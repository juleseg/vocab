"use strict";

// === IMAGES SUR LES CARTES (ÉTAPE 49) ===
// Une carte vocab peut avoir une image : champ image = { path, src: "photo" | "wikimedia", author, license, page, size }
// (normCardImage, js/storage.js). Mode Supabase seulement (script supabase-etape49.sql) ; ailleurs, le bouton n'apparaît pas.
//
// Stockage : bucket privé « card-images » de Supabase Storage.
//  - <id du compte>/<nom>.webp|jpg : images du compte (photo réduite, ou image Wikimedia recopiée), comptées dans SON quota
//    (50 Mo, calculé et vérifié par le serveur ; admin sans limite) ;
//  - common/<sens>/<nom>.webp : images du dictionnaire commun, validées par l'admin (onglet Images de l'écran Dictionnaire).
//  Lecture par liens signés (1 h), jamais d'adresse publique. Images d'une liste commune : lisibles par ses membres.
// Traitement dans l'appli (imgProcess) : carré centré (ou image entière), 512 px au plus, WebP (sinon JPEG), ≈ 60 Ko au plus.
// Wikimedia Commons : API appelée depuis le navigateur (origin=*), licences libres seulement (domaine public, CC0, CC BY,
// CC BY-SA) ; l'image choisie est recopiée dans Storage (jamais affichée depuis Wikimedia sur une carte).
// Affichage (Images.place) : côté question quand la question est dans la langue d'appui (sens appui → appris), côté réponse
// sinon ; réglage par liste imgSide (q / a / never ; absent = automatique). Carte sans image : image validée de son sens.
// Cache : Cache API « vocab-img » (300 images au plus, les plus anciennes retirées ; index LRU dans localStorage). Sans
// réseau et sans cache : rien n'est affiché, sans erreur. sw.js n'est pas concerné (il ignore supabase.co et les autres sites).
// Suppression : image qui n'est plus citée par aucune carte (carte, liste, dossier supprimés, image changée) → supprimée
// (après vérification par le serveur qu'elle n'est pas citée par une liste commune ou une proposition en attente) ;
// ménage des images orphelines au lancement, au plus une fois par jour (images de plus de 2 jours seulement).
const IMG_BUCKET = "card-images";
const IMG_CACHE = "vocab-img";
const IMG_CACHE_MAX = 300;
const IMG_MAX_PX = 512;
const IMG_TARGET = 60 * 1024;        // taille visée
const IMG_HARD = 190 * 1024;         // au-delà : refusée (le bucket accepte 200 Ko)
const IMG_SIGN_S = 3600;             // liens signés : 1 h
const IMG_GRACE_MS = 2 * 86400000;   // ménage : images de plus de 2 jours seulement
const IMG_WM_API = "https://commons.wikimedia.org/w/api.php";
const IMG_WM_N = 12;
const IMG_SIDES = ["auto", "q", "a", "never"];
const IMG_LRU_KEY = "vocabfr.img:lru";

