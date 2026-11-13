'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const YAML = require('yaml');
const { invalidSettings } = require('../scripts/ci-check-owpengram-env.cjs');
const { checkApkEntries, certificateDigest, checkSigningDigest } = require('../scripts/ci-verify-apk.cjs');
const root = path.resolve(__dirname, '..');
const idName = 'EXPO_PUBLIC_OWPENGRAM_API_ID', hashName = 'EXPO_PUBLIC_OWPENGRAM_API_HASH';
const valid = { [idName]: '12345', [hashName]: 'abcdef0123456789abcdef0123456789' };

test('CI fails on missing or malformed credentials without printing their values', () => {
  assert.deepEqual(invalidSettings({}), [idName, hashName]);
  assert.deepEqual(invalidSettings(valid), []);
  assert.deepEqual(invalidSettings({ ...valid, [idName]: '2147483648' }), [idName]);
  assert.deepEqual(invalidSettings({ ...valid, [hashName]: 'wrong-value' }), [hashName]);
  for (const values of [valid, { [idName]: 'PRIVATE_ID_VALUE', [hashName]: 'PRIVATE_HASH_VALUE' }]) {
    const result = spawnSync(process.execPath, [path.join(root, 'scripts/ci-check-owpengram-env.cjs')], {
      encoding: 'utf8', env: { ...process.env, ...values }, timeout: 10000,
    });
    assert.equal(result.status, values === valid ? 0 : 1);
    const output = result.stdout + result.stderr;
    assert.equal(output.includes(values[idName]), false);
    assert.equal(output.includes(values[hashName]), false);
  }
});

test('an APK must contain its JS bundle and native application before upload', () => {
  const complete = ['AndroidManifest.xml', 'classes.dex', 'assets/index.android.bundle', 'lib/arm64-v8a/libhermes.so'];
  assert.doesNotThrow(() => checkApkEntries(complete));
  assert.throws(() => checkApkEntries(complete.filter(name => !name.endsWith('.bundle'))), /Metro/);
  assert.throws(() => checkApkEntries(complete.filter(name => !name.endsWith('.so'))), /natives/);
  assert.throws(() => checkApkEntries(['assets/index.android.bundle']), /incomplet/);
});

test('APK verification rejects a missing, different or multiple signer', () => {
  const expected = 'a'.repeat(64);
  const actual = certificateDigest('Signer #1 certificate SHA-256 digest: ' + expected);
  assert.doesNotThrow(() => checkSigningDigest(actual, expected.match(/../g).join(':').toUpperCase()));
  assert.throws(() => checkSigningDigest(actual, 'b'.repeat(64)), /signature/);
  assert.throws(() => certificateDigest('DOES NOT VERIFY'), /signature/);
  assert.throws(() => certificateDigest('Signer #1 certificate SHA-256 digest: ' + expected + '\nSigner #2 certificate SHA-256 digest: ' + expected), /unique/);
});

test('the workflow is manual, pinned and keeps credentials out of dependency installation', () => {
  const source = fs.readFileSync(path.join(root, '.github/workflows/android-apk.yml'), 'utf8');
  const doc = YAML.parseDocument(source, { uniqueKeys: true });
  assert.deepEqual(doc.errors, []);
  const workflow = doc.toJSON();
  assert.equal(workflow.name, 'Compiler l’APK Android');
  assert.deepEqual(Object.keys(workflow.on), ['workflow_dispatch', 'push']);
  assert.deepEqual(workflow.on.push, { branches: ['main'], paths: ['.github/workflows/android-apk.yml'] });
  assert.deepEqual(workflow.permissions, { contents: 'read' });
  const job = workflow.jobs.build;
  assert.equal(job['runs-on'], 'ubuntu-24.04');
  assert.equal(job.env.EXPO_NO_DOTENV, '1');
  assert.equal(job.env[idName], undefined);
  assert.equal(job.env[hashName], undefined);
  const steps = job.steps;
  const actions = steps.filter(step => step.uses);
  assert.ok(actions.every(step => /^actions\/[^@]+@[a-f0-9]{40}$/.test(step.uses)));
  assert.equal(actions.find(step => step.uses.startsWith('actions/setup-node@')).with['node-version'], '22');
  assert.equal(actions.find(step => step.uses.startsWith('actions/setup-java@')).with['java-version'], '17');
  const checkIndex = steps.findIndex(step => step.run === 'node scripts/ci-check-owpengram-env.cjs');
  const installIndex = steps.findIndex(step => step.run === 'npm ci');
  const prebuildIndex = steps.findIndex(step => /expo prebuild/.test(step.run || ''));
  const buildIndex = steps.findIndex(step => /:app:assembleRelease/.test(step.run || ''));
  const verifyIndex = steps.findIndex(step => /ci-verify-apk/.test(step.run || ''));
  const uploadIndex = steps.findIndex(step => step.uses?.startsWith('actions/upload-artifact@'));
  assert.ok(checkIndex >= 0 && checkIndex < installIndex && installIndex < prebuildIndex && prebuildIndex < buildIndex && buildIndex < verifyIndex && verifyIndex < uploadIndex);
  assert.match(steps[prebuildIndex].run, /--template expo-template-bare-minimum@55\.0\.44/);
  assert.match(steps[prebuildIndex].run, /--no-install/);
  assert.equal(steps[buildIndex]['working-directory'], 'android');
  for (const index of [checkIndex, buildIndex]) {
    assert.equal(steps[index].env[idName], '${{ secrets.' + idName + ' }}');
    assert.equal(steps[index].env[hashName], '${{ secrets.' + hashName + ' }}');
  }
  assert.equal(steps[installIndex].env, undefined);
  assert.equal(steps[uploadIndex].with.path, 'artifacts/BearLike-OwpenGram-test.apk');
  assert.equal(steps[uploadIndex].with.archive, false);
  assert.equal(steps[uploadIndex].with['if-no-files-found'], 'error');
  assert.doesNotMatch(source, /EXPO_TOKEN|EAS_BUILD|eas build|\.env\.local|pull_request_target/);
});
