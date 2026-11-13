'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto, generateKeyPairSync } = require('node:crypto');
const esbuild = require('esbuild');
const root = path.resolve(__dirname, '..');

// Simulate Hermes: no Node globals, DOM, WebAssembly, SubtleCrypto, encoders or
// browser compression streams. These tests never use a real network or account.
function loadBrowserBundle(source) {
  const sandbox = {
    module: { exports: {} }, console,
    setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask,
    AbortController,
    WebAssembly: undefined, TextEncoder: undefined, TextDecoder: undefined,
    CompressionStream: undefined, DecompressionStream: undefined,
  };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { timeout: 10000 });
  return { sandbox, exports: sandbox.module.exports };
}
const { sandbox, exports: sdk } = loadBrowserBundle(fs.readFileSync(path.join(root, 'transport/owpengram.bundle.cjs'), 'utf8'));
sdk.configureNativeRandom((bytes) => webcrypto.getRandomValues(bytes));
const { Api, Buffer, StringSession, buildPinnedClient, installOwpenRsaKey, assertOwpenRsaKey,
  PinnedOwpenSocket, OwpenClient, decodeMediaReference, owpenRandomId,
  OWPENGRAM_SERVER, readOwpenConfig, encodeOwpenIdentifier, safeOwpenError } = sdk;
const bigInt = (value) => owpenRandomId(String(value));
const plain = (value) => JSON.parse(JSON.stringify(value));
const config = readOwpenConfig({ apiId: 12345, apiHash: 'a'.repeat(32) });
const self = new Api.User({ id: bigInt(42), accessHash: bigInt(33), self: true, firstName: 'Test' });

