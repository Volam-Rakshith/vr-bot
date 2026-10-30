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
import { postStatus, weeklyReportText } from './features/autostatus.js';
import { statusAudience } from '../panel/shared/status.js';
import { buildJobs, expandTargets, recipientId } from '../panel/shared/planner.js';
import { renderTemplate, firstName, headerOn } from '../panel/shared/templates.js';
import { localDate, prettyDate, pretty12, localTime, WEEKDAYS, WEEKDAYS_FULL, weekdayOf } from '../panel/shared/time.js';
import { maskNumber } from '../panel/shared/defaults.js';
import { ghClient, shouldYield, handoffDue, writeChainInfo } from './chain.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MAX_TRIES = 3;

export async function run({ inbox = [] } = {}) {
  const t0 = Date.now();
  // "Always on": tell the last workflow step when this run started; it decides about the next run.
  if (env.inActions) { try { writeChainInfo({ startedAt: t0, want: null }); } catch {} }
  const chainEnd = (want, reason) => { if (env.inActions) { try { writeChainInfo({ want, reason, endedAt: Date.now() }); } catch {} } };
  if (!env.passphrase) { log.warn('VR_PASSPHRASE secret is not set yet — nothing to do. Add it in Settings → Secrets and variables → Actions (SETUP step 4).'); return 0; }
  log.group('Loading');
  let data = await loadData();
  const { state, hasSession } = await pullState();
  const S0 = data.settings;
  const T = S0.timing;
  const via = process.env.VR_VIA || '';
  const rec = { startedAt: t0, trigger: via === 'chain' ? 'always-on' : via === 'watchdog' ? 'watchdog' : env.eventName === 'workflow_dispatch' ? `manual:${env.action}` : env.eventName, sent: 0, failed: 0, received: 0, late: 0, notes: [] };
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
    chainEnd(false, 'WhatsApp is not linked yet');
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
      chainEnd(false, 'WhatsApp logged the bot out — pair again');
      return finish(first ? 1 : 0); // fail loudly once (GitHub emails you), then stay quiet until re-paired
    }
    state.status.session = { ...(state.status.session || {}), status: 'error', error: e.message, at: Date.now() };
    log.error(`Could not connect: ${e.message}`);
    // Try a fresh run a couple of times (WhatsApp hiccup), then leave it to the watchdog.
    state.status.connFails = (state.status.connFails || 0) + 1;
    chainEnd(state.status.connFails <= 2, state.status.connFails <= 2 ? 'retry connecting' : 'could not connect 3 times in a row');
    return finish(1);
  }
  state.status.session = { status: 'ok', me: maskNumber(wa.me()), lastOk: Date.now(), pairedAt: state.status.session?.pairedAt };
  state.status.connFails = 0;
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
  await incoming.busyTick();
  log.info(`Handled ${rec.received} new message(s)`);
  log.endGroup();

  // ---- alerts to you ---- (checked at the start, and every 10 min while an always-on run stays connected)
  const S = data.settings;
  const checkAlerts = async (first) => {
    const Sx = getData().settings;
    if (!Sx.features.alerts) return;
    const alerts = first ? [...dispatchAlert()] : [];
    if (Sx.alerts.github?.enabled) { try { alerts.push(...await githubWatch(Sx.alerts.github, state.memory.github, Date.now())); } catch (e) { log.warn(`GitHub watcher: ${e.message}`); } }
    if (Sx.alerts.form?.enabled && Sx.alerts.form.ntfyTopic) { try { alerts.push(...await ntfyPoll(Sx.alerts.form.ntfyTopic, state.memory.ntfy)); } catch (e) { log.warn(`Website form check: ${e.message}`); } }
    for (const a of alerts) { try { await toOwner(a); rec.sent++; } catch (e) { log.warn(`alert failed: ${e.message}`); } }
    if (alerts.length) log.info(`Sent ${alerts.length} alert(s) to you`);
  };
  await checkAlerts(true);
  let lastAlerts = Date.now();

  // ---- panel buttons: "Post test status now" / "Send me this week's report now" ----
  if (env.action === 'test-send' && (env.target === '@status' || env.target === '@report' || env.target.startsWith('@special:'))) {
    try {
      if (env.target === '@status' || env.target.startsWith('@special:')) {
        const owner = env.ownerNumber || wa.me();
        const specialId = env.target.startsWith('@special:') ? env.target.slice(9) : '';
        const r = await postStatus({ send, data, state, ownerNumber: owner, botNumber: wa.me(), test: true, specialId });
        rec.sent++;
        log.ok(`Test status posted (${r.label}) — only you can see it. Open WhatsApp → Updates → My status`);
        const real = statusAudience(data.settings.autoStatus, { contacts: data.contacts, recent: state.memory.lastIn, owner: [owner, wa.me()] });
        const others = real.numbers.length - real.self;
        await toOwner(`🧪 Test status posted (${r.label}). Only you can see it: WhatsApp → Updates → My status (delete it there if you like).\nThe real one will go to ${others} ${others === 1 ? 'person' : 'people'} + you${real.capped ? ` (capped at ${real.numbers.length}; ${real.total - real.self} picked)` : ''}.`).catch(() => {});
      } else {
        await toOwner(weeklyReportText(data, state));
        rec.sent++;
        log.ok('Weekly report sent to you');
      }
    } catch (e) { rec.failed++; log.warn(`Test failed: ${e.message}`); await toOwner(`❌ Test failed: ${e.message}`).catch(() => {}); }
  }

  // ---- manual test / send-now from the panel ----
  if ((env.action === 'test-send' || env.action === 'send-now') && !env.target.startsWith('@')) {
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
      let extra = '';
      if (job.to.type === 'status') {
        // Auto status: posted to your WhatsApp status, seen by the people picked in the panel
        const r = await postStatus({ send, data: d, state, ownerNumber: env.ownerNumber || wa.me(), botNumber: wa.me(), date: job.date, onlySpecial: job.dynamic === 'status-special' });
        if (r.skipped) {
          ledger[job.key] = { t: Date.now(), s: 'skipped', k: job.kind, label: job.label, to: 'My status', err: r.skipped };
          log.info(`Auto status skipped: ${r.skipped}`);
          return;
        }
        extra = ` (${r.label}, ${r.count} people${r.capped ? ', capped' : ''})`;
      } else {
        let jid;
        if (job.to.type === 'group') jid = job.to.jid;
        else {
          const ex = await wa.exists(job.to.number);
          if (!ex.exists) throw Object.assign(new Error('number is not on WhatsApp'), { permanent: true });
          jid = ex.jid || numberJid(job.to.number);
        }
        let text = job.dynamic === 'summary' ? summaryText(d, state, Date.now()) : job.dynamic === 'weekly' ? weeklyReportText(d, state, Date.now()) : job.text;
        if (!text) throw Object.assign(new Error('message is empty'), { permanent: true });
        if (job.header) text = `${Sx.header.text}\n${text}`;
        await send(jid, { text }, { kind: job.kind });
      }
      const late = Date.now() - job.at;
      ledger[job.key] = { t: Date.now(), s: 'sent', k: job.kind, label: job.label + extra, to: job.to.type === 'group' ? job.to.name : (job.to.name || who(job.to)), at: job.at, lateSec: Math.round(late / 1000) };
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

  // "Always on": stay connected until it is time to hand over to the next run (see src/chain.js).
  const alwaysOn = () => { const Sx = getData().settings; return env.inActions && !!env.githubToken && Sx.timing.relay !== false && !Sx.paused && !state.status.pausedByOwner; };
  const gh = env.inActions && env.githubToken ? ghClient({ repo: env.repo, token: env.githubToken }) : null;
  let lastYieldCheck = Date.now(), downSince = 0, endWant = null, endReason = '';
  if (alwaysOn()) log.info('Always on: this run stays connected and hands over to the next run before it ends');

  let jobs = plan();
  log.info(`${jobs.length} message(s) due in this window`);
  while (true) {
    const now = Date.now();
    if (now > deadline) { log.info('Reached max run time — handing over to the next run'); endWant = true; endReason = 'hand-over'; break; }
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
    await incoming.busyTick();
    if (now - lastCheckpoint > 10 * 60000) { state.logs.entries.push(...log.drain()); persistLocal(state); await pushState('checkpoint').catch((e) => log.warn(`checkpoint: ${e.message}`)); lastCheckpoint = Date.now(); }
    const next = plan().find((j) => j.at > Date.now() + 1000);
    const onlineLongEnough = Date.now() - t0 >= T.minOnlineSeconds * 1000;
    if (alwaysOn()) {
      // WhatsApp connection lost for 3+ minutes → end; a fresh run reconnects cleanly.
      if (wa.loggedOut) { endWant = false; endReason = 'WhatsApp logged the bot out — pair again'; break; }
      if (!wa.open) { downSince = downSince || Date.now(); if (Date.now() - downSince > 3 * 60000) { log.warn('WhatsApp connection lost — handing over to a fresh run'); endWant = true; endReason = 'reconnect'; break; } } else downSince = 0;
      if (handoffDue({ now: Date.now(), t0, maxRunMs: T.maxRunMinutes * 60000, nextJobAt: next?.at })) { log.info('Handing over to the next run'); endWant = true; endReason = 'hand-over'; break; }
      if (Date.now() - lastAlerts > 10 * 60000) { lastAlerts = Date.now(); await checkAlerts(false); }
      // Someone pressed Run now / Test / Pair (or an alert arrived): let that run take over.
      if (gh && Date.now() - lastYieldCheck > 60000) {
        lastYieldCheck = Date.now();
        try {
          if (shouldYield({ runs: await gh.liveRuns(), selfId: process.env.GITHUB_RUN_ID, now: Date.now(), nextJobAt: next?.at })) { log.info('Another run is waiting (Run now / Test / Pair) — letting it take over'); endWant = true; endReason = 'yield'; break; }
        } catch (e) { /* API hiccup: just keep running */ }
      }
    } else if (!next && onlineLongEnough && !due.length) { endWant = false; endReason = getData().settings.paused || state.status.pausedByOwner ? 'paused' : 'always-on is switched off'; break; }
    const wait = next ? Math.min(next.at - Date.now(), 20000) : (alwaysOn() ? 5000 : 3000);
    if (next && wait > 60000) log.info(`Waiting ${Math.round((next.at - Date.now()) / 60000)} min for the next send`);
    await sleep(Math.max(200, wait));
  }
  log.endGroup();

  // ---- always on: the workflow's last step reads this and starts the next run ----
  {
    const on = alwaysOn();
    const want = endReason === 'yield' || (endWant !== false && on);
    const why = want ? (endReason || 'hand-over') : endWant === false ? endReason : (getData().settings.paused || state.status.pausedByOwner ? 'paused' : 'always-on is switched off');
    chainEnd(want, why);
  }

  // ---- heartbeat so GitHub doesn't disable the schedule after 60 days without commits ----
  if (env.inActions && env.githubToken && Date.now() - (state.status.heartbeatAt || 0) > 20 * 86400000) {
    try {
      const url = `${process.env.VR_GH_API || 'https://api.github.com'}/repos/${env.repo}/contents/data/.heartbeat`;
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
