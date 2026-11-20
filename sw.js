// Service worker : appli installable + fonctionnement hors connexion.
// Pages et scripts du site : réseau d'abord (les mises à jour arrivent tout de suite), cache si hors ligne.
// Supabase (données, connexion) : jamais mis en cache.
// Étape 62 (fiabilité du chargement) : repli vers index.html seulement pour une navigation (page) ; un script,
// un style ou une image absents du cache reçoivent une erreur réseau normale (plus jamais du HTML à la place).
// Installation fichier par fichier ; le cache des images « vocab-img » (étape 49) est gardé à l'activation.
const CACHE = "vocab-v13";
const CORE = ["./", "./index.html", "./config.js", "./pwa.js", "./manifest.webmanifest",
  "./icons/icon-192.png", "./icons/icon-512.png", "./icons/apple-touch-icon.png"];

// Un fichier à la fois : un fichier qui échoue ne fait plus échouer les autres (il sera pris au réseau plus tard).
const addEach = (c, urls) => Promise.all(urls.map((u) => c.add(u).catch(() => {})));

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => addEach(c, CORE)
    .then(() => fetch("./index.html", { cache: "no-cache" })).then((r) => r.text())
    .then((html) => addEach(c, [...html.matchAll(/(?:src|href)="((?:css|js)\/[^"]+)"/g)].map((m) => "./" + m[1]))))
    .catch(() => {}).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys()
    // Seulement les anciens caches de l'appli « vocab-vNN » ; « vocab-img » (images des cartes) et les autres restent.
    .then((keys) => Promise.all(keys.filter((k) => /^vocab-v\d+$/.test(k) && k !== CACHE).map((k) => caches.delete(k))))
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
  }).catch(() => caches.match(req).then((hit) => {
    if (hit) return hit;
    if (req.mode === "navigate") return caches.match("./index.html").then((page) => page || Response.error());   // page : appli hors connexion
    return Response.error();                                 // script, style, image… : erreur réseau normale, jamais index.html
  })));
});

// === NOTIFICATIONS PUSH (étape 32) ===
// Message envoyé par la fonction Supabase « send-push » (chiffré, déchiffré par le navigateur) :
// { id, title, body, url, icon, badge, image, lang, click, tag }
//   url   : écran à ouvrir (ex. https://juleseg.github.io/vocab/?n=<id>#review) ; ?n=<id> permet à l'appli d'enregistrer le clic
//   click : adresse qui enregistre le clic même si l'appli n'est pas connectée
self.addEventListener("push", (e) => {
  let m = {};
  try { m = e.data ? e.data.json() : {}; } catch (err) { m = { body: e.data ? e.data.text() : "" }; }
  const title = m.title || "Vocab";
  const opts = {
    body: m.body || "",
    icon: m.icon || "icons/icon-192.png",
    badge: m.badge || "icons/icon-192.png",
    tag: m.tag || undefined,
    lang: m.lang || undefined,
    data: { id: m.id || null, url: m.url || "./", click: m.click || null }
  };
  if (m.image) opts.image = m.image;
  e.waitUntil(self.registration.showNotification(title, opts));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const d = e.notification.data || {};
  const target = new URL(d.url || "./", self.registration.scope);
  e.waitUntil((async () => {
    // Clic enregistré (sans attendre de réponse ; sans effet si hors ligne)
    if (d.click) { try { await fetch(d.click, { method: "GET", mode: "no-cors", keepalive: true }); } catch (err) {} }
    // Onglet de l'appli déjà ouvert : on le réutilise (écran changé par un message), sinon nouvel onglet.
    const list = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const scope = self.registration.scope;
    const tab = list.find((c) => c.url.startsWith(scope));
    if (tab) {
      try { await tab.focus(); } catch (err) {}
      tab.postMessage({ type: "push-open", id: d.id, hash: target.hash || "#home" });
      return;
    }
    if (self.clients.openWindow) await self.clients.openWindow(target.href);
  })());
});
