const CACHE_NAME = "vetinstant-dashboard-v71";

const APP_SHELL_FILES = [
  "./assets/logo-vetinstant.png",
];

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) =>
        Promise.all(
          cacheNames.map((cacheName) => {
            if (cacheName !== CACHE_NAME) {
              console.log("[SW] Deleting stale cache:", cacheName);
              return caches.delete(cacheName);
            }
          })
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  // CRITICAL: NEVER intercept browser navigation requests (HTML page loads, redirects)!
  // Bypassing navigation requests allows the browser to natively load index.html over HTTPS,
  // handle GitHub Pages trailing-slash 301 redirects, and avoid Chromium RequestInit TypeError.
  if (event.request.mode === "navigate") {
    return;
  }

  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);

  // CRITICAL: NEVER intercept or cache API requests, cross-origin requests, or non-static requests!
  // Any call to backend, ngrok, EC2, or containing /api/ must bypass the Service Worker completely!
  if (url.origin !== self.location.origin || url.pathname.includes("/api/")) {
    return;
  }

  // Network-first for JS and CSS so updates are loaded immediately
  const isCode =
    url.pathname.endsWith(".js") ||
    url.pathname.endsWith(".css");

  if (isCode) {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const clone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return networkResponse;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Static assets (images, fonts, manifest): Cache-first with network fallback
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) return cachedResponse;
      return fetch(event.request).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const clone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return networkResponse;
      });
    })
  );
});
