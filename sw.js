const CACHE_NAME = 'noor-v1';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Pass-through fetch handler — required by some browsers for a page to be
// considered "installable" as a home-screen app.
self.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
});

// Real push messages arrive here, sent by the send-notifications Netlify
// Function — this fires even if the app isn't open, as long as the browser
// process is running in the background (this is what makes it reliable).
self.addEventListener('push', (event) => {
  let data = { title: 'Prayer time', body: "It's time to pray." };
  try {
    if (event.data) data = event.data.json();
  } catch (e) {
    if (event.data) data.body = event.data.text();
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      tag: data.tag || 'noor-prayer',
      requireInteraction: false
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((clientList) => {
      if (clientList.length > 0) {
        return clientList[0].focus();
      }
      return self.clients.openWindow('./index.html');
    })
  );
});
