// VR Bot control panel — © VR DEVELOPMENTS · "Turning Ideas Into Innovation"
// Static app: talks straight to the GitHub API with YOUR token (kept only on this phone).
// All private files are encrypted/decrypted here in the browser with your panel password.
import { encryptJSON, openData, makeLock, checkLock, isEnvelope, decryptBytes, decryptJSON, b64decode, b64encode } from './shared/crypto.js';
import { withDefaults, normalizeNumber } from './shared/defaults.js';
import { describe, nextOccurrence } from './shared/scheduler.js';
import { buildJobs, expandTargets } from './shared/planner.js';
import { renderTemplate, headerOn, KNOWN_PLACEHOLDERS } from './shared/templates.js';
import { mergedFestivals, upcomingFestivals, festivalDate } from './shared/festivals.js';
import { localDate, localTime, prettyDate, pretty12, WEEKDAYS, WEEKDAYS_FULL, MONTHS, isValidTime, isValidDate, zonedToUtc } from './shared/time.js';
import { matchText, ruleApplies, REACTIONS } from './shared/rules.js';
import { QUOTES, formatQuote } from './shared/quotes.js';
import { statusAudience, STATUS_COLORS, STATUS_FONTS } from './shared/status.js';
import { busyNow, busyText, busyTimeText } from './shared/busy.js';
import { SPECIAL_DAYS, SPECIAL_BY_ID, upcomingSpecials, specialConfig, specialFor, cardUrl } from './shared/specialdays.js';

const FILES = ['settings', 'contacts', 'schedules', 'templates', 'festivals', 'rules', 'groups'];
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = (p) => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const clone = (o) => JSON.parse(JSON.stringify(o ?? null));
const view = () => $('#view');

const S = {
  cfg: JSON.parse(localStorage.getItem('vrbot.cfg') || 'null'),
  pass: sessionStorage.getItem('vrbot.pass') || localStorage.getItem('vrbot.pass') || '',
  demo: false, files: {}, state: { status: null, sentlog: null, logs: null }, runs: [], loaded: false, hasLock: false,
};
let D = null; // the draft object of the open editor

