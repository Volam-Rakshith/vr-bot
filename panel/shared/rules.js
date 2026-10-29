// VR Bot — auto-reply rule matching. © VR DEVELOPMENTS
// rule: { id, enabled, match: "contains"|"exact"|"startsWith"|"regex", pattern, caseSensitive,
//         reply: "text" | ["option 1","option 2"], where: "private"|"groups"|"both",
//         contacts: [contactIds] (empty = everyone), tags: [tags], exclude: [contactIds],
//         cooldownMinutes: 60 }

export function matchText(rule, text) {
  if (!rule || rule.enabled === false || !rule.pattern) return false;
  const t = String(text || '');
  if (!t) return false;
  const cs = !!rule.caseSensitive;
  const a = cs ? t.trim() : t.trim().toLowerCase();
  const p = cs ? String(rule.pattern) : String(rule.pattern).toLowerCase();
  switch (rule.match || 'contains') {
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

/** ctx: { isGroup, contactId, tags: [] } */
export function ruleApplies(rule, ctx = {}) {
  const where = rule.where || 'private';
  if (ctx.isGroup && where === 'private') return false;
  if (!ctx.isGroup && where === 'groups') return false;
  if ((rule.exclude || []).includes(ctx.contactId)) return false;
  const hasContacts = (rule.contacts || []).length > 0;
  const hasTags = (rule.tags || []).length > 0;
  if (!hasContacts && !hasTags) return true;
  if (hasContacts && rule.contacts.includes(ctx.contactId)) return true;
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
  for (const rule of rules || []) {
    if (!matchText(rule, text)) continue;
    if (!ruleApplies(rule, ctx)) continue;
    if (!cooldownOk(cooldowns, `${rule.id}|${chatKey}`, nowMs, rule.cooldownMinutes ?? 60)) continue;
    return rule;
  }
  return null;
}
