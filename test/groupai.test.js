// AI in groups → "In these groups reply to: Every message" (groupReplyAll + per-group cooldown). © VR DEVELOPMENTS
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withDefaults, DEFAULT_SETTINGS } from '../panel/shared/defaults.js';

process.env.GROQ_API_KEY = process.env.GROQ_API_KEY || 'test-key'; // read when src/env.js loads (below)
process.env.OWNER_NUMBER = '917989405979';
const { Incoming, groupCooldownMs, looksLikeBot, shortForGroup } = await import('../src/incoming.js');
const { buildMessages } = await import('../src/features/ai.js');

const G1 = '120363000000000001@g.us', G2 = '120363000000000002@g.us';
const ME = '919999999999';
function harness({ settings = {}, rules = [], contacts = [] } = {}) {
  const sent = [];
  const wa = {
    me: () => ME,
    isMe: (j) => String(j || '').startsWith(ME),
    pnFor: async (jid, alt) => String(alt || jid || '').split('@')[0].split(':')[0],
    sock: { user: { id: `${ME}@s.whatsapp.net` } },
  };
  const state = {
    memory: { processed: [], sentIds: [], lastOut: {}, lastIn: {}, cooldowns: {}, aiCount: {}, ai: {}, awaySent: {}, warns: {} },
    status: { inbox: {}, groups: [{ id: G1, name: 'ASCENDING TOGETHER' }, { id: G2, name: 'Other' }] },
  };
  const data = { settings: withDefaults({ version: 2, ...settings }), rules, contacts, groupsCfg: {} };
  const inc = new Incoming({ wa, getData: () => data, state, send: async (jid, content) => { sent.push({ jid, content }); return { key: { id: 'S' + sent.length } }; }, media: null });
  return { inc, sent, state, data };
}
let n = 0;
const ago = (s) => Math.floor(Date.now() / 1000) - s;
const gm = (group, num, text, { contextInfo, secsAgo = 30, pushName } = {}) => ({ key: { remoteJid: group, participant: `${num}@s.whatsapp.net`, id: 'G' + ++n, fromMe: false }, pushName, messageTimestamp: ago(secsAgo), message: contextInfo ? { extendedTextMessage: { text, contextInfo } } : { conversation: text } });
const mine = (group, text, secsAgo = 10) => ({ key: { remoteJid: group, participant: `${ME}@s.whatsapp.net`, id: 'O' + ++n, fromMe: true }, messageTimestamp: ago(secsAgo), message: { conversation: text } });
const mention = { mentionedJid: [`${ME}@s.whatsapp.net`] };

let calls = [];
let answer = 'haha same bro';
async function withGroq(fn) {
  const real = globalThis.fetch;
  calls = [];
  globalThis.fetch = async (url, opts) => { calls.push(JSON.parse(opts.body)); return { ok: true, json: async () => ({ choices: [{ message: { content: answer } }] }) }; };
  try { await fn(); } finally { globalThis.fetch = real; answer = 'haha same bro'; }
}
const ON = (ai = {}, extra = {}) => ({ settings: { features: { ai: true }, ai: { groups: [G1], groupReplyAll: true, ...ai }, ...extra } });

test('defaults: reply-all off, cooldown 60 s (min 15)', () => {
  assert.equal(DEFAULT_SETTINGS.ai.groupReplyAll, false);
  assert.equal(DEFAULT_SETTINGS.ai.groupCooldownSec, 60);
  assert.equal(withDefaults({ version: 2, ai: { groups: [G1] } }).ai.groupReplyAll, false, 'old saved settings keep the old behaviour');
  assert.equal(groupCooldownMs({ ai: {} }), 60000);
  assert.equal(groupCooldownMs({ ai: { groupCooldownSec: 5 } }), 15000);
  assert.equal(groupCooldownMs({ ai: { groupCooldownSec: 120 } }), 120000);
  assert.equal(groupCooldownMs({ ai: { groupCooldownSec: 'x' } }), 60000);
});

test('off (default): a plain group message gets nothing, an @mention still gets a reply', async () => {
  await withGroq(async () => {
    const { inc, sent } = harness({ settings: { features: { ai: true }, ai: { groups: [G1] } } });
    inc.push({ messages: [gm(G1, '919000000009', 'anyone free?')] });
    await inc.drain();
    assert.equal(sent.length, 0);
    inc.push({ messages: [gm(G1, '919000000009', '@me are you free', { contextInfo: mention })] });
    await inc.drain();
    assert.equal(sent.length, 1);
    assert.equal(sent[0].jid, G1);
  });
});

test('on: plain message in a picked group → AI reply; unpicked group → nothing', async () => {
  await withGroq(async () => {
    const { inc, sent } = harness(ON());
    inc.push({ messages: [gm(G1, '919000000009', 'anyone free tonight?', { pushName: 'Sunil' }), gm(G2, '919000000008', 'hello all')] });
    await inc.drain();
    assert.equal(sent.length, 1, JSON.stringify(sent));
    assert.equal(sent[0].jid, G1);
    assert.ok(sent[0].content.text.endsWith('haha same bro'));
    const sys = calls[0].messages[0].content;
    assert.ok(sys.includes('GROUP chat ("ASCENDING TOGETHER")') && sys.includes('1–2 short lines'), sys);
    assert.equal(calls[0].messages.at(-1).content, 'Sunil: anyone free tonight?');
  });
});

