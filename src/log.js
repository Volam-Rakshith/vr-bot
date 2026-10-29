// VR Bot — logging. © VR DEVELOPMENTS
// Your repo is public, so Actions logs are public too. The console log NEVER prints phone numbers,
// names or message text — only masked numbers and counts. The full detail goes into the ENCRYPTED
// log that only your panel can read (Logs screen).
import { maskNumber } from '../panel/shared/defaults.js';

const entries = [];
const stamp = () => new Date().toISOString().replace('T', ' ').slice(0, 19) + 'Z';

function out(level, pub, priv) {
  const line = `[${stamp()}] ${level.toUpperCase().padEnd(5)} ${pub}`;
  if (level === 'error') console.error(line); else console.log(line);
  if (process.env.GITHUB_ACTIONS === 'true') {
    if (level === 'warn') console.log(`::warning::${pub}`);
    if (level === 'error') console.log(`::error::${pub}`);
  }
  entries.push({ t: Date.now(), level, msg: priv || pub });
}

export const log = {
  info: (pub, priv) => out('info', pub, priv),
  ok: (pub, priv) => out('ok', pub, priv),
  warn: (pub, priv) => out('warn', pub, priv),
  error: (pub, priv) => out('error', pub, priv),
  group(title) { if (process.env.GITHUB_ACTIONS === 'true') console.log(`::group::${title}`); else console.log(`— ${title} —`); },
  endGroup() { if (process.env.GITHUB_ACTIONS === 'true') console.log('::endgroup::'); },
  mask(value) { if (value && process.env.GITHUB_ACTIONS === 'true') console.log(`::add-mask::${value}`); },
  drain() { return entries.splice(0, entries.length); },
};
export { maskNumber };
export const who = (r) => (r?.type === 'group' ? 'a group' : maskNumber(r?.number || r));
