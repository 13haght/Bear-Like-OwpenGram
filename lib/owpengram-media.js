'use strict';

const FS = require('expo-file-system/legacy');
const Crypto = require('expo-crypto');
const { Api, Buffer } = require('../transport/owpengram.bundle.cjs');
const { preparePhotoFile } = require('./media-file');
const { fail, publicError } = require('./owpengram-errors');
const PREFIX = 'owp-media://';
const MAX_UPLOAD_BYTES = 18 * 1024 * 1024;
const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
const MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024;

function checkRef(ref) {
  if (!ref || !['story', 'message', 'avatar'].includes(ref.kind) || !ref.peer ||
      !['user', 'chat', 'channel'].includes(ref.peer.type) || !/^[1-9]\d{0,19}$/.test(String(ref.peer.id)) ||
      (ref.peer.accessHash != null && !/^-?\d{1,20}$/.test(String(ref.peer.accessHash))) ||
      (ref.variant != null && !['full', 'thumb'].includes(ref.variant))) throw fail('MEDIA_REFERENCE_INVALID', 'Référence de média invalide.', 400);
  const nativeId = ref.kind === 'story' ? ref.storyId : ref.kind === 'message' ? ref.messageId : null;
  if (ref.kind !== 'avatar' && (!Number.isSafeInteger(Number(nativeId)) || Number(nativeId) < 1 || Number(nativeId) > 2147483647)) throw fail('MEDIA_REFERENCE_INVALID', 'Référence de média invalide.', 400);
  // Whitelist serializable public reference fields; authorization keys are never
  // part of an image URI, React prop, AsyncStorage draft, or file name.
  return {
    kind: ref.kind, peer: { type: ref.peer.type, id: String(ref.peer.id), ...(ref.peer.accessHash == null ? {} : { accessHash: String(ref.peer.accessHash) }) },
    variant: ref.variant || 'full',
    ...(ref.kind === 'story' ? { storyId: Number(ref.storyId) } : {}),
    ...(ref.kind === 'message' ? { messageId: Number(ref.messageId) } : {}),
    ...(ref.id != null ? { id: String(ref.id) } : {}),
    ...(ref.mediaId != null ? { mediaId: String(ref.mediaId) } : {}),
    ...(ref.photoId != null ? { photoId: String(ref.photoId) } : {}),
    ...(typeof ref.mime === 'string' && /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(ref.mime) ? { mime: ref.mime } : {}),
  };
}
function mediaUri(ref) { return PREFIX + encodeURIComponent(JSON.stringify(checkRef(ref))); }
function parseMediaUri(uri) {
  if (typeof uri !== 'string' || !uri.startsWith(PREFIX) || uri.length > 4096) throw fail('MEDIA_REFERENCE_INVALID', 'Référence de média invalide.', 400);
  try { return checkRef(JSON.parse(decodeURIComponent(uri.slice(PREFIX.length)))); }
  catch (error) { if (error.isOwpenPublicError) throw error; throw fail('MEDIA_REFERENCE_INVALID', 'Référence de média invalide.', 400); }
}
function extensionFor(mime) {
  return ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'video/mp4': 'mp4',
    'audio/mp4': 'm4a', 'audio/aac': 'aac', 'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/webm': 'webm' })[mime] || 'bin';
}

async function makeVideoThumbnail(uri) {
  const { createVideoPlayer } = require('expo-video');
  const { ImageManipulator, SaveFormat } = require('expo-image-manipulator');
  let player, thumbnail, context, image, saved;
  try {
    player = createVideoPlayer(null);
    player.muted = true;
    await player.replaceAsync({ uri });
    [thumbnail] = await player.generateThumbnailsAsync([0], { maxWidth: 320, maxHeight: 320 });
    if (!thumbnail) return undefined;
    context = ImageManipulator.manipulate(thumbnail);
    image = await context.renderAsync();
    saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.65, base64: true });
    const buffer = Buffer.from(saved.base64 || '', 'base64');
    if (buffer.length > 0 && buffer.length <= 128 * 1024) return { buffer, mime: 'image/jpeg', name: 'thumbnail.jpg' };
  } finally {
    image?.release?.(); context?.release?.(); thumbnail?.release?.(); player?.release?.();
    if (saved?.uri) await FS.deleteAsync(saved.uri, { idempotent: true }).catch(() => {});
  }
}

