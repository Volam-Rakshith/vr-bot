// VR Bot — default settings. Anything missing in data/settings.json falls back to these.
// © VR DEVELOPMENTS
export const DEFAULT_SETTINGS = {
  version: 2, // 2 = per-chat/per-group controls (commands default to "only me")
  botName: 'VR Bot',
  myName: 'Rakshith',
  timezone: 'Asia/Kolkata',
  paused: false, // master pause: nothing is sent while true
  header: {
    enabled: true,
    text: '🤖 *VR Bot* is sending:',
    // Default per kind of message. Every schedule and contact can override (on/off/default).
    defaults: {
      personal: false, birthday: false, festival: false, followup: false,
      group: true, broadcast: true, alert: true, summary: true, reply: false, ai: true,
    },
  },
  humanDelay: { minutes: 3 }, // used only by schedules where you switch "human-like delay" on
  timing: {
    lookaheadMinutes: 45,   // each run handles messages due in the next N minutes (it waits and sends on the minute)
    lateGraceMinutes: 180,  // if GitHub starts very late, still send messages that are up to N minutes overdue
    minOnlineSeconds: 60,   // stay connected at least this long to read new messages
    maxRunMinutes: 85,      // one run's life; with Always on it hands over to the next run from minute 75 (step times out at 95)
    relay: true,            // "Always on": each run stays connected and starts the next one before it ends (src/chain.js)
  },
  features: {
    scheduled: true, groupScheduler: true, birthdays: true, festivals: true,
    autoReply: true, ai: false, away: false, broadcast: true, groupTools: true,
    commands: true, voiceToText: false, mediaSave: false, alerts: true,
    followup: false, summary: true, failureAlerts: true,
  },
  replies: { maxAgeHours: 6, skipIfIReplied: true, stickers: false }, // stickers: also answer stickers & GIFs (off = ignore them)
  ai: {
    model: 'openai/gpt-oss-120b',
    stylePrompt: "You are replying on WhatsApp as Rakshith, an 18-year-old AIML diploma student from Hyderabad who runs VR DEVELOPMENTS. Reply short, friendly and casual, mix a little Telugu/Hinglish when the other person does. Never make promises about money, meetings or dates — say you'll confirm later.",
    examples: [
      { them: 'Hi bro, what are you doing?', me: 'Hey! Just working on a project 💻 what about you?' },
      { them: 'Are you coming tomorrow?', me: "Not sure yet, I'll confirm by tonight 👍" },
    ],
    who: 'contacts',        // private chats: everyone | contacts | pick (only these contacts/tags) | tags
    contacts: [],           // contact ids (when who = pick)
    tags: [],
    exclude: [],            // contact ids that never get AI replies
    groups: 'none',         // none | [group ids]: AI answers in those groups only when someone @mentions or replies to you
    react: false,           // also let the AI add a fitting emoji reaction (❤️ 👍 😂 😮 😢 🙏 🔥 🎉)
    memory: 8,              // remember the last N messages per chat
    maxPerChatPerDay: 15,
  },
  away: {
    message: "Hey! I'm away right now 🙂 I'll reply when I'm back.",
    window: { enabled: true, from: '23:00', to: '07:00' }, // auto-away at night; switch off for "always away"
    onceEveryHours: 6,
    who: 'everyone', contacts: [], tags: [], // who gets the away message: everyone | contacts | pick
  },
  broadcast: { minGapSeconds: 8, maxGapSeconds: 20, dailyCap: 60 },
  commands: {
    prefix: '!',
    allow: 'owner',         // private chats: owner (only me) | contacts | pick | everyone
    contacts: [], tags: [],
    inGroups: true,
    groups: 'all',          // all (same people as above) | none | [group ids] (anyone in those groups)
    enabled: { help: true, weather: true, sticker: true, pdf: true, yt: false, tagall: true, rules: true },
  },
  voice: { sendTo: 'owner', maxSeconds: 300, who: 'everyone', contacts: [], tags: [] }, // owner = transcript goes to you; chat = reply in that chat
  media: { statuses: false, chats: true, maxFileMB: 3, totalCapMB: 300, types: ['image', 'audio', 'video', 'document'],
    who: 'everyone', contacts: [], tags: [], groups: 'all' }, // whose media is saved (statuses use "who" too)
  alerts: {
    github: { enabled: true, user: 'Volam-Rakshith', repos: [], everyMinutes: 60 },
    form: { enabled: false, ntfyTopic: '' },
  },
  birthdays: {
    time: '00:00',
    message: 'Happy birthday {name}! 🎂🎉 Have an amazing year ahead!',
    remindMe: true, // also ping you on the day
  },
  followup: { days: 3, time: '10:00', message: 'Hey {first_name}, just checking in 🙂', contacts: [], tags: [] },
  summary: { time: '21:30' },
  weekly: { enabled: true, day: 0, time: '20:00' }, // weekly report to you: day 0 = Sunday. Counts only, no message text
  busy: {
    // "!busy 2h" / "!busy until 5pm" / "!busy off" on WhatsApp, or the switch in the panel (newest wins)
    message: "VR's busy right now, back by {time} 🙏",
    who: 'nobody', contacts: [], tags: [], exclude: [], // private chats that get the busy reply: nobody | pick
    groups: 'none',                                       // none | [group ids]
    groupsOnlyWhenTagged: true,                           // in groups: only when someone @mentions you or replies to you
    on: false, until: 0, setAt: 0,                        // set by the panel's Busy switch
  },
  autoStatus: {
    enabled: false, time: '08:00', days: [0, 1, 2, 3, 4, 5, 6], // all 7 days = every day
    mode: 'quote',          // quote (built-in list, no repeats) | own (your texts, in turn) | photo (https link)
    aiFresh: false,         // quote mode: let the AI write a fresh line (needs GROQ_API_KEY; falls back to the list)
    texts: [], photoUrl: '', photoCaption: '',
    color: 'rotate', font: 'rotate',
    audience: 'all',        // all (everyone in Contacts) | only (these) | except (everyone but these)
    contacts: [], tags: [],
    alsoRecent: false,      // also people who texted you in the last 30 days (all / except only)
    maxPeople: 500,         // safety cap: very big status lists fail or look like spam
    testWith: '',           // "Post test" also goes to this one contact (id); '' = only you
    // Special days (festivals, national & world days): an image card instead of the quote — see shared/specialdays.js
    special: {
      enabled: true,        // works whenever Auto status is ON
      offDays: true,        // also post on special days that are not one of your chosen days
      items: {},            // { "<day id>": { off: true, caption: "your own caption" } }
    },
  },
};

