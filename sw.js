// ប្តូរលេខ Version នេះទៅ v3 ដើម្បីបង្ខំឱ្យ App Update ទិន្នន័យថ្មី
const CACHE_NAME = 'worship-app-v3';

// ឯកសារ Static ដែលត្រូវ Cache ទុកប្រើ Offline
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './style.css',      // បន្ថែម File CSS ថ្មី
  './app.js',         // បន្ថែម File JS ថ្មី
  './manifest.json',
  './icon.jpg',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
  'https://fonts.googleapis.com/css2?family=Kantumruy+Pro:wght@400;500;600;700&display=swap'
];

// Fetch Event - ចែកចេញជា ២ យុទ្ធសាស្ត្រ (សម្រាប់រូបភាព និង សម្រាប់កូដ)
self.addEventListener('fetch', (event) => {
  // មិនធ្វើ Cache លើ Request របស់ Firebase ឡើយ
  if (event.request.url.includes('firestore.googleapis.com') || 
      event.request.url.includes('identitytoolkit.googleapis.com')) {
    return;
  }

  // ១. យុទ្ធសាស្ត្រ "Cache-First" សម្រាប់រូបភាព (សន្សំសំចៃអ៊ីនធឺណិត)
  if (event.request.destination === 'image' || event.request.url.includes('res.cloudinary.com')) {
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        // បើមានរូបភាពក្នុង Cache ស្រាប់ (ដែលបាន Download ទុក) គឺយកមកបង្ហាញភ្លាមៗ
        if (cachedResponse) {
          return cachedResponse;
        }
        // បើគ្មានទេ ទើបព្យាយាមទាញយកពីអ៊ីនធឺណិត
        return fetch(event.request);
      })
    );
    return;
  }

  // ២. យុទ្ធសាស្ត្រ "Network-First" សម្រាប់កូដ HTML, CSS, JS ដូចចាស់ 
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
