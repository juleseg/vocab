"use strict";

// === MISES À JOUR DE VERSION (ÉTAPE 48) ===
// Serveur : claude/supabase-etape48.sql (table app_release, fonction app_release_latest, lisible même avant connexion).
// Contrôle : au lancement (Release.start, dès que le client Supabase est prêt, avant la connexion), au retour au premier
// plan, au retour de la connexion, quand une notification est touchée (message push-open de sw.js) et toutes les 30 min.
// Réponse de app_release_latest : { version (dernière annoncée), required (plus haute version obligatoire), max_data,
//   data_version, mandatory, notes, announced_at } ; gardée sur l'appareil (vocabfr.release) pour le hors connexion.
//  - APP_VERSION < required                        → écran bloquant « Mise à jour nécessaire » (#releaseBlock)
//  - APP_VERSION < version (pas obligatoire)       → bandeau « Nouvelle version N disponible » (#releaseBar), fermable
//                                                    jusqu'au prochain lancement (×)
//  - sécurité sans annonce : données en ligne d'un format plus récent que DATA_VERSION (lu par Storage.initRemote dans
//    le morceau settings, ou au moment d'un conflit) → Release.dataTooNew(v) → même écran bloquant. Gardé sur l'appareil
//    (vocabfr.release:data:<compte>) jusqu'à ce que l'appli comprenne ce format (ou que les données en ligne redescendent).
// Bloqué : Storage.pause(true) (synchro en pause, données gardées sur l'appareil) ET portillon du fetch du client Supabase
//   (Release.gateFetch, branché par Supa.init) : aucune écriture vers Supabase (user_data, file d'attente, journal, appareil,
//   stats publiques, amis, partage, erreurs, send-push…). Laissés passer : lectures (GET / HEAD), auth (jeton de session),
//   fonctions de lecture READ_RPC. Requête refusée = « Failed to fetch » (traitée comme hors connexion : tout reste en attente
//   sur l'appareil et part après la mise à jour). Aucune requête réseau n'est faite pour une écriture refusée.
// « Mettre à jour » (Release.update) : 1) relecture de app_release_latest (prouve la connexion ; hors connexion → message
//   rl.offline, rien n'est effacé) ; 2) index.html et ./ relus avec cache "reload" (contourne le cache HTTP de GitHub Pages ;
//   sw.js « réseau d'abord » met la copie fraîche dans son cache) ; 3) envoi de ce qui attend (sauf si bloqué) ;
//   4) registration.update() du service worker ; 5) caches « vocab-* » vidés (sauf « vocab-img », étape 49) ; 6) rechargement. Les scripts en ?v=N changent
//   d'adresse : tous neufs. sw.js n'est pas modifié. Après le rechargement, sessionStorage vocabfr.release:updating dit vers
//   quelle version on allait : version toujours plus ancienne → message rl.notYet (GitHub Pages pas encore à jour).
// Réglages publics de l'appli (complément de l'étape 50) : app_settings_get(), lue avec le contrôle de version, gardée sur
//   l'appareil (vocabfr.appsettings) ; hors connexion : dernière valeur connue, sinon « Toutes ». Seul réglage :
//   changelog_count (null = toutes les versions, ou 0 à 100 = nombre de versions visibles dans les nouveautés).
//   Release.setting("changelog_count") ; Release.setSettings(obj) après un enregistrement par l'admin.
//   Script de l'étape 50 absent (404) : comportement actuel (toutes), sans erreur.
// Sans Supabase (artifact, fichier local) : rien (aucune annonce possible).
const RELEASE_EVERY_MS = 30 * 60000;
const RELEASE_MIN_GAP_MS = 60000;              // retour au premier plan : pas plus d'un contrôle par minute
const RELEASE_READ_RPC = ["app_release_latest", "app_settings_get", "claude_cadence_get", "my_profile", "username_exists", "mod_me", "claude_last_run_get"];   // étape 59 : claude_cadence_get ; étape 66 : mod_me, claude_last_run_get
const Release = (() => {
  const LS = CONFIG.LS_USER_PREFIX + "release";
  const LS_DATA = CONFIG.LS_USER_PREFIX + "release:data:";
  const SS_UPD = CONFIG.LS_USER_PREFIX + "release:updating";
  const NATIVE = (typeof window.fetch === "function") ? window.fetch.bind(window) : null;
  let info = null, dataV = 0, status = "unknown", started = false, lastAt = 0, inflight = null;
  let updating = false, msg = "", barHidden = 0, refused = 0, notYet = 0;
  const LS_SET = CONFIG.LS_USER_PREFIX + "appsettings";
  let settings = null;                           // { changelog_count: null | 0..100 } ; null = rien de connu : tout est « Toutes »

  const ver = v => { const n = parseInt(v, 10); return isFinite(n) && n > 0 ? n : 0; };
  const appV = () => ver(APP_VERSION);
  function lsGet(k) { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch (e) { return null; } }
  function lsSet(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function cfg() {
    const c = (window.APP_CONFIG && typeof window.APP_CONFIG === "object") ? window.APP_CONFIG : {};
    const url = String(c.SUPABASE_URL || "").trim().replace(/\/+$/, ""), key = String(c.SUPABASE_ANON_KEY || "").trim();
    return /^https:\/\/\S+$/.test(url) && key.length >= 20 ? { url, key } : null;
  }

  // --- État ---
  function norm(r) {
    if (!r || typeof r !== "object" || !ver(r.version)) return null;
    return { version: ver(r.version), required: ver(r.required), max_data: ver(r.max_data), data_version: ver(r.data_version),
             mandatory: r.mandatory === true, notes: r.notes && typeof r.notes === "object" ? r.notes : {}, announced_at: r.announced_at || null };
  }
  // "required" | "data" | null
  function reason() {
    if (dataV > DATA_VERSION) return "data";
    if (info && info.required > appV()) return "required";
    return null;
  }
  function blocked() { return !!reason(); }
  function available() { return !blocked() && !!info && info.version > appV(); }

  // --- Portillon des écritures (fetch du client Supabase) ---
  function isWrite(input, init) {
    const url = String(typeof input === "string" ? input : (input && input.url) || "");
    const method = String((init && init.method) || (input && typeof input === "object" && input.method) || "GET").toUpperCase();
    let path = "";
    try { path = new URL(url, location.href).pathname; } catch (e) { return true; }
    if (/\/auth\/v1\//.test(path)) return false;                       // session : renouvellement du jeton, connexion
    const m = /\/rest\/v1\/rpc\/([\w-]+)/.exec(path);
    if (m) return !RELEASE_READ_RPC.includes(m[1]);
    return method !== "GET" && method !== "HEAD";
  }
  function gateFetch(input, init) {
    if (blocked() && isWrite(input, init)) { refused++; return Promise.reject(new TypeError("Failed to fetch")); }
    return NATIVE ? NATIVE(input, init) : window.fetch(input, init);
  }

  // --- Réglages publics (étape 50) ---
  function normSettings(r) {
    if (!r || typeof r !== "object") return null;
    const n = r.changelog_count;
    return { changelog_count: typeof n === "number" && isFinite(n) && Math.floor(n) === n && n >= 0 && n <= 100 ? n : null };
  }
  function setting(k) { return settings && settings[k] != null ? settings[k] : null; }
  function setSettings(r) {
    const before = JSON.stringify(settings);
    settings = normSettings(r);
    lsSet(LS_SET, settings);
    if (JSON.stringify(settings) !== before) {
      try { if (typeof currentScreen !== "undefined" && currentScreen === "about" && typeof renderAbout === "function") renderAbout(); } catch (e) {}
    }
  }
  settings = normSettings(lsGet(LS_SET));        // dernière valeur connue (hors connexion)
  async function fetchSettings() {
    const c = cfg();
    if (!c || !NATIVE) return;
    const ctl = typeof AbortController === "function" ? new AbortController() : null;
    const tm = setTimeout(() => { try { if (ctl) ctl.abort(); } catch (e) {} }, 12000);
    try {
      const r = await NATIVE(c.url + "/rest/v1/rpc/app_settings_get", {
        method: "POST", headers: { apikey: c.key, "Content-Type": "application/json", Accept: "application/json" },
        body: "{}", cache: "no-store", signal: ctl ? ctl.signal : undefined
      });
      if (r.status === 404) { setSettings(null); return; }          // script de l'étape 50 pas lancé : comportement actuel
      if (!r.ok) return;                                             // erreur : on garde la dernière valeur connue
      setSettings(await r.json());
    } catch (e) { /* hors connexion : dernière valeur connue */ }
    finally { clearTimeout(tm); }
  }

  // --- Lecture de la dernière annonce ---
  async function fetchLatest() {
    const c = cfg();
    if (!c || !NATIVE) return undefined;
    const ctl = typeof AbortController === "function" ? new AbortController() : null;
    const tm = setTimeout(() => { try { if (ctl) ctl.abort(); } catch (e) {} }, 12000);
    try {
      const r = await NATIVE(c.url + "/rest/v1/rpc/app_release_latest", {
        method: "POST", headers: { apikey: c.key, "Content-Type": "application/json", Accept: "application/json" },
        body: "{}", cache: "no-store", signal: ctl ? ctl.signal : undefined
      });
      if (r.status === 404) { status = "missing"; return null; }      // script de l'étape 48 pas lancé
      if (!r.ok) throw new Error("http " + r.status);
      status = "ok";
      return norm(await r.json());
    } finally { clearTimeout(tm); }
  }
  // Renvoie true si la lecture a réussi. force : sans le délai minimal.
  function check(force) {
    if (!cfg()) return Promise.resolve(false);
    if (inflight) return inflight;
    if (!force && Date.now() - lastAt < RELEASE_MIN_GAP_MS) return Promise.resolve(true);
    inflight = (async () => {
      try {
        const r = await fetchLatest();
        if (r === undefined) return false;
        lastAt = Date.now();
        info = r;
        lsSet(LS, r ? Object.assign({ at: Date.now() }, r) : null);
        apply();
        try { await fetchSettings(); } catch (e) {}                  // étape 50 : jamais bloquant
        return true;
      } catch (e) { return false; }
      finally { inflight = null; }
    })();
    return inflight;
  }

  // --- Format des données en ligne plus récent (Storage) ---
  function dataKey() { const u = typeof Storage !== "undefined" && Storage.getUser ? Storage.getUser() : null; return u ? LS_DATA + u : null; }
  function dataTooNew(v) {
    const n = ver(v);
    if (n <= DATA_VERSION) return;
    dataV = Math.max(dataV, n);
    const k = dataKey();
    if (k) lsSet(k, { v: dataV, at: Date.now() });
    apply();
  }
  function dataOk() {
    const k = dataKey();
    if (k) lsSet(k, null);
    if (dataV) { dataV = 0; apply(); }
  }
  // Ouverture d'un compte : reprend un blocage « format » déjà vu sur cet appareil (hors connexion compris).
  function userChanged() {
    const k = dataKey(), s = k ? lsGet(k) : null;
    dataV = s && ver(s.v) > DATA_VERSION ? ver(s.v) : 0;
    if (k && s && !dataV) lsSet(k, null);   // l'appli comprend maintenant ce format
    apply();
  }

  // --- Affichage ---
  function apply() {
    try { if (typeof Storage !== "undefined" && Storage.pause) Storage.pause(blocked()); } catch (e) {}
    paint();
  }
  function paint() {
    try { paintBlock(); paintBar(); } catch (e) {}
  }
  function updBtn(label) {
    const b = el("button", "btn primary rl-go", updating ? t("rl.updating") : label || t("rl.update"));
    b.type = "button";
    b.disabled = updating;
    b.addEventListener("click", () => update());
    return b;
  }
  function msgLine() {
    if (!msg) return null;
    const p = el("p", "rl-msg", t(msg, { n: notYet || (info ? info.version : "") }));
    p.setAttribute("role", "status");
    return p;
  }
  function paintBlock() {
    const box = $("#releaseBlock");
    if (!box) return;
    const r = reason();
    document.body.classList.toggle("rl-locked", !!r);
    const app = document.querySelector(".app");
    if (app) app.inert = !!r;                                            // l'appli derrière ne réagit plus (clavier compris)
    if (!r) { box.hidden = true; box.textContent = ""; return; }
    const had = !box.hidden && box.firstChild;
    box.hidden = false;
    box.textContent = "";
    const card = el("div", "rl-card");
    card.appendChild(el("div", "rl-icon", "⬆️"));
    const h = el("h2", null, t("rl.block.title"));
    h.id = "rlBlockTitle";
    card.appendChild(h);
    card.appendChild(el("p", null, r === "data" ? t("rl.block.data") : t("rl.block.required", { n: info.required })));
    card.appendChild(el("p", "rl-keep", t("rl.block.keep")));
    card.appendChild(el("p", "rl-vers", r === "data"
      ? t("rl.block.versData", { v: APP_VERSION, d: DATA_VERSION, o: dataV })
      : t("rl.block.vers", { v: APP_VERSION, n: info.required })));
    const m = msgLine();
    if (m) card.appendChild(m);
    const b = updBtn();
    card.appendChild(b);
    box.appendChild(card);
    if (!had) { try { b.focus(); } catch (e) {} }
  }
  function paintBar() {
    const box = $("#releaseBar");
    if (!box) return;
    box.textContent = "";
    const logged = typeof Storage !== "undefined" && Storage.getUser && Storage.getUser();
    if (!logged || !available() || barHidden === info.version) return;
    const b = el("div", "rs-bar rl-bar");
    b.setAttribute("role", "status");
    const top = el("div", "rl-bar-top");
    top.appendChild(el("div", "rl-bar-text", t("rl.bar", { n: info.version })));
    const x = el("button", "rl-x", "×");
    x.type = "button";
    x.setAttribute("aria-label", t("rl.later")); x.title = t("rl.later");
    x.addEventListener("click", () => { barHidden = info.version; msg = ""; paintBar(); });
    top.appendChild(x);
    b.appendChild(top);
    const m = msgLine();
    if (m) b.appendChild(m);
    b.appendChild(updBtn());
    box.appendChild(b);
  }

  // --- Mise à jour ---
  async function update() {
    if (updating) return;
    msg = "";
    if (navigator.onLine === false) { msg = "rl.offline"; paint(); return; }
    updating = true; paint();
    try {
      const okNet = await check(true);                                   // connexion prouvée (Supabase n'est jamais en cache)
      if (!okNet && cfg()) throw new Error("offline");
      const target = Math.max(info ? info.version : 0, appV());
      for (const u of ["./index.html", "./"]) {                          // cache HTTP contourné ; sw.js garde la copie fraîche
        try { await withTimeout(NATIVE(u, { cache: "reload", credentials: "same-origin" }), 15000); } catch (e) { if (u === "./index.html") throw e; }
      }
      if (!blocked()) { try { await withTimeout(Storage.flushWait(), 8000); } catch (e) {} }
      try {
        if ("serviceWorker" in navigator) {
          const reg = await withTimeout(navigator.serviceWorker.getRegistration(), 5000);
          if (reg) await withTimeout(reg.update(), 10000).catch(() => {});
        }
      } catch (e) {}
      try {
        if (window.caches && caches.keys) {
          const keys = await caches.keys();
          await Promise.all(keys.filter(k => /^vocab-/.test(k) && k !== "vocab-img").map(k => caches.delete(k)));   // étape 49 : images gardées
        }
      } catch (e) {}
      try { sessionStorage.setItem(SS_UPD, JSON.stringify({ to: target, from: appV(), data: dataV, at: Date.now() })); } catch (e) {}
      reload();
    } catch (e) {
      updating = false;
      msg = "rl.offline";
      paint();
    }
  }
  // Rechargement (remplaçable dans les tests).
  let reload = () => { location.reload(); };

  // --- Démarrage ---
  function start() {
    if (started || !cfg()) return;
    started = true;
    const c = norm(lsGet(LS));
    if (c) info = c;                                                     // dernière réponse connue (hors connexion)
    try {
      const u = JSON.parse(sessionStorage.getItem(SS_UPD) || "null");
      sessionStorage.removeItem(SS_UPD);
      if (u && ver(u.to) > appV()) { notYet = ver(u.to); msg = "rl.notYet"; }
    } catch (e) {}
    apply();
    check(true);
    setInterval(() => check(true), RELEASE_EVERY_MS);
    try {
      document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") check(false); });
      window.addEventListener("online", () => check(true));
      if ("serviceWorker" in navigator) navigator.serviceWorker.addEventListener("message", ev => {
        if (ev && ev.data && ev.data.type === "push-open") check(true);
      });
    } catch (e) {}
  }

  return {
    start, check, update, paint, blocked, reason, available, gateFetch, isWrite, dataTooNew, dataOk, userChanged,
    info: () => info, status: () => status, refused: () => refused, setting, setSettings,
    _setReload: fn => { reload = fn; }
  };
})();
App.Release = Release;
