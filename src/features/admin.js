// VR Bot — group admin: owner-only commands (!kick !add !mute !del !warn !link !setname !setdesc !lock
// !slow !pin !poll !summary), !report for members, and the automatic tools (goodbye is in groups.js):
// anti-spam, bad-word filter, slow mode, night lock, !mute timer. Your bot IS your number, so these work
// in groups where your number is an admin. © VR DEVELOPMENTS
import { normalizeMessageContent } from 'baileys';
import { headerOn, firstName } from '../../panel/shared/templates.js';
import { localTime, pretty12 } from '../../panel/shared/time.js';
import {
  ADMIN_COMMANDS, GROUP_ADMIN_LIMITS as L, PIN_TIMES, warnLimitOf, spamCfgOf, slowCfgOf, slowSecondsOf, badWordsCfgOf,
  parseDuration, durationText, parseLockRange, inLockWindow, SpamTracker, findBadWord, parsePoll, parseSummaryArg,
  effectiveSetting, overrideOf,
} from '../../panel/shared/groupadmin.js';
import { isJidGroup, jidNumber, numberJid } from '../wa.js';
import { aiReply } from './ai.js';
import { limitedUntil, humanTime } from './groqlimit.js';
import { env } from '../env.js';
import { log } from '../log.js';

export const NEED_ADMIN = 'I need admin in this group for that';
const NEEDS_ADMIN = new Set(['kick', 'add', 'mute', 'unmute', 'del', 'delete', 'warn', 'link', 'resetlink', 'revoke', 'setname', 'setdesc', 'lock', 'slow', 'slowmode', 'pin', 'unpin']);
const tagOf = (jid) => '@' + (jidNumber(jid) || String(jid).split('@')[0]);
const ctxInfo = (it) => it.content?.extendedTextMessage?.contextInfo || it.content?.[it.type]?.contextInfo || {};
const lockText = (l) => `${pretty12(l.from)} – ${pretty12(l.to)}`;

export class GroupAdmin {
  /** inc = the Incoming handler (wa, tools(), getData(), state, send, toOwner, quotedMsg, notifier) */
  constructor(inc) { this.inc = inc; this.spam = new SpamTracker(); this.slowSeen = new Map(); this.buffer = new Map(); }
  get wa() { return this.inc.wa; }
  get S() { return this.inc.getData().settings; }
  get mem() { return this.inc.state.memory; }
  cfg(jid) { return this.inc.getData().groupsCfg?.[jid] || {}; }
  groupName(jid) { return (this.inc.state.status.groups || []).find((g) => g.id === jid)?.name || 'the group'; }

  /** A message from the bot into the group (with the 🤖 header when "group" messages have it). */
  async say(jid, text, { mentions = [], quoted } = {}) {
    const S = this.S;
    const head = headerOn(S.header, 'group');
    return this.inc.send(jid, { text: head ? `${S.header.text}\n${text}` : text, ...(mentions.length ? { mentions } : {}) }, { quoted, kind: 'group', cat: 'replies' });
  }
  async del(key) { return this.wa.send(key.remoteJid, { delete: key }).catch((e) => log.warn(`delete failed: ${e.message}`)); }
  isMeJid(jid) { return this.wa.isMe(jid) || (!!env.ownerNumber && jidNumber(jid) === env.ownerNumber); }

  /* ---------- who is the command about ---------- */
  /** @mention → replied-to message's author → a number typed in the command. */
  target(it, arg) {
    const ci = ctxInfo(it);
    const m = (ci.mentionedJid || []).find((j) => !this.wa.isMe(j));
    if (m) return m;
    if (ci.participant && ci.quotedMessage) return ci.participant;
    const d = String(arg || '').replace(/[^\d]/g, '');
    return d.length >= 8 ? numberJid(d) : null;
  }
  /** Warn counts are kept per group per phone number (same person whether WhatsApp shows a number or a hidden id). */
  async personKey(groupJid, jid) { const n = await this.wa.pnFor(jid).catch(() => ''); return `${groupJid}|${n || String(jid).split('@')[0].split(':')[0]}`; }
  warnStore() { this.mem.groupWarns = this.mem.groupWarns || {}; return this.mem.groupWarns; }

