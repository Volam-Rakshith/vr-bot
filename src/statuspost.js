// VR Bot — posting a WhatsApp status that really shows up, and knowing whether it did.
// © VR DEVELOPMENTS
//
// Why this file exists (Oct 2026):
//  • On Baileys 7.0.0-rc14, sock.sendMessage('status@broadcast', …) resolves as if all went well even when the
//    WhatsApp server REJECTS the post. The server's answer is an <ack error="479"> that Baileys only logs
//    (WhiskeySockets/Baileys#2794: "status@broadcast always rejected with ack error=479 on LID-migrated accounts
//    (root cause of 'returns 200 but status never shows')"; same symptom in #2072, #2084, #2118, #1196).
//  • The rejections come from the recipient list: on accounts that moved to WhatsApp's new "LID" ids, a list of
//    phone-number ids (…@s.whatsapp.net) can be refused, and a list that MIXES phone-number and LID ids is always
//    refused (tulir/whatsmeow#1293: PN-only ok, LID-only ok, mixed → error). The fix proposed upstream resolves
//    every recipient to its LID and adds your own LID (Baileys PR #2841, whatsmeow PR #1294) — not released yet.
//  • `broadcast: true` (in the Baileys docs) does nothing in rc14; it is only a type.
// So: build the message once, then send it with ONE consistent kind of id per try, LID first, and WAIT for the
// server's answer. A rejected try shows nothing anywhere, so trying the next way can never make a double status.
// The first try the server accepts is remembered and used first next time.

export const STATUS_JID = 'status@broadcast';
export const ACK_WAIT_MS = 12000;      // the server normally answers in < 1 s
export const RECEIPT_WAIT_MS = 6000;   // extra time to hear "delivered" from your phone

/** 'user@server' for a person: device / agent removed, digits → phone id, c.us → s.whatsapp.net. '' if not a person. */
export function personJid(x) {
  const s = String(x || '').trim().toLowerCase();
  if (!s) return '';
  if (!s.includes('@')) { const d = s.replace(/\D/g, ''); return d.length >= 8 ? `${d}@s.whatsapp.net` : ''; }
  let [user, server] = s.split('@');
  user = user.split(':')[0].split('_')[0];
  if (server === 'c.us') server = 's.whatsapp.net';
  if (server === 's.whatsapp.net') user = user.replace(/\D/g, '');
  else if (server !== 'lid') return '';
  return user ? `${user}@${server}` : '';
}

/**
 * The status audience in ONE kind of id (never mixed).
 *  mode 'pn'  → your phone id first, then every number as …@s.whatsapp.net
 *  mode 'lid' → your LID first, then every number's LID (lidOf: Map phone-jid → lid-jid); numbers without a known LID are left out
 *  me = sock.user ({ id, lid }); numbers = phone numbers (digits / jids) of the people who should see it (you may be in it).
 */
export function statusRecipients({ me = {}, numbers = [], mode = 'pn', lidOf = new Map() } = {}) {
  const ownPn = personJid(me.id);
  const ownLid = personJid(me.lid);
  const jids = [];
  const dropped = [];
  const seen = new Set();
  const add = (j) => { if (j && !seen.has(j)) { seen.add(j); jids.push(j); } };
  if (mode === 'lid') {
    if (!ownLid.endsWith('@lid')) throw new Error('this WhatsApp account has no LID');
    add(ownLid);
  } else if (ownPn) add(ownPn);
  for (const n of numbers) {
    const pn = personJid(n);
    if (!pn || pn === ownPn || pn === ownLid) continue; // you are already first
    if (mode === 'lid') {
      if (pn.endsWith('@lid')) { add(pn); continue; }
      const lid = personJid(lidOf.get(pn));
      if (lid.endsWith('@lid')) add(lid); else dropped.push(pn);
    } else if (pn.endsWith('@s.whatsapp.net')) add(pn);
    else dropped.push(pn);
  }
  return { mode, jids, dropped };
}

/** The ways of sending, best first. plain = without the "reporting token" Baileys adds (WhatsApp Web and whatsmeow send none by default). */
export const VARIANTS = [
  { id: 'lid', mode: 'lid', plain: false, label: 'LID ids' },
  { id: 'pn', mode: 'pn', plain: false, label: 'phone-number ids' },
  { id: 'lid-plain', mode: 'lid', plain: true, label: 'LID ids, no reporting token' },
  { id: 'pn-plain', mode: 'pn', plain: true, label: 'phone-number ids, no reporting token' },
];

