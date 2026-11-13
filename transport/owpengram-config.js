import { SecurityError } from 'teleproto/errors/Common';

/**
 * Public server identity copied from Loligram IV, not Telegram's public service.
 * Source: 13haght/Loligram-IV-copie @ b05b98f3d07e44a89f501c1f4b3b8c442bbafca2
 * TMessagesProj/src/main/java/org/telegram/owpengram/OwpengramServers.java
 * Root's anonymous GET /server-info verified the same key and main DC 2 on
 * 2026-11-12. The app supplies its API identity and stores the user session locally.
 */
export const OWPENGRAM_SERVER = Object.freeze({
  host: '152.89.254.50',
  port: 2398,
  webSocketUrl: 'ws://152.89.254.50:2398/apiws',
  mainDcId: 1, // Aligné sur le serveur OwpenGram intégré à Loligram IV.
  dcIds: Object.freeze([1, 2, 3, 4, 5]),
  rsaFingerprintHex: '0xdff66c3cbd5ceeca',
  publicKeyPem: [
    '-----BEGIN RSA PUBLIC KEY-----',
    'MIIBCgKCAQEAxUi0fsjiop7kTI+c+ATHwIs+XPcircj9WL/tNASH45/phiIvxhPU',
    'z4T6OgUfDVpQEC8SWCuq77aZAhnpZ0rfQ+h6vEv7X970wIAPT/hbyzekyWEFmH5Q',
    'RxSPrOMKF/V0wuTOVJcoHZW5r5cK7xsVe/otdYdOgt67kITS7pqoO1BlstRuOEHL',
    'jhaJ/40dXocrWpDQlJP2TZFwk5JF1Pbx/2mLr/asQapc/qbQP82b+iDLW8QIBT0f',
    '+xi4Js4k7Qo9kZSuUHUCDzmJt6Z0USBxxp/tSZRVjWRaT9ORDrdyfb/mKFSt9BtC',
    'B5VRJ1e0q7P/9/w21T0p9uV3eNXhnPnLFQIDAQAB',
    '-----END RSA PUBLIC KEY-----',
  ].join('\n'),
});

export class OwpenError extends Error {
  constructor(code, status = 502, extra = {}) {
    super(code);
    this.name = 'OwpenError';
    this.code = code;
    this.errorMessage = code;
    this.status = status;
    Object.assign(this, extra);
  }
}

/** Keep upstream errors useful without copying raw requests, passwords or keys. */
export function safeOwpenError(error, fallback = 'OWPENGRAM_REQUEST_FAILED') {
  if (error instanceof OwpenError) return error;
  const raw = error?.errorMessage || error?.code;
  // Match known failure categories; never propagate raw exception messages,
  // native URLs, TL requests, code hashes, or authorization keys to logs/UI.
  const message = String(error?.message || '');
  const diagnostic = /CLEARTEXT|cleartext.*permitted/.test(message) ? 'OWPENGRAM_ANDROID_NETWORK_POLICY'
    : /valid key for fingerprints/.test(message) ? 'OWPENGRAM_RSA_FINGERPRINT_REJECTED'
      : error instanceof SecurityError || error?.name === 'SecurityError' ? 'OWPENGRAM_MTPROTO_SECURITY_REJECTED'
        : error?.name === 'TimeoutError' ? 'OWPENGRAM_REQUEST_TIMEOUT'
          : /timed out|timeout/i.test(message) ? 'OWPENGRAM_CONNECTION_TIMEOUT'
            : /Expected HTTP 101|Unexpected server response/.test(message) ? 'OWPENGRAM_WEBSOCKET_UPGRADE_FAILED'
              : error?.name === 'SocketClosedError' ? 'OWPENGRAM_TRANSPORT_CLOSED'
                : /WebSocket connection/.test(message) ? 'OWPENGRAM_WEBSOCKET_FAILED'
                  : ['TypeError', 'ReferenceError'].includes(error?.name) ? 'OWPENGRAM_RUNTIME_INCOMPATIBLE' : fallback;
  const code = typeof raw === 'string' && /^[A-Z][A-Z0-9_]{1,90}$/.test(raw) ? raw : diagnostic;
  const status = /FLOOD|SLOWMODE/.test(code) ? 429
    : /AUTH_KEY_UNREGISTERED|SESSION_REVOKED|SESSION_EXPIRED|USER_DEACTIVATED/.test(code) ? 401
      : /INVALID|EMPTY|EXPIRED|OCCUPIED|PASSWORD|SIGNUP|PHONE_CODE|EMAIL/.test(code) ? 400 : 502;
  const seconds = Number(error?.seconds);
  return new OwpenError(code, status, Number.isFinite(seconds) && seconds > 0 ? { seconds } : {});
}

/** Explicit mobile configuration; never reads process.env or operator sessions. */
export function readOwpenConfig(settings = {}) {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    throw new OwpenError('OWPENGRAM_API_CREDENTIALS_REQUIRED', 503);
  }
  const apiId = Number(settings.apiId);
  const apiHash = String(settings.apiHash || '').trim();
  if (!Number.isSafeInteger(apiId) || apiId <= 0 || apiId > 2147483647 || !/^[a-f0-9]{32}$/i.test(apiHash)) {
    throw new OwpenError('OWPENGRAM_API_CREDENTIALS_REQUIRED', 503);
  }
  if ((settings.host !== undefined && settings.host !== OWPENGRAM_SERVER.host)
    || (settings.port !== undefined && Number(settings.port) !== OWPENGRAM_SERVER.port)
    || (settings.webSocketUrl !== undefined && settings.webSocketUrl !== OWPENGRAM_SERVER.webSocketUrl)) {
    throw new OwpenError('OWPENGRAM_ENDPOINT_PIN_MISMATCH', 503);
  }
  const dcId = Number(settings.dcId ?? OWPENGRAM_SERVER.mainDcId);
  if (!OWPENGRAM_SERVER.dcIds.includes(dcId)) throw new OwpenError('OWPENGRAM_DC_INVALID', 503);
  const maxFileBytes = Number(settings.maxFileBytes ?? 20 * 1024 * 1024);
  if (!Number.isSafeInteger(maxFileBytes) || maxFileBytes < 1 || maxFileBytes > 2 * 1024 ** 3) {
    throw new OwpenError('OWPENGRAM_MAX_FILE_BYTES_INVALID', 503);
  }
  const config = { apiId, dcId, maxFileBytes };
  // Avoid accidental JSON/log spreads of the app's credential.
  Object.defineProperty(config, 'apiHash', { value: apiHash, enumerable: false });
  return Object.freeze(config);
}

/** Loligram's EmailSignupPhone.java encoding; this is not a Telegram API feature. */
export function encodeOwpenIdentifier(identifier) {
  const value = String(identifier || '').trim().toLowerCase();
  if (value.includes('@')) {
    if (!/^[a-z0-9._+\-]+@[a-z0-9.\-]+$/.test(value)) throw new OwpenError('EMAIL_INVALID', 400);
    const escapes = { '@': 'q0', '.': 'q1', '-': 'q2', '_': 'q3', '+': 'q4', q: 'q5' };
    const phoneNumber = '888' + Array.from(value, (character) => escapes[character] || character).join('');
    if (phoneNumber.length > 200) throw new OwpenError('EMAIL_INVALID', 400);
    return { phoneNumber, identifierKind: 'email' };
  }
  const phoneNumber = value.replace(/[\s()\-]/g, '');
  if (!/^\+?[1-9]\d{4,19}$/.test(phoneNumber)) throw new OwpenError('PHONE_NUMBER_INVALID', 400);
  return { phoneNumber, identifierKind: 'phone' };
}
