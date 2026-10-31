// VR Bot — voice clips (your own prerecorded voice notes). Pure ES module: SAME code in the panel and the bot.
// © VR DEVELOPMENTS
//
// Where clips live: the "vr-voice" branch of your repo (never main), one pair of files per clip, both ENCRYPTED
// with your panel password (same AES-256-GCM scheme as your settings), so nobody can listen to them in the public repo:
//   voice/<id>.meta.json   → { v, id, name, secs, size, fmt, mime, waveform, by, at }
//   voice/<id>.audio.json  → the sound itself (Ogg/Opus = a real WhatsApp voice note)
// The panel adds clips through the GitHub API, the bot adds them from "!voice save <name>". Rules and schedules point
// at a clip by id:   voice: { clip: "<id>", name: "good morning", mode: "voice" | "voice+text" }

export const VOICE_BRANCH = 'vr-voice';
export const VOICE_DIR = 'voice';
export const VOICE_LIMITS = { maxSeconds: 60, maxBytes: 1024 * 1024, maxRawBytes: 5 * 1024 * 1024, maxUploadBytes: 20 * 1024 * 1024, maxClips: 100 };
export const VOICE_COOLDOWN_MIN = 10; // default for rules that answer with a voice clip
export const PTT_MIME = 'audio/ogg; codecs=opus';

export const clipPaths = (id) => ({ meta: `${VOICE_DIR}/${id}.meta.json`, audio: `${VOICE_DIR}/${id}.audio.json` });
export function clipIdFromPath(p) { const m = String(p || '').match(/^voice\/([A-Za-z0-9_-]+)\.(meta|audio)\.json$/); return m ? { id: m[1], part: m[2] } : null; }
export function newClipId(now = Date.now()) { return `v${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`; }

/** Clip names: trimmed, single spaces, max 40 chars. Compared without case. */
export function cleanName(name) { return String(name || '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40); }
export const nameKey = (name) => cleanName(name).toLowerCase();

/** Find a clip by id or by name (case-insensitive). list = [meta]. */
export function findClip(list = [], ref) {
  if (!ref) return null;
  const r = typeof ref === 'object' ? ref : { clip: ref, name: ref };
  return list.find((c) => c && r.clip && c.id === r.clip) || list.find((c) => c && r.name && nameKey(c.name) === nameKey(r.name)) || null;
}

/** What a rule / schedule sends: { text: bool, voice: bool, ref } (no voice set = plain text, like before). */
export function voicePlan(item = {}) {
  const v = item?.voice;
  if (!v || (!v.clip && !v.name) || v.mode === 'off' || v.mode === 'text') return { text: true, voice: false, ref: null };
  return { text: v.mode === 'voice+text', voice: true, ref: { clip: v.clip || '', name: v.name || '' } };
}

/** Cooldown for an auto-reply rule: what you set, else 10 min for voice rules and 60 min for text rules. */
export function ruleCooldown(rule = {}) {
  const n = Number(rule.cooldownMinutes);
  if (rule.cooldownMinutes !== undefined && rule.cooldownMinutes !== null && rule.cooldownMinutes !== '' && Number.isFinite(n)) return n;
  return voicePlan(rule).voice ? VOICE_COOLDOWN_MIN : 60;
}

/**
 * WhatsApp message content for a clip, sent as a real voice note (push-to-talk): no caption, no header, no label —
 * it looks exactly like a voice note you recorded yourself.
 */
export function pttContent(audio, meta = {}) {
  const c = { audio, mimetype: PTT_MIME, ptt: true };
  const secs = Math.round(Number(meta.secs) || 0);
  if (secs > 0) c.seconds = secs;
  if (Array.isArray(meta.waveform) && meta.waveform.length) c.waveform = Uint8Array.from(meta.waveform.slice(0, 64).map((x) => Math.max(0, Math.min(100, Math.round(x) || 0))));
  return c;
}

/** "!voice save good morning" → { sub: "save", name: "good morning" } */
export function parseVoiceCommand(arg = '') {
  const t = String(arg || '').trim();
  const [first = '', ...rest] = t.split(/\s+/);
  const sub = first.toLowerCase();
  const name = cleanName(rest.join(' '));
  if (['save', 'add', 'new'].includes(sub)) return { sub: 'save', name };
  if (['list', 'ls', 'all', ''].includes(sub)) return { sub: 'list', name: '' };
  if (['delete', 'del', 'remove', 'rm'].includes(sub)) return { sub: 'delete', name };
  if (['play', 'send', 'test'].includes(sub)) return { sub: 'play', name };
  return { sub: 'help', name: cleanName(t) };
}

export const fmtSecs = (s) => { const n = Math.round(Number(s) || 0); return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`; };
export const fmtSize = (b) => { const n = Number(b) || 0; return n >= 1024 * 1024 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`; };

/** Text for "!voice list". */
export function voiceListText(list = [], prefix = '!') {
  if (!list.length) return `🎙️ No voice clips yet.\nSend a voice note here, then reply to it with ${prefix}voice save <name>. Or record one in the panel → More → Voice clips.`;
  const rows = [...list].sort((a, b) => nameKey(a.name).localeCompare(nameKey(b.name))).map((c) => `• ${c.name} — ${c.secs ? fmtSecs(c.secs) : '?'} · ${fmtSize(c.size)}${c.fmt === 'raw' ? ' · ⏳ converting' : ''}`);
  return [`🎙️ *Voice clips* (${list.length})`, ...rows, '', `${prefix}voice play <name> · ${prefix}voice delete <name>`].join('\n');
}

/** Sent log text for a voice send. */
export const voiceLabel = (name) => `🎙️ Voice clip: ${name || 'voice note'}`;
