// VR Bot — Busy mode: "!busy 2h", "!busy until 5pm", "!busy off" + the panel switch.
// Pure ES module (bot + panel). © VR DEVELOPMENTS
//
// Two places can switch it on/off, the newest one wins:
//   panel:    settings.busy = { on, until, setAt, message, who/contacts/tags/exclude/groups, groupsOnlyWhenTagged }
//   WhatsApp: state.status.busy = { on, until, at, message }   (written by the bot when you send !busy)
import { zonedToUtc, localDate, localTime, addDays, pretty12, prettyDate } from './time.js';

const MIN = 60000;
export const BUSY_DEFAULT_MINUTES = 60;
export const BUSY_MAX_MINUTES = 7 * 24 * 60;

const UNIT = { h: 60, hr: 60, hrs: 60, hour: 60, hours: 60, m: 1, min: 1, mins: 1, minute: 1, minutes: 1, d: 1440, day: 1440, days: 1440 };

/**
 * Read what comes after "!busy". Returns { off: true } | { until, minutes } | { error }.
 *  ""                → 1 hour        "2h", "30m", "1h30m", "1.5 hours", "45 min"
 *  "until 5pm", "till 17:30", "until 5:30 pm", "5pm"   → that time today (tomorrow if it has passed)
 *  "off", "stop", "end"  → switch off
 * Anything after the time is ignored ("!busy 2h exam" = 2 hours).
 */
export function parseBusy(arg, nowMs, tz = 'Asia/Kolkata') {
  const a = String(arg || '').trim().toLowerCase();
  if (!a) return { until: nowMs + BUSY_DEFAULT_MINUTES * MIN, minutes: BUSY_DEFAULT_MINUTES };
  if (/^(off|stop|end|no|done|cancel|free)\b/.test(a)) return { off: true };

  // durations: one or more "<number><unit>" pieces at the start
  const durRe = /^\s*(\d+(?:\.\d+)?)\s*(hours|hour|hrs|hr|h|minutes|minute|mins|min|m|days|day|d)(?![a-z])/;
  let rest = a, minutes = 0, n = 0, m;
  while ((m = rest.match(durRe))) { minutes += Number(m[1]) * UNIT[m[2]]; rest = rest.slice(m[0].length); n++; }
  if (n) {
    minutes = Math.round(minutes);
    if (minutes < 1) return { error: 'That is less than a minute.' };
    if (minutes > BUSY_MAX_MINUTES) return { error: 'Busy mode can be on for at most 7 days.' };
    return { until: nowMs + minutes * MIN, minutes };
  }

  // clock times: "until 5pm", "till 17:30", "5:30 pm", "at 9"
  const t = a.match(/^(?:until|till|til|untill|upto|up to|to|at|by)?\s*(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?(?![\d])/);
  const hasWord = /^(until|till|til|untill|upto|up to|to|at|by)\b/.test(a);
  if (t && (hasWord || t[2] || t[3])) {
    let h = Number(t[1]); const mi = Number(t[2] || 0); const ap = (t[3] || '').replace(/\./g, '');
    if (mi > 59 || h > 24 || (ap && (h < 1 || h > 12))) return { error: 'I could not read that time. Try "until 5pm" or "until 17:30".' };
    const today = localDate(nowMs, tz);
    const at = (hh, d) => zonedToUtc(d, `${String(hh % 24).padStart(2, '0')}:${String(mi).padStart(2, '0')}`, tz);
    let cands;
    if (ap === 'am') cands = [h % 12];
    else if (ap === 'pm') cands = [(h % 12) + 12];
    else if (h <= 12 && h > 0) cands = [h % 12 === 0 ? 12 : h, (h % 12) + 12]; // "until 5" → 5:00 or 17:00, whichever comes next
    else cands = [h];
    let best = Infinity;
    for (const hh of cands) for (const d of [today, addDays(today, 1)]) { const x = at(hh, d); if (x > nowMs && x < best) best = x; }
    if (!Number.isFinite(best)) return { error: 'I could not read that time.' };
    return { until: best, minutes: Math.round((best - nowMs) / MIN) };
  }
  // a bare number = hours ("!busy 2")
  const bare = a.match(/^(\d+(?:\.\d+)?)(?![\d.])/);
  if (bare) {
    const minutes = Math.round(Number(bare[1]) * 60);
    if (minutes >= 1 && minutes <= BUSY_MAX_MINUTES) return { until: nowMs + minutes * MIN, minutes };
  }
  return { error: 'Try: !busy 2h · !busy 30m · !busy until 5pm · !busy off' };
}

/** Which busy switch is in force right now (the newest of panel and !busy wins). */
export function busyNow(settings = {}, status = {}, nowMs = Date.now()) {
  const p = settings.busy || {};
  const c = status.busy || null;
  const pAt = Number(p.setAt) || 0, cAt = Number(c?.at) || 0;
  const src = c && cAt > pAt
    ? { on: !!c.on, until: Number(c.until) || 0, at: cAt, source: 'whatsapp', message: c.message }
    : { on: !!p.on, until: Number(p.until) || 0, at: pAt, source: 'panel', message: '' };
  const active = src.on && src.until > nowMs;
  return { active, on: src.on, until: src.until, at: src.at, source: src.source, id: `${src.source}:${src.at}`, message: src.message || p.message || '' };
}

/** "5:00 PM", "tomorrow 9:00 AM" or "Mon 3 Nov, 9:00 AM" — for "back by {time}". */
export function busyTimeText(untilMs, nowMs, tz = 'Asia/Kolkata') {
  const d = localDate(untilMs, tz), today = localDate(nowMs, tz);
  const t = pretty12(localTime(untilMs, tz));
  if (d === today) return t;
  if (d === addDays(today, 1)) return `tomorrow ${t}`;
  return `${prettyDate(d).replace(/ \d{4}$/, '')}, ${t}`;
}

/** The auto-reply text with {time} filled in. */
export function busyText(template, untilMs, nowMs, tz) {
  const tpl = String(template || "I'm busy right now, back by {time} 🙏");
  return tpl.replace(/\{time\}/gi, busyTimeText(untilMs, nowMs, tz));
}
