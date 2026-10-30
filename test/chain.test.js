// "Always on" chain: the decisions that keep exactly one bot run alive (GitHub API mocked).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  shouldYield, handoffDue, successorDecision, watchdogDecision, othersAlive, ghClient, main, writeChainInfo, readChainInfo,
} from '../src/chain.js';

const MIN = 60000;
const T0 = Date.UTC(2026, 9, 30, 0, 0, 0);
const self = { id: 100, status: 'in_progress', workflow: 'bot' };

test('othersAlive ignores this run and finished runs', () => {
  const runs = [self, { id: 99, status: 'completed' }, { id: 101, status: 'pending' }, { id: 7, status: 'in_progress', workflow: 'pair' }];
  assert.deepEqual(othersAlive(runs, 100).map((r) => r.id), [101, 7]);
  assert.deepEqual(othersAlive(runs, '100').map((r) => r.id), [101, 7], 'run id from env is a string');
});

test('shouldYield: step aside for a waiting run, but never right before a send', () => {
  const waiting = [self, { id: 101, status: 'pending' }];
  assert.equal(shouldYield({ runs: [self], selfId: 100, now: T0 }), false, 'alone → keep running');
  assert.equal(shouldYield({ runs: [self, { id: 99, status: 'completed' }], selfId: 100, now: T0 }), false);
  for (const st of ['queued', 'pending', 'waiting', 'requested']) assert.equal(shouldYield({ runs: [self, { id: 101, status: st }], selfId: 100, now: T0 }), true, st);
  assert.equal(shouldYield({ runs: waiting, selfId: 100, now: T0, nextJobAt: T0 + 2 * MIN }), false, 'send due in 2 min goes out first');
  assert.equal(shouldYield({ runs: waiting, selfId: 100, now: T0, nextJobAt: T0 + 10 * MIN }), true);
  assert.equal(shouldYield({ runs: [{ id: 100, status: 'queued' }], selfId: '100', now: T0 }), false, 'never yields to itself');
});

test('handoffDue: hands over in the last 10 minutes, but holds for a send due soon', () => {
  const base = { t0: T0, maxRunMs: 85 * MIN };
  assert.equal(handoffDue({ ...base, now: T0 + 30 * MIN }), false);
  assert.equal(handoffDue({ ...base, now: T0 + 74 * MIN }), false);
  assert.equal(handoffDue({ ...base, now: T0 + 75 * MIN }), true, 'quiet → hand over at minute 75');
  assert.equal(handoffDue({ ...base, now: T0 + 76 * MIN, nextJobAt: T0 + 80 * MIN }), false, 'send at 80 → stay for it');
  assert.equal(handoffDue({ ...base, now: T0 + 80.5 * MIN, nextJobAt: T0 + 90 * MIN }), true, 'next send far → hand over');
  assert.equal(handoffDue({ ...base, now: T0 + 82 * MIN, nextJobAt: T0 + 84.9 * MIN }), true, 'send after the hard stop window → next run catches it');
  assert.equal(handoffDue({ ...base, now: T0 + 85 * MIN, nextJobAt: T0 + 85.2 * MIN }), true, 'hard stop always wins');
});

test('successorDecision: dispatch only when needed, never into a crash loop', () => {
  const now = T0 + 80 * MIN;
  const ok = { startedAt: T0, want: true, reason: 'hand-over' };
  assert.equal(successorDecision({ info: null, runs: [], selfId: 100, now }).dispatch, false, 'run never started');
  assert.equal(successorDecision({ info: ok, runs: [self], selfId: 100, now }).dispatch, true, 'normal hand-over');
  assert.equal(successorDecision({ info: ok, runs: null, selfId: 100, now }).dispatch, true, 'API down → still dispatch (a 2nd waiting run would just replace the 1st)');
  const busy = successorDecision({ info: ok, runs: [self, { id: 101, status: 'pending', workflow: 'bot' }], selfId: 100, now });
  assert.equal(busy.dispatch, false, 'a run is already lined up → do not add one');
  assert.equal(successorDecision({ info: ok, runs: [self, { id: 7, status: 'queued', workflow: 'pair' }], selfId: 100, now }).dispatch, false, 'pairing waiting → would be cancelled by a new run');
  assert.equal(successorDecision({ info: { ...ok, want: false, reason: 'paused' }, runs: [self], selfId: 100, now }).dispatch, false, 'paused → chain stops');
  assert.equal(successorDecision({ info: { startedAt: T0, want: null }, runs: [self], selfId: 100, now: T0 + 2 * MIN }).dispatch, false, 'crashed early → no loop');
  assert.equal(successorDecision({ info: { startedAt: T0, want: null }, runs: [self], selfId: 100, now: T0 + 40 * MIN }).dispatch, true, 'crashed/killed after a long run → restart');
  assert.equal(successorDecision({ info: { startedAt: T0, want: true, reason: 'yield' }, runs: [self, { id: 101, status: 'pending' }], selfId: 100, now }).dispatch, false, 'yielded → the waiting run continues');
  assert.equal(successorDecision({ info: { startedAt: T0, want: true, reason: 'yield' }, runs: [self, { id: 101, status: 'completed', conclusion: 'cancelled' }], selfId: 100, now }).dispatch, true, 'yielded but that run vanished → restart anyway');
});

