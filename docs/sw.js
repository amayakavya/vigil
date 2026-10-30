/* Keeps VIGIL usable with no connection, the way a workshop computer runs it.
   Network first, so a published change is seen at once when online; the
   cached copy only when the network is not there. */
const CACHE = "vigil-v2";
const CORE = ["./", "index.html", "results.html", "house.css", "console.css", "console.js", "diagnose.js", "vigil.js", "worker.js",
  "sheet.svg", "fonts/inter.woff2", "icon-192.png", "manifest.webmanifest",
  "data/replay.json", "data/cwru.json", "data/samples.json"];
self.addEventListener("install", e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting())));
self.addEventListener("activate", e => e.waitUntil(
  caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET" || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(fetch(e.request).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
    return res;
  }).catch(() => caches.match(e.request).then(hit => hit || (e.request.mode === "navigate" ? caches.match("index.html") : Response.error()))));
});
