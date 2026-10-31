// VR Bot — "VR Bot mode": friends talk to the bot itself ("hey vr bot, explain this", "vr bot tell a story").
// Pure logic shared by the bot (src/features/botmode.js, src/incoming.js) and the panel: trigger words,
// intents (chat / link / web / real picture / AI drawing / "what's this" photo), daily caps, the assistant
// persona prompt and the "never share private things" guard. No network here. © VR DEVELOPMENTS
import { projectIntent, projectsOf, projectsFacts, brandOf } from './projects.js';

export const BOT_DEFAULTS = {
  triggers: ['vr bot', 'vrbot', 'bot,'],   // "hey vr bot …", "@vrbot …", "bot, …" (any capitals); one per line in the panel
  allow: { chat: true, web: true, vision: true, pics: true, draw: true },
  who: 'everyone',          // private chats: everyone | contacts | pick
  contacts: [], tags: [],
  exclude: [], excludeTags: [], // never answer these (the AI's "never reply" list counts too)
  groups: 'all',            // all | none | [group ids] — in groups it answers ONLY when addressed ("vr bot …" / "@VR bot …")
  inBusy: true,             // a direct "vr bot …" question is still answered while busy/class mode is on
  perPersonPerDay: 20,      // bot-mode replies per person per day
  globalPerDay: 300,        // all chats together per day (Groq free plan: 1,000 requests/day per model)
  cooldownSeconds: 15,      // per chat, between two bot-mode replies
  maxLines: 12,
  memory: 6,                // remember the last N messages of the bot conversation per chat
  model: 'openai/gpt-oss-120b',
  visionModel: 'qwen/qwen3.8-27b',
  promo: true,              // after an answer on a matching topic: "💡 btw VR built GeoWeather3D for this → link"
  promoEveryDays: 1,        // the same project at most once per chat every N days
};

export const BOT_LIMITS = { pageBytes: 1500000, pageChars: 6000, imageBytes: 5 * 1024 * 1024, fetchMs: 12000, imageMs: 60000 };

/** Bot-mode settings with every default filled in. */
export function botCfg(S = {}) {
  const b = S.botMode || {};
  return { ...BOT_DEFAULTS, ...b, allow: { ...BOT_DEFAULTS.allow, ...(b.allow || {}) }, triggers: cleanTriggers(b.triggers ?? BOT_DEFAULTS.triggers) };
}

/** The scope used by inScope(): its own picks + the AI's "never reply to these people" list. */
export function botScope(S = {}) {
  const b = botCfg(S), a = S.ai || {};
  return {
    who: b.who || 'everyone', contacts: b.contacts || [], tags: b.tags || [],
    exclude: [...new Set([...(b.exclude || []), ...(a.exclude || [])])],
    excludeTags: [...new Set([...(b.excludeTags || []), ...(a.excludeTags || [])])],
    groups: b.groups ?? 'all',
  };
}

