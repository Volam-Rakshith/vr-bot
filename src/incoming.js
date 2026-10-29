// VR Bot — handles messages that arrived (while offline or during a run).
// Auto-reply, AI, away, commands, group tools, voice→text, media save, follow-up tracking.
// NOTE: GitHub Actions is not always-on, so these "instant" features reply on the next run
// (up to ~30 minutes later) — or live, if a run happens to be connected at that moment.
// © VR DEVELOPMENTS
import { getContentType, downloadMediaMessage, normalizeMessageContent, WAMessageStubType } from 'baileys';
import { findRule, pickReply } from '../panel/shared/rules.js';
import { renderTemplate, firstName, headerOn } from '../panel/shared/templates.js';
import { localDate, localTime, inDailyWindow } from '../panel/shared/time.js';
import { normalizeNumber, maskNumber } from '../panel/shared/defaults.js';
import { isJidGroup, jidNumber, numberJid } from './wa.js';
import { log } from './log.js';
import { aiReply, transcribe } from './features/ai.js';
import { weather, toSticker, imagesToPdf, ytAudio, helpText } from './features/commands.js';
import { GroupTools } from './features/groups.js';
import { env } from './env.js';

const IGNORE = new Set(['protocolMessage', 'reactionMessage', 'senderKeyDistributionMessage', 'messageContextInfo', 'pollUpdateMessage', 'keepInChatMessage', 'pinInChatMessage', 'encReactionMessage', 'editedMessage']);
const textOf = (c) => c?.conversation || c?.extendedTextMessage?.text || c?.imageMessage?.caption || c?.videoMessage?.caption || c?.documentMessage?.caption || '';

export function isAwayActive(settings, status, nowMs) {
  const o = status.away;
  if (o && nowMs - (o.at || 0) < 12 * 3600000) return !!o.on; // !away / !back from WhatsApp wins for 12h
  if (!settings.features?.away) return false;
  const w = settings.away?.window;
  if (!w?.enabled) return true; // feature on, no window → always away
  return inDailyWindow(localTime(nowMs, settings.timezone), w.from, w.to);
}

export class Incoming {
  constructor({ wa, getData, state, send, media }) {
    this.wa = wa; this.getData = getData; this.state = state; this.send = send; this.media = media;
    this.queue = [];
    this.recentImages = new Map(); // chat → [WAMessage] (for !pdf)
    this.groups = null;
  }
  push(m) { for (const msg of m.messages || []) this.queue.push(msg); }
  async participants(u) {
    if (u.action !== 'add') return;
    const data = this.getData();
    if (!data.settings.features.groupTools) return;
    const ids = (u.participants || []).map((p) => (typeof p === 'string' ? p : p.id)).filter(Boolean);
    const key = `${u.id}|${ids.join(',')}|${localDate(Date.now(), data.settings.timezone)}`;
    if (this.state.memory.processed.includes('w:' + key)) return;
    this.state.memory.processed.push('w:' + key);
    await this.tools().welcome(u.id, ids).catch((e) => log.warn(`welcome failed: ${e.message}`));
  }
  tools() {
    const data = this.getData();
    if (!this.groups) this.groups = new GroupTools(this.wa, { groupsCfg: data.groupsCfg, memory: this.state.memory, send: this.send });
    this.groups.ctx.groupsCfg = data.groupsCfg;
    return this.groups;
  }

