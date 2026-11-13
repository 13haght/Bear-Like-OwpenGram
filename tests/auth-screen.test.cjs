const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const React = require('react');
const { create, act } = require('react-test-renderer');

global.IS_REACT_ACT_ENVIRONMENT = true;
const componentSource = fs.readFileSync(path.join(__dirname, '../components/OwpengramAuth.js'), 'utf8');
const componentCode = require('@babel/core').transformSync(componentSource, {
  plugins: [require.resolve('@babel/plugin-transform-react-jsx'), require.resolve('@babel/plugin-transform-modules-commonjs')],
  configFile: false,
  babelrc: false,
}).code;
const GATEWAY = ''; 
const AUTH = '/api/owpengram/auth';
const session = (unused, id = 'owp:123') => ({provider:'owpengram',serverIdentity:'pinned-owpengram',user:{id,username:'alice',name:'Alice'}});
const response = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body, headers: { get: () => null } });
const challenge = (step = 'code', extra = {}) => response(200, { step, challengeId: 'challenge-123', ...extra });
const authenticated = extra => response(200, { step: 'authenticated', session: session(), ...extra });

function harness({gateway = 'configured', replies = []} = {}) {
  const values=new Map(),requests=[],logs=[],failures={set:false};
  const authClient={configurationError:gateway===''?'Configure EXPO_PUBLIC_OWPENGRAM_API_ID pour OwpenGram.':null,
    async request(url,options){requests.push({url,body:JSON.stringify(options.body),headers:{'X-Client-Request-Id':options.requestId}});let next=replies.shift();if(next instanceof Error)throw next;if(typeof next==='function')next=await next(url,options);if(!next)throw Error('Unexpected native request');const body=await next.json();if(!next.ok)throw Object.assign(Error(body.error||body.code||'OwpenGram indisponible'),{status:next.status,code:body.code});return body;},
    async save(value){if(failures.set)throw Error('native storage write error');values.set('native-session',JSON.stringify(value));return value;},
    async logout(){values.clear();}
  };
  return {lib:{authClient,normalizeSession:value=>value},values,requests,logs,failures};
}

async function mountUI(h, onAuthenticated) {
  let requestSequence = 0;
  const rn = { Platform: { OS: 'android' }, StyleSheet: { create: value => value } };
  for (const name of ['ActivityIndicator', 'KeyboardAvoidingView', 'Pressable', 'ScrollView', 'StatusBar', 'Text', 'TextInput', 'View']) rn[name] = name;
  const modules = {
    react: React,
    'react-native': rn,
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) },
    '@expo/vector-icons': { Ionicons: 'Ionicons' },
    'expo-crypto': { randomUUID: () => '10000000-0000-4000-8000-' + String(++requestSequence).padStart(12, '0') },
    '../lib/owpengram-auth': h.lib,
  };
  const context = vm.createContext({
    exports: {}, Date, Math,
    require(name) { if (name in modules) return modules[name]; throw Error('Unexpected component dependency: ' + name); },
  });
  vm.runInContext(componentCode, context);
  const successes = [];
  let renderer;
  await act(async () => {
    renderer = create(React.createElement(context.exports.default, {
      client: h.lib.authClient,
      Background: 'AuthVideoBackground', FormScroll: 'BearFormScroll', TextComponent: 'Text', InputComponent: 'Input',
      onAuthenticated: async (value, isNew) => {
        assert.equal(h.values.size, 1, 'SecureStore must contain the session before navigation');
        successes.push({ value, isNew });
        if (onAuthenticated) await onAuthenticated(value, isNew);
      },
    }));
  });
  const input = label => renderer.root.find(node => node.type === 'Input' && node.props.accessibilityLabel === label);
  const button = label => renderer.root.find(node => node.type === 'Pressable' && node.props.accessibilityLabel === label);
  return {
    renderer, successes, input, button,
    async fill(label, value) { await act(async () => input(label).props.onChangeText(value)); },
    async press(label) { await act(async () => button(label).props.onPress()); },
    async close() { await act(async () => renderer.unmount()); },
  };
}

