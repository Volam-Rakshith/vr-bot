// VR Bot — your voice clips on the bot side: load them (encrypted) from the "vr-voice" branch, save new ones
// from "!voice save <name>", convert uploaded mp3/m4a/wav to a real WhatsApp voice note (Ogg/Opus) ONCE, and
// hand the ready audio to the sender. © VR DEVELOPMENTS
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { encryptBytes, encryptJSON, decryptBytes, decryptJSON } from '../../panel/shared/crypto.js';
import * as gitstate from '../gitstate.js';
import { log } from '../log.js';
import { VOICE_BRANCH, VOICE_LIMITS, clipPaths, clipIdFromPath, newClipId, cleanName, nameKey, findClip } from '../../panel/shared/voice.js';
import { isOggOpus, readOgg, sniffAudio, webmToOgg, waveformOf } from '../../panel/shared/ogg.js';

const README = '# VR Bot voice clips (encrypted)\nYour prerecorded voice notes. Every file here is encrypted with your panel password.\nManage them in your VR Bot panel → More → Voice clips, or with !voice in your own WhatsApp chat.\n\n© VR DEVELOPMENTS\n';

/** Run a command, async (never blocks the WhatsApp connection), killed after timeoutMs. */
function run(cmd, args, { input, timeoutMs = 120000 } = {}) {
  return new Promise((resolve) => {
    let p;
    try { p = spawn(cmd, args, { stdio: [input ? 'pipe' : 'ignore', 'pipe', 'pipe'] }); } catch (e) { resolve({ code: -1, out: Buffer.alloc(0), err: e.message }); return; }
    const out = [], err = [];
    const t = setTimeout(() => { try { p.kill('SIGKILL'); } catch {} }, timeoutMs);
    p.stdout.on('data', (d) => out.push(d)); p.stderr.on('data', (d) => err.push(d));
    p.on('error', (e) => { clearTimeout(t); resolve({ code: -1, out: Buffer.alloc(0), err: e.message }); });
    p.on('close', (code) => { clearTimeout(t); resolve({ code, out: Buffer.concat(out), err: Buffer.concat(err).toString().slice(-400) }); });
    if (input) { p.stdin.on('error', () => {}); p.stdin.end(input); }
  });
}

let ffmpegOk = null;
/** ffmpeg is not on GitHub's Ubuntu runners: install it the first time a clip needs converting (≈30 s, once per run). */
export async function ensureFfmpeg() {
  if (ffmpegOk !== null) return ffmpegOk;
  if ((await run('ffmpeg', ['-version'], { timeoutMs: 15000 })).code === 0) return (ffmpegOk = true);
  if (process.env.GITHUB_ACTIONS === 'true') {
    log.info('Installing ffmpeg to convert a voice clip (one time in this run)…');
    await run('sudo', ['-n', 'apt-get', 'update', '-qq'], { timeoutMs: 180000 });
    const r = await run('sudo', ['-n', 'env', 'DEBIAN_FRONTEND=noninteractive', 'apt-get', 'install', '-y', '-qq', '--no-install-recommends', 'ffmpeg'], { timeoutMs: 300000 });
    if (r.code === 0 && (await run('ffmpeg', ['-version'], { timeoutMs: 15000 })).code === 0) return (ffmpegOk = true);
    log.warn(`Could not install ffmpeg: ${r.err}`);
  }
  return (ffmpegOk = false);
}

