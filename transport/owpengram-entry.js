/**
 * Direct mobile MTProto client. Build this entry for the browser condition before
 * Metro consumes it; never import teleproto's Node entry from the mobile app.
 * Only the transport uses MTProto encryption. Media bytes have no extra AES layer.
 */
// Must initialize before teleproto; all its Buffer imports share this instance.
import { Buffer } from './buffer.js';
import { TelegramClient, Api } from 'teleproto';
import { StringSession } from 'teleproto/sessions';
import { CustomFile } from 'teleproto/client/uploads';
import { Logger } from 'teleproto/extensions/Logger';
import { WebSocketSocket } from 'teleproto/network/transport/socket/WebSocketSocket';
import { ConnectionTCPObfuscated } from 'teleproto/network/connection';
import { computeCheck } from 'teleproto/Password';
import { createHash, randomBytes } from 'teleproto/platform/crypto/index';
import * as RSA from 'teleproto/crypto/RSA';
import bigInt from 'big-integer';
import { OWPENGRAM_SERVER, OwpenError, safeOwpenError, readOwpenConfig, encodeOwpenIdentifier } from './owpengram-config.js';

export { Api, Buffer, StringSession, OWPENGRAM_SERVER, safeOwpenError, encodeOwpenIdentifier };

/**
 * Call once with ExpoCrypto.getRandomValues before constructing a client.
 * cifrante uses this synchronous native entropy source for every MTProto nonce.
 * Hashes and AES stay synchronous portable JS; no WebCrypto/SubtleCrypto needed.
 */
export function configureNativeRandom(getRandomValues) {
  if (typeof getRandomValues !== 'function') throw new OwpenError('OWPENGRAM_NATIVE_RANDOM_REQUIRED', 503);
  const nativeFill = (array) => {
    if (!ArrayBuffer.isView(array) || array instanceof DataView) throw new TypeError('Expected an integer typed array');
    getRandomValues(array);
    return array;
  };
  try {
    const crypto = globalThis.crypto || {};
    Object.defineProperty(crypto, 'getRandomValues', { value: nativeFill, configurable: true, writable: true });
    if (!globalThis.crypto) Object.defineProperty(globalThis, 'crypto', { value: crypto, configurable: true });
  } catch {
    throw new OwpenError('OWPENGRAM_NATIVE_RANDOM_CONFIGURATION_FAILED', 503);
  }
}

export { readOwpenConfig, OwpenError };
const PINNED_FINGERPRINT = BigInt.asIntN(64, BigInt(OWPENGRAM_SERVER.rsaFingerprintHex)).toString();
let pinnedKeyTask;
let pinnedModulus;

/** This isolated bundle dedicates teleproto to OwpenGram; no official-server key is trusted. */
export async function installOwpenRsaKey() {
  pinnedKeyTask ||= (async () => {
    RSA._serverKeys.clear();
    const fingerprint = (await RSA.addServerKey(OWPENGRAM_SERVER.publicKeyPem)).toString();
    if (fingerprint !== PINNED_FINGERPRINT) throw new OwpenError('OWPENGRAM_RSA_PIN_MISMATCH', 503);
    const key = RSA._serverKeys.get(fingerprint);
    pinnedModulus = key.n.toString();
    Object.freeze(key);
    // Adding a server-supplied CDN key must never widen the trust set.
    Object.defineProperties(RSA._serverKeys, {
      set: { value(id, value) {
        if (String(id) !== fingerprint || value.e !== 65537 || value.n.toString() !== pinnedModulus) {
          throw new OwpenError('OWPENGRAM_FOREIGN_RSA_KEY', 503);
        }
        return this;
      } },
      delete: { value() { throw new OwpenError('OWPENGRAM_RSA_PIN_LOCKED', 503); } },
      clear: { value() { throw new OwpenError('OWPENGRAM_RSA_PIN_LOCKED', 503); } },
    });
    Object.freeze(RSA._serverKeys);
  })();
  await pinnedKeyTask;
  assertOwpenRsaKey();
}

export function assertOwpenRsaKey() {
  const key = RSA._serverKeys.get(PINNED_FINGERPRINT);
  if (RSA._serverKeys.size !== 1 || !key || key.e !== 65537 || key.n.toString() !== pinnedModulus) {
    throw new OwpenError('OWPENGRAM_RSA_PIN_MISMATCH', 503);
  }
}

function checkedDcId(dcId) {
  if (!OWPENGRAM_SERVER.dcIds.includes(dcId)) throw new OwpenError('OWPENGRAM_DC_INVALID', 502);
  return dcId;
}

