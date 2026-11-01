// 😈 Troll mode: count clamp, stop, name resolution, rate limit, owner only, no daily caps used. © VR DEVELOPMENTS
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withDefaults, DEFAULT_SETTINGS } from '../panel/shared/defaults.js';
import { clampCount, parseTroll, resolveTarget, Troll, TROLL_LIMITS } from '../src/features/troll.js';

process.env.OWNER_NUMBER = '919999999999';
process.env.GROQ_API_KEY = '';
const { Incoming } = await import('../src/incoming.js');
const { helpText } = await import('../src/features/commands.js');

const ME = '919999999999', RAVI = '919000000002';
const G1 = '120363000000000001@g.us', G2 = '120363000000000002@g.us';

test('count clamp: 1–50, "capped at 50"', () => {
  assert.deepEqual(clampCount(10), { count: 10, capped: false });
  assert.deepEqual(clampCount(50), { count: 50, capped: false });
  assert.deepEqual(clampCount(500), { count: 50, capped: true });
  assert.equal(clampCount(0).count, 0);
  assert.equal(clampCount('x').count, 0);
  assert.deepEqual(parseTroll('80 wake up'), { target: null, count: 50, capped: true, text: 'wake up' });
  assert.deepEqual(parseTroll('@ascending together 5 hello\nall'), { target: 'ascending together', count: 5, capped: false, text: 'hello\nall' });
  assert.deepEqual(parseTroll('stop'), { stop: true });
  assert.equal(parseTroll('hello').error, 'usage');
  assert.equal(parseTroll('@AIML hello').error, 'usage');
  assert.equal(parseTroll('0 hi').error, 'usage');
  assert.equal(DEFAULT_SETTINGS.troll.enabled, true);
});

test('name resolution: case-insensitive, exact wins, ambiguous → list, unknown → none', () => {
  const groups = [{ id: G1, name: 'ASCENDING TOGETHER' }, { id: G2, name: 'AIML Class' }];
  const contacts = [{ id: 'c1', name: 'Ravi Kumar', number: '+91 90000 00002' }, { id: 'c2', name: 'Ravi Teja', number: '+91 90000 00004' }, { id: 'c3', name: 'Aiml', number: '+91 90000 00005' }];
  assert.equal(resolveTarget('ascending together', { groups, contacts }).to.id, G1);
  assert.equal(resolveTarget('ascending', { groups, contacts }).to.id, G1, 'contains');
  assert.equal(resolveTarget('aiml', { groups, contacts }).to.id, 'c3', 'exact name beats "contains"');
  assert.deepEqual(resolveTarget('ravi', { groups, contacts }).matches, ['👤 Ravi Kumar', '👤 Ravi Teja']);
  assert.equal(resolveTarget('ravi teja', { groups, contacts }).to.number, '+91 90000 00004');
  assert.ok(resolveTarget('nobody', { groups, contacts }).none);
});

test('Troll: random 1.2–2.5 s gaps, stop, stop on error, max 3 bursts per 10 min', async () => {
  const gaps = [];
  let now = 1_000_000;
  const sent = [];
  const t = new Troll({ send: async (jid, text) => { sent.push(text); }, mem: {}, sleep: async (ms) => { gaps.push(ms); }, rand: () => 0.5, now: () => now });
  const r = t.start(G1, 'hi', 5);
  assert.deepEqual(await r.done, { sent: 5, count: 5, stopped: false, error: null });
  assert.equal(gaps.length, 4);
  assert.ok(gaps.every((g) => g >= TROLL_LIMITS.minGapMs && g <= TROLL_LIMITS.maxGapMs));
  // stop
  let n = 0;
  const t2 = new Troll({ send: async () => { n++; if (n === 3) t2.stop(); }, mem: {}, sleep: async () => {}, now: () => now });
  assert.deepEqual(await t2.start(G1, 'x', 50).done, { sent: 3, count: 50, stopped: true, error: null });
  assert.equal(t2.stop(), false, 'nothing running');
  // error → stops
  let m = 0;
  const t3 = new Troll({ send: async () => { if (++m === 2) throw new Error('not allowed'); }, mem: {}, sleep: async () => {}, now: () => now });
  assert.deepEqual(await t3.start(G1, 'x', 10).done, { sent: 1, count: 10, stopped: false, error: 'not allowed' });
  // rate: 3 bursts / 10 min
  const mem = {};
  const t4 = new Troll({ send: async () => {}, mem, sleep: async () => {}, now: () => now });
  for (let i = 0; i < 3; i++) await t4.start(G1, 'x', 1).done;
  const blocked = t4.start(G1, 'x', 1);
  assert.equal(blocked.error, 'rate');
  assert.ok(blocked.waitMs > 0 && blocked.waitMs <= TROLL_LIMITS.windowMs);
  now += TROLL_LIMITS.windowMs + 1;
  assert.ok(t4.start(G1, 'x', 1).ok, 'allowed again after 10 min');
  // busy
  const t5 = new Troll({ send: async () => {}, mem: {}, sleep: () => new Promise((res) => setTimeout(res, 5)), now: () => now });
  const a = t5.start(G1, 'x', 3);
  assert.equal(t5.start(G1, 'y', 3).error, 'busy');
  await a.done;
});