// This instrumented build exposes upstream primitives to tests only. The app's
// actual bundle above exposes no RSA registry or authentication keys.
test('portable crypto and the single RSA trust key work without Node, WebAssembly or WebCrypto', async () => {
  const built = esbuild.buildSync({
    absWorkingDir: root,
    stdin: { contents: `import * as sdk from './transport/owpengram-entry.js';
      import * as RSA from 'teleproto/crypto/RSA';
      import * as crypto from 'teleproto/platform/crypto/index';
      import * as compression from 'teleproto/platform/compression/index';
      import { LAYER } from 'teleproto/tl/runtime/registry';
      export { sdk, RSA, crypto, compression, LAYER };`, resolveDir: root },
    bundle: true, platform: 'browser', format: 'cjs', target: 'es2020', write: false,
  });
  const instrumented = loadBrowserBundle(built.outputFiles[0].text);
  const { sdk: actual, RSA, crypto, compression, LAYER } = instrumented.exports;
  await assert.rejects(actual.buildPinnedClient({ config }), { code: 'OWPENGRAM_NATIVE_RANDOM_REQUIRED' });
  actual.configureNativeRandom((bytes) => webcrypto.getRandomValues(bytes));
  await Promise.all([actual.installOwpenRsaKey(), actual.installOwpenRsaKey()]);
  assert.equal(LAYER, 232);
  const fingerprint = BigInt.asIntN(64, BigInt(OWPENGRAM_SERVER.rsaFingerprintHex)).toString();
  assert.deepEqual(Array.from(RSA._serverKeys.keys()), [fingerprint]);
  assert.equal(await RSA.encrypt(actual.owpenRandomId('-3414540481677951611'), actual.Buffer.from('hello')), undefined);
  const foreign = generateKeyPairSync('rsa', { modulusLength: 1024 }).publicKey.export({ type: 'pkcs1', format: 'pem' });
  await assert.rejects(RSA.addServerKey(foreign), { code: 'OWPENGRAM_FOREIGN_RSA_KEY' });
  assert.throws(() => RSA._serverKeys.clear(), { code: 'OWPENGRAM_RSA_PIN_LOCKED' });
  actual.assertOwpenRsaKey();
  const bytes = actual.Buffer.from('abc');
  assert.equal(crypto.hash('sha1', bytes).toString('hex'), 'a9993e364706816aba3e25717850c26c9cd0d89d');
  assert.equal(crypto.hash('sha256', bytes).toString('hex'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  const aes = crypto.aesIge(actual.Buffer.alloc(32, 3)), iv = actual.Buffer.alloc(32, 4), clear = actual.Buffer.alloc(32, 9);
  assert.equal(aes.decrypt(aes.encrypt(clear, iv), iv).toString('hex'), clear.toString('hex'));
  aes.dispose();
  assert.equal(compression.gunzip(compression.gzip(bytes)).toString(), 'abc');
  assert.equal(crypto.randomBytes(32).length, 32);
  assert.equal(instrumented.sandbox.crypto.subtle, undefined);
  assert.equal(instrumented.sandbox.WebAssembly, undefined);
});

function photoMessage() {
  return new Api.Message({ id: 17, peerId: new Api.PeerUser({ userId: bigInt(42) }), message: '', date: 1,
    media: new Api.MessageMediaPhoto({ photo: new Api.Photo({ id: bigInt(55), accessHash: bigInt(66), dcId: 3,
      fileReference: Buffer.from('old-reference'), date: 1, sizes: [] }) }) });
}
function documentMessage(reference = 'fresh-reference') {
  return new Api.Message({ id: 17, peerId: new Api.PeerUser({ userId: bigInt(42) }), message: '', date: 1,
    media: new Api.MessageMediaDocument({ document: new Api.Document({ id: bigInt(55), accessHash: bigInt(66), dcId: 3,
      fileReference: Buffer.from(reference), date: 1, mimeType: 'audio/mp4', size: bigInt(8), attributes: [] }) }) });
}
function mockClient(responses = []) {
  const requests = [], uploads = [];
  const raw = {
    session: { save: () => 'private-session', delete() {} },
    async invoke(request) {
      // Encoding validates fields/constructors against the pinned layer schema.
      request.getBytes();
      requests.push(request);
      const result = responses.shift();
      if (result instanceof Error) throw result;
      if (typeof result === 'function') return result(request);
      return result;
    },
    async getMe() { return self; },
    async uploadFile(options) { uploads.push(options.file); return new Api.InputFile({ id: bigInt(90), parts: 1, name: options.file.name, md5Checksum: '' }); },
    _getResponseMessage() { return documentMessage(); },
    async destroy() {},
  };
  return { client: new OwpenClient(raw, config), raw, requests, uploads };
}

test('bootstrap, server-config, retry, migration and media DCs stay on the pinned endpoint', async () => {
  const client = await buildPinnedClient({ config });
  try {
    assert.equal(client.session.dcId, 2);
    assert.equal(client._files.cdnEnabled, false);
    assert.equal(client._transport.webSocket, true);
    assert.equal(client._securityChecks, true);
    client._setConfig({ date: 1, expires: 3601, dcOptions: [{ id: 2, ipAddress: '149.154.167.51', port: 443, cdn: true }] });
    for (const dc of [1, 2, 3, 4, 5]) {
      const expected = { id: dc, ipAddress: '152.89.254.50', port: 2398 };
      assert.deepEqual(plain(await client.getDC(dc, false)), expected);
      assert.deepEqual(plain(await client.getDC(dc, true)), expected);
      assert.deepEqual(plain(client._addresses.seed(dc)), expected);
      assert.deepEqual(plain(client._addresses.next(dc, '149.154.167.51')), expected);
      assert.equal(client._addresses.isCdn(dc), false);
    }
    assert.throws(() => client._createConnection({ id: 2, ipAddress: '149.154.167.51', port: 443 }), { code: 'OWPENGRAM_ENDPOINT_PIN_MISMATCH' });
    await assert.rejects(client.getDC(6), { code: 'OWPENGRAM_DC_INVALID' });
    await assert.rejects(client._files.cdnReachable(2), { code: 'OWPENGRAM_CDN_DISABLED' });
    client.connect = async () => true; // Exercise migration without any socket.
    await client._switchDC(5);
    assert.equal(client.session.serverAddress, '152.89.254.50');
    assert.equal(client.session.port, 2398);
    await assert.rejects(client._switchDC(9), { code: 'OWPENGRAM_DC_INVALID' });
  } finally { await client.destroy(); }
});

test('the native WebSocket is binary and only opens the pinned OwpenGram URL', async () => {
  await installOwpenRsaKey();
  const opened = [], sent = [];
  sandbox.WebSocket = class {
    constructor(url, protocols) {
      opened.push({ url, protocols });
      queueMicrotask(() => this.onopen());
    }
    send(data) { sent.push(data); }
    close() { this.onclose?.(); }
  };
  const socket = new PinnedOwpenSocket();
  await assert.rejects(socket.connect(443, '149.154.167.51'), { code: 'OWPENGRAM_ENDPOINT_PIN_MISMATCH' });
  await assert.rejects(socket.connect(2398, '152.89.254.50', true), { code: 'OWPENGRAM_TEST_SERVER_DISABLED' });
  assert.throws(() => socket.create('wss://other.example/apiws', 'binary'), { code: 'OWPENGRAM_ENDPOINT_PIN_MISMATCH' });
  assert.equal(opened.length, 0);
  await socket.connect(2398, '152.89.254.50');
  assert.deepEqual(opened, [{ url: 'ws://152.89.254.50:2398/apiws', protocols: 'binary' }]);
  assert.equal(socket.socket.binaryType, 'arraybuffer');
  const bytes = Buffer.from([1, 2, 3]);
  socket.write(bytes);
  assert.equal(sent[0], bytes);
  socket.socket.onmessage({ data: Uint8Array.from([4, 5]).buffer });
  assert.equal((await socket.readExactly(2)).toString('hex'), '0405');
  await socket.close();
});

test('StringSession import rejects an official-server session before client construction', async () => {
  const session = new StringSession('');
  session.setDC(2, '149.154.167.51', 443);
  session.authKey = { getKey: () => Buffer.alloc(256, 7) };
  await assert.rejects(buildPinnedClient({ session: session.save(), config }), { code: 'OWPENGRAM_ENDPOINT_PIN_MISMATCH' });
  await assert.rejects(buildPinnedClient({ session: 'broken', config }), { code: 'OWPENGRAM_SESSION_INVALID' });
  session.setDC(2, '152.89.254.50', 2398);
  const imported = await buildPinnedClient({ session: session.save(), config });
  assert.equal(imported.session.authKey.getKey().length, 256);
  await imported.destroy();
});

test('configuration and errors do not expose API hash, session or upstream request text', () => {
  const privateConfig = readOwpenConfig({ apiId: 12345, apiHash: 'b'.repeat(32) });
  const json = JSON.stringify(privateConfig);
  assert.equal(json.includes('secret'), false);
  assert.equal(json.includes('b'.repeat(32)), false);
  assert.throws(() => readOwpenConfig({}), { code: 'OWPENGRAM_API_CREDENTIALS_REQUIRED' });
  assert.equal(safeOwpenError(new Error('request api_hash=secret')).message, 'OWPENGRAM_REQUEST_FAILED');
  assert.equal(safeOwpenError({ errorMessage: 'PHONE_CODE_INVALID' }).status, 400);
  assert.equal(safeOwpenError({ errorMessage: 'FLOOD_WAIT_12', seconds: 12 }).seconds, 12);
});

test('email encoding follows Loligram and sign-in uses emailVerification for email delivery', async () => {
  assert.deepEqual(plain(encodeOwpenIdentifier(' Q.a+b_c-d@EXAMPLE.org ')), { phoneNumber: '888q5q1aq4bq3cq2dq0exampleq1org', identifierKind: 'email' });
  assert.throws(() => encodeOwpenIdentifier('a!b@example.org'), { code: 'EMAIL_INVALID' });
  const { client, requests } = mockClient([
    new Api.help.AppConfig({ hash: 1, config: new Api.JsonObject({ value: [] }) }),
    new Api.auth.SentCode({ phoneCodeHash: 'test-hash', type: new Api.auth.SentCodeTypeEmailCode({ emailPattern: 'a***@example.org', length: 6 }) }),
    new Api.auth.AuthorizationSignUpRequired({}),
    new Api.auth.Authorization({ user: self }),
  ]);
  const challenge = await client.authStart('a@example.org');
  assert.equal(challenge.codeKind, 'email');
  assert.equal(requests[1].phoneNumber, '888aq0exampleq1org');
  const verified = await client.authCode({ ...challenge, code: '123456' });
  assert.equal(verified.state, 'signup');
  assert.equal(requests[2].emailVerification.code, '123456');
  assert.equal(requests[2].phoneCode, undefined);
  const authorized = await client.authSignup({ ...challenge, firstName: 'Test' });
  assert.equal(authorized.state, 'authorized');
  assert.equal(requests[3].phoneCodeHash, 'test-hash');
});

test('server-required SRP is returned as a password step without auto-signup', async () => {
  const error = Object.assign(new Error(), { errorMessage: 'SESSION_PASSWORD_NEEDED' });
  const { client, requests } = mockClient([error]);
  assert.deepEqual(plain(await client.authCode({ phoneNumber: '+33123456789', phoneCodeHash: 'hash', code: '12345' })), { state: 'password' });
  assert.equal(requests[0].phoneCode, '12345');
  assert.equal(requests[0].emailVerification, undefined);
});

test('text, photo, video and AAC voice uploads preserve bytes and use standard MTProto media', async () => {
  const { client, requests, uploads } = mockClient([{}, {}, {}, {}]);
  const bytes = Buffer.from('plain media bytes');
  await client.sendMessage({ peer: 'self', text: 'hello', randomId: 'text-retry' });
  await client.sendMedia({ peer: 'self', file: { buffer: bytes, mime: 'image/jpeg', name: 'photo.jpg' }, randomId: 'photo-retry' });
  await client.sendMedia({ peer: 'self', file: { buffer: bytes, mime: 'video/mp4', name: 'video.mp4', duration: 2.5, width: 1920, height: 1080 }, randomId: 'video-retry' });
  await client.sendMedia({ peer: 'self', file: { buffer: bytes, mime: 'audio/mp4', name: 'voice.m4a', kind: 'voice', duration: 3.2 }, randomId: 'voice-retry' });
  assert.equal(requests[0].className, 'messages.SendMessage');
  assert.equal(requests[0].message, 'hello');
  assert.ok(requests[1].media instanceof Api.InputMediaUploadedPhoto);
  const video = requests[2].media.attributes.find((item) => item instanceof Api.DocumentAttributeVideo);
  assert.equal(video.duration, 2.5);
  assert.equal(video.w, 1920);
  assert.equal(video.h, 1080);
  const audio = requests[3].media.attributes.find((item) => item instanceof Api.DocumentAttributeAudio);
  assert.equal(audio.voice, true);
  assert.equal(audio.duration, 4);
  assert.equal(requests[3].media.mimeType, 'audio/mp4');
  assert.equal(audio.waveform, undefined);
  assert.ok(uploads.every((file) => file.buffer === bytes && file.size === bytes.length));
  assert.equal(owpenRandomId('same-retry').toString(), owpenRandomId('same-retry').toString());
});

test('invalid voice duration fails before upload rather than inventing metadata', async () => {
  const { client, uploads } = mockClient();
  await assert.rejects(client.sendMedia({ peer: 'self', file: { buffer: Buffer.from('voice'), kind: 'voice', mime: 'audio/mp4' } }), { code: 'OWPENGRAM_MEDIA_DURATION_REQUIRED' });
  assert.equal(uploads.length, 0);
});

test('media is re-fetched by account and message ID, including expired file references', async () => {
  const { client, raw, requests } = mockClient([
    { messages: [documentMessage('first-reference')], users: [self], chats: [] },
    { messages: [documentMessage('refreshed-reference')], users: [self], chats: [] },
  ]);
  const passed = [];
  raw.downloadMedia = async (media) => {
    passed.push(media.document.fileReference.toString());
    if (passed.length === 1) throw Object.assign(new Error(), { errorMessage: 'FILE_REFERENCE_EXPIRED' });
    return Buffer.from('downloaded');
  };
  const reference = await client.mediaReference(documentMessage('stale-stored-reference'), 'self', { mime: 'audio/mp4' });
  assert.equal(decodeMediaReference(reference).messageId, 17);
  assert.equal((await client.downloadMedia(reference)).toString(), 'downloaded');
  assert.deepEqual(passed, ['first-reference', 'refreshed-reference']);
  assert.equal(requests.filter((request) => request instanceof Api.messages.GetMessages).length, 2);
});

test('a media reference cannot relabel a message from a different private conversation', async () => {
  const { client } = mockClient([{ messages: [documentMessage()], users: [], chats: [] }]);
  await assert.rejects(client.downloadMedia({ peer: { type: 'user', id: '99', accessHash: '88' }, messageId: 17 }), { code: 'OWPENGRAM_MEDIA_NOT_FOUND' });
});

test('an announced file above the default 20 MiB cap is refused before download', async () => {
  assert.equal(config.maxFileBytes, 20 * 1024 ** 2);
  const oversized = documentMessage();
  oversized.media.document.size = bigInt(20 * 1024 ** 2 + 1);
  const { client, raw } = mockClient([{ messages: [oversized], users: [], chats: [] }]);
  raw.downloadMedia = () => assert.fail('The oversized file must be refused before fetching bytes');
  await assert.rejects(client.downloadMedia({ peer: 'self', messageId: 17 }), { code: 'OWPENGRAM_FILE_SIZE_INVALID', status: 413 });
  const explicit = readOwpenConfig({ apiId: 12345, apiHash: 'a'.repeat(32), maxFileBytes: 30 * 1024 ** 2 });
  assert.equal(explicit.maxFileBytes, 30 * 1024 ** 2);
  assert.throws(() => readOwpenConfig({ apiId: 12345, apiHash: 'a'.repeat(32), maxFileBytes: -1 }), { code: 'OWPENGRAM_MAX_FILE_BYTES_INVALID' });
});

test('a persisted media reference cannot silently select a replacement file', async () => {
  const { client, raw } = mockClient([{ messages: [documentMessage()], users: [], chats: [] }]);
  raw.downloadMedia = () => assert.fail('A changed media identity must be rejected before download');
  await assert.rejects(client.downloadMedia({ peer: 'self', messageId: 17, id: '999' }), { code: 'OWPENGRAM_MEDIA_REFERENCE_CHANGED' });
});


test('story and avatar upload primitives return standard InputMedia before publishing', async () => {
  const { client, requests, uploads } = mockClient();
  const bytes = Buffer.from('original image');
  const media = await client.uploadInputMedia({ buffer: bytes, mime: 'image/jpeg', name: 'photo.jpg' }, { kind: 'photo' });
  assert.ok(media instanceof Api.InputMediaUploadedPhoto);
  assert.ok(media.file instanceof Api.InputFile);
  assert.equal(requests.length, 0);
  assert.equal(uploads[0].buffer, bytes);
  // Serialization catches the layer's real story and avatar input contracts.
  new Api.stories.SendStory({ peer: new Api.InputPeerSelf(), media, pinned: true,
    privacyRules: [new Api.InputPrivacyValueAllowAll()], randomId: owpenRandomId('story:42:retry-1'), period: 86400 }).getBytes();
  new Api.photos.UploadProfilePhoto({ file: media.file }).getBytes();
});

test('a story TL media download enforces its announced size before fetching bytes', async () => {
  const { client, raw } = mockClient();
  const media = documentMessage().media;
  media.document.size = bigInt(20 * 1024 ** 2 + 1);
  raw.downloadMedia = () => assert.fail('No oversized download may begin');
  await assert.rejects(client.downloadTLMedia(media), { code: 'OWPENGRAM_FILE_SIZE_INVALID' });
  media.document.size = bigInt(8);
  raw.downloadMedia = async (passed) => { assert.equal(passed, media); return Buffer.from('ordinary'); };
  assert.equal((await client.downloadTLMedia(media)).toString(), 'ordinary');
});

test('video grid thumbnails never fall back to downloading a full video', async () => {
  const { client, raw } = mockClient();
  const media = documentMessage().media;
  media.document.mimeType = 'video/mp4';
  media.document.size = bigInt(300 * 1024 ** 2);
  const preview = new Api.PhotoSize({ type: 'm', w: 320, h: 180, size: 9000 });
  media.document.thumbs = [preview];
  let downloaded = 0;
  raw.downloadMedia = async (passed, options) => {
    downloaded++;
    assert.equal(passed, media);
    assert.equal(options.thumb, preview);
    return Buffer.from('jpeg preview');
  };
  assert.equal((await client.downloadTLMedia(media, { thumb: true })).toString(), 'jpeg preview');
  assert.equal(downloaded, 1);
  media.document.thumbs = [];
  await assert.rejects(client.downloadTLMedia(media, { thumb: true }), { code: 'OWPENGRAM_THUMBNAIL_UNAVAILABLE' });
  assert.equal(downloaded, 1);
});

test('avatar raw uploads and story uploads preserve the real progress callback', async () => {
  const { client, raw } = mockClient();
  const file = { buffer: Buffer.from('photo'), name: 'photo.jpg', mime: 'image/jpeg' };
  const values = [], onProgress = (value) => values.push(value);
  raw.uploadFile = async (options) => {
    assert.equal(options.file.buffer, file.buffer);
    assert.equal(options.onProgress, onProgress);
    options.onProgress(0.5);
    return new Api.InputFile({ id: bigInt(9), parts: 1, name: file.name, md5Checksum: '' });
  };
  assert.ok(await client.uploadFile(file, { onProgress }) instanceof Api.InputFile);
  assert.ok(await client.uploadInputMedia(file, { kind: 'photo', onProgress }) instanceof Api.InputMediaUploadedPhoto);
  assert.deepEqual(values, [0.5, 0.5]);
});

test('a video can attach a real bounded JPEG thumbnail before its original bytes', async () => {
  const { client, uploads } = mockClient();
  const thumbnail = { name: 'thumbnail.jpg', mime: 'image/jpeg', buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0xff, 0xd9]) };
  const file = { buffer: Buffer.from('original video'), name: 'video.mp4', mime: 'video/mp4', duration: 2, width: 320, height: 180, thumbnail };
  const media = await client.uploadInputMedia(file, { kind: 'video' });
  assert.ok(media.thumb instanceof Api.InputFile);
  assert.equal(uploads[0].buffer, thumbnail.buffer);
  assert.equal(uploads[1].buffer, file.buffer);
  media.getBytes();
  for (const invalid of [
    { ...thumbnail, mime: 'image/png' },
    { ...thumbnail, buffer: Buffer.from('not jpeg') },
    { ...thumbnail, buffer: Buffer.alloc(128 * 1024 + 1, 0xff) },
  ]) {
    await assert.rejects(client.uploadInputMedia({ ...file, thumbnail: invalid }, { kind: 'video' }), { code: 'OWPENGRAM_THUMBNAIL_INVALID' });
  }
  assert.equal(uploads.length, 2);
});

test('concurrent reconnects preserve the client session and do not send another code', async () => {
  const { client, raw, requests } = mockClient();
  const originalSession = raw.session;
  let connections = 0, release;
  const pending = new Promise(resolve => { release = resolve; });
  raw.connected = false;
  raw.connect = async () => { connections++; await pending; raw.connected = true; };
  assert.equal(client.isConnected(), false);
  const first = client.reconnect(), second = client.reconnect();
  assert.equal(first, second);
  release();
  await Promise.all([first, second]);
  assert.equal(connections, 1);
  assert.equal(client.isConnected(), true);
  assert.equal(raw.session, originalSession);
  assert.equal(client.serializeSession(), 'private-session');
  assert.equal(requests.length, 0);
  await client.reconnect();
  assert.equal(connections, 1);
  await client.disconnect();
  assert.equal(client.isConnected(), false);
  await assert.rejects(client.reconnect(), { code: 'OWPENGRAM_CLIENT_CLOSED' });
});
