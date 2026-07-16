/**
 * llm-wiki Service Worker template (LMVK L4)
 *
 * Rendered to sw.js at export time by html_export/service_worker.py, which
 * substitutes __CACHE_VERSION__ (build-timestamp-versioned cache name) and
 * __PRECACHE_URLS__ (build-time precache manifest, full site or the
 * degraded "index + recent 30 days" set). Do not edit the emitted sw.js
 * by hand -- edit this template.
 */

var CACHE_VERSION = "__CACHE_VERSION__";
var PRECACHE_URLS = __PRECACHE_URLS__;

// Install: precache the build-time manifest. Each URL is added
// individually so one failed fetch (page deleted between manifest build
// and install, transient 401 re-prompt, ...) doesn't brick the install.
self.addEventListener("install", function (event) {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then(function (cache) {
        return Promise.all(
          PRECACHE_URLS.map(function (url) {
            return cache.add(url).catch(function () {
              /* skip: stale-while-revalidate will pick it up on first visit */
            });
          })
        );
      })
      .then(function () {
        return self.skipWaiting();
      })
  );
});

// Activate: cache version follows the build timestamp, so every cache
// that isn't this build's is a previous build -- delete them all
// (LMVK L4: "缓存版本随构建时间戳失效").
self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches
      .keys()
      .then(function (names) {
        return Promise.all(
          names
            .filter(function (name) {
              return name !== CACHE_VERSION;
            })
            .map(function (name) {
              return caches.delete(name);
            })
        );
      })
      .then(function () {
        return self.clients.claim();
      })
  );
});

// Fetch: stale-while-revalidate for same-origin GET only. Cross-origin
// requests (CDN prism/mermaid/chart) and non-GET pass through untouched.
// Plain fetch(request) keeps basic_auth working -- the browser attaches
// the Authorization header itself, and no cache-busting query params are
// added (they would defeat the auth cache).
self.addEventListener("fetch", function (event) {
  var request = event.request;
  if (request.method !== "GET") return;
  if (new URL(request.url).origin !== self.location.origin) return;

  event.respondWith(
    caches.open(CACHE_VERSION).then(function (cache) {
      return cache.match(request).then(function (cached) {
        var refresh = fetch(request)
          .then(function (response) {
            if (response && response.ok) {
              cache.put(request, response.clone());
            }
            return response;
          })
          .catch(function () {
            // Offline: fall back to whatever we have (may be undefined
            // for a never-cached page -- that surfaces as a normal
            // network error, which is the honest answer).
            return cached;
          });
        if (cached) {
          // Serve stale immediately; keep the worker alive until the
          // background revalidation lands in the cache.
          event.waitUntil(refresh);
          return cached;
        }
        return refresh;
      });
    })
  );
});
