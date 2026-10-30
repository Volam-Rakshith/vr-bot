// Per-chat / per-group controls ("scope"), rule reactions and AI reactions. © VR DEVELOPMENTS
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inScope, peopleOk, featureScope, ruleApplies, pickReaction, findRule } from '../panel/shared/rules.js';
import { withDefaults } from '../panel/shared/defaults.js';

process.env.GROQ_API_KEY = process.env.GROQ_API_KEY || 'test-key'; // read when src/env.js loads (below)
process.env.OWNER_NUMBER = '917989405979';
const { Incoming } = await import('../src/incoming.js');

const G1 = '120363000000000001@g.us', G2 = '120363000000000002@g.us';
const amma = { contactId: 'c1', tags: ['family'] };

test('inScope: people in private chats', () => {
  assert.equal(inScope({ who: 'everyone' }, { contactId: undefined }), true);
  assert.equal(inScope({ who: 'contacts' }, {}), false);
  assert.equal(inScope({ who: 'contacts' }, amma), true);
  assert.equal(inScope({ who: 'pick', contacts: ['c1'] }, amma), true);
  assert.equal(inScope({ who: 'pick', contacts: ['c2'] }, amma), false);
  assert.equal(inScope({ who: 'pick', tags: ['family'] }, amma), true);
  assert.equal(inScope({ who: 'pick' }, amma), false, 'nothing picked = nobody');
  assert.equal(inScope({ who: 'tags', tags: ['friends'] }, amma), false);
  assert.equal(inScope({ who: 'owner' }, amma), false);
  assert.equal(inScope({ who: 'everyone', exclude: ['c1'] }, amma), false);
  assert.equal(peopleOk({ who: 'something-new' }, amma), false, 'unknown value is a safe no');
});

test('inScope: groups all / none / only these', () => {
  const g1 = { isGroup: true, groupId: G1 }, g2 = { isGroup: true, groupId: G2 };
  assert.equal(inScope({ who: 'everyone', groups: 'all' }, g1), true);
  assert.equal(inScope({ who: 'everyone' }, g1), true, 'missing = all (old behaviour)');
  assert.equal(inScope({ who: 'contacts', groups: 'all' }, g1), false, '"all" still checks the sender');
  assert.equal(inScope({ who: 'everyone', groups: 'none' }, g1), false);
  assert.equal(inScope({ who: 'owner', groups: [G1] }, g1), true, 'anyone in a picked group');
  assert.equal(inScope({ who: 'everyone', groups: [G1] }, g2), false, 'never in other groups');
  assert.equal(inScope({ who: 'everyone', groups: [] }, g1), false, 'empty pick = no groups');
  assert.equal(inScope({ groups: [G1], exclude: ['c1'] }, { ...g1, contactId: 'c1' }), false);
});

test('featureScope: old settings keep old behaviour', () => {
  const S = withDefaults({ version: 2 });
  assert.deepEqual([featureScope(S, 'ai').who, featureScope(S, 'ai').groups], ['contacts', 'none']);
  assert.equal(inScope(featureScope(S, 'ai'), { isGroup: true, groupId: G1, ...amma }), false, 'AI never in groups by default');
  assert.equal(inScope(featureScope(S, 'media'), { isGroup: true, groupId: G1 }), true, 'media: all chats as before');
  assert.equal(inScope(featureScope(S, 'away'), {}), true, 'away: everyone as before');
  assert.equal(inScope(featureScope(S, 'voice'), {}), true);
  // old commands.inGroups switch still works
  assert.equal(featureScope(withDefaults({ version: 2, commands: { allow: 'everyone', inGroups: false } }), 'commands').groups, 'none');
  assert.equal(inScope(featureScope(withDefaults({ version: 2, commands: { allow: 'everyone' } }), 'commands'), { isGroup: true, groupId: G2 }), true);
  // old AI "tags" mode
  assert.equal(inScope(featureScope(withDefaults({ version: 2, ai: { who: 'tags', tags: ['family'] } }), 'ai'), amma), true);
});

