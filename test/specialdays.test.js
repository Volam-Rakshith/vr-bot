// Special days: image-card statuses on festivals / national / world days. © VR DEVELOPMENTS
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SPECIAL_DAYS, SPECIAL_BY_ID, specialFor, specialsOn, upcomingSpecials, specialCaption, specialConfig, cardFile } from '../panel/shared/specialdays.js';
import { buildJobs } from '../panel/shared/planner.js';
import { withDefaults } from '../panel/shared/defaults.js';
import { zonedToUtc, localDate, weekdayOf } from '../panel/shared/time.js';

process.env.OWNER_NUMBER = '917989405979';
const { postStatus } = await import('../src/features/autostatus.js');

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TZ = 'Asia/Kolkata';
const ist = (d, t) => zonedToUtc(d, t, TZ);
const ON = { enabled: true };

test('special days: every day has exact 2026 + 2027 dates, a source, and a 1080x1920 card under 300 KB', () => {
  assert.ok(SPECIAL_DAYS.length >= 30);
  assert.equal(new Set(SPECIAL_DAYS.map((d) => d.id)).size, SPECIAL_DAYS.length, 'unique ids');
  for (const d of SPECIAL_DAYS) {
    for (const y of ['2026', '2027']) {
      assert.match(d.dates[y] || '', new RegExp(`^${y}-\\d\\d-\\d\\d$`), `${d.id} ${y}`);
      assert.equal(localDate(ist(d.dates[y], '12:00'), TZ), d.dates[y], `${d.id} ${y} is a real date`);
    }
    assert.ok(d.src && d.title && d.line && d.caption && d.name, d.id);
    assert.ok(!/[\u{1F300}-\u{1FAFF}\u2600-\u27BF]/u.test(d.title + d.line), `${d.id}: no emoji on the picture text`);
    const f = path.join(REPO, cardFile(d.id));
    const buf = fs.readFileSync(f);
    assert.equal(buf.toString('ascii', 1, 4), 'PNG', d.id);
    assert.deepEqual([buf.readUInt32BE(16), buf.readUInt32BE(20)], [1080, 1920], `${d.id} size`);
    assert.ok(buf.length <= 300 * 1024, `${d.id} is ${buf.length} bytes`);
  }
  // moon-based (Islamic) days say so; fixed ones never do
  for (const id of ['eid-ul-fitr', 'eid-al-adha']) assert.match(SPECIAL_BY_ID[id].approx, /±1 day/);
  assert.equal(SPECIAL_DAYS.filter((d) => d.approx).length, 2);
  // a few anchors he asked about
  assert.equal(specialsOn('2026-10-30')[0].id, 'savings-day');
  assert.equal(specialsOn('2026-11-08')[0].id, 'diwali');
  assert.equal(specialsOn('2027-01-15')[0].id, 'sankranti');
  assert.equal(specialsOn('2026-06-02')[0].id, 'telangana-day');
  assert.equal(weekdayOf(SPECIAL_BY_ID['mothers-day'].dates[2027]), 0, "Mother's Day is a Sunday");
});

test('special days: date lookup uses IST (midnight edge), switches, clashes', () => {
  // Diwali 2026 = 8 Nov in India. 7 Nov 18:29 UTC is still 7 Nov 23:59 IST; 18:30 UTC is 8 Nov 00:00 IST.
  assert.equal(localDate(Date.parse('2026-11-07T18:29:00Z'), TZ), '2026-11-07');
  assert.equal(specialFor(localDate(Date.parse('2026-11-07T18:29:00Z'), TZ), ON), null);
  assert.equal(specialFor(localDate(Date.parse('2026-11-07T18:30:00Z'), TZ), ON).id, 'diwali');
  assert.equal(specialFor(localDate(Date.parse('2026-11-08T18:29:59Z'), TZ), ON).id, 'diwali');
  assert.equal(specialFor(localDate(Date.parse('2026-11-08T18:30:00Z'), TZ), ON), null, '9 Nov IST: over');
  // switches
  assert.equal(specialFor('2026-11-08', { enabled: false }), null, 'auto status off → nothing');
  assert.equal(specialFor('2026-11-08', { enabled: true, special: { enabled: false } }), null, 'special days off');
  assert.equal(specialFor('2026-11-08', { enabled: true, special: { items: { diwali: { off: true } } } }), null, 'Diwali switched off');
  // two days on one date: higher priority wins; switch it off → the other one
  assert.equal(specialFor('2026-06-21', ON).id, 'fathers-day');
  assert.equal(specialFor('2026-06-21', { enabled: true, special: { items: { 'fathers-day': { off: true } } } }).id, 'yoga-day');
  // upcoming list for the panel
  const up = upcomingSpecials('2026-10-30', 60, { enabled: true, special: { items: { diwali: { caption: 'Happy Deepavali from VR 🪔' } } } });
  assert.deepEqual(up.map((r) => r.id), ['savings-day', 'diwali', 'childrens-day', 'christmas']);
  assert.equal(up[1].caption, 'Happy Deepavali from VR 🪔');
  assert.equal(specialCaption(SPECIAL_BY_ID.diwali, specialConfig({})), SPECIAL_BY_ID.diwali.caption);
  assert.equal(upcomingSpecials('2026-06-20', 3, ON).find((r) => r.id === 'yoga-day').clash, 'Father\u2019s Day');
  assert.deepEqual(specialConfig({}), { enabled: true, offDays: true, items: {} }, 'default ON');
});

