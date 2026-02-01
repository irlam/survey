const CACHE_NAME = 'survey-pwa-v6';
const OFFLINE_URL = '/';
const ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/assets/ui.css?v=20260125_7',
  '/assets/ui-icons.svg',
  '/app/app.js?v=20260125_1',       // Updated to match index.html
  '/app/router.js',
  '/app/viewer.js?v=20260128_3',
  '/app/ui.js?v=20260125_2',        // Updated to match index.html
  '/app/idb.js',
  '/app/sync.js',
  '/app/overlay.js',
  '/app/pin-draggable.js',
  '/icons/icon-192-maskable.png',
  '/icons/icon-512-maskable.png',
  '/vendor/pdfjs/pdf.min.js',       // Use local file
  '/vendor/pdfjs/pdf.worker.min.js' // Use local file
];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  // Robust install: fetch each asset individually so a single failed fetch
  // does not fail the whole install. Log failures for diagnostics.
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    const results = await Promise.all(ASSETS.map(async (url) => {
      try {
        const res = await fetch(url, { cache: 'no-cache' });
        if (!res || !res.ok) throw new Error('HTTP ' + (res && res.status));
        await cache.put(url, res.clone());
        return { url, ok: true };
      } catch (err) {
        console.error('service-worker: asset cache failed', url, err);
        return { url, ok: false, error: String(err) };
      }
    }));
    const failed = results.filter(r => !r.ok);
    if (failed.length) {
      // Don't reject install — keep existing SW active. Useful for flaky CDNs or blocked resources.
      console.warn('service-worker: some assets failed to cache during install:', failed.map(f => f.url));
    }
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);

  // App shell / navigation: serve cached shell when offline.
  if (e.request.mode === 'navigate') {
    e.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(OFFLINE_URL);
      if (cached) return cached;
      try {
        const res = await fetch(e.request);
        cache.put(OFFLINE_URL, res.clone());
        return res;
      } catch (_) {
        return cached || Response.error();
      }
    })());
    return;
  }

  // Runtime cache for same-origin GET (incl. exports) with network fallback.
  if (url.origin === self.location.origin) {
    e.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(e.request);
      if (cached) return cached;
      try {
        const res = await fetch(e.request);
        if (res && res.status === 200 && res.type === 'basic') {
          cache.put(e.request, res.clone());
        }
        return res;
      } catch (err) {
        if (e.request.destination === 'document') {
          const fallback = await cache.match(OFFLINE_URL);
          if (fallback) return fallback;
        }
        throw err;
      }
    })());
  }
});
