// VR Bot — Web Push straight from the GitHub runner to your phone. No server, no extra package.
// © VR DEVELOPMENTS
//
// The panel makes a VAPID key pair (P-256) and subscribes your phone; both live ENCRYPTED in data/settings.json.
// Here the bot encrypts each notification for your phone (RFC 8291, aes128gcm), signs a VAPID token (RFC 8292)
// and POSTs it to the phone's push address (for Chrome on Android that is Google's push service, which only
// sees encrypted bytes). A failed notification NEVER stops a send: errors are logged and the bot carries on.
import crypto from 'node:crypto';
import { log } from '../log.js';
import { normalizeNumber, maskNumber } from '../../panel/shared/defaults.js';
import { notifyCategory, shouldNotify, selfReportsOn, liveDevices, pushReady, contentText, buildPayload, appendSent, epKey, statusPeople } from '../../panel/shared/notify.js';

const b64u = (buf) => Buffer.from(buf).toString('base64url');
const unb64u = (s) => Buffer.from(String(s || ''), 'base64url');
const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();

/**
 * RFC 8291 message encryption (Content-Encoding: aes128gcm), one record.
 * sub = { p256dh, auth } from the phone's subscription (base64url). opts.salt / opts.serverKeys only for tests.
 */
export function encryptPayload(plaintext, sub, { salt = crypto.randomBytes(16), serverKeys = null, rs = 4096 } = {}) {
  const uaPublic = unb64u(sub.p256dh);
  const authSecret = unb64u(sub.auth);
  if (uaPublic.length !== 65 || authSecret.length < 16) throw new Error('bad push subscription keys');
  const ecdh = serverKeys || crypto.createECDH('prime256v1');
  if (!serverKeys) ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const shared = ecdh.computeSecret(uaPublic);
  const prkKey = hmac(authSecret, shared);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]);
  const ikm = hmac(prkKey, Buffer.concat([keyInfo, Buffer.from([1])]));
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.from('Content-Encoding: aes128gcm\0\x01', 'binary')).subarray(0, 16);
  const nonce = hmac(prk, Buffer.from('Content-Encoding: nonce\0\x01', 'binary')).subarray(0, 12);
  const data = Buffer.concat([Buffer.from(plaintext), Buffer.from([2])]); // 0x02 = last (only) record
  if (data.length + 16 > rs) throw new Error('notification too big');
  const c = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const ct = Buffer.concat([c.update(data), c.final(), c.getAuthTag()]);
  const header = Buffer.alloc(21);
  salt.copy(header, 0);
  header.writeUInt32BE(rs, 16);
  header.writeUInt8(asPublic.length, 20);
  return Buffer.concat([header, asPublic, ct]);
}

