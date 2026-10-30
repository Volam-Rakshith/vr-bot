// Auto status, weekly report, busy mode, stickers/GIFs ignored. © VR DEVELOPMENTS
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { QUOTES, nextQuoteIndex, shuffledOrder, formatQuote } from '../panel/shared/quotes.js';
import { statusAudience, nextStatus, statusLook, STATUS_COLORS, cleanAiQuote } from '../panel/shared/status.js';
import { parseBusy, busyNow, busyText, busyTimeText } from '../panel/shared/busy.js';
import { recordWeekly, pruneWeekly, weeklyStats, weeklyText } from '../panel/shared/report.js';
import { messageKind, shouldRespond, matchText, featureScope, inScope } from '../panel/shared/rules.js';
import { buildJobs } from '../panel/shared/planner.js';
import { withDefaults } from '../panel/shared/defaults.js';
import { zonedToUtc, addDays } from '../panel/shared/time.js';

process.env.OWNER_NUMBER = '919999999999';
const { Incoming } = await import('../src/incoming.js');

const TZ = 'Asia/Kolkata';
const ist = (d, t) => zonedToUtc(d, t, TZ);
const MIN = 60000;

/* ---------------- quotes ---------------- */
test('quotes: at least 150, each with an author, no duplicates', () => {
  assert.ok(QUOTES.length >= 150, `only ${QUOTES.length}`);
  assert.equal(new Set(QUOTES.map((q) => q[0])).size, QUOTES.length);
  for (const [q, a] of QUOTES) { assert.ok(q.length > 5 && q.length < 200, q); assert.ok(a && a.length > 1, q); }
  assert.match(formatQuote(['Do it.', 'Me']), /^“Do it\.”\n\n— Me$/);
});

test('quote rotation: no repeats until the whole list is used, then a fresh order', () => {
  let seed = 1;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const mem = {};
  const n = QUOTES.length;
  const first = Array.from({ length: n }, () => nextQuoteIndex(mem, n, rnd));
  assert.equal(new Set(first).size, n, 'every quote once');
  assert.deepEqual([...first].sort((a, b) => a - b), Array.from({ length: n }, (_, i) => i));
  const next = nextQuoteIndex(mem, n, rnd);
  assert.notEqual(next, first[n - 1], 'new cycle does not start with the last one');
  assert.equal(mem.pos, 1);
  // the rotation survives a save/load (only n, seed, pos are stored)
  const saved = JSON.parse(JSON.stringify(mem));
  assert.equal(nextQuoteIndex(saved, n, rnd), shuffledOrder(n, mem.seed)[1]);
  // a list that changed size starts a new cycle
  const m2 = { n: 10, seed: 5, pos: 3 };
  nextQuoteIndex(m2, 12, rnd);
  assert.equal(m2.n, 12); assert.equal(m2.pos, 1);
  assert.equal(nextQuoteIndex({}, 0), -1);
});

/* ---------------- status audience & content ---------------- */
const people = [
  { id: 'c1', name: 'Amma', number: '+91 98480 00001', tags: ['family'] },
  { id: 'c2', name: 'Nanna', number: '9848000002', tags: ['family'] },
  { id: 'c3', name: 'Saiteja', number: '+91 90000 00003', tags: ['friends'] },
  { id: 'c4', name: 'Client', number: '+91 90000 00004', tags: ['clients'] },
  { id: 'cx', name: 'Example', number: '+91 90000 00009', example: true },
  { id: 'cn', name: 'No number', number: '' },
];
const OWN = '917989405979';

