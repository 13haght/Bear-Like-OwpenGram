'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Api, owpenRandomId, Buffer } = require('../transport/owpengram.bundle.cjs');
const { createSocialApi, parsePostId, postId, MAX_CONTACTS, POSTS_PER_CONTACT, MAX_MEDIA_BYTES } = require('../lib/owpengram-social');

const long = value => owpenRandomId(String(value));

function user(id, extra = {}) {
  return new Api.User({ id: long(id), accessHash: long(Number(id) * 111), firstName: `User ${id}`,
    username: `person_${id}`, self: String(id) === '1', contact: String(id) !== '1', ...extra });
}

function story(id, extra = {}) {
  return new Api.StoryItem({ id, date: 1700000000 + id, expireDate: 1700086400 + id,
    pinned: true, public: true, caption: `Publication ${id}`,
    media: new Api.MessageMediaPhoto({ photo: new Api.Photo({ id: long(9000 + id), accessHash: long(22),
      fileReference: Buffer.from('native-reference'), date: 1700000000, sizes: [], dcId: 2 }) }), ...extra });
}

function fixture({ numberOfContacts = 2, storiesPerUser = 2 } = {}) {
  const users = new Map(Array.from({ length: numberOfContacts + 1 }, (_, i) => [String(i + 1), user(i + 1)]));
  const contactIds = new Set([...users.keys()].filter(id => id !== '1'));
  const histories = new Map([...users.keys()].map(id => [id,
    Array.from({ length: storiesPerUser }, (_, i) => story(100 - i))]));
  const calls = [], resolutions = [], uploads = [], drafts = new Map();
  const hooks = {};
  let profileBio = 'Biographie native';
  let meCalls = 0;
  const ownerId = peer => peer instanceof Api.InputPeerSelf ? '1' : String(peer.userId);
  const client = {
    async getMe() { meCalls++; return users.get('1'); },
    async resolvePeer(value) {
      resolutions.push(value);
      if (value === 'self') return new Api.InputPeerSelf();
      const id = typeof value === 'object' ? String(value.id) : String(value).replace(/^(user|owp):/, '');
      const entity = users.get(id);
      if (!entity) throw Object.assign(new Error('Access required'), { code: 'OWPENGRAM_PEER_ACCESS_REQUIRED', status: 409 });
      return new Api.InputPeerUser({ userId: long(id), accessHash: long(value.accessHash || entity.accessHash) });
    },
    async uploadInputMedia(file, options) {
      uploads.push({ file, options });
      if (hooks.upload) return hooks.upload(file, options);
      options.onProgress?.(0.5);
      options.onProgress?.(1);
      return new Api.InputMediaUploadedPhoto({ file: new Api.InputFile({ id: long(44), parts: 1, name: file.name || 'photo.jpg', md5Checksum: '' }) });
    },
    async invoke(request) {
      calls.push(request);
      // Exercise actual TL request serialization, not look-alike constructors.
      assert.ok(request.getBytes().length >= 4, request.className);
      if (hooks[request.className]) return hooks[request.className](request);
      switch (request.className) {
        case 'users.GetFullUser': {
          const id = request.id instanceof Api.InputUserSelf ? '1' : String(request.id.userId);
          return { fullUser: { id: long(id), about: id === '1' ? profileBio : `Bio ${id}` }, users: [users.get(id)], chats: [] };
        }
        case 'account.UpdateProfile': {
          const old = users.get('1');
          const next = user(1, { firstName: request.firstName ?? old.firstName, lastName: request.lastName ?? old.lastName });
          users.set('1', next);
          if (request.about !== undefined) profileBio = request.about;
          return next;
        }
        case 'contacts.GetContacts': return { contacts: [...contactIds].map(id => new Api.Contact({ userId: long(id), mutual: false })), users: [...users.values()] };
        case 'contacts.Search': return { myResults: [], results: [new Api.PeerUser({ userId: long(2) })], users: [users.get('2')] };
        case 'contacts.AddContact': contactIds.add(String(request.id.userId)); return { updates: [] };
        case 'contacts.DeleteContacts': request.id.forEach(id => contactIds.delete(String(id.userId))); return { updates: [] };
        case 'stories.GetPinnedStories': {
          const id = ownerId(request.peer);
          const list = (histories.get(id) || []).filter(item => item.pinned && (!request.offsetId || item.id < request.offsetId));
          return { stories: list.slice(0, request.limit), count: (histories.get(id) || []).filter(item => item.pinned).length, users: [users.get(id)], chats: [] };
        }
        case 'stories.GetStoriesByID': return { stories: (histories.get(ownerId(request.peer)) || []).filter(item => request.id.includes(item.id)), users: [], chats: [] };
        case 'stories.CanSendStory': return { countRemains: 100 };
        case 'stories.SendStory': {
          const key = String(request.randomId);
          let id = drafts.get(key);
          if (!id) {
            id = 101 + drafts.size;
            drafts.set(key, id);
            histories.get('1').unshift(story(id, { caption: request.caption, pinned: request.pinned,
              public: request.privacyRules[0] instanceof Api.InputPrivacyValueAllowAll,
              contacts: request.privacyRules[0] instanceof Api.InputPrivacyValueAllowContacts }));
          }
          return { updates: [new Api.UpdateStoryID({ id, randomId: request.randomId })], users: [], chats: [] };
        }
        case 'stories.EditStory': {
          const item = histories.get('1').find(item => item.id === request.id);
          if (item) item.caption = request.caption;
          return { updates: [] };
        }
        case 'stories.DeleteStories': {
          const removed = histories.get('1').filter(item => request.id.includes(item.id)).map(item => item.id);
          histories.set('1', histories.get('1').filter(item => !request.id.includes(item.id)));
          return removed;
        }
        case 'stories.SendReaction': {
          const item = histories.get(ownerId(request.peer)).find(item => item.id === request.storyId);
          const clear = request.reaction instanceof Api.ReactionEmpty;
          item.sentReaction = clear ? undefined : request.reaction;
          item.views = new Api.StoryViews({ viewsCount: 4, reactionsCount: clear ? 0 : 1,
            reactions: clear ? [] : [new Api.ReactionCount({ reaction: request.reaction, count: 1 })] });
          return { updates: [] };
        }
        case 'stories.IncrementStoryViews': return true;
        default: throw new Error(`Unexpected native method: ${request.className}`);
      }
    },
  };
  const api = createSocialApi({ getClient: async () => client, mediaUri: ref => `owpen-media:${JSON.stringify(ref)}` });
  return { api, client, calls, users, histories, contactIds, hooks, resolutions, uploads, drafts, meCalls: () => meCalls };
}

