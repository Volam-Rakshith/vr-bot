#!/usr/bin/env node
// VR Bot by VR DEVELOPMENTS — "Turning Ideas Into Innovation"
// Usage:  node src/index.js run | pair | save | plan [days] | lock
import fs from 'node:fs';
import { env } from './env.js';
import { log } from './log.js';

const cmd = process.argv[2] || 'run';
const fail = (e) => { log.error(e?.message || String(e)); process.exitCode = 1; };

try {
  if (env.botNumber) log.mask(env.botNumber);
  if (env.ownerNumber) log.mask(env.ownerNumber);
  if (cmd === 'run') {
    const { run } = await import('./runner.js');
    const inbox = process.env.VR_FAKE_INBOX ? JSON.parse(fs.readFileSync(process.env.VR_FAKE_INBOX, 'utf8')) : [];
    process.exitCode = await run({ inbox });
    if (!env.inActions && process.argv.includes('--save')) { const { pushState } = await import('./state.js'); await pushState('local'); }
  } else if (cmd === 'pair') {
    const { pair } = await import('./pair.js');
    process.exitCode = await pair();
  } else if (cmd === 'save') {
    // Runs in a separate workflow step with if: always(), so the session is saved even if the run step crashed or timed out.
    const { pushState } = await import('./state.js');
    if (!env.passphrase) log.info('No VR_PASSPHRASE yet — nothing to save.');
    else if (fs.existsSync('.vr/state/status.json')) await pushState('end of run');
    else log.info('Nothing to save (run did not start).');
  } else if (cmd === 'plan') {
    // Preview upcoming sends without WhatsApp:  node src/index.js plan 7
    const { loadData } = await import('./data.js');
    const { buildJobs } = await import('../panel/shared/planner.js');
    const { localDate, localTime } = await import('../panel/shared/time.js');
    const d = await loadData();
    const days = Number(process.argv[3] || 7);
    const jobs = buildJobs({ ...d, ownerNumber: env.ownerNumber || '910000000000' }, Date.now(), Date.now() + days * 86400000);
    for (const j of jobs) console.log(`${localDate(j.at, d.settings.timezone)} ${localTime(j.at, d.settings.timezone)}  ${j.kind.padEnd(9)} ${j.label}${j.header ? '  [header]' : ''}`);
    console.log(`${jobs.length} send(s) in the next ${days} day(s)`);
  } else if (cmd === 'lock') {
    // Encrypt plaintext data/*.json files with VR_PASSPHRASE (the panel does this for you too).
    const { lockAll } = await import('./lock.js');
    await lockAll();
  } else {
    console.log('Usage: node src/index.js run | pair | save | plan [days] | lock');
  }
} catch (e) { fail(e); }
