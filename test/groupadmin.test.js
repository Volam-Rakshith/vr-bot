// 👮 Group admin: owner-only commands, warns → kick at a custom N, !mute timer, anti-spam, bad words,
// slow mode, night lock across midnight, goodbye, !report, !poll, !pin, !summary. © VR DEVELOPMENTS
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withDefaults } from '../panel/shared/defaults.js';
import {
  parseDuration, parseLockRange, parseClock, inLockWindow, warnLimitOf, spamCfgOf, slowCfgOf, badWordsCfgOf, SpamTracker,
  findBadWord, parsePoll, parseSummaryArg, effectiveSetting, GROUP_ADMIN_DEFAULTS, ADMIN_FLAGS,
} from '../panel/shared/groupadmin.js';

process.env.GROQ_API_KEY = process.env.GROQ_API_KEY || 'test-key';
process.env.OWNER_NUMBER = '919999999999'; // VR = the bot's own number (as in real life)
const { Incoming, participantJids } = await import('../src/incoming.js');
const { NEED_ADMIN, rawRest } = await import('../src/features/admin.js');
const { helpText } = await import('../src/features/commands.js');

const G = '120363000000000001@g.us';
const ME = '919999999999', F1 = '919000000001', F2 = '919000000002', ADM = '919000000003';
const J = (n) => `${n}@s.whatsapp.net`;
// 2026-01-01 23:30 IST = 18:00 UTC
const IST = (h, m = 0, day = 1) => Date.UTC(2026, 0, day, h, m) - 5.5 * 3600000;

function harness({ settings = {}, groupsCfg = {}, botAdmin = true, addStatus = '200' } = {}) {
  const sent = [], waSent = [], calls = [];
  const sock = {
    user: { id: `${ME}:5@s.whatsapp.net` },
    groupMetadata: async (jid) => ({ id: jid, subject: 'Friends', participants: [{ id: J(ME), admin: botAdmin ? 'admin' : null }, { id: J(F1) }, { id: J(F2) }, { id: J(ADM), admin: 'admin' }] }),
    groupParticipantsUpdate: async (jid, list, action) => { calls.push({ fn: 'participants', jid, list, action }); return list.map((j) => ({ status: action === 'add' ? addStatus : '200', jid: j })); },
    groupSettingUpdate: async (jid, setting) => { calls.push({ fn: 'setting', jid, setting }); },
    groupInviteCode: async () => 'ABC123',
    groupRevokeInvite: async () => { calls.push({ fn: 'revoke' }); return 'NEW456'; },
    groupUpdateSubject: async (jid, s) => { calls.push({ fn: 'subject', s }); },
    groupUpdateDescription: async (jid, s) => { calls.push({ fn: 'desc', s }); },
  };
  const wa = {
    sock, me: () => ME, isMe: (j) => String(j || '').startsWith(ME),
    pnFor: async (jid, alt) => String(alt || jid || '').split('@')[0].split(':')[0],
    exists: async (d) => ({ exists: true, jid: J(d) }),
    send: async (jid, content) => { waSent.push({ jid, content }); return { key: { id: 'W' + waSent.length } }; },
  };
  const state = {
    memory: { processed: [], sentIds: [], lastOut: {}, lastIn: {}, cooldowns: {}, aiCount: {}, ai: {}, awaySent: {}, warns: {} },
    status: { inbox: {}, groups: [{ id: G, name: 'Friends', admin: botAdmin }] },
  };
  const data = { settings: withDefaults({ version: 2, ...settings }), rules: [], contacts: [], groupsCfg };
  const inc = new Incoming({ wa, getData: () => data, state, send: async (jid, content, opts) => { sent.push({ jid, content, opts }); return { key: { id: 'S' + sent.length } }; }, media: null });
  const texts = () => sent.map((x) => x.content.text || '');
  return { inc, sent, waSent, calls, state, data, texts };
}
let n = 0;
const ago = (s = 10) => Math.floor(Date.now() / 1000) - s;
const msg = (from, text, { ctx, secsAgo = 10, id, pushName } = {}) => ({
  key: { remoteJid: G, participant: J(from), id: id || 'M' + ++n, fromMe: from === ME }, pushName, messageTimestamp: ago(secsAgo),
  message: ctx ? { extendedTextMessage: { text, contextInfo: ctx } } : { conversation: text },
});
const mention = (who) => ({ mentionedJid: [J(who)] });
const replyTo = (who, text = 'hello', id = 'Q' + ++n) => ({ stanzaId: id, participant: J(who), quotedMessage: { conversation: text } });
async function run(h, ...msgs) { h.inc.push({ messages: msgs }); await h.inc.drain(); }

