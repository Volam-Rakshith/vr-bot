// Class mode (and its sharing of the busy-mode machinery): !class, !free, busy ↔ class switching.
// © VR DEVELOPMENTS
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBusy, busyNow, modeNow, busyText, shortTimeText, MODES } from '../panel/shared/busy.js';
import { featureScope } from '../panel/shared/rules.js';
import { withDefaults } from '../panel/shared/defaults.js';
import { zonedToUtc } from '../panel/shared/time.js';
import { helpText } from '../src/features/commands.js';
import { notifyCategory } from '../panel/shared/notify.js';

process.env.OWNER_NUMBER = '919999999999';
const { Incoming } = await import('../src/incoming.js');

const TZ = 'Asia/Kolkata';
const MIN = 60000;
const ME = '919999999999';
const G1 = '120363000000000001@g.us';
const ist = (d, t) => zonedToUtc(d, t, TZ);
const NOW = ist('2026-10-30', '09:10'); // Fri 9:10 AM IST

/* ---------------- parsing & text ---------------- */
test('class: parsing "2h", "until 4", "till 4:30pm", "" (1h), "off"/"free"', () => {
  assert.equal(parseBusy('2h', NOW, TZ, '!class').until, NOW + 120 * MIN);
  assert.equal(parseBusy('until 4', NOW, TZ, '!class').until, ist('2026-10-30', '16:00'), '"until 4" in the morning = 4 PM');
  assert.equal(parseBusy('till 4:30pm', NOW, TZ, '!class').until, ist('2026-10-30', '16:30'));
  assert.equal(parseBusy('till 10', NOW, TZ, '!class').until, ist('2026-10-30', '10:00'), 'next 10 o\'clock = 10 AM today');
  assert.equal(parseBusy('', NOW, TZ, '!class').minutes, 60);
  assert.equal(parseBusy('', NOW, TZ, '!class').until, NOW + 60 * MIN);
  assert.ok(parseBusy('off', NOW, TZ).off);
  assert.ok(parseBusy('free', NOW, TZ).off);
  assert.match(parseBusy('banana', NOW, TZ, '!class').error, /!class 2h/);
});

test('class: {time} is short ("4", "4:30", "tomorrow 9"); busy keeps "4:00 PM"', () => {
  assert.equal(shortTimeText(ist('2026-10-30', '16:00'), NOW, TZ), '4');
  assert.equal(shortTimeText(ist('2026-10-30', '16:30'), NOW, TZ), '4:30');
  assert.equal(shortTimeText(ist('2026-10-30', '12:05'), NOW, TZ), '12:05');
  assert.equal(shortTimeText(ist('2026-10-31', '09:00'), NOW, TZ), 'tomorrow 9');
  const S = withDefaults({});
  assert.equal(S.class.message, 'in class rn, will text after {time}');
  assert.equal(busyText(S.class.message, ist('2026-10-30', '16:00'), NOW, TZ, 'class'), 'in class rn, will text after 4');
  assert.equal(busyText(S.class.message, ist('2026-10-30', '16:30'), NOW, TZ, 'class'), 'in class rn, will text after 4:30');
  assert.equal(busyText('back by {time}', ist('2026-10-30', '16:00'), NOW, TZ), 'back by 4:00 PM');
  assert.equal(busyText('', ist('2026-10-30', '16:00'), NOW, TZ, 'class'), 'in class rn, will text after 4', 'empty message → default');
  assert.equal(MODES.class.icon, '🎓');
});

test('class: panel/WhatsApp switches, newest wins; modeNow picks the one that is on', () => {
  const S = withDefaults({ class: { on: true, until: NOW + 3600000, setAt: NOW - 1000 } });
  assert.equal(modeNow(S, {}, NOW).mode, 'class');
  assert.equal(busyNow(S, {}, NOW, 'busy').active, false);
  // !busy later than the panel class switch → busy (and the bot switches class off when it does that)
  const st = { busy: { on: true, until: NOW + 7200000, at: NOW }, class: { on: false, until: 0, at: NOW } };
  assert.equal(modeNow(S, st, NOW).mode, 'busy');
  assert.equal(modeNow(S, {}, NOW + 2 * 3600000).active, false, 'expired');
  assert.equal(modeNow(withDefaults({}), {}, NOW).mode, null);
  // class ids never clash with busy ids (separate once-per-chat lists)
  assert.notEqual(busyNow(S, {}, NOW, 'class').id, busyNow(withDefaults({ busy: { on: true, until: NOW + 1, setAt: NOW - 1000 } }), {}, NOW, 'busy').id);
});