test('watchdogDecision: start a run only when nothing is alive', () => {
  assert.equal(watchdogDecision({ runs: [] }).dispatch, true);
  assert.equal(watchdogDecision({ runs: [{ id: 1, status: 'completed' }] }).dispatch, true);
  assert.equal(watchdogDecision({ runs: [{ id: 1, status: 'in_progress' }] }).dispatch, false);
  assert.equal(watchdogDecision({ runs: [{ id: 1, status: 'pending' }] }).dispatch, false);
  assert.equal(watchdogDecision({ runs: null }).dispatch, false, 'API unreadable → do nothing');
});

/** Fake GitHub API: records requests, serves run lists. */
function fakeFetch({ bot = [], pair = [], dispatchStatus = [204] } = {}) {
  const calls = [];
  const fetchImpl = async (url, opts = {}) => {
    calls.push({ url, method: opts.method || 'GET', body: opts.body ? JSON.parse(opts.body) : null, auth: opts.headers?.Authorization });
    const res = (status, body) => ({ ok: status < 300, status, json: async () => body });
    if (url.includes('/workflows/bot.yml/runs')) return res(200, { workflow_runs: bot });
    if (url.includes('/workflows/pair.yml/runs')) return res(200, { workflow_runs: pair });
    if (url.endsWith('/dispatches')) return res(dispatchStatus.length > 1 ? dispatchStatus.shift() : dispatchStatus[0], null);
    return res(404, {});
  };
  return { calls, fetchImpl };
}

test('ghClient: lists bot + pair runs and dispatches with the token', async () => {
  const f = fakeFetch({ bot: [{ id: 5, status: 'in_progress' }], pair: [{ id: 6, status: 'completed' }] });
  const c = ghClient({ repo: 'me/vr-bot', token: 'TKN', fetchImpl: f.fetchImpl });
  const runs = await c.liveRuns();
  assert.deepEqual(runs.map((r) => [r.id, r.workflow]), [[5, 'bot'], [6, 'pair']]);
  assert.ok(await c.dispatch({ ref: 'main', via: 'chain', wait: async () => {} }));
  const d = f.calls.find((x) => x.method === 'POST');
  assert.match(d.url, /\/repos\/me\/vr-bot\/actions\/workflows\/bot\.yml\/dispatches$/);
  assert.deepEqual(d.body, { ref: 'main', inputs: { action: 'run', via: 'chain' } });
  assert.equal(d.auth, 'Bearer TKN');
});

test('ghClient.dispatch retries, and falls back for an old bot.yml without "via"', async () => {
  const f = fakeFetch({ dispatchStatus: [500, 500, 204] });
  const c = ghClient({ repo: 'me/vr-bot', token: 'T', fetchImpl: f.fetchImpl });
  assert.equal(await c.dispatch({ ref: 'main', via: 'chain', wait: async () => {}, log: () => {} }), true);
  assert.equal(f.calls.filter((x) => x.method === 'POST').length, 3);
  const g = fakeFetch({ dispatchStatus: [422, 204] });
  const c2 = ghClient({ repo: 'me/vr-bot', token: 'T', fetchImpl: g.fetchImpl });
  assert.equal(await c2.dispatch({ ref: 'main', via: 'chain', wait: async () => {}, log: () => {} }), true);
  assert.deepEqual(g.calls.filter((x) => x.method === 'POST').map((x) => x.body.inputs), [{ action: 'run', via: 'chain' }, { action: 'run' }]);
  const h = fakeFetch({ dispatchStatus: [500] });
  assert.equal(await ghClient({ repo: 'a/b', token: 'T', fetchImpl: h.fetchImpl }).dispatch({ ref: 'main', via: 'chain', tries: 3, wait: async () => {}, log: () => {} }), false);
});

