// VR Bot — auto-save incoming media/statuses. © VR DEVELOPMENTS
// GitHub runners are wiped after every run, so files are ENCRYPTED and committed to the "vr-media"
// branch (small files only, default ≤ 3 MB each, ≤ 300 MB total; oldest are dropped past the cap).
// View/download them in the panel → Logs → Saved media.
import { encryptBytes } from '../../panel/shared/crypto.js';
import { commitFiles, fetchBranch, listFiles } from '../gitstate.js';
import { env } from '../env.js';
import { log } from '../log.js';

const EXT = { image: 'jpg', video: 'mp4', audio: 'ogg', document: 'bin', sticker: 'webp' };

export class MediaSaver {
  constructor(cfg) { this.cfg = cfg; this.pending = []; }
  sizeOk(bytes) { return bytes && bytes <= (this.cfg.maxFileMB || 3) * 1024 * 1024; }
  async add(buffer, { kind, mimetype, from, chatName, status = false, fileName }) {
    const now = new Date();
    const id = `${now.toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${Math.random().toString(36).slice(2, 7)}`;
    const ext = (fileName && fileName.includes('.') ? fileName.split('.').pop() : EXT[kind] || 'bin').slice(0, 5);
    const path = `media/${now.toISOString().slice(0, 7)}/${id}.${ext}.json`;
    const env1 = await encryptBytes(new Uint8Array(buffer), env.passphrase);
    this.pending.push({ path, content: JSON.stringify({ ...env1, mimetype }), meta: { id, path, kind, mimetype, from, chatName, status, size: buffer.length, t: now.getTime(), fileName: fileName || null } });
  }
  /** Commit pending files. Returns index entries for status.media. */
  flush() {
    if (!this.pending.length) return { saved: [], removed: [] };
    const files = Object.fromEntries(this.pending.map((p) => [p.path, p.content]));
    const remove = [];
    if (fetchBranch(env.mediaBranch)) {
      const existing = listFiles(env.mediaBranch).filter((f) => f.path.startsWith('media/')).sort((a, b) => a.path.localeCompare(b.path));
      let total = existing.reduce((s, f) => s + f.size, 0) + Object.values(files).reduce((s, c) => s + c.length, 0);
      const cap = (this.cfg.totalCapMB || 300) * 1024 * 1024;
      while (total > cap && existing.length) { const f = existing.shift(); remove.push(f.path); total -= f.size; }
    }
    if (env.noPush) { log.info(`(local) ${this.pending.length} media file(s) ready, push skipped`); }
    else {
      try {
        commitFiles(env.mediaBranch, { ...files, 'README.md': '# VR Bot saved media (encrypted)\nOpen them in your VR Bot panel → Logs → Saved media.\n\n© VR DEVELOPMENTS\n' }, `VR Bot media · ${this.pending.length} file(s)`, { mode: 'append', remove, orphan: remove.length > 0 });
        log.ok(`Saved ${this.pending.length} media file(s)${remove.length ? `, dropped ${remove.length} old one(s) (size cap)` : ''}`);
      } catch (e) { log.warn(`Could not save media: ${e.message}`); this.pending = []; return { saved: [], removed: [] }; }
    }
    const out = this.pending.map((p) => p.meta);
    this.pending = [];
    return { saved: out, removed: remove };
  }
}