/* ---------------- pure helpers ---------------- */
test('durations, clock + lock ranges', () => {
  assert.equal(parseDuration('30m'), 30 * 60000);
  assert.equal(parseDuration('2h'), 2 * 3600000);
  assert.equal(parseDuration('1h30m'), 90 * 60000);
  assert.equal(parseDuration('45 min'), 45 * 60000);
  assert.equal(parseDuration('30d'), 7 * 86400000, 'capped at 7 days');
  assert.equal(parseDuration('soon'), null);
  assert.equal(parseDuration(''), null);
  assert.equal(parseClock('11pm'), '23:00');
  assert.equal(parseClock('7am'), '07:00');
  assert.equal(parseClock('12am'), '00:00');
  assert.equal(parseClock('25:00'), null);
  assert.deepEqual(parseLockRange('23:00-07:00'), { from: '23:00', to: '07:00' });
  assert.deepEqual(parseLockRange('11pm-7am'), { from: '23:00', to: '07:00' });
  assert.deepEqual(parseLockRange('22:30 to 6'), { from: '22:30', to: '06:00' });
  assert.equal(parseLockRange('23:00-23:00'), null);
  assert.equal(parseLockRange('tonight'), null);
});

test('lock window crosses midnight (Asia/Kolkata)', () => {
  const tz = 'Asia/Kolkata';
  assert.equal(inLockWindow(IST(22, 59), '23:00', '07:00', tz), false);
  assert.equal(inLockWindow(IST(23, 0), '23:00', '07:00', tz), true);
  assert.equal(inLockWindow(IST(2, 0, 2), '23:00', '07:00', tz), true);
  assert.equal(inLockWindow(IST(6, 59, 2), '23:00', '07:00', tz), true);
  assert.equal(inLockWindow(IST(7, 0, 2), '23:00', '07:00', tz), false);
  assert.equal(inLockWindow(IST(14, 0), '13:00', '15:00', tz), true, 'same-day window');
  assert.equal(inLockWindow(IST(16, 0), '13:00', '15:00', tz), false);
});

test('per-group defaults: warns 3 (1–50), anti-spam off 4 in 20s, slow 30s, goodbye off', () => {
  assert.equal(warnLimitOf({}), 3);
  assert.equal(warnLimitOf({ warn: { limit: 10 } }), 10);
  assert.equal(warnLimitOf({ warn: { limit: 0 } }), 1);
  assert.equal(warnLimitOf({ warn: { limit: 99 } }), 50);
  assert.equal(warnLimitOf({ warn: { limit: null } }), 3);
  assert.deepEqual(spamCfgOf({}), { enabled: false, count: 4, seconds: 20 });
  assert.deepEqual(slowCfgOf({ slow: { enabled: true, seconds: 1 } }), { enabled: true, seconds: 5 });
  assert.deepEqual(badWordsCfgOf({ badWords: { enabled: true, words: ['a, b', 'c'] } }).words, ['a', 'b', 'c']);
  assert.equal(GROUP_ADMIN_DEFAULTS.goodbye.enabled, false);
  assert.ok(!ADMIN_FLAGS.includes('promote') && !ADMIN_FLAGS.includes('demote'), 'no promote/demote');
});

