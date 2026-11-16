// Service worker : appli installable + fonctionnement hors connexion.
// Pages et scripts du site : réseau d'abord (les mises à jour arrivent tout de suite), cache si hors ligne.
// Supabase (données, connexion) : jamais mis en cache.
const CACHE = "vocab-v10";
const CORE = ["./", "./index.html", "./config.js", "./pwa.js", "./manifest.webmanifest",
  "./icons/icon-192.png", "./icons/icon-512.png", "./icons/apple-touch-icon.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE).catch(() => {})).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.hostname.endsWith("supabase.co")) return;          // données : toujours en direct
  const sameOrigin = url.origin === self.location.origin;
  const isCdn = url.hostname === "cdn.jsdelivr.net";
  if (!sameOrigin && !isCdn) return;

  if (isCdn || url.pathname.includes("/icons/")) {           // fichiers fixes : cache d'abord
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    })));
    return;
  }

  e.respondWith(fetch(req).then((res) => {                   // reste du site : réseau d'abord
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
    return res;
  }).catch(() => caches.match(req).then((hit) => hit || caches.match("./index.html"))));
});
