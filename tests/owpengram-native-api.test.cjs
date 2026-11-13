'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const sdk = require('../transport/owpengram.bundle.cjs');
const errors = require('../lib/owpengram-errors');
const { Api, Buffer, owpenRandomId } = sdk;
const long = value => owpenRandomId(String(value));
const plain = value => JSON.parse(JSON.stringify(value));

// No RN runtime, HTTP endpoint or real OwpenGram account is involved. Native
// request constructors and the portable SDK are real; only RPC I/O is mocked.
const defaultAuth = { getAccountId: () => null, getGeneration: () => 0, getClient: async () => null, subscribe: () => () => {} };
const emptySocial = () => ({ request: async () => ({}), publish: async () => ({}), clear() {} });
const defaultMedia = { mediaUri: ref => JSON.stringify(ref), prepareUpload: async file => file, resolveMedia: async uri => uri, useMediaUri: uri => uri };
const sandbox = { module: { exports: {} }, exports: {}, Date, console,
  require(name) {
    if (name === './owpengram-auth') return { authClient: defaultAuth };
    if (name === '../transport/owpengram.bundle.cjs') return sdk;
    if (name === './owpengram-social') return { createSocialApi: emptySocial };
    if (name === './owpengram-media') return defaultMedia;
    if (name === './owpengram-errors') return errors;
    throw new Error(`Unexpected dependency: ${name}`);
  },
};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../lib/owpengram-api.js'), 'utf8'), sandbox,
  { filename: 'owpengram-api.js', timeout: 10000 });
const { createApi } = sandbox.module.exports;

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function user(id, extra = {}) {
  return new Api.User({ id: long(id), accessHash: long(Number(id) * 111), firstName: `User ${id}`, username: `person_${id}`, ...extra });
}

function incoming(id, extra = {}) {
  return new Api.Message({ id, date: 1700000000 + id, peerId: new Api.PeerUser({ userId: long(2) }),
    out: false, message: `Message ${id}`, ...extra });
}

function document(id, mime, attributes) {
  return new Api.Document({ id: long(id), accessHash: long(12), fileReference: Buffer.from('file-reference'),
    date: 1700000000, mimeType: mime, size: long(1024), dcId: 2, attributes });
}