test('spam tracker: X same texts within Y seconds', () => {
  const s = new SpamTracker(), cfg = { count: 4, seconds: 20 }, base = 1_000_000;
  const hit = (t, text = 'hi', who = 'a') => s.hit({ group: G, sender: who, text, ts: base + t * 1000, key: { id: 'k' + t } }, cfg);
  assert.equal(hit(0).trigger, false); assert.equal(hit(5).trigger, false); assert.equal(hit(8, 'other').trigger, false);
  assert.equal(hit(10, 'HI ').trigger, false, '3rd copy (case/space ignored)');
  const r = hit(12);
  assert.equal(r.trigger, true); assert.deepEqual(r.keys.map((k) => k.id), ['k0', 'k5', 'k10', 'k12']);
  assert.deepEqual(hit(14).keys.map((k) => k.id), ['k14'], 'flood continues → that copy is deleted too, no new warn');
  const s2 = new SpamTracker();
  for (const t of [0, 15, 30, 45]) assert.equal(s2.hit({ group: G, sender: 'b', text: 'yo', ts: base + t * 1000, key: {} }, cfg).trigger, false, 'spread over > 20 s → fine');
});

test('bad words: whole words, any case, simple leetspeak', () => {
  const list = ['idiot', 'shit'];
  assert.equal(findBadWord('you IDIOT', list), 'idiot');
  assert.equal(findBadWord('1d10t', list), 'idiot');
  assert.equal(findBadWord('sh!t man', list), 'shit');
  assert.equal(findBadWord('shit!', list), 'shit');
  assert.equal(findBadWord('shiiiit', list), 'shit');
  assert.equal(findBadWord('idiotic plan', list), null, 'whole words only');
  assert.equal(findBadWord('as you wish', ['ass']), null);
  assert.equal(findBadWord('go die now', ['go die']), 'go die');
  assert.equal(findBadWord('hello', []), null);
});

test('poll, summary args, rawRest, newest of panel vs command wins', () => {
  assert.deepEqual(parsePoll('Movie? | RRR | KGF | RRR'), { name: 'Movie?', values: ['RRR', 'KGF'] });
  assert.equal(parsePoll('Only one | a').error, 'too_few');
  assert.equal(parsePoll('Q | ' + Array.from({ length: 13 }, (_, i) => 'o' + i).join(' | ')).error, 'too_many');
  assert.deepEqual(parseSummaryArg(''), { n: 50, here: false });
  assert.deepEqual(parseSummaryArg('100 here'), { n: 100, here: true });
  assert.deepEqual(parseSummaryArg('999'), { n: 200, here: false });
  assert.equal(rawRest('!setdesc line 1\nline 2'), 'line 1\nline 2');
  assert.equal(effectiveSetting({ enabled: false }, { value: { enabled: true }, at: 200 }, 100).value.enabled, true);
  assert.equal(effectiveSetting({ enabled: false }, { value: { enabled: true }, at: 200 }, 300).value.enabled, false);
  assert.deepEqual(participantJids(['{"id":"123@lid","phoneNumber":"919000000001@s.whatsapp.net"}', { id: '5@lid', phoneNumber: J(F2) }, J(ADM)]), [J(F1), J(F2), J(ADM)]);
});

/* ---------------- owner-only + admin needed ---------------- */
test('!kick: VR can, a friend can\'t, and "I need admin" when the number isn\'t admin', async () => {
  const h = harness();
  await run(h, msg(F1, '!kick @919000000002', { ctx: mention(F2) }));
  assert.equal(h.calls.length, 0, 'friend → nothing happens');
  assert.equal(h.sent.length, 0, 'friend → no reply either');
  await run(h, msg(ME, '!kick @919000000002', { ctx: mention(F2) }));
  assert.deepEqual(h.calls[0], { fn: 'participants', jid: G, list: [J(F2)], action: 'remove' });
  assert.ok(h.texts().at(-1).includes('Removed @919000000002'));
  await run(h, msg(ME, '!kick', { ctx: replyTo(F1) }));
  assert.deepEqual(h.calls[1].list, [J(F1)], 'reply to their message works too');

  const na = harness({ botAdmin: false });
  await run(na, msg(ME, '!kick @919000000002', { ctx: mention(F2) }));
  assert.equal(na.calls.length, 0);
  assert.ok(na.texts()[0].endsWith(NEED_ADMIN), na.texts()[0]);
});