  /** Add one warn; kick at the group's "Warns before kick". Returns { count, limit, kicked }. */
  async addWarn(groupJid, jid, { reason = '', quoted, meta } = {}) {
    const store = this.warnStore();
    const k = await this.personKey(groupJid, jid);
    const limit = warnLimitOf(this.cfg(groupJid));
    store[k] = (store[k] || 0) + 1;
    const count = store[k];
    if (count >= limit) {
      const m = meta || await this.inc.tools().metadata(groupJid).catch(() => null);
      if (m && this.inc.tools().amAdmin(m)) {
        const r = await this.wa.sock.groupParticipantsUpdate(groupJid, [jid], 'remove').catch((e) => { log.warn(`kick failed: ${e.message}`); return null; });
        const ok = !!r && (r[0]?.status ?? '200') === '200';
        if (ok) {
          delete store[k];
          await this.say(groupJid, `🚫 ${tagOf(jid)} removed after ${limit} warning${limit > 1 ? 's' : ''}${reason ? ` (${reason})` : ''}.`, { mentions: [jid], quoted });
          return { count, limit, kicked: true };
        }
      }
      await this.say(groupJid, `⚠️ ${tagOf(jid)} warning ${count}/${limit}${reason ? ` (${reason})` : ''}. Could not remove them${m && !this.inc.tools().amAdmin(m) ? ' (I am not admin here)' : ''}.`, { mentions: [jid], quoted });
      return { count, limit, kicked: false };
    }
    await this.say(groupJid, `⚠️ ${tagOf(jid)} warning ${count}/${limit}${reason ? ` (${reason})` : ''}`, { mentions: [jid], quoted });
    return { count, limit, kicked: false };
  }

  /* ---------- per-group overrides set from WhatsApp (!lock, !slow) ---------- */
  overrides(jid) { const st = this.inc.state.status; st.groupOverrides = st.groupOverrides || {}; return st.groupOverrides[jid] || {}; }
  setOverride(jid, key, value) {
    const st = this.inc.state.status; st.groupOverrides = st.groupOverrides || {};
    st.groupOverrides[jid] = { ...(st.groupOverrides[jid] || {}), [key]: overrideOf(value) };
  }
  /** The lock / slow setting in force: the newest of the panel and your !command. */
  setting(jid, key) {
    const c = this.cfg(jid);
    const e = effectiveSetting(c[key], this.overrides(jid)[key], c.savedAt);
    if (e.stale) { const st = this.inc.state.status; delete st.groupOverrides[jid][key]; }
    return e.value || {};
  }
  lockOf(jid) { const l = this.setting(jid, 'lock'); return l.enabled && l.from && l.to && l.from !== l.to ? { from: l.from, to: l.to } : null; }
  slowOf(jid) { const s = this.setting(jid, 'slow'); return s.enabled ? slowSecondsOf(s.seconds) : 0; }

  /* ---------- memory-only log of recent group text for !summary (never saved) ---------- */
  record(it, S) {
    if (!it.isGroup || it.kind !== 'message' || !it.text || it.text.startsWith('🤖')) return;
    const name = it.fromMe ? (S.myName || 'Me') : (it.contact?.name || it.msg?.pushName || `+${it.senderNum || '?'}`);
    const list = this.buffer.get(it.chat) || [];
    list.push({ name: firstName(name) || name, text: it.text.slice(0, 500), ts: it.ts });
    if (list.length > L.bufferMax) list.splice(0, list.length - L.bufferMax);
    this.buffer.set(it.chat, list);
  }

  /* ---------- the owner commands ---------- */
  isAdminCommand(cmd) { return Object.hasOwn(ADMIN_COMMANDS, cmd); }