test('status audience: everyone / only these / everyone except; you always first', () => {
  const all = statusAudience({ audience: 'all' }, { contacts: people, owner: OWN });
  assert.deepEqual(all.numbers, [OWN, '919848000001', '919848000002', '919000000003', '919000000004'], 'examples and empty numbers skipped');
  assert.equal(all.jids[0], `${OWN}@s.whatsapp.net`);
  const only = statusAudience({ audience: 'only', tags: ['family'], contacts: ['c3'] }, { contacts: people, owner: OWN });
  assert.deepEqual(only.numbers, [OWN, '919848000001', '919848000002', '919000000003']);
  const except = statusAudience({ audience: 'except', tags: ['clients'], contacts: ['c2'] }, { contacts: people, owner: OWN });
  assert.deepEqual(except.numbers, [OWN, '919848000001', '919000000003']);
  const none = statusAudience({ audience: 'only' }, { contacts: people, owner: OWN });
  assert.equal(none.nobody, true, 'nothing picked → only you → nobody');
  // owner already a contact → not twice
  const dup = statusAudience({ audience: 'all' }, { contacts: [{ id: 'me', number: '+91 79894 05979' }, people[0]], owner: OWN });
  assert.deepEqual(dup.numbers, [OWN, '919848000001']);
});

test('status audience: recent chatters (30 days), except-list respected, safety cap, test = only you', () => {
  const now = Date.UTC(2026, 9, 30);
  const recent = { '919111111111': now - 2 * 86400000, '919222222222': now - 40 * 86400000, '919848000002': now - 86400000 };
  const a = statusAudience({ audience: 'except', contacts: ['c2'], alsoRecent: true }, { contacts: people, owner: OWN, recent, nowMs: now });
  assert.ok(a.numbers.includes('919111111111'), 'texted 2 days ago');
  assert.ok(!a.numbers.includes('919222222222'), '40 days ago is too old');
  assert.ok(!a.numbers.includes('919848000002'), 'excluded contact stays excluded');
  const o = statusAudience({ audience: 'only', contacts: ['c1'], alsoRecent: true }, { contacts: people, owner: OWN, recent, nowMs: now });
  assert.deepEqual(o.numbers, [OWN, '919848000001'], '"only these" means only these');
  const capped = statusAudience({ audience: 'all', maxPeople: 3 }, { contacts: people, owner: OWN });
  assert.equal(capped.numbers.length, 3); assert.equal(capped.capped, true); assert.equal(capped.total, 5); assert.equal(capped.numbers[0], OWN);
  const t = statusAudience({ audience: 'all' }, { contacts: people, owner: OWN, testOnly: true });
  assert.deepEqual(t.numbers, [OWN]);
  const two = statusAudience({ audience: 'only', contacts: ['c1'] }, { contacts: people, owner: [OWN, '919999999999', OWN] });
  assert.deepEqual(two.numbers, [OWN, '919999999999', '919848000001']); assert.equal(two.self, 2); assert.equal(two.nobody, false);
});

test('status content: quote with rotating colour/font, own texts in turn, photo, AI line', () => {
  const mem = {};
  const a = nextStatus({ mode: 'quote' }, mem, { random: () => 0.5 });
  assert.match(a.content.text, /^“.+”\n\n— .+/s);
  assert.equal(a.options.backgroundColor, STATUS_COLORS[0]);
  assert.equal(typeof a.options.font, 'number');
  const b = nextStatus({ mode: 'quote' }, mem, { random: () => 0.5 });
  assert.notEqual(b.content.text, a.content.text);
  assert.equal(b.options.backgroundColor, STATUS_COLORS[1]);
  assert.deepEqual(statusLook({ color: '#112233', font: 8 }, {}), { backgroundColor: '#112233', font: 8 });
  const own = { mode: 'own', texts: ['One', ' ', 'Two'] }, m2 = {};
  assert.deepEqual([1, 2, 3].map(() => nextStatus(own, m2).content.text), ['One', 'Two', 'One']);
  assert.match(nextStatus({ mode: 'own', texts: [] }, {}).content.text, /—/, 'empty own list falls back to a quote');
  const photo = nextStatus({ mode: 'photo', photoUrl: 'https://x.y/p.jpg', photoCaption: 'hi' }, {});
  assert.deepEqual(photo.content, { image: { url: 'https://x.y/p.jpg' }, caption: 'hi' });
  assert.ok(nextStatus({ mode: 'photo', photoUrl: 'http://insecure' }, {}).content.text, 'bad link → quote instead');
  assert.equal(nextStatus({ mode: 'quote', aiFresh: true }, {}, { aiText: 'Keep going.' }).content.text, '“Keep going.”');
  assert.equal(cleanAiQuote('"Small steps every day."'), 'Small steps every day.');
  assert.equal(cleanAiQuote('Sorry, as an AI I cannot'), '');
});

