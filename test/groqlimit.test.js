// Groq free-plan limits: reset time parsing, the optional 2nd key for VR Bot mode, the once-per-chat
// "limit used up" notice, and silent "as VR" replies with ONE notification to you. © VR DEVELOPMENTS
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { withDefaults } from '../panel/shared/defaults.js';

process.env.OWNER_NUMBER = '919999999999';
process.env.GROQ_API_KEY = '';
process.env.GROQ_API_KEY_BOT = '';
const { env } = await import('../src/env.js');
const L = await import('../src/features/groqlimit.js');
const { groqChat } = await import('../src/features/botmode.js');
const { aiReply } = await import('../src/features/ai.js');
const { Incoming } = await import('../src/incoming.js');

const ME = '919999999999', RAVI = '919000000002', VIJAY = '919000000003';
let calls = [], routes = [];
const route = (re, fn) => routes.push([re, fn]);
const json = (o, status = 200, headers = {}) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json', ...headers } });
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  calls.push({ url: u, opts });
  for (const [re, fn] of routes) if (re.test(u)) return fn(u, opts);
  throw new Error(`no mock for ${u}`);
};
const groq = () => calls.filter((c) => c.url.includes('api.groq.com'));
const answer = (content) => json({ choices: [{ message: { content } }] });
const limit429 = (retryAfter = '8100', again = '2h15m0s') => json({ error: { message: `Rate limit reached for model \`openai/gpt-oss-120b\` on requests per day (RPD): Limit 1000, Used 1000, Requested 1. Please try again in ${again}.` } }, 429, { 'retry-after': retryAfter });
beforeEach(() => { calls = []; routes = []; env.groqKey = ''; env.groqKeyBot = ''; L.useLimitStore(null); });

test('reset time: retry-after (seconds / date), x-ratelimit-reset-* headers, "try again in" text, fallback', () => {
  const now = Date.UTC(2026, 9, 31, 12, 0, 0);
  assert.equal(L.parseDuration('2m59.56s'), 179560);
  assert.equal(L.parseDuration('1h2m3s'), 3723000);
  assert.equal(L.parseDuration('500ms'), 500);
  assert.equal(L.parseDuration('7.66s'), 7660);
  assert.equal(L.parseDuration('120'), 120000);
  assert.equal(L.parseDuration(''), null);
  assert.equal(L.resetMs(new Headers({ 'retry-after': '90' }), '', now), 90000);
  assert.equal(L.resetMs({ 'Retry-After': new Date(now + 300000).toUTCString() }, '', now), 300000);
  assert.equal(L.resetMs(new Headers({ 'x-ratelimit-remaining-requests': '0', 'x-ratelimit-reset-requests': '2h14m30s', 'x-ratelimit-remaining-tokens': '5000', 'x-ratelimit-reset-tokens': '7.5s' }), '', now), 8070000, 'the used-up limit (requests) decides');
  assert.equal(L.resetMs(new Headers({ 'x-ratelimit-remaining-requests': '900', 'x-ratelimit-reset-requests': '2h', 'x-ratelimit-remaining-tokens': '0', 'x-ratelimit-reset-tokens': '45s' }), '', now), 45000, 'tokens per minute used up');
  assert.equal(L.resetMs(null, '{"error":{"message":"Rate limit reached ... Please try again in 1h12m3.5s. Visit https://console.groq.com"}}', now), 4323500);
  assert.equal(L.resetMs(null, 'Please try again in 26.4s', now), 26400);
  assert.equal(L.resetMs(new Headers({ 'retry-after': '30' }), 'Please try again in 2m0s.', now), 120000, 'the longer one wins');
  assert.equal(L.resetMs(new Headers(), 'rate limit', now), 60000, 'no hint → 1 minute');
  assert.equal(L.humanTime(8100000), '2h 15m');
  assert.equal(L.humanTime(7200000), '2h');
  assert.equal(L.humanTime(20000), '1m');
  assert.equal(L.humanTime(5 * 60000), '5m');
});

test('keys: VR Bot mode uses GROQ_API_KEY_BOT when set, else GROQ_API_KEY; "as VR" always GROQ_API_KEY', async () => {
  route(/api\.groq\.com/, () => answer('ok'));
  env.groqKey = 'gsk_main';
  await groqChat({ model: 'm', messages: [] });
  assert.equal(groq().at(-1).opts.headers.Authorization, 'Bearer gsk_main');
  assert.equal(L.botKeyId(), 'main');
  env.groqKeyBot = 'gsk_bot';
  await groqChat({ model: 'm', messages: [] });
  assert.equal(groq().at(-1).opts.headers.Authorization, 'Bearer gsk_bot');
  assert.equal(L.botKeyId(), 'bot');
  await aiReply({}, 'R', [], 'hi');
  assert.equal(groq().at(-1).opts.headers.Authorization, 'Bearer gsk_main');
  env.groqKey = ''; // only the bot key → bot mode still works, "as VR" says no key
  await groqChat({ model: 'm', messages: [] });
  assert.equal(groq().at(-1).opts.headers.Authorization, 'Bearer gsk_bot');
  await assert.rejects(aiReply({}, 'R', [], 'hi'), /GROQ_API_KEY/);
});

