// VR Bot — Auto status: who sees it, what it says, how it looks. Pure ES module (bot + panel).
// © VR DEVELOPMENTS
//
// settings.autoStatus = {
//   enabled, time: "08:00", days: [0..6] (all 7 = every day),
//   mode: "quote" | "own" | "photo", aiFresh, texts: ["…"], photoUrl, photoCaption,
//   color: "rotate" | "#RRGGBB", font: "rotate" | 0..10,
//   audience: "all" | "only" | "except", contacts: [ids], tags: [tags], alsoRecent, maxPeople,
//   testWith: contact id — "Post test" also goes to this one person ('' = only you)
// }
import { QUOTES, nextQuoteIndex, formatQuote } from './quotes.js';
import { normalizeNumber } from './defaults.js';

/** Background colours that look good with white text (rotated one per status). */
export const STATUS_COLORS = ['#128C7E', '#6A1B9A', '#C2185B', '#1565C0', '#E65100', '#2E7D32', '#37474F', '#AD1457', '#00838F', '#4527A0', '#BF360C', '#283593'];
/** WhatsApp status fonts (ExtendedTextMessage.FontType): value → name shown in the panel. */
export const STATUS_FONTS = [[0, 'Classic'], [6, 'Bold'], [2, 'Script'], [7, 'Breeze'], [8, 'Calistoga'], [9, 'Exo'], [10, 'Courier']];
export const STATUS_JID = 'status@broadcast';
export const RECENT_DAYS = 30;

const jidOf = (n) => `${n}@s.whatsapp.net`;

/** Does this contact match the picked people/lists? */
const picked = (cfg, c) => (cfg.contacts || []).includes(c.id) || (c.tags || []).some((t) => (cfg.tags || []).includes(t));

/**
 * Who gets the status. Returns { numbers, jids, total, capped, nobody }.
 *  contacts = panel contacts; recent = { number: lastMessageMs } (people who texted you);
 *  owner = your own number (or [your number, the bot's number]) — always included first, so you see it too.
 *  testOnly = only you (+ the one test person in cfg.testWith, if picked).
 */
export function statusAudience(cfg = {}, { contacts = [], recent = {}, owner = '', nowMs = Date.now(), testOnly = false } = {}) {
  const mine = (Array.isArray(owner) ? owner : [owner]).filter(Boolean);
  const out = [];
  const seen = new Set();
  const add = (n) => { const d = normalizeNumber(n); if (d.length >= 10 && !seen.has(d)) { seen.add(d); out.push(d); } };
  for (const n of mine) add(n); // you (and the bot's own number, if it is a different one)
  const selfCount = out.length;
  if (testOnly && cfg.testWith) { // a test can also go to ONE person you pick (to check it shows for others too)
    const t = contacts.find((c) => c && c.id === cfg.testWith && c.number && !c.example);
    if (t) add(t.number);
  }
  if (!testOnly) {
    const real = contacts.filter((c) => c && c.number && !c.example);
    const mode = cfg.audience || 'all';
    const chosen = mode === 'only' ? real.filter((c) => picked(cfg, c)) : mode === 'except' ? real.filter((c) => !picked(cfg, c)) : real;
    for (const c of chosen) add(c.number);
    if (cfg.alsoRecent && mode !== 'only') {
      const blocked = new Set(mode === 'except' ? real.filter((c) => picked(cfg, c)).map((c) => normalizeNumber(c.number)) : []);
      const cut = nowMs - RECENT_DAYS * 86400000;
      for (const [n, at] of Object.entries(recent || {})) if (at >= cut && !blocked.has(normalizeNumber(n))) add(n);
    }
  }
  const max = Math.max(1, Number(cfg.maxPeople) || 500);
  const total = out.length;
  const numbers = out.slice(0, max);
  return { numbers, jids: numbers.map(jidOf), total, capped: total > max, self: selfCount, nobody: numbers.length <= selfCount };
}

/** Next background colour / font (rotating, or the fixed one picked in the panel). mem = memory.autoStatus */
export function statusLook(cfg = {}, mem = {}) {
  let backgroundColor = cfg.color;
  if (!backgroundColor || backgroundColor === 'rotate' || !/^#[0-9a-f]{6}$/i.test(backgroundColor)) {
    mem.color = ((mem.color ?? -1) + 1) % STATUS_COLORS.length;
    backgroundColor = STATUS_COLORS[mem.color];
  }
  let font = cfg.font;
  if (font === undefined || font === null || font === 'rotate' || !STATUS_FONTS.some(([v]) => v === Number(font))) {
    mem.font = ((mem.font ?? -1) + 1) % STATUS_FONTS.length;
    font = STATUS_FONTS[mem.font][0];
  }
  return { backgroundColor, font: Number(font) };
}

/**
 * What to post next. Returns { content, options, label } for sock.sendMessage('status@broadcast', content, options).
 * The caller adds statusJidList. aiText (optional) = a fresh quote from the AI; used when mode is quote + aiFresh.
 * mem (memory.autoStatus) is updated so quotes never repeat until the list is used up, and own texts rotate.
 */
export function nextStatus(cfg = {}, mem = {}, { aiText = '', random = Math.random } = {}) {
  const mode = cfg.mode || 'quote';
  if (mode === 'photo' && /^https:\/\/\S+$/i.test(String(cfg.photoUrl || '').trim())) {
    return { content: { image: { url: String(cfg.photoUrl).trim() }, ...(cfg.photoCaption ? { caption: String(cfg.photoCaption) } : {}) }, options: {}, label: 'photo' };
  }
  let text = '';
  let label = '';
  if (mode === 'own') {
    const list = (cfg.texts || []).map((t) => String(t).trim()).filter(Boolean);
    if (list.length) {
      const i = ((mem.own ?? -1) + 1) % list.length;
      mem.own = i;
      text = list[i]; label = `own text ${i + 1}/${list.length}`;
    }
  }
  if (!text && cfg.aiFresh && aiText && mode === 'quote') { text = `\u201C${String(aiText).trim()}\u201D`; label = 'AI quote'; }
  if (!text) {
    mem.quote = mem.quote || {};
    const i = nextQuoteIndex(mem.quote, QUOTES.length, random);
    text = formatQuote(QUOTES[i]); label = `quote #${i + 1}`;
  }
  return { content: { text }, options: statusLook(cfg, mem), label };
}

/** Clean up an AI answer into one quote line ('' if it looks wrong). */
export function cleanAiQuote(answer) {
  const a = String(answer || '').trim().replace(/^["“]+|["”]+$/g, '').trim();
  if (!a || a.length > 300 || /as an ai|i can't|i cannot|sorry/i.test(a)) return '';
  return a;
}
