'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { parseStringPromise } = require('xml2js');
const { compileModsAsync, withAndroidManifest, AndroidConfig } = require('@expo/config-plugins');
const withOwpenGramNetwork = require('../plugins/with-owpengram-network.cjs');
const configureScript = path.resolve(__dirname, '../scripts/configure-owpengram.cjs');

function temporaryProject(t) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'bear-owpen-network-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  return folder;
}

function androidFixture(folder, existingNetworkConfig = '') {
  const main = path.join(folder, 'android/app/src/main');
  fs.mkdirSync(main, { recursive: true });
  const manifest = path.join(main, 'AndroidManifest.xml');
  fs.writeFileSync(manifest, `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.example.bearfixture">
  <uses-permission android:name="android.permission.INTERNET" />
  <application android:name=".MainApplication" android:label="Existing application" android:usesCleartextTraffic="true"${existingNetworkConfig ? ` android:networkSecurityConfig="${existingNetworkConfig}"` : ''} />
</manifest>
`);
  return { manifest, resource: path.join(main, 'res/xml/owpengram_network_security_config.xml') };
}

function expoFixture() {
  return { name: 'Local fixture', slug: 'local-fixture', android: { package: 'com.example.bearfixture' } };
}

test('the real Expo mod pipeline writes the sole-host Android resource before referencing it', async (t) => {
  const folder = temporaryProject(t), files = androidFixture(folder);
  let resourceExistedDuringManifest = false;
  let config = withOwpenGramNetwork(expoFixture());
  config = withAndroidManifest(config, mod => {
    resourceExistedDuringManifest = fs.existsSync(files.resource);
    return mod;
  });
  await compileModsAsync(config, { projectRoot: folder, platforms: ['android'], assertMissingModProviders: true });
  assert.equal(resourceExistedDuringManifest, true);
  const manifest = await AndroidConfig.Manifest.readAndroidManifestAsync(files.manifest);
  const app = AndroidConfig.Manifest.getMainApplicationOrThrow(manifest);
  assert.equal(manifest.manifest.$.package, 'com.example.bearfixture');
  assert.equal(app.$['android:label'], 'Existing application');
  assert.equal(app.$['android:networkSecurityConfig'], '@xml/owpengram_network_security_config');
  assert.equal(app.$['android:usesCleartextTraffic'], 'false');
  const xml = (await parseStringPromise(fs.readFileSync(files.resource, 'utf8')))['network-security-config'];
  assert.equal(xml['base-config'].length, 1);
  assert.equal(xml['base-config'][0].$.cleartextTrafficPermitted, 'false');
  assert.deepEqual(xml['base-config'][0]['trust-anchors'][0].certificates.map(item => item.$.src), ['system']);
  assert.equal(xml['domain-config'].length, 1);
  assert.equal(xml['domain-config'][0].$.cleartextTrafficPermitted, 'true');
  assert.equal(xml['domain-config'][0].domain.length, 1);
  assert.equal(xml['domain-config'][0].domain[0]._, '152.89.254.50');
  assert.equal(xml['domain-config'][0].domain[0].$.includeSubdomains, 'false');

  // A second prebuild keeps the same manifest reference and exactly one policy.
  const firstResource = fs.readFileSync(files.resource, 'utf8');
  await compileModsAsync(withOwpenGramNetwork(expoFixture()), { projectRoot: folder, platforms: ['android'] });
  assert.equal(fs.readFileSync(files.resource, 'utf8'), firstResource);
});

test('the native plugin refuses to overwrite an existing unrelated network policy', async (t) => {
  const folder = temporaryProject(t), files = androidFixture(folder, '@xml/existing_network_policy');
  const before = fs.readFileSync(files.manifest, 'utf8');
  await assert.rejects(compileModsAsync(withOwpenGramNetwork(expoFixture()), {
    projectRoot: folder, platforms: ['android'],
  }), /configuration réseau Android existe déjà/);
  assert.equal(fs.readFileSync(files.manifest, 'utf8'), before);
});

