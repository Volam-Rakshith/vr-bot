// VR Bot — daily summary to you. © VR DEVELOPMENTS
import { buildJobs } from '../../panel/shared/planner.js';
import { localDate, zonedToUtc, addDays, pretty12 } from '../../panel/shared/time.js';

export function summaryText(data, state, nowMs) {
  const s = data.settings;
  const tz = s.timezone;
  const today = localDate(nowMs, tz);
  const inbox = state.status.inbox?.date === today ? state.status.inbox.people : {};
  const people = Object.values(inbox).sort((a, b) => b.count - a.count);
  const from = zonedToUtc(today, '00:00', tz), to = zonedToUtc(addDays(today, 1), '00:00', tz);
  const jobs = buildJobs({ ...data, groups: state.status.groups, memory: state.memory }, from, to).filter((j) => j.kind !== 'summary');
  const log = state.sentlog.entries || {};
  const sent = jobs.filter((j) => log[j.key]?.s === 'sent').length;
  const failed = Object.values(log).filter((e) => e.s === 'failed' && e.t >= from);
  const tomorrow = buildJobs({ ...data, groups: state.status.groups, memory: state.memory }, to, to + 86400000).filter((j) => j.kind !== 'summary');
  const lines = [`📊 *Daily summary* — ${today}`];
  lines.push('', `💬 *${people.length}* people/groups messaged you today`);
  for (const p of people.slice(0, 10)) lines.push(`• ${p.name || p.masked} (${p.count})`);
  lines.push('', `📤 Scheduled today: ${jobs.length} · sent ${sent}`);
  if (failed.length) { lines.push(`❌ Failed: ${failed.length}`); for (const f of failed.slice(0, 5)) lines.push(`• ${f.label || f.k} — ${f.err || 'error'}`); }
  if (tomorrow.length) { lines.push('', `🗓️ Tomorrow: ${tomorrow.length} message(s)`); for (const j of tomorrow.slice(0, 5)) lines.push(`• ${pretty12(j.time)} ${j.label}`); }
  lines.push('', `Session: ${state.status.session?.status === 'ok' ? '✅ linked' : '⚠️ ' + state.status.session?.status}`);
  return lines.join('\n');
}
