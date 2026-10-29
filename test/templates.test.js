import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderTemplate, placeholders, headerOn, withHeader } from '../panel/shared/templates.js';
import { DEFAULT_SETTINGS } from '../panel/shared/defaults.js';

test('placeholders + fallback', () => {
  assert.equal(renderTemplate('Hi {name}, today is {day}', { name: 'Amma', day: 'Mon' }), 'Hi Amma, today is Mon');
  assert.equal(renderTemplate('Hi {name|friend}!', { name: '' }), 'Hi friend!');
  assert.equal(renderTemplate('Happy {festival} {first_name|}!', { festival: 'Diwali' }), 'Happy Diwali !');
  assert.equal(renderTemplate('Hi {unknown}', {}), 'Hi {unknown}');
});

test('random pick is deterministic per seed', () => {
  const t = '{{Hi|Hello|Hey}} {name}';
  const a = renderTemplate(t, { name: 'X' }, 'seed1');
  assert.equal(a, renderTemplate(t, { name: 'X' }, 'seed1'));
  assert.match(a, /^(Hi|Hello|Hey) X$/);
});

test('placeholders()', () => {
  assert.deepEqual(placeholders('Hi {name}, {date|soon}'), ['name', 'date']);
});

test('VR Bot header: defaults per kind + overrides', () => {
  const h = DEFAULT_SETTINGS.header;
  assert.equal(headerOn(h, 'group'), true);
  assert.equal(headerOn(h, 'broadcast'), true);
  assert.equal(headerOn(h, 'alert'), true);
  assert.equal(headerOn(h, 'birthday'), false);
  assert.equal(headerOn(h, 'festival'), false);
  assert.equal(headerOn(h, 'birthday', 'on'), true);          // schedule override wins
  assert.equal(headerOn(h, 'group', 'off'), false);
  assert.equal(headerOn(h, 'personal', 'default', 'on'), true); // contact override
  assert.equal(headerOn({ ...h, enabled: false }, 'group', 'on'), false); // global off beats everything
  assert.equal(withHeader('Hello', h.text, true), '🤖 *VR Bot* is sending:\nHello');
});
