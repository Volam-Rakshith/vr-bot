// VR Bot — turns your schedules, birthdays, festivals and follow-ups into a list of concrete sends.
// Pure ES module (no network), shared by the bot and the panel ("Next sends" on the dashboard).
// © VR DEVELOPMENTS
import { occurrencesBetween, jitterMs, seededRandom } from './scheduler.js';
import { voicePlan } from './voice.js';
import { renderTemplate, firstName, headerOn } from './templates.js';
import { mergedFestivals, festivalDate } from './festivals.js';
import { normalizeNumber } from './defaults.js';
import { specialFor, specialConfig, specialDatesBetween } from './specialdays.js';
import { zonedToUtc, localDate, addDays, prettyDate, WEEKDAYS, WEEKDAYS_FULL, weekdayOf, pretty12, parseDate } from './time.js';

const MAX_JITTER_MIN = 60;

function contactById(contacts, id) { return (contacts || []).find((c) => c.id === id); }

/** Expand schedule targets into individual recipients. */
export function expandTargets(targets, { contacts = [], groups = [], ownerNumber = '' } = {}) {
  const out = [];
  const seen = new Set();
  const push = (r) => { const k = r.type + ':' + (r.jid || r.number); if (!seen.has(k)) { seen.add(k); out.push(r); } };
  for (const t of targets || []) {
    if (t.type === 'contact') {
      const c = contactById(contacts, t.id);
      if (c && c.number && !c.example) push({ type: 'number', number: normalizeNumber(c.number), name: c.name, contactId: c.id, contact: c });
    } else if (t.type === 'tag') {
      for (const c of contacts) if ((c.tags || []).includes(t.tag) && c.number && !c.example) push({ type: 'number', number: normalizeNumber(c.number), name: c.name, contactId: c.id, contact: c, viaTag: t.tag });
    } else if (t.type === 'group') {
      const g = groups.find((x) => x.id === t.id);
      push({ type: 'group', jid: t.id, name: t.name || g?.name || 'group' });
    } else if (t.type === 'number' && t.number) {
      push({ type: 'number', number: normalizeNumber(t.number), name: t.name || '' });
    } else if (t.type === 'owner' && ownerNumber) {
      push({ type: 'number', number: normalizeNumber(ownerNumber), name: 'me', owner: true });
    }
  }
  return out;
}

export function recipientId(r) { return r.type === 'group' || r.type === 'status' ? r.jid : r.number; }

function vars(base, r, date, time) {
  const name = r.type === 'group' ? r.name : (r.name || '');
  return {
    name, first_name: firstName(name), group: r.type === 'group' ? r.name : '',
    date: prettyDate(date), day: WEEKDAYS_FULL[weekdayOf(date)], time: pretty12(time), year: date.slice(0, 4),
    ...base,
  };
}

/**
 * Build all sends whose time falls in [fromMs, toMs).
 * data = { settings, contacts, schedules, templates, festivals, groups(seen), memory, ownerNumber }
 * Returns jobs sorted by time: { key, kind, sourceId, label, at, nominal, date, time, to, text, header, list }
 */
