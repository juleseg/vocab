"use strict";

// === JOURNAL DES ERREURS (ÉTAPE 41) ===
// Capture les erreurs de l'appli et les envoie au serveur (script supabase-etape41.sql, fonction client_error_add),
// sans jamais gêner l'utilisateur ni afficher d'erreur.
// Chargé juste après core.js, pour attraper le plus tôt possible les erreurs des autres fichiers.
// - Erreurs capturées (kind) :
//     js       window.onerror (erreur JavaScript non attrapée)
//     promise  unhandledrejection (promesse rejetée sans catch)
//     sync     erreur de synchro des données : message exact de l'indicateur (étape 33b, Storage.getLastError),
//              appelé par Storage (setErr) ; pas « hors ligne », pas les conflits ; même message 1 fois par 5 min
//     supabase réponse en erreur d'un appel Supabase (fonctions rpc, tables, auth ≥ 500), vue par le fetch du client
//              Supabase (Supa.init → global.fetch = ErrLog.wrapFetch()) ; pas user_data (déjà en « sync »), pas les
//              fonctions absentes (script pas lancé), pas les erreurs prévues expliquées à l'utilisateur (P0001 + hint),
//              pas la session expirée (401, renouvelée seule)
//     push     réponse en erreur de la fonction send-push (sauf 404 : fonction pas déployée)
//   Ignorées : coupures réseau (« Failed to fetch », timeout…), « Script error. » sans détail, ResizeObserver.
// - Aucune donnée personnelle ni contenu de carte : textes entre guillemets doubles, adresses e-mail, identifiants
//   techniques (uuid), jetons, longs nombres et valeurs « =(…) » retirés ; adresses des fichiers réduites à
//   « js/fichier.js:ligne:colonne ». Le serveur refait le même nettoyage.
// - File locale sur l'appareil (localStorage vocabfr.errors:q, 100 lignes max, 7 jours max), gardée hors connexion
//   et quand le script n'est pas lancé. Erreurs identiques regroupées (n). Envoi groupé (20 par appel) 4 s après une
//   nouvelle erreur, toutes les 30 s, au retour de la connexion et à la mise en arrière-plan. Une ligne ne quitte la
//   file qu'après un envoi réussi. Script absent : nouvel essai toutes les 10 min, rien de visible.
// - Limite : 50 occurrences par appareil et par jour (vocabfr.errors:day) ; au-delà, ignorées tout de suite
//   (l'appli reste fluide). Le serveur applique aussi la limite.
// - Compte : une erreur survenue avant la connexion part avec le premier compte connecté, sans compte (anon) ; une
//   erreur d'un compte ne part qu'avec ce compte.
// - Jamais de boucle : une erreur pendant la capture ou l'envoi n'est pas capturée (garde « depth », erreurs venant de
//   js/errors.js ignorées, appel client_error_add exclu du fetch surveillé, envoi toujours dans try / catch).
const ErrLog = (() => {
  const Q_KEY = CONFIG.LS_USER_PREFIX + "errors:q";
  const DAY_KEY = CONFIG.LS_USER_PREFIX + "errors:day";
  const DAY_MAX = 50, Q_MAX = 100, BATCH = 20, SEND_MS = 30000, SOON_MS = 4000, KEEP_MS = 7 * 86400000;
  const MISSING_RETRY_MS = 600000, SYNC_GAP_MS = 300000, N_MAX = 50;
  const KINDS = ["js", "promise", "sync", "supabase", "push"];
  const MISSING_CODES = ["PGRST202", "42883", "PGRST205", "42P01"];
  const NATIVE_FETCH = (typeof window.fetch === "function") ? window.fetch.bind(window) : null;
  let q = null, day = null, status = "unknown", missingAt = 0, inflight = null;
  let soonTimer = null, storeTimer = null, depth = 0;
  const syncSeen = new Map();          // message de synchro → dernière capture (1 par 5 min)

  // --- Outils ---
  function lsGet(k, d) { try { const v = JSON.parse(localStorage.getItem(k) || "null"); return v == null ? d : v; } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  // Retire ce qui pourrait être personnel (voir en tête de section).
  function scrub(s) {
    return String(s == null ? "" : s)
      .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "<email>")
      .replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, "<jwt>")
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<id>")
      .replace(/"[^"]*"/g, "\"…\"")
      .replace(/=\([^)]*\)/g, "=(…)")
      .replace(/\d{6,}/g, "<n>");
  }
  // Pile d'appels : 8 lignes, adresses réduites au chemin du fichier de l'appli (sans domaine ni « ?v= »).
  function cleanStack(st) {
    return String(st || "").split("\n").map(l => l.trim()).filter(Boolean).slice(0, 8)
      .map(l => l.replace(/(?:https?|blob|file):\/\/[^\s)]*?\/((?:js|css)\/[^\s)?:#]+|[^\s/)?:#]+)(?:[?#][^\s):]*)?(?=[:\s)]|$)/g, "$1"))
      .join("\n");
  }
  // Origine = premier fichier de l'appli dans la pile : « js/fichier.js:fonction » (sans numéro de ligne, pour que
  // la même erreur garde la même empreinte d'une version à l'autre).
  function topFrame(st) {
    for (const l of String(st || "").split("\n")) {
      const m = /((?:js|css)\/[\w\/.-]+\.js)/.exec(l);
      if (!m) continue;
      const a = /^at\s+(?:async\s+)?([^\s(]+)\s+\(/.exec(l) || /^([^@\s]+)@/.exec(l);
      return m[1] + (a && a[1] && !/^(?:https?|blob|file):/.test(a[1]) ? ":" + a[1] : "");
    }
    return "";
  }
  function fromSelf(st) { return /js\/errors\.js/.test(String(st || "")); }
  function isNetMsg(m) { return /failed to fetch|networkerror|network request failed|load failed|^(?:error: )?timeout$|aborterror|the user aborted|cdn$/i.test(String(m || "").trim()); }
  function uidNow() { try { return (typeof auth !== "undefined" && auth.mode === "supabase" && auth.sbUid) ? String(auth.sbUid) : ""; } catch (e) { return ""; } }
  function screenName() {
    try {
      if (typeof Storage === "undefined" || !Storage.getUser()) return "auth";
      return typeof currentScreen !== "undefined" ? String(currentScreen || "") : "";
    } catch (e) { return ""; }
  }

  // --- File locale ---
  function load() {
    if (q) return;
    const now = Date.now();
    q = arr(lsGet(Q_KEY, [])).filter(e => e && e.id && KINDS.includes(e.kind) && e.msg && now - Date.parse(e.at || 0) < KEEP_MS);
    const d = lsGet(DAY_KEY, null);
    day = d && typeof d === "object" && d.day ? { day: String(d.day), n: num(Number(d.n), 0) } : { day: todayStr(), n: 0 };
  }
  function store() {
    clearTimeout(storeTimer); storeTimer = null;
    if (!q) return;
    try { if (q.length) lsSet(Q_KEY, q); else localStorage.removeItem(Q_KEY); } catch (e) {}
    lsSet(DAY_KEY, day);
  }
  function storeSoon() { if (!storeTimer) storeTimer = setTimeout(store, 800); }
  // Une occurrence de plus aujourd'hui (false = limite du jour atteinte).
  function take() {
    const today = todayStr();
    if (day.day !== today) day = { day: today, n: 0 };
    if (day.n >= DAY_MAX) return false;
    day.n++;
    return true;
  }

  // --- Capture ---
  // kind : js | promise | sync | supabase | push ; msg : texte court ; stack : pile brute ; src : origine.
  function capture(kind, msg, stack, src) {
    if (depth > 0) return;             // erreur pendant la capture : jamais renvoyée
    depth++;
    try {
      if (!KINDS.includes(kind)) return;
      const st = cleanStack(stack);
      if (fromSelf(stack)) return;
      const m = scrub(String(msg || "").replace(/\s+/g, " ").trim()).slice(0, 300);
      if (!m) return;
      load();
      if (!take()) { storeSoon(); return; }
      const s = scrub(src || topFrame(st)).slice(0, 120);
      const it = {
        kind, msg: m, stack: scrub(st).slice(0, 1000), src: s, screen: screenName().slice(0, 40), version: APP_VERSION,
        at: new Date().toISOString(), n: 1, u: uidNow()
      };
      const key = e => e.kind + "|" + e.msg.replace(/\d+/g, "0") + "|" + e.src + "|" + e.u + "|" + e.version;
      const k = key(it);
      const same = q.find(e => e.n < N_MAX && key(e) === k);
      if (same) { same.n++; same.at = it.at; same.screen = it.screen; if (!same.stack && it.stack) same.stack = it.stack; }
      else {
        it.id = uid();
        q.push(it);
        if (q.length > Q_MAX) q = q.slice(-Q_MAX);
      }
      storeSoon();
      sendSoon();
    } catch (e) {
      // rien : la capture ne doit jamais gêner l'appli
    } finally { depth--; }
  }
  function sendSoon() {
    if (soonTimer) return;
    soonTimer = setTimeout(() => { soonTimer = null; flush(); }, SOON_MS);
  }

  // --- Envoi ---
  function isMissing(e) {
    const code = String((e && e.code) || ""), msg = String((e && (e.message || e.msg)) || "");
    return MISSING_CODES.includes(code) || /could not find|does not exist|schema cache/i.test(msg);
  }
  function usable() {
    try {
      if (typeof auth === "undefined" || auth.mode !== "supabase" || !auth.sbUid) return false;
      if (typeof Supa === "undefined" || !Supa.client()) return false;
      if (navigator.onLine === false) return false;
      if (status === "missing" && Date.now() - missingAt < MISSING_RETRY_MS) return false;
      return true;
    } catch (e) { return false; }
  }
  function devInfo() {
    try { return typeof deviceInfo === "function" ? deviceInfo() : {}; } catch (e) { return {}; }
  }
  function flush() {
    try {
      load();
      if (inflight) return inflight;
      if (!q.length || !usable()) return Promise.resolve(false);
      const me = String(auth.sbUid);
      const batch = q.filter(e => !e.u || e.u === me).slice(0, BATCH);
      if (!batch.length) return Promise.resolve(false);
      const ids = new Set(batch.map(e => e.id));
      const payload = batch.map(e => ({
        kind: e.kind, msg: e.msg, stack: e.stack || null, src: e.src || null, screen: e.screen || null,
        version: e.version, at: e.at, n: Math.min(N_MAX, Math.max(1, num(e.n, 1))), anon: !e.u
      }));
      const cl = Supa.client();
      inflight = (async () => {
        try {
          const r = await withTimeout(cl.rpc("client_error_add", {
            p_device: typeof deviceId === "function" ? deviceId() : "unknown", p_info: devInfo(), p_errors: payload
          }), 15000);
          if (r && r.error) throw r.error;
          status = "ok";
          q = q.filter(e => !ids.has(e.id));
          store();
          return true;
        } catch (e) {
          if (isMissing(e)) { status = "missing"; missingAt = Date.now(); }
          return false;
        }
      })().then(ok => {
        inflight = null;
        if (ok && q.some(e => !e.u || e.u === uidNow())) return flush();
        return ok;
      }, () => { inflight = null; return false; });
      return inflight;
    } catch (e) { inflight = null; return Promise.resolve(false); }
  }

  // --- Erreurs de synchro (Storage.setErr) ---
  // message = texte exact affiché en touchant l'indicateur (« envoi : … », « lecture : … », « appareil : … »).
  function sync(message, err) {
    try {
      if (err === "conflict") return;                       // conflit : choix de l'utilisateur, pas une erreur
      if (navigator.onLine === false) return;
      if (err && typeof err === "object" && typeof sbErrKind === "function" && sbErrKind(err) === "net") return;
      const m = String(message || "");
      if (!m || isNetMsg(m.split(" : ").slice(1).join(" : "))) return;
      const now = Date.now(), last = syncSeen.get(m) || 0;
      if (now - last < SYNC_GAP_MS) return;
      syncSeen.set(m, now);
      capture("sync", m, "", "sync:" + (m.split(" : ")[0] || "").slice(0, 30));
    } catch (e) {}
  }

  // --- Appels Supabase et send-push (fetch du client Supabase) ---
  function inspect(input, init, res) {
    const url = String(typeof input === "string" ? input : (input && input.url) || "");
    let path = "";
    try { path = new URL(url, location.href).pathname; } catch (e) { return; }
    const method = String((init && init.method) || (input && typeof input === "object" && input.method) || "GET").toUpperCase();
    const st = res.status;
    let kind = "supabase", src = "", m;
    if ((m = /\/rest\/v1\/rpc\/([\w-]+)/.exec(path))) {
      if (m[1] === "client_error_add") return;              // jamais l'envoi des erreurs lui-même
      src = "rpc:" + m[1];
    } else if ((m = /\/rest\/v1\/([\w-]+)/.exec(path))) {
      if (m[1] === "user_data") return;                     // synchro : déjà capturée avec son message exact
      src = "table:" + m[1] + " " + method;
    } else if ((m = /\/functions\/v1\/([\w-]+)/.exec(path))) {
      if (st === 404) return;                               // fonction pas déployée : message clair dans l'écran
      kind = m[1] === "send-push" ? "push" : "supabase";
      src = "fn:" + m[1];
    } else if ((m = /\/auth\/v1\/([\w-]+)/.exec(path))) {
      if (st < 500) return;                                 // PIN faux, compte existant… : réponses prévues
      src = "auth:" + m[1];
    } else if (/\/storage\/v1\//.test(path)) {
      src = "storage " + method;
    } else return;                                          // pas un appel Supabase
    if (st === 401) return;                                 // session expirée : renouvelée seule
    res.clone().text().then(txt => {
      let j = null;
      try { j = JSON.parse(txt); } catch (e) {}
      const code = String((j && (j.code || j.error_code)) || "");
      const hint = String((j && j.hint) || "");
      const msg = String((j && (j.message || j.msg || j.error_description || j.error)) || "");
      if (MISSING_CODES.includes(code) || /could not find the function|schema cache/i.test(msg)) return;   // script pas lancé
      if (code === "PGRST301" || code === "PGRST303") return;   // jeton expiré
      if (code === "P0001" && hint) return;                 // erreur prévue, expliquée à l'utilisateur par l'appli
      capture(kind, src + " · HTTP " + st + (code ? " " + code : "") + (msg ? " · " + msg.slice(0, 200) : ""), "", src);
    }).catch(() => {});
  }
  // fetch surveillé, à donner au client Supabase (createClient(…, { global: { fetch } })).
  function wrapFetch(base) {
    const f = typeof base === "function" ? base : (a, b) => (NATIVE_FETCH ? NATIVE_FETCH(a, b) : window.fetch(a, b));
    return function (input, init) {
      return f(input, init).then(res => {
        try { if (res && res.status >= 400) inspect(input, init, res); } catch (e) {}
        return res;
      });
    };
  }

  // --- Écoute des erreurs globales ---
  try {
    window.addEventListener("error", ev => {
      try {
        const err = ev && ev.error;
        let msg = err && err.message !== undefined ? String(err.name || "Error") + ": " + String(err.message) : String((ev && ev.message) || "");
        if (!err && /^script error\.?$/i.test(msg.trim())) return;   // erreur d'un script externe, sans détail
        if (/ResizeObserver loop/i.test(msg)) return;
        let stack = err && err.stack ? String(err.stack) : "";
        let src = "";
        if (!stack && ev && ev.filename) src = cleanStack(ev.filename);
        capture("js", msg, stack, src);
      } catch (e) {}
    });
    window.addEventListener("unhandledrejection", ev => {
      try {
        const r = ev && ev.reason;
        let msg = "", stack = "";
        if (r instanceof Error) { msg = String(r.name || "Error") + ": " + String(r.message); stack = String(r.stack || ""); }
        else if (r && typeof r === "object") msg = [r.code, r.message || r.msg || r.error, r.status].filter(x => x !== undefined && x !== null && x !== "").join(" ") || "[objet]";
        else msg = String(r);
        if (isNetMsg(String((r && r.message) || r || "")) || isNetMsg(msg)) return;   // coupure réseau
        capture("promise", msg, stack, "");
      } catch (e) {}
    });
    setInterval(() => { flush(); }, SEND_MS);
    window.addEventListener("online", () => { flush(); });
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") { store(); flush(); } });
    window.addEventListener("pagehide", () => { store(); });
  } catch (e) {}

  return {
    capture, sync, wrapFetch, flush,
    pending: () => { load(); return q.reduce((s, e) => s + num(e.n, 1), 0); },
    status: () => status,
    scrub
  };
})();
App.ErrLog = ErrLog;