test('commands default to "only me", and old saved "everyone" is moved to "only me" once', () => {
  assert.equal(withDefaults({}).commands.allow, 'owner');
  assert.equal(withDefaults(undefined).commands.allow, 'owner');
  const old = withDefaults({ version: 1, commands: { allow: 'everyone', inGroups: true } });
  assert.equal(old.commands.allow, 'owner');
  assert.equal(old.version, 2);
  assert.equal(withDefaults({ version: 1, commands: { allow: 'contacts' } }).commands.allow, 'contacts', 'a real choice is kept');
  assert.equal(withDefaults({ version: 2, commands: { allow: 'everyone' } }).commands.allow, 'everyone', 'choosing Everyone again sticks');
  assert.equal(inScope(featureScope(withDefaults({}), 'commands'), { contactId: 'c1' }), false, 'strangers and contacts cannot run commands');
});

test('ruleApplies: picked groups', () => {
  const r = { where: 'both', groups: [G1] };
  assert.equal(ruleApplies(r, { isGroup: true, groupId: G1 }), true);
  assert.equal(ruleApplies(r, { isGroup: true, groupId: G2 }), false);
  assert.equal(ruleApplies({ where: 'groups', groups: [] }, { isGroup: true, groupId: G2 }), true, 'empty = all groups (old behaviour)');
  assert.equal(ruleApplies({ where: 'private', groups: [G1] }, { isGroup: true, groupId: G1 }), false, '"Private chats" wins');
  assert.equal(ruleApplies({ where: 'groups', groups: [G1] }, { isGroup: false, contactId: 'c1' }), false);
  // picked contacts limit private chats; picked groups answer anyone in them
  const mix = { where: 'both', contacts: ['c1'], groups: [G1] };
  assert.equal(ruleApplies(mix, { isGroup: false, contactId: 'c1' }), true);
  assert.equal(ruleApplies(mix, { isGroup: false, contactId: 'c9' }), false);
  assert.equal(ruleApplies(mix, { isGroup: true, groupId: G1, contactId: 'c9' }), true);
  assert.equal(ruleApplies({ where: 'both', groups: [G1], exclude: ['c9'] }, { isGroup: true, groupId: G1, contactId: 'c9' }), false);
  // no groups field at all → exactly as before (contacts filter applies to group senders too)
  assert.equal(ruleApplies({ where: 'both', contacts: ['c1'] }, { isGroup: true, groupId: G2, contactId: 'c9' }), false);
  assert.equal(findRule([{ id: 'x', pattern: 'hi', where: 'groups', groups: [G1] }], 'hi', { isGroup: true, groupId: G2 }, {}, Date.now(), G2), null);
});

test('pickReaction keeps only the allowed emoji', () => {
  assert.equal(pickReaction('😂'), '😂');
  assert.equal(pickReaction('I would react with ❤️ here'), '❤️');
  assert.equal(pickReaction('❤'), '❤️', 'heart without the variation selector');
  assert.equal(pickReaction('none'), '');
  assert.equal(pickReaction('🤡'), '');
  assert.equal(pickReaction(''), '');
});

/* ---- the real message handler with a fake WhatsApp ---- */
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
    status: { inbox: {}, groups: [{ id: G1, name: 'AIML' }, { id: G2, name: 'Other' }] },
  };
  const data = { settings: withDefaults({ version: 2, ...settings }), rules, contacts, groupsCfg: {} };
  const inc = new Incoming({ wa, getData: () => data, state, send: async (jid, content) => { sent.push({ jid, content }); return { key: { id: 'S' + sent.length } }; }, media: null });
  return { inc, sent, state };
}
let n = 0;
const dm = (num, text) => ({ key: { remoteJid: `${num}@s.whatsapp.net`, id: 'M' + ++n, fromMe: false }, messageTimestamp: Math.floor(Date.now() / 1000) - 30, message: { conversation: text } });
const gm = (group, num, text, contextInfo) => ({ key: { remoteJid: group, participant: `${num}@s.whatsapp.net`, id: 'M' + ++n, fromMe: false }, messageTimestamp: Math.floor(Date.now() / 1000) - 30, message: contextInfo ? { extendedTextMessage: { text, contextInfo } } : { conversation: text } });

test('rule → reaction (only in scope, respects cooldown)', async () => {
  const rules = [{ id: 'love', pattern: 'good morning', react: '❤️', reply: '', where: 'both', contacts: ['c1'], groups: [G1], cooldownMinutes: 60 }];
  const contacts = [{ id: 'c1', name: 'Amma', number: '+91 98480 00001' }];
  const { inc, sent } = harness({ rules, contacts });
  const m1 = dm('919848000001', 'Good morning ra');
  inc.push({ messages: [m1, dm('919000000005', 'good morning'), gm(G2, '919000000006', 'good morning all')] });
  await inc.drain();
  assert.equal(sent.length, 1, JSON.stringify(sent));
  assert.deepEqual(sent[0].content, { react: { text: '❤️', key: m1.key } });
  // same chat again within cooldown → nothing; picked group → reacts
  const m3 = gm(G1, '919000000006', 'good morning everyone');
  inc.push({ messages: [dm('919848000001', 'good morning again'), m3] });
  await inc.drain();
  assert.equal(sent.length, 2);
  assert.equal(sent[1].jid, G1);
  assert.equal(sent[1].content.react.text, '❤️');
});

