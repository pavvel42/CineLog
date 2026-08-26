// CineLog Service Worker - Network-First / Stale-While-Revalidate Caching for PWA
const CACHE_NAME = "cinelog-v10.30.0";
const STATIC_ASSETS = [
  "./",
  "manifest.json",
  "static/css/style.css?v=10.30",
  "static/dist/app.min.js?v=10.30",
  "static/dist/drive_sync.min.js?v=10.30",
  "static/js/theme_bootstrap.js?v=10.30",
  "static/js/sw_register.js?v=10.30",
  "static/icons/icon-192.png",
  "static/icons/icon-512.png",
  "static/icons/icon-maskable.png",
  "static/icons/apple-touch-icon.png",
  "static/icons/favicon.png"
];

// Install Event - Pre-cache core shell
self.addEventListener("install", (evt) => {
  self.skipWaiting();
  evt.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch((e) => console.warn("SW precache failed:", e));
    })
  );
});

// Activate Event - Immediately delete ALL old caches
self.addEventListener("activate", (evt) => {
  evt.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch Event - Network-First for JS modules & API, Cache-First for static assets
self.addEventListener("fetch", (evt) => {
  const url = new URL(evt.request.url);

  // Ignore non-GET and non-http requests
  if (evt.request.method !== "GET" || !url.protocol.startsWith("http")) {
    return;
  }

  // Network-First for JS and APIs to ensure instant updates
  if (url.pathname.endsWith(".js") || url.pathname.startsWith("/api/")) {
    evt.respondWith(
      fetch(evt.request)
        .then((networkResponse) => {
          if (networkResponse.ok && networkResponse.type === "basic") {
            const resClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(evt.request, resClone));
          }
          return networkResponse;
        })
        .catch(() => caches.match(evt.request))
    );
    return;
  }

  // Stale-While-Revalidate for images, styles, fonts
  evt.respondWith(
    caches.match(evt.request).then((cachedResponse) => {
      const fetchPromise = fetch(evt.request)
        .then((networkResponse) => {
          if (networkResponse.ok && networkResponse.type === "basic") {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(evt.request, responseToCache));
          }
          return networkResponse;
        })
        .catch(() => cachedResponse);

      return cachedResponse || fetchPromise;
    })
  );
});