test('class: chats = the same as busy mode by default, or its own pick', () => {
  const S = withDefaults({ busy: { who: 'pick', contacts: ['c1'], groups: [G1], exclude: ['c9'] } });
  const sc = featureScope(S, 'class');
  assert.equal(sc.who, 'pick'); assert.deepEqual(sc.contacts, ['c1']); assert.deepEqual(sc.groups, [G1]); assert.deepEqual(sc.exclude, ['c9']);
  const own = featureScope(withDefaults({ busy: { who: 'pick', contacts: ['c1'] }, class: { who: 'pick', contacts: ['c2'] } }), 'class');
  assert.deepEqual(own.contacts, ['c2']); assert.equal(own.groups, 'none');
  assert.equal(featureScope(withDefaults({ class: { who: 'nobody' } }), 'class').who, 'nobody');
});

test('class: in !help (owner line) and Sent log kind "class" counts as an auto-reply', () => {
  const h = helpText(withDefaults({}), true);
  assert.match(h, /!class 2h/); assert.match(h, /!free/);
  assert.ok(!helpText(withDefaults({}), false).includes('!class'), 'not shown to others');
  assert.equal(notifyCategory({ kind: 'class', cat: 'replies' }), 'replies');
});

/* ---------------- the bot ---------------- */
const HDR = /^🤖 \*VR Bot\* is sending:\n/; // your own alerts carry the header (Settings → header); tests read the text after it
function harness({ settings = {}, rules = [], contacts = [] } = {}) {
  const sent = [];
  const wa = { me: () => ME, isMe: (j) => String(j || '').startsWith(ME), pnFor: async (jid, alt) => String(alt || jid || '').split('@')[0].split(':')[0], sock: { user: { id: `${ME}@s.whatsapp.net` } } };
  const state = {
    memory: { processed: [], sentIds: [], lastOut: {}, lastIn: {}, cooldowns: {}, aiCount: {}, ai: {}, awaySent: {}, warns: {} },
    status: { inbox: {}, groups: [{ id: G1, name: 'AIML' }] },
  };
  const data = { settings: withDefaults({ version: 2, ...settings }), rules, contacts, groupsCfg: {} };
  const inc = new Incoming({ wa, getData: () => data, state, send: async (jid, content, opts) => { sent.push({ jid, content: content.text ? { ...content, text: content.text.replace(HDR, '') } : content, raw: content, opts }); return { key: { id: 'S' + sent.length } }; }, media: null });
  return { inc, sent, state, data };
}
let n = 0;
const ts = () => Math.floor(Date.now() / 1000) - 30;
const dm = (num, message) => ({ key: { remoteJid: `${num}@s.whatsapp.net`, id: 'C' + ++n, fromMe: false }, messageTimestamp: ts(), message: typeof message === 'string' ? { conversation: message } : message });
const gm = (group, num, message) => ({ key: { remoteJid: group, participant: `${num}@s.whatsapp.net`, id: 'C' + ++n, fromMe: false }, messageTimestamp: ts(), message: typeof message === 'string' ? { conversation: message } : message });
const mine = (text) => ({ key: { remoteJid: `${ME}@s.whatsapp.net`, id: 'C' + ++n, fromMe: true }, messageTimestamp: ts(), message: { conversation: text } });
const run = async (h, ...messages) => { h.inc.push({ messages }); await h.inc.drain(); };
const contacts = [{ id: 'c1', name: 'Amma', number: '+91 98480 00001' }, { id: 'c2', name: 'Ravi', number: '+91 90000 00002' }, { id: 'c3', name: 'Vijay', number: '+91 90000 00003' }];
const AMMA = '919848000001', RAVI = '919000000002', VIJAY = '919000000003';
const busyCfg = { busy: { who: 'pick', contacts: ['c1', 'c2', 'c3'], exclude: ['c3'], groups: [G1], message: 'Busy till {time}' } };

