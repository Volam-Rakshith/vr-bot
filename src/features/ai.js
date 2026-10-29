// VR Bot — AI replies "in your style" using Groq's free API. © VR DEVELOPMENTS
// Free plan (checked Oct 2026): openai/gpt-oss-120b → 30 requests/min, 1,000/day. Key: console.groq.com → API Keys.
import { env } from '../env.js';

const URL = 'https://api.groq.com/openai/v1/chat/completions';

export function buildMessages(ai, myName, history, incomingText) {
  const sys = [
    ai.stylePrompt || `You reply to WhatsApp messages as ${myName}. Keep it short and natural.`,
    'Rules: reply in 1–3 short lines like a real WhatsApp message. Match the language of the other person. No hashtags, no "As an AI". If you do not know something personal (plans, money, location), say you will reply properly later.',
  ].join('\n');
  const msgs = [{ role: 'system', content: sys }];
  for (const ex of ai.examples || []) {
    if (ex.them && ex.me) { msgs.push({ role: 'user', content: ex.them }); msgs.push({ role: 'assistant', content: ex.me }); }
  }
  for (const h of history || []) msgs.push({ role: h.role === 'me' ? 'assistant' : 'user', content: h.text });
  if (incomingText) msgs.push({ role: 'user', content: incomingText });
  return msgs;
}

export async function aiReply(ai, myName, history, incomingText) {
  if (!env.groqKey) throw new Error('GROQ_API_KEY secret is not set');
  const body = {
    model: ai.model || 'openai/gpt-oss-120b',
    messages: buildMessages(ai, myName, history, incomingText),
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
