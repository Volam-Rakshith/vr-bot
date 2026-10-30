// VR Bot — "Special days": festivals, national days and world days that get an IMAGE CARD as your
// WhatsApp status (instead of the daily quote). Pure ES module, shared by the bot and the panel.
// © VR DEVELOPMENTS
//
// Every date below was checked on 30 Oct 2026. Sources (one per lunar date, as noted per entry):
//   drik  = drikpanchang.com festival calendar, location Hyderabad (geoname 1269843)
//   tad   = timeanddate.com/holidays/india
//   phin  = publicholidays.in/telangana (Telangana list)
//   nsi   = National Savings Institute (nsiindia.gov.in) — World Thrift/Savings Day is 30 Oct in India
//   fixed = same date every year (or "nth Sunday" rule, computed)
// approx: Islamic dates depend on the moon being seen in India the evening before: can move ±1 day.
//          If WhatsApp friends are celebrating a day later, turn the day off in the panel (or edit the date
//          in data later). Lunar Hindu dates are from the panchang and don't move.
//
// settings.autoStatus.special = {
//   enabled: true,              // "Special days" switch (only works while Auto status is ON)
//   offDays: true,              // "Post special days even on my off days"
//   items: { "<id>": { off: true, caption: "…" } }   // per-day switch + your own caption
// }

