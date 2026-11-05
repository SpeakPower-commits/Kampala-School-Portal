/*
 * service-worker.js — offline support for the School Management Portal.
 *
 * Strategy:
 *   • App code (HTML, JS, CSS): network-first, falling back to cache. This means
 *     a freshly deployed version is picked up as soon as the device is online,
 *     while the app still opens instantly and works offline.
 *   • Static assets (icons): cache-first for speed.
 *   • Server API calls (/api/…): never cached; they always go to the network.
 * Bump CACHE_VERSION whenever you deploy new files.
 */

const CACHE_VERSION = 'school-portal-v3.5.0';
const CORE_ASSETS = [
  './',
  './index.html',
  './styles.css',
  './config.js',
  './core.js',
  './sync.js',
  './auth-online.js',
  './app.js',
  './auth.js',
  './billing.js',
  './academics.js',
  './register.js',
  './tools.js',
  './sms.js',
  './manifest.json',
  './icon192.png',
  './icon512.png',
];

/* Some hosts redirect one address to another (Cloudflare sends /index.html to /).
   Browsers refuse to open a page from a redirected response stored by a service
   worker, so keep a clean, unredirected copy instead. */
function storable(response) {
  if (!response.redirected) return Promise.resolve(response);
  return response.blob().then(body => new Response(body, {
    status: response.status, statusText: response.statusText, headers: response.headers,
  }));
}

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then(cache => Promise.allSettled(CORE_ASSETS.map(url =>
        fetch(url).then(response => {
          if (!response.ok) throw new Error('Could not cache ' + url);
          return storable(response).then(clean => cache.put(url, clean));
        }))))
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
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;   // server API: always live

  if (isAppCode(request)) {
    // Network-first so deployed updates are picked up promptly.
    event.respondWith(
      fetch(request)
        .then(response => {
          if (response && response.status === 200) {
            storable(response.clone()).then(clean => caches.open(CACHE_VERSION).then(cache => cache.put(request, clean)));
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
