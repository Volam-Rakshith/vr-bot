// VR Bot — Groq free-plan limits (429). Works out WHEN the limit resets and remembers it per key,
// so no more Groq calls are made with that key until then. © VR DEVELOPMENTS
//   • retry-after header (seconds or a date)
//   • x-ratelimit-reset-requests / x-ratelimit-reset-tokens ("2m59.56s", "7.66s", "1h2m3s")
//   • the error text: "... Please try again in 1h12m3.5s."
// The store is the bot's memory (state.memory.groqLimit = { main|bot: untilMs }), so it survives runs.
import { env } from '../env.js';

const FALLBACK_MS = 60000; // a 429 with no hint at all → wait a minute

/** "1h2m3.5s" / "2m59.56s" / "7.66s" / "500ms" / "120" (seconds) → ms, or null. */
export function parseDuration(s) {
  const t = String(s ?? '').trim();
  if (!t) return null;
  if (/^\d+(\.\d+)?$/.test(t)) return Math.round(Number(t) * 1000);
  let ms = 0, hit = false;
  for (const m of t.matchAll(/(\d+(?:\.\d+)?)\s*(ms|h|m|s)/g)) {
    hit = true;
    const n = Number(m[1]);
    ms += m[2] === 'h' ? n * 3600000 : m[2] === 'm' ? n * 60000 : m[2] === 's' ? n * 1000 : n;
  }
  return hit ? Math.round(ms) : null;
}

/**
 * How long until a 429 limit resets, in ms (never null: falls back to 1 minute).
 * headers: a fetch Headers (or a plain object); body: the error text Groq sent back.
 */
export function resetMs(headers, body = '', now = Date.now()) {
  const h = (k) => {
    if (!headers) return null;
    if (typeof headers.get === 'function') return headers.get(k);
    const key = Object.keys(headers).find((x) => x.toLowerCase() === k);
    return key ? headers[key] : null;
  };
  const c = [];
  const ra = h('retry-after');
  if (ra != null && ra !== '') {
    const d = parseDuration(ra);
    if (d != null) c.push(d);
    else { const at = Date.parse(ra); if (!Number.isNaN(at)) c.push(at - now); }
  }
  const m = String(body || '').match(/try again in\s+((?:\d+(?:\.\d+)?\s*(?:ms|h|m|s)\s*)+)/i);
  if (m) { const d = parseDuration(m[1]); if (d != null) c.push(d); }
  const remReq = h('x-ratelimit-remaining-requests'), remTok = h('x-ratelimit-remaining-tokens');
  const rr = parseDuration(h('x-ratelimit-reset-requests')), rt = parseDuration(h('x-ratelimit-reset-tokens'));
  // the reset of the limit that is actually used up (both unknown → the reset headers count too)
  if (rr != null && (String(remReq) === '0' || (!c.length && remTok == null))) c.push(rr);
  if (rt != null && (String(remTok) === '0' || (!c.length && remReq == null))) c.push(rt);
  const best = c.filter((x) => Number.isFinite(x) && x > 0);
  return best.length ? Math.max(...best) : FALLBACK_MS;
}

/** "2h 15m" / "5m" / "1m" (rounded up to the minute; days shown as hours). */
export function humanTime(ms) {
  const min = Math.max(1, Math.ceil((Number(ms) || 0) / 60000));
  const h = Math.floor(min / 60), m = min % 60;
  return h ? (m ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
}

export class RateLimitError extends Error {
  constructor(keyId, until, skipped = false) {
    super(`Groq limit reached (${keyId} key) until ${new Date(until).toISOString()}${skipped ? ' — call skipped' : ''}`);
    this.rateLimit = true; this.status = 429; this.keyId = keyId; this.until = until; this.skipped = skipped;
  }
}

/* ---- which key ---- */
/** The key "as VR" AI replies, quotes and voice notes use. */
export const mainKey = () => env.groqKey || '';
/** The key VR Bot mode uses: GROQ_API_KEY_BOT if set, else GROQ_API_KEY. */
export const botKey = () => env.groqKeyBot || env.groqKey || '';
/** Which limit a bot-mode call counts against ("bot" only when it really has its own key). */
export const botKeyId = () => (env.groqKeyBot ? 'bot' : 'main');

/* ---- the store ---- */
let store = {};
/** Point the limit store at the bot's memory (state.memory.groqLimit). */
export function useLimitStore(mem) {
  if (!mem) { store = {}; return store; }
  mem.groqLimit = mem.groqLimit && typeof mem.groqLimit === 'object' ? mem.groqLimit : {};
  store = mem.groqLimit;
  return store;
}
/** Until when this key is limited (ms), or 0 when it can be used. */
export function limitedUntil(keyId, now = Date.now()) {
  const u = Number(store[keyId] || 0);
  if (u && u <= now) { delete store[keyId]; return 0; }
  return u;
}
/** Throw (without calling Groq) while this key is limited. */
export function checkLimit(keyId, now = Date.now()) {
  const u = limitedUntil(keyId, now);
  if (u) throw new RateLimitError(keyId, u, true);
}
/** A 429 came back: remember until when, and return the error to throw. */
export function noteLimit(keyId, headers, body, now = Date.now()) {
  const until = now + resetMs(headers, body, now);
  store[keyId] = Math.max(Number(store[keyId] || 0), until);
  return new RateLimitError(keyId, store[keyId]);
}
