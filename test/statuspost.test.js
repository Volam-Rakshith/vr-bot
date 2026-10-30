// Status posting that really shows up: one kind of id per try (never mixed), you always in, server answer checked,
// pictures as JPEG. © VR DEVELOPMENTS
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import sharp from 'sharp';
import {
  personJid, statusRecipients, variantOrder, AckWatch, postStatusChecked, asJpeg, prepareStatusContent,
  withoutReporting, describeStatusResult, STATUS_JID,
} from '../src/statuspost.js';
import { statusAudience } from '../panel/shared/status.js';
import { withDefaults } from '../panel/shared/defaults.js';

const ME = { id: '917989405979:12@s.whatsapp.net', lid: '123456789012345:12@lid' };

test('personJid: device / agent suffix removed, digits and c.us normalised, groups/broadcasts refused', () => {
  assert.equal(personJid('917989405979:12@s.whatsapp.net'), '917989405979@s.whatsapp.net');
  assert.equal(personJid('123456789012345:3@lid'), '123456789012345@lid');
  assert.equal(personJid('917989405979_1:2@s.whatsapp.net'), '917989405979@s.whatsapp.net');
  assert.equal(personJid('+91 79894 05979'), '917989405979@s.whatsapp.net');
  assert.equal(personJid('917989405979@c.us'), '917989405979@s.whatsapp.net');
  assert.equal(personJid('120363000000000000@g.us'), '');
  assert.equal(personJid('status@broadcast'), '');
  assert.equal(personJid(''), '');
});

test('statusRecipients: you first, normalised, deduped — and never a mix of phone-number and LID ids', () => {
  const numbers = ['917989405979', '919848000001', '+91 98480 00001', '919848000003'];
  const pn = statusRecipients({ me: ME, numbers, mode: 'pn' });
  assert.deepEqual(pn.jids, ['917989405979@s.whatsapp.net', '919848000001@s.whatsapp.net', '919848000003@s.whatsapp.net']);
  const lidOf = new Map([['919848000001@s.whatsapp.net', '555000000000001:4@lid']]);
  const lid = statusRecipients({ me: ME, numbers, mode: 'lid', lidOf });
  assert.deepEqual(lid.jids, ['123456789012345@lid', '555000000000001@lid'], 'own LID without device suffix + resolved contact');
  assert.deepEqual(lid.dropped, ['919848000003@s.whatsapp.net'], 'unresolved contact left out, not mixed in');
  for (const r of [pn, lid]) {
    const servers = new Set(r.jids.map((j) => j.split('@')[1]));
    assert.equal(servers.size, 1, `one kind of id only: ${r.jids}`);
    assert.ok(r.jids.every((j) => !j.includes(':')), 'no device suffixes');
  }
  // self-only test: exactly your own id
  assert.deepEqual(statusRecipients({ me: ME, numbers: ['917989405979'], mode: 'pn' }).jids, ['917989405979@s.whatsapp.net']);
  assert.deepEqual(statusRecipients({ me: ME, numbers: ['917989405979'], mode: 'lid' }).jids, ['123456789012345@lid']);
  // a different owner phone (bot runs on another number) is a normal recipient
  assert.deepEqual(statusRecipients({ me: { id: '919999999999:3@s.whatsapp.net' }, numbers: ['917989405979', '919999999999'], mode: 'pn' }).jids, ['919999999999@s.whatsapp.net', '917989405979@s.whatsapp.net']);
  assert.throws(() => statusRecipients({ me: { id: ME.id }, numbers: [], mode: 'lid' }), /no LID/);
});

test('variantOrder: LID first when the account has one, the remembered way first next time', () => {
  assert.deepEqual(variantOrder({ hasLid: true }).map((v) => v.id), ['lid', 'pn', 'lid-plain', 'pn-plain']);
  assert.deepEqual(variantOrder({ hasLid: false }).map((v) => v.id), ['pn', 'pn-plain']);
  assert.deepEqual(variantOrder({ hasLid: true, remembered: 'pn' }).map((v) => v.id), ['pn', 'lid', 'lid-plain', 'pn-plain']);
});

