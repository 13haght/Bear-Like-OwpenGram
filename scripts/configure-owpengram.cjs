'use strict';
// Adds the new dependency plugins while preserving the user's Expo identity.
const fs = require('node:fs');
const names = ['app.json', 'eas.json'];
for (const name of names) {
  if (!fs.existsSync(name)) throw new Error('Conserve ' + name + ' du dépôt Bear Like existant. Les exemples ne contiennent pas ton identité EAS.');
}
const app = JSON.parse(fs.readFileSync('app.json', 'utf8'));
const eas = JSON.parse(fs.readFileSync('eas.json', 'utf8'));
if (!app.expo) throw new Error('app.json doit contenir expo.');
if (eas.build?.preview?.android?.gradleCommand) {
  throw new Error('La commande Gradle personnalisée doit être vérifiée avant de sélectionner le profil APK.');
}
const stamp = Date.now();
for (const name of names) fs.copyFileSync(name, name + '.avant-owpengram-' + stamp);
app.expo.plugins = app.expo.plugins || [];
for (const plugin of ['expo-secure-store', 'expo-audio', 'expo-video', './plugins/with-owpengram-network.cjs']) {
  if (!app.expo.plugins.some(entry => (Array.isArray(entry) ? entry[0] : entry) === plugin)) app.expo.plugins.push(plugin);
}
app.expo.android = { ...app.expo.android, softwareKeyboardLayoutMode: 'resize' };
app.expo.android.permissions = [...new Set([...(app.expo.android.permissions || []), 'RECORD_AUDIO'])];
eas.build = eas.build || {};
eas.build.preview = {
  ...eas.build.preview,
  distribution: 'internal',
  environment: eas.build.preview?.environment || 'preview',
  android: { ...eas.build.preview?.android, buildType: 'apk' },
};
fs.writeFileSync('app.json', JSON.stringify(app, null, 2) + '\n');
fs.writeFileSync('eas.json', JSON.stringify(eas, null, 2) + '\n');
console.log('Configuration V55 OwpenGram direct ajoutée. Identité EAS, package Android, signature et versionCode conservés.');
