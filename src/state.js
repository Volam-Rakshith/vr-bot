// VR Bot — the bot's own state: WhatsApp session, sent-log (dedupe ledger), logs, memory.
// Stored ENCRYPTED on the "vr-state" branch. While a run is alive it lives in .vr/ on the runner.
// © VR DEVELOPMENTS
import fs from 'node:fs';
import path from 'node:path';
import { AUTH_DIR, STATE_DIR, WORK, env } from './env.js';
import { encryptJSON, decryptJSON, isEnvelope } from '../panel/shared/crypto.js';
import { fetchBranch, readFile, commitFiles } from './gitstate.js';
import { log } from './log.js';

export const STATE_FILES = ['status', 'sentlog', 'logs', 'memory'];

export function emptyState() {
  return {
    status: { session: { status: 'never_paired' }, lastRun: null, runs: [], groups: [], away: null, inbox: { date: null, people: {} }, media: [], nextPlanned: [], heartbeatAt: null },
    sentlog: { entries: {} },
    logs: { entries: [] },
    memory: { cooldowns: {}, ai: {}, aiCount: {}, lastIn: {}, lastOut: {}, followed: {}, awaySent: {}, github: {}, ntfy: {}, processed: [], warns: {}, pdf: {}, broadcast: { date: null, n: 0 }, sentIds: [], lastPollAt: 0 },
  };
}

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const writeJson = (p, o) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(o)); };

/** Pull vr-state, decrypt, and unpack into .vr/ . Returns { state, hasSession }. */
export async function pullState() {
  fs.mkdirSync(WORK, { recursive: true });
  const st = emptyState();
  let hasSession = false;
  if (fetchBranch(env.stateBranch)) {
    for (const name of STATE_FILES) {
      const buf = readFile(env.stateBranch, `${name}.json`);
      if (!buf) continue;
      try { st[name] = { ...st[name], ...(await decryptJSON(JSON.parse(buf.toString()), env.passphrase)) }; }
      catch (e) { if (e.code === 'BAD_PASSPHRASE') throw e; log.warn(`state file ${name}.json unreadable, starting it fresh`); }
    }
    const sess = readFile(env.stateBranch, 'session.json');
    if (sess) {
      const envlp = JSON.parse(sess.toString());
      fs.writeFileSync(path.join(WORK, 'session.prev.json'), sess); // kept for rollback
      const { files } = await decryptJSON(envlp, env.passphrase);
      fs.rmSync(AUTH_DIR, { recursive: true, force: true });
      fs.mkdirSync(AUTH_DIR, { recursive: true });
      for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(AUTH_DIR, name), content);
      hasSession = Object.keys(files).includes('creds.json');
    }
  }
  st.memory.sentIds = st.memory.sentIds || [];
  for (const name of STATE_FILES) writeJson(path.join(STATE_DIR, `${name}.json`), st[name]);
  return { state: st, hasSession };
}

/** Write current in-memory state to .vr/state (cheap, done often). */
export function persistLocal(state) {
  prune(state);
  for (const name of STATE_FILES) writeJson(path.join(STATE_DIR, `${name}.json`), state[name]);
}

export function loadLocal() {
  const st = emptyState();
  for (const name of STATE_FILES) {
    const p = path.join(STATE_DIR, `${name}.json`);
    if (fs.existsSync(p)) st[name] = readJson(p);
  }
  return st;
}

function packAuth() {
  if (!fs.existsSync(path.join(AUTH_DIR, 'creds.json'))) return null;
  const files = {};
  for (const f of fs.readdirSync(AUTH_DIR)) files[f] = fs.readFileSync(path.join(AUTH_DIR, f), 'utf8');
  return { files, savedAt: new Date().toISOString() };
}

/** Encrypt .vr/state + .vr/auth and push them to the vr-state branch (one commit). */
export async function pushState(reason = 'save') {
  if (!env.passphrase) throw new Error('VR_PASSPHRASE secret is missing');
  const st = loadLocal();
  prune(st);
  const files = {};
  for (const name of STATE_FILES) files[`${name}.json`] = JSON.stringify(await encryptJSON(st[name], env.passphrase));
  const auth = packAuth();
  if (auth) files['session.json'] = JSON.stringify(await encryptJSON(auth, env.passphrase, { compress: true }));
  const prev = path.join(WORK, 'session.prev.json');
  if (fs.existsSync(prev)) files['session.prev.json'] = fs.readFileSync(prev);
  files['README.md'] = '# VR Bot state (encrypted)\n\nThis branch is written by the bot. Everything here is AES-256-GCM encrypted with your VR_PASSPHRASE.\nDo not edit by hand. To start over, delete this branch and run "Pair WhatsApp" again.\n\n© VR DEVELOPMENTS\n';
  if (env.noPush) { log.info(`(local) state ready, push skipped (${reason})`); return; }
  commitFiles(env.stateBranch, files, `VR Bot state · ${reason} · ${new Date().toISOString()}`, { mode: 'replace' });
  log.ok(`State saved to branch ${env.stateBranch} (${reason})`);
}

export function prune(st) {
  const cutoff = Date.now() - 45 * 86400000;
  const e = st.sentlog.entries || {};
  for (const [k, v] of Object.entries(e)) if ((v.t || 0) < cutoff) delete e[k];
  st.logs.entries = (st.logs.entries || []).slice(-500);
  st.status.runs = (st.status.runs || []).slice(-60);
  st.status.media = (st.status.media || []).slice(-300);
  const m = st.memory;
  m.processed = (m.processed || []).slice(-3000);
  m.sentIds = (m.sentIds || []).slice(-500);
  for (const [k, v] of Object.entries(m.cooldowns || {})) if (v < Date.now() - 7 * 86400000) delete m.cooldowns[k];
  for (const [k, v] of Object.entries(m.ai || {})) m.ai[k] = (v || []).slice(-20);
}

export { isEnvelope };
