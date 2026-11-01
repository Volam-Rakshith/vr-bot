// VR Bot — group admin helpers shared by the bot and the panel (Group tools page).
// Warns before kick, goodbye message, anti-spam, night lock (!lock 23:00-07:00), !mute 30m.
// Pure functions only (no WhatsApp here) so they are easy to test. © VR DEVELOPMENTS
import { zonedParts, pad } from './time.js';

/** Per-group defaults for the new tools (the panel and the bot fill missing values from these). */
export const GROUP_ADMIN_DEFAULTS = {
  warn: { limit: 3 },                                            // "Warns before kick" (1–50)
  goodbye: { enabled: false, message: '👋 {name} left {group}. Bye!' },
  antiSpam: { enabled: false, count: 4, seconds: 20 },          // same text ≥ count times within seconds
  lock: { enabled: false, from: '23:00', to: '07:00' },         // nightly auto mute / unmute
  slow: { enabled: false, seconds: 30 },                        // slow mode: 1 message per person per N seconds
  badWords: { enabled: false, words: [] },                      // bad-word filter (delete + 1 warn)
};
export const GROUP_ADMIN_LIMITS = { warnMin: 1, warnMax: 50, spamCountMin: 2, spamCountMax: 20, spamSecondsMin: 5, spamSecondsMax: 600, slowMin: 5, slowMax: 600, pollMin: 2, pollMax: 12, summaryDefault: 50, summaryMax: 200, bufferMax: 200, reportsPerHour: 5, muteMaxMs: 7 * 86400000 };

/** The owner-only group admin commands → the commands.enabled flag that switches each one on/off. */
export const ADMIN_COMMANDS = {
  kick: 'kick', add: 'add', mute: 'mute', unmute: 'mute', del: 'del', delete: 'del',
  warn: 'warn', warns: 'warn', unwarn: 'warn', link: 'link', resetlink: 'link', revoke: 'link',
  setname: 'setname', setdesc: 'setdesc', lock: 'lock', slow: 'slow', slowmode: 'slow',
  pin: 'pin', unpin: 'pin', poll: 'poll', summary: 'summary', summarize: 'summary',
};
export const ADMIN_FLAGS = ['kick', 'add', 'mute', 'del', 'warn', 'link', 'setname', 'setdesc', 'lock', 'slow', 'pin', 'poll', 'summary'];
/** Pin durations WhatsApp allows (seconds). */
export const PIN_TIMES = { '24h': 86400, '1d': 86400, '7d': 604800, '30d': 2592000 };

const int = (v, d, lo, hi) => { const n = Math.round(Number(v)); return Number.isFinite(n) && v !== null && v !== '' ? Math.min(hi, Math.max(lo, n)) : d; };

/** "Warns before kick" for a group: default 3, kept inside 1–50. */
export function warnLimitOf(cfg) {
  return int(cfg?.warn?.limit, GROUP_ADMIN_DEFAULTS.warn.limit, GROUP_ADMIN_LIMITS.warnMin, GROUP_ADMIN_LIMITS.warnMax);
}
/** Anti-spam settings for a group (off unless switched on in the panel). */
export function spamCfgOf(cfg) {
  const a = cfg?.antiSpam || {};
  const L = GROUP_ADMIN_LIMITS, D = GROUP_ADMIN_DEFAULTS.antiSpam;
  return { enabled: a.enabled === true, count: int(a.count, D.count, L.spamCountMin, L.spamCountMax), seconds: int(a.seconds, D.seconds, L.spamSecondsMin, L.spamSecondsMax) };
}
/** Slow mode seconds for a group (default 30, 5–600). */
export function slowSecondsOf(v) {
  return int(v, GROUP_ADMIN_DEFAULTS.slow.seconds, GROUP_ADMIN_LIMITS.slowMin, GROUP_ADMIN_LIMITS.slowMax);
}
export function slowCfgOf(cfg) {
  const s = cfg?.slow || {};
  return { enabled: s.enabled === true, seconds: slowSecondsOf(s.seconds) };
}
export function badWordsCfgOf(cfg) {
  const b = cfg?.badWords || {};
  const words = [...new Set((Array.isArray(b.words) ? b.words : [b.words || '']).flatMap((w) => String(w).split(/[,\n]/)).map((w) => w.trim()).filter(Boolean))];
  return { enabled: b.enabled === true, words };
}
export function goodbyeCfgOf(cfg) {
  const g = cfg?.goodbye || {};
  return { enabled: g.enabled === true, message: String(g.message || '').trim() || GROUP_ADMIN_DEFAULTS.goodbye.message };
}