/* ---------------- GitHub API ---------------- */
async function gh(path, { method = 'GET', body, raw = false } = {}) {
  const r = await fetch(`https://api.github.com${path}`, {
    method, cache: 'no-store',
    headers: { Authorization: `Bearer ${S.cfg.token}`, Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (r.status === 404) return null;
  if (r.status === 204) return true;
  if (!r.ok) {
    let msg = ''; try { msg = (await r.json()).message; } catch {}
    const e = new Error(r.status === 401 ? 'GitHub rejected the token (expired or wrong). Make a new one — see SETUP step 5.' : r.status === 403 ? `GitHub said "forbidden": ${msg}. Check the token has Contents + Actions "Read and write" for this repo.` : `GitHub ${r.status}: ${msg}`);
    e.status = r.status; throw e;
  }
  return raw ? r.text() : r.json();
}
const repo = () => `/repos/${S.cfg.owner}/${S.cfg.repo}`;
const branch = () => S.cfg.branch || 'main';
const utf8 = { enc: (s) => b64encode(new TextEncoder().encode(s)), dec: (b) => new TextDecoder().decode(b64decode(b.replace(/\s/g, ''))) };

const api = {
  async readData(name) {
    if (S.demo) return S.demoStore.files[name] ? { data: clone(S.demoStore.files[name]), sha: 'demo' } : null;
    const j = await gh(`${repo()}/contents/data/${name}.json?ref=${branch()}`);
    if (!j) return null;
    return { data: JSON.parse(utf8.dec(j.content)), sha: j.sha };
  },
  async writeData(name, obj, sha) {
    if (S.demo) { S.demoStore.files[name] = clone(obj); return 'demo'; }
    const put = (s) => gh(`${repo()}/contents/data/${name}.json`, { method: 'PUT', body: { message: `VR Bot panel: update ${name}`, content: utf8.enc(JSON.stringify(obj, null, 1)), branch: branch(), ...(s ? { sha: s } : {}) } });
    try { return (await put(sha)).content.sha; }
    catch (e) {
      if (e.status === 409 || e.status === 422) { const cur = await gh(`${repo()}/contents/data/${name}.json?ref=${branch()}`); return (await put(cur?.sha)).content.sha; }
      throw e;
    }
  },
  async readState(name) {
    if (S.demo) return clone(S.demoStore.state[name] || null);
    const t = await gh(`${repo()}/contents/${name}.json?ref=vr-state`, { raw: true });
    if (!t) return null;
    return decryptJSON(JSON.parse(t), S.pass);
  },
  async readMedia(path) {
    if (S.demo) throw new Error('No media in demo mode');
    const t = await gh(`${repo()}/contents/${path}?ref=vr-media`, { raw: true });
    const env = JSON.parse(t);
    return { bytes: await decryptBytes(env, S.pass), mimetype: env.mimetype };
  },
  async dispatch(inputs) {
    if (S.demo) return true;
    return gh(`${repo()}/actions/workflows/bot.yml/dispatches`, { method: 'POST', body: { ref: branch(), inputs } });
  },
  async runs() {
    if (S.demo) return S.demoStore.runs || [];
    const j = await gh(`${repo()}/actions/workflows/bot.yml/runs?per_page=6`);
    return j?.workflow_runs || [];
  },
};

/* ---------------- data access ---------------- */
const settings = () => withDefaults(S.files.settings?.data);
/** "Always on" (Settings → Timing): one run stays connected, so replies are near-instant. */
const alwaysOn = () => { const s = settings(); return s.timing.relay !== false && !s.paused; };
/** After un-pausing or switching Always on back on, start a run right away (don't wait for GitHub's timer). */
async function kickIfResumed(before, after) {
  const off = (x) => !!x.paused || x.timing?.relay === false;
  if (S.demo || !off(withDefaults(before)) || off(withDefaults(after))) return;
  try { await api.dispatch({ action: 'run' }); toast('Resumed ✓ — the bot starts in about a minute', 'ok'); } catch { toast('Saved, but could not start the bot — tap ▶ Run now', 'bad'); }
}
const contacts = () => S.files.contacts?.data?.contacts || [];
const schedules = () => S.files.schedules?.data?.schedules || [];
const templates = () => S.files.templates?.data?.templates || [];
const rules = () => S.files.rules?.data?.rules || [];
const festCfg = () => S.files.festivals?.data || {};
const groupsCfg = () => S.files.groups?.data?.groups || {};
const status = () => S.state.status || {};
const seenGroups = () => status().groups || [];
const allTags = () => [...new Set(contacts().flatMap((c) => c.tags || []))].sort();
const tz = () => settings().timezone || 'Asia/Kolkata';
const planData = () => ({ settings: settings(), contacts: contacts(), schedules: schedules(), templates: templates(), festivals: festCfg(), groups: seenGroups(), memory: {}, ownerNumber: '0000000000' });

async function loadAll() {
  const lock = await api.readData('lock');
  if (lock && isEnvelope(lock.data)) {
    const ok = await checkLock(lock.data, S.pass);
    if (ok === false) throw Object.assign(new Error('Wrong panel password. It must be exactly the same as your VR_PASSPHRASE secret.'), { code: 'BAD_PASS' });
    S.hasLock = true;
  } else S.hasLock = false;
  await Promise.all(FILES.map(async (n) => {
    const m = await api.readData(n);
    S.files[n] = m ? { data: await openData(m.data, S.pass), sha: m.sha, encrypted: isEnvelope(m.data) } : { data: {}, sha: null, encrypted: false };
  }));
  await Promise.all(['status', 'sentlog', 'logs'].map(async (n) => { try { S.state[n] = await api.readState(n); } catch (e) { if (e.code === 'BAD_PASSPHRASE') throw e; S.state[n] = null; } }));
  try { S.runs = await api.runs(); } catch { S.runs = []; }
  S.loaded = true;
}

async function save(name, data) {
  toast('Saving…');
  const env = await encryptJSON(data, S.pass);
  const sha = await api.writeData(name, env, S.files[name]?.sha);
  S.files[name] = { data, sha, encrypted: true };
  if (!S.hasLock) { const l = await api.readData('lock'); await api.writeData('lock', await makeLock(S.pass), l?.sha); S.hasLock = true; }
  toast('Saved ✓ — the bot uses it from its next check', 'ok');
}
const saveList = (name, key, list) => save(name, { ...(S.files[name]?.data || {}), [key]: list });

/* ---------------- helpers ---------------- */
let toastT;
function toast(msg, kind = '') {
  const t = $('#toast'); t.textContent = msg; t.className = `toast ${kind}`; t.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, kind === 'bad' ? 6000 : 2600);
}
function ago(ms) {
  if (!ms) return 'never';
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}
function whenText(at) {
  const d = localDate(at, tz()), today = localDate(Date.now(), tz()), tom = localDate(Date.now() + 86400000, tz());
  const day = d === today ? 'Today' : d === tom ? 'Tomorrow' : prettyDate(d).replace(/ \d{4}$/, '');
  return `${day} · ${pretty12(localTime(at, tz()))}`;
}
const toggle = (attrs, checked, label = 'Toggle') => `<span class="tg"><input type="checkbox" role="switch" aria-label="${esc(label)}" ${attrs} ${checked ? 'checked' : ''}><span></span></span>`;
const sw = (title, desc, attrs, checked, pill = '') => `<div class="switch"><div class="txt"><b>${esc(title)} ${pill}</b>${desc ? `<span>${desc}</span>` : ''}</div>${toggle(attrs, checked, title)}</div>`;
const delayedPill = () => (alwaysOn() ? '' : '<span class="pill warn tiny" title="GitHub checks every ~30 min">⏱ delayed</span>');
const seg = (field, options, value) => `<div class="seg" role="group">${options.map(([v, l]) => `<button type="button" data-seg="${field}" data-v="${esc(v)}" aria-pressed="${String(v) === String(value)}">${esc(l)}</button>`).join('')}</div>`;
const getPath = (o, p) => p.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
function setPath(o, p, v) { const ks = p.split('.'); let c = o; ks.slice(0, -1).forEach((k) => { if (c[k] == null || typeof c[k] !== 'object') c[k] = {}; c = c[k]; }); c[ks.at(-1)] = v; }
function readInput(el) {
  const t = el.dataset.type;
  if (el.type === 'checkbox') return t === 'neg' ? !el.checked : el.checked; // neg: switch ON = setting false
  if (t === 'num') return el.value === '' ? null : Number(el.value);
  if (t === 'csv') return el.value.split(',').map((x) => x.trim()).filter(Boolean);
  if (t === 'lines') return el.value.split('\n').map((x) => x.trim()).filter(Boolean);
  return el.value;
}
const exampleBadge = (x) => (x.example ? '<span class="pill cu tiny">EXAMPLE</span>' : '');

function targetLabel(t) {
  if (t.type === 'contact') return `👤 ${contacts().find((c) => c.id === t.id)?.name || 'deleted contact'}`;
  if (t.type === 'tag') return `🏷️ ${t.tag} (${contacts().filter((c) => (c.tags || []).includes(t.tag)).length})`;
  if (t.type === 'group') return `👥 ${t.name || seenGroups().find((g) => g.id === t.id)?.name || 'group'}`;
  if (t.type === 'owner') return '🙋 Me';
  return `📞 ${t.number}`;
}
function targetPicker(targets) {
  return `<div class="chips" id="targets">${(targets || []).map((t, i) => `<span class="chip on static">${esc(targetLabel(t))}<button class="x" type="button" data-act="rm-target" data-i="${i}" aria-label="Remove">×</button></span>`).join('') || '<span class="muted small">No recipients yet</span>'}</div>
  <select id="addTarget" aria-label="Add recipient" style="margin-top:8px">
    <option value="">＋ Add recipient…</option>
    <option value="owner:">🙋 Me (my own number)</option>
    <optgroup label="Contacts">${contacts().map((c) => `<option value="contact:${esc(c.id)}">${esc(c.name)}${c.example ? ' (example)' : ''}</option>`).join('')}</optgroup>
    <optgroup label="Lists (tags)">${allTags().map((t) => `<option value="tag:${esc(t)}">🏷️ ${esc(t)}</option>`).join('')}</optgroup>
    <optgroup label="Groups">${seenGroups().map((g) => `<option value="group:${esc(g.id)}">👥 ${esc(g.name)}</option>`).join('')}<option value="groupid:">👥 Group by ID…</option></optgroup>
    <option value="number:">📞 Other phone number…</option>
  </select>
  ${seenGroups().length ? '' : '<p class="hint">Your WhatsApp groups appear here after the bot\'s first run.</p>'}`;
}
function addTargetFromSelect(value, list) {
  const [type, ...rest] = value.split(':'); const v = rest.join(':');
  if (type === 'owner') list.push({ type: 'owner' });
  else if (type === 'contact') list.push({ type: 'contact', id: v });
  else if (type === 'tag') list.push({ type: 'tag', tag: v });
  else if (type === 'group') list.push({ type: 'group', id: v, name: seenGroups().find((g) => g.id === v)?.name || '' });
  else if (type === 'groupid') { const id = prompt('Group ID (ends with @g.us):'); if (id) list.push({ type: 'group', id: id.trim(), name: prompt('Name for this group:') || 'Group' }); }
  else if (type === 'number') { const n = prompt('Phone number with country code (e.g. +91 98765 43210):'); if (n) list.push({ type: 'number', number: n.trim() }); }
}
function messagePreview(text, kind, override, contactOverride, vars = {}) {
  const s = settings();
  const body = renderTemplate(text || '', { name: 'Saiteja', first_name: 'Saiteja', my_name: s.myName, date: prettyDate(localDate(Date.now(), tz())), day: WEEKDAYS_FULL[new Date().getDay()], time: pretty12(localTime(Date.now(), tz())), year: localDate(Date.now(), tz()).slice(0, 4), festival: 'Diwali', age: '19', group: 'AIML Class', ...vars }, 'preview');
  const h = headerOn(s.header, kind, override, contactOverride);
  const full = (h ? `${s.header.text}\n` : '') + (body || '…');
  return `<div class="preview"><div class="bubble">${esc(full).replace(/\*([^*\n]+)\*/g, '<b>$1</b>').replace(/_([^_\n]+)_/g, '<i>$1</i>')}<small>${pretty12(localTime(Date.now(), tz()))} ✓✓</small></div></div>`;
}
const placeholderChips = (target) => `<div class="chips" style="margin-top:6px">${KNOWN_PLACEHOLDERS.map((p) => `<button type="button" class="chip" data-act="ins" data-target="${target}" data-v="{${p}}">{${p}}</button>`).join('')}<button type="button" class="chip" data-act="ins" data-target="${target}" data-v="{{Hi|Hello|Hey}}">{{Hi|Hello}}</button></div>`;

/* ---- "who / which chats" pickers: one look for rules, AI, commands, away, voice and media ---- */
const chipList = (path, items, sel) => `<div class="chips" style="margin-top:8px">${items.map(([v, l]) => `<button type="button" class="chip ${sel.includes(v) ? 'on' : ''}" data-act="pick" data-path="${esc(path)}" data-v="${esc(v)}" aria-pressed="${sel.includes(v)}">${esc(l)}</button>`).join('')}</div>`;
/** Contacts + tags to tap. base = the object path holding .contacts and .tags ('' for the rule being edited). */
function peopleChips(base) {
  const o = base ? getPath(D, base) || {} : D;
  const p = (k) => (base ? `${base}.${k}` : k);
  const cs = contacts().map((c) => [c.id, `👤 ${c.name}`]), ts = allTags().map((t) => [t, `🏷️ ${t}`]);
  const n = (o.contacts || []).length + (o.tags || []).length;
  if (!cs.length && !ts.length) return '<p class="hint">Add people in Contacts first, then pick them here.</p>';
  return `${cs.length ? chipList(p('contacts'), cs, o.contacts || []) : ''}${ts.length ? chipList(p('tags'), ts, o.tags || []) : ''}
    <p class="hint">${n ? `${n} picked. Tap again to remove.` : '⚠️ Nobody picked yet, so it won’t act for anyone. Tap names or lists above.'}</p>`;
}
/** Group selector. value: "all" | "none" | [group ids]. */
function groupScope(path, value, opts, hints = {}) {
  const mode = Array.isArray(value) ? 'pick' : (value || 'all');
  const sel = Array.isArray(value) ? value : [];
  const known = seenGroups().map((g) => [g.id, `👥 ${g.name}`]);
  const extra = sel.filter((id) => !known.some(([k]) => k === id)).map((id) => [id, `👥 ${groupsCfg()[id]?.name || 'group (left?)'}`]);
  const btns = `<div class="seg" role="group">${opts.map(([v, l]) => `<button type="button" data-act="gscope" data-path="${esc(path)}" data-v="${v}" aria-pressed="${v === mode}">${esc(l)}</button>`).join('')}</div>`;
  let body = '';
  if (mode === 'pick') {
    body = known.length || extra.length ? chipList(path, [...known, ...extra], sel) : '';
    body += `<p class="hint">${!known.length ? 'Your WhatsApp groups appear here after the bot\'s first run. ' : ''}${sel.length ? `${sel.length} group${sel.length > 1 ? 's' : ''} picked.` : '⚠️ No group picked yet, so it stays quiet in every group.'}${hints.pick ? ' ' + hints.pick : ''}</p>`;
  } else if (hints[mode]) body = `<p class="hint">${hints[mode]}</p>`;
  return btns + body;
}
const whoMode = (v) => (v === 'tags' ? 'pick' : v); // old "Some tags" = "Only these…" with only tags picked
const wdPick = (field, sel) => `<div class="chips">${WEEKDAYS.map((w, i) => `<button type="button" class="chip ${(sel || []).includes(i) ? 'on' : ''}" data-act="wd" data-field="${field}" data-i="${i}" aria-pressed="${(sel || []).includes(i)}">${w}</button>`).join('')}</div>`;

/* ---- 🔕 Busy mode card (Replies screen). Saves right away when switched on/off. ---- */
let busyDur = '60';
function busyCard(s) {
  const b = busyNow(s, status(), Date.now());
  const bs = s.busy || {};
  const picked = (bs.who === 'pick' ? (bs.contacts || []).length + (bs.tags || []).length : 0) + (Array.isArray(bs.groups) ? bs.groups.length : 0);
  const head = b.active
    ? `<div class="banner ok"><span>🔕</span><div><b>Busy until ${esc(busyTimeText(b.until, Date.now(), tz()))}</b>${b.source === 'whatsapp' ? 'Switched on from WhatsApp (!busy). ' : ''}Turns off by itself and tells you on WhatsApp.</div></div>`
    : '';
  const durs = [['30', '30 min'], ['60', '1 hour'], ['120', '2 hours'], ['180', '3 hours'], ['until', 'Until…']];
  return `<div class="card" id="busyCard"><h2>🔕 Busy mode ${b.active ? '<span class="pill ok tiny">ON</span>' : ''}</h2>
    ${head}
    <p class="muted small" style="margin-top:0">While you're busy, the bot replies <b>once</b> per chat with your busy message, only in the chats and groups you pick below. Stickers and GIFs don't trigger it.</p>
    ${picked ? '' : '<div class="banner warn"><span>👇</span><div><b>Pick chats first</b>Nobody is picked yet, so busy mode won’t reply to anyone. Choose people or groups below, then Save replies.</div></div>'}
    ${b.active ? `<div class="btns"><button class="btn" data-act="busy-off">☀️ I'm free — turn off</button></div>` : `
    <div class="field"><span class="lbl">For how long</span><div class="seg" role="group">${durs.map(([v, l]) => `<button type="button" data-act="busy-dur" data-v="${v}" aria-pressed="${busyDur === v}">${l}</button>`).join('')}</div>
      ${busyDur === 'until' ? `<input id="busyUntil" type="time" aria-label="Busy until" style="margin-top:8px" value="${esc(localTime(Date.now() + 2 * 3600000, tz()).slice(0, 3) + '00')}">` : ''}</div>
    <div class="btns"><button class="btn primary" data-act="busy-on">🔕 Turn on busy mode</button></div>`}
    <div class="field" style="margin-top:12px"><label for="fBm">Busy message</label><textarea id="fBm" data-f="busy.message">${esc(bs.message)}</textarea>
      <p class="hint">{time} becomes the time you're back, e.g. “${esc(busyText(bs.message, Date.now() + 2 * 3600000, Date.now(), tz()))}”</p></div>
    <div class="field"><span class="lbl">Private chats that get it</span>${seg('busy.who', [['nobody', 'Nobody'], ['pick', 'Only these…']], bs.who === 'pick' ? 'pick' : 'nobody')}${bs.who === 'pick' ? peopleChips('busy') : ''}</div>
    <div class="field"><span class="lbl">Groups that get it</span>${groupScope('busy.groups', bs.groups, [['none', 'No groups'], ['pick', 'Only these groups']], { none: 'Never in groups.' })}</div>
    ${Array.isArray(bs.groups) ? sw('In groups, only when someone tags me', 'Replies only when someone @mentions you or replies to your message (recommended)', 'data-f="busy.groupsOnlyWhenTagged"', bs.groupsOnlyWhenTagged !== false) : ''}
    <p class="hint">From WhatsApp (message yourself): <span class="mono">!busy 2h</span> · <span class="mono">!busy 30m</span> · <span class="mono">!busy until 5pm</span> · <span class="mono">!busy off</span></p>
  </div>`;
}

/* ---- 📸 Auto status screen ---- */
const FONT_CSS = { 0: 'font-family:system-ui,sans-serif', 6: 'font-family:system-ui,sans-serif;font-weight:800', 2: 'font-family:"Brush Script MT",cursive;font-style:italic', 7: 'font-family:"Comic Sans MS","Trebuchet MS",sans-serif', 8: 'font-family:Georgia,serif;font-weight:700', 9: 'font-family:Verdana,sans-serif;font-weight:800', 10: 'font-family:"Courier New",monospace;font-weight:700' };
function statusPreview(a) {
  const color = /^#[0-9a-f]{6}$/i.test(a.color || '') ? a.color : STATUS_COLORS[new Date().getDate() % STATUS_COLORS.length];
  const font = STATUS_FONTS.some(([v]) => String(v) === String(a.font)) ? Number(a.font) : STATUS_FONTS[new Date().getDate() % STATUS_FONTS.length][0];
  let text;
  if (a.mode === 'own') text = (a.texts || []).find((x) => x.trim()) || 'Write your first status below ✍️';
  else if (a.mode === 'photo') return `<div class="st-prev photo"><div><b>🖼️ Photo status</b><span>${esc(a.photoUrl || 'Paste a photo link below')}</span>${a.photoCaption ? `<em>${esc(a.photoCaption)}</em>` : ''}</div></div>`;
  else text = formatQuote(QUOTES[(new Date().getDate() * 7) % QUOTES.length]);
  return `<div class="st-prev" style="background:${color}"><p style="${FONT_CSS[font] || ''}">${esc(text).replace(/\n/g, '<br>')}</p><small>${a.mode === 'own' ? 'Your text' : a.aiFresh ? 'Example · AI writes a fresh line each time' : 'Example · a different quote every time'}</small></div>`;
}
/* ---- 🎉 Special days (part of the Auto status screen) ---- */
let sdAll = false; // "Show all days this year" (screen state only, not saved)
function daysAway(date, today) {
  const n = Math.round((Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10)) - Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10))) / 86400000);
  return n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : `in ${n} days`;
}
function specialCard(a) {
  const sp = specialConfig(a);
  const today = localDate(Date.now(), tz());
  const rows = upcomingSpecials(today, sdAll ? 366 : 60, a);
  const days = (a.days || []).map(Number);
  const offNote = days.length === 7 ? '' : sp.offDays ? 'Special days on your off days still get their card.' : 'Special days on your off days are skipped.';
  const todaySp = a.enabled && sp.enabled ? specialFor(today, a) : null;
  const row = (r) => {
    const own = a.special?.items?.[r.id]?.caption || '';
    return `<div class="sd-row${r.on ? '' : ' off'}">
      <div class="sd-top">
        <button type="button" class="sd-thumb" data-act="sd-prev" data-v="${esc(r.id)}" aria-label="Preview ${esc(r.name)}"><img src="${esc(cardUrl(r.id))}" alt="" width="45" height="80" loading="lazy"></button>
        <div class="main"><div class="t">${esc(r.name)}</div>
          <div class="d">${esc(prettyDate(r.date))} · ${esc(daysAway(r.date, today))}${r.approx ? ' <span class="pill warn tiny" title="Depends on the moon">±1 day</span>' : ''}</div>
          ${r.clash && r.on ? `<div class="d warn">Same day as ${esc(r.clash)}, which is posted instead (one status a day)</div>` : ''}</div>
        ${toggle(`data-f="autoStatus.special.items.${esc(r.id)}.off" data-type="neg" data-rr="1"`, r.on, `Post ${r.name}`)}
      </div>
      <details class="sd-more"><summary>Caption &amp; test</summary>
        <div class="field"><label for="sdc-${esc(r.id)}">Caption under the picture</label><input id="sdc-${esc(r.id)}" type="text" maxlength="300" data-f="autoStatus.special.items.${esc(r.id)}.caption" value="${esc(own)}" placeholder="${esc(SPECIAL_BY_ID[r.id].caption)}"><p class="hint">Leave empty to use the one shown in grey.</p></div>
        <div class="btns"><button type="button" class="btn sm" data-act="sd-prev" data-v="${esc(r.id)}">Preview</button><button type="button" class="btn sm cy" data-act="sd-test" data-v="${esc(r.id)}">Post test now</button></div>
      </details>
    </div>`;
  };
  return `<div class="card"><h2>🎉 Special days</h2>
    ${sw('Special days', 'On festivals and days like Diwali, Sankranti or World Savings Day, post a picture card instead of the quote', 'data-f="autoStatus.special.enabled" data-rr="1"', sp.enabled)}
    ${a.enabled ? '' : '<p class="hint">⚠️ Turn on Auto status above. Special days only post while it is on.</p>'}
    ${sp.enabled ? `${sw('Post special days even on my off days', 'A festival on a day you skip still gets its wish', 'data-f="autoStatus.special.offDays" data-rr="1"', sp.offDays)}
    ${todaySp ? `<div class="banner info small" style="margin:10px 0 0"><span>🎉 Today is <strong>${esc(todaySp.name)}</strong>, so today's status is its picture card.</span></div>` : ''}
    <div class="sd-list">${rows.length ? rows.map(row).join('') : `<p class="muted small">No special days in the next ${sdAll ? 'year' : '60 days'}.</p>`}</div>
    <div class="btns" style="margin-top:8px"><button type="button" class="btn sm ghost" data-act="sd-all">${sdAll ? 'Show only the next 60 days' : `Show all ${SPECIAL_DAYS.length} special days (next 12 months)`}</button></div>
    <p class="hint">One status a day: on a special day the picture goes out at your status time instead of the quote. If the picture fails, the caption goes out as a text status. ${offNote} Moon-based days (Eid) can move by a day. Switch it off if your area celebrates on a different day.</p>` : ''}
  </div>`;
}
function showCard(id) {
  const d = SPECIAL_BY_ID[id];
  if (!d) return;
  const cap = D?.autoStatus?.special?.items?.[id]?.caption || d.caption;
  const ov = document.createElement('div');
  ov.className = 'sd-modal';
  ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true'); ov.setAttribute('aria-label', `${d.name} card`);
  ov.innerHTML = `<div class="sd-box"><img src="${esc(cardUrl(id))}" alt="${esc(d.title)}: ${esc(d.line)}"><p class="sd-cap">${esc(cap)}</p><button type="button" class="btn sm" data-close="1">Close</button></div>`;
  const close = () => { ov.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  ov.addEventListener('click', (e) => { if (e.target === ov || e.target.closest('[data-close]')) close(); });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(ov);
  ov.querySelector('[data-close]').focus();
}
const testPerson = (a) => (a?.testWith ? contacts().find((c) => c && c.id === a.testWith && c.number && !c.example) || null : null);
function renderStatus() {
  if (!D || D._id !== 'status') D = { ...clone(settings()), _kind: 'settings', _id: 'status' };
  const a = D.autoStatus;
  const days = (a.days || []).map(Number);
  const everyDay = days.length === 7;
  const aud = statusAudience(a, { contacts: contacts(), owner: '0000000000' });
  const others = aud.numbers.length - 1;
  const next = buildJobs({ ...planData(), settings: withDefaults(strip(D)) }, Date.now(), Date.now() + 8 * 86400000).find((j) => j.kind === 'status');
  const audHint = a.audience === 'only'
    ? (others ? `Goes to <b>${others}</b> ${others === 1 ? 'person' : 'people'} + you.` : '⚠️ Nobody picked yet. Tap people or lists above.')
    : `Goes to <b>${others}</b> ${others === 1 ? 'person' : 'people'} from your Contacts${a.alsoRecent && a.audience !== 'only' ? ' + people who texted you in the last 30 days' : ''} + you.`;
  view().innerHTML = `<button class="back" data-act="go" data-v="#/more">‹ More</button>
  <div class="ph"><div><h1>Auto status</h1><p>Posts a WhatsApp status for you, on a schedule</p></div></div>
  <div class="card"><h2>📸 Status</h2>
    ${sw('Auto status', a.enabled ? (next ? `Next: ${esc(whenText(next.at))}` : 'Pick at least one day') : 'Off. Nothing is posted.', 'data-f="autoStatus.enabled" data-rr="1"', a.enabled)}
    <div class="field" style="margin-top:10px"><span class="lbl">When</span><div class="seg" role="group"><button type="button" data-act="st-days" data-v="all" aria-pressed="${everyDay}">Every day</button><button type="button" data-act="st-days" data-v="pick" aria-pressed="${!everyDay}">Chosen days</button></div>
      ${everyDay ? '' : `<div style="margin-top:8px">${wdPick('autoStatus.days', days)}</div>${days.length ? '' : '<p class="hint">⚠️ Pick at least one day.</p>'}`}</div>
    <div class="field"><label for="stTime">Time</label><input id="stTime" type="time" data-f="autoStatus.time" data-rr="1" value="${esc(a.time)}"></div>
  </div>
  ${specialCard(a)}
  <div class="card"><h2>✍️ What to post</h2>
    ${seg('autoStatus.mode', [['quote', 'Motivational quote'], ['own', 'My own text'], ['photo', 'Photo']], a.mode || 'quote')}
    <div style="margin-top:12px">${statusPreview(a)}</div>
    ${(a.mode || 'quote') === 'quote' ? `<p class="hint">${QUOTES.length} short quotes built in (Kalam, Vivekananda, Jobs, Kobe, Sachin…). No repeats until all of them are used.</p>
      ${sw('AI-fresh quote', 'The AI writes a new line each time (needs your GROQ_API_KEY). If the AI fails, a built-in quote is used.', 'data-f="autoStatus.aiFresh" data-rr="1"', a.aiFresh)}` : ''}
    ${a.mode === 'own' ? `<div class="field" style="margin-top:10px"><label for="stTexts">Your statuses, one per line</label><textarea id="stTexts" data-f="autoStatus.texts" data-type="lines" data-rr="1" style="min-height:110px" placeholder="Grind now, shine later ✨&#10;New day, new code 💻">${esc((a.texts || []).join('\n'))}</textarea><p class="hint">Posted in turn: line 1, then line 2… then back to line 1.</p></div>` : ''}
    ${a.mode === 'photo' ? `<div class="field" style="margin-top:10px"><label for="stUrl">Photo link (https://…jpg or .png)</label><input id="stUrl" type="url" data-f="autoStatus.photoUrl" value="${esc(a.photoUrl)}" placeholder="https://…/photo.jpg"></div>
      <div class="field"><label for="stCap">Caption (optional)</label><input id="stCap" type="text" data-f="autoStatus.photoCaption" value="${esc(a.photoCaption)}"></div><p class="hint">Must be a direct image link anyone can open. If the link is missing or broken, a quote is posted instead.</p>` : ''}
    ${a.mode !== 'photo' ? `<div class="field" style="margin-top:12px"><span class="lbl">Background colour</span><div class="swatches"><button type="button" class="sw-rot ${!/^#/.test(a.color || '') ? 'on' : ''}" data-act="st-color" data-v="rotate" aria-pressed="${!/^#/.test(a.color || '')}">🎨 Rotate</button>${STATUS_COLORS.map((c) => `<button type="button" class="sw-c ${a.color === c ? 'on' : ''}" style="background:${c}" data-act="st-color" data-v="${c}" aria-label="Colour ${c}" aria-pressed="${a.color === c}"></button>`).join('')}</div></div>
      <div class="field"><span class="lbl">Font</span>${seg('autoStatus.font', [['rotate', 'Rotate'], ...STATUS_FONTS.map(([v, l]) => [String(v), l])], a.font ?? 'rotate')}</div>` : ''}
  </div>
  <div class="card"><h2>👀 Who sees it</h2>
    ${seg('autoStatus.audience', [['all', 'All my contacts'], ['only', 'Only these…'], ['except', 'All except…']], a.audience || 'all')}
    ${a.audience === 'only' || a.audience === 'except' ? `<p class="hint" style="margin-top:8px">${a.audience === 'only' ? 'Tap who should see it:' : 'Tap who should NOT see it:'}</p>${peopleChips('autoStatus')}` : ''}
    ${a.audience !== 'only' ? sw('Also people who texted me lately', 'Anyone who messaged you in the last 30 days, even if they are not in Contacts', 'data-f="autoStatus.alsoRecent" data-rr="1"', a.alsoRecent) : ''}
    <p class="hint">${audHint} WhatsApp doesn't give bots your phone's address book, so “contacts” means the people in the Contacts tab here. You always see your own status.</p>
  </div>
  <div class="card"><h2>🧪 Try it</h2>
    <p class="muted small" style="margin-top:0">Posts the next status to <b>${testPerson(a) ? `you + ${esc(testPerson(a).name || 'your test person')}` : 'only you'}</b> (WhatsApp → Updates → My status). The bot then messages you whether WhatsApp <b>accepted</b> it. Delete it there afterwards if you like.</p>
    <div class="field"><label for="stTestWith">Test also goes to</label><select id="stTestWith" data-f="autoStatus.testWith" data-rr="1"><option value="">Nobody else (only me)</option>${contacts().filter((c) => c && c.number && !c.example).map((c) => `<option value="${esc(c.id)}" ${a.testWith === c.id ? 'selected' : ''}>${esc(c.name || c.number)}</option>`).join('')}</select><p class="hint">Optional: pick one friend to check that others can see it too (also used by “Post test now” on special days).</p></div>
    <div class="btns"><button class="btn cy" data-act="st-test">Post test status now</button></div>
  </div>
  <div class="sticky-save"><button class="btn primary" data-act="st-save">Save auto status</button></div>`;
}

/* ---------------- screens ---------------- */
function renderLogin(err = '') {
  const host = location.hostname.endsWith('.github.io') ? location.hostname.split('.')[0] : '';
  const repoGuess = host ? (location.pathname.split('/').filter(Boolean)[0] || 'vr-bot') : 'vr-bot';
  const c = S.cfg || {};
  $('#tabs').hidden = true; $('#topRight').innerHTML = '';
  view().innerHTML = `<section class="login">
    <div class="hero-logo"><img src="icons/logo.png" alt="VR DEVELOPMENTS logo"></div>
    <h1><span class="grad">VR Bot</span></h1>
    <p class="tag">Control panel · by VR DEVELOPMENTS</p>
    ${err ? `<div class="banner bad" role="alert"><div><b>Couldn't open</b>${esc(err)}</div></div>` : ''}
    <form class="card glow" id="loginForm" autocomplete="on">
      <div class="grid2">
        <div class="field"><label for="lgOwner">GitHub username</label><input id="lgOwner" type="text" autocapitalize="off" spellcheck="false" required value="${esc(c.owner || host || 'Volam-Rakshith')}"></div>
        <div class="field"><label for="lgRepo">Repo name</label><input id="lgRepo" type="text" autocapitalize="off" spellcheck="false" required value="${esc(c.repo || repoGuess)}"></div>
      </div>
      <div class="field"><label for="lgToken">GitHub token</label><input id="lgToken" type="password" autocomplete="off" spellcheck="false" required placeholder="github_pat_…" value="${esc(c.token || '')}"><p class="hint">Fine-grained token for this repo only (SETUP step 5). Saved only on this phone.</p></div>
      <div class="field"><label for="lgPass">Panel password</label><input id="lgPass" type="password" autocomplete="current-password" required value="${esc(S.pass)}"><p class="hint">Exactly the same as your <span class="mono">VR_PASSPHRASE</span> secret. It encrypts your contacts and messages.</p></div>
      <label class="switch" style="border:0"><span class="txt"><b>Remember on this phone</b><span>Off = you type the password each time you open the panel</span></span>${toggle('id="lgRemember"', !!localStorage.getItem('vrbot.pass'), 'Remember')}</label>
      <button class="btn primary" style="width:100%;margin-top:8px" type="submit">Open my panel</button>
    </form>
    <div class="card"><h2>New here?</h2><ol class="steps"><li>Follow SETUP.md in your repo (about 15 minutes).</li><li>Come back here with your token and password.</li><li>Add contacts and schedules — the bot does the rest.</li></ol>
      <div class="btns"><a class="btn sm cy" href="#/demo">👀 Try the demo</a><a class="btn sm ghost" href="https://github.com/${esc(c.owner || host || 'Volam-Rakshith')}/${esc(c.repo || repoGuess)}/blob/main/SETUP.md" target="_blank" rel="noopener">Open SETUP.md</a></div></div>
  </section>`;
  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    S.cfg = { owner: $('#lgOwner').value.trim(), repo: $('#lgRepo').value.trim(), token: $('#lgToken').value.trim(), branch: 'main' };
    S.pass = $('#lgPass').value;
    localStorage.setItem('vrbot.cfg', JSON.stringify(S.cfg));
    if ($('#lgRemember').checked) localStorage.setItem('vrbot.pass', S.pass); else { localStorage.removeItem('vrbot.pass'); sessionStorage.setItem('vrbot.pass', S.pass); }
    S.demo = false;
    await boot();
  });
}

function topStatus() {
  const st = status();
  const s = st.session?.status;
  const pill = S.demo ? '<span class="pill vi">DEMO</span>' : s === 'ok' ? '<span class="pill ok"><span class="dot"></span>Linked</span>' : s === 'logged_out' ? '<span class="pill bad"><span class="dot"></span>Logged out</span>' : '<span class="pill warn"><span class="dot"></span>Not linked</span>';
  const busy = busyNow(settings(), st, Date.now()).active ? '<span class="pill cy" title="Busy mode is on" aria-label="Busy mode is on">🔕</span>' : '';
  $('#topRight').innerHTML = (settings().paused || st.pausedByOwner ? '<span class="pill warn">⏸ Paused</span>' : '') + busy + pill;
}

function renderHome() {
  const st = status(), s = settings();
  const now = Date.now();
  const jobs = buildJobs(planData(), now, now + 7 * 86400000);
  const log = Object.entries(S.state.sentlog?.entries || {}).map(([k, v]) => ({ k, ...v })).sort((a, b) => b.t - a.t);
  const fails = log.filter((e) => e.s === 'failed' && e.t > now - 7 * 86400000);
  const sentToday = log.filter((e) => e.s === 'sent' && localDate(e.t, tz()) === localDate(now, tz())).length;
  const lr = st.lastRun;
  const run = S.runs[0];
  const examples = contacts().some((c) => c.example) || schedules().some((x) => x.example);
  const fests = upcomingFestivals(mergedFestivals(festCfg()), localDate(now, tz()), 4);
  const banners = [];
  if (S.demo) banners.push('<div class="banner info"><span>👀</span><div><b>Demo mode</b>Example data only — nothing is saved or sent. <a href="#/logout">Sign in</a> to manage your real bot.</div></div>');
  if (st.session?.status === 'logged_out') banners.push('<div class="banner bad"><span>⚠️</span><div><b>WhatsApp logged the bot out</b>Run the <b>"VR Bot — Pair WhatsApp"</b> workflow again (SETUP step 9). Nothing sends until then.</div></div>');
  else if (!S.demo && st.session?.status !== 'ok') banners.push('<div class="banner warn"><span>🔗</span><div><b>WhatsApp not linked yet</b>Open your repo → Actions → "VR Bot — Pair WhatsApp" → Run workflow (SETUP step 9).</div></div>');
  if (s.paused || st.pausedByOwner) banners.push(`<div class="banner warn"><span>⏸️</span><div><b>Paused</b>No scheduled messages go out. ${st.pausedByOwner ? 'Send <b>!resume</b> to yourself on WhatsApp' : 'Turn it back on below'}.</div></div>`);
  if (examples) banners.push('<div class="banner info"><span>✨</span><div><b>Example data is loaded</b>Items marked EXAMPLE are never sent. Replace them with your real contacts and schedules.</div></div>');
  view().innerHTML = `
    <div class="ph"><div><h1>Hi ${esc(s.myName || 'there')} 👋</h1><p>${esc(prettyDate(localDate(now, tz())))} · ${esc(tz())}</p></div></div>
    ${banners.join('')}
    <div class="stats">
      <div class="stat"><div class="k">⏭ Next send</div><div class="v">${jobs[0] ? esc(pretty12(localTime(jobs[0].at, tz()))) : '—'}</div><div class="s">${jobs[0] ? esc(whenText(jobs[0].at).split(' · ')[0] + ' · ' + jobs[0].label) : 'nothing in 7 days'}</div></div>
      <div class="stat"><div class="k">🔁 Last run</div><div class="v ${lr ? (lr.ok ? 'ok' : 'bad') : ''}">${lr ? (lr.ok ? 'OK' : 'Error') : '—'}</div><div class="s">${lr ? esc(ago(lr.endedAt || lr.startedAt)) : 'no runs yet'}</div></div>
      <div class="stat"><div class="k">📤 Sent today</div><div class="v">${sentToday}</div><div class="s">${jobs.filter((j) => localDate(j.at, tz()) === localDate(now, tz())).length} more planned</div></div>
      <div class="stat"><div class="k">❌ Failures</div><div class="v ${fails.length ? 'bad' : 'ok'}">${fails.length}</div><div class="s">last 7 days</div></div>
    </div>
    <div class="card glow"><h2>⏰ Next sends <span class="count">${jobs.length} in 7 days</span></h2>
      <div class="list">${jobs.slice(0, 8).map((j) => `<div class="row"><div class="ic">${{ birthday: '🎂', festival: '🪔', group: '👥', broadcast: '📣', summary: '📊', alert: '🔔', followup: '↩️', status: '📸' }[j.kind] || '💬'}</div><div class="main"><div class="t">${esc(j.label)}</div><div class="d">→ ${esc(j.to.type === 'group' ? j.to.name : j.to.owner ? 'you' : j.to.name || j.to.number)}${j.header ? ' · 🤖 header' : ''}</div></div><div class="r stack">${esc(whenText(j.at).split(' · ')[0])}<b>${esc(pretty12(localTime(j.at, tz())))}</b></div></div>`).join('') || '<p class="empty">Nothing scheduled. Tap Schedules → ＋ to add one.</p>'}</div>
    </div>
    ${fails.length ? `<div class="card"><h2>❌ Failures</h2><div class="list">${fails.slice(0, 5).map((f) => `<div class="row"><div class="ic">⚠️</div><div class="main"><div class="t">${esc(f.label || f.k)}</div><div class="d">${esc(f.err || '')}</div></div><div class="r">${esc(ago(f.t))}</div></div>`).join('')}</div></div>` : ''}
    <div class="card"><h2>🪔 Upcoming festivals <a class="count" href="#/festivals">manage</a></h2><div class="list">${fests.map((f) => `<a class="row" href="#/festival/${esc(f.id)}"><div class="ic">${esc(f.emoji || '🎉')}</div><div class="main"><div class="t">${esc(f.name)}</div><div class="d">${f.enabled && (f.to || []).length ? `✅ wishes on · ${esc(pretty12(f.time || festCfg().defaultTime || '00:00'))}` : 'off — tap to set up'}${f.lunar ? ' · date varies yearly' : ''}</div></div><div class="r when">${esc(prettyDate(f.date).replace(/^\w+, /, ''))}</div></a>`).join('')}</div></div>
    <div class="card"><h2>🧾 Recent activity <a class="count" href="#/logs">all logs</a></h2><div class="list">${log.slice(0, 6).map((e) => `<div class="row"><div class="ic">${e.s === 'sent' ? '✅' : e.s === 'failed' ? '❌' : '⏭️'}</div><div class="main"><div class="t">${esc(e.label || e.k)}</div><div class="d">${esc(e.to || '')}${e.lateSec > 120 ? ` · ${Math.round(e.lateSec / 60)} min late` : e.s === 'sent' ? ' · on time' : ''}</div></div><div class="r">${esc(ago(e.t))}</div></div>`).join('') || '<p class="empty">No messages sent yet.</p>'}</div></div>
    <div class="card"><h2>⚙️ Quick actions</h2>
      <div class="btns full"><button class="btn cy" data-act="run-now">▶ Run now</button><button class="btn ${s.paused ? 'primary' : ''}" data-act="pause">${s.paused ? '▶ Resume all' : '⏸ Pause all'}</button></div>
      <p class="hint">${run && run.status === 'in_progress' ? `🟢 The bot is online now (this run started ${esc(ago(Date.parse(run.created_at)))})` : `GitHub ${run ? `last started the bot ${esc(ago(Date.parse(run.created_at)))} (${esc(run.conclusion || run.status)})` : 'has not started the bot yet'}`}. Scheduled messages go out on the exact minute; ${alwaysOn() ? 'with Always on, replies to incoming messages are near-instant (a short gap about every 80 min while it hands over).' : 'replies to incoming messages wait for the next check (≈30 min).'}</p>
    </div>`;
}

function renderSchedules() {
  const list = schedules();
  const now = Date.now();
  view().innerHTML = `<div class="ph"><div><h1>Schedules</h1><p>Daily, weekdays, monthly, yearly or one-time messages</p></div></div>
    <div class="card"><div class="list">${list.map((x) => {
      const n = nextOccurrence(x, now, tz());
      const icon = (x.to || []).some((t) => t.type === 'group') ? '👥' : (x.to || []).some((t) => t.type === 'tag') || (x.to || []).length > 1 ? '📣' : '💬';
      return `<div class="row"><a class="ic" href="#/schedule/${esc(x.id)}" aria-hidden="true" tabindex="-1" style="text-decoration:none">${icon}</a><a class="main" href="#/schedule/${esc(x.id)}" style="text-decoration:none;color:inherit"><div class="t">${esc(x.name || 'Untitled')} ${exampleBadge(x)}</div><div class="d">${esc(describe(x))}</div><div class="d">${(x.to || []).map((t) => esc(targetLabel(t))).join(', ')}${n && x.enabled !== false ? ` · next <span class="when">${esc(whenText(n.at))}</span>` : x.enabled === false ? ' · <span class="warn">paused</span>' : ''}</div></a>${toggle(`data-act="sch-enable" data-id="${esc(x.id)}"`, x.enabled !== false, `Enable ${x.name}`)}</div>`;
    }).join('') || '<p class="empty">No schedules yet. Tap ＋ to create your first one.</p>'}</div></div>
    <a class="fab" href="#/schedule/new" aria-label="New schedule">＋</a>`;
}

const NEW_SCHEDULE = () => ({ id: uid('s'), name: '', enabled: true, to: [], message: '', templateId: '', time: '07:00', repeat: { type: 'daily' }, skipDays: [], skipDates: [], start: null, end: null, humanDelay: { enabled: false, minutes: 3 }, header: 'default' });

function renderScheduleEditor(id) {
  const existing = schedules().find((x) => x.id === id);
  if (!D || D._id !== id) D = { ...(existing ? clone(existing) : NEW_SCHEDULE()), _id: id, _kind: 'schedule' };
  const r = D.repeat || { type: 'daily' };
  const tplOpts = templates().map((t) => `<option value="${esc(t.id)}" ${D.templateId === t.id ? 'selected' : ''}>${esc(t.name)}</option>`).join('');
  const wdChips = (field, sel) => `<div class="chips">${WEEKDAYS.map((w, i) => `<button type="button" class="chip ${(sel || []).includes(i) ? 'on' : ''}" data-act="wd" data-field="${field}" data-i="${i}" aria-pressed="${(sel || []).includes(i)}">${w}</button>`).join('')}</div>`;
  let repeatFields = '';
  if (r.type === 'once') repeatFields = `<div class="field"><label for="fDate">Date</label><input id="fDate" type="date" data-f="repeat.date" value="${esc(r.date || localDate(Date.now(), tz()))}"></div>`;
  if (r.type === 'weekly') repeatFields = `<div class="field"><span class="lbl">On these days</span>${wdChips('repeat.days', r.days)}</div>`;
  if (r.type === 'monthly') repeatFields = `<div class="field"><label for="fMday">Day of the month</label><select id="fMday" data-f="repeat.day">${[...Array(31)].map((_, i) => `<option value="${i + 1}" ${String(r.day) === String(i + 1) ? 'selected' : ''}>${i + 1}</option>`).join('')}<option value="last" ${r.day === 'last' ? 'selected' : ''}>Last day</option></select><p class="hint">29–31 move to the last day in shorter months.</p></div>`;
  if (r.type === 'yearly') repeatFields = `<div class="grid2"><div class="field"><label for="fYm">Month</label><select id="fYm" data-f="repeat.month" data-type="num">${MONTHS.map((m, i) => `<option value="${i + 1}" ${Number(r.month) === i + 1 ? 'selected' : ''}>${m}</option>`).join('')}</select></div><div class="field"><label for="fYd">Day</label><input id="fYd" type="number" min="1" max="31" data-f="repeat.day" data-type="num" value="${esc(r.day || 1)}"></div></div>`;
  if (r.type === 'dates') repeatFields = `<div class="field"><span class="lbl">Dates</span><div class="chips">${(r.dates || []).map((d, i) => `<span class="chip on static">${esc(d)}<button class="x" type="button" data-act="rm-date" data-field="repeat.dates" data-i="${i}" aria-label="Remove">×</button></span>`).join('')}</div><div class="btns" style="margin-top:8px"><input type="date" id="addDateVal" aria-label="Date to add" style="flex:1"><button type="button" class="btn sm" data-act="add-date" data-field="repeat.dates">Add</button></div></div>`;
  view().innerHTML = `<button class="back" data-act="back">‹ Schedules</button>
  <div class="ph"><div><h1>${existing ? 'Edit schedule' : 'New schedule'} ${exampleBadge(D)}</h1></div></div>
  <form id="ed">
  <div class="card">
    <div class="field"><label for="fName">Name (only you see this)</label><input id="fName" type="text" data-f="name" value="${esc(D.name)}" placeholder="Good morning Amma"></div>
    <div class="field"><span class="lbl">Send to</span>${targetPicker(D.to)}</div>
  </div>
  <div class="card">
    <div class="field"><label for="fTpl">Template</label><select id="fTpl" data-f="templateId"><option value="">— Write my own message —</option>${tplOpts}</select></div>
    <div class="field" ${D.templateId ? 'hidden' : ''}><label for="fMsg">Message</label><textarea id="fMsg" data-f="message" placeholder="Good morning {first_name} ☀️">${esc(D.message)}</textarea>${placeholderChips('fMsg')}</div>
    <span class="lbl">Preview</span><div id="pv"></div>
  </div>
  <div class="card">
    <div class="grid2"><div class="field"><label for="fTime">Time (${esc(tz())})</label><input id="fTime" type="time" data-f="time" value="${esc(D.time)}" required></div>
    <div class="field"><span class="lbl">Status</span>${toggle('data-f="enabled"', D.enabled !== false, 'Enabled')}</div></div>
    <div class="field"><span class="lbl">Repeat</span>${seg('repeat.type', [['once', 'Once'], ['daily', 'Daily'], ['weekly', 'Weekdays'], ['monthly', 'Monthly'], ['yearly', 'Yearly'], ['dates', 'Dates']], r.type)}</div>
    ${repeatFields}
    ${r.type !== 'once' && r.type !== 'dates' ? `<div class="field"><span class="lbl">Skip these weekdays</span>${wdChips('skipDays', D.skipDays)}</div>
    <div class="field"><span class="lbl">Skip these dates</span><div class="chips">${(D.skipDates || []).map((d, i) => `<span class="chip on static">${esc(d)}<button class="x" type="button" data-act="rm-date" data-field="skipDates" data-i="${i}" aria-label="Remove">×</button></span>`).join('') || '<span class="muted small">none</span>'}</div><div class="btns" style="margin-top:8px"><input type="date" id="addDateVal" aria-label="Skip date to add" style="flex:1"><button type="button" class="btn sm" data-act="add-date" data-field="skipDates">Add</button></div></div>
    <div class="grid2"><div class="field"><label for="fStart">From (optional)</label><input id="fStart" type="date" data-f="start" value="${esc(D.start || '')}"></div><div class="field"><label for="fEnd">Until (optional)</label><input id="fEnd" type="date" data-f="end" value="${esc(D.end || '')}"></div></div>` : ''}
    <span class="lbl">Next sends</span><div id="nx" class="small"></div>
  </div>
  <div class="card">
    ${sw('Human-like delay', 'Sends a few minutes before/after the time so it looks natural. Leave OFF for exact time.', 'data-f="humanDelay.enabled"', D.humanDelay?.enabled)}
    ${D.humanDelay?.enabled ? `<div class="field" style="margin-top:10px"><label for="fHd">± minutes</label><input id="fHd" type="number" min="1" max="60" data-f="humanDelay.minutes" data-type="num" value="${esc(D.humanDelay?.minutes ?? 3)}"></div>` : ''}
    <div class="field" style="margin-top:12px"><span class="lbl">🤖 "VR Bot is sending" header</span>${seg('header', [['default', 'Default'], ['on', 'On'], ['off', 'Off']], D.header || 'default')}<p class="hint">Default: on for groups & lists, off for personal messages.</p></div>
  </div>
  <div class="card"><div class="btns full"><button type="button" class="btn cy" data-act="sch-test">🧪 Test to me</button><button type="button" class="btn" data-act="sch-now">📤 Send now</button></div>
  ${existing ? '<button type="button" class="btn danger" style="width:100%;margin-top:8px" data-act="sch-del">Delete schedule</button>' : ''}</div>
  <div class="sticky-save"><button type="button" class="btn ghost" data-act="back">Cancel</button><button type="button" class="btn primary" data-act="sch-save">Save</button></div>
  </form>`;
  refreshPreview();
}

function draftKind() {
  const to = D.to || [];
  if (to.some((t) => t.type === 'group')) return 'group';
  if (to.some((t) => t.type === 'tag') || to.length > 1) return 'broadcast';
  return 'personal';
}
function refreshPreview() {
  if (!D) return;
  const pv = $('#pv');
  if (D._kind === 'schedule') {
    const text = (D.templateId && templates().find((t) => t.id === D.templateId)?.text) || D.message;
    const firstContact = contacts().find((c) => (D.to || []).some((t) => t.type === 'contact' && t.id === c.id));
    if (pv) pv.innerHTML = messagePreview(text, draftKind(), D.header, firstContact?.header, firstContact ? { name: firstContact.name, first_name: firstContact.name.split(' ')[0] } : {});
    const nx = $('#nx');
    if (nx) {
      const out = []; let from = Date.now();
      for (let i = 0; i < 3; i++) { const n = nextOccurrence({ ...D, enabled: true }, from, tz()); if (!n) break; out.push(whenText(n.at) + ` (${prettyDate(n.date)})`); from = n.at + 60000; }
      nx.innerHTML = out.length ? out.map((o) => `• ${esc(o)}`).join('<br>') : '<span class="warn">No upcoming dates — check the repeat, range and skip settings.</span>';
    }
  } else if (D._kind === 'template' && pv) pv.innerHTML = messagePreview(D.text, 'personal', 'off');
  else if (D._kind === 'festival' && pv) pv.innerHTML = messagePreview((D.templateId && templates().find((t) => t.id === D.templateId)?.text) || D.message, 'festival', D.header, undefined, { festival: D.name });
  else if (D._kind === 'contact' && pv) pv.innerHTML = messagePreview(D.birthdayMessage || settings().birthdays.message, 'birthday', undefined, D.header, { name: D.name || 'Name', first_name: (D.name || 'Name').split(' ')[0] });
}

let contactFilter = { q: '', tag: '' };
function renderContacts() {
  const q = contactFilter.q.toLowerCase();
  const list = contacts().filter((c) => (!q || c.name.toLowerCase().includes(q) || String(c.number).includes(q)) && (!contactFilter.tag || (c.tags || []).includes(contactFilter.tag)));
  const ex = contacts().filter((c) => c.example).length;
  view().innerHTML = `<div class="ph"><div><h1>Contacts</h1><p>${contacts().length} people · tags make lists (family, friends…)</p></div></div>
    ${ex ? `<div class="banner info"><span>✨</span><div><b>${ex} example contact(s)</b>They are never messaged. <button class="btn sm" data-act="del-examples" style="margin-top:6px">Delete all examples</button></div></div>` : ''}
    <input type="search" class="search" id="cSearch" placeholder="Search name or number" value="${esc(contactFilter.q)}" aria-label="Search contacts">
    <div class="chips" style="margin-bottom:10px"><button class="chip ${!contactFilter.tag ? 'on' : ''}" data-act="ctag" data-v="">All</button>${allTags().map((t) => `<button class="chip ${contactFilter.tag === t ? 'on' : ''}" data-act="ctag" data-v="${esc(t)}">🏷️ ${esc(t)}</button>`).join('')}</div>
    <div class="card"><div class="list">${list.map((c) => `<a class="row" href="#/contact/${esc(c.id)}"><div class="ic">${esc((c.name || '?')[0].toUpperCase())}</div><div class="main"><div class="t">${esc(c.name)} ${exampleBadge(c)}</div><div class="d">${esc(c.number)}${c.birthday ? ` · 🎂 ${esc(c.birthday.length === 5 ? c.birthday : c.birthday.slice(5))}` : ''}</div></div><div class="r">${(c.tags || []).map((t) => esc(t)).join(', ')}</div></a>`).join('') || '<p class="empty">No contacts match.</p>'}</div></div>
    <details class="card"><summary>📋 Add many at once (paste)</summary>
      <p class="hint" style="margin-bottom:8px">One per line: <span class="mono">Name, Number, Birthday, tag1|tag2</span><br>Birthday as 2006-05-14 or 05-14 (optional).</p>
      <textarea id="importTxt" placeholder="Amma, +91 98765 43210, 1980-03-12, family&#10;Saiteja, 9876543210, 11-02, friends|class"></textarea>
      <button class="btn cy" style="margin-top:8px" data-act="import">Import</button></details>
    <a class="fab" href="#/contact/new" aria-label="New contact">＋</a>`;
  $('#cSearch').addEventListener('input', (e) => { contactFilter.q = e.target.value; const pos = e.target.selectionStart; renderContacts(); const el = $('#cSearch'); el.focus(); el.setSelectionRange(pos, pos); });
}

function renderContactEditor(id) {
  const existing = contacts().find((c) => c.id === id);
  if (!D || D._id !== id) D = { ...(existing ? clone(existing) : { id: uid('c'), name: '', number: '', birthday: '', tags: [], header: 'default', wishBirthday: true }), _id: id, _kind: 'contact' };
  const noYear = (D.birthday || '').length === 5;
  view().innerHTML = `<button class="back" data-act="back">‹ Contacts</button>
  <div class="ph"><div><h1>${existing ? 'Edit contact' : 'New contact'} ${exampleBadge(D)}</h1></div></div>
  <div class="card">
    <div class="field"><label for="fN">Name</label><input id="fN" type="text" data-f="name" value="${esc(D.name)}" placeholder="Saiteja"></div>
    <div class="field"><label for="fNum">WhatsApp number</label><input id="fNum" type="tel" data-f="number" value="${esc(D.number)}" placeholder="+91 98765 43210"><p class="hint">10-digit numbers are treated as Indian (+91).</p></div>
    <div class="field"><label for="fBd">Birthday</label>${noYear
      ? `<div class="grid2"><select id="fBdM" aria-label="Birthday month">${MONTHS.map((m, i) => `<option value="${String(i + 1).padStart(2, '0')}" ${D.birthday.slice(0, 2) === String(i + 1).padStart(2, '0') ? 'selected' : ''}>${m}</option>`).join('')}</select><input id="fBdD" type="number" min="1" max="31" aria-label="Birthday day" value="${Number(D.birthday.slice(3, 5)) || 1}"></div>`
      : `<input id="fBd" type="date" data-f="birthday" value="${esc(D.birthday || '')}">`}
      <label class="switch" style="border:0;padding-bottom:0"><span class="txt"><span>I don't know the year</span></span>${toggle('data-act="bd-noyear"', noYear, 'No year')}</label></div>
    <div class="field"><label for="fTags">Tags / lists (comma separated)</label><input id="fTags" type="text" data-f="tags" data-type="csv" value="${esc((D.tags || []).join(', '))}" placeholder="family, friends">
      <div class="chips" style="margin-top:6px">${allTags().map((t) => `<button type="button" class="chip ${(D.tags || []).includes(t) ? 'on' : ''}" data-act="tag-toggle" data-v="${esc(t)}">${esc(t)}</button>`).join('')}</div></div>
  </div>
  <div class="card">
    ${sw('Auto birthday wish', `Sent at ${esc(settings().birthdays.time)} on their birthday (change time in Settings).`, 'data-f="wishBirthday"', D.wishBirthday !== false)}
    <div class="field" style="margin-top:10px"><label for="fBm">Custom birthday message (optional)</label><textarea id="fBm" data-f="birthdayMessage" placeholder="${esc(settings().birthdays.message)}">${esc(D.birthdayMessage || '')}</textarea>${placeholderChips('fBm')}</div>
    <span class="lbl">Preview</span><div id="pv"></div>
    <div class="field" style="margin-top:12px"><span class="lbl">🤖 Header for this person</span>${seg('header', [['default', 'Default'], ['on', 'On'], ['off', 'Off']], D.header || 'default')}</div>
  </div>
  ${existing ? '<button class="btn danger" style="width:100%" data-act="c-del">Delete contact</button>' : ''}
  <div class="sticky-save"><button class="btn ghost" data-act="back">Cancel</button><button class="btn primary" data-act="c-save">Save</button></div>`;
  refreshPreview();
}

function renderReplies() {
  if (!D || D._id !== 'replies') D = { ...clone(settings()), _kind: 'settings', _id: 'replies' };
  const s = D;
  view().innerHTML = `<div class="ph"><div><h1>Replies</h1><p>Busy mode, auto-replies, away and AI replies</p></div></div>
  ${alwaysOn() ? '' : '<div class="banner warn"><span>⏱</span><div><b>These replies are delayed</b>Always on is off (or the bot is paused), so GitHub wakes the bot about every 30 minutes and replies arrive on the next check — not instantly. Scheduled messages are still exact. Turn on Settings → Timing → Always on for near-instant replies.</div></div>'}
  ${busyCard(s)}
  <div class="card"><h2>⚡ Auto-reply rules <span class="count">${rules().length}</span></h2>
    ${sw('Auto-reply', 'Reply when a message matches a keyword', 'data-f="features.autoReply"', s.features.autoReply, delayedPill())}
    ${sw('Also respond to stickers & GIFs', 'Off = stickers, GIFs, reactions and deleted messages never trigger auto-replies, away, AI or busy replies (good for busy groups)', 'data-f="replies.stickers"', !!s.replies?.stickers)}
    <div class="list">${rules().map((r) => `<a class="row" href="#/rule/${esc(r.id)}"><div class="ic">${r.enabled === false ? '⏸️' : '⚡'}</div><div class="main"><div class="t">${esc(r.match)}: “${esc(r.pattern)}”</div><div class="d">→ ${r.react ? esc(r.react) + ' ' : ''}${esc((Array.isArray(r.reply) ? r.reply[0] : r.reply) || (r.react ? 'reaction only' : ''))}</div></div><div class="r">${esc({ private: 'private', groups: 'groups', both: 'both' }[r.where || 'private'] || r.where)}${(r.groups || []).length && r.where !== 'private' ? ` · ${r.groups.length} grp` : ''}${(r.contacts || []).length + (r.tags || []).length && r.where !== 'groups' ? ' · picked' : ''}</div></a>`).join('') || '<p class="empty">No rules yet.</p>'}</div>
    <div class="btns" style="margin-top:10px"><a class="btn sm cy" href="#/rule/new">＋ Add rule</a></div>
    <div class="field" style="margin-top:12px"><label for="ruleTest">Test a message</label><input id="ruleTest" type="text" placeholder="e.g. what's your price?"><p class="hint" id="ruleTestOut">Type to see which rule would answer.</p></div>
  </div>
  <div class="card"><h2>🌙 Away mode</h2>
    ${sw('Away mode', 'Auto-reply once per person while you are away. You can also send !away / !back to yourself on WhatsApp.', 'data-f="features.away"', s.features.away, delayedPill())}
    <div class="field" style="margin-top:10px"><label for="fAw">Away message</label><textarea id="fAw" data-f="away.message">${esc(s.away.message)}</textarea></div>
    ${sw('Only during these hours', 'Off = always away while Away mode is on', 'data-f="away.window.enabled"', s.away.window.enabled)}
    <div class="grid2" style="margin-top:10px"><div class="field"><label for="fAf">From</label><input id="fAf" type="time" data-f="away.window.from" value="${esc(s.away.window.from)}"></div><div class="field"><label for="fAt">To</label><input id="fAt" type="time" data-f="away.window.to" value="${esc(s.away.window.to)}"></div></div>
    <div class="field"><label for="fAh">Reply to the same person at most once every (hours)</label><input id="fAh" type="number" min="1" data-f="away.onceEveryHours" data-type="num" value="${esc(s.away.onceEveryHours)}"></div>
    <div class="field"><span class="lbl">Who gets the away message</span>${seg('away.who', [['everyone', 'Everyone'], ['contacts', 'My contacts'], ['pick', 'Only these…']], whoMode(s.away.who))}${whoMode(s.away.who) === 'pick' ? peopleChips('away') : ''}<p class="hint">Private chats only. Never sent in groups.</p></div>
  </div>
  <div class="card"><h2>🧠 AI replies in your style</h2>
    ${sw('AI replies', 'Uses the free Groq API. Needs the GROQ_API_KEY secret (SETUP step 11).', 'data-f="features.ai"', s.features.ai, delayedPill())}
    <div class="field" style="margin-top:10px"><label for="fSp">Your style (how should it talk?)</label><textarea id="fSp" data-f="ai.stylePrompt" style="min-height:120px">${esc(s.ai.stylePrompt)}</textarea></div>
    <div class="field"><span class="lbl">Example chats (teach it how you reply)</span>
      ${(s.ai.examples || []).map((ex, i) => `<div class="card" style="padding:10px;margin-bottom:8px"><input type="text" aria-label="They say" data-f="ai.examples.${i}.them" value="${esc(ex.them)}" placeholder="They say…"><input type="text" aria-label="You reply" style="margin-top:6px" data-f="ai.examples.${i}.me" value="${esc(ex.me)}" placeholder="You reply…"><button class="btn sm ghost" data-act="ex-rm" data-i="${i}" style="margin-top:6px">Remove</button></div>`).join('')}
      <button class="btn sm" data-act="ex-add">＋ Add example</button></div>
    <div class="field"><span class="lbl">Who gets AI replies (private chats)</span>${seg('ai.who', [['contacts', 'My contacts'], ['pick', 'Only these…'], ['everyone', 'Everyone']], whoMode(s.ai.who))}${whoMode(s.ai.who) === 'pick' ? peopleChips('ai') : ''}</div>
    <div class="field"><span class="lbl">AI in groups</span>${groupScope('ai.groups', s.ai.groups, [['none', 'No groups'], ['pick', 'Only these groups']], { none: 'The AI never answers in groups.', pick: 'It answers there only when someone @mentions you or replies to your message.' })}</div>
    ${sw('Also react with an emoji', 'The AI picks one fitting reaction (❤️ 👍 😂 😮 😢 🙏 🔥 🎉) or none, on the same messages it answers', 'data-f="ai.react"', s.ai.react)}
    <div class="grid2"><div class="field"><label for="fAiM">Memory (messages)</label><input id="fAiM" type="number" min="0" max="20" data-f="ai.memory" data-type="num" value="${esc(s.ai.memory)}"></div><div class="field"><label for="fAiC">Max replies / chat / day</label><input id="fAiC" type="number" min="1" data-f="ai.maxPerChatPerDay" data-type="num" value="${esc(s.ai.maxPerChatPerDay)}"></div></div>
    <div class="field"><label for="fAiModel">Model</label><input id="fAiModel" type="text" data-f="ai.model" value="${esc(s.ai.model)}"><p class="hint">Free plan default: openai/gpt-oss-120b (30 requests/min, 1,000/day).</p></div>
  </div>
  <div class="sticky-save"><button class="btn primary" data-act="settings-save">Save replies</button></div>`;
  $('#ruleTest').addEventListener('input', (e) => {
    const t = e.target.value; const hit = rules().find((r) => matchText(r, t) && ruleApplies(r, {}));
    $('#ruleTestOut').innerHTML = !t ? 'Type to see which rule would answer.' : hit ? `✅ Rule “${esc(hit.pattern)}” replies: <b>${esc(Array.isArray(hit.reply) ? hit.reply[0] : hit.reply)}</b>` : `No rule matches${s.features.ai ? ' → AI would reply' : ''}.`;
  });
}

function renderRuleEditor(id) {
  const existing = rules().find((r) => r.id === id);
  if (!D || D._id !== id) {
    D = { ...(existing ? clone(existing) : { id: uid('r'), enabled: true, match: 'contains', pattern: '', caseSensitive: false, reply: '', react: '', where: 'private', contacts: [], tags: [], groups: [], exclude: [], cooldownMinutes: 60 }), _id: id, _kind: 'rule' };
    D._people = (D.contacts || []).length || (D.tags || []).length ? 'pick' : 'all';
    D._groups = (D.groups || []).length ? 'pick' : 'all';
  }
  const where = D.where || 'private';
  view().innerHTML = `<button class="back" data-act="back">‹ Replies</button>
  <div class="ph"><div><h1>${existing ? 'Edit rule' : 'New rule'}</h1><p>${alwaysOn() ? 'Replies go out within seconds while the bot is online' : 'Replies arrive on the next check (≈30 min)'}</p></div></div>
  <div class="card">
    <div class="field"><span class="lbl">When a message…</span>${seg('match', [['contains', 'contains'], ['exact', 'is exactly'], ['startsWith', 'starts with'], ['regex', 'regex']], D.match)}</div>
    <div class="field"><label for="fPat">Words</label><input id="fPat" type="text" data-f="pattern" value="${esc(D.pattern)}" placeholder="price, cost, rate"><p class="hint">"contains": separate options with commas.</p></div>
    ${sw('Match capital letters exactly', '', 'data-f="caseSensitive"', D.caseSensitive)}
    <div class="field" style="margin-top:10px"><label for="fRep">Reply (one per line = random pick)</label><textarea id="fRep" data-f="reply" data-type="lines">${esc(Array.isArray(D.reply) ? D.reply.join('\n') : D.reply)}</textarea>${placeholderChips('fRep')}</div>
    <div class="field"><span class="lbl">React with an emoji</span><div class="chips">${['', ...REACTIONS].map((e) => `<button type="button" class="chip ${(D.react || '') === e ? 'on' : ''}" data-act="r-react" data-v="${esc(e)}" aria-pressed="${(D.react || '') === e}">${e || 'No reaction'}</button>`).join('')}</div><p class="hint">Puts the emoji on their message. Leave the reply empty for “reaction only”.</p></div>
  </div>
  <div class="card"><h2>👀 Who this rule works for</h2>
    <div class="field"><span class="lbl">Where</span>${seg('where', [['private', 'Private chats'], ['groups', 'Groups'], ['both', 'Both']], where)}</div>
    ${where !== 'groups' ? `<div class="field"><span class="lbl">People (private chats)</span><div class="seg" role="group">${[['all', 'Everyone'], ['pick', 'Only these…']].map(([v, l]) => `<button type="button" data-act="r-people" data-v="${v}" aria-pressed="${D._people === v}">${l}</button>`).join('')}</div>${D._people === 'pick' ? peopleChips('') : ''}</div>` : ''}
    ${where !== 'private' ? `<div class="field"><span class="lbl">Groups</span>${groupScope('groups', D._groups === 'pick' ? D.groups || [] : 'all', [['all', 'All groups'], ['pick', 'Only these groups']], { all: 'Works in every group you are in.', pick: 'In these groups it answers anyone.' })}</div>` : ''}
    <div class="field"><label for="fCd">Cooldown per chat (minutes)</label><input id="fCd" type="number" min="0" data-f="cooldownMinutes" data-type="num" value="${esc(D.cooldownMinutes ?? 60)}"><p class="hint">Stops the bot replying again and again in the same chat.</p></div>
    ${sw('Rule on', '', 'data-f="enabled"', D.enabled !== false)}
  </div>
  ${existing ? '<button class="btn danger" style="width:100%" data-act="r-del">Delete rule</button>' : ''}
  <div class="sticky-save"><button class="btn ghost" data-act="back">Cancel</button><button class="btn primary" data-act="r-save">Save</button></div>`;
}

function renderMore() {
  view().innerHTML = `<div class="ph"><div><h1>More</h1></div></div>
  <div class="card"><div class="list">
    <a class="row" href="#/status"><div class="ic">📸</div><div class="main"><div class="t">Auto status</div><div class="d">${settings().autoStatus?.enabled ? 'On · ' + esc(pretty12(settings().autoStatus.time)) : 'Off'} · motivational quotes or your own text</div></div><div class="r">›</div></a>
    <a class="row" href="#/festivals"><div class="ic">🪔</div><div class="main"><div class="t">Festivals & occasions</div><div class="d">Diwali, Sankranti, Eid, New Year… 2026–2027</div></div><div class="r">›</div></a>
    <a class="row" href="#/templates"><div class="ic">📝</div><div class="main"><div class="t">Templates</div><div class="d">Reusable messages with {name}, {date}…</div></div><div class="r">›</div></a>
    <a class="row" href="#/groups"><div class="ic">👥</div><div class="main"><div class="t">Group tools</div><div class="d">Welcome, anti-link, !tagall, !rules</div></div><div class="r">›</div></a>
    <a class="row" href="#/settings"><div class="ic">⚙️</div><div class="main"><div class="t">Settings</div><div class="d">Features on/off, header, timing, alerts</div></div><div class="r">›</div></a>
    <a class="row" href="#/logs"><div class="ic">🧾</div><div class="main"><div class="t">Logs</div><div class="d">Sent messages, runs, saved media</div></div><div class="r">›</div></a>
  </div></div>
  <div class="card"><h2>📲 Install as an app</h2><p class="small muted">Chrome: ⋮ → “Add to Home screen”. Safari: Share → “Add to Home Screen”. It opens full-screen like a real app.</p></div>
  <div class="card"><div class="list">
    ${S.cfg ? `<a class="row" href="https://github.com/${esc(S.cfg.owner)}/${esc(S.cfg.repo)}/actions" target="_blank" rel="noopener"><div class="ic">🚀</div><div class="main"><div class="t">Open GitHub Actions</div><div class="d">See every run, re-pair WhatsApp</div></div><div class="r">↗</div></a>
    <a class="row" href="https://github.com/${esc(S.cfg.owner)}/${esc(S.cfg.repo)}/blob/main/SETUP.md" target="_blank" rel="noopener"><div class="ic">📘</div><div class="main"><div class="t">Setup guide & troubleshooting</div></div><div class="r">↗</div></a>` : ''}
    <a class="row" href="#/logout"><div class="ic">🚪</div><div class="main"><div class="t">Sign out</div><div class="d">Removes the token and password from this phone</div></div><div class="r">›</div></a>
  </div></div>
  <p class="tiny muted" style="text-align:center">VR Bot v1.0 · by VR DEVELOPMENTS · <a href="https://vrdevelopments.sites.tab.bot" target="_blank" rel="noopener">vrdevelopments</a> · <a href="https://github.com/Volam-Rakshith" target="_blank" rel="noopener">GitHub</a></p>`;
}

let festYear = Math.min(2028, Math.max(2026, new Date().getFullYear()));
function renderFestivals() {
  const list = mergedFestivals(festCfg());
  const yrs = [2026, 2027, 2028];
  view().innerHTML = `<button class="back" data-act="go" data-v="#/more">‹ More</button>
  <div class="ph"><div><h1>Festivals</h1><p>Built-in Indian calendar + your own occasions</p></div></div>
  <div class="banner info"><span>🌙</span><div><b>Lunar dates change every year</b>Festivals marked 🌙 follow the moon (Eid depends on sighting). Check them each January — tap a festival to correct a date.</div></div>
  <div class="field">${seg('festYear', yrs.map((y) => [y, String(y)]), festYear)}</div>
  <div class="field"><label for="fDt">Default time for festival wishes</label><input id="fDt" type="time" value="${esc(festCfg().defaultTime || '00:00')}" data-act="fest-default"></div>
  <div class="card"><div class="list">${list.map((f) => { const d = festivalDate(f, festYear); const on = f.enabled && (f.to || []).length; return `<a class="row" href="#/festival/${esc(f.id)}"><div class="ic">${esc(f.emoji || '🎉')}</div><div class="main"><div class="t">${esc(f.name)} ${f.lunar ? '🌙' : ''} ${f.builtin ? '' : '<span class="pill vi tiny">custom</span>'}</div><div class="d">${on ? `✅ ${(f.to || []).map((t) => esc(targetLabel(t))).join(', ')} · ${esc(pretty12(f.time || festCfg().defaultTime || '00:00'))}` : 'off'}</div></div><div class="r when">${d ? esc(prettyDate(d).replace(/ \d{4}$/, '')) : '—'}</div></a>`; }).join('')}</div></div>
  <a class="fab" href="#/festival/new" aria-label="Add occasion">＋</a>`;
}

function renderFestivalEditor(id) {
  const list = mergedFestivals(festCfg());
  const f = list.find((x) => x.id === id);
  const isNew = id === 'new';
  if (!D || D._id !== id) D = { ...(f ? clone(f) : { id: uid('occ'), name: '', emoji: '🎉', dates: {}, builtin: false }), enabled: f ? !!f.enabled : true, to: clone(f?.to || []), time: f?.time || '', message: f?.message || '', header: f?.header || 'default', _id: id, _kind: 'festival' };
  const years = [2026, 2027, 2028];
  view().innerHTML = `<button class="back" data-act="go" data-v="#/festivals">‹ Festivals</button>
  <div class="ph"><div><h1>${esc(D.emoji || '🎉')} ${isNew ? 'New occasion' : esc(D.name)}</h1><p>${D.lunar ? '🌙 Date follows the lunar calendar — verify yearly' : D.builtin ? 'Fixed date' : 'Your own occasion'}</p></div></div>
  <div class="card">
    ${!D.builtin ? `<div class="grid2"><div class="field"><label for="fFn">Name</label><input id="fFn" type="text" data-f="name" value="${esc(D.name)}" placeholder="Anniversary"></div><div class="field"><label for="fFe">Emoji</label><input id="fFe" type="text" data-f="emoji" value="${esc(D.emoji)}"></div></div>` : ''}
    <span class="lbl">Dates</span><div class="grid2">${years.map((y) => `<div class="field"><label for="fy${y}" class="tiny muted">${y}</label><input id="fy${y}" type="date" data-f="dates.${y}" value="${esc((D.dates || {})[y] || '')}"></div>`).join('')}</div>
  </div>
  <div class="card">
    ${sw('Send wishes', 'Sends to the recipients below on the day', 'data-f="enabled"', D.enabled)}
    <div class="field" style="margin-top:10px"><span class="lbl">Send to</span>${targetPicker(D.to)}</div>
    <div class="field"><label for="fFt">Time (empty = default ${esc(festCfg().defaultTime || '00:00')})</label><input id="fFt" type="time" data-f="time" value="${esc(D.time)}"></div>
    <div class="field"><label for="fFm">Message</label><textarea id="fFm" data-f="message" placeholder="Happy {festival} {first_name|}! ✨">${esc(D.message)}</textarea>${placeholderChips('fFm')}</div>
    <span class="lbl">Preview</span><div id="pv"></div>
    <div class="field" style="margin-top:12px"><span class="lbl">🤖 Header</span>${seg('header', [['default', 'Default (off)'], ['on', 'On'], ['off', 'Off']], D.header || 'default')}</div>
  </div>
  ${!D.builtin && !isNew ? '<button class="btn danger" style="width:100%" data-act="f-del">Delete occasion</button>' : ''}
  <div class="sticky-save"><button class="btn ghost" data-act="go" data-v="#/festivals">Cancel</button><button class="btn primary" data-act="f-save">Save</button></div>`;
  refreshPreview();
}

function renderTemplates() {
  view().innerHTML = `<button class="back" data-act="go" data-v="#/more">‹ More</button>
  <div class="ph"><div><h1>Templates</h1><p>{name} {first_name} {date} {day} {time} {festival} {age} {my_name}</p></div></div>
  <div class="card"><div class="list">${templates().map((t) => `<a class="row" href="#/template/${esc(t.id)}"><div class="ic">📝</div><div class="main"><div class="t">${esc(t.name)}</div><div class="d">${esc(t.text)}</div></div><div class="r">›</div></a>`).join('') || '<p class="empty">No templates yet.</p>'}</div></div>
  <div class="card small muted">Tips: <span class="mono">{name|friend}</span> uses “friend” if the name is empty. <span class="mono">{{Hi|Hello|Hey}}</span> picks one at random so messages don't look copy-pasted.</div>
  <a class="fab" href="#/template/new" aria-label="New template">＋</a>`;
}
function renderTemplateEditor(id) {
  const existing = templates().find((t) => t.id === id);
  if (!D || D._id !== id) D = { ...(existing ? clone(existing) : { id: uid('t'), name: '', text: '' }), _id: id, _kind: 'template' };
  view().innerHTML = `<button class="back" data-act="go" data-v="#/templates">‹ Templates</button>
  <div class="ph"><div><h1>${existing ? 'Edit template' : 'New template'}</h1></div></div>
  <div class="card"><div class="field"><label for="fTn">Name</label><input id="fTn" type="text" data-f="name" value="${esc(D.name)}"></div>
  <div class="field"><label for="fTt">Text</label><textarea id="fTt" data-f="text">${esc(D.text)}</textarea>${placeholderChips('fTt')}</div>
  <span class="lbl">Preview</span><div id="pv"></div></div>
  ${existing ? '<button class="btn danger" style="width:100%" data-act="t-del">Delete template</button>' : ''}
  <div class="sticky-save"><button class="btn ghost" data-act="go" data-v="#/templates">Cancel</button><button class="btn primary" data-act="t-save">Save</button></div>`;
  refreshPreview();
}

function renderGroups() {
  const cfg = groupsCfg();
  const ids = [...new Set([...seenGroups().map((g) => g.id), ...Object.keys(cfg)])];
  view().innerHTML = `<button class="back" data-act="go" data-v="#/more">‹ More</button>
  <div class="ph"><div><h1>Group tools</h1><p>Welcome new members, block links, !tagall, !rules</p></div></div>
  <div class="banner warn"><span>⏱</span><div><b>${alwaysOn() ? 'Admin needed' : 'Delayed'}</b>${alwaysOn() ? '' : 'Group tools act on the next check (≈30 min). '}Deleting links or removing people only works where your number is a group admin.</div></div>
  <p class="hint" style="margin:0 2px 10px">Welcome and anti-link only run in the groups you switch them on for below. Who can use !tagall / !rules is set in Settings → Commands → In groups.</p>
  <div class="card"><div class="list">${ids.map((id) => { const g = seenGroups().find((x) => x.id === id); const c = cfg[id] || {}; return `<a class="row" href="#/group/${encodeURIComponent(id)}"><div class="ic">👥</div><div class="main"><div class="t">${esc(g?.name || c.name || id)} ${g?.admin ? '<span class="pill ok tiny">admin</span>' : ''}</div><div class="d">${[c.welcome?.enabled && 'welcome', c.antiLink?.enabled && 'anti-link', c.rulesText && 'rules'].filter(Boolean).join(' · ') || 'no tools on'}${g ? ` · ${g.size} members` : ''}</div></div><div class="r">›</div></a>`; }).join('') || '<p class="empty">Your groups show up here after the bot\'s first run.</p>'}</div></div>`;
}
function renderGroupEditor(id) {
  const g = seenGroups().find((x) => x.id === id);
  const c = groupsCfg()[id] || {};
  if (!D || D._id !== id) D = { name: g?.name || c.name || '', welcome: { enabled: false, message: 'Welcome {name} to {group}! 👋', ...(c.welcome || {}) }, antiLink: { enabled: false, action: 'warn', warnLimit: 3, allowDomains: [], ...(c.antiLink || {}) }, rulesText: c.rulesText || '', tagallAdminsOnly: c.tagallAdminsOnly !== false, _id: id, _kind: 'group' };
  view().innerHTML = `<button class="back" data-act="go" data-v="#/groups">‹ Groups</button>
  <div class="ph"><div><h1>${esc(D.name || 'Group')}</h1><p class="mono tiny">${esc(id)}</p></div></div>
  <div class="card">${sw('Welcome new members', 'Mentions them with this message', 'data-f="welcome.enabled"', D.welcome.enabled, delayedPill())}
    <div class="field" style="margin-top:10px"><label for="fGw">Welcome message</label><textarea id="fGw" data-f="welcome.message">${esc(D.welcome.message)}</textarea><p class="hint">{name} = the new member(s), {group} = group name</p></div></div>
  <div class="card">${sw('Anti-link', 'Warn people who post links', 'data-f="antiLink.enabled"', D.antiLink.enabled, delayedPill())}
    <div class="field" style="margin-top:10px"><span class="lbl">Action</span>${seg('antiLink.action', [['warn', 'Warn only'], ['delete', 'Delete + warn'], ['remove', 'Delete, remove after limit']], D.antiLink.action)}</div>
    <div class="grid2"><div class="field"><label for="fGl">Warnings before removal</label><input id="fGl" type="number" min="1" data-f="antiLink.warnLimit" data-type="num" value="${esc(D.antiLink.warnLimit)}"></div><div class="field"><label for="fGa">Allowed sites</label><input id="fGa" type="text" data-f="antiLink.allowDomains" data-type="csv" value="${esc((D.antiLink.allowDomains || []).join(', '))}" placeholder="github.com"></div></div></div>
  <div class="card"><div class="field"><label for="fGr">!rules text</label><textarea id="fGr" data-f="rulesText">${esc(D.rulesText)}</textarea></div>
    ${sw('!tagall only for admins', 'You (the owner) can always use it', 'data-f="tagallAdminsOnly"', D.tagallAdminsOnly)}</div>
  <div class="sticky-save"><button class="btn ghost" data-act="go" data-v="#/groups">Cancel</button><button class="btn primary" data-act="g-save">Save</button></div>`;
}

function renderSettings() {
  if (!D || D._id !== 'settings') D = { ...clone(settings()), _kind: 'settings', _id: 'settings' };
  const s = D;
  const F = s.features;
  const feat = (k, t, d, delayed = false) => sw(t, d, `data-f="features.${k}"`, F[k], delayed ? delayedPill() : '');
  const hd = s.header.defaults;
  view().innerHTML = `<button class="back" data-act="go" data-v="#/more">‹ More</button>
  <div class="ph"><div><h1>Settings</h1><p>Everything can be switched on or off</p></div></div>
  <div class="card"><h2>👤 Profile</h2>
    <div class="grid2"><div class="field"><label for="sMy">Your name</label><input id="sMy" type="text" data-f="myName" value="${esc(s.myName)}"></div><div class="field"><label for="sBn">Bot name</label><input id="sBn" type="text" data-f="botName" value="${esc(s.botName)}"></div></div>
    <div class="field"><label for="sTz">Timezone</label><input id="sTz" type="text" data-f="timezone" value="${esc(s.timezone)}"><p class="hint">Asia/Kolkata = India (IST).</p></div>
    ${sw('Pause everything', 'Master switch — no scheduled messages go out while on', 'data-f="paused"', s.paused)}</div>
  <div class="card"><h2>🧩 Features</h2>
    ${feat('scheduled', 'Scheduled messages', 'Your schedules (exact time)')}
    ${feat('groupScheduler', 'Group message scheduler', 'Schedules that send to groups')}
    ${feat('birthdays', 'Birthday wishes', 'From contacts\' birthdays')}
    ${feat('festivals', 'Festival wishes', 'Built-in Indian festival calendar')}
    ${feat('broadcast', 'Lists / broadcast', 'Send one schedule to a whole tag, with gaps')}
    ${feat('followup', '“No reply” follow-up', 'Nudge chosen people after X days of silence')}
    ${feat('summary', 'Daily summary to me', 'Who messaged, what is scheduled, failures')}
    ${feat('alerts', 'Alerts to me', 'GitHub stars/issues + website contact form')}
    ${feat('failureAlerts', 'Failure alerts to me', 'WhatsApp you when a message could not be sent')}
    ${feat('autoReply', 'Auto-reply rules', 'Keyword replies', true)}
    ${feat('away', 'Away mode', 'Away message', true)}
    ${feat('ai', 'AI replies', 'Groq, in your style', true)}
    ${feat('groupTools', 'Group tools', 'Welcome, anti-link, !tagall, !rules', true)}
    ${feat('commands', 'Commands', '!sticker !pdf !weather !help !yt', true)}
    ${feat('voiceToText', 'Voice note → text', 'Groq Whisper (needs GROQ_API_KEY)', true)}
    ${feat('mediaSave', 'Save incoming media', 'Small files, encrypted, kept on the vr-media branch', true)}
  </div>
  <div class="card"><h2>🤖 “VR Bot is sending” header</h2>
    ${sw('Header on bot messages', 'A first line that shows the message was sent by your bot', 'data-f="header.enabled"', s.header.enabled)}
    <div class="field" style="margin-top:10px"><label for="sHt">Header text</label><input id="sHt" type="text" data-f="header.text" value="${esc(s.header.text)}"><p class="hint">*bold* and _italic_ work like in WhatsApp.</p></div>
    <span class="lbl">Default per message type (schedules & contacts can override)</span>
    ${[['personal', 'Personal schedules'], ['birthday', 'Birthday wishes'], ['festival', 'Festival wishes'], ['followup', 'Follow-ups'], ['group', 'Group messages'], ['broadcast', 'Lists / broadcasts'], ['alert', 'Alerts to me'], ['summary', 'Daily summary'], ['reply', 'Auto-replies & away'], ['ai', 'AI replies']].map(([k, l]) => sw(l, '', `data-f="header.defaults.${k}"`, hd[k])).join('')}
    <span class="lbl" style="margin-top:10px;display:block">Preview</span>${messagePreview('Class starts at 9:30 ⏰', 'group')}</div>
  <div class="card"><h2>⏰ Timing</h2>
    <div class="grid2"><div class="field"><label for="sLa">Look-ahead (min)</label><input id="sLa" type="number" min="20" max="80" data-f="timing.lookaheadMinutes" data-type="num" value="${esc(s.timing.lookaheadMinutes)}"></div><div class="field"><label for="sLg">Send if late up to (min)</label><input id="sLg" type="number" min="0" data-f="timing.lateGraceMinutes" data-type="num" value="${esc(s.timing.lateGraceMinutes)}"></div></div>
    ${sw('Always on (recommended)', 'Keeps the bot connected all day: each run starts the next one before it ends, so messages go out on the minute and replies are near-instant — even when GitHub\'s timer skips. Off = the bot only wakes when GitHub\'s timer fires (can be hours late).', 'data-f="timing.relay"', s.timing.relay)}
    <div class="field" style="margin-top:10px"><label for="sHd">Human-like delay (± minutes, for schedules that turn it on)</label><input id="sHd" type="number" min="1" max="60" data-f="humanDelay.minutes" data-type="num" value="${esc(s.humanDelay.minutes)}"></div></div>
  <div class="card"><h2>📣 Lists / broadcast</h2>
    <div class="banner warn" style="margin-bottom:10px"><span>⚠️</span><div><b>Ban risk</b>WhatsApp bans numbers that mass-message people who don't know them. Only message people who saved your number, keep the daily cap low, and use a spare number if you can.</div></div>
    <div class="grid2"><div class="field"><label for="sB1">Gap min (sec)</label><input id="sB1" type="number" min="3" data-f="broadcast.minGapSeconds" data-type="num" value="${esc(s.broadcast.minGapSeconds)}"></div><div class="field"><label for="sB2">Gap max (sec)</label><input id="sB2" type="number" min="3" data-f="broadcast.maxGapSeconds" data-type="num" value="${esc(s.broadcast.maxGapSeconds)}"></div></div>
    <div class="field"><label for="sBc">Daily cap (list messages per day)</label><input id="sBc" type="number" min="1" data-f="broadcast.dailyCap" data-type="num" value="${esc(s.broadcast.dailyCap)}"></div></div>
  <div class="card"><h2>🎂 Birthdays</h2>
    <div class="field"><label for="sBt">Send at</label><input id="sBt" type="time" data-f="birthdays.time" value="${esc(s.birthdays.time)}"><p class="hint">00:00 = right at midnight.</p></div>
    <div class="field"><label for="sBm">Default birthday message</label><textarea id="sBm" data-f="birthdays.message">${esc(s.birthdays.message)}</textarea></div>
    ${sw('Tell me too', 'A note to you when a birthday wish goes out', 'data-f="birthdays.remindMe"', s.birthdays.remindMe)}</div>
  <div class="card"><h2>↩️ “No reply” follow-up</h2>
    <div class="grid2"><div class="field"><label for="sFd">After (days)</label><input id="sFd" type="number" min="1" data-f="followup.days" data-type="num" value="${esc(s.followup.days)}"></div><div class="field"><label for="sFt">At</label><input id="sFt" type="time" data-f="followup.time" value="${esc(s.followup.time)}"></div></div>
    <div class="field"><label for="sFm">Message</label><textarea id="sFm" data-f="followup.message">${esc(s.followup.message)}</textarea></div>
    <div class="field"><label for="sFg">For contacts with these tags</label><input id="sFg" type="text" data-f="followup.tags" data-type="csv" value="${esc((s.followup.tags || []).join(', '))}" placeholder="clients"><p class="hint">Only after a message YOU sent got no answer. Sent once per message.</p></div></div>
  <div class="card"><h2>📊 Daily summary</h2><div class="field"><label for="sSt">Send at</label><input id="sSt" type="time" data-f="summary.time" value="${esc(s.summary.time)}"></div></div>
  <div class="card"><h2>🗓️ Weekly report</h2>
    ${sw('Weekly report to me', 'Who texted you most, busiest groups, this week vs last week, busiest hour', 'data-f="weekly.enabled"', s.weekly.enabled !== false)}
    <div class="field" style="margin-top:10px"><span class="lbl">Day</span>${seg('weekly.day', WEEKDAYS.map((w, i) => [String(i), w]), String(s.weekly.day ?? 0))}</div>
    <div class="field"><label for="sWt">At</label><input id="sWt" type="time" data-f="weekly.time" value="${esc(s.weekly.time)}"></div>
    <p class="hint">Counts only: the bot saves how many messages each chat sent per day, never the text.</p>
    <div class="btns" style="margin-top:10px"><button class="btn sm" data-act="wk-test">Send me this week's report now</button></div></div>
  <div class="card"><h2>⌨️ Commands</h2>
    <div class="field"><span class="lbl">Who can use them in private chats</span>${seg('commands.allow', [['owner', 'Only me'], ['contacts', 'My contacts'], ['pick', 'Only these…'], ['everyone', 'Everyone']], whoMode(s.commands.allow))}${whoMode(s.commands.allow) === 'pick' ? peopleChips('commands') : ''}</div>
    <div class="field"><span class="lbl">In groups</span>${groupScope('commands.groups', s.commands.inGroups === false ? 'none' : s.commands.groups, [['none', 'No groups'], ['pick', 'Only these groups'], ['all', 'Any group']], { none: 'Nobody can use commands in groups (except you).', pick: 'Anyone in these groups can use them (!tagall still follows the admin setting in Group tools).', all: 'Any group, but only the people chosen above.' })}<p class="hint">You can always use every command, everywhere.</p></div>
    ${['help', 'weather', 'sticker', 'pdf', 'tagall', 'rules'].map((k) => sw('!' + k, '', `data-f="commands.enabled.${k}"`, s.commands.enabled[k])).join('')}
    ${sw('!yt (experimental)', 'YouTube often blocks GitHub servers, so this may fail', 'data-f="commands.enabled.yt"', s.commands.enabled.yt)}</div>
  <div class="card"><h2>🎤 Voice notes</h2><div class="field"><span class="lbl">Send the transcript to</span>${seg('voice.sendTo', [['owner', 'Me (private)'], ['chat', 'Reply in that chat']], s.voice.sendTo)}</div>
    <div class="field"><span class="lbl">Whose voice notes</span>${seg('voice.who', [['everyone', 'Everyone'], ['contacts', 'My contacts'], ['pick', 'Only these…']], whoMode(s.voice.who))}${whoMode(s.voice.who) === 'pick' ? peopleChips('voice') : ''}<p class="hint">Private chats only.</p></div></div>
  <div class="card"><h2>💾 Saved media</h2>
    ${sw('Save statuses', 'Image/video statuses seen while the bot is connected', 'data-f="media.statuses"', s.media.statuses)}
    ${sw('Save media from chats', '', 'data-f="media.chats"', s.media.chats)}
    <div class="field" style="margin-top:10px"><span class="lbl">From whom</span>${seg('media.who', [['everyone', 'Everyone'], ['contacts', 'My contacts'], ['pick', 'Only these…']], whoMode(s.media.who))}${whoMode(s.media.who) === 'pick' ? peopleChips('media') : ''}<p class="hint">Also decides whose statuses are saved.</p></div>
    <div class="field"><span class="lbl">From groups</span>${groupScope('media.groups', s.media.groups, [['none', 'No groups'], ['pick', 'Only these groups'], ['all', 'Any group']], { none: 'Nothing is saved from groups.', pick: 'Everything sent in these groups is saved.', all: 'Any group, but only from the people chosen above.' })}</div>
    <div class="grid2"><div class="field"><label for="sMm">Max file size (MB)</label><input id="sMm" type="number" min="1" max="20" data-f="media.maxFileMB" data-type="num" value="${esc(s.media.maxFileMB)}"></div><div class="field"><label for="sMt">Keep up to (MB total)</label><input id="sMt" type="number" min="50" max="900" data-f="media.totalCapMB" data-type="num" value="${esc(s.media.totalCapMB)}"></div></div></div>
  <div class="card"><h2>🔔 Alerts to me</h2>
    ${sw('GitHub watcher', 'New stars, forks, issues and PRs on your public repos', 'data-f="alerts.github.enabled"', s.alerts.github.enabled)}
    <div class="grid2" style="margin-top:10px"><div class="field"><label for="sGu">GitHub user</label><input id="sGu" type="text" data-f="alerts.github.user" value="${esc(s.alerts.github.user)}"></div><div class="field"><label for="sGe">Check every (min)</label><input id="sGe" type="number" min="30" data-f="alerts.github.everyMinutes" data-type="num" value="${esc(s.alerts.github.everyMinutes)}"></div></div>
    <div class="field"><label for="sGr">Only these repos (empty = all)</label><input id="sGr" type="text" data-f="alerts.github.repos" data-type="csv" value="${esc((s.alerts.github.repos || []).join(', '))}"></div>
    ${sw('Website contact form', 'Your site posts to a private ntfy.sh topic; the bot forwards it to WhatsApp', 'data-f="alerts.form.enabled"', s.alerts.form.enabled)}
    <div class="field" style="margin-top:10px"><label for="sNt">ntfy topic (keep it secret)</label><div class="btns"><input id="sNt" type="text" data-f="alerts.form.ntfyTopic" value="${esc(s.alerts.form.ntfyTopic)}" style="flex:1"><button class="btn sm" data-act="gen-topic">Generate</button></div>
    <p class="hint">Add to your website form: <span class="mono">fetch('https://ntfy.sh/${esc(s.alerts.form.ntfyTopic || 'YOUR-TOPIC')}', {method:'POST', body: name + '\\n' + email + '\\n' + message})</span></p></div></div>
  <div class="sticky-save"><button class="btn primary" data-act="settings-save">Save settings</button></div>`;
}

let logTab = 'sent';
function renderLogs() {
  const st = status();
  const sent = Object.entries(S.state.sentlog?.entries || {}).map(([k, v]) => ({ k, ...v })).sort((a, b) => b.t - a.t);
  const runs = [...(st.runs || [])].reverse();
  const logs = [...(S.state.logs?.entries || [])].reverse();
  const media = [...(st.media || [])].reverse();
  let body = '';
  if (logTab === 'sent') body = sent.slice(0, 150).map((e) => `<div class="row"><div class="ic">${e.s === 'sent' ? '✅' : e.s === 'failed' ? '❌' : e.s === 'retry' ? '🔁' : '⏭️'}</div><div class="main"><div class="t">${esc(e.label || e.k)}</div><div class="d">${esc(e.to || '')} · ${esc(e.s)}${e.err ? ' · ' + esc(e.err) : ''}${e.lateSec > 120 ? ` · ${Math.round(e.lateSec / 60)} min late` : ''}</div></div><div class="r">${esc(new Date(e.t).toLocaleString('en-IN', { timeZone: tz(), day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }))}</div></div>`).join('') || '<p class="empty">Nothing sent yet.</p>';
  if (logTab === 'runs') body = runs.slice(0, 60).map((r) => `<div class="row"><div class="ic">${r.ok ? '🟢' : '🔴'}</div><div class="main"><div class="t">${esc(r.trigger || 'run')} · ${r.sent} sent${r.failed ? `, ${r.failed} failed` : ''}</div><div class="d">${r.received} messages read · ${Math.round(((r.endedAt || r.startedAt) - r.startedAt) / 1000)}s${r.late ? ` · ${r.late} late` : ''}</div></div><div class="r">${esc(ago(r.startedAt))}</div></div>`).join('') || '<p class="empty">No runs yet.</p>';
  if (logTab === 'bot') body = logs.slice(0, 200).map((l) => `<div class="row" style="align-items:flex-start"><div class="main"><div class="d ${l.level === 'error' ? 'bad' : l.level === 'warn' ? 'warn' : ''}" style="white-space:normal">${esc(l.msg)}</div></div><div class="r">${esc(new Date(l.t).toLocaleTimeString('en-IN', { timeZone: tz(), hour: 'numeric', minute: '2-digit' }))}</div></div>`).join('') || '<p class="empty">No log yet.</p>';
  if (logTab === 'media') body = media.length ? `<div class="media-grid">${media.slice(0, 90).map((m) => `<button data-act="media" data-path="${esc(m.path)}" data-mime="${esc(m.mimetype)}">${m.kind === 'image' ? '🖼️' : m.kind === 'video' ? '🎬' : m.kind === 'audio' ? '🎵' : '📄'}<br>${esc(m.from || '')}<br>${esc(ago(m.t))}${m.status ? '<br>status' : ''}</button>`).join('')}</div><div id="mediaView" class="media-view" style="margin-top:12px"></div>` : '<p class="empty">No saved media. Turn on “Save incoming media” in Settings.</p>';
  view().innerHTML = `<button class="back" data-act="go" data-v="#/more">‹ More</button>
  <div class="ph"><div><h1>Logs</h1><p>Updated after every bot run</p></div><button class="btn sm" data-act="reload">↻ Refresh</button></div>
  <div class="field">${seg('logTab', [['sent', 'Sent'], ['runs', 'Runs'], ['bot', 'Bot log'], ['media', 'Saved media']], logTab)}</div>
  <div class="card"><div class="list">${body}</div></div>`;
}

/* ---------------- router ---------------- */
const routes = [
  [/^#\/home$/, renderHome, 'home'], [/^#\/schedules$/, renderSchedules, 'schedules'], [/^#\/schedule\/(.+)$/, renderScheduleEditor, 'schedules'],
  [/^#\/contacts$/, renderContacts, 'contacts'], [/^#\/contact\/(.+)$/, renderContactEditor, 'contacts'],
  [/^#\/replies$/, renderReplies, 'replies'], [/^#\/rule\/(.+)$/, renderRuleEditor, 'replies'],
  [/^#\/more$/, renderMore, 'more'], [/^#\/festivals$/, renderFestivals, 'more'], [/^#\/festival\/(.+)$/, renderFestivalEditor, 'more'],
  [/^#\/templates$/, renderTemplates, 'more'], [/^#\/template\/(.+)$/, renderTemplateEditor, 'more'],
  [/^#\/groups$/, renderGroups, 'more'], [/^#\/group\/(.+)$/, (id) => renderGroupEditor(decodeURIComponent(id)), 'more'],
  [/^#\/settings$/, renderSettings, 'more'], [/^#\/logs$/, renderLogs, 'more'], [/^#\/status$/, renderStatus, 'more'],
];
function route() {
  const h = location.hash || '#/home';
  if (h === '#/demo') { startDemo(); return; }
  if (h === '#/logout') { localStorage.removeItem('vrbot.cfg'); localStorage.removeItem('vrbot.pass'); sessionStorage.clear(); S.cfg = null; S.pass = ''; S.demo = false; S.loaded = false; history.replaceState(null, '', '#/home'); renderLogin(); return; }
  if (!S.loaded) { renderLogin(); return; }
  const prevId = D?._id;
  for (const [re, fn, tab] of routes) {
    const m = h.match(re);
    if (m) {
      if (!m[1] || m[1] !== prevId) D = null;
      $('#tabs').hidden = false;
      $$('#tabs a').forEach((a) => a.classList.toggle('on', a.dataset.tab === tab));
      topStatus();
      fn(m[1]);
      window.scrollTo(0, 0);
      return;
    }
  }
  location.hash = '#/home';
}

/* ---------------- events ---------------- */
function onField(e) {
  const el = e.target.closest('[data-f]');
  if (!el || !D) return;
  setPath(D, el.dataset.f, readInput(el));
  if (el.dataset.rr) { if (e.type === 'change') rerender(); return; } // re-draw after the change (not on every key)
  if (el.dataset.f === 'templateId' || el.dataset.f === 'humanDelay.enabled' || el.dataset.f === 'wishBirthday') { rerender(); return; }
  refreshPreview();
}
function rerender() { const y = window.scrollY; const h = location.hash; for (const [re, fn] of routes) { const m = h.match(re); if (m) { fn(m[1]); break; } } window.scrollTo(0, y); }
const replaceIn = (list, item) => { const i = list.findIndex((x) => x.id === item.id); const copy = [...list]; if (i >= 0) copy[i] = item; else copy.push(item); return copy; };
const strip = (o) => { const c = clone(o); delete c._id; delete c._kind; return c; };
async function guarded(fn) { try { await fn(); } catch (e) { console.error(e); toast(e.message || String(e), 'bad'); } }

async function onClick(e) {
  const b = e.target.closest('[data-act],[data-seg]');
  if (!b) return;
  if (b.dataset.seg) {
    const f = b.dataset.seg, v = b.dataset.v;
    if (f === 'logTab') { logTab = v; renderLogs(); return; }
    if (f === 'festYear') { festYear = Number(v); renderFestivals(); return; }
    if (D) { setPath(D, f, f === 'repeat.type' ? v : v); if (f === 'repeat.type') D.repeat = { type: v, ...(v === 'once' ? { date: localDate(Date.now(), tz()) } : v === 'weekly' ? { days: [1, 2, 3, 4, 5] } : v === 'monthly' ? { day: 1 } : v === 'yearly' ? { month: new Date().getMonth() + 1, day: new Date().getDate() } : v === 'dates' ? { dates: [] } : {}) }; rerender(); }
    return;
  }
  const a = b.dataset.act;
  if (b.tagName === 'INPUT' && !['sch-enable', 'bd-noyear'].includes(a)) return;
  await guarded(async () => {
    switch (a) {
      case 'back': history.back(); break;
      case 'go': location.hash = b.dataset.v; break;
      case 'reload': toast('Refreshing…'); await loadAll(); rerender(); toast('Up to date ✓', 'ok'); break;
      case 'run-now': await api.dispatch({ action: 'run' }); toast('Started ✓ — the bot runs in 1–3 min', 'ok'); break;
      case 'pause': { const before = settings(); const s = settings(); s.paused = !s.paused; await save('settings', s); renderHome(); topStatus(); await kickIfResumed(before, s); break; }
      case 'rm-target': D.to.splice(Number(b.dataset.i), 1); rerender(); break;
      case 'wd': { const list = getPath(D, b.dataset.field) || []; const i = Number(b.dataset.i); setPath(D, b.dataset.field, list.includes(i) ? list.filter((x) => x !== i) : [...list, i].sort()); rerender(); break; }
      case 'add-date': { const v = $('#addDateVal').value; if (!isValidDate(v)) { toast('Pick a date first', 'bad'); break; } const list = getPath(D, b.dataset.field) || []; if (!list.includes(v)) setPath(D, b.dataset.field, [...list, v].sort()); rerender(); break; }
      case 'rm-date': { const list = getPath(D, b.dataset.field) || []; list.splice(Number(b.dataset.i), 1); rerender(); break; }
      case 'ins': { const ta = $('#' + b.dataset.target); const p = ta.selectionStart ?? ta.value.length; ta.value = ta.value.slice(0, p) + b.dataset.v + ta.value.slice(ta.selectionEnd ?? p); ta.focus(); ta.dispatchEvent(new Event('input', { bubbles: true })); break; }
      case 'sch-enable': { const x = schedules().find((s) => s.id === b.dataset.id); x.enabled = b.checked; await saveList('schedules', 'schedules', schedules()); break; }
      case 'sch-save': case 'sch-test': case 'sch-now': {
        if (!D.name.trim()) throw new Error('Give it a name');
        if (!isValidTime(D.time)) throw new Error('Pick a time');
        if (!(D.to || []).length) throw new Error('Add at least one recipient');
        if (!D.templateId && !D.message.trim()) throw new Error('Write a message or pick a template');
        if (D.repeat.type === 'weekly' && !(D.repeat.days || []).length) throw new Error('Pick at least one weekday');
        if (a === 'sch-now' && !confirm(`Send "${D.name}" to ${(D.to || []).length} recipient(s) right now?`)) break;
        const item = strip(D); if (!item.start) item.start = null; if (!item.end) item.end = null;
        await saveList('schedules', 'schedules', replaceIn(schedules(), item));
        if (a === 'sch-save') { D = null; location.hash = '#/schedules'; }
        else { await api.dispatch({ action: a === 'sch-test' ? 'test-send' : 'send-now', target: item.id }); toast(a === 'sch-test' ? 'Test started ✓ — check your WhatsApp in 1–3 min' : 'Sending ✓ — goes out in 1–3 min', 'ok'); D._id = item.id; if (location.hash !== `#/schedule/${item.id}`) history.replaceState(null, '', `#/schedule/${item.id}`); }
        break;
      }
      case 'sch-del': if (confirm('Delete this schedule?')) { await saveList('schedules', 'schedules', schedules().filter((x) => x.id !== D.id)); D = null; location.hash = '#/schedules'; } break;
      case 'ctag': contactFilter.tag = b.dataset.v; renderContacts(); break;
      case 'pick': { const path = b.dataset.path, v = b.dataset.v; const list = getPath(D, path) || []; setPath(D, path, list.includes(v) ? list.filter((x) => x !== v) : [...(Array.isArray(list) ? list : []), v]); rerender(); break; }
      case 'gscope': {
        const path = b.dataset.path, v = b.dataset.v;
        if (D._kind === 'rule') { D._groups = v; if (v !== 'pick') D.groups = []; rerender(); break; }
        const cur = getPath(D, path);
        setPath(D, path, v === 'pick' ? (Array.isArray(cur) ? cur : []) : v);
        if (path === 'commands.groups') D.commands.inGroups = v !== 'none';
        rerender(); break;
      }
      case 'r-people': D._people = b.dataset.v; if (D._people === 'all') { D.contacts = []; D.tags = []; } rerender(); break;
      case 'r-react': D.react = b.dataset.v; rerender(); break;
      case 'tag-toggle': { const t = b.dataset.v; D.tags = (D.tags || []).includes(t) ? D.tags.filter((x) => x !== t) : [...(D.tags || []), t]; rerender(); break; }
      case 'bd-noyear': { const bd = D.birthday || ''; D.birthday = b.checked ? (bd.length === 10 ? bd.slice(5) : '01-01') : (bd.length === 5 ? `2000-${bd}` : ''); rerender(); break; }
      case 'c-save': {
        if ($('#fBdM')) D.birthday = `${$('#fBdM').value}-${String(Math.min(31, Math.max(1, Number($('#fBdD').value) || 1))).padStart(2, '0')}`;
        if (!D.name.trim()) throw new Error('Name is required');
        if (normalizeNumber(D.number).length < 10) throw new Error('Enter the WhatsApp number with country code');
        const item = strip(D); delete item.example;
        await saveList('contacts', 'contacts', replaceIn(contacts(), item)); D = null; location.hash = '#/contacts'; break;
      }
      case 'c-del': if (confirm('Delete this contact?')) { await saveList('contacts', 'contacts', contacts().filter((x) => x.id !== D.id)); D = null; location.hash = '#/contacts'; } break;
      case 'del-examples': if (confirm('Delete all EXAMPLE contacts and schedules?')) { await saveList('contacts', 'contacts', contacts().filter((c) => !c.example)); await saveList('schedules', 'schedules', schedules().filter((x) => !x.example)); renderContacts(); } break;
      case 'import': {
        const rows = $('#importTxt').value.split('\n').map((l) => l.split(',').map((x) => x.trim())).filter((r) => r[0] && r[1]);
        const add = rows.map(([name, number, birthday = '', tags = '']) => ({ id: uid('c'), name, number, birthday: /^\d{4}-\d{2}-\d{2}$|^\d{2}-\d{2}$/.test(birthday) ? birthday : '', tags: tags.split('|').map((t) => t.trim()).filter(Boolean), header: 'default', wishBirthday: true }));
        if (!add.length) throw new Error('Nothing to import — use: Name, Number, Birthday, tags');
        await saveList('contacts', 'contacts', [...contacts(), ...add]); toast(`Imported ${add.length} contact(s) ✓`, 'ok'); renderContacts(); break;
      }
      case 'ex-add': D.ai.examples = [...(D.ai.examples || []), { them: '', me: '' }]; await save('settings', strip(D)); rerender(); break;
      case 'ex-rm': D.ai.examples.splice(Number(b.dataset.i), 1); await save('settings', strip(D)); rerender(); break;
      case 'busy-dur': busyDur = b.dataset.v; rerender(); break;
      case 'busy-on': case 'busy-off': {
        const now = Date.now();
        let until = 0;
        if (a === 'busy-on') {
          if (busyDur === 'until') {
            const v = $('#busyUntil')?.value; if (!isValidTime(v)) throw new Error('Pick the time you are back');
            const today = localDate(now, tz());
            const at = (d) => zonedToUtc(d, v, tz());
            until = at(today) > now ? at(today) : at(localDate(now + 86400000, tz()));
          } else until = now + Number(busyDur) * 60000;
        }
        D.busy = { ...(D.busy || {}), on: a === 'busy-on', until, setAt: now };
        const after = strip(D); await save('settings', after); topStatus();
        toast(a === 'busy-on' ? `Busy until ${busyTimeText(until, now, tz())} ✓ — the bot picks it up within a few minutes` : 'Busy mode off ✓', 'ok');
        rerender(); break;
      }
      case 'st-days': D.autoStatus.days = b.dataset.v === 'all' ? [0, 1, 2, 3, 4, 5, 6] : [1, 2, 3, 4, 5]; rerender(); break;
      case 'st-color': D.autoStatus.color = b.dataset.v; rerender(); break;
      case 'sd-all': sdAll = !sdAll; rerender(); break;
      case 'sd-prev': showCard(b.dataset.v); break;
      case 'st-save': case 'st-test': case 'sd-test': {
        const as = D.autoStatus;
        if (as.enabled && !(as.days || []).length) throw new Error('Pick at least one day');
        if (!isValidTime(as.time)) throw new Error('Pick a time');
        if (as.mode === 'own' && !(as.texts || []).length) throw new Error('Write at least one status, one per line');
        if (as.mode === 'photo' && as.photoUrl && !/^https:\/\/\S+$/i.test(as.photoUrl)) throw new Error('The photo link must start with https://');
        if (as.enabled && as.audience === 'only' && !(as.contacts || []).length && !(as.tags || []).length) throw new Error('Pick who should see it, or choose All my contacts');
        await save('settings', strip(D));
        if (a === 'st-test') { await api.dispatch({ action: 'test-send', target: '@status' }); toast(`Test started ✓ — goes to ${testPerson(as) ? 'you + your test person' : 'only you'}. In 1–3 min the bot messages you whether WhatsApp accepted it`, 'ok'); }
        if (a === 'sd-test') { await api.dispatch({ action: 'test-send', target: `@special:${b.dataset.v}` }); toast(`Test started ✓ — the ${SPECIAL_BY_ID[b.dataset.v]?.name || 'special day'} card goes to ${testPerson(as) ? 'you + your test person' : 'only you'}. In 1–3 min the bot messages you whether WhatsApp accepted it`, 'ok'); }
        rerender(); break;
      }
      case 'wk-test': await save('settings', strip(D)); await api.dispatch({ action: 'test-send', target: '@report' }); toast('Started ✓ — the report reaches your WhatsApp in 1–3 min', 'ok'); break;
      case 'settings-save': { const before = settings(); const after = strip(D); await save('settings', after); topStatus(); await kickIfResumed(before, after); break; }
      case 'gen-topic': { const t = 'vrbot-' + Array.from(crypto.getRandomValues(new Uint8Array(9)), (x) => x.toString(36).padStart(2, '0')).join('').slice(0, 16); D.alerts.form.ntfyTopic = t; $('#sNt').value = t; break; }
      case 'r-save': {
        if (!D.pattern.trim()) throw new Error('Add the words to match');
        if (!(Array.isArray(D.reply) ? D.reply.length : String(D.reply || '').trim()) && !D.react) throw new Error('Write a reply or pick a reaction');
        const w = D.where || 'private';
        if (w !== 'groups' && D._people === 'pick' && !(D.contacts || []).length && !(D.tags || []).length) throw new Error('Pick at least one person or list, or choose Everyone');
        if (w !== 'private' && D._groups === 'pick' && !(D.groups || []).length) throw new Error('Pick at least one group, or choose All groups');
        const item = strip(D); delete item._people; delete item._groups;
        await saveList('rules', 'rules', replaceIn(rules(), item)); D = null; location.hash = '#/replies'; break;
      }
      case 'r-del': if (confirm('Delete this rule?')) { await saveList('rules', 'rules', rules().filter((x) => x.id !== D.id)); D = null; location.hash = '#/replies'; } break;
      case 'fest-default': break;
      case 'f-save': {
        const fc = clone(festCfg()); fc.items = fc.items || {}; fc.custom = fc.custom || [];
        const item = { enabled: !!D.enabled, time: D.time || '', to: D.to || [], message: D.message || '', header: D.header || 'default' };
        if (D.builtin) { const base = mergedFestivals({}).find((x) => x.id === D.id); const dates = {}; for (const [y, d] of Object.entries(D.dates || {})) if (d && d !== base.dates[y]) dates[y] = d; fc.items[D.id] = { ...item, ...(Object.keys(dates).length ? { dates } : {}) }; }
        else { if (!D.name.trim()) throw new Error('Name the occasion'); const c = { id: D.id, name: D.name, emoji: D.emoji || '🎉', dates: Object.fromEntries(Object.entries(D.dates || {}).filter(([, d]) => d)), ...item }; fc.custom = replaceIn(fc.custom, c); }
        await save('festivals', fc); D = null; location.hash = '#/festivals'; break;
      }
      case 'f-del': if (confirm('Delete this occasion?')) { const fc = clone(festCfg()); fc.custom = (fc.custom || []).filter((x) => x.id !== D.id); await save('festivals', fc); D = null; location.hash = '#/festivals'; } break;
      case 't-save': if (!D.name.trim() || !D.text.trim()) throw new Error('Name and text are required'); await saveList('templates', 'templates', replaceIn(templates(), strip(D))); D = null; location.hash = '#/templates'; break;
      case 't-del': if (confirm('Delete this template?')) { await saveList('templates', 'templates', templates().filter((x) => x.id !== D.id)); D = null; location.hash = '#/templates'; } break;
      case 'g-save': { const g = clone(groupsCfg()); const item = strip(D); g[D._id] = item; await save('groups', { ...(S.files.groups?.data || {}), groups: g }); D = null; location.hash = '#/groups'; break; }
      case 'media': {
        const mv = $('#mediaView'); mv.innerHTML = '<p class="muted">Decrypting…</p>';
        const { bytes, mimetype } = await api.readMedia(b.dataset.path);
        const url = URL.createObjectURL(new Blob([bytes], { type: mimetype || b.dataset.mime }));
        const m = mimetype || '';
        mv.innerHTML = (m.startsWith('image/') ? `<img src="${url}" alt="Saved media">` : m.startsWith('video/') ? `<video src="${url}" controls></video>` : m.startsWith('audio/') ? `<audio src="${url}" controls></audio>` : '') + `<p><a class="btn sm" href="${url}" download="vr-bot-media">⬇ Download</a></p>`;
        break;
      }
      default: break;
    }
  });
}
document.addEventListener('click', onClick);
document.addEventListener('submit', (e) => { if (e.target.id === 'ed') e.preventDefault(); });
document.addEventListener('input', onField);
document.addEventListener('change', async (e) => {
  if (e.target.id === 'addTarget' && e.target.value && D) { D.to = D.to || []; addTargetFromSelect(e.target.value, D.to); rerender(); return; }
  if (e.target.dataset.act === 'fest-default') { await guarded(async () => { const fc = clone(festCfg()); fc.defaultTime = e.target.value || '00:00'; await save('festivals', fc); }); return; }
  if (e.target.dataset.act === 'sch-enable' || e.target.dataset.act === 'bd-noyear') return; // handled on click
  onField(e);
});

/* ---------------- boot ---------------- */
async function startDemo() {
  const { DEMO } = await import('./demo.js');
  S.demo = true; S.demoStore = clone(DEMO); S.pass = 'demo'; S.cfg = S.cfg || null;
  await loadAll();
  location.hash = '#/home';
}
async function boot() {
  if (!S.cfg?.token || !S.pass) { route(); return; }
  view().innerHTML = '<div class="boot"><img src="icons/logo.png" alt="" width="72" height="72"><p>Unlocking your data…</p></div>';
  try { await loadAll(); if (!location.hash || location.hash === '#/demo') location.hash = '#/home'; route(); }
  catch (e) { console.error(e); S.loaded = false; renderLogin(e.message); }
}
$('#year').textContent = new Date().getFullYear();
window.addEventListener('hashchange', route);
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
boot();
