// VR Bot — "Always on": keeps exactly ONE bot run alive, all day, without GitHub's timer.
// © VR DEVELOPMENTS
//
// Why: GitHub's cron ("schedule") is best-effort. On a quiet repo it can skip most of its runs
// (one night it fired 1 run in 5½ hours), and a message due at 07:00 has nobody to send it.
// How: every run stays connected for ~80 min, sends everything ON THE MINUTE, and when it ends the
// last workflow step starts the next run (workflow_dispatch — allowed with the built-in token).
// The concurrency group makes the new run wait until the old one has saved, so there is never
// more than one WhatsApp connection. GitHub keeps at most ONE waiting run per group, so runs can
// never pile up. The watchdog workflow (every 20 min, best-effort) restarts the chain if it breaks.
//
// CLI (used by the workflows):
//   node src/chain.js next      → last step of "VR Bot — Run": start the next run if needed
//   node src/chain.js watchdog  → "VR Bot — Watchdog": start a run if none is alive
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const BOT_WORKFLOW = 'bot.yml';
export const PAIR_WORKFLOW = 'pair.yml';
/** Run statuses that mean "waiting for its turn" (GitHub uses several words for this). */
export const WAITING = new Set(['queued', 'pending', 'waiting', 'requested']);
/** Statuses that mean the run is not finished yet. */
export const ALIVE = new Set([...WAITING, 'in_progress']);
export const CHAIN_FILE = path.join(process.cwd(), '.vr', 'chain.json');

const MIN = 60000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------ pure decisions (unit-tested) ------------------------------ */

/** Unfinished runs (bot or pair) other than this one. */
export function othersAlive(runs, selfId) {
  return (runs || []).filter((r) => String(r.id) !== String(selfId) && ALIVE.has(r.status));
}

/**
 * Should the live run step aside now? Yes when another bot/pair run is WAITING for the WhatsApp
 * connection (you pressed Run now / Test / Pair, or an alert came in) — it takes over the chain.
 * Never right before a send: a send due in the next 3 minutes goes out first.
 */
export function shouldYield({ runs, selfId, now, nextJobAt = null }) {
  if (nextJobAt && nextJobAt - now < 3 * MIN) return false;
  return (runs || []).some((r) => String(r.id) !== String(selfId) && WAITING.has(r.status));
}

/**
 * Is it time to hand over to the next run? Each run lives up to maxRunMs. From (max − 10 min) on
 * it hands over at the first quiet moment — but if a send is due within the next 6 minutes (and
 * before the hard stop) it stays to send it, so no send falls into the ~2-minute changeover.
 */
export function handoffDue({ now, t0, maxRunMs, nextJobAt = null, softMs = 10 * MIN, holdMs = 6 * MIN }) {
  const hardEnd = t0 + maxRunMs;
  if (now >= hardEnd) return true;
  if (now < hardEnd - softMs) return false;
  if (nextJobAt && nextJobAt - now <= holdMs && nextJobAt <= hardEnd - 30000) return false;
  return true;
}

/**
 * Last step of every run: start the next one?
 *  info  = what the run wrote to .vr/chain.json: { startedAt, want: true|false|null, reason }
 *          (want null = the run step crashed or was killed before deciding)
 *  runs  = unfinished runs from the API, or null if the API could not be read
 */
export function successorDecision({ info, runs, selfId, now, minCrashAgeMs = 10 * MIN }) {
  if (!info) return { dispatch: false, reason: 'the run did not start (nothing to continue)' };
  if (info.want === false) return { dispatch: false, reason: info.reason || 'always-on is off for now' };
  if (info.want == null) {
    // Crashed/killed. Continue only if it had been running a while, so a broken setup can't
    // start a run every minute. The watchdog retries later in that case.
    if (!info.startedAt || now - info.startedAt < minCrashAgeMs) return { dispatch: false, reason: 'the run stopped early with an error — the watchdog will retry' };
  }
  if (runs) {
    const o = othersAlive(runs, selfId);
    if (o.length) return { dispatch: false, reason: `another run is already lined up (${o[0].workflow || 'bot'}, ${o[0].status}) — it continues` };
  }
  return { dispatch: true, reason: info.want == null ? 'restarting after an error' : (info.reason || 'hand-over') };
}

