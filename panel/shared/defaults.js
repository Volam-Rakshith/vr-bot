// VR Bot — default settings. Anything missing in data/settings.json falls back to these.
// © VR DEVELOPMENTS
export const DEFAULT_SETTINGS = {
  version: 1,
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
    maxRunMinutes: 85,      // hard stop for one run (the workflow step times out at 95)
    relay: true,            // start the next run early when a message is due soon (protects exact timing)
  },
  features: {
    scheduled: true, groupScheduler: true, birthdays: true, festivals: true,
    autoReply: true, ai: false, away: false, broadcast: true, groupTools: true,
    commands: true, voiceToText: false, mediaSave: false, alerts: true,
    followup: false, summary: true, failureAlerts: true,
  },
  replies: { maxAgeHours: 6, skipIfIReplied: true },
  ai: {
    model: 'openai/gpt-oss-120b',
    stylePrompt: "You are replying on WhatsApp as Rakshith, an 18-year-old AIML diploma student from Hyderabad who runs VR DEVELOPMENTS. Reply short, friendly and casual, mix a little Telugu/Hinglish when the other person does. Never make promises about money, meetings or dates — say you'll confirm later.",
    examples: [
      { them: 'Hi bro, what are you doing?', me: 'Hey! Just working on a project 💻 what about you?' },
      { them: 'Are you coming tomorrow?', me: "Not sure yet, I'll confirm by tonight 👍" },
    ],
    who: 'contacts',        // everyone | contacts | tags
    tags: [],
    exclude: [],            // contact ids that never get AI replies
    memory: 8,              // remember the last N messages per chat
    maxPerChatPerDay: 15,
  },
  away: {
    message: "Hey! I'm away right now 🙂 I'll reply when I'm back.",
    window: { enabled: true, from: '23:00', to: '07:00' }, // auto-away at night; switch off for "always away"
    onceEveryHours: 6,
  },
  broadcast: { minGapSeconds: 8, maxGapSeconds: 20, dailyCap: 60 },
  commands: {
    prefix: '!',
    allow: 'everyone',      // everyone | contacts | owner
    inGroups: true,
    enabled: { help: true, weather: true, sticker: true, pdf: true, yt: false, tagall: true, rules: true },
  },
  voice: { sendTo: 'owner', maxSeconds: 300 }, // owner = transcript goes to you; chat = reply in that chat
  media: { statuses: false, chats: true, maxFileMB: 3, totalCapMB: 300, types: ['image', 'audio', 'video', 'document'] },
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
};

export function isObj(x) { return x && typeof x === 'object' && !Array.isArray(x); }
export function deepMerge(base, over) {
  if (!isObj(base)) return over === undefined ? base : over;
  const out = { ...base };
  for (const [k, v] of Object.entries(over || {})) out[k] = isObj(v) && isObj(base[k]) ? deepMerge(base[k], v) : v;
  return out;
}
export function withDefaults(settings) { return JSON.parse(JSON.stringify(deepMerge(DEFAULT_SETTINGS, settings || {}))); } // deep copy: never mutate the defaults

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
