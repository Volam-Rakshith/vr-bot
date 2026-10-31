// VR Bot — auto-reply rule matching. © VR DEVELOPMENTS
// rule: { id, enabled, match: "word"|"contains"|"exact"|"startsWith"|"regex", pattern, caseSensitive,
//         reply: "text" | ["option 1","option 2"], where: "private"|"groups"|"both",
//         people: "all" | "pick" (saved by the panel; missing on old rules → empty contacts+tags = everyone),
//         contacts: [contactIds], tags: [tags]   (who it works for when people = "pick"; nobody picked = NOBODY),
//         exclude: [contactIds], excludeTags: [tags]   ("Never reply to these people": always wins, also in groups),
//         groups: [groupJids] (empty = every group, when "where" includes groups),
//         react: "❤️" (optional emoji reaction, with or without a text reply),
//         voice: { clip, name, mode: "voice"|"voice+text" }  (optional: answer with one of your voice clips),
//         cooldownMinutes: 60 (10 for voice rules when not set) }
import { ruleCooldown } from './voice.js';

/** Lower-case words with punctuation/extra spaces removed: "Good  MORNING bro!!" → "good morning bro". Works for Telugu/Hindi too. */
export function wordText(s, cs = false) {
  const t = String(s || '').normalize('NFC').replace(/[^\p{L}\p{N}\p{M}]+/gu, ' ').trim();
  return cs ? t : t.toLowerCase();
}
/** Does the text contain this word or phrase as whole words? ("gm" matches "GM bro!" but not "gmail") */
export function hasPhrase(text, phrase, cs = false) {
  const p = wordText(phrase, cs);
  if (!p) return false;
  return ` ${wordText(text, cs)} `.includes(` ${p} `);
}

export function matchText(rule, text) {
  if (!rule || rule.enabled === false || !rule.pattern) return false;
  const t = String(text || '');
  if (!t.trim()) return false; // empty text (stickers, GIFs, photos without caption…) never matches a rule
  const cs = !!rule.caseSensitive;
  const a = cs ? t.trim() : t.trim().toLowerCase();
  const p = cs ? String(rule.pattern) : String(rule.pattern).toLowerCase();
  switch (rule.match || 'contains') {
    case 'word': {
      // Whole words / phrases, comma-separated: "good morning, gm, where are you"
      return String(rule.pattern).split(',').some((x) => hasPhrase(t, x, cs));
    }
    case 'exact': return a === p.trim();
    case 'startsWith': return a.startsWith(p);
    case 'contains': {
      // Comma-separated alternatives: "price, cost, rate"
      return p.split(',').map((x) => x.trim()).filter(Boolean).some((x) => a.includes(x));
    }
    case 'regex': {
      try { return new RegExp(rule.pattern, cs ? '' : 'i').test(t); } catch { return false; }
    }
    default: return false;
  }
}

/** ctx: { isGroup, groupId, contactId, tags: [] }  (contactId is missing for numbers not saved in Contacts) */
export function isExcluded(cfg = {}, ctx = {}) {
  if (ctx.contactId && (cfg.exclude || []).includes(ctx.contactId)) return true;
  const ex = cfg.excludeTags || [];
  return ex.length > 0 && (ctx.tags || []).some((t) => ex.includes(t));
}

export function ruleApplies(rule, ctx = {}) {
  const where = rule.where || 'private';
  if (ctx.isGroup && where === 'private') return false;
  if (!ctx.isGroup && where === 'groups') return false;
  if (isExcluded(rule, ctx)) return false; // "Never reply to these people" wins over everything
  // Picked groups: the rule works for anyone in those groups and in no other group.
  if (ctx.isGroup && (rule.groups || []).length) return rule.groups.includes(ctx.groupId);
  if (rule.people === 'all') return true;
  const hasContacts = (rule.contacts || []).length > 0;
  const hasTags = (rule.tags || []).length > 0;
  // "Only these…" with nobody picked = nobody. Old rules (no `people` field): empty = everyone, like before.
  if (!hasContacts && !hasTags) return rule.people !== 'pick';
  if (hasContacts && ctx.contactId && rule.contacts.includes(ctx.contactId)) return true; // unsaved numbers are never "picked"
  if (hasTags && (ctx.tags || []).some((t) => rule.tags.includes(t))) return true;
  return false;
}

