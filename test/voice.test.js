// 🎙️ Voice clips: encrypted library, !voice commands, keyword rules → real voice notes (PTT), cooldown,
// phrase matching, Sent log kind "voice", schedules with a clip, Ogg/WebM handling. © VR DEVELOPMENTS
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { matchText, matchRule, findRule, hasPhrase } from '../panel/shared/rules.js';
import { voicePlan, ruleCooldown, pttContent, parseVoiceCommand, findClip, clipPaths, clipIdFromPath, voiceListText, PTT_MIME, VOICE_COOLDOWN_MIN } from '../panel/shared/voice.js';
import { muxOggOpus, readOgg, isOggOpus, webmOpusPackets, webmToOgg, sniffAudio, opusPacketSamples, oggCrc, waveformOf } from '../panel/shared/ogg.js';
import { contentText, appendSent } from '../panel/shared/notify.js';
import { buildJobs } from '../panel/shared/planner.js';
import { withDefaults } from '../panel/shared/defaults.js';
import { decryptJSON } from '../panel/shared/crypto.js';

process.env.OWNER_NUMBER = '919999999999';
const { Incoming } = await import('../src/incoming.js');
const { VoiceLibrary } = await import('../src/features/voice.js');
const { Notifier } = await import('../src/features/push.js');

const PASS = 'voice-pass-123';
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* ---------------- helpers ---------------- */
// fake Opus packets: TOC 0x98 = CELT 20 ms, 1 frame → 960 samples each
const packet = (i) => Uint8Array.from([0x98, ...crypto.createHash('sha256').update(String(i)).digest().subarray(0, 24)]);
const fakeOgg = (n = 100) => Buffer.from(muxOggOpus(Array.from({ length: n }, (_, i) => packet(i)), { channels: 1, preSkip: 312 }));

/** In-memory stand-in for the git branch helpers (src/gitstate.js). */
function fakeGit() {
  const branches = {};
  const sha = (c) => crypto.createHash('sha1').update(c).digest('hex');
  return {
    branches,
    fetchBranch: (b) => !!branches[b],
    listFiles: (b) => [...(branches[b] || new Map())].map(([p, c]) => ({ path: p, size: c.length, sha: sha(c) })),
    readFile: (b, f) => branches[b]?.get(f) || null,
    commitFiles: (b, files, msg, { remove = [] } = {}) => {
      const m = branches[b] || (branches[b] = new Map());
      for (const p of remove) m.delete(p);
      for (const [p, c] of Object.entries(files)) m.set(p, Buffer.from(c));
      return 'commit';
    },
  };
}
const newLib = (git = fakeGit()) => new VoiceLibrary({ passphrase: PASS, git, noPush: false });

const ME = '919999999999';
let n = 0;
const ts = () => Math.floor(Date.now() / 1000) - 30;
const dm = (num, text) => ({ key: { remoteJid: `${num}@s.whatsapp.net`, id: 'V' + ++n, fromMe: false }, messageTimestamp: ts(), message: { conversation: text } });
function harness({ rules = [], contacts = [], settings = {}, voices = null } = {}) {
  const sent = [];
  const wa = { me: () => ME, isMe: (j) => String(j || '').startsWith(ME), pnFor: async (jid, alt) => String(alt || jid || '').split('@')[0].split(':')[0], sock: { user: { id: `${ME}@s.whatsapp.net` } } };
  const state = {
    memory: { processed: [], sentIds: [], lastOut: {}, lastIn: {}, cooldowns: {}, aiCount: {}, ai: {}, awaySent: {}, warns: {} },
    status: { inbox: {}, groups: [] },
  };
  const data = { settings: withDefaults({ version: 2, ...settings }), rules, contacts, groupsCfg: {} };
  const inc = new Incoming({ wa, getData: () => data, state, send: async (jid, content, opts = {}) => { sent.push({ jid, content, opts }); return { key: { id: 'S' + sent.length } }; }, media: null, voices });
  const aiCalls = [];
  inc.ai = async (it) => { aiCalls.push(it.text); };
  return { inc, sent, state, data, aiCalls };
}

