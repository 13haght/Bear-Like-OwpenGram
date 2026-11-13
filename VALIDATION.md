# Vérifications — préparation GitHub et APK Android

Vérifications effectuées le 12 novembre 2026 sur les sources Bear Like V55 OwpenGram seul.

## Résultats obtenus

| Vérification | Résultat |
| --- | --- |
| Reconstruction du protocole avec `npm run build:protocol` | Réussie ; le bundle reste identique à celui de la livraison V55 validée. |
| `npm test` | **166 tests réussis, 0 échec, 0 ignoré.** |
| Analyse du workflow YAML et des nouveaux contrôles CI | Incluse dans les 166 tests : déclenchement manuel, actions fixées, paramètres, ordre des étapes, APK autonome et certificat de test. |
| Génération native Android Expo SDK 55 | Réussie dans une copie isolée, avec le paquet exact `expo-template-bare-minimum@55.0.44`. |
| Package Android généré | `com.bearlike.owpengram.preview`. |
| JavaScript embarqué | Le projet Gradle généré utilise `export:embed` pour la compilation release. |
| Signature prévue par le projet généré | `signingConfigs.debug`, avec le fichier de clé de test présent dans le template. |
| Configuration réseau Android | Trafic sans TLS refusé par défaut ; exception limitée à `152.89.254.50`, avec MTProto et sa clé serveur épinglée. |
| Confidentialité du dossier à publier | Les valeurs API privées ne figurent dans aucun fichier du dossier `projet`. Elles sont livrées séparément dans l’archive. |

La suite précédente comportait 162 tests. Quatre contrôles de la compilation GitHub ont été ajoutés. L’interface et le fonctionnement de l’application n’ont pas été modifiés pendant cette préparation GitHub.

## Génération Android vérifiée

La commande du workflow est :

```bash
npx expo prebuild --platform android --clean --no-install \
  --template expo-template-bare-minimum@55.0.44
```

Dans cet environnement, le premier téléchargement effectué par Expo a dépassé le délai du proxy. Le même paquet a ensuite été téléchargé normalement avec `npm pack`, puis son intégrité SHA-512 a été comparée à celle annoncée par npm. La génération a réussi en fournissant cette archive locale à l’option `--template`.

```text
sha512-Ioay+lfIK2lMAvBPgE4oTlAHTKAkw9CCXQCjvKCdIPLeQae0gLp0mR4RzE6PbjYoCJ2FpNTAggkpGuqOJSOiLQ==
```

Le prébuild a uniquement changé le script `android` de sa copie temporaire ; aucune dépendance n’a été remplacée. Le dossier des sources livré conserve son `package.json` et son verrouillage d’origine.

## Ce qui reste à vérifier

**Aucun APK natif n’a encore été compilé ni exécuté sur téléphone dans cette préparation.** Le SDK Android n’est pas installé ici. La première exécution GitHub devra donc confirmer la compilation Gradle complète et produire le fichier installable.

Le workflow ne publie l’artefact qu’après réussite de Gradle, vérification des composants de l’APK et vérification de sa signature. Une erreur arrête le travail avant cette publication.

L’export JavaScript Android/Hermes de la livraison V55 précédente avait réussi. Cet export, les tests et le prébuild ne remplacent pas un essai réel de connexion, de publication, de réactions et de messagerie avec un compte de test sur Android. Aucun code de connexion, compte, message ou média réel n’a été envoyé pendant les vérifications.

Le dépôt GitHub n’a pas encore été créé ou rempli : la création du dépôt doit être effectuée depuis le compte GitHub de son propriétaire, puis son URL peut être fournie pour l’envoi des sources.
