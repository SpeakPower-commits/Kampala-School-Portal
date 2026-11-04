/*
 * service-worker.js — offline support for the School Management Portal.
 *
 * Strategy:
 *   • App code (HTML, JS, CSS): network-first, falling back to cache. This means
 *     a freshly deployed version is picked up as soon as the device is online,
 *     while the app still opens instantly and works offline.
 *   • Static assets (icons): cache-first for speed.
 * Bump CACHE_VERSION whenever you deploy new files.
 */

const CACHE_VERSION = 'school-portal-v3.0.0';
const CORE_ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './auth.js',
  './billing.js',
  './academics.js',
  './register.js',
  './tools.js',
  './manifest.json',
  './icon192.png',
  './icon512.png',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then(cache => Promise.allSettled(CORE_ASSETS.map(url => cache.add(url))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function isAppCode(request) {
  if (request.mode === 'navigate') return true;
  return /\.(?:html|js|css|json)$/.test(new URL(request.url).pathname);
}

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;
  if (new URL(request.url).origin !== self.location.origin) return;

  if (isAppCode(request)) {
    // Network-first so deployed updates are picked up promptly.
    event.respondWith(
      fetch(request)
        .then(response => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_VERSION).then(cache => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => caches.match(request).then(cached => cached || caches.match('./index.html')))
    );
    return;
  }

  // Cache-first for everything else (icons, images).
  event.respondWith(
    caches.match(request).then(cached => cached || fetch(request).then(response => {
      if (response && response.status === 200) {
        const clone = response.clone();
        caches.open(CACHE_VERSION).then(cache => cache.put(request, clone));
      }
      return response;
    }))
  );
});
