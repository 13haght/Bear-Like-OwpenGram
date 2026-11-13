'use strict';

function fail(code, message, status = 0, extra = {}) {
  return Object.assign(new Error(message), { code, status, isOwpenPublicError: true, ...extra });
}
const messages = {
  PHONE_CODE_INVALID: 'Code incorrect. Vérifie le code reçu et réessaie.',
  EMAIL_CODE_INVALID: 'Code incorrect. Vérifie le code reçu et réessaie.',
  PHONE_CODE_EXPIRED: 'Ce code a expiré. Recommence la connexion.',
  EMAIL_CODE_EXPIRED: 'Ce code a expiré. Recommence la connexion.',
  PASSWORD_HASH_INVALID: 'Le mot de passe de double authentification est incorrect.',
  PHONE_NUMBER_INVALID: 'Le numéro de téléphone est invalide. Vérifie son indicatif.',
  EMAIL_INVALID: 'L’adresse e-mail est invalide.',
  FIRSTNAME_INVALID: 'Indique un prénom pour créer le compte.',
  AUTH_KEY_UNREGISTERED: 'La session OwpenGram a expiré. Reconnecte-toi.',
  SESSION_REVOKED: 'Cette session OwpenGram a été révoquée.',
  SESSION_EXPIRED: 'La session OwpenGram a expiré. Reconnecte-toi.',
  OWPENGRAM_EMAIL_SIGNUP_DISABLED: 'La connexion par e-mail n’est pas activée sur ce serveur.',
  OWPENGRAM_CONNECTION_FAILED: 'Connexion au serveur OwpenGram impossible. Vérifie le réseau ou le transport WebSocket.',
  OWPENGRAM_ANDROID_NETWORK_POLICY: 'Android a bloqué le transport OwpenGram. La configuration réseau de cet APK doit être corrigée.',
  OWPENGRAM_WEBSOCKET_FAILED: 'Le WebSocket OwpenGram n’a pas pu s’ouvrir. Vérifie le réseau et réessaie.',
  OWPENGRAM_WEBSOCKET_UPGRADE_FAILED: 'Le serveur n’a pas accepté l’ouverture du WebSocket OwpenGram.',
  OWPENGRAM_TRANSPORT_CLOSED: 'La connexion OwpenGram a été interrompue. Réessaie.',
  OWPENGRAM_CONNECTION_TIMEOUT: 'La connexion ou la négociation MTProto a dépassé le délai. Réessaie.',
  OWPENGRAM_REQUEST_TIMEOUT: 'OwpenGram n’a pas répondu à temps. Vérifie si un code est déjà arrivé avant de réessayer.',
  OWPENGRAM_RUNTIME_INCOMPATIBLE: 'Un composant du protocole est incompatible avec le moteur Android de cet APK.',
  OWPENGRAM_RSA_FINGERPRINT_REJECTED: 'Le serveur n’a pas présenté la clé RSA OwpenGram attendue. Connexion refusée.',
  OWPENGRAM_MTPROTO_SECURITY_REJECTED: 'La vérification cryptographique MTProto a échoué. Connexion refusée.',
  OWPENGRAM_ENDPOINT_PIN_MISMATCH: 'Adresse du serveur OwpenGram différente de celle attendue.',
  OWPENGRAM_RSA_PIN_MISMATCH: 'La clé publique du serveur OwpenGram ne correspond pas à celle de référence.',
  OWPENGRAM_REQUEST_FAILED: 'Le serveur OwpenGram ne répond pas correctement à la demande.',
  OWPENGRAM_LOGIN_FLOW_UNSUPPORTED: 'Le serveur a répondu avec une étape de connexion non reconnue.',

  OWPENGRAM_PEER_ACCESS_REQUIRED: 'Retrouve ce compte par son pseudo OwpenGram avant de l’ouvrir.',
  USERNAME_NOT_OCCUPIED: 'Ce pseudo OwpenGram est introuvable.',
  USERNAME_INVALID: 'Ce pseudo OwpenGram est invalide.',
  CHAT_WRITE_FORBIDDEN: 'Tu ne peux pas envoyer de message dans cette conversation.',
  MESSAGE_AUTHOR_REQUIRED: 'Ce message ne peut pas être modifié par ce compte.',
  OWPENGRAM_MEDIA_NOT_FOUND: 'Ce média n’est plus disponible sur OwpenGram.',
  OWPENGRAM_FILE_SIZE_INVALID: 'Ce média dépasse la taille prise en charge par cette version.',
  OWPENGRAM_MEDIA_DURATION_REQUIRED: 'La durée du média est inconnue. Sélectionne-le à nouveau.',
  OWPENGRAM_VIDEO_METADATA_REQUIRED: 'Les dimensions de la vidéo sont inconnues. Sélectionne-la à nouveau.',
  OWPENGRAM_THUMBNAIL_UNAVAILABLE: 'Aucune miniature n’est disponible.',
};
function publicError(error) {
  if (error?.isOwpenPublicError) return error;
  const raw = error?.code || error?.errorMessage;
  const code = typeof raw === 'string' && /^[A-Z][A-Z0-9_]{1,90}$/.test(raw) ? raw : 'OWPENGRAM_REQUEST_FAILED';
  const seconds = Number(error?.seconds || /(?:FLOOD_WAIT|SLOWMODE_WAIT)_(\d+)/.exec(code)?.[1]);
  const status = Number(error?.status) || (/AUTH_KEY_UNREGISTERED|SESSION_REVOKED|SESSION_EXPIRED|USER_DEACTIVATED/.test(code) ? 401 : seconds > 0 ? 429 : 502);
  const message = messages[code] || (seconds > 0 ? 'OwpenGram demande de patienter ' + Math.ceil(seconds) + ' secondes avant de réessayer.'
    : /UNSUPPORTED|METHOD_INVALID/.test(code) ? 'Cette opération n’est pas prise en charge par ce serveur OwpenGram.'
      : 'OwpenGram n’a pas confirmé la demande. Vérifie la connexion puis réessaie.');
  return fail(code, message, status, seconds > 0 ? { retryAfter: seconds } : {});
}
module.exports = { fail, publicError };
