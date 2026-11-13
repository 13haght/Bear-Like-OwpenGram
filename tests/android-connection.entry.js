// CI-only entry: copied over index.js in the probe build, never used by the APK distributed to users.
import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { registerRootComponent } from 'expo';
import * as ExpoCrypto from 'expo-crypto';
const sdk = require('../transport/owpengram.bundle.cjs');

function category(error) {
  const message = String(error?.message || '');
  const code = error?.errorMessage || error?.code;
  if (typeof code === 'string' && /^[A-Z][A-Z0-9_]{2,80}$/.test(code)) return code;
  if (/CLEARTEXT|cleartext/.test(message)) return 'ANDROID_CLEARTEXT_DENIED';
  if (/fingerprints|valid key/.test(message)) return 'RSA_IDENTITY_REJECTED';
  if (/BigInt|bigint/.test(message)) return 'BIGINT_RUNTIME_ERROR';
  if (/timed? ?out|Timeout/i.test(message)) return 'TIMEOUT';
  if (/WebSocket/.test(message)) return 'WEBSOCKET_ERROR';
  if (/nonce|dh_prime|g_a|AES|security/i.test(message)) return 'MTPROTO_SECURITY_ERROR';
  if (/not a function|is not defined|doesn.t exist/.test(message)) return 'JS_RUNTIME_API_MISSING';
  return ['TypeError', 'ReferenceError', 'RangeError', 'SecurityError'].includes(error?.name) ? error.name.toUpperCase() : 'UNCLASSIFIED_ERROR';
}

function Probe() {
  const [status, setStatus] = useState('STARTING');
  useEffect(() => {
    const report = code => { console.info('OWP_PROBE:' + code); setStatus(code); };
    let client;
    const timer = setTimeout(() => { report('FAIL_TIMEOUT'); client?.destroy().catch(() => {}); }, 90000);
    (async () => {
      report(global.HermesInternal ? 'HERMES' : 'FAIL_NOT_HERMES');
      sdk.configureNativeRandom(ExpoCrypto.getRandomValues);
      const config = sdk.readOwpenConfig({
        apiId: process.env.EXPO_PUBLIC_OWPENGRAM_API_ID,
        apiHash: process.env.EXPO_PUBLIC_OWPENGRAM_API_HASH,
      });
      report('API_CONFIG_VALID');
      const originalCreate = sdk.PinnedOwpenSocket.prototype.create;
      sdk.PinnedOwpenSocket.prototype.create = function (...args) {
        report('WEBSOCKET_CREATING');
        const socket = originalCreate.apply(this, args);
        socket.addEventListener('open', () => report('WEBSOCKET_OPEN'));
        socket.addEventListener('message', () => report('WEBSOCKET_RECEIVED'));
        socket.addEventListener('error', error => report('SOCKET_' + category(error)));
        return socket;
      };
      client = await sdk.buildPinnedClient({ config });
      report('RSA_PIN_VALID');
      client._errorHandler = error => report('ATTEMPT_' + category(error));
      await client.connect();
      report('MTPROTO_CONNECTED');
      try {
        // Exercise the real encrypted authentication RPC with an empty identifier.
        // It cannot address an account or deliver a code. No API identity is logged.
        await client.invoke(new sdk.Api.auth.SendCode({ phoneNumber: '', apiId: config.apiId,
          apiHash: config.apiHash, settings: new sdk.Api.CodeSettings({}) }), { timeout: 20000 });
        report('FAIL_UNEXPECTED_AUTH_RESPONSE');
      } catch (error) {
        if (error?.errorMessage === 'PHONE_NUMBER_INVALID') report('PASS_AUTH_RPC_REJECTED_INVALID_IDENTIFIER');
        else report('FAIL_AUTH_' + category(error));
      }
    })().catch(error => report('FAIL_' + category(error))).finally(async () => {
      clearTimeout(timer);
      await client?.destroy().catch(() => {});
    });
  }, []);
  return React.createElement(View, { style: { padding: 30 } }, React.createElement(Text, { accessibilityLabel: status }, status));
}
registerRootComponent(Probe);