function address(dcId) {
  return { id: checkedDcId(dcId), ipAddress: OWPENGRAM_SERVER.host, port: OWPENGRAM_SERVER.port };
}

export class PinnedDcAddressBook {
  get hasConfig() { return true; }
  get options() { return OWPENGRAM_SERVER.dcIds.map(address); }
  setOptions() { /* Server config cannot replace the compiled endpoint pin. */ }
  seed(id) { return address(id); }
  lookup(id) { return address(id); }
  resolve(id) { return address(id); }
  next(id) { return address(id); }
  isCdn(id) { checkedDcId(id); return false; }
  cdn() { throw new OwpenError('OWPENGRAM_CDN_DISABLED'); }
  fail(id) { checkedDcId(id); return 0; }
  failureCount(id) { checkedDcId(id); return 0; }
}

function assertEndpoint(ip, port) {
  if (ip !== OWPENGRAM_SERVER.host || port !== OWPENGRAM_SERVER.port) {
    throw new OwpenError('OWPENGRAM_ENDPOINT_PIN_MISMATCH', 503);
  }
}

export class PinnedOwpenSocket extends WebSocketSocket {
  create(url, protocols) {
    if (url !== OWPENGRAM_SERVER.webSocketUrl || protocols !== 'binary') {
      throw new OwpenError('OWPENGRAM_ENDPOINT_PIN_MISMATCH', 503);
    }
    assertOwpenRsaKey();
    const socket = super.create(url, protocols);
    socket.addEventListener?.('error', event => {
      this.nativeFailure = safeOwpenError(event, 'OWPENGRAM_WEBSOCKET_FAILED');
    });
    return socket;
  }
  async connect(port, ip, testServers = false) {
    assertEndpoint(ip, port);
    if (testServers) throw new OwpenError('OWPENGRAM_TEST_SERVER_DISABLED', 503);
    assertOwpenRsaKey();
    this.nativeFailure = undefined;
    try { return await super.connect(port, ip, false); }
    catch (error) { throw this.nativeFailure || safeOwpenError(error, 'OWPENGRAM_WEBSOCKET_FAILED'); }
  }
}

class PinnedTelegramClient extends TelegramClient {
  constructor(session, config) {
    super(session, config.apiId, config.apiHash, {
      transport: { resolve: () => ({ connection: ConnectionTCPObfuscated, socket: PinnedOwpenSocket, webSocket: true }) },
      baseLogger: new Logger('none'),
      securityChecks: true,
      connectionRetries: 2, reconnectRetries: 2, requestRetries: 2, downloadRetries: 2,
      timeout: 10, retryDelay: 500, floodSleepThreshold: 0, autoReconnect: false,
      catchUp: false, useIPV6: false, testServers: false,
      deviceModel: 'Bear Like', systemVersion: 'React Native', appVersion: '2.0.0',
      langCode: 'fr', systemLangCode: 'fr',
      downloadPool: { cdnSupported: false, sessions: 1, inflightPerDc: 2 },
    });
    this._addresses = new PinnedDcAddressBook();
    // A redirect received despite cdnSupported=false is a protocol error.
    this._files.cdnReachable = async () => { throw new OwpenError('OWPENGRAM_CDN_DISABLED'); };
  }
  async getDC(dcId) { return address(dcId); }
  _ensureCdnKeys() { throw new OwpenError('OWPENGRAM_CDN_DISABLED'); }
  _createConnection(target, dcId = target.id) {
    checkedDcId(dcId);
    assertEndpoint(target.ipAddress, target.port);
    assertOwpenRsaKey();
    return super._createConnection(target, dcId);
  }
}

/** Build without connecting, also useful for an offline endpoint/session audit. */
export async function buildPinnedClient({ session = '', config: settings = {} } = {}) {
  const config = readOwpenConfig(settings);
  if (typeof globalThis.crypto?.getRandomValues !== 'function') throw new OwpenError('OWPENGRAM_NATIVE_RANDOM_REQUIRED', 503);
  if (typeof session !== 'string' || session.length > 2048) throw new OwpenError('OWPENGRAM_SESSION_INVALID', 401);
  let parsed;
  try {
    parsed = new StringSession(session);
    await parsed.load();
  } catch {
    throw new OwpenError('OWPENGRAM_SESSION_INVALID', 401);
  }
  if (session) {
    assertEndpoint(parsed.serverAddress, parsed.port);
    checkedDcId(parsed.dcId);
    if (parsed.authKey?.getKey()?.length !== 256) throw new OwpenError('OWPENGRAM_SESSION_INVALID', 401);
  } else {
    parsed.setDC(checkedDcId(config.dcId || OWPENGRAM_SERVER.mainDcId), OWPENGRAM_SERVER.host, OWPENGRAM_SERVER.port);
  }
  await installOwpenRsaKey();
  return new PinnedTelegramClient(parsed, config);
}

