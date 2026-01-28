const CACHE_NAME = 'survey-pwa-v4';
const ASSETS = [
  '/',
  '/index.html',
  '/assets/ui.css?v=20260124_1',
  '/app/app.js?v=20260121_2',
  '/app/router.js',
  '/app/viewer.js?v=20260128_2',
  '/app/ui.js?v=20260121_2',
  '/app/idb.js',
  '/app/sync.js',
  '/app/overlay.js',
  '/assets/ui-icons.svg',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.2.67/pdf.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.2.67/pdf.worker.min.js'
];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)));
});
self.addEventListener('activate', e => {
  e.waitUntil(self.clients.claim());
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request))
  );
});
