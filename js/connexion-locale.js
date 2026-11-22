"use strict";

// ====================================================================================================
// js/connexion-locale.js — CONNEXION HORS LIGNE FIABLE (ÉTAPE 86)
// Chargé juste après js/auth.js. Au chargement : seulement des écouteurs (online, offline, visibilitychange).
// Objet ConnLocal. Appelé par js/app.js (init), js/auth.js, js/storage-supabase.js (Supa.init) et js/storage-sync.js
// (failMode), toujours avec typeof ConnLocal !== "undefined" : sans ce fichier, l'appli se comporte comme la version 85.
// ====================================================================================================

// === CONNEXION HORS LIGNE FIABLE (ÉTAPE 86) ===
// CAUSE corrigée : le jeton d'accès Supabase dure 1 h. Au lancement, la bibliothèque veut le renouveler ; sans Internet le
// renouvellement échoue et elle répond « pas de session » (alors que la session est toujours sur l'appareil) ; l'appli
// affichait donc l'écran de connexion. Règle maintenant : une erreur réseau n'est JAMAIS une déconnexion.
// 1. Session gardée sur l'appareil mais pas renouvelable (hors ligne, serveur injoignable) : boot() la rend quand même ;
//    le compte s'ouvre sur ses données locales (voyant « Hors connexion ») ; confirm() termine l'ouverture au retour d'Internet.
// 2. Tant que le compte ouvert n'a pas de jeton valable, AUCUNE requête ne part sous la clé publique (guardFetch) : elle
//    échoue comme une coupure réseau. Sans cela, le serveur répondrait « aucune ligne » sans erreur (règles d'accès).
// 3. Le serveur REFUSE la session (réponse reçue : la bibliothèque la retire de l'appareil) : vraie déconnexion (lost),
//    avec un message sur l'écran de connexion. Les données restent dans le cache de l'appareil.
// 4. Plus de session du tout sur l'appareil ET serveur injoignable : PIN vérifié SUR L'APPAREIL (login), seulement pour un
//    compte déjà connecté ici. Vérificateur par compte : PBKDF2-HMAC-SHA-256, sel aléatoire, CXL_ITER itérations ; jamais
//    le PIN ni le mot de passe. CXL_TRIES erreurs → attente (CXL_WAIT_MIN minutes, doublée à chaque fois).
//    Le mot de passe dérivé reste en mémoire (pend.pwd), jamais sur l'appareil : au retour d'Internet une vraie session
//    est rouverte (reopen) ; PIN changé ailleurs → fenêtre « PIN changé » (askPin).
// Clés locales (appareil seulement) : vocabfr.cxl:<compte> (vérificateur), vocabfr.cxl:try:<compte> (erreurs de PIN).
const CXL_ITER = 600000;        // itérations PBKDF2 (au moins 100 000)
const CXL_TRIES = 5;            // erreurs de PIN hors ligne avant une attente
const CXL_WAIT_MIN = 5;         // première attente, en minutes ; doublée à chaque nouvelle série d'erreurs
const CXL_WAIT_MAX_MIN = 1440;  // attente la plus longue (24 h)
const CXL_BOOT_MS = 4000;       // au lancement : attente la plus longue du renouvellement de la session
const CXL_RETRY_MS = 20000;     // nouvel essai de retour en ligne
const CXL_NET_MS = 20000;       // après un échec réseau du renouvellement : les appels échouent tout de suite pendant ce délai

