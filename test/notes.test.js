// 📝 Notes: "!note", "!notes", "!note delete <n>", reply-to-save, encrypted vr-notes branch. © VR DEVELOPMENTS
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { parseNoteCommand, notesListText, messageNoteText, isForwardedContent, linksIn, linkParts, searchNotes, sortNotes, cleanNoteText, notePath, noteIdFromPath, newNoteId, NOTES_BRANCH } from '../panel/shared/notes.js';
import { decryptJSON, isEnvelope } from '../panel/shared/crypto.js';
import { withDefaults } from '../panel/shared/defaults.js';
import { helpText } from '../src/features/commands.js';

process.env.OWNER_NUMBER = '919999999999';
const { Incoming } = await import('../src/incoming.js');
const { NotesBook } = await import('../src/features/notes.js');

const PASS = 'test-pass';
const ME = '919999999999';
const G1 = '120363000000000001@g.us';

/** An in-memory git branch store with the same functions as src/gitstate.js. */
function fakeGit() {
  const branches = new Map();
  const sha = (b) => createHash('sha1').update(b).digest('hex');
  return {
    branches, pushes: 0,
    fetchBranch: (b) => branches.has(b),
    listFiles: (b) => [...(branches.get(b) || new Map())].map(([path, buf]) => ({ path, size: buf.length, sha: sha(buf) })),
    readFile: (b, p) => branches.get(b)?.get(p) || null,
    commitFiles(b, files, msg, { mode, remove = [] } = {}) {
      assert.equal(mode, 'append', 'notes never force-push');
      const m = new Map(branches.get(b) || []);
      for (const p of remove) m.delete(p);
      for (const [p, c] of Object.entries(files)) m.set(p, Buffer.from(c));
      branches.set(b, m); this.pushes++;
      return 'c' + this.pushes;
    },
  };
}

/* ---------------- shared helpers ---------------- */
test('notes: command parsing', () => {
  assert.deepEqual(parseNoteCommand('note', 'buy charger'), { sub: 'add', text: 'buy charger' });
  assert.deepEqual(parseNoteCommand('note', ''), { sub: 'add', text: '' });
  assert.deepEqual(parseNoteCommand('note', 'delete 3'), { sub: 'delete', n: 3 });
  assert.deepEqual(parseNoteCommand('note', 'del #12'), { sub: 'delete', n: 12 });
  assert.deepEqual(parseNoteCommand('note', 'delete'), { sub: 'delete', n: 0 });
  assert.deepEqual(parseNoteCommand('note', 'delete old files from laptop'), { sub: 'add', text: 'delete old files from laptop' }, 'a sentence starting with "delete" is a note');
  assert.deepEqual(parseNoteCommand('notes', ''), { sub: 'list', page: 1 });
  assert.deepEqual(parseNoteCommand('notes', '2'), { sub: 'list', page: 2 });
  assert.deepEqual(parseNoteCommand('notes', 'cricket tickets'), { sub: 'find', q: 'cricket tickets' });
  assert.deepEqual(parseNoteCommand('notes', 'find exam'), { sub: 'find', q: 'exam' });
  assert.deepEqual(parseNoteCommand('notes', 'delete 2'), { sub: 'delete', n: 2 });
  assert.deepEqual(parseNoteCommand('note', 'help'), { sub: 'help' });
});

test('notes: paths, ids, text cleaning, sort and search', () => {
  const id = newNoteId(1700000000000);
  assert.match(id, /^n[a-z0-9]+$/);
  assert.equal(noteIdFromPath(notePath(id)), id);
  assert.equal(noteIdFromPath('voice/x.meta.json'), null);
  assert.equal(noteIdFromPath('notes/../x.json'), null);
  assert.equal(cleanNoteText('  a  \r\n\n\n\nb \n'), 'a\n\nb');
  assert.equal(cleanNoteText('x'.repeat(5000)).length, 4000);
  const list = [{ id: 'a', text: 'Buy charger', at: 1 }, { id: 'b', text: 'Cricket tickets link', from: 'Ravi', at: 3 }, { id: 'c', text: 'exam on monday', at: 2 }];
  assert.deepEqual(sortNotes(list).map((n) => n.id), ['b', 'c', 'a']);
  assert.deepEqual(searchNotes(list, 'ravi').map((n) => n.id), ['b']);
  assert.deepEqual(searchNotes(list, 'EXAM monday').map((n) => n.id), ['c']);
  assert.deepEqual(searchNotes(list, '').map((n) => n.id), ['b', 'c', 'a']);
});