test('main("next") and main("watchdog") end to end with a mocked API', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vrchain-'));
  const chainFile = path.join(dir, 'chain.json');
  const env = { GITHUB_TOKEN: 'T', GITHUB_REPOSITORY: 'me/vr-bot', GITHUB_RUN_ID: '100', GITHUB_REF_NAME: 'main' };
  const quiet = () => {};
  writeChainInfo({ startedAt: T0, want: null }, chainFile);
  writeChainInfo({ want: true, reason: 'hand-over' }, chainFile);
  assert.deepEqual(readChainInfo(chainFile), { startedAt: T0, want: true, reason: 'hand-over' });

  let f = fakeFetch({ bot: [{ id: 100, status: 'in_progress' }, { id: 90, status: 'completed' }] });
  let r = await main('next', { client: ghClient({ repo: 'me/vr-bot', token: 'T', fetchImpl: f.fetchImpl }), env, now: T0 + 80 * MIN, log: quiet, chainFile });
  assert.equal(r.dispatched, true);
  assert.equal(f.calls.find((x) => x.method === 'POST').body.inputs.via, 'chain');

  f = fakeFetch({ bot: [{ id: 101, status: 'pending' }, { id: 100, status: 'in_progress' }] });
  r = await main('next', { client: ghClient({ repo: 'me/vr-bot', token: 'T', fetchImpl: f.fetchImpl }), env, now: T0 + 80 * MIN, log: quiet, chainFile });
  assert.equal(r.dispatched, false, 'successor already waiting → no second one');
  assert.equal(f.calls.filter((x) => x.method === 'POST').length, 0);

  writeChainInfo({ want: false, reason: 'paused' }, chainFile);
  f = fakeFetch({ bot: [{ id: 100, status: 'in_progress' }] });
  r = await main('next', { client: ghClient({ repo: 'me/vr-bot', token: 'T', fetchImpl: f.fetchImpl }), env, now: T0 + 5 * MIN, log: quiet, chainFile });
  assert.equal(r.dispatched, false, 'paused → stop');

  f = fakeFetch({ bot: [{ id: 100, status: 'completed' }] });
  r = await main('watchdog', { client: ghClient({ repo: 'me/vr-bot', token: 'T', fetchImpl: f.fetchImpl }), env: { ...env, GITHUB_RUN_ID: '555' }, log: quiet, chainFile });
  assert.equal(r.dispatched, true, 'chain broken → watchdog restarts it');
  assert.equal(f.calls.find((x) => x.method === 'POST').body.inputs.via, 'watchdog');

  f = fakeFetch({ bot: [{ id: 100, status: 'in_progress' }] });
  r = await main('watchdog', { client: ghClient({ repo: 'me/vr-bot', token: 'T', fetchImpl: f.fetchImpl }), env, log: quiet, chainFile });
  assert.equal(r.dispatched, false, 'bot alive → watchdog does nothing');

  r = await main('next', { client: ghClient({ repo: 'x/y', token: 'T', fetchImpl: f.fetchImpl }), env: {}, log: quiet, chainFile });
  assert.equal(r.dispatched, false, 'outside GitHub Actions → nothing');
});

/* ---- the real runner in "GitHub Actions" mode against a fake API server ---- */
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sh = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: 'utf8', ...opts });
const runAsync = (args, opts) => new Promise((resolve) => {
  const p = spawn(process.execPath, args, opts); let out = '';
  p.stdout.on('data', (d) => { out += d; }); p.stderr.on('data', (d) => { out += d; });
  p.on('close', (status) => resolve({ status, out }));
});

