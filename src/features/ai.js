// VR Bot — AI replies "in your style" using Groq's free API. © VR DEVELOPMENTS
// Free plan (checked Oct 2026): openai/gpt-oss-120b → 30 requests/min, 1,000/day. Key: console.groq.com → API Keys.
import { env } from '../env.js';
import { DEFAULT_SETTINGS } from '../../panel/shared/defaults.js';
import { checkLimit, noteLimit } from './groqlimit.js';

const URL = 'https://api.groq.com/openai/v1/chat/completions';

/** The facts the AI may use about you ("About you" in the panel). Missing → the default; cleared on purpose ('') → none. */
export function aboutMeOf(ai = {}) {
  return String(ai.aboutMe ?? DEFAULT_SETTINGS.ai.aboutMe ?? '').trim();
}

/**
 * opts.group: this is a group chat → the prompt says so and asks for 1–2 short lines.
 * opts.groupName / opts.from: the group's name and who wrote the new message (their name is also put
 * in front of each group message as "Name: text", so the AI can tell people apart).
 */
export function buildMessages(ai, myName, history, incomingText, opts = {}) {
  const name = String(myName || '').trim() || 'me';
  const facts = aboutMeOf(ai);
  const sys = ai.plain ? [ai.stylePrompt] : [
    ai.stylePrompt || `You reply to WhatsApp messages as ${name}. Keep it short and natural.`,
    `You are ${name}, replying on WhatsApp as yourself.`,
    facts ? `Facts about you (the ONLY true details about you):\n${facts}` : `Facts about you: only your name, ${name}.`,
    'Your name and details are ONLY what is written in the facts. Never make up a name, age, college, business, place or number. If asked something not in the facts, say you\'ll tell them later.',
    'Rules: reply in 1–3 short lines like a real WhatsApp message. Match the language of the other person. No hashtags, no "As an AI". If you do not know something personal (plans, money, location), say you will reply properly later.',
  ];
  if (!ai.plain && opts.group) {
    sys.push(`This is a WhatsApp GROUP chat${opts.groupName ? ` ("${opts.groupName}")` : ''} with several people. Messages from others start with the sender's name ("Name: message"). Reply only to the latest message, in 1–2 short lines, like a friend in the group. Never start your reply with a name and a colon.`);
  }
  const msgs = [{ role: 'system', content: sys.join('\n') }];
  for (const ex of ai.examples || []) {
    if (ex.them && ex.me) { msgs.push({ role: 'user', content: ex.them }); msgs.push({ role: 'assistant', content: ex.me }); }
  }
  for (const h of history || []) msgs.push({ role: h.role === 'me' ? 'assistant' : 'user', content: h.text });
  if (incomingText) msgs.push({ role: 'user', content: incomingText });
  return msgs;
}

export async function aiReply(ai, myName, history, incomingText, opts = {}) {
  if (!env.groqKey) throw new Error('GROQ_API_KEY secret is not set');
  checkLimit('main'); // Groq said "limit reached" earlier → no call until it resets
  const body = {
    model: ai.model || 'openai/gpt-oss-120b',
    messages: buildMessages(ai, myName, history, incomingText, opts),
    temperature: 0.7,
    max_completion_tokens: 400,
  };
  if (/gpt-oss/.test(body.model)) { body.reasoning_effort = 'low'; body.include_reasoning = false; }
  const res = await fetch(URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.groqKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  if (res.status === 429) throw noteLimit('main', res.headers, await res.text().catch(() => ''));
  if (!res.ok) throw new Error(`Groq ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = await res.json();
  return (j.choices?.[0]?.message?.content || '').trim();
}

/** Voice note → text with Groq Whisper (free plan: 20 req/min, 2,000/day, 2h audio/hour). */
export async function transcribe(buffer, filename = 'voice.ogg') {
  if (!env.groqKey) throw new Error('GROQ_API_KEY secret is not set');
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: 'audio/ogg' }), filename);
  form.append('model', 'whisper-large-v3-turbo');
  form.append('response_format', 'json');
  const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST', headers: { Authorization: `Bearer ${env.groqKey}` }, body: form, signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) throw new Error(`Groq Whisper ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return ((await res.json()).text || '').trim();
}