test('notes: links are found (https, www, bare domains), e-mails are not; linkParts rebuilds the text', () => {
  assert.deepEqual(linksIn('see https://youtu.be/abc?t=1, and www.github.com/x.').map((l) => l.href), ['https://youtu.be/abc?t=1', 'https://www.github.com/x']);
  assert.deepEqual(linksIn('mail me: a@gmail.com').map((l) => l.href), []);
  assert.deepEqual(linksIn('vrdevelopments.sites.tab.bot is my site').map((l) => l.href), ['https://vrdevelopments.sites.tab.bot']);
  const t = 'Look: https://x.com/a (cool)';
  const parts = linkParts(t);
  assert.equal(parts.map((p) => p.text).join(''), t);
  assert.deepEqual(parts.filter((p) => p.href).map((p) => p.href), ['https://x.com/a']);
  assert.ok(!linkParts('javascript:alert(1)').some((p) => p.href), 'only http(s) links');
});

test('notes: text of any message (text, link preview, captions, media, location, poll, forwarded)', () => {
  assert.deepEqual(messageNoteText({ conversation: 'hello' }), { text: 'hello', kind: 'text' });
  assert.deepEqual(messageNoteText({ conversation: 'https://youtu.be/x' }), { text: 'https://youtu.be/x', kind: 'link' });
  assert.deepEqual(messageNoteText({ extendedTextMessage: { text: 'watch this', matchedText: 'https://youtu.be/y', title: 'Cool video' } }), { text: 'Cool video\nwatch this\nhttps://youtu.be/y', kind: 'link' });
  assert.deepEqual(messageNoteText({ imageMessage: { caption: 'timetable' } }), { text: 'timetable', kind: 'image' });
  assert.deepEqual(messageNoteText({ imageMessage: {} }), { text: '📷 Photo', kind: 'image' });
  assert.equal(messageNoteText({ documentMessage: { fileName: 'notes.pdf' } }).text, 'notes.pdf');
  assert.equal(messageNoteText({ audioMessage: { ptt: true, seconds: 12 } }).text, '🎤 Voice note (12s)');
  assert.match(messageNoteText({ locationMessage: { degreesLatitude: 17.38, degreesLongitude: 78.48, name: 'Charminar' } }).text, /Charminar\nhttps:\/\/maps\.google\.com\/\?q=17\.38,78\.48/);
  assert.equal(messageNoteText({ pollCreationMessageV3: { name: 'Lunch?', options: [{ optionName: 'Biryani' }, { optionName: 'Dosa' }] } }).text, '📊 Lunch?\n• Biryani\n• Dosa');
  assert.deepEqual(messageNoteText(null), { text: '', kind: '' });
  assert.equal(isForwardedContent({ extendedTextMessage: { text: 'x', contextInfo: { isForwarded: true, forwardingScore: 1 } } }), true);
  assert.equal(isForwardedContent({ conversation: 'x' }), false);
});

test('notes: "!notes" list text — newest first, numbered, 10 per page, search keeps the real numbers', () => {
  const list = Array.from({ length: 12 }, (_, i) => ({ id: `n${i}`, text: `note number ${i}`, at: 1000 + i, from: i === 11 ? 'Ravi' : 'me' }));
  const t = notesListText(list, { fmt: () => 'T' });
  assert.match(t, /^📝 \*Your notes\* \(12 · page 1\/2\)/);
  assert.match(t, /\*1\.\* note number 11\n {4}_T · from Ravi_/);
  assert.match(t, /\*10\.\* note number 2\n/);
  assert.ok(!t.includes('note number 1\n'), 'only 10 on page 1');
  assert.match(t, /More: !notes 2/);
  assert.match(notesListText(list, { page: 2, fmt: () => 'T' }), /\*12\.\* note number 0/);
  const f = notesListText(list, { q: 'number 3', fmt: () => 'T' });
  assert.match(f, /Notes with "number 3"/);
  assert.match(f, /\*9\.\* note number 3/, 'number = position in the full list, so "!note delete 9" deletes it');
  assert.match(notesListText([], {}), /No notes yet/);
});

