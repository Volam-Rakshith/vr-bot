import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encryptJSON, decryptJSON, makeLock, checkLock, openData, isEnvelope } from '../panel/shared/crypto.js';

test('encrypt → decrypt round trip (with and without gzip)', async () => {
  const obj = { contacts: [{ name: 'Amma', number: '+919000000001' }], emoji: '🪔' };
  const env = await encryptJSON(obj, 'correct horse');
  assert.ok(isEnvelope(env));
  assert.ok(!JSON.stringify(env).includes('Amma'));
  assert.deepEqual(await decryptJSON(env, 'correct horse'), obj);
  const z = await encryptJSON({ big: 'x'.repeat(10000) }, 'pw', { compress: true });
  assert.ok(z.ct.length < 2000);
  assert.equal((await decryptJSON(z, 'pw')).big.length, 10000);
});

test('wrong password is detected', async () => {
  const env = await encryptJSON({ a: 1 }, 'right');
  await assert.rejects(() => decryptJSON(env, 'wrong'), /Wrong password/);
  const lock = await makeLock('right');
  assert.equal(await checkLock(lock, 'right'), true);
  assert.equal(await checkLock(lock, 'wrong'), false);
  assert.equal(await checkLock(null, 'x'), null);
});

test('plaintext data passes through', async () => {
  assert.deepEqual(await openData({ a: 1 }, 'pw'), { a: 1 });
});
