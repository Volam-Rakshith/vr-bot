// VR Bot — tiny Ogg/Opus helpers for voice clips. Pure ES module: runs in the panel (browser) and the bot (Node).
// © VR DEVELOPMENTS
//
// WhatsApp voice notes are Ogg files with the Opus codec. Chrome records WebM/Opus, so the panel REPACKS the
// recording into Ogg here (no re-encoding, no quality loss, no server, no ffmpeg). Other audio files (mp3, m4a…)
// are re-encoded in the panel with the browser's own Opus encoder (encodeToOgg) — or by the bot with ffmpeg.

const enc = new TextEncoder();
const ascii = (b, o, n) => String.fromCharCode(...b.subarray(o, o + n));

/* ---------------- Ogg CRC + pages ---------------- */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let r = i << 24;
    for (let j = 0; j < 8; j++) r = (r & 0x80000000) ? ((r << 1) ^ 0x04c11db7) : (r << 1);
    t[i] = r >>> 0;
  }
  return t;
})();
export function oggCrc(bytes) {
  let crc = 0;
  for (let i = 0; i < bytes.length; i++) crc = ((crc << 8) ^ CRC_TABLE[((crc >>> 24) ^ bytes[i]) & 0xff]) >>> 0;
  return crc >>> 0;
}

function page({ packets, granule, serial, seq, bos = false, eos = false, continued = false }) {
  const lacing = [];
  for (const p of packets) {
    let n = p.length;
    while (n >= 255) { lacing.push(255); n -= 255; }
    lacing.push(n);
  }
  const bodyLen = packets.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(27 + lacing.length + bodyLen);
  const dv = new DataView(out.buffer);
  out.set(enc.encode('OggS'), 0);
  out[4] = 0;
  out[5] = (continued ? 1 : 0) | (bos ? 2 : 0) | (eos ? 4 : 0);
  dv.setBigUint64(6, BigInt(granule), true);
  dv.setUint32(14, serial >>> 0, true);
  dv.setUint32(18, seq >>> 0, true);
  dv.setUint32(22, 0, true);
  out[26] = lacing.length;
  out.set(lacing, 27);
  let o = 27 + lacing.length;
  for (const p of packets) { out.set(p, o); o += p.length; }
  dv.setUint32(22, oggCrc(out), true);
  return out;
}

/* ---------------- Opus packet + headers ---------------- */
/** Samples (at 48 kHz) in one Opus packet, from its TOC byte (RFC 6716 §3.1). */
export function opusPacketSamples(p) {
  if (!p || !p.length) return 0;
  const toc = p[0];
  const config = toc >> 3;
  let ms;
  if (config < 12) ms = [10, 20, 40, 60][config & 3];
  else if (config < 16) ms = [10, 20][config & 1];
  else ms = [2.5, 5, 10, 20][config & 3];
  const c = toc & 3;
  const frames = c === 0 ? 1 : c === 3 ? (p.length > 1 ? p[1] & 0x3f : 0) : 2;
  return Math.round(frames * ms * 48);
}

export function opusHead({ channels = 1, preSkip = 312, inputRate = 48000 } = {}) {
  const h = new Uint8Array(19);
  const dv = new DataView(h.buffer);
  h.set(enc.encode('OpusHead'), 0);
  h[8] = 1; h[9] = channels;
  dv.setUint16(10, preSkip, true);
  dv.setUint32(12, inputRate, true);
  dv.setInt16(16, 0, true);
  h[18] = 0;
  return h;
}
function opusTags(vendor = 'VR Bot') {
  const v = enc.encode(vendor);
  const t = new Uint8Array(8 + 4 + v.length + 4);
  const dv = new DataView(t.buffer);
  t.set(enc.encode('OpusTags'), 0);
  dv.setUint32(8, v.length, true);
  t.set(v, 12);
  dv.setUint32(12 + v.length, 0, true);
  return t;
}

/**
 * Opus packets → an Ogg/Opus file (Uint8Array).
 * head: the 19+ byte OpusHead (e.g. WebM CodecPrivate) or { channels, preSkip }.
 */
export function muxOggOpus(packets, head = {}, { serial = 0x56522042 /* "VR B" */ } = {}) {
  const headBytes = head instanceof Uint8Array ? head : opusHead(head);
  if (ascii(headBytes, 0, 8) !== 'OpusHead') throw new Error('not an Opus stream');
  const pages = [page({ packets: [headBytes], granule: 0, serial, seq: 0, bos: true }), page({ packets: [opusTags()], granule: 0, serial, seq: 1 })];
  let seq = 2, granule = 0, cur = [], segs = 0, bytes = 0;
  const list = packets.filter((p) => p && p.length);
  list.forEach((p, i) => {
    const need = Math.floor(p.length / 255) + 1;
    if (cur.length && (segs + need > 255 || bytes + p.length > 4000)) {
      pages.push(page({ packets: cur, granule, serial, seq: seq++ }));
      cur = []; segs = 0; bytes = 0;
    }
    cur.push(p); segs += need; bytes += p.length;
    granule += opusPacketSamples(p);
    if (i === list.length - 1) pages.push(page({ packets: cur, granule, serial, seq: seq++, eos: true }));
  });
  if (!list.length) throw new Error('no audio in the recording');
  const total = pages.reduce((s, x) => s + x.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const x of pages) { out.set(x, o); o += x.length; }
  return out;
}

