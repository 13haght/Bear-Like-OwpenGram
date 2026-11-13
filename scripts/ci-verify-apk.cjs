'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { X509Certificate } = require('node:crypto');

function checkApkEntries(entries) {
  const names = new Set(entries);
  if (!names.has('AndroidManifest.xml') || !names.has('classes.dex')) throw new Error('APK Android incomplet.');
  if (!names.has('assets/index.android.bundle')) throw new Error('Bundle JavaScript absent : cet APK aurait besoin de Metro.');
  if (!entries.some(name => /^lib\/[^/]+\/[^/]+\.so$/.test(name))) throw new Error('Bibliothèques natives absentes de l’APK.');
}

function certificateDigest(report) {
  const digests = Array.from(String(report).matchAll(/Signer #\d+ certificate SHA-256 digest:\s*([a-f0-9]{64})/gi), match => match[1].toLowerCase());
  if (digests.length !== 1) throw new Error('Une signature APK de test unique est requise.');
  return digests[0];
}

function checkSigningDigest(actual, expected) {
  const normalized = String(expected).replace(/:/g, '').toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized) || actual !== normalized) {
    throw new Error('La signature de l’APK ne correspond pas à la clé de test du template Expo.');
  }
}

function execute(command, args, options = {}) {
  const result = spawnSync(command, args, { maxBuffer: 8 * 1024 * 1024, ...options });
  if (result.error || result.status !== 0) throw new Error('Vérification impossible avec ' + path.basename(command) + '.');
  return result.stdout;
}

function verifyApk(apkPath, debugKeystorePath, androidHome) {
  if (!apkPath || !debugKeystorePath || !androidHome) throw new Error('Chemins APK, clé de test et ANDROID_HOME requis.');
  if (!fs.statSync(apkPath).isFile() || fs.statSync(apkPath).size === 0) throw new Error('APK absent ou vide.');
  const entries = execute('unzip', ['-Z1', apkPath], { encoding: 'utf8' }).split(/\r?\n/).filter(Boolean);
  checkApkEntries(entries);
  const apksigner = path.join(androidHome, 'build-tools/36.0.0/apksigner');
  const report = execute(apksigner, ['verify', '--verbose', '--print-certs', apkPath], { encoding: 'utf8' });
  // The template's debug key is deliberately public and used only for this test
  // APK. A production keystore is neither loaded nor uploaded by this workflow.
  const cert = execute('keytool', ['-exportcert', '-keystore', debugKeystorePath,
    '-storepass', 'android', '-alias', 'androiddebugkey']);
  checkSigningDigest(certificateDigest(report), new X509Certificate(cert).fingerprint256);
}

if (require.main === module) {
  try {
    verifyApk(process.argv[2], process.argv[3], process.env.ANDROID_HOME);
    console.log('APK autonome vérifié : JavaScript embarqué, bibliothèques natives et signature de test valides.');
  } catch (error) {
    console.error('::error::' + error.message);
    process.exitCode = 1;
  }
}

module.exports = { checkApkEntries, certificateDigest, checkSigningDigest, verifyApk };