test('every admin command is owner-only (a friend gets nothing, even with commands open to the group)', async () => {
  const h = harness({ settings: { commands: { groups: [G], inGroups: true } } });
  for (const c of ['!add 919000000009', '!mute', '!mute 30m', '!unmute', '!warn', '!warns', '!unwarn', '!link', '!resetlink', '!setname x', '!setdesc y', '!lock 23:00-07:00', '!slow 30', '!pin', '!poll Q | a | b', '!summary', '!del']) {
    await run(h, msg(F1, c, { ctx: replyTo(F2) }));
  }
  assert.equal(h.calls.length, 0);
  assert.equal(h.waSent.length, 0);
  assert.equal(h.sent.length, 0, JSON.stringify(h.texts()));
});

test('not admin → "I need admin in this group for that" for each admin command', async () => {
  const h = harness({ botAdmin: false });
  const cmds = ['!add 919000000009', '!mute', '!unmute', '!warn @919000000001', '!link', '!resetlink', '!setname x', '!setdesc y', '!lock 23:00-07:00', '!slow 30'];
  for (const c of cmds) await run(h, msg(ME, c, { ctx: mention(F1) }));
  await run(h, msg(ME, '!del', { ctx: replyTo(F1) }), msg(ME, '!pin', { ctx: replyTo(F1) }));
  assert.equal(h.calls.length, 0);
  assert.equal(h.waSent.length, 0);
  assert.equal(h.texts().filter((t) => t.endsWith(NEED_ADMIN)).length, cmds.length + 2);
});

test('a command switched off in the panel says so; private chat says "type it inside the group"', async () => {
  const h = harness({ settings: { commands: { enabled: { kick: false } } } });
  await run(h, msg(ME, '!kick @919000000002', { ctx: mention(F2) }));
  assert.equal(h.calls.length, 0);
  assert.match(h.texts()[0], /!kick is switched off/);
  h.inc.push({ messages: [{ key: { remoteJid: J(ME), id: 'P1', fromMe: true }, messageTimestamp: ago(), message: { conversation: '!mute' } }] });
  await h.inc.drain();
  assert.match(h.texts().at(-1), /Type !mute inside the group/);
});

/* ---------------- warns ---------------- */
test('!warn counts per person and kicks at the group\'s custom "Warns before kick" (10)', async () => {
  const h = harness({ groupsCfg: { [G]: { warn: { limit: 10 } } } });
  for (let i = 1; i <= 9; i++) await run(h, msg(ME, '!warn @919000000001 stop', { ctx: mention(F1) }));
  assert.equal(h.calls.length, 0, 'no kick before 10');
  assert.ok(h.texts()[1].includes('@919000000001 warning 2/10'), h.texts()[1]);
  assert.ok(h.texts()[8].includes('warning 9/10 (stop)'));
  await run(h, msg(ME, '!warns @919000000001', { ctx: mention(F1) }));
  assert.ok(h.texts().at(-1).includes('has 9/10 warnings'));
  await run(h, msg(ME, '!warn @919000000001', { ctx: mention(F1) }));
  assert.deepEqual(h.calls[0], { fn: 'participants', jid: G, list: [J(F1)], action: 'remove' });
  assert.ok(h.texts().at(-1).includes('removed after 10 warnings'));
  assert.equal(Object.keys(h.state.memory.groupWarns).length, 0, 'count reset after the kick');
});