// --- Petits outils ---
function imgMb(bytes) {
  const v = num(Number(bytes), 0) / 1048576;
  let s;
  try { s = v.toLocaleString(state.settings.uiLang, { maximumFractionDigits: 1, minimumFractionDigits: v > 0 && v < 10 ? 1 : 0 }); }
  catch (e) { s = (Math.round(v * 10) / 10).toString(); }
  return t("img.mb", { n: s });
}
// Taille d'un fichier : « 38 Ko » sous 1 Mo, sinon « 1,2 Mo ».
function imgSize(bytes) {
  const b = num(Number(bytes), 0);
  if (b >= 1048576) return imgMb(b);
  let s;
  try { s = Math.max(1, Math.round(b / 1024)).toLocaleString(state.settings.uiLang); } catch (e) { s = String(Math.max(1, Math.round(b / 1024))); }
  return t("img.kb", { n: s });
}
function imgRandName() {
  const a = new Uint8Array(12);
  try { crypto.getRandomValues(a); } catch (e) { for (let i = 0; i < a.length; i++) a[i] = Math.floor(Math.random() * 256); }
  return Array.from(a).map(b => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("");
}
function imgStripHtml(s) {
  const d = document.createElement("div");
  d.innerHTML = String(s || "");
  return (d.textContent || "").replace(/\s+/g, " ").trim();
}
// Licence Wikimedia (extmetadata) → forme courte acceptée (« CC BY-SA 4.0 », « CC0 », « Public domain »), sinon null.
function imgLicense(meta) {
  const v = k => (meta && meta[k] && meta[k].value != null) ? String(meta[k].value) : "";
  const code = v("License").toLowerCase().trim(), short = imgStripHtml(v("LicenseShortName"));
  if (/(^|-)nc\b|-nd\b|\bnc\b|\bnd\b/i.test(code + " " + short)) return null;
  if (/^pd\b|^pd-|public.?domain/.test(code) || /^public domain$/i.test(short)) return "Public domain";
  if (/^cc0\b/.test(code) || /^cc0\b/i.test(short)) return "CC0";
  let m = code.match(/^cc-by(-sa)?-([0-9.]+)(?:-[a-z]{2,3})?$/);
  if (!m) m = short.match(/^CC BY(-SA)? ([0-9.]+)(?: [a-z-]+)?$/i);
  if (m) return "CC BY" + (m[1] ? "-SA" : "") + " " + m[2];
  return null;
}
function imgCredit(info) {
  if (!info) return "";
  if (info.src !== "wikimedia") return t("img.photoOwn");
  return t("img.credit", { a: info.author || t("img.unknownAuthor"), l: info.license || "?" });
}

const Images = (() => {
  let status = "unknown";              // unknown | ok | missing (script de l'étape 49 pas lancé)
  let quotaVal = null, quotaAt = 0, quotaBusy = null;
  const mem = new Map();               // chemin → adresse blob: (affichage)
  const inflight = new Map();          // chemin → promesse en cours
  const failed = new Map();            // chemin → heure du dernier échec (nouvel essai après 5 min)
  const signQ = new Map();             // chemin → [résolutions] (liens signés demandés par paquets)
  let signTimer = null;
  let lru = null, lruTimer = null;
  let senses = null, sensesUser = null, senseQ = new Set(), senseTimer = null;
  let known = new Set(), knownUser = null, relTimer = null, relBusy = false;
  const uploads = new Map();           // chemins envoyés pendant ce lancement (éditeur pas encore enregistré)
  let observer = null;

  function client() { try { return Supa.client(); } catch (e) { return null; } }
  function on() { return typeof auth !== "undefined" && auth.mode === "supabase" && !!auth.sbUid && !!client() && !!Storage.getUser(); }
  function me() { return (typeof auth !== "undefined" && auth.sbUid) || ""; }
  function mine(p) { return typeof p === "string" && !!me() && p.startsWith(me() + "/"); }
  function bucket() { return client().storage.from(IMG_BUCKET); }
  async function rpc(name, args) {
    const r = await withTimeout(client().rpc(name, args || {}), 20000);
    if (r && r.error) throw r.error;
    return r ? r.data : null;
  }
  function isMissing(e) { return typeof alIsMissing === "function" && alIsMissing(e); }
  function online() { return navigator.onLine !== false; }
  function userKey(k) { return CONFIG.LS_USER_PREFIX + "img:" + k + ":" + (Storage.getUser() || ""); }

  // --- Cache API « vocab-img » + index LRU (le plus ancien est retiré au-delà de 300 images) ---
  function cacheKey(path) { return "https://vocab-img.local/" + path; }
  async function cacheOpen() { try { return (window.caches && caches.open) ? await caches.open(IMG_CACHE) : null; } catch (e) { return null; } }
  function lruLoad() {
    if (lru) return lru;
    try { const o = JSON.parse(localStorage.getItem(IMG_LRU_KEY) || "{}"); lru = o && typeof o === "object" && !Array.isArray(o) ? o : {}; }
    catch (e) { lru = {}; }
    return lru;
  }
  function lruSave() { clearTimeout(lruTimer); lruTimer = setTimeout(() => { try { localStorage.setItem(IMG_LRU_KEY, JSON.stringify(lru || {})); } catch (e) {} }, 1500); }
  function lruTouch(path) { lruLoad()[path] = Date.now(); lruSave(); }
  async function cacheGet(path) {
    const c = await cacheOpen();
    if (!c) return null;
    try { const r = await c.match(cacheKey(path)); if (!r) return null; const b = await r.blob(); lruTouch(path); return b && b.size ? b : null; }
    catch (e) { return null; }
  }
  async function cachePut(path, blob) {
    const c = await cacheOpen();
    if (!c || !blob) return;
    try { await c.put(cacheKey(path), new Response(blob, { headers: { "Content-Type": blob.type || "image/webp" } })); } catch (e) { return; }
    lruTouch(path);
    // Étape 79 : les images des listes gardées hors ligne (js/hors-ligne.js) ne comptent pas et ne sont jamais retirées.
    const pin = k => { try { return typeof Offline !== "undefined" && Offline.pinned(k); } catch (e) { return false; } };
    const L = lruLoad(), keys = Object.keys(L).filter(k => !pin(k));
    if (keys.length > IMG_CACHE_MAX) {
      const old = keys.sort((a, b) => L[a] - L[b]).slice(0, keys.length - IMG_CACHE_MAX);
      for (const k of old) { delete L[k]; try { await c.delete(cacheKey(k)); } catch (e) {} }
      lruSave();
    }
  }
  async function cacheDel(paths) {
    const c = await cacheOpen(), L = lruLoad();
    for (const p of paths) {
      delete L[p];
      if (c) { try { await c.delete(cacheKey(p)); } catch (e) {} }
      const u = mem.get(p); if (u) { try { URL.revokeObjectURL(u); } catch (e) {} mem.delete(p); }
    }
    lruSave();
  }
  function memSet(path, url) {
    mem.set(path, url);
    if (mem.size > 400) { const k = mem.keys().next().value; const u = mem.get(k); mem.delete(k); try { URL.revokeObjectURL(u); } catch (e) {} }
  }

  // --- Liens signés (par paquets de 100) ---
  function sign(path) {
    return new Promise(res => {
      if (!signQ.has(path)) signQ.set(path, []);
      signQ.get(path).push(res);
      if (!signTimer) signTimer = setTimeout(signFlush, 40);
    });
  }
  async function signFlush() {
    signTimer = null;
    const batch = [...signQ.entries()].slice(0, 100);
    batch.forEach(([p]) => signQ.delete(p));
    if (signQ.size) signTimer = setTimeout(signFlush, 40);
    const urls = {};
    if (on() && online()) {
      try {
        const r = await withTimeout(bucket().createSignedUrls(batch.map(x => x[0]), IMG_SIGN_S), 15000);
        arr(r && r.data).forEach(x => { if (x && x.path && !x.error && (x.signedUrl || x.signedURL)) urls[x.path] = x.signedUrl || x.signedURL; });
      } catch (e) {}
    }
    batch.forEach(([p, rs]) => rs.forEach(f => f(urls[p] || null)));
  }
  // Adresse affichable d'une image (cache de l'appareil, sinon téléchargement par lien signé) ; null si impossible.
  // force (étape 79, téléchargement hors ligne) : nouvel essai tout de suite, même après un échec récent (réseau coupé).
  function url(path, force) {
    if (!path) return Promise.resolve(null);
    if (mem.has(path)) { lruTouch(path); return Promise.resolve(mem.get(path)); }
    if (inflight.has(path)) return inflight.get(path);
    const p = (async () => {
      let blob = await cacheGet(path);
      if (!blob && on() && online() && !(!force && failed.has(path) && Date.now() - failed.get(path) < 300000)) {
        const u = await sign(path);
        if (u) {
          try { const r = await withTimeout(fetch(u), 20000); if (r.ok) { blob = await r.blob(); if (blob && blob.size) await cachePut(path, blob); else blob = null; } }
          catch (e) { blob = null; }
        }
        if (!blob) failed.set(path, Date.now()); else failed.delete(path);
      }
      if (!blob) return null;
      const u = URL.createObjectURL(blob);
      memSet(path, u);
      return u;
    })().catch(() => null).finally(() => inflight.delete(path));
    inflight.set(path, p);
    return p;
  }

  // --- Images validées du dictionnaire commun (par sens), gardées sur l'appareil, relues après 24 h ---
  function senseLoad() {
    const u = Storage.getUser();
    if (senses && sensesUser === u) return senses;
    sensesUser = u; senses = {};
    try { const o = JSON.parse(localStorage.getItem(userKey("senses")) || "{}"); if (o && typeof o === "object" && !Array.isArray(o)) senses = o; } catch (e) {}
    return senses;
  }
  function senseSave() { try { localStorage.setItem(userKey("senses"), JSON.stringify(senses || {})); } catch (e) {} }
  function senseWant(ids) {
    const S = senseLoad(), now = Date.now();
    ids.forEach(id => { const x = S[id]; if (!x || now - num(x.t, 0) > 86400000) senseQ.add(id); });
    if (senseQ.size && !senseTimer) senseTimer = setTimeout(senseFlush, 300);
  }
  async function senseFlush() {
    senseTimer = null;
    if (!on() || !online() || status === "missing") { senseQ.clear(); return; }
    const ids = [...senseQ].slice(0, 500);
    ids.forEach(id => senseQ.delete(id));
    let found = 0;
    try {
      const rows = arr(await rpc("dict_images_get", { p_ids: ids }));
      const S = senseLoad(), now = Date.now();
      ids.forEach(id => { S[id] = { n: 1, t: now }; });
      rows.forEach(r => {
        const im = normCardImage({ path: r.path, src: "wikimedia", author: r.author, license: r.license, page: r.page, size: r.size });
        if (r && r.sense_id && im) { S[r.sense_id] = Object.assign(im, { t: now }); found++; }
      });
      senseSave();
      status = "ok";
    } catch (e) { if (isMissing(e)) status = "missing"; }
    if (senseQ.size) senseTimer = setTimeout(senseFlush, 300);
    if (found && typeof currentScreen !== "undefined" && currentScreen === "lists") { try { renderLists(); } catch (e) {} }
  }

  // Étape 79 (stockage hors ligne) : images des sens demandées TOUT DE SUITE (attend la réponse) ; false si impossible.
  async function sensesNow(ids) {
    const S = senseLoad(), now = Date.now();
    const todo = [...new Set(ids)].filter(id => { const x = S[id]; return !x || now - num(x.t, 0) > 86400000; });
    if (!todo.length) return true;
    if (!on() || !online() || status === "missing") return false;
    try {
      for (let i = 0; i < todo.length; i += 500) {
        const part = todo.slice(i, i + 500);
        const rows = arr(await rpc("dict_images_get", { p_ids: part }));
        part.forEach(id => { S[id] = { n: 1, t: now }; });
        rows.forEach(r => {
          const im = normCardImage({ path: r.path, src: "wikimedia", author: r.author, license: r.license, page: r.page, size: r.size });
          if (r && r.sense_id && im) S[r.sense_id] = Object.assign(im, { t: now });
        });
      }
      senseSave(); status = "ok";
      return true;
    } catch (e) { if (isMissing(e)) status = "missing"; senseSave(); return false; }
  }
  // Image connue d'une carte, sans rien demander au serveur (carte, sinon sens déjà connu) ; null sinon.
  function known1(c) {
    if (!c || !isVocab(c)) return null;
    if (c.image && c.image.path) return c.image;
    const x = c.senseId ? senseLoad()[c.senseId] : null;
    return x && x.path ? x : null;
  }

  // --- Image à afficher pour une carte ---
  function info(c) {
    if (!c || !isVocab(c)) return null;
    if (c.image && c.image.path) return c.image;
    if (c.senseId) {
      const x = senseLoad()[c.senseId];
      if (x && x.path) return Object.assign({ common: true }, x);
      if (!x) senseWant([c.senseId]);
    }
    return null;
  }
  // Côté de l'image pour une carte posée dans le sens dir : "q" | "a" | null (jamais, ou pas une carte vocab).
  function side(c, dir) {
    if (!c || !isVocab(c)) return null;
    let s = "auto";
    try { const l = getList(c.listId); if (l && IMG_SIDES.includes(l.imgSide)) s = l.imgSide; } catch (e) {}
    if (s === "never") return null;
    if (s === "q" || s === "a") return s;
    return dir === "fromT" ? "a" : "q";
  }
  // Nœud image de la carte pour ce côté (which = "q" | "a"), ou null.
  function place(c, dir, which, cls) {
    if (side(c, dir) !== which) return null;
    const im = info(c);
    return im ? node(im, { cls }) : null;
  }

  // --- Affichage : vignette (cachée tant que l'image n'est pas chargée ; supprimée si elle ne peut pas l'être) ---
  function node(im, opts) {
    const o = opts || {};
    const w = el("span", "ci-img" + (o.cls ? " " + o.cls : ""));
    w.hidden = true;
    w.setAttribute("role", "button"); w.tabIndex = 0;
    w.setAttribute("aria-label", t("img.zoom"));
    const pic = document.createElement("img");
    pic.alt = ""; pic.decoding = "async"; pic.draggable = false;
    w.appendChild(pic);
    const load = () => url(im.path).then(u => {
      if (!u) { w.remove(); return; }
      pic.onload = () => { w.hidden = false; w.classList.remove("ci-wait"); };
      pic.onerror = () => w.remove();
      pic.src = u;
    });
    if (o.lazy && "IntersectionObserver" in window) {   // liste des cartes : chargée quand elle approche de l'écran
      if (!observer) observer = new IntersectionObserver(es => es.forEach(e => {
        if (!e.isIntersecting) return;
        observer.unobserve(e.target);
        const f = e.target.__ciLoad; e.target.__ciLoad = null;
        if (f) f();
      }), { rootMargin: "300px" });
      w.hidden = false; w.classList.add("ci-wait");
      w.__ciLoad = load;
      observer.observe(w);
    } else load();
    const stop = e => { e.stopPropagation(); };
    w.addEventListener("pointerdown", stop);
    w.addEventListener("pointerup", stop);
    w.addEventListener("click", e => { e.stopPropagation(); e.preventDefault(); zoom(im); });
    w.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); zoom(im); } });
    return w;
  }
  // Image agrandie, avec l'auteur et la licence (lien vers la page Wikimedia).
  function zoom(im) {
    const bg = el("div", "ci-zoom");
    bg.setAttribute("role", "dialog"); bg.setAttribute("aria-modal", "true"); bg.setAttribute("aria-label", t("img.zoom"));
    const box = el("div", "ci-zbox");
    const pic = document.createElement("img"); pic.alt = "";
    url(im.path).then(u => { if (u) pic.src = u; else box.classList.add("ci-zfail"); });
    box.appendChild(pic);
    const cap = el("div", "ci-zcap");
    if (im.src === "wikimedia") {
      cap.appendChild(el("div", null, t("img.author", { a: im.author || t("img.unknownAuthor") })));
      cap.appendChild(el("div", null, t("img.license", { l: im.license || "?" })));
      if (im.page) { const a = el("a", "ci-zlink", t("img.page")); a.href = im.page; a.target = "_blank"; a.rel = "noopener noreferrer"; cap.appendChild(a); }
      if (im.common) cap.appendChild(el("div", "ci-zsmall", t("img.fromDictShort")));
    } else cap.appendChild(el("div", null, t("img.photoOwn")));
    box.appendChild(cap);
    const close = el("button", "btn ci-zclose", t("img.close")); close.type = "button";
    box.appendChild(close);
    bg.appendChild(box);
    const done = () => { bg.remove(); document.removeEventListener("keydown", key, true); };
    const key = e => { if (e.key === "Escape") { e.stopPropagation(); done(); } };
    close.addEventListener("click", done);
    bg.addEventListener("click", e => { if (e.target === bg || e.target === pic) done(); });
    document.addEventListener("keydown", key, true);
    document.body.appendChild(bg);
    try { close.focus({ preventScroll: true }); } catch (e) {}
  }

  // --- Traitement d'une image : carré centré (ou entière), 512 px au plus, WebP (sinon JPEG), ≈ 60 Ko ---
  async function decode(blob) {
    if (window.createImageBitmap) {
      try { const b = await createImageBitmap(blob, { imageOrientation: "from-image" }); return { src: b, w: b.width, h: b.height, close: () => { try { b.close(); } catch (e) {} } }; }
      catch (e) {}
    }
    const u = URL.createObjectURL(blob);
    const im = new Image();
    await new Promise((res, rej) => { im.onload = res; im.onerror = () => rej(new Error("decode")); im.src = u; });
    return { src: im, w: im.naturalWidth, h: im.naturalHeight, close: () => URL.revokeObjectURL(u) };
  }
  function toBlob(cv, type, q) { return new Promise(res => { try { cv.toBlob(b => res(b), type, q); } catch (e) { res(null); } }); }
  async function process(blob, mode) {
    let d;
    try { d = await decode(blob); } catch (e) { throw { img: "read" }; }
    try {
      if (!d.w || !d.h) throw { img: "read" };
      let sx = 0, sy = 0, sw = d.w, sh = d.h;
      if (mode !== "full") { const s = Math.min(d.w, d.h); sx = (d.w - s) / 2; sy = (d.h - s) / 2; sw = sh = s; }
      let scale = Math.min(1, IMG_MAX_PX / Math.max(sw, sh)), best = null, type = "image/webp";
      for (let round = 0; round < 4; round++) {
        const W = Math.max(1, Math.round(sw * scale)), H = Math.max(1, Math.round(sh * scale));
        const cv = document.createElement("canvas");
        cv.width = W; cv.height = H;
        const g = cv.getContext("2d");
        g.fillStyle = "#fff"; g.fillRect(0, 0, W, H);
        g.imageSmoothingEnabled = true; g.imageSmoothingQuality = "high";
        g.drawImage(d.src, sx, sy, sw, sh, 0, 0, W, H);
        for (const q of [0.82, 0.72, 0.62, 0.52, 0.42]) {
          let b = await toBlob(cv, type, q);
          if (!b || b.type !== type) { type = "image/jpeg"; b = await toBlob(cv, type, q); }   // WebP impossible (anciens Safari)
          if (!b) continue;
          if (!best || b.size < best.blob.size) best = { blob: b, type: b.type || type, w: W, h: H };
          if (b.size <= IMG_TARGET) return Object.assign(best, { blob: b, type: b.type || type, w: W, h: H });
        }
        scale *= 0.8;
      }
      if (best && best.blob.size <= IMG_HARD) return best;
      throw { img: "big" };
    } finally { d.close(); }
  }

  // --- Place utilisée (calculée par le serveur) ---
  async function quota(force) {
    if (!on()) return null;
    if (!force && quotaVal && Date.now() - quotaAt < 60000) return quotaVal;
    if (quotaBusy) return quotaBusy;
    quotaBusy = (async () => {
      try { quotaVal = await rpc("image_quota"); quotaAt = Date.now(); status = "ok"; }
      catch (e) { if (isMissing(e)) status = "missing"; }
      return quotaVal;
    })().finally(() => { quotaBusy = null; });
    return quotaBusy;
  }
  function quotaText(q) {
    if (!q) return "";
    return q.limit == null ? t("img.quotaAdmin", { u: imgMb(q.used) }) : t("img.quota", { u: imgMb(q.used), l: imgMb(q.limit) });
  }
  function renderQuota() {
    const p = $("#imgQuota");
    if (!p) return;
    if (!on()) { p.hidden = true; return; }
    const show = q => {
      if (!q) { p.hidden = true; return; }
      p.hidden = false;
      p.textContent = quotaText(q);
      const warn = q.limit != null && num(Number(q.used), 0) > 0.9 * num(Number(q.limit), 1);
      p.classList.toggle("ci-qwarn", warn);
      if (warn) p.appendChild(el("span", "ci-qwarn-t", " — " + t("img.quotaWarn")));
    };
    show(quotaVal);
    if (!quotaVal || Date.now() - quotaAt > 60000) quota().then(show);
  }

  // --- Envoi dans mon dossier ---
  function errOf(e) {
    if (e && e.img) return e;
    const m = String((e && (e.message || e.error || e.msg)) || e || ""), st = String((e && (e.statusCode || e.status)) || "");
    if (!online() || /fetch|network|timeout|load failed/i.test(m)) return { img: "net" };
    if (/bucket not found/i.test(m) || isMissing(e)) { status = "missing"; return { img: "missing" }; }
    if (st === "403" || /row-level security|unauthorized|policy/i.test(m)) return { img: "denied" };
    if (st === "413" || /too large|exceeded the maximum/i.test(m)) return { img: "big" };
    return { img: "send" };
  }
  async function upload(out) {
    if (!online()) throw { img: "net" };
    const q = await quota(true);
    if (status === "missing") throw { img: "missing" };
    if (q && q.limit != null && num(Number(q.used), 0) + out.blob.size > num(Number(q.limit), 0)) throw { img: "quota", q };
    const path = me() + "/" + imgRandName() + (out.type === "image/jpeg" ? ".jpg" : ".webp");
    let r;
    try { r = await withTimeout(bucket().upload(path, out.blob, { contentType: out.type, cacheControl: "31536000", upsert: false }), 30000); }
    catch (e) { throw errOf(e); }
    if (r && r.error) {
      const er = errOf(r.error);
      if (er.img === "denied") { const q2 = await quota(true); if (q2 && q2.limit != null && num(Number(q2.used), 0) + 204800 > num(Number(q2.limit), 0)) throw { img: "quota", q: q2 }; }
      throw er;
    }
    uploads.set(path, Date.now());
    if (quotaVal) { quotaVal = Object.assign({}, quotaVal, { used: num(Number(quotaVal.used), 0) + out.blob.size, count: num(Number(quotaVal.count), 0) + 1 }); }
    await cachePut(path, out.blob);
    return path;
  }
  function errText(e) {
    const k = (e && e.img) || "send";
    if (k === "quota") { const q = e.q || quotaVal || {}; return t("img.err.quota", { u: imgMb(q.used), l: imgMb(q.limit) }); }
    if (k === "net") return t("img.err.offline");
    return t("img.err." + (["read", "big", "missing", "denied", "wm"].includes(k) ? k : "send"));
  }
  async function remove(paths) {
    const list = [...new Set(arr(paths).filter(p => typeof p === "string" && p))];
    if (!list.length || !on()) return false;
    for (let i = 0; i < list.length; i += 100) {
      const part = list.slice(i, i + 100);
      try { const r = await withTimeout(bucket().remove(part), 20000); if (r && r.error) return false; }
      catch (e) { return false; }
      await cacheDel(part);
      part.forEach(p => { uploads.delete(p); known.delete(p); });
    }
    quotaAt = 0;
    return true;
  }

  // --- Wikimedia Commons ---
  async function wmSearch(word) {
    const q = String(word || "").trim();
    if (!q) return [];
    const ps = new URLSearchParams({
      action: "query", format: "json", origin: "*", generator: "search", gsrsearch: q + " filetype:bitmap", gsrnamespace: "6",
      gsrlimit: "40", prop: "imageinfo", iiprop: "url|extmetadata|mime|size", iiurlwidth: "330",
      iiextmetadatafilter: "LicenseShortName|License|Artist|Credit"
    });
    let j;
    try {
      const r = await withTimeout(fetch(IMG_WM_API + "?" + ps.toString(), { credentials: "omit" }), 15000);
      if (!r.ok) throw new Error("http " + r.status);
      j = await r.json();
    } catch (e) { throw { img: "wm" }; }
    const pages = Object.values((j && j.query && j.query.pages) || {}).sort((a, b) => num(a.index, 0) - num(b.index, 0));
    const out = [];
    for (const p of pages) {
      const ii = p && arr(p.imageinfo)[0];
      if (!ii || !/^image\/(jpeg|png|webp|gif)$/.test(ii.mime || "")) continue;
      const lic = imgLicense(ii.extmetadata);
      if (!lic) continue;                                  // licence non libre (ou inconnue) : écartée
      const meta = ii.extmetadata || {};
      let author = imgStripHtml(meta.Artist && meta.Artist.value) || imgStripHtml(meta.Credit && meta.Credit.value);
      author = author.slice(0, 120);
      const page = String(ii.descriptionurl || "");
      if (!/^https:\/\/commons\.wikimedia\.org\//.test(page)) continue;
      const thumb = String(ii.thumburl || ii.url || "");
      let big = String(ii.url || "");
      if (num(ii.width, 0) > 960 && /\/330px-/.test(thumb)) big = thumb.replace("/330px-", "/960px-");
      else if (num(ii.width, 0) > 960) big = thumb;
      if (!/^https:\/\//.test(thumb) || !/^https:\/\//.test(big)) continue;
      out.push({ title: String(p.title || "").replace(/^File:/, ""), thumb, big, page, author, license: lic });
      if (out.length >= IMG_WM_N) break;
    }
    return out;
  }
  async function wmBlob(u) {
    try {
      const r = await withTimeout(fetch(u, { credentials: "omit" }), 25000);
      if (!r.ok) throw new Error("http");
      return await r.blob();
    } catch (e) { throw { img: "wm" }; }
  }

  // --- Suppression des images qui ne sont plus citées ---
  function localRefs() {
    const s = new Set();
    arr(state && state.cards).forEach(c => { if (c && c.image && mine(c.image.path)) s.add(c.image.path); });
    return s;
  }
  async function serverRefs() {
    try { return new Set(arr(await rpc("img_refs"))); }
    catch (e) { if (isMissing(e)) status = "missing"; return null; }
  }
  function delQueue() { try { const a = JSON.parse(localStorage.getItem(userKey("del")) || "[]"); return Array.isArray(a) ? a.filter(mine) : []; } catch (e) { return []; } }
  function delQueueSet(a) { try { if (a.length) localStorage.setItem(userKey("del"), JSON.stringify(a.slice(0, 2000))); else localStorage.removeItem(userKey("del")); } catch (e) {} }
  function onSave(data) {
    if (!on() || data !== state || knownUser !== Storage.getUser()) return;
    localRefs().forEach(p => { known.add(p); uploads.delete(p); });   // images citées : connues (leur disparition sera vue)
    clearTimeout(relTimer);
    relTimer = setTimeout(releaseCheck, 15000);
  }
  async function releaseCheck() {
    relTimer = null;
    if (!on() || relBusy || knownUser !== Storage.getUser()) return;
    relBusy = true;
    try {
      const cur = localRefs(), now = Date.now();
      const gone = [...known].filter(p => !cur.has(p));
      const edOpen = !!document.querySelector(".ci-ed");
      const lost = [...uploads.keys()].filter(p => !cur.has(p) && !edOpen && now - uploads.get(p) > 60000);
      cur.forEach(p => known.add(p));
      gone.forEach(p => known.delete(p));
      let cand = [...new Set(delQueue().concat(gone, lost))].filter(p => !cur.has(p));
      if (!cand.length) { delQueueSet([]); return; }
      if (!online() || status === "missing") { delQueueSet(cand); return; }
      const refs = await serverRefs();
      if (!refs) { delQueueSet(cand); return; }
      const del = cand.filter(p => !refs.has(p));
      cand.filter(p => refs.has(p)).forEach(p => uploads.delete(p));
      if (!del.length) { delQueueSet([]); return; }
      const ok = await remove(del);
      delQueueSet(ok ? [] : del);
      if (ok && typeof currentScreen !== "undefined" && currentScreen === "settings") renderQuota();
    } finally { relBusy = false; }
  }
  // Ménage du lancement (au plus une fois par jour, seulement quand les données sont synchronisées) :
  // fichiers de mon dossier de plus de 2 jours, cités ni par mes cartes ni ailleurs (listes communes, propositions).
  async function gc() {
    if (!on() || !online()) return;
    const key = userKey("gc");
    try { if (localStorage.getItem(key) === todayStr()) return; } catch (e) {}
    if (Storage.getMode() !== "cloud") return;
    const files = [];
    try {
      for (let off = 0; off < 5000; off += 1000) {
        const r = await withTimeout(bucket().list(me(), { limit: 1000, offset: off, sortBy: { column: "name", order: "asc" } }), 20000);
        if (r && r.error) { if (/bucket not found/i.test(String(r.error.message || ""))) status = "missing"; return; }
        const rows = arr(r && r.data).filter(x => x && x.id && x.name);
        rows.forEach(x => files.push({ path: me() + "/" + x.name, at: Date.parse(x.created_at || "") || 0 }));
        if (rows.length < 1000) break;
      }
    } catch (e) { return; }
    const refs = await serverRefs();
    if (!refs) return;
    const cur = localRefs(), now = Date.now();
    const del = files.filter(f => !cur.has(f.path) && !refs.has(f.path) && now - f.at > IMG_GRACE_MS).map(f => f.path);
    if (del.length && !(await remove(del))) return;
    try { localStorage.setItem(key, todayStr()); } catch (e) {}
  }
  function start() {
    if (!on()) return;
    knownUser = Storage.getUser();
    known = localRefs();
    senses = null;
    const ids = arr(state.cards).filter(c => isVocab(c) && !(c.image && c.image.path) && c.senseId).map(c => c.senseId);
    if (ids.length) senseWant([...new Set(ids)]);
    quota();
    setTimeout(() => { if (knownUser === Storage.getUser()) { releaseCheck(); gc(); } }, 30000);
  }

  // --- Proposition au dictionnaire commun (image Wikimedia d'une carte reliée à un sens) ---
  async function propose(cardId) {
    const c = state.cards.find(x => x.id === cardId);
    if (!on() || !c || !c.senseId || !c.image || c.image.src !== "wikimedia" || !mine(c.image.path)) return;
    try {
      const r = await rpc("dict_image_propose", { p_sense: c.senseId, p_path: c.image.path, p_author: c.image.author,
        p_license: c.image.license, p_page: c.image.page, p_size: c.image.size });
      toast(t(r && r.status === "same" ? "img.proposeSame" : "img.proposed"));
    } catch (e) {
      if (isMissing(e)) { status = "missing"; return; }
      const h = String((e && e.hint) || "");
      if (h === "img_limit") toast(t("img.err.limit"));
    }
  }

  // --- Copie reçue (ou liste commune gardée en copie) : images d'un autre compte recopiées dans mon dossier ---
  // Les cartes dont l'image n'a pas pu être copiée (place, connexion, droits) la perdent. Renvoie le nombre d'échecs.
  async function adopt(cards) {
    const todo = arr(cards).filter(c => c && c.image && c.image.path && !mine(c.image.path) && !c.image.path.startsWith("common/"));
    if (!todo.length) return 0;
    let fail = 0;
    const done = new Map();
    for (const c of todo) {
      const src = c.image.path;
      let dst = done.get(src) || null;
      if (!dst && on() && online()) {
        const q = await quota(true);
        if (!(q && q.limit != null && num(Number(q.used), 0) + num(c.image.size, 60000) + 204800 > num(Number(q.limit), 0))) {
          const p = me() + "/" + imgRandName() + (src.endsWith(".jpg") ? ".jpg" : ".webp");
          try {
            const r = await withTimeout(bucket().copy(src, p), 20000);
            if (!(r && r.error)) { dst = p; done.set(src, p); uploads.set(p, Date.now()); quotaAt = 0; }
          } catch (e) {}
        }
      }
      if (dst) { c.image = Object.assign({}, c.image, { path: dst }); known.add(dst); }
      else { delete c.image; fail++; }
    }
    if (fail) toast(t("img.err.copy", { n: fail }));
    return fail;
  }
  // Admin : suppression d'un compte → ses images (dossier entier).
  async function purgeUser(userId) {
    if (!on() || !/^[0-9a-f-]{36}$/.test(String(userId || ""))) return;
    try {
      const r = await withTimeout(bucket().list(userId, { limit: 1000 }), 20000);
      const paths = arr(r && r.data).filter(x => x && x.id && x.name).map(x => userId + "/" + x.name);
      if (paths.length) await withTimeout(bucket().remove(paths), 20000);
    } catch (e) {}
  }

  return {
    on, me, mine, status: () => status, setStatus: s => { status = s; }, info, side, place, node, zoom, url,
    process, upload, remove, errText, quota, quotaText, renderQuota, wmSearch, wmBlob, propose, adopt, purgeUser,
    start, onSave, releaseCheck, gc, senseWant, bucket, rpc, cacheDel, uploads,
    sensesNow, knownImage: known1, cacheKey   // étape 79 (js/hors-ligne.js)
  };
})();
window.App.Images = Images;
Storage.onBeforeSave(data => Images.onSave(data));   // cartes, listes, dossiers supprimés ou image changée → ménage

