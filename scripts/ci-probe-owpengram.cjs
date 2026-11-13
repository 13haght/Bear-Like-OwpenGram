'use strict';
// Real read-only transport smoke test from GitHub Actions.
// Opens an MTProto connection; never sends an authentication code or accesses a user account.
// Only controlled error codes are logged: never print passwords, sessions, or app hash.
const { webcrypto } = require('node:crypto');
const sdk = require('../transport/owpengram.bundle.cjs');
const id = Number(process.env.EXPO_PUBLIC_OWPENGRAM_API_ID);
const hash = String(process.env.EXPO_PUBLIC_OWPENGRAM_API_HASH || '');
const statusCode = error => {
  const code = error?.code || error?.errorMessage;
  return typeof code === 'string' && /^[A-Z][A-Z0-9_]{2,80}$/.test(code) ? code : 'OWPENGRAM_TRANSPORT_UNKNOWN';
};
async function main() {
  sdk.configureNativeRandom(bytes => webcrypto.getRandomValues(bytes));
  const config = sdk.readOwpenConfig({ apiId: id, apiHash: hash, dcId: 1 });
  let client, timer;
  try {
    client = await Promise.race([
      sdk.createOwpenClient({ config }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error('Timeout'), {code:'OWPENGRAM_TRANSPORT_TIMEOUT'})), 25000); }),
    ]);
    console.log('MTProto OwpenGram : connexion anonyme réussie sur le centre 1. Aucune connexion à un compte.');
  } catch (error) {
    console.error('Diagnostic OwpenGram transport : ' + statusCode(error));
    process.exitCode = 1;
  } finally {
    if (timer) clearTimeout(timer);
    if (client) await client.disconnect().catch(() => {});
  }
}
main().catch(() => { console.error('Diagnostic OwpenGram transport : OWPENGRAM_PROBE_FAILED'); process.exitCode = 1; });