async function prepareUpload(media, { avatar = false, fs = FS, makeThumbnail = makeVideoThumbnail } = {}) {
  if (!media || typeof media.uri !== 'string') throw fail('MEDIA_REQUIRED', 'Sélectionne un média local.', 400);
  const sourceMime = String(media.mime || media.mimeType || media.type || '').toLowerCase();
  const kind = avatar ? 'photo' : media.kind === 'voice' || sourceMime.startsWith('audio/') || media.type === 'audio' ? 'voice'
    : media.type === 'video' || sourceMime.startsWith('video/') ? 'video' : 'photo';
  let uri = media.uri, name = media.fileName || media.name || '', mime = sourceMime;
  let copied = false;
  if (kind === 'photo') {
    const prepared = await preparePhotoFile({ uri }, { ...fs, documentDirectory: fs.cacheDirectory }, avatar ? 'avatar' : 'photo');
    copied = prepared.uri !== uri;
    uri = prepared.uri; name = prepared.name; mime = prepared.type;
  } else {
    if (/^content:\/\//i.test(uri)) {
      const folder = fs.cacheDirectory + 'owpengram-upload/';
      await fs.makeDirectoryAsync(folder, { intermediates: true });
      const copy = folder + Crypto.randomUUID() + '.media';
      try { await fs.copyAsync({ from: uri, to: copy }); } catch (_) { throw fail('MEDIA_UNREADABLE', 'Le fichier Android est inaccessible. Sélectionne-le à nouveau.', 400); }
      uri = copy; copied = true;
    }
    if (kind === 'video' && !mime.startsWith('video/')) mime = 'video/mp4';
    if (kind === 'voice' && !mime.startsWith('audio/')) mime = 'audio/mp4';
  }
  try {
    if (!/^file:\/\//i.test(uri)) throw fail('MEDIA_NOT_LOCAL', 'Le média doit être disponible sur cet appareil.', 400);
    const info = await fs.getInfoAsync(uri);
    const limit = avatar ? MAX_AVATAR_BYTES : MAX_UPLOAD_BYTES;
    if (!info.exists || info.isDirectory || !(Number(info.size) > 0)) throw fail('MEDIA_UNREADABLE', 'Le fichier est vide ou inaccessible.', 400);
    if (Number(info.size) > limit) throw fail('MEDIA_TOO_LARGE', avatar ? 'La photo de profil doit faire au maximum 5 Mio.' : 'Cette version accepte les médias jusqu’à 18 Mio.', 413);
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'audio/mp4', 'audio/mpeg', 'audio/aac', 'audio/ogg', 'audio/webm'];
    if (!allowed.includes(mime)) throw fail('MEDIA_FORMAT_UNSUPPORTED', 'Choisis une photo JPEG/PNG/WEBP, une vidéo MP4 ou un enregistrement audio compatible.', 400);
    const buffer = Buffer.from(await fs.readAsStringAsync(uri, { encoding: fs.EncodingType.Base64 }), 'base64');
    if (!buffer.length || buffer.length > limit) throw fail('MEDIA_TOO_LARGE', 'Le fichier a changé ou dépasse la taille acceptée.', 413);
    if ((kind === 'video' || mime === 'audio/mp4') && buffer.subarray(4, 8).toString('ascii') !== 'ftyp') throw fail('MEDIA_FORMAT_INVALID', 'Le contenu de ce fichier n’est pas un MP4/M4A reconnu.', 400);
    const duration = Number(media.durationSeconds ?? media.duration), width = Number(media.width), height = Number(media.height);
    if (kind !== 'photo' && (!Number.isFinite(duration) || duration <= 0 || duration > 86400)) throw fail('MEDIA_DURATION_REQUIRED', 'La durée du média est inconnue. Sélectionne-le à nouveau.', 400);
    if (kind === 'video' && (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0)) throw fail('VIDEO_DIMENSIONS_REQUIRED', 'Les dimensions de la vidéo sont inconnues. Sélectionne-la à nouveau.', 400);
    const file = { buffer, name: name || kind + '.' + extensionFor(mime), mime, kind, duration, width, height };
    if (kind === 'video' && makeThumbnail) {
      // A codec without thumbnail support can still be sent. The UI then uses
      // its video placeholder; it must never fetch the whole video as a thumb.
      try { file.thumbnail = await makeThumbnail(uri); } catch (_) {}
    }
    return file;
  } finally {
    if (copied) await fs.deleteAsync(uri, { idempotent: true }).catch(() => {});
  }
}

