// VR Bot — 😈 Troll mode: send one sentence N times into a chat (owner only).
//   !troll <count> <text>                     → into the chat where you type it
//   !troll @<group or contact name> <count> <text>  → into that group/contact (works from your own chat)
//   !troll stop                               → stops a running burst
// Panel: More → 😈 Troll mode (writes a one-shot job the bot picks up on its next check).
// Safety rails so WhatsApp doesn't ban the number: max 50 per burst, 1.2–2.5 s random gap,
// stop on the first send error, max 3 bursts per 10 minutes. Plain text, no header. © VR DEVELOPMENTS

export const TROLL_LIMITS = { maxCount: 50, minGapMs: 1200, maxGapMs: 2500, maxBursts: 3, windowMs: 10 * 60000, jobMaxAgeMs: 30 * 60000 };

/** Count → { count (1–50), capped } */
export function clampCount(n) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v < 1) return { count: 0, capped: false };
  return v > TROLL_LIMITS.maxCount ? { count: TROLL_LIMITS.maxCount, capped: true } : { count: v, capped: false };
}

/**
 * "!troll …" arguments (everything after the command, line breaks kept).
 * → { stop } | { target: 'name' | null, count, capped, text } | { error }
 */
export function parseTroll(arg) {
  const a = String(arg || '').trim();
  if (/^(stop|off|cancel)$/i.test(a)) return { stop: true };
  let target = null, rest = a;
  if (a.startsWith('@')) {
    const m = a.match(/^@(.+?)\s+(\d+)\s+([\s\S]+)$/);
    if (!m) return { error: 'usage' };
    target = m[1].trim(); rest = `${m[2]} ${m[3]}`;
  }
  const m = rest.match(/^(\d+)\s+([\s\S]+)$/);
  if (!m || !m[2].trim()) return { error: 'usage' };
  const { count, capped } = clampCount(m[1]);
  if (!count) return { error: 'usage' };
  return { target, count, capped, text: m[2].trim() };
}

/**
 * A group or contact by name (case-insensitive). Exact name wins; otherwise "contains".
 * groups: [{ id, name }], contacts: [{ id, name, number }] → { to } | { matches: [names] } | { none: true }
 */
export function resolveTarget(name, { groups = [], contacts = [] } = {}) {
  const q = String(name || '').trim().toLowerCase();
  if (!q) return { none: true };
  const all = [
    ...groups.filter((g) => g?.id && g?.name).map((g) => ({ type: 'group', id: g.id, name: g.name })),
    ...contacts.filter((c) => c?.name && c?.number).map((c) => ({ type: 'contact', id: c.id, name: c.name, number: c.number })),
  ];
  const exact = all.filter((x) => x.name.trim().toLowerCase() === q);
  const hits = exact.length ? exact : all.filter((x) => x.name.toLowerCase().includes(q));
  if (hits.length === 1) return { to: hits[0] };
  if (hits.length > 1) return { matches: hits.map((x) => `${x.type === 'group' ? '👥' : '👤'} ${x.name}`) };
  return { none: true };
}

export const usageText = (p = '!') => `😈 *Troll mode*\n${p}troll <count> <text> — type it IN the chat to troll\n${p}troll @<group or contact name> <count> <text> — from anywhere\n${p}troll stop — stop it\nMax ${TROLL_LIMITS.maxCount} per burst, ${TROLL_LIMITS.maxBursts} bursts per 10 min.`;

const realSleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Runs bursts one at a time. send(jid, text) must throw on failure. mem = state.memory (burst times). */
export class Troll {
  constructor({ send, mem, sleep = realSleep, rand = Math.random, now = () => Date.now() }) {
    this.sendText = send; this.mem = mem; this.sleep = sleep; this.rand = rand; this.now = now;
    this.current = null; this.stopped = false;
  }
  get running() { return !!this.current; }
  /** Bursts started in the last 10 minutes (kept in memory so it holds across runs). */
  recent() {
    const t = this.now();
    this.mem.trollBursts = (this.mem.trollBursts || []).filter((x) => t - x < TROLL_LIMITS.windowMs);
    return this.mem.trollBursts;
  }
  /** → { ok, done: Promise<{ sent, count, stopped, error }> } | { error: 'busy' | 'rate', waitMs } */
  start(jid, text, count) {
    if (this.current) return { error: 'busy' };
    const r = this.recent();
    if (r.length >= TROLL_LIMITS.maxBursts) return { error: 'rate', waitMs: TROLL_LIMITS.windowMs - (this.now() - r[0]) };
    r.push(this.now());
    this.stopped = false;
    const n = clampCount(count).count;
    const done = (async () => {
      let sent = 0, error = null;
      for (let i = 0; i < n; i++) {
        if (this.stopped) break;
        try { await this.sendText(jid, text); sent++; } catch (e) { error = e.message || String(e); break; } // stop on any error
        if (i < n - 1 && !this.stopped) await this.sleep(TROLL_LIMITS.minGapMs + Math.floor(this.rand() * (TROLL_LIMITS.maxGapMs - TROLL_LIMITS.minGapMs)));
      }
      return { sent, count: n, stopped: this.stopped && sent < n, error };
    })().finally(() => { this.current = null; });
    this.current = done;
    return { ok: true, done };
  }
  stop() { if (!this.current) return false; this.stopped = true; return true; }
}
