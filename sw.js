// Nur Cache-Einträge dieser Anwendung verwalten, niemals fremde Caches löschen.
const CACHE = "druckmarkt-handy-3";
const FILES = ["./", "index.html", "app.js", "manifest.webmanifest", "icon-180.png", "icon-512.png"];
self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES.map(file => new Request(file, {cache:"reload"})))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", event => {
  event.waitUntil(Promise.all([caches.delete("druckmarkt-handy-1"), caches.delete("druckmarkt-handy-2"), self.clients.claim()]));
});
self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url), scope = new URL(self.registration.scope);
  if (url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return;
  const allowed = FILES.map(file => new URL(file, scope).pathname);
  if (!allowed.includes(url.pathname)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req, {ignoreSearch:true});
    if (hit) return hit;
    if (req.mode === "navigate") { const page = await cache.match("index.html"); if (page) return page; }
    return fetch(req);
  })());
});
