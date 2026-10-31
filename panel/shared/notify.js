// VR Bot — phone notifications + the Sent log. Pure ES module: the SAME code runs in the panel and the bot.
// © VR DEVELOPMENTS
//
// settings.notify = {
//   enabled,                       // master switch
//   kinds: { scheduled, replies, ai, status, reports },   // which sends make a notification
//   selfReports: null | true | false,   // reports to your own WhatsApp chat (null = automatic, see selfReportsOn)
//   vapid: { publicKey, privateJwk }, subject,          // made by the panel on first "Allow"; lives ENCRYPTED
//   devices: [{ id, name, endpoint, keys: { p256dh, auth }, addedAt }],
//   testAt,                        // "Send test notification" → the bot sends one from GitHub
// }
// status.push (written by the bot) = { dev: { <epKey>: { ok, fail, err, dead } }, testFor, lastAt }
// outbox state file (vr-state branch, encrypted) = { entries: [{ id, t, cat, kind, to, num, text, people?, count?, clip? }] }
//   voice clips: kind "voice", clip "<clip name>", text "🎙️ Voice clip: <clip name>"
import { normalizeNumber } from './defaults.js';

export const SENT_CAP = 300;
export const SENT_MAX_DAYS = 14;
export const TEXT_MAX = 1000;
export const PUSH_LINE = 100;

/** Notification kinds, as shown in the panel. */
export const NOTIFY_KINDS = [
  ['scheduled', '🗓️ Scheduled messages', 'Schedules, birthdays, festivals, follow-ups, Send now'],
  ['replies', '💬 Auto-replies', 'Keyword rules, busy & away replies, group tools'],
  ['ai', '🧠 AI replies', 'Every reply the AI writes for you'],
  ['status', '📸 Status posts', 'Auto status & special-day cards'],
  ['reports', '📋 Reports', 'Daily summary, weekly report, birthday notes, alerts — when they are not sent to your own chat'],
];
export const CAT_ICON = { scheduled: '🗓️', replies: '💬', ai: '🧠', status: '📸', reports: '📋', self: '🙋', alert: '⚠️' };
export const CAT_LABEL = { scheduled: 'Scheduled', replies: 'Auto-reply', ai: 'AI reply', status: 'Status', reports: 'Report', self: 'My chat', alert: 'Alert' };

const SCHEDULED = new Set(['personal', 'broadcast', 'birthday', 'festival', 'followup', 'group', 'summary']);
// kind "class" = a class-mode auto-reply (cat replies).
// kind "voice" = one of your voice clips (auto-reply or schedule); its cat (replies / scheduled) says which.

/** Which notification kind a send belongs to. cat (given by the sender) wins; status posts are always "status". */
export function notifyCategory({ kind = '', cat = '', jid = '' } = {}) {
  if (jid === 'status@broadcast' || kind === 'status') return 'status';
  if (cat) return cat;
  if (kind === 'ai') return 'ai';
  if (SCHEDULED.has(kind)) return 'scheduled';
  return 'replies';
}

/** Short stable key for a push endpoint (FNV-1a), so the bot can remember dead ones without storing the URL twice. */
export function epKey(endpoint) {
  let h = 0x811c9dc5;
  const s = String(endpoint || '');
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36);
}

