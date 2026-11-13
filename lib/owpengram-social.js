'use strict';

// This module is a projection of the signed-in OwpenGram account. It has no
// database, HTTP backend, storage account, or persistent social state.
const { Api, owpenRandomId } = require('../transport/owpengram.bundle.cjs');

const MAX_CONTACTS = 50;
const POSTS_PER_CONTACT = 10;
const PROFILE_PAGE_SIZE = 30;
const MAX_MEDIA_BYTES = 20 * 1024 * 1024;
const MAX_INT64 = '9223372036854775807';

function failure(code, message, status = 400) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  error.isOwpenPublicError = true;
  return error;
}

function decimalId(value) {
  const id = value == null ? '' : String(value);
  if (!/^[1-9]\d{0,18}$/.test(id) || (id.length === MAX_INT64.length && id > MAX_INT64)) {
    throw failure('OWPENGRAM_INVALID_USER_ID', 'Identifiant OwpenGram invalide.');
  }
  return id;
}

function storyNumber(value) {
  const raw = String(value);
  if (!/^[1-9]\d{0,9}$/.test(raw) || Number(raw) > 2147483647) {
    throw failure('OWPENGRAM_INVALID_STORY_ID', 'Identifiant de publication invalide.');
  }
  return Number(raw);
}

function parsePostId(value) {
  const match = /^owps:user:([1-9]\d{0,18}):([1-9]\d{0,9})$/.exec(String(value || ''));
  if (!match) throw failure('OWPENGRAM_INVALID_POST_ID', 'Référence de publication invalide.');
  return { ownerType: 'user', ownerId: decimalId(match[1]), storyId: storyNumber(match[2]) };
}

function postId(ownerId, storyId) {
  return `owps:user:${decimalId(ownerId)}:${storyNumber(storyId)}`;
}

function className(value) {
  return String(value && (value.className || value._ || value.constructor?.name) || '');
}

function readBody(value) {
  let body = value;
  if (typeof value === 'string') {
    try { body = JSON.parse(value); } catch (_) {
      throw failure('OWPENGRAM_INVALID_BODY', 'Données de la requête invalides.');
    }
  }
  if (body == null) return {};
  if (typeof body !== 'object' || Array.isArray(body)) {
    throw failure('OWPENGRAM_INVALID_BODY', 'Données de la requête invalides.');
  }
  return body;
}

function routeParts(path) {
  if (typeof path !== 'string' || !path.startsWith('/api/')) {
    throw failure('OWPENGRAM_SOCIAL_ROUTE_NOT_FOUND', 'Opération sociale inconnue.', 404);
  }
  const split = path.indexOf('?');
  const pathname = split < 0 ? path : path.slice(0, split);
  const search = split < 0 ? '' : path.slice(split + 1);
  try {
    const parts = pathname.split('/').filter(Boolean).map(decodeURIComponent);
    const query = Object.create(null);
    for (const pair of search.split('&')) {
      if (!pair) continue;
      const at = pair.indexOf('=');
      const key = decodeURIComponent((at < 0 ? pair : pair.slice(0, at)).replace(/\+/g, ' '));
      const value = decodeURIComponent((at < 0 ? '' : pair.slice(at + 1)).replace(/\+/g, ' '));
      query[key] = value;
    }
    return { parts, query };
  } catch (_) {
    throw failure('OWPENGRAM_INVALID_PATH', 'Adresse de requête invalide.');
  }
}

function peerDescriptor(user, inputPeer) {
  const id = decimalId(user.id);
  const peer = { type: 'user', id };
  const hash = !user.min && user.accessHash != null ? user.accessHash : inputPeer?.accessHash;
  if (hash != null && /^-?\d+$/.test(String(hash))) peer.accessHash = String(hash);
  return peer;
}

function counter(value) {
  if (value == null) return null;
  const result = Number(value);
  return Number.isSafeInteger(result) && result >= 0 ? result : null;
}