function fixture() {
  const calls = [], refs = [], socialCalls = [], prepareCalls = [], hooks = {}, socialHooks = {};
  let account = 'owp:1', generation = 1, clock = 10000, clears = 0, prepared = { buffer: Buffer.from('native bytes'), mime: 'image/jpeg', name: 'photo.jpg' };
  const users = new Map([['1', user(1, { self: true })], ['2', user(2)], ['3', user(3)]]);
  const histories = [incoming(11)];
  const subscribers = [];
  const native = {};
  const invokeMock = (method, callback) => async (...args) => {
    calls.push({ method, args });
    return hooks[method] ? hooks[method](...args) : callback(...args);
  };
  native.resolvePeer = invokeMock('resolvePeer', value => {
    if (value === 'self') return new Api.InputPeerSelf();
    const text = typeof value === 'object' ? `${value.type}:${value.id}` : String(value);
    const [type, id] = text.replace(/^owp:/, 'user:').split(':');
    if (type === 'user') return new Api.InputPeerUser({ userId: long(id), accessHash: long(value.accessHash || Number(id) * 111) });
    if (type === 'channel') return new Api.InputPeerChannel({ channelId: long(id), accessHash: long(value.accessHash || 555) });
    return new Api.InputPeerChat({ chatId: long(id) });
  });
  native.getEntity = invokeMock('getEntity', value => {
    const id = typeof value === 'object' ? String(value.id) : String(value).startsWith('@') ? '2' : String(value).split(':')[1];
    return users.get(id);
  });
  native.getDialogs = invokeMock('getDialogs', () => ({
    dialogs: [{ peer: new Api.PeerUser({ userId: long(2) }), topMessage: 11, unreadCount: 3 }],
    messages: [incoming(11)], users: [users.get('2')], chats: [],
  }));
  native.getMessages = invokeMock('getMessages', () => ({ messages: histories, users: [users.get('2')], chats: [] }));
  native.sendMessage = invokeMock('sendMessage', ({ text }) => incoming(501, { out: true, message: text }));
  native.sendMedia = invokeMock('sendMedia', ({ onProgress }) => { onProgress?.(0.4); return incoming(502, { out: true }); });
  native.forwardMessages = invokeMock('forwardMessages', () => [incoming(503, { out: true })]);
  for (const name of ['editMessage', 'deleteMessages', 'sendReaction', 'markRead', 'setHistoryTTL', 'clearHistory']) native[name] = invokeMock(name, () => true);
  native.getHistoryTTL = invokeMock('getHistoryTTL', () => 86400);
  native.uploadFile = invokeMock('uploadFile', () => new Api.InputFile({ id: long(88), parts: 1, name: 'avatar.jpg', md5Checksum: '' }));
  native.invoke = invokeMock('invoke', request => {
    assert.ok(request instanceof Api.photos.UploadProfilePhoto);
    assert.ok(request.getBytes().length > 4);
    return { photo: new Api.Photo({ id: long(900), accessHash: long(44), fileReference: Buffer.from('avatar'), date: 1700000000, sizes: [], dcId: 2 }) };
  });
  const auth = {
    getAccountId: () => account,
    getGeneration: () => generation,
    getClient: async () => hooks.getClient ? hooks.getClient() : native,
    subscribe(callback) { subscribers.push(callback); return () => {}; },
  };
  const media = {
    mediaUri(ref) { refs.push(ref); return 'owpen-test:' + JSON.stringify(ref); },
    resolveMedia: async uri => ({ uri: 'file://native-cache', original: uri }), useMediaUri: uri => ({ uri }),
  };
  const social = {
    clear() { clears++; },
    async request(...args) {
      socialCalls.push({ method: 'request', args });
      return socialHooks.request ? socialHooks.request(...args) : { profile: { id: account, name: 'Profil natif' } };
    },
    async publish(...args) {
      socialCalls.push({ method: 'publish', args });
      if (socialHooks.publish) return socialHooks.publish(...args);
      args[1]?.(0.5); args[1]?.(1);
      return { post: { id: 'owps:user:1:22', author: account, pinned: true } };
    },
  };
  const prepareUpload = async (...args) => {
    prepareCalls.push(args);
    return hooks.prepareUpload ? hooks.prepareUpload(...args) : prepared;
  };
  const api = createApi({ auth, mediaStore: media, prepareUpload, socialFactory: () => social, now: () => clock });
  return { api, native, hooks, socialHooks, calls, refs, users, histories, socialCalls, prepareCalls, auth,
    get clears() { return clears; },
    setPrepared(file) { prepared = file; },
    advance(ms) { clock += ms; },
    switchAccount(id = 'owp:9') { account = id; generation++; subscribers.forEach(callback => callback()); },
  };
}

const messagePath = '/api/conversations/user:2/messages';
const sendText = (f, clientMessageId = 'client_message_0001', text = 'Bonjour') => f.api.request(messagePath,
  { method: 'POST', body: JSON.stringify({ text, clientMessageId, replyTo: '7' }) });

test('a publication cannot issue its final native RPC after account change during upload', async () => {
  const f = fixture(), upload = deferred(), entered = deferred();
  f.native.uploadInputMedia = async () => { entered.resolve(); await upload.promise; return new Api.InputMediaEmpty(); };
  let published = false;
  f.native.invoke = async () => { published = true; return {}; };
  const api = createApi({ auth: f.auth, mediaStore: defaultMedia, prepareUpload: async value => value,
    socialFactory: ({ getClient }) => ({ clear() {}, async publish() {
      const native = await getClient();
      const media = await native.uploadInputMedia({});
      await native.invoke(new Api.stories.SendStory({ peer: new Api.InputPeerSelf(), media, randomId: long(7), privacyRules: [] }));
      return { post: { id: 'must-not-return' } };
    } }) });
  const pending = api.publish({ media: {}, clientMessageId: 'client-story-1' });
  await entered.promise;
  f.switchAccount(); upload.resolve();
  await assert.rejects(pending, { code: 'SESSION_CHANGED' });
  assert.equal(published, false);
});