export function buildJobs(data, fromMs, toMs) {
  const s = data.settings;
  const tz = s.timezone || 'Asia/Kolkata';
  const F = s.features || {};
  const contacts = data.contacts || [];
  const templates = data.templates || [];
  const ctx = { contacts, groups: data.groups || [], ownerNumber: data.ownerNumber || '' };
  const jobs = [];
  if (s.paused) return jobs;
  const wideFrom = fromMs - MAX_JITTER_MIN * 60000;
  const wideTo = toMs + MAX_JITTER_MIN * 60000;
  const tplText = (obj) => (obj.templateId && templates.find((t) => t.id === obj.templateId)?.text) || obj.message || '';

  const addOccurrence = ({ kind, sourceId, label, occ, recipients, text, scheduleHeader, delayMin, extraVars = {}, dynamic = null, voice = null }) => {
    const isList = recipients.length > 1;
    let cumulative = 0;
    recipients.forEach((r, i) => {
      const rid = recipientId(r);
      const key = `${kind}:${sourceId}:${occ.date}T${occ.time}:${rid}`;
      let k = kind;
      if (kind === 'personal' && r.type === 'group') k = 'group';
      else if (kind === 'personal' && (isList || r.viaTag)) k = 'broadcast';
      else if (kind === 'festival' && r.type === 'group') k = 'group';
      let at = occ.at + (delayMin ? jitterMs(`${sourceId}:${occ.date}`, delayMin) : 0);
      if (isList && i > 0) {
        const min = s.broadcast?.minGapSeconds ?? 8, max = s.broadcast?.maxGapSeconds ?? 20;
        cumulative += Math.round((min + seededRandom(key) * Math.max(0, max - min)) * 1000);
        at += cumulative;
      }
      if (at < fromMs || at >= toMs) return;
      const header = headerOn(s.header, k, scheduleHeader, r.contact?.header);
      const rendered = dynamic ? '' : renderTemplate(text, vars({ my_name: s.myName || '', ...extraVars }, r, occ.date, occ.time), key);
      jobs.push({ key, kind: k, sourceId, label, at, nominal: occ.at, date: occ.date, time: occ.time, to: r, text: rendered, header, list: isList || !!r.viaTag, dynamic, ...(voice ? { voice } : {}) });
    });
  };

  // 1) Scheduled messages (personal, lists/broadcasts, groups)
  if (F.scheduled !== false) {
    for (const sch of data.schedules || []) {
      if (sch.enabled === false || sch.example) continue; // "example": true items are never sent
      let targets = sch.to || [];
      if (F.groupScheduler === false) targets = targets.filter((t) => t.type !== 'group');
      if (F.broadcast === false) targets = targets.filter((t) => t.type !== 'tag');
      const recipients = expandTargets(targets, ctx);
      if (!recipients.length) continue;
      const delayMin = sch.humanDelay?.enabled ? Math.min(MAX_JITTER_MIN, sch.humanDelay.minutes ?? s.humanDelay?.minutes ?? 3) : 0;
      for (const occ of occurrencesBetween(sch, wideFrom, wideTo, tz)) {
        addOccurrence({ kind: 'personal', sourceId: sch.id, label: sch.name || 'Scheduled message', occ, recipients, text: tplText(sch), scheduleHeader: sch.header, delayMin, voice: voicePlan(sch).voice ? sch.voice : null });
      }
    }
  }

  // 2) Birthdays
  if (F.birthdays !== false) {
    const b = s.birthdays || {};
    for (const c of contacts) {
      if (!c.birthday || c.wishBirthday === false || !c.number || c.example) continue;
      const parts = String(c.birthday).split('-').map(Number);
      const [month, day] = parts.length === 3 ? [parts[1], parts[2]] : [parts[0], parts[1]];
      if (!month || !day) continue;
      const pseudo = { id: `bday-${c.id}`, enabled: true, time: c.birthdayTime || b.time || '00:00', repeat: { type: 'yearly', month, day } };
      const r = { type: 'number', number: normalizeNumber(c.number), name: c.name, contactId: c.id, contact: c };
      for (const occ of occurrencesBetween(pseudo, wideFrom, wideTo, tz)) {
        const age = parts.length === 3 ? Number(occ.date.slice(0, 4)) - parts[0] : '';
        addOccurrence({ kind: 'birthday', sourceId: pseudo.id, label: `Birthday wish · ${c.name}`, occ, recipients: [r], text: c.birthdayMessage || b.message, scheduleHeader: c.header, delayMin: 0, extraVars: { age } });
        if (b.remindMe && data.ownerNumber) {
          const me = { type: 'number', number: normalizeNumber(data.ownerNumber), name: 'me', owner: true };
          addOccurrence({ kind: 'alert', sourceId: `bday-note-${c.id}`, label: `Birthday note · ${c.name}`, occ: { ...occ, at: occ.at + 60000 }, recipients: [me], text: `🎂 Today is ${c.name}'s birthday — your wish was scheduled for ${pretty12(occ.time)}.`, delayMin: 0 });
        }
      }
    }
  }

  // 3) Festivals
  if (F.festivals !== false) {
    const fest = data.festivals || {};
    for (const f of mergedFestivals(fest)) {
      if (!f.enabled || !(f.to || []).length) continue;
      const recipients = expandTargets(f.to, ctx);
      if (!recipients.length) continue;
      const time = f.time || fest.defaultTime || '00:00';
      const y0 = Number(localDate(fromMs, tz).slice(0, 4));
      for (const y of [y0 - 1, y0, y0 + 1]) {
        const d = festivalDate(f, y);
        if (!d) continue;
        const pseudo = { id: `fest-${f.id}`, enabled: true, time, repeat: { type: 'once', date: d } };
        for (const occ of occurrencesBetween(pseudo, wideFrom, wideTo, tz)) {
          addOccurrence({ kind: 'festival', sourceId: pseudo.id, label: `${f.emoji || '🎉'} ${f.name}`, occ, recipients, text: f.message || `Happy ${f.name} {name|}! ${f.emoji || '🎉'}`, scheduleHeader: f.header, delayMin: 0, extraVars: { festival: f.name } });
        }
      }
    }
  }

  // 4) "No reply" follow-ups
  if (F.followup) {
    const fu = s.followup || {};
    const mem = data.memory || {};
    const days = Number(fu.days) || 3;
    const chosen = contacts.filter((c) => !c.example && (fu.contacts || []).includes(c.id) || (c.tags || []).some((t) => (fu.tags || []).includes(t)));
    for (const c of chosen) {
      const num = normalizeNumber(c.number);
      const lastOut = mem.lastOut?.[num];
      const lastIn = mem.lastIn?.[num] || 0;
      if (!lastOut || lastIn >= lastOut) continue;
      if (mem.followed?.[num] === lastOut) continue;
      const dueMs = lastOut + days * 86400000;
      let date = localDate(dueMs, tz);
      let at = zonedToUtc(date, fu.time || '10:00', tz);
      if (at < dueMs) { date = addDays(date, 1); at = zonedToUtc(date, fu.time || '10:00', tz); }
      const occ = { date, time: fu.time || '10:00', at };
      const r = { type: 'number', number: num, name: c.name, contactId: c.id, contact: c };
      addOccurrence({ kind: 'followup', sourceId: `fu-${num}-${lastOut}`, label: `Follow-up · ${c.name}`, occ, recipients: [r], text: fu.message, delayMin: 0 });
    }
  }

  // 5) Daily summary to you (text is written at send time)
  if (F.summary !== false && data.ownerNumber) {
    const pseudo = { id: 'daily-summary', enabled: true, time: s.summary?.time || '21:30', repeat: { type: 'daily' } };
    const me = { type: 'number', number: normalizeNumber(data.ownerNumber), name: 'me', owner: true };
    for (const occ of occurrencesBetween(pseudo, wideFrom, wideTo, tz)) {
      addOccurrence({ kind: 'summary', sourceId: 'daily-summary', label: 'Daily summary', occ, recipients: [me], text: '', delayMin: 0, dynamic: 'summary' });
    }
  }

  // 6) Weekly report to you (Sunday 8 PM by default; text is written at send time, counts only)
  const wk = s.weekly || {};
  if (wk.enabled !== false && data.ownerNumber) {
    const pseudo = { id: 'weekly-report', enabled: true, time: wk.time || '20:00', repeat: { type: 'weekly', days: [Number(wk.day ?? 0)] } };
    const me = { type: 'number', number: normalizeNumber(data.ownerNumber), name: 'me', owner: true };
    for (const occ of occurrencesBetween(pseudo, wideFrom, wideTo, tz)) {
      addOccurrence({ kind: 'summary', sourceId: 'weekly-report', label: 'Weekly report', occ, recipients: [me], text: '', delayMin: 0, dynamic: 'weekly' });
    }
  }

  // 7) Auto status (your WhatsApp status; what it says is picked at send time)
  const st = s.autoStatus || {};
  if (st.enabled) {
    const days = (Array.isArray(st.days) ? st.days : []).map(Number).filter((d) => d >= 0 && d <= 6);
    if (days.length) {
      const pseudo = { id: 'auto-status', enabled: true, time: st.time || '08:00', repeat: days.length === 7 ? { type: 'daily' } : { type: 'weekly', days } };
      const r = { type: 'status', jid: 'status@broadcast', name: 'My status' };
      for (const occ of occurrencesBetween(pseudo, wideFrom, wideTo, tz)) {
        const sp = specialFor(occ.date, st);
        addOccurrence({ kind: 'status', sourceId: 'auto-status', label: sp ? `Special day · ${sp.name}` : 'Auto status', occ, recipients: [r], text: '', delayMin: 0, dynamic: 'status' });
      }
    }
    // Special days that are NOT one of your chosen days still get their card ("Post special days even on my off days").
    // Same key format as above → still only one status per day.
    if (specialConfig(st).enabled && specialConfig(st).offDays && days.length && days.length < 7) {
      const r = { type: 'status', jid: 'status@broadcast', name: 'My status' };
      for (const date of specialDatesBetween(localDate(wideFrom, tz), localDate(wideTo, tz), st)) {
        if (days.includes(weekdayOf(date))) continue; // already covered by the normal schedule
        const sp = specialFor(date, st);
        const pseudo = { id: `auto-status-${date}`, enabled: true, time: st.time || '08:00', repeat: { type: 'once', date } };
        for (const occ of occurrencesBetween(pseudo, wideFrom, wideTo, tz)) {
          addOccurrence({ kind: 'status', sourceId: 'auto-status', label: `Special day · ${sp.name}`, occ, recipients: [r], text: '', delayMin: 0, dynamic: 'status-special' });
        }
      }
    }
  }

  return jobs.sort((a, b) => a.at - b.at || a.key.localeCompare(b.key));
}

/** Upcoming sends for the panel's dashboard (next `days` days, max `limit`). */
export function upcoming(data, nowMs, days = 7, limit = 20) {
  return buildJobs(data, nowMs, nowMs + days * 86400000).slice(0, limit);
}
