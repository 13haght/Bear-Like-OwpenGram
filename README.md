# Bear Like V55 — OwpenGram seul

Version du 12 novembre 2026, préparée pour compiler un APK de test dans GitHub Actions. Cette version remplace l’architecture V54 après la demande de supprimer Turso et de conserver OwpenGram comme seul service distant.

## Compiler un APK avec GitHub

Le workflow fourni dans `.github/workflows/android-apk.yml` prépare le projet Android avec Expo puis compile un APK autonome avec Gradle. Aucun compte Expo, abonnement EAS ou serveur de développement n’est nécessaire pour cette compilation. Le déclenchement est manuel.

### 1. Créer le dépôt

Sur [GitHub — nouveau dépôt](https://github.com/new), choisir le compte voulu, le nom `Bear-Like-OwpenGram`, la visibilité **Private**, puis activer **Add README** et créer le dépôt.

Si ChatGPT doit déposer les fichiers, lui envoyer ensuite l’URL du dépôt. La connexion GitHub de ChatGPT doit avoir accès à ce nouveau dépôt privé.

Pour un envoi manuel, placer le **contenu** du dossier `projet` de l’archive à la racine du dépôt, y compris `.github/`, `.gitignore` et `.env.example`. `package.json` doit être à la racine, et non dans un sous-dossier `projet`. Ne pas envoyer le ZIP comme seul fichier du dépôt. Les paramètres privés de l’archive sont séparés du dossier à publier.

### 2. Ajouter les paramètres OwpenGram

Dans le dépôt : **Settings → Secrets and variables → Actions → New repository secret**. Créer ces deux secrets avec les valeurs correspondantes du fichier `PARAMETRES_PRIVES.env` livré à côté du dossier `projet` :

| Nom exact du secret | Valeur à copier |
| --- | --- |
| `EXPO_PUBLIC_OWPENGRAM_API_ID` | La valeur après `=` sur la ligne du même nom. |
| `EXPO_PUBLIC_OWPENGRAM_API_HASH` | La valeur après `=` sur la ligne du même nom. |

Ces paramètres identifient l’application auprès d’OwpenGram. Ils proviennent de la configuration de référence Loligram IV déjà consultée. Aucun code reçu par SMS/email, mot de passe, session utilisateur ou jeton Expo n’est à ajouter. Ces deux valeurs sont intégrées au client mobile à la compilation ; les secrets GitHub évitent de les placer dans l’historique du dépôt et ses journaux, mais ne les rendent pas impossibles à retrouver dans un APK.

### 3. Lancer et récupérer l’APK

1. Ouvrir **Actions** dans le dépôt.
2. Choisir **Compiler l’APK Android**.
3. Cliquer sur **Run workflow**, sélectionner `main`, puis confirmer **Run workflow**.
4. Ouvrir l’exécution et attendre que toutes les étapes réussissent.
5. Dans **Artifacts**, télécharger l’artefact proposé. S’il est téléchargé en ZIP, l’extraire : il contient `BearLike-OwpenGram-test.apk`.
6. Transférer l’APK sur Android et l’ouvrir pour l’installer.

Le workflow doit être présent sur la branche par défaut pour que le bouton de lancement apparaisse. Il vérifie la présence et le format des deux paramètres avant toute compilation. Un résultat vert n’est produit qu’après compilation et vérification de l’APK ; aucun APK n’est fourni quand une étape échoue.

### Identité de cet APK de test

Sans les anciens fichiers `app.json` et `eas.json`, le projet utilise le package distinct **`com.bearlike.owpengram.preview`**. Cet APK est compilé en variante `release`, avec le code JavaScript embarqué, puis signé avec la clé de test du modèle Android Expo. Il sert aux essais et peut être installé en parallèle de l’ancienne application si celle-ci utilise un autre package.

Cette signature de test n’est pas la signature de publication de l’ancienne application. Pour livrer une mise à jour de l’application existante ou publier sur une boutique, il faut restaurer son véritable package et sa configuration de signature. La procédure EAS existante reste décrite plus bas.

Le workflow utilise Node.js 22, Java 17 et un modèle Android Expo SDK 55 fixé à la version `55.0.44`. Les dépendances JavaScript sont verrouillées par `package-lock.json` et les actions GitHub sont fixées à des révisions précises.

## Ce que contient cette version

L’application Android Expo/React Native se connecte directement au serveur OwpenGram déjà utilisé par la référence Loligram IV. Elle n’a besoin d’aucun backend Bear Like, d’aucune passerelle HTTP, d’aucun compte de stockage partagé et d’aucune base Turso à créer ou à héberger.

| Fonction | Fonctionnement |
| --- | --- |
| Inscription et connexion | Compte OwpenGram natif ; email ou téléphone selon les possibilités du serveur, code, création de compte et double authentification si demandée. |
| Session | Clé de session MTProto conservée uniquement dans le stockage sécurisé de l’appareil. Aucun JWT Bear Like. |
| Photos et vidéos publiées | Publications de profil natives, réalisées avec les stories épinglées d’OwpenGram. Une photo ou une vidéo par publication. |
| Réactions aux publications | Réaction emoji native, retrait de sa réaction et compteurs fournis par le serveur. |
| Fil | Publications du compte connecté et de ses contacts OwpenGram. |
| Recherche et contacts | Recherche native de comptes et ajout/retrait des contacts OwpenGram. |
| Profil | Nom, biographie et photo de profil du compte OwpenGram. |
| Conversations | Discussions natives avec texte, photos, vidéos et messages vocaux. |
| Historique | Cinquante messages par page, avec chargement des messages précédents. |
| Médias reçus | Téléchargement natif vers un cache de l’appareil, séparé par compte. |

Les fichiers sont transmis sans la couche supplémentaire de chiffrement média de Loligram. Le protocole MTProto conserve son chiffrement de transport : le serveur OwpenGram reçoit et gère les photos, vidéos et messages ordinaires. Les mots de passe et les codes ne sont pas inscrits dans les brouillons, les journaux ou le cache.

Les données sociales et les conversations sont celles d’OwpenGram. Les fichiers locaux servent uniquement aux préférences, aux brouillons, au classement de l’Inbox et au cache. La base interne du serveur OwpenGram reste sous la responsabilité de ce serveur ; cette application n’en installe pas une seconde.

## Démarrage local

Node.js 22 à 24 est attendu ; validation réalisée avec Node.js 24.22.1 et Expo SDK 55.

Pour le développement local, copier `PARAMETRES_PRIVES.env` depuis l’archive vers la racine du projet sous le nom `.env.local`. Ce fichier est ignoré par Git.

```bash
npm ci
npm run build:protocol
npm test
npm start
```

Le transport compilé `transport/owpengram.bundle.cjs` est livré avec les sources. Pour le reconstruire après modification :

```bash
npm run build:protocol
```

Ne pas importer directement `teleproto` dans `App.js` ou les modules React Native : son point d’entrée Node ne convient pas à Metro. La construction fournie sélectionne les dépendances portables et inclut leurs licences.

### Configuration de l’application OwpenGram

Le dossier à publier sur GitHub ne contient aucune valeur privée. Le fichier `PARAMETRES_PRIVES.env` de l’archive conserve séparément l’identité API d’application présente dans le `BuildVars.java` de la référence Loligram IV consultée. Il ne contient aucune session utilisateur, aucun code de connexion ni aucun mot de passe utilisateur.

Les variables utilisées sont `EXPO_PUBLIC_OWPENGRAM_API_ID` et `EXPO_PUBLIC_OWPENGRAM_API_HASH`. Pour GitHub Actions, renseigner les deux secrets indiqués ci-dessus. Pour une compilation EAS distante, renseigner ces deux mêmes variables dans l’environnement EAS sélectionné : `.env.local` est volontairement ignoré par Git et peut être absent de l’archive envoyée à EAS. `.env.example` décrit les noms sans recopier les valeurs.

Le serveur et sa clé RSA sont fixés dans `transport/owpengram-config.js`. Aucune URL de passerelle, clé Turso, session de compte de stockage, clé JWT ou clé AES de médias n’est à ajouter.

## Reprendre la compilation EAS de l’application existante

Le dossier initial transmis ne contenait pas les véritables `app.json` et `eas.json` du projet existant. Cette archive ne fabrique donc pas une identité de production, un identifiant de projet EAS ou une clé de signature.

Pour continuer le projet Android existant :

1. Remettre ses véritables `app.json` et `eas.json` à la racine de ce dossier.
2. Exécuter `npm run configure:owpengram`. Le script sauvegarde les deux fichiers avant modification, ajoute les plugins et prépare le profil APK. Il conserve le package Android, le projet EAS, le `versionCode`, la configuration de signature et les autres profils.
3. Renseigner les deux variables API dans l’environnement EAS retenu, avec les valeurs de `.env.local`.
4. Exécuter `npm run build:apk` depuis le compte EAS du projet.

Pour une prévisualisation locale sans ces fichiers, `app.config.js` utilise les exemples et le package distinct `com.bearlike.owpengram.preview`. Une compilation EAS refuse ce mode de prévisualisation et demande la véritable configuration du projet.

Le plugin `plugins/with-owpengram-network.cjs` crée la configuration réseau Android nécessaire au WebSocket du serveur. L’exception de trafic WebSocket sans TLS est limitée au domaine IP `152.89.254.50` ; les données MTProto restent protégées par le protocole et la clé épinglée. Le plugin refuse d’écraser silencieusement une autre politique réseau Android déjà présente. Le build natif doit inclure ce plugin ; un export JavaScript seul ne l’installe pas dans un APK existant.

Cette livraison cible Android. Une configuration réseau et une validation iOS restent à réaliser avant de présenter une version iOS comme fonctionnelle.

## Publications, contacts et médias

Une publication est une story native conservée sur le profil avec `pinned: true`. Les lectures du profil utilisent `stories.GetPinnedStories` et ne masquent pas une publication épinglée parce que sa période de story active est terminée. Les réactions passent par `stories.SendReaction`.

Le fil charge au maximum cinquante contacts et dix publications par profil, ainsi que les publications du compte connecté. L’interface indique sa couverture et ses éventuels échecs partiels. Un profil consulté par recherche n’est pas ajouté artificiellement au fil Contacts. Les profils possèdent leur propre pagination native ; le chargement du profil parcourt ces pages.

Un brouillon et son identifiant d’envoi sont conservés avant le premier transfert. Une reprise utilise le même identifiant natif. Après confirmation du serveur, le reçu est conservé avant la mise à jour du cache : un échec de sauvegarde locale ne provoque pas automatiquement une seconde publication. Les messages utilisent également un identifiant stable pour leurs nouvelles tentatives.

### Limites actuelles

- Une photo **ou** une vidéo par publication, sans carrousel. Un ancien brouillon contenant plusieurs médias est conservé et demande de choisir un seul média.
- Description limitée à 1 024 caractères dans l’interface.
- Médias sortants : 18 Mio maximum. Photo de profil : 5 Mio. Téléchargement : 20 Mio maximum par fichier, avec deux téléchargements simultanés au plus. Ces plafonds limitent les buffers en mémoire JavaScript ; ce ne sont pas des limites annoncées du serveur OwpenGram.
- Photos JPEG, PNG ou WEBP ; vidéos MP4 ; vocaux de l’application enregistrés en AAC/M4A avec le MIME `audio/mp4` et leur durée réelle.
- Les vignettes vidéo sont générées localement si le codec le permet et envoyées au serveur. Sans miniature disponible, la grille affiche un aperçu indisponible ; elle ne télécharge pas la vidéo complète pour fabriquer une vignette.
- Liste initiale limitée à cent conversations, avec indication à l’écran. L’historique de chaque discussion ouverte se charge par pages de cinquante messages.
- Actualisation des conversations à l’ouverture et toutes les quinze secondes lorsque l’application est active. Les notifications push en arrière-plan ne sont pas ajoutées par cette version.
- Les brouillons, les préférences et les classements épinglé/archivé de l’Inbox restent propres à cet appareil.
- Les médias déjà protégés par une enveloppe AES spécifique à Loligram ne sont pas déchiffrés ici. Les nouveaux envois de cette application utilisent les médias OwpenGram ordinaires.

Les anciens commentaires publics indépendants, followers, republications, visiteurs de profil, classements et notifications sociales Bear Like ont été retirés. La recherche mondiale de publications par hashtag n’est pas présentée comme disponible. Les compteurs absents dans une réponse OwpenGram sont masqués, sans inventer une valeur.

Les anciens comptes Bear Like, publications Turso, mots de passe et caches de la passerelle ne sont pas migrés automatiquement. Le dossier de l’ancien projet et le projet Loligram ne sont pas modifiés par cette livraison.

## Vérifications

Voir `VALIDATION.md` pour les commandes exécutées, leurs résultats et les validations restant à effectuer. Les tests utilisent des données simulées avec les véritables constructeurs TL ; ils ne créent aucun compte et n’envoient aucun code, message ou média réel.

Un export Android/Hermes réussi valide la construction JavaScript et ses imports. Il ne constitue pas une compilation APK signée ni un essai réseau sur téléphone. La réception d’un code, la connexion réelle, la publication et la lecture réelles doivent encore être vérifiées avec un compte de test sur un appareil Android.

## Fichiers principaux

| Fichier | Rôle |
| --- | --- |
| `App.js` | Interface de l’application. |
| `.github/workflows/android-apk.yml` | Compilation manuelle de l’APK autonome dans GitHub Actions. |
| `components/OwpengramAuth.js` | Étapes de connexion, inscription et double authentification. |
| `lib/owpengram-auth.js` | Session privée, stockage sécurisé, reconnexion et garde contre les réponses tardives. |
| `lib/owpengram-api.js` | Façade locale utilisée par l’interface ; les chemins `/api/…` sont des noms internes, sans serveur HTTP. |
| `lib/owpengram-social.js` | Profils, contacts, publications épinglées et réactions natives. |
| `lib/owpengram-media.js` | Fichiers natifs, miniatures, cache et résolution des médias. |
| `transport/` | Client MTProto portable, serveur et RSA épinglés, bundle compilé et licences. |
| `plugins/with-owpengram-network.cjs` | Configuration réseau Android ciblée. |
| `tests/` | Tests de protocole, authentification, médias, API, interface et configuration native. |

## Références techniques consultées

- [Créer un dépôt GitHub](https://docs.github.com/en/repositories/creating-and-managing-repositories/creating-a-new-repository).
- [Créer les secrets GitHub Actions](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets).
- [Lancer un workflow manuellement](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow).
- [Configuration serveur de Loligram IV](https://github.com/13haght/Loligram-IV-copie/blob/b05b98f3d07e44a89f501c1f4b3b8c442bbafca2/TMessagesProj/src/main/java/org/telegram/owpengram/OwpengramServers.java).
- [Identité d’application de la référence Loligram IV](https://github.com/13haght/Loligram-IV-copie/blob/test-profile-insta/TMessagesProj/src/main/java/org/telegram/messenger/BuildVars.java), consultée le 12 novembre 2026.
- [RPC stories du serveur OwpenGram](https://github.com/owpengram/owpengram-server/blob/fd717289860a1076133436e1bcb1adc49d04100f/internal/rpc/stories.go).
- [Stockage natif des stories et publications épinglées](https://github.com/owpengram/owpengram-server/blob/fd717289860a1076133436e1bcb1adc49d04100f/internal/store/postgres/story.go).
- [Tests des RPC stories, dont les nouvelles tentatives avec randomId](https://github.com/owpengram/owpengram-server/blob/fd717289860a1076133436e1bcb1adc49d04100f/internal/rpc/stories_rpc_test.go).

Le transport livré fixe `teleproto` à la version `1.232.1`. Les API Expo utilisées ont été vérifiées dans les sources des dépendances installées et verrouillées dans `package-lock.json`.