test('runner (Actions mode): stays connected until hand-over, then the last step starts the next run; paused stops the chain', { timeout: 120000 }, async () => {
  const api = { bot: [{ id: 100, status: 'in_progress' }], posts: [] };
  const server = http.createServer((req, res) => {
    let body = ''; req.on('data', (d) => { body += d; });
    req.on('end', () => {
      if (req.method === 'POST' && req.url.endsWith('/dispatches')) { api.posts.push(JSON.parse(body)); res.writeHead(204); return res.end(); }
      if (req.url.includes('/workflows/bot.yml/runs')) { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ workflow_runs: api.bot })); }
      if (req.url.includes('/workflows/pair.yml/runs')) { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ workflow_runs: [] })); }
      res.writeHead(404); res.end('{}');
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vrbot-chain-'));
    const origin = path.join(tmp, 'origin.git'), work = path.join(tmp, 'work');
    sh('git', ['init', '-q', '--bare', origin]);
    fs.mkdirSync(work);
    for (const d of ['src', 'panel']) fs.cpSync(path.join(REPO, d), path.join(work, d), { recursive: true });
    fs.copyFileSync(path.join(REPO, 'package.json'), path.join(work, 'package.json'));
    fs.symlinkSync(path.join(REPO, 'node_modules'), path.join(work, 'node_modules'));
    const writeData = (settings) => {
      const data = { settings, contacts: { contacts: [] }, schedules: { schedules: [] }, templates: { templates: [] }, festivals: {}, groups: { groups: {} }, rules: { rules: [] } };
      fs.mkdirSync(path.join(work, 'data'), { recursive: true });
      for (const [k, v] of Object.entries(data)) fs.writeFileSync(path.join(work, 'data', `${k}.json`), JSON.stringify(v));
      sh('git', ['add', '-A'], { cwd: work }); sh('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'data'], { cwd: work }); sh('git', ['push', '-q', 'origin', 'main'], { cwd: work });
    };
    sh('git', ['init', '-q', '-b', 'main'], { cwd: work });
    sh('git', ['remote', 'add', 'origin', origin], { cwd: work });
    const features = { summary: false, alerts: false, birthdays: false, festivals: false };
    // maxRunMinutes 10.1 → hand-over window opens after 6 s (it opens 10 min before the end)
    writeData({ timezone: 'Asia/Kolkata', features, timing: { minOnlineSeconds: 1, lookaheadMinutes: 1, maxRunMinutes: 10.1 } });
    const env = { ...process.env, VR_FAKE_WA: '1', VR_PASSPHRASE: 'test-pass-123', OWNER_NUMBER: '917989405979', GITHUB_ACTIONS: 'true', GITHUB_TOKEN: 'T', GITHUB_REPOSITORY: 'me/vr-bot', GITHUB_RUN_ID: '100', GITHUB_REF_NAME: 'main', GITHUB_EVENT_NAME: 'workflow_dispatch', VR_GH_API: base };

    // 1) always on: the run stays connected (not quitting after 1 s like before), then hands over
    const t = Date.now();
    const run1 = await runAsync(['src/index.js', 'run'], { cwd: work, env });
    assert.equal(run1.status, 0, run1.out);
    assert.ok(Date.now() - t >= 5000, run1.out);
    assert.match(run1.out, /Always on: this run stays connected/);
    assert.equal(readChainInfo(path.join(work, '.vr', 'chain.json')).want, true);
    const next1 = await runAsync(['src/chain.js', 'next'], { cwd: work, env }); // async: the fake API lives in this process
    assert.equal(next1.status, 0, next1.out);
    assert.equal(api.posts.length, 1, next1.out);
    assert.deepEqual(api.posts[0], { ref: 'main', inputs: { action: 'run', via: 'chain' } });

    // 2) a successor is already waiting → the last step adds nothing
    api.bot = [{ id: 101, status: 'pending' }, { id: 100, status: 'in_progress' }];
    await runAsync(['src/chain.js', 'next'], { cwd: work, env });
    assert.equal(api.posts.length, 1);

    // 3) paused → the run ends quickly and the chain stops (the watchdog keeps checking)
    api.bot = [{ id: 100, status: 'in_progress' }];
    writeData({ timezone: 'Asia/Kolkata', paused: true, features, timing: { minOnlineSeconds: 1, lookaheadMinutes: 1, maxRunMinutes: 10.1 } });
    const t3 = Date.now();
    const run3 = await runAsync(['src/index.js', 'run'], { cwd: work, env });
    assert.equal(run3.status, 0, run3.out);
    assert.ok(Date.now() - t3 < 5000, 'paused → short run like before');
    assert.deepEqual(readChainInfo(path.join(work, '.vr', 'chain.json')).want, false);
    await runAsync(['src/chain.js', 'next'], { cwd: work, env });
    assert.equal(api.posts.length, 1, 'no new run while paused');
  } finally { server.close(); }
});