/* ---------------- busy parsing ---------------- */
const NOW = ist('2026-10-30', '14:00'); // Fri 2 PM IST
test('busy: "2h", "30m", "1h30m", "1.5 hours", "" (1h), bare number', () => {
  assert.equal(parseBusy('2h', NOW, TZ).until, NOW + 120 * MIN);
  assert.equal(parseBusy('30m', NOW, TZ).until, NOW + 30 * MIN);
  assert.equal(parseBusy('30 mins', NOW, TZ).minutes, 30);
  assert.equal(parseBusy('1h30m', NOW, TZ).minutes, 90);
  assert.equal(parseBusy('1h 30m exam', NOW, TZ).minutes, 90, 'words after are ignored');
  assert.equal(parseBusy('1.5 hours', NOW, TZ).minutes, 90);
  assert.equal(parseBusy('2 HRS', NOW, TZ).minutes, 120);
  assert.equal(parseBusy('', NOW, TZ).minutes, 60);
  assert.equal(parseBusy('3', NOW, TZ).minutes, 180);
  assert.equal(parseBusy('1d', NOW, TZ).minutes, 1440);
  assert.ok(parseBusy('8 days', NOW, TZ).error);
  assert.ok(parseBusy('0m', NOW, TZ).error);
  assert.ok(parseBusy('banana', NOW, TZ).error);
});

test('busy: "until 5pm", "till 17:30", "5:30 pm", "until 9" (next one), past time → tomorrow, "off"', () => {
  assert.equal(parseBusy('until 5pm', NOW, TZ).until, ist('2026-10-30', '17:00'));
  assert.equal(parseBusy('till 17:30', NOW, TZ).until, ist('2026-10-30', '17:30'));
  assert.equal(parseBusy('until 5:30 pm', NOW, TZ).until, ist('2026-10-30', '17:30'));
  assert.equal(parseBusy('5pm', NOW, TZ).until, ist('2026-10-30', '17:00'));
  assert.equal(parseBusy('until 9', NOW, TZ).until, ist('2026-10-30', '21:00'), '9 → 9 PM today (9 AM has passed)');
  assert.equal(parseBusy('until 11am', NOW, TZ).until, ist('2026-10-31', '11:00'), 'past → tomorrow');
  assert.equal(parseBusy('until 12am', NOW, TZ).until, ist('2026-10-31', '00:00'));
  assert.ok(parseBusy('until 25:00', NOW, TZ).error);
  for (const w of ['off', 'OFF', 'stop', 'end']) assert.deepEqual(parseBusy(w, NOW, TZ), { off: true });
});

test('busy: newest switch wins (panel vs WhatsApp), ends by itself, {time} text', () => {
  const S = withDefaults({ version: 2, busy: { on: true, until: NOW + 60 * MIN, setAt: NOW - 10 * MIN } });
  assert.equal(busyNow(S, {}, NOW).active, true);
  assert.equal(busyNow(S, {}, NOW + 61 * MIN).active, false, 'turns off by itself');
  assert.equal(busyNow(S, { busy: { on: false, at: NOW - 5 * MIN } }, NOW).active, false, '!busy off after the panel switch wins');
  assert.equal(busyNow(S, { busy: { on: true, until: NOW + 5 * MIN, at: NOW - 20 * MIN } }, NOW).until, NOW + 60 * MIN, 'older !busy loses');
  assert.equal(busyNow(withDefaults({}), {}, NOW).active, false, 'off by default');
  assert.equal(busyTimeText(ist('2026-10-30', '17:00'), NOW, TZ), '5:00 PM');
  assert.equal(busyTimeText(ist('2026-10-31', '09:30'), NOW, TZ), 'tomorrow 9:30 AM');
  assert.equal(busyText("VR's busy right now, back by {time} 🙏", ist('2026-10-30', '17:00'), NOW, TZ), "VR's busy right now, back by 5:00 PM 🙏");
  assert.equal(inScope(featureScope(withDefaults({ version: 2 }), 'busy'), { contactId: 'c1' }), false, 'nobody picked by default');
  assert.equal(inScope(featureScope(withDefaults({ version: 2 }), 'busy'), { isGroup: true, groupId: 'g@g.us' }), false);
});