test('publication IDs include the owner and reject ambiguous or out-of-range native IDs', () => {
  assert.deepEqual(parsePostId('owps:user:9223372036854775807:2147483647'),
    { ownerType: 'user', ownerId: '9223372036854775807', storyId: 2147483647 });
  assert.notEqual(postId('1', 7), postId('2', 7));
  for (const id of ['7', 'owps:user:01:7', 'owps:user:1:0', 'owps:user:1:2147483648',
    'owps:user:9223372036854775808:7', 'owps:channel:1:7', 'owps:user:1:7:8']) {
    assert.throws(() => parsePostId(id), error => error.status === 400);
  }
});

test('expired pinned publications remain visible and missing counters remain unknown', async () => {
  const f = fixture();
  const result = await f.api.request('/api/users/owp%3A2/posts');
  assert.equal(result.posts.length, 2);
  const item = result.posts[0];
  assert.equal(item.id, 'owps:user:2:100');
  assert.ok(item.expiresAt < Date.now());
  assert.equal(item.likes, null);
  assert.equal(item.views, null);
  assert.equal(item.myReaction, null);
  assert.equal(item.author, 'owp:2');
  assert.equal(item.nativeRef.peer.accessHash, '222');
  assert.equal(item.nativeRef.storyId, 100);
  assert.equal(item.media[0].nativeRef.mediaId, '9100');
  assert.equal(item.allowComments, false);
  assert.ok(!('fileReference' in item.nativeRef));
});

test('profile pagination uses native story offsets without discarding old pinned pages', async () => {
  const f = fixture({ storiesPerUser: 31 });
  const first = await f.api.request('/api/users/owp:1/posts');
  assert.equal(first.posts.length, 30);
  assert.equal(first.nextCursor, '71');
  const second = await f.api.request('/api/users/owp:1/posts?before=71');
  assert.equal(second.posts.length, 1);
  assert.equal(second.posts[0].id, 'owps:user:1:70');
  assert.equal(second.nextCursor, null);
  assert.equal(f.calls.filter(r => r instanceof Api.stories.GetPinnedStories)[1].offsetId, 71);
  await assert.rejects(f.api.request('/api/users/owp:1/posts?before=not-a-cursor'), { code: 'OWPENGRAM_INVALID_STORY_ID' });
});

