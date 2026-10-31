// 🔔 Notifications + 📤 Sent log: payloads, kind filtering, self-chat switch, Sent log cap, Web Push crypto.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { buildPayload, notifyCategory, shouldNotify, selfReportsOn, appendSent, pruneSent, sentList, statusPeople, contentText, liveDevices, epKey, SENT_CAP } from '../panel/shared/notify.js';
import { statusAudienceNames } from '../panel/shared/status.js';
import { withDefaults } from '../panel/shared/defaults.js';
import { encryptPayload, vapidAuth, sendPush, Notifier } from '../src/features/push.js';
import { Incoming } from '../src/incoming.js';

// ---- a fake phone: subscription keys + a receiver that decrypts like Chrome does (RFC 8291) ----
function fakePhone(endpoint = 'https://fcm.googleapis.com/fcm/send/abc123') {
  const ua = crypto.createECDH('prime256v1'); ua.generateKeys();
  const auth = crypto.randomBytes(16);
  return { ua, auth, device: { id: 'dev1', name: 'Moto', endpoint, keys: { p256dh: ua.getPublicKey().toString('base64url'), auth: auth.toString('base64url') }, addedAt: 1 } };
}
function decrypt(body, phone) {
  const hm = (k, d) => crypto.createHmac('sha256', k).update(d).digest();
  const salt = body.subarray(0, 16), rs = body.readUInt32BE(16), idlen = body[20];
  const asPublic = body.subarray(21, 21 + idlen), ct = body.subarray(21 + idlen);
  assert.equal(rs, 4096);
  const shared = phone.ua.computeSecret(asPublic);
  const ikm = hm(hm(phone.auth, shared), Buffer.concat([Buffer.from('WebPush: info\0'), phone.ua.getPublicKey(), asPublic, Buffer.from([1])]));
  const prk = hm(salt, ikm);
  const cek = hm(prk, Buffer.from('Content-Encoding: aes128gcm\0\x01', 'binary')).subarray(0, 16);
  const nonce = hm(prk, Buffer.from('Content-Encoding: nonce\0\x01', 'binary')).subarray(0, 12);
  const d = crypto.createDecipheriv('aes-128-gcm', cek, nonce);
  d.setAuthTag(ct.subarray(ct.length - 16));
  const pt = Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]);
  assert.equal(pt[pt.length - 1], 2, 'last-record delimiter');
  return pt.subarray(0, pt.length - 1).toString();
}
function vapidKeys() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = privateKey.export({ format: 'jwk' });
  const raw = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')]).toString('base64url');
  return { vapid: { publicKey: raw, privateJwk: { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y, d: jwk.d } }, publicKey };
}
function settingsWith(notify = {}, phone = fakePhone()) {
  const { vapid } = vapidKeys();
  return withDefaults({ notify: { enabled: true, vapid, subject: 'https://volam-rakshith.github.io/vr-bot/', devices: [phone.device], ...notify } });
}

