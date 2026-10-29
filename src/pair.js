// VR Bot — one-time pairing: links this bot to your WhatsApp as a "linked device".
// © VR DEVELOPMENTS
import fs from 'node:fs';
import { env, AUTH_DIR, WORK } from './env.js';
import { log } from './log.js';
import { WA, numberJid } from './wa.js';
import { pullState, persistLocal, pushState } from './state.js';
import { maskNumber } from '../panel/shared/defaults.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function banner(code) {
  const line = '═'.repeat(44);
  console.log(`\n${line}\n  YOUR WHATSAPP PAIRING CODE:\n\n        ${code}\n\n  On your phone (within ~2 minutes):\n  WhatsApp → ⋮ / Settings → Linked devices\n  → Link a device → "Link with phone number\n  instead" → type the code above.\n${line}\n`);
}

export async function pair() {
  if (!env.passphrase) { log.error('VR_PASSPHRASE secret is missing.'); return 1; }
  if (!env.botNumber && env.pairMethod !== 'qr') { log.error('BOT_NUMBER secret is missing (your WhatsApp number with country code, e.g. 917989405979).'); return 1; }
  const { state } = await pullState();
  fs.rmSync(AUTH_DIR, { recursive: true, force: true }); // always pair fresh
  fs.mkdirSync(WORK, { recursive: true });

  for (let attempt = 1; attempt <= 3; attempt++) {
    const wa = new WA({ authDir: AUTH_DIR });
    log.info(`Requesting a ${env.pairMethod === 'qr' ? 'QR code' : 'pairing code'} for ${maskNumber(env.botNumber)} (attempt ${attempt}/3)…`);
    try {
      await Promise.race([
        wa.start({ pairing: true, method: env.pairMethod, number: env.botNumber, onCode: ({ code }) => { if (code) banner(code); else console.log('Scan the QR above: WhatsApp → Linked devices → Link a device.'); } }),
        sleep(170000).then(() => { throw new Error('Timed out waiting for you to enter the code'); }),
      ]);
      log.ok('Linked! Finishing the first sync (about 30 seconds)…');
      await sleep(30000);
      state.status.session = { status: 'ok', me: maskNumber(wa.me()), pairedAt: Date.now(), lastOk: Date.now() };
      try {
        const owner = env.ownerNumber || wa.me();
        await wa.send(numberJid(owner), { text: '🤖 *VR Bot* is linked and ready ✅\n\nOpen your panel to add schedules. Send *!help* in this chat for commands.\n\n— VR Bot by VR DEVELOPMENTS' });
      } catch (e) { log.warn(`Linked, but the hello message failed: ${e.message}`); }
      await sleep(3000);
      await wa.close();
      state.logs.entries.push(...log.drain());
      fs.rmSync(`${WORK}/session.prev.json`, { force: true });
      persistLocal(state);
      await pushState('paired');
      log.ok('All done. Your session is saved (encrypted). The bot now runs by itself every 30 minutes.');
      return 0;
    } catch (e) {
      await wa.close();
      log.warn(`Pairing attempt ${attempt} failed: ${e.message}`);
      fs.rmSync(AUTH_DIR, { recursive: true, force: true });
      if (attempt < 3) await sleep(5000);
    }
  }
  log.error('Pairing failed 3 times. Check BOT_NUMBER (country code, digits only) and try again. See SETUP.md → Troubleshooting.');
  return 1;
}