test('feed reads only contacts and self with explicit coverage instead of a fake global feed', async () => {
  const f = fixture({ numberOfContacts: 53, storiesPerUser: 12 });
  const result = await f.api.request('/api/posts');
  assert.equal(result.posts.length, (MAX_CONTACTS + 1) * POSTS_PER_CONTACT);
  assert.equal(result.coverage.contactsAvailable, 53);
  assert.equal(result.coverage.contactsIncluded, 50);
  assert.equal(result.coverage.profilesLoaded, 51);
  assert.equal(result.coverage.truncated, true);
  assert.equal(result.coverage.complete, false);
  assert.equal(result.coverage.scope, 'owpengram_contacts_and_self');
  assert.ok(f.calls.filter(r => r instanceof Api.stories.GetPinnedStories).every(r => r.limit === 10));
  assert.equal(f.calls.some(r => r instanceof Api.stories.GetAllStories || r instanceof Api.stories.SearchPosts), false);
  await assert.rejects(f.api.request('/api/posts?hashtag=demo'), { code: 'OWPENGRAM_FEED_FILTER_UNSUPPORTED' });
});

test('partial feed failures are disclosed, while an expired account fails the whole read', async () => {
  const f = fixture();
  f.hooks['stories.GetPinnedStories'] = request => {
    if (String(request.peer.userId) === '2') throw Object.assign(new Error('network'), { status: 503 });
    return { stories: [story(1)], count: 1, users: [] };
  };
  const result = await f.api.request('/api/posts');
  assert.equal(result.coverage.partial, true);
  assert.equal(result.coverage.profilesFailed, 1);
  assert.equal(result.coverage.complete, false);
  f.hooks['stories.GetPinnedStories'] = () => { throw Object.assign(new Error('expired'), { status: 401, code: 'SESSION_EXPIRED' }); };
  await assert.rejects(f.api.request('/api/posts'), { code: 'SESSION_EXPIRED' });
});

test('search returns native users and preserves a full peer descriptor for later profile reads', async () => {
  const f = fixture();
  const found = await f.api.request('/api/users/search?q=%40person_2');
  assert.equal(found.users[0].id, 'owp:2');
  assert.equal(found.users[0].handle, 'person_2');
  assert.equal(f.calls.find(r => r instanceof Api.contacts.Search).q, 'person_2');
  await f.api.request('/api/users/owp:2/profile');
  assert.deepEqual(f.resolutions.at(-1), { type: 'user', id: '2', accessHash: '222' });
  f.hooks['contacts.Search'] = () => ({ users: [user(2, { min: true, accessHash: undefined })], myResults: [], results: [new Api.PeerUser({ userId: long(2) })] });
  await f.api.request('/api/users/search?q=person_2');
  await f.api.request('/api/users/owp:2/posts');
  assert.equal(f.resolutions.at(-1).accessHash, '222');
});

test('profile edits call native account.updateProfile, including an intentionally cleared biography', async () => {
  const f = fixture();
  const result = await f.api.request('/api/profile/me', { method: 'PUT', body: JSON.stringify({ name: 'Jean Marc', bio: '' }) });
  const update = f.calls.find(r => r instanceof Api.account.UpdateProfile);
  assert.equal(update.firstName, 'Jean Marc');
  assert.equal(update.lastName, '');
  assert.equal(update.about, '');
  assert.equal(result.profile.name, 'Jean Marc');
  assert.equal(result.profile.bio, '');
  assert.equal(result.profile.nativeRef.peer.id, '1');
  const before = f.calls.length;
  await assert.rejects(f.api.request('/api/profile/me', { method: 'PUT', body: { country: 'France' } }), { code: 'OWPENGRAM_PROFILE_FIELDS_UNSUPPORTED' });
  assert.equal(f.calls.length, before);
});

test('contacts are native contacts, with no implicit phone-number visibility exception', async () => {
  const f = fixture();
  const removed = await f.api.request('/api/users/owp:2/contact', { method: 'DELETE' });
  assert.equal(removed.isContact, false);
  assert.ok(!f.contactIds.has('2'));
  const added = await f.api.request('/api/users/owp:2/contact', { method: 'POST' });
  assert.equal(added.isContact, true);
  const call = f.calls.find(r => r instanceof Api.contacts.AddContact);
  assert.ok(call.id instanceof Api.InputUser);
  assert.equal(call.phone, '');
  assert.equal(call.addPhonePrivacyException, false);
  assert.ok(f.contactIds.has('2'));
  const contacts = await f.api.request('/api/users/contacts');
  assert.equal(contacts.users.length, 2);
  assert.equal('followers' in contacts.users[0], false);
  await assert.rejects(f.api.request('/api/users/owp:1/contact', { method: 'POST' }), { code: 'OWPENGRAM_SELF_CONTACT' });
});

