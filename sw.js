const CACHE_NAME = 'worship-songs-v1';
const ASSETS_TO_CACHE = [
    './',
    './index.html',
    './manifest.json',
    './icon.jpg',
    'https://fonts.googleapis.com/css2?family=Kantumruy+Pro:wght@400;500;600;700&display=swap',
    'https://www.gstatic.com/firebasejs/8.10.1/firebase-app.js',
    'https://www.gstatic.com/firebasejs/8.10.1/firebase-firestore.js',
    'https://www.gstatic.com/firebasejs/8.10.1/firebase-auth.js'
];

// ពេលដំឡើង Service Worker
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(ASSETS_TO_CACHE);
        })
    );
    self.skipWaiting();
});

// សម្អាត Cache ចាស់ពេលមាន Version ថ្មី
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys.map((key) => {
                    if (key !== CACHE_NAME) {
                        return caches.delete(key);
                    }
                })
            );
        })
    );
    self.clients.claim();
});

// ទាញយកទិន្នន័យពី Cache មកវិញពេលប្រើប្រាស់
self.addEventListener('fetch', (event) => {
    event.respondWith(
        caches.match(event.request).then((cachedResponse) => {
            if (cachedResponse) {
                return cachedResponse;
            }
            return fetch(event.request).catch(() => {
                // ករណីគ្មានអ៊ិនធឺណិត ហើយសំណើគឺចូលទំព័រ HTML
                if (event.request.mode === 'navigate') {
                    return caches.match('./index.html');
                }
            });
        })
    );
});