function createMediaStore({ auth, fs = FS, hash = text => Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, text) }) {
  const inflight = new Map();
  let running = 0;
  const waiting = [];
  async function limited(fn) {
    if (running >= 2) await new Promise(resolve => waiting.push(resolve));
    else running += 1;
    try { return await fn(); }
    finally { const next = waiting.shift(); if (next) next(); else running -= 1; }
  }
  const scope = () => {
    const id = auth.getAccountId();
    if (!id) throw fail('SESSION_REQUIRED', 'Connecte-toi à OwpenGram.', 401);
    return { id, generation: auth.getGeneration() };
  };
  const same = value => value.id === auth.getAccountId() && value.generation === auth.getGeneration();
  async function currentMedia(native, ref) {
    const peer = await native.resolvePeer(ref.peer);
    if (ref.kind === 'story') {
      const result = await native.invoke(new Api.stories.GetStoriesByID({ peer, id: [ref.storyId] }));
      const story = result.stories?.find(item => Number(item.id) === ref.storyId && item.media);
      if (!story) throw fail('MEDIA_NOT_FOUND', 'Cette publication n’est plus disponible.', 404);
      const document = story.media.document || story.media.photo;
      if (ref.mediaId && String(document?.id) !== ref.mediaId) throw fail('MEDIA_CHANGED', 'Le média de cette publication a changé. Actualise le profil.', 404);
      return story.media;
    }
    if (ref.kind === 'message') {
      const result = await native.getMessages(peer, { ids: [ref.messageId] });
      const message = result.messages?.find(item => Number(item.id) === ref.messageId && item.media);
      const document = message?.media?.document || message?.media?.photo;
      if (!document || (ref.id && String(document.id) !== ref.id)) throw fail('MEDIA_NOT_FOUND', 'Ce média n’est plus disponible.', 404);
      return message.media;
    }
    if (ref.peer.type !== 'user') throw fail('AVATAR_UNAVAILABLE', 'Photo de profil indisponible.', 404);
    const result = await native.invoke(new Api.users.GetFullUser({ id: peer }));
    const photo = result.fullUser?.profilePhoto;
    if (!photo || (ref.photoId && String(photo.id) !== ref.photoId)) throw fail('AVATAR_UNAVAILABLE', 'La photo de profil a changé. Actualise le profil.', 404);
    return photo;
  }
  async function trim(folder, keep) {
    try {
      const names = await fs.readDirectoryAsync(folder);
      const files = [];
      for (const name of names) {
        const uri = folder + name;
        const info = await fs.getInfoAsync(uri);
        if (info.exists && !info.isDirectory) files.push({ uri, size: Number(info.size) || 0, date: Number(info.modificationTime) || 0 });
      }
      let total = files.reduce((sum, item) => sum + item.size, 0);
      files.sort((a, b) => a.date - b.date);
      for (const file of files) {
        if (total <= 200 * 1024 * 1024) break;
        if (file.uri === keep) continue;
        await fs.deleteAsync(file.uri, { idempotent: true }); total -= file.size;
      }
    } catch (_) { /* Cache cleanup must not turn a successful download into a failed send. */ }
  }
  async function resolveMedia(uri) {
    if (!uri) return { uri: null };
    if (!uri.startsWith(PREFIX)) {
      if (/^(file|content):\/\//i.test(uri)) return { uri };
      throw fail('REMOTE_MEDIA_REJECTED', 'Ce média n’appartient pas à OwpenGram.', 400);
    }
    const account = scope(), ref = parseMediaUri(uri), key = account.id + ':' + account.generation + ':' + uri;
    if (inflight.has(key)) return inflight.get(key);
    const promise = limited(async () => {
      if (!same(account)) throw fail('SESSION_CHANGED', 'Le compte a changé.');
      const folder = fs.cacheDirectory + 'owpengram/' + account.id.replace(':', '-') + '/';
      const digest = await hash(uri);
      const base = folder + digest;
      // Metadata points only at a verified local file. It contains no key/token.
      try {
        const cached = JSON.parse(await fs.readAsStringAsync(base + '.json'));
        const local = base + '.' + extensionFor(cached.mime);
        const info = await fs.getInfoAsync(local);
        if (info.exists && info.size > 0 && same(account)) return { uri: local, mime: cached.mime };
      } catch (_) {}
      const native = await auth.getClient();
      let bytes, mime;
      for (let attempt = 0; attempt < 2; attempt++) {
        const value = await currentMedia(native, ref);
        const document = value.document || value.photo || value;
        mime = ref.variant === 'thumb' || !document.mimeType ? 'image/jpeg' : document.mimeType;
        try { bytes = await native.downloadTLMedia(value, { thumb: ref.variant === 'thumb' }); break; }
        catch (error) { if (attempt === 0 && /^FILE_REFERENCE_/.test(error.code || error.errorMessage || '')) continue; throw error; }
      }
      if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > MAX_DOWNLOAD_BYTES) throw fail('MEDIA_DOWNLOAD_INVALID', 'Le téléchargement dépasse 20 Mio ou le média est vide.', 413);
      if (!same(account)) throw fail('SESSION_CHANGED', 'Le compte a changé.');
      await fs.makeDirectoryAsync(folder, { intermediates: true });
      const local = base + '.' + extensionFor(mime);
      await fs.writeAsStringAsync(local, bytes.toString('base64'), { encoding: fs.EncodingType.Base64 });
      await fs.writeAsStringAsync(base + '.json', JSON.stringify({ mime }));
      if (!same(account)) { await fs.deleteAsync(local, { idempotent: true }); await fs.deleteAsync(base + '.json', { idempotent: true }); throw fail('SESSION_CHANGED', 'Le compte a changé.'); }
      await trim(folder, local);
      return { uri: local, mime };
    }).catch(error => { throw publicError(error); }).finally(() => { inflight.delete(key); });
    inflight.set(key, promise);
    return promise;
  }
  async function clearAccount(accountId) {
    if (!/^owp:[1-9]\d{0,19}$/.test(accountId || '')) return;
    await fs.deleteAsync(fs.cacheDirectory + 'owpengram/' + accountId.replace(':', '-') + '/', { idempotent: true });
  }
  return { mediaUri, resolveMedia, clearAccount };
}

