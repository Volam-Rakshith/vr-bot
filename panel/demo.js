// VR Bot panel — demo data (used by "Try the demo"; nothing is saved or sent). © VR DEVELOPMENTS
const now = Date.now();
const m = 60000, h = 3600000, d = 86400000;
export const DEMO = {
  files: {
    settings: { version: 2, myName: 'Rakshith', timezone: 'Asia/Kolkata', features: { ai: true, away: true, followup: true },
      busy: { who: 'pick', contacts: ['c3'], tags: ['friends'], groups: ['120363000000000001@g.us'] },
      autoStatus: { enabled: true, time: '07:30', days: [0, 1, 2, 3, 4, 5, 6], mode: 'quote', audience: 'except', tags: ['clients'] } },
    contacts: { contacts: [
      { id: 'c1', name: 'Amma', number: '+91 98480 00001', birthday: '1980-03-12', tags: ['family'], header: 'off' },
      { id: 'c2', name: 'Nanna', number: '+91 98480 00002', birthday: '1976-07-21', tags: ['family'] },
      { id: 'c3', name: 'Saiteja', number: '+91 90000 00003', birthday: '2007-11-02', tags: ['friends', 'class'] },
      { id: 'c4', name: 'Harsha', number: '+91 90000 00004', birthday: '05-19', tags: ['friends'] },
      { id: 'c5', name: 'Ravi (client)', number: '+91 90000 00005', tags: ['clients'], header: 'on' },
    ] },
    templates: { templates: [
      { id: 't1', name: 'Good morning', text: '{{Good morning|Morning|Gm}} {first_name} ☀️ Have a great {day}!' },
      { id: 't2', name: 'Exam reminder', text: '📚 Reminder: exam on {date}. All the best! 💪' },
    ] },
    schedules: { schedules: [
      { id: 's1', name: 'Good morning Amma', enabled: true, to: [{ type: 'contact', id: 'c1' }], templateId: 't1', message: '', time: '07:00', repeat: { type: 'daily' }, skipDays: [0], skipDates: [], start: null, end: null, humanDelay: { enabled: false, minutes: 3 }, header: 'default' },
      { id: 's2', name: 'AIML class — attendance', enabled: true, to: [{ type: 'group', id: '120363000000000001@g.us', name: 'AIML 2nd Year' }], message: '⏰ Classes start at 9:30 today. Don\'t be late!', time: '08:30', repeat: { type: 'weekly', days: [1, 2, 3, 4, 5] }, skipDays: [], skipDates: [], start: null, end: null, humanDelay: { enabled: false, minutes: 3 }, header: 'default' },
      { id: 's3', name: 'Exam reminder to friends', enabled: true, to: [{ type: 'tag', tag: 'friends' }], templateId: 't2', message: '', time: '19:00', repeat: { type: 'once', date: new Date(now + 9 * d).toISOString().slice(0, 10) }, skipDays: [], skipDates: [], start: null, end: null, humanDelay: { enabled: true, minutes: 5 }, header: 'default' },
      { id: 's4', name: 'Recharge reminder', enabled: false, to: [{ type: 'owner' }], message: '📱 Recharge your mobile today.', time: '10:00', repeat: { type: 'monthly', day: 1 }, skipDays: [], skipDates: [], start: null, end: null, humanDelay: { enabled: false, minutes: 3 }, header: 'default' },
    ] },
    festivals: { defaultTime: '00:00', items: { diwali: { enabled: true, time: '07:00', to: [{ type: 'tag', tag: 'family' }, { type: 'tag', tag: 'friends' }], message: 'Happy Diwali {first_name|}! 🪔 — {my_name}' }, 'new-year': { enabled: true, time: '00:00', to: [{ type: 'tag', tag: 'friends' }], message: 'Happy New Year {first_name|}! 🎆' } }, custom: [] },
    rules: { rules: [
      { id: 'r1', enabled: true, match: 'contains', pattern: 'price, cost, rate', reply: 'Hi {first_name|}! 👋 Share what you need and I\'ll send a quote soon. — VR DEVELOPMENTS', where: 'private', contacts: [], tags: [], exclude: [], cooldownMinutes: 360 },
    ] },
    groups: { groups: { '120363000000000001@g.us': { name: 'AIML 2nd Year', welcome: { enabled: true, message: 'Welcome {name} to {group}! 👋' }, antiLink: { enabled: true, action: 'warn', warnLimit: 3, allowDomains: ['github.com'] }, rulesText: 'Be respectful. No spam.', tagallAdminsOnly: true } } },
  },
  state: {
    status: {
      session: { status: 'ok', me: '+91******979', lastOk: now - 12 * m },
      lastRun: { startedAt: now - 14 * m, endedAt: now - 12 * m, ok: true, sent: 2, failed: 0, received: 7, trigger: 'schedule' },
      runs: [...Array(8)].map((_, i) => ({ startedAt: now - (i * 30 + 14) * m, endedAt: now - (i * 30 + 12) * m, ok: i !== 5, sent: i % 3, failed: i === 5 ? 1 : 0, received: (i * 3) % 7, trigger: i % 4 === 0 ? 'manual:run' : 'schedule' })).reverse(),
      groups: [{ id: '120363000000000001@g.us', name: 'AIML 2nd Year', size: 64, admin: true }, { id: '120363000000000002@g.us', name: 'Family ❤️', size: 12, admin: false }],
      inbox: { date: null, people: {} }, media: [],
    },
    sentlog: { entries: {
      a: { t: now - 3 * h, s: 'sent', k: 'personal', label: 'Good morning Amma', to: 'Amma', lateSec: 2 },
      b: { t: now - 2.5 * h, s: 'sent', k: 'group', label: 'AIML class — attendance', to: 'AIML 2nd Year', lateSec: 1 },
      c: { t: now - 1 * d, s: 'sent', k: 'birthday', label: 'Birthday wish · Harsha', to: 'Harsha', lateSec: 0 },
      e: { t: now - 26 * h, s: 'failed', k: 'personal', label: 'Hello to new number', to: '+91******123', err: 'number is not on WhatsApp' },
    } },
    logs: { entries: [{ t: now - 13 * m, level: 'ok', msg: 'Connected as +91******979' }, { t: now - 12 * m, level: 'info', msg: 'Handled 7 new message(s)' }] },
  },
  runs: [{ created_at: new Date(now - 14 * m).toISOString(), status: 'completed', conclusion: 'success', html_url: '#' }],
};
