// VR Bot — stores encrypted state on separate git branches using git "plumbing" commands.
// © VR DEVELOPMENTS
// Why a branch (and not Actions cache/artifacts)? Branches never expire, are readable by the panel
// through the GitHub API, and a push is atomic. vr-state is rewritten as ONE commit each time
// (force-push), so the repo does not grow by megabytes per day. The previous session is kept
// inside that commit as session.prev.json for rollback.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ID = {
  GIT_AUTHOR_NAME: 'VR Bot', GIT_AUTHOR_EMAIL: 'vr-bot@users.noreply.github.com',
  GIT_COMMITTER_NAME: 'VR Bot', GIT_COMMITTER_EMAIL: 'vr-bot@users.noreply.github.com',
};

export function git(args, { input, env, allowFail = false } = {}) {
  const r = spawnSync('git', args, { input, env: { ...process.env, ...ID, ...(env || {}) }, maxBuffer: 512 * 1024 * 1024 });
  if (r.status !== 0 && !allowFail) {
    throw new Error(`git ${args[0]} failed: ${(r.stderr || '').toString().trim().slice(0, 400)}`);
  }
  return { ok: r.status === 0, stdout: r.stdout ? r.stdout : Buffer.alloc(0), stderr: (r.stderr || '').toString() };
}
const ref = (branch) => `refs/remotes/origin/${branch}`;

/** Fetch the tip of a branch. Returns false if the branch does not exist yet. */
export function fetchBranch(branch) {
  return git(['fetch', '--no-tags', '--depth=1', 'origin', `+refs/heads/${branch}:${ref(branch)}`], { allowFail: true }).ok;
}
export function readFile(branch, file) {
  const r = git(['show', `${ref(branch)}:${file}`], { allowFail: true });
  return r.ok ? r.stdout : null;
}
/** [{ path, size }] of every file on the branch tip. */
export function listFiles(branch) {
  const r = git(['ls-tree', '-r', '-l', ref(branch)], { allowFail: true });
  if (!r.ok) return [];
  return r.stdout.toString().split('\n').filter(Boolean).map((l) => {
    const [meta, p] = l.split('\t');
    const parts = meta.trim().split(/\s+/);
    return { path: p, size: Number(parts[3]) || 0, sha: parts[2] };
  });
}

/**
 * Commit `files` ({ "path/in/branch": Buffer|string }) to `branch` and push.
 * mode "replace": one orphan commit containing exactly these files (force push).
 * mode "append": keep everything already on the branch, add/replace these files, parent = old tip.
 * remove: paths to delete (append mode).
 * orphan: with append, keep the files but drop history (force push) so deleted media really frees space.
 */
export function commitFiles(branch, files, message, { mode = 'replace', remove = [], push = true, orphan = false } = {}) {
  const tmpIndex = path.join(os.tmpdir(), `vr-index-${process.pid}-${Date.now()}`);
  const env = { GIT_INDEX_FILE: tmpIndex };
  let parent = null;
  try {
    if (mode === 'append') {
      const tip = git(['rev-parse', '--verify', '-q', ref(branch)], { allowFail: true });
      if (tip.ok) { parent = tip.stdout.toString().trim(); git(['read-tree', parent], { env }); }
    }
    for (const p of remove) git(['update-index', '--force-remove', p], { env, allowFail: true });
    for (const [p, content] of Object.entries(files)) {
      const sha = git(['hash-object', '-w', '--stdin'], { input: Buffer.isBuffer(content) ? content : Buffer.from(content) }).stdout.toString().trim();
      git(['update-index', '--add', '--cacheinfo', `100644,${sha},${p}`], { env });
    }
    const tree = git(['write-tree'], { env }).stdout.toString().trim();
    const args = ['commit-tree', tree, '-m', message];
    if (parent && !orphan) args.splice(2, 0, '-p', parent);
    const commit = git(args).stdout.toString().trim();
    if (push) {
      git(['push', ...(mode === 'replace' || orphan ? ['--force'] : []), 'origin', `${commit}:refs/heads/${branch}`]);
      git(['update-ref', ref(branch), commit], { allowFail: true });
    }
    return commit;
  } finally {
    try { fs.unlinkSync(tmpIndex); } catch {}
  }
}