  async command(it, S, cmd, arg, prefix) {
    const en = S.commands?.enabled || {};
    const flag = ADMIN_COMMANDS[cmd];
    const reply = (text, mentions = []) => this.say(it.chat, text, { mentions, quoted: it.msg });
    if (en[flag] === false) return reply(`${prefix}${flag} is switched off (panel → Settings → Commands → Group admin).`);
    if (cmd === 'poll') return this.poll(it, arg, prefix, reply);
    if (!it.isGroup) return reply(`Type ${prefix}${cmd} inside the group.`);
    const tools = this.inc.tools();
    let meta = null;
    if (NEEDS_ADMIN.has(cmd) || cmd === 'summary') {
      meta = await tools.metadata(it.chat, { fresh: true }).catch((e) => { log.warn(`group info: ${e.message}`); return null; });
      if (!meta) return reply('Could not read this group\'s info from WhatsApp, try again in a minute.');
    }
    const ownDel = (cmd === 'del' || cmd === 'delete') && this.wa.isMe(ctxInfo(it).participant || '');
    if (NEEDS_ADMIN.has(cmd) && !ownDel && !tools.amAdmin(meta)) return reply(NEED_ADMIN);
    const sock = this.wa.sock;
    switch (cmd) {
      case 'kick': {
        const t = this.target(it, arg);
        if (!t) return reply(`Who? ${prefix}kick @user, or reply to their message with ${prefix}kick`);
        if (this.isMeJid(t)) return reply('I can\'t kick you 😅');
        const r = await sock.groupParticipantsUpdate(it.chat, [t], 'remove').catch((e) => [{ status: String(e?.output?.statusCode || e?.data || 'error') }]);
        const st = String(r?.[0]?.status ?? '200');
        if (st === '200') { delete this.warnStore()[await this.personKey(it.chat, t)]; return reply(`👢 Removed ${tagOf(t)}`, [t]); }
        if (st === '404') return reply(`${tagOf(t)} is not in this group.`, [t]);
        return reply(`WhatsApp didn't let me remove ${tagOf(t)} (code ${st}). The group creator can't be removed.`, [t]);
      }
      case 'add': {
        const d = String(arg || '').replace(/[^\d]/g, '').replace(/^00/, '');
        if (d.length === 10) return reply(`Add the country code: ${prefix}add 91${d}`);
        if (d.length < 8 || d.length > 15) return reply(`Usage: ${prefix}add 91XXXXXXXXXX (number with country code)`);
        const ex = await this.wa.exists?.(d).catch(() => null);
        if (ex && ex.exists === false) return reply(`+${d} is not on WhatsApp.`);
        const r = await sock.groupParticipantsUpdate(it.chat, [ex?.jid || numberJid(d)], 'add').catch((e) => [{ status: String(e?.output?.statusCode || 'error') }]);
        const st = String(r?.[0]?.status ?? '200');
        if (st === '200') return reply(`✅ Added +${d}`);
        if (st === '409') return reply(`+${d} is already in the group.`);
        const link = await sock.groupInviteCode(it.chat).then((c) => (c ? `https://chat.whatsapp.com/${c}` : '')).catch(() => '');
        const why = st === '403' ? 'their privacy settings only let their contacts add them to groups'
          : st === '408' ? 'they left this group recently, so WhatsApp blocks adding them back for a while'
            : `WhatsApp refused (code ${st})`;
        return reply(`❌ Couldn't add +${d}: ${why}.${link ? `\nSend them the invite link instead:\n${link}` : ''}`);
      }
      case 'mute': case 'unmute': return this.mute(it, cmd, arg, prefix, reply);
      case 'del': case 'delete': {
        const q = this.inc.quotedMsg(it);
        if (!q) return reply(`Reply to a message with ${prefix}del`);
        await this.del({ ...q.key, fromMe: ownDel });
        await this.del(it.msg.key); // your "!del" too, so nothing is left behind
        return null;
      }
      case 'warn': {
        const t = this.target(it, arg);
        if (!t) return reply(`Who? ${prefix}warn @user (or reply to their message with ${prefix}warn)`);
        if (this.isMeJid(t)) return reply('You can\'t warn yourself 😅');
        if (tools.isAdmin(meta, t)) return reply(`${tagOf(t)} is a group admin, warns don't apply to admins.`, [t]);
        const reason = String(arg || '').replace(/@\d+/g, '').replace(/\+?\d{8,}/g, '').trim().slice(0, 100);
        return this.addWarn(it.chat, t, { reason, quoted: it.msg, meta });
      }
      case 'warns': case 'unwarn': {
        const t = this.target(it, arg);
        const store = this.warnStore(), limit = warnLimitOf(this.cfg(it.chat));
        if (!t) {
          if (cmd === 'unwarn') return reply(`Who? ${prefix}unwarn @user`);
          const rows = Object.entries(store).filter(([k, n]) => k.startsWith(it.chat + '|') && n > 0);
          if (!rows.length) return reply(`Nobody has warnings here. Kick at ${limit}.`);
          const jids = rows.map(([k]) => numberJid(k.split('|')[1]));
          return reply(`⚠️ Warnings (kick at ${limit}):\n${rows.map(([k, n]) => `${tagOf(numberJid(k.split('|')[1]))} ${n}/${limit}`).join('\n')}`, jids);
        }
        const k = await this.personKey(it.chat, t);
        if (cmd === 'unwarn') { delete store[k]; return reply(`✅ ${tagOf(t)} warnings reset (0/${limit})`, [t]); }
        return reply(`⚠️ ${tagOf(t)} has ${store[k] || 0}/${limit} warnings`, [t]);
      }
      case 'link': case 'resetlink': case 'revoke': {
        const code = cmd === 'link' ? await sock.groupInviteCode(it.chat) : await sock.groupRevokeInvite(it.chat);
        if (!code) return reply('WhatsApp didn\'t give me a link, try again.');
        return reply(`${cmd === 'link' ? '🔗' : '🔄 Old link stopped working. New'} invite link for *${meta.subject || this.groupName(it.chat)}*:\nhttps://chat.whatsapp.com/${code}`);
      }
      case 'setname': {
        const name = String(arg || '').trim();
        if (!name) return reply(`Usage: ${prefix}setname New group name`);
        if (name.length > 100) return reply('Group names can be at most 100 characters.');
        await sock.groupUpdateSubject(it.chat, name);
        tools.forget(it.chat);
        return null; // WhatsApp itself shows "You changed the group name" to everyone
      }
      case 'setdesc': {
        const desc = rawRest(it.text, prefix);
        if (!desc) return reply(`Usage: ${prefix}setdesc New description`);
        if (desc.length > 2048) return reply('Descriptions can be at most 2048 characters.');
        await sock.groupUpdateDescription(it.chat, desc);
        tools.forget(it.chat);
        return null;
      }
      case 'lock': return this.lockCommand(it, arg, prefix, reply);
      case 'slow': case 'slowmode': return this.slowCommand(it, arg, prefix, reply);
      case 'pin': case 'unpin': {
        const q = this.inc.quotedMsg(it);
        if (!q) return reply(`Reply to a message with ${prefix}${cmd}${cmd === 'pin' ? ' (or ' + prefix + 'pin 24h / 7d / 30d)' : ''}`);
        let time = PIN_TIMES['7d'];
        if (cmd === 'pin' && arg.trim()) { time = PIN_TIMES[arg.trim().toLowerCase()]; if (!time) return reply(`Pin for 24h, 7d or 30d (WhatsApp only allows these): ${prefix}pin 7d`); }
        const key = { remoteJid: it.chat, id: q.key.id, participant: q.key.participant, fromMe: this.wa.isMe(q.key.participant || '') };
        try {
          await this.wa.send(it.chat, cmd === 'pin' ? { pin: key, type: 1, time } : { pin: key, type: 2 });
        } catch (e) { return reply(/pin|unsupported|not supported/i.test(e.message) ? 'pin not supported by this WhatsApp library version' : `WhatsApp refused the ${cmd} (${e.message.slice(0, 80)})`); }
        return null;
      }
      case 'summary': case 'summarize': return this.summary(it, arg, reply, meta);
      default: return null;
    }
  }

