const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const React = require('react');
const { create, act } = require('react-test-renderer');

global.IS_REACT_ACT_ENVIRONMENT = true;
const source = fs.readFileSync(path.join(__dirname, '../App.js'), 'utf8');
const raw = source.slice(source.indexOf('function Chat('), source.indexOf('async function getBearImageQuality'));
const code = require('@babel/core').transformSync(raw, {
  plugins: [require.resolve('@babel/plugin-transform-react-jsx')],
  configFile: false,
  babelrc: false,
}).code;

async function mount({ send = async () => {}, pickerResults = [] } = {}) {
  const sent = [], pickerCalls = [], stored = new Map(), files = new Map();
  let sequence = 0;
  const recorder = {
    uri: 'file:///cache/native.m4a', isRecording: false, recordCalls: 0,
    getStatus() { return { durationMillis: 3000, isRecording: this.isRecording }; },
    async prepareToRecordAsync() {},
    record() { this.isRecording = true; this.recordCalls++; },
    async stop() { this.isRecording = false; },
  };
  files.set(recorder.uri, { exists: true, size: 256 });
  const globals = {
    React, useState: React.useState, useRef: React.useRef, useEffect: React.useEffect,
    PULSE_THEMES: { navy: { bg: '#000', panel: '#111', text: '#fff', muted: '#aaa' } },
    RecordingPresets: { HIGH_QUALITY: {} },
    useAudioRecorder: () => recorder,
    useAudioRecorderState: () => ({ durationMillis: recorder.isRecording ? 3000 : 0, isRecording: recorder.isRecording }),
    AudioModule: { getRecordingPermissionsAsync: async () => ({ granted: true }) },
    setAudioModeAsync: async () => {},
    AsyncStorage: {
      getItem: async key => stored.get(key),
      setItem: async (key, value) => stored.set(key, value),
      removeItem: async key => stored.delete(key),
    },
    FS: {
      documentDirectory: 'file:///document/',
      getInfoAsync: async uri => files.get(uri) || { exists: false },
      makeDirectoryAsync: async () => {},
      copyAsync: async ({ to }) => files.set(to, { exists: true, size: 256 }),
      deleteAsync: async uri => files.delete(uri),
    },
    ImagePicker: {
      async launchImageLibraryAsync(options) {
        pickerCalls.push(options);
        const result = pickerResults.shift();
        if (result instanceof Error) throw result;
        return result || { canceled: true };
      },
    },
    getBearImageQuality: async () => 0.85,
    AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) },
    BackHandler: { addEventListener: () => ({ remove() {} }) },
    Alert: { alert() {} },
    uid: () => 'client-' + (++sequence),
    chatTime: () => '12:00',
    voiceTime: () => '0:03',
    setInterval: (...args) => { const timer = setInterval(...args); timer.unref(); return timer; },
    clearInterval, Date, Math,
  };
  for (const name of ['View', 'Text', 'TextInput', 'Tap', 'Icon', 'Avatar', 'FlatList', 'Modal', 'Pressable', 'ActivityIndicator', 'Image', 'MediaThumb', 'Movie', 'ChatVoicePlayer']) globals[name] = name;
  const context = vm.createContext(globals);
  vm.runInContext(code + '\nglobalThis.Component = Chat;', context);
  let renderer;
  await act(async () => {
    renderer = create(React.createElement(context.Component, {
      sessionUserId: 'alice', user: { id: 'bob', name: 'Bob' }, messages: [],
      onSend: async message => { sent.push(JSON.parse(JSON.stringify(message))); return send(message); },
      onBack() {}, onChatSettings: async () => ({ ttlSeconds: 0 }), onClearConversation: async () => {},
    }));
  });
  const button = label => renderer.root.find(node => node.type === 'Tap' && node.props.label === label);
  const input = () => renderer.root.findByType('TextInput');
  const mic = () => renderer.root.find(node => node.type === 'View' && node.props.onResponderGrant);
  return {
    renderer, button, input, mic, sent, stored, files, recorder, pickerCalls,
    async write(text) {
      if (!renderer.root.findAllByType('TextInput').length) await act(async () => button('Écrire un message').props.onPress());
      await act(async () => input().props.onChangeText(text));
    },
    async close() { await act(async () => renderer.unmount()); },
  };
}

test('Text composer sends a real message and clears only after acknowledgement', async () => {
  const h = await mount();
  try {
    await h.write('   ');
    assert.equal(h.button('Envoyer le texte').props.disabled, true);
    await act(async () => h.button('Envoyer le texte').props.onPress());
    assert.equal(h.sent.length, 0);
    await h.write('  Bonjour Bob  ');
    await act(async () => h.button('Envoyer le texte').props.onPress());
    assert.deepEqual(h.sent, [{ type: 'text', text: 'Bonjour Bob', clientMessageId: 'client-1' }]);
    assert.equal(h.input().props.value, '');
  } finally { await h.close(); }
});

test('Failed text remains editable and an unchanged retry keeps its operation ID', async () => {
  let attempts = 0;
  const h = await mount({ send: async () => { if (++attempts === 1) throw Error('Connexion coupée'); } });
  try {
    await h.write('Texte à conserver');
    await act(async () => h.button('Envoyer le texte').props.onPress());
    assert.equal(h.input().props.value, 'Texte à conserver');
    assert.ok(h.renderer.root.findAllByType('Text').some(node => node.props.children === 'Connexion coupée'));
    await act(async () => h.button('Envoyer le texte').props.onPress());
    assert.equal(h.sent.length, 2);
    assert.equal(h.sent[0].clientMessageId, h.sent[1].clientMessageId);
    assert.equal(h.input().props.value, '');
  } finally { await h.close(); }
});