/* ---------------- tests ---------------- */
test('phrase matching: whole words / phrases, any case, punctuation ignored', () => {
  const r = { match: 'word', pattern: 'good morning, gm, where are you' };
  assert.equal(matchText(r, 'GOOD   Morning!!'), true);
  assert.equal(matchText(r, 'gm bro'), true);
  assert.equal(matchText(r, 'check your gmail'), false, 'part of a word does not count');
  assert.equal(matchText(r, 'bro, where are you??'), true);
  assert.equal(matchText(r, 'where you are'), false, 'the phrase order matters');
  assert.equal(matchText(r, 'good evening'), false);
  assert.equal(hasPhrase('Naa peru రాజు, ok', 'రాజు'), true, 'Telugu words work');
  assert.equal(matchText({ match: 'word', pattern: 'VR', caseSensitive: true }, 'vr'), false);
  // "contains" keeps its old meaning (substring) so existing rules do not change
  assert.equal(matchText({ match: 'contains', pattern: 'gm' }, 'check your gmail'), true);
});

test('voice plan + cooldown defaults (10 min for voice rules, 60 for text, own value wins)', () => {
  assert.deepEqual(voicePlan({ reply: 'hi' }), { text: true, voice: false, ref: null });
  assert.deepEqual(voicePlan({ voice: { clip: 'v1', name: 'gm', mode: 'voice' } }), { text: false, voice: true, ref: { clip: 'v1', name: 'gm' } });
  assert.equal(voicePlan({ voice: { clip: 'v1', mode: 'voice+text' } }).text, true);
  assert.equal(voicePlan({ voice: { clip: 'v1', mode: 'text' } }).voice, false);
  assert.equal(ruleCooldown({ voice: { clip: 'v1', mode: 'voice' } }), VOICE_COOLDOWN_MIN);
  assert.equal(ruleCooldown({}), 60);
  assert.equal(ruleCooldown({ voice: { clip: 'v1', mode: 'voice' }, cooldownMinutes: 3 }), 3);
  assert.equal(ruleCooldown({ cooldownMinutes: 0 }), 0);
  assert.equal(ruleCooldown({ voice: { clip: 'v1', mode: 'voice' }, cooldownMinutes: null }), 10);
});

test('matchRule: a cooling rule still owns the message; findRule keeps its old answer', () => {
  const now = Date.now();
  const rules = [{ id: 'a', match: 'word', pattern: 'where are you', voice: { clip: 'v1', mode: 'voice' } }];
  assert.equal(matchRule(rules, 'where are you', {}, {}, now, 'c').rule.id, 'a');
  const cd = { 'a|c': now - 5 * 60000 };
  assert.deepEqual(matchRule(rules, 'where are you', {}, cd, now, 'c').rule, null);
  assert.equal(matchRule(rules, 'where are you', {}, cd, now, 'c').cooling.id, 'a');
  assert.equal(findRule(rules, 'where are you', {}, cd, now, 'c'), null);
  assert.equal(matchRule(rules, 'where are you', {}, { 'a|c': now - 11 * 60000 }, now, 'c').rule.id, 'a', 'after 10 min it answers again');
  assert.equal(matchRule(rules, 'hello', {}, cd, now, 'c').cooling, null, 'no match = not owned');
});

test('PTT payload: real voice note shape, no caption/header', () => {
  const audio = Buffer.from('x');
  const c = pttContent(audio, { secs: 4.4, waveform: [0, 50, 120, -3, 99.6] });
  assert.equal(c.ptt, true);
  assert.equal(c.mimetype, 'audio/ogg; codecs=opus');
  assert.equal(c.mimetype, PTT_MIME);
  assert.equal(c.audio, audio);
  assert.equal(c.seconds, 4);
  assert.ok(c.waveform instanceof Uint8Array);
  assert.deepEqual([...c.waveform], [0, 50, 100, 0, 100]);
  assert.equal(c.caption, undefined);
  assert.equal(c.text, undefined);
  assert.equal('seconds' in pttContent(audio, {}), false);
  assert.equal(contentText(c), '🎙️ Voice note');
});

