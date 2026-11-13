const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const React = require('react');
const { create, act } = require('react-test-renderer');
global.IS_REACT_ACT_ENVIRONMENT = true;
const source = fs.readFileSync(path.join(__dirname, '../App.js'), 'utf8');
const recipientCode = source.slice(source.indexOf('function bearConversationRecipient('), source.indexOf('function Main('));
const openCode = source.slice(source.indexOf('  const openRemoteChat='), source.indexOf('  const sendRemoteMessage='));
const sendCode = source.slice(source.indexOf('  const sendRemoteMessage='), source.indexOf('  const toggleContact='));
const loadCode = source.slice(source.indexOf('  const loadConversations='), source.indexOf('  const refresh=',source.indexOf('  const loadConversations=')));

function sendingHarness({ handle = 'bob_real', rejected = false } = {}) {
  const requests = [], routes = [], loads = [], alerts = [];
  const remoteChatIds = { current: {} }, activeChatRef = { current: null };
  const context = vm.createContext({
    remoteChatIds, activeChatRef,
    userOf: id => ({ id, handle }),
    request: async (url, options) => {
      requests.push({ url, body: options?.body ? JSON.parse(options.body) : null });
      if (url === '/api/conversations') {
        if (rejected) throw Object.assign(Error('Ce pseudo appartient à un autre compte.'), { status: 409 });
        return { conversationId: 'user:200' };
      }
      return { success: true, messageId: '321' };
    },
    setRoute: route => routes.push(route), setError() {}, notice: value=>alerts.push(value),
    loadConversations: async id => loads.push({ id, active: activeChatRef.current }),
    Alert: { alert: (...args) => alerts.push(args) },
    uid: () => 'client-message-123',
  });
  vm.runInContext(recipientCode + openCode + sendCode + '\nglobalThis.api={recipient:bearConversationRecipient,open:openRemoteChat,send:sendRemoteMessage};', context);
  return { ...context.api, requests, routes, loads, alerts, remoteChatIds, activeChatRef };
}

test('A new chat opened from a known profile supplies stable ID and real username before rendering', async () => {
  const h = sendingHarness({ handle: '@bob_real' });
  await h.open('owp:200');
  assert.deepEqual(h.requests[0].body, { recipientId: 'owp:200', recipientUsername: 'bob_real' });
  assert.equal(h.remoteChatIds.current['owp:200'], 'user:200');
  assert.equal(h.routes[0].id, 'owp:200');
  assert.deepEqual(h.loads, [{ id: 'owp:200', active: 'owp:200' }]);
});

test('Sending without a cached dialogue resolves the profile then uses the returned remote conversation ID', async () => {
  const h = sendingHarness();
  h.activeChatRef.current = 'owp:200';
  await h.send('owp:200', { type: 'text', text: 'Bonjour', clientMessageId: 'stable-message-123' });
  assert.deepEqual(h.requests[0].body, { recipientId: 'owp:200', recipientUsername: 'bob_real' });
  assert.equal(h.requests[1].url, '/api/conversations/user%3A200/messages');
  assert.deepEqual(h.requests[1].body, { text: 'Bonjour', replyTo: null, clientMessageId: 'stable-message-123' });
  assert.deepEqual(h.loads, [{ id: 'owp:200', active: 'owp:200' }]);
});

test('Synthetic or malformed usernames are never used to infer another recipient', () => {
  const h = sendingHarness();
  for (const handle of ['', 'owp_200', '@OWP_200', 'mon.profil', 'bad handle']) {
    assert.equal(JSON.stringify(h.recipient('owp:200', { handle })), JSON.stringify({ recipientId: 'owp:200' }));
  }
  assert.equal(JSON.stringify(h.recipient('channel:200', { handle: 'bob_real' })), JSON.stringify({ recipientId: 'channel:200' }));
});

test('A server identity mismatch opens no chat and sends no message', async () => {
  const h = sendingHarness({ rejected: true });
  await h.open('owp:200');
  assert.equal(h.routes.length, 0);
  assert.equal(h.loads.length, 0);
  assert.equal(h.alerts.length, 1);
  await assert.rejects(h.send('owp:200', { type: 'text', text: 'Bonjour' }), { status: 409 });
  assert.ok(h.requests.every(request => request.url === '/api/conversations'));
});

const rooms = [
  { id: 'user:200', recipientId: 'owp:200', name: 'Bob', username: 'bob_real', lastMessage: 'Message vocal', lastMessageId: '1', lastMessageAt: '2026-11-12T10:00:00Z' },
  { id: 'user:300', recipientId: 'owp:300', name: 'Camille', username: 'camille', lastMessage: 'Bonjour demain', lastMessageId: '2', lastMessageAt: '2026-11-12T11:00:00Z' },
];