const ConnLocal = (() => {
  let pend = null;        // { id, uid, pwd } : compte ouvert par le PIN local ; pwd = mot de passe dérivé, en mémoire seulement
  let offEntry = false;   // compte ouvert sans avoir pu vérifier le profil en ligne (session pas renouvelée, profil illisible)
  let hadSession = false; // une session a bien été vue sur l'appareil pour le compte ouvert
  let netFailAt = 0;      // dernier échec RÉSEAU du renouvellement de la session
  let timer = null, busy = false, lostRun = false, askClose = null;

  const lsGet = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };
  const lsDel = k => { try { localStorage.removeItem(k); } catch (e) {} };
  const vKey = id => CONFIG.LS_USER_PREFIX + "cxl:" + id;
  const tKey = id => CONFIG.LS_USER_PREFIX + "cxl:try:" + id;
  const b64 = u8 => btoa(String.fromCharCode.apply(null, u8));
  const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  const can = () => !!(window.crypto && crypto.subtle && crypto.subtle.deriveBits && crypto.getRandomValues);
  const open = () => auth.mode === "supabase" && !!Storage.getUser();
  const stored = () => { try { return Supa.stored(); } catch (e) { return null; } };
  const expired = s => !s.expires_at || s.expires_at * 1000 <= Date.now();
  const netError = () => ({ name: "AuthRetryableFetchError", message: "Failed to fetch", status: 0 });

  // --- Vérificateur du PIN (sur l'appareil) ---
  async function derive(id, pin, salt, iter) {
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(id + ":" + pin), "PBKDF2", false, ["deriveBits"]);
    return new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: iter }, key, 256));
  }
  // Comparaison à temps constant : tous les octets sont toujours comparés.
  function same(a, b) {
    if (!a || !b || a.length !== b.length) return false;
    let d = 0;
    for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
    return d === 0;
  }
  function verifier(id) {
    try {
      const v = JSON.parse(lsGet(vKey(id)) || "null");
      return v && v.v === 1 && v.uid && v.salt && v.hash && v.iter >= 100000 ? v : null;
    } catch (e) { return null; }
  }
  // Après chaque connexion réussie EN LIGNE (connexion, création, nouveau PIN) : vérificateur créé ou remplacé.
  async function remember(id, pin, uid) {
    try {
      if (!can() || !id || !uid || !validPin(pin)) return false;
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const hash = await derive(id, pin, salt, CXL_ITER);
      lsSet(vKey(id), JSON.stringify({ v: 1, uid, salt: b64(salt), iter: CXL_ITER, hash: b64(hash), at: Date.now() }));
      lsDel(tKey(id));
      // PIN vérifié en ligne pendant que le compte était ouvert par le PIN local (changement de PIN) : la vraie session existe.
      if (pend && pend.id === id) { pend = null; offEntry = true; hadSession = true; watch(); }
      return true;
    } catch (e) { return false; }
  }
  function forget(id) { if (id) { lsDel(vKey(id)); lsDel(tKey(id)); } }
  function has(id) { return !!verifier(id); }

  // --- Erreurs de PIN hors ligne : CXL_TRIES erreurs → attente, doublée à chaque nouvelle série ---
  function tries(id) {
    try {
      const x = JSON.parse(lsGet(tKey(id)) || "null");
      if (x && typeof x === "object") return { n: num(x.n, 0), lvl: num(x.lvl, 0), until: num(x.until, 0), at: num(x.at, 0) };
    } catch (e) {}
    return { n: 0, lvl: 0, until: 0, at: 0 };
  }
  function waitDur(lvl) { return Math.min(CXL_WAIT_MAX_MIN, CXL_WAIT_MIN * Math.pow(2, Math.max(0, lvl - 1))) * 60000; }
  function waitMs(id) {
    const x = tries(id), now = Date.now();
    if (!x.until) return 0;
    if (now < x.at) { x.at = now; x.until = now + waitDur(x.lvl); lsSet(tKey(id), JSON.stringify(x)); }   // horloge reculée : l'attente repart
    return Math.max(0, x.until - now);
  }
  function failed(id) {
    const x = tries(id);
    x.n++; x.at = Date.now();
    let wait = 0;
    if (x.n >= CXL_TRIES) { x.n = 0; x.lvl++; wait = waitDur(x.lvl); x.until = x.at + wait; }
    lsSet(tKey(id), JSON.stringify(x));
    return wait ? { wait } : { left: CXL_TRIES - x.n };
  }

  // --- Connexion par PIN vérifié sur l'appareil (appelée par sbLogin quand le serveur est injoignable) ---
  // Renvoie true si l'écran a sa réponse (compte ouvert, ou message affiché) ; false = message réseau habituel.
  async function login(id, pin) {
    if (!can()) return false;
    const v = verifier(id);
    if (!v) { authError("cxl.err.unknown", { id }); return true; }   // jamais connecté ici : refusé hors ligne
    const w = waitMs(id);
    if (w > 0) { authError("cxl.err.wait", { min: Math.ceil(w / 60000) }); return true; }
    let good = false;
    try { good = same(await derive(id, pin, unb64(v.salt), v.iter), unb64(v.hash)); } catch (e) { return false; }
    if (!good) {
      const r = failed(id);
      if (r.wait) authError("cxl.err.wait", { min: Math.ceil(r.wait / 60000) });
      else authError("cxl.err.wrong", { n: r.left });
      return true;
    }
    lsDel(tKey(id));
    pend = { id, uid: v.uid, pwd: await Supa.password(id, pin) };
    auth.lastPin = ""; auth.loginVia = "pin"; auth.sbUid = v.uid; auth.isAdmin = false;
    clearAuthForm();
    try { await startUser(id, null, null, v.uid); }   // données locales ; rien n'est lu ni écrit en ligne (pas de session)
    catch (e) { if (!Storage.getUser()) { pend = null; return false; } }
    if (Storage.getUser() === id) { toast(t("cxl.opened")); watch(); }
    return true;
  }

  // --- Lancement : session de l'appareil, même si elle ne peut pas être renouvelée ---
  // null = aucune session sur l'appareil ; { refused } = le serveur l'a refusée (retirée de l'appareil) ;
  // { session, offline } : offline = gardée telle quelle (hors ligne, serveur injoignable ou trop lent).
  async function boot() {
    const s0 = stored();
    if (!s0) return null;
    let s = null;
    if (!(expired(s0) && navigator.onLine === false)) {   // hors ligne avec un jeton périmé : inutile d'attendre
      try { s = await withTimeout(Supa.session(), CXL_BOOT_MS); } catch (e) {}
    }
    if (s) return { session: s, offline: false };
    const s1 = stored();
    if (!s1) return { refused: true };
    netFailAt = Date.now();
    offEntry = true;
    watch();
    return { session: s1, offline: true };
  }
  // Profil illisible à l'ouverture (réseau) : à vérifier au retour d'Internet.
  function unsure() { offEntry = true; watch(); }

  // --- Bibliothèque : getSession n'attend pas quand on sait que le renouvellement ne peut pas aboutir ---
  // (jeton périmé + appareil hors ligne, ou échec réseau il y a moins de CXL_NET_MS). Même réponse que la bibliothèque
  // après un échec réseau. Le renouvellement automatique de la bibliothèque (toutes les 30 s) n'est pas touché.
  function attach(client) {
    try {
      const real = client.auth.getSession.bind(client.auth);
      client.auth.getSession = async function () {
        const s = stored();
        if (s) hadSession = true;
        if (s && expired(s) && (navigator.onLine === false || Date.now() - netFailAt < CXL_NET_MS)) return { data: { session: null }, error: netError() };
        const r = await real();
        if (r && r.error && sbErrKind(r.error) === "net") netFailAt = Date.now();
        else if (r && r.data && r.data.session) netFailAt = 0;
        return r;
      };
    } catch (e) {}
  }
  // --- Aucune requête sous la clé publique pour un compte ouvert (données, fonctions, stockage) ---
  // Et, compte ouvert + appareil hors ligne : la requête échoue TOUT DE SUITE (la bibliothèque réessaie sinon une lecture
  // pendant 7 s, et pendant ce temps les enregistrements du lancement restent retenus en mémoire).
  const urlOf = input => typeof input === "string" ? input : String((input && input.url) || input || "");
  function anonCall(input, init) {
    let a = "";
    try { a = new Headers((init && init.headers) || (input && typeof input === "object" && input.headers) || {}).get("Authorization") || ""; } catch (e) {}
    return !a || a === "Bearer " + Supa.anonKey();
  }
  // Échec « comme une coupure réseau ». Lecture de données (GET / HEAD) : réponse d'erreur que la bibliothèque ne réessaie pas.
  function netFail(url, input, init) {
    const m = String((init && init.method) || (input && typeof input === "object" && input.method) || "GET").toUpperCase();
    if (/\/rest\/v1\//.test(url) && (m === "GET" || m === "HEAD")) {
      return Promise.resolve(new Response(JSON.stringify({ message: "TypeError: Failed to fetch", code: "", details: "", hint: "" }),
        { status: 599, headers: { "Content-Type": "application/json" } }));
    }
    return Promise.reject(new TypeError("Failed to fetch"));
  }
  function guardFetch(base) {
    const f = typeof base === "function" ? base : (a, b) => window.fetch(a, b);
    return function (input, init) {
      try {
        const url = urlOf(input);
        if (open() && /\/(rest|functions|storage)\/v1\//.test(url)) {   // la connexion elle-même (/auth/v1/) passe toujours
          if (anonCall(input, init)) {
            if (stored()) hadSession = true;
            else if (!pend && hadSession) lost();   // session retirée de l'appareil : le serveur l'a refusée
            return netFail(url, input, init);
          }
          if (navigator.onLine === false) return netFail(url, input, init);
        }
      } catch (e) {}
      return f(input, init);
    };
  }

  // --- Le serveur a refusé la session (réponse reçue) : vraie déconnexion, message sur l'écran de connexion ---
  async function lost() {
    if (lostRun) return;
    lostRun = true;
    try {
      forget(Storage.getUser());   // PIN peut-être changé ailleurs : l'ancien PIN n'ouvre plus cet appareil
      await logout();
      authError("cxl.refused");
    } catch (e) {}
    finally { lostRun = false; }
  }

  // --- Retour d'Internet ---
  function watch() {
    clearTimeout(timer);
    timer = pend || offEntry ? setTimeout(confirm, CXL_RETRY_MS) : null;
  }
  // Délai de la bibliothèque après un renouvellement raté (1 min) : levé quand la connexion revient.
  function coolOff() {
    netFailAt = 0;
    try { const a = Supa.client() && Supa.client().auth; if (a && a.lastRefreshFailure) a.lastRefreshFailure = null; } catch (e) {}
  }
  async function confirm() {
    clearTimeout(timer); timer = null;
    if (busy || askClose || !(pend || offEntry)) return;
    if (!open()) { pend = null; offEntry = false; return; }
    if (navigator.onLine === false) { watch(); return; }
    busy = true;
    try {
      if (pend) await reopen();
      else {
        const s = await Supa.session();
        if (s) await online(s);
      }
    } catch (e) {
      if (!pend && open() && hadSession && !stored()) lost();   // refus explicite du serveur pendant le renouvellement
    } finally { busy = false; watch(); }
  }
  // Session valable : profil relu (compte bloqué ou PIN à changer → lancement normal en ligne), droits, synchro relancée.
  async function online(session) {
    const id = Storage.getUser();
    const prof = await Supa.myProfile();   // erreur réseau : nouvel essai plus tard (offEntry reste vrai)
    if (!id || Storage.getUser() !== id) return;
    if (prof && (prof.blocked === true || prof.must_change_pin)) { location.reload(); return; }
    auth.sbUid = session.user.id;
    if (prof) {
      auth.isAdmin = !!prof.is_admin;
      lsSet(CONFIG.LS_SB_PROFILE, JSON.stringify({ uid: session.user.id, identifiant: id, is_admin: auth.isAdmin }));
    }
    offEntry = false; netFailAt = 0;
    Supa.touch().catch(() => {});
    try { Mod.refresh(true); } catch (e) {}
    try { Storage.retry(); } catch (e) {}        // lecture en ligne puis fusion (étapes 77 et 78), envoi de ce qui attend
    try { enterChecks(id); } catch (e) {}        // fenêtres du lancement qui n'ont pas pu se faire hors connexion
  }
  // Compte ouvert par le PIN local : vraie session rouverte avec le mot de passe gardé en mémoire.
  async function reopen() {
    const p = pend;
    let session = null;
    try { session = await Supa.signInPwd(p.id, p.pwd); }
    catch (e) {
      if (sbErrKind(e) === "wrong" && pend === p) { lsDel(vKey(p.id)); askPin(p); }   // PIN changé ailleurs
      return;                                                                          // réseau, serveur : plus tard
    }
    if (pend !== p || Storage.getUser() !== p.id) { await Supa.signOut(); return; }    // compte quitté entre-temps
    if (!session || !session.user || session.user.id !== p.uid) { await lost(); return; }   // identifiant repris par un autre compte
    pend = null; offEntry = true; hadSession = true;
    await online(session);
    toast(t("cxl.back"));
  }
  // « PIN changé » : nouvelle saisie (vérifiée en ligne), ou déconnexion. Fenêtre verrouillée.
  function askPin(p) {
    if (askClose) return;
    let pin = "", run = false;
    const wrap = el("div", "cxl-ask");
    wrap.appendChild(el("p", null, t("cxl.pin.text", { id: p.id })));
    const err = el("div", "auth-msg err cxl-ask-err");
    err.hidden = true; err.setAttribute("role", "alert");
    wrap.appendChild(err);
    const inp = pinInput("", v => { pin = v; });
    wrap.appendChild(formField(t("cxl.pin.label"), inp));
    const say = key => { err.textContent = t(key); err.hidden = false; };
    const done = () => { const c = askClose; askClose = null; if (c) c(); };
    const go = async () => {
      if (run) return;
      if (!validPin(pin)) { say("auth.err.pin"); return; }
      run = true;
      try {
        const session = await Supa.signIn(p.id, pin);
        if (pend !== p || Storage.getUser() !== p.id) { await Supa.signOut(); done(); return; }
        if (!session || !session.user || session.user.id !== p.uid) { done(); await lost(); return; }
        remember(p.id, pin, p.uid);
        pend = null; offEntry = true; hadSession = true;
        done();
        try { await online(session); } catch (e) {}
        toast(t("cxl.back"));
        watch();
      } catch (e) {
        const k = sbErrKind(e);
        say(k === "wrong" ? "cxl.pin.wrong" : k === "net" ? "cxl.pin.net" : "auth.err.server");
      } finally { run = false; }
    };
    inp.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); go(); } });
    askClose = openModal(t("cxl.pin.title"), wrap, [
      { label: t("account.logout"), onClick: () => { askClose = null; logout(); } },
      { label: t("cxl.pin.ok"), kind: "primary", onClick: () => { go(); return false; } }
    ], { locked: true });
  }

  // --- « Se déconnecter » : vérificateur gardé seulement si « Rester connecté » est coché ---
  function onLogout(id) {
    pend = null; offEntry = false; hadSession = false; netFailAt = 0;
    clearTimeout(timer); timer = null;
    if (askClose) { const c = askClose; askClose = null; try { c(); } catch (e) {} }
    if (id && !rememberMe()) forget(id);
  }

  // --- Écran de connexion hors ligne : une phrase d'explication ---
  function hint() {
    if (navigator.onLine !== false || !can()) return null;
    return el("div", "auth-msg cxl-hint", t("cxl.offHint"));
  }

  // --- Bibliothèque Supabase gardée par le service worker ---
  // sw.js sert cdn.jsdelivr.net « cache d'abord », mais ne peut pas ranger la réponse d'une balise <script> d'un autre site
  // (réponse illisible). Une lecture « cors » de la même adresse, faite ici, passe par sw.js qui la range : la bibliothèque
  // reste alors disponible hors connexion, même quand le cache du navigateur (7 jours) ne l'a plus. sw.js n'est pas modifié.
  function keepLib() {
    try {
      if (!("caches" in window) || !("serviceWorker" in navigator)) return;
      const go = async () => {
        if (!navigator.serviceWorker.controller || navigator.onLine === false) return;
        if (await caches.match(CONFIG.SB_CDN)) return;
        await fetch(CONFIG.SB_CDN, { mode: "cors", credentials: "omit" });
      };
      go().catch(() => {});
      navigator.serviceWorker.addEventListener("controllerchange", () => { go().catch(() => {}); });
    } catch (e) {}
  }

  // Compte ouvert sans jeton valable : le voyant dit « Hors connexion » (jamais « Erreur »).
  function waiting() { return !!pend || offEntry || (netFailAt > 0 && Date.now() - netFailAt < CXL_NET_MS); }
  function status() { return { pin: !!pend, offline: offEntry, ask: !!askClose, waiting: waiting() }; }

  try {
    window.addEventListener("online", () => {
      coolOff();
      if (pend || offEntry) setTimeout(confirm, 500);
      if (!Storage.getUser() && auth.mode === "supabase" && auth.view === "login") renderAuth();
    });
    window.addEventListener("offline", () => { if (!Storage.getUser() && auth.mode === "supabase" && auth.view === "login") renderAuth(); });
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && (pend || offEntry)) confirm(); });
  } catch (e) {}

  return { boot, unsure, attach, guardFetch, login, remember, forget, has, onLogout, hint, keepLib, waiting, status, confirm };
})();