const { authClient } = require('./owpengram-auth');
const mediaStore = createMediaStore({ auth: authClient });
let previousAccount = null;
authClient.subscribe(account => {
  if (previousAccount && account !== previousAccount) mediaStore.clearAccount(previousAccount).catch(() => {});
  previousAccount = account;
});

function useMediaUri(uri, enabled = true) {
  const React = require('react');
  const [revision, setRevision] = React.useState(0);
  const [state, setState] = React.useState({ uri: null, loading: false, error: null });
  const [account, setAccount] = React.useState(() => authClient.getAccountId());
  React.useEffect(() => authClient.subscribe(id => setAccount(id)), []);
  React.useEffect(() => {
    let alive = true;
    if (!uri || !enabled) { setState({ uri: null, loading: false, error: null }); return () => { alive = false; }; }
    setState({ uri: null, loading: true, error: null });
    mediaStore.resolveMedia(uri).then(result => {
      if (alive) setState({ ...result, loading: false, error: null });
    }).catch(error => { if (alive) setState({ uri: null, loading: false, error }); });
    return () => { alive = false; };
  }, [uri, enabled, revision, account]);
  const retry = React.useCallback(() => setRevision(value => value + 1), []);
  return { ...state, retry };
}

module.exports = { PREFIX, mediaUri, parseMediaUri, createMediaStore, prepareUpload, useMediaUri,
  resolveMedia: mediaStore.resolveMedia, clearAccount: mediaStore.clearAccount,
  MAX_UPLOAD_BYTES, MAX_AVATAR_BYTES, MAX_DOWNLOAD_BYTES };
