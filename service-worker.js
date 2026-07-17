const CACHE_NAME = "vetinstant-dashboard-v35";

const APP_SHELL_FILES = [
  "./",
  "./index.html",
  "./styles.css",
  "./manifest.webmanifest",
  "./assets/icons/dashboard.svg",
  "./assets/icons/animals.svg",
  "./assets/icons/horses.svg",
  "./assets/icons/health.svg",
  "./assets/icons/alerts.svg",
  "./assets/icons/sync.svg",
  "./assets/icons/settings.svg",
  "./assets/icons/bell.svg",
  "./assets/icons/user.svg",
  "./assets/icons/menu.svg",
  "./assets/icons/kpi-total.svg",
  "./assets/icons/kpi-healthy.svg",
  "./assets/icons/kpi-risk.svg",
  "./assets/icons/kpi-sick.svg",
  "./assets/icons/kpi-estrous.svg",
  "./assets/icons/kpi-vaccination.svg",
  "./assets/icons/risk-infection.svg",
  "./assets/icons/risk-respiratory.svg",
  "./assets/icons/risk-udder.svg",
  "./assets/icons/risk-chronic.svg",
  "./assets/icons/risk-heat.svg",
  "./assets/icons/pwa-192.svg",
  "./assets/icons/pwa-512.svg",
];

function isNetworkFirst(url, request) {
  return (
    request.mode === "navigate" ||
    url.pathname.endsWith(".html") ||
    url.pathname.endsWith(".js") ||
    url.pathname.endsWith(".css")
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL_FILES))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) =>
      Promise.all(
        cacheNames
          .filter((cacheName) => cacheName !== CACHE_NAME)
          .map((cacheName) => caches.delete(cacheName))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);

  if (isNetworkFirst(url, event.request)) {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseClone));
          return networkResponse;
        })
        .catch(() =>
          caches.match(event.request).then((cached) => cached || caches.match("./index.html"))
        )
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) return cachedResponse;
      return fetch(event.request).then((networkResponse) => {
        const responseClone = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseClone));
        return networkResponse;
      });
    })
  );
});
