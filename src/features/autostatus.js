// VR Bot — Auto status (posts your WhatsApp status on a schedule) + the weekly report text.
// © VR DEVELOPMENTS
//
// Baileys 7: sock.sendMessage('status@broadcast', { text }, { backgroundColor, font, statusJidList })
//  • statusJidList is REQUIRED — it is the list of people who receive the status. Without it nobody sees it.
//  • The real bot posts through wa.postStatus → src/statuspost.js, which checks WhatsApp's answer (a status can be
//    silently rejected) and sends pictures as JPEG.
//  • your own number is always in the list, so the status also shows on your own phone.
//  • very large lists are slow and can fail, so the list is capped (settings.autoStatus.maxPeople, default 500).
import fs from 'node:fs';
import path from 'node:path';
import { env, ROOT } from '../env.js';
import { log } from '../log.js';
import { aiReply } from './ai.js';
import { statusAudience, nextStatus, statusLook, cleanAiQuote, STATUS_JID } from '../../panel/shared/status.js';
import { describeStatusResult } from '../statuspost.js';
import { weeklyStats, weeklyText } from '../../panel/shared/report.js';
import { localDate } from '../../panel/shared/time.js';
import { maskNumber } from '../../panel/shared/defaults.js';
import { specialFor, specialCaption, specialConfig, cardFile, SPECIAL_BY_ID } from '../../panel/shared/specialdays.js';

/** The pre-made picture for a special day (committed in panel/days/), or null if it is missing. */
export function readCard(id) {
  try { return fs.readFileSync(path.join(ROOT, cardFile(id))); } catch { return null; }
}

async function freshQuote(S, mem) {
  const A = S.ai || {};
  const avoid = (mem.ai || []).slice(-10).map((x) => `- ${x}`).join('\n');
  const ask = {
    ...A, examples: [],
    stylePrompt: 'Write ONE short, original motivational line (at most 18 words) for a WhatsApp status. Fresh and real, not cheesy. No hashtags, no emojis, no quotation marks, no author name, no intro — only the line.' + (avoid ? `\nDo not repeat or reword these recent ones:\n${avoid}` : ''),
  };
  const line = cleanAiQuote(await aiReply(ask, S.myName, [], "Today's line, please."));
  if (line) mem.ai = [...(mem.ai || []), line].slice(-20);
  return line;
}

/**
 * Post the status. test = only to your own number, and the quote/text rotation is NOT used up
 * (so the test shows exactly what the next real status will look like).
 *  date        = the local day this status is for (the planned job's date; default: today in your timezone)
 *  onlySpecial = this post exists only because it is a special day (an "off" day) → skipped if that day was switched off
 *  specialId   = test one particular special-day card ("Post test now" in the panel)
 * Rules: only ONE status per day (a second call for the same date is skipped). On a special day the image card is
 * posted instead of the quote; if the picture can't be posted, a text status with the wish goes out instead.
 * Returns { label, count (people other than you), total, capped, special, fallback } or { skipped: reason }.
 */
export async function postStatus({ send, sendStatus, data, state, ownerNumber, botNumber = '', test = false, nowMs = Date.now(), date = '', onlySpecial = false, specialId = '', loadCard = readCard }) {
  const S = data.settings;
  const cfg = S.autoStatus || {};
  const memAll = state.memory;
  memAll.autoStatus = memAll.autoStatus || {};
  const mem = test ? JSON.parse(JSON.stringify(memAll.autoStatus)) : memAll.autoStatus;
  const day = date || localDate(nowMs, S.timezone || 'Asia/Kolkata');
  if (!test && mem.lastDate === day) return { skipped: `a status was already posted on ${day} (only one per day)` };
  const special = specialId ? SPECIAL_BY_ID[specialId] || null : specialFor(day, cfg);
  if (specialId && !special) throw Object.assign(new Error(`unknown special day "${specialId}"`), { permanent: true });
  if (onlySpecial && !special) return { skipped: `${day} is no longer a special day that is switched on` };
  if (!ownerNumber && test) throw Object.assign(new Error('your own number is not known yet (set the OWNER_NUMBER secret)'), { permanent: true });
  const aud = statusAudience(cfg, { contacts: data.contacts, recent: memAll.lastIn, owner: [ownerNumber, botNumber], nowMs, testOnly: test });
  // One status post. sendStatus (the real bot: wa.postStatus) waits for WhatsApp's answer and returns
  // { state: 'accepted' | 'rejected' | 'unknown', … }; without it, a plain send ("handed to WhatsApp", unverified).
  const post = async (content, look = {}) => {
    const r = sendStatus
      ? await sendStatus(content, { numbers: aud.numbers, look })
      : (await send(STATUS_JID, content, { ...look, statusJidList: aud.jids, kind: 'status' }), { state: 'sent' });
    if (r?.state === 'rejected') throw Object.assign(new Error(describeStatusResult(r)), { permanent: true, result: r });
    return r;
  };
  if (!test && aud.nobody) throw Object.assign(new Error('nobody would see it: add people in Contacts, or change "Who sees it" in Auto status'), { permanent: true });
  if (aud.capped) log.warn(`Auto status: ${aud.total} people picked, sending to the first ${aud.numbers.length} only (safety cap)`);
  const out = (label, result, extra = {}) => {
    if (!test) mem.lastDate = day;
    return { label, count: aud.numbers.length - aud.self, total: aud.total - aud.self, capped: aud.capped, result, delivery: describeStatusResult(result), ...extra };
  };

  if (special) {
    const caption = specialCaption(special, specialConfig(cfg));
    const img = loadCard(special.id);
    if (img) {
      try {
        const r = await post({ image: img, caption });
        return out(`special day: ${special.name}`, r, { special: special.id });
      } catch (e) {
        log.warn(`Special-day picture could not be posted (${e.message}) — posting the wish as a text status instead`);
      }
    } else log.warn(`Special-day picture for "${special.id}" is missing — posting the wish as a text status instead`);
    const r = await post({ text: caption }, statusLook(cfg, mem));
    return out(`special day: ${special.name} (text, picture failed)`, r, { special: special.id, fallback: true });
  }

  let aiText = '';
  if ((cfg.mode || 'quote') === 'quote' && cfg.aiFresh && env.groqKey) {
    try { aiText = await freshQuote(S, mem); } catch (e) { log.warn(`AI quote failed, using the built-in list: ${e.message}`); }
  }
  const next = nextStatus(cfg, mem, { aiText });
  const r = await post(next.content, next.options);
  return out(next.label, r);
}

/** Weekly report for the 7 days ending today. Counts only — no message text exists to show. */
export function weeklyReportText(data, state, nowMs = Date.now()) {
  const tz = data.settings.timezone;
  const groupNames = Object.fromEntries((state.status.groups || []).map((g) => [g.id, g.name]));
  return weeklyText(weeklyStats(state.status.weekly || {}, localDate(nowMs, tz), { groupNames, maskNumber }));
}