test('planner: special days on off days ("Post special days even on my off days"), still one status a day', () => {
  const base = (autoStatus) => ({ settings: withDefaults({ version: 2, weekly: { enabled: false }, features: { summary: false, birthdays: false, festivals: false }, autoStatus }), contacts: [], schedules: [], templates: [], festivals: {}, groups: [], memory: {}, ownerNumber: '917989405979' });
  const from = ist('2026-11-02', '00:00'), to = ist('2026-11-16', '00:00'); // Diwali Sun 8 Nov, Children's Day Sat 14 Nov
  const weekdays = { enabled: true, time: '08:00', days: [1, 2, 3, 4, 5] };
  let jobs = buildJobs(base(weekdays), from, to);
  const dates = jobs.map((j) => j.date);
  assert.ok(dates.includes('2026-11-08') && dates.includes('2026-11-14'), 'weekend festivals still get a post');
  assert.equal(dates.length, new Set(dates).size, 'never two status jobs on one day');
  const diwali = jobs.find((j) => j.date === '2026-11-08');
  assert.equal(diwali.dynamic, 'status-special'); assert.match(diwali.label, /Diwali/);
  assert.equal(new Date(diwali.at).toISOString(), '2026-11-08T02:30:00.000Z', '8:00 AM IST');
  assert.equal(jobs.filter((j) => j.dynamic === 'status').length, 10, 'normal weekday posts unchanged');
  // setting off → only the chosen days
  jobs = buildJobs(base({ ...weekdays, special: { offDays: false } }), from, to);
  assert.ok(!jobs.some((j) => j.date === '2026-11-08' || j.date === '2026-11-14'));
  // one day switched off → that day is skipped, the other still posts
  jobs = buildJobs(base({ ...weekdays, special: { items: { diwali: { off: true } } } }), from, to);
  assert.ok(!jobs.some((j) => j.date === '2026-11-08')); assert.ok(jobs.some((j) => j.date === '2026-11-14'));
  // special days off, or auto status off → nothing extra
  assert.equal(buildJobs(base({ ...weekdays, special: { enabled: false } }), from, to).length, 10);
  assert.equal(buildJobs(base({ ...weekdays, enabled: false }), from, to).length, 0);
  // every day: a special day is the normal daily job (labelled), not a second one
  jobs = buildJobs(base({ enabled: true, time: '08:00' }), from, to);
  assert.equal(jobs.length, 14);
  assert.match(jobs.find((j) => j.date === '2026-11-08').label, /Special day · Diwali/);
  // status time just after midnight: the job belongs to the IST date even though UTC is still the day before
  jobs = buildJobs(base({ ...weekdays, time: '00:05' }), ist('2026-11-07', '12:00'), ist('2026-11-08', '12:00'));
  assert.deepEqual(jobs.map((j) => [j.date, new Date(j.at).toISOString(), j.dynamic]), [['2026-11-08', '2026-11-07T18:35:00.000Z', 'status-special']]);
});

/* ---------------- posting ---------------- */
const people = [{ id: 'c1', name: 'Amma', number: '+91 98480 00001' }, { id: 'c2', name: 'Ravi', number: '+91 98480 00003' }];
const fakeSend = (fail = () => false) => {
  const sent = [];
  const send = async (jid, content, opts) => { if (fail(content)) throw new Error('media upload failed'); sent.push({ jid, content, opts }); return { key: { id: 'X' + sent.length } }; };
  return { sent, send };
};
const ctx = (autoStatus = {}, memory = {}) => ({
  data: { settings: withDefaults({ version: 2, timezone: TZ, autoStatus: { enabled: true, ...autoStatus } }), contacts: people },
  state: { memory: { lastIn: {}, ...memory } },
  ownerNumber: '917989405979', botNumber: '919999999999',
});
const PNG = Buffer.from('89504e47', 'hex');
const DIWALI = ist('2026-11-08', '08:00');

