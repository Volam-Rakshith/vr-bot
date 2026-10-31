// VR Bot — VR DEVELOPMENTS projects: the catalog VR Bot mode promotes ("vr bot show VR's projects", "!projects",
// "btw VR built GeoWeather3D for this → link"). Pure logic shared by the bot and the panel, no network.
// The list is editable in the panel (Replies → 🤖 VR Bot mode → 📦 Projects); these are only the defaults.
// The bot never talks about projects that are not in this list. © VR DEVELOPMENTS

export const DEFAULT_BRAND = {
  company: 'VR DEVELOPMENTS',
  owner: 'VR',                                    // "btw VR built …"
  site: 'https://vrdevelopments.sites.tab.bot',
  github: 'https://github.com/Volam-Rakshith',
};

// tags = topics that make the bot mention the project after its answer (whole words; "word*" = word + any ending).
export const DEFAULT_PROJECTS = [
  { name: 'ECHO', tagline: 'Every website. Decoded. One URL, an entire digital universe. Source code, color tokens, tech stack, security audit.', link: 'https://volam-rakshith.github.io/ECHO-A-WEBSITE-INTELLIGENCE-STUDIO-BY-VR-DEVELOPMENTS',
    tags: ['website analysis', 'analyze a website', 'analyze this website', 'analyze website', 'tech stack', 'built with which', 'which framework', 'color palette', 'color tokens', 'website source code', 'source code of this website', 'security audit', 'inspect a website', 'inspect website'] },
  { name: 'VR KRYPTA', tagline: 'Transform • Decipher • Analyze. 190 operations, auto-detect, pipeline lab, offline PWA.', link: 'https://volam-rakshith.github.io/VR-KRYPTA',
    tags: ['encode', 'encoding', 'decode', 'decoding', 'encrypt', 'encryption', 'decrypt', 'decryption', 'cipher', 'ciphers', 'base64', 'base 64', 'hash', 'hashing', 'sha256', 'md5', 'caesar', 'morse code', 'cryptography', 'binary to text', 'hex to text'] },
  { name: 'Terminal Arcade', tagline: '49 retro games in one HTML file. Zero dependencies, 14 achievements, play offline.', link: 'https://volam-rakshith.github.io/Terminal-Arcade',
    tags: ['bored', 'boring', 'im bored', 'timepass', 'time pass', 'arcade', 'retro game*', 'video game*', 'offline game*', 'browser game*', 'play a game', 'game to play', 'games to play', 'suggest a game', 'suggest some games', 'snake game', 'tetris'] },
  { name: 'RepoDNA', tagline: 'Decode the DNA of any repository. 8 lenses, local-first, no login, PNG/SVG export.', link: 'https://volam-rakshith.github.io/RepoDNA',
    tags: ['github', 'repo', 'repos', 'repository', 'repositories', 'analyze a repo', 'analyze my repo', 'open source project'] },
  { name: 'RepoTimeMachine', tagline: 'Explore a repository across time. Commits, tags, releases, jump by date, compare versions.', link: 'https://volam-rakshith.github.io/RewindRepo',
    tags: ['github', 'repo', 'repository', 'commit history', 'git history', 'repo history', 'git log', 'old commits', 'previous commits', 'compare versions', 'version history', 'github releases'] },
  { name: 'README Doctor', tagline: "Your README doesn't need another generator, it needs a diagnosis. Zero dependencies, no AI, open source.", link: 'https://volam-rakshith.github.io/ReadME.Doctor',
    tags: ['github', 'repo', 'repository', 'readme', 'read me file', 'readme file', 'readme md'] },
  { name: 'GeoWeather3D', tagline: 'Live weather on an interactive 3D globe. Weather, air quality, discover places.', link: 'https://volam-rakshith.github.io/GeoWeather3D',
    tags: ['weather', 'forecast', 'temperature', 'rain', 'raining', 'rainy', 'humidity', 'air quality', 'aqi', 'monsoon', 'cyclone', 'climate'] },
  { name: 'PromptCraft', tagline: 'Turn any idea into a master prompt. Groq LPU, /commands, 5 themes, export .md.', link: 'https://volam-rakshith.github.io/PROMPT-CRAFT',
    tags: ['prompt', 'prompts', 'prompt engineering', 'chatgpt prompt*', 'ai prompt*', 'midjourney prompt*'] },
  { name: 'Groq AI Chatbot', tagline: 'Lightning-fast AI, zero clutter. /key /model /theme /history.', link: 'https://volam-rakshith.github.io/Groq-AI-Chatbot',
    tags: ['groq', 'ai chatbot', 'chatbot app', 'free chatbot', 'free ai chat'] },
  { name: 'RecipeAI', tagline: 'Discover any recipe instantly. AI recipes, step timeline, smart timer.', link: 'https://volam-rakshith.github.io/Recipe-AI',
    tags: ['recipe', 'recipes', 'cook', 'cooking', 'cooked', 'what to cook', 'what should i cook', 'what to eat', 'dinner idea*', 'breakfast idea*', 'lunch idea*', 'baking', 'bake a', 'biryani', 'curry', 'dish', 'dishes', 'food recipe*', 'make food'] },
  { name: 'Coding Insight', tagline: 'See the logic behind the syntax. Paste code → ask AI → understand. Error detection, line-by-line, auto fix. Android APK (latest v2.1 in Releases).', link: 'https://github.com/Volam-Rakshith/Coding-insight-Apk',
    tags: ['code', 'coding', 'my code', 'this code', 'debug', 'debugging', 'bug', 'bugs', 'syntax', 'syntax error', 'code error', 'error in my code', 'error in code', 'programming', 'compile', 'compiler', 'compilation error', 'python', 'javascript', 'java', 'c++', 'c program', 'html', 'css', 'traceback', 'exception', 'null pointer', 'segmentation fault'] },
  { name: 'House Price Predictor (India)', tagline: 'Know the price before you hunt. Lasso regression, R² 0.94, Streamlit app.', link: 'https://github.com/Volam-Rakshith/house-price-predictor-india',
    tags: ['house price*', 'home price*', 'flat price*', 'apartment price*', 'property price*', 'property rate*', 'real estate', 'buy a house', 'buying a house', 'land rate*', 'plot price*'] },
  { name: 'VR Flash Cardzz', tagline: 'Make flashcards that look as good as your notes. 100% private, no sign-up, export to PDF.', link: 'https://volam-rakshith.github.io/VR-FLASH-CARDZZ',
    tags: ['flashcard*', 'flash card*', 'study', 'studying', 'exam', 'exams', 'examination', 'revision', 'revise', 'memorize', 'memorise', 'memorizing', 'test prep', 'prepare for test'] },
  { name: 'VR PDF Tools', tagline: 'Bulk PDF toolkit: merge, split, bulk rename, watermark. Coming soon.', link: '',
    tags: ['merge pdf*', 'split pdf*', 'pdf merge', 'pdf split', 'watermark'] },
  { name: 'VR Portfolio', tagline: 'Know about VR and see his work.', link: 'https://volam-rakshith.github.io/VOLAM-RAKSHITH-PORTFOLIO',
    tags: [] },
];

