/* =========================================================
   RAMPUR FREE TUITION - SERVICE WORKER

   Job of this file: make the APP SHELL (html/css/js/icons and
   the CDN libraries it depends on) available offline.
   It does NOT cache Supabase API responses - application data
   lives in IndexedDB (see offline-core.js), not the SW cache.

   Bump CACHE_NAME whenever any shell file changes so old
   clients pick up the new version instead of staying stuck
   on stale cached JS/CSS.
   ========================================================= */

const CACHE_NAME = "rampur-free-tuition-v8";

const APP_SHELL = [
    "./",
    "./index.html",
    "./manifest.json",
    "./style.css",
    "./script.js",
    "./offline-core.js",
    "./icons/icon-192.png",
    "./icons/icon-512.png"
];

// External dependencies the app cannot run without. Cached on a
// best-effort basis - if the CDN is briefly unreachable during
// install, the rest of the shell still gets cached.
const EXTERNAL_SHELL = [
    "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2",
    "https://cdn.jsdelivr.net/npm/eruda"
];

self.addEventListener("install", event => {

    event.waitUntil(
        caches.open(CACHE_NAME).then(async cache => {

            // Local files: fail loudly if any of these are missing,
            // since a broken app shell is worth knowing about.
            await cache.addAll(APP_SHELL);

            // External CDN files: best effort, never block install.
            await Promise.allSettled(
                EXTERNAL_SHELL.map(url =>
                    fetch(url, { mode: "cors" })
                        .then(response => {
                            if (response && response.ok) {
                                return cache.put(url, response);
                            }
                        })
                        .catch(() => { /* offline during install - fine, skip it */ })
                )
            );
        })
    );

    self.skipWaiting();
});

self.addEventListener("activate", event => {

    event.waitUntil(
        caches.keys().then(names =>
            Promise.all(
                names
                    .filter(name => name !== CACHE_NAME)
                    .map(name => caches.delete(name))
            )
        )
    );

    self.clients.claim();
});

function isSupabaseRequest(url) {
    return url.includes(".supabase.co");
}

self.addEventListener("fetch", event => {

    const request = event.request;
    const url = request.url;

    // Never let the Service Worker touch Supabase traffic - that's
    // live application data, not app shell, and must always hit
    // the network (or fail fast so the app's own offline-queue
    // logic can take over).
    if (isSupabaseRequest(url)) {
        return;
    }

    if (request.mode === "navigate") {
        // Network-first for the page itself, so a teacher who IS
        // online always gets the latest shell; falls back to the
        // cached shell the moment the network is unavailable.
        event.respondWith(
            fetch(request)
                .then(response => {
                    const copy = response.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put("./index.html", copy));
                    return response;
                })
                .catch(() => caches.match("./index.html"))
        );
        return;
    }

    // Everything else (JS/CSS/icons/CDN libs): cache-first, and
    // opportunistically refresh the cache when a network fetch
    // does succeed, so the next offline session has the latest copy.
    event.respondWith(
        caches.match(request).then(cached => {
            const networkFetch = fetch(request)
                .then(response => {
                    if (response && response.ok) {
                        const copy = response.clone();
                        caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
                    }
                    return response;
                })
                .catch(() => cached);

            return cached || networkFetch;
        })
    );
});
