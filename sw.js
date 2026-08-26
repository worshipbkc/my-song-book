// ប្តូរលេខ Version នេះ (ឧ. v1 -> v2) រាល់ពេលអ្នកកែប្រែ UI/HTML
const CACHE_NAME = 'worship-app-v2';

// ឯកសារStatic ដែលត្រូវ Cache ទុកប្រើ Offline
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './manifest.json',
  './icon.jpg',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
  'https://fonts.googleapis.com/css2?family=Kantumruy+Pro:wght@400;500;600;700&display=swap'
];

// Install Event - ចុះឈ្មោះ Cache ថ្មី
self.addEventListener('install', (event) => {
  self.skipWaiting(); // បង្ខំឱ្យ Service Worker ថ្មីដំណើរការភ្លាមៗ
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
});

// Activate Event - លុប Cache ចាស់ៗចោលស្វ័យប្រវត្តិ
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME) {
            return caches.delete(cache);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch Event - Network-First Strategy សម្រាប់កូដ UI
// ព្យាយាមទាញយកកូដថ្មីពី Server មុន បើគ្មានអ៊ីនធឺណិត ទើបយកកូដក្នុង Cache មកប្រើ
self.addEventListener('fetch', (event) => {
  // មិនធ្វើ Cache លើ Request របស់ Firebase Firestore ឡើយ (ដើម្បីកុំឱ្យជាន់គ្នា)
  if (event.request.url.includes('firestore.googleapis.com') || 
      event.request.url.includes('identitytoolkit.googleapis.com')) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        // បើទាញយកបានជោគជ័យ យកទៅ Update ក្នុង Cache ទុកប្រើ Offline លើកក្រោយ
        if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      })
      .catch(() => {
        // បើដាច់អ៊ីនធឺណិត (Offline) ទើបយកកូដពី Cache មកបង្ហាញ
        return caches.match(event.request);
      })
  );
});