test('native history preserves voice/video/photo metadata, sender identity and opaque media references', async () => {
  const f = fixture();
  f.histories.splice(0, 1,
    incoming(14, { message: '', media: new Api.MessageMediaDocument({ document: document(700, 'audio/mp4', [new Api.DocumentAttributeAudio({ voice: true, duration: 7 })]) }), ttlPeriod: 60 }),
    incoming(13, { fromId: new Api.PeerUser({ userId: long(2) }), message: 'Vidéo', media: new Api.MessageMediaDocument({ document: document(701, 'video/mp4', [new Api.DocumentAttributeVideo({ duration: 3.5, w: 720, h: 1280 })]) }) }),
    incoming(12, { out: true, message: 'Photo', media: new Api.MessageMediaPhoto({ photo: new Api.Photo({ id: long(702), accessHash: long(12), fileReference: Buffer.from('photo'), date: 1700000000, sizes: [], dcId: 2 }) }), replyTo: new Api.MessageReplyHeader({ replyToMsgId: 8 }), editDate: 1700000500 }),
  );
  const result = await f.api.request(messagePath);
  assert.equal(result.messages.length, 3);
  const [voice, video, photo] = result.messages;
  assert.equal(voice.sender_id, 'owp:2', 'incoming private messages can omit fromId');
  assert.equal(voice.mime_type, 'audio/mp4');
  assert.equal(voice.durationSeconds, 7);
  assert.equal(voice.isVoice, true);
  assert.equal(voice.thumbnailUri, null);
  assert.equal(voice.created_at, new Date(1700000014 * 1000).toISOString());
  assert.equal(voice.expires_at, new Date(1700000074 * 1000).toISOString());
  assert.equal(video.width, 720);
  assert.equal(video.height, 1280);
  assert.equal(video.duration, 3.5);
  assert.ok(video.thumbnailUri);
  assert.equal(photo.sender_id, 'owp:1');
  assert.equal(photo.reply_to, '8');
  assert.equal(photo.mime_type, 'image/jpeg');
  assert.equal(photo.edited_at, new Date(1700000500 * 1000).toISOString());
  assert.deepEqual(JSON.parse(voice.uri.slice('owpen-test:'.length)), {
    kind: 'message', peer: { type: 'user', id: '2', accessHash: '222' }, messageId: 14, id: '700', mime: 'audio/mp4', variant: 'full',
  });
  assert.equal(voice.read_at, null);
  assert.equal(result.nextBefore, null);
});

test('native aggregate and personal message reactions are normalized without inventing a count', async () => {
  const f = fixture();
  f.histories[0] = incoming(11, { reactions: new Api.MessageReactions({
    results: [new Api.ReactionCount({ reaction: new Api.ReactionEmoji({ emoticon: '❤️' }), count: 4, chosenOrder: 0 })],
    recentReactions: [new Api.MessagePeerReaction({ peerId: new Api.PeerUser({ userId: long(2) }), date: 1700000000, reaction: new Api.ReactionEmoji({ emoticon: '👍' }) })],
  }) });
  const result = await f.api.request(messagePath);
  assert.deepEqual(plain(result.messages[0].reactions), { 'owp:2': '👍', 'owp:1': '❤️' });
  assert.deepEqual(plain(result.messages[0].reactionCounts), [{ emoji: '❤️', count: 4 }]);
});

test('history passes native offsets, drops MessageEmpty and uses only valid message IDs', async () => {
  const f = fixture();
  f.histories.push(new Api.MessageEmpty({ id: 9 }));
  const result = await f.api.request(messagePath + '?before=10');
  assert.equal(result.messages.length, 1);
  const read = f.calls.find(call => call.method === 'getMessages');
  assert.deepEqual(plain(read.args[1]), { limit: 50, before: 10 });
  const count = f.calls.length;
  await assert.rejects(f.api.request(messagePath + '?before=2147483648'), { code: 'INVALID_MESSAGE_ID' });
  assert.equal(f.calls.slice(count).some(call => call.method === 'getMessages'), false);
});

