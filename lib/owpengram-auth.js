'use strict';

// Only this module handles the MTProto authorization key. The UI receives public
// account metadata, never a bearer token or a serialized StringSession.
const SecureStore = require('expo-secure-store');
const ExpoCrypto = require('expo-crypto');
const transport = require('../transport/owpengram.bundle.cjs');
const { publicError, fail } = require('./owpengram-errors');
const PROVIDER = 'owpengram';
const SERVER_IDENTITY = '152.89.254.50:2398/dff66c3cbd5ceeca';
const STORAGE_KEY = 'bear.owpengram.direct.v1.dff66c3cbd5ceeca';
const AUTH_PATH = '/api/owpengram/auth/';

function normalizedUserId(value) {
  if (typeof value !== 'string' || !/^owp:[1-9]\d{0,19}$/.test(value)) {
    throw fail('INVALID_OWPENGRAM_SESSION', 'Le compte OwpenGram confirmé est invalide.', 401);
  }
  return value;
}

function normalizeSession(value) {
  if (!value || value.provider !== PROVIDER || value.serverIdentity !== SERVER_IDENTITY ||
      !value.user || (value.user.provider != null && value.user.provider !== PROVIDER)) {
    throw fail('INVALID_OWPENGRAM_SESSION', 'La session ne correspond pas au serveur OwpenGram de cette application.', 401);
  }
  const id = normalizedUserId(value.user.id);
  if (value.user.remoteId != null && String(value.user.remoteId) !== id.slice(4)) {
    throw fail('INVALID_OWPENGRAM_SESSION', 'L’identité OwpenGram est incohérente.', 401);
  }
  const user = { id, provider: PROVIDER, remoteId: id.slice(4) };
  for (const key of ['username', 'name', 'firstName', 'lastName']) {
    if (typeof value.user[key] === 'string') user[key] = value.user[key].slice(0, 256);
  }
  return { provider: PROVIDER, serverIdentity: SERVER_IDENTITY, user };
}

function publicSession(user) {
  return normalizeSession({ provider: PROVIDER, serverIdentity: SERVER_IDENTITY, user: {
    id: 'owp:' + String(user?.id || ''), remoteId: String(user?.id || ''),
    username: user?.username || '', firstName: user?.firstName || '', lastName: user?.lastName || '',
    name: [user?.firstName, user?.lastName].filter(Boolean).join(' ') || user?.username || 'Utilisateur OwpenGram',
  } });
}

