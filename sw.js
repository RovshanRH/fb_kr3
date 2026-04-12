const STATIC_CACHE_NAME = 'app-shell-v3';
const DYNAMIC_CACHE_NAME = 'dynamic-content-v3';

const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/app.js',
  '/styles/styles.css',
  '/manifest.json',
  '/content/home.html',
  '/content/about.html',
  '/icons/favicon.ico',
  '/icons/favicon-16x16.png',
  '/icons/favicon-32x32.png',
  '/icons/favicon-64x64.png',
  '/icons/favicon-128x128.png',
  '/icons/favicon-256x256.png',
  '/icons/favicon-512x512.png',
  '/icons/android-chrome-192x192.png',
  '/icons/android-chrome-512x512.png',
  '/icons/apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE_NAME)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys
        .filter((key) => key !== STATIC_CACHE_NAME && key !== DYNAMIC_CACHE_NAME)
        .map((key) => caches.delete(key))
    )).then(() => self.clients.claim())
  );
});
self.addEventListener('notificationclick', (event) => {
  const notification = event.notification;
  const action = event.action;
  if (action === 'snooze') {
    console.log("Snooze clicked");
    // Получаем id напоминания из данных уведомления
    const reminderId = notification.data.reminderId;
    // Отправляем запрос на сервер для откладывания
    event.waitUntil(
      fetch(`/snooze?reminderId=${reminderId}`, { method: 'POST' })
        .then(() => notification.close())
        .catch(err => console.error('Snooze failed:', err))
    );
    console.log("Snooze called for reminder:", reminderId);

  } else {
    // При клике на само уведомление просто закрываем его
    notification.close();
  }
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== 'GET') {
    return;
  }

  if (url.origin !== self.location.origin) {
    return;
  }

  if (url.pathname.startsWith('/content/')) {
    event.respondWith(
      fetch(request)
        .then((networkRes) => {
          const resClone = networkRes.clone();
          caches.open(DYNAMIC_CACHE_NAME).then((cache) => cache.put(request, resClone));
          return networkRes;
        })
        .catch(() => caches.match(request)
          .then((cached) => cached || caches.match('/content/home.html')))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) {
        return cached;
      }

      return fetch(request).then((networkRes) => {
        const copy = networkRes.clone();
        caches.open(STATIC_CACHE_NAME).then((cache) => cache.put(request, copy));
        return networkRes;
      });
    })
  );
});

self.addEventListener('push', (event) => {
  let data = { title: 'Новое уведомление', body: '', reminderId: null };
  if (event.data) {
    data = event.data.json();
  }
  const options = {
    body: data.body,
    icon: '/icons/favicon-128x128.png',
    badge: '/icons/favicon-48x48.png',
    data: { reminderId: data.reminderId }// для идентификации в click
  };
  // Добавляем кнопку только если это напоминание
  if (data.reminderId) {
    options.actions = [
      { action: 'snooze', title: 'Отложить на 5 минут' }
    ];
  }
  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});