test('limits are per key and calls are skipped until the reset', async () => {
  env.groqKey = 'gsk_main'; env.groqKeyBot = 'gsk_bot';
  const store = L.useLimitStore({});
  route(/api\.groq\.com/, (u, o) => (o.headers.Authorization === 'Bearer gsk_bot' ? limit429('600') : answer('fine')));
  await assert.rejects(groqChat({ model: 'm', messages: [] }), (e) => e.rateLimit && e.keyId === 'bot' && !e.skipped);
  assert.ok(store.bot > Date.now() + 590000);
  const n = groq().length;
  await assert.rejects(groqChat({ model: 'm', messages: [] }), (e) => e.rateLimit && e.skipped);
  assert.equal(groq().length, n, 'no call while limited');
  assert.equal(await aiReply({}, 'R', [], 'hi'), 'fine', 'the main key is not limited');
  store.bot = Date.now() - 1; // reset passed
  routes = []; route(/api\.groq\.com/, () => answer('back'));
  assert.equal((await groqChat({ model: 'm', messages: [] })).text, 'back');
  assert.equal(store.bot, undefined);
});

/* ---- the bot (Incoming) ---- */
const HDR = /^🤖 \*VR Bot\* is sending:\n/;
function harness(settings = {}) {
  const sent = [];
  const wa = { me: () => ME, isMe: (j) => String(j || '').startsWith(ME), pnFor: async (jid, alt) => String(alt || jid || '').split('@')[0].split(':')[0], sock: { user: { id: `${ME}@s.whatsapp.net` } } };
  const state = { memory: { processed: [], sentIds: [], lastOut: {}, lastIn: {}, cooldowns: {}, aiCount: {}, ai: {}, awaySent: {}, warns: {} }, status: { inbox: {}, groups: [] } };
  const contacts = [{ id: 'c1', name: 'Ravi Kumar', number: '+91 90000 00002' }, { id: 'c2', name: 'Vijay', number: '+91 90000 00003' }];
  const data = { settings: withDefaults({ version: 2, ...settings }), rules: [], contacts, groupsCfg: {} };
  const inc = new Incoming({ wa, getData: () => data, state, send: async (jid, content) => { sent.push({ jid, text: content.text ? content.text.replace(HDR, '') : undefined, content }); return { key: { id: 'S' + sent.length } }; }, media: null });
  return { inc, sent, state };
}
let n = 0;
const dm = (num, text) => ({ key: { remoteJid: `${num}@s.whatsapp.net`, id: 'L' + ++n, fromMe: false }, messageTimestamp: Math.floor(Date.now() / 1000) - 5, pushName: 'Friend', message: { conversation: text } });
const run = async (h, ...messages) => { h.inc.push({ messages }); await h.inc.drain(); };
const to = (h, num) => h.sent.filter((s) => s.jid === `${num}@s.whatsapp.net`);

test('VR Bot mode: limit used up → that chat is told ONCE (with the reset time); fixed-text answers keep working', async () => {
  env.groqKey = 'gsk_main';
  route(/api\.groq\.com/, () => limit429('8100'));
  const h = harness({ features: { botMode: true } });
  await run(h, dm(RAVI, 'vr bot tell me a story'));
  assert.equal(to(h, RAVI).length, 1);
  assert.equal(to(h, RAVI)[0].text, "🤖 VR Bot's free AI limit is used up for now — back in ~2h 15m. Try again later!");
  const g = groq().length;
  h.state.memory.botMode.last = {}; // skip the bot's own per-chat cooldown
  await run(h, dm(RAVI, 'vr bot tell me a joke'));
  assert.equal(to(h, RAVI).length, 1, 'not repeated in the same window');
  assert.equal(groq().length, g, 'no Groq call while limited');
  h.state.memory.botMode.last = {};
  await run(h, dm(VIJAY, 'vr bot how are you'));
  assert.equal(to(h, VIJAY).length, 1, 'another chat is told once too');
  assert.match(to(h, VIJAY)[0].text, /free AI limit is used up/);
  h.state.memory.botMode.last = {};
  await run(h, dm(VIJAY, 'vr bot show me your projects'));
  assert.equal(to(h, VIJAY).length, 2, 'projects list still answered');
  assert.doesNotMatch(to(h, VIJAY)[1].text, /limit/);
  assert.equal(groq().length, g);
  assert.equal(h.sent.filter((s) => s.jid === `${ME}@s.whatsapp.net`).length, 0, 'no "add the key" hint — the key is there');
});

test('"as VR" AI replies: limit used up → friends get NOTHING, you get ONE notification, calls skipped until reset', async () => {
  env.groqKey = 'gsk_main';
  route(/api\.groq\.com/, () => limit429('5400', '1h29m30s'));
  const h = harness({ features: { ai: true }, ai: { who: 'everyone' } });
  await run(h, dm(RAVI, 'bro where are you'));
  assert.equal(to(h, RAVI).length, 0, 'never a limit message in your name');
  const mine = to(h, ME);
  assert.equal(mine.length, 1);
  assert.equal(mine[0].text, '⚠️ AI replies paused: Groq limit reached, resets in ~1h 30m. Friends get no AI reply until then (nothing is sent in your name).');
  const g = groq().length;
  await run(h, dm(VIJAY, 'hello?'));
  assert.equal(to(h, VIJAY).length, 0);
  assert.equal(to(h, ME).length, 1, 'one notification per window');
  assert.equal(groq().length, g, 'no Groq call while limited');
  assert.equal(h.state.memory.aiCount[Object.keys(h.state.memory.aiCount).find((k) => k.endsWith(`${VIJAY}@s.whatsapp.net`))] || 0, 0, 'skipped replies do not use the daily cap');
  // the limit resets → replies again
  h.state.memory.groqLimit.main = Date.now() - 1;
  routes = []; route(/api\.groq\.com/, () => answer('here bro'));
  await run(h, dm(VIJAY, 'you there?'));
  assert.equal(to(h, VIJAY).length, 1);
  assert.match(to(h, VIJAY)[0].text, /here bro$/);
});
