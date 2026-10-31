// VR Bot panel — looks ("themes"). Loaded as a plain script in <head>, BEFORE the page draws, so the chosen look
// shows instantly with no flash. Saved on THIS phone only (localStorage) — nothing is committed to GitHub.
// The panel (app.js) and the tests use the same list through globalThis.VRTheme. © VR DEVELOPMENTS
(function (root) {
  'use strict';
  var LD = [{ id: 'dark', label: '🌙 Dark' }, { id: 'light', label: '☀️ Light' }];
  var DL = [{ id: 'light', label: '☀️ Light' }, { id: 'dark', label: '🌙 Dark' }];
  // id, name, what it is, modes (first = default), browser bar colour per mode
  var THEMES = [
    { id: 'classic', name: 'Classic', icon: '✨', desc: 'The original VR Bot look — copper on midnight', modes: LD, bar: { dark: '#07080d', light: '#f6f1ec' } },
    { id: 'glass', name: 'Glassmorphism', icon: '🫧', desc: 'Frosted glass cards over a colourful glow', modes: LD, bar: { dark: '#1b1340', light: '#dfe7ff' } },
    { id: 'neu', name: 'Neumorphism', icon: '🧼', desc: 'Soft, pressed-in plastic — shadows instead of borders', modes: DL, bar: { light: '#e4e9f0', dark: '#262a31' } },
    { id: 'clay', name: 'Claymorphism', icon: '🧸', desc: 'Puffy, rounded, pastel — like soft clay', modes: DL, bar: { light: '#f3ecff', dark: '#2a2340' } },
    { id: 'brutal', name: 'Neo-Brutalism', icon: '🧱', desc: 'Thick black borders, hard shadows, loud colours', modes: DL, bar: { light: '#fff4d6', dark: '#141414' } },
    { id: 'bento', name: 'Bento Grid', icon: '🍱', desc: 'Neat tiles of different sizes, like a bento box', modes: LD, bar: { dark: '#0e0f13', light: '#eef0f4' } },
    { id: 'skeuo', name: 'Skeuomorphism', icon: '📒', desc: 'Real-world textures: paper, leather, glossy buttons', modes: DL, bar: { light: '#d9cdb8', dark: '#2b211a' } },
    { id: 'aurora', name: 'Aurora UI', icon: '🌌', desc: 'Slow-moving northern-lights colours behind everything', modes: LD, bar: { dark: '#070b1a', light: '#eef3ff' } },
    { id: 'retro', name: 'Retro Windows / Mac OS', icon: '🪟', desc: 'Classic window title bars and chunky 3D buttons', modes: [{ id: 'win', label: '🪟 Windows' }, { id: 'mac', label: '🍎 Mac OS' }], bar: { win: '#008080', mac: '#cfcfcf' } },
    { id: 'iso', name: 'Isometric UI', icon: '🧊', desc: '3D blocks that pop out of an isometric grid', modes: DL, bar: { light: '#eef2f7', dark: '#151a26' } },
    { id: 'kinetic', name: 'Typographic / Kinetic', icon: '🔤', desc: 'Big bold type that moves (gently)', modes: LD, bar: { dark: '#0a0a0a', light: '#f5f3ee' } },
  ];
  var KEY = 'vrbot.theme';
  var byId = {};
  THEMES.forEach(function (t) { byId[t.id] = t; });

  function store() { try { return root.localStorage || null; } catch (e) { return null; } }
  /** { theme, modes: { <themeId>: 'auto' | <modeId> } } */
  function read() {
    var s = store(), v = null;
    try { v = JSON.parse((s && s.getItem(KEY)) || 'null'); } catch (e) { v = null; }
    if (!v || typeof v !== 'object') v = {};
    return { theme: byId[v.theme] ? v.theme : 'classic', modes: v.modes && typeof v.modes === 'object' ? v.modes : {} };
  }
  function write(v) { var s = store(); try { if (s) s.setItem(KEY, JSON.stringify(v)); } catch (e) { /* private mode */ } }
  /** Light + dark both available → the phone's setting can decide ("auto"). */
  function hasAuto(t) { var ids = t.modes.map(function (m) { return m.id; }); return ids.indexOf('light') >= 0 && ids.indexOf('dark') >= 0; }
  function prefersDark() { try { return !!(root.matchMedia && root.matchMedia('(prefers-color-scheme: dark)').matches); } catch (e) { return false; } }
  /** The mode to show for a theme: what you picked, "auto" = the phone's light/dark setting, else the theme's default. */
  function resolve(themeId, choice, dark) {
    var t = byId[themeId] || byId.classic;
    if (choice === 'auto' && hasAuto(t)) return (dark === undefined ? prefersDark() : dark) ? 'dark' : 'light';
    for (var i = 0; i < t.modes.length; i++) if (t.modes[i].id === choice) return choice;
    return t.modes[0].id;
  }
  function current() { var v = read(); var choice = v.modes[v.theme] || ''; return { theme: v.theme, choice: choice || byId[v.theme].modes[0].id, mode: resolve(v.theme, choice) }; }
  function apply() {
    var doc = root.document;
    if (!doc || !doc.documentElement) return current();
    var c = current();
    doc.documentElement.setAttribute('data-theme', c.theme);
    doc.documentElement.setAttribute('data-mode', c.mode);
    var meta = doc.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', byId[c.theme].bar[c.mode] || '#07080d');
    return c;
  }
  /** set({ theme }) and/or set({ mode: 'auto' | <modeId> }) — saves and applies at once. */
  function set(o) {
    var v = read();
    if (o && o.theme && byId[o.theme]) v.theme = o.theme;
    if (o && o.mode) v.modes[v.theme] = o.mode;
    write(v);
    return apply();
  }
  var api = { THEMES: THEMES, byId: byId, KEY: KEY, read: read, resolve: resolve, hasAuto: hasAuto, current: current, apply: apply, set: set };
  root.VRTheme = api;
  apply();
  // "Auto": follow the phone when it switches between light and dark
  try {
    var mq = root.matchMedia && root.matchMedia('(prefers-color-scheme: dark)');
    if (mq && mq.addEventListener) mq.addEventListener('change', function () { apply(); });
  } catch (e) { /* old browser */ }
})(typeof window !== 'undefined' ? window : globalThis);
