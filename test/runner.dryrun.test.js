// End-to-end dry run: real planner + ledger + encrypted state on a local git "origin",
// with a FAKE WhatsApp connection (no network). Proves: due message sent once, auto-reply works,
// state is encrypted and pushed, and a second run does NOT send anything twice.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decryptJSON } from '../panel/shared/crypto.js';
import { localDate, localTime } from '../panel/shared/time.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sh = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: 'utf8', ...opts });

test('dry run: send once, auto-reply, encrypted state, no duplicates', { timeout: 120000 }, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vrbot-'));
  const origin = path.join(tmp, 'origin.git'), work = path.join(tmp, 'work');
  sh('git', ['init', '-q', '--bare', origin]);
  fs.mkdirSync(work);
  for (const d of ['src', 'panel']) fs.cpSync(path.join(REPO, d), path.join(work, d), { recursive: true });
  fs.copyFileSync(path.join(REPO, 'package.json'), path.join(work, 'package.json'));
  fs.symlinkSync(path.join(REPO, 'node_modules'), path.join(work, 'node_modules'));
  const now = Date.now();
  const tz = 'Asia/Kolkata';
  const overdue = now - 5 * 60000; // 5 minutes ago → inside the late-grace window → sends immediately
  const data = {
    settings: { timezone: tz, features: { summary: false, alerts: false, birthdays: false, festivals: false }, timing: { minOnlineSeconds: 1, lookaheadMinutes: 1 } },
    contacts: { contacts: [{ id: 'c1', name: 'Ravi Kumar', number: '+91 90000 00003', tags: ['clients'] }] },
    schedules: { schedules: [{ id: 's1', name: 'Test schedule', to: [{ type: 'contact', id: 'c1' }], message: 'Hello {first_name}!', time: localTime(overdue, tz), repeat: { type: 'once', date: localDate(overdue, tz) } }] },
    templates: { templates: [] }, festivals: {}, groups: { groups: {} },
    rules: { rules: [{ id: 'r1', match: 'contains', pattern: 'price', reply: 'Quote coming soon, {first_name}!', where: 'private', cooldownMinutes: 60 }] },
  };
  fs.mkdirSync(path.join(work, 'data'));
  for (const [k, v] of Object.entries(data)) fs.writeFileSync(path.join(work, 'data', `${k}.json`), JSON.stringify(v));
  sh('git', ['init', '-q', '-b', 'main'], { cwd: work });
  sh('git', ['remote', 'add', 'origin', origin], { cwd: work });
  const inbox = [{ key: { remoteJid: '919000000003@s.whatsapp.net', id: 'IN1', fromMe: false }, messageTimestamp: Math.floor(now / 1000) - 60, pushName: 'Ravi', message: { conversation: 'bro what is the price?' } }];
  fs.writeFileSync(path.join(tmp, 'inbox.json'), JSON.stringify(inbox));
  const env = { ...process.env, VR_FAKE_WA: '1', VR_PASSPHRASE: 'test-pass-123', OWNER_NUMBER: '917989405979', VR_FAKE_INBOX: path.join(tmp, 'inbox.json'), GITHUB_ACTIONS: '' };

  const run1 = sh(process.execPath, ['src/index.js', 'run'], { cwd: work, env });
  assert.equal(run1.status, 0, run1.stdout + run1.stderr);
  const sends1 = (run1.stdout.match(/\(dry-run\) would send/g) || []).length;
  assert.equal(sends1, 2, run1.stdout); // the scheduled message + the auto-reply
  assert.ok(!run1.stdout.includes('Ravi') && !run1.stdout.includes('price'), 'public log must not contain names or message text');
  const save1 = sh(process.execPath, ['src/index.js', 'save'], { cwd: work, env });
  assert.equal(save1.status, 0, save1.stdout + save1.stderr);

  const files = sh('git', ['--git-dir', origin, 'ls-tree', '--name-only', 'vr-state']).stdout.split('\n').filter(Boolean).sort();
  assert.deepEqual(files, ['README.md', 'logs.json', 'memory.json', 'sentlog.json', 'status.json']);
  const sentlogRaw = sh('git', ['--git-dir', origin, 'show', 'vr-state:sentlog.json']).stdout;
  assert.ok(!sentlogRaw.includes('Ravi'), 'state must be encrypted');
  const sentlog = await decryptJSON(JSON.parse(sentlogRaw), 'test-pass-123');
  const entries = Object.entries(sentlog.entries);
  assert.equal(entries.length, 1);
  assert.match(entries[0][0], /^personal:s1:/);
  assert.equal(entries[0][1].s, 'sent');

  // Second run on a fresh checkout (like the next GitHub run): nothing may be sent twice.
  fs.rmSync(path.join(work, '.vr'), { recursive: true, force: true });
  const run2 = sh(process.execPath, ['src/index.js', 'run'], { cwd: work, env });
  assert.equal(run2.status, 0, run2.stdout + run2.stderr);
  assert.equal((run2.stdout.match(/\(dry-run\) would send/g) || []).length, 0, run2.stdout);

  // Wrong passphrase is refused clearly.
  fs.rmSync(path.join(work, '.vr'), { recursive: true, force: true });
  const run3 = sh(process.execPath, ['src/index.js', 'run'], { cwd: work, env: { ...env, VR_PASSPHRASE: 'nope' } });
  assert.notEqual(run3.status, 0);
  assert.match(run3.stdout + run3.stderr, /Wrong password|does not match/);
  fs.rmSync(tmp, { recursive: true, force: true });
});
