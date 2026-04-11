const CACHE = 'uke-v2';
const SHELL = ['/', '/style.css', '/bundle.js', '/logo.png', '/manifest.json'];

self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL))));
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
));

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // API calls always go to network
  if (url.pathname.startsWith('/api/')) return;
  // Shell assets: network-first, fall back to cache
  e.respondWith(fetch(e.request).then(r => {
    const clone = r.clone();
    caches.open(CACHE).then(c => c.put(e.request, clone));
    return r;
  }).catch(() => caches.match(e.request)));
});