test('Ogg/Opus: mux → read roundtrip, CRC, durations', () => {
  const pk = Array.from({ length: 150 }, (_, i) => packet(i));
  const ogg = muxOggOpus(pk, { channels: 1, preSkip: 312 });
  assert.equal(sniffAudio(ogg), 'ogg');
  assert.ok(isOggOpus(ogg));
  const r = readOgg(ogg);
  assert.equal(r.packets.length, 150);
  assert.deepEqual(r.packets.map((p) => Buffer.from(p).toString('hex')), pk.map((p) => Buffer.from(p).toString('hex')));
  assert.equal(r.channels, 1); assert.equal(r.preSkip, 312);
  assert.ok(Math.abs(r.seconds - (150 * 960 - 312) / 48000) < 1e-9);
  // every page CRC checks out
  let o = 0; const b = Buffer.from(ogg);
  while (o < b.length) {
    const segs = b[o + 26]; let len = 27 + segs; for (let i = 0; i < segs; i++) len += b[o + 27 + i];
    const pg = Buffer.from(b.subarray(o, o + len)); const crc = pg.readUInt32LE(22); pg.writeUInt32LE(0, 22);
    assert.equal(oggCrc(pg), crc); o += len;
  }
  assert.equal(opusPacketSamples(Uint8Array.of(0x98)), 960);
  assert.equal(opusPacketSamples(Uint8Array.of((0 << 3) | 1)), 960, 'SILK 10 ms × 2 frames');
  assert.equal(opusPacketSamples(Uint8Array.of((16 << 3) | 3, 4)), 480, 'CELT 2.5 ms × 4');
  assert.equal(isOggOpus(Buffer.from('ID3 not ogg')), false);
  assert.deepEqual(waveformOf(Float32Array.from([0, 0.5, 1, 0.25]), 4), [0, 50, 100, 25]);
});

