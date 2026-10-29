import { test } from 'node:test';
import assert from 'node:assert/strict';
import { occursOn, occurrencesBetween, nextOccurrence, jitterMs, describe } from '../panel/shared/scheduler.js';
import { zonedToUtc, localDate, localTime, addDays, weekdayOf, inDailyWindow } from '../panel/shared/time.js';

const TZ = 'Asia/Kolkata';
const ist = (d, t) => zonedToUtc(d, t, TZ);

test('IST conversion: 07:00 IST is 01:30 UTC', () => {
  assert.equal(new Date(ist('2026-11-02', '07:00')).toISOString(), '2026-11-02T01:30:00.000Z');
  assert.equal(new Date(ist('2026-11-02', '00:00')).toISOString(), '2026-11-01T18:30:00.000Z');
  assert.equal(localDate(Date.parse('2026-11-01T18:30:00Z'), TZ), '2026-11-02');
  assert.equal(localTime(Date.parse('2026-11-01T18:29:00Z'), TZ), '23:59');
});

test('weekday + date arithmetic', () => {
  assert.equal(weekdayOf('2026-10-28'), 3); // Wednesday
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2028-02-28', 1), '2028-02-29');
});

test('daily with skip days (skip Sundays)', () => {
  const s = { id: 'a', time: '07:00', repeat: { type: 'daily' }, skipDays: [0] };
  assert.equal(occursOn(s, '2026-11-01'), false); // Sunday
  assert.equal(occursOn(s, '2026-11-02'), true);  // Monday
  const occ = occurrencesBetween(s, ist('2026-10-31', '00:00'), ist('2026-11-03', '00:00'), TZ);
  assert.deepEqual(occ.map((o) => o.date), ['2026-10-31', '2026-11-02']);
  assert.equal(new Date(occ[0].at).toISOString(), '2026-10-31T01:30:00.000Z');
});

test('weekly on chosen weekdays + skip dates + date range', () => {
  const s = { id: 'b', time: '08:30', repeat: { type: 'weekly', days: [1, 3, 5] }, skipDates: ['2026-11-04'], start: '2026-11-01', end: '2026-11-13' };
  const occ = occurrencesBetween(s, ist('2026-10-01', '00:00'), ist('2026-12-01', '00:00'), TZ).map((o) => o.date);
  assert.deepEqual(occ, ['2026-11-02', '2026-11-06', '2026-11-09', '2026-11-11', '2026-11-13']);
});

test('once', () => {
  const s = { id: 'c', time: '19:00', repeat: { type: 'once', date: '2026-12-01' } };
  const n = nextOccurrence(s, ist('2026-10-28', '12:00'), TZ);
  assert.equal(n.date, '2026-12-01');
  assert.equal(nextOccurrence(s, ist('2026-12-01', '19:01'), TZ), null);
});

test('monthly: day 31 falls back to last day; "last"', () => {
  const s = { id: 'd', time: '10:00', repeat: { type: 'monthly', day: 31 } };
  const dates = occurrencesBetween(s, ist('2027-01-01', '00:00'), ist('2027-05-01', '00:00'), TZ).map((o) => o.date);
  assert.deepEqual(dates, ['2027-01-31', '2027-02-28', '2027-03-31', '2027-04-30']);
  const l = { id: 'e', time: '10:00', repeat: { type: 'monthly', day: 'last' } };
  assert.equal(occursOn(l, '2028-02-29'), true);
});

test('yearly birthdays incl. Feb 29 in non-leap years', () => {
  const s = { id: 'f', time: '00:00', repeat: { type: 'yearly', month: 2, day: 29 } };
  assert.equal(nextOccurrence(s, ist('2026-10-28', '00:00'), TZ).date, '2027-02-28');
  assert.equal(nextOccurrence(s, ist('2027-03-01', '00:00'), TZ).date, '2028-02-29');
  const b = { id: 'g', time: '00:00', repeat: { type: 'yearly', month: 11, day: 2 } };
  const n = nextOccurrence(b, ist('2026-10-28', '15:00'), TZ);
  assert.equal(n.date, '2026-11-02');
  assert.equal(new Date(n.at).toISOString(), '2026-11-01T18:30:00.000Z'); // midnight IST
});

test('disabled schedule never fires; window bounds are [from, to)', () => {
  assert.equal(occursOn({ enabled: false, time: '07:00', repeat: { type: 'daily' } }, '2026-11-02'), false);
  const s = { id: 'h', time: '07:00', repeat: { type: 'daily' } };
  const at = ist('2026-11-02', '07:00');
  assert.equal(occurrencesBetween(s, at, at + 1, TZ).length, 1);
  assert.equal(occurrencesBetween(s, at + 1, at + 60000, TZ).length, 0);
});

test('human-like jitter is stable and bounded', () => {
  const a = jitterMs('s1:2026-11-02', 5), b = jitterMs('s1:2026-11-02', 5);
  assert.equal(a, b);
  assert.ok(Math.abs(a) <= 5 * 60000);
  assert.equal(jitterMs('x', 0), 0);
});

test('daily window (away hours) wraps midnight', () => {
  assert.equal(inDailyWindow('23:30', '23:00', '07:00'), true);
  assert.equal(inDailyWindow('06:59', '23:00', '07:00'), true);
  assert.equal(inDailyWindow('07:00', '23:00', '07:00'), false);
  assert.equal(inDailyWindow('12:00', '09:00', '17:00'), true);
});

test('describe()', () => {
  assert.equal(describe({ time: '07:00', repeat: { type: 'daily' }, skipDays: [0] }), 'Every day at 07:00 · skips Sun');
});