// === ÉDITEUR DE CARTE : CHAMP « IMAGE » ===
// Champ ajouté au formulaire vocab (js/screens/listes-cartes.js, vocabForm). L'image choisie est traitée et envoyée tout de
// suite (chemin nouveau à chaque fois) ; elle n'est liée à la carte qu'à l'enregistrement. Fenêtre fermée sans enregistrer :
// le fichier envoyé est supprimé au prochain contrôle (ou par le ménage du lancement).
// ctx.word() : mot à chercher sur Wikimedia ; renvoie { node, get(), proposeAsked() }.
function imgEditorField(c, ctx) {
  const st = { cur: c && c.image ? Object.assign({}, c.image) : null, fresh: false, propose: true };
  const box = el("div", "field ci-ed");
  const draw = () => {
    box.textContent = "";
    box.appendChild(el("label", null, t("img.label")));
    const row = el("div", "ci-ed-row");
    if (st.cur) {
      row.appendChild(Images.node(st.cur, { cls: "ci-ed-thumb" }));
      const side = el("div", "ci-ed-side");
      side.appendChild(el("div", "hint ci-ed-credit", imgCredit(st.cur)));
      const bc = el("button", "btn ci-ed-btn", t("img.change")); bc.type = "button";
      bc.addEventListener("click", () => imgOpenChooser(st, draw, ctx));
      const br = el("button", "btn danger ci-ed-btn", t("img.remove")); br.type = "button";
      br.addEventListener("click", () => { st.cur = null; st.fresh = false; draw(); });
      side.append(bc, br);
      row.appendChild(side);
    } else {
      const b = el("button", "btn ci-ed-btn", t("img.btn")); b.type = "button";
      b.addEventListener("click", () => imgOpenChooser(st, draw, ctx));
      row.appendChild(b);
      const si = c && c.senseId ? Images.info(Object.assign({}, c, { image: null })) : null;
      if (si) { const h = el("div", "ci-ed-side"); h.appendChild(Images.node(si, { cls: "ci-ed-thumb ci-ed-small" })); h.appendChild(el("div", "hint", t("img.fromDict"))); row.appendChild(h); }
    }
    box.appendChild(row);
    if (st.cur && st.fresh && st.cur.src === "wikimedia" && typeof Dict !== "undefined" && Dict.on()) {
      const lab = el("label", "ci-ed-prop");
      const cb = el("input"); cb.type = "checkbox"; cb.checked = st.propose;
      cb.addEventListener("change", () => { st.propose = cb.checked; });
      lab.append(cb, document.createTextNode(" " + t("img.propose")));
      box.appendChild(lab);
      box.appendChild(el("div", "hint", t("img.proposeHint")));
    }
  };
  draw();
  return {
    node: box,
    get: () => (st.cur ? normCardImage(st.cur) : null),
    proposeAsked: () => !!(st.cur && st.fresh && st.propose && st.cur.src === "wikimedia")
  };
}
// Choix de la source : photo / galerie, ou Wikimedia ; cadrage carré centré ou image entière (retenu sur l'appareil).
function imgCropPref() { try { return localStorage.getItem("vocabfr.img:crop") === "full" ? "full" : "square"; } catch (e) { return "square"; } }
function imgOpenChooser(st, redraw, ctx) {
  if (!Images.on()) { toast(t("img.err.offline")); return; }
  if (Images.status() === "missing") { toast(t("img.err.missing")); return; }
  let crop = imgCropPref();
  const body = el("div", "ci-ch");
  const seg = el("div", "seg ci-crop");
  [["square", "img.crop.square"], ["full", "img.crop.full"]].forEach(([k, lab]) => {
    const b = el("button", null, t(lab)); b.type = "button"; b.setAttribute("aria-pressed", String(crop === k));
    b.addEventListener("click", () => { crop = k; try { localStorage.setItem("vocabfr.img:crop", k); } catch (e) {} seg.querySelectorAll("button").forEach(x => x.setAttribute("aria-pressed", String(x === b))); });
    seg.appendChild(b);
  });
  body.appendChild(formField(t("img.crop"), seg));
  const pick = el("label", "btn primary ci-pick");
  pick.appendChild(document.createTextNode(t("img.photo")));
  const inp = el("input"); inp.type = "file"; inp.accept = "image/*"; inp.className = "hidden-input";
  pick.appendChild(inp);
  const wm = el("button", "btn ci-pick", t("img.wm")); wm.type = "button";
  body.append(pick, wm);
  let close = null;
  inp.addEventListener("change", () => {
    const f = inp.files && inp.files[0];
    if (!f) return;
    if (close) close();
    imgUseBlob(f, crop, { src: "photo", author: "", license: "", page: "" }, st, redraw);
  });
  wm.addEventListener("click", () => { if (close) close(); imgOpenWikimedia(st, redraw, ctx, crop); });
  close = openModal(t("img.title"), body, [{ label: t("cancel") }]);
}
// Traitement + envoi, avec fenêtre de progression ; l'image remplace celle du formulaire.
async function imgUseBlob(blob, crop, meta, st, redraw) {
  const prog = openProgress(t("img.title"), t("img.preparing"));
  try {
    const out = await Images.process(blob, crop);
    prog.set(0.5, t("img.sending"));
    const path = await Images.upload(out);
    prog.set(1);
    st.cur = Object.assign({ path, size: out.blob.size }, meta);
    st.fresh = true; st.propose = true;
    redraw();
  } catch (e) { toast(Images.errText(e)); }
  finally { prog.close(); }
}
// Recherche Wikimedia Commons : 12 vignettes (licences libres seulement), auteur + licence + lien ; toucher = choisir.
function imgOpenWikimedia(st, redraw, ctx, crop) {
  const body = el("div", "ci-wm");
  const form = el("div", "ci-wm-form");
  const q = textInput((ctx && ctx.word && ctx.word()) || "", t("img.wmPh"));
  q.type = "search"; q.enterKeyHint = "search";
  const go = el("button", "btn primary", t("img.wmSearch")); go.type = "button";
  form.append(q, go);
  const res = el("div", "ci-wm-res");
  body.append(form, el("p", "hint", t("img.wmHint")), res);
  let close = null, my = 0;
  const run = async () => {
    const w = q.value.trim();
    if (!w) return;
    const tok = ++my;
    res.textContent = "";
    res.appendChild(el("p", "muted", t("img.wmLoading")));
    let rows;
    try { rows = await Images.wmSearch(w); }
    catch (e) { if (tok === my) { res.textContent = ""; res.appendChild(el("p", "q-err", t("img.err.wm"))); } return; }
    if (tok !== my) return;
    res.textContent = "";
    if (!rows.length) { res.appendChild(el("p", "muted", t("img.wmNone"))); return; }
    const grid = el("div", "ci-wm-grid");
    rows.forEach(r => {
      const cell = el("div", "ci-wm-cell");
      const b = el("button", "ci-wm-pic"); b.type = "button"; b.setAttribute("aria-label", r.title);
      const im = document.createElement("img"); im.src = r.thumb; im.alt = ""; im.loading = "lazy"; im.referrerPolicy = "no-referrer";
      b.appendChild(im);
      b.addEventListener("click", async () => {
        if (close) close();
        const prog = openProgress(t("img.title"), t("img.preparing"));
        let blob = null;
        try { blob = await Images.wmBlob(r.big); } catch (e) { prog.close(); toast(Images.errText(e)); return; }
        prog.close();
        imgUseBlob(blob, crop, { src: "wikimedia", author: r.author, license: r.license, page: r.page }, st, redraw);
      });
      cell.appendChild(b);
      cell.appendChild(el("div", "ci-wm-cap", (r.author || t("img.unknownAuthor")) + " · " + r.license));
      const a = el("a", "ci-wm-link", t("img.page")); a.href = r.page; a.target = "_blank"; a.rel = "noopener noreferrer";
      cell.appendChild(a);
      grid.appendChild(cell);
    });
    res.appendChild(grid);
  };
  go.addEventListener("click", run);
  q.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); run(); } });
  close = openModal(t("img.wmTitle"), body, [{ label: t("cancel") }]);
  if (q.value.trim()) run(); else setTimeout(() => { try { q.focus(); } catch (e) {} }, 50);
}

