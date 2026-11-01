// VR Bot mode: friends chat with the bot itself ("hey vr bot …"). Triggers, persona, About-you-only facts,
// links, web search, pictures, AI drawings, photos, caps, no-key fallback, scope/exclude, groups, busy.
// All network calls are mocked (globalThis.fetch). © VR DEVELOPMENTS
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  detectTrigger, botIntent, extractUrls, isPrivateHost, youtubeId, htmlToText, botSystemPrompt, buildBotMessages, tidyReply,
  botAllowed, botCount, botCfg, botScope, unsafeImagePrompt, personalAsk, bossAsk, publicFacts, topicOf, sourcesLine, botHelpLines, BOT_DEFAULTS,
} from '../panel/shared/botmode.js';
import { withDefaults, DEFAULT_SETTINGS } from '../panel/shared/defaults.js';
import { helpText } from '../src/features/commands.js';
import { notifyCategory } from '../panel/shared/notify.js';

process.env.OWNER_NUMBER = '919999999999';
process.env.GROQ_API_KEY = '';
const { env } = await import('../src/env.js');
const { answerBot, fetchPage, toolSources, drawUrl } = await import('../src/features/botmode.js');
const { Incoming } = await import('../src/incoming.js');

const ME = '919999999999';
const G1 = '120363000000000001@g.us';
const ABOUT = 'Name: Volam Rakshith (friends call me VR). I run VR DEVELOPMENTS. Website: https://vrdevelopments.sites.tab.bot. Phone +91 98480 12345\nMy real names: Rakshith, VR. Friends tease me with fake names: Rudra.';

/* ---------------- fetch mock ---------------- */
let calls = [];
let routes = [];
const route = (re, fn) => routes.push([re, fn]);
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
const html = (s, status = 200, headers = {}) => new Response(s, { status, headers: { 'content-type': 'text/html; charset=utf-8', ...headers } });
const jpeg = () => new Response(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]), { status: 200, headers: { 'content-type': 'image/jpeg' } });
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  calls.push({ url: u, opts, body: opts.body && typeof opts.body === 'string' ? JSON.parse(opts.body) : null });
  for (const [re, fn] of routes) if (re.test(u)) return fn(u, opts);
  throw new Error(`no mock for ${u}`);
};
const groqCalls = () => calls.filter((c) => c.url.includes('api.groq.com'));
const groqAnswer = (content, extra = {}) => json({ choices: [{ message: { content, ...extra } }] });
const { useLimitStore } = await import('../src/features/groqlimit.js');
beforeEach(() => { calls = []; routes = []; env.groqKey = ''; env.groqKeyBot = ''; useLimitStore(null); }); // fresh Groq-limit store per test

/* ---------------- triggers ---------------- */
test('botmode: triggers — "hey vr bot", "@vrbot", "vr bot ra", "bot,", trailing "… vr bot?"; never "robot"/"botany"/"bot is"', () => {
  const q = (t, o) => detectTrigger(t, BOT_DEFAULTS.triggers, o);
  assert.deepEqual(q('hey vr bot can u explain this stuff'), { hit: true, question: 'can u explain this stuff', trigger: 'vr bot' });
  assert.equal(q('Vr Bot ra tell a story').question, 'tell a story');
  assert.equal(q('VR BOT anna explain about ur boss').question, 'explain about ur boss');
  assert.equal(q('@vrbot who made you').question, 'who made you');
  assert.equal(q('vr-bot: explain recursion').question, 'explain recursion');
  assert.equal(q('hi hello vr bot').question, '');
  assert.equal(q('bot, tell me a joke').question, 'tell me a joke');
  assert.equal(q('explain photosynthesis vr bot?').question, 'explain photosynthesis');
  assert.equal(q('ok vr bot, draw a cat').question, 'draw a cat');
  for (const no of ['robot dance', 'vr botany notes', 'bot is slow today', 'my vr bot setup is cool', 'I love robots', 'about the bot', '', 'botswana trip'])
    assert.equal(q(no).hit, false, no);
  // tagging you + "bot" in a group counts; a bare "bot" without the tag does not
  assert.equal(q('@919999999999 bot what is AI', { mentionedMe: true }).question, 'what is AI');
  assert.equal(q('@919999999999 bot what is AI', { mentionedMe: false }).hit, false);
  // custom trigger words from the panel
  assert.equal(detectTrigger('Jarvis explain DNA', ['jarvis']).question, 'explain DNA');
  assert.equal(detectTrigger('vr bot hi', ['jarvis']).hit, false, 'only the configured words');
  assert.deepEqual(botCfg({ botMode: { triggers: ['  VR Bot ', '', 'x', 'vr bot'] } }).triggers, ['vr bot'], 'cleaned, deduped, 1-letter dropped');
});