/* ---------------- the notes book (encrypted, vr-notes branch) ---------------- */
test('notes: NotesBook saves each note ENCRYPTED as its own file on vr-notes (append, never main), deletes by number', async () => {
  const git = fakeGit();
  const book = new NotesBook({ passphrase: PASS, git, noPush: false });
  const a = await book.add({ text: 'buy charger' });
  await new Promise((r) => setTimeout(r, 2));
  const b = await book.add({ text: 'https://youtu.be/x', from: 'Ravi', fromNum: '919000000002', kind: 'link' });
  const files = git.branches.get(NOTES_BRANCH);
  assert.ok(files, 'branch is vr-notes');
  assert.deepEqual([...files.keys()].sort(), ['README.md', notePath(a.id), notePath(b.id)].sort());
  const raw = files.get(notePath(b.id)).toString();
  assert.ok(!raw.includes('youtu') && !raw.includes('Ravi') && !raw.includes('9190000'), 'nothing readable in the public repo');
  const env = JSON.parse(raw);
  assert.ok(isEnvelope(env));
  assert.equal((await decryptJSON(env, PASS)).text, 'https://youtu.be/x');
  // a fresh bot run reads them back
  const book2 = new NotesBook({ passphrase: PASS, git, noPush: false });
  const list = await book2.refresh();
  assert.deepEqual(list.map((n) => n.text), ['https://youtu.be/x', 'buy charger']);
  assert.equal(list[0].from, 'Ravi');
  // a note the panel added in the meantime shows up too (one file per note = no overwrite)
  const panelNote = { v: 1, id: 'npanel1', text: 'from the panel', from: 'me', kind: 'text', at: Date.now() + 5, by: 'panel' };
  const { encryptJSON } = await import('../panel/shared/crypto.js');
  files.set(notePath('npanel1'), Buffer.from(JSON.stringify(await encryptJSON(panelNote, PASS))));
  assert.equal((await book2.refresh())[0].text, 'from the panel');
  const gone = await book2.removeAt(2);
  assert.equal(gone.text, 'https://youtu.be/x');
  assert.ok(!git.branches.get(NOTES_BRANCH).has(notePath(b.id)));
  assert.equal(await book2.removeAt(9), null);
  await assert.rejects(book2.add({ text: '   ' }), /empty/);
  // wrong password → that note is skipped, not a crash
  const bad = new NotesBook({ passphrase: 'wrong', git, noPush: false });
  assert.deepEqual(await bad.refresh(), []);
});

/* ---------------- the bot: !note in WhatsApp ---------------- */
const HDR = /^🤖 \*VR Bot\* is sending:\n/;
function harness({ settings = {}, contacts = [] } = {}) {
  const sent = [];
  const git = fakeGit();
  const notes = new NotesBook({ passphrase: PASS, git, noPush: false });
  const wa = { me: () => ME, isMe: (j) => String(j || '').startsWith(ME), pnFor: async (jid, alt) => String(alt || jid || '').split('@')[0].split(':')[0], sock: { user: { id: `${ME}@s.whatsapp.net` } } };
  const state = {
    memory: { processed: [], sentIds: [], lastOut: {}, lastIn: {}, cooldowns: {}, aiCount: {}, ai: {}, awaySent: {}, warns: {} },
    status: { inbox: {}, groups: [{ id: G1, name: 'AIML' }] },
  };
  const data = { settings: withDefaults({ version: 2, ...settings }), rules: [], contacts, groupsCfg: {} };
  const inc = new Incoming({ wa, getData: () => data, state, notes, send: async (jid, content, opts) => { sent.push({ jid, text: (content.text || '').replace(HDR, ''), opts }); return { key: { id: 'S' + sent.length } }; }, media: null });
  return { inc, sent, state, data, notes, git };
}
let n = 0;
const ts = () => Math.floor(Date.now() / 1000) - 30;
const SELF = `${ME}@s.whatsapp.net`;
const mine = (text, chat = SELF) => ({ key: { remoteJid: chat, id: 'C' + ++n, fromMe: true }, messageTimestamp: ts(), message: { conversation: text } });
const reply = (text, quoted, participant, chat = SELF) => ({ key: { remoteJid: chat, id: 'C' + ++n, fromMe: true }, messageTimestamp: ts(), message: { extendedTextMessage: { text, contextInfo: { stanzaId: 'Q' + n, participant, quotedMessage: quoted } } } });
const dm = (num, text) => ({ key: { remoteJid: `${num}@s.whatsapp.net`, id: 'C' + ++n, fromMe: false }, messageTimestamp: ts(), message: { conversation: text } });
const run = async (h, ...messages) => { h.inc.push({ messages }); await h.inc.drain(); };
const contacts = [{ id: 'c2', name: 'Ravi', number: '+91 90000 00002' }];
const RAVI = '919000000002';