/** Any audio → Ogg/Opus voice note (mono 48 kHz, 32 kbps). Returns { ogg, secs, waveform }. */
export async function toVoiceNote(bytes, { maxSeconds = VOICE_LIMITS.maxSeconds } = {}) {
  const buf = Buffer.from(bytes);
  const kind = sniffAudio(buf);
  if (kind === 'ogg' && isOggOpus(buf)) return { ogg: buf, secs: Math.round(readOgg(buf).seconds * 10) / 10, waveform: null };
  if (kind === 'webm') { try { const ogg = Buffer.from(webmToOgg(buf)); return { ogg, secs: Math.round(readOgg(ogg).seconds * 10) / 10, waveform: null }; } catch {} }
  if (!(await ensureFfmpeg())) throw new Error('this audio needs converting and ffmpeg is not available');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vrv-'));
  try {
    const inp = path.join(dir, 'in'), out = path.join(dir, 'out.ogg');
    fs.writeFileSync(inp, buf);
    const r = await run('ffmpeg', ['-nostdin', '-v', 'error', '-y', '-i', inp, '-vn', '-ac', '1', '-ar', '48000', '-t', String(maxSeconds), '-c:a', 'libopus', '-b:a', '32k', '-application', 'voip', out], { timeoutMs: 120000 });
    if (r.code !== 0 || !fs.existsSync(out)) throw new Error(`could not convert the audio (${r.err.trim().split('\n').pop() || 'ffmpeg failed'})`);
    const ogg = fs.readFileSync(out);
    const pcm = await run('ffmpeg', ['-nostdin', '-v', 'error', '-i', out, '-ac', '1', '-ar', '8000', '-f', 'f32le', '-'], { timeoutMs: 60000 });
    const samples = pcm.code === 0 && pcm.out.length >= 4 ? new Float32Array(pcm.out.buffer.slice(pcm.out.byteOffset, pcm.out.byteOffset + (pcm.out.length - (pcm.out.length % 4)))) : null;
    return { ogg, secs: Math.round(readOgg(ogg).seconds * 10) / 10, waveform: samples ? waveformOf(samples) : null };
  } finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} }
}

export class VoiceLibrary {
  /** git = gitstate functions (swappable in tests); convert = toVoiceNote */
  constructor({ passphrase, branch = process.env.VR_VOICE_BRANCH || VOICE_BRANCH, git = gitstate, convert = toVoiceNote, noPush = process.env.VR_NO_PUSH === '1' } = {}) {
    this.pass = passphrase; this.branch = branch; this.git = git; this.convert = convert; this.noPush = noPush;
    this.converting = null;
    this.clips = []; this.metaCache = new Map(); this.audioCache = new Map(); this.files = new Map(); this.loaded = false; this.failedConvert = new Set();
  }
  list() { return this.clips; }
  /** Resolves when a background conversion (if any) has finished. */
  idle() { return this.converting || Promise.resolve(); }
  find(ref) { return findClip(this.clips, ref); }

  /** Re-read the clip list from GitHub (cheap: only changed files are decrypted). Never throws. */
  async refresh({ convert = true } = {}) {
    try {
      if (!this.git.fetchBranch(this.branch)) { this.clips = []; this.files = new Map(); this.loaded = true; return this.clips; }
      const files = new Map(this.git.listFiles(this.branch).map((f) => [f.path, f]));
      const clips = [];
      for (const [p, f] of files) {
        const c = clipIdFromPath(p);
        if (!c || c.part !== 'meta') continue;
        const audio = files.get(clipPaths(c.id).audio);
        if (!audio) continue; // still uploading
        let meta = this.metaCache.get(f.sha);
        if (!meta) {
          try { meta = await decryptJSON(JSON.parse(this.git.readFile(this.branch, p).toString('utf8')), this.pass); this.metaCache.set(f.sha, meta); }
          catch (e) { log.warn(`Voice clip ${c.id} could not be read: ${e.message}`); continue; }
        }
        clips.push({ ...meta, id: c.id, audioSha: audio.sha, size: meta.size || audio.size });
      }
      this.clips = clips; this.files = files; this.loaded = true;
      // converting (maybe installing ffmpeg first) runs in the background so scheduled sends are never held up
      if (convert && !this.converting && clips.some((c) => c.fmt === 'raw' && !this.failedConvert.has(c.audioSha))) {
        this.converting = this.convertPending().catch(() => {}).finally(() => { this.converting = null; });
      }
    } catch (e) { log.warn(`Could not load voice clips: ${e.message}`); }
    return this.clips;
  }

  /** The ready-to-send audio of a clip: { meta, audio: Buffer } or null. */
  async get(ref) {
    if (!this.loaded) await this.refresh();
    const meta = this.find(ref);
    if (!meta) return null;
    if (meta.fmt === 'raw') return null; // not converted yet
    let buf = this.audioCache.get(meta.audioSha);
    if (!buf) {
      const raw = this.git.readFile(this.branch, clipPaths(meta.id).audio);
      if (!raw) return null;
      buf = Buffer.from(await decryptBytes(JSON.parse(raw.toString('utf8')), this.pass));
      this.audioCache.set(meta.audioSha, buf);
    }
    return { meta, audio: buf };
  }

