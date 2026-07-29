/**
 * Offline cache.
 *
 * The previous version of this file shipped a bug that made every update
 * invisible. It was cache-first — `return cached || network` — against a cache
 * named `gow-v1` that never changed. So a player who had opened the game once
 * was served the OLD bundle on every subsequent launch, while the background
 * fetch quietly refreshed the cache for next time. They were permanently
 * exactly one version behind: a build would land, they would play it, and see
 * the version before it. New building descriptions, new numbers, new
 * behaviour — all present in the file on disk, none of it on screen.
 *
 * It applied to the Android app too, not just the web build: Capacitor serves
 * over the `https` scheme, so the `location.protocol === 'https:'` guard that
 * registers this worker is true there.
 *
 * Two changes fix it, and both are needed:
 *
 *  - **The cache name carries the build.** `BUILD` is rewritten by build.mjs
 *    with a hash of the bundle, so a new build cannot collide with an old
 *    cache, and `activate` deletes every cache that is not this one.
 *  - **The two files that ARE the game go network-first.** index.html and
 *    game.bundle.js are fetched fresh whenever the network is there, falling
 *    back to the cache only when it is not. Everything else — icons, the
 *    manifest — stays cache-first, because those are what offline needs and
 *    they do not carry behaviour.
 */
const BUILD = '__BUILD_ID__'
const CACHE = `gow-${BUILD}`
const ASSETS = [
  './',
  './index.html',
  './game.bundle.js',
  './manifest.json',
  './assets/icons/icons-192.png',
  './assets/icons/icons-512.png'
]

/** The files that carry the game itself, and must never be served stale. */
function isLive(url) {
  const p = new URL(url).pathname
  return p.endsWith('/') || p.endsWith('/index.html') || p.endsWith('/game.bundle.js')
}

self.addEventListener('install', event => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then(cache => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
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
  const store = response => {
    if (response && response.status === 200 && response.type === 'basic') {
      const copy = response.clone()
      caches.open(CACHE).then(cache => cache.put(event.request, copy))
    }
    return response
  }

  if (isLive(event.request.url)) {
    // Network first. Offline still works — it falls back to whatever was
    // cached — but a player with a connection always gets the build that is
    // actually deployed.
    event.respondWith(
      fetch(event.request)
        .then(store)
        .catch(() => caches.match(event.request))
    )
    return
  }

  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request).then(store))
  )
})