/** kind: festival | national | world. prio: higher wins when two days fall on the same date. */
export const SPECIAL_DAYS = [
  // ---- January ----
  { id: 'new-year', name: 'New Year', kind: 'world', prio: 5, motif: 'fireworks',
    dates: { 2026: '2026-01-01', 2027: '2027-01-01' }, src: 'fixed',
    title: 'Happy New Year', line: 'New year, new goals. Let\u2019s make it count.', caption: 'Happy New Year! \u2728\ud83c\udf86 Let\u2019s make it count.' },
  { id: 'youth-day', name: 'National Youth Day', kind: 'national', prio: 3, motif: 'sunrise',
    dates: { 2026: '2026-01-12', 2027: '2027-01-12' }, src: 'fixed (Swami Vivekananda Jayanti, 12 Jan)',
    title: 'National Youth Day', line: 'Arise, awake, and stop not till the goal is reached.', caption: 'Happy National Youth Day \ud83d\udd25 \u201cArise, awake, and stop not till the goal is reached.\u201d \u2014 Swami Vivekananda' },
  { id: 'sankranti', name: 'Sankranti / Pongal', kind: 'festival', prio: 9, motif: 'kites',
    dates: { 2026: '2026-01-14', 2027: '2027-01-15' }, src: 'drik (2026: 14 Jan; 2027: 15 Jan, Sun enters Makara 9:14 PM on 14 Jan); tad lists both',
    title: 'Happy Sankranti', line: 'Kites up, worries down. Wishing you a sweet harvest season.', caption: 'Happy Sankranti & Pongal! \ud83e\ude81\ud83c\udf3e' },
  { id: 'republic-day', name: 'Republic Day', kind: 'national', prio: 8, motif: 'tricolour',
    dates: { 2026: '2026-01-26', 2027: '2027-01-26' }, src: 'fixed',
    title: 'Happy Republic Day', line: 'Proud of our Constitution. Proud to be Indian.', caption: 'Happy Republic Day \ud83c\uddee\ud83c\uddf3 Jai Hind!' },
  // ---- February / March ----
  { id: 'maha-shivaratri', name: 'Maha Shivaratri', kind: 'festival', prio: 9, motif: 'crescent-trident',
    dates: { 2026: '2026-02-15', 2027: '2027-03-06' }, src: 'drik (2026-02-15, 2027-03-06); phin agrees',
    title: 'Happy Maha Shivaratri', line: 'May Lord Shiva bless you with strength and peace.', caption: 'Happy Maha Shivaratri \ud83d\udd31 Om Namah Shivaya' },
  { id: 'science-day', name: 'National Science Day', kind: 'national', prio: 3, motif: 'atom',
    dates: { 2026: '2026-02-28', 2027: '2027-02-28' }, src: 'fixed (Raman Effect, 28 Feb)',
    title: 'National Science Day', line: 'Stay curious. Every big idea starts with a question.', caption: 'Happy National Science Day \ud83d\udd2c Stay curious!' },
  { id: 'holi', name: 'Holi', kind: 'festival', prio: 9, motif: 'colours',
    dates: { 2026: '2026-03-04', 2027: '2027-03-22' }, src: 'drik (Rangwali Holi 2026-03-04 / 2027-03-22; Holika Dahan the evening before)',
    title: 'Happy Holi', line: 'May your life be as bright as today\u2019s colours.', caption: 'Happy Holi! \ud83c\udfa8\ud83c\udf08' },
  { id: 'womens-day', name: 'Women\u2019s Day', kind: 'world', prio: 4, motif: 'flower',
    dates: { 2026: '2026-03-08', 2027: '2027-03-08' }, src: 'fixed',
    title: 'Happy Women\u2019s Day', line: 'To the women who inspire, lead and lift others up.', caption: 'Happy International Women\u2019s Day \ud83d\udc9c' },
  { id: 'ugadi', name: 'Ugadi', kind: 'festival', prio: 9, motif: 'toran',
    dates: { 2026: '2026-03-19', 2027: '2027-04-07' }, src: 'drik (2026-03-19, 2027-04-07); tad agrees (Apr 7, 2027)',
    title: 'Happy Ugadi', line: 'A sweet new year of health, success and happiness.', caption: 'Ugadi Subhakankshalu! \ud83c\udf3f Happy Ugadi' },
  { id: 'eid-ul-fitr', name: 'Eid al-Fitr (Ramzan)', kind: 'festival', prio: 9, motif: 'crescent',
    dates: { 2026: '2026-03-21', 2027: '2027-03-10' }, approx: '\u00b11 day (moon sighting)',
    src: '2026-03-21 tad + phin; 2027-03-10 tad (tentative) + phin, final only when the moon is seen',
    title: 'Eid Mubarak', line: 'Wishing you peace, joy and blessings this Ramzan.', caption: 'Eid Mubarak! \ud83c\udf19\u2728' },
  { id: 'ram-navami', name: 'Sri Rama Navami', kind: 'festival', prio: 9, motif: 'sun',
    dates: { 2026: '2026-03-26', 2027: '2027-04-15' }, src: 'drik (Smarta 2026-03-26; 2027-04-15); phin agrees',
    title: 'Happy Sri Rama Navami', line: 'May Lord Rama guide you on the path of truth.', caption: 'Happy Sri Rama Navami \ud83c\udff9 Jai Shri Ram' },
  // ---- April / May / June ----
  { id: 'earth-day', name: 'Earth Day', kind: 'world', prio: 2, motif: 'globe',
    dates: { 2026: '2026-04-22', 2027: '2027-04-22' }, src: 'fixed',
    title: 'Happy Earth Day', line: 'There is no planet B. Let\u2019s take care of this one.', caption: 'Happy Earth Day \ud83c\udf0d' },
  { id: 'mothers-day', name: 'Mother\u2019s Day', kind: 'world', prio: 4, motif: 'heart',
    dates: { 2026: '2026-05-10', 2027: '2027-05-09' }, src: 'fixed rule (2nd Sunday of May)',
    title: 'Happy Mother\u2019s Day', line: 'For the one who believed in me first. Love you, Amma.', caption: 'Happy Mother\u2019s Day \u2764\ufe0f Love you Amma' },
  { id: 'eid-al-adha', name: 'Bakrid (Eid al-Adha)', kind: 'festival', prio: 9, motif: 'crescent',
    dates: { 2026: '2026-05-28', 2027: '2027-05-17' }, approx: '\u00b11 day (moon sighting)',
    src: '2026-05-28 tad + Economic Times (moon not seen on 26 May, so 28 not 27); 2027-05-17 tad (tentative) + phin',
    title: 'Eid al-Adha Mubarak', line: 'May this Bakrid bring peace and blessings to all.', caption: 'Bakrid Mubarak! \ud83c\udf19' },
  { id: 'telangana-day', name: 'Telangana Formation Day', kind: 'national', prio: 7, motif: 'telangana',
    dates: { 2026: '2026-06-02', 2027: '2027-06-02' }, src: 'fixed (state formed 2 Jun 2014)',
    title: 'Happy Telangana Formation Day', line: 'Proud of my state. Proud of my roots.', caption: 'Happy Telangana Formation Day! \ud83d\udc9a Jai Telangana' },
  { id: 'environment-day', name: 'World Environment Day', kind: 'world', prio: 2, motif: 'leaves',
    dates: { 2026: '2026-06-05', 2027: '2027-06-05' }, src: 'fixed',
    title: 'World Environment Day', line: 'Plant a tree. Save water. Small steps, big change.', caption: 'Happy World Environment Day \ud83c\udf31' },
  { id: 'fathers-day', name: 'Father\u2019s Day', kind: 'world', prio: 4, motif: 'heart',
    dates: { 2026: '2026-06-21', 2027: '2027-06-20' }, src: 'fixed rule (3rd Sunday of June)',
    title: 'Happy Father\u2019s Day', line: 'My first hero, my biggest support. Love you, Nanna.', caption: 'Happy Father\u2019s Day \u2764\ufe0f Love you Nanna' },
  { id: 'yoga-day', name: 'International Yoga Day', kind: 'world', prio: 3, motif: 'lotus',
    dates: { 2026: '2026-06-21', 2027: '2027-06-21' }, src: 'fixed',
    title: 'International Yoga Day', line: 'Calm mind, strong body, better life.', caption: 'Happy International Yoga Day \ud83e\uddd8' },
  // ---- August / September ----
  { id: 'friendship-day', name: 'Friendship Day', kind: 'world', prio: 4, motif: 'rings',
    dates: { 2026: '2026-08-02', 2027: '2027-08-01' }, src: 'fixed rule (1st Sunday of August, as celebrated in India)',
    title: 'Happy Friendship Day', line: 'To the friends who make every day better.', caption: 'Happy Friendship Day \ud83e\udd1d' },
  { id: 'independence-day', name: 'Independence Day', kind: 'national', prio: 8, motif: 'tricolour',
    dates: { 2026: '2026-08-15', 2027: '2027-08-15' }, src: 'fixed',
    title: 'Happy Independence Day', line: 'Freedom in our minds, faith in our words, pride in our hearts.', caption: 'Happy Independence Day \ud83c\uddee\ud83c\uddf3 Jai Hind!' },
  { id: 'raksha-bandhan', name: 'Raksha Bandhan', kind: 'festival', prio: 9, motif: 'rakhi',
    dates: { 2026: '2026-08-28', 2027: '2027-08-17' }, src: 'drik (2026-08-28, 2027-08-17)',
    title: 'Happy Raksha Bandhan', line: 'A thread of love, a promise for life.', caption: 'Happy Raksha Bandhan \ud83e\udea2\u2764\ufe0f' },
  { id: 'janmashtami', name: 'Krishna Janmashtami', kind: 'festival', prio: 9, motif: 'peacock',
    dates: { 2026: '2026-09-04', 2027: '2027-08-25' }, src: 'drik (2026-09-04, 2027-08-25); phin agrees',
    title: 'Happy Janmashtami', line: 'May Lord Krishna fill your life with love and joy.', caption: 'Happy Krishna Janmashtami \ud83e\udd9a' },
  { id: 'teachers-day', name: 'Teachers\u2019 Day', kind: 'national', prio: 5, motif: 'book',
    dates: { 2026: '2026-09-05', 2027: '2027-09-05' }, src: 'fixed (Dr. S. Radhakrishnan, 5 Sep)',
    title: 'Happy Teachers\u2019 Day', line: 'Thank you to every teacher who believed in me.', caption: 'Happy Teachers\u2019 Day \ud83d\ude4f Thank you to all my teachers' },
  { id: 'ganesh-chaturthi', name: 'Ganesh Chaturthi', kind: 'festival', prio: 9, motif: 'marigold',
    dates: { 2026: '2026-09-14', 2027: '2027-09-04' }, src: 'drik (2026-09-14, 2027-09-04); phin agrees',
    title: 'Happy Ganesh Chaturthi', line: 'Ganpati Bappa Morya! May all obstacles fade away.', caption: 'Happy Vinayaka Chavithi \ud83d\ude4f Ganpati Bappa Morya!' },
  { id: 'engineers-day', name: 'Engineers\u2019 Day', kind: 'national', prio: 5, motif: 'gear',
    dates: { 2026: '2026-09-15', 2027: '2027-09-15' }, src: 'fixed (Sir M. Visvesvaraya, 15 Sep)',
    title: 'Happy Engineers\u2019 Day', line: 'To everyone who turns ideas into things that work.', caption: 'Happy Engineers\u2019 Day \u2699\ufe0f Turning ideas into innovation' },
  // ---- October ----
  { id: 'bathukamma', name: 'Bathukamma (first day)', kind: 'festival', prio: 9, motif: 'bathukamma',
    dates: { 2026: '2026-10-10', 2027: '2027-09-29' },
    src: 'Engili Pula Bathukamma = Mahalaya Amavasya: drik Sarva Pitru Amavasya 2026-10-10, 2027-09-29 (phin lists 2027-09-30 as the holiday)',
    title: 'Happy Bathukamma', line: 'Nine days of flowers, songs and togetherness.', caption: 'Happy Bathukamma! \ud83c\udf38\ud83c\udf3c' },
  { id: 'gandhi-jayanti', name: 'Gandhi Jayanti', kind: 'national', prio: 8, motif: 'glasses',
    dates: { 2026: '2026-10-02', 2027: '2027-10-02' }, src: 'fixed',
    title: 'Gandhi Jayanti', line: 'Be the change you wish to see in the world.', caption: 'Remembering Bapu on Gandhi Jayanti \ud83d\udd4a\ufe0f' },
  { id: 'dussehra', name: 'Dussehra / Vijayadashami', kind: 'festival', prio: 9, motif: 'bow',
    dates: { 2026: '2026-10-20', 2027: '2027-10-09' }, src: 'drik (2026-10-20, 2027-10-09); tad agrees (Oct 9, 2027)',
    title: 'Happy Dussehra', line: 'May good always win. Happy Vijayadashami.', caption: 'Happy Dasara! \ud83c\udff9\u2728' },
  { id: 'kalam-day', name: 'Dr. Kalam\u2019s Birthday', kind: 'national', prio: 3, motif: 'rocket',
    dates: { 2026: '2026-10-15', 2027: '2027-10-15' }, src: 'fixed (Dr. A.P.J. Abdul Kalam, born 15 Oct 1931)',
    title: 'Remembering Dr. Kalam', line: 'The Missile Man who taught India to dream big.', caption: 'Remembering Dr. A.P.J. Abdul Kalam on his birthday \ud83d\ude80 Dream big.' },
  { id: 'savings-day', name: 'World Savings Day', kind: 'world', prio: 2, motif: 'coins',
    dates: { 2026: '2026-10-30', 2027: '2027-10-30' }, src: 'nsi (in India observed 30 Oct; 31 Oct elsewhere)',
    title: 'World Savings Day', line: 'Small savings today, big dreams tomorrow.', caption: 'Happy World Savings Day \ud83d\udcb0 Small savings today, big dreams tomorrow.' },
  { id: 'diwali', name: 'Diwali', kind: 'festival', prio: 10, motif: 'diya',
    dates: { 2026: '2026-11-08', 2027: '2027-10-29' }, src: 'drik Lakshmi Puja (2026-11-08, 2027-10-29); tad agrees (Oct 29, 2027)',
    title: 'Happy Diwali', line: 'May the festival of lights fill your home with joy.', caption: 'Happy Diwali! \ud83e\ude94\u2728' },
  // ---- November / December ----
  { id: 'childrens-day', name: 'Children\u2019s Day', kind: 'national', prio: 4, motif: 'balloons',
    dates: { 2026: '2026-11-14', 2027: '2027-11-14' }, src: 'fixed',
    title: 'Happy Children\u2019s Day', line: 'Never stop being curious. Never stop playing.', caption: 'Happy Children\u2019s Day \ud83c\udf88' },
  { id: 'christmas', name: 'Christmas', kind: 'festival', prio: 9, motif: 'tree',
    dates: { 2026: '2026-12-25', 2027: '2027-12-25' }, src: 'fixed',
    title: 'Merry Christmas', line: 'Peace, love and joy to you and your family.', caption: 'Merry Christmas! \ud83c\udf84\u2728' },
];

