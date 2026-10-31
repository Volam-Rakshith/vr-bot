// "Only these…" with nobody picked, and "Never reply to these people" (rules + AI). © VR DEVELOPMENTS
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ruleApplies, inScope, featureScope, findRule, isExcluded } from '../panel/shared/rules.js';
import { withDefaults } from '../panel/shared/defaults.js';

process.env.GROQ_API_KEY = process.env.GROQ_API_KEY || 'test-key';
process.env.OWNER_NUMBER = '917989405979';
const { Incoming } = await import('../src/incoming.js');

const G1 = '120363000000000001@g.us';
const vijay = { contactId: 'cV', tags: ['friends'] };
const amma = { contactId: 'c1', tags: ['family'] };
const stranger = { contactId: undefined, tags: [] };

test('rule people: "Only these…" with nobody picked = nobody (not everyone)', () => {
  const r = { where: 'private', people: 'pick', contacts: [], tags: [] };
  assert.equal(ruleApplies(r, vijay), false);
  assert.equal(ruleApplies(r, amma), false);
  assert.equal(ruleApplies(r, stranger), false);
  assert.equal(ruleApplies({ where: 'private', people: 'pick' }, amma), false, 'missing lists too');
});

test('rule people: old rules without the field keep working exactly as before', () => {
  assert.equal(ruleApplies({ where: 'private', contacts: [], tags: [] }, vijay), true, 'empty = everyone (old)');
  assert.equal(ruleApplies({ where: 'private' }, stranger), true);
  assert.equal(ruleApplies({ where: 'private', contacts: ['c1'] }, vijay), false);
  assert.equal(ruleApplies({ where: 'private', contacts: ['c1'] }, amma), true);
});

test('rule people: "Everyone" and "Only these…" with people picked', () => {
  assert.equal(ruleApplies({ people: 'all', contacts: [], tags: [] }, stranger), true);
  assert.equal(ruleApplies({ people: 'all', contacts: ['c1'] }, vijay), true, '"Everyone" ignores leftover picks');
  const pick = { people: 'pick', contacts: ['c1'], tags: ['clients'] };
  assert.equal(ruleApplies(pick, amma), true);
  assert.equal(ruleApplies(pick, vijay), false);
  assert.equal(ruleApplies(pick, { contactId: 'c7', tags: ['clients'] }), true, 'picked list');
  assert.equal(ruleApplies(pick, stranger), false, 'a number not saved in Contacts is never "picked"');
  assert.equal(ruleApplies({ people: 'pick', contacts: [undefined, null] }, stranger), false, 'junk ids never match an unsaved number');
});

test('rule exclude: contacts and lists, wins over everything (groups too)', () => {
  assert.equal(ruleApplies({ people: 'all', exclude: ['cV'] }, vijay), false);
  assert.equal(ruleApplies({ people: 'all', exclude: ['cV'] }, amma), true);
  assert.equal(ruleApplies({ people: 'pick', contacts: ['cV'], exclude: ['cV'] }, vijay), false, 'blocked beats picked');
  assert.equal(ruleApplies({ people: 'all', excludeTags: ['friends'] }, vijay), false);
  assert.equal(ruleApplies({ people: 'all', excludeTags: ['friends'] }, amma), true);
  assert.equal(ruleApplies({ where: 'both', groups: [G1], exclude: ['cV'] }, { ...vijay, isGroup: true, groupId: G1 }), false);
  assert.equal(ruleApplies({ where: 'groups', excludeTags: ['friends'] }, { ...vijay, isGroup: true, groupId: G1 }), false);
  assert.equal(ruleApplies({ exclude: ['cV'] }, stranger), true, 'unsaved numbers are not blocked by a contact pick');
  assert.equal(ruleApplies({ exclude: [undefined] }, stranger), true);
  assert.equal(isExcluded({}, vijay), false);
});

test('AI exclude: contacts and lists, read from settings', () => {
  assert.equal(inScope({ who: 'everyone', excludeTags: ['friends'] }, vijay), false);
  assert.equal(inScope({ who: 'contacts', exclude: ['cV'] }, vijay), false);
  assert.equal(inScope({ who: 'contacts', exclude: ['cV'] }, amma), true);
  const S = withDefaults({ version: 2, ai: { who: 'contacts', exclude: ['cV'], excludeTags: ['clients'] } });
  const sc = featureScope(S, 'ai');
  assert.deepEqual([sc.exclude, sc.excludeTags], [['cV'], ['clients']]);
  assert.equal(inScope(sc, vijay), false);
  assert.equal(inScope(sc, { contactId: 'c5', tags: ['clients'] }), false);
  assert.equal(inScope(sc, amma), true);
  assert.deepEqual(withDefaults({ version: 2 }).ai.excludeTags, [], 'old settings get an empty list');
  assert.equal(inScope(featureScope(withDefaults({ version: 2 }), 'ai'), amma), true, 'old settings unchanged');
});