/** Is this device dead (its browser said "gone")? A device added again after that counts as alive. */
export function deviceDead(device, pushStatus = {}) {
  const st = pushStatus?.dev?.[epKey(device?.endpoint)];
  return !!(st?.dead && st.dead > (device?.addedAt || 0));
}
const validDevice = (d) => !!(d && /^https:\/\//.test(d.endpoint || '') && d.keys?.p256dh && d.keys?.auth);

/** Devices the bot should push to (valid, not dead). */
export function liveDevices(settings = {}, pushStatus = {}) {
  const n = settings.notify || {};
  if (!n.vapid?.publicKey || !n.vapid?.privateJwk?.d) return [];
  return (n.devices || []).filter((d) => validDevice(d) && !deviceDead(d, pushStatus));
}

/** Notifications switched on and at least one phone that can get them. */
export function pushReady(settings = {}, pushStatus = {}) {
  return !!settings.notify?.enabled && liveDevices(settings, pushStatus).length > 0;
}

/** Should a send of this kind make a notification? */
export function shouldNotify(settings = {}, cat, pushStatus = {}) {
  if (cat === 'self') return false; // you see these in your own chat anyway
  if (!pushReady(settings, pushStatus)) return false;
  if (cat === 'alert') return true; // critical (logged out, can't connect, couldn't send) — always
  return settings.notify?.kinds?.[cat] !== false;
}

/**
 * Do reports (daily summary, weekly report, birthday notes, busy-over, GitHub / website alerts, voice-note
 * transcripts) go to your own WhatsApp chat?
 *  - switch set in the panel (true/false) → that,
 *  - not set → OFF once notifications work on a phone, ON before that (old behaviour),
 *  - and if no phone can get notifications right now (none added, all expired) → ON, so nothing gets lost.
 */
export function selfReportsOn(settings = {}, pushStatus = {}) {
  const ready = pushReady(settings, pushStatus);
  if (!ready) return true;
  const v = settings.notify?.selfReports;
  if (v === true || v === false) return v;
  return false;
}

/** Text for the Sent log / notification from a WhatsApp message content. */
export function contentText(content = {}) {
  if (!content || typeof content !== 'object') return '';
  if (content.react) return `reacted ${content.react.text || ''}`.trim();
  if (typeof content.text === 'string') return content.text;
  if (content.image) return `📷 Photo${content.caption ? `: ${content.caption}` : ''}`;
  if (content.video) return `🎬 Video${content.caption ? `: ${content.caption}` : ''}`;
  if (content.sticker) return '🙂 Sticker';
  if (content.audio) return content.ptt ? '🎙️ Voice note' : '🎵 Audio';
  if (content.document) return `📄 ${content.fileName || 'Document'}`;
  if (content.delete) return '🗑️ Deleted a message';
  return '(message)';
}

const clip = (s, n) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

/** One line for a notification: "Mummy: Good morning…" */
function lineFor(it, n = PUSH_LINE) {
  if (it.cat === 'status') return `📸 Status → ${it.count ?? 0} people${it.text ? `: ${clip(it.text, n - 20)}` : ''}`;
  if (it.cat === 'reports') return `📋 ${clip(it.text, n)}`;
  return `${it.to || 'a chat'}: ${clip(it.text, n)}`;
}

/**
 * Notification for one or more sends (grouped when several go out close together).
 * Returns { title, body, url, tag, ts, n, items } — items carry the full text (capped) so the phone can show
 * them in the Sent log right away. The JSON stays under ~3 KB (Web Push payloads max out near 4 KB).
 */
export function buildPayload(items = [], { now = Date.now(), maxBytes = 3000 } = {}) {
  const list = items.filter(Boolean);
  let title, body;
  if (list.length === 1) {
    const it = list[0];
    if (it.cat === 'alert') { title = it.title || '⚠️ VR Bot'; body = clip(it.text, 240); }
    else if (it.cat === 'status') { title = `🤖 VR Bot posted a status → ${it.count ?? 0} ${it.count === 1 ? 'person' : 'people'}`; body = clip(it.text, PUSH_LINE) || 'Status posted'; }
    else if (it.cat === 'reports') { title = `📋 VR Bot ${it.title || 'report'}`; body = clip(it.text, 240); }
    else { title = `🤖 VR Bot → ${it.to || 'a chat'}`; body = clip(it.text, PUSH_LINE) || '(message)'; }
  } else {
    const people = [...new Set(list.map((x) => (x.cat === 'status' ? 'status' : x.cat === 'reports' ? 'report' : x.to)).filter(Boolean))];
    title = `🤖 VR Bot sent ${list.length} messages${people.length === 1 && people[0] !== 'status' && people[0] !== 'report' ? ` → ${people[0]}` : ''}`;
    const lines = list.slice(0, 5).map((x) => lineFor(x, 70));
    if (list.length > 5) lines.push(`+${list.length - 5} more`);
    body = lines.join('\n');
  }
  const out = { title, body, url: '#/sent', tag: `vr-${now}`, ts: now, n: list.length, items: list.map((x) => ({ id: x.id, t: x.t, cat: x.cat, kind: x.kind, to: x.to, num: x.num, text: String(x.text || '').slice(0, 600), count: x.count, ...(x.clip ? { clip: x.clip } : {}) })) };
  // keep the encrypted push small: shorten the item texts, then drop them
  for (const cap of [300, 120, 0]) {
    if (new TextEncoder().encode(JSON.stringify(out)).length <= maxBytes) break;
    out.items = cap ? out.items.map((x) => ({ ...x, text: x.text.slice(0, cap) })) : [];
  }
  return out;
}

/** Add one entry to the Sent log (newest last), keep at most SENT_CAP and nothing older than SENT_MAX_DAYS. */
export function appendSent(outbox, entry, { now = Date.now(), cap = SENT_CAP, maxDays = SENT_MAX_DAYS } = {}) {
  const box = outbox && typeof outbox === 'object' ? outbox : {};
  box.entries = Array.isArray(box.entries) ? box.entries : [];
  const e = { ...entry, t: entry.t || now, text: String(entry.text ?? '').slice(0, TEXT_MAX) };
  if (!e.id) e.id = `${e.t.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  box.entries.push(e);
  pruneSent(box, { now, cap, maxDays });
  return e;
}
export function pruneSent(box, { now = Date.now(), cap = SENT_CAP, maxDays = SENT_MAX_DAYS } = {}) {
  const cut = now - maxDays * 86400000;
  box.entries = (box.entries || []).filter((e) => (e.t || 0) >= cut).slice(-cap);
  return box;
}

/** Sent log for the panel: newest first, entries the phone got by notification merged in (no doubles). */
export function sentList(outbox, fromPush = []) {
  const seen = new Set();
  const all = [];
  for (const e of [...(outbox?.entries || []), ...(fromPush || [])]) {
    if (!e || !e.id || seen.has(e.id)) continue;
    seen.add(e.id); all.push(e);
  }
  return all.sort((a, b) => (b.t || 0) - (a.t || 0));
}

/** Status viewers for the Sent log / panel: contact name, else the number (+ "texted you lately"). You are left out. */
export function statusPeople(numbers = [], { contacts = [], self = [] } = {}) {
  const mine = new Set((Array.isArray(self) ? self : [self]).map((n) => normalizeNumber(n)).filter(Boolean));
  const byNum = new Map(contacts.filter((c) => c && c.number && !c.example).map((c) => [normalizeNumber(c.number), c]));
  const out = [];
  for (const raw of numbers) {
    const n = normalizeNumber(String(raw).split('@')[0]);
    if (!n || mine.has(n)) continue;
    const c = byNum.get(n);
    out.push(c ? { n, name: c.name || `+${n}` } : { n, name: `+${n}`, recent: true });
  }
  return out;
}