/* ---------------- weekly report ---------------- */
test('weekly report: counts only, top people/groups, vs last week, busiest hour/day, pruning', () => {
  const w = {};
  const at = (d, t) => ist(d, t);
  const add = (key, name, isGroup, d, t, times = 1) => { for (let i = 0; i < times; i++) recordWeekly(w, { key, name, isGroup, ts: at(d, t), tz: TZ }); };
  // this week (Mon 26 Oct – Sun 1 Nov)
  add('919848000001', 'Amma', false, '2026-10-27', '09:10', 5);
  add('919000000003', 'Saiteja', false, '2026-10-29', '21:15', 8);
  add('G1@g.us', 'AIML', true, '2026-10-29', '21:40', 20);
  add('G2@g.us', 'Family', true, '2026-11-01', '10:00', 3);
  // last week
  add('919848000001', 'Amma', false, '2026-10-20', '09:00', 2);
  add('G1@g.us', 'AIML', true, '2026-10-22', '12:00', 10);
  const st = weeklyStats(w, '2026-11-01', { groupNames: { 'G1@g.us': 'AIML 2nd Year' } });
  assert.equal(st.total, 36); assert.equal(st.prevTotal, 12); assert.equal(st.change, 200);
  assert.equal(st.chats, 4);
  assert.deepEqual(st.people.map((p) => [p.name, p.count, p.prev]), [['Saiteja', 8, 0], ['Amma', 5, 2]]);
  assert.deepEqual(st.groups.map((g) => [g.name, g.count]), [['AIML 2nd Year', 20], ['Family', 3]]);
  assert.equal(st.busiestHour, 21);
  assert.equal(st.busiestDay.name, 'Thursday'); assert.equal(st.busiestDay.count, 28);
  const txt = weeklyText(st);
  assert.match(txt, /\*36\* messages from \*4\* chats \(↑ 200% vs last week: 12\)/);
  assert.match(txt, /1\. Saiteja · 8 ↑8/);
  assert.match(txt, /Busiest hour: 9 PM – 10 PM/);
  assert.match(txt, /saves no chat text/);
  // nothing but counts and names is kept
  assert.deepEqual(Object.keys(w).sort(), ['d', 'n']);
  assert.deepEqual(Object.keys(w.d['2026-10-29']).sort(), ['c', 'h', 't']);
  pruneWeekly(w, '2026-11-08');
  assert.ok(!w.d['2026-10-20'] && !w.d['2026-10-22'], 'older than 15 days dropped');
  assert.ok(w.d['2026-10-27']);
  pruneWeekly(w, '2026-12-31');
  assert.deepEqual(w, { d: {}, n: {} });
  assert.match(weeklyText(weeklyStats({}, '2026-11-01')), /No messages counted/);
});

/* ---------------- planner ---------------- */
test('planner: weekly report Sunday 8 PM IST by default; auto status on chosen days only when switched on', () => {
  const base = (settings) => ({ settings: withDefaults({ version: 2, features: { summary: false, birthdays: false, festivals: false }, ...settings }), contacts: [], schedules: [], templates: [], festivals: {}, groups: [], memory: {}, ownerNumber: OWN });
  const from = ist('2026-10-26', '00:00'), to = ist('2026-11-02', '00:00');
  let jobs = buildJobs(base({}), from, to);
  assert.deepEqual(jobs.map((j) => [j.sourceId, j.date, j.time, j.dynamic]), [['weekly-report', '2026-11-01', '20:00', 'weekly']]);
  assert.equal(buildJobs(base({ weekly: { enabled: false } }), from, to).length, 0);
  jobs = buildJobs(base({ weekly: { enabled: false }, autoStatus: { enabled: true, time: '07:30', days: [1, 3, 5] } }), from, to);
  assert.deepEqual(jobs.map((j) => j.date), ['2026-10-26', '2026-10-28', '2026-10-30']);
  assert.equal(jobs[0].kind, 'status'); assert.equal(jobs[0].to.type, 'status'); assert.equal(jobs[0].header, false);
  assert.equal(new Date(jobs[0].at).toISOString(), '2026-10-26T02:00:00.000Z');
  assert.equal(buildJobs(base({ weekly: { enabled: false }, autoStatus: { enabled: true } }), from, to).length, 7, 'every day by default');
  assert.equal(buildJobs(base({ weekly: { enabled: false }, autoStatus: { enabled: false } }), from, to).length, 0);
  assert.equal(buildJobs(base({ weekly: { enabled: false }, autoStatus: { enabled: true, days: [] } }), from, to).length, 0);
});

