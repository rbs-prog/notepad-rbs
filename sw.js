const C = 'notas-v1', FILES = ['./', 'index.html', 'manifest.json', 'icons/icon.svg', 'sync.js'];
self.addEventListener('install', e => e.waitUntil(caches.open(C).then(c => c.addAll(FILES))));
self.addEventListener('fetch', e => e.respondWith(fetch(e.request).catch(() => caches.match(e.request))));