/** Read an Ogg file → { packets, head, channels, preSkip, granule, seconds, opus }. Throws if it is not Ogg. */
export function readOgg(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const packets = [];
  let o = 0, pending = [], granule = 0, pagesN = 0;
  while (o + 27 <= b.length) {
    if (ascii(b, o, 4) !== 'OggS') throw new Error('not an Ogg file');
    const n = b[o + 26];
    const g = dv.getBigInt64(o + 6, true);
    if (g >= 0n) granule = Number(g);
    let p = o + 27 + n;
    for (let i = 0; i < n; i++) {
      const len = b[o + 27 + i];
      pending.push(b.subarray(p, p + len)); p += len;
      if (len < 255) { const total = pending.reduce((s, x) => s + x.length, 0); const pk = new Uint8Array(total); let q = 0; for (const x of pending) { pk.set(x, q); q += x.length; } packets.push(pk); pending = []; }
    }
    o = p; pagesN++;
  }
  if (!pagesN) throw new Error('not an Ogg file');
  const head = packets[0];
  const opus = !!head && head.length >= 19 && ascii(head, 0, 8) === 'OpusHead';
  const channels = opus ? head[9] : 0;
  const preSkip = opus ? new DataView(head.buffer, head.byteOffset).getUint16(10, true) : 0;
  return { packets: packets.slice(2), head, channels, preSkip, granule, opus, seconds: opus ? Math.max(0, (granule - preSkip) / 48000) : 0 };
}

/** Is this an Ogg file with Opus audio (what WhatsApp voice notes are)? */
export function isOggOpus(bytes) {
  try { const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes); return ascii(b, 0, 4) === 'OggS' && readOgg(b).opus; } catch { return false; }
}

/* ---------------- WebM (Matroska) → Opus packets ---------------- */
const MASTER = new Set([0x18538067 /* Segment */, 0x1654AE6B /* Tracks */, 0xAE /* TrackEntry */, 0x1F43B675 /* Cluster */, 0xA0 /* BlockGroup */, 0xE1 /* Audio */]);

function readVint(b, o, keepMarker) {
  const first = b[o];
  if (first === undefined) return null;
  let len = 1, mask = 0x80;
  while (len <= 8 && !(first & mask)) { len++; mask >>= 1; }
  if (len > 8 || o + len > b.length) return null;
  let v = keepMarker ? first : first & (mask - 1);
  let allOnes = (first & (mask - 1)) === mask - 1;
  for (let i = 1; i < len; i++) { v = v * 256 + b[o + i]; if (b[o + i] !== 0xff) allOnes = false; }
  return { v, len, unknown: !keepMarker && allOnes };
}

/** WebM/Opus bytes → { packets, head } (Chrome's MediaRecorder output, any lacing). */
export function webmOpusPackets(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (b[0] !== 0x1a || b[1] !== 0x45 || b[2] !== 0xdf || b[3] !== 0xa3) throw new Error('not a WebM file');
  let o = 0, codec = '', head = null, track = 0, curTrack = 0, audioTrack = 0, channels = 1;
  const packets = [];
  const block = (start, end) => {
    const tn = readVint(b, start, false); if (!tn) return;
    if (audioTrack && tn.v !== audioTrack) return;
    let p = start + tn.len + 2;
    const flags = b[p++];
    const lacing = (flags >> 1) & 3;
    if (lacing === 0) { packets.push(b.slice(p, end)); return; }
    const count = b[p++] + 1;
    const sizes = [];
    if (lacing === 1) { // Xiph
      for (let i = 0; i < count - 1; i++) { let s = 0, x; do { x = b[p++]; s += x; } while (x === 255); sizes.push(s); }
    } else if (lacing === 3) { // EBML
      const f = readVint(b, p, false); p += f.len; sizes.push(f.v);
      for (let i = 1; i < count - 1; i++) { const d = readVint(b, p, false); p += d.len; const bias = 2 ** (7 * d.len - 1) - 1; sizes.push(sizes[i - 1] + (d.v - bias)); }
    } else { // fixed
      const each = Math.floor((end - p) / count); for (let i = 0; i < count - 1; i++) sizes.push(each);
    }
    sizes.push(end - p - sizes.reduce((s, x) => s + x, 0));
    for (const s of sizes) { packets.push(b.slice(p, p + s)); p += s; }
  };
  while (o < b.length) {
    const id = readVint(b, o, true); if (!id) break;
    const sz = readVint(b, o + id.len, false); if (!sz) break;
    const data = o + id.len + sz.len;
    const end = sz.unknown ? b.length : Math.min(b.length, data + sz.v);
    if (MASTER.has(id.v)) { if (id.v === 0xAE) { curTrack = 0; codec = codec || ''; } o = data; continue; }
    switch (id.v) {
      case 0xD7: { let v = 0; for (let i = data; i < end; i++) v = v * 256 + b[i]; curTrack = v; track = v; break; }
      case 0x86: { const c = ascii(b, data, end - data); if (c === 'A_OPUS') { codec = c; audioTrack = curTrack || track || 1; } break; }
      case 0x63A2: if (codec === 'A_OPUS' && !head) head = b.slice(data, end); break;
      case 0x9F: channels = b[data] || 1; break;
      case 0xA3: case 0xA1: block(data, end); break;
      default: break;
    }
    o = end;
  }
  if (codec !== 'A_OPUS') throw new Error('this recording is not Opus audio');
  if (!head || ascii(head, 0, 8) !== 'OpusHead') head = opusHead({ channels });
  return { packets, head };
}