/** "30m" / "2h" / "1h30m" / "45 min" / "1d" → milliseconds (null if not a duration). Max 7 days. */
export function parseDuration(s) {
  const t = String(s || '').toLowerCase().replace(/\s+/g, '');
  if (!t || !/^(\d+(d|days?|h|hrs?|hours?|m|mins?|minutes?))+$/.test(t)) return null;
  let ms = 0;
  for (const [, n, u] of t.matchAll(/(\d+)([a-z]+)/g)) ms += Number(n) * (u.startsWith('d') ? 86400000 : u.startsWith('h') ? 3600000 : 60000);
  if (!ms) return null;
  return Math.min(ms, GROUP_ADMIN_LIMITS.muteMaxMs);
}
/** 90 min → "1h 30m" */
export function durationText(ms) {
  const m = Math.round(ms / 60000), d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60;
  return [d && `${d}d`, h && `${h}h`, mm && `${mm}m`].filter(Boolean).join(' ') || '1m';
}

/** "23:00" / "11pm" / "11:30pm" / "7" / "7am" / "0730" → "HH:MM" (null if not a time). */
export function parseClock(s) {
  const t = String(s || '').trim().toLowerCase().replace(/\s+/g, '').replace(/\./g, ':');
  const m = t.match(/^(\d{1,2})(?::?(\d{2}))?(am|pm)?$/);
  if (!m) return null;
  let h = Number(m[1]); const mi = Number(m[2] || 0);
  if (mi > 59) return null;
  if (m[3]) { if (h < 1 || h > 12) return null; h = (h % 12) + (m[3] === 'pm' ? 12 : 0); }
  if (h > 23) return null;
  return `${pad(h)}:${pad(mi)}`;
}
/** "!lock 23:00-07:00" / "11pm-7am" / "23 to 7" → { from, to } (null if not a range or from = to). */
export function parseLockRange(s) {
  const parts = String(s || '').trim().toLowerCase().split(/\s*(?:-|–|—|to)\s*/).filter(Boolean);
  if (parts.length !== 2) return null;
  const from = parseClock(parts[0]), to = parseClock(parts[1]);
  if (!from || !to || from === to) return null;
  return { from, to };
}
/** Is `when` inside the nightly window? Works across midnight (23:00–07:00). Uses the bot's timezone (India by default). */
export function inLockWindow(when, from, to, tz = 'Asia/Kolkata') {
  if (!from || !to || from === to) return false;
  const p = zonedParts(new Date(when), tz);
  const now = `${pad(p.hour)}:${pad(p.minute)}`;
  return from < to ? now >= from && now < to : now >= from || now < to;
}

/**
 * Anti-spam counter: same text from the same person ≥ count times within `seconds`.
 * hit() returns the message keys to delete when the limit is reached (then a warn is added),
 * and right after that, further copies inside the window come back one by one (deleted, no extra warn
 * until the count is reached again). Lives in memory: a flood happens within one run.
 */
