const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const transport = require('../transport/owpengram.bundle.cjs');
const { Api, Buffer: PortableBuffer, owpenRandomId } = transport;
const source = fs.readFileSync(path.join(__dirname, '../lib/owpengram-media.js'), 'utf8');
const photo = id => new Api.Photo({ id: owpenRandomId(String(id)), accessHash: owpenRandomId('2'), fileReference: PortableBuffer.from('ref'), date: 1, sizes: [], dcId: 2 });

function memoryFS() {
  const files = new Map(), writes = [], deleted = [];
  return {
    cacheDirectory: 'file:///cache/', documentDirectory: 'file:///documents/', EncodingType: { Base64: 'base64' }, files, writes, deleted,
    async getInfoAsync(uri) { const value = files.get(uri); return { exists: value != null, size: value?.length || 0, isDirectory: false, modificationTime: 1 }; },
    async makeDirectoryAsync() {},
    async copyAsync({ from, to }) { if (!files.has(from)) throw Error('missing'); files.set(to, files.get(from)); },
    async readAsStringAsync(uri, options = {}) {
      if (!files.has(uri)) throw Error('missing');
      const bytes = files.get(uri), start = options.position || 0;
      return bytes.subarray(start, options.length == null ? undefined : start + options.length).toString(options.encoding === 'base64' ? 'base64' : 'utf8');
    },
    async writeAsStringAsync(uri, value, options = {}) { files.set(uri, Buffer.from(value, options.encoding === 'base64' ? 'base64' : 'utf8')); writes.push(uri); },
    async deleteAsync(uri) { deleted.push(uri); for (const key of files.keys()) if (key === uri || key.startsWith(uri.endsWith('/') ? uri : uri + '/')) files.delete(key); },
    async readDirectoryAsync(uri) { return [...files.keys()].filter(key => key.startsWith(uri)).map(key => key.slice(uri.length)).filter(key => !key.includes('/')); },
  };
}
function harness() {
  const io = memoryFS(), calls = [];
  const state = { account: 'owp:123', generation: 0, storyMediaId: '77', delay: null };
  const native = {
    async resolvePeer(peer) { return new Api.InputPeerUser({ userId: owpenRandomId(peer.id), accessHash: owpenRandomId(peer.accessHash || '1') }); },
    async invoke(request) {
      calls.push(['invoke', request.className]);
      if (request instanceof Api.stories.GetStoriesByID) return { stories: [{ id: request.id[0], media: new Api.MessageMediaPhoto({ photo: photo(state.storyMediaId) }) }] };
      if (request instanceof Api.users.GetFullUser) return { fullUser: { profilePhoto: photo('88') } };
      throw Error('Unexpected native request');
    },
    async getMessages(peer, options) { return { messages: [{ id: options.ids[0], media: new Api.MessageMediaPhoto({ photo: photo('99') }) }] }; },
    async downloadTLMedia(value, options) { calls.push(['download', options]); if (state.delay) await state.delay; return PortableBuffer.from('original-media-bytes'); },
  };
  const auth = { getAccountId: () => state.account, getGeneration: () => state.generation, getClient: async () => native, subscribe: () => () => {} };
  const modules = { 'expo-file-system/legacy': io, 'expo-crypto': { randomUUID: () => 'mock-uuid', CryptoDigestAlgorithm: { SHA256: 'sha256' },
    digestStringAsync: async (algorithm, input) => crypto.createHash(algorithm).update(input).digest('hex') },
    '../transport/owpengram.bundle.cjs': transport, './media-file': require('../lib/media-file'), './owpengram-errors': require('../lib/owpengram-errors'), './owpengram-auth': { authClient: auth } };
  const context = vm.createContext({ module: { exports: {} }, require(name) { if (modules[name]) return modules[name]; throw Error('Unexpected module ' + name); } });
  vm.runInContext(source, context);
  const lib = context.module.exports;
  const store = lib.createMediaStore({ auth, fs: io, hash: async value => crypto.createHash('sha256').update(value).digest('hex') });
  return { lib, io, calls, state, native, auth, store };
}
const storyRef = (extra = {}) => ({ kind: 'story', peer: { type: 'user', id: '123', accessHash: '456' }, storyId: 10, mediaId: '77', variant: 'full', ...extra });

test('Opaque references preserve native media identity without secrets or foreign URLs', async () => {
  const h = harness();
  const uri = h.lib.mediaUri({ ...storyRef(), token: 'secret-token', nativeSession: 'private-key' });
  assert.doesNotMatch(uri, /secret-token|private-key/);
  assert.equal(h.lib.parseMediaUri(uri).mediaId, '77');
  assert.throws(() => h.lib.mediaUri(storyRef({ peer: { type: 'user', id: '../outside' } })));
  await assert.rejects(h.store.resolveMedia('https://foreign.example/image.jpg'), { code: 'REMOTE_MEDIA_REJECTED' });
  assert.equal((await h.store.resolveMedia('file:///local.jpg')).uri, 'file:///local.jpg');
});