/** A fake Baileys socket whose "server" answers each relayed status with an ack (error per the rule given). */
function fakeSock({ answer = () => '', lids = {}, me = ME, silentServer = false, receipt = false } = {}) {
  const ws = new EventEmitter();
  const relayed = [];
  const sock = {
    ws, user: me,
    signalRepository: { lidMapping: { getLIDsForPNs: async (pns) => pns.filter((p) => lids[p]).map((p) => ({ pn: p, lid: lids[p] })) } },
    relayMessage: async (jid, message, opts) => {
      relayed.push({ jid, message, opts });
      if (silentServer) return opts.messageId;
      const err = answer(opts.statusJidList, message, relayed.length);
      setTimeout(() => {
        ws.emit('CB:ack,class:message', { tag: 'ack', attrs: { class: 'message', id: opts.messageId, from: STATUS_JID, ...(err ? { error: err } : {}) } });
        if (!err && receipt) ws.emit('CB:receipt', { tag: 'receipt', attrs: { id: opts.messageId, from: '917989405979@s.whatsapp.net', participant: '917989405979@s.whatsapp.net' } });
      }, 5);
      return opts.messageId;
    },
  };
  return { sock, relayed };
}
const deps = (sock) => {
  const watch = new AckWatch(); watch.attach(sock.ws);
  let n = 0;
  return { sock, watch, build: async (c) => ({ extendedTextMessage: { text: c.text }, messageContextInfo: { messageSecret: Buffer.alloc(32, 1) } }), newId: () => `ID${++n}`, log: { warn() {} } };
};
const quick = { ackWaitMs: 300, receiptWaitMs: 100 };

test('postStatusChecked: accepted on the first try → "accepted", audience in LID ids incl. your own LID', async () => {
  const { sock, relayed } = fakeSock({ lids: { '919848000001@s.whatsapp.net': '555000000000001@lid' }, receipt: true });
  const r = await postStatusChecked(deps(sock), { text: 'hi' }, { numbers: ['917989405979', '919848000001'], ...quick });
  assert.equal(r.state, 'accepted'); assert.equal(r.variant, 'lid'); assert.equal(r.delivered, true);
  assert.equal(relayed.length, 1);
  assert.equal(relayed[0].jid, 'status@broadcast');
  assert.deepEqual(relayed[0].opts.statusJidList, ['123456789012345@lid', '555000000000001@lid']);
  assert.match(describeStatusResult(r), /WhatsApp accepted it and a phone confirmed delivery/);
});

test('postStatusChecked: server rejects (479) → next way; all rejected → "rejected", nothing claimed', async () => {
  // rejects LID lists, accepts phone-number lists
  const a = fakeSock({ answer: (list) => (list[0].endsWith('@lid') ? '479' : '') });
  const mem = {};
  const r = await postStatusChecked(deps(a.sock), { text: 'hi' }, { numbers: ['917989405979'], ...quick });
  assert.equal(r.state, 'accepted'); assert.equal(r.variant, 'pn');
  assert.deepEqual(r.tries.map((t) => t.result), ['rejected', 'accepted']);
  assert.deepEqual(a.relayed[1].opts.statusJidList, ['917989405979@s.whatsapp.net']);
  assert.notEqual(a.relayed[0].opts.messageId, a.relayed[1].opts.messageId, 'each try is a new message id');
  // remembered way goes first next time
  mem.statusWay = r.variant;
  const a2 = fakeSock({ answer: (list) => (list[0].endsWith('@lid') ? '479' : '') });
  const r2 = await postStatusChecked(deps(a2.sock), { text: 'hi' }, { numbers: ['917989405979'], remembered: mem.statusWay, ...quick });
  assert.equal(a2.relayed.length, 1); assert.equal(r2.variant, 'pn');
  // reporting-token-free tries really drop the secret
  const b = fakeSock({ answer: (l, msg) => (msg.messageContextInfo?.messageSecret ? '479' : '') });
  const rb = await postStatusChecked(deps(b.sock), { text: 'hi' }, { numbers: [], ...quick });
  assert.equal(rb.variant, 'lid-plain'); assert.equal(b.relayed.length, 3);
  // everything rejected
  const c = fakeSock({ answer: () => '479' });
  const rc = await postStatusChecked(deps(c.sock), { text: 'hi' }, { numbers: [], ...quick });
  assert.equal(rc.state, 'rejected'); assert.equal(c.relayed.length, 4);
  assert.match(describeStatusResult(rc), /REJECTED .*error 479.*nothing was posted/);
});