/** cooldowns: { "<ruleId>|<chat>": lastMs } */
export function cooldownOk(cooldowns, key, nowMs, minutes) {
  const last = cooldowns?.[key];
  if (!last) return true;
  return nowMs - last >= (Number(minutes) || 0) * 60000;
}

export function pickReply(rule, seed = '') {
  const r = rule.reply;
  if (Array.isArray(r)) {
    if (!r.length) return '';
    let h = 0; for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    return r[h % r.length];
  }
  return r || '';
}

/** First matching rule (rules are checked in order). */
export function findRule(rules, text, ctx, cooldowns, nowMs, chatKey) {
  return matchRule(rules, text, ctx, cooldowns, nowMs, chatKey).rule;
}

/**
 * Like findRule, but also says when a rule DID match this message and is only waiting for its cooldown:
 * { rule, cooling }. A cooling match still "owns" the message, so the AI does not answer it instead.
 * extraOk(rule) can veto a rule (e.g. its voice clip was sent to this chat too recently) → counts as cooling.
 */
export function matchRule(rules, text, ctx, cooldowns, nowMs, chatKey, extraOk = null) {
  let cooling = null;
  for (const rule of rules || []) {
    if (!matchText(rule, text)) continue;
    if (!ruleApplies(rule, ctx)) continue;
    if (!cooldownOk(cooldowns, `${rule.id}|${chatKey}`, nowMs, ruleCooldown(rule)) || (extraOk && !extraOk(rule))) { cooling = cooling || rule; continue; }
    return { rule, cooling: null };
  }
  return { rule: null, cooling };
}

/* ---------------- who/where a feature may act ("scope") ----------------
 * One shape for every feature that acts on incoming messages (AI, commands, away, voice, media):
 *   who:      "everyone" | "contacts" (saved contacts) | "tags" | "pick" (these contacts or tags) | "owner"/"nobody"
 *   contacts: [contactIds]  tags: [tags]   (used by "pick"/"tags")
 *   exclude: [contactIds]  excludeTags: [tags]   ("never these people" — always wins, in private chats and groups)
 *   groups:   "all" | "none" | [groupJids]
 *             "all"  = any group, but only messages from the people allowed by "who" (old behaviour)
 *             [list] = only these groups, and anyone in them
 * ctx: { isGroup, groupId, contactId, tags }
 */
export function peopleOk(cfg = {}, ctx = {}) {
  const who = cfg.who || 'everyone';
  if (who === 'everyone') return true;
  if (who === 'owner' || who === 'nobody') return false;
  if (who === 'contacts') return !!ctx.contactId;
  const inTags = (ctx.tags || []).some((t) => (cfg.tags || []).includes(t));
  if (who === 'tags') return inTags;
  if (who === 'pick') return (!!ctx.contactId && (cfg.contacts || []).includes(ctx.contactId)) || inTags;
  return false; // unknown value → safest is "no"
}

export function inScope(cfg = {}, ctx = {}) {
  if (isExcluded(cfg, ctx)) return false;
  if (!ctx.isGroup) return peopleOk(cfg, ctx);
  const g = cfg.groups ?? 'all';
  if (Array.isArray(g)) return g.includes(ctx.groupId);
  if (g === 'none' || g === false) return false;
  return peopleOk(cfg, ctx);
}