/* ---- through the real message handler ---- */
function harness(settings = {}) {
  const sent = [];
  const wa = { me: () => ME, isMe: (j) => String(j || '').startsWith(ME), pnFor: async (jid, alt) => String(alt || jid || '').split('@')[0].split(':')[0], sock: { user: { id: `${ME}@s.whatsapp.net` } } };
  const state = { memory: { processed: [], sentIds: [], lastOut: {}, lastIn: {}, cooldowns: {}, aiCount: {}, ai: {}, awaySent: {}, warns: {}, broadcast: { date: null, n: 0 } }, status: { inbox: {}, groups: [{ id: G1, name: 'ASCENDING TOGETHER' }, { id: G2, name: 'AIML' }] } };
  const contacts = [{ id: 'c1', name: 'Ravi Kumar', number: '+91 90000 00002' }];
  const data = { settings: withDefaults({ version: 2, ...settings }), rules: [], contacts, groupsCfg: {} };
  const inc = new Incoming({ wa, getData: () => data, state, send: async (jid, content, opts = {}) => { const id = 'S' + (sent.length + 1); sent.push({ jid, id, text: content.text, opts }); state.memory.sentIds.push(id); return { key: { id } }; }, media: null });
  inc.trollOpts = { sleep: async () => {} };
  return { inc, sent, state, data };
}
let k = 0;
const ts = () => Math.floor(Date.now() / 1000) - 5;
const mine = (chat, text) => ({ key: { remoteJid: chat, participant: chat.endsWith('@g.us') ? `${ME}@s.whatsapp.net` : undefined, id: 'T' + ++k, fromMe: true }, messageTimestamp: ts(), message: { conversation: text } });
const friend = (chat, num, text) => ({ key: { remoteJid: chat, participant: chat.endsWith('@g.us') ? `${num}@s.whatsapp.net` : undefined, id: 'T' + ++k, fromMe: false }, messageTimestamp: ts(), message: { conversation: text } });
const run = async (h, ...messages) => { h.inc.push({ messages }); await h.inc.drain(); if (h.inc._troll?.current) await h.inc._troll.current; await new Promise((r) => setTimeout(r, 1)); };
const SELF = `${ME}@s.whatsapp.net`;
const into = (h, jid) => h.sent.filter((s) => s.jid === jid && s.opts.kind === 'troll');

test('owner "!troll 5 wake up" typed in a group → 5 plain messages there (no header), summary only to you', async () => {
  const h = harness();
  await run(h, mine(G1, '!troll 5 wake up 😴'));
  assert.equal(into(h, G1).length, 5);
  assert.ok(into(h, G1).every((s) => s.text === 'wake up 😴' && s.opts.quiet));
  assert.equal(h.sent.filter((s) => s.jid === G1).length, 5, 'nothing else goes into the trolled group');
  const me = h.sent.filter((s) => s.jid === SELF);
  assert.equal(me.length, 1);
  assert.match(me[0].text, /5\/5 sent to 👥 ASCENDING TOGETHER/);
  // the echoes of the bot's own troll messages never re-trigger anything
  await run(h, ...into(h, G1).map((s) => ({ ...mine(G1, s.text), key: { remoteJid: G1, participant: `${ME}@s.whatsapp.net`, id: s.id, fromMe: true } })));
  assert.equal(into(h, G1).length, 5);
});