test('!note <text> saves (line breaks kept), !notes lists, !note delete <n> removes — answers in your own chat', async () => {
  const h = harness({ contacts });
  await run(h, mine('!note buy charger\nand a cable'));
  assert.equal(h.sent.at(-1).jid, SELF);
  assert.match(h.sent.at(-1).text, /^📝 Saved: "buy charger and a cable"\nYou have 1 note/);
  assert.equal(h.sent.at(-1).opts.kind, 'alert');
  assert.equal(h.notes.list()[0].text, 'buy charger\nand a cable');
  await run(h, mine('!note https://youtu.be/abc'));
  assert.equal(h.notes.list()[0].kind, 'link');
  await run(h, mine('!notes'));
  assert.match(h.sent.at(-1).text, /^📝 \*Your notes\* \(2\)\n\*1\.\* https:\/\/youtu\.be\/abc\n {4}_\d\d\/\d\d \d\d:\d\d_\n\*2\.\* buy charger and a cable/);
  await run(h, mine('!notes charger'));
  assert.match(h.sent.at(-1).text, /Notes with "charger"\* \(1\)\n\*2\.\* buy charger/);
  await run(h, mine('!note delete 2'));
  assert.match(h.sent.at(-1).text, /^🗑️ Deleted note 2: "buy charger and a cable"/);
  assert.equal(h.notes.list().length, 1);
  await run(h, mine('!note delete 7'));
  assert.match(h.sent.at(-1).text, /No note 7/);
  await run(h, mine('!note'));
  assert.match(h.sent.at(-1).text, /Type the note after the command/);
  await run(h, mine('!note help'));
  assert.match(h.sent.at(-1).text, /Reply !note to any message/);
});

test('reply "!note" to a message: saves its text/caption + who sent it; forwarded is marked; your words go first', async () => {
  const h = harness({ contacts });
  // in Ravi's chat, replying to Ravi's link → saved, the ✅ goes to YOUR chat (Ravi gets nothing)
  await run(h, reply('!note', { extendedTextMessage: { text: 'match tickets', matchedText: 'https://bookmyshow.com/x' } }, `${RAVI}@s.whatsapp.net`, `${RAVI}@s.whatsapp.net`));
  assert.equal(h.sent.length, 1);
  assert.equal(h.sent[0].jid, SELF, 'confirmation only in your own chat');
  assert.match(h.sent[0].text, /^📝 Saved \(from Ravi\): "match tickets https:\/\/bookmyshow\.com\/x"/);
  let note = h.notes.list()[0];
  assert.deepEqual([note.from, note.fromNum, note.kind, note.text], ['Ravi', RAVI, 'link', 'match tickets\nhttps://bookmyshow.com/x']);
  assert.ok(note.at > 0, 'saved time');
  // a forwarded message in your own chat
  await run(h, reply('!note exam', { extendedTextMessage: { text: 'Exam on 5th Nov, room 204', contextInfo: { isForwarded: true, forwardingScore: 1 } } }, SELF));
  note = h.notes.list()[0];
  assert.equal(note.from, 'forwarded');
  assert.equal(note.text, 'exam\n\nExam on 5th Nov, room 204');
  assert.match(h.sent.at(-1).text, /Saved \(forwarded\)/);
  // a photo with a caption from an unknown number in a group
  await run(h, reply('!note', { imageMessage: { caption: 'timetable' } }, '918888888888@s.whatsapp.net', G1));
  note = h.notes.list()[0];
  assert.deepEqual([note.text, note.kind, note.from, note.chat], ['timetable', 'image', '+918888888888', 'AIML']);
  assert.equal(h.sent.at(-1).jid, SELF);
  // a sticker has no text → nothing saved
  const before = h.notes.list().length;
  await run(h, reply('!note', { stickerMessage: {} }, SELF));
  assert.equal(h.notes.list().length, before + 1, 'stickers save as "🙂 Sticker"');
  await run(h, reply('!note', { reactionMessage: {} }, SELF));
  assert.match(h.sent.at(-1).text, /no text I can save/);
});

test('!notes / !note delete typed in someone else\'s chat never show your notes there; friends can\'t use !note', async () => {
  const h = harness({ contacts });
  await run(h, mine('!note secret plan'));
  await run(h, mine('!notes', `${RAVI}@s.whatsapp.net`));
  assert.equal(h.sent.at(-1).jid, SELF);
  const k = h.sent.length;
  await run(h, dm(RAVI, '!notes'), dm(RAVI, '!note hack'));
  assert.ok(h.sent.slice(k).every((s) => !/secret plan|Saved/.test(s.text)), JSON.stringify(h.sent.slice(k)));
  assert.equal(h.notes.list().length, 1);
});

test('notes: in !help (owner only); the bot works without a notes book', async () => {
  assert.match(helpText(withDefaults({}), true), /!note <text>/);
  assert.ok(!helpText(withDefaults({}), false).includes('!note'));
  const h = harness();
  h.inc.notes = null;
  await run(h, mine('!note x'));
  assert.match(h.sent.at(-1).text, /not available/);
});