/** The scope of each feature, read from settings (missing fields keep the old behaviour). */
export function featureScope(S = {}, feature) {
  const pick = (o, who, groups) => ({ who, contacts: o.contacts || [], tags: o.tags || [], exclude: o.exclude || [], excludeTags: o.excludeTags || [], groups });
  if (feature === 'ai') { const a = S.ai || {}; return pick(a, a.who || 'contacts', a.groups ?? 'none'); }
  if (feature === 'commands') {
    const c = S.commands || {};
    return pick(c, c.allow || 'owner', c.inGroups === false ? 'none' : (c.groups ?? 'all'));
  }
  if (feature === 'away') { const a = S.away || {}; return pick(a, a.who || 'everyone', 'none'); }
  if (feature === 'voice') { const v = S.voice || {}; return pick(v, v.who || 'everyone', 'none'); }
  if (feature === 'busy') { const b = S.busy || {}; return pick(b, b.who || 'nobody', b.groups ?? 'none'); }
  if (feature === 'class') { // who "same" (default) = exactly the chats/groups picked for busy mode
    const c = S.class || {};
    if (!c.who || c.who === 'same') return featureScope(S, 'busy');
    return pick(c, c.who, c.groups ?? 'none');
  }
  if (feature === 'media') { const m = S.media || {}; return pick(m, m.who || 'everyone', m.groups ?? 'all'); }
  return pick({}, 'everyone', 'all');
}

/* ---------------- stickers, GIFs & other "noise" ----------------
 * Replies (rules, AI, AI reactions, busy) only answer real text messages by default.
 * kind: "message" | "sticker" | "gif" | "reaction" | "protocol" (deleted/edited/system) | "poll" | "vote" | "empty"
 */
const NOISE = {
  stickerMessage: 'sticker', lottieStickerMessage: 'sticker', stickerPackMessage: 'sticker',
  reactionMessage: 'reaction', encReactionMessage: 'reaction',
  protocolMessage: 'protocol', editedMessage: 'protocol', senderKeyDistributionMessage: 'protocol', messageContextInfo: 'protocol',
  keepInChatMessage: 'protocol', pinInChatMessage: 'protocol', deviceSentMessage: 'protocol', ephemeralSettingMessage: 'protocol',
  pollCreationMessage: 'poll', pollCreationMessageV2: 'poll', pollCreationMessageV3: 'poll', pollCreationMessageV5: 'poll',
  pollUpdateMessage: 'vote', encEventResponseMessage: 'vote',
};
export function messageKind(content, type) {
  if (!type || !content) return 'empty';
  if (NOISE[type]) return NOISE[type];
  if (type === 'videoMessage' && content.videoMessage?.gifPlayback) return 'gif';
  return 'message';
}
/**
 * May reply features act on this message?  it = { kind, text }
 * Default: only real messages that have text. "Also respond to stickers & GIFs" (settings.replies.stickers)
 * lets stickers and GIFs through too. Reactions, deleted/edited messages, polls and votes: never.
 */
export function shouldRespond(it = {}, { stickers = false } = {}) {
  const kind = it.kind || 'message';
  if (kind === 'sticker' || kind === 'gif') return !!stickers;
  if (kind !== 'message') return false;
  return !!String(it.text || '').trim();
}
/** Text an AI reply sees for a sticker/GIF (only when stickers are allowed). */
export function noiseText(it = {}) {
  if (it.kind === 'sticker') return '(sent a sticker)';
  if (it.kind === 'gif') return it.text ? `(sent a GIF) ${it.text}` : '(sent a GIF)';
  return it.text || '';
}

/* ---------------- reactions ---------------- */
export const REACTIONS = ['❤️', '👍', '😂', '😮', '😢', '🙏', '🔥', '🎉'];
/** Pull one allowed emoji out of a model answer ("none"/anything else → ''). */
export function pickReaction(answer) {
  const a = String(answer || '');
  let best = '', at = Infinity;
  for (const e of REACTIONS) {
    const i = Math.min(...[e, e.replace('\uFE0F', '')].map((x) => { const k = a.indexOf(x); return k < 0 ? Infinity : k; }));
    if (i < at) { at = i; best = e; }
  }
  return best;
}