  async mute(it, cmd, arg, prefix, reply) {
    const sock = this.wa.sock;
    this.mem.groupMuteUntil = this.mem.groupMuteUntil || {};
    if (cmd === 'unmute') {
      await sock.groupSettingUpdate(it.chat, 'not_announcement');
      delete this.mem.groupMuteUntil[it.chat];
      return reply('🔊 Unmuted: everyone can send messages again.');
    }
    const a = String(arg || '').trim();
    const ms = a ? parseDuration(a) : null;
    if (a && !ms) return reply(`Usage: ${prefix}mute · ${prefix}mute 30m · ${prefix}mute 2h · ${prefix}unmute`);
    await sock.groupSettingUpdate(it.chat, 'announcement');
    if (ms) {
      const until = Date.now() + ms;
      this.mem.groupMuteUntil[it.chat] = until;
      return reply(`🔇 Muted for ${durationText(ms)}: only admins can send messages. Auto-unmute at ${pretty12(localTime(until, this.S.timezone))}.`);
    }
    delete this.mem.groupMuteUntil[it.chat];
    return reply(`🔇 Muted: only admins can send messages. ${prefix}unmute to open it.`);
  }

  async lockCommand(it, arg, prefix, reply) {
    const a = String(arg || '').trim().toLowerCase();
    const tz = this.S.timezone || 'Asia/Kolkata';
    if (!a) { const l = this.lockOf(it.chat); return reply(l ? `🔒 Night lock: ${lockText(l)} every night (${tz}). ${prefix}lock off to stop.` : `Night lock is off. ${prefix}lock 23:00-07:00 to auto-mute every night.`); }
    if (['off', 'stop', 'no', 'none'].includes(a)) {
      this.setOverride(it.chat, 'lock', { enabled: false });
      const opened = await this.lockTick(it.chat);
      return reply(`🔓 Night lock off.${opened ? ' Group is open now.' : ''}`);
    }
    const r = parseLockRange(a);
    if (!r) return reply(`Usage: ${prefix}lock 23:00-07:00 (or ${prefix}lock 11pm-7am) · ${prefix}lock off`);
    this.setOverride(it.chat, 'lock', { enabled: true, ...r });
    await reply(`🔒 Night lock set: ${lockText(r)} every night. The group is muted (only admins can send) in that time and opens again after.`);
    await this.lockTick(it.chat);
    return null;
  }

