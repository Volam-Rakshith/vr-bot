// VR DEVELOPMENTS projects in VR Bot mode: the catalog, "show VR's projects", "tell me about RepoDNA", "more",
// topic promo ("btw VR built GeoWeather3D for this → link", once per chat per project per day), !projects / !project,
// no promo in normal "as VR" replies or unaddressed group chat, everything without the Groq key. © VR DEVELOPMENTS
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_PROJECTS, DEFAULT_BRAND, projectsOf, cleanProjects, renderProjectList, renderProject, projectsFacts, topicMatches,
  findProject, projectIntent, promoLine, projectsCommand, hasTag, norm, MORE_RE,
} from '../panel/shared/projects.js';
import { botIntent, buildBotMessages, botCfg, botHelpLines } from '../panel/shared/botmode.js';
import { withDefaults, DEFAULT_SETTINGS } from '../panel/shared/defaults.js';
import { helpText } from '../src/features/commands.js';

process.env.OWNER_NUMBER = '919999999999';
process.env.GROQ_API_KEY = '';
const { env } = await import('../src/env.js');
const { answerBot } = await import('../src/features/botmode.js');
const { Incoming } = await import('../src/incoming.js');

const ME = '919999999999';
const G1 = '120363000000000001@g.us';
const S0 = withDefaults({ version: 2 });
const P = projectsOf(S0);
const names = (list) => list.map((p) => p.name);

let calls = [];
let routes = [];
const route = (re, fn) => routes.push([re, fn]);
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  calls.push({ url: u, body: opts.body && typeof opts.body === 'string' ? JSON.parse(opts.body) : null });
  for (const [re, fn] of routes) if (re.test(u)) return fn(u, opts);
  throw new Error(`no mock for ${u}`);
};
const groqAnswer = (content) => json({ choices: [{ message: { content } }] });
beforeEach(() => { calls = []; routes = []; env.groqKey = ''; });

