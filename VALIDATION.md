# Validation de la correction Android OwpenGram — 13 novembre 2026

## Cause démontrée

Le code initial a été exécuté dans un **émulateur Android 35, React Native 0.83.10, Expo SDK 55 et Hermes**, avec les paramètres API provenant des secrets du dépôt.

Le WebSocket s’ouvre, puis l’obfuscation du transport échoue avant le premier échange MTProto : `encryptor.encrypt(header).subarray(56).copy(header, 56)` dans `teleproto/network/connection/Obfuscation.js:47`. Sous Hermes, `buffer@6` hérite d’un `TypedArray.subarray` qui renvoie un `Uint8Array` dépourvu de `copy`. Les tests V8 précédents conservaient le prototype Buffer et ne reproduisaient donc pas ce défaut.

Preuves Android avant correction : [première reproduction](https://github.com/13haght/Bear-Like-OwpenGram/actions/runs/43352148652), puis [localisation par source map](https://github.com/13haght/Bear-Like-OwpenGram/actions/runs/43353026149). Les journaux contiennent seulement des étapes, catégories et coordonnées de source, jamais les requêtes, clés ou sessions.

Un deuxième défaut a été reproduit avec **le paquet `abort-controller` réellement installé par React Native** : teleproto appelle `signal.throwIfAborted()`, absent de cette implémentation. Elle ne conserve pas non plus `signal.reason`. Cela bloque les RPC et leur annulation, même après réparation du transport.

## Comparaison avec Loligram IV

- Loligram utilise la pile native Java/C++ et des sockets TCP ; il ne dépend pas des vues Buffer et des contrôleurs d’annulation JavaScript de BearLike.
- Le serveur `152.89.254.50:2398`, la clé RSA publique et le centre principal 1 de BearLike correspondent à `OwpengramServers.java`. Tous les centres autorisés restent attachés à ce serveur.
- La clé publique annoncée par `/owpengram/server-info` correspond également à la clé épinglée. Cette réponse HTTP n’est pas utilisée pour élargir la confiance cryptographique.
- L’e-mail est encodé en identifiant commençant par `888`, selon `EmailSignupPhone.java`. Le code e-mail passe par `auth.signIn.emailVerification`, puis `auth.signUp` si le serveur demande une inscription, comme dans `LoginActivity.java`.
- L’exception réseau Android existante autorise le WebSocket uniquement vers le serveur OwpenGram. Son ouverture a été observée avant correction : remplacer WebSocket par TCP n’est pas nécessaire pour corriger ce défaut démontré.

## Modifications

- `transport/buffer.js` rétablit les méthodes Buffer sur les vues `subarray` sans copier les octets ni changer les prototypes globaux de React Native.
- `transport/abort-controller.js`, injecté seulement dans le bundle du protocole, conserve les événements natifs et ajoute `reason` / `throwIfAborted`.
- Bundle régénéré ; version teleproto inchangée et verrouillée. Aucun module Node externe ne doit subsister dans le bundle mobile.
- Délai de 45 secondes pour toute l’ouverture et la négociation ; délai de 30 secondes pour les RPC de la façade. Les connexions abandonnées sont fermées.
- Catégories d’erreur distinctes pour réseau Android, WebSocket, interruption, délai, moteur JavaScript et vérification cryptographique, sans exception brute dans l’interface.
- Aucun changement de l’interface, du protocole des médias ou des publications. Aucun Turso, serveur intermédiaire ou chiffrement média spécifique à Loligram ajouté. Épinglage RSA, contrôle des centres et vérifications MTProto maintenus.

## Vérifications

- **172 tests locaux réussis**, dont reproduction des vues typées de Hermes, vraie implémentation React Native d’AbortController, en-tête obfusqué, RPC d’identification, annulation à échéance et vecteur AES-256-CTR NIST. Les tests existants couvrant interfaces, sessions, messages, médias et réactions passent également.
- Le workflow `owpengram-android.yml` compile une entrée de test isolée, exécute Hermes sur Android, vérifie SecureStore et appelle réellement `auth.sendCode` avec un identifiant vide. Une réponse serveur `PHONE_NUMBER_INVALID` ou `PHONE_NUMBER_EMPTY` est attendue ; aucun destinataire ni code réel n’est utilisé.
- Il restaure ensuite `index.js`, compile l’application complète pour les quatre architectures Android et installe cet APK. Le bouton Continuer doit établir la connexion puis rejeter localement le numéro volontairement invalide `00000`.
- L’artefact n’est publié qu’après ces étapes, contrôle du JavaScript embarqué, des bibliothèques natives et de la signature de test.

Résultat du [workflow corrigé](https://github.com/13haght/Bear-Like-OwpenGram/actions/runs/43356324336) : **réussite**, pour le commit applicatif [`dfa84ce3176eefd33c555dbf370720e1740a5257`](https://github.com/13haght/Bear-Like-OwpenGram/commit/dfa84ce3176eefd33c555dbf370720e1740a5257).

- Les **172 tests** passent également sur GitHub Actions.
- Sur l’émulateur Android 35 avec Hermes : paramètres API valides, écriture/lecture/suppression SecureStore, clé RSA épinglée, ouverture WebSocket, obfuscation, négociation MTProto et réponse attendue à la véritable RPC `auth.sendCode` réussissent.
- L’APK complet est compilé pour `armeabi-v7a`, `arm64-v8a`, `x86` et `x86_64`. Son installation, son démarrage et le parcours Continuer passent dans l’émulateur `x86_64`. Les architectures ARM sont compilées, mais n’ont pas été exécutées sur un appareil.
- Le JavaScript embarqué, les bibliothèques natives et la signature de test de l’APK ont été vérifiés avant publication.
- [Télécharger BearLike-OwpenGram-Android-fix.apk](https://github.com/13haght/Bear-Like-OwpenGram/actions/runs/43356324336/artifacts/14007121034) : **86 945 893 octets**, artefact non expiré lors de la vérification, conservé jusqu’au **27 novembre 2026**. Une connexion GitHub peut être nécessaire.
- SHA-256 calculé sur le fichier APK et confirmé par l’artefact publié : `737ccc9d3677e2f1723ec0d5f22fc0ca2a01f0a03570c9c4542e79a25ec58601`.

## Limites de validation

Aucun téléphone physique ni compte utilisateur authentifié n’a été utilisé. Une réponse à une requête d’identification invalide prouve que la requête chiffrée atteint le serveur ; elle ne prouve pas la réception d’un vrai code ni sa validation. Inscription complète, connexion au compte de l’utilisateur, échanges et publications de médias réels restent à confirmer avec ce compte. Les tests des fonctionnalités authentifiées sont des tests de régression locaux.

L’APK conserve l’identité de prévisualisation existante `com.bearlike.owpengram.preview` et la signature de test du template Expo. Les valeurs API proviennent des secrets GitHub lors de la compilation et ne sont pas recopiées dans le dépôt ou les journaux.
