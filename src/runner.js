// VR Bot — one run: connect, read new messages, send everything that is due ON THE MINUTE, save.
// © VR DEVELOPMENTS
import { env, AUTH_DIR } from './env.js';
import { log, who } from './log.js';
import { loadData } from './data.js';
import { pullState, persistLocal, pushState } from './state.js';
import { WA, FakeWA, numberJid } from './wa.js';
import { Incoming } from './incoming.js';
import { MediaSaver } from './features/media.js';
import { githubWatch, ntfyPoll, dispatchAlert } from './features/alerts.js';
import { summaryText } from './features/summary.js';
import { buildJobs, expandTargets, recipientId } from '../panel/shared/planner.js';
import { renderTemplate, firstName, headerOn } from '../panel/shared/templates.js';
import { localDate, prettyDate, pretty12, localTime, WEEKDAYS, WEEKDAYS_FULL, weekdayOf } from '../panel/shared/time.js';
import { maskNumber } from '../panel/shared/defaults.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MAX_TRIES = 3;

export async function run({ inbox = [] } = {}) {
  const t0 = Date.now();
  if (!env.passphrase) { log.warn('VR_PASSPHRASE secret is not set yet — nothing to do. Add it in Settings → Secrets and variables → Actions (SETUP step 4).'); return 0; }
  log.group('Loading');
  let data = await loadData();
  const { state, hasSession } = await pullState();
  const S0 = data.settings;
  const T = S0.timing;
  const rec = { startedAt: t0, trigger: env.eventName === 'workflow_dispatch' ? `manual:${env.action}` : env.eventName, sent: 0, failed: 0, received: 0, late: 0, notes: [] };
  log.info(`VR Bot run started (${rec.trigger}). Timezone ${S0.timezone}, look-ahead ${T.lookaheadMinutes} min.`);
  log.endGroup();

  const finish = async (code) => {
    rec.endedAt = Date.now();
    rec.ok = code === 0;
    state.status.lastRun = rec;
    state.status.runs.push(rec);
    state.logs.entries.push(...log.drain());
    persistLocal(state);
    return code;
  };

  if (!hasSession && !env.fakeWA) {
    state.status.session = { status: 'never_paired' };
    log.warn('WhatsApp is not linked yet → open Actions → "VR Bot — Pair WhatsApp" → Run workflow.');
    return finish(0);
  }

  // ---- connect ----
  let data_ = data;
  const getData = () => data_;
  let incoming;
  const media = data.settings.features.mediaSave ? new MediaSaver(data.settings.media) : null;
  const handlers = { upsert: (m) => incoming?.push(m), participants: (u) => incoming?.participants(u).catch(() => {}) };
  const wa = env.fakeWA ? new FakeWA({ handlers, inbox }) : new WA({ authDir: AUTH_DIR, handlers });

  /** low-level send used by everything; records ids so we never react to our own messages */
  const send = async (jid, content, opts = {}) => {
    const { kind, ...rest } = opts;
    const r = await wa.send(jid, content, rest);
    if (r?.key?.id) state.memory.sentIds.push(r.key.id);
    return r;
  };
  const toOwner = async (text) => {
    const n = env.ownerNumber || wa.me();
    if (!n) return;
    const S = getData().settings;
    const head = headerOn(S.header, 'alert');
    await send(numberJid(n), { text: head ? `${S.header.text}\n${text}` : text }, { kind: 'alert' });
  };

  log.group('Connecting to WhatsApp');
  try {
    await wa.start();
  } catch (e) {
    if (e.code === 'LOGGED_OUT') {
      const first = state.status.session?.status !== 'logged_out';
      state.status.session = { status: 'logged_out', at: Date.now() };
      log.error(e.message);
      return finish(first ? 1 : 0); // fail loudly once (GitHub emails you), then stay quiet until re-paired
    }
    state.status.session = { ...(state.status.session || {}), status: 'error', error: e.message, at: Date.now() };
    log.error(`Could not connect: ${e.message}`);
    return finish(1);
  }
  state.status.session = { status: 'ok', me: maskNumber(wa.me()), lastOk: Date.now(), pairedAt: state.status.session?.pairedAt };
  log.ok(`Connected as ${maskNumber(wa.me())}`);
  log.endGroup();

  incoming = new Incoming({ wa, getData, state, send, media });

  // groups list for the panel (refreshed every 6 hours)
  if (!env.fakeWA && Date.now() - (state.status.groupsAt || 0) > 6 * 3600000) {
    try {
      const all = await wa.sock.groupFetchAllParticipating();
      const me = [wa.sock.user?.id, wa.sock.user?.lid].filter(Boolean).map((x) => x.split(':')[0].split('@')[0]);
      state.status.groups = Object.values(all).map((g) => ({ id: g.id, name: g.subject, size: g.participants?.length || 0, admin: !!g.participants?.find((p) => me.some((m) => (p.id || '').startsWith(m) || (p.lid || '').startsWith(m)))?.admin }));
      state.status.groupsAt = Date.now();
      log.info(`Found ${state.status.groups.length} group(s)`);
    } catch (e) { log.warn(`Could not list groups: ${e.message}`); }
  }

  log.group('Reading new messages');
  await wa.waitPending(30000);
  rec.received += await incoming.drain();
  log.info(`Handled ${rec.received} new message(s)`);
  log.endGroup();

  // ---- alerts to you ----
  const S = data.settings;
  if (S.features.alerts) {
    const alerts = [...dispatchAlert()];
    if (S.alerts.github?.enabled) { try { alerts.push(...await githubWatch(S.alerts.github, state.memory.github, Date.now())); } catch (e) { log.warn(`GitHub watcher: ${e.message}`); } }
    if (S.alerts.form?.enabled && S.alerts.form.ntfyTopic) { try { alerts.push(...await ntfyPoll(S.alerts.form.ntfyTopic, state.memory.ntfy)); } catch (e) { log.warn(`Website form check: ${e.message}`); } }
    for (const a of alerts) { try { await toOwner(a); rec.sent++; } catch (e) { log.warn(`alert failed: ${e.message}`); } }
    if (alerts.length) log.info(`Sent ${alerts.length} alert(s) to you`);
  }

  // ---- manual test / send-now from the panel ----
  if (env.action === 'test-send' || env.action === 'send-now') {
    const sch = data.schedules.find((x) => x.id === env.target);
    if (!sch) log.warn(`Schedule "${env.target}" not found`);
    else {
      const rcpts = expandTargets(sch.to, { contacts: data.contacts, groups: state.status.groups, ownerNumber: env.ownerNumber });
      const text0 = (sch.templateId && data.templates.find((t) => t.id === sch.templateId)?.text) || sch.message || '';
      const today = localDate(Date.now(), S.timezone);
      const varsFor = (r) => ({ name: r.name, first_name: firstName(r.name), my_name: S.myName, date: prettyDate(today), day: WEEKDAYS_FULL[weekdayOf(today)], time: pretty12(sch.time || localTime(Date.now(), S.timezone)), year: today.slice(0, 4), group: r.type === 'group' ? r.name : '' });
      if (env.action === 'test-send') {
        const r = rcpts[0] || { name: 'Test' };
        const body = renderTemplate(text0, varsFor(r), 'test');
        await toOwner(`🧪 *Test of "${sch.name}"* — ${rcpts.length} recipient(s) would get:\n\n${body}`);
        log.ok('Test message sent to you');
      } else {
        for (const r of rcpts) {
          try {
            const jid = r.type === 'group' ? r.jid : numberJid(r.number);
            const kind = r.type === 'group' ? 'group' : rcpts.length > 1 ? 'broadcast' : 'personal';
            const head = headerOn(S.header, kind, sch.header, r.contact?.header);
            const body = renderTemplate(text0, varsFor(r), `now-${r.number || r.jid}`);
            await send(jid, { text: head ? `${S.header.text}\n${body}` : body }, { kind });
            rec.sent++;
            if (rcpts.length > 1) await sleep(1000 * (S.broadcast.minGapSeconds + Math.random() * (S.broadcast.maxGapSeconds - S.broadcast.minGapSeconds)));
          } catch (e) { rec.failed++; log.warn(`send-now to ${who(r)} failed: ${e.message}`); }
        }
        log.ok(`Sent "${sch.name}" now to ${rcpts.length} recipient(s)`);
      }
    }
  }

  // ---- the exact-time loop ----
  log.group('Scheduled sends');
  const ledger = state.sentlog.entries;
  const lookahead = Math.min(Number(process.env.VR_LOOKAHEAD || T.lookaheadMinutes), T.maxRunMinutes - 5) * 60000;
  const graceMs = T.lateGraceMinutes * 60000;
  const deadline = t0 + T.maxRunMinutes * 60000;
  let lastRefresh = Date.now(), lastCheckpoint = Date.now();

  const plan = () => {
    const d = getData();
    if (state.status.pausedByOwner) return [];
    const now = Date.now();
    return buildJobs({ ...d, groups: state.status.groups, memory: state.memory, ownerNumber: env.ownerNumber || wa.me() }, now - graceMs, now + lookahead)
      .filter((j) => { const e = ledger[j.key]; return !e || (e.s === 'retry' && (e.n || 0) < MAX_TRIES); });
  };

  const sendJob = async (job) => {
    const d = getData();
    const Sx = d.settings;
    const e = ledger[job.key] || { n: 0 };
    try {
      if (job.list) {
        const today = localDate(Date.now(), Sx.timezone);
        const bc = state.memory.broadcast;
        if (bc.date !== today) { bc.date = today; bc.n = 0; }
        if (bc.n >= Sx.broadcast.dailyCap) {
          ledger[job.key] = { t: Date.now(), s: 'skipped', k: job.kind, label: job.label, to: who(job.to), err: `daily broadcast cap (${Sx.broadcast.dailyCap}) reached` };
          log.warn(`Skipped a list message: daily cap ${Sx.broadcast.dailyCap} reached`);
          return;
        }
        bc.n++;
      }
      let jid;
      if (job.to.type === 'group') jid = job.to.jid;
      else {
        const ex = await wa.exists(job.to.number);
        if (!ex.exists) throw Object.assign(new Error('number is not on WhatsApp'), { permanent: true });
        jid = ex.jid || numberJid(job.to.number);
      }
      let text = job.dynamic === 'summary' ? summaryText(d, state, Date.now()) : job.text;
      if (!text) throw Object.assign(new Error('message is empty'), { permanent: true });
      if (job.header) text = `${Sx.header.text}\n${text}`;
      await send(jid, { text }, { kind: job.kind });
      const late = Date.now() - job.at;
      ledger[job.key] = { t: Date.now(), s: 'sent', k: job.kind, label: job.label, to: job.to.type === 'group' ? job.to.name : (job.to.name || who(job.to)), at: job.at, lateSec: Math.round(late / 1000) };
      if (job.kind === 'followup') state.memory.followed[job.to.number] = Number(job.sourceId.split('-').pop());
      rec.sent++;
      if (late > 120000) rec.late++;
      log.ok(`Sent ${job.kind} → ${who(job.to)} (${late > 120000 ? `${Math.round(late / 60000)} min late` : 'on time'})`, `Sent "${job.label}" → ${job.to.name || who(job.to)} at ${new Date().toISOString()}${late > 120000 ? ` (${Math.round(late / 60000)} min late)` : ''}`);
    } catch (err) {
      e.n = (e.n || 0) + 1;
      const final = err.permanent || e.n >= MAX_TRIES;
      ledger[job.key] = { t: Date.now(), s: final ? 'failed' : 'retry', n: e.n, k: job.kind, label: job.label, to: job.to.name || who(job.to), at: job.at, err: err.message };
      log.warn(`Send failed (${job.kind} → ${who(job.to)}): ${err.message}${final ? '' : ' — will retry'}`, `Send failed: "${job.label}" → ${job.to.name || who(job.to)}: ${err.message}`);
      if (final) {
        rec.failed++;
        if (Sx.features.failureAlerts && !job.to.owner) await toOwner(`❌ *Couldn't send* "${job.label}" to ${job.to.name || 'a contact'}: ${err.message}`).catch(() => {});
      }
    }
  };

  let jobs = plan();
  log.info(`${jobs.length} message(s) due in this window`);
  while (true) {
    const now = Date.now();
    if (now > deadline) { log.warn('Reached max run time, stopping (the next run continues)'); break; }
    if (now - lastRefresh > 4 * 60000) { // pick up panel edits made while we wait
      try { data_ = await loadData({ fresh: true }); } catch (e) { log.warn(`Could not refresh data: ${e.message}`); }
      lastRefresh = now;
    }
    jobs = plan();
    const due = jobs.filter((j) => j.at <= Date.now() + 1000);
    for (const j of due) {
      if (Date.now() - lastRefresh > 60000 && j.at - Date.now() < 1000) { try { data_ = await loadData({ fresh: true }); lastRefresh = Date.now(); } catch {} if (!plan().some((x) => x.key === j.key)) continue; }
      await sendJob(j);
    }
    rec.received += await incoming.drain();
    if (now - lastCheckpoint > 10 * 60000) { state.logs.entries.push(...log.drain()); persistLocal(state); await pushState('checkpoint').catch((e) => log.warn(`checkpoint: ${e.message}`)); lastCheckpoint = Date.now(); }
    const next = plan().find((j) => j.at > Date.now() + 1000);
    const onlineLongEnough = Date.now() - t0 >= T.minOnlineSeconds * 1000;
    if (!next && onlineLongEnough && !due.length) break;
    const wait = next ? Math.min(next.at - Date.now(), 20000) : 3000;
    if (next && wait > 60000) log.info(`Waiting ${Math.round((next.at - Date.now()) / 60000)} min for the next send`);
    await sleep(Math.max(200, wait));
  }
  log.endGroup();

  // ---- relay: make sure a run is alive for the next send, even if GitHub's cron starts late ----
  if (T.relay && env.inActions && env.githubToken) {
    const now = Date.now();
    const upcoming = buildJobs({ ...getData(), groups: state.status.groups, memory: state.memory, ownerNumber: env.ownerNumber || wa.me() }, now, now + 3 * 3600000).filter((j) => !ledger[j.key]);
    const nextJob = upcoming[0];
    const relayMax = (T.maxRunMinutes - 10) * 60000;
    if (nextJob && nextJob.at - now < relayMax) {
      const mins = Math.ceil((nextJob.at - now) / 60000) + 3;
      try {
        const r = await fetch(`https://api.github.com/repos/${env.repo}/actions/workflows/bot.yml/dispatches`, {
          method: 'POST', headers: { Authorization: `Bearer ${env.githubToken}`, Accept: 'application/vnd.github+json', 'User-Agent': 'vr-bot' },
          body: JSON.stringify({ ref: env.dataBranch, inputs: { action: 'run', lookahead: String(mins) } }),
        });
        if (r.ok) log.info(`Next send in ${mins - 3} min → started a relay run to wait for it`); else log.warn(`Relay dispatch failed (${r.status})`);
      } catch (e) { log.warn(`Relay dispatch failed: ${e.message}`); }
    }
  }

  // ---- heartbeat so GitHub doesn't disable the schedule after 60 days without commits ----
  if (env.inActions && env.githubToken && Date.now() - (state.status.heartbeatAt || 0) > 20 * 86400000) {
    try {
      const url = `https://api.github.com/repos/${env.repo}/contents/data/.heartbeat`;
      const h = { Authorization: `Bearer ${env.githubToken}`, Accept: 'application/vnd.github+json', 'User-Agent': 'vr-bot' };
      const cur = await fetch(`${url}?ref=${env.dataBranch}`, { headers: h });
      const sha = cur.ok ? (await cur.json()).sha : undefined;
      const body = { message: 'VR Bot heartbeat (keeps the schedule active)', content: Buffer.from(`Last heartbeat: ${new Date().toISOString()}\n`).toString('base64'), branch: env.dataBranch, ...(sha ? { sha } : {}) };
      const r = await fetch(url, { method: 'PUT', headers: h, body: JSON.stringify(body) });
      if (r.ok) { state.status.heartbeatAt = Date.now(); log.info('Heartbeat committed'); }
    } catch (e) { log.warn(`heartbeat: ${e.message}`); }
  }

  if (media) {
    const r = media.flush();
    state.status.media.push(...r.saved);
    if (r.removed?.length) state.status.media = state.status.media.filter((m) => !r.removed.includes(m.path));
  }
  rec.received += await incoming.drain();
  await sleep(1500);
  await wa.close();
  log.ok(`Run finished: ${rec.sent} sent, ${rec.failed} failed, ${rec.received} received, ${Math.round((Date.now() - t0) / 1000)}s`);
  return finish(0);
}