test('WebM/Opus (what Chrome records) → Ogg/Opus without re-encoding', () => {
  const vint = (n) => { const b = Buffer.alloc(8); b[0] = 0x01; b.writeUIntBE(n, 2, 6); return b; };
  const unknown = Buffer.from([0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);
  const el = (id, data) => Buffer.concat([Buffer.from(id), vint(data.length), data]);
  const head = Buffer.from(readOgg(fakeOgg(1)).head);
  const ebml = el([0x1a, 0x45, 0xdf, 0xa3], el([0x42, 0x82], Buffer.from('webm')));
  const tracks = el([0x16, 0x54, 0xae, 0x6b], el([0xae], Buffer.concat([el([0xd7], Buffer.from([1])), el([0x86], Buffer.from('A_OPUS')), el([0x63, 0xa2], head), el([0xe1], el([0x9f], Buffer.from([1])))])));
  const pk = Array.from({ length: 6 }, (_, i) => Buffer.from(packet(i)));
  const simple = (p) => el([0xa3], Buffer.concat([Buffer.from([0x81, 0, 0, 0x80]), p]));
  const xiph = el([0xa3], Buffer.concat([Buffer.from([0x81, 0, 0, 0x82, 1, pk[4].length]), pk[4], pk[5]])); // 2 frames, Xiph lacing
  const cluster1 = Buffer.concat([Buffer.from([0x1f, 0x43, 0xb6, 0x75]), unknown, el([0xe7], Buffer.from([0])), simple(pk[0]), simple(pk[1])]);
  const cluster2 = Buffer.concat([Buffer.from([0x1f, 0x43, 0xb6, 0x75]), unknown, el([0xe7], Buffer.from([40])), el([0xa0], el([0xa1], Buffer.concat([Buffer.from([0x81, 0, 0, 0]), pk[2]]))), simple(pk[3]), xiph]);
  const webm = Buffer.concat([ebml, Buffer.from([0x18, 0x53, 0x80, 0x67]), unknown, tracks, cluster1, cluster2]);
  assert.equal(sniffAudio(webm), 'webm');
  const got = webmOpusPackets(webm);
  assert.deepEqual(got.packets.map((p) => Buffer.from(p).toString('hex')), pk.map((p) => p.toString('hex')));
  const ogg = webmToOgg(webm);
  assert.ok(isOggOpus(ogg));
  assert.equal(readOgg(ogg).packets.length, 6);
  assert.throws(() => webmOpusPackets(Buffer.from('nope')), /not a WebM/);
});

test('voice library: clips are stored ENCRYPTED, decrypt back byte-for-byte, replace keeps the id, delete', async () => {
  const git = fakeGit();
  const lib = newLib(git);
  const ogg = fakeOgg(120);
  const { meta, replaced } = await lib.save('Good  Morning ', ogg, { secs: 2, waveform: [1, 2, 3], by: 'whatsapp' });
  assert.equal(replaced, false);
  assert.equal(meta.name, 'Good Morning');
  assert.equal(meta.fmt, 'ogg');
  const files = [...git.branches['vr-voice'].keys()].sort();
  assert.deepEqual(files, ['README.md', clipPaths(meta.id).audio, clipPaths(meta.id).meta].sort());
  for (const f of files.filter((x) => x !== 'README.md')) {
    const raw = git.branches['vr-voice'].get(f).toString();
    assert.match(raw, /"vrenc":1/);
    assert.ok(!raw.includes('Good Morning') && !raw.includes('OggS') && !raw.includes('OpusHead') && !raw.includes(Buffer.from(ogg.subarray(0, 30)).toString('base64').slice(0, 20)), `${f} must be encrypted`);
  }
  assert.deepEqual(clipIdFromPath(clipPaths(meta.id).meta), { id: meta.id, part: 'meta' });
  // a fresh library (like the next run) reads it back
  const lib2 = newLib(git);
  await lib2.refresh();
  assert.equal(lib2.list().length, 1);
  const got = await lib2.get({ name: 'good morning' });
  assert.ok(Buffer.from(got.audio).equals(ogg), 'decrypted audio equals the original');
  assert.equal(got.meta.secs, Math.round(readOgg(ogg).seconds * 10) / 10);
  // wrong password → not listed, no crash
  const bad = new VoiceLibrary({ passphrase: 'wrong', git });
  await bad.refresh();
  assert.equal(bad.list().length, 0);
  // replace by name keeps the id (rules keep working)
  const r2 = await lib2.save('GOOD MORNING', fakeOgg(50));
  assert.equal(r2.replaced, true); assert.equal(r2.meta.id, meta.id);
  // limits
  await assert.rejects(lib2.save('long one', fakeOgg(61 * 50)), /too long/);
  await assert.rejects(lib2.save('', fakeOgg(5)), /name/);
  // delete
  assert.equal((await lib2.remove({ name: 'good morning' })).id, meta.id);
  assert.deepEqual([...git.branches['vr-voice'].keys()], ['README.md']);
  assert.equal(await lib2.remove({ name: 'nothing' }), null);
});

test('panel-uploaded file the browser could not convert ("raw") is converted once by the bot', async () => {
  const git = fakeGit();
  const lib = newLib(git);
  let calls = 0;
  lib.convert = async (bytes) => { calls++; if (sniffAudio(bytes) === 'ogg') return { ogg: Buffer.from(bytes), secs: 1, waveform: null }; return { ogg: fakeOgg(100), secs: 2, waveform: [5, 6] }; };
  // simulate the panel: raw mp3 bytes + meta fmt "raw"
  const { encryptBytes, encryptJSON } = await import('../panel/shared/crypto.js');
  const id = 'vpanel1';
  git.commitFiles('vr-voice', { [clipPaths(id).audio]: JSON.stringify(await encryptBytes(Buffer.from('ID3 fake mp3'), PASS)), [clipPaths(id).meta]: JSON.stringify(await encryptJSON({ v: 1, id, name: 'hello', fmt: 'raw', mime: 'audio/mpeg', secs: 2, by: 'panel' }, PASS)) });
  await lib.refresh();
  assert.equal(lib.find({ name: 'hello' }).fmt, 'raw', 'not ready until converted');
  assert.equal(await lib.get({ name: 'hello' }), null);
  await lib.idle();
  assert.equal(calls, 1);
  const c = await lib.get({ name: 'hello' });
  assert.ok(isOggOpus(c.audio));
  assert.equal(c.meta.fmt, 'ogg');
  const lib2 = newLib(git); await lib2.refresh(); await lib2.idle();
  assert.equal(lib2.find({ name: 'hello' }).fmt, 'ogg', 'converted version was saved back');
  await lib2.refresh(); await lib2.idle(); assert.equal(calls, 1, 'only once');
});

test('!voice save / list / play / delete from your own chat', async () => {
  const git = fakeGit();
  const voices = newLib(git);
  const h = harness({ voices });
  const ogg = fakeOgg(150);
  h.inc.download = async () => ogg; // the quoted voice note
  const selfChat = `${ME}@s.whatsapp.net`;
  const quoted = { audioMessage: { mimetype: 'audio/ogg; codecs=opus', ptt: true, seconds: 3, waveform: Buffer.from([1, 9, 30]), url: 'x', mediaKey: 'k' } };
  const cmd = (text, withQuote = false) => ({ key: { remoteJid: selfChat, id: 'C' + ++n, fromMe: true }, messageTimestamp: ts(), message: withQuote ? { extendedTextMessage: { text, contextInfo: { stanzaId: 'Q1', participant: selfChat, quotedMessage: quoted } } } : { conversation: text } });
  h.inc.push({ messages: [cmd('!voice save busy reply', true)] });
  await h.inc.drain();
  assert.equal(voices.list().length, 1);
  assert.equal(voices.list()[0].name, 'busy reply');
  assert.deepEqual(voices.list()[0].waveform, [1, 9, 30], 'waveform from WhatsApp kept');
  assert.match(h.sent.at(-1).content.text, /Voice clip "busy reply" saved/);
  // without replying to a voice note → help, nothing saved
  h.inc.push({ messages: [cmd('!voice save other')] });
  await h.inc.drain();
  assert.match(h.sent.at(-1).content.text, /Reply to a voice note/);
  h.inc.push({ messages: [cmd('!voice list')] });
  await h.inc.drain();
  assert.match(h.sent.at(-1).content.text, /busy reply — 0:03/);
  h.inc.push({ messages: [cmd('!voice play Busy Reply')] });
  await h.inc.drain();
  const play = h.sent.at(-1);
  assert.equal(play.content.ptt, true); assert.equal(play.jid, selfChat);
  assert.equal(play.opts.kind, 'voice'); assert.equal(play.opts.clip, 'busy reply');
  h.inc.push({ messages: [cmd('!voice delete busy reply')] });
  await h.inc.drain();
  assert.match(h.sent.at(-1).content.text, /Deleted voice clip "busy reply"/);
  assert.equal(voices.list().length, 0);
  assert.equal(parseVoiceCommand('').sub, 'list');
  assert.deepEqual(parseVoiceCommand('rm  Good   Night'), { sub: 'delete', name: 'Good Night' });
  assert.equal(parseVoiceCommand('whatever').sub, 'help');
  assert.match(voiceListText([]), /No voice clips yet/);
});

test('keyword rule answers with the voice clip as a real voice note; AI stays quiet; 10-min cooldown per clip', async () => {
  const git = fakeGit();
  const voices = newLib(git);
  const { meta } = await voices.save('where', fakeOgg(100), { waveform: [10, 20] });
  const rules = [
    { id: 'r1', match: 'word', pattern: 'where are you', voice: { clip: meta.id, name: 'where', mode: 'voice' }, where: 'private', people: 'all' },
    { id: 'r2', match: 'word', pattern: 'wya', voice: { clip: meta.id, name: 'where', mode: 'voice+text' }, reply: 'call you soon', where: 'private', people: 'all' },
  ];
  const h = harness({ rules, voices, settings: { features: { ai: true, autoReply: true }, ai: { who: 'everyone' } } });
  h.inc.push({ messages: [dm('919000000011', 'Bro WHERE are you??')] });
  await h.inc.drain();
  assert.equal(h.sent.length, 1);
  const s = h.sent[0];
  assert.equal(s.jid, '919000000011@s.whatsapp.net');
  assert.equal(s.content.ptt, true);
  assert.equal(s.content.mimetype, 'audio/ogg; codecs=opus');
  assert.equal(s.content.seconds, 2);
  assert.deepEqual([...s.content.waveform], [10, 20]);
  assert.equal(s.content.caption, undefined, 'no caption');
  assert.equal(s.opts.quoted, undefined, 'not a quoted reply — looks like a normal voice note');
  assert.equal(s.opts.kind, 'voice'); assert.equal(s.opts.cat, 'replies'); assert.equal(s.opts.clip, 'where');
  assert.deepEqual(h.aiCalls, [], 'the keyword rule wins over AI');
  // same person again within 10 min → nothing (and still no AI), other rule with the SAME clip also waits
  h.inc.push({ messages: [dm('919000000011', 'where are you'), dm('919000000011', 'wya')] });
  await h.inc.drain();
  assert.equal(h.sent.length, 1, JSON.stringify(h.sent.map((x) => x.content.text || 'voice')));
  assert.deepEqual(h.aiCalls, []);
  // another person gets it right away
  h.inc.push({ messages: [dm('919000000012', 'where are you')] });
  await h.inc.drain();
  assert.equal(h.sent.length, 2);
  // 11 minutes later: voice + text rule sends the clip, then the text
  for (const k of Object.keys(h.state.memory.cooldowns)) h.state.memory.cooldowns[k] -= 11 * 60000;
  for (const k of Object.keys(h.state.memory.voiceSent)) h.state.memory.voiceSent[k] -= 11 * 60000;
  h.inc.push({ messages: [dm('919000000011', 'wya')] });
  await h.inc.drain();
  assert.equal(h.sent.length, 4);
  assert.equal(h.sent[2].content.ptt, true);
  assert.equal(h.sent[3].content.text, 'call you soon');
  // a message no rule matches still goes to the AI
  h.inc.push({ messages: [dm('919000000013', 'hello there')] });
  await h.inc.drain();
  assert.deepEqual(h.aiCalls, ['hello there']);
});

test('voice rule respects people mode + never-reply list; missing clip falls through', async () => {
  const voices = newLib();
  const { meta } = await voices.save('gm', fakeOgg(20));
  const contacts = [{ id: 'c1', name: 'Amma', number: '919000000021' }, { id: 'c2', name: 'Vijay', number: '919000000022' }, { id: 'c3', name: 'Ravi', number: '919000000023' }];
  const rules = [{ id: 'r', match: 'word', pattern: 'gm', voice: { clip: meta.id, name: 'gm', mode: 'voice' }, where: 'private', people: 'pick', contacts: ['c1', 'c2'], exclude: ['c2'] }];
  const h = harness({ rules, contacts, voices, settings: { features: { ai: true } } });
  h.inc.push({ messages: [dm('919000000021', 'gm'), dm('919000000022', 'gm'), dm('919000000023', 'gm')] });
  await h.inc.drain();
  assert.deepEqual(h.sent.map((s) => s.jid), ['919000000021@s.whatsapp.net'], 'only Amma (Vijay blocked, Ravi not picked)');
  // clip deleted → the rule has nothing to send → AI may answer instead (no silent black hole)
  const h2 = harness({ rules: [{ id: 'x', match: 'word', pattern: 'yo', voice: { clip: 'gone', name: 'gone', mode: 'voice' }, where: 'private', people: 'all' }], voices, settings: { features: { ai: true }, ai: { who: 'everyone' } } });
  h2.inc.push({ messages: [dm('919000000031', 'yo')] });
  await h2.inc.drain();
  assert.equal(h2.sent.length, 0);
  assert.deepEqual(h2.aiCalls, ['yo']);
  assert.equal(findClip(voices.list(), { clip: 'nope', name: 'GM' }).id, meta.id, 'found by name when the id changed');
});

test('Sent log + notification: voice sends are kind "voice" with the clip name', () => {
  const state = { status: {}, memory: {} };
  const settings = withDefaults({});
  const nt = new Notifier({ getData: () => ({ settings, contacts: [{ id: 'c1', name: 'Mummy', number: '919000000041' }] }), state, me: () => ME });
  const e = nt.sent('919000000041@s.whatsapp.net', pttContent(Buffer.from('x'), { secs: 3 }), { kind: 'voice', cat: 'scheduled', label: '🎙️ Voice clip: good morning', clip: 'good morning' });
  assert.equal(e.kind, 'voice'); assert.equal(e.clip, 'good morning'); assert.equal(e.cat, 'scheduled'); assert.equal(e.to, 'Mummy');
  assert.equal(e.text, '🎙️ Voice clip: good morning');
  assert.equal(state.outbox.entries.length, 1);
  const box = { entries: [] }; appendSent(box, { kind: 'voice', clip: 'x', text: 'y' }); assert.equal(box.entries[0].clip, 'x');
});

test('schedules can send a voice clip (planner carries it to the job)', () => {
  const now = Date.parse('2026-11-02T01:30:00Z'); // 7:00 IST
  const sch = { id: 's1', name: 'GM Mummy', to: [{ type: 'contact', id: 'c1' }], message: '', time: '07:00', repeat: { type: 'daily' }, voice: { clip: 'v1', name: 'good morning', mode: 'voice' } };
  const data = { settings: withDefaults({ timezone: 'Asia/Kolkata', features: { summary: false, birthdays: false, festivals: false } }), contacts: [{ id: 'c1', name: 'Mummy', number: '919000000041' }], schedules: [sch, { ...sch, id: 's2', voice: undefined, message: 'hi' }], templates: [], festivals: {}, groups: [], memory: {}, ownerNumber: ME };
  const jobs = buildJobs(data, now - 60000, now + 60000);
  const j1 = jobs.find((j) => j.sourceId === 's1');
  assert.deepEqual(j1.voice, sch.voice);
  assert.equal(voicePlan(j1).voice, true);
  assert.equal(jobs.find((j) => j.sourceId === 's2').voice, undefined);
});

test('dry run: clip on the vr-voice branch → keyword rule + schedule send it; Sent log says "voice"', { timeout: 120000 }, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vrvoice-'));
  const sh = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: 'utf8', ...opts });
  const origin = path.join(tmp, 'origin.git'), work = path.join(tmp, 'work');
  sh('git', ['init', '-q', '--bare', origin]);
  fs.mkdirSync(work);
  for (const d of ['src', 'panel']) fs.cpSync(path.join(REPO, d), path.join(work, d), { recursive: true });
  fs.copyFileSync(path.join(REPO, 'package.json'), path.join(work, 'package.json'));
  fs.symlinkSync(path.join(REPO, 'node_modules'), path.join(work, 'node_modules'));
  sh('git', ['init', '-q', '-b', 'main'], { cwd: work });
  sh('git', ['remote', 'add', 'origin', origin], { cwd: work });
  const env = { ...process.env, VR_FAKE_WA: '1', VR_PASSPHRASE: PASS, OWNER_NUMBER: '917989405979', GITHUB_ACTIONS: '' };
  // 1) save a clip exactly like "!voice save" does (real git, pushed to origin/vr-voice)
  const mk = sh(process.execPath, ['--input-type=module', '-e', `
    import { VoiceLibrary } from './src/features/voice.js';
    import { muxOggOpus } from './panel/shared/ogg.js';
    const pk = Array.from({ length: 100 }, (_, i) => Uint8Array.from([0x98, i, 1, 2, 3, 4, 5]));
    const lib = new VoiceLibrary({ passphrase: process.env.VR_PASSPHRASE });
    const r = await lib.save('on my way', Buffer.from(muxOggOpus(pk, { channels: 1 })));
    console.log('ID=' + r.meta.id);`], { cwd: work, env });
  assert.equal(mk.status, 0, mk.stdout + mk.stderr);
  const id = mk.stdout.match(/ID=(\w+)/)[1];
  const branchFiles = sh('git', ['--git-dir', origin, 'ls-tree', '-r', '--name-only', 'vr-voice']).stdout.split('\n').filter(Boolean).sort();
  assert.deepEqual(branchFiles, ['README.md', `voice/${id}.audio.json`, `voice/${id}.meta.json`]);
  const rawAudio = sh('git', ['--git-dir', origin, 'show', `vr-voice:voice/${id}.audio.json`]).stdout;
  const rawMeta = sh('git', ['--git-dir', origin, 'show', `vr-voice:voice/${id}.meta.json`]).stdout;
  assert.ok(rawAudio.includes('"vrenc":1') && !rawAudio.includes('OggS'));
  assert.ok(!rawMeta.includes('on my way'), 'clip name is encrypted too');
  // 2) a run with a voice rule + a voice schedule
  const tz = 'Asia/Kolkata';
  const { localDate, localTime } = await import('../panel/shared/time.js');
  const overdue = Date.now() - 5 * 60000;
  const data = {
    settings: { timezone: tz, features: { summary: false, alerts: false, birthdays: false, festivals: false }, timing: { minOnlineSeconds: 1, lookaheadMinutes: 1 } },
    contacts: { contacts: [{ id: 'c1', name: 'Ravi Kumar', number: '+91 90000 00003' }] },
    schedules: { schedules: [{ id: 's1', name: 'Voice hello', to: [{ type: 'contact', id: 'c1' }], message: 'see you {first_name}', time: localTime(overdue, tz), repeat: { type: 'once', date: localDate(overdue, tz) }, voice: { clip: id, name: 'on my way', mode: 'voice+text' } }] },
    templates: { templates: [] }, festivals: {}, groups: { groups: {} },
    rules: { rules: [{ id: 'rv', match: 'word', pattern: 'where are you', where: 'private', people: 'all', voice: { clip: id, name: 'on my way', mode: 'voice' } }] },
  };
  fs.mkdirSync(path.join(work, 'data'));
  for (const [k, v] of Object.entries(data)) fs.writeFileSync(path.join(work, 'data', `${k}.json`), JSON.stringify(v));
  const inbox = [{ key: { remoteJid: '919000000003@s.whatsapp.net', id: 'IN1', fromMe: false }, messageTimestamp: Math.floor(Date.now() / 1000) - 60, pushName: 'Ravi', message: { conversation: 'bro where are you?' } }];
  fs.writeFileSync(path.join(tmp, 'inbox.json'), JSON.stringify(inbox));
  const run1 = sh(process.execPath, ['src/index.js', 'run'], { cwd: work, env: { ...env, VR_FAKE_INBOX: path.join(tmp, 'inbox.json') } });
  assert.equal(run1.status, 0, run1.stdout + run1.stderr);
  assert.equal((run1.stdout.match(/\(dry-run\) would send/g) || []).length, 3, run1.stdout); // schedule: voice + text, rule: voice
  assert.ok(!run1.stdout.includes('on my way'), 'public log never shows the clip name');
  const save1 = sh(process.execPath, ['src/index.js', 'save'], { cwd: work, env });
  assert.equal(save1.status, 0, save1.stdout + save1.stderr);
  const outbox = await decryptJSON(JSON.parse(sh('git', ['--git-dir', origin, 'show', 'vr-state:outbox.json']).stdout), PASS);
  const rows = outbox.entries.map((e) => [e.cat, e.kind, e.clip || '', e.text]).sort();
  assert.deepEqual(rows, [
    ['replies', 'voice', 'on my way', '🎙️ Voice clip: on my way'],
    ['scheduled', 'personal', '', 'see you Ravi'],
    ['scheduled', 'voice', 'on my way', '🎙️ Voice clip: on my way'],
  ]);
  fs.rmSync(tmp, { recursive: true, force: true });
});