  /** Process everything queued so far. Returns number of messages handled. */
  async drain() {
    if (!this.queue.length) return 0;
    const batch = this.queue.splice(0, this.queue.length);
    const data = this.getData();
    const S = data.settings, F = S.features, mem = this.state.memory, now = Date.now();
    const processed = new Set(mem.processed);
    const sentIds = new Set(mem.sentIds);
    const me = this.wa.me();
    const owner = env.ownerNumber || me;
    const contactsByNum = new Map(data.contacts.map((c) => [normalizeNumber(c.number), c]));

    // ---- pass 1: normalise + record who said what when ----
    const items = [];
    for (const msg of batch) {
      const id = msg.key?.id;
      if (!id || processed.has(id)) continue;
      processed.add(id); mem.processed.push(id);
      if (sentIds.has(id)) continue; // a message this bot sent itself
      const chat = msg.key.remoteJid;
      if (!chat || chat.endsWith('@newsletter') || chat.endsWith('@broadcast') && chat !== 'status@broadcast') continue;
      const ts = Number(msg.messageTimestamp || 0) * 1000 || now;
      const content = normalizeMessageContent(msg.message);
      const type = content ? getContentType(content) : null;
      const isGroup = !!isJidGroup(chat);
      const it = { msg, id, chat, ts, content, type, isGroup, text: textOf(content).trim(), fromMe: !!msg.key.fromMe, status: chat === 'status@broadcast' };
      if (it.status) { items.push(it); continue; }
      if (isGroup) {
        it.senderJid = msg.key.participant || msg.participant || '';
        it.senderNum = await this.wa.pnFor(it.senderJid, msg.key.participantAlt);
      } else {
        it.senderNum = await this.wa.pnFor(chat, msg.key.remoteJidAlt);
        it.senderJid = chat;
      }
      it.contact = contactsByNum.get(it.senderNum) || null;
      it.selfChat = !isGroup && (this.wa.isMe(chat) || (!!it.senderNum && it.senderNum === me));
      if (!isGroup && !it.selfChat && it.senderNum) {
        if (it.fromMe) mem.lastOut[it.senderNum] = Math.max(mem.lastOut[it.senderNum] || 0, ts);
        else mem.lastIn[it.senderNum] = Math.max(mem.lastIn[it.senderNum] || 0, ts);
      }
      if (!it.fromMe && !it.selfChat && type && type !== 'protocolMessage' && type !== 'reactionMessage') {
        const today = localDate(now, S.timezone);
        const ib = this.state.status.inbox;
        if (ib.date !== today) { ib.date = today; ib.people = {}; }
        const k = isGroup ? chat : it.senderNum;
        const nm = isGroup ? (this.state.status.groups.find((g) => g.id === chat)?.name || 'group') : (it.contact?.name || msg.pushName || '');
        ib.people[k] = { name: nm, masked: isGroup ? 'group' : maskNumber(it.senderNum), count: (ib.people[k]?.count || 0) + 1, last: ts };
      }
      items.push(it);
    }
    items.sort((a, b) => a.ts - b.ts);
    const maxAge = (S.replies?.maxAgeHours ?? 6) * 3600000;
    const aiQueue = new Map();
    let handled = 0;

    // ---- pass 2: act ----
    for (const it of items) {
      try {
        handled++;
        if (it.status) { await this.saveMedia(it, S, true); continue; }
        // group "joined" system messages → welcome
        if (it.isGroup && F.groupTools && [WAMessageStubType.GROUP_PARTICIPANT_ADD, WAMessageStubType.GROUP_PARTICIPANT_INVITE, WAMessageStubType.GROUP_PARTICIPANT_ACCEPT].includes(it.msg.messageStubType)) {
          if (now - it.ts < maxAge) await this.participants({ id: it.chat, action: 'add', participants: it.msg.messageStubParameters || [] });
          continue;
        }
        if (!it.type || IGNORE.has(it.type)) continue;
        if (F.commands) this.noteImage(it);
        const fresh = now - it.ts < maxAge;
        const prefix = S.commands?.prefix || '!';
        const isCmd = it.text.startsWith(prefix);
        const isOwner = it.fromMe || (owner && it.senderNum === owner);

        if (!it.fromMe && F.mediaSave && S.media?.chats) await this.saveMedia(it, S, false);

        if (it.fromMe) {
          if (isCmd && fresh) await this.command(it, S, F, true);
          continue;
        }
        if (!fresh) continue;
        if (isCmd && F.commands) { await this.command(it, S, F, isOwner); continue; }
        if (it.isGroup) {
          if (F.groupTools && it.text) await this.tools().antiLink(it.msg, it.text, it.chat, it.senderJid).catch((e) => log.warn(`anti-link: ${e.message}`));
          if (F.autoReply && it.text) await this.autoReply(it, data, true);
          continue;
        }
        // private chat
        if (S.replies?.skipIfIReplied !== false && (mem.lastOut[it.senderNum] || 0) > it.ts) continue; // you already answered
        if (F.voiceToText && it.type === 'audioMessage') { await this.voice(it, S); continue; }
        if (F.autoReply && it.text && await this.autoReply(it, data, false)) continue;
        if (isAwayActive(S, this.state.status, now)) { await this.away(it, S); continue; }
        if (F.ai && it.text) aiQueue.set(it.chat, it); // one AI reply per chat, to the latest message
      } catch (e) {
        log.warn(`Could not handle a message: ${e.message}`);
      }
    }
    for (const it of aiQueue.values()) await this.ai(it, data).catch((e) => log.warn(`AI reply failed: ${e.message}`));
    for (const [chat, imgs] of this.recentImages) if (imgs.pdfRequested) { await this.makePdf(chat, imgs); this.recentImages.delete(chat); }
    mem.lastPollAt = now;
    return handled;
  }

  async reply(it, text, kind = 'reply') {
    const data = this.getData();
    const head = headerOn(data.settings.header, kind, undefined, it.contact?.header);
    await this.send(it.chat, { text: head ? `${data.settings.header.text}\n${text}` : text }, { quoted: it.msg, kind });
  }