test('reaction and removal are read back from native story state', async () => {
  const f = fixture();
  const result = await f.api.request('/api/posts/owps:user:2:100/reaction', { method: 'POST', body: { emoji: '❤️' } });
  assert.equal(result.post.myReaction, '❤️');
  assert.equal(result.post.likes, 1);
  assert.deepEqual(result.post.reactionCounts, [{ emoji: '❤️', count: 1 }]);
  assert.equal(result.post.views, 4);
  const removed = await f.api.request('/api/posts/owps:user:2:100/reaction', { method: 'POST', body: { emoji: null } });
  assert.equal(removed.post.myReaction, null);
  assert.equal(removed.post.likes, 0);
  assert.equal(removed.post.liked, false);
  assert.ok(f.calls.filter(r => r instanceof Api.stories.SendReaction).at(-1).reaction instanceof Api.ReactionEmpty);
});

test('a failed reaction never reports a locally fabricated counter or success', async () => {
  const f = fixture();
  f.hooks['stories.SendReaction'] = () => { throw Object.assign(new Error('unavailable'), { code: 'NETWORK_UNAVAILABLE', status: 503 }); };
  await assert.rejects(f.api.request('/api/posts/owps:user:2:100/reaction', { method: 'POST', body: { emoji: '👍' } }), { code: 'NETWORK_UNAVAILABLE' });
  assert.equal(f.histories.get('2')[0].sentReaction, undefined);
  assert.equal(f.calls.some(r => r instanceof Api.stories.GetStoriesByID), false);
});

test('publishing uses the owner account, persistent pin and a stable server-deduplicated random ID', async () => {
  const f = fixture();
  const progress = [];
  const payload = { file: { buffer: Buffer.from('image bytes'), mime: 'image/jpeg', name: 'photo.jpg' },
    caption: 'Publication native', visibility: 'contacts', clientMessageId: 'draft-retry-123' };
  const first = await f.api.publish(payload, value => progress.push(value));
  const second = await f.api.publish(payload);
  assert.equal(first.post.id, second.post.id);
  assert.equal(f.drafts.size, 1);
  assert.equal(first.post.pinned, true);
  assert.equal(first.post.visibility, 'contacts');
  const sends = f.calls.filter(r => r instanceof Api.stories.SendStory);
  assert.equal(sends.length, 2);
  assert.equal(String(sends[0].randomId), String(sends[1].randomId));
  assert.ok(sends[0].peer instanceof Api.InputPeerSelf);
  assert.ok(sends[0].privacyRules[0] instanceof Api.InputPrivacyValueAllowContacts);
  assert.equal(sends[0].pinned, true);
  assert.equal(sends[0].period, 86400);
  assert.equal(f.uploads[0].file.buffer.toString(), 'image bytes');
  assert.equal(f.uploads[0].options.kind, 'photo');
  assert.equal(progress[0], 0);
  assert.equal(progress.at(-1), 1);
});

test('upload failure is preserved and a retry confirms the native post before reaching 100 percent', async () => {
  const f = fixture();
  const progress = [];
  const payload = { file: { buffer: Buffer.from('photo'), mime: 'image/png' }, clientMessageId: 'same-draft' };
  f.hooks.upload = () => { throw Object.assign(new Error('interrupted'), { code: 'UPLOAD_INTERRUPTED' }); };
  await assert.rejects(f.api.publish(payload, value => progress.push(value)), { code: 'UPLOAD_INTERRUPTED' });
  assert.equal(f.calls.some(r => r instanceof Api.stories.SendStory), false);
  assert.equal(progress.includes(1), false);
  delete f.hooks.upload;
  const result = await f.api.publish(payload, value => progress.push(value));
  assert.equal(result.post.author, 'owp:1');
  assert.equal(progress.at(-1), 1);
});