export function cleanTriggers(list) {
  const arr = Array.isArray(list) ? list : String(list || '').split(/[\n]/);
  return [...new Set(arr.map((t) => String(t || '').trim().toLowerCase()).filter((t) => t.replace(/[^\p{L}\p{N}]/gu, '').length >= 2))];
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** "vr bot" → /vr[\s._-]*bot/ ; "bot," keeps its comma/colon (so "bot is slow" never triggers). */
function triggerRe(t) {
  const needsPunct = /[,:]$/.test(t);
  const core = t.replace(/[,:]+$/, '').trim();
  const body = core.replace(/^@/, '').split(/[\s._-]+/).filter(Boolean).map(esc).join('[\\s._-]*');
  return { body: `@?${body}`, needsPunct };
}
const GREET = '(?:(?:hey|hi|hii+|hello|helo|hlo|oi|oye|yo|ey|ok|okay|dear|ra|bro|anna)[\\s,!.]+)*';
const FILLER = /^(?:[\s,:;!.\-–—?]|ra\b|raa\b|anna\b|bro\b|bhai\b|please\b|pls\b|plz\b|garu\b)+/i;
const LETTER = /[\p{L}\p{N}]/u;

/**
 * Is this message talking to the bot? → { hit, question } (question = the text without the trigger).
 * Start: "hey vr bot …", "@vrbot …", "Vr Bot ra …", "bot, …". End: "… , vr bot?". Never: "robot", "vr botany".
 * opts.mentionedMe: the message @mentions you (the bot's number) → "@VR bot …" counts (the bare word "bot" after the tag).
 */
export function detectTrigger(text, triggers = BOT_DEFAULTS.triggers, opts = {}) {
  let t = String(text || '').trim();
  if (!t) return { hit: false };
  t = t.replace(/^[^\p{L}\p{N}@]+/u, ''); // leading emoji / punctuation
  let mentioned = false;
  const m0 = t.match(/^@\d{5,}\s*/);
  if (m0) { mentioned = !!opts.mentionedMe; t = t.slice(m0[0].length); }
  const list = cleanTriggers(triggers);
  if (mentioned && !list.includes('bot')) list.push('bot');
  for (const trig of list) {
    const { body, needsPunct } = triggerRe(trig);
    const start = new RegExp(`^${GREET}${body}${needsPunct ? '\\s*[,:]' : '(?![\\p{L}\\p{N}])'}`, 'iu');
    const m = t.match(start);
    if (m) return { hit: true, question: t.slice(m[0].length).replace(FILLER, '').trim(), trigger: trig };
    if (!needsPunct) {
      const end = new RegExp(`(?:^|[\\s,.;!?])${GREET}${body}(?:\\s*(?:ra|anna|bro|please|pls))?[\\s?!.]*$`, 'iu');
      const e = t.match(end);
      if (e && e.index > 0 && LETTER.test(t.slice(0, e.index))) return { hit: true, question: t.slice(0, e.index).replace(/[\s,;:\-–—]+$/, '').trim(), trigger: trig };
    }
  }
  return { hit: false };
}

/* ---------------- links ---------------- */
export function extractUrls(text, max = 2) {
  const out = [];
  for (const m of String(text || '').matchAll(/\bhttps?:\/\/[^\s<>"'`]+|\bwww\.[a-z0-9-]+\.[^\s<>"'`]+/gi)) {
    let u = m[0].replace(/[),.!?;:'"\]]+$/, '');
    if (/^www\./i.test(u)) u = 'https://' + u;
    try { const p = new URL(u); if (!['http:', 'https:'].includes(p.protocol)) continue; if (isPrivateHost(p.hostname)) continue; } catch { continue; }
    if (!out.includes(u)) out.push(u);
    if (out.length >= max) break;
  }
  return out;
}
/** Never fetch the bot's own machine / local network (a friend could send http://localhost/...). */
export function isPrivateHost(h) {
  h = String(h || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!h || h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true;
  if (/^(127\.|10\.|0\.|169\.254\.|192\.168\.)/.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  if (h === '::1' || h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80')) return h.includes(':');
  return false;
}
export function youtubeId(u) {
  try {
    const p = new URL(u);
    const h = p.hostname.replace(/^www\.|^m\.|^music\./, '');
    if (h === 'youtu.be') return p.pathname.slice(1, 12) || null;
    if (h === 'youtube.com') {
      if (p.searchParams.get('v')) return p.searchParams.get('v').slice(0, 11);
      const m = p.pathname.match(/^\/(?:shorts|live|embed)\/([\w-]{6,})/);
      return m ? m[1].slice(0, 11) : null;
    }
  } catch {}
  return null;
}

/** HTML → { title, description, text } (scripts/styles/nav dropped, entities decoded, capped). */
export function htmlToText(html, maxChars = BOT_LIMITS.pageChars) {
  const s = String(html || '');
  const meta = (name) => {
    const re1 = new RegExp(`<meta[^>]+(?:name|property)=["']${name}["'][^>]*content=["']([^"']*)["']`, 'i');
    const re2 = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:name|property)=["']${name}["']`, 'i');
    return decodeEntities((s.match(re1) || s.match(re2) || [])[1] || '').trim();
  };
  const title = meta('og:title') || decodeEntities((s.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '').replace(/\s+/g, ' ').trim();
  const description = meta('og:description') || meta('description');
  let body = s.replace(/<head[\s>][\s\S]*?<\/head>/i, ' ').replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|nav|footer|header|form|iframe|template)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(br|p|div|li|h[1-6]|tr|section|article)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  body = decodeEntities(body).replace(/[ \t\f\v\u00a0]+/g, ' ').replace(/\s*\n\s*/g, '\n').replace(/\n{2,}/g, '\n').trim();
  return { title: title.slice(0, 200), description: description.slice(0, 500), text: body.slice(0, maxChars) };
}
export function decodeEntities(s) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', copy: '©' };
  return String(s || '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') { const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); try { return String.fromCodePoint(n); } catch { return m; } }
    return named[e.toLowerCase()] ?? m;
  });
}

/* ---------------- intents ---------------- */
const IMG_NOUN = '(?:image|images|pic|pics|picture|pictures|photo|photos|pik|drawing|painting|art|artwork|wallpaper|logo|poster|sketch|illustration)';
const DRAW_RE = new RegExp(`^(?:can you |can u |could you |pls |please )?(?:(?:draw|paint|sketch|imagine)\\b(?:\\s+(?:me|us))?(?:\\s+(?:an?|the|some))?(?:\\s+${IMG_NOUN})?(?:\\s+of)?|(?:generate|create|make|design)\\s+(?:me\\s+|us\\s+)?(?:an?\\s+|the\\s+|some\\s+)?(?:ai\\s+)?${IMG_NOUN}(?:\\s+of)?)\\s+(.+)$`, 'i');
const PIC_RE = new RegExp(`^(?:can you |can u |could you |pls |please )?(?:(?:show|send|give|find|get)\\s+(?:me\\s+|us\\s+)?(?:an?\\s+|the\\s+|some\\s+|real\\s+)*${IMG_NOUN}\\s+(?:of\\s+)?|${IMG_NOUN}\\s+of\\s+|(?:show me|show)\\s+)(.+)$`, 'i');
const VISION_RE = /\b(what'?s this|what is this|what is in (?:this|the) (?:pic|photo|image)|whats this|wat is this|identify|describe (?:this|the)|explain (?:this|the) (?:pic|photo|image|diagram|question)|solve (?:this|it)|read (?:this|it)|what does (?:this|it) say|is this real|which (?:place|plant|animal|car|flower) is this|ide enti|idi enti|enti idi)\b/i;
const WEB_RE = /\b(latest|today'?s?|tonight|yesterday|right now|currently|current|news|this week|this month|live|score|scores|who won|winner|result|results|price of|price|rate of|stock|weather|release date|released|launch(?:ed)?|upcoming|trending|update|election|202[4-9]|20[3-9]\d|recent|new (?:movie|phone|iphone|song)|box office)\b/i;

/**
 * What kind of bot-mode question is this?
 * → { type: 'empty'|'personal'|'draw'|'projects'|'project'|'pic'|'vision'|'link'|'web'|'chat', subject?, urls?, project?, all? }
 * ctx.hasImage: the message itself is a photo (caption to the bot) · ctx.quotedImage: it replies to a photo
 * ctx.quotedText: the text of the message it replies to (links in there count too)
 * ctx.projects: the project list (settings.projects) · ctx.moreProjects: the top-5 list was just sent here ("more" → all)
 */
export function botIntent(question, ctx = {}) {
  const q = String(question || '').trim();
  const urls = extractUrls(`${q}\n${ctx.quotedText || ''}`);
  if (ctx.hasImage || ctx.quotedImage) return { type: 'vision', question: q || 'What is in this picture?' };
  if (!urls.length && (!q || GREETING_ONLY.test(q))) return { type: 'empty' };
  if (personalAsk(q)) return { type: 'personal' };
  const d = q.match(DRAW_RE);
  if (d && d[1].trim().length >= 2) {
    let subject = cleanSubject(d[1]);
    const noun = q.match(new RegExp(`\\b(logo|poster|wallpaper|sketch|painting|drawing|illustration|artwork)\\b`, 'i'));
    if (noun && /^(for|with|that|which|showing)\b/i.test(subject)) subject = `${noun[1].toLowerCase()} ${subject}`;
    return { type: 'draw', subject };
  }
  // VR DEVELOPMENTS projects: "show VR's projects", "what has VR built", "tell me about RepoDNA", "more"
  const pr = q.replace(/https?:\/\/\S+/g, '').trim() ? projectIntent(q, ctx.projects || projectsOf({}), { moreProjects: ctx.moreProjects }) : null;
  if (pr) return pr;
  const p = q.match(PIC_RE);
  if (p && p[1].trim().length >= 2 && !urls.length) {
    const subject = cleanSubject(p[1]);
    if (subject && !/^(me|us|how|what|why|the way|your|ur|my|him|her|them)\b/i.test(subject)) return { type: 'pic', subject };
  }
  if (urls.length) return { type: 'link', urls, question: q };
  if (VISION_RE.test(q) && /\b(this|it)\b/i.test(q) && ctx.expectImage) return { type: 'vision', question: q };
  if (needsWeb(q)) return { type: 'web', question: q };
  return { type: 'chat', question: q };
}
const GREETING_ONLY = /^(?:hi+|hello+|hey+|helo|hlo|yo|oi|namaste|namaskaram|gm|good (?:morning|evening|afternoon|night)|bro|ra|anna)[\s!.?🙂😀👋]*$/i;
const cleanSubject = (s) => String(s || '').replace(/^(?:an?|the|some|real|of)\s+/i, '').replace(/[?!.]+$/, '').replace(/\s+(?:pls|please|ra|bro|anna)$/i, '').trim().slice(0, 200);
export function needsWeb(q) { return WEB_RE.test(String(q || '')); }

/** Questions only VR can answer (where he is, is he free, his number…) → "he'll reply himself". */
const PERSONAL_RE = /\b(where (?:is|r|are) (?:he|vr|rakshith|ur boss|your boss|ur owner|your owner|u|you)|where'?s (?:he|vr|rakshith|ur boss|your boss)|is (?:he|vr|rakshith|ur boss|your boss) (?:free|busy|there|online|available|home|ok|coming|sleeping|awake)|(?:his|vr'?s|rakshith'?s|ur boss'?s|your boss'?s) (?:number|phone|mobile|address|location|house|home|schedule|timetable|plans?|girlfriend|gf|password|marks|salary|money|bank)|when (?:will|is|does) (?:he|vr|rakshith) (?:reply|come|call|be free|be back|text)|can (?:he|vr|rakshith) (?:call|come|meet|talk)|tell (?:him|vr|rakshith) to|ask (?:him|vr|rakshith) to|call (?:him|vr|rakshith)|is he (?:angry|mad|upset))\b/i;
export function personalAsk(q) { return PERSONAL_RE.test(String(q || '')); }

/** "who is your boss", "who made you", "tell me about VR", "what is VR DEVELOPMENTS" → answer from About-you facts only. */
const BOSS_RE = /\b((your|ur|yr) (boss|owner|creator|maker|master|admin)|who (made|created|built|owns|programmed|coded|developed) (you|u|this bot)|who (is|r|are) (vr|rakshith|volam)|about (vr|rakshith|volam|him|ur boss|your boss)|vr developments|vr dev)\b/i;
export function bossAsk(q) { return BOSS_RE.test(String(q || '')); }

/** About-you facts that are safe to show without the AI: the first paragraph, phone numbers hidden. */
export function publicFacts(aboutMe = '') {
  const first = String(aboutMe || '').split(/\n\s*\n|\n(?=My real names|Friends tease)/i)[0] || '';
  return first.replace(/(?:\+?\d[\d\s-]{8,}\d)/g, '[hidden]').trim().slice(0, 900);
}

/* ---------------- safety ---------------- */
const NSFW = /\b(nude|nudes|naked|nsfw|porn|porno|sex|sexy|sexual|boobs?|breasts?|tits|nipples?|genitals?|penis|vagina|bikini|lingerie|underwear|topless|strip(?:per|ping)?|erotic|hentai|onlyfans|xxx|horny|seductive|lewd|fetish)\b/i;
const GORE = /\b(gore|gory|blood(?:y)?|beheaded|behead(?:ing)?|decapitat\w*|dismember\w*|mutilat\w*|corpse|dead body|murder(?:ed|ing)?|killing|suicide|self[- ]?harm|torture\w*|massacre|terroris\w*|bomb(?:ing)?|shoot(?:ing)? (?:people|someone|him|her))\b/i;
/** Image prompts we refuse (sexual, gore/violence). Real people + anything sexual is covered by NSFW. */
export function unsafeImagePrompt(p) {
  const s = String(p || '');
  if (NSFW.test(s)) return 'sexual';
  if (GORE.test(s)) return 'violent';
  return '';
}

/* ---------------- caps & cooldown ---------------- */
/**
 * Can the bot answer this person now? Counts live in memory.botMode (today only, no message text).
 * → { ok } or { ok:false, reason:'cooldown'|'person'|'global', first } (first = first time today → tell them / the owner once)
 */
export function botAllowed(mem, cfg, { chat, person, day, now }) {
  const st = mem.botMode = mem.botMode && mem.botMode.day === day ? mem.botMode : { day, people: {}, total: 0, last: {}, told: {} };
  const last = st.last[chat];
  if (last != null && now - last < (cfg.cooldownSeconds ?? 15) * 1000) return { ok: false, reason: 'cooldown' };
  if ((st.total || 0) >= (cfg.globalPerDay || 300)) return { ok: false, reason: 'global', first: !st.told.global && (st.told.global = true) };
  if ((st.people[person] || 0) >= (cfg.perPersonPerDay || 20)) return { ok: false, reason: 'person', first: !st.told['p:' + person] && (st.told['p:' + person] = true) };
  return { ok: true };
}
export function botCount(mem, { chat, person, now }) {
  const st = mem.botMode;
  st.people[person] = (st.people[person] || 0) + 1;
  st.total = (st.total || 0) + 1;
  st.last[chat] = now;
}

/* ---------------- persona ---------------- */
/** The system prompt for VR Bot mode: an assistant, never VR himself; facts about VR only from "About you". */
export function botSystemPrompt({ botName = 'VR Bot', myName = 'Rakshith', aboutMe = '', maxLines = 12, isGroup = false, extra = '', company = 'VR DEVELOPMENTS', projects = '' } = {}) {
  const facts = String(aboutMe || '').replace(/(?:\+?\d[\d\s-]{8,}\d)/g, '[hidden]').trim();
  return [
    `You are ${botName} 🤖 by ${company}, ${myName}'s WhatsApp assistant bot. You are NOT ${myName}: never pretend to be him, never write as him, never say "I'm ${myName}". If asked, say you are ${botName} by ${company}, his assistant bot.`,
    `You are chatting with one of ${myName}'s friends${isGroup ? ' in a WhatsApp group' : ''}. Be friendly, helpful and fun. You can explain topics simply, help with study doubts and code, tell short stories and jokes, and answer questions.`,
    `Facts about your boss ${myName} (the ONLY things you know about him):\n${facts || `His name is ${myName}.`}`,
    projects,
    `About ${myName}: use ONLY the facts above${projects ? ' and the project list' : ''}, never invent anything (no made-up age, college, projects, features, numbers or links). When someone asks about him, his work or who made you, answer from those facts and you may proudly mention his website/Instagram if they are in the facts${projects ? ' and his projects from the list (name, one line, exact link)' : ''}.`,
    `Never share or guess his phone number, location, address, schedule, plans, relationships, money or anything private. If someone asks where he is, whether he is free, or anything personal, say he'll reply himself.`,
    `Format for WhatsApp: at most ${maxLines} short lines, no markdown headings, no tables, no code fences unless showing code. *single asterisks* for bold is fine. Match the person's language (English, Telugu, Hinglish or a mix). No "As an AI language model".`,
    'Refuse sexual content, hate, or anything dangerous or illegal, briefly and kindly.',
    extra,
  ].filter(Boolean).join('\n');
}

/** Messages for Groq: system + recent bot conversation in this chat + the new question. */
export function buildBotMessages(cfg, S, history, question, opts = {}) {
  const sys = botSystemPrompt({ botName: S.botName || 'VR Bot', myName: S.myName || 'Rakshith', aboutMe: opts.aboutMe ?? '', maxLines: cfg.maxLines || 12, isGroup: !!opts.isGroup, extra: opts.extra || '', company: brandOf(S).company, projects: projectsFacts(S) });
  const msgs = [{ role: 'system', content: sys }];
  for (const h of (history || []).slice(-(cfg.memory ?? 6))) msgs.push({ role: h.role === 'bot' ? 'assistant' : 'user', content: String(h.text || '').slice(0, 1500) });
  msgs.push({ role: 'user', content: String(question || '').slice(0, 4000) || 'Hi!' });
  return msgs;
}

/** Tidy an AI answer for WhatsApp: no reasoning, no web-citation marks, no markdown headings/tables, ≤ maxLines lines. */
export function tidyReply(text, maxLines = 12) {
  let t = String(text || '').replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/【[^】]*】/g, '').replace(/\[\d+(?:†[^\]]*)?\]/g, '');
  t = t.replace(/^#{1,6}\s*/gm, '').replace(/\*\*([^*\n]+)\*\*/g, '*$1*').replace(/__([^_\n]+)__/g, '_$1_');
  t = t.split('\n').filter((l) => !/^\s*\|?\s*:?-{3,}/.test(l)).map((l) => (/^\s*\|.*\|\s*$/.test(l) ? l.replace(/^\s*\|\s*|\s*\|\s*$/g, '').replace(/\s*\|\s*/g, ' · ') : l)).join('\n');
  t = t.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  const lines = t.split('\n');
  if (lines.filter((l) => l.trim()).length > maxLines) {
    const out = []; let n = 0;
    for (const l of lines) { if (l.trim()) n++; if (n > maxLines) break; out.push(l); }
    t = out.join('\n').trim() + ' …';
  }
  return t.slice(0, 3500);
}

/** "Sources:" footer, 1–3 links. */
export function sourcesLine(urls = []) {
  const u = [...new Set((urls || []).filter(Boolean))].slice(0, 3);
  return u.length ? `\n\n🔗 ${u.length > 1 ? 'Sources' : 'Source'}:\n${u.join('\n')}` : '';
}

/** "explain photosynthesis" / "what is a black hole" / "tell me about Taj Mahal" → "photosynthesis". */
export function topicOf(q) {
  return String(q || '')
    .replace(/[?!.]+$/g, '')
    .replace(/^(?:(?:can|could) (?:you|u) |please |pls |plz )+/i, '')
    .replace(/^(?:explain(?: me)?(?: about)?|tell (?:me|us) (?:about|abt)|what(?:'s| is| are| was| were) (?:an? |the )?|who(?:'s| is| was| are) |define |meaning of |info (?:on|about) |about |describe |history of |summary of |summarize |details (?:of|about) )/i, '')
    .replace(/^(?:an?|the)\s+/i, '')
    .replace(/\s+(?:in (?:short|simple words|telugu|english|detail)|simply|briefly|pls|please|ra|bro|anna)$/i, '')
    .trim().slice(0, 120);
}

/** Lines for !help that friends see when VR Bot mode is on. */
export function botHelpLines(S = {}) {
  if (!S.features?.botMode) return [];
  const b = botCfg(S);
  const t = (b.triggers[0] || 'vr bot').replace(/[,:]$/, '');
  const lines = ['', `🤖 *Talk to ${S.botName || 'VR Bot'}* by ${brandOf(S).company} (start with "${t}")`];
  if (b.allow.chat) lines.push(`${t} explain black holes · ${t} tell a story · ${t} who is your boss?`);
  if (projectsOf(S).length) lines.push(`${t} show ${brandOf(S).owner}'s projects · ${t} tell me about ${projectsOf(S)[Math.min(3, projectsOf(S).length - 1)].name}`);
  if (b.allow.web) lines.push(`${t} + a link → summary · ${t} latest news on ISRO`);
  if (b.allow.vision) lines.push(`photo + caption "${t} what's this?"`);
  if (b.allow.pics) lines.push(`${t} show me a pic of Charminar`);
  if (b.allow.draw) lines.push(`${t} draw a dragon in space (AI image)`);
  return lines;
}

/** One-time hint for the owner when the Groq key is missing. */
export const GROQ_HELP = '🔑 Free Groq key (no card, 2 min):\n1. console.groq.com → sign in with Google\n2. API Keys → Create API Key → copy it\n3. GitHub → your vr-bot repo → Settings → Secrets and variables → Actions → New repository secret\n4. Name: GROQ_API_KEY · Secret: paste → Add secret\nThe bot picks it up on its next run (Actions → VR Bot — Run → Run workflow to make it instant).';
