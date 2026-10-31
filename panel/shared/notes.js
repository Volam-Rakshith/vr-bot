// VR Bot — notes ("!note"). Pure ES module: SAME code in the panel and the bot. © VR DEVELOPMENTS
//
// Where notes live: the "vr-notes" branch of your repo (never main), ONE file per note, ENCRYPTED with your panel
// password (same AES-256-GCM scheme as your settings — your repo is public, nobody can read them there):
//   notes/<id>.json  → { v, id, text, from, fromNum, kind, forwarded, sentAt, at, by }
// Why its own branch: vr-state is rewritten by every bot run (force-push), so a note the panel adds there could be wiped
// a minute later; main would make every note a commit that re-deploys the panel. One file per note means the bot and
// the panel can both add notes at the same moment without overwriting each other.

export const NOTES_BRANCH = 'vr-notes';
export const NOTES_DIR = 'notes';
export const NOTES_LIMITS = { maxChars: 4000, maxNotes: 1000, listCount: 10 };

export const notePath = (id) => `${NOTES_DIR}/${id}.json`;
export function noteIdFromPath(p) { const m = String(p || '').match(/^notes\/([A-Za-z0-9_-]+)\.json$/); return m ? m[1] : null; }
export function newNoteId(now = Date.now()) { return `n${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`; }

/** Trim, keep line breaks (max 2 blank lines in a row), cut to the limit. */
export function cleanNoteText(t) {
  return String(t ?? '').replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, NOTES_LIMITS.maxChars);
}

/** Newest first (by when it was saved). */
export const sortNotes = (list = []) => [...list].filter(Boolean).sort((a, b) => (Number(b.at) || 0) - (Number(a.at) || 0) || String(b.id).localeCompare(String(a.id)));