/** The brand (company, owner nickname, site, GitHub) with defaults filled in. */
export function brandOf(S = {}) {
  const b = S.brand || {};
  const out = { ...DEFAULT_BRAND };
  for (const k of Object.keys(DEFAULT_BRAND)) if (typeof b[k] === 'string' && b[k].trim()) out[k] = b[k].trim();
  return out;
}

/** Clean project list from settings (empty names dropped, tags trimmed/lower-cased, link https only). */
export function cleanProjects(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const p of list) {
    if (!p || typeof p !== 'object') continue;
    const name = String(p.name || '').trim().slice(0, 80);
    if (!name) continue;
    const link = String(p.link || '').trim();
    const tags = (Array.isArray(p.tags) ? p.tags : String(p.tags || '').split(','))
      .map((t) => String(t || '').trim().toLowerCase()).filter((t) => t.replace(/[^a-z0-9+#]/g, '').length >= 2);
    out.push({ name, tagline: String(p.tagline || '').trim().slice(0, 300), link: /^https:\/\/\S+$/i.test(link) ? link : '', tags: [...new Set(tags)] });
  }
  return out;
}
/** The projects VR Bot may talk about (settings.projects, else the defaults). */
export function projectsOf(S = {}) {
  return cleanProjects(Array.isArray(S.projects) ? S.projects : DEFAULT_PROJECTS);
}

/* ---------------- rendering (WhatsApp text) ---------------- */
/** First sentence(s) of the tagline, at least ~30 characters, at most ~100. */
export function shortLine(p) {
  const parts = String(p.tagline || '').split(/(?<=[.!?])\s+/);
  let out = '';
  for (const s of parts) { out = out ? `${out} ${s}` : s; if (out.length >= 30) break; }
  return out.length > 100 ? out.slice(0, 98).replace(/\s+\S*$/, '') + '…' : out;
}
const linkOrSoon = (p) => p.link || '🔜 coming soon';

/** "🚀 VR DEVELOPMENTS — Rakshith's projects" + top N (name, one line, link) + "say more" hint. */
export function renderProjectList(S = {}, { limit = 5, moreHint = '', header = true } = {}) {
  const list = projectsOf(S), brand = brandOf(S);
  if (!list.length) return `🤖 No projects listed yet. See ${brand.github}`;
  const shown = limit ? list.slice(0, limit) : list;
  const lines = [];
  if (header) lines.push(`🚀 *${brand.company}* — ${S.myName || brand.owner}'s projects${limit && list.length > shown.length ? ` (top ${shown.length} of ${list.length})` : ` (${list.length})`}`, '');
  shown.forEach((p, i) => { lines.push(`*${i + 1}. ${p.name}* — ${limit ? shortLine(p) : shortLine(p)}`, linkOrSoon(p)); });
  if (limit && list.length > shown.length) lines.push('', moreHint || `Say *more* for all ${list.length} 👀`);
  else lines.push('', `🌐 ${brand.site}`, `💻 ${brand.github}`);
  return lines.join('\n');
}
/** One project, full card. */
export function renderProject(S = {}, p) {
  const brand = brandOf(S);
  return [`🚀 *${p.name}* — by ${brand.company}`, p.tagline, p.link ? `👉 ${p.link}` : '🔜 Coming soon, no link yet.', '', `More of ${brand.owner}'s work: ${brand.site}`].filter((l) => l != null).join('\n');
}

/** Facts for the bot-mode system prompt: the ONLY projects the AI may mention. */
export function projectsFacts(S = {}) {
  const list = projectsOf(S), brand = brandOf(S);
  if (!list.length) return '';
  return [`${brand.company} projects built by ${S.myName || brand.owner} (the ONLY projects you know; never invent other projects, features, numbers or links, never change these links):`,
    ...list.map((p) => `- ${p.name}: ${p.tagline}${p.link ? ` Link: ${p.link}` : ' (coming soon, no link yet)'}`),
    `Company site: ${brand.site} · GitHub: ${brand.github}`].join('\n');
}

/* ---------------- matching ---------------- */
/** lower-case, apostrophes dropped, anything but letters/digits/+/# → one space. */
export function norm(s) {
  return ' ' + String(s || '').toLowerCase().replace(/https?:\/\/\S+/g, ' ').replace(/['’`]/g, '').replace(/[^a-z0-9+#]+/g, ' ').trim() + ' ';
}
const rx = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Does the (normalised) text contain this tag? Whole words; "s"/"es" plural ok; "word*" = any ending. */
export function hasTag(ntext, tag) {
  const wild = tag.endsWith('*');
  const t = norm(wild ? tag.slice(0, -1) : tag).trim();
  if (!t) return false;
  if (wild) return new RegExp(` ${rx(t)}[a-z0-9]* `).test(ntext);
  return ntext.includes(` ${t} `) || ntext.includes(` ${t}s `) || ntext.includes(` ${t}es `);
}
/**
 * Projects whose topic this question is about, best first: most matching tags, then the longest tag, then list order.
 * Projects without a link (coming soon) are never promoted.
 */
// "pin code", "promo code", "how vr works"… are not about coding: removed before matching.
const NOT_TOPIC = / (?:pin|zip|postal|dress|promo|coupon|discount|referral|redeem|qr|otp|area|country|std|ifsc|secret|gift|access|verification) codes? | code name | (?:reverse )?repo rates? /g;
export function topicMatches(question, projects) {
  const n = norm(question).replace(NOT_TOPIC, '  ');
  const hits = [];
  projects.forEach((p, i) => {
    if (!p.link) return;
    const m = (p.tags || []).filter((t) => hasTag(n, t));
    if (m.length) hits.push({ p, i, count: m.length, longest: Math.max(...m.map((t) => t.length)) });
  });
  return hits.sort((a, b) => b.count - a.count || b.longest - a.longest || a.i - b.i).map((h) => h.p);
}

const COMMON = new Set(['echo', 'portfolio', 'tools', 'tool', 'pdf', 'games', 'arcade', 'terminal', 'notes', 'cards', 'weather', 'recipe', 'prompt', 'chatbot', 'bot', 'insight', 'doctor', 'craft', 'app', 'apps', 'ai', 'flash']);
function nameTokens(s) {
  return String(s).replace(/\s*\([^)]*\)\s*/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([A-Za-z])(\d)/g, '$1 $2').replace(/(\d)([A-Za-z])/g, '$1 $2')
    .toLowerCase().split(/[^a-z0-9+#]+/).filter(Boolean);
}
/** Ways people write a project's name: "RepoDNA" / "repo dna", "VR KRYPTA" / "krypta", "GeoWeather3D" / "geo weather". */
export function nameVariants(name) {
  const full = nameTokens(name);
  const out = [{ tokens: full, strong: full.length >= 2 || !full.every((t) => COMMON.has(t)) }];
  const add = (tokens) => { if (tokens.length && !out.some((v) => v.tokens.join(' ') === tokens.join(' '))) out.push({ tokens, strong: !tokens.every((t) => COMMON.has(t)) }); };
  if (full[0] === 'vr' && full.length > 1) add(full.slice(1));
  const d = full.findIndex((t) => /^\d+$/.test(t));
  if (d > 0) add(full.slice(0, d));
  return out;
}
const QUAL_BEFORE = "(?:vr'?s|vrs|his|rakshith'?s|your boss'?s|ur boss'?s|open|link (?:for|to|of))\\s+";
const QUAL_AFTER = '\\s+(?:app|apk|project|tool|site|website|web ?app|game|by vr|link)';
/**
 * Which project does this message name? Strong names (RepoDNA, Terminal Arcade, krypta) count anywhere;
 * plain-word names (ECHO, Portfolio) only as "ECHO" in capitals, "VR's echo", "echo app/project/site".
 */
export function findProject(text, projects, { loose = false } = {}) {
  const raw = String(text || '').replace(/https?:\/\/\S+/g, ' ');
  let best = null;
  for (const p of projects) {
    for (const v of nameVariants(p.name)) {
      const body = v.tokens.map(rx).join("[\\s._'-]*");
      const re = new RegExp(`(?:^|[^a-z0-9])${body}(?![a-z0-9])`, 'i');
      if (!re.test(raw)) continue;
      let ok = v.strong || loose;
      if (!ok) {
        const caps = v.tokens.length === 1 && new RegExp(`(?:^|[^A-Za-z0-9])${rx(v.tokens[0].toUpperCase())}(?![A-Za-z0-9])`).test(raw);
        ok = caps || new RegExp(`${QUAL_BEFORE}${body}(?![a-z0-9])`, 'i').test(raw) || new RegExp(`${body}${QUAL_AFTER}\\b`, 'i').test(raw);
      }
      if (ok) { const len = v.tokens.join(' ').length; if (!best || len > best.len) best = { p, len }; }
    }
  }
  return best ? best.p : null;
}

/* ---------------- intents ---------------- */
const OWNER_POSS = "(?:vr'?s|vr’s|vrs|rakshith|volam|volam rakshith|his|ur boss|your boss|yr boss|the boss|boss|ur owner|your owner|ur creator|your creator|vr developments|vr devs?)(?:'?s|’s)?";
const OWNER_REF = '(?:vr|rakshith|volam|he|your boss|ur boss|yr boss|your owner|ur owner|your creator|ur creator|vr developments)';
const WORK = '(?:projects?|apps?|applications?|portfolio|products?|creations?|tools?|websites?|sites?)(?!\\s+(?:schedule|timings?|time|hours|place|location|address))';
const OWNER_S = "(?:vr'?s|vr’s|vrs|rakshith'?s|rakshith’s|his|(?:ur|your|yr|the) boss'?s|(?:ur|your|yr|the) boss’s|boss'?s|vr developments'?)";
const LIST_RES = [
  new RegExp(`\\b${OWNER_POSS}\\s+(?:latest\\s+|best\\s+|top\\s+|all\\s+|other\\s+|own\\s+)?${WORK}\\b`, 'i'),
  new RegExp(`\\b${OWNER_S}\\s+(?:latest\\s+|best\\s+|own\\s+)?works?\\b(?!\\s+(?:schedule|timings?|time|hours|place|location|address|from home))`, 'i'),
  new RegExp(`\\bwhat (?:all |else )?(?:has|have|did|does|can) ${OWNER_REF} (?:built|build|made|make|created|create|developed|develop|coded|launched)\\b`, 'i'),
  new RegExp(`\\b(?:projects?|apps?|works?|tools?|websites?)\\s+(?:by|of|from|made by|built by|created by)\\s+${OWNER_REF}\\b`, 'i'),
  /^(?:(?:show|list|send|give|share|tell)\s+)?(?:(?:me|us)\s+)?(?:(?:the|all|your|ur|some|all the)\s+)*(?:projects?|apps|portfolio)(?:\s+list)?[\s?!.]*$/i,
  /\b(?:show|list|send|share|see)\b.{0,25}\bprojects\b/i,
  /\bvr\s+(?:dev(?:elopments?)?\s+)?projects?\b/i,
];
const ALL_RE = /\b(?:all|full list|every|whole list|complete list)\b.{0,20}\bprojects?\b|\ball \d+\b/i;
export const MORE_RE = /^(?:more|show more|more please|more pls|more plz|all|show all|all of them|the rest|rest|full list|all \d+|send all|send more)[\s?!.🙂👀]*$/i;

/**
 * Is this a question about VR's projects? → { type:'projects', all } | { type:'project', project, simple } | null
 * ctx.moreProjects: the bot just sent the top-5 list in this chat → "more" means the full list.
 */
export function projectIntent(question, projects, ctx = {}) {
  const q = String(question || '').trim();
  if (!q) return null;
  if (ctx.moreProjects && MORE_RE.test(q)) return { type: 'projects', all: true };
  const p = findProject(q, projects);
  if (p) {
    const rest = norm(q.replace(/https?:\/\/\S+/g, ' ')).replace(new RegExp(`\\b(?:${nameVariants(p.name).map((v) => v.tokens.map(rx).join('\\s*')).join('|')})\\b`, 'g'), ' ')
      .replace(/\b(?:tell|me|us|about|abt|what|whats|is|the|vr|vrs|his|app|project|tool|site|website|link|send|show|open|info|on|of|for|explain|pls|please|ra|bro|anna|give|share|a|an|about|it|this|share)\b/g, ' ').trim();
    return { type: 'project', project: p, simple: rest.split(/\s+/).filter(Boolean).length <= 2 };
  }
  if (LIST_RES.some((re) => re.test(q))) return { type: 'projects', all: ALL_RE.test(q) };
  return null;
}

/* ---------------- "btw VR built … for this" ---------------- */
const dayNum = (d) => Math.floor(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 86400000);
export const projectKey = (p) => String(p.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
/**
 * The one promo line for this answer, or '' — at most once per chat per project every N days (default 1).
 * Records what it picks in mem.botPromo (chat|project → day). Skips projects the answer already links to.
 */
export function promoLine(mem, S, { question, chat, day, answer = '', everyDays = 1 }) {
  const list = projectsOf(S), brand = brandOf(S);
  const st = mem.botPromo = mem.botPromo || {};
  for (const p of topicMatches(question, list)) {
    if (answer && answer.includes(p.link)) continue;
    const k = `${chat}|${projectKey(p)}`;
    if (st[k] && dayNum(day) - dayNum(st[k]) < Math.max(1, Number(everyDays) || 1)) continue;
    st[k] = day;
    for (const [kk, d] of Object.entries(st)) if (dayNum(day) - dayNum(d) > 60) delete st[kk]; // forget old ones
    return `💡 btw ${brand.owner} built *${p.name}* for this → ${p.link}`;
  }
  return '';
}

/** !projects / !project <name> for friends. */
export function projectsCommand(S, arg = '', prefix = '!') {
  const list = projectsOf(S);
  const a = String(arg || '').trim();
  if (!a) return renderProjectList(S, { limit: 0 });
  const p = findProject(a, list, { loose: true }) || list.find((x) => projectKey(x).includes(a.toLowerCase().replace(/[^a-z0-9]+/g, '')) && a.replace(/[^a-z0-9]/gi, '').length >= 3);
  return p ? renderProject(S, p) : `🤔 No project called "${a.slice(0, 40)}". Send ${prefix}projects for the full list.`;
}