  async autoReply(it, data, isGroup) {
    const mem = this.state.memory;
    const rule = findRule(data.rules, it.text, { isGroup, contactId: it.contact?.id, tags: it.contact?.tags || [] }, mem.cooldowns, Date.now(), it.chat);
    if (!rule) return false;
    mem.cooldowns[`${rule.id}|${it.chat}`] = Date.now();
    const text = renderTemplate(pickReply(rule, it.id), { name: it.contact?.name || it.msg.pushName || '', first_name: firstName(it.contact?.name || it.msg.pushName || ''), my_name: data.settings.myName }, it.id);
    await this.reply(it, text, 'reply');
    log.info(`Auto-reply rule "${rule.id}" answered ${isGroup ? 'a group' : maskNumber(it.senderNum)}`);
    return true;
  }

  async away(it, S) {
    const mem = this.state.memory;
    const last = mem.awaySent[it.senderNum] || 0;
    if (Date.now() - last < (S.away?.onceEveryHours ?? 6) * 3600000) return;
    mem.awaySent[it.senderNum] = Date.now();
    const msg = this.state.status.away?.on && this.state.status.away?.message ? this.state.status.away.message : S.away?.message;
    await this.reply(it, renderTemplate(msg, { name: it.contact?.name || '', first_name: firstName(it.contact?.name || '') }), 'reply');
  }

  async ai(it, data) {
    const A = data.settings.ai || {};
    const mem = this.state.memory;
    const c = it.contact;
    if (A.who === 'contacts' && !c) return;
    if (A.who === 'tags' && !(c?.tags || []).some((t) => (A.tags || []).includes(t))) return;
    if (c && (A.exclude || []).includes(c.id)) return;
    const day = localDate(Date.now(), data.settings.timezone);
    const ck = `${day}|${it.chat}`;
    mem.aiCount[ck] = (mem.aiCount[ck] || 0) + 1;
    if (mem.aiCount[ck] > (A.maxPerChatPerDay || 15)) return;
    const hist = mem.ai[it.chat] || [];
    const answer = await aiReply(A, data.settings.myName, hist.slice(-(A.memory || 8)), it.text);
    if (!answer) return;
    await this.reply(it, answer, 'ai');
    mem.ai[it.chat] = [...hist, { role: 'them', text: it.text }, { role: 'me', text: answer }].slice(-20);
    log.info(`AI replied to ${maskNumber(it.senderNum)}`);
  }

  async download(msgLike) {
    return downloadMediaMessage(msgLike, 'buffer', {}, { reuploadRequest: this.wa.sock?.updateMediaMessage, logger: undefined });
  }
  quotedMsg(it) {
    const ci = it.content?.extendedTextMessage?.contextInfo || it.content?.[it.type]?.contextInfo;
    if (!ci?.quotedMessage) return null;
    return { key: { remoteJid: it.chat, id: ci.stanzaId, participant: ci.participant, fromMe: false }, message: ci.quotedMessage };
  }

  async voice(it, S, forceTo) {
    const secs = it.content.audioMessage?.seconds || 0;
    if (secs > (S.voice?.maxSeconds || 300)) return;
    const buf = await this.download(it.msg);
    const text = await transcribe(buf);
    const who = it.contact?.name || it.msg.pushName || maskNumber(it.senderNum);
    const to = forceTo || S.voice?.sendTo || 'owner';
    if (to === 'chat') await this.reply(it, `🎤 _Transcript:_ ${text}`, 'reply');
    else await this.send(numberJid(env.ownerNumber || this.wa.me()), { text: `🎤 Voice note from *${who}* (${secs}s):\n${text}` }, { kind: 'alert' });
  }

  async saveMedia(it, S, isStatus) {
    if (!this.media || !S.features.mediaSave) return;
    if (isStatus && !S.media?.statuses) return;
    const map = { imageMessage: 'image', videoMessage: 'video', audioMessage: 'audio', documentMessage: 'document' };
    const kind = map[it.type];
    if (!kind || !(S.media?.types || []).includes(kind)) return;
    const m = it.content[it.type];
    const size = Number(m.fileLength || 0);
    if (!this.media.sizeOk(size)) return;
    const buf = await this.download(it.msg);
    await this.media.add(buf, { kind, mimetype: m.mimetype, from: isStatus ? maskNumber(jidNumber(it.msg.key.participant || '')) : (it.contact?.name || it.msg.pushName || maskNumber(it.senderNum)), chatName: it.isGroup ? 'group' : '', status: isStatus, fileName: m.fileName });
  }