test('push crypto: a phone can decrypt the notification (RFC 8291) and the VAPID token verifies (RFC 8292)', () => {
  const phone = fakePhone();
  const msg = JSON.stringify({ title: '🤖 VR Bot → Mummy', body: 'Good morning ☀️' });
  assert.equal(decrypt(encryptPayload(Buffer.from(msg), phone.device.keys), phone), msg);
  const { vapid, publicKey } = vapidKeys();
  const h = vapidAuth(phone.device.endpoint, vapid, 'https://volam-rakshith.github.io/vr-bot/', { nowSec: 1000 });
  const [, tok, k] = h.match(/^vapid t=([^,]+), k=(.+)$/);
  assert.equal(k, vapid.publicKey);
  const [a, b, c] = tok.split('.');
  assert.deepEqual(JSON.parse(Buffer.from(b, 'base64url')), { aud: 'https://fcm.googleapis.com', exp: 1000 + 12 * 3600, sub: 'https://volam-rakshith.github.io/vr-bot/' });
  assert.ok(crypto.verify('sha256', Buffer.from(`${a}.${b}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(c, 'base64url')));
  assert.throws(() => encryptPayload(Buffer.alloc(5000), phone.device.keys), /too big/);
});

test('push payload: one send, several sends grouped, status, report, size cap', () => {
  const one = buildPayload([{ id: 'a', t: 1, cat: 'scheduled', to: 'Mummy', text: 'Good morning! '.repeat(20) }], { now: 5 });
  assert.equal(one.title, '🤖 VR Bot → Mummy');
  assert.ok(one.body.length <= 100 && one.body.endsWith('…'));
  assert.equal(one.url, '#/sent');
  assert.equal(one.items[0].id, 'a');
  const many = buildPayload([{ cat: 'ai', to: 'Vijay', text: 'hi' }, { cat: 'replies', to: 'Vijay', text: 'yo' }]);
  assert.equal(many.title, '🤖 VR Bot sent 2 messages → Vijay');
  assert.equal(many.body, 'Vijay: hi\nVijay: yo');
  const mixed = buildPayload(Array.from({ length: 7 }, (_, i) => ({ cat: 'scheduled', to: `P${i}`, text: 'Happy Diwali' })));
  assert.equal(mixed.title, '🤖 VR Bot sent 7 messages');
  assert.match(mixed.body, /\+2 more$/);
  const st = buildPayload([{ cat: 'status', count: 42, text: 'Dream big' }]);
  assert.equal(st.title, '🤖 VR Bot posted a status → 42 people');
  assert.equal(buildPayload([{ cat: 'reports', title: 'Daily summary', text: 'Sent 5' }]).title, '📋 VR Bot Daily summary');
  const big = buildPayload(Array.from({ length: 40 }, () => ({ id: 'x', cat: 'ai', to: 'X', text: 'z'.repeat(900) })));
  assert.ok(Buffer.byteLength(JSON.stringify(big)) <= 3000);
});

test('notify kinds: category of each send and the per-kind switches', () => {
  assert.equal(notifyCategory({ kind: 'personal' }), 'scheduled');
  assert.equal(notifyCategory({ kind: 'birthday' }), 'scheduled');
  assert.equal(notifyCategory({ kind: 'ai', cat: 'ai' }), 'ai');
  assert.equal(notifyCategory({ kind: 'reply' }), 'replies');
  assert.equal(notifyCategory({ kind: 'group', cat: 'replies' }), 'replies'); // group tools are not "scheduled"
  assert.equal(notifyCategory({ jid: 'status@broadcast' }), 'status');
  const S = settingsWith({ kinds: { scheduled: true, replies: false, ai: true, status: false, reports: true } });
  assert.equal(shouldNotify(S, 'scheduled'), true);
  assert.equal(shouldNotify(S, 'replies'), false);
  assert.equal(shouldNotify(S, 'status'), false);
  assert.equal(shouldNotify(S, 'self'), false);
  assert.equal(shouldNotify(S, 'alert'), true); // critical: always
  assert.equal(shouldNotify({ ...S, notify: { ...S.notify, enabled: false } }, 'ai'), false);
  assert.equal(shouldNotify(withDefaults({}), 'ai'), false); // nothing set up
  // a phone whose browser said "gone" gets nothing, until it is added again
  const dead = { dev: { [epKey(S.notify.devices[0].endpoint)]: { dead: 10 } } };
  assert.equal(liveDevices(S, dead).length, 0);
  assert.equal(shouldNotify(S, 'ai', dead), false);
  assert.equal(liveDevices({ ...S, notify: { ...S.notify, devices: [{ ...S.notify.devices[0], addedAt: 20 }] } }, dead).length, 1);
});

test('self-chat switch: automatic, on, off, and the "no working phone" safety net', () => {
  const S = settingsWith();
  assert.equal(selfReportsOn(withDefaults({})), true); // no notifications → old behaviour
  assert.equal(selfReportsOn(S), false);                // notifications work + not set → off
  assert.equal(selfReportsOn({ ...S, notify: { ...S.notify, selfReports: true } }), true);
  assert.equal(selfReportsOn({ ...S, notify: { ...S.notify, selfReports: false } }), false);
  const dead = { dev: { [epKey(S.notify.devices[0].endpoint)]: { dead: 10 } } };
  assert.equal(selfReportsOn({ ...S, notify: { ...S.notify, selfReports: false } }, dead), true); // nothing would arrive → chat
  assert.equal(selfReportsOn({ ...S, notify: { ...S.notify, enabled: false, selfReports: false } }), true);
});

test('Sent log: append, newest-first list, 300 cap, 14-day limit, long text cut, push entries merged once', () => {
  const box = { entries: [] };
  const now = Date.UTC(2026, 9, 31, 6);
  for (let i = 0; i < 350; i++) appendSent(box, { cat: 'ai', to: `P${i}`, text: 'x', t: now - (350 - i) * 1000 }, { now });
  assert.equal(box.entries.length, SENT_CAP);
  assert.equal(box.entries[0].to, 'P50');
  const e = appendSent(box, { cat: 'scheduled', to: 'Mummy', text: 'y'.repeat(5000) }, { now });
  assert.equal(e.text.length, 1000);
  assert.ok(e.id);
  const old = { entries: [{ id: '1', t: now - 15 * 86400000 }, { id: '2', t: now - 86400000 }] };
  assert.deepEqual(pruneSent(old, { now }).entries.map((x) => x.id), ['2']);
  const list = sentList({ entries: [{ id: 'a', t: 1 }, { id: 'b', t: 3 }] }, [{ id: 'b', t: 3 }, { id: 'c', t: 2 }]);
  assert.deepEqual(list.map((x) => x.id), ['b', 'c', 'a']);
  assert.equal(contentText({ react: { text: '👍' } }), 'reacted 👍');
  assert.equal(contentText({ document: Buffer.alloc(1), fileName: 'a.pdf' }), '📄 a.pdf');
});

test('status: who sees it — names from Contacts, numbers for people who texted lately, never you', () => {
  const contacts = [{ id: 'c1', name: 'Mummy', number: '9290570095' }, { id: 'c2', name: 'Vijay', number: '+91 90000 03938', tags: ['friends'] }, { id: 'c3', name: 'Ex', number: '9000000001', example: true }];
  const r = statusAudienceNames({ audience: 'all', alsoRecent: true }, { contacts, recent: { 919111111111: Date.now() }, owner: '917989405979' });
  assert.deepEqual(r.people.map((p) => p.name), ['Mummy', 'Vijay', '+919111111111']);
  assert.equal(r.people[2].recent, true);
  assert.equal(r.recentIncluded, true);
  const only = statusAudienceNames({ audience: 'only', tags: ['friends'], alsoRecent: true }, { contacts, owner: '917989405979' });
  assert.deepEqual(only.people.map((p) => p.name), ['Vijay']);
  assert.equal(only.recentIncluded, false);
  const except = statusAudienceNames({ audience: 'except', contacts: ['c1'] }, { contacts, owner: '917989405979' });
  assert.deepEqual(except.people.map((p) => p.name), ['Vijay']);
  assert.deepEqual(statusPeople(['917989405979@s.whatsapp.net', '919290570095@s.whatsapp.net', '919111111111'], { contacts, self: ['917989405979'] }),
    [{ n: '919290570095', name: 'Mummy' }, { n: '919111111111', name: '+919111111111', recent: true }]);
});

// ---- the bot's notifier with a fake push service ----
function rig(notify = {}, { status = 500 } = {}) {
  const phone = fakePhone();
  const settings = settingsWith(notify, phone);
  const calls = [];
  const fetchImpl = async (url, opts) => { calls.push({ url, opts, json: JSON.parse(decrypt(opts.body, phone)) }); return { status: typeof status === 'function' ? status(calls.length) : status === 500 ? 201 : status }; };
  const state = { status: { groups: [{ id: '123@g.us', name: 'Family' }] } };
  const data = { settings, contacts: [{ id: 'c1', name: 'Mummy', number: '9290570095' }] };
  const n = new Notifier({ getData: () => data, state, me: () => '917989405979', owner: '917989405979', fetchImpl, windowMs: 20, maxWaitMs: 60 });
  return { n, calls, state, data, phone };
}

test('notifier: logs every send, groups a burst into one notification, names the contact', async () => {
  const { n, calls, state } = rig();
  n.sent('919290570095@s.whatsapp.net', { text: 'Good morning Mummy' }, { kind: 'personal', cat: 'scheduled' });
  n.sent('919290570095@s.whatsapp.net', { text: 'Have a nice day' }, { kind: 'reply', cat: 'replies' });
  n.sent('123@g.us', { text: 'Welcome!' }, { kind: 'group', cat: 'replies' });
  await new Promise((r) => setTimeout(r, 80));
  await n.flushing;
  assert.equal(calls.length, 1);
  assert.equal(calls[0].json.title, '🤖 VR Bot sent 3 messages');
  assert.match(calls[0].json.body, /^Mummy: Good morning Mummy\nMummy: Have a nice day\nFamily: Welcome!$/);
  assert.equal(calls[0].opts.headers['Content-Encoding'], 'aes128gcm');
  assert.match(calls[0].opts.headers.Authorization, /^vapid t=/);
  assert.deepEqual(state.outbox.entries.map((e) => [e.cat, e.to]), [['scheduled', 'Mummy'], ['replies', 'Mummy'], ['replies', 'Family']]);
  assert.ok(state.status.push.dev[epKey(calls[0].url)].ok);
});

test('notifier: kinds off → logged but no notification; own chat → "self", no notification; reactions not pushed', async () => {
  const { n, calls, state } = rig({ kinds: { scheduled: true, replies: true, ai: false, status: true, reports: true } });
  n.sent('919290570095@s.whatsapp.net', { text: 'AI says hi' }, { kind: 'ai', cat: 'ai' });
  n.sent('917989405979@s.whatsapp.net', { text: '✅ VR Bot is linked' }, { kind: 'alert', to: { self: true } });
  n.sent('919290570095@s.whatsapp.net', { react: { text: '👍' } }, { kind: 'reply', cat: 'replies' });
  await n.flush();
  assert.equal(calls.length, 0);
  assert.deepEqual(state.outbox.entries.map((e) => e.cat), ['ai', 'self', 'replies']);
});

test('notifier: expired phone (410) is marked dead and skipped; network errors never throw', async () => {
  const { n, calls, state, data } = rig({}, { status: 410 });
  n.sent('919290570095@s.whatsapp.net', { text: 'one' }, { kind: 'personal' });
  await n.flush();
  assert.equal(calls.length, 1);
  assert.ok(state.status.push.dev[epKey(data.settings.notify.devices[0].endpoint)].dead);
  n.sent('919290570095@s.whatsapp.net', { text: 'two' }, { kind: 'personal' });
  await n.flush();
  assert.equal(calls.length, 1, 'dead phone gets nothing more');
  assert.equal(n.selfReports(), true, 'no working phone → reports go back to your chat');
  const boom = new Notifier({ getData: () => data, state: { status: {} }, fetchImpl: async () => { throw new Error('offline'); } });
  data.settings.notify.devices[0].addedAt = Date.now() + 1000;
  boom.sent('919290570095@s.whatsapp.net', { text: 'x' }, {});
  assert.equal(await boom.flush(), false);
  const r = await sendPush({ endpoint: 'https://x.example/1', keys: { p256dh: 'bad', auth: 'bad' } }, {}, data.settings.notify.vapid, '');
  assert.equal(r.ok, false);
});

test('notifier: status post → "posted a status → N people" + who saw it; reports; test notification once', async () => {
  const { n, calls, state, data } = rig();
  n.status({ text: 'Dream big' }, ['917989405979', '919290570095', '919111111111']);
  await n.flush();
  assert.equal(calls[0].json.title, '🤖 VR Bot posted a status → 2 people');
  const st = state.outbox.entries[0];
  assert.deepEqual(st.people.map((p) => p.name), ['Mummy', '+919111111111']);
  n.report('📊 Today: 5 sent', 'Daily summary');
  await n.flush();
  assert.equal(calls[1].json.title, '📋 VR Bot Daily summary');
  data.settings.notify.testAt = Date.now();
  assert.equal(await n.checkTest(), true);
  assert.equal(await n.checkTest(), false, 'one test per tap');
  assert.equal(calls[2].json.title, '✅ VR Bot test');
  assert.equal(await n.critical('⚠️ VR Bot is logged out of WhatsApp', 'pair again'), true);
  assert.equal(calls[3].json.title, '⚠️ VR Bot is logged out of WhatsApp');
});

test('self-chat switch in the bot: reports become notifications, ON keeps them in your chat', async () => {
  for (const selfReports of [false, true]) {
    const { n } = rig({ selfReports });
    const sent = [];
    const reports = [];
    n.report = (text, title) => { reports.push([title, text]); };
    const inc = new Incoming({ wa: { me: () => '917989405979', isMe: () => false }, getData: () => ({ settings: rigSettings(n) }), state: { memory: {}, status: {} }, send: async (jid, c) => { sent.push([jid, c.text]); }, notifier: n });
    await inc.toOwner('🔕 Busy mode is off now', { report: true, title: 'busy mode' });
    await inc.toOwner('✅ command reply');
    if (selfReports) { assert.equal(reports.length, 0); assert.equal(sent.length, 2); }
    else { assert.deepEqual(reports, [['busy mode', '🔕 Busy mode is off now']]); assert.equal(sent.length, 1); assert.match(sent[0][1], /✅ command reply$/); }
  }
});
function rigSettings(n) { return n.settings(); }