/* ---------------- catalog ---------------- */
test('projects: the 15 VR DEVELOPMENTS defaults, exact links, editable in settings, PDF Tools has no link (coming soon)', () => {
  assert.equal(DEFAULT_PROJECTS.length, 15);
  assert.deepEqual(names(P), ['ECHO', 'VR KRYPTA', 'Terminal Arcade', 'RepoDNA', 'RepoTimeMachine', 'README Doctor', 'GeoWeather3D', 'PromptCraft', 'Groq AI Chatbot', 'RecipeAI', 'Coding Insight', 'House Price Predictor (India)', 'VR Flash Cardzz', 'VR PDF Tools', 'VR Portfolio']);
  const link = (n) => P.find((p) => p.name === n).link;
  assert.equal(link('RepoTimeMachine'), 'https://volam-rakshith.github.io/RewindRepo');
  assert.equal(link('Coding Insight'), 'https://github.com/Volam-Rakshith/Coding-insight-Apk');
  assert.equal(link('README Doctor'), 'https://volam-rakshith.github.io/ReadME.Doctor');
  assert.equal(link('VR PDF Tools'), '');
  for (const p of P) { assert.ok(p.tagline, p.name); if (p.link) assert.match(p.link, /^https:\/\/(volam-rakshith\.github\.io|github\.com\/Volam-Rakshith)\//, p.name); }
  assert.deepEqual(DEFAULT_SETTINGS.brand, DEFAULT_BRAND);
  assert.equal(DEFAULT_SETTINGS.botMode.promo, true);
  assert.equal(botCfg(S0).promoEveryDays, 1);
  assert.equal(DEFAULT_SETTINGS.commands.enabled.projects, true);
  // edited in the panel: saved list wins (order, removals, a new one); junk rows dropped
  const S = withDefaults({ projects: [{ name: 'New App', tagline: 'Fresh', link: 'https://x.dev/app', tags: 'Weather, x' }, { name: '' }, { name: 'Bad link', link: 'javascript:alert(1)' }] });
  assert.deepEqual(projectsOf(S), [{ name: 'New App', tagline: 'Fresh', link: 'https://x.dev/app', tags: ['weather'] }, { name: 'Bad link', tagline: '', link: '', tags: [] }]);
  assert.deepEqual(cleanProjects(null), []);
});

test('projects: list = top 5 (name + one line + link) + "more for all 15"; full list has every link; one project card', () => {
  const top = renderProjectList(S0, { limit: 5 });
  assert.match(top, /^🚀 \*VR DEVELOPMENTS\* — Rakshith's projects \(top 5 of 15\)/);
  assert.match(top, /\*1\. ECHO\* — Every website\. Decoded\. One URL, an entire digital universe\.\nhttps:\/\/volam-rakshith\.github\.io\/ECHO-A-WEBSITE/);
  assert.match(top, /\*5\. RepoTimeMachine\*/);
  assert.ok(!top.includes('README Doctor'));
  assert.match(top, /Say \*more\* for all 15 👀$/);
  const all = renderProjectList(S0, { limit: 0 });
  for (const p of P) { assert.ok(all.includes(p.name), p.name); if (p.link) assert.ok(all.includes(p.link), p.link); }
  assert.match(all, /\*14\. VR PDF Tools\* — Bulk PDF toolkit: merge, split, bulk rename, watermark\.\n🔜 coming soon/);
  assert.match(all, /🌐 https:\/\/vrdevelopments\.sites\.tab\.bot\n💻 https:\/\/github\.com\/Volam-Rakshith$/);
  const card = renderProject(S0, P[3]);
  assert.match(card, /^🚀 \*RepoDNA\* — by VR DEVELOPMENTS\nDecode the DNA of any repository\. 8 lenses, local-first, no login, PNG\/SVG export\.\n👉 https:\/\/volam-rakshith\.github\.io\/RepoDNA/);
});

test('projects: the catalog is the bot-mode system prompt\'s ONLY project facts; persona says "VR Bot by VR DEVELOPMENTS"', () => {
  const sys = buildBotMessages(botCfg(S0), S0, [], 'hi', { aboutMe: S0.ai.aboutMe })[0].content;
  assert.match(sys, /^You are VR Bot 🤖 by VR DEVELOPMENTS, Rakshith's WhatsApp assistant bot/);
  assert.match(sys, /VR DEVELOPMENTS projects built by Rakshith \(the ONLY projects you know; never invent other projects/);
  assert.match(sys, /- GeoWeather3D: Live weather on an interactive 3D globe\. Weather, air quality, discover places\. Link: https:\/\/volam-rakshith\.github\.io\/GeoWeather3D/);
  assert.match(sys, /- VR PDF Tools: .*\(coming soon, no link yet\)/);
  assert.match(sys, /Company site: https:\/\/vrdevelopments\.sites\.tab\.bot · GitHub: https:\/\/github\.com\/Volam-Rakshith/);
  assert.equal(projectsFacts(withDefaults({ projects: [] })), '');
});

/* ---------------- matching ---------------- */
test('projects: topic matching — each topic → its project; no false positives ("whether", plain chat, pin code, cookies, repo rate)', () => {
  const top = (q) => topicMatches(q, P)[0]?.name || null;
  const yes = {
    "what's the weather in hyderabad": 'GeoWeather3D', 'will it rain tomorrow': 'GeoWeather3D', 'aqi in delhi today': 'GeoWeather3D',
    'i have an error in my python code': 'Coding Insight', 'help me debug this': 'Coding Insight', 'what is a syntax error': 'Coding Insight',
    'make flashcards for biology': 'VR Flash Cardzz', 'tips for my exam tomorrow': 'VR Flash Cardzz', 'how to study better': 'VR Flash Cardzz',
    'give me a biryani recipe': 'RecipeAI', 'what should i cook tonight': 'RecipeAI', 'easy recipes for beginners': 'RecipeAI',
    'write a prompt for an image': 'PromptCraft', 'how to write good chatgpt prompts': 'PromptCraft',
    'analyze my github repo': 'RepoDNA', 'commit history of my repo': 'RepoTimeMachine', 'how to write a good readme for my github repo': 'README Doctor',
    'what is the tech stack of amazon': 'ECHO', 'website analysis tools': 'ECHO',
    'what is base64 encoding': 'VR KRYPTA', 'decode this cipher': 'VR KRYPTA', 'morse code for sos': 'VR KRYPTA',
    'im bored': 'Terminal Arcade', 'suggest a game to play': 'Terminal Arcade',
    'house price in gachibowli': 'House Price Predictor (India)', 'is real estate a good investment': 'House Price Predictor (India)',
  };
  for (const [q, want] of Object.entries(yes)) assert.equal(top(q), want, q);
  const no = ['whether you like it or not', 'tell me a joke', 'explain photosynthesis', 'tell me a story about a king', 'who won the game yesterday',
    'what is the pin code of hyderabad', 'explain food chain', 'explain cookies in browser', 'what is the repo rate today', 'how vr works', 'what is an echo',
    'hi', 'good morning', 'who is your boss', 'explain recursion', 'what is a black hole', 'merge two pdfs'];
  for (const q of no) assert.equal(top(q), null, q);
  assert.equal(hasTag(norm('Weather?'), 'weather'), true);
  assert.equal(hasTag(norm('weathers'), 'weather'), true);
  assert.equal(hasTag(norm('recipes'), 'recipe*'), true);
  assert.equal(hasTag(norm('cookies'), 'cook'), false);
});

test('projects: intents — "show VR\'s projects", "what has VR built", "your boss\'s work", "tell me about RepoDNA", "more"', () => {
  const t = (q, ctx = {}) => botIntent(q, { projects: P, ...ctx });
  for (const q of ["show VR's projects", 'show me vr projects', 'what has VR built', "your boss's work", "ur boss's projects", 'his projects', 'what all has vr made', 'projects', 'list all projects', 'apps made by your boss'])
    assert.equal(t(q).type, 'projects', q);
  assert.equal(t("show VR's projects").all, false);
  assert.equal(t('send all 15 projects').all, true);
  assert.deepEqual([t('tell me about RepoDNA').type, t('tell me about RepoDNA').project.name, t('tell me about RepoDNA').simple], ['project', 'RepoDNA', true]);
  assert.equal(t('what is krypta').project.name, 'VR KRYPTA');
  assert.equal(t('is repo dna free?').project.name, 'RepoDNA');
  assert.equal(t('link for geoweather').project.name, 'GeoWeather3D');
  assert.equal(t('tell me about ECHO').project.name, 'ECHO', 'ECHO in capitals = the project');
  assert.equal(t("vr's echo app").project.name, 'ECHO');
  assert.equal(t('what is an echo').type, 'chat', 'the word echo alone is physics, not the project');
  assert.equal(t('how does RepoDNA compare with other repo tools for big monorepos').simple, false);
  // "more" only right after the top-5 list
  assert.deepEqual(t('more', { moreProjects: true }), { type: 'projects', all: true });
  assert.equal(t('more').type, 'chat');
  assert.ok(MORE_RE.test('more pls') && MORE_RE.test('all 15') && !MORE_RE.test('more about black holes'));
  // still the old intents
  assert.equal(t('draw the RepoDNA logo').type, 'draw');
  assert.equal(t('show me a pic of Charminar').type, 'pic');
  assert.equal(t('where is he').type, 'personal');
  assert.equal(t("what's the weather in hyderabad").type, 'web');
});

test('projects: promo line — once per chat per project per day (configurable), skips links the answer already has', () => {
  const mem = {};
  const q = "what's the weather in hyderabad";
  assert.equal(promoLine(mem, S0, { question: q, chat: 'A', day: '2026-10-31' }), '💡 btw VR built *GeoWeather3D* for this → https://volam-rakshith.github.io/GeoWeather3D');
  assert.equal(promoLine(mem, S0, { question: 'will it rain later', chat: 'A', day: '2026-10-31' }), '', 'same chat, same project, same day');
  assert.match(promoLine(mem, S0, { question: q, chat: 'B', day: '2026-10-31' }), /GeoWeather3D/, 'another chat');
  assert.match(promoLine(mem, S0, { question: 'base64 decode this', chat: 'A', day: '2026-10-31' }), /VR KRYPTA/, 'another project same chat');
  assert.match(promoLine(mem, S0, { question: q, chat: 'A', day: '2026-11-01' }), /GeoWeather3D/, 'next day');
  assert.equal(promoLine(mem, S0, { question: q, chat: 'C', day: '2026-11-01', answer: 'see https://volam-rakshith.github.io/GeoWeather3D' }), '', 'already linked');
  const m2 = {};
  assert.ok(promoLine(m2, S0, { question: q, chat: 'A', day: '2026-11-01', everyDays: 3 }));
  assert.equal(promoLine(m2, S0, { question: q, chat: 'A', day: '2026-11-03', everyDays: 3 }), '');
  assert.ok(promoLine(m2, S0, { question: q, chat: 'A', day: '2026-11-04', everyDays: 3 }));
  assert.equal(promoLine({}, S0, { question: 'tell me a joke', chat: 'A', day: '2026-11-01' }), '');
  // repo question already promoted RepoDNA today → the next matching repo project
  const m3 = {};
  assert.match(promoLine(m3, S0, { question: 'analyze my github repo', chat: 'A', day: '2026-11-01' }), /RepoDNA/);
  assert.match(promoLine(m3, S0, { question: 'analyze my github repo', chat: 'A', day: '2026-11-01' }), /RepoTimeMachine/);
});

/* ---------------- answers without the key ---------------- */
test('projects: no Groq key → list, "more", project card all work (no AI needed, no "add the key" nag)', async () => {
  const cfg = botCfg(S0);
  const ans = (q, ctx = {}) => answerBot({ S: S0, cfg, intent: botIntent(q, { projects: P, ...ctx }), question: q });
  const l = await ans("show VR's projects");
  assert.match(l.out[0].text, /top 5 of 15/); assert.equal(l.projectsList, true); assert.ok(!l.noKey);
  const all = await ans('more', { moreProjects: true });
  assert.match(all.out[0].text, /\(15\)/); assert.ok(!all.projectsList);
  const one = await ans('tell me about RepoDNA');
  assert.match(one.out[0].text, /^🚀 \*RepoDNA\*/); assert.ok(!one.noKey);
  const deep = await ans('how does RepoDNA compare with other repo tools for big monorepos');
  assert.match(deep.out[0].text, /^🚀 \*RepoDNA\*/, 'no key → the card, not an error');
  const g = await answerBot({ S: S0, cfg, intent: botIntent("show VR's projects", { projects: P }), question: '', isGroup: true });
  assert.match(g.out[0].text, /Say "vr bot more" for all of them/);
  const hi = await ans('');
  assert.match(hi.out[0].text, /I'm \*VR Bot\* by VR DEVELOPMENTS/);
  assert.equal(calls.length, 0, 'no network at all');
});

test('projects: with the key, a detailed project question goes to the AI (catalog facts) and keeps the exact link', async () => {
  env.groqKey = 'gsk_test';
  route(/api\.groq\.com/, () => groqAnswer('RepoDNA reads a repo through 8 lenses, all in your browser.'));
  const r = await answerBot({ S: S0, cfg: botCfg(S0), intent: botIntent('how does RepoDNA compare with other repo tools', { projects: P }), question: 'how does RepoDNA compare with other repo tools' });
  assert.equal(r.out[0].text, '🤖 RepoDNA reads a repo through 8 lenses, all in your browser.\n👉 https://volam-rakshith.github.io/RepoDNA');
  const sys = calls[0].body.messages[0].content;
  assert.match(sys, /asks about Rakshith's project "RepoDNA"\. Use ONLY its line/);
});

/* ---------------- the bot (Incoming) ---------------- */
const HDR = /^🤖 \*VR Bot\* is sending:\n/;
function harness({ settings = {}, contacts = [] } = {}) {
  const sent = [];
  const wa = { me: () => ME, isMe: (j) => String(j || '').startsWith(ME), pnFor: async (jid, alt) => String(alt || jid || '').split('@')[0].split(':')[0], sock: { user: { id: `${ME}@s.whatsapp.net` } } };
  const state = { memory: { processed: [], sentIds: [], lastOut: {}, lastIn: {}, cooldowns: {}, aiCount: {}, ai: {}, awaySent: {}, warns: {} }, status: { inbox: {}, groups: [{ id: G1, name: 'AIML' }] } };
  const data = { settings: withDefaults({ version: 2, ...settings }), rules: [], contacts, groupsCfg: {} };
  const inc = new Incoming({ wa, getData: () => data, state, send: async (jid, content, opts) => { sent.push({ jid, text: content.text ? content.text.replace(HDR, '') : undefined, content, opts }); return { key: { id: 'S' + sent.length } }; }, media: null });
  return { inc, sent, state, data };
}
let n = 0;
const ts = () => Math.floor(Date.now() / 1000) - 5;
const dm = (num, text) => ({ key: { remoteJid: `${num}@s.whatsapp.net`, id: 'P' + ++n, fromMe: false }, messageTimestamp: ts(), pushName: 'Friend', message: { conversation: text } });
const gm = (group, num, text) => ({ key: { remoteJid: group, participant: `${num}@s.whatsapp.net`, id: 'P' + ++n, fromMe: false }, messageTimestamp: ts(), message: { conversation: text } });
const run = async (h, ...messages) => { h.inc.push({ messages }); await h.inc.drain(); };
const contacts = [{ id: 'c1', name: 'Ravi Kumar', number: '+91 90000 00002' }, { id: 'c2', name: 'Vijay', number: '+91 90000 00003' }];
const RAVI = '919000000002', VIJAY = '919000000003', STRANGER = '919111111111';
const ON = { features: { botMode: true } };
const to = (h, jid) => h.sent.filter((s) => s.jid === jid).map((s) => s.text);
const dmJid = (num) => `${num}@s.whatsapp.net`;
const PROMO = /💡 btw VR built \*GeoWeather3D\* for this → https:\/\/volam-rakshith\.github\.io\/GeoWeather3D/;
const noCooldown = (h) => { if (h.state.memory.botMode) h.state.memory.botMode.last = {}; };

test('projects bot: "vr bot show me VR\'s projects" → top 5; plain "more" → all 15; "vr bot tell me about RepoDNA" → the card (no key)', async () => {
  const h = harness({ contacts, settings: ON });
  await run(h, dm(RAVI, "vr bot show me VR's projects"));
  const [list] = to(h, dmJid(RAVI));
  assert.match(list, /top 5 of 15/); assert.match(list, /Say \*more\* for all 15/);
  assert.equal(h.sent[0].opts.kind, 'bot');
  assert.equal(h.sent.filter((s) => s.jid === dmJid(ME)).length, 0, 'no "add the Groq key" nag for the deterministic list');
  await run(h, dm(RAVI, 'more'));
  const all = to(h, dmJid(RAVI))[1];
  assert.match(all, /\(15\)/); assert.match(all, /VR Portfolio/);
  await run(h, dm(RAVI, 'more'));
  assert.equal(to(h, dmJid(RAVI)).length, 2, 'a second "more" is just a normal message again');
  noCooldown(h);
  await run(h, dm(RAVI, 'vr bot tell me about RepoDNA'));
  assert.match(to(h, dmJid(RAVI))[2], /^🚀 \*RepoDNA\* — by VR DEVELOPMENTS/);
  // "more" in another chat that never got the list → not for the bot
  await run(h, dm(VIJAY, 'more'));
  assert.equal(to(h, dmJid(VIJAY)).length, 0);
});

test('projects bot: matching question → answer first, then ONE promo line; not again in that chat today; promo switch off → none', async () => {
  env.groqKey = 'gsk_test';
  route(/api\.groq\.com/, () => groqAnswer('Hyderabad: 29°C, cloudy, light rain later.'));
  const h = harness({ contacts, settings: ON });
  await run(h, dm(RAVI, "vr bot what's the weather in hyderabad"));
  const [a] = to(h, dmJid(RAVI));
  assert.match(a, /^🤖 Hyderabad: 29°C, cloudy, light rain later\./);
  assert.match(a, PROMO);
  assert.ok(a.indexOf('Hyderabad') < a.indexOf('btw'), 'answer first');
  assert.equal(a.match(/btw/g).length, 1);
  assert.equal(h.sent.length, 1, 'same bubble, no extra message');
  noCooldown(h);
  await run(h, dm(RAVI, 'vr bot will it rain tomorrow in hyderabad'));
  assert.doesNotMatch(to(h, dmJid(RAVI))[1], /btw/, 'once per chat per project per day');
  await run(h, dm(VIJAY, 'vr bot weather in warangal today?'));
  assert.match(to(h, dmJid(VIJAY))[0], PROMO, 'another chat gets it');
  noCooldown(h);
  await run(h, dm(VIJAY, 'vr bot tell me a joke'));
  assert.doesNotMatch(to(h, dmJid(VIJAY))[1], /btw/, 'plain chat → no promo');
  const off = harness({ contacts, settings: { ...ON, botMode: { promo: false } } });
  await run(off, dm(RAVI, "vr bot what's the weather in hyderabad"));
  assert.doesNotMatch(to(off, dmJid(RAVI))[0], /btw/);
});

test('projects bot: promo also on the no-key fallback; never in normal "as VR" AI replies; groups only when the bot is addressed', async () => {
  // no key: Wikipedia fallback answer + promo
  route(/w\/api\.php\?action=query&list=search/, () => json({ query: { search: [{ title: 'Biryani' }] } }));
  route(/rest_v1\/page\/summary\/Biryani/, () => json({ title: 'Biryani', extract: 'Biryani is a mixed rice dish.', content_urls: { mobile: { page: 'https://en.m.wikipedia.org/wiki/Biryani' } } }));
  const h = harness({ contacts, settings: ON });
  await run(h, dm(RAVI, 'vr bot explain biryani recipe'));
  assert.match(to(h, dmJid(RAVI))[0], /💡 btw VR built \*RecipeAI\* for this → https:\/\/volam-rakshith\.github\.io\/Recipe-AI$/);
  // normal AI reply "as VR" (no trigger) → never a promo
  env.groqKey = 'gsk_test'; routes = [];
  route(/api\.groq\.com/, () => groqAnswer('ya bro raining here too 🌧️'));
  const ai = harness({ contacts, settings: { ...ON, features: { botMode: true, ai: true }, ai: { who: 'everyone' } } });
  await run(ai, dm(RAVI, 'is it raining there? weather is crazy'));
  const r = to(ai, dmJid(RAVI));
  assert.equal(r.length, 1, 'the "as VR" AI answered');
  assert.doesNotMatch(r[0], /btw|GeoWeather3D|🤖/);
  // group: normal chat about weather → nothing; addressed → answer + promo
  routes = []; route(/api\.groq\.com/, () => groqAnswer('Sunny, 31°C.'));
  const g = harness({ contacts, settings: ON });
  await run(g, gm(G1, RAVI, 'weather is so hot today'), gm(G1, VIJAY, 'anyone know a biryani recipe'));
  assert.equal(g.sent.length, 0, 'unaddressed group chat → silent');
  await run(g, gm(G1, RAVI, 'vr bot weather in hyderabad today'));
  assert.match(to(g, G1)[0], PROMO);
});

test('projects bot: !projects / !project <name> for friends (works when VR Bot answers them), off switch, in !help', async () => {
  const h = harness({ contacts, settings: ON }); // commands scope = only me (default), VR Bot = everyone
  await run(h, dm(STRANGER, '!projects'));
  const [all] = to(h, dmJid(STRANGER));
  assert.match(all, /🚀 \*VR DEVELOPMENTS\* — Rakshith's projects \(15\)/);
  for (const p of P) if (p.link) assert.ok(all.includes(p.link));
  await run(h, dm(STRANGER, '!project krypta'));
  assert.match(to(h, dmJid(STRANGER))[1], /^🚀 \*VR KRYPTA\*/);
  await run(h, dm(STRANGER, '!project terminal arcade'));
  assert.match(to(h, dmJid(STRANGER))[2], /^🚀 \*Terminal Arcade\*/);
  await run(h, dm(STRANGER, '!project nothing-like-this'));
  assert.match(to(h, dmJid(STRANGER))[3], /No project called "nothing-like-this"\. Send !projects/);
  // VR Bot off + commands only for me → friends get nothing; turned off → nothing
  const off = harness({ contacts });
  await run(off, dm(STRANGER, '!projects'));
  assert.equal(off.sent.length, 0);
  const dis = harness({ contacts, settings: { ...ON, commands: { enabled: { projects: false } } } });
  await run(dis, dm(STRANGER, '!projects'));
  assert.equal(dis.sent.length, 0);
  assert.equal(projectsCommand(S0, 'echo').split('\n')[0], '🚀 *ECHO* — by VR DEVELOPMENTS', '!project accepts plain names');
  // !help
  const help = helpText(withDefaults({ features: { botMode: true } }), false);
  assert.match(help, /!projects — VR's projects \(VR DEVELOPMENTS\) · !project <name>/);
  assert.match(help, /vr bot show VR's projects · vr bot tell me about RepoDNA/);
  assert.match(help, /— VR Bot by VR DEVELOPMENTS$/);
  assert.ok(botHelpLines(withDefaults({ features: { botMode: true } })).some((l) => /by VR DEVELOPMENTS/.test(l)));
  assert.equal(findProject('house price predictor', P).name, 'House Price Predictor (India)');
  assert.equal(projectIntent('', P), null);
});