/** Links in a note: http(s) URLs and bare www./domain.tld/... */
const URL_RE = /\b((?:https?:\/\/|www\.)[^\s<>"']+|(?:[a-z0-9-]+\.)+(?:com|in|org|net|io|dev|me|app|co|gg|ly|be|tv|ai|edu|gov|info|xyz|site|bot)(?:\/[^\s<>"']*)?)/gi;
const trimUrl = (u) => u.replace(/[).,!?;:'"\]]+$/, '');
export function linksIn(text = '') {
  const out = [];
  for (const m of String(text).matchAll(URL_RE)) {
    const raw = trimUrl(m[1]);
    if (!raw || /@/.test(String(text).slice(Math.max(0, m.index - 1), m.index))) continue; // skip e-mail domains
    const href = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    if (!out.some((l) => l.href === href)) out.push({ text: raw, href });
  }
  return out;
}
/** Split text into [{ text } | { text, href }] for safe rendering (the panel escapes each piece). */
export function linkParts(text = '') {
  const s = String(text), parts = [];
  let last = 0;
  for (const m of s.matchAll(URL_RE)) {
    const raw = trimUrl(m[1]);
    if (!raw || /@/.test(s.slice(Math.max(0, m.index - 1), m.index))) continue;
    if (m.index > last) parts.push({ text: s.slice(last, m.index) });
    parts.push({ text: raw, href: /^https?:\/\//i.test(raw) ? raw : `https://${raw}` });
    last = m.index + raw.length;
  }
  if (last < s.length) parts.push({ text: s.slice(last) });
  return parts;
}

/** Search: every word must appear in the text, the sender's name or the kind. */
export function searchNotes(list = [], q = '') {
  const words = String(q || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return sortNotes(list);
  return sortNotes(list).filter((n) => { const hay = `${n.text || ''} ${n.from || ''} ${n.kind || ''}`.toLowerCase(); return words.every((w) => hay.includes(w)); });
}

/**
 * "!note …" / "!notes …" → what to do.
 *   !note buy charger        → { sub: 'add', text }
 *   !note  (reply to a msg)  → { sub: 'add', text: '' }  (the bot takes the replied-to message)
 *   !note delete 3 / del 3   → { sub: 'delete', n: 3 }
 *   !notes / !note list      → { sub: 'list' }      !notes 2 → page 2      !notes find <words> / !notes <words> → search
 *   !note help               → { sub: 'help' }
 */
export function parseNoteCommand(cmd = 'note', arg = '') {
  const t = String(arg || '').trim();
  const del = t.match(/^(?:delete|del|remove|rm)\s*#?(\d{1,4})$/i);
  if (del) return { sub: 'delete', n: Number(del[1]) };
  if (/^(?:delete|del|remove|rm)$/i.test(t)) return { sub: 'delete', n: 0 };
  if (cmd === 'notes') {
    if (!t || /^(?:list|all)$/i.test(t)) return { sub: 'list', page: 1 };
    const pg = t.match(/^(?:page\s*)?(\d{1,3})$/i);
    if (pg) return { sub: 'list', page: Math.max(1, Number(pg[1])) };
    const f = t.match(/^(?:find|search)\s+(.+)$/i);
    return { sub: 'find', q: (f ? f[1] : t).trim() };
  }
  if (/^help$/i.test(t)) return { sub: 'help' };
  if (/^list$/i.test(t)) return { sub: 'list', page: 1 };
  return { sub: 'add', text: t };
}

/** A short one-line preview of a note. */
export function notePreview(n = {}, max = 90) {
  const one = String(n.text || '').replace(/\s+/g, ' ').trim();
  return one.length > max ? `${one.slice(0, max - 1).trimEnd()}…` : one;
}

/** "!notes" reply: newest first, numbered (the number is what "!note delete <n>" uses). */
export function notesListText(list = [], { prefix = '!', page = 1, q = '', fmt = (ms) => new Date(ms).toISOString().slice(0, 16).replace('T', ' ') } = {}) {
  const all = sortNotes(list);
  const per = NOTES_LIMITS.listCount;
  if (!all.length) return `📝 No notes yet.\nSave one: ${prefix}note buy charger — or reply ${prefix}note to any message.`;
  const shown = q ? searchNotes(all, q) : all;
  if (q && !shown.length) return `📝 No note has "${q}". Send ${prefix}notes to see the newest.`;
  const pages = Math.max(1, Math.ceil(shown.length / per));
  const pg = Math.min(Math.max(1, page), pages);
  const slice = shown.slice((pg - 1) * per, pg * per);
  const lines = slice.map((n) => {
    const num = all.indexOf(n) + 1; // the number always refers to the full newest-first list
    const who = n.from && n.from !== 'me' ? ` · from ${n.from}` : '';
    return `*${num}.* ${notePreview(n, 120) || `(${n.kind || 'empty'})`}\n    _${fmt(n.at)}${who}_`;
  });
  const head = q ? `📝 *Notes with "${q}"* (${shown.length})` : `📝 *Your notes* (${all.length}${pages > 1 ? ` · page ${pg}/${pages}` : ''})`;
  const tail = [`Delete one: ${prefix}note delete <number>`];
  if (!q && pg < pages) tail.unshift(`More: ${prefix}notes ${pg + 1}`);
  return [head, ...lines, '', ...tail, 'All notes + search: panel → More → Notes'].join('\n');
}

/**
 * The text of a WhatsApp message (already unwrapped: ephemeral/view-once/etc.), for saving it as a note.
 * Returns { text, kind } — kind: text | link | image | video | document | audio | voice | sticker | contact | location | poll.
 */
export function messageNoteText(c) {
  if (!c || typeof c !== 'object') return { text: '', kind: '' };
  const withLink = (txt, extra) => {
    const t = String(txt || '');
    const url = extra?.canonicalUrl || extra?.matchedText || '';
    const full = url && !t.includes(url) ? `${t}${t ? '\n' : ''}${url}` : t;
    return { text: full, kind: linksIn(full).length ? 'link' : 'text' };
  };
  if (typeof c.conversation === 'string' && c.conversation) return withLink(c.conversation);
  if (c.extendedTextMessage) { const e = c.extendedTextMessage; const r = withLink(e.text, e); if (e.title && !r.text.includes(e.title)) r.text = `${e.title}\n${r.text}`; return r; }
  if (c.imageMessage) return { text: c.imageMessage.caption || '📷 Photo', kind: 'image' };
  if (c.videoMessage) return { text: c.videoMessage.caption || (c.videoMessage.gifPlayback ? '🎞️ GIF' : '🎬 Video'), kind: 'video' };
  if (c.documentMessage) { const d = c.documentMessage; return { text: [d.caption, d.fileName || d.title].filter(Boolean).join('\n') || '📄 Document', kind: 'document' }; }
  if (c.documentWithCaptionMessage?.message) return messageNoteText(c.documentWithCaptionMessage.message);
  if (c.audioMessage) return { text: c.audioMessage.ptt ? `🎤 Voice note${c.audioMessage.seconds ? ` (${c.audioMessage.seconds}s)` : ''}` : '🎵 Audio', kind: c.audioMessage.ptt ? 'voice' : 'audio' };
  if (c.stickerMessage) return { text: '🙂 Sticker', kind: 'sticker' };
  if (c.contactMessage) { const vc = c.contactMessage.vcard || ''; const tel = (vc.match(/TEL[^:]*:([+\d ()-]+)/) || [])[1] || ''; return { text: `👤 ${c.contactMessage.displayName || 'Contact'}${tel ? ` ${tel.trim()}` : ''}`, kind: 'contact' }; }
  if (c.contactsArrayMessage) return { text: `👥 ${(c.contactsArrayMessage.contacts || []).map((x) => x.displayName).filter(Boolean).join(', ') || 'Contacts'}`, kind: 'contact' };
  if (c.locationMessage || c.liveLocationMessage) {
    const l = c.locationMessage || c.liveLocationMessage;
    const where = [l.name, l.address].filter(Boolean).join(', ');
    return { text: `📍 ${where ? `${where}\n` : ''}https://maps.google.com/?q=${l.degreesLatitude},${l.degreesLongitude}`, kind: 'location' };
  }
  const poll = c.pollCreationMessage || c.pollCreationMessageV2 || c.pollCreationMessageV3;
  if (poll) return { text: `📊 ${poll.name || 'Poll'}\n${(poll.options || []).map((o) => `• ${o.optionName}`).join('\n')}`, kind: 'poll' };
  if (c.buttonsMessage?.contentText) return { text: c.buttonsMessage.contentText, kind: 'text' };
  if (c.templateMessage?.hydratedTemplate?.hydratedContentText) return { text: c.templateMessage.hydratedTemplate.hydratedContentText, kind: 'text' };
  return { text: '', kind: '' };
}

/** Was this (quoted) message forwarded? */
export function isForwardedContent(c) {
  if (!c || typeof c !== 'object') return false;
  for (const v of Object.values(c)) if (v && typeof v === 'object' && v.contextInfo && (v.contextInfo.isForwarded || v.contextInfo.forwardingScore > 0)) return true;
  return false;
}
