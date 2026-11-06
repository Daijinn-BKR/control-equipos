// Guarda la pantalla de la app para que abra rápido.
// Los datos (Supabase) nunca se guardan aquí: siempre se piden en línea.
const CACHE = "control-equipos-v4";
const BASE = ["./", "index.html", "app.js", "config.js", "manifest.webmanifest", "icons/icon-192.png", "icons/logo-omega.png", "icons/icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(BASE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.hostname.endsWith("supabase.co") || url.hostname === "quickchart.io") return; // siempre en línea
  e.respondWith(
    fetch(req, url.origin === self.location.origin ? { cache: "no-cache" } : undefined)
      .then((res) => {
        if (res.ok && url.origin === self.location.origin) {
          const copia = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copia));
        }
        return res;
      })
      .catch(() => caches.match(req).then((m) => m || caches.match("index.html")))
  );
});
