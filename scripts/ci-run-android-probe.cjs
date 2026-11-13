'use strict';
// Only allowlisted diagnostic markers leave logcat. Never upload raw Android logs.
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const { SourceMapConsumer } = require('source-map');
const packageName = 'com.bearlike.owpengram.preview';
const adb = args => execFileSync('adb', args, { encoding: 'utf8', timeout: 20000, stdio: ['ignore', 'pipe', 'pipe'] });
async function main() {
  adb(['install', '-r', 'android/app/build/outputs/apk/release/app-release.apk']);
  adb(['logcat', '-c']);
  adb(['shell', 'am', 'start', '-n', packageName + '/.MainActivity']);
  const seen = new Set();
  const sourceMap = JSON.parse(fs.readFileSync('android/app/build/generated/sourcemaps/react/release/index.android.bundle.map', 'utf8'));
  const consumer = await new SourceMapConsumer(sourceMap);
  for (let attempt = 0; attempt < 55; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 2000));
    const log = adb(['logcat', '-d', '-s', 'ReactNativeJS:I', '*:S']);
    for (const match of log.matchAll(/OWP_PROBE:([A-Z][A-Z0-9_]{1,100})/g)) {
      const code = match[1];
      if (code.startsWith('STACK_') && !seen.has(code)) {
        const [, line, column] = code.split('_');
        const point = consumer.originalPositionFor({ line: Number(line), column: Number(column) });
        // Source coordinates and function identifier only; never print source content.
        console.log('PROBE_FRAME', JSON.stringify({ source: point.source, line: point.line, column: point.column, name: point.name }));
      }
      if (!seen.has(code)) { seen.add(code); console.log('OWP_PROBE:' + code); }
      if (code.startsWith('PASS_')) return;
      if (code.startsWith('FAIL_')) throw new Error('Android probe failed: ' + code);
    }
  }
  throw new Error('Android probe produced no terminal result.');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