/** Watchdog: start a run only if nothing is alive. If the API can't be read, do nothing. */
export function watchdogDecision({ runs, selfId = null }) {
  if (!runs) return { dispatch: false, reason: 'could not read the run list — trying again next time' };
  const o = othersAlive(runs, selfId);
  if (o.length) return { dispatch: false, reason: `bot is alive (${o.length} unfinished run${o.length > 1 ? 's' : ''})` };
  return { dispatch: true, reason: 'no run alive — starting one' };
}

/* ------------------------------ GitHub API ------------------------------ */

export function ghClient({ repo = process.env.GITHUB_REPOSITORY, token = process.env.GITHUB_TOKEN, fetchImpl = globalThis.fetch, api = process.env.VR_GH_API || 'https://api.github.com' } = {}) {
  const call = async (p, { method = 'GET', body } = {}) => {
    const r = await fetchImpl(`${api}/repos/${repo}${p}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'vr-bot', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(20000),
    });
    if (!r.ok) throw Object.assign(new Error(`GitHub API ${r.status} for ${p}`), { status: r.status });
    return r.status === 204 ? null : r.json().catch(() => null);
  };
  return {
    /** Recent runs of the bot + pairing workflows: [{ id, status, workflow }]. Throws on API errors. */
    async liveRuns() {
      const out = [];
      for (const [wf, name] of [[BOT_WORKFLOW, 'bot'], [PAIR_WORKFLOW, 'pair']]) {
        const j = await call(`/actions/workflows/${wf}/runs?per_page=${wf === BOT_WORKFLOW ? 15 : 5}`);
        for (const r of j?.workflow_runs || []) out.push({ id: r.id, status: r.status, workflow: name, created_at: r.created_at });
      }
      return out;
    },
    /** Start "VR Bot — Run". Retries a few times; returns true when GitHub accepted it. */
    async dispatch({ ref, via, tries = 4, wait = sleep, log = console.log }) {
      for (let i = 1; i <= tries; i++) {
        try {
          await call(`/actions/workflows/${BOT_WORKFLOW}/dispatches`, { method: 'POST', body: { ref, inputs: { action: 'run', via } } });
          return true;
        } catch (e) {
          log(`could not start the next run (try ${i}/${tries}): ${e.message}`);
          if (e.status === 422 && i === 1) {
            // Older bot.yml without the "via" input → start it without that input.
            try { await call(`/actions/workflows/${BOT_WORKFLOW}/dispatches`, { method: 'POST', body: { ref, inputs: { action: 'run' } } }); return true; } catch {}
          }
          if (i < tries) await wait(5000 * i);
        }
      }
      return false;
    },
  };
}

/* ------------------------------ chain file (written by the runner) ------------------------------ */

export function writeChainInfo(patch, file = CHAIN_FILE) {
  let cur = {};
  try { cur = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ ...cur, ...patch }));
}
export function readChainInfo(file = CHAIN_FILE) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

/* ------------------------------ CLI ------------------------------ */

export async function main(cmd, { client = ghClient(), env = process.env, now = Date.now(), log = console.log, chainFile = CHAIN_FILE } = {}) {
  const selfId = env.GITHUB_RUN_ID || null;
  const ref = env.VR_DATA_BRANCH || env.GITHUB_REF_NAME || 'main';
  if (!env.GITHUB_TOKEN || !env.GITHUB_REPOSITORY) { log('Always on: not running on GitHub Actions — nothing to do.'); return { dispatched: false }; }
  let runs = null;
  try { runs = await client.liveRuns(); } catch (e) { log(`Always on: could not read the run list (${e.message}).`); }
  const d = cmd === 'watchdog'
    ? watchdogDecision({ runs, selfId: null })
    : successorDecision({ info: readChainInfo(chainFile), runs, selfId, now });
  if (!d.dispatch) { log(`Always on: no new run needed — ${d.reason}.`); return { dispatched: false, reason: d.reason }; }
  const ok = await client.dispatch({ ref, via: cmd === 'watchdog' ? 'watchdog' : 'chain', log });
  log(ok ? `Always on: started the next run (${d.reason}).` : 'Always on: GitHub did not accept the next run — the watchdog will start one.');
  return { dispatched: ok, reason: d.reason };
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const cmd = process.argv[2];
  if (!['next', 'watchdog'].includes(cmd)) { console.log('Usage: node src/chain.js next | watchdog'); process.exit(0); }
  // Never fail the workflow because of this step: a red ❌ would email you for nothing.
  main(cmd).catch((e) => console.log(`Always on: ${e.message}`)).finally(() => { process.exitCode = 0; });
}
