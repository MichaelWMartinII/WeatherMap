const CACHE_NAME = 'weathermap-v4';
const PRECACHE = [
  './',
  './index.html',
  './css/main.css',
  './js/app.js',
  './js/map.js',
  './js/search.js',
  './js/routing.js',
  './js/weather.js',
  './js/radar.js',
  './js/route-weather.js',
  './js/eta.js',
  './js/ui.js',
  './js/geo.js',
  './js/utils.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // Network-first for API calls
  if (
    url.hostname.includes('api.open-meteo.com') ||
    url.hostname.includes('router.project-osrm.org') ||
    url.hostname.includes('nominatim.openstreetmap.org') ||
    url.hostname.includes('photon.komoot.io') ||
    url.hostname.includes('api.rainviewer.com') ||
    url.hostname.includes('tilecache.rainviewer.com')
  ) {
    e.respondWith(
      fetch(e.request).catch(() => caches.match(e.request))
    );
    return;
  }

  // Cache-first for app shell and tiles
  e.respondWith(
    caches.match(e.request).then((cached) => cached || fetch(e.request))
  );
});
