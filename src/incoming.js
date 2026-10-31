// VR Bot — handles messages that arrived (while offline or during a run).
// Auto-reply, AI, away, commands, group tools, voice→text, media save, follow-up tracking.
// NOTE: GitHub Actions is not always-on, so these "instant" features reply on the next run
// (up to ~30 minutes later) — or live, if a run happens to be connected at that moment.
// © VR DEVELOPMENTS
import { getContentType, downloadMediaMessage, normalizeMessageContent, WAMessageStubType } from 'baileys';
import { findRule, matchRule, pickReply, inScope, featureScope, pickReaction, REACTIONS, messageKind, shouldRespond, noiseText } from '../panel/shared/rules.js';
import { parseBusy, busyNow, modeNow, busyText, busyTimeText, modeTimeText, modeScopeCfg, MODES, MODE_KEYS } from '../panel/shared/busy.js';
import { recordWeekly } from '../panel/shared/report.js';
import { renderTemplate, firstName, headerOn } from '../panel/shared/templates.js';
import { localDate, localTime, inDailyWindow } from '../panel/shared/time.js';
import { normalizeNumber, maskNumber } from '../panel/shared/defaults.js';
import { parseNoteCommand, notesListText, messageNoteText, isForwardedContent, notePreview, NOTES_LIMITS } from '../panel/shared/notes.js';
import { voicePlan, ruleCooldown, pttContent, parseVoiceCommand, voiceListText, voiceLabel, fmtSecs, fmtSize, VOICE_LIMITS } from '../panel/shared/voice.js';
import { isJidGroup, jidNumber, numberJid } from './wa.js';
import { log } from './log.js';
import { aiReply, transcribe } from './features/ai.js';
import { weather, toSticker, imagesToPdf, ytAudio, helpText } from './features/commands.js';
import { GroupTools } from './features/groups.js';
import { env } from './env.js';

// Reactions, deleted/edited messages and other system messages are never answered. Stickers, GIFs,
// polls and media without text are not answered by replies/AI/busy either (see shouldRespond).
const IGNORE = new Set(['protocolMessage', 'reactionMessage', 'senderKeyDistributionMessage', 'messageContextInfo', 'pollUpdateMessage', 'keepInChatMessage', 'pinInChatMessage', 'encReactionMessage', 'editedMessage']);
/** Everything after "!cmd", keeping line breaks (for !note). */
const rawArg = (text, prefix) => String(text || '').slice(prefix.length).replace(/^\s*\S+[ \t]*/, '').replace(/^\n+/, '').trim();
const textOf = (c) => c?.conversation || c?.extendedTextMessage?.text || c?.imageMessage?.caption || c?.videoMessage?.caption || c?.documentMessage?.caption || '';

export function isAwayActive(settings, status, nowMs) {
  const o = status.away;
  if (o && nowMs - (o.at || 0) < 12 * 3600000) return !!o.on; // !away / !back from WhatsApp wins for 12h
  if (!settings.features?.away) return false;
  const w = settings.away?.window;
  if (!w?.enabled) return true; // feature on, no window → always away
  return inDailyWindow(localTime(nowMs, settings.timezone), w.from, w.to);
}

/** Who/where a message came from, for the per-chat controls (panel/shared/rules.js → inScope). */
function scopeCtx(it) {
  return { isGroup: !!it.isGroup, groupId: it.isGroup ? it.chat : undefined, contactId: it.contact?.id, tags: it.contact?.tags || [] };
}