test('findRule skips a blocked person and moves on to the next rule', () => {
  const rules = [
    { id: 'quote', pattern: 'hi', people: 'all', exclude: ['cV'], reply: 'quote' },
    { id: 'none', pattern: 'hi', people: 'pick', contacts: [], reply: 'nobody' },
    { id: 'fallback', pattern: 'hi', reply: 'fallback' },
  ];
  assert.equal(findRule(rules, 'hi', vijay, {}, Date.now(), 'x').id, 'fallback');
  assert.equal(findRule(rules, 'hi', amma, {}, Date.now(), 'x').id, 'quote');
});

/* ---- end to end with the real message handler and a fake WhatsApp ---- */
const ME = '919999999999';
function harness({ settings = {}, rules = [], contacts = [] } = {}) {
  const sent = [];
  const wa = { me: () => ME, isMe: (j) => String(j || '').startsWith(ME), pnFor: async (jid, alt) => String(alt || jid || '').split('@')[0].split(':')[0], sock: { user: { id: `${ME}@s.whatsapp.net` } } };
  const state = {
    memory: { processed: [], sentIds: [], lastOut: {}, lastIn: {}, cooldowns: {}, aiCount: {}, ai: {}, awaySent: {}, warns: {} },
    status: { inbox: {}, groups: [{ id: G1, name: 'AIML' }] },
  };
  const data = { settings: withDefaults({ version: 2, ...settings }), rules, contacts, groupsCfg: {} };
  const inc = new Incoming({ wa, getData: () => data, state, send: async (jid, content) => { sent.push({ jid, content }); return { key: { id: 'S' + sent.length } }; }, media: null });
  return { inc, sent };
}
let n = 0;
const dm = (num, text) => ({ key: { remoteJid: `${num}@s.whatsapp.net`, id: 'X' + ++n, fromMe: false }, messageTimestamp: Math.floor(Date.now() / 1000) - 30, message: { conversation: text } });
const people = [
  { id: 'cV', name: 'Vijay', number: '+91 90000 00011', tags: ['friends'] },
  { id: 'c1', name: 'Amma', number: '+91 98480 00001', tags: ['family'] },
];

test('keyword rule: blocked Vijay gets nothing, others still do', async () => {
  const rules = [{ id: 'quote', pattern: 'hi', reply: 'Quote soon — VR DEVELOPMENTS', where: 'private', people: 'all', contacts: [], tags: [], exclude: ['cV'] }];
  const { inc, sent } = harness({ rules, contacts: people });
  inc.push({ messages: [dm('919000000011', 'hi'), dm('919848000001', 'hi'), dm('919000000077', 'hi')] });
  await inc.drain();
  assert.deepEqual(sent.map((s) => s.jid), ['919848000001@s.whatsapp.net', '919000000077@s.whatsapp.net']);
});

test('keyword rule: "Only these…" with nobody picked sends nothing to anyone', async () => {
  const rules = [{ id: 'quote', pattern: 'hi', reply: 'Quote soon', where: 'private', people: 'pick', contacts: [], tags: [] }];
  const { inc, sent } = harness({ rules, contacts: people });
  inc.push({ messages: [dm('919000000011', 'hi'), dm('919848000001', 'hi'), dm('919000000077', 'hi')] });
  await inc.drain();
  assert.equal(sent.length, 0);
});

test('keyword rule: "Only these…" Amma → unsaved numbers and Vijay get nothing', async () => {
  const rules = [{ id: 'quote', pattern: 'hi', reply: 'Quote soon', where: 'private', people: 'pick', contacts: ['c1'], tags: [] }];
  const { inc, sent } = harness({ rules, contacts: people });
  inc.push({ messages: [dm('919000000011', 'hi'), dm('919848000001', 'hi'), dm('919000000077', 'hi')] });
  await inc.drain();
  assert.deepEqual(sent.map((s) => s.jid), ['919848000001@s.whatsapp.net']);
});

test('AI replies: blocked person (by contact or list) gets no AI reply', async () => {
  const realFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, opts) => { calls.push(JSON.parse(opts.body)); return { ok: true, json: async () => ({ choices: [{ message: { content: 'ok bro' } }] }) }; };
  try {
    const { inc, sent } = harness({ contacts: [...people, { id: 'c3', name: 'Ravi', number: '+91 90000 00033', tags: ['friends'] }], settings: { features: { ai: true }, ai: { who: 'contacts', exclude: ['cV'] } } });
    inc.push({ messages: [dm('919000000011', 'what are you doing'), dm('919848000001', 'what are you doing')] });
    await inc.drain();
    assert.deepEqual(sent.map((s) => s.jid), ['919848000001@s.whatsapp.net'], JSON.stringify(sent));
    const h = harness({ contacts: [...people, { id: 'c3', name: 'Ravi', number: '+91 90000 00033', tags: ['friends'] }], settings: { features: { ai: true }, ai: { who: 'everyone', excludeTags: ['friends'] } } });
    h.inc.push({ messages: [dm('919000000011', 'yo'), dm('919000000033', 'yo'), dm('919848000001', 'yo')] });
    await h.inc.drain();
    assert.deepEqual(h.sent.map((s) => s.jid), ['919848000001@s.whatsapp.net']);
  } finally { globalThis.fetch = realFetch; }
});
