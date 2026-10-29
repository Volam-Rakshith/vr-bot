// VR Bot — built-in Indian festival calendar. © VR DEVELOPMENTS
// Dates checked in Oct 2026 against drikpanchang.com, timeanddate.com, publicholidays.in and news reports.
// lunar: true  → date follows the lunar/Islamic calendar. These are announced each year and can
//                shift by a day (Eid depends on moon sighting). Check them every January in the panel
//                (Festivals → tap a festival → edit date) before relying on them.
export const FESTIVALS = [
  { id: 'new-year',        name: 'New Year',              emoji: '🎆', lunar: false, dates: { 2026: '2026-01-01', 2027: '2027-01-01', 2028: '2028-01-01' } },
  { id: 'sankranti',       name: 'Makar Sankranti / Pongal', emoji: '🪁', lunar: false, dates: { 2026: '2026-01-14', 2027: '2027-01-15' }, note: 'Solar festival; 2027 observed 15 Jan (transit 14 Jan).' },
  { id: 'republic-day',    name: 'Republic Day',          emoji: '🇮🇳', lunar: false, dates: { 2026: '2026-01-26', 2027: '2027-01-26', 2028: '2028-01-26' } },
  { id: 'maha-shivaratri', name: 'Maha Shivaratri',       emoji: '🔱', lunar: true,  dates: { 2026: '2026-02-15', 2027: '2027-03-06' } },
  { id: 'holi',            name: 'Holi',                  emoji: '🎨', lunar: true,  dates: { 2026: '2026-03-04', 2027: '2027-03-22' } },
  { id: 'ugadi',           name: 'Ugadi',                 emoji: '🌿', lunar: true,  dates: { 2026: '2026-03-19', 2027: '2027-04-07' } },
  { id: 'eid-ul-fitr',     name: 'Eid ul-Fitr (Ramzan)',  emoji: '🌙', lunar: true,  dates: { 2026: '2026-03-21', 2027: '2027-03-10' }, note: 'Moon sighting decides; 2027 date is tentative.' },
  { id: 'rama-navami',     name: 'Sri Rama Navami',       emoji: '🏹', lunar: true,  dates: { 2026: '2026-03-26', 2027: '2027-04-15' } },
  { id: 'bakrid',          name: 'Bakrid (Eid al-Adha)',  emoji: '🌙', lunar: true,  dates: { 2026: '2026-05-28', 2027: '2027-05-17' }, note: 'Moon sighting decides; 2027 date is tentative.' },
  { id: 'independence-day',name: 'Independence Day',      emoji: '🇮🇳', lunar: false, dates: { 2026: '2026-08-15', 2027: '2027-08-15', 2028: '2028-08-15' } },
  { id: 'raksha-bandhan',  name: 'Raksha Bandhan',        emoji: '🧵', lunar: true,  dates: { 2026: '2026-08-28', 2027: '2027-08-17' } },
  { id: 'janmashtami',     name: 'Krishna Janmashtami',   emoji: '🦚', lunar: true,  dates: { 2026: '2026-09-04', 2027: '2027-08-25' } },
  { id: 'ganesh-chaturthi',name: 'Ganesh Chaturthi',      emoji: '🐘', lunar: true,  dates: { 2026: '2026-09-14', 2027: '2027-09-04' } },
  { id: 'gandhi-jayanti',  name: 'Gandhi Jayanti',        emoji: '🕊️', lunar: false, dates: { 2026: '2026-10-02', 2027: '2027-10-02', 2028: '2028-10-02' } },
  { id: 'bathukamma',      name: 'Saddula Bathukamma',    emoji: '🌸', lunar: true,  dates: { 2026: '2026-10-18', 2027: '2027-10-08' } },
  { id: 'dussehra',        name: 'Dussehra / Vijayadashami', emoji: '🏹', lunar: true, dates: { 2026: '2026-10-20', 2027: '2027-10-09' } },
  { id: 'diwali',          name: 'Diwali',                emoji: '🪔', lunar: true,  dates: { 2026: '2026-11-08', 2027: '2027-10-29' } },
  { id: 'guru-nanak',      name: 'Guru Nanak Jayanti',    emoji: '🙏', lunar: true,  dates: { 2026: '2026-11-24', 2027: '2027-11-14' } },
  { id: 'christmas',       name: 'Christmas',             emoji: '🎄', lunar: false, dates: { 2026: '2026-12-25', 2027: '2027-12-25', 2028: '2028-12-25' } },
];

export const DEFAULT_FESTIVAL_MESSAGES = {
  'new-year': 'Happy New Year {name|}! 🎆 Wishing you a fantastic {year} ✨',
  sankranti: 'Happy Sankranti {name|}! 🪁 May this harvest festival bring you joy and prosperity.',
  'republic-day': 'Happy Republic Day! 🇮🇳 Jai Hind!',
  holi: 'Happy Holi {name|}! 🎨 May your life be as colourful as today.',
  ugadi: 'Happy Ugadi {name|}! 🌿 Wishing you a sweet new year ahead.',
  diwali: 'Happy Diwali {name|}! 🪔 May the festival of lights fill your home with happiness.',
  dussehra: 'Happy Dussehra {name|}! 🏹 May good always win in your life.',
  'ganesh-chaturthi': 'Happy Ganesh Chaturthi {name|}! 🐘 Ganpati Bappa Morya!',
  christmas: 'Merry Christmas {name|}! 🎄',
};

/**
 * Merge built-in dates with your edits/custom occasions.
 * userFest (data/festivals.json): { items: { "<id>": { enabled, time, message, to: [...], dates: {2027:"..."}, header } },
 *                                   custom: [ { id, name, emoji, dates: {...}, enabled, time, message, to } ] }
 */
export function mergedFestivals(userFest = {}) {
  const items = userFest.items || {};
  const out = FESTIVALS.map((f) => {
    const u = items[f.id] || {};
    return { ...f, builtin: true, ...u, dates: { ...f.dates, ...(u.dates || {}) } };
  });
  for (const c of userFest.custom || []) out.push({ lunar: false, emoji: '🎉', ...c, builtin: false, dates: c.dates || {} });
  return out;
}

/** Date of festival f in year y, or null. */
export function festivalDate(f, year) { return (f.dates || {})[year] || null; }

/** Upcoming festivals from a local date, soonest first. */
export function upcomingFestivals(list, fromDate, limit = 5) {
  const y = +fromDate.slice(0, 4);
  const rows = [];
  for (const f of list) for (const yr of [y, y + 1]) {
    const d = festivalDate(f, yr);
    if (d && d >= fromDate) { rows.push({ ...f, date: d }); break; }
  }
  return rows.sort((a, b) => a.date.localeCompare(b.date)).slice(0, limit);
}
