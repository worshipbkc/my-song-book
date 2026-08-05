const CACHE_NAME = 'worship-songs-v1';
const ASSETS_TO_CACHE = [
  './',
  './gemini-code-1785902308624.html',
  'https://fonts.googleapis.com/css2?family=Kantumruy+Pro:wght@400;500;600;700&display=swap',
  'https://www.gstatic.com/firebasejs/8.10.1/firebase-app.js',
  'https://www.gstatic.com/firebasejs/8.10.1/firebase-firestore.js',
  'https://www.gstatic.com/firebasejs/8.10.1/firebase-auth.js'
];

// ពេលដំឡើង Service Worker ដំបូង
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
  self.skipWaiting();
});

// សម្អាត Cache ចាស់ៗពេលមាន Version ថ្មី
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

// ទប់ស្កាត់សំណើ Network ហើយទាញយកពី Cache មកវិញ (Cache First Strategy)
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse; // បើមានក្នុង Cache រួចស្រេច ទាញយកមកបង្ហាញភ្លាម
      }
      return fetch(event.request).then((networkResponse) => {
        // រក្សាទុករូបភាព ឬទិន្នន័យថ្មីៗចូល Cache ដោយស្វ័យប្រវត្តិ
        return caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, networkResponse.clone());
          return networkResponse;
        });
      }).catch(() => {
        // ករណីគ្មានអ៊ីនធឺណិត និងគ្មានក្នុង Cache
      });
    })
  );
});
