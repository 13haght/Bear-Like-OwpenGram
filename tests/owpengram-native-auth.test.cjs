const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../lib/owpengram-auth.js'), 'utf8');
const AUTH = '/api/owpengram/auth/';
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

function harness({ configured = true, overrides = {} } = {}) {
  const values = new Map(), calls = [], clients = [];
  const failures = { set: false, get: false, delete: false, available: true };
  const gate = { set: null };
  const store = {
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: 6,
    isAvailableAsync: async () => failures.available,
    getItemAsync: async key => { if (failures.get) throw Error('get failure'); return values.get(key) || null; },
    setItemAsync: async (key, value, options) => { calls.push(['store', options]); if (failures.set) throw Error('save failure'); if (gate.set) await gate.set.promise; values.set(key, value); },
    deleteItemAsync: async key => { if (failures.delete) throw Error('delete failure'); values.delete(key); calls.push(['delete']); },
  };
  let sequence = 0;
  const transport = {
    configureNativeRandom(fn) { assert.equal(typeof fn, 'function'); calls.push(['rng']); },
    readOwpenConfig(config) { if (!Number(config?.apiId) || !/^[a-f0-9]{32}$/i.test(config?.apiHash || '')) throw Error('missing'); return config; },
    async createOwpenClient({ session }) {
      calls.push(['connect', !!session]);
      const native = {
        authorized: !!session, connected: true,
        serializeSession: () => '1_PRIVATE_NATIVE_AUTHORIZATION_KEY',
        isConnected() { return this.connected; },
        async reconnect() { calls.push(['reconnect']); this.connected = true; },
        async isAuthorized() { if (overrides.isAuthorized) return overrides.isAuthorized(this); return this.authorized; },
        async getMe() { return { id: '123', firstName: 'Alice', lastName: 'Test', username: 'alice' }; },
        async authStart(identity) { calls.push(['authStart', identity]); return { state: 'code', phoneNumber: '888encoded', phoneCodeHash: 'native-code-hash', codeKind: 'email' }; },
        async authCode(data) { calls.push(['authCode', data]); if (overrides.authCode) return overrides.authCode(data, this); this.authorized = true; return { state: 'authorized' }; },
        async authSignup(data) { calls.push(['authSignup', data]); this.authorized = true; return { state: 'authorized' }; },
        async authPassword(password) { calls.push(['authPassword']); if (overrides.authPassword) return overrides.authPassword(password, this); this.authorized = true; return { state: 'authorized' }; },
        async disconnect() { this.connected = false; calls.push(['disconnect']); },
        async logout() { if (overrides.logout) await overrides.logout(this); this.authorized = false; this.connected = false; calls.push(['logout']); },
      };
      clients.push(native); return native;
    },
  };
  const modules = {
    'expo-secure-store': store,
    'expo-crypto': { randomUUID: () => 'mock-uuid-' + (++sequence), getRandomValues: array => array.fill(42) },
    '../transport/owpengram.bundle.cjs': transport,
    './owpengram-errors': require('../lib/owpengram-errors'),
  };
  const context = vm.createContext({ module: { exports: {} }, process: { env: configured ? { EXPO_PUBLIC_OWPENGRAM_API_ID: '1234', EXPO_PUBLIC_OWPENGRAM_API_HASH: '0'.repeat(32) } : {} },
    require(name) { if (modules[name]) return modules[name]; throw Error('Unexpected dependency ' + name); } });
  vm.runInContext(source, context);
  const lib = context.module.exports, auth = lib.authClient;
  async function start() { return auth.request(AUTH + 'start', { body: { identity: 'alice@example.test' }, requestId: 'start-1' }); }
  async function authorize() { const challenge = await start(); return auth.request(AUTH + 'code', { body: { challengeId: challenge.challengeId, code: '739185' }, requestId: 'code-1' }); }
  return { lib, auth, values, calls, clients, store, failures, gate, overrides, start, authorize };
}

