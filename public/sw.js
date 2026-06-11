/**
 * Unbox mobile cabinet — minimal service worker.
 *
 * Why it exists: Chrome/Edge/Samsung Browser refuse to install a PWA as
 * a proper WebAPK without an active service worker that has a fetch handler.
 * Without one, Android falls back to a shortcut/bookmark or builds a malformed
 * APK that Play Protect flags as suspicious. This file just satisfies the
 * install criteria; it doesn't try to do offline caching yet (next phase).
 *
 * Strategy: network-only with a graceful offline shell only for navigations
 * that already cached the bare HTML. We deliberately skip caching JS/CSS
 * assets — Vite hashes them per build, so a stale-cache strategy would
 * pin users on dead bundles after a deploy.
 */

// Bump CACHE_VERSION on every deploy so the cache name changes and the
// activate handler below evicts the previous shell cache — prevents users
// from being pinned on a stale HTML shell after a release.
const CACHE_VERSION = 'v2';
const CACHE_NAME = `unbox-mobile-shell-${CACHE_VERSION}`;
const SHELL_URLS = ['/', '/m', '/m/today', '/manifest.webmanifest', '/icons/icon-192.png'];

self.addEventListener('install', (event) => {
    // Pre-cache the bare app shell so the icon at least opens *something*
    // when the user is offline. JS/CSS will still need network — this is
    // not a full offline mode, just a reassuring shell.
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_URLS).catch(() => null))
    );
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    // Drop old shell caches on each new SW deploy.
    event.waitUntil(
        caches.keys().then((keys) => Promise.all(
            keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
        )).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const req = event.request;

    // Only handle GET — POST/PATCH/DELETE always go to network.
    if (req.method !== 'GET') return;

    // Network-first for HTML navigations. Only fall back to the cached shell
    // when the browser is *genuinely* offline — a flaky-network fetch reject
    // while online would otherwise serve a stale shell and pin users on dead
    // bundles after a deploy (white screen). When online, let the error bubble
    // so the browser's own retry/error handling kicks in.
    if (req.mode === 'navigate') {
        event.respondWith(
            fetch(req).catch((err) => {
                if (!navigator.onLine) {
                    return caches.match('/m').then((m) => m || caches.match('/'));
                }
                throw err;
            })
        );
        return;
    }

    // For everything else (assets, API), pass through to network. Letting
    // axios/api errors bubble up keeps the app behaviour predictable.
});
