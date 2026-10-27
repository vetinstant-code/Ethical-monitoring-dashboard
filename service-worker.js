const CACHE_NAME = "vetinstant-dashboard-v62";

const APP_SHELL_FILES = [
  "./",
  "./index.html",
  "./styles.css",
  "./manifest.webmanifest",
  "./assets/logo-vetinstant.png",
];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // Best-effort cache of shell files so missing optional assets don't fail install
      return Promise.allSettled(
        APP_SHELL_FILES.map((file) =>
          cache.add(file).catch((err) => console.warn("[SW] Cache add skipped:", file, err))
        )
      );
    })
  );
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
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);

  // CRITICAL: NEVER intercept or cache API requests, cross-origin requests, or non-static requests!
  // Any call to backend, ngrok, EC2, or containing /api/ must bypass the Service Worker completely!
  if (url.origin !== self.location.origin || url.pathname.includes("/api/")) {
    return;
  }

  // Network-first with no-store for HTML, JS, CSS so normal reloads ALWAYS fetch latest versions immediately!
  const isCode =
    event.request.mode === "navigate" ||
    url.pathname.endsWith(".html") ||
    url.pathname.endsWith(".js") ||
    url.pathname.endsWith(".css");

  if (isCode) {
    event.respondWith(
      fetch(event.request, { cache: "no-store" })
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const clone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return networkResponse;
        })
        .catch(() =>
          caches.match(event.request).then((cached) => cached || caches.match("./index.html"))
        )
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