  /** Clips the panel stored as mp3/m4a/wav (its browser could not convert) → Ogg/Opus, once. */
  async convertPending() {
    for (const meta of this.clips.filter((c) => c.fmt === 'raw' && !this.failedConvert.has(c.audioSha)).slice(0, 3)) {
      try {
        const raw = this.git.readFile(this.branch, clipPaths(meta.id).audio);
        const src = Buffer.from(await decryptBytes(JSON.parse(raw.toString('utf8')), this.pass));
        const r = await this.convert(src);
        await this.write({ ...meta, ...this.metaFrom(r, meta) }, r.ogg, `VR Bot voice · converted "${meta.name}"`);
        log.ok(`Voice clip converted to a WhatsApp voice note (${r.secs}s)`);
      } catch (e) { this.failedConvert.add(meta.audioSha); log.warn(`Voice clip could not be converted: ${e.message}`); }
    }
  }

  metaFrom(r, base = {}) {
    return { secs: r.secs || base.secs || 0, size: r.ogg.length, fmt: 'ogg', mime: 'audio/ogg; codecs=opus', waveform: r.waveform || base.waveform || null };
  }

  /** Save (or replace, same name) a clip. bytes = any audio. Returns { meta, replaced }. */
  async save(name, bytes, { secs = 0, waveform = null, by = 'whatsapp' } = {}) {
    const nm = cleanName(name);
    if (!nm) throw new Error('give the clip a name');
    if (!bytes || !bytes.length) throw new Error('no audio');
    if (bytes.length > VOICE_LIMITS.maxUploadBytes) throw new Error('that audio file is too big');
    await this.refresh({ convert: false });
    const old = this.clips.find((c) => nameKey(c.name) === nameKey(nm));
    if (!old && this.clips.length >= VOICE_LIMITS.maxClips) throw new Error(`you already have ${VOICE_LIMITS.maxClips} clips — delete one first`);
    const r = await this.convert(bytes);
    const seconds = r.secs || secs;
    if (seconds > VOICE_LIMITS.maxSeconds + 0.5) throw new Error(`too long (${Math.round(seconds)} s) — max ${VOICE_LIMITS.maxSeconds} s`);
    if (r.ogg.length > VOICE_LIMITS.maxBytes) throw new Error(`too big after converting (${Math.round(r.ogg.length / 1024)} KB) — max 1 MB`);
    const meta = { v: 1, id: old?.id || newClipId(), name: nm, by, at: Date.now(), ...this.metaFrom({ ...r, secs: seconds, waveform: r.waveform || waveform }) };
    await this.write(meta, r.ogg, `VR Bot voice · ${old ? 'replaced' : 'saved'} a clip`);
    return { meta, replaced: !!old };
  }

  /** Delete a clip by name or id. Returns the deleted meta or null. */
  async remove(ref) {
    await this.refresh({ convert: false });
    const meta = this.find(ref);
    if (!meta) return null;
    const p = clipPaths(meta.id);
    this.commit({}, [p.meta, p.audio], 'VR Bot voice · deleted a clip');
    this.clips = this.clips.filter((c) => c.id !== meta.id);
    return meta;
  }

  async write(meta, ogg, message) {
    const p = clipPaths(meta.id);
    const clean = { ...meta }; delete clean.audioSha;
    const files = { [p.audio]: JSON.stringify(await encryptBytes(new Uint8Array(ogg), this.pass)), [p.meta]: JSON.stringify(await encryptJSON(clean, this.pass)), 'README.md': README };
    this.commit(files, [], message);
    const sha = `local-${meta.id}-${meta.at}-${ogg.length}`;
    this.audioCache.set(sha, Buffer.from(ogg));
    this.clips = [...this.clips.filter((c) => c.id !== meta.id), { ...clean, audioSha: sha }];
  }

  /** Append a commit to vr-voice (never force: the panel may have added a clip a second ago). Retries on a race. */
  commit(files, remove, message) {
    if (this.noPush) { log.info('(local) voice clip change ready, push skipped'); return null; }
    let last;
    for (let i = 0; i < 3; i++) {
      this.git.fetchBranch(this.branch);
      try { return this.git.commitFiles(this.branch, files, message, { mode: 'append', remove }); }
      catch (e) { last = e; }
    }
    throw new Error(`could not save to GitHub (${last?.message || 'push failed'})`);
  }
}
