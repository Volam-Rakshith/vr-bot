// VR Bot — encryption for everything private that lives in your (public) repo.
// © VR DEVELOPMENTS
// AES-256-GCM, key derived from your passphrase with PBKDF2-SHA256 (200k rounds).
// Uses WebCrypto, so the SAME code runs in the panel (browser) and the bot (Node 20+).
// Envelope stored in files: {"vrenc":1,"alg":"AES-256-GCM","kdf":"PBKDF2-SHA256","iter":200000,"salt":"…","iv":"…","z":0,"ct":"…"}

const subtle = globalThis.crypto.subtle;
const ITER = 200000;
const keyCache = new Map();

export function b64encode(bytes) {
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  return btoa(s);
}
export function b64decode(str) {
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(str, 'base64'));
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function deriveKey(passphrase, saltB64, iter = ITER) {
  const ck = `${iter}|${saltB64}|${passphrase}`;
  if (keyCache.has(ck)) return keyCache.get(ck);
  const base = await subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  const key = await subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: b64decode(saltB64), iterations: iter },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
  );
  keyCache.set(ck, key);
  return key;
}

let sessionSalt = null; // one salt per process/session → the key is derived once
function getSalt() {
  if (!sessionSalt) sessionSalt = b64encode(globalThis.crypto.getRandomValues(new Uint8Array(16)));
  return sessionSalt;
}

async function streamThrough(bytes, stream) {
  const s = new Blob([bytes]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(s).arrayBuffer());
}
export const gzip = (b) => streamThrough(b, new CompressionStream('gzip'));
export const gunzip = (b) => streamThrough(b, new DecompressionStream('gzip'));

export function isEnvelope(obj) { return !!obj && typeof obj === 'object' && obj.vrenc === 1 && typeof obj.ct === 'string'; }

/** Encrypt bytes → envelope object. */
export async function encryptBytes(bytes, passphrase, { compress = false } = {}) {
  if (!passphrase) throw new Error('No passphrase set');
  const salt = getSalt();
  const key = await deriveKey(passphrase, salt);
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const body = compress ? await gzip(bytes) : bytes;
  const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv }, key, body));
  return { vrenc: 1, alg: 'AES-256-GCM', kdf: 'PBKDF2-SHA256', iter: ITER, salt, iv: b64encode(iv), z: compress ? 1 : 0, ct: b64encode(ct) };
}

/** Decrypt envelope → bytes. Throws "Wrong password" style error on failure. */
export async function decryptBytes(env, passphrase) {
  if (!isEnvelope(env)) throw new Error('Not an encrypted VR Bot file');
  const key = await deriveKey(passphrase, env.salt, env.iter || ITER);
  let pt;
  try {
    pt = new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: b64decode(env.iv) }, key, b64decode(env.ct)));
  } catch {
    const e = new Error('Wrong password (could not decrypt). The panel password must equal the VR_PASSPHRASE secret.');
    e.code = 'BAD_PASSPHRASE';
    throw e;
  }
  return env.z ? gunzip(pt) : pt;
}

export async function encryptJSON(obj, passphrase, opts) {
  return encryptBytes(new TextEncoder().encode(JSON.stringify(obj)), passphrase, opts);
}
export async function decryptJSON(env, passphrase) {
  return JSON.parse(new TextDecoder().decode(await decryptBytes(env, passphrase)));
}

/** Read a data file's parsed JSON: plaintext files pass through, envelopes are decrypted. */
export async function openData(parsed, passphrase) {
  if (isEnvelope(parsed)) return decryptJSON(parsed, passphrase);
  return parsed;
}

/** lock.json lets the panel and the bot check the password before touching anything. */
export async function makeLock(passphrase) {
  const env = await encryptJSON({ check: 'vr-bot-ok', at: new Date().toISOString() }, passphrase);
  return { about: 'Password check for VR Bot by VR DEVELOPMENTS. Safe to be public.', ...env };
}
export async function checkLock(lock, passphrase) {
  if (!lock || !isEnvelope(lock)) return null; // no lock yet
  try { const v = await decryptJSON(lock, passphrase); return v.check === 'vr-bot-ok'; } catch { return false; }
}
