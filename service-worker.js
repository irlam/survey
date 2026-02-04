/* service-worker.js - PWA caching strategy (04/02/2026) */

const STATIC_CACHE = 'survey-pwa-static-v18';
const RUNTIME_CACHE = 'survey-pwa-runtime-v18';
const ASSETS = [
  '/',
  '/index.html',
  '/exports.html',
  '/tools/index.html',
  '/tools/issues.html',
  '/offline.html',
  '/manifest.json',
  '/assets/ui.css?v=20260204_1',
  '/app/app.js?v=20260125_1',
  '/app/router.js',
  '/app/viewer.js?v=20260204_2',
  '/app/ui.js?v=20260204_5',
  '/app/idb.js',
  '/app/sync.js',
  '/app/overlay.js',
  '/assets/ui-icons.svg',
  '/vendor/pdfjs/pdf.min.js',
  '/vendor/pdfjs/pdf.worker.min.js',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-192-maskable.png',
  '/icons/icon-512-maskable.png'
];

/**
 * Checks if a response can be safely cached.
 * @param {Response} response - The fetch response to check
 * @returns {boolean} True if the response can be cached, false otherwise
 * 
 * Note: HTTP 206 (Partial Content) responses are excluded because the Cache API
 * does not support caching partial responses. Attempting to cache them will throw:
 * "Failed to execute 'put' on 'Cache': Partial response (status code 206) is unsupported"
 */
function isCacheable(response) {
  return response && response.ok && response.status !== 206;
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  const res = await fetch(request);
  if (isCacheable(res)) cache.put(request, res.clone());
  return res;
}

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try{
    const res = await fetch(request);
    if (isCacheable(res)) cache.put(request, res.clone());
    return res;
  }catch(err){
    const cached = await cache.match(request);
    if (cached) return cached;
    throw err;
  }
}

self.addEventListener('install', (e) => {
  e.waitUntil((async ()=>{
    const cache = await caches.open(STATIC_CACHE);
    await cache.addAll(ASSETS);
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async ()=>{
    const keys = await caches.keys();
    await Promise.all(keys.map((k)=> (k !== STATIC_CACHE && k !== RUNTIME_CACHE) ? caches.delete(k) : Promise.resolve()));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;

  if (req.mode === 'navigate') {
    e.respondWith((async ()=>{
      try{
        const res = await fetch(req);
        const cache = await caches.open(RUNTIME_CACHE);
        if (isCacheable(res)) {
          cache.put(req, res.clone());
        }
        return res;
      }catch(err){
        const cached = await caches.match(req);
        return cached || caches.match('/offline.html') || caches.match('/index.html');
      }
    })());
    return;
  }

  if (sameOrigin) {
    if (
      url.pathname.startsWith('/assets/') ||
      url.pathname.startsWith('/app/') ||
      url.pathname.startsWith('/icons/') ||
      url.pathname.startsWith('/vendor/') ||
      ASSETS.includes(url.pathname)
    ) {
      e.respondWith(cacheFirst(req, STATIC_CACHE));
      return;
    }
    // Network-first for API and PDF/plan resources so offline can fallback to cached copies
    e.respondWith(networkFirst(req, RUNTIME_CACHE));
    return;
  }
});
