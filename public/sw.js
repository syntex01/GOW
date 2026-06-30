/*
 * Minimal, safe service worker: runtime cache-first for same-origin GET
 * requests (app shell, hashed JS/CSS, models, icons), with a network fallback
 * and offline support. No fragile precache manifest — Vite emits hashed asset
 * names, so we cache on first fetch and serve from cache thereafter. A version
 * bump clears old caches.
 */
const CACHE = 'grimdark-v1';

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
    ).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // don't touch cross-origin (fonts/CDN)

  e.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req)
          .then((res) => {
            if (res && res.status === 200 && res.type === 'basic') {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(req, copy));
            }
            return res;
          })
          .catch(() => caches.match('./index.html')),
    ),
  );
});