function createAuthClient({
  config, secureStore = SecureStore, createClient = transport.createOwpenClient,
  getRandomValues = ExpoCrypto.getRandomValues, randomUUID = ExpoCrypto.randomUUID,
  now = Date.now,
} = {}) {
  let checkedConfig, configurationError = '';
  try { checkedConfig = transport.readOwpenConfig(config); }
  catch (_) { configurationError = 'Ajoute les identifiants API de l’application OwpenGram (EXPO_PUBLIC_OWPENGRAM_API_ID et EXPO_PUBLIC_OWPENGRAM_API_HASH) avant de compiler.'; }
  let client = null, clientTask = null, secret = '', current = null, generation = 0;
  let activeChallenge = null, closing = false, storageTail = Promise.resolve();
  const attempts = new Map(), listeners = new Set();
  const options = {
    keychainService: 'bear-like.owpengram.direct',
    ...(secureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY == null ? {} : { keychainAccessible: secureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }),
  };
  const configured = () => { if (configurationError) throw fail('OWPENGRAM_API_CREDENTIALS_REQUIRED', configurationError, 503); };
  const storageFailure = () => fail('SECURE_SESSION_STORAGE_UNAVAILABLE', 'Impossible d’accéder au stockage sécurisé. Réessaie sur cet appareil.');
  const emit = () => { for (const fn of listeners) { try { fn(current?.user.id || null, generation); } catch (_) {} } };
  async function storageReady() {
    if (secureStore.isAvailableAsync && !(await secureStore.isAvailableAsync())) throw storageFailure();
  }
  function assertGeneration(expected) {
    if (generation !== expected || closing) throw fail('SESSION_CHANGED', 'La connexion a changé. Recommence cette opération.');
  }
  function storageMutation(callback) {
    const task = storageTail.catch(() => {}).then(callback);
    storageTail = task;
    return task;
  }
  async function connection() {
    configured();
    if (closing) throw fail('SESSION_CHANGED', 'Déconnexion en cours.');
    if (client) {
      const active = client, started = generation;
      if (active.isConnected && !active.isConnected()) await active.reconnect();
      assertGeneration(started);
      if (client !== active) throw fail('SESSION_CHANGED', 'Le compte a changé.');
      return active;
    }
    if (!clientTask) {
      const started = generation;
      transport.configureNativeRandom(getRandomValues);
      clientTask = createClient({ session: secret, config: checkedConfig }).then(async value => {
        if (started !== generation) { await value.disconnect().catch(() => {}); throw fail('SESSION_CHANGED', 'Le compte a changé.'); }
        client = value; return value;
      }).finally(() => { clientTask = null; });
    }
    return clientTask;
  }
  function decode(raw) {
    let record;
    try { record = JSON.parse(raw); } catch (_) { throw fail('INVALID_STORED_SESSION', 'La session enregistrée est illisible. Elle a été conservée.'); }
    if (record?.version !== 1 || record.serverIdentity !== SERVER_IDENTITY || typeof record.nativeSession !== 'string' || !record.nativeSession || record.nativeSession.length > 4096) {
      throw fail('STORED_SESSION_PROVIDER_MISMATCH', 'La session enregistrée ne correspond pas à cette application.');
    }
    return { session: normalizeSession(record.session), nativeSession: record.nativeSession };
  }
  async function load() {
    if (configurationError) return null;
    const started = generation;
    let raw;
    try { await storageReady(); raw = await secureStore.getItemAsync(STORAGE_KEY, options); }
    catch (_) { throw storageFailure(); }
    assertGeneration(started);
    if (!raw) return null;
    const record = decode(raw);
    if (current && current.user.id !== record.session.user.id) throw fail('SESSION_CHANGED', 'Un autre compte est déjà ouvert.');
    secret = record.nativeSession; current = record.session; emit();
    return normalizeSession(current);
  }
  async function save(value) {
    configured();
    const started = generation;
    assertGeneration(started);
    const session = normalizeSession(value);
    if (!client || !current || current.user.id !== session.user.id) {
      throw fail('UNCONFIRMED_SESSION', 'OwpenGram doit confirmer ce compte avant l’enregistrement.', 401);
    }
    const nativeSession = client.serializeSession();
    if (typeof nativeSession !== 'string' || !nativeSession || nativeSession.length > 4096) throw fail('INVALID_NATIVE_SESSION', 'OwpenGram n’a pas fourni de session valide.');
    try {
      await storageMutation(async () => {
        assertGeneration(started);
        await storageReady();
        assertGeneration(started);
        await secureStore.setItemAsync(STORAGE_KEY, JSON.stringify({ version: 1, serverIdentity: SERVER_IDENTITY, nativeSession, session }), options);
      });
    } catch (error) { if (error.isOwpenPublicError) throw error; throw storageFailure(); }
    assertGeneration(started);
    secret = nativeSession; current = session; emit();
    return normalizeSession(session);
  }
  async function discard(expectedGeneration) {
    if (expectedGeneration != null && generation !== expectedGeneration) return;
    closing = true;
    generation += 1;
    try { await storageMutation(async () => { await storageReady(); await secureStore.deleteItemAsync(STORAGE_KEY, options); }); }
    catch (_) { closing = false; throw storageFailure(); }
    const old = client;
    client = null; secret = ''; current = null; activeChallenge = null; attempts.clear(); closing = false; emit();
    if (old) await old.disconnect().catch(() => {});
  }
  async function validate(value) {
    const session = normalizeSession(value), started = generation;
    if (!current || current.user.id !== session.user.id || !secret) throw fail('UNCONFIRMED_SESSION', 'Reconnecte-toi à OwpenGram.', 401);
    try {
      const native = await connection();
      if (!(await native.isAuthorized())) throw fail('SESSION_EXPIRED', 'La session OwpenGram a expiré. Reconnecte-toi.', 401);
      const verified = publicSession(await native.getMe());
      if (verified.user.id !== session.user.id) throw fail('OWPENGRAM_SESSION_ACCOUNT_MISMATCH', 'Le compte confirmé ne correspond pas à la session enregistrée.');
      if (started !== generation) throw fail('SESSION_CHANGED', 'Le compte a changé.');
      current = verified;
      return await save(verified);
    } catch (error) {
      const safe = publicError(error);
      if (safe.status === 401) {
        try { await discard(started); } catch (_) { safe.storageCleared = false; }
      }
      throw safe;
    }
  }
  async function confirmed(native, isNew = false, started = generation) {
    assertGeneration(started);
    if (!(await native.isAuthorized())) throw fail('UNCONFIRMED_SESSION', 'OwpenGram n’a pas confirmé la connexion.', 401);
    const session = publicSession(await native.getMe());
    assertGeneration(started);
    current = session; secret = native.serializeSession();
    activeChallenge = null;
    return { step: 'authenticated', session, isNew };
  }
  async function accept(result, native, challenge, isNew = false, started = generation) {
    assertGeneration(started);
    if (result.state === 'authorized') return confirmed(native, isNew, started);
    if (!['code', 'signup', 'password'].includes(result.state)) throw fail('OWPENGRAM_LOGIN_FLOW_UNSUPPORTED', 'Cette étape de connexion n’est pas prise en charge.', 501);
    const value = { ...challenge, ...result, expiresAt: now() + 15 * 60 * 1000 };
    activeChallenge = value;
    const delivery = /Email/i.test(result.delivery || '') || result.codeKind === 'email' ? 'email'
      : /Sms/i.test(result.delivery || '') ? 'sms' : /App/i.test(result.delivery || '') ? 'app' : '';
    return { step: result.state, challengeId: value.id, delivery };
  }
  async function runRequest(path, body) {
    const started = generation;
    assertGeneration(started);
    if (typeof path !== 'string' || !path.startsWith(AUTH_PATH)) throw fail('OWPENGRAM_ROUTE_NOT_FOUND', 'Opération de connexion inconnue.', 404);
    const action = path.slice(AUTH_PATH.length);
    if (action === 'cancel') {
      if (activeChallenge && body.challengeId !== activeChallenge.id) throw fail('AUTH_CHALLENGE_EXPIRED', 'Cette demande a expiré.', 400);
      activeChallenge = null; attempts.clear();
      if (!current) {
        generation += 1; const old = client; client = null; secret = '';
        if (old) await old.disconnect().catch(() => {});
      }
      return { success: true };
    }
    if (action === 'start') {
      if (current) throw fail('SESSION_ALREADY_OPEN', 'Un compte est déjà ouvert. Déconnecte-toi avant de changer de compte.', 409);
      const native = await connection();
      assertGeneration(started);
      const challenge = { id: 'local-' + randomUUID() };
      return accept(await native.authStart(body.identity), native, challenge, false, started);
    }
    const challenge = activeChallenge;
    if (!challenge || challenge.id !== body.challengeId || challenge.expiresAt < now()) throw fail('AUTH_CHALLENGE_EXPIRED', 'La demande de connexion a expiré. Recommence.', 400);
    if (!['code', 'signup', 'password'].includes(action) || challenge.state !== action) throw fail('AUTH_STAGE_INVALID', 'Reprends l’étape de connexion affichée.', 400);
    const native = await connection();
    assertGeneration(started);
    try {
      const result = action === 'code' ? await native.authCode({ phoneNumber: challenge.phoneNumber, phoneCodeHash: challenge.phoneCodeHash, codeKind: challenge.codeKind, code: body.code })
        : action === 'signup' ? await native.authSignup({ phoneNumber: challenge.phoneNumber, phoneCodeHash: challenge.phoneCodeHash, firstName: body.firstName, lastName: body.lastName })
          : await native.authPassword(body.password);
      return await accept(result, native, challenge, action === 'signup', started);
    } catch (error) {
      // A lost authorization reply must not cause a repeated successful sign-in.
      if (!(Number(error?.status) >= 400 && Number(error?.status) < 500)) {
        try { if (await native.isAuthorized()) return await confirmed(native, action === 'signup', started); } catch (_) {}
      }
      throw error;
    }
  }
  async function request(path, { body = {}, requestId } = {}) {
    configured();
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch (_) { throw fail('OWPENGRAM_REQUEST_INVALID', 'Demande invalide.', 400); } }
    if (!body || typeof body !== 'object') throw fail('OWPENGRAM_REQUEST_INVALID', 'Demande invalide.', 400);
    const key = requestId ? path + ':' + requestId : null;
    if (key && attempts.has(key)) return attempts.get(key);
    // Failed sendCode calls have no server idempotency key. Only a user's
    // explicit retry can send another code; successful local replies are reused.
    const task = runRequest(path, body).catch(error => { if (key) attempts.delete(key); throw publicError(error); });
    if (key) {
      if (attempts.size > 30) attempts.delete(attempts.keys().next().value);
      attempts.set(key, task);
    }
    return task;
  }
  async function logout(value) {
    if (value && current && normalizeSession(value).user.id !== current.user.id) throw fail('SESSION_CHANGED', 'Le compte a changé.');
    try { const native = await connection(); await native.logout(); }
    catch (error) {
      // A temporary failure preserves the secure record for a revocation retry.
      if (publicError(error).status !== 401) { client = null; throw publicError(error); }
    }
    await discard(generation);
    return { success: true };
  }
  async function getClient() {
    if (!current) throw fail('SESSION_REQUIRED', 'Connecte-toi à OwpenGram.', 401);
    return connection();
  }
  function accountNamespace(userId) {
    return '@bear-owpengram-direct-v1:dff66c3cbd5ceeca:' + normalizedUserId(userId);
  }
  return {
    configurationError, request, load, validate, save, logout, getClient, accountNamespace,
    getAccountId: () => current?.user.id || null,
    getGeneration: () => generation,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
}

// Metro inlines these explicit names. They identify the application only.
const authClient = createAuthClient({ config: {
  apiId: process.env.EXPO_PUBLIC_OWPENGRAM_API_ID,
  apiHash: process.env.EXPO_PUBLIC_OWPENGRAM_API_HASH,
  dcId: 1,
} });
module.exports = { authClient, createAuthClient, normalizeSession, accountNamespace: authClient.accountNamespace, SERVER_IDENTITY };
