# Transport OwpenGram direct pour Expo / React Native

Ce module connecte l’application directement à OwpenGram, avec le WebSocket natif de React Native. Il n’utilise ni passerelle, ni compte de stockage partagé, ni WebView, ni base sociale indépendante. Chaque publication ou message appartient au compte utilisateur OwpenGram connecté.

## Import mobile

```js
import * as ExpoCrypto from 'expo-crypto';

const {
  createOwpenClient, Api, Buffer, configureNativeRandom, owpenRandomId,
} = require('./transport/owpengram.bundle.cjs');

configureNativeRandom(ExpoCrypto.getRandomValues);

const client = await createOwpenClient({
  session: serializedSession || '',
  config: { apiId: configuredApiId, apiHash: configuredApiHash, dcId: 1 },
});
```

L’appel crée et connecte le client MTProto. Une chaîne de session vide crée uniquement une session de transport ; l’envoi d’un code de connexion exige un appel explicite à `authStart`. Le module ne lit aucune variable d’environnement et ne contient aucun identifiant d’application réel.

La façade mobile doit importer le **bundle**, pas le point d’entrée source ni `teleproto` directement. Le bundle inclut les variantes `browser` des dépendances, afin que Metro ne sélectionne pas les modules Node. Il exporte son propre `Buffer` : utiliser `Buffer.from(bytes)` ou `Buffer.from(base64, 'base64')` avant l’envoi d’un fichier.

Deux adaptations sont indispensables sur Expo SDK 55 / React Native 0.83 / Hermes : `buffer.js` conserve les méthodes Buffer sur les vues `subarray`, et `abort-controller.js` fournit `signal.reason` et `signal.throwIfAborted` aux contrôleurs internes de teleproto. Ces adaptations restent dans le bundle ; elles ne modifient pas les prototypes globaux de React Native. Les supprimer réintroduit des erreurs que le moteur V8 de Node ne reproduit pas spontanément.

L’ouverture complète (WebSocket, clé MTProto et configuration initiale) est bornée à 45 secondes ; les RPC de la façade sont bornés à 30 secondes. Un dépassement ferme la tentative, conserve la session existante et laisse l’utilisateur réessayer. Les erreurs distinguent blocage Android, échec d’upgrade WebSocket, interruption, délai, incompatibilité du moteur et rejet cryptographique, sans publier les exceptions brutes.

`configureNativeRandom` doit recevoir `ExpoCrypto.getRandomValues`, avant la construction d’un client. Les fonctions de hachage, AES et compression restent synchrones dans la bibliothèque portable. Elles n’exigent ni `SubtleCrypto`, ni WebAssembly, ni un polyfill Node. Aucun repli vers `Math.random` n’est ajouté.

## Session et cycle de vie

Conserver un seul client par compte actif, le temps que l’application est connectée. Après une connexion réussie, enregistrer `client.serializeSession()` dans Expo SecureStore. Réenregistrer la session après une opération susceptible de changer de DC. Une session contient la clé d’accès au compte : ne pas la journaliser ni l’inclure dans les URL ou les médias.

`isConnected()` indique l’état local de la connexion. Après une interruption réseau, `reconnect()` reprend le même client et la même clé MTProto, y compris pendant un code de connexion en attente ; plusieurs appels simultanés partagent une seule tentative. Cette méthode n’envoie aucun nouveau code.

`disconnect()` détruit le client et ferme ses connexions. Après cet appel, il faut en créer un nouveau avec la session sauvegardée. `logout()` révoque la session côté serveur puis détruit le client ; la façade doit supprimer la session locale. La reconnexion automatique est désactivée et les tentatives protocolaires sont bornées ; la façade gère explicitement la reprise de l’application.

Les identités retournées par les RPC sont gardées dans le cache de ce client. `StringSession` ne conserve pas les entités après un redémarrage. Les références de pairs `{ type, id, accessHash }` peuvent donc accompagner les objets locaux ; sinon `getDialogs()` ou `contacts.GetContacts` réalimentent ce cache. Un identifiant numérique seul ne permet pas d’inventer un `accessHash`.

## API de la façade