export class Incoming {
  constructor({ wa, getData, state, send, media, notifier = null, voices = null, notes = null }) {
    this.wa = wa; this.getData = getData; this.state = state; this.send = send; this.media = media; this.notifier = notifier; this.voices = voices; this.notes = notes;
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
      it.kind = messageKind(content, type); // message | sticker | gif | reaction | protocol | poll | vote | empty
      if (it.status) {
        it.senderNum = await this.wa.pnFor(msg.key.participant || '', msg.key.participantAlt);
        it.contact = contactsByNum.get(it.senderNum) || null;
        items.push(it); continue;
      }
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
        // weekly report: one more message from this chat today (counts only — never the text)
        if (['message', 'sticker', 'gif', 'poll'].includes(it.kind) && k) {
          this.state.status.weekly = this.state.status.weekly || {};
          recordWeekly(this.state.status.weekly, { key: k, name: nm, isGroup, ts, tz: S.timezone });
        }
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
        if (it.status) { if (inScope(featureScope(S, 'media'), scopeCtx(it))) await this.saveMedia(it, S, true); continue; }
        // group "joined" system messages → welcome
        if (it.isGroup && F.groupTools && [WAMessageStubType.GROUP_PARTICIPANT_ADD, WAMessageStubType.GROUP_PARTICIPANT_INVITE, WAMessageStubType.GROUP_PARTICIPANT_ACCEPT].includes(it.msg.messageStubType)) {
          if (now - it.ts < maxAge) await this.participants({ id: it.chat, action: 'add', participants: it.msg.messageStubParameters || [] });
          continue;
        }
        if (!it.type || IGNORE.has(it.type)) continue;
        const fresh = now - it.ts < maxAge;
        const prefix = S.commands?.prefix || '!';
        const isCmd = it.text.startsWith(prefix);
        const isOwner = it.fromMe || (owner && it.senderNum === owner);
        // Every feature below only acts in the chats/groups picked for it in the panel (see inScope).
        const sc = scopeCtx(it);
        if (F.commands && (isOwner || inScope(featureScope(S, 'commands'), sc))) this.noteImage(it);

        if (!it.fromMe && F.mediaSave && S.media?.chats && inScope(featureScope(S, 'media'), sc)) await this.saveMedia(it, S, false);

        if (it.fromMe) {
          if (isCmd && fresh) await this.command(it, S, F, true);
          continue;
        }
        if (!fresh) continue;
        if (isCmd && F.commands && (it.kind === 'message' || it.kind === 'gif')) { await this.command(it, S, F, isOwner); continue; }
        // Stickers, GIFs, polls and photos/videos without text get no reply, unless
        // Replies → "Also respond to stickers & GIFs" is on (then stickers & GIFs count as messages).
        const canReply = shouldRespond(it, { stickers: !!S.replies?.stickers });
        it.aiText = it.kind === 'message' ? it.text : noiseText(it);
        const busy = modeNow(S, this.state.status, now); // busy or class mode (only one is on at a time)
        if (it.isGroup) {
          if (F.groupTools && it.text) await this.tools().antiLink(it.msg, it.text, it.chat, it.senderJid).catch((e) => log.warn(`anti-link: ${e.message}`));
          if (canReply && busy.active && await this.busyReply(it, S, busy, true)) continue;
          if (F.autoReply && canReply && it.text && await this.autoReply(it, data, true)) continue;
          if (F.ai && canReply && it.aiText && inScope(featureScope(S, 'ai'), sc) && this.talksToMe(it)) aiQueue.set(it.chat, it); // picked groups: only when @mentioned / replied to
          continue;
        }
        // private chat
        if (S.replies?.skipIfIReplied !== false && (mem.lastOut[it.senderNum] || 0) > it.ts) continue; // you already answered
        if (F.voiceToText && it.type === 'audioMessage' && inScope(featureScope(S, 'voice'), sc)) { await this.voice(it, S); continue; }
        if (canReply && busy.active && await this.busyReply(it, S, busy, false)) continue;
        if (F.autoReply && canReply && it.text && await this.autoReply(it, data, false)) continue;
        if ((it.kind === 'message' || canReply) && isAwayActive(S, this.state.status, now) && inScope(featureScope(S, 'away'), sc)) { await this.away(it, S); continue; }
        if (F.ai && canReply && it.aiText && inScope(featureScope(S, 'ai'), sc)) aiQueue.set(it.chat, it); // one AI reply per chat, to the latest message
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
    await this.send(it.chat, { text: head ? `${data.settings.header.text}\n${text}` : text }, { quoted: it.msg, kind, cat: kind === 'ai' ? 'ai' : 'replies', to: this.whoOf(it) });
  }