function reactionEmoji(reaction) {
  return reaction && typeof reaction.emoticon === 'string' ? reaction.emoticon : null;
}

async function mapLimited(items, concurrency, callback) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await callback(items[index], index);
    }
  }));
  return results;
}

function createSocialApi({ getClient, mediaUri }) {
  if (typeof getClient !== 'function' || typeof mediaUri !== 'function') {
    throw new TypeError('getClient et mediaUri sont requis.');
  }
  let states = new WeakMap();

  async function context() {
    const client = await getClient();
    if (!client || typeof client.invoke !== 'function' || typeof client.getMe !== 'function') {
      throw failure('OWPENGRAM_SESSION_REQUIRED', 'Connecte-toi à OwpenGram.', 401);
    }
    let state = states.get(client);
    if (!state) {
      state = { me: null, users: new Map() };
      states.set(client, state);
    }
    if (!state.me) {
      const me = await client.getMe();
      decimalId(me?.id);
      state.me = me;
      state.users.set(String(me.id), me);
    }
    return { client, state, me: state.me, myId: String(state.me.id) };
  }

  function remember(ctx, result) {
    for (const user of result?.users || []) {
      if (!user || user.id == null) continue;
      const id = String(user.id);
      // A min entity is insufficient for future general-purpose requests and
      // must never replace a full access hash already learned from OwpenGram.
      if (user.min && ctx.state.users.has(id)) continue;
      ctx.state.users.set(id, user);
    }
    return result;
  }

  async function invoke(ctx, request) {
    return remember(ctx, await ctx.client.invoke(request));
  }

  function userId(value, ctx) {
    if (value === 'me' || value === 'self') return ctx.myId;
    return decimalId(String(value || '').replace(/^owp:/, ''));
  }

  function inputUser(ctx, peer, id) {
    if (id === ctx.myId || /InputPeerSelf$/.test(className(peer))) return new Api.InputUserSelf();
    if (peer?.userId == null || String(peer.userId) !== id || peer.accessHash == null) {
      throw failure('OWPENGRAM_PEER_ACCESS_REQUIRED', 'Retrouve ce profil avec la recherche OwpenGram.', 409);
    }
    return new Api.InputUser({ userId: peer.userId, accessHash: peer.accessHash });
  }

  async function target(ctx, identifier, { full = false } = {}) {
    const id = userId(identifier, ctx);
    let user = ctx.state.users.get(id);
    const known = user && !user.min ? peerDescriptor(user) : null;
    const peer = await ctx.client.resolvePeer(id === ctx.myId ? 'self' : known?.accessHash != null ? known : `user:${id}`);
    if (id !== ctx.myId && (peer?.userId == null || String(peer.userId) !== id)) {
      throw failure('OWPENGRAM_PEER_ID_MISMATCH', 'Le profil retourné ne correspond pas au compte demandé.', 409);
    }
    let fullUser = null;
    if (full || !user || user.min) {
      const response = await invoke(ctx, new Api.users.GetFullUser({ id: inputUser(ctx, peer, id) }));
      fullUser = response?.fullUser;
      user = ctx.state.users.get(id);
      if (fullUser?.id != null && String(fullUser.id) !== id) {
        throw failure('OWPENGRAM_PEER_ID_MISMATCH', 'Le profil retourné ne correspond pas au compte demandé.', 409);
      }
      if (!fullUser || !user) throw failure('OWPENGRAM_INVALID_RESPONSE', 'Profil OwpenGram incomplet.', 502);
    }
    if (!user || user.deleted) throw failure('OWPENGRAM_USER_NOT_FOUND', 'Ce compte OwpenGram est indisponible.', 404);
    return { id, user, peer, descriptor: peerDescriptor(user, peer), fullUser };
  }

  async function normalizeUser(user, fullUser, descriptor) {
    const id = decimalId(user.id);
    const peer = descriptor || peerDescriptor(user);
    const username = typeof user.username === 'string' ? user.username : '';
    const firstName = typeof user.firstName === 'string' ? user.firstName : '';
    const lastName = typeof user.lastName === 'string' ? user.lastName : '';
    const name = [firstName, lastName].filter(Boolean).join(' ').trim() || username || 'Utilisateur OwpenGram';
    const photoId = fullUser?.profilePhoto?.id ?? user.photo?.photoId;
    const avatarNativeRef = photoId != null && String(photoId) !== '0'
      ? { kind: 'avatar', peer, photoId: String(photoId), variant: 'thumb' } : null;
    return {
      id: `owp:${id}`, username, handle: username, name, firstName, lastName,
      bio: typeof fullUser?.about === 'string' ? fullUser.about : '',
      avatar: avatarNativeRef ? await mediaUri(avatarNativeRef) : null,
      avatarType: 'image', avatarNativeRef,
      isContact: Boolean(user.contact), isMutualContact: Boolean(user.mutualContact),
      self: Boolean(user.self), bot: Boolean(user.bot),
      nativeRef: { kind: 'user', peer },
    };
  }

  async function profile(ctx, identifier) {
    const owner = await target(ctx, identifier, { full: true });
    return normalizeUser(owner.user, owner.fullUser, owner.descriptor);
  }

  async function normalizeStory(story, owner) {
    if (!story || /StoryItem(?:Deleted|Skipped)$/.test(className(story)) || story.id == null) return null;
    const photo = story.media?.photo;
    const document = story.media?.document;
    let type;
    let mediaId;
    if (photo?.id != null && !/PhotoEmpty$/.test(className(photo))) {
      type = 'image'; mediaId = String(photo.id);
    } else if (document?.id != null && (String(document.mimeType || '').startsWith('video/') ||
      (document.attributes || []).some(value => /DocumentAttributeVideo$/.test(className(value))))) {
      type = 'video'; mediaId = String(document.id);
    } else return null;
    const id = postId(owner.id, story.id);
    const nativeRef = { kind: 'story', peer: owner.descriptor, storyId: storyNumber(story.id), mediaId, variant: 'full' };
    const thumbnailRef = { ...nativeRef, variant: 'thumb' };
    const author = await normalizeUser(owner.user, owner.fullUser, owner.descriptor);
    const myReaction = reactionEmoji(story.sentReaction);
    const reactionCounts = (story.views?.reactions || []).map(item => ({ emoji: reactionEmoji(item.reaction), count: counter(item.count) }))
      .filter(item => item.emoji != null && item.count != null);
    return {
      id, author: `owp:${owner.id}`, authorName: author.name, authorHandle: author.username,
      authorAvatar: author.avatar, caption: String(story.caption || ''),
      visibility: story.public ? 'public' : story.contacts ? 'contacts' : 'restricted',
      createdAt: Number.isFinite(Number(story.date)) ? Number(story.date) * 1000 : null,
      expiresAt: Number.isFinite(Number(story.expireDate)) ? Number(story.expireDate) * 1000 : null,
      pinned: Boolean(story.pinned), likes: counter(story.views?.reactionsCount), views: counter(story.views?.viewsCount),
      liked: Boolean(story.sentReaction && !/ReactionEmpty$/.test(className(story.sentReaction))),
      myReaction, reactionCounts, allowComments: false,
      media: [{ id, type, uri: await mediaUri(nativeRef), thumbnailUri: await mediaUri(thumbnailRef), nativeRef }],
      nativeRef,
    };
  }

  async function storyById(ctx, reference) {
    const owner = await target(ctx, reference.ownerId);
    const result = await invoke(ctx, new Api.stories.GetStoriesByID({ peer: owner.peer, id: [reference.storyId] }));
    const story = result?.stories?.find(item => Number(item.id) === reference.storyId && !/StoryItemDeleted$/.test(className(item)));
    const post = await normalizeStory(story, owner);
    if (!post) throw failure('OWPENGRAM_POST_NOT_FOUND', 'Cette publication est indisponible.', 404);
    return post;
  }

  async function pinnedPage(ctx, identifier, before = 0, limit = PROFILE_PAGE_SIZE) {
    const owner = await target(ctx, identifier);
    const result = await invoke(ctx, new Api.stories.GetPinnedStories({ peer: owner.peer, offsetId: before, limit }));
    if (!Array.isArray(result?.stories)) throw failure('OWPENGRAM_INVALID_RESPONSE', 'Liste de publications invalide.', 502);
    let stories = result.stories;
    const missing = stories.filter(item => /StoryItemSkipped$/.test(className(item))).map(item => storyNumber(item.id));
    if (missing.length) {
      const hydrated = await invoke(ctx, new Api.stories.GetStoriesByID({ peer: owner.peer, id: missing }));
      const byId = new Map((hydrated?.stories || []).map(item => [Number(item.id), item]));
      stories = stories.map(item => byId.get(Number(item.id)) || item);
    }
    // expireDate only controls active stories. Pinned profile publications
    // remain visible after it; deliberately do not filter on this timestamp.
    const posts = (await Promise.all(stories.map(story => normalizeStory(story, owner)))).filter(Boolean);
    const ids = result.stories.map(item => Number(item.id)).filter(id => Number.isInteger(id) && id > 0);
    const last = ids.length ? Math.min(...ids) : 0;
    if (before && ids.length && last >= before) {
      throw failure('OWPENGRAM_INVALID_PAGINATION', 'Pagination OwpenGram incohérente.', 502);
    }
    return { posts, nextCursor: result.stories.length >= limit && last > 1 ? String(last) : null,
      count: counter(result.count), native: true };
  }

  async function contactUsers(ctx) {
    const result = await invoke(ctx, new Api.contacts.GetContacts({ hash: 0 }));
    if (!Array.isArray(result?.contacts) || !Array.isArray(result?.users)) {
      throw failure('OWPENGRAM_INVALID_RESPONSE', 'Liste de contacts OwpenGram incomplète.', 502);
    }
    const ids = new Set(result.contacts.map(contact => String(contact.userId)));
    return result.users.filter(user => user?.id != null && ids.has(String(user.id)) && !user.deleted);
  }

  async function feed(ctx) {
    const contacts = (await contactUsers(ctx)).filter(user => String(user.id) !== ctx.myId && !user.bot);
    const chosen = contacts.slice(0, MAX_CONTACTS);
    const owners = [ctx.myId, ...chosen.map(user => String(user.id))];
    const pages = await mapLimited(owners, 4, async id => {
      try { return { id, page: await pinnedPage(ctx, id, 0, POSTS_PER_CONTACT) }; }
      catch (error) {
        if (id === ctx.myId || error?.status === 401) throw error;
        return { id, error };
      }
    });
    const good = pages.filter(item => item.page);
    const posts = [...new Map(good.flatMap(item => item.page.posts).map(post => [post.id, post])).values()]
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0) || b.id.localeCompare(a.id));
    const profilesFailed = pages.length - good.length;
    const truncated = contacts.length > chosen.length || good.some(item => item.page.nextCursor != null);
    return { posts, nextCursor: null, coverage: {
      scope: 'owpengram_contacts_and_self', maxContacts: MAX_CONTACTS, maxPostsPerProfile: POSTS_PER_CONTACT,
      contactsAvailable: contacts.length, contactsIncluded: chosen.length,
      profilesRequested: owners.length, profilesLoaded: good.length, profilesFailed,
      partial: profilesFailed > 0, truncated, complete: !profilesFailed && !truncated,
    } };
  }

  async function updateProfile(ctx, body) {
    const allowed = new Set(['name', 'firstName', 'lastName', 'bio']);
    if (!Object.keys(body).length || Object.keys(body).some(key => !allowed.has(key))) {
      throw failure('OWPENGRAM_PROFILE_FIELDS_UNSUPPORTED', 'Seuls le nom, le prénom et la biographie sont modifiables ici.');
    }
    if (body.name != null && (body.firstName != null || body.lastName != null)) {
      throw failure('OWPENGRAM_PROFILE_FIELDS_AMBIGUOUS', 'Utilise le nom complet ou les champs prénom et nom.');
    }
    const fields = {};
    const name = Object.prototype.hasOwnProperty.call(body, 'name') ? body.name : body.firstName;
    if (name != null) {
      if (typeof name !== 'string' || !name.trim() || [...name.trim()].length > 64) {
        throw failure('OWPENGRAM_INVALID_PROFILE_NAME', 'Le nom doit contenir entre 1 et 64 caractères.');
      }
      fields.firstName = name.trim();
      if (Object.prototype.hasOwnProperty.call(body, 'name')) fields.lastName = '';
    }
    if (Object.prototype.hasOwnProperty.call(body, 'lastName')) {
      if (typeof body.lastName !== 'string' || [...body.lastName.trim()].length > 64) {
        throw failure('OWPENGRAM_INVALID_PROFILE_NAME', 'Le nom de famille est invalide.');
      }
      fields.lastName = body.lastName.trim();
    }
    if (Object.prototype.hasOwnProperty.call(body, 'bio')) {
      if (typeof body.bio !== 'string' || [...body.bio].length > 500) {
        throw failure('OWPENGRAM_INVALID_PROFILE_BIO', 'La biographie est invalide.');
      }
      fields.about = body.bio;
    }
    if (!Object.keys(fields).length) throw failure('OWPENGRAM_INVALID_BODY', 'Aucune modification à enregistrer.');
    const updated = await invoke(ctx, new Api.account.UpdateProfile(fields));
    if (updated?.id != null && String(updated.id) === ctx.myId) {
      ctx.state.me = updated; ctx.state.users.set(ctx.myId, updated);
    }
    return { profile: await profile(ctx, ctx.myId) };
  }

  async function request(path, options = {}) {
    const { parts, query } = routeParts(path);
    const method = String(options.method || 'GET').toUpperCase();
    const body = readBody(options.body);
    const ctx = await context();
    if (parts.length === 2 && parts[1] === 'posts' && method === 'GET') {
      if (query.hashtag || query.before) throw failure('OWPENGRAM_FEED_FILTER_UNSUPPORTED', 'Le fil présente les publications récentes des contacts ; ouvre un profil pour parcourir ses publications.');
      return feed(ctx);
    }
    if (parts.join('/') === 'api/profile/me') {
      if (method === 'GET') return { profile: await profile(ctx, 'me') };
      if (method === 'PUT') return updateProfile(ctx, body);
    }
    if (parts.join('/') === 'api/users/contacts' && method === 'GET') {
      const users = await contactUsers(ctx);
      return { users: await Promise.all(users.map(user => normalizeUser(user))), native: true };
    }
    if (parts.join('/') === 'api/users/search' && method === 'GET') {
      const q = String(query.q || '').trim().replace(/^@/, '');
      if (!q || q.length > 100) throw failure('OWPENGRAM_INVALID_QUERY', 'Indique un nom ou un identifiant à rechercher.');
      const result = await invoke(ctx, new Api.contacts.Search({ q, limit: 40 }));
      if (!Array.isArray(result?.users)) throw failure('OWPENGRAM_INVALID_RESPONSE', 'Résultat de recherche invalide.', 502);
      const peers = [...(result.myResults || []), ...(result.results || [])];
      const ids = new Set(peers.filter(peer => peer?.userId != null).map(peer => String(peer.userId)));
      const users = result.users.filter(user => user?.id != null && ids.has(String(user.id)) && !user.deleted);
      return { users: await Promise.all(users.map(user => normalizeUser(user))), native: true };
    }
    if (parts[1] === 'users' && parts.length === 4) {
      if (parts[3] === 'profile' && method === 'GET') return { profile: await profile(ctx, parts[2]) };
      if (parts[3] === 'posts' && method === 'GET') {
        const before = query.before ? storyNumber(query.before) : 0;
        return pinnedPage(ctx, parts[2], before);
      }
      if (parts[3] === 'contact' && (method === 'POST' || method === 'DELETE')) {
        const owner = await target(ctx, parts[2]);
        if (owner.id === ctx.myId) throw failure('OWPENGRAM_SELF_CONTACT', 'Ce profil est le tien.');
        const id = inputUser(ctx, owner.peer, owner.id);
        if (method === 'POST') {
          await invoke(ctx, new Api.contacts.AddContact({ id, firstName: owner.user.firstName || owner.user.username || 'Contact',
            lastName: owner.user.lastName || '', phone: '', addPhonePrivacyException: false }));
        } else await invoke(ctx, new Api.contacts.DeleteContacts({ id: [id] }));
        ctx.state.users.delete(owner.id);
        return { success: true, isContact: method === 'POST' };
      }
    }
    if (parts[1] === 'posts' && (parts.length === 3 || parts.length === 4)) {
      const reference = parsePostId(parts[2]);
      if (parts.length === 3 && method === 'GET') return { post: await storyById(ctx, reference) };
      if (parts.length === 3 && (method === 'PATCH' || method === 'DELETE')) {
        if (reference.ownerId !== ctx.myId) throw failure('OWPENGRAM_POST_OWNER_REQUIRED', 'Seul le propriétaire peut modifier cette publication.', 403);
        const peer = await ctx.client.resolvePeer('self');
        if (method === 'PATCH') {
          if (typeof body.caption !== 'string' || body.caption.length > 2048 || Object.keys(body).some(key => key !== 'caption')) {
            throw failure('OWPENGRAM_INVALID_CAPTION', 'La légende est invalide.');
          }
          await invoke(ctx, new Api.stories.EditStory({ peer, id: reference.storyId, caption: body.caption, entities: [] }));
          return { post: await storyById(ctx, reference) };
        }
        const deleted = await invoke(ctx, new Api.stories.DeleteStories({ peer, id: [reference.storyId] }));
        if (!Array.isArray(deleted)) throw failure('OWPENGRAM_INVALID_RESPONSE', 'Suppression non confirmée par OwpenGram.', 502);
        if (!deleted.some(id => Number(id) === reference.storyId)) {
          try { await storyById(ctx, reference); }
          catch (error) {
            if (error?.code === 'OWPENGRAM_POST_NOT_FOUND') return { success: true, alreadyDeleted: true, deletedPostIds: [parts[2]] };
            throw error;
          }
          throw failure('OWPENGRAM_DELETE_NOT_CONFIRMED', 'La publication est encore présente sur OwpenGram.', 502);
        }
        return { success: true, deletedPostIds: [parts[2]] };
      }
      if (parts[3] === 'reaction' && method === 'POST') {
        if (!Object.prototype.hasOwnProperty.call(body, 'emoji') || (body.emoji !== null &&
          (typeof body.emoji !== 'string' || !body.emoji.trim() || body.emoji.length > 32))) {
          throw failure('OWPENGRAM_INVALID_REACTION', 'Choisis une réaction valide.');
        }
        const owner = await target(ctx, reference.ownerId);
        await invoke(ctx, new Api.stories.SendReaction({ peer: owner.peer, storyId: reference.storyId,
          reaction: body.emoji === null ? new Api.ReactionEmpty() : new Api.ReactionEmoji({ emoticon: body.emoji }) }));
        return { post: await storyById(ctx, reference) };
      }
      if (parts[3] === 'view' && method === 'POST') {
        const owner = await target(ctx, reference.ownerId);
        const result = await invoke(ctx, new Api.stories.IncrementStoryViews({ peer: owner.peer, id: [reference.storyId] }));
        if (result !== true) throw failure('OWPENGRAM_VIEW_NOT_CONFIRMED', 'Vue non confirmée par OwpenGram.', 502);
        return { success: true };
      }
    }
    throw failure('OWPENGRAM_SOCIAL_ROUTE_NOT_FOUND', 'Cette fonction ne fait pas partie des fonctions natives activées.', 404);
  }

  async function publish({ file, caption = '', visibility = 'public', clientMessageId } = {}, onProgress) {
    if (!file || !file.buffer || !Number.isFinite(file.buffer.byteLength ?? file.buffer.length)) {
      throw failure('OWPENGRAM_MEDIA_REQUIRED', 'Sélectionne une photo ou une vidéo.');
    }
    const bytes = file.buffer.byteLength ?? file.buffer.length;
    const mime = String(file.mime || file.mimetype || file.type || '').toLowerCase();
    if (!['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime', 'video/webm'].includes(mime)) {
      throw failure('OWPENGRAM_MEDIA_TYPE_UNSUPPORTED', 'Ce format de photo ou de vidéo est incompatible.');
    }
    if (bytes <= 0 || bytes > MAX_MEDIA_BYTES) throw failure('OWPENGRAM_MEDIA_TOO_LARGE', 'Le média doit contenir entre 1 octet et 20 Mio.', 413);
    if (typeof caption !== 'string' || caption.length > 2048) throw failure('OWPENGRAM_INVALID_CAPTION', 'La légende est trop longue.');
    if (typeof clientMessageId !== 'string' || !clientMessageId.trim() || clientMessageId.length > 160 || /[\u0000-\u001f]/.test(clientMessageId)) {
      throw failure('OWPENGRAM_REQUEST_ID_REQUIRED', 'L’identifiant stable de cette publication est requis.');
    }
    if (!['public', 'contacts', 'private'].includes(visibility)) throw failure('OWPENGRAM_INVALID_VISIBILITY', 'Visibilité de publication invalide.');
    const ctx = await context();
    const peer = await ctx.client.resolvePeer('self');
    const progress = fraction => { try { if (typeof onProgress === 'function') onProgress(Math.max(0, Math.min(1, Number(fraction) || 0))); } catch (_) { /* UI observer only */ } };
    progress(0);
    const capacity = await invoke(ctx, new Api.stories.CanSendStory({ peer }));
    if (capacity?.countRemains != null && Number(capacity.countRemains) <= 0) {
      throw failure('OWPENGRAM_STORY_LIMIT', 'OwpenGram ne permet pas de nouvelle publication pour le moment.', 429);
    }
    const kind = mime.startsWith('image/') ? 'photo' : 'video';
    const media = await ctx.client.uploadInputMedia({ ...file, mime }, { kind, onProgress: value => progress(Number(value) * 0.85) });
    progress(0.9);
    const privacyRules = visibility === 'public' ? [new Api.InputPrivacyValueAllowAll()]
      : visibility === 'contacts' ? [new Api.InputPrivacyValueAllowContacts()] : [new Api.InputPrivacyValueDisallowAll()];
    const randomId = owpenRandomId(`story:${ctx.myId}:${clientMessageId}`);
    const updates = await invoke(ctx, new Api.stories.SendStory({ peer, media, pinned: true, caption, entities: [],
      privacyRules, randomId, period: 86400 }));
    const list = updates?.updates || (updates?.update ? [updates.update] : []);
    const mapping = list.find(update => /UpdateStoryID$/.test(className(update)) && String(update.randomId) === String(randomId));
    if (!mapping?.id) throw failure('OWPENGRAM_PUBLISH_UNCONFIRMED', 'OwpenGram n’a pas confirmé la publication. Réessaie avec le même brouillon.', 502);
    const post = await storyById(ctx, { ownerType: 'user', ownerId: ctx.myId, storyId: storyNumber(mapping.id) });
    if (!post.pinned) throw failure('OWPENGRAM_PUBLICATION_NOT_PINNED', 'OwpenGram n’a pas confirmé la conservation de cette publication sur le profil.', 502);
    progress(1);
    return { post };
  }

  function clear() { states = new WeakMap(); }
  return { request, publish, clear, clearCache: clear };
}

module.exports = { createSocialApi, parsePostId, postId, MAX_CONTACTS, POSTS_PER_CONTACT, MAX_MEDIA_BYTES };