/* ---------------- stickers & GIFs ---------------- */
test('message kinds: stickers, GIFs, reactions, deleted, polls are not answered; empty text never matches', () => {
  assert.equal(messageKind({ stickerMessage: {} }, 'stickerMessage'), 'sticker');
  assert.equal(messageKind({ videoMessage: { gifPlayback: true } }, 'videoMessage'), 'gif');
  assert.equal(messageKind({ videoMessage: { caption: 'x' } }, 'videoMessage'), 'message');
  assert.equal(messageKind({ reactionMessage: {} }, 'reactionMessage'), 'reaction');
  assert.equal(messageKind({ protocolMessage: { type: 0 } }, 'protocolMessage'), 'protocol');
  assert.equal(messageKind({ pollCreationMessageV3: {} }, 'pollCreationMessageV3'), 'poll');
  assert.equal(messageKind(null, null), 'empty');
  assert.equal(shouldRespond({ kind: 'message', text: 'hi' }), true);
  assert.equal(shouldRespond({ kind: 'message', text: '' }), false, 'photo without caption');
  assert.equal(shouldRespond({ kind: 'message', text: '   ' }), false);
  assert.equal(shouldRespond({ kind: 'sticker', text: '' }), false);
  assert.equal(shouldRespond({ kind: 'gif', text: 'lol' }), false, 'GIF with caption still ignored by default');
  assert.equal(shouldRespond({ kind: 'sticker' }, { stickers: true }), true);
  assert.equal(shouldRespond({ kind: 'gif', text: 'lol' }, { stickers: true }), true);
  assert.equal(shouldRespond({ kind: 'reaction' }, { stickers: true }), false);
  assert.equal(shouldRespond({ kind: 'poll' }, { stickers: true }), false);
  for (const rule of [{ pattern: '.*', match: 'regex' }, { pattern: 'a', match: 'contains' }, { pattern: ' ', match: 'exact' }]) {
    assert.equal(matchText(rule, ''), false); assert.equal(matchText(rule, '   '), false);
  }
});

/* ---------------- the real message handler with a fake WhatsApp ---------------- */
const ME = '919999999999', G1 = '120363000000000001@g.us', G2 = '120363000000000002@g.us';
function harness({ settings = {}, rules = [], contacts = [] } = {}) {
  const sent = [];
  const wa = { me: () => ME, isMe: (j) => String(j || '').startsWith(ME), pnFor: async (jid, alt) => String(alt || jid || '').split('@')[0].split(':')[0], sock: { user: { id: `${ME}@s.whatsapp.net` } } };
  const state = {
    memory: { processed: [], sentIds: [], lastOut: {}, lastIn: {}, cooldowns: {}, aiCount: {}, ai: {}, awaySent: {}, warns: {} },
    status: { inbox: {}, groups: [{ id: G1, name: 'AIML' }, { id: G2, name: 'Other' }] },
  };
  const data = { settings: withDefaults({ version: 2, ...settings }), rules, contacts, groupsCfg: {} };
  const inc = new Incoming({ wa, getData: () => data, state, send: async (jid, content) => { sent.push({ jid, content }); return { key: { id: 'S' + sent.length } }; }, media: null });
  return { inc, sent, state, data };
}
let n = 0;
const ts = () => Math.floor(Date.now() / 1000) - 30;
const dm = (num, message) => ({ key: { remoteJid: `${num}@s.whatsapp.net`, id: 'X' + ++n, fromMe: false }, messageTimestamp: ts(), message: typeof message === 'string' ? { conversation: message } : message });
const gm = (group, num, message) => ({ key: { remoteJid: group, participant: `${num}@s.whatsapp.net`, id: 'X' + ++n, fromMe: false }, messageTimestamp: ts(), message: typeof message === 'string' ? { conversation: message } : message });
const mine = (text) => ({ key: { remoteJid: `${ME}@s.whatsapp.net`, id: 'X' + ++n, fromMe: true }, messageTimestamp: ts(), message: { conversation: text } });
const STICKER = { stickerMessage: { mimetype: 'image/webp' } };
const GIF = { videoMessage: { gifPlayback: true, caption: 'thanks lol', mimetype: 'video/mp4' } };

