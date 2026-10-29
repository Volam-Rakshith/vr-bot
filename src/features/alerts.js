// VR Bot — alerts to your own WhatsApp: GitHub stars/issues, website contact form, custom pings.
// © VR DEVELOPMENTS
import fs from 'node:fs';
import { env } from '../env.js';

async function gh(path) {
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'vr-bot' };
  if (env.githubToken) headers.Authorization = `Bearer ${env.githubToken}`;
  const r = await fetch(`https://api.github.com${path}`, { headers, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`GitHub API ${r.status} for ${path}`);
  return r.json();
}

/**
 * Compares star/fork counts and new issues with the last check. First check only records numbers.
 * mem: memory.github  → { lastCheck, repos: { name: { stars, forks } }, lastIssueAt }
 */
export async function githubWatch(cfg, mem, nowMs) {
  const msgs = [];
  if (mem.lastCheck && nowMs - mem.lastCheck < (cfg.everyMinutes || 60) * 60000) return msgs;
  const user = cfg.user || 'Volam-Rakshith';
  let repos = await gh(`/users/${encodeURIComponent(user)}/repos?per_page=100&sort=updated`);
  if ((cfg.repos || []).length) repos = repos.filter((r) => cfg.repos.includes(r.name));
  const first = !mem.repos;
  mem.repos = mem.repos || {};
  for (const r of repos) {
    const prev = mem.repos[r.name];
    if (prev && !first) {
      if (r.stargazers_count > prev.stars) msgs.push(`⭐ *${r.name}* got ${r.stargazers_count - prev.stars} new star(s) → ${r.stargazers_count} total`);
      if (r.forks_count > prev.forks) msgs.push(`🍴 *${r.name}* was forked → ${r.forks_count} forks`);
    }
    mem.repos[r.name] = { stars: r.stargazers_count, forks: r.forks_count };
  }
  const since = new Date(mem.lastIssueAt || nowMs - 3600000).toISOString();
  if (!first) {
    for (const r of repos.filter((x) => x.open_issues_count > 0).slice(0, 20)) {
      const issues = await gh(`/repos/${r.full_name}/issues?state=open&since=${since}&per_page=10`);
      for (const i of issues) {
        if (new Date(i.created_at).getTime() > (mem.lastIssueAt || 0) && i.user?.login !== user) {
          msgs.push(`${i.pull_request ? '🔀 New pull request' : '🐞 New issue'} on *${r.name}*: "${i.title}" by ${i.user?.login}\n${i.html_url}`);
        }
      }
    }
  }
  mem.lastIssueAt = nowMs;
  mem.lastCheck = nowMs;
  return msgs;
}

/**
 * Website contact form → ntfy.sh topic → WhatsApp.
 * Your site does:  fetch('https://ntfy.sh/<topic>', { method: 'POST', body: 'Name: …\nEmail: …\nMessage: …' })
 * The bot reads new posts every run (ntfy.sh keeps them 12 hours; runs are every 30 min).
 */
export async function ntfyPoll(topic, mem) {
  if (!topic) return [];
  const since = mem.since || '12h';
  const r = await fetch(`https://ntfy.sh/${encodeURIComponent(topic)}/json?poll=1&since=${encodeURIComponent(since)}`, { signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`ntfy ${r.status}`);
  const lines = (await r.text()).split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter((x) => x && x.event === 'message');
  const out = [];
  for (const m of lines) {
    out.push(`📬 *New message from your website*${m.title ? `\n${m.title}` : ''}\n${String(m.message || '').slice(0, 1500)}`);
    mem.since = m.id;
  }
  return out;
}

/** repository_dispatch payloads (event types: vr-alert, contact-form). */
export function dispatchAlert() {
  if (env.eventName !== 'repository_dispatch' || !env.eventPath || !fs.existsSync(env.eventPath)) return [];
  const ev = JSON.parse(fs.readFileSync(env.eventPath, 'utf8'));
  const p = ev.client_payload || {};
  if (ev.action === 'contact-form') return [`📬 *New contact form message*\nName: ${p.name || '-'}\nEmail: ${p.email || '-'}\n\n${String(p.message || '').slice(0, 1500)}`];
  return [`🔔 ${String(p.text || p.message || JSON.stringify(p)).slice(0, 1500)}`];
}
