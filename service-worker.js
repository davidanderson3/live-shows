const STATIC_CACHE = 'dashboard-static-v3';
const DYNAMIC_CACHE = 'dashboard-dynamic-v1';
const MAX_DYNAMIC_ENTRIES = 60;

const PRECACHE_URLS = [
  './',
  './index.html',
  './style.css',
  './js/main.js',
  './js/tabs.js',
  './js/movies.js',
  './js/shows.js',
  './js/recipes.js',
  './js/restaurants.js',
  './js/tabReports.js',
  './js/helpers.js',
  './js/auth.js',
  './js/descriptions.js',
  './js/siteName.js',
  './assets/favicon.png',
  './assets/favicon.ico'
];

const PRECACHE_URL_SET = new Set(
  PRECACHE_URLS.map(url => new URL(url, self.location).href)
);

async function trimCache(cacheName, maxEntries) {
  if (typeof maxEntries !== 'number' || maxEntries <= 0) return;
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length <= maxEntries) return;
  const removals = keys.slice(0, keys.length - maxEntries);
  await Promise.all(removals.map(request => cache.delete(request)));
}

async function putInCache(cacheName, request, response, maxEntries) {
  if (!response) return;
  const cache = await caches.open(cacheName);
  await cache.put(request, response);
  await trimCache(cacheName, maxEntries);
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response && response.ok) {
    await putInCache(STATIC_CACHE, request, response.clone());
  }
  return response;
}

async function networkFirst(request, cacheName, { isDocument = false } = {}) {
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      const clone = response.clone();
      const maxEntries = cacheName === DYNAMIC_CACHE ? MAX_DYNAMIC_ENTRIES : undefined;
      await putInCache(cacheName, request, clone, maxEntries);
    }
    return response;
  } catch (err) {
    const cached = await caches.match(request);
    if (cached) return cached;
    if (isDocument) {
      const fallback = await caches.match('./index.html');
      if (fallback) return fallback;
    }
    return new Response('Offline', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
  }
}

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then(cache => cache.addAll(PRECACHE_URLS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== STATIC_CACHE && key !== DYNAMIC_CACHE)
          .map(key => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('message', event => {
  if (event?.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') {
    return;
  }

  const requestUrl = new URL(request.url);
  const isNavigation = request.mode === 'navigate' || request.destination === 'document';

  if (PRECACHE_URL_SET.has(requestUrl.href)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  event.respondWith(
    networkFirst(request, isNavigation ? STATIC_CACHE : DYNAMIC_CACHE, { isDocument: isNavigation })
  );
});
