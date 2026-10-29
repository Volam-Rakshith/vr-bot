// VR Bot — WhatsApp connection (Baileys, linked device). © VR DEVELOPMENTS
import fs from 'node:fs';
import makeWASocket, {
  useMultiFileAuthState, DisconnectReason, Browsers, fetchLatestBaileysVersion,
  jidDecode, isJidGroup, isLidUser, jidNormalizedUser, makeCacheableSignalKeyStore,
} from 'baileys';
import pino from 'pino';
import { log } from './log.js';

const silent = pino({ level: process.env.VR_BAILEYS_LOG || 'silent' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const numberJid = (digits) => `${String(digits).replace(/\D/g, '')}@s.whatsapp.net`;
export const jidNumber = (jid) => (jid ? (jidDecode(jid)?.user || '').replace(/\D/g, '') : '');
export { isJidGroup, isLidUser, jidNormalizedUser };

export class WA {
  constructor({ authDir, handlers = {} }) {
    this.authDir = authDir;
    this.handlers = handlers; // { upsert(m), participants(u), connection(update) }
    this.sock = null;
    this.open = false;
    this.loggedOut = false;
    this.pendingDone = false;
    this.attempts = 0;
    this.version = null;
  }

  async _version() {
    if (this.version) return this.version;
    try {
      const v = await Promise.race([fetchLatestBaileysVersion(), sleep(6000).then(() => null)]);
      if (v?.version) this.version = v.version;
    } catch { /* fall back to the version built into Baileys */ }
    return this.version;
  }

  /** Connect. Resolves when the connection is open. Rejects on logout / too many failures. */
  start({ pairing = false, method = 'code', number = '', onCode } = {}) {
    fs.mkdirSync(this.authDir, { recursive: true });
    return new Promise((resolve, reject) => {
      let codeShown = false;
      const make = async () => {
        const { state, saveCreds } = await useMultiFileAuthState(this.authDir);
        if (pairing && !state.creds.registered) codeShown = false; // code expired → ask for a fresh one
        if (!pairing && !state.creds.registered) {
          reject(Object.assign(new Error('WhatsApp is not linked yet. Run the "Pair WhatsApp" workflow first.'), { code: 'NOT_PAIRED' }));
          return;
        }
        const version = await this._version();
        const sock = makeWASocket({
          ...(version ? { version } : {}),
          auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, silent) },
          logger: silent,
          browser: Browsers.macOS('Chrome'),
          markOnlineOnConnect: false,   // keeps notifications on your phone
          syncFullHistory: false,
          generateHighQualityLinkPreview: false,
          getMessage: async () => undefined,
        });
        this.sock = sock;
        sock.ev.on('creds.update', saveCreds);
        sock.ev.on('messages.upsert', (m) => this.handlers.upsert?.(m));
        sock.ev.on('group-participants.update', (u) => this.handlers.participants?.(u));
        sock.ev.on('connection.update', async (u) => {
          this.handlers.connection?.(u);
          if (u.receivedPendingNotifications) this.pendingDone = true;
          if (u.qr && pairing && !codeShown) {
            codeShown = true;
            if (method === 'qr') {
              const qrt = (await import('qrcode-terminal')).default;
              qrt.generate(u.qr, { small: true }, (q) => { console.log(q); onCode?.({ qr: u.qr }); });
            } else {
              try {
                const code = await sock.requestPairingCode(number);
                onCode?.({ code: code.match(/.{1,4}/g).join('-') });
              } catch (e) { reject(new Error(`Could not get a pairing code: ${e.message}`)); }
            }
          }
          if (u.connection === 'open') {
            this.open = true; this.attempts = 0;
            resolve(sock);
          }
          if (u.connection === 'close') {
            this.open = false;
            const code = u.lastDisconnect?.error?.output?.statusCode;
            if (code === DisconnectReason.loggedOut) {
              this.loggedOut = true;
              reject(Object.assign(new Error('WhatsApp logged this bot out (device removed or session expired). Run "Pair WhatsApp" again.'), { code: 'LOGGED_OUT' }));
              return;
            }
            if (this.closing) return;
            this.attempts += 1;
            if (this.attempts > 6) { reject(Object.assign(new Error(`WhatsApp connection keeps closing (code ${code}).`), { code: 'CONN_FAIL' })); return; }
            if (code === DisconnectReason.restartRequired) log.info('WhatsApp asked for a restart (normal after linking) — reconnecting');
            else log.warn(`WhatsApp connection closed (code ${code ?? 'unknown'}), reconnecting (try ${this.attempts})`);
            await sleep(code === DisconnectReason.restartRequired ? 500 : 3000 * this.attempts);
            make().catch(reject);
          }
        });
      };
      make().catch(reject);
    });
  }

  async waitOpen(ms = 60000) {
    const t0 = Date.now();
    while (!this.open) { if (this.loggedOut || Date.now() - t0 > ms) throw new Error('WhatsApp not connected'); await sleep(500); }
  }

  /** Wait until WhatsApp has delivered messages that arrived while the bot was offline. */
  async waitPending(ms = 30000) {
    const t0 = Date.now();
    while (!this.pendingDone && Date.now() - t0 < ms) await sleep(500);
    await sleep(3000); // let the last batch arrive
  }

  async send(jid, content, opts = {}) {
    await this.waitOpen();
    return this.sock.sendMessage(jid, content, opts);
  }

  async exists(digits) {
    try {
      const [r] = await this.sock.onWhatsApp(numberJid(digits));
      return r ? { exists: !!r.exists, jid: r.jid } : { exists: false };
    } catch { return { exists: true, jid: numberJid(digits) }; } // don't block a send on a lookup error
  }

  /** Phone number behind a LID / alt jid, if WhatsApp told us. */
  async pnFor(jid, alt) {
    if (alt && !isLidUser(alt)) return jidNumber(alt);
    if (jid && !isLidUser(jid)) return jidNumber(jid);
    try { const pn = await this.sock?.signalRepository?.lidMapping?.getPNForLID(jid); return pn ? jidNumber(pn) : ''; } catch { return ''; }
  }

  me() { return jidNumber(this.sock?.user?.id || ''); }

  /** Is this jid my own chat ("Message yourself")? Works for phone-number and LID addressing. */
  isMe(jid) {
    const u = this.sock?.user || {};
    const mine = [u.id, u.lid].filter(Boolean).map((x) => jidNormalizedUser(x));
    return !!jid && mine.includes(jidNormalizedUser(jid));
  }

  async close() {
    this.closing = true;
    try { this.sock?.end?.(undefined); } catch {}
    await sleep(500);
  }
}

/** Fake connection for local dry runs (VR_FAKE_WA=1). Sends are only logged. */
export class FakeWA {
  constructor({ handlers = {}, inbox = [] }) { this.handlers = handlers; this.inbox = inbox; this.sent = []; this.open = true; this.pendingDone = true; this.sock = { user: { id: '919999999999@s.whatsapp.net' } }; }
  async start() { setTimeout(() => this.inbox.length && this.handlers.upsert?.({ type: 'notify', messages: this.inbox }), 10); return this; }
  async waitOpen() {}
  async waitPending() { await sleep(100); }
  async send(jid, content) { const id = 'FAKE' + (this.sent.length + 1); this.sent.push({ jid, content }); log.info(`(dry-run) would send to ${isJidGroup(jid) ? 'a group' : 'a chat'}`); return { key: { id, remoteJid: jid, fromMe: true } }; }
  async exists(d) { return { exists: true, jid: numberJid(d) }; }
  async pnFor(jid, alt) { return jidNumber(alt || jid); }
  me() { return '919999999999'; }
  isMe(jid) { return jidNumber(jid) === '919999999999'; }
  async close() {}
}