function writeExpoConfig(folder, { gradleCommand } = {}) {
  const app = {
    expo: {
      name: 'Existing Bear application', slug: 'existing-bear', owner: 'existing-owner', version: '2.7.4',
      android: { package: 'com.example.existingbear', versionCode: 74, permissions: ['CAMERA'], adaptiveIcon: { backgroundColor: '#abcdef' } },
      ios: { bundleIdentifier: 'com.example.existingbear', buildNumber: '74' },
      runtimeVersion: { policy: 'appVersion' },
      extra: { feature: 'preserved', eas: { projectId: '11111111-1111-4111-8111-111111111111' } },
      plugins: [['expo-secure-store', { configureAndroidBackup: false }], ['existing-custom-plugin', { setting: 'keep' }]],
    },
  };
  const eas = {
    cli: { appVersionSource: 'remote' },
    build: {
      production: { channel: 'release', android: { buildType: 'app-bundle' } },
      preview: { channel: 'test-channel', environment: 'existing-preview', android: { credentialsSource: 'local', ...(gradleCommand ? { gradleCommand } : {}) } },
    },
    submit: { production: { android: { track: 'internal' } } },
  };
  const serialized = { app: JSON.stringify(app, null, 2) + '\n', eas: JSON.stringify(eas, null, 2) + '\n' };
  fs.writeFileSync(path.join(folder, 'app.json'), serialized.app);
  fs.writeFileSync(path.join(folder, 'eas.json'), serialized.eas);
  fs.writeFileSync(path.join(folder, 'credentials.json'), '{"localFixture":"unchanged"}\n');
  return { app, eas, serialized };
}

function configure(folder) {
  return spawnSync(process.execPath, [configureScript], { cwd: folder, encoding: 'utf8', timeout: 10000 });
}

test('configure adds native plugins and an APK profile while preserving the existing app identity', (t) => {
  const folder = temporaryProject(t), before = writeExpoConfig(folder);
  const result = configure(folder);
  assert.equal(result.status, 0, result.stderr);
  const app = JSON.parse(fs.readFileSync(path.join(folder, 'app.json'), 'utf8'));
  const eas = JSON.parse(fs.readFileSync(path.join(folder, 'eas.json'), 'utf8'));
  for (const field of ['name', 'slug', 'owner', 'version', 'extra', 'ios', 'runtimeVersion']) {
    assert.deepEqual(app.expo[field], before.app.expo[field]);
  }
  assert.equal(app.expo.android.package, before.app.expo.android.package);
  assert.equal(app.expo.android.versionCode, 74);
  assert.deepEqual(app.expo.android.adaptiveIcon, before.app.expo.android.adaptiveIcon);
  assert.deepEqual(app.expo.android.permissions, ['CAMERA', 'RECORD_AUDIO']);
  assert.equal(app.expo.android.softwareKeyboardLayoutMode, 'resize');
  assert.deepEqual(app.expo.plugins[0], before.app.expo.plugins[0]);
  assert.deepEqual(app.expo.plugins[1], before.app.expo.plugins[1]);
  const pluginNames = app.expo.plugins.map(value => Array.isArray(value) ? value[0] : value);
  for (const name of ['expo-secure-store', 'expo-audio', 'expo-video', './plugins/with-owpengram-network.cjs']) {
    assert.equal(pluginNames.filter(value => value === name).length, 1);
  }
  assert.deepEqual(eas.build.production, before.eas.build.production);
  assert.deepEqual(eas.submit, before.eas.submit);
  assert.deepEqual(eas.cli, before.eas.cli);
  assert.equal(eas.build.preview.android.credentialsSource, 'local');
  assert.equal(eas.build.preview.android.buildType, 'apk');
  assert.equal(eas.build.preview.channel, 'test-channel');
  assert.equal(eas.build.preview.environment, 'existing-preview');
  assert.equal(eas.build.preview.distribution, 'internal');
  assert.equal(fs.readFileSync(path.join(folder, 'credentials.json'), 'utf8'), '{"localFixture":"unchanged"}\n');
  const backups = fs.readdirSync(folder);
  assert.equal(fs.readFileSync(path.join(folder, backups.find(name => name.startsWith('app.json.avant-owpengram-'))), 'utf8'), before.serialized.app);
  assert.equal(fs.readFileSync(path.join(folder, backups.find(name => name.startsWith('eas.json.avant-owpengram-'))), 'utf8'), before.serialized.eas);
  assert.equal(configure(folder).status, 0);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(folder, 'app.json'), 'utf8')), app);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(folder, 'eas.json'), 'utf8')), eas);
});

test('configure requires the real configuration and preserves a custom Gradle profile for review', (t) => {
  const missing = temporaryProject(t);
  const first = configure(missing);
  assert.notEqual(first.status, 0);
  assert.match(first.stderr, /app\.json/);
  assert.deepEqual(fs.readdirSync(missing), []);

  const custom = temporaryProject(t), before = writeExpoConfig(custom, { gradleCommand: ':app:assembleCustomVariant' });
  const second = configure(custom);
  assert.notEqual(second.status, 0);
  assert.match(second.stderr, /Gradle personnalisée/);
  assert.equal(fs.readFileSync(path.join(custom, 'app.json'), 'utf8'), before.serialized.app);
  assert.equal(fs.readFileSync(path.join(custom, 'eas.json'), 'utf8'), before.serialized.eas);
  assert.equal(fs.readdirSync(custom).some(name => name.includes('.avant-owpengram-')), false);
});