test('missing publish confirmation and missing pin are failures instead of temporary synthetic posts', async () => {
  const f = fixture();
  const payload = { file: { buffer: Buffer.from('photo'), mime: 'image/jpeg' }, clientMessageId: 'persistent-draft' };
  f.hooks['stories.SendStory'] = () => ({ updates: [] });
  await assert.rejects(f.api.publish(payload), { code: 'OWPENGRAM_PUBLISH_UNCONFIRMED' });
  assert.equal(f.histories.get('1').length, 2);
  f.hooks['stories.SendStory'] = request => ({ updates: [new Api.UpdateStoryID({ id: 100, randomId: request.randomId })] });
  f.histories.get('1')[0].pinned = false;
  await assert.rejects(f.api.publish(payload), { code: 'OWPENGRAM_PUBLICATION_NOT_PINNED' });
});

test('publication preflight respects server capacity, one supported media and explicit stable IDs', async () => {
  const f = fixture();
  const base = { file: { buffer: Buffer.from('photo'), mime: 'image/jpeg' }, clientMessageId: 'draft-capacity' };
  f.hooks['stories.CanSendStory'] = () => ({ countRemains: 0 });
  await assert.rejects(f.api.publish(base), { code: 'OWPENGRAM_STORY_LIMIT' });
  assert.equal(f.uploads.length, 0);
  await assert.rejects(f.api.publish({ ...base, clientMessageId: '' }), { code: 'OWPENGRAM_REQUEST_ID_REQUIRED' });
  await assert.rejects(f.api.publish({ ...base, file: [{ buffer: Buffer.from('photo'), mime: 'image/jpeg' }] }), { code: 'OWPENGRAM_MEDIA_REQUIRED' });
  await assert.rejects(f.api.publish({ ...base, file: { buffer: Buffer.from('audio'), mime: 'audio/aac' } }), { code: 'OWPENGRAM_MEDIA_TYPE_UNSUPPORTED' });
  await assert.rejects(f.api.publish({ ...base, file: { buffer: { byteLength: MAX_MEDIA_BYTES + 1 }, mime: 'image/jpeg' } }), { code: 'OWPENGRAM_MEDIA_TOO_LARGE' });
});

test('editing and deleting require the native owner; deletion confirmation is checked', async () => {
  const f = fixture();
  await assert.rejects(f.api.request('/api/posts/owps:user:2:100', { method: 'PATCH', body: { caption: 'wrong owner' } }), { status: 403 });
  await assert.rejects(f.api.request('/api/posts/owps:user:2:100', { method: 'DELETE' }), { status: 403 });
  assert.equal(f.calls.some(r => r instanceof Api.stories.EditStory || r instanceof Api.stories.DeleteStories), false);
  const changed = await f.api.request('/api/posts/owps:user:1:100', { method: 'PATCH', body: { caption: '' } });
  assert.equal(changed.post.caption, '');
  f.hooks['stories.DeleteStories'] = () => [];
  await assert.rejects(f.api.request('/api/posts/owps:user:1:100', { method: 'DELETE' }), { code: 'OWPENGRAM_DELETE_NOT_CONFIRMED' });
  delete f.hooks['stories.DeleteStories'];
  const removed = await f.api.request('/api/posts/owps:user:1:100', { method: 'DELETE' });
  assert.deepEqual(removed.deletedPostIds, ['owps:user:1:100']);
  const retry = await f.api.request('/api/posts/owps:user:1:100', { method: 'DELETE' });
  assert.equal(retry.alreadyDeleted, true);
});

test('clearCache discards only transient social caches and never logs out or deletes native content', async () => {
  const f = fixture();
  await f.api.request('/api/users/contacts');
  await f.api.request('/api/users/contacts');
  assert.equal(f.meCalls(), 1);
  const callsBefore = f.calls.length;
  f.api.clearCache();
  assert.equal(f.calls.length, callsBefore);
  await f.api.request('/api/users/contacts');
  assert.equal(f.meCalls(), 2);
  assert.equal(f.histories.get('1').length, 2);
});

test('unsupported social features fail explicitly and returned peers cannot silently change identity', async () => {
  const f = fixture();
  for (const path of ['/api/users/popular', '/api/social/notifications', '/api/profile/visitors', '/api/posts/owps:user:1:100/comments']) {
    await assert.rejects(f.api.request(path), { code: 'OWPENGRAM_SOCIAL_ROUTE_NOT_FOUND', status: 404 });
  }
  f.hooks['users.GetFullUser'] = () => ({ fullUser: { id: long(3) }, users: [f.users.get('3')] });
  await assert.rejects(f.api.request('/api/users/owp:2/profile'), { code: 'OWPENGRAM_PEER_ID_MISMATCH', status: 409 });
});