test('Repeated taps cannot duplicate an in-flight message or start audio capture', async () => {
  let acknowledge;
  const gate = new Promise(resolve => { acknowledge = resolve; });
  const h = await mount({ send: () => gate });
  let pending;
  try {
    await h.write('Un seul envoi');
    const submit = h.button('Envoyer le texte').props.onPress;
    await act(async () => { pending = submit(); await submit(); });
    assert.equal(h.sent.length, 1);
    assert.equal(h.input().props.editable, false);
    await act(async () => h.mic().props.onResponderGrant({ nativeEvent: { pageX: 100, pageY: 100 } }));
    assert.equal(h.recorder.recordCalls, 0);
    await act(async () => h.button('Ajouter une photo ou vidéo').props.onPress());
    assert.equal(h.pickerCalls.length, 0);
    await act(async () => { acknowledge(); await pending; });
    assert.equal(h.input().props.value, '');
  } finally { acknowledge(); await pending; await h.close(); }
});

for (const type of ['image', 'video']) test('Single ' + type + ' selection waits for send and survives a failed upload', async () => {
  let attempts = 0;
  const extension = type === 'video' ? 'mp4' : 'jpg';
  const asset = { uri: 'file:///cache/selected.' + extension, type, mimeType: type === 'video' ? 'video/mp4' : 'image/jpeg', fileName: 'selected.' + extension, width: 640, height: 800, duration: type === 'video' ? 12000 : 0 };
  const h = await mount({ pickerResults: [{ canceled: false, assets: [asset] }], send: async () => { if (++attempts === 1) throw Error('Média refusé par le serveur'); } });
  try {
    await h.write('Un texte indépendant');
    await act(async () => h.button('Ajouter une photo ou vidéo').props.onPress());
    assert.equal(h.pickerCalls[0].allowsMultipleSelection, false);
    assert.equal(h.pickerCalls[0].selectionLimit, 1);
    assert.equal(h.sent.length, 0);
    await act(async () => h.button('Envoyer le média').props.onPress());
    assert.equal(h.sent[0].type, type);
    assert.equal(h.sent[0].mimeType, asset.mimeType);
    assert.equal(h.sent[0].uri, asset.uri);
    assert.equal(h.renderer.root.findByType('MediaThumb').props.media.uri, asset.uri);
    assert.equal(h.input().props.value, 'Un texte indépendant');
    assert.ok(h.renderer.root.findAllByType('Text').some(node => node.props.children === 'Média refusé par le serveur'));
    await act(async () => h.button('Envoyer le média').props.onPress());
    assert.equal(h.sent[0].clientMessageId, h.sent[1].clientMessageId);
    assert.equal(h.renderer.root.findAllByType('MediaThumb').length, 0);
    assert.equal(h.input().props.value, 'Un texte indépendant');
  } finally { await h.close(); }
});

test('Cancel, picker failure and unexpected multi-selection preserve the previous attachment', async () => {
  const asset = { uri: 'file:///cache/selected.jpg', type: 'image', fileName: 'selected.jpg' };
  const h = await mount({ pickerResults: [
    { canceled: false, assets: [asset] },
    { canceled: true },
    Error('Galerie indisponible'),
    { canceled: false, assets: [asset, { ...asset, uri: 'file:///other.jpg' }] },
  ] });
  try {
    for (let i = 0; i < 4; i++) {
      await act(async () => h.button('Ajouter une photo ou vidéo').props.onPress());
      assert.equal(h.renderer.root.findByType('MediaThumb').props.media.uri, asset.uri);
    }
    assert.equal(h.sent.length, 0);
    await act(async () => h.button('Retirer le média sélectionné').props.onPress());
    assert.equal(h.renderer.root.findAllByType('MediaThumb').length, 0);
  } finally { await h.close(); }
});

test('Text and media pause during voice capture and leave the voice preview intact', async () => {
  const h = await mount();
  try {
    await h.write('À envoyer après le vocal');
    await act(async () => h.mic().props.onResponderGrant({ nativeEvent: { pageX: 100, pageY: 100 } }));
    assert.equal(h.recorder.recordCalls, 1);
    await act(async () => h.button('Envoyer le texte').props.onPress());
    await act(async () => h.button('Ajouter une photo ou vidéo').props.onPress());
    assert.equal(h.sent.length, 0);
    assert.equal(h.pickerCalls.length, 0);
    await act(async () => h.mic().props.onResponderRelease());
    const savedVoice = [...h.stored.entries()].find(([key]) => key.startsWith('@bear-voice-draft'));
    assert.ok(savedVoice);
    await act(async () => h.button('Envoyer le texte').props.onPress());
    assert.equal(h.sent[0].type, 'text');
    assert.equal(h.stored.get(savedVoice[0]), savedVoice[1]);
    assert.equal(h.renderer.root.findByType('ChatVoicePlayer').props.uri, JSON.parse(savedVoice[1]).uri);
  } finally { await h.close(); }
});
