const CACHE_NAME = 'noteview-v1';

const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/icon.svg',
  '/manifest.json',
  '/css/base.css',
  '/css/layout.css',
  '/css/components.css',
  '/css/editor.css',
  '/css/views/document.css',
  '/css/views/timeline.css',
  '/css/views/kanban.css',
  '/css/views/history.css',
  '/css/views/settings.css',
  '/js/gitFs.js',
  '/js/gitStore.js',
  '/js/gitRemote.js',
  '/js/main.js',
  '/js/store.js',
  '/js/selectionManager.js',
  '/js/undoRedoManager.js',
  '/js/utils/cacheManager.js',
  '/js/utils/common.js',
  '/js/utils/contactHelper.js',
  '/js/utils/modal.js',
  '/js/utils/performance.js',
  '/js/utils/taskParser.js',
  '/js/utils/timeFilter.js',
  '/js/views/document.js',
  '/js/views/history.js',
  '/js/views/kanban.js',
  '/js/views/settings.js',
  '/js/views/timeline.js',
  '/js/widgets/codeMirrorWidgets.js',
  '/js/menus/taskMenus.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Skip non-GET and cross-origin requests
  if (event.request.method !== 'GET' || url.origin !== location.origin) return;

  // Skip CodeMirror CDN and Google Fonts — always fetch from network
  if (url.hostname === 'cdn.jsdelivr.net' || url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      });
    }).catch(() => {
      if (event.request.mode === 'navigate') {
        return caches.match('/index.html');
      }
    })
  );
});