  async slowCommand(it, arg, prefix, reply) {
    const a = String(arg || '').trim().toLowerCase();
    if (!a) { const s = this.slowOf(it.chat); return reply(s ? `🐢 Slow mode: 1 message per ${s}s per person. ${prefix}slow off to stop.` : `Slow mode is off. ${prefix}slow 30 = 1 message per 30s per person.`); }
    if (['off', 'stop', 'no', 'none', '0'].includes(a)) { this.setOverride(it.chat, 'slow', { enabled: false }); return reply('🐇 Slow mode off.'); }
    const m = a.match(/^(\d+)\s*(s|sec|secs|seconds?|m|min|mins|minutes?)?$/);
    if (!m) return reply(`Usage: ${prefix}slow 30 (seconds, 5–600) · ${prefix}slow off`);
    const sec = slowSecondsOf(Number(m[1]) * (m[2]?.startsWith('m') ? 60 : 1));
    this.setOverride(it.chat, 'slow', { enabled: true, seconds: sec });
    return reply(`🐢 Slow mode on: 1 message per ${sec}s per person (admins not included).`);
  }

  async poll(it, arg, prefix, reply) {
    const p = parsePoll(rawRest(it.text, prefix));
    if (p.error) return reply(p.error === 'too_many' ? `A poll can have at most ${L.pollMax} options.` : `Usage: ${prefix}poll Question | option 1 | option 2 (2–${L.pollMax} options)`);
    await this.inc.send(it.chat, { poll: { name: p.name, values: p.values, selectableCount: 1 } }, { kind: 'group', cat: 'replies' });
    return null;
  }

  async summary(it, arg, reply, meta) {
    const { n, here } = parseSummaryArg(arg);
    const list = (this.buffer.get(it.chat) || []).filter((x) => x.ts <= it.ts).slice(-n);
    const name = meta?.subject || this.groupName(it.chat);
    const tell = (t) => (here ? reply(t) : this.inc.toOwner(t));
    if (list.length < 3) return tell(`📝 ${name}: not enough messages yet to summarize (I only remember messages from while I'm running, never saved).`);
    if (!env.groqKey) return tell('📝 !summary needs the free Groq key (GitHub secret GROQ_API_KEY).');
    const until = limitedUntil('main');
    if (until) return tell(`📝 Groq's free limit is used up, back in ~${humanTime(until - Date.now())}.`);
    const lines = list.map((x) => `${x.name}: ${x.text}`).join('\n').slice(-12000);
    const ai = {
      ...(this.S.ai || {}), plain: true, examples: [],
      stylePrompt: 'You summarize WhatsApp group chats. Write a short summary in simple English: 3–8 bullet points ("• "), who said or decided what, plans, dates, questions left open. No intro line, no hashtags. Keep names as written.',
    };
    let text;
    try { text = await aiReply(ai, this.S.myName, [], `Group "${name}", last ${list.length} messages:\n${lines}`); }
    catch (e) {
      if (e.rateLimit) return tell(`📝 Groq's free limit is used up, back in ~${humanTime(e.until - Date.now())}.`);
      log.warn(`summary: ${e.message}`);
      return tell('📝 Could not make the summary right now (Groq error), try again later.');
    }
    return tell(`📝 *${name}*, last ${list.length} messages:\n${text || '(empty answer)'}`);
  }

