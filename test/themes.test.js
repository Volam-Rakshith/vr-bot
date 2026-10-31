// 🎨 Panel looks: the theme list, saving the choice on the phone, and the CSS that makes each look. © VR DEVELOPMENTS
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../panel/${p}`, import.meta.url), 'utf8');

/** Run panel/theme.js like a browser would (a fake page + phone storage + dark-mode setting). */
async function loadTheme({ saved = null, dark = false } = {}) {
  const store = new Map(saved ? [['vrbot.theme', JSON.stringify(saved)]] : []);
  const attrs = {}, meta = { content: '' };
  const win = {
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) },
    matchMedia: () => ({ matches: dark, addEventListener() {} }),
    document: { documentElement: { setAttribute: (k, v) => { attrs[k] = v; } }, querySelector: () => ({ setAttribute: (k, v) => { meta[k] = v; } }) },
  };
  // theme.js is a plain browser script: run it with `window` = our fake
  new Function('window', 'globalThis', read('theme.js'))(win, win);
  return { T: win.VRTheme, attrs, meta, store };
}

test('themes: all 11 looks are there, Classic first and the default', async () => {
  const { T, attrs } = await loadTheme();
  assert.deepEqual(T.THEMES.map((t) => t.name), ['Classic', 'Glassmorphism', 'Neumorphism', 'Claymorphism', 'Neo-Brutalism', 'Bento Grid', 'Skeuomorphism', 'Aurora UI', 'Retro Windows / Mac OS', 'Isometric UI', 'Typographic / Kinetic']);
  assert.equal(attrs['data-theme'], 'classic');
  assert.equal(attrs['data-mode'], 'dark', 'the current look stays the default');
  for (const t of T.THEMES) {
    assert.ok(t.modes.length >= 1 && t.icon && t.desc, t.id);
    for (const m of t.modes) assert.ok(t.bar[m.id], `${t.id}/${m.id} has a browser-bar colour`);
  }
});

test('themes: tap = saved on the phone and applied at once; light/dark/auto; Retro has Windows / Mac OS', async () => {
  const { T, attrs, meta, store } = await loadTheme();
  T.set({ theme: 'glass' });
  assert.equal(attrs['data-theme'], 'glass');
  assert.equal(attrs['data-mode'], 'dark');
  assert.equal(meta.content, '#1b1340');
  T.set({ mode: 'light' });
  assert.equal(attrs['data-mode'], 'light');
  assert.deepEqual(JSON.parse(store.get('vrbot.theme')), { theme: 'glass', modes: { glass: 'light' } });
  T.set({ theme: 'neu' });
  assert.equal(attrs['data-mode'], 'light', 'Neumorphism starts light');
  T.set({ theme: 'glass' });
  assert.equal(attrs['data-mode'], 'light', 'each look remembers its own light/dark');
  assert.equal(T.resolve('glass', 'auto', true), 'dark');
  assert.equal(T.resolve('glass', 'auto', false), 'light');
  assert.equal(T.hasAuto(T.byId.retro), false);
  assert.equal(T.resolve('retro', 'auto', true), 'win', 'no auto for Retro');
  assert.equal(T.resolve('retro', 'mac'), 'mac');
  assert.equal(T.resolve('nope', 'x'), 'dark', 'unknown look → Classic');
  // reopening the panel shows the saved look
  const again = await loadTheme({ saved: JSON.parse(store.get('vrbot.theme')) });
  assert.equal(again.attrs['data-theme'], 'glass');
  assert.equal(again.attrs['data-mode'], 'light');
  const auto = await loadTheme({ saved: { theme: 'aurora', modes: { aurora: 'auto' } }, dark: false });
  assert.equal(auto.attrs['data-mode'], 'light', 'auto follows the phone');
  const junk = await loadTheme({ saved: 'garbage' });
  assert.equal(junk.attrs['data-theme'], 'classic');
});

test('themes: every look and mode has CSS; every token used is defined; nothing external (works offline)', async () => {
  const { T } = await loadTheme();
  const base = read('styles.css'), themes = read('themes.css');
  for (const t of T.THEMES) {
    if (t.id === 'classic') continue; // classic dark = the defaults in styles.css
    assert.match(themes, new RegExp(`\\[data-theme=${t.id}\\]\\{`), `${t.id} block`);
    for (const m of t.modes.slice(1)) assert.match(themes, new RegExp(`\\[data-theme=${t.id}\\]\\[data-mode=${m.id}\\]\\{`), `${t.id}/${m.id} block`);
  }
  assert.match(themes, /\[data-theme=classic\]\[data-mode=light\]\{/);
  // tokens: everything styles.css/themes.css reads must be set in the defaults block (so no look can leave one empty)
  const defaults = base.slice(base.indexOf(':root,[data-theme]{'), base.indexOf('}', base.indexOf(':root,[data-theme]{')));
  const defined = new Set([...defaults.matchAll(/(--[a-z0-9-]+):/g)].map((m) => m[1]));
  for (const m of themes.matchAll(/(--[a-z0-9-]+):/g)) defined.add(m[1]);
  const used = new Set([...(base + themes).matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1]));
  const missing = [...used].filter((v) => !defined.has(v));
  assert.deepEqual(missing, [], `undefined tokens: ${missing.join(', ')}`);
  // theme-only tokens (like --tile-a) must exist in every mode of that theme
  for (const css of [base, themes]) {
    assert.ok(!/@import|url\(\s*['"]?https?:|https?:\/\/fonts\./i.test(css), 'no web fonts / CDNs');
  }
  assert.match(base, /@media \(prefers-reduced-motion:reduce\)\{\*,\*::before,\*::after\{animation:none!important;transition:none!important\}\}/, 'motion off when the phone asks');
});

test('themes: loaded before the page draws, cached for offline (sw v9), CSP-safe', () => {
  const html = read('index.html'), sw = read('sw.js');
  const head = html.slice(0, html.indexOf('</head>'));
  assert.ok(head.includes('<link rel="stylesheet" href="themes.css">'));
  assert.ok(head.includes('<script src="theme.js"></script>'), 'plain script in <head> (no flash of the wrong look)');
  assert.ok(head.indexOf('theme-color') < head.indexOf('theme.js'), 'meta theme-color exists before the script sets it');
  assert.match(sw, /const CACHE = 'vr-bot-v9';/);
  for (const f of ['themes.css', 'theme.js', 'shared/notes.js']) assert.ok(sw.includes(`'${f}'`), `${f} precached`);
  assert.ok(!/<script>/.test(html), 'no inline script (CSP script-src self)');
});