test('warn default 3, !unwarn resets, admins and VR can\'t be warned', async () => {
  const h = harness();
  await run(h, msg(ME, '!warn', { ctx: replyTo(F2) }), msg(ME, '!warn', { ctx: replyTo(F2) }));
  assert.ok(h.texts()[1].includes('warning 2/3'));
  await run(h, msg(ME, '!unwarn @919000000002', { ctx: mention(F2) }));
  assert.ok(h.texts().at(-1).includes('reset (0/3)'));
  await run(h, msg(ME, '!warn', { ctx: replyTo(F2) }));
  assert.ok(h.texts().at(-1).includes('warning 1/3'));
  await run(h, msg(ME, '!warn @919000000003', { ctx: mention(ADM) }));
  assert.match(h.texts().at(-1), /admin, warns don't apply/);
  await run(h, msg(ME, '!warn', { ctx: replyTo(ME) }));
  assert.match(h.texts().at(-1), /can't warn yourself/);
  assert.equal(h.calls.length, 0);
});

/* ---------------- add / del / link / name / poll / pin ---------------- */
test('!add: added, or privacy refusal → says so + invite link', async () => {
  const ok = harness();
  await run(ok, msg(ME, '!add +91 90000 00009'));
  assert.deepEqual(ok.calls[0], { fn: 'participants', jid: G, list: [J('919000000009')], action: 'add' });
  assert.match(ok.texts()[0], /Added \+919000000009/);
  await run(ok, msg(ME, '!add 9000000009'));
  assert.match(ok.texts().at(-1), /country code: !add 919000000009/);
  const priv = harness({ addStatus: '403' });
  await run(priv, msg(ME, '!add 919000000009'));
  assert.match(priv.texts()[0], /privacy/);
  assert.match(priv.texts()[0], /https:\/\/chat\.whatsapp\.com\/ABC123/);
});

test('!del deletes the replied message for everyone (and the !del itself)', async () => {
  const h = harness();
  await run(h, msg(ME, '!del', { ctx: replyTo(F1, 'oops', 'BAD1') }));
  assert.deepEqual(h.waSent[0].content.delete, { remoteJid: G, id: 'BAD1', participant: J(F1), fromMe: false });
  assert.equal(h.waSent[1].content.delete.fromMe, true);
  await run(h, msg(ME, '!del'));
  assert.match(h.texts().at(-1), /Reply to a message with !del/);
});

test('!link / !resetlink / !setname / !setdesc', async () => {
  const h = harness();
  await run(h, msg(ME, '!link'));
  assert.match(h.texts()[0], /https:\/\/chat\.whatsapp\.com\/ABC123/);
  await run(h, msg(ME, '!resetlink'));
  assert.ok(h.calls.some((c) => c.fn === 'revoke'));
  assert.match(h.texts()[1], /Old link stopped working[\s\S]*NEW456/);
  await run(h, msg(ME, '!setname Gang 2026'), msg(ME, '!setdesc rule 1\nrule 2'));
  assert.ok(h.calls.some((c) => c.fn === 'subject' && c.s === 'Gang 2026'));
  assert.ok(h.calls.some((c) => c.fn === 'desc' && c.s === 'rule 1\nrule 2'));
});

test('!poll sends a real poll (2–12 options); !pin / !unpin use WhatsApp pin', async () => {
  const h = harness();
  await run(h, msg(ME, '!poll Where tonight? | Paradise | Bawarchi | Shah Ghouse'));
  assert.deepEqual(h.sent[0].content.poll, { name: 'Where tonight?', values: ['Paradise', 'Bawarchi', 'Shah Ghouse'], selectableCount: 1 });
  await run(h, msg(ME, '!poll just a question'));
  assert.match(h.texts().at(-1), /Usage: !poll/);
  await run(h, msg(ME, '!pin', { ctx: replyTo(F1, 'meet at 5', 'PIN1') }));
  assert.deepEqual(h.waSent[0].content, { pin: { remoteJid: G, id: 'PIN1', participant: J(F1), fromMe: false }, type: 1, time: 604800 });
  await run(h, msg(ME, '!pin 24h', { ctx: replyTo(F1, 'x', 'PIN2') }), msg(ME, '!unpin', { ctx: replyTo(F1, 'x', 'PIN2') }));
  assert.equal(h.waSent[1].content.time, 86400);
  assert.equal(h.waSent[2].content.type, 2);
  await run(h, msg(ME, '!pin 3d', { ctx: replyTo(F1) }));
  assert.match(h.texts().at(-1), /24h, 7d or 30d/);
});

/* ---------------- mute timer + night lock ---------------- */
test('!mute 30m mutes now and the run loop unmutes after 30 min', async () => {
  const h = harness();
  const t0 = Date.now();
  await run(h, msg(ME, '!mute 30m'));
  assert.deepEqual(h.calls[0], { fn: 'setting', jid: G, setting: 'announcement' });
  const until = h.state.memory.groupMuteUntil[G];
  assert.ok(until >= t0 + 30 * 60000 - 1000 && until <= Date.now() + 30 * 60000);
  assert.match(h.texts()[0], /Muted for 30m/);
  await h.inc.admin.tick(t0 + 29 * 60000);
  assert.equal(h.calls.length, 1, 'not yet');
  await h.inc.admin.tick(until + 1000);
  assert.deepEqual(h.calls[1], { fn: 'setting', jid: G, setting: 'not_announcement' });
  assert.equal(h.state.memory.groupMuteUntil[G], undefined);
  await h.inc.admin.tick(until + 60000);
  assert.equal(h.calls.length, 2, 'only once');
  await run(h, msg(ME, '!mute'), msg(ME, '!unmute'));
  assert.deepEqual(h.calls.slice(2).map((c) => c.setting), ['announcement', 'not_announcement']);
  await run(h, msg(ME, '!mute forever'));
  assert.match(h.texts().at(-1), /Usage: !mute/);
});

test('night lock from the panel crosses midnight: locks at 23:00, opens at 07:00, once each', async () => {
  const h = harness({ groupsCfg: { [G]: { lock: { enabled: true, from: '23:00', to: '07:00' } } } });
  const settings = () => h.calls.map((c) => c.setting);
  await h.inc.admin.tick(IST(22, 0));
  assert.deepEqual(settings(), [], 'daytime: nothing (never opens a group it did not lock)');
  await h.inc.admin.tick(IST(23, 1));
  assert.deepEqual(settings(), ['announcement']);
  assert.match(h.texts().at(-1), /Night lock[\s\S]*7:00 AM/);
  await h.inc.admin.tick(IST(3, 0, 2));
  assert.deepEqual(settings(), ['announcement'], 'still night: no repeat');
  await h.inc.admin.tick(IST(7, 1, 2));
  assert.deepEqual(settings(), ['announcement', 'not_announcement']);
  await h.inc.admin.tick(IST(9, 0, 2));
  assert.equal(h.calls.length, 2);
});

test('!lock 23:00-07:00 / !lock off from WhatsApp (newest of panel and command wins)', async () => {
  const h = harness();
  await run(h, msg(ME, '!lock 11pm-7am'));
  assert.match(h.texts()[0], /Night lock set: 11:00 PM – 7:00 AM/);
  assert.equal(h.state.status.groupOverrides[G].lock.value.from, '23:00');
  await h.inc.admin.tick(IST(23, 30));
  assert.deepEqual(h.calls.map((c) => c.setting), ['announcement']);
  await run(h, msg(ME, '!lock off'));
  assert.deepEqual(h.calls.map((c) => c.setting), ['announcement', 'not_announcement'], 'lock off at night → opens now');
  assert.match(h.texts().at(-1), /Night lock off/);
  // a later Save in the panel replaces the command
  h.data.groupsCfg[G] = { lock: { enabled: true, from: '22:00', to: '06:00' }, savedAt: Date.now() + 1000 };
  assert.deepEqual(h.inc.admin.lockOf(G), { from: '22:00', to: '06:00' });
  await run(h, msg(ME, '!lock nonsense'));
  assert.match(h.texts().at(-1), /Usage: !lock 23:00-07:00/);
});

/* ---------------- automatic tools ---------------- */
test('anti-spam: 4 same msgs within 20 s → deleted + 1 warn; never VR or admins; off by default', async () => {
  const off = harness();
  await run(off, ...[1, 2, 3, 4, 5].map((i) => msg(F1, 'buy now', { secsAgo: 20 - i })));
  assert.equal(off.waSent.length, 0, 'off by default');

  const h = harness({ groupsCfg: { [G]: { antiSpam: { enabled: true, count: 4, seconds: 20 } } } });
  await run(h, ...[1, 2, 3].map((i) => msg(F1, 'buy now', { secsAgo: 20 - i })));
  assert.equal(h.waSent.length, 0, '3 copies are fine');
  await run(h, msg(F1, 'buy now', { secsAgo: 15, id: 'SP4' }));
  assert.equal(h.waSent.length, 4, 'all 4 deleted');
  assert.equal(h.waSent[3].content.delete.id, 'SP4');
  assert.ok(h.texts().at(-1).includes('@919000000001 warning 1/3 (spam)'));
  await run(h, ...[1, 2, 3, 4, 5].map((i) => msg(ADM, 'admin spam', { secsAgo: 10 - i })), ...[1, 2, 3, 4, 5].map((i) => msg(ME, 'my spam', { secsAgo: 10 - i })));
  assert.equal(h.waSent.length, 4, 'admins and VR are never touched');
  // custom thresholds: 3 in 60 s
  const c = harness({ groupsCfg: { [G]: { antiSpam: { enabled: true, count: 3, seconds: 60 } } } });
  await run(c, msg(F2, 'yo', { secsAgo: 50 }), msg(F2, 'yo', { secsAgo: 25 }), msg(F2, 'yo', { secsAgo: 1 }));
  assert.equal(c.waSent.length, 3);
});

test('bad-word filter: delete + 1 warn, kick at N, admins exempt', async () => {
  const h = harness({ groupsCfg: { [G]: { badWords: { enabled: true, words: ['idiot'] }, warn: { limit: 2 } } } });
  await run(h, msg(F1, 'hello all'), msg(F1, 'you 1d10t', { id: 'B1' }));
  assert.equal(h.waSent.length, 1);
  assert.equal(h.waSent[0].content.delete.id, 'B1');
  assert.ok(h.texts().at(-1).includes('warning 1/2 (bad language)'));
  await run(h, msg(F1, 'IDIOT'));
  assert.deepEqual(h.calls[0].action, 'remove');
  await run(h, msg(ADM, 'idiot'));
  assert.equal(h.waSent.length, 2, 'admin not filtered');
});

test('slow mode: 2nd msg inside the window deleted, one notice per person per 10 min, no warn', async () => {
  const h = harness({ groupsCfg: { [G]: { slow: { enabled: true, seconds: 30 } } } });
  await run(h, msg(F1, 'one', { secsAgo: 25 }), msg(F1, 'two', { secsAgo: 20, id: 'SL2' }), msg(F1, 'three', { secsAgo: 15 }), msg(F2, 'other person', { secsAgo: 14 }));
  assert.deepEqual(h.waSent.map((x) => x.content.delete.id), ['SL2', h.waSent[1].content.delete.id]);
  assert.equal(h.waSent.length, 2);
  assert.equal(h.texts().filter((t) => t.includes('slow mode: 30s')).length, 1);
  assert.ok(!h.texts().some((t) => t.includes('warning')));
  await run(h, msg(ME, '!slow off'));
  await run(h, msg(F1, 'four', { secsAgo: 2 }), msg(F1, 'five', { secsAgo: 1 }));
  assert.equal(h.waSent.length, 2, 'off by command');
});

test('goodbye: off by default; on → "{name} left {group}" when someone leaves', async () => {
  const off = harness();
  await off.inc.participants({ id: G, action: 'remove', participants: [{ id: '5@lid', phoneNumber: J(F2) }] });
  assert.equal(off.sent.length, 0);
  const h = harness({ groupsCfg: { [G]: { goodbye: { enabled: true, message: 'Bye {name}, {group} will miss you' } } } });
  await h.inc.participants({ id: G, action: 'remove', participants: [{ id: '5@lid', phoneNumber: J(F2) }] });
  assert.equal(h.sent[0].content.text, 'Bye @919000000002, Friends will miss you');
  assert.deepEqual(h.sent[0].content.mentions, [J(F2)]);
  // the same leave as a system message → no second goodbye
  h.inc.push({ messages: [{ key: { remoteJid: G, id: 'STUB1', fromMe: false, participant: J(F2) }, messageTimestamp: ago(), messageStubType: 32, messageStubParameters: [JSON.stringify({ id: '5@lid', phoneNumber: J(F2) })] }] });
  await h.inc.drain();
  assert.equal(h.sent.length, 1);
});

test('anti-link stays off unless switched on (links are fine by default)', async () => {
  const h = harness({ groupsCfg: { [G]: { warn: { limit: 10 } } } });
  await run(h, msg(F1, 'check https://youtu.be/abc'), msg(F1, 'join chat.whatsapp.com/XYZ'));
  assert.equal(h.waSent.length, 0);
  assert.equal(h.sent.length, 0);
});

/* ---------------- !report / !summary ---------------- */
test('!report: any member, once per message, 5/person/hour, goes to your own chat', async () => {
  const h = harness();
  await run(h, msg(F1, '!report', { ctx: replyTo(F2, 'rude stuff', 'R1'), pushName: 'Sunil' }));
  const toMe = h.sent.filter((x) => x.jid === J(ME));
  assert.equal(toMe.length, 1);
  assert.match(toMe[0].content.text, /Report[\s\S]*Friends[\s\S]*Sunil[\s\S]*\+919000000002[\s\S]*rude stuff/);
  assert.match(h.texts().at(-1), /✅ reported to admin/);
  await run(h, msg(F2, '!report', { ctx: replyTo(F2, 'rude stuff', 'R1') }));
  assert.equal(h.sent.filter((x) => x.jid === J(ME)).length, 1, 'same message only once');
  for (let i = 0; i < 6; i++) await run(h, msg(F2, '!report', { ctx: replyTo(F1, 'x' + i) }));
  assert.equal(h.sent.filter((x) => x.jid === J(ME)).length, 6, '5 per person per hour');
  const na = harness({ botAdmin: false });
  await run(na, msg(F1, '!report', { ctx: replyTo(F2) }));
  assert.equal(na.sent.length, 0, 'only in groups where you are admin');
});

test('!summary: Groq summary of recent group text → your own chat (or "here"); text is never saved', async () => {
  const h = harness();
  const real = globalThis.fetch; let body = null;
  globalThis.fetch = async (url, opts) => { body = JSON.parse(opts.body); return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '• Plan: movie at 7' } }] }) }; };
  try {
    await run(h, msg(F1, 'movie tonight?', { pushName: 'Sunil Kumar', secsAgo: 40 }), msg(F2, 'yes 7pm', { pushName: 'Vijay', secsAgo: 30 }), msg(ME, 'im in', { secsAgo: 20 }));
    await run(h, msg(ME, '!summary'));
    const toMe = h.sent.filter((x) => x.jid === J(ME));
    assert.equal(toMe.length, 1);
    assert.match(toMe[0].content.text, /Friends[\s\S]*last 3 messages[\s\S]*movie at 7/);
    assert.match(body.messages.at(-1).content, /Sunil: movie tonight\?\nVijay: yes 7pm\nRakshith: im in/);
    await run(h, msg(ME, '!summary 2 here'));
    assert.equal(h.sent.at(-1).jid, G);
    assert.ok(!JSON.stringify(h.state).includes('movie tonight'), 'message text is memory-only');
  } finally { globalThis.fetch = real; }
});

/* ---------------- help + panel flags ---------------- */
test('!help: admin commands in the owner section, !report public; switched-off ones hidden', () => {
  const S = withDefaults({ version: 2 });
  const own = helpText(S, true), pub = helpText(S, false);
  for (const c of ['!kick @user', '!add 91XXXXXXXXXX', '!mute 30m', '!unmute', '!del', '!warn @user', '!warns', '!unwarn', '!link', '!resetlink', '!setname', '!setdesc', '!lock 23:00-07:00', '!lock off', '!slow 30', '!pin', '!unpin', '!poll', '!summary']) assert.ok(own.includes(c), c);
  assert.ok(!pub.includes('!kick'), 'friends never see admin commands');
  assert.ok(pub.includes('!report'));
  assert.ok(!own.includes('promote'));
  const off = withDefaults({ version: 2, commands: { enabled: { kick: false, report: false } } });
  assert.ok(!helpText(off, true).includes('!kick'));
  assert.ok(!helpText(off, false).includes('!report'));
  for (const f of ADMIN_FLAGS) assert.equal(S.commands.enabled[f], true, f);
});
