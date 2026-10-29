// VR Bot — schedule engine. Pure ES module shared by the bot (Node) and the panel (browser).
// © VR DEVELOPMENTS
//
// A schedule looks like:
// {
//   id, name, enabled: true,
//   time: "07:00",                         // local wall-clock time in settings.timezone
//   repeat: { type: "once", date: "2026-11-08" }
//         | { type: "daily" }
//         | { type: "weekly", days: [1,2,3,4,5] }          // 0=Sun … 6=Sat
//         | { type: "monthly", day: 15 }  | { type: "monthly", day: "last" }
//         | { type: "yearly", month: 11, day: 8 }           // Feb 29 → Feb 28 in non-leap years
//         | { type: "dates", dates: ["2026-12-01", "2027-01-05"] },
//   start: "2026-10-01" | null, end: "2026-12-31" | null,   // optional date range (inclusive)
//   skipDays: [0],                          // weekdays to skip (0=Sun)
//   skipDates: ["2026-11-14"],              // specific dates to skip
// }
import { zonedToUtc, localDate, addDays, weekdayOf, daysInMonth, isLeap, parseDate, isValidTime } from './time.js';

/** Does this schedule fire on local date `dateStr`? (ignores time-of-day) */
export function occursOn(s, dateStr) {
  if (!s || s.enabled === false) return false;
  const r = s.repeat || { type: 'daily' };
  if (s.start && dateStr < s.start) return false;
  if (s.end && dateStr > s.end) return false;
  if (Array.isArray(s.skipDates) && s.skipDates.includes(dateStr)) return false;
  const wd = weekdayOf(dateStr);
  if (r.type !== 'once' && r.type !== 'dates' && Array.isArray(s.skipDays) && s.skipDays.includes(wd)) return false;
  const { y, m, d } = parseDate(dateStr);
  switch (r.type) {
    case 'once': return r.date === dateStr;
    case 'dates': return Array.isArray(r.dates) && r.dates.includes(dateStr);
    case 'daily': return true;
    case 'weekly': return Array.isArray(r.days) && r.days.includes(wd);
    case 'monthly': {
      const dim = daysInMonth(y, m);
      if (r.day === 'last') return d === dim;
      const want = Math.min(Number(r.day) || 1, dim); // 31st → last day of short months
      return d === want;
    }
    case 'yearly': {
      const rm = Number(r.month), rd = Number(r.day);
      if (rm === 2 && rd === 29 && !isLeap(y)) return m === 2 && d === 28;
      return m === rm && d === rd;
    }
    default: return false;
  }
}

/** All occurrences with fromMs <= at < toMs. Returns [{ date, time, at }] sorted. */
export function occurrencesBetween(s, fromMs, toMs, tz = 'Asia/Kolkata') {
  if (!s || s.enabled === false || !isValidTime(s.time)) return [];
  const out = [];
  let date = addDays(localDate(fromMs, tz), -1);
  const last = addDays(localDate(toMs, tz), 1);
  let guard = 0;
  while (date <= last && guard++ < 4000) {
    if (occursOn(s, date)) {
      const at = zonedToUtc(date, s.time, tz);
      if (at >= fromMs && at < toMs) out.push({ date, time: s.time, at });
    }
    date = addDays(date, 1);
  }
  return out;
}

/** Next occurrence at or after fromMs (searches up to ~3 years). null if none. */
export function nextOccurrence(s, fromMs, tz = 'Asia/Kolkata', maxDays = 1500) {
  if (!s || s.enabled === false || !isValidTime(s.time)) return null;
  let date = localDate(fromMs, tz);
  for (let i = 0; i <= maxDays; i++) {
    if (s.end && date > s.end) return null;
    if (occursOn(s, date)) {
      const at = zonedToUtc(date, s.time, tz);
      if (at >= fromMs) return { date, time: s.time, at };
    }
    date = addDays(date, 1);
  }
  return null;
}

/** Human summary like "Every day at 07:00 · skips Sun". */
export function describe(s) {
  const r = s.repeat || { type: 'daily' };
  const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  let base;
  switch (r.type) {
    case 'once': base = `Once on ${r.date}`; break;
    case 'dates': base = `On ${(r.dates || []).length} chosen date(s)`; break;
    case 'daily': base = 'Every day'; break;
    case 'weekly': base = (r.days || []).length === 7 ? 'Every day' : `Every ${(r.days || []).map((d) => WD[d]).join(', ')}`; break;
    case 'monthly': base = r.day === 'last' ? 'Last day of every month' : `Every month on day ${r.day}`; break;
    case 'yearly': base = `Every year on ${r.day} ${MO[(r.month || 1) - 1]}`; break;
    default: base = 'Custom';
  }
  let txt = `${base} at ${s.time}`;
  if (r.type !== 'once' && r.type !== 'dates' && (s.skipDays || []).length) txt += ` · skips ${s.skipDays.map((d) => WD[d]).join(', ')}`;
  if ((s.skipDates || []).length) txt += ` · ${s.skipDates.length} skip date(s)`;
  if (s.start || s.end) txt += ` · ${s.start || '…'} → ${s.end || '…'}`;
  return txt;
}

/**
 * Deterministic pseudo-random number in [0,1) from a string seed.
 * Used for "human-like" jitter so a re-run computes the SAME send time (no doubles, no skips).
 */
export function seededRandom(seed) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  h += h << 13; h ^= h >>> 7; h += h << 3; h ^= h >>> 17; h += h << 5;
  return ((h >>> 0) % 1000000) / 1000000;
}

/** Jitter in ms within ±minutes, stable for a given key. */
export function jitterMs(key, minutes) {
  const m = Math.max(0, Number(minutes) || 0);
  if (!m) return 0;
  return Math.round((seededRandom(key) * 2 - 1) * m * 60000);
}