test('Existing-account UI performs start then code, saves securely and preserves the background', async () => {
  const h = harness({ replies: [challenge('code', { delivery: 'email' }), authenticated({ isNew: false })] });
  const ui = await mountUI(h);
  try {
    assert.equal(ui.renderer.root.findAllByType('AuthVideoBackground').length, 1);
    assert.equal(ui.renderer.root.findAllByType('BearFormScroll').length, 1);
    assert.equal(ui.renderer.root.findAll(node => node.type === 'Input' && node.props.secureTextEntry).length, 0);
    await ui.fill('E-mail ou téléphone OwpenGram', 'alice@example.test');
    await ui.press('Continuer');
    await ui.fill('Code de connexion OwpenGram', '674821');
    await ui.press('Vérifier le code');
    assert.deepEqual(h.requests.map(request => request.url), [GATEWAY + AUTH + '/start', GATEWAY + AUTH + '/code']);
    assert.deepEqual(JSON.parse(h.requests[0].body), { identity: 'alice@example.test' });
    assert.equal(h.requests[0].headers['X-Client-Request-Id'], 'auth-10000000-0000-4000-8000-000000000001');
    assert.deepEqual(JSON.parse(h.requests[1].body), { challengeId: 'challenge-123', code: '674821' });
    assert.equal(ui.successes.length, 1);
    assert.equal(ui.successes[0].isNew, false);
    assert.ok(![...h.values.values()].join('').includes('674821'));
    assert.deepEqual(h.logs, []);
  } finally { await ui.close(); }
});

test('New-account UI calls native signup with first and last name and no local password', async () => {
  const h = harness({ replies: [challenge(), challenge('signup'), authenticated({ isNew: true })] });
  const ui = await mountUI(h);
  try {
    await ui.fill('E-mail ou téléphone OwpenGram', '+33 6 12 34 56 78');
    await ui.press('Continuer');
    await ui.fill('Code de connexion OwpenGram', '674821');
    await ui.press('Vérifier le code');
    assert.equal(ui.renderer.root.findAll(node => node.type === 'Input' && node.props.secureTextEntry).length, 0);
    await ui.press('Créer mon compte OwpenGram');
    assert.equal(h.requests.length, 2, 'Empty first name does not submit signup');
    await ui.fill('Prénom OwpenGram', ' Alice ');
    await ui.fill('Nom OwpenGram', ' Exemple ');
    await ui.press('Créer mon compte OwpenGram');
    assert.equal(h.requests[2].url, GATEWAY + AUTH + '/signup');
    assert.deepEqual(JSON.parse(h.requests[2].body), { challengeId: 'challenge-123', firstName: 'Alice', lastName: 'Exemple' });
    assert.equal(JSON.parse(h.requests[0].body).identity, '+33612345678');
    assert.equal(ui.successes[0].isNew, true);
  } finally { await ui.close(); }
});

test('2FA appears only on server request and failed passwords are cleared before a fresh attempt', async () => {
  const h = harness({ replies: [challenge(), challenge('password', { passwordHint: 'Mon indice' }), response(403, { code: 'PASSWORD_HASH_INVALID' }), authenticated()] });
  const ui = await mountUI(h);
  try {
    await ui.fill('E-mail ou téléphone OwpenGram', 'alice@example.test');
    await ui.press('Continuer');
    await ui.fill('Code de connexion OwpenGram', '674821');
    await ui.press('Vérifier le code');
    assert.equal(ui.input('Mot de passe de double authentification OwpenGram').props.secureTextEntry, true);
    await ui.fill('Mot de passe de double authentification OwpenGram', 'wrong-secret');
    await ui.press('Valider le mot de passe');
    assert.equal(ui.input('Mot de passe de double authentification OwpenGram').props.value, '');
    assert.equal(ui.successes.length, 0);
    await ui.fill('Mot de passe de double authentification OwpenGram', 'correct-secret');
    await ui.press('Valider le mot de passe');
    assert.notEqual(h.requests[2].headers['X-Client-Request-Id'], h.requests[3].headers['X-Client-Request-Id']);
    assert.ok(![...h.values.values()].join('').includes('correct-secret'));
    assert.ok(![...h.values.values()].join('').includes('wrong-secret'));
    assert.deepEqual(h.logs, []);
  } finally { await ui.close(); }
});