export const SPECIAL_BY_ID = Object.fromEntries(SPECIAL_DAYS.map((d) => [d.id, d]));

/** Where the card picture lives: repo path (bot) and the panel-relative path (GitHub Pages). */
export const cardFile = (id) => `panel/days/${id}.png`;
export const cardUrl = (id) => `days/${id}.png`;

/** settings.autoStatus.special with defaults filled in. */
export function specialConfig(autoStatus = {}) {
  const s = autoStatus.special || {};
  return { enabled: s.enabled !== false, offDays: s.offDays !== false, items: s.items && typeof s.items === 'object' ? s.items : {} };
}

/** Is this day switched on? (per-day switch in the panel) */
export const dayOn = (cfg, id) => !(cfg.items?.[id]?.off);

/** The caption that goes under the picture (your own one if you wrote it). */
export function specialCaption(day, cfg = {}) {
  const own = String(cfg.items?.[day.id]?.caption || '').trim();
  return own || day.caption;
}

/** All special days on a local date "YYYY-MM-DD", highest priority first (ignores switches). */
export function specialsOn(date) {
  const y = String(date).slice(0, 4);
  return SPECIAL_DAYS.filter((d) => d.dates[y] === date).sort((a, b) => b.prio - a.prio);
}

/**
 * The ONE special day to post on this local date, or null.
 * null when the feature is off, or every day on that date is switched off.
 * If two days share a date (e.g. Father's Day + Yoga Day), the higher prio wins; if you switched that one off, the next.
 */
