// VR Bot — time helpers. Pure ES module, works in Node 20+ and in the browser.
// © VR DEVELOPMENTS
// All "local" dates/times are wall-clock values in the configured IANA timezone
// (default Asia/Kolkata). Dates are "YYYY-MM-DD" strings, times are "HH:MM".

const fmtCache = new Map();
function fmt(tz) {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short',
    });
    fmtCache.set(tz, f);
  }
  return f;
}
const WD = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** Wall-clock parts of an instant (ms or Date) in a timezone. */
export function zonedParts(when, tz = 'Asia/Kolkata') {
  const d = typeof when === 'number' ? new Date(when) : when;
  const p = {};
  for (const { type, value } of fmt(tz).formatToParts(d)) p[type] = value;
  return {
    year: +p.year, month: +p.month, day: +p.day,
    hour: +p.hour % 24, minute: +p.minute, second: +p.second,
    weekday: WD[p.weekday],
  };
}

function tzOffsetMs(ts, tz) {
  const p = zonedParts(ts, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(ts / 1000) * 1000;
}

/** Instant (ms) for a wall-clock date+time in a timezone. */
export function zonedToUtc(dateStr, timeStr, tz = 'Asia/Kolkata') {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = (timeStr || '00:00').split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm || 0, 0);
  let t = guess - tzOffsetMs(guess, tz);
  const off2 = tzOffsetMs(t, tz);
  if (guess - off2 !== t) t = guess - off2; // DST edge (not relevant for IST, kept for other zones)
  return t;
}

export const pad = (n) => String(n).padStart(2, '0');
export function ymd(y, m, d) { return `${y}-${pad(m)}-${pad(d)}`; }

/** Local date string ("YYYY-MM-DD") of an instant in tz. */
export function localDate(when, tz = 'Asia/Kolkata') {
  const p = zonedParts(when, tz);
  return ymd(p.year, p.month, p.day);
}
/** Local time string ("HH:MM") of an instant in tz. */
export function localTime(when, tz = 'Asia/Kolkata') {
  const p = zonedParts(when, tz);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

export function parseDate(s) {
  const [y, m, d] = s.split('-').map(Number);
  return { y, m, d };
}
/** Calendar arithmetic on date strings (timezone-free). */
export function addDays(dateStr, n) {
  const { y, m, d } = parseDate(dateStr);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return ymd(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}
export function weekdayOf(dateStr) {
  const { y, m, d } = parseDate(dateStr);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}
export function daysInMonth(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }
export function isLeap(y) { return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0; }
export function diffDays(a, b) { // b - a in days
  const A = parseDate(a), B = parseDate(b);
  return Math.round((Date.UTC(B.y, B.m - 1, B.d) - Date.UTC(A.y, A.m - 1, A.d)) / 86400000);
}
export function isValidTime(s) { return /^([01]\d|2[0-3]):[0-5]\d$/.test(s || ''); }
export function isValidDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s || '')) return false;
  const { y, m, d } = parseDate(s);
  return m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m);
}
/** Is a wall-clock time inside a daily window like 23:00–07:00 (wraps midnight)? */
export function inDailyWindow(timeStr, from, to) {
  if (!from || !to) return false;
  if (from === to) return true;
  return from < to ? (timeStr >= from && timeStr < to) : (timeStr >= from || timeStr < to);
}
export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const WEEKDAYS_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function prettyDate(dateStr) {
  const { y, m, d } = parseDate(dateStr);
  return `${WEEKDAYS[weekdayOf(dateStr)]}, ${d} ${MONTHS[m - 1]} ${y}`;
}
export function pretty12(timeStr) {
  const [h, m] = timeStr.split(':').map(Number);
  const ap = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${pad(m)} ${ap}`;
}
