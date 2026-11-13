// PCG Punch service worker (v0.7.3): opens the app with no signal.
// App files: network first (so updates show up), cached copy when offline.
// Firebase SDK, PDF reader, plan images and photos: cached once, reused offline.
const CACHE = 'pcg-punch-v0.7.3';
const SHELL = ['./', './index.html', './app.js?v=0.7.3', './fb.js', './qr.js', './seeds.js', './style.css?v=0.7.3', './config.js?v=0.7.3',
  './manifest.webmanifest', './icon-192.png', './icon-512.png', './apple-touch-icon.png'];
const LIBS = ['https://www.gstatic.com/firebasejs/', 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/'];
const FILES = 'https://firebasestorage.googleapis.com/';

self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('pcg-punch-') && k !== CACHE && k !== 'pcg-punch-files').map(k => caches.delete(k))))
    .then(() => self.clients.claim())));

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = req.url;
  if (LIBS.some(p => url.startsWith(p))) { e.respondWith(cacheFirst(req, CACHE)); return; }
  // Plan images and photos: each upload has its own address, so a cached copy never goes stale.
  if (url.startsWith(FILES) && /\/o\/projects%2F[^?]+%2F(plans|photos)%2F/.test(url)) { e.respondWith(cacheFirst(req, 'pcg-punch-files')); return; }
  if (new URL(url).origin !== self.location.origin) return;
  e.respondWith(fetch(req).then(r => {
    if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
    return r;
  }).catch(() => caches.match(req, { ignoreSearch: req.mode === 'navigate' }).then(hit => hit || caches.match('./'))));
});

function cacheFirst(req, name) {
  return caches.open(name).then(c => c.match(req).then(hit => hit || fetch(req).then(r => {
    if (r.ok || r.type === 'opaque') c.put(req, r.clone());
    return r;
  })));
}