test('Direct auth requires application API configuration and has no HTTP gateway fallback', async () => {
  const h = harness({ configured: false });
  assert.ok(h.auth.configurationError);
  assert.equal(await h.auth.load(), null);
  await assert.rejects(h.start(), { code: 'OWPENGRAM_API_CREDENTIALS_REQUIRED' });
  assert.equal(h.calls.length, 0);
  assert.doesNotMatch(source, /fetch\(|Authorization|EXPO_PUBLIC_OWPENGRAM_GATEWAY_URL/);
});

test('Native login exposes only public account data and saves the key exclusively in SecureStore', async () => {
  const h = harness(), result = await h.authorize();
  assert.equal(result.step, 'authenticated');
  assert.equal(result.session.user.id, 'owp:123');
  assert.equal(result.session.token, undefined);
  assert.equal(result.session.nativeSession, undefined);
  assert.equal(h.values.size, 0);
  await h.auth.save(result.session);
  const [key, text] = [...h.values][0], record = JSON.parse(text);
  assert.match(key, /^[A-Za-z0-9._-]+$/);
  assert.equal(record.nativeSession, '1_PRIVATE_NATIVE_AUTHORIZATION_KEY');
  assert.equal(record.serverIdentity, h.lib.SERVER_IDENTITY);
  assert.doesNotMatch(text, /739185|native-code-hash|888encoded/);
  assert.equal(h.calls.find(x => x[0] === 'store')[1].keychainAccessible, 6);
  assert.notEqual(h.auth.accountNamespace('owp:123'), h.auth.accountNamespace('owp:456'));
});

test('Successful challenge retries do not resend OTP or sign in twice', async () => {
  const h = harness();
  const first = await h.start(), second = await h.start();
  assert.equal(first.challengeId, second.challengeId);
  const body = { challengeId: first.challengeId, code: '739185' };
  const [a, b] = await Promise.all([h.auth.request(AUTH + 'code', { body, requestId: 'same-code' }), h.auth.request(AUTH + 'code', { body, requestId: 'same-code' })]);
  assert.equal(a.session.user.id, b.session.user.id);
  assert.equal(h.calls.filter(x => x[0] === 'authStart').length, 1);
  assert.equal(h.calls.filter(x => x[0] === 'authCode').length, 1);
});

test('Signup preserves the native challenge without saving its code', async () => {
  const h = harness({ overrides: { authCode: async () => ({ state: 'signup' }) } });
  const signup = await h.authorize();
  assert.equal(signup.step, 'signup');
  const result = await h.auth.request(AUTH + 'signup', { body: { challengeId: signup.challengeId, firstName: 'Alice', lastName: 'Test' } });
  assert.equal(result.isNew, true);
  const data = h.calls.find(x => x[0] === 'authSignup')[1];
  assert.equal(data.phoneCodeHash, 'native-code-hash');
  assert.equal(data.code, undefined);
  await h.auth.save(result.session);
  assert.doesNotMatch([...h.values.values()][0], /739185|native-code-hash/);
});

test('A failed 2FA proof keeps the password step and does not restart OTP', async () => {
  let attempts = 0;
  const h = harness({ overrides: { authCode: async () => ({ state: 'password' }), authPassword: async (password, native) => {
    if (!attempts++) throw { code: 'PASSWORD_HASH_INVALID', status: 400, message: password };
    native.authorized = true; return { state: 'authorized' };
  } } });
  const stage = await h.authorize();
  await assert.rejects(h.auth.request(AUTH + 'password', { body: { challengeId: stage.challengeId, password: 'secret-never-persist' } }), error => error.code === 'PASSWORD_HASH_INVALID' && !error.message.includes('secret-never-persist'));
  const result = await h.auth.request(AUTH + 'password', { body: { challengeId: stage.challengeId, password: 'correct-password' } });
  await h.auth.save(result.session);
  assert.equal(h.calls.filter(x => x[0] === 'authStart').length, 1);
  assert.doesNotMatch([...h.values.values()][0], /secret-never-persist|correct-password/);
});

test('SecureStore failure can be retried without resending credentials', async () => {
  const h = harness(), result = await h.authorize();
  h.failures.set = true;
  await assert.rejects(h.auth.save(result.session), { code: 'SECURE_SESSION_STORAGE_UNAVAILABLE' });
  h.failures.set = false;
  await h.auth.save(result.session);
  assert.equal(h.calls.filter(x => x[0] === 'authCode').length, 1);
});

test('Offline restoration preserves the secure session; explicit revocation removes it', async () => {
  const h = harness(), result = await h.authorize();
  await h.auth.save(result.session);
  h.overrides.isAuthorized = async () => { throw { code: 'OWPENGRAM_REQUEST_FAILED' }; };
  await assert.rejects(h.auth.validate(await h.auth.load()));
  assert.equal(h.values.size, 1);
  h.overrides.isAuthorized = async () => false;
  await assert.rejects(h.auth.validate(await h.auth.load()), { code: 'SESSION_EXPIRED' });
  assert.equal(h.values.size, 0);
  assert.equal(h.auth.getAccountId(), null);
});

test('A stored session for another server is preserved and refused', async () => {
  const h = harness(), result = await h.authorize();
  await h.auth.save(result.session);
  const [key, raw] = [...h.values][0], record = JSON.parse(raw);
  record.serverIdentity = 'another-server'; h.values.set(key, JSON.stringify(record));
  await assert.rejects(h.auth.load(), { code: 'STORED_SESSION_PROVIDER_MISMATCH' });
  assert.equal(h.values.size, 1);
});

test('A disconnected native client reconnects using its existing authorization', async () => {
  const h = harness(), result = await h.authorize();
  await h.auth.save(result.session); h.clients[0].connected = false;
  assert.equal(await h.auth.getClient(), h.clients[0]);
  assert.equal(h.calls.filter(x => x[0] === 'reconnect').length, 1);
  assert.equal(h.calls.filter(x => x[0] === 'connect').length, 1);
});

test('A late sign-in response cannot restore a canceled account', async () => {
  const gate = deferred(), entered = deferred();
  const h = harness({ overrides: { authCode: async (data, native) => { entered.resolve(); await gate.promise; native.authorized = true; return { state: 'authorized' }; } } });
  const stage = await h.start();
  const pending = h.auth.request(AUTH + 'code', { body: { challengeId: stage.challengeId, code: '739185' } });
  await entered.promise;
  await h.auth.request(AUTH + 'cancel', { body: { challengeId: stage.challengeId } });
  gate.resolve();
  await assert.rejects(pending, { code: 'SESSION_CHANGED' });
  assert.equal(h.auth.getAccountId(), null);
  assert.equal(h.values.size, 0);
});

test('Logout serializes secure deletion after a pending write', async () => {
  const h = harness(), result = await h.authorize();
  h.gate.set = deferred();
  const saving = h.auth.save(result.session);
  while (!h.calls.some(x => x[0] === 'store')) await Promise.resolve();
  const logout = h.auth.logout(result.session);
  while (!h.calls.some(x => x[0] === 'logout')) await Promise.resolve();
  await Promise.resolve();
  h.gate.set.resolve();
  const results = await Promise.allSettled([saving, logout]);
  assert.equal(results[1].status, 'fulfilled');
  assert.equal(h.values.size, 0);
  assert.equal(h.auth.getAccountId(), null);
});

test('Public metadata cannot inject an arbitrary session or change the confirmed identity', async () => {
  const h = harness(), result = await h.authorize();
  const clean = h.lib.normalizeSession({ ...result.session, token: 'never', nativeSession: 'never', password: 'never' });
  assert.equal(clean.token, undefined); assert.equal(clean.nativeSession, undefined);
  await assert.rejects(h.auth.save({ ...result.session, user: { id: 'owp:456' } }), { code: 'UNCONFIRMED_SESSION' });
  for (const id of ['owp:0', 'owp:00123', 'alice', '123']) assert.throws(() => h.lib.normalizeSession({ ...result.session, user: { id } }));
});