/** Order to try: the one that worked last time first; LID ways only if the account has a LID. */
export function variantOrder({ hasLid = false, remembered = '' } = {}) {
  const ok = VARIANTS.filter((v) => hasLid || v.mode !== 'lid');
  const first = ok.find((v) => v.id === remembered);
  return first ? [first, ...ok.filter((v) => v !== first)] : ok;
}

/** Watches the raw connection for the server's answer (ack) and delivery receipts of the messages we care about. */
export class AckWatch {
  constructor() { this.want = new Map(); }
  /** ws = sock.ws (an EventEmitter of Baileys' "CB:…" events) */
  attach(ws) {
    if (!ws?.on) return;
    ws.on('CB:ack,class:message', (node) => this.onAck(node));
    ws.on('CB:receipt', (node) => this.onReceipt(node));
  }
  expect(id) { const w = { ack: null, receipts: [], waiters: [] }; this.want.set(id, w); return w; }
  onAck(node) {
    const a = node?.attrs || {};
    const w = this.want.get(a.id);
    if (!w || w.ack) return;
    w.ack = { error: a.error ? String(a.error) : '', at: Date.now() };
    for (const f of w.waiters.splice(0)) f();
  }
  onReceipt(node) {
    const a = node?.attrs || {};
    const ids = [a.id];
    const list = (Array.isArray(node?.content) ? node.content : []).find((c) => c?.tag === 'list');
    for (const it of (Array.isArray(list?.content) ? list.content : [])) if (it?.attrs?.id) ids.push(it.attrs.id);
    for (const id of ids) {
      const w = this.want.get(id);
      if (w) w.receipts.push({ from: a.participant || a.from || '', type: a.type || 'delivery', at: Date.now() });
    }
  }
  /** Resolves with { error } once the server answered, or null after ms. */
  waitAck(id, ms) {
    const w = this.want.get(id) || this.expect(id);
    if (w.ack) return Promise.resolve(w.ack);
    return new Promise((resolve) => {
      const t = setTimeout(() => resolve(w.ack), ms);
      w.waiters.push(() => { clearTimeout(t); resolve(w.ack); });
    });
  }
  receipts(id) { return this.want.get(id)?.receipts || []; }
  done(id) { this.want.delete(id); }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isPng = (b) => Buffer.isBuffer(b) && b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
const isWebp = (b) => Buffer.isBuffer(b) && b.length > 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP';
const isJpeg = (b) => Buffer.isBuffer(b) && b.length > 3 && b[0] === 0xff && b[1] === 0xd8;

/**
 * Pictures go out as real JPEG. Baileys labels EVERY photo "image/jpeg" (Utils/messages.js MIMETYPE_MAP), so a PNG
 * card would travel as PNG bytes with a JPEG label. sharp is already a dependency. Anything that fails → unchanged.
 */
export async function asJpeg(buf, { loadSharp = () => import('sharp').then((m) => m.default) } = {}) {
  if (!Buffer.isBuffer(buf) || isJpeg(buf) || !(isPng(buf) || isWebp(buf))) return buf;
  try {
    const sharp = await loadSharp();
    return await sharp(buf).flatten({ background: '#000000' }).jpeg({ quality: 90, mozjpeg: true }).toBuffer();
  } catch { return buf; }
}

/** Same content, picture as a JPEG buffer (photo links are downloaded first; a failed download is left to Baileys). */
export async function prepareStatusContent(content, { fetchImpl = globalThis.fetch, loadSharp } = {}) {
  if (!content?.image) return content;
  let img = content.image;
  if (!Buffer.isBuffer(img) && /^https:\/\//i.test(img?.url || '') && fetchImpl) {
    try {
      const r = await fetchImpl(img.url, { signal: AbortSignal.timeout(20000) });
      if (r.ok) { const b = Buffer.from(await r.arrayBuffer()); if (b.length && b.length < 15 * 1024 * 1024) img = b; }
    } catch { /* Baileys downloads it itself */ }
  }
  if (!Buffer.isBuffer(img)) return content;
  const jpg = await asJpeg(img, loadSharp ? { loadSharp } : undefined);
  return { ...content, image: jpg, ...(isJpeg(jpg) ? { mimetype: 'image/jpeg' } : {}) };
}

/** A copy of the message without the reporting secret (→ relayMessage adds no <reporting> node). */
export function withoutReporting(message) {
  const m = { ...message };
  if (m.messageContextInfo) { m.messageContextInfo = { ...m.messageContextInfo }; delete m.messageContextInfo.messageSecret; }
  return m;
}

/**
 * Post a status and find out what WhatsApp said.
 *  deps: { sock, watch (AckWatch), build(content, look) → proto message, newId() → message id, log }
 *  numbers: the people who should see it (phone numbers); you are always added.
 *  remembered: the variant id that worked last time.
 * Returns { state: 'accepted' | 'rejected' | 'unknown', variant, label, id, people, dropped, delivered, tries }
 *   accepted = the WhatsApp server took it (ack without error)  ·  delivered = a device sent a delivery receipt (e.g. your phone)
 *   rejected = every way was refused (nothing was posted)       ·  unknown   = no answer in time (it may or may not show)
 */
export async function postStatusChecked({ sock, watch, build, newId, log = console }, content, { numbers = [], look = {}, remembered = '', ackWaitMs = ACK_WAIT_MS, receiptWaitMs = RECEIPT_WAIT_MS } = {}) {
  const me = sock.user || {};
  const hasLid = personJid(me.lid).endsWith('@lid');
  const order = variantOrder({ hasLid, remembered });
  const lidOf = new Map();
  if (hasLid) {
    const pns = [...new Set(numbers.map(personJid).filter((j) => j.endsWith('@s.whatsapp.net') && j !== personJid(me.id)))];
    if (pns.length) {
      try {
        const pairs = await sock.signalRepository?.lidMapping?.getLIDsForPNs?.(pns);
        for (const p of pairs || []) lidOf.set(personJid(p.pn), personJid(p.lid));
      } catch (e) { log.warn?.(`Status: could not look up the new WhatsApp ids of your contacts (${e.message})`); }
    }
  }
  const message = await build(content, look); // uploads a picture once, reused by every try
  const tries = [];
  for (const v of order) {
    let r;
    try { r = statusRecipients({ me, numbers, mode: v.mode, lidOf }); } catch (e) { tries.push({ variant: v.id, result: 'skipped', error: e.message }); continue; }
    const id = newId();
    watch.expect(id);
    try {
      await sock.relayMessage(STATUS_JID, v.plain ? withoutReporting(message) : message, { messageId: id, statusJidList: r.jids });
    } catch (e) {
      watch.done(id);
      tries.push({ variant: v.id, result: 'error', error: e.message });
      log.warn?.(`Status try "${v.label}" could not be sent: ${e.message}`);
      continue;
    }
    const ack = await watch.waitAck(id, ackWaitMs);
    const base = { variant: v.id, label: v.label, id, people: r.jids.length, dropped: r.dropped.length };
    if (!ack) {
      watch.done(id);
      tries.push({ variant: v.id, result: 'no answer' });
      return { state: 'unknown', ...base, delivered: false, tries };
    }
    if (ack.error) {
      watch.done(id);
      tries.push({ variant: v.id, result: 'rejected', error: ack.error });
      log.warn?.(`WhatsApp rejected the status sent with ${v.label} (error ${ack.error}) — nothing was posted; trying the next way`);
      continue;
    }
    tries.push({ variant: v.id, result: 'accepted' });
    const t0 = Date.now();
    while (!watch.receipts(id).length && Date.now() - t0 < receiptWaitMs) await sleep(250);
    const receipts = watch.receipts(id);
    watch.done(id);
    return { state: 'accepted', ...base, delivered: receipts.length > 0, receipts: receipts.length, tries };
  }
  return { state: 'rejected', variant: '', label: '', id: '', people: 0, dropped: 0, delivered: false, tries };
}

/** One line for logs / your self-chat. */
export function describeStatusResult(r) {
  if (!r) return '';
  if (r.state === 'sent') return 'handed to WhatsApp';
  if (r.state === 'accepted') return `WhatsApp accepted it${r.delivered ? ' and a phone confirmed delivery' : ''} (${r.label}${r.tries?.length > 1 ? `, try ${r.tries.length}` : ''})`;
  if (r.state === 'unknown') return `sent, but WhatsApp did not answer in time (${r.label}) — it may or may not show`;
  const errs = [...new Set((r.tries || []).map((t) => t.error).filter(Boolean))].join(', ');
  return `WhatsApp REJECTED it every way it was tried${errs ? ` (error ${errs})` : ''} — nothing was posted`;
}