test('dialog cache and unread DTO reflect native data and refresh after expiry or account change', async () => {
  const f = fixture();
  const list = await f.api.request('/api/conversations');
  assert.equal(list.conversations[0].id, 'user:2');
  assert.equal(list.conversations[0].recipientId, 'owp:2');
  assert.equal(list.conversations[0].username, 'person_2');
  const unread = await f.api.request('/api/messages/unread');
  assert.equal(unread.total, 3);
  assert.deepEqual(plain(unread.conversations), [{ id: 'user:2', count: 3 }]);
  assert.equal(f.calls.filter(call => call.method === 'getDialogs').length, 1);
  f.advance(1600);
  await f.api.request('/api/conversations');
  assert.equal(f.calls.filter(call => call.method === 'getDialogs').length, 2);
  f.switchAccount();
  await f.api.request('/api/conversations');
  assert.equal(f.calls.filter(call => call.method === 'getDialogs').length, 3);
  assert.equal(f.clears, 2);
});

test('text retries keep the same native random ID and scope it to account and recipient', async () => {
  const f = fixture();
  assert.equal((await sendText(f)).messageId, '501');
  await sendText(f);
  const sends = f.calls.filter(call => call.method === 'sendMessage');
  assert.equal(sends[0].args[0].randomId, sends[1].args[0].randomId);
  assert.equal(sends[0].args[0].replyTo, 7);
  assert.equal(sends[0].args[0].text, 'Bonjour');
  await f.api.request('/api/conversations/user:3/messages', { method: 'POST', body: { text: 'Bonjour', clientMessageId: 'client_message_0001' } });
  assert.notEqual(f.calls.filter(call => call.method === 'sendMessage').at(-1).args[0].randomId, sends[0].args[0].randomId);
  f.switchAccount();
  await sendText(f);
  assert.notEqual(f.calls.filter(call => call.method === 'sendMessage').at(-1).args[0].randomId, sends[0].args[0].randomId);
  const before = f.calls.filter(call => call.method === 'sendMessage').length;
  await assert.rejects(sendText(f, ''), { code: 'CLIENT_MESSAGE_ID_REQUIRED' });
  assert.equal(f.calls.filter(call => call.method === 'sendMessage').length, before);
});

test('text and media sends refuse an absent native receipt', async () => {
  const f = fixture();
  f.hooks.sendMessage = () => ({});
  await assert.rejects(sendText(f), { code: 'MESSAGE_NOT_CONFIRMED' });
  f.hooks.sendMedia = () => ({ id: 0 });
  const progress = [];
  await assert.rejects(f.api.sendMedia('user:2', { uri: 'file://voice.m4a' }, { clientMessageId: 'media_message_0001' }, value => progress.push(value)), { code: 'MEDIA_NOT_CONFIRMED' });
  assert.equal(progress.some(value => value.phase === 'complete'), false);
});

test('voice media sends pass the prepared bytes and duration intact with stable retry IDs', async () => {
  const f = fixture();
  const prepared = { buffer: Buffer.from('actual voice bytes'), mime: 'audio/mp4', name: 'voice.m4a', kind: 'voice', duration: 4.25 };
  f.setPrepared(prepared);
  const progress = [];
  const selected = { uri: 'file://voice.m4a', type: 'audio', durationSeconds: 4.25 };
  const first = await f.api.sendMedia('owp:2', selected, { clientMessageId: 'voice_message_0001', caption: '', replyTo: '11' }, value => progress.push(value));
  await f.api.sendMedia('user:2', selected, { clientMessageId: 'voice_message_0001', caption: '', replyTo: '11' });
  const sends = f.calls.filter(call => call.method === 'sendMedia');
  assert.equal(sends[0].args[0].file, prepared);
  assert.equal(sends[0].args[0].file.buffer.toString(), 'actual voice bytes');
  assert.equal(sends[0].args[0].file.duration, 4.25);
  assert.equal(sends[0].args[0].randomId, sends[1].args[0].randomId);
  assert.equal(sends[0].args[0].replyTo, 11);
  assert.equal(first.messageId, '502');
  assert.deepEqual(plain(progress), [{ phase: 'preparing', progress: 0 }, { phase: 'uploading', progress: 0.4 }, { phase: 'complete', progress: 1 }]);
});

