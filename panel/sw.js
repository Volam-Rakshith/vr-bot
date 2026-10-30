// VR Bot panel — offline shell cache. GitHub API calls are never cached. © VR DEVELOPMENTS
const CACHE = 'vr-bot-v3';
const SHELL = ['./', 'index.html', 'styles.css', 'app.js', 'manifest.webmanifest', 'icons/logo.png', 'icons/icon-192.png',
  'shared/time.js', 'shared/scheduler.js', 'shared/templates.js', 'shared/rules.js', 'shared/crypto.js', 'shared/festivals.js', 'shared/defaults.js', 'shared/planner.js', 'shared/quotes.js', 'shared/status.js', 'shared/busy.js', 'shared/report.js', 'shared/specialdays.js', 'demo.js'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin || e.request.method !== 'GET') return; // API → network only
  e.respondWith(fetch(e.request).then((r) => { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return r; }).catch(() => caches.match(e.request)));
});
