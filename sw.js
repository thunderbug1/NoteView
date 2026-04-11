const CACHE_NAME = 'noteview-v3';

const PRECACHE_URLS = [
  './',
  './index.html',
  './icon.svg',
  './manifest.json',
  './css/base.css',
  './css/layout.css?v=2',
  './css/components.css',
  './css/editor.css',
  './css/views/document.css',
  './css/views/timeline.css',
  './css/views/kanban.css',
  './css/views/history.css',
  './css/views/settings.css?v=2',
  './vendor/marked.js?v=1',
  './vendor/isomorphic-git.js?v=1',
  './vendor/codemirror.js?v=1',
  './js/gitFs.js',
  './js/gitStore.js',
  './js/gitRemote.js',
  './js/undoRedoManager.js?v=5',
  './js/store.js?v=9',
  './js/selectionManager.js?v=2',
  './js/utils/cacheManager.js',
  './js/utils/common.js',
  './js/utils/contactHelper.js',
  './js/utils/modal.js',
  './js/utils/performance.js',
  './js/utils/taskParser.js',
  './js/utils/timeFilter.js',
  './js/utils/sortManager.js',
  './js/widgets/codeMirrorWidgets.js',
  './js/menus/taskMenus.js',
  './js/views/history.js',
  './js/views/document.js?v=4',
  './js/views/timeline.js?v=3',
  './js/views/kanban.js?v=4',
  './js/views/settings.js?v=4',
  './js/main.js?v=13',
];

function shouldUseNetworkFirst(request) {
  if (request.mode === 'navigate') {
    return true;
  }

  const destination = request.destination;
  return destination === 'script' || destination === 'style';
}

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

  if (shouldUseNetworkFirst(event.request)) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(event.request);
          if (cached) {
            return cached;
          }

          if (event.request.mode === 'navigate') {
            return caches.match('./index.html');
          }

          throw new Error(`No cached response for ${event.request.url}`);
        })
    );
    return;
  }

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
        return caches.match('./index.html');
      }
    })
  );
});