test('conversation creation resolves stable IDs before username fallback and rejects reassigned handles', async () => {
  const f = fixture();
  const payload = { recipientId: 'owp:2', recipientUsername: 'person_2' };
  let result = await f.api.request('/api/conversations', { method: 'POST', body: payload });
  assert.equal(result.conversationId, 'user:2');
  assert.deepEqual(f.calls.filter(call => call.method === 'getEntity').map(call => call.args[0]), ['user:2']);
  f.hooks.getEntity = value => {
    if (typeof value !== 'string' || !value.startsWith('@')) throw Object.assign(new Error('need access'), { code: 'OWPENGRAM_PEER_ACCESS_REQUIRED', status: 409 });
    return f.users.get('2');
  };
  result = await f.api.request('/api/conversations', { method: 'POST', body: payload });
  assert.equal(result.conversationId, 'user:2');
  assert.equal(f.calls.filter(call => call.method === 'getEntity').at(-1).args[0], '@person_2');
  f.hooks.getEntity = value => {
    if (typeof value !== 'string' || !value.startsWith('@')) throw Object.assign(new Error('need access'), { code: 'OWPENGRAM_PEER_ACCESS_REQUIRED', status: 409 });
    return f.users.get('3');
  };
  await assert.rejects(f.api.request('/api/conversations', { method: 'POST', body: payload }), { code: 'OWPENGRAM_IDENTITY_MISMATCH', status: 409 });
});

test('username fallback is not used after transport failure, and a mismatched resolved peer cannot be read', async () => {
  const f = fixture();
  f.hooks.getEntity = () => { throw Object.assign(new Error('raw protocol trace'), { code: 'NETWORK_TIMEOUT' }); };
  await assert.rejects(f.api.request('/api/conversations', { method: 'POST', body: { recipientId: 'owp:2', recipientUsername: 'person_2' } }), { code: 'NETWORK_TIMEOUT' });
  assert.equal(f.calls.filter(call => call.method === 'getEntity').length, 1);
  f.hooks.resolvePeer = () => new Api.InputPeerUser({ userId: long(3), accessHash: long(333) });
  await assert.rejects(f.api.request(messagePath), { code: 'IDENTITY_MISMATCH', status: 409 });
  assert.equal(f.calls.some(call => call.method === 'getMessages'), false);
});

test('message edits, reactions, read boundaries, TTL and deletions invoke the native operations directly', async () => {
  const f = fixture();
  await f.api.request(messagePath + '/11', { method: 'PATCH', body: { text: 'Modifié' } });
  await f.api.request(messagePath + '/11/reaction', { method: 'POST', body: { emoji: '🔥' } });
  await f.api.request(messagePath + '/11/reaction', { method: 'POST', body: { emoji: null } });
  await f.api.request('/api/conversations/user:2/read', { method: 'POST', body: { maxId: '11' } });
  assert.equal((await f.api.request('/api/conversations/user:2/settings')).ttlSeconds, 86400);
  const ttl = await f.api.request('/api/conversations/user:2/settings', { method: 'PUT', body: { ttlSeconds: 604800 } });
  assert.equal(ttl.ttlSeconds, 604800);
  await assert.rejects(f.api.request('/api/conversations/user:2/settings', { method: 'PUT', body: { ttlSeconds: 123 } }), { code: 'INVALID_TTL' });
  await f.api.request(messagePath + '/11', { method: 'DELETE' });
  const removed = await f.api.request('/api/conversations/user:2', { method: 'DELETE' });
  assert.equal(removed.scope, 'self');
  assert.deepEqual(plain(f.calls.find(call => call.method === 'editMessage').args[0]), { peer: { type: 'user', id: '2', accessHash: '222' }, id: 11, text: 'Modifié' });
  assert.deepEqual(f.calls.filter(call => call.method === 'sendReaction').map(call => call.args[0].emoji), ['🔥', null]);
  assert.equal(f.calls.find(call => call.method === 'markRead').args[0].maxId, 11);
  assert.equal(f.calls.find(call => call.method === 'setHistoryTTL').args[0].seconds, 604800);
  assert.deepEqual(plain(f.calls.find(call => call.method === 'deleteMessages').args[0]), { peer: { type: 'user', id: '2', accessHash: '222' }, ids: [11], revoke: true });
  assert.equal(f.calls.filter(call => call.method === 'clearHistory').length, 1);
});