/** WebM/Opus → Ogg/Opus (lossless repack). */
export function webmToOgg(bytes) {
  const { packets, head } = webmOpusPackets(bytes);
  return muxOggOpus(packets, head);
}

/** Bytes → which audio container it is: "ogg" | "webm" | "other". */
export function sniffAudio(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (b.length >= 4 && ascii(b, 0, 4) === 'OggS') return 'ogg';
  if (b.length >= 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return 'webm';
  return 'other';
}

/** 64-bar waveform (0–100), the way WhatsApp shows voice notes. samples = Float32Array of one channel. */
export function waveformOf(samples, bars = 64) {
  const n = samples?.length || 0;
  if (!n) return [];
  const block = Math.max(1, Math.floor(n / bars));
  const vals = [];
  for (let i = 0; i < bars; i++) {
    let s = 0; const st = i * block;
    for (let j = 0; j < block && st + j < n; j++) s += Math.abs(samples[st + j]);
    vals.push(s / block);
  }
  const max = Math.max(...vals) || 1;
  return vals.map((v) => Math.min(100, Math.floor((v / max) * 100)));
}

/**
 * Browser only: re-encode any audio the browser can play (mp3, m4a, wav…) to Ogg/Opus with WebCodecs.
 * Returns { ogg, seconds, waveform } or null when this browser has no Opus encoder.
 */
export async function encodeToOgg(arrayBuffer, { maxSeconds = 60, bitrate = 32000 } = {}) {
  if (typeof AudioEncoder === 'undefined' || typeof AudioData === 'undefined') return null;
  const ctx = new (globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext)(1, 48000, 48000);
  const decoded = await ctx.decodeAudioData(arrayBuffer.slice(0));
  if (decoded.duration > maxSeconds + 0.5) throw new Error(`Too long: ${Math.round(decoded.duration)} s (max ${maxSeconds} s)`);
  // mix down to mono 48 kHz
  const frames = Math.ceil(decoded.duration * 48000);
  const off = new OfflineAudioContext(1, Math.max(1, frames), 48000);
  const src = off.createBufferSource(); src.buffer = decoded; src.connect(off.destination); src.start();
  const mono = (await off.startRendering()).getChannelData(0);
  const support = await AudioEncoder.isConfigSupported({ codec: 'opus', sampleRate: 48000, numberOfChannels: 1, bitrate }).catch(() => null);
  if (!support?.supported) return null;
  const packets = [];
  let preSkip = 312;
  const encoder = new AudioEncoder({
    output: (chunk, meta) => {
      const d = new Uint8Array(chunk.byteLength); chunk.copyTo(d); packets.push(d);
      const desc = meta?.decoderConfig?.description;
      if (desc && desc.byteLength >= 19) { const h = new Uint8Array(desc instanceof ArrayBuffer ? desc : desc.buffer); if (ascii(h, 0, 8) === 'OpusHead') preSkip = new DataView(h.buffer, h.byteOffset).getUint16(10, true); }
    },
    error: (e) => { throw e; },
  });
  encoder.configure({ codec: 'opus', sampleRate: 48000, numberOfChannels: 1, bitrate });
  const CH = 4800;
  for (let i = 0; i < mono.length; i += CH) {
    const part = mono.subarray(i, Math.min(mono.length, i + CH));
    encoder.encode(new AudioData({ format: 'f32-planar', sampleRate: 48000, numberOfFrames: part.length, numberOfChannels: 1, timestamp: Math.round((i / 48000) * 1e6), data: part }));
  }
  await encoder.flush(); encoder.close();
  return { ogg: muxOggOpus(packets, { channels: 1, preSkip }), seconds: Math.round(decoded.duration * 10) / 10, waveform: waveformOf(mono) };
}
