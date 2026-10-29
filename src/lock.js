// VR Bot — encrypt plaintext data files locally (optional; the panel does this automatically).
// © VR DEVELOPMENTS
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, env } from './env.js';
import { encryptJSON, isEnvelope, makeLock } from '../panel/shared/crypto.js';
import { DATA_FILES } from './data.js';

export async function lockAll() {
  if (!env.passphrase) throw new Error('Set VR_PASSPHRASE first');
  for (const n of DATA_FILES) {
    const p = path.join(DATA_DIR, `${n}.json`);
    if (!fs.existsSync(p)) continue;
    const obj = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (isEnvelope(obj)) continue;
    fs.writeFileSync(p, JSON.stringify(await encryptJSON(obj, env.passphrase), null, 1));
    console.log(`encrypted data/${n}.json`);
  }
  fs.writeFileSync(path.join(DATA_DIR, 'lock.json'), JSON.stringify(await makeLock(env.passphrase), null, 1));
  console.log('wrote data/lock.json');
}
