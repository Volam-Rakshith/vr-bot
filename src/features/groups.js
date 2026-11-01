// VR Bot — group tools: welcome, goodbye, anti-link, !tagall, !rules (admin commands: admin.js). © VR DEVELOPMENTS
import { renderTemplate } from '../../panel/shared/templates.js';
import { jidNumber, jidNormalizedUser } from '../wa.js';
import { goodbyeCfgOf } from '../../panel/shared/groupadmin.js';

const META_TTL = 5 * 60000; // group info (who is admin) is re-read at most every 5 min; admin commands always read it fresh

const LINK_RE = /(https?:\/\/|www\.|chat\.whatsapp\.com\/|wa\.me\/|t\.me\/)[^\s]*/i;

export class GroupTools {
  constructor(wa, ctx) { this.wa = wa; this.ctx = ctx; this.meta = new Map(); this.metaAt = new Map(); }

  async metadata(jid, { fresh = false } = {}) {
    if (!fresh && this.meta.has(jid) && Date.now() - (this.metaAt.get(jid) || 0) < META_TTL) return this.meta.get(jid);
    const m = await this.wa.sock.groupMetadata(jid);
    this.meta.set(jid, m); this.metaAt.set(jid, Date.now());
    return m;
  }
  forget(jid) { this.meta.delete(jid); this.metaAt.delete(jid); }
  myIds() {
    const u = this.wa.sock?.user || {};
    return [u.id, u.lid].filter(Boolean).map((x) => jidNormalizedUser(x));
  }
  isAdmin(meta, jid) {
    const n = jidNormalizedUser(jid);
    const p = meta.participants.find((x) => [x.id, x.lid, x.phoneNumber].filter(Boolean).map(jidNormalizedUser).includes(n));
    return !!p?.admin;
  }
  amAdmin(meta) { return this.myIds().some((id) => this.isAdmin(meta, id)); }

  async welcome(groupJid, participantJids) {
    const cfg = this.ctx.groupsCfg[groupJid];
    if (!cfg?.welcome?.enabled || !participantJids.length) return 0;
    const meta = await this.metadata(groupJid).catch(() => ({ subject: 'the group', participants: [] }));
    const mentions = participantJids;
    const names = participantJids.map((j) => '@' + (jidNumber(j) || j.split('@')[0])).join(' ');
    const text = renderTemplate(cfg.welcome.message || 'Welcome {name} to {group}! 👋', { name: names, group: meta.subject }, groupJid);
    await this.ctx.send(groupJid, { text, mentions }, { kind: 'group', cat: 'replies' });
    return 1;
  }

  /** 👋 Goodbye message when someone leaves or is removed (per-group switch + text in the panel). */
  async goodbye(groupJid, participantJids) {
    const cfg = goodbyeCfgOf(this.ctx.groupsCfg[groupJid]);
    const ids = participantJids.filter((j) => !this.myIds().includes(jidNormalizedUser(j)));
    if (!cfg.enabled || !ids.length) return 0;
    this.forget(groupJid);
    const meta = await this.metadata(groupJid).catch(() => ({ subject: 'the group', participants: [] }));
    const names = ids.map((j) => '@' + (jidNumber(j) || j.split('@')[0])).join(' ');
    const text = renderTemplate(cfg.message, { name: names, group: meta.subject }, groupJid);
    await this.ctx.send(groupJid, { text, mentions: ids }, { kind: 'group', cat: 'replies' });
    return 1;
  }

  /** returns true if the message was a link violation and was handled */
  async antiLink(msg, text, groupJid, senderJid) {
    const cfg = this.ctx.groupsCfg[groupJid]?.antiLink;
    if (!cfg?.enabled || !LINK_RE.test(text || '')) return false;
    const allowed = (cfg.allowDomains || []).some((d) => text.toLowerCase().includes(String(d).toLowerCase()));
    if (allowed) return false;
    const meta = await this.metadata(groupJid);
    if (this.isAdmin(meta, senderJid)) return false;
    const iAmAdmin = this.amAdmin(meta);
    const warns = this.ctx.memory.warns;
    const k = `${groupJid}|${jidNormalizedUser(senderJid)}`;
    warns[k] = (warns[k] || 0) + 1;
    const limit = cfg.warnLimit || 3;
    if (iAmAdmin && cfg.action !== 'warn') await this.wa.send(groupJid, { delete: msg.key }).catch(() => {});
    const tag = '@' + (jidNumber(senderJid) || senderJid.split('@')[0]);
    if (iAmAdmin && cfg.action === 'remove' && warns[k] >= limit) {
      await this.ctx.send(groupJid, { text: `🚫 ${tag} removed after ${limit} link warnings.`, mentions: [senderJid] }, { kind: 'group', cat: 'replies' });
      await this.wa.sock.groupParticipantsUpdate(groupJid, [senderJid], 'remove').catch(() => {});
      warns[k] = 0;
    } else {
      await this.ctx.send(groupJid, { text: `⚠️ ${tag} links are not allowed here (warning ${warns[k]}/${limit}).`, mentions: [senderJid] }, { kind: 'group', cat: 'replies' });
    }
    return true;
  }

  async tagall(groupJid, senderJid, isOwner, arg) {
    const cfg = this.ctx.groupsCfg[groupJid] || {};
    const meta = await this.metadata(groupJid);
    if (!isOwner && cfg.tagallAdminsOnly !== false && !this.isAdmin(meta, senderJid)) return 'Only group admins can use !tagall.';
    const ids = meta.participants.map((p) => p.id);
    const tags = ids.map((j) => '@' + (jidNumber(j) || j.split('@')[0])).join(' ');
    await this.ctx.send(groupJid, { text: `📢 ${arg || 'Attention everyone!'}\n\n${tags}`, mentions: ids }, { kind: 'group', cat: 'replies' });
    return null;
  }

  rules(groupJid) {
    return this.ctx.groupsCfg[groupJid]?.rulesText || 'No rules have been set for this group yet.';
  }
}