test('forward retries keep stable IDs and require a nonempty native confirmation', async () => {
  const f = fixture();
  const route = messagePath + '/11/forward';
  const options = { method: 'POST', body: { conversationId: 'user:3', clientMessageId: 'forward_message_0001' } };
  await f.api.request(route, options);
  await f.api.request(route, options);
  const sent = f.calls.filter(call => call.method === 'forwardMessages');
  assert.equal(sent[0].args[0].randomIds[0], sent[1].args[0].randomIds[0]);
  assert.equal(sent[0].args[0].fromPeer.id, '2');
  assert.equal(sent[0].args[0].peer.id, '3');
  assert.deepEqual(plain(sent[0].args[0].ids), [11]);
  f.hooks.forwardMessages = () => [];
  await assert.rejects(f.api.request(route, options), { code: 'FORWARD_NOT_CONFIRMED' });
});

test('social public errors retain their safe message while raw native diagnostics are sanitized', async () => {
  const f = fixture();
  const controlled = errors.fail('OWPENGRAM_PROFILE_FIELDS_UNSUPPORTED', 'Ce champ ne peut pas être enregistré dans OwpenGram.', 400);
  f.socialHooks.request = () => { throw controlled; };
  await assert.rejects(f.api.request('/api/profile/me'), error => error === controlled && error.message === controlled.message);
  f.hooks.sendMessage = () => { throw Object.assign(new Error('raw protocol trace should not reach UI'), { code: 'NETWORK_TIMEOUT', status: 503 }); };
  await assert.rejects(sendText(f), error => error.code === 'NETWORK_TIMEOUT' && error.status === 503 && !error.message.includes('raw protocol trace'));
});

test('publication preparation is direct and one-media validation happens before any upload', async () => {
  const f = fixture(), progress = [];
  const selected = { uri: 'file://photo.jpg' };
  const result = await f.api.publish({ media: [selected], caption: 'Légende', visibility: 'public', clientMessageId: 'publication_0001' }, (...args) => progress.push(args));
  assert.equal(result.post.id, 'owps:user:1:22');
  assert.equal(f.prepareCalls[0][0], selected);
  const sent = f.socialCalls.find(call => call.method === 'publish').args[0];
  assert.equal(sent.file.buffer.toString(), 'native bytes');
  assert.equal(sent.clientMessageId, 'publication_0001');
  assert.equal(progress[0][0], 0.5);
  assert.match(progress[0][1], /Envoi/);
  assert.match(progress.at(-1)[1], /Confirmation/);
  const count = f.prepareCalls.length;
  await assert.rejects(f.api.publish({ media: [selected, selected] }), { code: 'SINGLE_MEDIA_REQUIRED' });
  assert.equal(f.prepareCalls.length, count);
});

test('avatar uploads use photos.UploadProfilePhoto and return the refreshed native profile', async () => {
  const f = fixture();
  const result = await f.api.setAvatar({ uri: 'file://avatar.jpg' });
  assert.equal(result.profile.id, 'owp:1');
  assert.deepEqual(plain(f.prepareCalls[0][1]), { avatar: true });
  assert.equal(f.calls.filter(call => call.method === 'uploadFile').length, 1);
  assert.ok(f.calls.find(call => call.method === 'invoke').args[0] instanceof Api.photos.UploadProfilePhoto);
  assert.equal(f.socialCalls.at(-1).args[0], '/api/profile/me');
  f.hooks.invoke = () => ({ photo: null });
  await assert.rejects(f.api.setAvatar({ uri: 'file://avatar.jpg' }), { code: 'AVATAR_NOT_CONFIRMED' });
});

