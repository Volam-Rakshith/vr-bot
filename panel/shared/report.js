// VR Bot — Weekly report: who texted you most, busiest groups, vs last week, busiest hour.
// Stores ONLY counts per chat per day (no message text, ever). Pure ES module (bot + panel).
// © VR DEVELOPMENTS
//
// state.status.weekly = {
//   d: { "2026-10-30": { t: 57, c: { "<number or group id>": 12, … }, h: [24 hourly counts] } },   (last 15 days)
//   n: { "<number or group id>": ["Name", 1 if group] }
// }
import { addDays, localDate, localTime, weekdayOf, WEEKDAYS_FULL, prettyDate } from './time.js';

export const KEEP_DAYS = 15;

/** Count one incoming message. No text is passed in or stored. */
export function recordWeekly(weekly, { key, name = '', isGroup = false, ts, tz = 'Asia/Kolkata' }) {
  if (!weekly || !key || !ts) return weekly;
  weekly.d = weekly.d || {}; weekly.n = weekly.n || {};
  const day = localDate(ts, tz);
  const hour = Number(localTime(ts, tz).slice(0, 2));
  const b = weekly.d[day] || (weekly.d[day] = { t: 0, c: {}, h: Array(24).fill(0) });
  b.t += 1;
  b.c[key] = (b.c[key] || 0) + 1;
  if (!Array.isArray(b.h) || b.h.length !== 24) b.h = Array(24).fill(0);
  b.h[hour] += 1;
  if (name || !weekly.n[key]) weekly.n[key] = [name || weekly.n[key]?.[0] || '', isGroup ? 1 : 0];
  return weekly;
}

/** Drop days older than KEEP_DAYS and names nobody uses any more (keeps the encrypted state small). */
export function pruneWeekly(weekly, today) {
  if (!weekly?.d) return weekly;
  const oldest = addDays(today, -(KEEP_DAYS - 1));
  for (const day of Object.keys(weekly.d)) if (day < oldest) delete weekly.d[day];
  const used = new Set(Object.values(weekly.d).flatMap((b) => Object.keys(b.c || {})));
  for (const k of Object.keys(weekly.n || {})) if (!used.has(k)) delete weekly.n[k];
  return weekly;
}

const sumDays = (weekly, days) => {
  const per = {}, hours = Array(24).fill(0), byDay = [];
  let total = 0;
  for (const day of days) {
    const b = weekly?.d?.[day];
    byDay.push({ day, t: b?.t || 0 });
    if (!b) continue;
    total += b.t || 0;
    for (const [k, v] of Object.entries(b.c || {})) per[k] = (per[k] || 0) + v;
    (b.h || []).forEach((v, i) => { hours[i] += v || 0; });
  }
  return { per, hours, byDay, total };
};

/**
 * The numbers for the 7 days ending `endDate` (inclusive) vs the 7 days before.
 * groupNames = { groupId: name } (fresh names from WhatsApp, optional)
 */
export function weeklyStats(weekly, endDate, { top = 5, groupNames = {}, maskNumber = (n) => n } = {}) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(endDate, i - 6));
  const prevDays = days.map((d) => addDays(d, -7));
  const cur = sumDays(weekly, days), prev = sumDays(weekly, prevDays);
  const names = weekly?.n || {};
  const isGroup = (k) => names[k]?.[1] === 1 || /@g\.us$/.test(k);
  const label = (k) => (isGroup(k) ? groupNames[k] || names[k]?.[0] || 'a group' : names[k]?.[0] || maskNumber(k));
  const rank = (filter) => Object.entries(cur.per).filter(([k]) => filter(k)).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, top).map(([k, count]) => ({ key: k, name: label(k), count, prev: prev.per[k] || 0 }));
  let busiestHour = null;
  cur.hours.forEach((v, i) => { if (v > 0 && (busiestHour === null || v > cur.hours[busiestHour])) busiestHour = i; });
  let busiestDay = null;
  for (const x of cur.byDay) if (x.t > 0 && (!busiestDay || x.t > busiestDay.t)) busiestDay = x;
  return {
    from: days[0], to: endDate,
    total: cur.total, prevTotal: prev.total,
    change: prev.total ? Math.round(((cur.total - prev.total) / prev.total) * 100) : null,
    chats: Object.keys(cur.per).length,
    people: rank((k) => !isGroup(k)),
    groups: rank(isGroup),
    busiestHour, busiestHourCount: busiestHour === null ? 0 : cur.hours[busiestHour],
    busiestDay: busiestDay ? { day: busiestDay.day, name: WEEKDAYS_FULL[weekdayOf(busiestDay.day)], count: busiestDay.t } : null,
  };
}

const hour12 = (h) => `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? 'AM' : 'PM'}`;
const arrow = (now, before) => (now > before ? ` ↑${now - before}` : now < before ? ` ↓${before - now}` : '');
const short = (d) => prettyDate(d).replace(/ \d{4}$/, '');

/** The WhatsApp message. */
export function weeklyText(st) {
  const L = [`📊 *Weekly report* (${short(st.from)} – ${short(st.to)})`, ''];
  if (!st.total) {
    L.push('💬 No messages counted this week.', '', '_(The bot started counting when this feature was added, so the first report can be short.)_');
    return L.join('\n');
  }
  const ch = st.change === null ? '' : st.change === 0 ? ' (same as last week)' : ` (${st.change > 0 ? '↑' : '↓'} ${Math.abs(st.change)}% vs last week: ${st.prevTotal})`;
  L.push(`💬 *${st.total}* messages from *${st.chats}* chats${ch}`);
  if (st.people.length) { L.push('', '👤 *Top people*'); st.people.forEach((p, i) => L.push(`${i + 1}. ${p.name} · ${p.count}${arrow(p.count, p.prev)}`)); }
  if (st.groups.length) { L.push('', '👥 *Busiest groups*'); st.groups.forEach((g, i) => L.push(`${i + 1}. ${g.name} · ${g.count}${arrow(g.count, g.prev)}`)); }
  L.push('');
  if (st.busiestHour !== null) L.push(`⏰ Busiest hour: ${hour12(st.busiestHour)} – ${hour12((st.busiestHour + 1) % 24)}`);
  if (st.busiestDay) L.push(`📅 Busiest day: ${st.busiestDay.name} (${st.busiestDay.count})`);
  L.push('', '_Counts only. VR Bot saves no chat text._');
  return L.join('\n');
}