| Méthode | Résultat ou usage |
| --- | --- |
| `authStart(identifier)` | Email encodé comme Loligram ou numéro ; retourne un état `code` / `authorized` avec `phoneNumber`, `phoneCodeHash`, `codeKind`. |
| `authCode({ phoneNumber, phoneCodeHash, code, codeKind })` | Retourne `authorized`, `signup` ou `password` selon la réponse du serveur. |
| `authSignup({ phoneNumber, phoneCodeHash, firstName, lastName })` | Termine l’inscription après vérification du code. |
| `authPassword(password)` | Calcule la preuve SRP attendue par le serveur, sans envoyer le mot de passe en clair. |
| `getMe()`, `isAuthorized()` | Utilisateur TL et état d’autorisation. |
| `invoke(request)` | RPC TL brut avec erreurs normalisées et mise en cache des entités par teleproto. |
| `resolvePeer(peer)`, `getEntity(peer)`, `searchUsers(query, { limit })` | Résolution d’un pair, détail, recherche OwpenGram. |
| `getDialogs({ limit, offsetDate, offsetId, offsetPeer })` | Réponse TL `{ dialogs, messages, users, chats }`. |
| `getMessages(peer, { limit, before, ids })` | Historique TL ; la sélection par ID est vérifiée contre le pair demandé. |
| `sendMessage({ peer, text, randomId, replyTo })` | Message texte standard ; retourne un `Api.Message`. |
| `sendMedia({ peer, file, caption, randomId, replyTo })` | Média standard ; retourne un `Api.Message`. |
| `uploadFile(file, { onProgress })` | Retourne un `InputFile` / `InputFileBig`, notamment pour un avatar. |
| `uploadInputMedia(file, { kind, onProgress })` | Upload uniquement ; retourne `InputMediaUploadedPhoto` ou `InputMediaUploadedDocument`. |
| `downloadTLMedia(media, { thumb })` | Télécharge une `Photo`, un `Document` ou un `MessageMediaPhoto/Document` actuel, utile pour les stories et avatars. |
| `downloadMedia({ peer, messageId, id? }, { thumb })` | Recharge le message, vérifie son appartenance et rafraîchit une référence de fichier expirée. |
| `mediaReference(message, peer, file?)` | Référence locale sérialisée `owpg1:` ; aucun compte partagé ni URL publique. |
| `editMessage`, `deleteMessages`, `forwardMessages`, `sendReaction` | Opérations standard sur les messages. |
| `markRead`, `setHistoryTTL`, `getHistoryTTL`, `clearHistory` | Lecture et durée de conservation du dialogue. |

Les pairs acceptés sont `self`, `me`, `@pseudo`, `user:123`, `owp:123`, `chat:123`, `channel:123`, un descripteur `{ type, id, accessHash }` ou un `Api.InputPeer…`. Les identifiants TL de 64 bits doivent rester des chaînes ou des objets `big-integer` ; éviter leur conversion en nombres JavaScript.

Les méthodes renvoient une erreur `OwpenError` avec `code`, `errorMessage`, `status`, et éventuellement `seconds` pour l’attente anti-abus. Les flux de configuration supplémentaire d’un email et l’effacement pour soi dans un canal restent explicitement non pris en charge.

## Fichiers et publications

Le descripteur d’envoi est :

```js
const file = {
  buffer: Buffer.from(originalBytes),
  name: 'video.mp4',
  mime: 'video/mp4',
  kind: 'video',
  duration: 2.5, // secondes, depuis les métadonnées réelles
  width: 1920,
  height: 1080,
};
const media = await client.uploadInputMedia(file, { kind: 'video' });
```

`photo`, `video`, `voice` et `document` sont les types reconnus. Une vidéo exige une durée et ses dimensions. Un vocal exige une durée positive et un MIME audio réel ; un enregistrement AAC/M4A reste `audio/mp4` avec l’attribut `voice: true`. Aucune conversion Opus, fausse durée ou fausse waveform n’est ajoutée.

Une vidéo ou un document peut fournir `file.thumbnail = { buffer, mime: 'image/jpeg', name: 'thumbnail.jpg' }`. Le module vérifie le MIME, la signature JPEG et la limite de 128 KiB, puis transmet cet upload dans `InputMediaUploadedDocument.thumb`. La création de cette miniature depuis la vidéo appartient à la façade native. `onProgress` reçoit la progression réelle du fichier principal, entre 0 et 1.

Pour une grille, appeler `downloadTLMedia(media, { thumb: true })` ou `downloadMedia(reference, { thumb: true })`. Le module choisit une taille photo explicite et n’autorise aucun repli vers la vidéo complète. En l’absence de miniature disponible, il renvoie `OWPENGRAM_THUMBNAIL_UNAVAILABLE` ; la grille peut montrer son visuel d’attente. Un nom de taille ou un index peut également être fourni à `thumb`.