export class SpamTracker {
  constructor() { this.seen = new Map(); }
  static norm(text) { return String(text || '').toLowerCase().replace(/\s+/g, ' ').trim(); }
  /** → { trigger: boolean, keys: [msgKey…] } — keys to delete (empty = nothing to do) */
  hit({ group, sender, text, ts, key }, { count, seconds }) {
    const t = SpamTracker.norm(text);
    if (!t) return { trigger: false, keys: [] };
    const id = `${group}|${sender}|${t}`, win = seconds * 1000;
    const s = this.seen.get(id) || { list: [], hotUntil: 0 };
    s.list = s.list.filter((x) => ts - x.ts < win && x.ts <= ts);
    s.list.push({ ts, key });
    // forget old people/texts so this never grows without end
    if (this.seen.size > 2000) for (const [k, v] of this.seen) if (!v.list.length || ts - v.list.at(-1).ts > win) this.seen.delete(k);
    this.seen.set(id, s);
    if (s.list.length >= count) {
      const keys = s.list.map((x) => x.key);
      s.list = []; s.hotUntil = ts + win;
      return { trigger: true, keys };
    }
    if (ts < s.hotUntil) { s.list.length && (s.hotUntil = ts + win); return { trigger: false, keys: [key] }; } // still flooding → delete this copy too
    return { trigger: false, keys: [] };
  }
}

/* ---- bad-word filter ---- */
const LEET = { '@': 'a', '4': 'a', '0': 'o', '1': 'i', '3': 'e', '$': 's', '5': 's', '7': 't' };
/** lower-case, simple leetspeak back to letters ("@ss" → "ass", "sh1t" → "shit"), accents removed. */
export function normWords(text) {
  return String(text || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/(?<=\p{L})!+(?=\p{L})/gu, 'i') // "sh!t" → "shit" (but "shit!" stays a word + "!")
    .replace(/[@4013$57]/g, (c) => LEET[c]);
}
const words = (t) => t.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
const squash = (w, keep) => w.replace(/(\p{L})\1{2,}/gu, keep === 1 ? '$1' : '$1$1'); // "fuuuck" → "fuck" / "asss" → "ass"
/**
 * First bad word found in text (whole words only, case-insensitive, simple leetspeak), or null.
 * A list entry with a space ("go die") matches as a phrase.
 */
export function findBadWord(text, list) {
  const bad = (list || []).map((w) => words(normWords(w)).join(' ')).filter(Boolean);
  if (!bad.length || !text) return null;
  const ws = words(normWords(text));
  if (!ws.length) return null;
  const forms = [ws, ws.map((w) => squash(w, 1)), ws.map((w) => squash(w, 2))];
  for (const b of bad) {
    const bw = b.split(' ');
    for (const f of forms) {
      for (let i = 0; i + bw.length <= f.length; i++) if (bw.every((x, j) => f[i + j] === x)) return b;
    }
  }
  return null;
}

/** "!poll Question | a | b | c" → { name, values } or { error } (2–12 options). */
export function parsePoll(arg) {
  const parts = String(arg || '').split('|').map((x) => x.trim()).filter(Boolean);
  const [name, ...rest] = parts;
  const values = [...new Set(rest)];
  if (!name || values.length < GROUP_ADMIN_LIMITS.pollMin) return { error: 'too_few' };
  if (values.length > GROUP_ADMIN_LIMITS.pollMax) return { error: 'too_many' };
  return { name: name.slice(0, 255), values: values.map((v) => v.slice(0, 100)) };
}

/** "!summary" / "!summary 100" / "!summary here" / "!summary 80 here" → { n, here } */
export function parseSummaryArg(arg) {
  const t = String(arg || '').toLowerCase();
  const m = t.match(/\d+/);
  const n = m ? int(m[0], GROUP_ADMIN_LIMITS.summaryDefault, 1, GROUP_ADMIN_LIMITS.summaryMax) : GROUP_ADMIN_LIMITS.summaryDefault;
  return { n, here: /\bhere\b/.test(t) };
}

/**
 * Panel vs WhatsApp command: "!lock 23:00-07:00" or "!slow 30" typed in WhatsApp is saved by the bot as
 * { value, at }. The newest wins: a later Save of that group in the panel (cfg.savedAt) replaces it.
 * The panel's group page shows the command's value in the form, so saving keeps it unless you change it.
 */
export function effectiveSetting(panelValue, ov, panelSavedAt = 0) {
  if (ov && Number(ov.at || 0) > Number(panelSavedAt || 0)) return { value: ov.value, from: 'command' };
  return { value: panelValue, from: 'panel', stale: !!ov };
}
export const overrideOf = (value, now = Date.now()) => ({ value, at: now });
