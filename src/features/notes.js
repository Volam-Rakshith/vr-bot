// VR Bot — your notes on the bot side ("!note"): read and write them (ENCRYPTED) on the "vr-notes" branch.
// One file per note, so the panel and the bot can add notes at the same time. © VR DEVELOPMENTS
import { encryptJSON, decryptJSON } from '../../panel/shared/crypto.js';
import * as gitstate from '../gitstate.js';
import { log } from '../log.js';
import { NOTES_BRANCH, NOTES_LIMITS, notePath, noteIdFromPath, newNoteId, cleanNoteText, sortNotes } from '../../panel/shared/notes.js';

const README = '# VR Bot notes (encrypted)\nNotes you saved with !note in WhatsApp or in the panel. Every file here is encrypted with your panel password.\nRead them in your VR Bot panel → More → Notes, or send !notes to your own chat.\n\n© VR DEVELOPMENTS\n';

export class NotesBook {
  /** git = gitstate functions (swappable in tests) */
  constructor({ passphrase, branch = process.env.VR_NOTES_BRANCH || NOTES_BRANCH, git = gitstate, noPush = process.env.VR_NO_PUSH === '1' } = {}) {
    this.pass = passphrase; this.branch = branch; this.git = git; this.noPush = noPush;
    this.notes = []; this.cache = new Map(); this.loaded = false;
  }

  /** Newest first. */
  list() { return sortNotes(this.notes); }

  /** Re-read the notes from GitHub (only new/changed files are decrypted). Throws if GitHub can't be read. */
  async refresh() {
    if (this.noPush && this.loaded) return this.list(); // local runs (VR_NO_PUSH=1) keep what they saved in memory
    if (!this.git.fetchBranch(this.branch)) { this.notes = []; this.loaded = true; return this.notes; }
    const notes = [];
    for (const f of this.git.listFiles(this.branch)) {
      const id = noteIdFromPath(f.path);
      if (!id) continue;
      let n = this.cache.get(f.sha);
      if (!n) {
        try { n = await decryptJSON(JSON.parse(this.git.readFile(this.branch, f.path).toString('utf8')), this.pass); this.cache.set(f.sha, n); }
        catch (e) { log.warn(`Note ${id} could not be read: ${e.message}`); continue; }
      }
      notes.push({ ...n, id });
    }
    this.notes = notes; this.loaded = true;
    return this.list();
  }

  /** Save a note. fields: { text, from, fromNum, kind, forwarded, sentAt, by }. Returns the note. */
  async add(fields = {}) {
    const text = cleanNoteText(fields.text);
    if (!text) throw new Error('the note is empty');
    await this.refresh();
    if (this.notes.length >= NOTES_LIMITS.maxNotes) throw new Error(`you have ${NOTES_LIMITS.maxNotes} notes — delete some first (panel → More → Notes)`);
    const now = Date.now();
    const note = { v: 1, id: newNoteId(now), text, from: fields.from || 'me', fromNum: fields.fromNum || '', kind: fields.kind || 'text', forwarded: !!fields.forwarded, sentAt: fields.sentAt || 0, at: now, by: fields.by || 'whatsapp' };
    if (fields.chat) note.chat = String(fields.chat).slice(0, 80);
    if (!note.fromNum) delete note.fromNum;
    if (!note.sentAt) delete note.sentAt;
    this.commit({ [notePath(note.id)]: JSON.stringify(await encryptJSON(note, this.pass)), 'README.md': README }, [], 'VR Bot notes · saved a note');
    this.notes = [...this.notes.filter((x) => x.id !== note.id), note];
    return note;
  }

  /** Delete the n-th note of the newest-first list (1 = newest). Returns the deleted note or null. */
  async removeAt(n) {
    await this.refresh();
    const note = this.list()[Number(n) - 1];
    if (!note) return null;
    this.commit({}, [notePath(note.id)], 'VR Bot notes · deleted a note');
    this.notes = this.notes.filter((x) => x.id !== note.id);
    return note;
  }

  /** Append a commit to vr-notes (never force: the panel may have added a note a second ago). Retries on a race. */
  commit(files, remove, message) {
    if (this.noPush) { log.info('(local) note change ready, push skipped'); return null; }
    let last;
    for (let i = 0; i < 3; i++) {
      this.git.fetchBranch(this.branch);
      try { return this.git.commitFiles(this.branch, files, message, { mode: 'append', remove }); }
      catch (e) { last = e; }
    }
    throw new Error(`could not save to GitHub (${last?.message || 'push failed'})`);
  }
}