test('class: !class 2h → confirmation, once per chat, groups only when tagged, excluded people never; Sent log kind "class"', async () => {
  const h = harness({ contacts, settings: busyCfg });
  await run(h, mine('!class 2h'));
  assert.match(h.sent[0].content.text, /^🎓 Class mode on till \d{1,2}(:\d{2})? ✅/);
  assert.match(h.sent[0].content.text, /!free to stop early/);
  assert.equal(h.sent[0].jid, `${ME}@s.whatsapp.net`);
  h.sent.length = 0;
  await h.inc.busyTick();
  const tagged = { extendedTextMessage: { text: 'bro where', contextInfo: { mentionedJid: [`${ME}@s.whatsapp.net`] } } };
  await run(h, dm(AMMA, 'hi'), dm(AMMA, 'hello??'), dm(RAVI, 'hey'), dm(VIJAY, 'hi'), dm('919111111111', 'stranger'), gm(G1, '919000000005', 'random'), gm(G1, '919000000005', tagged));
  assert.deepEqual(h.sent.map((s) => s.jid), [`${AMMA}@s.whatsapp.net`, `${RAVI}@s.whatsapp.net`, G1], JSON.stringify(h.sent.map((s) => s.jid)));
  assert.match(h.sent[0].content.text, /^in class rn, will text after \d{1,2}(:\d{2})?$/);
  assert.ok(!h.sent[0].raw.text.includes('VR Bot'), 'no header on the class reply');
  assert.equal(h.sent[0].opts.kind, 'class');
  assert.equal(h.sent[0].opts.cat, 'replies');
  assert.equal(h.state.status.class.on, true);
});

test('class: beats keyword rules and AI, like busy', async () => {
  const rules = [{ id: 'r', pattern: 'hi', reply: 'Rule reply', where: 'both', cooldownMinutes: 0 }];
  const h = harness({ contacts, rules, settings: busyCfg });
  await run(h, mine('!class'));
  h.sent.length = 0;
  await run(h, dm(AMMA, 'hi'));
  assert.deepEqual(h.sent.map((s) => s.content.text), [h.sent[0].content.text]);
  assert.match(h.sent[0].content.text, /^in class rn/);
  await run(h, dm(AMMA, 'hi'));
  assert.equal(h.sent[1].content.text, 'Rule reply', 'after the one class reply, normal replies go on');
});

test('class: time is up → off by itself + one notice; !class default is 1 hour', async () => {
  const h = harness({ contacts, settings: busyCfg });
  const t0 = Date.now();
  await run(h, mine('!class'));
  assert.ok(Math.abs(h.state.status.class.until - (t0 + 60 * MIN)) < 5000);
  await h.inc.busyTick();
  await run(h, dm(AMMA, 'hi'));
  h.state.status.class.until = Date.now() - 1000;
  h.sent.length = 0;
  await h.inc.busyTick();
  await h.inc.busyTick();
  assert.equal(h.sent.length, 1);
  assert.equal(h.sent[0].jid, `${ME}@s.whatsapp.net`);
  assert.match(h.sent[0].content.text, /^🎓 Class mode is off now, your time is up\.\n1 chat got your class reply\./);
  // nothing on → no more class replies
  h.sent.length = 0;
  await run(h, dm(RAVI, 'hi'));
  assert.equal(h.sent.length, 0);
});

test('class: !free ends class (no "time is up" later), and ends busy too; !busy off ends class', async () => {
  const h = harness({ contacts, settings: busyCfg });
  await run(h, mine('!class till 11:59pm'), dm(AMMA, 'hi'));
  await run(h, mine('!free'));
  assert.match(h.sent.at(-1).content.text, /^☀️ Class mode OFF\. 1 chat got your class reply\.$/);
  await h.inc.busyTick();
  const k = h.sent.length;
  await run(h, dm(RAVI, 'hi'));
  assert.equal(h.sent.length, k, 'no reply once free');
  await run(h, mine('!free'));
  assert.match(h.sent.at(-1).content.text, /already off/);
  await run(h, mine('!busy 2h'));
  await run(h, mine('!free'));
  assert.match(h.sent.at(-1).content.text, /^☀️ Busy mode OFF\.$/);
  await run(h, mine('!class 1h'));
  await run(h, mine('!busy off'));
  assert.match(h.sent.at(-1).content.text, /^☀️ Class mode OFF\.$/, '"!busy off" still works and ends whichever is on');
  assert.equal(modeNow(h.data.settings, h.state.status, Date.now()).active, false);
  await h.inc.busyTick();
  assert.match(h.sent.at(-1).content.text, /Class mode OFF/, 'no end notice after switching off by hand');
});

