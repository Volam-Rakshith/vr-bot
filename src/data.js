// VR Bot — loads your settings/contacts/schedules/... from the data/ folder (decrypting if needed).
// © VR DEVELOPMENTS
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, env } from './env.js';
import { openData, checkLock } from '../panel/shared/crypto.js';
import { withDefaults } from '../panel/shared/defaults.js';
import { fetchBranch, readFile } from './gitstate.js';

export const DATA_FILES = ['settings', 'contacts', 'schedules', 'templates', 'festivals', 'rules', 'groups'];

async function parse(buf, name) {
  if (!buf) return null;
  let obj;
  try { obj = JSON.parse(buf.toString('utf8')); } catch (e) { throw new Error(`data/${name}.json is not valid JSON: ${e.message}`); }
  return openData(obj, env.passphrase);
}

/**
 * fresh=false → read the files checked out at the start of the run.
 * fresh=true  → fetch the latest commit of your data branch (so edits you make in the panel while a
 *               run is waiting are picked up before each send — pause/edit works even mid-run).
 */
export async function loadData({ fresh = false } = {}) {
  let read = (name) => { const p = path.join(DATA_DIR, `${name}.json`); return fs.existsSync(p) ? fs.readFileSync(p) : null; };
  if (fresh && env.inActions && fetchBranch(env.dataBranch)) {
    read = (name) => readFile(env.dataBranch, `data/${name}.json`);
  }
  const lockBuf = read('lock');
  if (lockBuf) {
    const ok = await checkLock(JSON.parse(lockBuf.toString('utf8')), env.passphrase);
    if (ok === false) {
      const e = new Error('VR_PASSPHRASE secret does not match the password you set in the panel. Fix: Settings → Secrets → Actions → edit VR_PASSPHRASE to the exact same password.');
      e.code = 'BAD_PASSPHRASE';
      throw e;
    }
  }
  const raw = {};
  for (const n of DATA_FILES) raw[n] = (await parse(read(n), n)) || {};
  return {
    settings: withDefaults(raw.settings),
    contacts: raw.contacts.contacts || [],
    schedules: raw.schedules.schedules || [],
    templates: raw.templates.templates || [],
    festivals: raw.festivals || {},
    rules: raw.rules.rules || [],
    groupsCfg: raw.groups.groups || {},
  };
}