// === RÉGLAGE « IMAGES » D'UNE LISTE ===
function imgSideLabel(l) { return t("img.side." + (l && IMG_SIDES.includes(l.imgSide) ? l.imgSide : "auto")); }
function openImgSide(listId) {
  const l = getList(listId);
  if (!l) return;
  const body = el("div");
  body.appendChild(el("p", "hint", t("img.side.autoHint")));
  const box = el("div", "ci-sides");
  let close = null;
  IMG_SIDES.forEach(k => {
    const b = el("button", "btn ci-side" + ((l.imgSide || "auto") === k ? " primary" : ""), t("img.side." + k)); b.type = "button";
    b.setAttribute("aria-pressed", String((l.imgSide || "auto") === k));
    b.addEventListener("click", () => {
      if (k === "auto") delete l.imgSide; else l.imgSide = k;
      if (close) close();
      commit();
      toast(t("img.saved"));
    });
    box.appendChild(b);
  });
  body.appendChild(box);
  close = openModal(t("img.side.title", { name: l.name }), body, [{ label: t("cancel") }]);
}

// Image placée en haut du corps d'une face du mode Cartes (rien si null).
function imgFace(face, node) {
  if (!face || !node) return;
  const b = face.querySelector(".sw-body") || face;
  b.insertBefore(node, b.firstChild);
}
