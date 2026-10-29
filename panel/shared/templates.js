// VR Bot — template rendering. © VR DEVELOPMENTS
// Placeholders: {name} {first_name} {my_name} {date} {day} {time} {year} {festival} {age} {group}
// Fallback:     {name|friend}  → uses "friend" when name is empty
// Random pick:  {{Hi|Hello|Hey}} → one option, chosen deterministically per message (looks less robotic)
import { seededRandom } from './scheduler.js';

export function renderTemplate(text, vars = {}, seed = '') {
  if (!text) return '';
  let out = String(text).replace(/\{\{([^{}]+)\}\}/g, (_, body) => {
    const opts = body.split('|');
    const i = Math.floor(seededRandom(seed + body) * opts.length);
    return opts[i];
  });
  out = out.replace(/\{([a-z_]+)(?:\|([^{}]*))?\}/gi, (whole, key, fallback) => {
    const v = vars[key.toLowerCase()];
    if (v !== undefined && v !== null && String(v) !== '') return String(v);
    if (fallback !== undefined) return fallback;
    return whole; // leave unknown placeholders visible so mistakes are obvious
  });
  return out;
}

export function firstName(full) { return String(full || '').trim().split(/\s+/)[0] || ''; }

/** Placeholders a template uses (for the panel's preview/warnings). */
export function placeholders(text) {
  return [...String(text || '').matchAll(/\{([a-z_]+)(?:\|[^{}]*)?\}/gi)].map((m) => m[1].toLowerCase());
}

export const KNOWN_PLACEHOLDERS = ['name', 'first_name', 'my_name', 'date', 'day', 'time', 'year', 'festival', 'age', 'group'];

/** Optional "🤖 VR Bot is sending:" header in front of a message. */
export function withHeader(text, headerText, on) {
  if (!on || !headerText) return text;
  return `${headerText}\n${text}`;
}

/**
 * Should the header be added? Order: schedule override → contact override → default for this kind.
 * override values: "on" | "off" | "default" (or undefined).
 * kind: personal | birthday | festival | group | broadcast | alert | reply | ai | followup
 */
export function headerOn(settingsHeader = {}, kind, scheduleOverride, contactOverride) {
  if (!settingsHeader || settingsHeader.enabled === false) return false;
  if (scheduleOverride === 'on') return true;
  if (scheduleOverride === 'off') return false;
  if (contactOverride === 'on') return true;
  if (contactOverride === 'off') return false;
  const d = settingsHeader.defaults || {};
  return !!d[kind];
}
