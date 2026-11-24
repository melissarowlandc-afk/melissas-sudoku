const CACHE_PREFIX = `melissas-sudoku:${self.registration.scope}:`;
const CACHE_NAME = `${CACHE_PREFIX}v6`;
const PRECACHE = [
  "./",
  "./index.html",
  "./styles.css",
  "./manifest.webmanifest",
  "./sw.js",
  "./src/app.js",
  "./src/game.js",
  "./src/gen-worker.js",
  "./src/generator.js",
  "./src/hints.js",
  "./src/rating.js",
  "./src/rng.js",
  "./src/score.js",
  "./src/storage.js",
  "./src/sudoku.js",
  "./src/techniques.js",
  "./icons/apple-touch-icon.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./icons/icon-maskable.svg",
  "./icons/icon.svg"
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(PRECACHE.map((path) => new Request(new URL(path, self.registration.scope), { cache: 'reload' })));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
      .map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const navigation = request.mode === 'navigate';
    const response = await cache.match(request, { ignoreSearch: navigation });
    if (response) return response;
    try {
      return await fetch(request);
    } catch {
      const fallback = navigation ? await cache.match(new URL('./index.html', self.registration.scope).href) : null;
      return fallback ?? Response.error();
    }
  })());
});