test('late history and social results are rejected after an account switch', async () => {
  const f = fixture(), started = deferred(), pending = deferred();
  f.hooks.getMessages = () => { started.resolve(); return pending.promise; };
  const read = f.api.request(messagePath);
  await started.promise;
  f.switchAccount();
  pending.resolve({ messages: [incoming(11)], users: [], chats: [] });
  await assert.rejects(read, { code: 'SESSION_CHANGED' });
  const socialStarted = deferred(), socialPending = deferred();
  f.socialHooks.request = () => { socialStarted.resolve(); return socialPending.promise; };
  const socialRead = f.api.request('/api/profile/me');
  await socialStarted.promise;
  f.switchAccount('owp:10');
  socialPending.resolve({ profile: { id: 'owp:9' } });
  await assert.rejects(socialRead, { code: 'SESSION_CHANGED' });
});

test('account changes during media preparation prevent sending, and late media receipts never report success', async () => {
  const f = fixture(), started = deferred(), pending = deferred();
  f.hooks.prepareUpload = () => { started.resolve(); return pending.promise; };
  const send = f.api.sendMedia('user:2', { uri: 'file://photo.jpg' }, { clientMessageId: 'media_message_0001' });
  await started.promise;
  f.switchAccount();
  pending.resolve({ buffer: Buffer.from('photo'), mime: 'image/jpeg' });
  await assert.rejects(send, { code: 'SESSION_CHANGED' });
  assert.equal(f.calls.some(call => call.method === 'sendMedia'), false);
  delete f.hooks.prepareUpload;
  const sent = deferred(), receipt = deferred(), progress = [];
  f.hooks.sendMedia = () => { sent.resolve(); return receipt.promise; };
  const later = f.api.sendMedia('user:2', { uri: 'file://photo.jpg' }, { clientMessageId: 'media_message_0002' }, value => progress.push(value));
  await sent.promise;
  f.switchAccount('owp:10');
  receipt.resolve(incoming(601, { out: true }));
  await assert.rejects(later, { code: 'SESSION_CHANGED' });
  assert.equal(progress.some(value => value.phase === 'complete'), false);
});

test('a text send must not start after its pending peer resolution crosses an account switch', async () => {
  const f = fixture(), started = deferred(), pending = deferred();
  f.hooks.resolvePeer = () => { started.resolve(); return pending.promise; };
  const send = sendText(f);
  await started.promise;
  f.switchAccount();
  pending.resolve(new Api.InputPeerUser({ userId: long(2), accessHash: long(222) }));
  await assert.rejects(send, { code: 'SESSION_CHANGED' });
  assert.equal(f.calls.some(call => call.method === 'sendMessage'), false,
    'No message mutation may begin after the account has changed while resolving its peer');
});

test('an avatar upload finishing after account switch cannot start a profile mutation', async () => {
  const f = fixture(), started = deferred(), pending = deferred();
  f.hooks.uploadFile = () => { started.resolve(); return pending.promise; };
  const update = f.api.setAvatar({ uri: 'file://avatar.jpg' });
  await started.promise;
  f.switchAccount();
  pending.resolve(new Api.InputFile({ id: long(88), parts: 1, name: 'avatar.jpg', md5Checksum: '' }));
  await assert.rejects(update, { code: 'SESSION_CHANGED' });
  assert.equal(f.calls.some(call => call.method === 'invoke'), false,
    'photos.UploadProfilePhoto must not run after the account changes');
});

test('an avatar profile refresh resolving after account switch cannot return a stale profile', async () => {
  const f = fixture(), started = deferred(), pending = deferred();
  f.socialHooks.request = () => { started.resolve(); return pending.promise; };
  const update = f.api.setAvatar({ uri: 'file://avatar.jpg' });
  await started.promise;
  f.switchAccount();
  pending.resolve({ profile: { id: 'owp:1', name: 'Old account' } });
  await assert.rejects(update, { code: 'SESSION_CHANGED' });
});