export function isObj(x) { return x && typeof x === 'object' && !Array.isArray(x); }
export function deepMerge(base, over) {
  if (!isObj(base)) return over === undefined ? base : over;
  const out = { ...base };
  for (const [k, v] of Object.entries(over || {})) out[k] = isObj(v) && isObj(base[k]) ? deepMerge(base[k], v) : v;
  return out;
}
export function withDefaults(settings) {
  const out = JSON.parse(JSON.stringify(deepMerge(DEFAULT_SETTINGS, settings || {}))); // deep copy: never mutate the defaults
  // v1 → v2: old panels saved commands.allow = "everyone" (the old default) for everyone, so strangers could
  // run !commands. From v2 the default is "only me"; pick "Everyone" again in Settings → Commands to undo.
  if (!(Number(settings?.version) >= 2)) {
    if (settings?.commands?.allow === 'everyone') out.commands.allow = 'owner';
    out.version = DEFAULT_SETTINGS.version;
  }
  return out;
}

/** Digits-only phone number with country code. "+91 79894-05979" → "917989405979". 10-digit → India (+91). */
export function normalizeNumber(n, defaultCC = '91') {
  let d = String(n || '').replace(/[^\d]/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.length === 10) d = defaultCC + d;
  if (d.length === 11 && d.startsWith('0')) d = defaultCC + d.slice(1);
  return d;
}
export function maskNumber(n) {
  const d = String(n || '').replace(/[^\d]/g, '');
  if (d.length < 6) return '***';
  return `+${d.slice(0, 2)}******${d.slice(-3)}`;
}
