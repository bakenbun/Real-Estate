const CACHE_NAME = "buildledger-v1";
const STATIC_ASSETS = [
    "./",
    "./index.html",
    "./styles.css",
    "./app.js",
    "./manifest.json",
    "./icons/favicon-16.png",
    "./icons/favicon-32.png",
    "./icons/apple-touch-icon.png",
    "./icons/icon-192.png",
    "./icons/icon-512.png"
];

// Install: pre-cache static layout elements
self.addEventListener("install", (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            console.log("[Service Worker] Pre-caching static assets...");
            return cache.addAll(STATIC_ASSETS);
        }).then(() => self.skipWaiting())
    );
});

// Activate: clean up old caches
self.addEventListener("activate", (event) => {
    event.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys.map((key) => {
                    if (key !== CACHE_NAME) {
                        console.log("[Service Worker] Removing old cache:", key);
                        return caches.delete(key);
                    }
                })
            );
        }).then(() => self.clients.claim())
    );
});

// Fetch: Stale-While-Revalidate for static assets, network-only for APIs
self.addEventListener("fetch", (event) => {
    const url = new URL(event.request.url);

    // Bypass database sync APIs (do not cache current records!)
    if (url.pathname.includes("/api/")) {
        return; // let it naturally fall back to network fetch
    }

    // Handle local pages & assets
    event.respondWith(
        caches.match(event.request).then((cachedResponse) => {
            const fetchPromise = fetch(event.request).then((networkResponse) => {
                // Cache new static pages / assets
                if (networkResponse && networkResponse.status === 200 && event.request.method === "GET") {
                    const responseToCache = networkResponse.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(event.request, responseToCache);
                    });
                }
                return networkResponse;
            }).catch(() => {
                // Handle offline scenario
                return cachedResponse;
            });

            // Return cached immediately if available, while updating cache behind the scenes.
            // Otherwise, wait for network fetch response.
            return cachedResponse || fetchPromise;
        })
    );
});
