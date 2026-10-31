// AI replies never invent your name: name + "About you" facts are always in the prompt. © VR DEVELOPMENTS
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMessages, aboutMeOf } from '../src/features/ai.js';
import { withDefaults, DEFAULT_SETTINGS } from '../panel/shared/defaults.js';

const sysOf = (ai, name = 'Rakshith') => buildMessages(ai, name, [], 'what is your name?')[0].content;

test('buildMessages: name + facts + no-invent rule, with the default style prompt', () => {
  const ai = withDefaults({ version: 2 }).ai;
  const s = sysOf(ai);
  assert.ok(s.startsWith(ai.stylePrompt), 'style prompt still used');
  assert.ok(s.includes('You are Rakshith, replying on WhatsApp as yourself.'));
  assert.ok(s.includes('Volam Rakshith') && s.includes('SITS, Hyderabad') && s.includes('VR DEVELOPMENTS'));
  assert.ok(s.includes('Never make up a name, age, college, business, place or number'));
  assert.ok(s.includes('My real names: Rakshith, VR, or my full name Volam Rakshith — all three are fine'), 'names line is in the prompt');
  assert.ok(s.includes('fake names: Rudra, Vishal, or just "Volam" alone as a nickname'));
  assert.ok(s.includes('reply casually that my name is Rakshith / VR, not that.'));
});

test('buildMessages: name + facts present WITHOUT a style prompt too', () => {
  const s = sysOf({ stylePrompt: '', aboutMe: 'Name: Test Person. Age 20.' }, 'Testu');
  assert.ok(s.includes('You reply to WhatsApp messages as Testu'));
  assert.ok(s.includes('You are Testu, replying on WhatsApp as yourself.'));
  assert.ok(s.includes('Name: Test Person. Age 20.'));
  assert.ok(s.includes('ONLY what is written in the facts'));
});

test('buildMessages: a custom style prompt keeps working and still gets the facts', () => {
  const s = sysOf({ stylePrompt: 'Talk like a pirate.', aboutMe: 'Name: VR' });
  assert.ok(s.startsWith('Talk like a pirate.'));
  assert.ok(s.includes('You are Rakshith') && s.includes('Name: VR'));
});

test('aboutMe: missing in an old saved file → default; cleared on purpose → name only', () => {
  assert.equal(withDefaults({ version: 2, ai: { stylePrompt: 'x' } }).ai.aboutMe, DEFAULT_SETTINGS.ai.aboutMe);
  assert.equal(aboutMeOf({}), DEFAULT_SETTINGS.ai.aboutMe, 'explicit fallback when settings were not merged');
  assert.ok(sysOf({ stylePrompt: 'x' }).includes('Volam Rakshith'));
  const s = sysOf({ stylePrompt: 'x', aboutMe: '' });
  assert.ok(!s.includes('SITS') && s.includes('Facts about you: only your name, Rakshith.'));
});

test('buildMessages: examples, history and the new message keep their order', () => {
  const m = buildMessages({ examples: [{ them: 'hi', me: 'hey' }] }, 'R', [{ role: 'them', text: 'a' }, { role: 'me', text: 'b' }], 'c');
  assert.deepEqual(m.slice(1).map((x) => [x.role, x.content]), [['user', 'hi'], ['assistant', 'hey'], ['user', 'a'], ['assistant', 'b'], ['user', 'c']]);
});

test('reaction-only ask (plain) sends just its own instruction', () => {
  const s = sysOf({ plain: true, stylePrompt: 'Pick ONE emoji.' });
  assert.equal(s, 'Pick ONE emoji.');
});