  /** Who this chat is, for the Sent log / notifications: contact name → group name → WhatsApp name → number. */
  whoOf(it) {
    if (it.selfChat) return { self: true };
    if (it.isGroup) return { name: (this.state.status.groups || []).find((g) => g.id === it.chat)?.name || 'a group' };
    return { name: it.contact?.name || it.msg?.pushName || '', number: it.senderNum || '' };
  }

  /** Did this group message @mention me or reply to one of my messages? */
  talksToMe(it) {
    const ci = it.content?.[it.type]?.contextInfo || it.content?.extendedTextMessage?.contextInfo || {};
    if ((ci.mentionedJid || []).some((j) => this.wa.isMe(j))) return true;
    return !!ci.participant && !!ci.quotedMessage && this.wa.isMe(ci.participant);
  }

  /** Put an emoji reaction on the incoming message. */
  async react(it, emoji) {
    if (!emoji) return;
    await this.send(it.chat, { react: { text: emoji, key: it.msg.key } }, { kind: 'reply', cat: 'replies', to: this.whoOf(it) });
  }

  async autoReply(it, data, isGroup) {
    const mem = this.state.memory;
    mem.voiceSent = mem.voiceSent || {};
    const ctx = { ...scopeCtx(it), isGroup };
    const now = Date.now();
    // a voice rule also waits if the SAME clip went to this chat recently (another rule may use it too)
    const clipOk = (rule) => {
      const v = voicePlan(rule);
      if (!v.voice) return true;
      const c = this.voices?.find(v.ref);
      return !c || now - (mem.voiceSent[`${c.id}|${it.chat}`] || 0) >= ruleCooldown(rule) * 60000;
    };
    const { rule, cooling } = matchRule(data.rules, it.text, ctx, mem.cooldowns, now, it.chat, clipOk);
    if (!rule) {
      // A keyword rule matched but is waiting for its cooldown: it still owns this message, so no AI/away reply.
      if (cooling) { log.info(`Auto-reply rule "${cooling.id}" matched but is cooling down — no reply`); return true; }
      return false;
    }
    const plan = voicePlan(rule);
    const text = plan.text ? renderTemplate(pickReply(rule, it.id), { name: it.contact?.name || it.msg.pushName || '', first_name: firstName(it.contact?.name || it.msg.pushName || ''), my_name: data.settings.myName }, it.id) : '';
    let clip = null;
    if (plan.voice) {
      clip = await this.voices?.get(plan.ref).catch((e) => { log.warn(`Voice clip could not be loaded: ${e.message}`); return null; });
      if (!clip) {
        log.warn(`Auto-reply rule "${rule.id}": its voice clip is missing or not ready`);
        if (!text.trim() && !rule.react) return false; // nothing else to send → let the next feature (AI/away) answer
      }
    }
    mem.cooldowns[`${rule.id}|${it.chat}`] = now;
    if (rule.react) await this.react(it, String(rule.react).trim());
    if (clip) {
      await this.sendClip(it.chat, clip, { kind: 'voice', cat: 'replies', to: this.whoOf(it) });
      mem.voiceSent[`${clip.meta.id}|${it.chat}`] = now;
    }
    if (text.trim()) await this.reply(it, text, 'reply');
    log.info(`Auto-reply rule "${rule.id}" ${clip ? 'sent a voice clip to' : text.trim() ? 'answered' : 'reacted to'} ${isGroup ? 'a group' : maskNumber(it.senderNum)}`);
    return true;
  }