test('postStatusChecked: no answer from the server → "unknown" and NO second try (could double-post)', async () => {
  const { sock, relayed } = fakeSock({ silentServer: true });
  const r = await postStatusChecked(deps(sock), { text: 'hi' }, { numbers: [], ...quick });
  assert.equal(r.state, 'unknown'); assert.equal(relayed.length, 1);
});

test('asJpeg / prepareStatusContent: PNG cards go out as real JPEG with an image/jpeg label', async () => {
  const png = await sharp({ create: { width: 108, height: 192, channels: 4, background: '#123456' } }).png().toBuffer();
  const jpg = await asJpeg(png);
  assert.equal(jpg[0], 0xff); assert.equal(jpg[1], 0xd8);
  assert.equal((await sharp(jpg).metadata()).format, 'jpeg');
  assert.equal(await asJpeg(jpg), jpg, 'JPEG stays as it is');
  const c = await prepareStatusContent({ image: png, caption: 'Happy Diwali' });
  assert.equal(c.mimetype, 'image/jpeg'); assert.equal(c.caption, 'Happy Diwali'); assert.equal(c.image[0], 0xff);
  // a photo link is downloaded and converted too
  const viaUrl = await prepareStatusContent({ image: { url: 'https://example.com/a.png' } }, { fetchImpl: async () => ({ ok: true, arrayBuffer: async () => png }) });
  assert.equal(viaUrl.image[0], 0xff);
  // broken link → left for Baileys; text untouched
  const broken = await prepareStatusContent({ image: { url: 'https://example.com/x.png' } }, { fetchImpl: async () => { throw new Error('down'); } });
  assert.deepEqual(broken.image, { url: 'https://example.com/x.png' });
  assert.deepEqual(await prepareStatusContent({ text: 'hi' }), { text: 'hi' });
  const m = withoutReporting({ imageMessage: {}, messageContextInfo: { messageSecret: Buffer.alloc(32), other: 1 } });
  assert.equal(m.messageContextInfo.messageSecret, undefined); assert.equal(m.messageContextInfo.other, 1);
});

test('statusAudience test mode: only you, plus the ONE optional test person (never the whole list)', () => {
  const people = [{ id: 'c1', name: 'Amma', number: '+91 98480 00001' }, { id: 'c2', name: 'Ravi', number: '+91 98480 00003' }, { id: 'ex', name: 'Example', number: '919000000000', example: true }];
  assert.deepEqual(statusAudience({ audience: 'all' }, { contacts: people, owner: '917989405979', testOnly: true }).numbers, ['917989405979']);
  const t = statusAudience({ audience: 'all', testWith: 'c2' }, { contacts: people, owner: ['917989405979', '917989405979'], testOnly: true });
  assert.deepEqual(t.numbers, ['917989405979', '919848000003']); assert.equal(t.self, 1);
  assert.deepEqual(statusAudience({ testWith: 'ex' }, { contacts: people, owner: '917989405979', testOnly: true }).numbers, ['917989405979'], 'example contacts never');
  assert.equal(statusAudience({ testWith: 'c2' }, { contacts: people, owner: '917989405979' }).numbers.length, 3, 'real post unaffected');
  assert.equal(withDefaults({}).autoStatus.testWith, '');
});