test('Native download is cached under the current account and concurrent requests are coalesced', async () => {
  const h = harness(), uri = h.lib.mediaUri(storyRef());
  const [a, b] = await Promise.all([h.store.resolveMedia(uri), h.store.resolveMedia(uri)]);
  assert.equal(a.uri, b.uri);
  assert.match(a.uri, /^file:\/\/\/cache\/owpengram\/owp-123\//);
  assert.equal(h.calls.filter(x => x[0] === 'download').length, 1);
  assert.equal((await h.store.resolveMedia(uri)).uri, a.uri);
  assert.equal(h.calls.filter(x => x[0] === 'download').length, 1);
  h.state.account = 'owp:456'; h.state.generation++;
  const next = await h.store.resolveMedia(uri);
  assert.notEqual(next.uri, a.uri);
  assert.equal(h.calls.filter(x => x[0] === 'download').length, 2);
});

test('Changed story media has a new cache key and old references are refused after reload', async () => {
  const h = harness();
  const first = h.lib.mediaUri(storyRef()), second = h.lib.mediaUri(storyRef({ mediaId: '78' }));
  assert.notEqual(first, second);
  h.state.storyMediaId = '78';
  await assert.rejects(h.store.resolveMedia(first), { code: 'MEDIA_CHANGED' });
  assert.equal(h.calls.filter(x => x[0] === 'download').length, 0);
  await h.store.resolveMedia(second);
});

test('Thumbnail requests stay explicit through the cache and never request the full file', async () => {
  const h = harness(), uri = h.lib.mediaUri(storyRef({ variant: 'thumb' }));
  await h.store.resolveMedia(uri);
  assert.equal(h.calls.find(x => x[0] === 'download')[1].thumb, true);
  assert.notEqual(uri, h.lib.mediaUri(storyRef()));
});

test('A download completed after account change cannot write or return a private cache file', async () => {
  const h = harness();
  let resolve;
  h.state.delay = new Promise(r => { resolve = r; });
  const pending = h.store.resolveMedia(h.lib.mediaUri(storyRef()));
  while (!h.calls.some(x => x[0] === 'download')) await Promise.resolve();
  h.state.account = null; h.state.generation++;
  resolve();
  await assert.rejects(pending, { code: 'SESSION_CHANGED' });
  assert.equal(h.io.writes.length, 0);
});

test('Avatar and message downloads reload native media and check their identities', async () => {
  const h = harness(), peer = storyRef().peer;
  await h.store.resolveMedia(h.lib.mediaUri({ kind: 'avatar', peer, photoId: '88', variant: 'thumb' }));
  await h.store.resolveMedia(h.lib.mediaUri({ kind: 'message', peer, messageId: 4, id: '99', mime: 'image/jpeg' }));
  await assert.rejects(h.store.resolveMedia(h.lib.mediaUri({ kind: 'avatar', peer, photoId: '89' })), { code: 'AVATAR_UNAVAILABLE' });
  await assert.rejects(h.store.resolveMedia(h.lib.mediaUri({ kind: 'message', peer, messageId: 5, id: '100' })), { code: 'MEDIA_NOT_FOUND' });
});

test('Photo upload derives its true MIME and passes original file bytes without a media envelope', async () => {
  const h = harness(), uri = 'file:///documents/fake.png', bytes = Buffer.from('ffd8ffe000104a46494600010100000100010000', 'hex');
  h.io.files.set(uri, bytes);
  const file = await h.lib.prepareUpload({ uri, mimeType: 'image/png', type: 'image' }, { fs: h.io, makeThumbnail: null });
  assert.equal(file.mime, 'image/jpeg');
  assert.equal(file.kind, 'photo');
  assert.equal(file.buffer.toString('hex'), bytes.toString('hex'));
  assert.equal(file.name, 'photo.jpg');
});

test('MP4 metadata remains in seconds and a forged non-MP4 is rejected before upload', async () => {
  const h = harness(), uri = 'file:///documents/video.mp4';
  h.io.files.set(uri, Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypisom'), Buffer.alloc(24)]));
  const file = await h.lib.prepareUpload({ uri, type: 'video', durationSeconds: 7.25, duration: 7250, width: 1080, height: 1920 }, { fs: h.io, makeThumbnail: null });
  assert.equal(file.mime, 'video/mp4'); assert.equal(file.duration, 7.25);
  assert.equal(file.width, 1080); assert.equal(file.height, 1920);
  h.io.files.set(uri, Buffer.from('this is not a video'));
  await assert.rejects(h.lib.prepareUpload({ uri, type: 'video', durationSeconds: 7, width: 10, height: 20 }, { fs: h.io, makeThumbnail: null }), { code: 'MEDIA_FORMAT_INVALID' });
});

test('Oversized local files fail before being read into JS memory', async () => {
  const h = harness(), io = { ...h.io, getInfoAsync: async () => ({ exists: true, size: 19 * 1024 ** 2 }), readAsStringAsync: async () => { throw Error('must not read'); } };
  await assert.rejects(h.lib.prepareUpload({ uri: 'file:///video.mp4', type: 'video', durationSeconds: 2, width: 10, height: 10 }, { fs: io }), { code: 'MEDIA_TOO_LARGE' });
});

test('Android content URI copies are temporary and removed after preparing the upload', async () => {
  const h = harness(), uri = 'content://media/photos/1';
  h.io.files.set(uri, Buffer.from('ffd8ffe000104a46494600010100000100010000', 'hex'));
  const file = await h.lib.prepareUpload({ uri, type: 'image' }, { fs: h.io, makeThumbnail: null });
  assert.equal(file.mime, 'image/jpeg');
  assert.equal(h.io.deleted.length, 1);
  assert.match(h.io.deleted[0], /^file:\/\/\/cache\//);
  assert.equal(h.io.files.has(uri), true);
});