  /* ---------- !report: any member, reply to a message ---------- */
  async report(it, S, prefix) {
    if (!it.isGroup) return null;
    const meta = await this.inc.tools().metadata(it.chat).catch(() => null);
    if (!meta || !this.inc.tools().amAdmin(meta)) return null; // only in groups where you are admin
    const ci = ctxInfo(it);
    const reply = (t) => this.say(it.chat, t, { quoted: it.msg });
    if (!ci.quotedMessage) return reply(`Reply to the message you want to report with ${prefix}report`);
    const mem = this.mem;
    mem.reported = mem.reported || []; mem.reports = mem.reports || {};
    if (mem.reported.includes(`${it.chat}|${ci.stanzaId}`)) return null; // already reported (once per message)
    const who = it.senderNum || 'x', now = Date.now();
    const recent = (mem.reports[who] || []).filter((t) => now - t < 3600000);
    if (recent.length >= L.reportsPerHour) return null; // max 5 reports per person per hour
    mem.reports[who] = [...recent, now];
    mem.reported = [...mem.reported, `${it.chat}|${ci.stanzaId}`].slice(-300);
    const q = normalizeMessageContent(ci.quotedMessage) || {};
    const qText = q.conversation || q.extendedTextMessage?.text || q.imageMessage?.caption || q.videoMessage?.caption || (q.imageMessage ? '[photo]' : q.videoMessage ? '[video]' : q.stickerMessage ? '[sticker]' : q.audioMessage ? '[voice note]' : '[message]');
    const author = ci.participant ? (await this.wa.pnFor(ci.participant).catch(() => '')) || ci.participant.split('@')[0] : '?';
    const reporter = it.contact?.name || it.msg?.pushName || `+${it.senderNum}`;
    const text = `🚩 *Report* in ${meta.subject || this.groupName(it.chat)}\nFrom: ${reporter}${it.senderNum ? ` (+${it.senderNum})` : ''}\nAbout a message by: +${author}\n"${String(qText).slice(0, 700)}"`;
    await this.inc.toOwner(text).catch((e) => log.warn(`report: ${e.message}`));
    if (this.inc.notifier && !this.inc.notifier.selfReports?.()) this.inc.notifier.report?.(text, '🚩 Report');
    return reply('✅ reported to admin');
  }

  /* ---------- automatic tools on members' messages (never you, never admins) ---------- */
  /** true = the message was deleted (spam / bad word / slow mode) → nothing else should answer it */
  async guard(it, S, isOwner) {
    if (!it.isGroup || it.fromMe || isOwner) return false;
    const cfg = this.cfg(it.chat);
    const spam = spamCfgOf(cfg), bad = badWordsCfgOf(cfg), slow = this.slowOf(it.chat);
    const doBad = bad.enabled && bad.words.length && it.text, doSpam = spam.enabled && it.text;
    if (!doSpam && !doBad && !slow) return false;
    const tools = this.inc.tools();
    const meta = await tools.metadata(it.chat).catch(() => null);
    if (!meta || tools.isAdmin(meta, it.senderJid)) return false;
    const iAmAdmin = tools.amAdmin(meta);
    const who = it.senderNum || it.senderJid;
    // 🚫 anti-spam: same text ≥ X times within Y seconds → delete them + 1 warn
    if (doSpam) {
      const r = this.spam.hit({ group: it.chat, sender: who, text: it.text, ts: it.ts, key: it.msg.key }, spam);
      if (r.keys.length && iAmAdmin) {
        for (const k of r.keys) await this.del(k);
        if (r.trigger) await this.addWarn(it.chat, it.senderJid, { reason: 'spam', meta });
        return true;
      }
    }
    // 🤬 bad words → delete + 1 warn
    if (doBad && iAmAdmin && findBadWord(it.text, bad.words)) {
      await this.del(it.msg.key);
      await this.addWarn(it.chat, it.senderJid, { reason: 'bad language', meta });
      return true;
    }
    // 🐢 slow mode → a 2nd message inside the window is deleted (no warn); one notice per person per 10 min
    if (slow) {
      const k = `${it.chat}|${who}`, prev = this.slowSeen.get(k);
      if (prev && it.ts - prev < slow * 1000 && iAmAdmin) {
        await this.del(it.msg.key);
        this.mem.slowNotice = this.mem.slowNotice || {};
        if (Date.now() - (this.mem.slowNotice[k] || 0) > 10 * 60000) {
          this.mem.slowNotice[k] = Date.now();
          await this.say(it.chat, `🐢 ${tagOf(it.senderJid)} slow mode: ${slow}s`, { mentions: [it.senderJid] });
        }
        return true;
      }
      this.slowSeen.set(k, it.ts);
    }
    return false;
  }