test('class: switching busy ↔ class replaces the other; each mode has its own once-per-chat list; no stray end notice', async () => {
  const h = harness({ contacts, settings: busyCfg });
  await run(h, mine('!busy 2h'), dm(AMMA, 'hi'));
  assert.match(h.sent[1].content.text, /^Busy till /);
  await run(h, mine('!class 2h'));
  assert.match(h.sent[2].content.text, /^🎓 Class mode on till .+ ✅ \(busy mode switched off\)/);
  assert.equal(busyNow(h.data.settings, h.state.status, Date.now(), 'busy').active, false);
  await h.inc.busyTick();
  await run(h, dm(AMMA, 'hi again'));
  assert.match(h.sent[3].content.text, /^in class rn/, 'Amma had the busy reply, still gets the class one once');
  await run(h, dm(AMMA, 'hello?'));
  assert.equal(h.sent.length, 4, 'once per chat');
  // back to busy → class off, Amma gets the busy message once more
  await run(h, mine('!busy 1h'));
  assert.match(h.sent[4].content.text, /^🔕 Busy mode ON until .+\(class mode switched off\)/);
  await h.inc.busyTick();
  await run(h, dm(AMMA, 'hii'));
  assert.match(h.sent[5].content.text, /^Busy till /);
  assert.equal(h.sent.length, 6);
  assert.equal(modeNow(h.data.settings, h.state.status, Date.now()).mode, 'busy');
});

test('class: from the panel switch, with its own message and its own picked chats', async () => {
  const settings = { ...busyCfg, class: { who: 'pick', contacts: ['c2'], message: 'class till {time} 📚', on: true, until: Date.now() + 3600000, setAt: Date.now() - 1000 } };
  const h = harness({ contacts, settings });
  await run(h, dm(AMMA, 'hi'), dm(RAVI, 'hi'));
  assert.deepEqual(h.sent.map((s) => s.jid), [`${RAVI}@s.whatsapp.net`]);
  assert.match(h.sent[0].content.text, /^class till \d{1,2}(:\d{2})? 📚$/);
});

test('class: nobody picked for busy → class warns too', async () => {
  const h = harness({ contacts });
  await run(h, mine('!class 30m'), dm(AMMA, 'hi'));
  assert.equal(h.sent.length, 1);
  assert.match(h.sent[0].content.text, /No chats picked yet[\s\S]*Busy mode \(class uses the same chats\)/);
});

test('class: !status shows it', async () => {
  const h = harness({ contacts, settings: busyCfg });
  await run(h, mine('!class 2h'), mine('!status'));
  assert.match(h.sent.at(-1).content.text, /Busy: off\nClass: on till /);
});

test('class: two switches in the SAME millisecond never share a session (frozen clock — was a flaky test)', async () => {
  const realNow = Date.now;
  const frozen = realNow();
  Date.now = () => frozen; // every command below happens "at the same time"
  try {
    const h = harness({ contacts, settings: busyCfg });
    await run(h, mine('!class till 11:59pm'), dm(AMMA, 'hi'));
    await run(h, mine('!free'));
    assert.match(h.sent.at(-1).content.text, /^☀️ Class mode OFF\. 1 chat got your class reply\.$/);
    await run(h, mine('!class 1h'));
    assert.equal(modeNow(h.data.settings, h.state.status, frozen).active, true, 'new session is on even in the same ms');
    await run(h, mine('!busy off'));
    assert.match(h.sent.at(-1).content.text, /^☀️ Class mode OFF\.$/, 'the new session starts with an empty "already replied" list');
    await run(h, mine('!class 1h'), dm(AMMA, 'hi again'));
    assert.match(h.sent.at(-1).content.text, /^in class rn/, 'a new session replies to Amma again');
  } finally { Date.now = realNow; }
});