/* ---------------- intents ---------------- */
test('botmode: intents — draw, real pic, link, web, vision, personal, chat', () => {
  assert.deepEqual(botIntent('draw a dragon in space'), { type: 'draw', subject: 'dragon in space' });
  assert.equal(botIntent('generate an image of a cat on the moon').subject, 'cat on the moon');
  assert.equal(botIntent('create a logo for VR DEVELOPMENTS').subject, 'logo for VR DEVELOPMENTS');
  assert.equal(botIntent('make a story about cats').type, 'chat', '"make" needs an image word');
  assert.deepEqual(botIntent('show me a pic of taj mahal'), { type: 'pic', subject: 'taj mahal' });
  assert.equal(botIntent('send me a photo of a tiger pls').subject, 'tiger');
  assert.equal(botIntent('show me how to code').type, 'chat');
  const l = botIntent('summarise this https://example.com/post?id=1).');
  assert.equal(l.type, 'link'); assert.deepEqual(l.urls, ['https://example.com/post?id=1']);
  assert.equal(botIntent('what is this about', { quotedText: 'look www.example.org/x' }).type, 'link', 'link in the replied-to message');
  assert.equal(botIntent('latest news on ISRO').type, 'web');
  assert.equal(botIntent('who won the match yesterday').type, 'web');
  assert.equal(botIntent("what's this", { hasImage: true }).type, 'vision');
  assert.equal(botIntent('', { quotedImage: true }).question, 'What is in this picture?');
  assert.equal(botIntent('where is he right now').type, 'personal');
  assert.equal(botIntent('is vr free today?').type, 'personal');
  assert.equal(botIntent("what's his number").type, 'personal');
  assert.equal(botIntent('who is your boss').type, 'chat', 'boss questions → persona answer from About you');
  assert.equal(botIntent('explain recursion').type, 'chat');
  assert.equal(botIntent('').type, 'empty');
  assert.ok(personalAsk('when will rakshith reply') && !personalAsk('when will the exam be'));
  assert.ok(bossAsk('who made you?') && bossAsk('tell me about VR DEVELOPMENTS') && !bossAsk('tell me about black holes'));
  assert.equal(topicOf('can you explain about photosynthesis in simple words?'), 'photosynthesis');
  assert.equal(topicOf('what is a black hole'), 'black hole');
});

test('botmode: refuses sexual / violent image prompts', () => {
  assert.equal(unsafeImagePrompt('draw a naked woman'), 'sexual');
  assert.equal(unsafeImagePrompt('Rashmika in bikini'), 'sexual');
  assert.equal(unsafeImagePrompt('a gory beheading'), 'violent');
  assert.equal(unsafeImagePrompt('dragon in space'), '');
  assert.equal(unsafeImagePrompt('a tiger hunting'), '');
});