test('stickers & GIFs: no rule reply, no away reply by default; toggle lets them through', async () => {
  const rules = [{ id: 't', pattern: 'thanks', reply: 'Welcome!', where: 'both', cooldownMinutes: 0 }];
  const away = { features: { away: true }, away: { window: { enabled: false } } };
  let h = harness({ rules, settings: away });
  h.inc.push({ messages: [dm('919000000001', STICKER), dm('919000000002', GIF), gm(G1, '919000000003', GIF), gm(G1, '919000000004', STICKER), dm('919000000005', { reactionMessage: { text: '❤️' } }), dm('919000000006', { protocolMessage: { type: 0 } })] });
  await h.inc.drain();
  assert.equal(h.sent.length, 0, JSON.stringify(h.sent));
  // real text still works (rule), and a photo without caption still gets the away message
  h.inc.push({ messages: [dm('919000000007', 'thanks bro'), dm('919000000008', { imageMessage: { mimetype: 'image/jpeg' } })] });
  await h.inc.drain();
  assert.deepEqual(h.sent.map((s) => s.content.text), ['Welcome!', "Hey! I'm away right now 🙂 I'll reply when I'm back."]);
  // toggle on: the GIF caption can match a rule, a sticker gets the away message
  h = harness({ rules, settings: { ...away, replies: { stickers: true } } });
  h.inc.push({ messages: [dm('919000000002', GIF), dm('919000000001', STICKER)] });
  await h.inc.drain();
  assert.deepEqual(h.sent.map((s) => s.content.text), ['Welcome!', "Hey! I'm away right now 🙂 I'll reply when I'm back."]);
  // stickers/GIFs are still counted for the weekly report (counts only)
  const counted = Object.values(h.state.status.weekly.d)[0].t;
  assert.equal(counted, 2);
  assert.ok(!JSON.stringify(h.state.status.weekly).includes('thanks'), 'no message text stored');
});

