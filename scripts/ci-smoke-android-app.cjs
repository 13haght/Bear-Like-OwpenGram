'use strict';
// Exercise the actual distributable APK, with a deliberately invalid local identifier.
// The encrypted auth RPC is tested separately by android-connection.entry.js.
const { execFileSync } = require('node:child_process');
const { parseStringPromise } = require('xml2js');
const packageName = 'com.bearlike.owpengram.preview';
const adb = args => execFileSync('adb', args, { encoding: 'utf8', timeout: 20000, stdio: ['ignore', 'pipe', 'pipe'] });
const pause = () => new Promise(resolve => setTimeout(resolve, 1500));
async function nodes() {
  adb(['shell', 'uiautomator', 'dump', '/sdcard/bearlike-ci.xml']);
  const tree = await parseStringPromise(adb(['shell', 'cat', '/sdcard/bearlike-ci.xml']));
  const all = [];
  function visit(node) { if (node.$) all.push(node.$); for (const child of node.node || []) visit(child); }
  visit(tree.hierarchy);
  return all;
}
function tap(node) {
  if (!node || node.enabled === 'false') throw new Error('Expected enabled Android control is absent.');
  const bounds = /^\[(\d+),(\d+)\]\[(\d+),(\d+)\]$/.exec(node.bounds);
  if (!bounds) throw new Error('Android control bounds are unavailable.');
  adb(['shell', 'input', 'tap', String(Math.floor((+bounds[1] + +bounds[3]) / 2)), String(Math.floor((+bounds[2] + +bounds[4]) / 2))]);
}
async function main() {
  adb(['install', '-r', 'android/app/build/outputs/apk/release/app-release.apk']);
  adb(['shell', 'pm', 'clear', packageName]);
  adb(['shell', 'am', 'start', '-n', packageName + '/.MainActivity']);
  let controls;
  for (let i = 0; i < 20; i++) {
    await pause();
    controls = await nodes();
    if (controls.some(node => node['content-desc'] === 'E-mail ou téléphone OwpenGram')) break;
  }
  tap(controls.find(node => node['content-desc'] === 'E-mail ou téléphone OwpenGram'));
  adb(['shell', 'input', 'text', '00000']);
  adb(['shell', 'input', 'keyevent', 'KEYCODE_BACK']);
  await pause();
  tap((await nodes()).find(node => node['content-desc'] === 'Continuer'));
  for (let i = 0; i < 35; i++) {
    await pause();
    const content = (await nodes()).map(node => (node.text || '') + ' ' + (node['content-desc'] || '')).join(' ');
    if (content.includes('PHONE_NUMBER_INVALID')) {
      console.log('ANDROID_APP_PASS: actual APK starts, API configuration is present, Continue establishes MTProto, invalid local identifier is rejected.');
      return;
    }
    const error = /OWPENGRAM_[A-Z_]+/.exec(content)?.[0];
    if (error) throw new Error('Actual APK connection failed: ' + error);
  }
  throw new Error('Actual APK did not finish the connection attempt.');
}
main().catch(error => {
  const code = /OWPENGRAM_[A-Z_]+/.exec(String(error?.message || ''))?.[0];
  console.error('ANDROID_APP_FAIL: ' + (code || 'startup or connection check failed; no raw device logs published.'));
  process.exitCode = 1;
});