export async function createOwpenClient(options = {}) {
  const config = readOwpenConfig(options.config);
  const client = await buildPinnedClient({ ...options, config });
  try {
    await connectOwpenTransport(client);
    return new OwpenClient(client, config);
  } catch (error) {
    await client.destroy().catch(() => {});
    throw safeOwpenError(error, 'OWPENGRAM_CONNECTION_FAILED');
  }
}

/** Bound the whole handshake + initial RPC, not just the WebSocket opening. */
export async function connectOwpenTransport(client, timeoutMs = 45000) {
  let timer, timedOut = false;
  try {
    await Promise.race([
      client.connect(),
      new Promise((_, reject) => {
        timer = setTimeout(() => { timedOut = true; reject(new OwpenError('OWPENGRAM_CONNECTION_TIMEOUT')); }, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    if (timedOut) await client.disconnect().catch(() => {});
  }
}

function positiveId(value) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1 || id > 2147483647) throw new OwpenError('MESSAGE_ID_INVALID', 400);
  return id;
}

function limit(value, maximum = 100) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(1, Math.min(maximum, Math.floor(number))) : maximum;
}

function long(value) {
  if (!/^-?\d+$/.test(String(value))) throw new OwpenError('OWPENGRAM_ID_INVALID', 400);
  const parsed = BigInt(String(value));
  if (BigInt.asIntN(64, parsed) !== parsed) throw new OwpenError('OWPENGRAM_ID_INVALID', 400);
  return bigInt(parsed.toString());
}

export function owpenRandomId(key) {
  if (key !== undefined && key !== null && key !== '') {
    const value = String(key);
    if (/^-?\d+$/.test(value)) return long(value);
    return bigInt(createHash('sha256').update(value).digest().readBigInt64LE(0).toString());
  }
  return bigInt(randomBytes(8).readBigInt64LE(0).toString());
}

function inputReplyTo(value) {
  return value == null ? undefined : new Api.InputReplyToMessage({ replyToMsgId: positiveId(value) });
}

function toPeerRef(peer) {
  if (peer instanceof Api.InputPeerSelf) return 'self';
  if (peer instanceof Api.InputPeerUser) return { type: 'user', id: peer.userId.toString(), accessHash: peer.accessHash.toString() };
  if (peer instanceof Api.InputPeerChannel) return { type: 'channel', id: peer.channelId.toString(), accessHash: peer.accessHash.toString() };
  if (peer instanceof Api.InputPeerChat) return { type: 'chat', id: peer.chatId.toString() };
  throw new OwpenError('PEER_ID_INVALID', 400);
}

function peerKey(peer) {
  if (peer?.userId !== undefined) return 'user:' + peer.userId;
  if (peer?.channelId !== undefined) return 'channel:' + peer.channelId;
  if (peer?.chatId !== undefined) return 'chat:' + peer.chatId;
  return '';
}

async function safeCall(callback) {
  try { return await callback(); } catch (error) { throw safeOwpenError(error); }
}

export class OwpenClient {
  constructor(client, config) {
    this.client = client;
    this.config = readOwpenConfig(config);
  }

  invoke(request) { return safeCall(() => this.client.invoke(request, undefined, { timeout: 30000 })); }
  serializeSession() { return this.client.session.save(); }
  isConnected() { return !this.closed && Boolean(this.client.connected); }
  reconnect() {
    if (this.closed) return Promise.reject(new OwpenError('OWPENGRAM_CLIENT_CLOSED', 409));
    if (this.isConnected()) return Promise.resolve(this);
    if (!this.reconnectTask) {
      const task = safeCall(async () => {
        // Reuse this client and its authorization key, including before an OTP
        // challenge is complete. No new sendCode or account action occurs here.
        await connectOwpenTransport(this.client);
        if (this.closed) throw new OwpenError('OWPENGRAM_CLIENT_CLOSED', 409);
        return this;
      });
      this.reconnectTask = task;
      task.finally(() => { if (this.reconnectTask === task) this.reconnectTask = null; }).catch(() => {});
    }
    return this.reconnectTask;
  }
  async disconnect() { this.closed = true; await this.client.destroy(); }
  async logout() {
    try { await this.invoke(new Api.auth.LogOut()); }
    finally { this.client.session.delete(); await this.disconnect(); }
  }
  async isAuthorized() {
    try { await this.invoke(new Api.updates.GetState()); return true; }
    catch (error) {
      if (/AUTH_KEY_UNREGISTERED|SESSION_REVOKED|SESSION_EXPIRED/.test(error.code)) return false;
      throw error;
    }
  }
  async getMe() {
    const user = await safeCall(() => this.client.getMe());
    this.me = user;
    return user;
  }

  async authStart(identifier) {
    const { phoneNumber } = encodeOwpenIdentifier(identifier);
    // Lors de la connexion Loligram, auth.sendCode est la première requête
    // propre au défi. Un help.getAppConfig préalable peut échouer avant que
    // le compte soit authentifié et n'est pas nécessaire pour envoyer un code.
    const result = await this.invoke(new Api.auth.SendCode({
      phoneNumber, apiId: this.config.apiId, apiHash: this.config.apiHash, settings: new Api.CodeSettings({}),
    }));
    if (result instanceof Api.auth.SentCodeSuccess) return this._authResult(result.authorization);
    if (!(result instanceof Api.auth.SentCode) || !result.phoneCodeHash) throw new OwpenError('OWPENGRAM_LOGIN_FLOW_UNSUPPORTED', 501);
    if (result.type instanceof Api.auth.SentCodeTypeSetUpEmailRequired) throw new OwpenError('OWPENGRAM_EMAIL_SETUP_REQUIRED', 501);
    return {
      state: 'code', phoneNumber, phoneCodeHash: result.phoneCodeHash,
      codeKind: result.type instanceof Api.auth.SentCodeTypeEmailCode ? 'email' : 'phone',
      delivery: result.type?.className, timeout: result.timeout || 0,
      nextType: result.nextType?.className, codeLength: result.type?.length,
    };
  }

  _authResult(result) {
    if (result instanceof Api.auth.AuthorizationSignUpRequired) return { state: 'signup' };
    if (result?.user) { this.me = result.user; return { state: 'authorized', user: result.user }; }
    throw new OwpenError('OWPENGRAM_LOGIN_RESPONSE_INVALID');
  }

  async authCode({ phoneNumber, phoneCodeHash, code, codeKind = 'phone' }) {
    if (!phoneNumber || !phoneCodeHash || typeof code !== 'string' || !code.trim()) throw new OwpenError('PHONE_CODE_INVALID', 400);
    try {
      const result = await this.invoke(new Api.auth.SignIn({
        phoneNumber, phoneCodeHash,
        ...(codeKind === 'email'
          ? { emailVerification: new Api.EmailVerificationCode({ code: code.trim() }) }
          : { phoneCode: code.trim() }),
      }));
      return this._authResult(result);
    } catch (error) {
      if (error.code === 'SESSION_PASSWORD_NEEDED') return { state: 'password' };
      if (error.code === 'PHONE_NUMBER_UNOCCUPIED') return { state: 'signup' };
      throw error;
    }
  }

  async authSignup({ phoneNumber, phoneCodeHash, firstName, lastName = '' }) {
    if (!phoneNumber || !phoneCodeHash || typeof firstName !== 'string' || !firstName.trim()) throw new OwpenError('FIRSTNAME_INVALID', 400);
    return this._authResult(await this.invoke(new Api.auth.SignUp({
      phoneNumber, phoneCodeHash, firstName: firstName.trim().slice(0, 64), lastName: String(lastName).trim().slice(0, 64),
    })));
  }

  async authPassword(password) {
    if (typeof password !== 'string' || !password) throw new OwpenError('PASSWORD_HASH_INVALID', 400);
    const parameters = await this.invoke(new Api.account.GetPassword());
    const proof = await safeCall(() => computeCheck(parameters, password));
    return this._authResult(await this.invoke(new Api.auth.CheckPassword({ password: proof })));
  }

  async resolvePeer(peer) {
    if (peer === 'self' || peer === 'me') return new Api.InputPeerSelf();
    if (peer instanceof Api.InputPeerUser || peer instanceof Api.InputPeerChat || peer instanceof Api.InputPeerChannel || peer instanceof Api.InputPeerSelf) return peer;
    if (typeof peer === 'string' && /^@?[a-z][a-z0-9_]{2,31}$/i.test(peer)) {
      return safeCall(() => this.client.getInputEntity(peer));
    }
    const match = typeof peer === 'string' && /^(user|owp|chat|channel):(\d+)$/.exec(peer);
    const descriptor = match ? { type: match[1] === 'owp' ? 'user' : match[1], id: match[2] } : peer;
    if (!descriptor || typeof descriptor !== 'object' || !/^[1-9]\d*$/.test(String(descriptor.id))) throw new OwpenError('PEER_ID_INVALID', 400);
    const id = long(descriptor.id);
    if (descriptor.type === 'chat') return new Api.InputPeerChat({ chatId: id });
    if (descriptor.type !== 'user' && descriptor.type !== 'channel') throw new OwpenError('PEER_ID_INVALID', 400);
    if (descriptor.accessHash != null) {
      const hash = long(descriptor.accessHash);
      return descriptor.type === 'user' ? new Api.InputPeerUser({ userId: id, accessHash: hash }) : new Api.InputPeerChannel({ channelId: id, accessHash: hash });
    }
    const barePeer = descriptor.type === 'user' ? new Api.PeerUser({ userId: id }) : new Api.PeerChannel({ channelId: id });
    try { return await this.client.getInputEntity(barePeer); } catch { /* StringSession intentionally has no entity cache. */ }
    await this.getDialogs();
    try { return await this.client.getInputEntity(barePeer); }
    catch { throw new OwpenError('OWPENGRAM_PEER_ACCESS_REQUIRED', 409); }
  }

  async getEntity(peer) { return safeCall(async () => this.client.getEntity(await this.resolvePeer(peer))); }
  async searchUsers(query, { limit: resultLimit = 30 } = {}) {
    const q = String(query || '').trim();
    if (q.length < 2 || q.length > 64) throw new OwpenError('QUERY_INVALID', 400);
    const result = await this.invoke(new Api.contacts.Search({ q, limit: limit(resultLimit) }));
    return result.users || [];
  }

  async getDialogs({ limit: pageLimit = 100, offsetDate = 0, offsetId = 0, offsetPeer = 'empty' } = {}) {
    return this.invoke(new Api.messages.GetDialogs({
      limit: limit(pageLimit), offsetDate, offsetId,
      offsetPeer: offsetPeer === 'empty' ? new Api.InputPeerEmpty() : await this.resolvePeer(offsetPeer), hash: bigInt.zero,
    }));
  }

  async getMessages(peer, { limit: pageLimit = 50, before = 0, ids } = {}) {
    const input = await this.resolvePeer(peer);
    if (ids) {
      if (!Array.isArray(ids) || !ids.length || ids.length > 100) throw new OwpenError('MESSAGE_ID_INVALID', 400);
      const id = ids.map((value) => new Api.InputMessageID({ id: positiveId(value) }));
      const result = await this.invoke(input instanceof Api.InputPeerChannel
        ? new Api.channels.GetMessages({ channel: input, id }) : new Api.messages.GetMessages({ id }));
      const expected = input instanceof Api.InputPeerSelf ? 'user:' + (this.me || await this.getMe()).id : peerKey(input);
      // Ordinary message IDs are account-wide: a caller cannot relabel another chat.
      return { ...result, messages: (result.messages || []).filter((message) => peerKey(message.peerId) === expected) };
    }
    return this.invoke(new Api.messages.GetHistory({ peer: input, limit: limit(pageLimit), offsetId: before ? positiveId(before) : 0,
      offsetDate: 0, addOffset: 0, maxId: 0, minId: 0, hash: bigInt.zero }));
  }

  async _sentMessage(request, result, peer) {
    let message = this.client._getResponseMessage(request, result, peer);
    if (Array.isArray(message)) message = message[0];
    if (message) return message;
    const messageId = result instanceof Api.UpdateShortSentMessage ? result.id
      : result.updates?.find((update) => update instanceof Api.UpdateMessageID && update.randomId.toString() === request.randomId?.toString())?.id;
    if (messageId) {
      const fetched = await this.getMessages(peer, { ids: [messageId] });
      if (fetched.messages[0]) return fetched.messages[0];
    }
    throw new OwpenError('OWPENGRAM_MESSAGE_ACK_MISSING');
  }

  async sendMessage({ peer, text, randomId, replyTo }) {
    if (typeof text !== 'string' || !text.trim() || text.length > 4096) throw new OwpenError('MESSAGE_EMPTY_OR_TOO_LONG', 400);
    const input = await this.resolvePeer(peer);
    const request = new Api.messages.SendMessage({ peer: input, message: text, randomId: owpenRandomId(randomId), replyTo: inputReplyTo(replyTo) });
    return this._sentMessage(request, await this.invoke(request), input);
  }

  /** Raw bounded upload for photos.UploadProfilePhoto and other native RPCs. */
  async uploadFile(file, { onProgress } = {}) {
    if (!Buffer.isBuffer(file?.buffer) || file.buffer.length === 0 || file.buffer.length > this.config.maxFileBytes) {
      throw new OwpenError('OWPENGRAM_FILE_SIZE_INVALID', 413);
    }
    const name = String(file.name || 'file.bin').replace(/[\x00-\x1f/\\]/g, '_').slice(0, 200);
    return safeCall(() => this.client.uploadFile({
      file: new CustomFile(name, file.buffer.length, '', file.buffer), workers: 1,
      onProgress: typeof onProgress === 'function' ? onProgress : undefined,
    }));
  }

  async uploadInputMedia(file, { kind: requestedKind, onProgress } = {}) {
    if (!Buffer.isBuffer(file?.buffer) || file.buffer.length === 0 || file.buffer.length > (this.config.maxFileBytes || 20 * 1024 ** 2)) {
      throw new OwpenError('OWPENGRAM_FILE_SIZE_INVALID', 413);
    }
    const name = String(file.name || 'file.bin').replace(/[\x00-\x1f/\\]/g, '_').slice(0, 200);
    const mime = String(file.mime || 'application/octet-stream').toLowerCase();
    if (!/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(mime)) throw new OwpenError('OWPENGRAM_MIME_INVALID', 400);
    const kind = requestedKind || file.kind || (mime.startsWith('image/') ? 'photo' : mime.startsWith('video/') ? 'video' : 'document');
    if (!['photo', 'video', 'voice', 'document'].includes(kind)) throw new OwpenError('OWPENGRAM_MEDIA_KIND_INVALID', 400);
    const attributes = [new Api.DocumentAttributeFilename({ fileName: name })];
    const duration = Number(file.duration);
    if (kind === 'voice' || kind === 'video') {
      if (!Number.isFinite(duration) || duration <= 0 || duration > 86400) throw new OwpenError('OWPENGRAM_MEDIA_DURATION_REQUIRED', 400);
      if (kind === 'voice') {
        if (!mime.startsWith('audio/')) throw new OwpenError('OWPENGRAM_VOICE_MIME_INVALID', 400);
        attributes.push(new Api.DocumentAttributeAudio({ voice: true, duration: Math.max(1, Math.ceil(duration)) }));
      } else {
        const w = Number(file.width), h = Number(file.height);
        if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1 || w > 16384 || h > 16384 || !mime.startsWith('video/')) throw new OwpenError('OWPENGRAM_VIDEO_METADATA_REQUIRED', 400);
        attributes.push(new Api.DocumentAttributeVideo({ duration, w, h, supportsStreaming: mime === 'video/mp4' }));
      }
    }
    if (kind === 'photo' && !mime.startsWith('image/')) throw new OwpenError('OWPENGRAM_PHOTO_MIME_INVALID', 400);
    let thumb;
    if (file.thumbnail !== undefined) {
      const preview = file.thumbnail;
      if (kind === 'photo' || preview?.mime !== 'image/jpeg' || !Buffer.isBuffer(preview?.buffer)
        || preview.buffer.length < 4 || preview.buffer.length > 128 * 1024
        || preview.buffer[0] !== 0xff || preview.buffer[1] !== 0xd8 || preview.buffer[2] !== 0xff) {
        throw new OwpenError('OWPENGRAM_THUMBNAIL_INVALID', 400);
      }
      thumb = await this.uploadFile({ ...preview, name: preview.name || 'thumbnail.jpg' });
    }
    // Payload bytes go directly to upload.saveFilePart: no application AES wrapper.
    const uploaded = await this.uploadFile(file, { onProgress });
    return kind === 'photo' ? new Api.InputMediaUploadedPhoto({ file: uploaded })
      : new Api.InputMediaUploadedDocument({ file: uploaded, thumb, mimeType: mime, attributes, forceFile: kind === 'document' });
  }

  async sendMedia({ peer, file, caption = '', randomId, replyTo, onProgress }) {
    if (String(caption).length > 1024) throw new OwpenError('MEDIA_CAPTION_TOO_LONG', 400);
    const input = await this.resolvePeer(peer);
    const media = await this.uploadInputMedia(file, { onProgress });
    const request = new Api.messages.SendMedia({ peer: input, media, message: String(caption), randomId: owpenRandomId(randomId), replyTo: inputReplyTo(replyTo) });
    return this._sentMessage(request, await this.invoke(request), input);
  }

  async editMessage({ peer, id, text }) {
    if (typeof text !== 'string' || !text.trim() || text.length > 4096) throw new OwpenError('MESSAGE_EMPTY_OR_TOO_LONG', 400);
    const input = await this.resolvePeer(peer);
    await this.invoke(new Api.messages.EditMessage({ peer: input, id: positiveId(id), message: text }));
    return (await this.getMessages(input, { ids: [id] })).messages[0];
  }

  async deleteMessages({ peer, ids, revoke = true }) {
    const input = await this.resolvePeer(peer);
    const messages = await this.getMessages(input, { ids });
    const id = messages.messages.map((message) => message.id);
    if (!id.length) return { deleted: 0 };
    if (input instanceof Api.InputPeerChannel) {
      if (!revoke) throw new OwpenError('OWPENGRAM_CHANNEL_DELETE_FOR_SELF_UNSUPPORTED', 501);
      return this.invoke(new Api.channels.DeleteMessages({ channel: input, id }));
    }
    return this.invoke(new Api.messages.DeleteMessages({ id, revoke: !!revoke }));
  }

  async forwardMessages({ fromPeer, peer, ids, randomIds }) {
    const source = await this.resolvePeer(fromPeer), target = await this.resolvePeer(peer);
    if (!Array.isArray(ids) || !ids.length || ids.length > 100 || (randomIds && randomIds.length !== ids.length)) throw new OwpenError('MESSAGE_ID_INVALID', 400);
    const request = new Api.messages.ForwardMessages({ fromPeer: source, toPeer: target, id: ids.map(positiveId), randomId: ids.map((_, i) => owpenRandomId(randomIds?.[i])) });
    const result = await this.invoke(request);
    const messages = this.client._getResponseMessage(request, result, target);
    return Array.isArray(messages) ? messages.filter(Boolean) : messages ? [messages] : [];
  }

  async sendReaction({ peer, id, emoji }) {
    if (emoji != null && (typeof emoji !== 'string' || emoji.length > 32)) throw new OwpenError('REACTION_INVALID', 400);
    return this.invoke(new Api.messages.SendReaction({ peer: await this.resolvePeer(peer), msgId: positiveId(id), reaction: emoji ? [new Api.ReactionEmoji({ emoticon: emoji })] : [] }));
  }
  async markRead({ peer, maxId }) {
    const input = await this.resolvePeer(peer);
    const params = { maxId: maxId ? positiveId(maxId) : 0 };
    return this.invoke(input instanceof Api.InputPeerChannel ? new Api.channels.ReadHistory({ channel: input, ...params }) : new Api.messages.ReadHistory({ peer: input, ...params }));
  }
  async setHistoryTTL({ peer, seconds }) {
    const period = Number(seconds);
    if (!Number.isSafeInteger(period) || period < 0 || period > 365 * 86400) throw new OwpenError('TTL_PERIOD_INVALID', 400);
    return this.invoke(new Api.messages.SetHistoryTTL({ peer: await this.resolvePeer(peer), period }));
  }
  async getHistoryTTL(peer) {
    const input = await this.resolvePeer(peer);
    const result = input instanceof Api.InputPeerChannel ? await this.invoke(new Api.channels.GetFullChannel({ channel: input }))
      : input instanceof Api.InputPeerChat ? await this.invoke(new Api.messages.GetFullChat({ chatId: input.chatId }))
        : await this.invoke(new Api.users.GetFullUser({ id: input }));
    return Number((result.fullChat || result.fullUser)?.ttlPeriod || 0);
  }
  async clearHistory(peer) {
    const input = await this.resolvePeer(peer);
    if (input instanceof Api.InputPeerChannel) throw new OwpenError('OWPENGRAM_CHANNEL_CLEAR_FOR_SELF_UNSUPPORTED', 501);
    let result;
    for (let page = 0; page < 100; page++) {
      result = await this.invoke(new Api.messages.DeleteHistory({ peer: input, maxId: 0, justClear: true, revoke: false }));
      if (!result.offset) return result;
    }
    throw new OwpenError('OWPENGRAM_CLEAR_HISTORY_INCOMPLETE');
  }

  /** Download a current TL photo/document (e.g. StoryItem.media) directly. */
  async downloadTLMedia(value, { thumb = false } = {}) {
    const media = value?.media || value;
    const document = media?.document || media?.photo || media;
    if (!(document instanceof Api.Document || document instanceof Api.Photo)) {
      throw new OwpenError('OWPENGRAM_MEDIA_NOT_FOUND', 404);
    }
    const maxBytes = this.config.maxFileBytes;
    const thumbnailRequested = thumb !== false && thumb !== null && thumb !== undefined;
    const sizeOf = (size) => Math.max(0, ...(size?.sizes || [size?.size || size?.bytes?.length || 0]));
    let selected;
    if (thumbnailRequested || document instanceof Api.Photo) {
      const candidates = (document instanceof Api.Document ? document.thumbs || [] : document.sizes || [])
        .filter((size) => size instanceof Api.PhotoSize || size instanceof Api.PhotoSizeProgressive
          || size instanceof Api.PhotoCachedSize || size instanceof Api.PhotoStrippedSize)
        .slice().sort((a, b) => sizeOf(a) - sizeOf(b));
      if (typeof thumb === 'number') selected = candidates[thumb < 0 ? candidates.length + thumb : thumb];
      else if (typeof thumb === 'string') selected = candidates.find((size) => size.type === thumb);
      else if (thumbnailRequested) {
        // A useful grid image, preferring a still image at least 320 px wide.
        selected = candidates.find((size) => Math.max(size.w || 0, size.h || 0) >= 320) || candidates[candidates.length - 1];
      } else selected = candidates[candidates.length - 1];
      if (!selected) throw new OwpenError(thumbnailRequested ? 'OWPENGRAM_THUMBNAIL_UNAVAILABLE' : 'OWPENGRAM_MEDIA_NOT_FOUND', 404);
      // teleproto's getThumb does not accept a PhotoSizeProgressive object, but
      // its explicit PhotoSize equivalent addresses the same stored rendition.
      if (selected instanceof Api.PhotoSizeProgressive) {
        selected = new Api.PhotoSize({ type: selected.type, w: selected.w, h: selected.h, size: sizeOf(selected) });
      }
    }
    const announcedSize = selected ? sizeOf(selected) : Number(document.size || 0);
    if (announcedSize > maxBytes) throw new OwpenError('OWPENGRAM_FILE_SIZE_INVALID', 413);
    // Passing a validated object prevents upstream from falling back to the
    // complete video when a requested thumbnail is absent.
    const output = await safeCall(() => this.client.downloadMedia(media, { requestTimeout: 30000, ...(selected ? { thumb: selected } : {}) }));
    if (!Buffer.isBuffer(output)) throw new OwpenError('OWPENGRAM_MEDIA_DOWNLOAD_FAILED');
    if (output.length > maxBytes) throw new OwpenError('OWPENGRAM_FILE_SIZE_INVALID', 413);
    return output;
  }

  async downloadMedia(reference, options = {}) {
    const ref = typeof reference === 'string' ? decodeMediaReference(reference) : reference;
    if (!ref?.peer || !ref.messageId) throw new OwpenError('OWPENGRAM_MEDIA_REFERENCE_INVALID', 400);
    for (let attempt = 0; attempt < 2; attempt++) {
      const message = (await this.getMessages(ref.peer, { ids: [positiveId(ref.messageId)] })).messages[0];
      if (!message || !(message.media instanceof Api.MessageMediaPhoto || message.media instanceof Api.MessageMediaDocument)) throw new OwpenError('OWPENGRAM_MEDIA_NOT_FOUND', 404);
      const document = message.media.document || message.media.photo;
      if (ref.id && document?.id?.toString() !== String(ref.id)) throw new OwpenError('OWPENGRAM_MEDIA_REFERENCE_CHANGED', 404);
      try {
        return await this.downloadTLMedia(message.media, options);
      } catch (error) {
        if (attempt === 0 && String(error?.errorMessage || error?.code || '').startsWith('FILE_REFERENCE_')) continue;
        throw safeOwpenError(error);
      }
    }
  }

  async mediaReference(message, peer, file = {}) {
    const input = await this.resolvePeer(peer);
    const document = message.media?.document || message.media?.photo;
    if (!document || !message.id) throw new OwpenError('OWPENGRAM_MEDIA_REFERENCE_INVALID');
    const ref = { v: 1, peer: toPeerRef(input), messageId: message.id, id: document.id?.toString(),
      accessHash: document.accessHash?.toString(), fileReference: document.fileReference?.toString('base64'),
      dcId: document.dcId, mime: file.mime || document.mimeType || 'image/jpeg',
      size: file.buffer?.length || (document.size ? Number(document.size) : 0) };
    return 'owpg1:' + Buffer.from(JSON.stringify(ref)).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  }
}

export function decodeMediaReference(value) {
  if (typeof value !== 'string' || !value.startsWith('owpg1:') || value.length > 8192) throw new OwpenError('OWPENGRAM_MEDIA_REFERENCE_INVALID', 400);
  try {
    const ref = JSON.parse(Buffer.from(value.slice(6).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    if (ref.v !== 1 || !ref.peer || !ref.messageId) throw new Error();
    positiveId(ref.messageId);
    return ref;
  } catch { throw new OwpenError('OWPENGRAM_MEDIA_REFERENCE_INVALID', 400); }
}

