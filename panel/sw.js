// VR Bot panel — offline shell cache + phone notifications. GitHub API calls are never cached. © VR DEVELOPMENTS
const CACHE = 'vr-bot-v11';
const PUSHLOG = 'vr-bot-pushlog'; // last notifications, so the Sent log can show them before the bot saves
const SHELL = ['./', 'index.html', 'styles.css', 'themes.css', 'theme.js', 'app.js', 'manifest.webmanifest', 'icons/logo.png', 'icons/icon-192.png',
  'shared/time.js', 'shared/scheduler.js', 'shared/templates.js', 'shared/rules.js', 'shared/crypto.js', 'shared/festivals.js', 'shared/defaults.js', 'shared/planner.js', 'shared/quotes.js', 'shared/status.js', 'shared/busy.js', 'shared/report.js', 'shared/specialdays.js', 'shared/notify.js', 'shared/voice.js', 'shared/ogg.js', 'shared/notes.js', 'shared/botmode.js', 'shared/projects.js', 'demo.js'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE && k !== PUSHLOG).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin || e.request.method !== 'GET') return; // API → network only
  e.respondWith(fetch(e.request).then((r) => { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return r; }).catch(() => caches.match(e.request)));
});

// 🔔 A notification from your bot (sent from GitHub, encrypted for this phone).
async function keepItems(items) {
  if (!items || !items.length) return;
  try {
    const c = await caches.open(PUSHLOG);
    const r = await c.match('pushlog.json');
    const old = r ? await r.json() : [];
    const ids = new Set(old.map((x) => x.id));
    const all = old.concat(items.filter((x) => x && x.id && !ids.has(x.id))).slice(-100);
    await c.put('pushlog.json', new Response(JSON.stringify(all), { headers: { 'Content-Type': 'application/json' } }));
  } catch (err) { /* the notification still shows */ }
}
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { body: e.data ? e.data.text() : '' }; }
  const show = self.registration.showNotification(d.title || '🤖 VR Bot', {
    body: d.body || '', icon: 'icons/icon-192.png',
    tag: d.tag || undefined, timestamp: d.ts || Date.now(), data: { url: d.url || '#/sent' },
  });
  e.waitUntil(Promise.all([show, keepItems(d.items)]));
});
// Tap → open the panel on the Sent log (re-use an open panel window if there is one).
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const go = (e.notification.data && e.notification.data.url) || '#/sent';
  const url = new URL(go, self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    const win = list.find((c) => c.url.startsWith(self.registration.scope));
    if (win) { win.postMessage({ go }); return win.focus(); }
    return self.clients.openWindow(url);
  }));
});