/** RFC 8292 VAPID: { Authorization } header for this push address. vapid = { publicKey (raw, b64url), privateJwk } */
export function vapidAuth(endpoint, vapid, subject, { nowSec = Math.floor(Date.now() / 1000) } = {}) {
  const aud = new URL(endpoint).origin;
  const key = crypto.createPrivateKey({ key: { kty: 'EC', crv: 'P-256', x: vapid.privateJwk.x, y: vapid.privateJwk.y, d: vapid.privateJwk.d }, format: 'jwk' });
  const head = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const sub = /^(mailto:|https:)/.test(subject || '') ? subject : 'https://github.com/Volam-Rakshith/vr-bot';
  const body = b64u(JSON.stringify({ aud, exp: nowSec + 12 * 3600, sub }));
  const sig = crypto.sign('sha256', Buffer.from(`${head}.${body}`), { key, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${head}.${body}.${b64u(sig)}, k=${vapid.publicKey}`;
}

/** Send one push. Returns { ok, status, gone }. Never throws. */
export async function sendPush(device, payload, vapid, subject, { fetchImpl = globalThis.fetch, ttl = 86400, urgency = 'normal', timeoutMs = 10000 } = {}) {
  try {
    const body = encryptPayload(Buffer.from(JSON.stringify(payload)), device.keys);
    const r = await fetchImpl(device.endpoint, {
      method: 'POST',
      headers: { 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: String(ttl), Urgency: urgency, Authorization: vapidAuth(device.endpoint, vapid, subject) },
      body, signal: AbortSignal.timeout(timeoutMs),
    });
    const status = r.status;
    return { ok: status >= 200 && status < 300, status, gone: status === 404 || status === 410 };
  } catch (e) {
    return { ok: false, status: 0, gone: false, error: e.message };
  }
}

/**
 * The bot's notifier: records every send in the Sent log (state.outbox) and pushes notifications,
 * grouping sends that go out within a few seconds of each other into one notification.
 */
export class Notifier {
  constructor({ getData, state, me = () => '', owner = '', fetchImpl, windowMs = 8000, maxWaitMs = 30000 } = {}) {
    this.getData = getData; this.state = state; this.me = me; this.owner = owner;
    this.fetchImpl = fetchImpl || ((...a) => globalThis.fetch(...a));
    this.windowMs = windowMs; this.maxWaitMs = maxWaitMs;
    this.queue = []; this.timer = null; this.firstAt = 0; this.flushing = Promise.resolve();
    state.outbox = state.outbox && typeof state.outbox === 'object' ? state.outbox : { entries: [] };
    state.status.push = state.status.push || { dev: {} };
    state.status.push.dev = state.status.push.dev || {};
  }
  settings() { return this.getData().settings; }
  pushStatus() { return this.state.status.push; }
  /** Reports to your own chat? (panel switch; automatic = off once a phone gets notifications) */
  selfReports() { try { return selfReportsOn(this.settings(), this.pushStatus()); } catch { return true; } }
  ready() { try { return pushReady(this.settings(), this.pushStatus()); } catch { return false; } }

  /** Who a send went to, for people: contact name → WhatsApp name → number. */
  resolve(jid, to = {}) {
    const d = this.getData();
    if (jid === 'status@broadcast') return { to: 'My status', num: '' };
    if (String(jid).endsWith('@g.us')) {
      const g = (this.state.status.groups || []).find((x) => x.id === jid);
      return { to: to.name || g?.name || 'a group', num: '', group: true };
    }
    let num = to.number ? normalizeNumber(to.number) : '';
    if (!num && /@s\.whatsapp\.net$/.test(String(jid))) num = String(jid).split('@')[0].split(':')[0];
    const mine = [normalizeNumber(this.owner || ''), normalizeNumber(this.me() || '')].filter(Boolean);
    if (to.self || (num && mine.includes(num))) return { to: 'You', num, self: true };
    const c = num ? (d.contacts || []).find((x) => x && x.number && normalizeNumber(x.number) === num) : null;
    return { to: c?.name || to.name || (num ? `+${num}` : 'a chat'), num };
  }

  /** Called after every successful WhatsApp send. Never throws. */
  sent(jid, content, { kind = '', cat = '', to = {}, label = '', clip = '' } = {}) {
    try {
      const r = this.resolve(jid, to);
      let c = r.self ? 'self' : notifyCategory({ kind, cat, jid });
      const entry = appendSent(this.state.outbox, { cat: c, kind, to: r.to, num: r.num ? maskNumber(r.num) : '', text: label || contentText(content), ...(clip ? { clip } : {}) });
      if (!content?.react && !content?.delete) this.queuePush(entry);
      return entry;
    } catch (e) { log.warn(`Sent log / notification skipped: ${e.message}`); return null; }
  }

  /** A status post: who saw it goes into the Sent log; one notification "posted a status → N people". */
  status(content, numbers = [], { label = '' } = {}) {
    try {
      const d = this.getData();
      const people = statusPeople(numbers, { contacts: d.contacts || [], self: [this.owner, this.me()] });
      const entry = appendSent(this.state.outbox, { cat: 'status', kind: 'status', to: 'My status', text: contentText(content) + (label ? ` (${label})` : ''), people: people.slice(0, 500), count: people.length });
      this.queuePush(entry);
      return entry;
    } catch (e) { log.warn(`Sent log / notification skipped: ${e.message}`); return null; }
  }

  /** A report that would have gone to your own chat: Sent log + notification (when switched on). */
  report(text, title = 'report') {
    try {
      const entry = appendSent(this.state.outbox, { cat: 'reports', kind: 'report', to: 'You', text: String(text || ''), title });
      this.queuePush(entry);
      return entry;
    } catch (e) { log.warn(`Report notification skipped: ${e.message}`); return null; }
  }

  /** Critical: always notifies (when a phone is set up), right away, not grouped. */
  async critical(title, text) {
    try {
      if (!this.ready()) return false;
      const entry = { id: `a${Date.now().toString(36)}`, t: Date.now(), cat: 'alert', title, text };
      return await this.pushNow([entry], 'high');
    } catch (e) { log.warn(`Alert notification failed: ${e.message}`); return false; }
  }

  queuePush(entry) {
    if (!shouldNotify(this.settings(), entry.cat, this.pushStatus())) return;
    this.queue.push(entry);
    const now = Date.now();
    if (!this.firstAt) this.firstAt = now;
    clearTimeout(this.timer);
    const wait = Math.max(0, Math.min(this.windowMs, this.firstAt + this.maxWaitMs - now));
    this.timer = setTimeout(() => { this.flush().catch(() => {}); }, wait);
    this.timer.unref?.();
  }

  /** Send what is queued now (also called before a run ends). */
  async flush() {
    clearTimeout(this.timer); this.timer = null;
    const items = this.queue.splice(0, this.queue.length);
    this.firstAt = 0;
    const job = this.flushing.then(() => (items.length ? this.pushNow(items) : false)).catch(() => false);
    this.flushing = job;
    return job;
  }

  /** Push to every live phone. Marks phones whose browser says "gone" (404/410) as dead. */
  async pushNow(items, urgency = 'normal') {
    const S = this.settings();
    const n = S.notify || {};
    const devices = liveDevices(S, this.pushStatus());
    if (!devices.length) return false;
    const payload = buildPayload(items);
    const st = this.pushStatus();
    const res = await Promise.all(devices.map((dv) => sendPush(dv, payload, n.vapid, n.subject, { fetchImpl: this.fetchImpl, urgency }).then((r) => ({ dv, r }))));
    let any = false;
    for (const { dv, r } of res) {
      const k = epKey(dv.endpoint);
      const rec = st.dev[k] = { ...(st.dev[k] || {}), name: dv.name || '' };
      if (r.ok) { rec.ok = Date.now(); rec.err = ''; any = true; }
      else {
        rec.fail = Date.now(); rec.err = r.error || `HTTP ${r.status}`;
        if (r.gone) { rec.dead = Date.now(); log.warn(`Notifications: a phone (${dv.name || 'device'}) is no longer subscribed — turn notifications on again in the panel`); }
        else log.warn(`Notification not delivered (${rec.err}) — the message itself was sent`);
      }
    }
    if (any) st.lastAt = Date.now();
    return any;
  }

  /** "Send test notification" in the panel → one push from GitHub (once per tap). */
  async checkTest() {
    try {
      const n = this.settings().notify || {};
      const st = this.pushStatus();
      if (!n.testAt || n.testAt === st.testFor || Date.now() - n.testAt > 86400000) return false;
      st.testFor = n.testAt;
      if (!liveDevices(this.settings(), st).length) return false;
      const ok = await this.pushNow([{ id: `test${n.testAt}`, t: Date.now(), cat: 'alert', title: '✅ VR Bot test', text: 'Notifications from your bot work. You will get one like this every time the bot sends a message.' }]);
      log.info(ok ? 'Test notification sent' : 'Test notification could not be delivered');
      return ok;
    } catch (e) { log.warn(`Test notification failed: ${e.message}`); return false; }
  }
}
