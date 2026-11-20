/* ARVEX SURVIVAL service worker — offline play + update notice. VERSION is stamped by tools/build.mjs */
const VERSION = 'arvex-1.1.0';
const CORE = ['./', 'index.html', 'arvex.css', 'style.css', 'game.js', 'manifest.webmanifest', 'fonts/ArvexDisplay-Bold.woff', 'fonts/ArvexDisplay-SemiBold.woff', 'fonts/ArvexText-Regular.woff', 'fonts/ArvexText-SemiBold.woff', 'fonts/ArvexText-Bold.woff', 'fonts/ArvexKufi-Bold.woff', 'fonts/ArvexMono-Medium.woff', 'brand/arvex-logo-dark.svg', 'brand/arvex-logo-stacked.svg', 'brand/arvex-mark.svg', 'brand/arvex-line.svg', 'brand/arvex-main-banner.svg', 'icons/icon-192.png', 'icons/icon-512.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(VERSION).then(c => c.addAll(CORE))); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('message', e => { if (e.data === 'skipWaiting') self.skipWaiting(); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin || u.pathname.startsWith('/api/') || u.pathname.endsWith('/ws') || u.pathname.startsWith('/launcher/')) return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(r => r || fetch(e.request).then(res => { if (res.ok) { const cp = res.clone(); caches.open(VERSION).then(c => c.put(e.request, cp)); } return res; })));
});
