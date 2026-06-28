// Service worker: runtime caching so the app works offline after the first visit.
const CACHE = "gkt-cache-v1";
// App base path (e.g. "/" or "/<repo>/") derived from where the SW is served.
const BASE = new URL("./", self.location).pathname;

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return; // skip cross-origin (e.g. fonts CDN)
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);

    // Page navigations: network-first, fall back to the cached shell when offline
    if (req.mode === "navigate") {
      try {
        const net = await fetch(req);
        cache.put(req, net.clone());
        return net;
      } catch {
        return (await cache.match(req)) || (await cache.match(BASE + "index.html")) || (await cache.match(BASE)) || Response.error();
      }
    }

    // Static assets: cache-first with a background refresh (stale-while-revalidate)
    const cached = await cache.match(req);
    if (cached) {
      fetch(req).then(res => { if (res && res.ok) cache.put(req, res.clone()); }).catch(() => {});
      return cached;
    }
    try {
      const net = await fetch(req);
      if (net && net.ok) cache.put(req, net.clone());
      return net;
    } catch {
      return Response.error();
    }
  })());
});