Pour une publication, passer le média à `new Api.stories.SendStory(...)`, avec `pinned: true` et les règles de visibilité voulues. Employer `owpenRandomId('story:<userId>:<clientMessageId>')` avec un identifiant de tentative conservé par la façade : le résultat est déterministe sur 64 bits et permet les nouvelles tentatives idempotentes. La méthode haut niveau `teleproto.sendStory` génère son propre identifiant et n’est pas utilisée ici.

Pour un avatar photo, `uploadInputMedia(photo).file` est l’`InputFile` attendu par `Api.photos.UploadProfilePhoto`. Pour télécharger un avatar, récupérer sa `Photo` complète via `users.GetFullUser` ou `photos.GetUserPhotos`, puis appeler `downloadTLMedia`. Un `UserProfilePhoto` seul ne contient pas toutes les informations de téléchargement.

Les octets du fichier vont directement dans `upload.saveFilePart`, sans enveloppe AES supplémentaire de l’application. Le protocole MTProto conserve son chiffrement de transport. Les anciens fichiers Loligram protégés par une enveloppe média propre à Loligram ne sont pas déchiffrés par ce module.

Envoi et réception sont limités à **20 MiB par défaut**. Une taille annoncée supérieure est rejetée avant le téléchargement. La réception produit un Buffer complet : la façade doit éviter les téléchargements simultanés nombreux, écrire les fichiers dans son cache local et libérer les buffers. La configuration explicite `maxFileBytes` peut modifier le plafond ; l’augmenter accroît l’utilisation mémoire.

## Serveur verrouillé

Le WebSocket est fixé à `ws://152.89.254.50:2398/apiws`, sous-protocole `binary`. Tous les DC de messages et fichiers 1 à 5 utilisent cette adresse. La clé RSA publique est celle vérifiée dans Loligram IV, empreinte `0xdff66c3cbd5ceeca`. Les sessions importées qui désignent un autre serveur sont refusées. La configuration distante ne peut modifier ni l’adresse ni l’ensemble des clés ; les CDN sont désactivés.

L’application native doit autoriser ce WebSocket sur Android/iOS dans sa configuration de compilation. L’endpoint TLS/WSS n’a pas été établi pour cette adresse ; ce module n’en invente pas. Un site chargé en HTTPS peut bloquer ce WebSocket `ws:` comme contenu mixte : la cible de cette intégration est l’application native Expo.

Sources de l’identité et du transport :

- [Loligram IV, OwpengramServers.java, commit b05b98f3d07e44a89f501c1f4b3b8c442bbafca2](https://github.com/13haght/Loligram-IV-copie/blob/b05b98f3d07e44a89f501c1f4b3b8c442bbafca2/TMessagesProj/src/main/java/org/telegram/owpengram/OwpengramServers.java).
- [Serveur OwpenGram, multiplexeur `/apiws`, commit fd717289860a1076133436e1bcb1adc49d04100f](https://github.com/owpengram/owpengram-server/blob/fd717289860a1076133436e1bcb1adc49d04100f/internal/mtprotoedge/same_port_mux.go).
- `teleproto@1.232.1`, layer 232 : `network/transport/socket/WebSocketSocket.js`, `platform/crypto/index.js`, `client/rpc/invoke.js`.

## Reconstruction et vérification

```sh
node scripts/build-owpengram.cjs
node --test tests/owpengram-transport.test.cjs
```

Le script exige `teleproto@1.232.1` et esbuild, compile les variantes navigateur et refuse tout import runtime externe ou branche Node détectée. Il faut régénérer le bundle après modification des sources.

Les tests exécutent le bundle dans une VM dépourvue de Node, WebAssembly, SubtleCrypto, encodeurs DOM et compression navigateur. Ils vérifient les primitives portables, le verrouillage RSA/DC/URL, les sessions, les transitions d’authentification, la sérialisation des RPC, les attributs audio/vidéo et les plafonds de téléchargement. Les sockets sont simulés : aucun compte, code de connexion, publication ou message réel n’est utilisé. La réception en conditions réelles sur un appareil et le serveur reste une validation distincte.

Le workflow `owpengram-android.yml` ajoute un émulateur Android 35 avec Hermes : une entrée de test isolée établit réellement MTProto, teste SecureStore et appelle `auth.sendCode` avec un identifiant vide (réponse de rejet attendue, aucun destinataire). Il restaure ensuite l’entrée de l’application, compile l’APK complet et teste son écran de connexion avec le bouton Continuer. Seul cet APK complet est publié. Ce test ne valide pas la réception d’un code réel ni une session utilisateur authentifiée.