test('postStatus: special day → image card + caption to the same people as the quote; one status per day', async () => {
  const f = fakeSend(); const c = ctx();
  const r = await postStatus({ ...c, send: f.send, nowMs: DIWALI, loadCard: (id) => (id === 'diwali' ? PNG : null) });
  assert.equal(f.sent.length, 1);
  assert.equal(f.sent[0].jid, 'status@broadcast');
  assert.equal(f.sent[0].content.image, PNG);
  assert.equal(f.sent[0].content.caption, SPECIAL_BY_ID.diwali.caption);
  assert.equal(f.sent[0].opts.statusJidList.length, 4, 'you + bot number + 2 contacts');
  assert.equal(r.special, 'diwali'); assert.match(r.label, /special day: Diwali/); assert.equal(r.count, 2);
  // a second post the same day (e.g. you changed the time) is skipped
  const again = await postStatus({ ...c, send: f.send, nowMs: DIWALI + 3600000, loadCard: () => PNG });
  assert.match(again.skipped, /only one per day/); assert.equal(f.sent.length, 1);
  // the next day is a normal quote again
  const next = await postStatus({ ...c, send: f.send, nowMs: DIWALI + 86400000, loadCard: () => PNG });
  assert.match(next.label, /^quote #/); assert.ok(f.sent[1].content.text);
  // the real card file is used by default
  const f2 = fakeSend(); const r2 = await postStatus({ ...ctx(), send: f2.send, nowMs: ist('2026-10-30', '08:00') });
  assert.equal(r2.special, 'savings-day'); assert.ok(Buffer.isBuffer(f2.sent[0].content.image) && f2.sent[0].content.image.length > 50000);
});

test('postStatus: picture fails → text status with the wish; own caption; per-day off → quote; off-day job skipped', async () => {
  const f = fakeSend((content) => !!content.image);
  const c = ctx({ special: { items: { diwali: { caption: 'Happy Deepavali from VR 🪔' } } } });
  const r = await postStatus({ ...c, send: f.send, nowMs: DIWALI, loadCard: () => PNG });
  assert.equal(r.fallback, true); assert.match(r.label, /text, picture failed/);
  assert.equal(f.sent.length, 1); assert.equal(f.sent[0].content.text, 'Happy Deepavali from VR 🪔');
  assert.ok(f.sent[0].opts.backgroundColor && f.sent[0].opts.statusJidList.length === 4);
  assert.equal(c.state.memory.autoStatus.lastDate, '2026-11-08', 'counts as today\'s one status');
  // card file missing → straight to text
  const f2 = fakeSend(); const r2 = await postStatus({ ...ctx(), send: f2.send, nowMs: DIWALI, loadCard: () => null });
  assert.equal(r2.fallback, true); assert.equal(f2.sent[0].content.text, SPECIAL_BY_ID.diwali.caption);
  // both fail → error (the bot retries later; not marked as posted)
  const c3 = ctx(); const f3 = fakeSend(() => true);
  await assert.rejects(postStatus({ ...c3, send: f3.send, nowMs: DIWALI, loadCard: () => PNG }), /media upload failed/);
  assert.equal(c3.state.memory.autoStatus.lastDate, undefined);
  // Diwali switched off → the usual quote
  const f4 = fakeSend(); const r4 = await postStatus({ ...ctx({ special: { items: { diwali: { off: true } } } }), send: f4.send, nowMs: DIWALI, loadCard: () => PNG });
  assert.match(r4.label, /^quote #/);
  // planned only because it was a special day (an off day), but switched off since → nothing
  const f5 = fakeSend(); const r5 = await postStatus({ ...ctx({ special: { items: { diwali: { off: true } } } }), send: f5.send, nowMs: DIWALI, date: '2026-11-08', onlySpecial: true, loadCard: () => PNG });
  assert.match(r5.skipped, /no longer a special day/); assert.equal(f5.sent.length, 0);
  // job date wins over the clock (a status planned for 23:55 that goes out at 00:02 is still that day's)
  const f6 = fakeSend(); const r6 = await postStatus({ ...ctx(), send: f6.send, nowMs: ist('2026-11-09', '00:02'), date: '2026-11-08', loadCard: () => PNG });
  assert.equal(r6.special, 'diwali');
});

test('postStatus: "Post test now" for one card → only you, and today\'s real status is not used up', async () => {
  const f = fakeSend(); const c = ctx();
  const r = await postStatus({ ...c, send: f.send, test: true, specialId: 'sankranti', nowMs: DIWALI, loadCard: () => PNG });
  assert.equal(r.special, 'sankranti');
  assert.deepEqual(f.sent[0].opts.statusJidList, ['917989405979@s.whatsapp.net', '919999999999@s.whatsapp.net']);
  assert.equal(f.sent[0].content.caption, SPECIAL_BY_ID.sankranti.caption);
  assert.equal(c.state.memory.autoStatus.lastDate, undefined, 'the real Diwali post still goes out');
  await assert.rejects(postStatus({ ...c, send: f.send, test: true, specialId: 'nope' }), /unknown special day/);
});