  async makePdf(chat, imgs) {
    const bufs = [];
    for (const m of imgs.slice(-20)) bufs.push(await this.download(m));
    if (!bufs.length) return;
    const pdf = await imagesToPdf(bufs);
    await this.send(chat, { document: pdf, mimetype: 'application/pdf', fileName: `VR-Bot-${Date.now()}.pdf` }, { kind: 'reply' });
  }

  async command(it, S, F, isOwner) {
    const prefix = S.commands?.prefix || '!';
    const [rawCmd, ...rest] = it.text.slice(prefix.length).trim().split(/\s+/);
    const cmd = (rawCmd || '').toLowerCase();
    const arg = rest.join(' ');
    const en = S.commands?.enabled || {};
    const mem = this.state.memory;
    // owner commands (from your own phone / self chat, or from OWNER_NUMBER)
    if (isOwner) {
      if (cmd === 'away') { this.state.status.away = { on: true, message: arg || S.away?.message, at: Date.now() }; return this.reply(it, `🌙 Away mode ON${arg ? `: "${arg}"` : ''} (for 12h or until ${prefix}back)`, 'alert'); }
      if (cmd === 'back') { this.state.status.away = { on: false, at: Date.now() }; return this.reply(it, '☀️ Away mode OFF', 'alert'); }
      if (cmd === 'pause') { this.state.status.pausedByOwner = true; return this.reply(it, '⏸️ Bot paused (scheduled sends stop). Send !resume to continue.', 'alert'); }
      if (cmd === 'resume') { this.state.status.pausedByOwner = false; return this.reply(it, '▶️ Bot resumed.', 'alert'); }
      if (cmd === 'status') {
        const lr = this.state.status.lastRun;
        return this.reply(it, `✅ ${S.botName} is linked.\nLast run: ${lr ? new Date(lr.startedAt).toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : 'first run'}\nAway: ${isAwayActive(S, this.state.status, Date.now()) ? 'on' : 'off'}`, 'alert');
      }
      if (cmd === 'text') { const q = this.quotedMsg(it); if (q?.message?.audioMessage) { const text = await transcribe(await this.download(q)); return this.reply(it, `🎤 ${text}`, 'alert'); } }
    }
    if (!F.commands) return;
    const allow = S.commands?.allow || 'everyone';
    if (!isOwner && allow === 'owner') return;
    if (!isOwner && allow === 'contacts' && !it.contact) return;
    if (it.isGroup && !isOwner && S.commands?.inGroups === false) return;
    switch (cmd) {
      case 'help': return en.help !== false && this.reply(it, helpText(S, isOwner && !it.isGroup));
      case 'weather': return en.weather && this.reply(it, await weather(arg));
      case 'sticker': case 's': {
        if (!en.sticker) return;
        const src = ['imageMessage', 'videoMessage'].includes(it.type) ? it.msg : this.quotedMsg(it);
        const c = src?.message ? normalizeMessageContent(src.message) : null;
        if (!c?.imageMessage && !c?.videoMessage) return this.reply(it, `Send an image with caption ${prefix}sticker, or reply to one with ${prefix}sticker`);
        const st = await toSticker(await this.download(src), !!c.videoMessage);
        return this.send(it.chat, { sticker: st }, { quoted: it.msg, kind: 'reply' });
      }
      case 'pdf': {
        if (!en.pdf) return;
        const list = this.recentImages.get(it.chat) || [];
        const q = this.quotedMsg(it); if (q?.message?.imageMessage) list.push(q);
        if (!list.length) return this.reply(it, `Send images, then ${prefix}pdf (or add caption ${prefix}pdf on each image).`);
        list.pdfRequested = true; this.recentImages.set(it.chat, list);
        return;
      }
      case 'yt': {
        if (!en.yt) return this.reply(it, '!yt is switched off in settings.');
        try { const a = await ytAudio(arg); return this.send(it.chat, { audio: a.buffer, mimetype: a.mimetype }, { quoted: it.msg, kind: 'reply' }); }
        catch (e) { return this.reply(it, `⚠️ ${e.message}`); }
      }
      case 'tagall': {
        if (!en.tagall || !it.isGroup || !F.groupTools) return;
        const err = await this.tools().tagall(it.chat, it.senderJid, isOwner, arg);
        return err && this.reply(it, err);
      }
      case 'rules': return en.rules && it.isGroup && this.reply(it, `📜 *Group rules*\n${this.tools().rules(it.chat)}`, 'group');
      default: return null;
    }
  }

  /** Remember images per chat so "!pdf" can bundle them. */
  noteImage(it) {
    if (it.type !== 'imageMessage') return;
    const l = this.recentImages.get(it.chat) || [];
    l.push(it.msg);
    this.recentImages.set(it.chat, l.slice(-20));
  }
}
