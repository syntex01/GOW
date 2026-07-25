/**
 * Minimal offline cache. The whole game is three files plus two icons, so a
 * cache-first strategy makes it fully playable offline after one visit.
 */
const CACHE = 'gow-v1'
const ASSETS = [
  './',
  './index.html',
  './game.bundle.js',
  './manifest.json',
  './assets/icons/icons-192.png',
  './assets/icons/icons-512.png'
]

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', event => {
  event.waitUntil(
    caches
      .keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return
  event.respondWith(
    caches.match(event.request).then(cached => {
      const network = fetch(event.request)
        .then(response => {
          if (response && response.status === 200 && response.type === 'basic') {
            const copy = response.clone()
            caches.open(CACHE).then(cache => cache.put(event.request, copy))
          }
          return response
        })
        .catch(() => cached)
      return cached || network
    })
  )
})
