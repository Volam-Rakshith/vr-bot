import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildJobs, expandTargets } from '../panel/shared/planner.js';
import { withDefaults } from '../panel/shared/defaults.js';
import { zonedToUtc } from '../panel/shared/time.js';
import { mergedFestivals, upcomingFestivals, FESTIVALS } from '../panel/shared/festivals.js';

const TZ = 'Asia/Kolkata';
const ist = (d, t) => zonedToUtc(d, t, TZ);
const contacts = [
  { id: 'c1', name: 'Amma Volam', number: '+91 90000 00001', birthday: '1980-11-02', tags: ['family'], header: 'off' },
  { id: 'c2', name: 'Saiteja', number: '9000000002', birthday: '02-29', tags: ['friends'] },
  { id: 'c3', name: 'Ravi', number: '+919000000003', tags: ['friends'] },
  { id: 'cx', name: 'Example', number: '+919000000009', tags: ['friends'], example: true },
];
const base = (over = {}) => ({ settings: withDefaults(over.settings || {}), contacts, templates: [{ id: 't1', text: 'Good morning {first_name} ☀️' }], schedules: over.schedules || [], festivals: over.festivals || {}, groups: [{ id: '123@g.us', name: 'AIML Class' }], memory: over.memory || {}, ownerNumber: '917989405979' });

test('expandTargets: contacts, tags, groups, owner; skips examples; dedupes', () => {
  const r = expandTargets([{ type: 'tag', tag: 'friends' }, { type: 'contact', id: 'c3' }, { type: 'group', id: '123@g.us' }, { type: 'owner' }], { contacts, groups: [{ id: '123@g.us', name: 'AIML Class' }], ownerNumber: '917989405979' });
  assert.deepEqual(r.map((x) => x.number || x.jid), ['919000000002', '919000000003', '123@g.us', '917989405979']);
});

test('daily schedule → one job per occurrence with rendered text, header off for personal', () => {
  const d = base({ schedules: [{ id: 's1', name: 'GM Amma', to: [{ type: 'contact', id: 'c1' }], templateId: 't1', time: '07:00', repeat: { type: 'daily' }, skipDays: [0] }] });
  d.settings.features.summary = false; d.settings.features.birthdays = false;
  const jobs = buildJobs(d, ist('2026-10-31', '00:00'), ist('2026-11-03', '00:00'));
  assert.deepEqual(jobs.map((j) => j.date), ['2026-10-31', '2026-11-02']);
  assert.equal(jobs[0].text, 'Good morning Amma ☀️');
  assert.equal(jobs[0].kind, 'personal');
  assert.equal(jobs[0].header, false);
  assert.equal(jobs[0].key, 's1' && 'personal:s1:2026-10-31T07:00:919000000001');
});

test('dedupe keys are stable across runs (same window twice → same keys)', () => {
  const d = base({ schedules: [{ id: 's1', to: [{ type: 'tag', tag: 'friends' }], message: 'Hi {name}', time: '19:00', repeat: { type: 'once', date: '2026-12-01' }, humanDelay: { enabled: true, minutes: 5 } }] });
  const a = buildJobs(d, ist('2026-12-01', '18:00'), ist('2026-12-01', '20:00'));
  const b = buildJobs(d, ist('2026-12-01', '18:00'), ist('2026-12-01', '20:00'));
  assert.deepEqual(a.map((j) => [j.key, j.at]), b.map((j) => [j.key, j.at]));
  assert.equal(a.length, 2); // example contact skipped
  assert.equal(a[0].kind, 'broadcast');
  assert.equal(a[0].header, true); // broadcasts get the VR Bot header by default
  assert.ok(a[1].at - a[0].at >= 8000 - 5 * 60000); // broadcast gap applied after jitter
});

test('group schedule gets kind=group and header', () => {
  const d = base({ schedules: [{ id: 'g', to: [{ type: 'group', id: '123@g.us' }], message: 'Class at 9:30, {group}', time: '08:30', repeat: { type: 'weekly', days: [1, 2, 3, 4, 5] } }] });
  const jobs = buildJobs(d, ist('2026-11-02', '00:00'), ist('2026-11-02', '23:59')).filter((j) => j.sourceId === 'g');
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].kind, 'group');
  assert.equal(jobs[0].header, true);
  assert.equal(jobs[0].text, 'Class at 9:30, AIML Class');
});

test('birthdays: exact midnight IST, age, Feb 29 → Feb 28, no header by default', () => {
  const d = base();
  d.settings.features.summary = false;
  const jobs = buildJobs(d, ist('2026-11-01', '12:00'), ist('2026-11-02', '12:00')).filter((j) => j.kind === 'birthday');
  assert.equal(jobs.length, 1);
  assert.equal(new Date(jobs[0].at).toISOString(), '2026-11-01T18:30:00.000Z');
  assert.equal(jobs[0].header, false);
  const feb = buildJobs(d, ist('2027-02-27', '12:00'), ist('2027-03-01', '12:00')).filter((j) => j.kind === 'birthday');
  assert.equal(feb[0].date, '2027-02-28');
});

test('festivals: built-in Diwali 2026 to a tag at chosen time', () => {
  const d = base({ festivals: { items: { diwali: { enabled: true, time: '07:00', to: [{ type: 'tag', tag: 'family' }], message: 'Happy {festival} {first_name}!' } } } });
  d.settings.features.summary = false; d.settings.features.birthdays = false;
  const jobs = buildJobs(d, ist('2026-11-08', '00:00'), ist('2026-11-09', '00:00'));
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].text, 'Happy Diwali Amma!');
  assert.equal(jobs[0].kind, 'festival');
  assert.equal(new Date(jobs[0].at).toISOString(), '2026-11-08T01:30:00.000Z');
});

test('festival calendar sanity', () => {
  for (const f of FESTIVALS) for (const [y, d] of Object.entries(f.dates)) assert.ok(d.startsWith(y), `${f.id} ${y}`);
  const up = upcomingFestivals(mergedFestivals({}), '2026-10-28', 3).map((f) => f.id);
  assert.deepEqual(up, ['diwali', 'guru-nanak', 'christmas']);
});

test('follow-up after X days of no reply (once per outgoing message)', () => {
  const lastOut = ist('2026-11-01', '15:00');
  const d = base({ memory: { lastOut: { '919000000003': lastOut }, lastIn: {} } });
  d.settings.features = { ...d.settings.features, followup: true, summary: false, birthdays: false };
  d.settings.followup = { days: 3, time: '10:00', message: 'Hey {first_name}?', contacts: ['c3'] };
  const jobs = buildJobs(d, ist('2026-11-04', '00:00'), ist('2026-11-06', '00:00'));
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].date, '2026-11-05'); // 3 days after 15:00 is past 10:00 on the 4th → next day 10:00
  d.memory.followed = { '919000000003': lastOut };
  assert.equal(buildJobs(d, ist('2026-11-04', '00:00'), ist('2026-11-06', '00:00')).length, 0);
});

test('master pause sends nothing; summary goes to owner daily', () => {
  const d = base();
  const jobs = buildJobs(d, ist('2026-11-03', '00:00'), ist('2026-11-04', '00:00'));
  assert.ok(jobs.some((j) => j.kind === 'summary' && j.to.number === '917989405979'));
  d.settings.paused = true;
  assert.equal(buildJobs(d, ist('2026-11-03', '00:00'), ist('2026-11-04', '00:00')).length, 0);
});