test('busy mode: !busy 2h → once per picked chat, not elsewhere, groups only when tagged; ends and tells me', async () => {
  const contacts = [{ id: 'c1', name: 'Amma', number: '+91 98480 00001' }, { id: 'c2', name: 'Ravi', number: '+91 90000 00002' }];
  const h = harness({ contacts, settings: { busy: { who: 'pick', contacts: ['c1'], groups: [G1], message: 'Busy till {time}' } } });
  h.inc.push({ messages: [mine('!busy 2h')] });
  await h.inc.drain();
  assert.match(h.sent[0].content.text, /Busy mode ON until/);
  assert.match(h.sent[0].content.text, /1 picked person\/list \+ 1 group/);
  h.sent.length = 0;
  await h.inc.busyTick();
  const tagged = { extendedTextMessage: { text: 'where are you', contextInfo: { mentionedJid: [`${ME}@s.whatsapp.net`] } } };
  h.inc.push({ messages: [dm('919848000001', 'hi'), dm('919848000001', 'hello??'), dm('919000000002', 'hi'), gm(G1, '919000000005', 'random chat'), gm(G1, '919000000005', tagged), gm(G2, '919000000006', tagged), dm('919848000001', STICKER)] });
  await h.inc.drain();
  assert.deepEqual(h.sent.map((s) => s.jid), ['919848000001@s.whatsapp.net', G1], JSON.stringify(h.sent));
  assert.match(h.sent[0].content.text, /^Busy till \d{1,2}:\d{2} [AP]M$/);
  // time is up → off by itself + one message to me
  h.state.status.busy.until = Date.now() - 1000;
  h.sent.length = 0;
  await h.inc.busyTick();
  await h.inc.busyTick();
  assert.equal(h.sent.length, 1);
  assert.equal(h.sent[0].jid, `${ME}@s.whatsapp.net`);
  assert.match(h.sent[0].content.text, /Busy mode is off now[\s\S]*2 chats got your busy reply/);
  // new session → Amma gets it again; !busy off → no "time is up" message later
  h.sent.length = 0;
  h.inc.push({ messages: [mine('!busy until 11:59pm'), dm('919848000001', 'hi again')] });
  await h.inc.drain();
  assert.equal(h.sent.length, 2);
  h.inc.push({ messages: [mine('!busy off')] });
  await h.inc.drain();
  assert.match(h.sent[2].content.text, /Busy mode OFF\. 1 chat got your busy reply/);
  await h.inc.busyTick();
  assert.equal(h.sent.length, 3);
});

test('busy mode: nobody picked → nobody gets it, and !busy warns me', async () => {
  const h = harness({ contacts: [{ id: 'c1', name: 'Amma', number: '+91 98480 00001' }] });
  h.inc.push({ messages: [mine('!busy 30m'), dm('919848000001', 'hi')] });
  await h.inc.drain();
  assert.equal(h.sent.length, 1);
  assert.match(h.sent[0].content.text, /No chats picked yet/);
});

test('busy mode from the panel switch works the same way', async () => {
  const h = harness({ contacts: [{ id: 'c1', name: 'Amma', number: '+91 98480 00001' }], settings: { busy: { who: 'pick', contacts: ['c1'], on: true, until: Date.now() + 3600000, setAt: Date.now() - 1000 } } });
  h.inc.push({ messages: [dm('919848000001', 'hi')] });
  await h.inc.drain();
  assert.equal(h.sent.length, 1);
  assert.match(h.sent[0].content.text, /^VR's busy right now, back by .+ 🙏$/);
});

/* ---------------- end-to-end dry run: the runner posts the status and the weekly report ---------------- */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decryptJSON } from '../panel/shared/crypto.js';
import { localDate, localTime } from '../panel/shared/time.js';

