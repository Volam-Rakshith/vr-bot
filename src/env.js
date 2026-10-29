// VR Bot — environment & paths. © VR DEVELOPMENTS
import path from 'node:path';
import { normalizeNumber } from '../panel/shared/defaults.js';

export const ROOT = process.cwd();
export const WORK = path.join(ROOT, '.vr');           // runner-local scratch (never committed)
export const AUTH_DIR = path.join(WORK, 'auth');      // Baileys auth files while a run is alive
export const STATE_DIR = path.join(WORK, 'state');    // plaintext state while a run is alive (ephemeral VM)
export const DATA_DIR = path.join(ROOT, 'data');

export const env = {
  passphrase: process.env.VR_PASSPHRASE || '',
  botNumber: normalizeNumber(process.env.BOT_NUMBER || ''),
  ownerNumber: normalizeNumber(process.env.OWNER_NUMBER || process.env.BOT_NUMBER || ''),
  groqKey: process.env.GROQ_API_KEY || '',
  githubToken: process.env.GITHUB_TOKEN || '',
  repo: process.env.GITHUB_REPOSITORY || '',
  dataBranch: process.env.VR_DATA_BRANCH || process.env.GITHUB_REF_NAME || 'main',
  stateBranch: process.env.VR_STATE_BRANCH || 'vr-state',
  mediaBranch: process.env.VR_MEDIA_BRANCH || 'vr-media',
  action: process.env.VR_ACTION || 'run',
  target: process.env.VR_TARGET || '',
  eventName: process.env.GITHUB_EVENT_NAME || 'local',
  eventPath: process.env.GITHUB_EVENT_PATH || '',
  inActions: process.env.GITHUB_ACTIONS === 'true',
  fakeWA: process.env.VR_FAKE_WA === '1',     // local dry-run: no WhatsApp, sends are only logged
  noPush: process.env.VR_NO_PUSH === '1',     // local: don't push state
  pairMethod: process.env.VR_PAIR_METHOD || 'code',
  runUrl: process.env.GITHUB_SERVER_URL && process.env.GITHUB_RUN_ID
    ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : '',
};
