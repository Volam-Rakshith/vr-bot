import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchText, ruleApplies, cooldownOk, findRule, pickReply } from '../panel/shared/rules.js';

test('contains with alternatives, case-insensitive', () => {
  const r = { pattern: 'price, cost', match: 'contains' };
  assert.equal(matchText(r, 'What is the PRICE?'), true);
  assert.equal(matchText(r, 'how much does it cost'), true);
  assert.equal(matchText(r, 'hello'), false);
});
test('exact / startsWith / regex / case sensitive', () => {
  assert.equal(matchText({ pattern: 'hi', match: 'exact' }, ' Hi '), true);
  assert.equal(matchText({ pattern: 'hi', match: 'exact' }, 'hi there'), false);
  assert.equal(matchText({ pattern: 'order', match: 'startsWith' }, 'Order #12'), true);
  assert.equal(matchText({ pattern: '^(hi|hey)\\b', match: 'regex' }, 'hey bro'), true);
  assert.equal(matchText({ pattern: '[bad', match: 'regex' }, 'x'), false); // invalid regex never crashes
  assert.equal(matchText({ pattern: 'VR', match: 'contains', caseSensitive: true }, 'vr'), false);
  assert.equal(matchText({ pattern: 'x', enabled: false }, 'x'), false);
});
test('scope: private/groups, contacts, tags, exclude', () => {
  assert.equal(ruleApplies({ where: 'private' }, { isGroup: true }), false);
  assert.equal(ruleApplies({ where: 'both' }, { isGroup: true }), true);
  assert.equal(ruleApplies({ contacts: ['c1'] }, { contactId: 'c2' }), false);
  assert.equal(ruleApplies({ tags: ['family'] }, { contactId: 'c2', tags: ['family'] }), true);
  assert.equal(ruleApplies({ exclude: ['c1'] }, { contactId: 'c1' }), false);
});
test('cooldown prevents loops', () => {
  const now = 1_000_000_000;
  assert.equal(cooldownOk({}, 'r|chat', now, 60), true);
  assert.equal(cooldownOk({ 'r|chat': now - 30 * 60000 }, 'r|chat', now, 60), false);
  assert.equal(cooldownOk({ 'r|chat': now - 61 * 60000 }, 'r|chat', now, 60), true);
  const rules = [{ id: 'r', pattern: 'price', cooldownMinutes: 60, reply: 'x' }];
  assert.equal(findRule(rules, 'price?', {}, { 'r|c': now - 1000 }, now, 'c'), null);
  assert.equal(findRule(rules, 'price?', {}, {}, now, 'c').id, 'r');
});
test('reply arrays pick one', () => {
  assert.ok(['a', 'b'].includes(pickReply({ reply: ['a', 'b'] }, 'seed')));
});
