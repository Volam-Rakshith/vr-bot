// VR himself typing "vr bot …" in ANY chat (groups, friends' chats) → VR Bot mode answers there.
// The bot's own messages never trigger it (sent ids + 🤖), so no loops. © VR DEVELOPMENTS
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withDefaults } from '../panel/shared/defaults.js';

process.env.OWNER_NUMBER = '919999999999';
process.env.GROQ_API_KEY = '';
process.env.GROQ_API_KEY_BOT = '';
const { Incoming } = await import('../src/incoming.js');
globalThis.fetch = async () => { throw new Error('offline in tests'); }; // no network: no-key fallbacks only

const ME = '919999999999', RAVI = '919000000002';
const G1 = '120363000000000001@g.us', G2 = '120363000000000002@g.us';
function harness(settings = { features: { botMode: true } }) {
  const sent = [];
  const wa = { me: () => ME, isMe: (j) => String(j || '').startsWith(ME), pnFor: async (jid, alt) => String(alt || jid || '').split('@')[0].split(':')[0], sock: { user: { id: `${ME}@s.whatsapp.net` } } };
  const state = { memory: { processed: [], sentIds: [], lastOut: {}, lastIn: {}, cooldowns: {}, aiCount: {}, ai: {}, awaySent: {}, warns: {} }, status: { inbox: {}, groups: [{ id: G1, name: 'AIML' }] } };
  const contacts = [{ id: 'c1', name: 'Ravi Kumar', number: '+91 90000 00002' }];
  const data = { settings: withDefaults({ version: 2, ...settings }), rules: [], contacts, groupsCfg: {} };
  // like src/runner.js: every message the bot sends is remembered by id
  const inc = new Incoming({ wa, getData: () => data, state, send: async (jid, content) => { const id = 'S' + (sent.length + 1); sent.push({ jid, id, text: content.text, content }); state.memory.sentIds.push(id); return { key: { id } }; }, media: null });
  return { inc, sent, state };
}
let n = 0;
const ts = () => Math.floor(Date.now() / 1000) - 5;
const myGroup = (group, text, id = 'O' + ++n) => ({ key: { remoteJid: group, participant: `${ME}@s.whatsapp.net`, id, fromMe: true }, messageTimestamp: ts(), message: { conversation: text } });
const myDm = (num, text) => ({ key: { remoteJid: `${num}@s.whatsapp.net`, id: 'O' + ++n, fromMe: true }, messageTimestamp: ts(), message: { conversation: text } });
const friendGroup = (group, num, text) => ({ key: { remoteJid: group, participant: `${num}@s.whatsapp.net`, id: 'F' + ++n, fromMe: false }, messageTimestamp: ts(), message: { conversation: text } });
const run = async (h, ...messages) => { h.inc.push({ messages }); await h.inc.drain(); };

test('owner "vr bot hi" in a group → the bot answers in that group', async () => {
  const h = harness();
  await run(h, myGroup(G1, 'vr bot hi'));
  assert.equal(h.sent.length, 1, JSON.stringify(h.sent));
  assert.equal(h.sent[0].jid, G1);
  assert.match(h.sent[0].text, /^🤖/);
});

test('owner "vr bot …" in a friend\'s private chat → answered there; trigger at the END works too', async () => {
  const h = harness();
  await run(h, myDm(RAVI, 'who are you vr bot?'));
  const out = h.sent.filter((s) => s.jid !== `${ME}@s.whatsapp.net`); // (you also get the one "add the free key" hint)
  assert.equal(out.length, 1);
  assert.equal(out[0].jid, `${RAVI}@s.whatsapp.net`);
  assert.equal(h.sent[0].jid, `${RAVI}@s.whatsapp.net`);
});

test('owner message in a group without the trigger → nothing', async () => {
  const h = harness();
  await run(h, myGroup(G1, 'hi guys, what is the plan'), myGroup(G1, 'robot dance tonight'));
  assert.equal(h.sent.length, 0);
});

test('VR Bot mode off, or a group not picked for it → owner trigger does nothing', async () => {
  const off = harness({ features: { botMode: false } });
  await run(off, myGroup(G1, 'vr bot hi'));
  assert.equal(off.sent.length, 0);
  const picked = harness({ features: { botMode: true }, botMode: { groups: [G1] } });
  await run(picked, myGroup(G2, 'vr bot hi'));
  assert.equal(picked.sent.length, 0, 'group not picked');
  await run(picked, myGroup(G1, 'vr bot hi'));
  assert.equal(picked.sent.length, 1, 'picked group');
});

test('the bot\'s own messages never re-trigger it (sent id, 🤖 text) — no loops', async () => {
  const h = harness();
  await run(h, myGroup(G1, 'vr bot hi'));
  assert.equal(h.sent.length, 1);
  const echo = h.sent[0];
  assert.match(echo.text, /vr bot/i, 'the reply itself mentions "vr bot" (the loop risk)');
  // WhatsApp echoes the bot's reply back as a fromMe message with the id it was sent with — even if it contains "vr bot"
  await run(h, myGroup(G1, 'vr bot hi again', echo.id), myGroup(G1, echo.text));
  await run(h, myGroup(G1, '🤖 ask me anything, vr bot'), myGroup(G1, '🤖 *VR Bot* is sending:\nvr bot hello'));
  assert.equal(h.sent.length, 1, JSON.stringify(h.sent.map((s) => s.text)));
});

test('friends: "vr bot …" in a group works WITHOUT @tagging (word at the start or the end)', async () => {
  const h = harness();
  await run(h, friendGroup(G1, RAVI, 'vr bot hi'));
  h.state.memory.botMode.last = {}; // skip the per-chat cooldown
  await run(h, friendGroup(G1, RAVI, 'who are you vr bot?'));
  assert.equal(h.sent.filter((s) => s.jid === G1).length, 2);
});

test('VR Bot mode never answers another bot ("🤖 *Rak Bot* is sending: …"), even with "vr bot" in it', async () => {
  const h = harness();
  await run(h, friendGroup(G1, RAVI, '🤖 *Rak Bot* is sending:\nDid it sleep 😴'));
  await run(h, friendGroup(G1, RAVI, '🤖 *Rak Bot* is sending:\nvr bot hi'));
  await run(h, friendGroup(G1, RAVI, '*Rak Bot* is sending: vr bot who are you'));
  assert.equal(h.sent.length, 0);
});

test('owner !commands are unchanged', async () => {
  const h = harness({ features: { botMode: true, commands: true } });
  await run(h, myGroup(G1, '!help'));
  assert.ok(h.sent.length >= 1);
  assert.doesNotMatch(h.sent[0].text || '', /^🤖 Hi/);
});