test('Double submit is blocked and an ambiguous code retry retains its request ID without retaining the code', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const h = harness({ replies: [challenge(), async () => { await gate; throw new TypeError('offline'); }, authenticated()] });
  const ui = await mountUI(h);
  let pending;
  try {
    await ui.fill('E-mail ou téléphone OwpenGram', 'alice@example.test');
    await ui.press('Continuer');
    await ui.fill('Code de connexion OwpenGram', '674821');
    const submit = ui.button('Vérifier le code').props.onPress;
    await act(async () => { pending = submit(); await submit(); });
    assert.equal(h.requests.length, 2);
    assert.equal(ui.input('Code de connexion OwpenGram').props.value, '');
    assert.equal(ui.button('Vérifier le code').props.disabled, true);
    await act(async () => { release(); await pending; });
    assert.equal(ui.successes.length, 0);
    await ui.fill('Code de connexion OwpenGram', '674821');
    await ui.press('Vérifier le code');
    assert.equal(h.requests[1].headers['X-Client-Request-Id'], h.requests[2].headers['X-Client-Request-Id']);
    assert.equal(ui.successes.length, 1);
  } finally { release(); await pending; await ui.close(); }
});

test('An expired challenge resets authentication and cancellation calls the native challenge cancellation', async () => {
  const h = harness({ replies: [challenge(), response(401, { code: 'AUTH_CHALLENGE_EXPIRED' }), challenge(), response(200, { success: true })] });
  const ui = await mountUI(h);
  try {
    await ui.fill('E-mail ou téléphone OwpenGram', 'alice@example.test');
    await ui.press('Continuer');
    await ui.fill('Code de connexion OwpenGram', '674821');
    await ui.press('Vérifier le code');
    assert.ok(ui.input('E-mail ou téléphone OwpenGram'));
    await ui.press('Continuer');
    await ui.press('Abandonner cette demande de connexion');
    assert.ok(ui.input('E-mail ou téléphone OwpenGram'));
    assert.equal(h.requests[3].url, GATEWAY + AUTH + '/cancel');
    assert.deepEqual(JSON.parse(h.requests[3].body), { challengeId: 'challenge-123' });
    assert.equal(ui.successes.length, 0);
    assert.equal(h.values.size, 0);
  } finally { await ui.close(); }
});

test('SecureStore save failure does not authenticate or resubmit an already accepted code', async () => {
  const h = harness({ replies: [challenge(), authenticated()] });
  const ui = await mountUI(h);
  try {
    await ui.fill('E-mail ou téléphone OwpenGram', 'alice@example.test');
    await ui.press('Continuer');
    h.failures.set = true;
    await ui.fill('Code de connexion OwpenGram', '674821');
    await ui.press('Vérifier le code');
    assert.equal(ui.successes.length, 0);
    assert.equal(h.values.size, 0);
    assert.ok(ui.button('Réessayer l’ouverture de session'));
    h.failures.set = false;
    await ui.press('Réessayer l’ouverture de session');
    assert.equal(h.requests.length, 2, 'Retrying local persistence does not consume the challenge again');
    assert.equal(ui.successes.length, 1);
  } finally { await ui.close(); }
});

test('Missing configuration renders a useful error with no legacy statistics or network calls', async () => {
  const h = harness({ gateway: '' });
  const ui = await mountUI(h);
  try {
    assert.equal(ui.button('Continuer').props.disabled, true);
    assert.ok(ui.renderer.root.findAllByType('Text').some(node => String(node.props.children).includes('EXPO_PUBLIC_OWPENGRAM_API_ID')));
    assert.ok(!ui.renderer.root.findAllByType('Text').some(node => ['Inscrits', '● En ligne'].includes(node.props.children)));
    assert.equal(h.requests.length, 0);
  } finally { await ui.close(); }
});
