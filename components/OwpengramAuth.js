import React, { useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text as NativeText,
  TextInput as NativeInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { randomUUID } from 'expo-crypto';

const { authClient: defaultAuthClient, normalizeSession } = require('../lib/owpengram-auth');
const AUTH_PATH = '/api/owpengram/auth';
// A start request can recover a pending challenge: use a native cryptographic
// UUID for every new flow, and retain it only in memory for safe retries.
const requestId = () => 'auth-' + randomUUID();

function normalizeIdentity(value) {
  const text = value.trim();
  if (/^[^\s@]+@[^\s@]+$/.test(text)) return text;
  const phone = text.replace(/[\s().-]/g, '');
  if (/^\+?\d{5,20}$/.test(phone)) return phone;
  throw Error('Indique ton adresse e-mail ou ton numéro de téléphone avec son indicatif.');
}

export default function OwpenGramAuth({
  onAuthenticated,
  Background,
  FormScroll = ScrollView,
  TextComponent = NativeText,
  InputComponent = NativeInput,
  client = defaultAuthClient,
}) {
  const insets = useSafeAreaInsets();
  const Text = TextComponent;
  const Input = InputComponent;
  const [step, setStep] = useState('identity');
  const [identity, setIdentity] = useState('');
  const [code, setCode] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [passwordHint, setPasswordHint] = useState('');
  const [delivery, setDelivery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const busyRef = useRef(false);
  const challenge = useRef(null);
  const attempts = useRef({});
  const pendingSession = useRef(null);
  const newAccount = useRef(false);
  const configurationError = client.configurationError || '';

  const clearSecrets = () => { setCode(''); setPassword(''); setShowPassword(false); };
  const resetChallenge = () => {
    challenge.current = null;
    pendingSession.current = null;
    attempts.current = {};
    newAccount.current = false;
    clearSecrets();
    setFirstName(''); setLastName(''); setPasswordHint(''); setDelivery(''); setStep('identity');
  };
  const finish = async result => {
    // Keep the server-confirmed session in memory if secure storage fails, so
    // retrying the local save never submits the same code a second time.
    const confirmed = normalizeSession(result.session);
    pendingSession.current = { ...result, session: confirmed };
    setStep('authenticated');
    const saved = await client.save(confirmed);
    await onAuthenticated(saved, result.isNew);
    pendingSession.current = null;
  };
  const acceptResponse = async response => {
    if (!response || !['code', 'signup', 'password', 'authenticated'].includes(response.step)) {
      throw Error('OwpenGram n’a pas renvoyé l’étape de connexion attendue. Réessaie.');
    }
    clearSecrets();
    if (response.step === 'authenticated') {
      await finish({ session: response.session, isNew: response.isNew == null ? newAccount.current : !!response.isNew });
      return;
    }
    const nextChallenge = response.challengeId || challenge.current;
    if (typeof nextChallenge !== 'string' || !nextChallenge || nextChallenge.length > 256 || /[\u0000-\u001f\u007f]/.test(nextChallenge)) {
      throw Error('La demande de connexion OwpenGram est invalide. Recommence.');
    }
    challenge.current = nextChallenge;
    if (response.step === 'signup') newAccount.current = true;
    setPasswordHint(typeof response.passwordHint === 'string' ? response.passwordHint.slice(0, 160) : '');
    setDelivery(typeof response.delivery === 'string' ? response.delivery : response.delivery?.type || '');
    setStep(response.step);
  };

  const submit = async () => {
    if (busyRef.current || configurationError) return;
    let path, body, attemptKey;
    try {
      if (pendingSession.current) {
        busyRef.current = true; setBusy(true); setError('');
        await finish(pendingSession.current);
        return;
      }
      if (step === 'identity') {
        const normalized = normalizeIdentity(identity);
        path = '/start'; body = { identity: normalized }; attemptKey = 'start:' + normalized;
      } else {
        if (!challenge.current) throw Error('La demande de connexion a expiré. Recommence.');
        attemptKey = step + ':' + challenge.current;
        if (step === 'code') {
          if (!code.trim()) throw Error('Saisis le code transmis par OwpenGram.');
          path = '/code'; body = { challengeId: challenge.current, code: code.trim() };
        } else if (step === 'signup') {
          if (!firstName.trim()) throw Error('Indique ton prénom pour créer le compte OwpenGram.');
          path = '/signup'; body = { challengeId: challenge.current, firstName: firstName.trim(), lastName: lastName.trim() };
        } else if (step === 'password') {
          if (!password) throw Error('Saisis le mot de passe de double authentification de ton compte OwpenGram.');
          path = '/password'; body = { challengeId: challenge.current, password };
        } else throw Error('Recommence la connexion à OwpenGram.');
      }
      busyRef.current = true; setBusy(true); setError('');
      // Request IDs depend on a stage and challenge, never on a stored code or
      // password. Keep the ID after an ambiguous network failure.
      const id = attempts.current[attemptKey] || (attempts.current[attemptKey] = requestId());
      clearSecrets();
      const response = await client.request(AUTH_PATH + path, { method: 'POST', body, requestId: id });
      await acceptResponse(response);
    } catch (failure) {
      if (attemptKey && failure.status >= 400 && failure.status < 500 && failure.status !== 429) delete attempts.current[attemptKey];
      if (failure.status === 401 || failure.code === 'AUTH_CHALLENGE_EXPIRED') resetChallenge();
      setError(failure.message || 'La connexion à OwpenGram a échoué. Réessaie.');
    } finally {
      clearSecrets();
      busyRef.current = false; setBusy(false);
    }
  };

  const cancel = async () => {
    if (busyRef.current || configurationError) return;
    busyRef.current = true; setBusy(true); setError(''); clearSecrets();
    try {
      if (pendingSession.current) await client.logout(pendingSession.current.session);
      else if (challenge.current) {
        const attemptKey = 'cancel:' + challenge.current;
        const id = attempts.current[attemptKey] || (attempts.current[attemptKey] = requestId());
        await client.request(AUTH_PATH + '/cancel', { method: 'POST', body: { challengeId: challenge.current }, requestId: id });
      }
      resetChallenge();
    } catch (failure) {
      if (failure.status === 401 || failure.code === 'AUTH_CHALLENGE_EXPIRED') resetChallenge();
      else setError(failure.message || 'Impossible d’abandonner la demande pour le moment. Réessaie.');
    } finally { busyRef.current = false; setBusy(false); }
  };

  const label = step === 'identity' ? 'Continuer'
    : step === 'code' ? 'Vérifier le code'
    : step === 'signup' ? 'Créer mon compte OwpenGram'
    : step === 'password' ? 'Valider le mot de passe'
    : 'Réessayer l’ouverture de session';
  const title = step === 'identity' ? 'Connexion à OwpenGram'
    : step === 'code' ? 'Vérifie ton identité'
    : step === 'signup' ? 'Crée ton compte OwpenGram'
    : step === 'password' ? 'Double authentification'
    : 'Enregistrer la session';
  const inputProps = {
    editable: !busy && !configurationError,
    placeholderTextColor: '#B8C5D5',
    selectionColor: '#25F4EE',
    style: styles.input,
  };
  return <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <StatusBar barStyle="light-content" backgroundColor="#000000" />
    {Background ? <Background /> : null}
    <FormScroll keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 56, paddingBottom: Math.max(insets.bottom, 16) + 20 }]}>
      <View style={styles.card}>
        <Text style={styles.brand}>Bear Like</Text>
        <Text style={styles.title}>{title}</Text>
        {step === 'identity' && <>
          <Text style={styles.description}>Utilise ton adresse e-mail ou ton numéro de téléphone OwpenGram. Le serveur indiquera la suite de la connexion.</Text>
          <Text style={styles.fieldLabel}>E-mail ou téléphone</Text>
          <Input {...inputProps} accessibilityLabel="E-mail ou téléphone OwpenGram" value={identity} onChangeText={setIdentity} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" textContentType="username" placeholder="ton@email.fr ou +33…" returnKeyType="go" onSubmitEditing={submit} />
        </>}
        {step === 'code' && <>
          <Text style={styles.description}>{delivery === 'email' ? 'Saisis le code envoyé par e-mail par OwpenGram.' : delivery === 'sms' ? 'Saisis le code envoyé par SMS par OwpenGram.' : delivery === 'app' ? 'Saisis le code reçu dans ton application OwpenGram.' : 'Saisis le code transmis par OwpenGram.'}</Text>
          <Text style={styles.fieldLabel}>Code de connexion</Text>
          <Input {...inputProps} accessibilityLabel="Code de connexion OwpenGram" value={code} onChangeText={setCode} autoCapitalize="none" autoCorrect={false} textContentType="oneTimeCode" keyboardType="number-pad" placeholder="Code reçu" returnKeyType="go" onSubmitEditing={submit} />
        </>}
        {step === 'signup' && <>
          <Text style={styles.description}>OwpenGram demande ces informations pour créer ton nouveau compte.</Text>
          <Text style={styles.fieldLabel}>Prénom</Text>
          <Input {...inputProps} accessibilityLabel="Prénom OwpenGram" value={firstName} onChangeText={setFirstName} autoCapitalize="words" textContentType="givenName" placeholder="Ton prénom" />
          <Text style={styles.fieldLabel}>Nom, facultatif</Text>
          <Input {...inputProps} accessibilityLabel="Nom OwpenGram" value={lastName} onChangeText={setLastName} autoCapitalize="words" textContentType="familyName" placeholder="Ton nom" returnKeyType="go" onSubmitEditing={submit} />
        </>}
        {step === 'password' && <>
          <Text style={styles.description}>Ce compte OwpenGram est protégé par un mot de passe de double authentification.</Text>
          {!!passwordHint && <Text style={styles.hint}>Indice : {passwordHint}</Text>}
          <Text style={styles.fieldLabel}>Mot de passe OwpenGram</Text>
          <View style={styles.passwordRow}>
            <Input {...inputProps} style={[styles.input, styles.passwordInput]} accessibilityLabel="Mot de passe de double authentification OwpenGram" value={password} onChangeText={setPassword} secureTextEntry={!showPassword} autoCapitalize="none" autoCorrect={false} textContentType="password" placeholder="Ton mot de passe" returnKeyType="go" onSubmitEditing={submit} />
            <Pressable accessibilityRole="button" accessibilityLabel={showPassword ? 'Masquer le mot de passe' : 'Afficher le mot de passe'} disabled={busy} onPress={() => setShowPassword(value => !value)} style={styles.eye}><Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} color="#DCE7F3" size={22} /></Pressable>
          </View>
        </>}
        {step === 'authenticated' && <Text style={styles.description}>La session reçue doit être enregistrée dans le stockage sécurisé de cet appareil avant d’ouvrir l’application.</Text>}
        {!!(configurationError || error) && <Text accessibilityLiveRegion="polite" style={styles.error}>{configurationError || error}</Text>}
        <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={busy || !!configurationError} onPress={submit} style={({ pressed }) => [styles.submit, { opacity: busy || configurationError ? 0.55 : pressed ? 0.8 : 1 }]}>
          {busy ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.submitText}>{label}</Text>}
        </Pressable>
        {step !== 'identity' && <Pressable accessibilityRole="button" accessibilityLabel="Abandonner cette demande de connexion" disabled={busy} onPress={cancel} style={styles.cancel}><Text style={styles.cancelText}>Abandonner cette demande</Text></Pressable>}
        <Text style={styles.footer}>Tes codes et mots de passe ne sont pas enregistrés dans l’application.</Text>
      </View>
    </FormScroll>
  </KeyboardAvoidingView>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#000000' },
  scroll: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 22 },
  card: { width: '100%', maxWidth: 440, alignSelf: 'center', padding: 20, borderRadius: 18, borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)', backgroundColor: 'rgba(0,0,0,0.66)' },
  brand: { color: '#FFFFFF', fontSize: 27, fontWeight: '900', letterSpacing: 1, textAlign: 'center' },
  title: { color: '#FFFFFF', fontSize: 20, fontWeight: '700', textAlign: 'center', marginTop: 10, marginBottom: 14 },
  description: { color: '#D0DCE9', fontSize: 14, lineHeight: 21, marginBottom: 20 },
  fieldLabel: { color: '#F0F6FC', fontWeight: '700', fontSize: 14, marginBottom: 7 },
  input: { minHeight: 50, borderRadius: 11, paddingHorizontal: 13, paddingVertical: 12, marginBottom: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.22)', backgroundColor: 'rgba(10,20,35,0.65)', color: '#FFFFFF', fontSize: 16 },
  passwordRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.22)', borderRadius: 11, backgroundColor: 'rgba(10,20,35,0.65)' },
  passwordInput: { flex: 1, borderWidth: 0, marginBottom: 0, backgroundColor: 'transparent' },
  eye: { padding: 13 },
  hint: { color: '#B8DCD9', fontSize: 13, marginBottom: 14 },
  error: { color: '#FFAFBF', fontSize: 14, lineHeight: 20, marginBottom: 16 },
  submit: { minHeight: 52, alignItems: 'center', justifyContent: 'center', borderRadius: 11, paddingHorizontal: 12, paddingVertical: 13, backgroundColor: 'rgba(37,244,238,0.23)', borderWidth: 1, borderColor: 'rgba(37,244,238,0.65)' },
  submitText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800', textAlign: 'center' },
  cancel: { paddingVertical: 17, alignItems: 'center' },
  cancelText: { color: '#D0DCE9', fontSize: 14 },
  footer: { color: '#C1CFDD', fontSize: 12, lineHeight: 18, textAlign: 'center', marginTop: 18 },
});