test('dry run: auto status goes out on time to the picked people (+ you), test status only to you, once only', { timeout: 120000 }, async () => {
  const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const sh = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: 'utf8', ...opts });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vrbot-st-'));
  const origin = path.join(tmp, 'origin.git'), work = path.join(tmp, 'work');
  sh('git', ['init', '-q', '--bare', origin]);
  fs.mkdirSync(work);
  for (const d of ['src', 'panel']) fs.cpSync(path.join(REPO, d), path.join(work, d), { recursive: true });
  fs.copyFileSync(path.join(REPO, 'package.json'), path.join(work, 'package.json'));
  fs.symlinkSync(path.join(REPO, 'node_modules'), path.join(work, 'node_modules'));
  const now = Date.now(), tz = 'Asia/Kolkata', due = now - 3 * 60000;
  const data = {
    settings: { version: 2, timezone: tz, features: { summary: false, alerts: false, birthdays: false, festivals: false }, timing: { minOnlineSeconds: 1, lookaheadMinutes: 1 }, weekly: { enabled: false },
      autoStatus: { enabled: true, time: localTime(due, tz), days: [0, 1, 2, 3, 4, 5, 6], audience: 'except', contacts: ['c2'], special: { enabled: false } } }, // special days: own test file (today might be one)
    contacts: { contacts: [{ id: 'c1', name: 'Amma', number: '+91 98480 00001' }, { id: 'c2', name: 'Boss', number: '+91 98480 00002' }, { id: 'c3', name: 'Ravi', number: '+91 98480 00003' }] },
    schedules: { schedules: [] }, templates: { templates: [] }, festivals: {}, groups: { groups: {} }, rules: { rules: [] },
  };
  if (localDate(due, tz) !== localDate(now, tz)) return; // right at midnight: skip rather than be flaky
  fs.mkdirSync(path.join(work, 'data'));
  for (const [k, v] of Object.entries(data)) fs.writeFileSync(path.join(work, 'data', `${k}.json`), JSON.stringify(v));
  sh('git', ['init', '-q', '-b', 'main'], { cwd: work });
  sh('git', ['remote', 'add', 'origin', origin], { cwd: work });
  const env = { ...process.env, VR_FAKE_WA: '1', VR_PASSPHRASE: 'test-pass-123', OWNER_NUMBER: '917989405979', GITHUB_ACTIONS: '', GROQ_API_KEY: '' };
  const run1 = sh(process.execPath, ['src/index.js', 'run'], { cwd: work, env });
  assert.equal(run1.status, 0, run1.stdout + run1.stderr);
  assert.match(run1.stdout, /would post a text status for 4 people/, run1.stdout); // you + the bot's own number (different in this test) + Amma + Ravi (Boss excluded)
  assert.ok(!run1.stdout.includes('Amma') && !run1.stdout.includes('“'), 'public log has no names or status text');
  assert.equal(sh(process.execPath, ['src/index.js', 'save'], { cwd: work, env }).status, 0);
  const sentlog = await decryptJSON(JSON.parse(sh('git', ['--git-dir', origin, 'show', 'vr-state:sentlog.json']).stdout), 'test-pass-123');
  const e = Object.entries(sentlog.entries).find(([k]) => k.startsWith('status:auto-status:'));
  assert.ok(e, JSON.stringify(sentlog));
  assert.equal(e[1].s, 'sent');
  assert.match(e[1].label, /Auto status \(quote #\d+, 2 people\)/);
  const memory = await decryptJSON(JSON.parse(sh('git', ['--git-dir', origin, 'show', 'vr-state:memory.json']).stdout), 'test-pass-123');
  assert.equal(memory.autoStatus.quote.pos, 1, 'rotation remembered');
  // next run: not posted twice
  fs.rmSync(path.join(work, '.vr'), { recursive: true, force: true });
  const run2 = sh(process.execPath, ['src/index.js', 'run'], { cwd: work, env });
  assert.doesNotMatch(run2.stdout, /would post/, run2.stdout);
  sh(process.execPath, ['src/index.js', 'save'], { cwd: work, env });
  // panel button "Post test status now" → only you
  fs.rmSync(path.join(work, '.vr'), { recursive: true, force: true });
  const run3 = sh(process.execPath, ['src/index.js', 'run'], { cwd: work, env: { ...env, VR_ACTION: 'test-send', VR_TARGET: '@status' } });
  assert.match(run3.stdout, /would post a text status for 2 people/, run3.stdout); // only you (+ the bot's own number)
  assert.match(run3.stdout, /Test status posted/);
  // Special days → "Post test now" on the Diwali card: the real picture, only to you
  fs.rmSync(path.join(work, '.vr'), { recursive: true, force: true });
  const run3b = sh(process.execPath, ['src/index.js', 'run'], { cwd: work, env: { ...env, VR_ACTION: 'test-send', VR_TARGET: '@special:diwali' } });
  assert.match(run3b.stdout, /would post a photo status for 2 people/, run3b.stdout);
  assert.match(run3b.stdout, /Test status posted \(special day: Diwali\)/);
  // "Send me this week's report now"
  fs.rmSync(path.join(work, '.vr'), { recursive: true, force: true });
  const run4 = sh(process.execPath, ['src/index.js', 'run'], { cwd: work, env: { ...env, VR_ACTION: 'test-send', VR_TARGET: '@report' } });
  assert.match(run4.stdout, /Weekly report sent to you/, run4.stdout);
  fs.rmSync(tmp, { recursive: true, force: true });
});