function loadingHarness({ gate, olderGate } = {}) {
  const requests = [], summaries = [], alerts = [];
  let lists = 0;
  const refs = {
    conversationLock: { current: null }, conversationEpoch: { current: 0 }, conversationVersions: { current: {} },
    remoteChatIds: { current: {} }, activeChatRef: { current: null }, mediaTickets: { current: {} },
    dataRef: { current: { chats: {} } }, historyRef:{current:{}}, olderLock:{current:false}, unreadSequence: { current: 0 },
  };
  const context = vm.createContext({
    ...refs, session: { user: { id: 'owp:100' } },
    request: async (url, options) => {
      requests.push({ url, options });
      if (url === '/api/conversations') { if (++lists === 1 && gate) await gate; return { conversations: rooms }; }
      if (url.includes('/messages?before=')) { if(olderGate) await olderGate; return {messages:[{id:9,sender_id:'owp:200',type:'text',content:'Plus ancien',created_at:'2026-11-12T09:00:00Z'}],nextBefore:null}; }
      if (url.endsWith('/messages')) return {nextBefore:'10', messages: [{ id: 10, sender_id: 'owp:200', type: 'media', mime_type: 'image/jpeg', created_at: '2026-11-12T10:00:00Z', content: '',uri:'owp-media://private-photo',reactionCounts:[{emoji:'👍',count:12}],reactions:{'owp:999':'👍'} }] };
      if (url.includes('/ticket')) throw Error('Media tickets are forbidden');
      return { success: true };
    },
    setDialogs: value => summaries.push(value), setDialogHasMore() {}, setHistoryState() {}, setLoadingOlder() {},
    commit: async update => { refs.dataRef.current = update(refs.dataRef.current); },
    setUnreadConversations: update => update([]), setRemoteNotifications: update => update([]),
    loadUnread: async () => {}, notice: value => alerts.push(value),
  });
  vm.runInContext(recipientCode + loadCode + '\nglobalThis.load=loadConversations;globalThis.loadOlder=loadOlder;', context);
  return { ...refs, requests, summaries, alerts, load: context.load,loadOlder:context.loadOlder };
}

test('Inbox refresh obtains summaries without requesting any closed conversation history or media ticket', async () => {
  const h = loadingHarness();
  await h.load();
  assert.deepEqual(h.requests.map(request => request.url), ['/api/conversations']);
  assert.equal(h.summaries[0].length, 2);
  assert.equal(Object.keys(h.dataRef.current.chats).length, 0);
});

test('Only the opened conversation fetches history and read acknowledgements; media stays opaque', async () => {
  const h = loadingHarness();
  h.activeChatRef.current = 'owp:200';
  await h.load('owp:200');
  const urls = h.requests.map(request => request.url);
  assert.ok(urls.includes('/api/conversations/user%3A200/messages'));
  assert.ok(!urls.some(url=>url.includes('/ticket')));
  assert.ok(urls.includes('/api/conversations/user%3A200/read'));
  assert.ok(!urls.some(url => url.includes('300')));
  assert.equal(h.dataRef.current.chats['owp:200'][0].uri, 'owp-media://private-photo');
  assert.equal(h.dataRef.current.chats['owp:300'], undefined);
  assert.equal(h.dataRef.current.chats['owp:200'][0].reaction,'👍 12');
});

test('Opening while a background summary request is pending waits then loads the selected dialogue', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const h = loadingHarness({ gate });
  const background = h.load();
  h.activeChatRef.current = 'owp:200';
  const foreground = h.load('owp:200');
  release();
  await Promise.all([background, foreground]);
  assert.equal(h.requests.filter(request => request.url.endsWith('/messages')).length, 1);
  assert.ok(h.dataRef.current.chats['owp:200']);
  assert.equal(h.conversationLock.current, null);
});

test('Inbox shows uncached remote summaries and preserves time sorting, pinning and text search', async () => {
  const raw = source.slice(source.indexOf('function Inbox('), source.indexOf('const voiceTime ='));
  const code = require('@babel/core').transformSync(raw, { plugins: [require.resolve('@babel/plugin-transform-react-jsx')], configFile: false, babelrc: false }).code;
  const globals = { React, useState: React.useState, useEffect: React.useEffect, Date, chatTime: () => '12:00', setInterval: () => 1, clearInterval() {}, PULSE_THEMES: { navy: { bg: '#000', panel: '#111', text: '#fff', muted: '#aaa', soft: '#222' } } };
  for (const name of ['View', 'Text', 'TextInput', 'Tap', 'Icon', 'Avatar', 'ScrollView', 'RefreshControl', 'Modal']) globals[name] = name;
  const context = vm.createContext(globals);
  vm.runInContext(code + '\nglobalThis.Component=Inbox;', context);
  const props = { chats: {}, remoteUsers: rooms.map(room => ({ ...room, id: room.recipientId, handle: room.username })), onChat() {}, onNewChat() {} };
  let renderer;
  const ids = () => renderer.root.findAll(node => node.type === 'Tap' && node.props.onLongPress).map(node => node.findByType('Avatar').props.user.id);
  try {
    await act(async () => { renderer = create(React.createElement(context.Component, props)); });
    assert.deepEqual(ids(), ['owp:300', 'owp:200']);
    await act(async () => renderer.update(React.createElement(context.Component, { ...props, meta: { 'owp:200': { pinned: true } } })));
    assert.deepEqual(ids(), ['owp:200', 'owp:300']);
    await act(async () => renderer.root.findByType('TextInput').props.onChangeText('vocal'));
    assert.deepEqual(ids(), ['owp:200']);
  } finally { if (renderer) await act(async () => renderer.unmount()); }
});


test('Older messages load only for the selected native conversation and merge without duplication',async()=>{const h=loadingHarness();h.activeChatRef.current='owp:200';await h.load('owp:200');await h.loadOlder('owp:200');assert.ok(h.requests.some(call=>call.url==='/api/conversations/user%3A200/messages?before=10'));assert.deepEqual(JSON.parse(JSON.stringify(h.dataRef.current.chats['owp:200'].map(message=>message.id))),['9','10']);assert.equal(h.historyRef.current['owp:200'].before,null);assert.ok(!h.requests.some(call=>call.url.includes('300')));});
test('An older-history reply arriving after changing conversations does not update the closed chat',async()=>{let release;const gate=new Promise(resolve=>release=resolve);const h=loadingHarness({olderGate:gate});h.activeChatRef.current='owp:200';await h.load('owp:200');const loading=h.loadOlder('owp:200');h.activeChatRef.current='owp:300';release();await loading;assert.equal(h.dataRef.current.chats['owp:200'].length,1);assert.equal(h.historyRef.current['owp:200'].before,'10');});