test('rule with reaction + text reply sends both', async () => {
  const { inc, sent } = harness({ rules: [{ id: 'p', pattern: 'price', react: '👍', reply: 'Quote soon!', where: 'private' }] });
  inc.push({ messages: [dm('919000000003', 'price?')] });
  await inc.drain();
  assert.equal(sent.length, 2);
  assert.ok(sent[0].content.react && sent[1].content.text.includes('Quote soon!'));
});

test('commands: strangers ignored by default, picked group allowed, I always can', async () => {
  const { inc, sent } = harness();
  inc.push({ messages: [dm('919000000003', '!help'), gm(G1, '919000000004', '!help')] });
  await inc.drain();
  assert.equal(sent.length, 0, 'default = only me');
  inc.push({ messages: [dm('917989405979', '!help')] }); // OWNER_NUMBER
  await inc.drain();
  assert.equal(sent.length, 1);
  const h = harness({ settings: { commands: { groups: [G1] } } });
  h.inc.push({ messages: [gm(G1, '919000000004', '!help'), gm(G2, '919000000004', '!help')] });
  await h.inc.drain();
  assert.equal(h.sent.length, 1);
  assert.equal(h.sent[0].jid, G1);
});

test('AI: only picked people / groups (@mention in groups), optional AI reaction', async () => {
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    const body = JSON.parse(opts.body);
    calls.push(body);
    const isReact = body.messages[0].content.startsWith('Pick ONE emoji');
    return { ok: true, json: async () => ({ choices: [{ message: { content: isReact ? '😂' : 'haha ok bro' } }] }) };
  };
  try {
    const contacts = [{ id: 'c3', name: 'Saiteja', number: '+91 90000 00003' }];
    const { inc, sent } = harness({ contacts, settings: { features: { ai: true }, ai: { who: 'pick', contacts: ['c3'], groups: [G1], react: true } } });
    inc.push({ messages: [
      dm('919000000003', 'bro you coming?'),               // picked → react + reply
      dm('919000000009', 'hello'),                          // not picked → nothing
      gm(G1, '919000000009', 'anyone free?'),               // picked group but not talking to me → nothing
      gm(G1, '919000000009', '@me are you free', { mentionedJid: [`${ME}@s.whatsapp.net`] }), // mention → react + reply
      gm(G2, '919000000009', '@me hi', { mentionedJid: [`${ME}@s.whatsapp.net`] }),         // other group → nothing
    ] });
    await inc.drain();
    const chats = sent.map((s) => s.jid);
    assert.deepEqual(chats, ['919000000003@s.whatsapp.net', '919000000003@s.whatsapp.net', G1, G1], JSON.stringify(sent));
    assert.equal(sent[0].content.react.text, '😂');
    assert.ok(sent[1].content.text.endsWith('haha ok bro'));
    assert.equal(calls.length, 4);
  } finally { globalThis.fetch = realFetch; }
});

test('AI reaction fails silently (Groq down) and away only goes to picked people', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('network down'); };
  try {
    const { inc, sent } = harness({ settings: { features: { ai: true, away: true }, away: { window: { enabled: false }, who: 'contacts' }, ai: { who: 'everyone', react: true } } });
    inc.push({ messages: [dm('919000000003', 'hi')] });
    await inc.drain(); // stranger: not in the away list → AI is tried, fails quietly, nothing sent
    assert.equal(sent.length, 0);
    const h = harness({ contacts: [{ id: 'c1', name: 'Amma', number: '+91 98480 00001' }], settings: { features: { away: true }, away: { window: { enabled: false }, who: 'contacts' } } });
    h.inc.push({ messages: [dm('919848000001', 'hi'), dm('919000000003', 'hi')] });
    await h.inc.drain();
    assert.equal(h.sent.length, 1);
    assert.equal(h.sent[0].jid, '919848000001@s.whatsapp.net');
  } finally { globalThis.fetch = realFetch; }
});
