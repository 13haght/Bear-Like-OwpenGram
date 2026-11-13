'use strict';

// The route-shaped names are an in-process compatibility interface for the UI.
// They are never HTTP URLs: every operation invokes the signed-in native client.
const { authClient } = require('./owpengram-auth');
const { Api, owpenRandomId } = require('../transport/owpengram.bundle.cjs');
const { createSocialApi } = require('./owpengram-social');
const media = require('./owpengram-media');
const { fail, publicError } = require('./owpengram-errors');

function canonicalPeer(value) {
  const text = String(value || '');
  if (/^owp:[1-9]\d{0,19}$/.test(text)) return 'user:' + text.slice(4);
  if (/^(user|chat|channel):[1-9]\d{0,19}$/.test(text)) return text;
  throw fail('INVALID_PEER', 'Conversation OwpenGram invalide.', 400);
}
function peerOf(value) {
  if (value?.userId != null) return 'user:' + String(value.userId);
  if (value?.channelId != null) return 'channel:' + String(value.channelId);
  if (value?.chatId != null) return 'chat:' + String(value.chatId);
  return null;
}
function entityPeer(entity) {
  const name = String(entity?.className || entity?._ || '');
  return (name.includes('Channel') ? 'channel:' : name.includes('Chat') ? 'chat:' : 'user:') + String(entity?.id || '');
}
function descriptor(entity) {
  const key = entityPeer(entity), [type, id] = key.split(':');
  return { type, id, ...(!entity?.min && entity?.accessHash != null ? { accessHash: String(entity.accessHash) } : {}) };
}
function messageId(value) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1 || id > 2147483647) throw fail('INVALID_MESSAGE_ID', 'Message invalide.', 400);
  return id;
}
function epoch(value) {
  if (value instanceof Date) return value.getTime();
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number < 1e12 ? number * 1000 : number : null;
}
function iso(value) { const ms = epoch(value); return ms ? new Date(ms).toISOString() : null; }
function displayName(entity) {
  return [entity?.firstName, entity?.lastName].filter(Boolean).join(' ').trim() || entity?.title || entity?.username || 'Utilisateur OwpenGram';
}
function mimeOf(message) { return message?.media?.photo ? 'image/jpeg' : String(message?.media?.document?.mimeType || ''); }
function normalizeMessage(message, selfId, peer, toMediaUri) {
  const mime = mimeOf(message), date = epoch(message.date), document = message.media?.document || message.media?.photo;
  const sender = peerOf(message.fromId) || (!message.out ? peerOf(message.peerId) : null);
  const reactions = {};
  for (const item of message.reactions?.recentReactions || []) {
    const reactor = peerOf(item.peerId);
    if (reactor && item.reaction?.emoticon) reactions[reactor.startsWith('user:') ? 'owp:' + reactor.slice(5) : reactor] = item.reaction.emoticon;
  }
  const reactionCounts = [];
  for (const item of message.reactions?.results || []) {
    if (!item.reaction?.emoticon || !Number.isSafeInteger(Number(item.count))) continue;
    reactionCounts.push({ emoji: item.reaction.emoticon, count: Number(item.count) });
    if (item.chosenOrder != null) reactions[selfId] = item.reaction.emoticon;
  }
  const attributes = document?.attributes || [];
  const dimensions = attributes.find(item => item.w && item.h);
  const audio = attributes.find(item => item.className === 'DocumentAttributeAudio');
  const duration = attributes.find(item => Number(item.duration) > 0)?.duration || null;
  const ref = document ? { kind: 'message', peer, messageId: messageId(message.id), id: String(document.id), mime, variant: 'full' } : null;
  return {
    id: String(message.id), sender_id: message.out ? selfId : sender?.startsWith('user:') ? 'owp:' + sender.slice(5) : sender || '',
    type: mime ? 'media' : 'text', content: String(message.message || ''), mime_type: mime || null,
    created_at: iso(message.date), read_at: null, reply_to: message.replyTo?.replyToMsgId ? String(message.replyTo.replyToMsgId) : null,
    edited_at: iso(message.editDate), reactions, reactionCounts,
    duration: duration == null ? null : Number(duration), durationSeconds: duration == null ? null : Number(duration),
    isVoice: !!audio?.voice, width: dimensions?.w || null, height: dimensions?.h || null,
    uri: ref ? toMediaUri(ref) : null,
    thumbnailUri: ref && !mime.startsWith('audio/') ? toMediaUri({ ...ref, variant: 'thumb' }) : null,
    expires_at: date && Number(message.ttlPeriod) > 0 ? new Date(date + Number(message.ttlPeriod) * 1000).toISOString() : null,
  };
}
function parseRequest(path, options = {}) {
  if (typeof path !== 'string' || !path.startsWith('/api/') || /[\\#\r\n]/.test(path)) throw fail('INVALID_REQUEST', 'Opération invalide.', 400);
  const at = path.indexOf('?'), pathname = at < 0 ? path : path.slice(0, at), query = {};
  let parts, body = options.body || {};
  try {
    parts = pathname.split('/').filter(Boolean).map(decodeURIComponent);
    for (const pair of (at < 0 ? '' : path.slice(at + 1)).split('&').filter(Boolean)) {
      const eq = pair.indexOf('=');
      query[decodeURIComponent(eq < 0 ? pair : pair.slice(0, eq))] = decodeURIComponent(eq < 0 ? '' : pair.slice(eq + 1));
    }
    if (typeof body === 'string') body = JSON.parse(body);
  } catch (_) { throw fail('INVALID_REQUEST', 'Données de requête invalides.', 400); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw fail('INVALID_REQUEST', 'Données de requête invalides.', 400);
  return { parts, query, body, method: String(options.method || (options.body == null ? 'GET' : 'POST')).toUpperCase() };
}

function createApi({ auth = authClient, mediaStore = media, prepareUpload = media.prepareUpload, socialFactory = createSocialApi, now = Date.now } = {}) {
  const socialClients = new WeakMap();
  const social = socialFactory({ getClient: async () => {
    const ctx = context(), native = await auth.getClient();
    assertCurrent(ctx);
    let cached = socialClients.get(native);
    if (!cached || cached.ctx !== ctx) {
      const guarded = {};
      // A multi-step story operation must stop before its next RPC if the
      // account changed during upload, even when the old client still exists.
      for (const name of ['invoke', 'getMe', 'resolvePeer', 'getEntity', 'uploadInputMedia']) {
        guarded[name] = async (...args) => {
          assertCurrent(ctx);
          const result = await native[name](...args);
          assertCurrent(ctx);
          return result;
        };
      }
      cached = { ctx, guarded }; socialClients.set(native, cached);
    }
    return cached.guarded;
  }, mediaUri: mediaStore.mediaUri });
  let state = { account: null, generation: -1, entities: new Map(), dialogs: null, dialogsAt: 0, dialogsTask: null };
  function context() {
    const account = auth.getAccountId(), generation = auth.getGeneration();
    if (!account) throw fail('SESSION_REQUIRED', 'Connecte-toi à OwpenGram.', 401);
    if (state.account !== account || state.generation !== generation) {
      social.clear?.();
      state = { account, generation, entities: new Map(), dialogs: null, dialogsAt: 0, dialogsTask: null };
    }
    return state;
  }
  function assertCurrent(ctx) {
    if (ctx.account !== auth.getAccountId() || ctx.generation !== auth.getGeneration()) throw fail('SESSION_CHANGED', 'Le compte a changé.');
  }
  function remember(ctx, result) {
    for (const entity of [...(result?.users || []), ...(result?.chats || [])]) {
      if (!entity?.id || entity.deleted || entity.min) continue;
      ctx.entities.set(entityPeer(entity), entity);
    }
    return result;
  }
  function knownPeer(ctx, key) {
    return ctx.entities.has(key) ? descriptor(ctx.entities.get(key)) : key;
  }
  async function inputDescriptor(ctx, native, key) {
    const input = await native.resolvePeer(knownPeer(ctx, key));
    assertCurrent(ctx);
    if (input.className === 'InputPeerSelf') return { type: 'user', id: ctx.account.slice(4) };
    const canonical = peerOf(input);
    if (canonical !== key) throw fail('IDENTITY_MISMATCH', 'La conversation ne correspond pas au compte demandé.', 409);
    const [type, id] = canonical.split(':');
    return { type, id, ...(input.accessHash == null ? {} : { accessHash: String(input.accessHash) }) };
  }
  async function dialogs(ctx, native) {
    if (ctx.dialogs && now() - ctx.dialogsAt < 1500) return ctx.dialogs;
    if (!ctx.dialogsTask) ctx.dialogsTask = native.getDialogs({ limit: 100 }).then(data => {
      assertCurrent(ctx);
      if (!Array.isArray(data.dialogs)) throw fail('INVALID_DIALOGS', 'La liste de conversations est invalide.');
      remember(ctx, data); ctx.dialogs = data; ctx.dialogsAt = now(); return data;
    }).finally(() => { ctx.dialogsTask = null; });
    return ctx.dialogsTask;
  }
  function dialogList(ctx, data) {
    return data.dialogs.map(item => {
      const id = peerOf(item.peer); if (!id) return null;
      const entity = ctx.entities.get(id), last = data.messages?.find(message => message.id === item.topMessage && peerOf(message.peerId) === id);
      const mime = mimeOf(last), avatar = entity?.photo?.photoId && id.startsWith('user:') ? mediaStore.mediaUri({ kind: 'avatar', peer: descriptor(entity), photoId: String(entity.photo.photoId), variant: 'thumb' }) : null;
      return { id, recipientId: id.startsWith('user:') ? 'owp:' + id.slice(5) : id, username: entity?.username || '', name: displayName(entity), avatar,
        lastMessage: String(last?.message || (mime.startsWith('audio/') ? 'Message vocal' : mime.startsWith('video/') ? 'Vidéo' : mime ? 'Photo' : '')),
        lastMessageId: last?.id ? String(last.id) : null, lastMessageAt: iso(last?.date), unreadCount: Number(item.unreadCount) || 0, isGroup: !id.startsWith('user:') };
    }).filter(Boolean);
  }
  function stableId(ctx, peer, provided, operation = 'message') {
    if (typeof provided !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(provided)) throw fail('CLIENT_MESSAGE_ID_REQUIRED', 'L’identifiant stable de cet envoi est manquant.', 400);
    return owpenRandomId(operation + ':' + ctx.account + ':' + peer + ':' + provided).toString();
  }
  async function runRequest(path, options = {}) {
    const ctx = context(), { parts, query, body, method } = parseRequest(path, options);
    if (parts[1] === 'posts' || parts[1] === 'users' || parts[1] === 'profile') {
      const result = await social.request(path, options);
      assertCurrent(ctx); return result;
    }
    const native = await auth.getClient();
    assertCurrent(ctx);
    if (parts[1] === 'messages' && parts[2] === 'unread' && parts.length === 3 && method === 'GET') {
      const data = await dialogs(ctx, native), list = dialogList(ctx, data).filter(item => item.unreadCount > 0).map(item => ({ id: item.id, count: item.unreadCount }));
      return { total: list.reduce((sum, item) => sum + item.count, 0), conversations: list, hasMore: data.dialogs.length === 100 };
    }
    if (parts[1] !== 'conversations') throw fail('OWPENGRAM_ROUTE_NOT_FOUND', 'Cette fonction n’est pas disponible dans cette version.', 404);
    if (parts.length === 2 && method === 'GET') {
      const data = await dialogs(ctx, native);
      return { conversations: dialogList(ctx, data), hasMore: data.dialogs.length === 100 };
    }
    if (parts.length === 2 && method === 'POST') {
      const peer = canonicalPeer(body.recipientId), handle = String(body.recipientUsername || '').replace(/^@/, '');
      let entity;
      try { entity = await native.getEntity(knownPeer(ctx, peer)); }
      catch (error) {
        if (error.code !== 'OWPENGRAM_PEER_ACCESS_REQUIRED' || !/^[a-z][a-z0-9_]{2,31}$/i.test(handle)) throw error;
        entity = await native.getEntity('@' + handle);
      }
      if (entityPeer(entity) !== peer) throw fail('OWPENGRAM_IDENTITY_MISMATCH', 'Ce pseudo appartient à un autre compte. Actualise le profil.', 409);
      remember(ctx, { users: [entity] });
      return { conversationId: peer };
    }
    const cid = canonicalPeer(parts[2]), peer = await inputDescriptor(ctx, native, cid);
    if (parts.length === 4 && parts[3] === 'messages') {
      if (method === 'GET') {
        const result = remember(ctx, await native.getMessages(peer, { limit: 50, before: query.before ? messageId(query.before) : 0 }));
        if (!Array.isArray(result.messages)) throw fail('INVALID_HISTORY', 'L’historique est incomplet.');
        const messages = result.messages.filter(item => item.id && !['MessageEmpty', 'MessageService'].includes(item.className)).map(item => normalizeMessage(item, ctx.account, peer, mediaStore.mediaUri));
        return { messages, nextBefore: result.messages.length === 50 ? String(result.messages[result.messages.length - 1].id) : null };
      }
      if (method === 'POST') {
        const result = await native.sendMessage({ peer, text: body.text, randomId: stableId(ctx, cid, body.clientMessageId), replyTo: body.replyTo ? messageId(body.replyTo) : undefined });
        if (!result?.id) throw fail('MESSAGE_NOT_CONFIRMED', 'OwpenGram n’a pas confirmé cet envoi.');
        ctx.dialogsAt = 0;
        return { success: true, messageId: String(result.id) };
      }
    }
    if (parts[3] === 'messages' && parts[4]) {
      const id = messageId(parts[4]);
      if (parts.length === 5 && method === 'PATCH') { await native.editMessage({ peer, id, text: body.text }); return { success: true }; }
      if (parts.length === 5 && method === 'DELETE') { await native.deleteMessages({ peer, ids: [id], revoke: true }); ctx.dialogsAt = 0; return { success: true }; }
      if (parts.length === 6 && parts[5] === 'reaction' && method === 'POST') { await native.sendReaction({ peer, id, emoji: body.emoji || null }); return { success: true }; }
      if (parts.length === 6 && parts[5] === 'forward' && method === 'POST') {
        const destination = canonicalPeer(body.conversationId), target = await inputDescriptor(ctx, native, destination);
        const result = await native.forwardMessages({ fromPeer: peer, peer: target, ids: [id], randomIds: [stableId(ctx, destination, body.clientMessageId, 'forward:' + cid + ':' + id)] });
        if (!result?.length) throw fail('FORWARD_NOT_CONFIRMED', 'OwpenGram n’a pas confirmé le transfert.');
        ctx.dialogsAt = 0; return { success: true };
      }
    }
    if (method === 'POST' && ((parts.length === 4 && parts[3] === 'read') || (parts.length === 5 && parts[3] === 'notifications' && parts[4] === 'read'))) {
      await native.markRead({ peer, maxId: body.maxId ? messageId(body.maxId) : 0 }); ctx.dialogsAt = 0; return { success: true };
    }
    if (parts.length === 4 && parts[3] === 'settings') {
      if (method === 'GET') return { ttlSeconds: await native.getHistoryTTL(peer) };
      if (method === 'PUT') {
        if (![0, 86400, 604800, 2592000].includes(body.ttlSeconds)) throw fail('INVALID_TTL', 'Durée invalide.', 400);
        await native.setHistoryTTL({ peer, seconds: body.ttlSeconds }); return { success: true, ttlSeconds: body.ttlSeconds };
      }
    }
    if (parts.length === 3 && method === 'DELETE') { await native.clearHistory(peer); ctx.dialogsAt = 0; return { success: true, scope: 'self' }; }
    throw fail('OWPENGRAM_ROUTE_NOT_FOUND', 'Opération de conversation inconnue.', 404);
  }
  async function request(path, options) {
    const ctx = context();
    try { const result = await runRequest(path, options); assertCurrent(ctx); return result; }
    catch (error) { throw publicError(error); }
  }
  async function publish({ media: selected, caption, visibility, clientMessageId }, onProgress) {
    const ctx = context();
    try {
      if (Array.isArray(selected)) { if (selected.length !== 1) throw fail('SINGLE_MEDIA_REQUIRED', 'Choisis une seule photo ou vidéo pour cette publication.', 400); selected = selected[0]; }
      const file = await prepareUpload(selected); assertCurrent(ctx);
      const result = await social.publish({ file, caption, visibility, clientMessageId },
        ratio => onProgress?.(ratio, ratio < 0.9 ? 'Envoi vers OwpenGram…' : 'Confirmation OwpenGram…'));
      assertCurrent(ctx); return result;
    } catch (error) { throw publicError(error); }
  }
  async function sendMedia(conversationId, selected, { clientMessageId, replyTo, caption = '' } = {}, onProgress) {
    const ctx = context(), cid = canonicalPeer(conversationId);
    try {
      const native = await auth.getClient(), peer = await inputDescriptor(ctx, native, cid);
      assertCurrent(ctx);
      const randomId = stableId(ctx, cid, clientMessageId);
      onProgress?.({ phase: 'preparing', progress: 0 });
      const file = await prepareUpload(selected); assertCurrent(ctx);
      const result = await native.sendMedia({ peer, file, caption, randomId, replyTo: replyTo ? messageId(replyTo) : undefined,
        onProgress: progress => onProgress?.({ phase: 'uploading', progress }) });
      assertCurrent(ctx);
      if (!result?.id) throw fail('MEDIA_NOT_CONFIRMED', 'OwpenGram n’a pas confirmé cet envoi.');
      ctx.dialogsAt = 0;
      onProgress?.({ phase: 'complete', progress: 1 });
      return { success: true, messageId: String(result.id) };
    } catch (error) { throw publicError(error); }
  }
  async function setAvatar(selected, onProgress) {
    const ctx = context();
    try {
      const file = await prepareUpload(selected, { avatar: true }); assertCurrent(ctx);
      const native = await auth.getClient();
      assertCurrent(ctx);
      const input = await native.uploadFile(file, { onProgress });
      assertCurrent(ctx);
      const result = await native.invoke(new Api.photos.UploadProfilePhoto({ file: input }));
      if (!result.photo?.id) throw fail('AVATAR_NOT_CONFIRMED', 'OwpenGram n’a pas confirmé la photo de profil.');
      assertCurrent(ctx); social.clear?.();
      const profile = await social.request('/api/profile/me');
      assertCurrent(ctx);
      return profile;
    } catch (error) { throw publicError(error); }
  }
  auth.subscribe?.(() => { state.dialogs = null; state.dialogsAt = 0; });
  return { request, publish, sendMedia, setAvatar, resolveMedia: mediaStore.resolveMedia, useMediaUri: mediaStore.useMediaUri };
}
const api = createApi();
module.exports = { ...api, api, createApi, canonicalPeer, normalizeMessage, parseRequest };