test('on: one reply per group per drain, to the latest message', async () => {
  await withGroq(async () => {
    const { inc, sent } = harness(ON());
    inc.push({ messages: [gm(G1, '919000000009', 'first', { secsAgo: 40 }), gm(G1, '919000000007', 'second', { secsAgo: 20 })] });
    await inc.drain();
    assert.equal(sent.length, 1);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].messages.at(-1).content, 'second');
  });
});

test('on: cooldown per group is respected', async () => {
  await withGroq(async () => {
    const { inc, sent, state } = harness(ON({ groupCooldownSec: 60 }));
    inc.push({ messages: [gm(G1, '919000000009', 'msg one')] });
    await inc.drain();
    assert.equal(sent.length, 1);
    inc.push({ messages: [gm(G1, '919000000009', 'msg two', { secsAgo: 5 })] });
    await inc.drain();
    assert.equal(sent.length, 1, 'within 60 s → quiet');
    state.memory.aiGroupLast[G1] -= 61000; // a minute later
    inc.push({ messages: [gm(G1, '919000000009', 'msg three', { secsAgo: 5 })] });
    await inc.drain();
    assert.equal(sent.length, 2, 'after the cooldown → replies again');
  });
});

test('on: excluded people are skipped', async () => {
  await withGroq(async () => {
    const contacts = [{ id: 'c1', name: 'Vijay', number: '+91 90000 00009' }];
    const { inc, sent } = harness({ contacts, ...ON({ exclude: ['c1'] }) });
    inc.push({ messages: [gm(G1, '919000000009', 'hi guys')] });
    await inc.drain();
    assert.equal(sent.length, 0);
    inc.push({ messages: [gm(G1, '919000000005', 'hi guys')] });
    await inc.drain();
    assert.equal(sent.length, 1);
  });
});

test('on: my own messages never trigger, and if I posted after the message it stays quiet', async () => {
  await withGroq(async () => {
    const { inc, sent } = harness(ON());
    inc.push({ messages: [mine(G1, 'hello guys', 20)] });
    await inc.drain();
    assert.equal(sent.length, 0, 'own message');
    inc.push({ messages: [gm(G1, '919000000009', 'bro?', { secsAgo: 30 }), mine(G1, 'ya tell', 10)] });
    await inc.drain();
    assert.equal(sent.length, 0, 'I already answered in the group');
    assert.equal(calls.length, 0);
  });
});

test('on: bot messages (🤖 / header) are never answered (no bot loops)', async () => {
  await withGroq(async () => {
    const { inc, sent } = harness(ON());
    inc.push({ messages: [gm(G1, '919000000009', '🤖 *Some Bot*: hello')] });
    await inc.drain();
    inc.push({ messages: [gm(G1, '919000000008', `${DEFAULT_SETTINGS.header.text}\nhi`)] });
    await inc.drain();
    assert.equal(sent.length, 0);
    inc.push({ messages: [gm(G1, '919000000007', '🤖 *Rak Bot* is sending:\nDid it sleep 😴')] });
    await inc.drain();
    inc.push({ messages: [gm(G1, '919000000006', '✨ *Rak Bot* is sending:\nhello @me', { contextInfo: mention })] });
    await inc.drain(); // even an @mention from another bot gets no AI reply
    assert.equal(sent.length, 0, JSON.stringify(sent));
    assert.equal(looksLikeBot('🤖 *Rak Bot* is sending:\nDid it sleep 😴'), true);
    assert.equal(looksLikeBot('*Rak Bot* is sending:\nhi'), true);
    assert.equal(looksLikeBot('normal msg 🤖', {}), true);
    assert.equal(looksLikeBot('normal msg', {}), false);
  });
});

test('on: keyword auto-reply rules still come first', async () => {
  await withGroq(async () => {
    const rules = [{ id: 'gm', pattern: 'good morning', reply: 'Good morning! ☀️', where: 'both', groups: [G1] }];
    const { inc, sent } = harness({ rules, ...ON() });
    inc.push({ messages: [gm(G1, '919000000009', 'good morning all')] });
    await inc.drain();
    assert.equal(sent.length, 1);
    assert.ok(sent[0].content.text.endsWith('Good morning! ☀️'));
    assert.equal(calls.length, 0, 'no AI call');
  });
});

test('group answers are cut to 2 lines, without a "Name:" prefix', async () => {
  assert.equal(shortForGroup('Rakshith: line one\n\nline two\nline three', 'Rakshith'), 'line one\nline two');
  answer = 'Rakshith: ya bro\ncoming\nat 7\nbye';
  await withGroq(async () => {
    const { inc, sent } = harness(ON());
    inc.push({ messages: [gm(G1, '919000000009', 'coming?')] });
    await inc.drain();
    assert.equal(sent.length, 1);
    assert.ok(sent[0].content.text.endsWith('ya bro\ncoming'), sent[0].content.text);
  });
});

test('buildMessages: group line only for groups; private chats unchanged', () => {
  const p = buildMessages({ stylePrompt: 'x' }, 'R', [], 'hi')[0].content;
  assert.ok(!p.includes('GROUP chat'));
  const g = buildMessages({ stylePrompt: 'x' }, 'R', [], 'hi', { group: true, groupName: 'AIML' })[0].content;
  assert.ok(g.includes('GROUP chat ("AIML")'));
  assert.equal(buildMessages({ plain: true, stylePrompt: 'Pick' }, 'R', [], 'hi', { group: true })[0].content, 'Pick');
});