/* ---------------- persona ---------------- */
test('botmode: persona — assistant, never VR; About-you facts only; phone numbers hidden; WhatsApp format', () => {
  const p = botSystemPrompt({ botName: 'VR Bot', myName: 'Rakshith', aboutMe: ABOUT, maxLines: 12 });
  assert.match(p, /You are VR Bot 🤖 by VR DEVELOPMENTS, Rakshith's WhatsApp assistant bot\. You are NOT Rakshith/);
  assert.match(p, /never pretend to be him/);
  assert.match(p, /VR DEVELOPMENTS/);
  assert.match(p, /ONLY things you know about him/);
  assert.match(p, /never invent/);
  assert.match(p, /Never share or guess his phone number, location/);
  assert.match(p, /he'll reply himself/);
  assert.match(p, /at most 12 short lines/);
  assert.match(p, /no tables/);
  assert.ok(!p.includes('98480 12345'), 'phone number never reaches the AI');
  assert.match(p, /\[hidden\]/);
  const S = withDefaults({ ai: { aboutMe: ABOUT } });
  const m = buildBotMessages(botCfg(S), S, [{ role: 'them', text: 'hi' }, { role: 'bot', text: '🤖 hey!' }], 'tell a story', { aboutMe: ABOUT });
  assert.deepEqual(m.slice(1).map((x) => x.role), ['user', 'assistant', 'user']);
  assert.equal(m.at(-1).content, 'tell a story');
  assert.ok(!m[0].content.includes('You are Rakshith'), 'not the "as VR" persona');
  assert.equal(publicFacts(ABOUT).includes('Rudra'), false, 'only the first paragraph (no nickname notes)');
  assert.equal(publicFacts(ABOUT).includes('98480'), false);
});

test('botmode: tidyReply — no reasoning, no citation marks, no headings/tables, ≤ max lines', () => {
  assert.equal(tidyReply('<think>hmm</think>## Title\n**Bold** fact 【3†L1-L4】'), 'Title\n*Bold* fact');
  assert.equal(tidyReply('| a | b |\n|---|---|\n| 1 | 2 |'), 'a · b\n1 · 2');
  const long = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join('\n');
  const t = tidyReply(long, 12);
  assert.equal(t.split('\n').length, 12); assert.ok(t.endsWith('line 12 …'));
  assert.equal(sourcesLine(['https://a.com', 'https://a.com', 'https://b.com', 'https://c.com', 'https://d.com']).trim().split('\n').length, 4, '"Sources:" + 3 links max');
});

/* ---------------- links ---------------- */
test('botmode: URL extraction, private hosts blocked, YouTube ids, HTML → text', () => {
  assert.deepEqual(extractUrls('see https://a.com/x, and www.b.org/y!'), ['https://a.com/x', 'https://www.b.org/y']);
  assert.deepEqual(extractUrls('http://localhost:3000/admin http://192.168.1.5/ http://10.0.0.1 https://ok.com'), ['https://ok.com']);
  assert.ok(isPrivateHost('127.0.0.1') && isPrivateHost('172.20.1.1') && isPrivateHost('::1') && !isPrivateHost('example.com') && !isPrivateHost('172.32.0.1'));
  assert.equal(youtubeId('https://youtu.be/dQw4w9WgXcQ?t=3'), 'dQw4w9WgXcQ');
  assert.equal(youtubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=x'), 'dQw4w9WgXcQ');
  assert.equal(youtubeId('https://youtube.com/shorts/abcdefghijk'), 'abcdefghijk');
  assert.equal(youtubeId('https://example.com/watch?v=x'), null);
  const p = htmlToText('<html><head><title>Hi &amp; bye</title><meta name="description" content="A page"><script>evil()</script><style>.a{}</style></head><body><nav>menu</nav><h1>Big</h1><p>Text&nbsp;here</p></body></html>');
  assert.equal(p.title, 'Hi & bye'); assert.equal(p.description, 'A page');
  assert.equal(p.text, 'Big\nText here');
});

test('botmode: fetchPage follows redirects, never to a private address, caps size; YouTube via oEmbed', async () => {
  route(/^https:\/\/short\.ly\/a$/, () => new Response(null, { status: 301, headers: { location: 'https://real.example.com/post' } }));
  route(/^https:\/\/real\.example\.com\/post$/, () => html(`<title>Real post</title><p>${'word '.repeat(5000)}</p>`));
  const page = await fetchPage('https://short.ly/a');
  assert.equal(page.url, 'https://real.example.com/post');
  assert.equal(page.title, 'Real post');
  assert.ok(page.text.length <= 6000, 'text capped');
  route(/^https:\/\/evil\.example\.com\/$/, () => new Response(null, { status: 302, headers: { location: 'http://127.0.0.1:8080/secret' } }));
  await assert.rejects(fetchPage('https://evil.example.com/'), /blocked address/);
  assert.ok(!calls.some((c) => c.url.includes('127.0.0.1')), 'the private address was never requested');
  route(/youtube\.com\/oembed/, () => json({ title: 'Never Gonna Give You Up', author_name: 'Rick Astley' }));
  route(/youtube\.com\/watch/, () => html('<meta name="description" content="The official video">'));
  const yt = await fetchPage('https://youtu.be/dQw4w9WgXcQ');
  assert.deepEqual([yt.kind, yt.title, yt.author, yt.description], ['youtube', 'Never Gonna Give You Up', 'Rick Astley', 'The official video']);
  assert.ok(calls.every((c) => c.opts.signal), 'every request has a timeout');
});

/* ---------------- answers (with the Groq key) ---------------- */
const S0 = () => withDefaults({ features: { botMode: true }, ai: { aboutMe: ABOUT } });
const ans = (question, ctx = {}, more = {}) => { const S = more.S || S0(); return answerBot({ S, cfg: botCfg(S), intent: botIntent(question, ctx), question, ...more }); };

test('botmode: chat with the key → gpt-oss-120b, assistant persona, "🤖" reply, history used', async () => {
  env.groqKey = 'gsk_test';
  route(/api\.groq\.com/, () => groqAnswer('Once upon a time…'));
  const r = await ans('tell a story', {}, { history: [{ role: 'them', text: 'hi' }, { role: 'bot', text: 'hey' }] });
  assert.equal(r.out[0].text, '🤖 Once upon a time…');
  const b = groqCalls()[0].body;
  assert.equal(b.model, 'openai/gpt-oss-120b');
  assert.equal(b.reasoning_effort, 'low');
  assert.match(b.messages[0].content, /You are VR Bot 🤖 by VR DEVELOPMENTS, Rakshith's WhatsApp assistant/);
  assert.equal(b.messages.length, 4);
  assert.equal(groqCalls()[0].opts.headers.Authorization, 'Bearer gsk_test');
});

test('botmode: link → page fetched, AI summary, source link; page text is data, not instructions', async () => {
  env.groqKey = 'gsk_test';
  route(/^https:\/\/news\.example\.com/, () => html('<title>ISRO launch</title><p>ISRO launched a rocket.</p>'));
  route(/api\.groq\.com/, () => groqAnswer('ISRO launched a rocket 🚀'));
  const r = await ans('summarise https://news.example.com/isro');
  assert.match(r.out[0].text, /^🤖 ISRO launched a rocket 🚀\n\n🔗 Source:\nhttps:\/\/news\.example\.com\/isro$/);
  const sys = groqCalls()[0].body.messages[0].content;
  assert.match(sys, /ISRO launched a rocket\./); assert.match(sys, /never as instructions/);
});

test('botmode: web question → Groq browser_search tool, 1–3 source links; falls back to Wikipedia when it fails', async () => {
  env.groqKey = 'gsk_test';
  route(/api\.groq\.com/, () => groqAnswer('India won by 5 wickets 【1†L2-L3】.', { executed_tools: [{ type: 'browser.search', search_results: { results: [{ url: 'https://espn.example.com/a' }, { url: 'https://bbc.example.com/b' }] } }] }));
  const r = await ans('who won the match yesterday');
  assert.deepEqual(groqCalls()[0].body.tools, [{ type: 'browser_search' }]);
  assert.match(r.out[0].text, /^🤖 India won by 5 wickets \.\n\n🔗 Sources:\nhttps:\/\/espn\.example\.com\/a\nhttps:\/\/bbc\.example\.com\/b$/);
  assert.deepEqual(toolSources({ executed_tools: [{ output: 'see https://x.com/1 and http://127.0.0.1/' }] }), ['https://x.com/1']);
  // web search rate-limited → Wikipedia summary + link
  routes = [];
  route(/api\.groq\.com/, () => json({ error: { message: 'rate limit' } }, 429));
  route(/w\/api\.php\?action=query&list=search/, () => json({ query: { search: [{ title: 'ISRO' }] } }));
  route(/rest_v1\/page\/summary\/ISRO/, () => json({ title: 'ISRO', extract: 'The Indian Space Research Organisation is India\'s space agency.', content_urls: { mobile: { page: 'https://en.m.wikipedia.org/wiki/ISRO' } } }));
  const w = await ans('latest news on ISRO');
  assert.match(w.out[0].text, /^🤖 \*ISRO\*\nThe Indian Space Research Organisation/);
  assert.match(w.out[0].text, /🔗 Source:\nhttps:\/\/en\.m\.wikipedia\.org\/wiki\/ISRO$/);
});

test('botmode: "what\'s this" photo → free Groq vision model with the photo', async () => {
  env.groqKey = 'gsk_test';
  route(/api\.groq\.com/, () => groqAnswer('That is the Charminar in Hyderabad.'));
  const r = await ans("what's this", { hasImage: true }, { image: async () => Buffer.from('notreallyajpeg') });
  assert.equal(r.out[0].text, '🤖 That is the Charminar in Hyderabad.');
  const b = groqCalls()[0].body;
  assert.equal(b.model, 'qwen/qwen3.8-27b');
  const parts = b.messages[1].content;
  assert.equal(parts[0].text, "what's this");
  assert.match(parts[1].image_url.url, /^data:image\/jpeg;base64,/);
  assert.match(b.messages[0].content, /Never guess who a real person in a photo is/);
});

/* ---------------- pictures (no key needed) ---------------- */
test('botmode: "show me a pic of X" → real Wikipedia photo with caption + source (no key needed)', async () => {
  route(/list=search/, () => json({ query: { search: [{ title: 'Taj Mahal' }] } }));
  route(/prop=pageimages/, () => json({ query: { pages: { 1: { title: 'Taj Mahal', thumbnail: { source: 'https://upload.wikimedia.org/taj_1024.jpg' } } } } }));
  route(/upload\.wikimedia\.org/, jpeg);
  const r = await ans('show me a pic of taj mahal');
  assert.ok(Buffer.isBuffer(r.out[0].image)); assert.equal(r.out[0].mimetype, 'image/jpeg');
  assert.equal(r.out[0].caption, '📷 *Taj Mahal*\nSource: https://en.wikipedia.org/wiki/Taj_Mahal');
  assert.ok(calls.filter((c) => c.url.includes('wiki')).every((c) => /VR-Bot/.test(c.opts.headers['User-Agent'])), 'Wikimedia wants a User-Agent');
  assert.equal(groqCalls().length, 0);
});

test('botmode: "draw X" → free Pollinations image, captioned "AI-generated"; unsafe prompts refused without a request', async () => {
  route(/image\.pollinations\.ai/, jpeg);
  const r = await ans('draw a dragon in space');
  assert.equal(r.out[0].caption, '🎨 AI-generated: dragon in space');
  assert.match(calls[0].url, /^https:\/\/image\.pollinations\.ai\/prompt\/dragon%20in%20space\?.*safe=true/);
  assert.match(drawUrl('x', 5), /seed=5/);
  calls = [];
  const no = await ans('draw a naked girl');
  assert.match(no.out[0].text, /can't make that/);
  assert.equal(calls.length, 0);
  const off = await ans('draw a cat', {}, { S: withDefaults({ botMode: { allow: { draw: false } } }) });
  assert.match(off.out[0].text, /switched off/);
});

/* ---------------- without the Groq key ---------------- */
test('botmode: no Groq key → no crash; boss facts from About you, Wikipedia for "explain", short fallback for stories', async () => {
  const boss = await ans('who is your boss');
  assert.match(boss.out[0].text, /^🤖 I'm \*VR Bot\* by VR DEVELOPMENTS, Rakshith's assistant bot\.\nAbout my boss:\nName: Volam Rakshith/);
  assert.ok(!boss.out[0].text.includes('98480') && !boss.out[0].text.includes('Rudra'));
  assert.equal(boss.noKey, true);
  route(/list=search/, () => json({ query: { search: [{ title: 'Photosynthesis' }] } }));
  route(/summary\/Photosynthesis/, () => json({ title: 'Photosynthesis', extract: 'Plants make food from light.', content_urls: { mobile: { page: 'https://en.m.wikipedia.org/wiki/Photosynthesis' } } }));
  const ex = await ans('explain photosynthesis');
  assert.match(ex.out[0].text, /Plants make food from light\.\n\n🔗 Source:/);
  const story = await ans('tell a story');
  assert.match(story.out[0].text, /AI brain isn't switched on yet/);
  assert.match(story.out[0].text, /vr bot draw a dragon/);
  route(/news\.example/, () => html('<title>Big news</title><meta name="description" content="Something happened">'));
  const link = await ans('https://news.example.com/x');
  assert.match(link.out[0].text, /📄 \*Big news\*\nSomething happened/);
  const pers = await ans('where is he');
  assert.match(pers.out[0].text, /he'll reply to you personally/);
  assert.equal(groqCalls().length, 0, 'Groq never called without a key');
});

/* ---------------- caps ---------------- */
test('botmode: per-person daily cap, global cap, per-chat cooldown, new day resets', () => {
  const cfg = botCfg({ botMode: { perPersonPerDay: 2, globalPerDay: 3, cooldownSeconds: 10 } });
  const mem = {};
  const at = (person, chat, now, day = 'D1') => { const r = botAllowed(mem, cfg, { chat, person, day, now }); if (r.ok) botCount(mem, { chat, person, now }); return r; };
  assert.ok(at('A', 'cA', 0).ok);
  assert.equal(at('A', 'cA', 5000).reason, 'cooldown');
  assert.ok(at('A', 'cA', 11000).ok);
  const third = at('A', 'cA', 30000);
  assert.deepEqual([third.reason, third.first], ['person', true]);
  assert.equal(at('A', 'cA', 60000).first, false, 'told once');
  assert.ok(at('B', 'cB', 60000).ok);
  const g = at('C', 'cC', 90000);
  assert.deepEqual([g.reason, g.first], ['global', true]);
  assert.ok(at('A', 'cA', 100000, 'D2').ok, 'new day');
  assert.equal(JSON.stringify(mem).includes('hello'), false, 'counts only');
});

/* ---------------- the bot (Incoming) ---------------- */
const HDR = /^🤖 \*VR Bot\* is sending:\n/;
function harness({ settings = {}, rules = [], contacts = [] } = {}) {
  const sent = [];
  const wa = { me: () => ME, isMe: (j) => String(j || '').startsWith(ME), pnFor: async (jid, alt) => String(alt || jid || '').split('@')[0].split(':')[0], sock: { user: { id: `${ME}@s.whatsapp.net` } } };
  const state = { memory: { processed: [], sentIds: [], lastOut: {}, lastIn: {}, cooldowns: {}, aiCount: {}, ai: {}, awaySent: {}, warns: {} }, status: { inbox: {}, groups: [{ id: G1, name: 'AIML' }] } };
  const data = { settings: withDefaults({ version: 2, ai: { aboutMe: ABOUT }, ...settings }), rules, contacts, groupsCfg: {} };
  const inc = new Incoming({ wa, getData: () => data, state, send: async (jid, content, opts) => { sent.push({ jid, text: content.text ? content.text.replace(HDR, '') : undefined, content, opts }); return { key: { id: 'S' + sent.length } }; }, media: null });
  inc.download = async () => Buffer.from('photo');
  return { inc, sent, state, data };
}
let n = 0;
const ts = () => Math.floor(Date.now() / 1000) - 5;
const dm = (num, message) => ({ key: { remoteJid: `${num}@s.whatsapp.net`, id: 'B' + ++n, fromMe: false }, messageTimestamp: ts(), pushName: 'Friend', message: typeof message === 'string' ? { conversation: message } : message });
const gm = (group, num, message) => ({ key: { remoteJid: group, participant: `${num}@s.whatsapp.net`, id: 'B' + ++n, fromMe: false }, messageTimestamp: ts(), message: typeof message === 'string' ? { conversation: message } : message });
const mine = (text) => ({ key: { remoteJid: `${ME}@s.whatsapp.net`, id: 'B' + ++n, fromMe: true }, messageTimestamp: ts(), message: { conversation: text } });
const run = async (h, ...messages) => { h.inc.push({ messages }); await h.inc.drain(); };
const contacts = [{ id: 'c1', name: 'Ravi Kumar', number: '+91 90000 00002' }, { id: 'c2', name: 'Vijay', number: '+91 90000 00003' }];
const RAVI = '919000000002', VIJAY = '919000000003', STRANGER = '919111111111';
const ON = { features: { botMode: true } };
const toFriend = (h, num) => h.sent.filter((s) => s.jid === `${num}@s.whatsapp.net`);
const toMe = (h) => h.sent.filter((s) => s.jid === `${ME}@s.whatsapp.net`);

test('botmode bot: off by default; on → "vr bot …" answered (kind "bot"), normal messages untouched', async () => {
  assert.equal(DEFAULT_SETTINGS.features.botMode, false);
  const off = harness({ contacts });
  await run(off, dm(RAVI, 'vr bot where is he'));
  assert.equal(off.sent.length, 0);
  const rules = [{ id: 'r', pattern: 'hi', reply: 'Rule reply', where: 'both', cooldownMinutes: 0 }];
  const h = harness({ contacts, rules, settings: ON });
  await run(h, dm(RAVI, 'hey vr bot where is he'));
  assert.equal(toFriend(h, RAVI).length, 1);
  assert.match(toFriend(h, RAVI)[0].text, /^🤖 That's one for Rakshith himself/);
  assert.equal(toFriend(h, RAVI)[0].opts.kind, 'bot');
  assert.equal(toFriend(h, RAVI)[0].opts.cat, 'ai');
  assert.ok(toFriend(h, RAVI)[0].opts.quoted, 'quotes their question');
  assert.equal(notifyCategory({ kind: 'bot', cat: 'ai' }), 'ai');
  h.sent.length = 0;
  await run(h, dm(VIJAY, 'hi'));
  assert.deepEqual(h.sent.map((s) => s.text), ['Rule reply'], 'normal message → normal rules');
  h.sent.length = 0;
  await run(h, dm(VIJAY, 'vr bot hi'));
  assert.match(h.sent[0].text, /^🤖 Hi Vijay! I'm \*VR Bot\*/, 'the bot wins over the keyword rule for messages addressed to it');
});

test('botmode bot: no Groq key → friend gets a short fallback, owner gets ONE hint with the free-key steps', async () => {
  const h = harness({ contacts, settings: ON });
  await run(h, dm(RAVI, 'vr bot tell a story'));
  assert.match(toFriend(h, RAVI)[0].text, /AI brain isn't switched on yet/);
  const hint = toMe(h);
  assert.equal(hint.length, 1);
  assert.match(hint[0].text, /GROQ_API_KEY secret is missing/);
  assert.match(hint[0].text, /console\.groq\.com/);
  assert.match(hint[0].text, /Secrets and variables → Actions/);
  await new Promise((r) => setTimeout(r, 5));
  h.state.memory.botMode.last = {}; // skip the cooldown
  await run(h, dm(VIJAY, 'vr bot tell a joke'));
  assert.equal(toMe(h).length, 1, 'hint only once a day');
});

test('botmode bot: scope — "never reply" lists (bot + AI) and "only these" picks respected; strangers allowed only with Everyone', async () => {
  const h = harness({ contacts, settings: { ...ON, botMode: { exclude: ['c2'] } } });
  await run(h, dm(VIJAY, 'vr bot where is he'), dm(STRANGER, 'vr bot where is he'));
  assert.deepEqual(h.sent.map((s) => s.jid), [`${STRANGER}@s.whatsapp.net`], 'Vijay blocked, everyone else answered');
  const h2 = harness({ contacts, settings: { ...ON, ai: { aboutMe: ABOUT, exclude: ['c2'] } } });
  await run(h2, dm(VIJAY, 'vr bot where is he'));
  assert.equal(h2.sent.length, 0, 'AI "never reply" list counts too');
  const h3 = harness({ contacts, settings: { ...ON, botMode: { who: 'pick', contacts: ['c1'] } } });
  await run(h3, dm(RAVI, 'vr bot where is he'), dm(STRANGER, 'vr bot where is he'));
  assert.deepEqual(h3.sent.map((s) => s.jid), [`${RAVI}@s.whatsapp.net`]);
  assert.deepEqual(botScope(withDefaults({ botMode: { exclude: ['a'] }, ai: { exclude: ['b', 'a'] } })).exclude, ['a', 'b']);
});

test('botmode bot: groups — only when addressed ("vr bot …" or tag + "bot"), group scope respected', async () => {
  const h = harness({ contacts, settings: ON });
  await run(h, gm(G1, RAVI, 'the robot was cool'), gm(G1, RAVI, 'anyone free?'));
  assert.equal(h.sent.length, 0);
  await run(h, gm(G1, RAVI, 'vr bot where is he'));
  assert.equal(h.sent.length, 1); assert.equal(h.sent[0].jid, G1);
  const tagged = { extendedTextMessage: { text: `@${ME} bot where is he`, contextInfo: { mentionedJid: [`${ME}@s.whatsapp.net`] } } };
  h.state.memory.botMode.last = {};
  await run(h, gm(G1, VIJAY, tagged));
  assert.equal(h.sent.length, 2);
  const none = harness({ contacts, settings: { ...ON, botMode: { groups: 'none' } } });
  await run(none, gm(G1, RAVI, 'vr bot where is he'));
  assert.equal(none.sent.length, 0);
  const pick = harness({ contacts, settings: { ...ON, botMode: { groups: ['other@g.us'] } } });
  await run(pick, gm(G1, RAVI, 'vr bot where is he'));
  assert.equal(pick.sent.length, 0);
});

test('botmode bot: busy/class on → "vr bot …" still answered by the bot (inBusy), else the class reply', async () => {
  const busy = { busy: { who: 'pick', contacts: ['c1', 'c2'] }, class: { on: true, until: Date.now() + 3600000, setAt: Date.now() - 1000 } };
  const h = harness({ contacts, settings: { ...ON, ...busy } });
  await run(h, dm(RAVI, 'vr bot where is he'), dm(VIJAY, 'hello'));
  assert.match(toFriend(h, RAVI)[0].text, /^🤖/);
  assert.match(toFriend(h, VIJAY)[0].text, /^in class rn/);
  const h2 = harness({ contacts, settings: { ...ON, ...busy, botMode: { inBusy: false } } });
  await run(h2, dm(RAVI, 'vr bot where is he'));
  assert.match(toFriend(h2, RAVI)[0].text, /^in class rn/);
});

test('botmode bot: daily cap → one "that\'s all for today" + one owner notification, then quiet', async () => {
  const h = harness({ contacts, settings: { ...ON, botMode: { perPersonPerDay: 1, cooldownSeconds: 0 } } });
  await run(h, dm(RAVI, 'vr bot where is he'));
  await run(h, dm(RAVI, 'vr bot where is he now'));
  await run(h, dm(RAVI, 'vr bot where is he pls'));
  const f = toFriend(h, RAVI).map((s) => s.text);
  assert.equal(f.length, 2);
  assert.match(f[1], /That's all my answers for you today \(1\/day\)/);
  assert.equal(toMe(h).filter((s) => /used all 1 bot answers/.test(s.text)).length, 1);
});

test('botmode bot: photo with caption "vr bot what\'s this" → vision; pictures sent as images; owner can test in own chat', async () => {
  env.groqKey = 'gsk_test';
  route(/api\.groq\.com/, () => groqAnswer('A cute cat 🐱'));
  route(/image\.pollinations\.ai/, jpeg);
  const h = harness({ contacts, settings: ON });
  await run(h, dm(RAVI, { imageMessage: { caption: "vr bot what's this", mimetype: 'image/jpeg', fileLength: 2000 } }));
  assert.equal(toFriend(h, RAVI)[0].text, '🤖 A cute cat 🐱');
  assert.equal(groqCalls()[0].body.model, 'qwen/qwen3.8-27b');
  await run(h, mine('vr bot draw a cat'));
  const img = toMe(h).find((s) => s.content.image);
  assert.ok(img, 'image sent in your own chat');
  assert.equal(img.content.caption, '🎨 AI-generated: cat');
  assert.equal(img.opts.kind, 'bot');
  assert.deepEqual(h.state.memory.ai[`bot:${RAVI}@s.whatsapp.net`].map((x) => x.role), ['them', 'bot'], 'short memory per chat');
});

/* ---------------- !help ---------------- */
test('botmode: !help lists "vr bot …" lines only when on; reply-time line matches Always on', () => {
  const off = helpText(withDefaults({}), false);
  assert.ok(!off.includes('vr bot'));
  assert.match(off, /Replies usually come within a minute/);
  assert.ok(!off.includes('within ~30 min'));
  assert.match(helpText(withDefaults({ timing: { relay: false } }), false), /next check \(within ~30 min\)/);
  const on = helpText(withDefaults({ features: { botMode: true }, botMode: { allow: { draw: false } } }), false);
  assert.match(on, /Talk to VR Bot/);
  assert.match(on, /vr bot explain black holes/);
  assert.match(on, /vr bot show me a pic of Charminar/);
  assert.ok(!on.includes('draw a dragon'), 'switched-off abilities are not advertised');
  assert.deepEqual(botHelpLines(withDefaults({})), []);
});