  /** Send a voice clip as a real voice note: no caption, no header, not quoted — like you recorded it just now. */
  async sendClip(jid, clip, { kind = 'voice', cat = 'replies', to = {} } = {}) {
    return this.send(jid, pttContent(clip.audio, clip.meta), { kind, cat, to, label: voiceLabel(clip.meta.name), clip: clip.meta.name });
  }

  async voiceCommand(it, arg, prefix) {
    const { sub, name } = parseVoiceCommand(arg);
    const lib = this.voices;
    const help = `🎙️ *Voice clips*\n${prefix}voice save <name> — reply to a voice note (or audio file) with this\n${prefix}voice list\n${prefix}voice play <name> — sends it here\n${prefix}voice delete <name>\nMax ${VOICE_LIMITS.maxSeconds} s each. Use them in the panel → Replies (keyword rules) or Schedules.`;
    if (!lib) return this.reply(it, '⚠️ Voice clips are not available in this run.', 'alert');
    if (sub === 'help') return this.reply(it, help, 'alert');
    if (sub === 'list') { await lib.refresh(); return this.reply(it, voiceListText(lib.list(), prefix), 'alert'); }
    if (!name) return this.reply(it, `Give the clip a name, e.g. ${prefix}voice ${sub} good morning`, 'alert');
    if (sub === 'save') {
      const q = this.quotedMsg(it);
      const c = q?.message ? normalizeMessageContent(q.message) : null;
      const a = c?.audioMessage || (c?.documentMessage && /^audio\//.test(c.documentMessage.mimetype || '') ? c.documentMessage : null);
      if (!a) return this.reply(it, `Reply to a voice note (or an audio file) with ${prefix}voice save ${name}`, 'alert');
      if ((a.seconds || 0) > VOICE_LIMITS.maxSeconds) return this.reply(it, `⚠️ That one is ${a.seconds} s. Voice clips can be max ${VOICE_LIMITS.maxSeconds} s.`, 'alert');
      try {
        const buf = await this.download(q);
        const wf = a.waveform && a.waveform.length ? Array.from(a.waveform) : null;
        const { meta, replaced } = await lib.save(name, buf, { secs: a.seconds || 0, waveform: wf, by: 'whatsapp' });
        return this.reply(it, `✅ Voice clip "${meta.name}" ${replaced ? 'replaced' : 'saved'} (${fmtSecs(meta.secs)} · ${fmtSize(meta.size)}, encrypted).\nUse it in the panel → Replies → a rule → Reply with: Voice clip.`, 'alert');
      } catch (e) { return this.reply(it, `⚠️ Could not save the clip: ${e.message}`, 'alert'); }
    }
    if (sub === 'delete') {
      try {
        const m = await lib.remove({ name });
        return this.reply(it, m ? `🗑️ Deleted voice clip "${m.name}". Rules that used it send nothing until you pick another clip.` : `No clip called "${name}". Send ${prefix}voice list`, 'alert');
      } catch (e) { return this.reply(it, `⚠️ Could not delete: ${e.message}`, 'alert'); }
    }
    if (sub === 'play') {
      await lib.refresh({ convert: false });
      const clip = await lib.get({ name }).catch(() => null);
      if (!clip) return this.reply(it, lib.find({ name }) ? `⏳ "${name}" is still being converted — try again in a few minutes.` : `No clip called "${name}". Send ${prefix}voice list`, 'alert');
      return this.sendClip(it.chat, clip, { kind: 'voice', cat: 'replies', to: this.whoOf(it) });
    }
    return null;
  }

  /**
   * 📝 "!note <text>" / reply "!note" to any message / "!notes" / "!note delete <n>" — your own notes, saved encrypted
   * on the vr-notes branch (panel → More → Notes). Answers only ever go to YOUR chat: "!note" typed as a reply inside
   * someone else's chat still saves the note, and the ✅ comes to your own chat (nothing more is sent to them).
   */
  async noteCommand(it, S, cmd, arg, prefix) {
    const answer = (text) => (it.selfChat || !it.fromMe
      ? this.reply(it, text, 'alert')
      : this.send(numberJid(this.wa.me()), { text }, { kind: 'alert', to: { self: true } }));
    const book = this.notes;
    if (!book) return answer('⚠️ Notes are not available in this run.');
    const p = parseNoteCommand(cmd, arg);
    const tz = S.timezone || 'Asia/Kolkata';
    const fmt = (ms) => `${localDate(ms, tz).slice(8, 10)}/${localDate(ms, tz).slice(5, 7)} ${localTime(ms, tz)}`;
    try {
      if (p.sub === 'help') return answer(`📝 *Notes*\n${prefix}note buy charger — save a note\nReply ${prefix}note to any message, link or forward — saves it (+ who sent it)\n${prefix}notes — your last ${NOTES_LIMITS.listCount}\n${prefix}notes cricket — search\n${prefix}note delete 3 — delete note 3 of ${prefix}notes\nAll notes: panel → More → Notes`);
      if (p.sub === 'list') return answer(notesListText(await book.refresh(), { prefix, page: p.page, fmt }));
      if (p.sub === 'find') return answer(notesListText(await book.refresh(), { prefix, q: p.q, fmt }));
      if (p.sub === 'delete') {
        if (!p.n) return answer(`Which one? Send ${prefix}notes, then ${prefix}note delete <number>`);
        const gone = await book.removeAt(p.n);
        return answer(gone ? `🗑️ Deleted note ${p.n}: "${notePreview(gone, 60)}"` : `No note ${p.n}. Send ${prefix}notes to see the numbers.`);
      }
      // add: your own text, else the message you replied to
      const fields = { by: 'whatsapp', from: 'me', kind: 'text' };
      const q = this.quotedMsg(it);
      if (q?.message) {
        const c = normalizeMessageContent(q.message);
        const got = messageNoteText(c);
        const ci = it.content?.extendedTextMessage?.contextInfo || it.content?.[it.type]?.contextInfo || {};
        const pj = ci.participant || (it.isGroup ? '' : it.chat);
        const num = pj ? await this.wa.pnFor(pj).catch(() => jidNumber(pj)) : '';
        const mine = !num || num === this.wa.me() || this.wa.isMe(pj);
        const contact = num ? this.getData().contacts.find((x) => normalizeNumber(x.number) === num) : null;
        fields.kind = got.kind || 'text';
        fields.forwarded = isForwardedContent(c);
        fields.from = mine ? (fields.forwarded ? 'forwarded' : 'me') : (contact?.name || `+${num}`);
        if (!mine) fields.fromNum = num;
        if (it.isGroup) fields.chat = (this.state.status.groups || []).find((g) => g.id === it.chat)?.name || 'a group';
        fields.text = [arg, got.text].filter(Boolean).join('\n\n'); // "!note for exam" as a reply = your words + the message
        if (!got.text && !arg) return answer('⚠️ That message has no text I can save.');
      } else {
        fields.text = arg;
        if (it.type === 'imageMessage' || it.type === 'videoMessage') fields.kind = it.type === 'imageMessage' ? 'image' : 'video';
        else if (/https?:\/\/|www\./i.test(arg)) fields.kind = 'link';
      }
      if (!fields.text.trim()) return answer(`📝 Type the note after the command: ${prefix}note buy charger\nOr reply ${prefix}note to any message to save it. ${prefix}notes shows them.`);
      const n = await book.add(fields);
      const who = n.from && !['me', 'forwarded'].includes(n.from) ? ` (from ${n.from})` : n.from === 'forwarded' ? ' (forwarded)' : '';
      return answer(`📝 Saved${who}: "${notePreview(n, 60)}"\nYou have ${book.list().length} note${book.list().length === 1 ? '' : 's'} · ${prefix}notes to see them`);
    } catch (e) {
      log.warn(`!note failed: ${e.message}`);
      return answer(`⚠️ Could not ${p.sub === 'delete' ? 'delete' : p.sub === 'add' ? 'save' : 'load'} the note: ${e.message}`);
    }
  }

  /** A message to you (your own chat), with the alert header if that is switched on. */
  async toOwner(text, { report = false, title = 'report' } = {}) {
    if (report && this.notifier && !this.notifier.selfReports()) { this.notifier.report(text, title); return; } // → phone notification
    const n = env.ownerNumber || this.wa.me();
    if (!n) return;
    const S = this.getData().settings;
    const head = headerOn(S.header, 'alert');
    await this.send(numberJid(n), { text: head ? `${S.header.text}\n${text}` : text }, { kind: 'alert', to: { self: true } });
  }

  /** This busy/class session's bookkeeping (which chats already got the reply). Lives in status, no text. */
  busyRun(busy) {
    const st = this.state.status;
    if (!st.busyRun || st.busyRun.id !== busy.id) st.busyRun = { id: busy.id, mode: busy.mode || 'busy', until: busy.until, source: busy.source, chats: [], n: 0, ended: false };
    return st.busyRun;
  }

  /** Busy / class mode: reply ONCE per chat per session, only in the chats/groups picked for it. */
  async busyReply(it, S, busy, isGroup) {
    const mode = busy.mode || 'busy';
    if (!inScope(featureScope(S, mode), scopeCtx(it))) return false;
    if (isGroup && modeScopeCfg(S, mode).groupsOnlyWhenTagged !== false && !this.talksToMe(it)) return false;
    const run = this.busyRun(busy);
    if (run.chats.includes(it.chat)) return false;
    run.chats.push(it.chat); run.n = (run.n || 0) + 1;
    await this.reply(it, busyText(busy.message, busy.until, Date.now(), S.timezone, mode), mode === 'busy' ? 'reply' : mode);
    log.info(`${MODES[mode].name} reply sent to ${isGroup ? 'a group' : maskNumber(it.senderNum)}`);
    return true;
  }

  /** Called often by the runner: starts the busy/class session, and when the time is up turns it off and tells you. */
  async busyTick() {
    const S = this.getData().settings, st = this.state.status, now = Date.now();
    const b = modeNow(S, st, now);
    if (b.active) { this.busyRun(b); return; }
    const run = st.busyRun;
    if (!run || run.ended) return;
    run.ended = true;
    const mode = MODES[run.mode] ? run.mode : 'busy';
    if (run.id !== busyNow(S, st, now, mode).id || run.quiet) return; // switched off by you (panel, !free, !busy off) — nothing to report
    const n = run.n || 0, M = MODES[mode], w = mode;
    await this.toOwner(`${M.icon} ${M.name} mode is off now, your time is up.\n${n ? `${n} chat${n > 1 ? 's' : ''} got your ${w} reply.` : `Nobody needed the ${w} reply.`}`, { report: true, title: `${w} mode` }).catch((e) => log.warn(`${w} notice: ${e.message}`));
    log.info(`${M.name} mode ended (time is up)`);
  }

  /** "!busy 2h" / "!busy until 5pm" / "!busy off" from your own number. */
  async busyCommand(it, S, arg) { return this.modeCommand(it, S, arg, 'busy'); }

  /**
   * "!busy …", "!class …" and "!free" (mode null = off). Only one mode is on at a time: turning one on turns
   * the other off; any "off" (!free, !busy off, !class off) turns off whichever is on.
   */
  async modeCommand(it, S, arg, mode) {
    const st = this.state.status, now = Date.now(), tz = S.timezone, pre = S.commands?.prefix || '!';
    const p = mode ? parseBusy(arg, now, tz, `${pre}${mode}`) : { off: true };
    if (p.error) return this.reply(it, `⚠️ ${p.error}`, 'alert');
    // Every switch gets a strictly newer stamp than the last one, so two commands in the same millisecond can never
    // share a session id (that would reuse the old session's "already replied" list).
    const at = Math.max(now, ...MODE_KEYS.map((m) => (Number(st[m]?.at) || 0) + 1));
    if (p.off) {
      const was = modeNow(S, st, now);
      if (st.busyRun && !st.busyRun.ended) { st.busyRun.quiet = true; st.busyRun.ended = true; }
      for (const m of MODE_KEYS) st[m] = { on: false, until: 0, at };
      const n = was.active && st.busyRun?.id === was.id ? st.busyRun.n : 0;
      if (!was.active) return this.reply(it, mode ? `☀️ ${MODES[mode].name} mode was already off.` : '☀️ Busy and class mode are already off.', 'alert');
      return this.reply(it, `☀️ ${MODES[was.mode].name} mode OFF.${n ? ` ${n} chat${n > 1 ? 's' : ''} got your ${was.mode} reply.` : ''}`, 'alert');
    }
    if (st.busyRun && !st.busyRun.ended) st.busyRun.quiet = true; // replaced by the new one, no "time is up" for the old
    const replaced = [];
    for (const m of MODE_KEYS) if (m !== mode && busyNow(S, st, now, m).active) { st[m] = { on: false, until: 0, at }; replaced.push(MODES[m].name.toLowerCase()); }
    st[mode] = { on: true, until: p.until, at };
    const sc = featureScope(S, mode);
    const people = sc.who === 'pick' ? (sc.contacts.length + sc.tags.length) : sc.who === 'nobody' ? 0 : -1;
    const groups = Array.isArray(sc.groups) ? sc.groups.length : 0;
    const where = people === 0 && !groups
      ? `⚠️ No chats picked yet, so nobody gets the ${mode} reply. Pick chats in the panel → Replies → ${mode === 'class' && (!S.class?.who || S.class.who === 'same') ? 'Busy mode (class uses the same chats)' : `${MODES[mode].name} mode`}.`
      : `${MODES[mode].name} reply goes to ${people < 0 ? 'everyone allowed' : `${people} picked ${people === 1 ? 'person/list' : 'people/lists'}`}${groups ? ` + ${groups} group${groups > 1 ? 's' : ''}` : ''}, once per chat.`;
    const off = replaced.length ? ` (${replaced.join(' & ')} mode switched off)` : '';
    if (mode === 'class') return this.reply(it, `🎓 Class mode on till ${modeTimeText('class', p.until, now, tz)} ✅${off}\n${where}\nTurns off by itself. Send ${pre}free to stop early.`, 'alert');
    return this.reply(it, `🔕 Busy mode ON until ${busyTimeText(p.until, now, tz)}.${off}\n${where}\nTurns off by itself. Send ${pre}busy off (or ${pre}free) to stop early.`, 'alert');
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
    if (!inScope(featureScope(data.settings, 'ai'), scopeCtx(it))) return; // safety net: never outside the picked chats
    const day = localDate(Date.now(), data.settings.timezone);
    const ck = `${day}|${it.chat}`;
    mem.aiCount[ck] = (mem.aiCount[ck] || 0) + 1;
    if (mem.aiCount[ck] > (A.maxPerChatPerDay || 15)) return;
    const hist = mem.ai[it.chat] || [];
    if (A.react) {
      // Optional: let the AI pick one fitting reaction (or none). Any failure (no key, Groq down) is silent.
      const ask = { ...A, examples: [], plain: true, stylePrompt: `Pick ONE emoji reaction ${data.settings.myName} would put on this WhatsApp message. Allowed: ${REACTIONS.join(' ')}. Answer with only that emoji, or the word none if no reaction fits.` };
      const emoji = pickReaction(await aiReply(ask, data.settings.myName, [], it.aiText || it.text).catch(() => ''));
      await this.react(it, emoji).catch(() => {});
    }
    const said = it.aiText || it.text;
    const answer = await aiReply(A, data.settings.myName, hist.slice(-(A.memory || 8)), said);
    if (!answer) return;
    await this.reply(it, answer, 'ai');
    mem.ai[it.chat] = [...hist, { role: 'them', text: said }, { role: 'me', text: answer }].slice(-20);
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
    else {
      const note = `🎤 Voice note from *${who}* (${secs}s):\n${text}`;
      if (this.notifier && !this.notifier.selfReports()) this.notifier.report(note, `voice note · ${who}`); // → phone notification
      else await this.send(numberJid(env.ownerNumber || this.wa.me()), { text: note }, { kind: 'alert', to: { self: true } });
    }
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
    await this.send(chat, { document: pdf, mimetype: 'application/pdf', fileName: `VR-Bot-${Date.now()}.pdf` }, { kind: 'reply', cat: 'replies' });
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
      if (cmd === 'busy') return this.busyCommand(it, S, arg);
      if (cmd === 'class') return this.modeCommand(it, S, arg, 'class');
      if (cmd === 'free') return this.modeCommand(it, S, '', null);
      if (cmd === 'resume') { this.state.status.pausedByOwner = false; return this.reply(it, '▶️ Bot resumed.', 'alert'); }
      if (cmd === 'status') {
        const lr = this.state.status.lastRun;
        return this.reply(it, `✅ ${S.botName} is linked.\nLast run: ${lr ? new Date(lr.startedAt).toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : 'first run'}\nAway: ${isAwayActive(S, this.state.status, Date.now()) ? 'on' : 'off'}\nBusy: ${(() => { const b = busyNow(S, this.state.status, Date.now()); return b.active ? `on until ${busyTimeText(b.until, Date.now(), S.timezone)}` : 'off'; })()}\nClass: ${(() => { const b = busyNow(S, this.state.status, Date.now(), 'class'); return b.active ? `on till ${modeTimeText('class', b.until, Date.now(), S.timezone)}` : 'off'; })()}`, 'alert');
      }
      if (cmd === 'voice' || cmd === 'clip') return this.voiceCommand(it, arg, prefix);
      if (cmd === 'note' || cmd === 'notes') return this.noteCommand(it, S, cmd, rawArg(it.text, prefix), prefix);
      if (cmd === 'text') { const q = this.quotedMsg(it); if (q?.message?.audioMessage) { const text = await transcribe(await this.download(q)); return this.reply(it, `🎤 ${text}`, 'alert'); } }
    }
    if (!F.commands) return;
    if (!isOwner && !inScope(featureScope(S, 'commands'), scopeCtx(it))) return; // only me + the people/groups picked in Settings
    switch (cmd) {
      case 'help': return en.help !== false && this.reply(it, helpText(S, isOwner && !it.isGroup));
      case 'weather': return en.weather && this.reply(it, await weather(arg));
      case 'sticker': case 's': {
        if (!en.sticker) return;
        const src = ['imageMessage', 'videoMessage'].includes(it.type) ? it.msg : this.quotedMsg(it);
        const c = src?.message ? normalizeMessageContent(src.message) : null;
        if (!c?.imageMessage && !c?.videoMessage) return this.reply(it, `Send an image with caption ${prefix}sticker, or reply to one with ${prefix}sticker`);
        const st = await toSticker(await this.download(src), !!c.videoMessage);
        return this.send(it.chat, { sticker: st }, { quoted: it.msg, kind: 'reply', cat: 'replies', to: this.whoOf(it) });
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
        try { const a = await ytAudio(arg); return this.send(it.chat, { audio: a.buffer, mimetype: a.mimetype }, { quoted: it.msg, kind: 'reply', cat: 'replies', to: this.whoOf(it) }); }
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