test('owner from own chat: needs @name; @name → that group; ambiguous / unknown → told; count capped at 50', async () => {
  const h = harness();
  await run(h, mine(SELF, '!troll 3 hi'));
  assert.ok(h.sent.some((s) => s.jid === SELF && /Type it IN the chat/.test(s.text)));
  await run(h, mine(SELF, '!troll @aiml 3 hello'));
  assert.equal(into(h, G2).length, 3);
  await run(h, mine(SELF, '!troll @ravi kumar 2 bro'));
  assert.equal(into(h, `${RAVI}@s.whatsapp.net`).length, 2);
  const trolls = h.sent.filter((s) => s.opts.kind === 'troll').length;
  await run(h, mine(SELF, '!troll @nobody 2 x'));
  assert.ok(h.sent.some((s) => s.jid === SELF && /No group or contact called "nobody"/.test(s.text)));
  assert.equal(h.sent.filter((s) => s.opts.kind === 'troll').length, trolls, 'nothing sent');
  h.state.memory.trollBursts = [];
  await run(h, mine(SELF, '!troll @ascending 120 spam'));
  assert.equal(into(h, G1).length, 50);
  assert.ok(h.sent.some((s) => s.jid === SELF && /capped at 50/.test(s.text)));
});

test('!troll stop cancels a running burst', async () => {
  const h = harness();
  let release;
  h.inc.trollOpts = { sleep: () => new Promise((r) => { release = r; }) };
  h.inc.push({ messages: [mine(G1, '!troll 10 hey')] });
  await h.inc.drain();
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(into(h, G1).length, 1);
  h.inc.push({ messages: [mine(SELF, '!troll stop')] });
  await h.inc.drain();
  release();
  await h.inc._troll.current;
  assert.equal(into(h, G1).length, 1, 'stopped after the first message');
  assert.ok(h.sent.some((s) => s.jid === SELF && /Troll stopped/.test(s.text)));
  assert.ok(h.sent.some((s) => s.jid === SELF && /1\/10 sent .*\(stopped\)/.test(s.text)));
});

test('rate limit: a 4th burst within 10 min is refused', async () => {
  const h = harness();
  for (let i = 0; i < 3; i++) await run(h, mine(G1, `!troll 1 hi ${i}`));
  await run(h, mine(G1, '!troll 1 again'));
  assert.equal(into(h, G1).length, 3);
  assert.ok(h.sent.some((s) => s.jid === SELF && /max 3 bursts per 10 min/.test(s.text)));
});

test('friends can never trigger it (private chat or group), and it can be switched off', async () => {
  const h = harness({ features: { commands: true }, commands: { allow: 'everyone' } });
  await run(h, friend(`${RAVI}@s.whatsapp.net`, RAVI, '!troll 5 lol'), friend(G1, RAVI, '!troll 5 lol'), friend(G1, RAVI, '!troll @ascending 5 lol'));
  assert.equal(h.sent.filter((s) => s.opts.kind === 'troll').length, 0);
  const off = harness({ troll: { enabled: false } });
  await run(off, mine(G1, '!troll 5 lol'));
  assert.equal(into(off, G1).length, 0);
  assert.match(off.sent.at(-1).text, /Troll mode is off/);
});

test('troll sends do not touch any daily cap (AI per chat, VR Bot mode, broadcast)', async () => {
  const h = harness({ features: { botMode: true, ai: true } });
  const snap = () => JSON.stringify({ ai: h.state.memory.aiCount, bot: h.state.memory.botMode || null, bc: h.state.memory.broadcast });
  const before = snap();
  await run(h, mine(G1, '!troll 20 hello vr bot'));
  assert.equal(into(h, G1).length, 20);
  assert.equal(snap(), before);
});

test('panel job: runs once per job id, only if recent; contact target; capped', async () => {
  const h = harness();
  h.data.settings.troll.job = { id: 'j1', to: { type: 'contact', id: 'c1', name: 'Ravi Kumar' }, text: 'hello', count: 3, at: Date.now() };
  assert.equal(await h.inc.trollJob(), true);
  await h.inc._troll.current;
  assert.equal(into(h, `${RAVI}@s.whatsapp.net`).length, 3);
  assert.equal(await h.inc.trollJob(), false, 'same job never runs twice');
  h.data.settings.troll.job = { id: 'j2', to: { type: 'group', id: G1, name: 'ASCENDING TOGETHER' }, text: 'x', count: 99, at: Date.now() - 31 * 60000 };
  assert.equal(await h.inc.trollJob(), false, 'older than 30 min');
  h.data.settings.troll.job = { id: 'j3', to: { type: 'group', id: G1, name: 'ASCENDING TOGETHER' }, text: 'x', count: 99, at: Date.now() };
  assert.equal(await h.inc.trollJob(), true);
  await h.inc._troll.current;
  assert.equal(into(h, G1).length, 50);
});

test('!help shows the troll line to the owner only', () => {
  const s = withDefaults({ version: 2 });
  assert.match(helpText(s, true), /!troll <count> <text>/);
  assert.doesNotMatch(helpText(s, false), /troll/);
});