  /* ---------- timers: !mute 30m and the night lock (called from the run loop) ---------- */
  async tick(now = Date.now()) {
    const mu = this.mem.groupMuteUntil || {};
    for (const [jid, until] of Object.entries(mu)) {
      if (now < until) continue;
      delete mu[jid];
      if (this.lockOf(jid) && inLockWindow(now, this.lockOf(jid).from, this.lockOf(jid).to, this.S.timezone)) { this.lockState()[jid] = 'locked'; continue; } // night lock keeps it muted
      try { await this.wa.sock.groupSettingUpdate(jid, 'not_announcement'); await this.say(jid, '🔊 Mute time is over, everyone can send messages again.'); }
      catch (e) { log.warn(`auto-unmute failed: ${e.message}`); }
    }
    const ids = new Set([...Object.keys(this.inc.getData().groupsCfg || {}), ...Object.keys(this.inc.state.status.groupOverrides || {}), ...Object.keys(this.lockState())]);
    for (const jid of ids) await this.lockTick(jid, now);
  }
  lockState() { this.mem.groupLockState = this.mem.groupLockState || {}; return this.mem.groupLockState; }
  /** Apply the night lock for one group. Returns true when it opened the group. */
  async lockTick(jid, now = Date.now()) {
    if (!isJidGroup(jid)) return false;
    const st = this.lockState(), l = this.lockOf(jid);
    const want = l && inLockWindow(now, l.from, l.to, this.S.timezone) ? 'locked' : 'open';
    const prev = st[jid];
    if (want === 'locked' && prev !== 'locked') {
      if (prev?.startsWith?.('err:') && now - Number(prev.slice(4)) < 15 * 60000) return false; // not admin? try again in 15 min
      try {
        await this.wa.sock.groupSettingUpdate(jid, 'announcement');
        st[jid] = 'locked';
        await this.say(jid, `🔒 Night lock: only admins can send messages till ${pretty12(l.to)}. Good night 🌙`);
      } catch (e) { st[jid] = `err:${now}`; log.warn(`night lock failed (${this.groupName(jid)}): ${e.message}`); }
      return false;
    }
    if (want === 'open' && prev === 'locked') {
      if ((this.mem.groupMuteUntil || {})[jid] > now) { delete st[jid]; return false; } // you muted it with a timer → that timer opens it
      try {
        await this.wa.sock.groupSettingUpdate(jid, 'not_announcement');
        delete st[jid];
        await this.say(jid, l ? '🔓 Good morning! The group is open again ☀️' : '🔓 The group is open again.');
        return true;
      } catch (e) { log.warn(`night unlock failed (${this.groupName(jid)}): ${e.message}`); return false; }
    }
    if (want === 'open' && prev && prev !== 'locked') delete st[jid];
    return false;
  }
}

/** Everything after "!cmd " with line breaks kept (for !setdesc and !poll). */
export function rawRest(text, prefix = '!') {
  const t = String(text || '').trim().slice(prefix.length);
  const m = t.match(/^\s*\S+\s?([\s\S]*)$/);
  return (m ? m[1] : '').trim();
}