export function specialFor(date, autoStatus = {}) {
  const cfg = specialConfig(autoStatus);
  if (!autoStatus.enabled || !cfg.enabled) return null;
  return specialsOn(date).find((d) => dayOn(cfg, d.id)) || null;
}

/** Upcoming special days from a local date for `days` days: [{ ...day, date, on, caption, clash }] soonest first. */
export function upcomingSpecials(fromDate, days = 60, autoStatus = {}) {
  const cfg = specialConfig(autoStatus);
  const end = addDaysISO(fromDate, days);
  const rows = [];
  for (const d of SPECIAL_DAYS) for (const date of Object.values(d.dates)) {
    if (date >= fromDate && date <= end) rows.push({ ...d, date, on: dayOn(cfg, d.id), caption: specialCaption(d, cfg) });
  }
  rows.sort((a, b) => a.date.localeCompare(b.date) || b.prio - a.prio);
  // clash = another (higher, switched-on) day on the same date wins over this one
  for (const r of rows) { const win = specialFor(r.date, { enabled: true, special: { ...cfg, enabled: true } }); r.clash = win && win.id !== r.id ? win.name : ''; }
  return rows;
}

/** Local dates (in range) that have a special day switched on — the bot posts on these even on "off" days. */
export function specialDatesBetween(fromDate, toDate, autoStatus = {}) {
  const out = [];
  for (const d of SPECIAL_DAYS) for (const date of Object.values(d.dates)) {
    if (date >= fromDate && date <= toDate && !out.includes(date) && specialFor(date, autoStatus)) out.push(date);
  }
  return out.sort();
}

function addDaysISO(date, n) {
  const t = Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10)) + n * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}
