"use strict";

// ====================================================================================================
// js/storage-sync.js — STORAGE (2e morceau de l'ancien js/storage.js, étape 65)
// Objet Storage : morceaux par compte, cache local, envois, synchro, pause. Chargé juste après js/storage.js.
// ====================================================================================================

// === STORAGE ===
// Couche d'accès unique. Données du compte connecté (<id> = identifiant de l'appli) découpées en morceaux :
//   user:<id>:index                 { v: 2, updatedAt, keys: [...] } — liste des morceaux, écrit en dernier
//   user:<id>:settings              { version (modèle de données), settings, updatedAt, rejected, lastCheckAt, aiResume: { kind, total } }
//   user:<id>:folders / :lists / :history
//   user:<id>:streak                série (étape 28, voir SÉRIES) — aussi modifiée par les fonctions admin de l'étape 28
//   user:<id>:xp                    XP, niveau, défis du jour, badges de l'étape 43 (voir js/xp.js)
//   user:<id>:sentences             phrases « Ma phrase » envoyées à Claude (étape 58, js/sentences.js), 200 max
//   user:<id>:stories:<listId>      histoires de la liste (étape 45, voir js/story.js), 20 max par liste
//   user:<id>:hard                  mots difficiles (étape 57, js/difficiles.js) : { v, w: { idCarte: { langue: compteurs } }, c: [paires] }
//   user:<id>:tips                  « Mon astuce » (étape 57) : { idCarte: texte (150 caractères) } — privée, jamais dans les cartes communes
//   user:<id>:progres               progrès visibles (étape 64, js/progres.js) : mots appris par semaine, bilan d'oubli (30 jours)
//   user:<id>:tombs                 pierres tombales (étape 78, js/fusion.js) : cartes, listes et dossiers supprimés, avec leur date
//   user:<id>:proposals:<n>         propositions « À valider » (500 max par morceau)
//   user:<id>:cards:<listId>:<n>    { cards: [200 max], sig: { idCarte: empreinte vérifiée } }
//   user:<id>:resume:<n>            ids des cartes restant à compléter (complétion en pause, 2000 max par morceau)
//   user:<id>:sharedprogress:<listeCommune>[:<n>]  progression personnelle sur une liste commune (étape 30) :
//                                   { idCarte: [boîte, dueAt, vues, sues, ratées, dernière vue] }, 2000 cartes max par morceau.
//                                   Les cartes d'une liste commune ne sont pas ici : table shared_cards (voir PARTAGE).
// Seuls les morceaux modifiés sont écrits (comparaison avec ce qui a déjà été écrit).
//  - local : localStorage "vocabfr." + clé (écriture tout-ou-rien : en cas d'échec, les morceaux déjà écrits sont restaurés)
//  - cloud : document data/users/<idClaude>/<clé> = { json, updatedAt } (adaptateur claudeDbBackend)
//  - Supabase (si config.js est rempli) : table user_data, une ligne par morceau, clé primaire (user_id, key),
//    clé sans le préfixe "user:<id>:" — adaptateur supabaseBackend, voir supabase.sql
// Conflits : localStorage "vocabfr.synced:<id>" = updatedAt des données en ligne à la dernière synchro réussie.
// Avant chaque envoi, l'index en ligne est relu : s'il a changé depuis (autre appareil), rien n'est écrit et on fusionne (étape 78).
// Envoi raté : données gardées sur l'appareil, nouvel essai automatique (CONFIG.RETRY_MS, et au retour de la connexion).
// Étape 77 : garde-fou avant chaque écriture (js/garde-fou.js, Guard) : l'index en ligne est TOUJOURS relu ; si le serveur
// a changé depuis la « base » (dernier état connu de l'appareil et du serveur), ses listes et langues sont relues aussi, et
// l'envoi est refusé s'il ferait disparaître une liste, une langue ou beaucoup de cartes que cet appareil n'a pas supprimées.
// Étape 78 : fusion (js/fusion.js, Fusion). Avant chaque enregistrement, le contenu modifié est daté et ce qui a disparu reçoit
// une pierre tombale (Fusion.stamp, par onBeforeSave). Pendant un envoi, si l'index en ligne n'est plus celui de la dernière
// synchro (r ≠ S : égalité seulement, jamais de comparaison d'horloges), rien n'est écrit : syncWithRemote relit tout et FUSIONNE.
// Ancien format (un seul bloc) : localStorage "vocabfr.user:<id>" + document "user:<id>". Migré automatiquement,
// après un export JSON de sécurité. Le document cloud ancien n'est jamais effacé ; la clé locale ancienne
// est retirée seulement après relecture réussie du nouveau format.
// Registre des comptes : localStorage "vocabfr.accounts" + document data/users/<idClaude>/accounts.
// Anciennes données (avant les comptes) : "vocabfr.data.v1" + data/users/<idClaude>/state, lues pour la migration, jamais effacées.

// Adaptateur cloud de l'artifact : get(clé) → texte JSON ou undefined ; set(clé, json, updatedAt) ; del(clé).
function claudeDbBackend(db, base) {
  return {
    async get(key) {
      const snap = await withTimeout(db.doc(base + "/" + key).get(), CONFIG.REMOTE_TIMEOUT_MS);
      if (!snap.exists) return undefined;
      const body = snap.data();
      return body && typeof body.json === "string" ? body.json : undefined;
    },
    async set(key, json, updatedAt) { await withTimeout(db.doc(base + "/" + key).set({ json, updatedAt }), CONFIG.REMOTE_TIMEOUT_MS); },
    async del(key) { await withTimeout(db.doc(base + "/" + key).delete(), CONFIG.REMOTE_TIMEOUT_MS); }
  };
}
// Adaptateur Supabase : table user_data (user_id, key, data jsonb, updated_at), RLS = chacun ses lignes (admin : toutes).
// La clé y est stockée sans le préfixe "user:<id>:". uid = auth.uid() de l'utilisateur connecté.
// updated_at est mis par le serveur (trigger). jsonb ne garde pas l'ordre des champs : voir markSynced().
function supabaseBackend(client, uid, prefix) {
  const k = key => key.startsWith(prefix) ? key.slice(prefix.length) : key;
  const ok = r => { if (r && r.error) throw r.error; return r ? r.data : null; };
  const T = CONFIG.REMOTE_TIMEOUT_MS;
  return {
    async get(key) {
      const d = ok(await withTimeout(client.from("user_data").select("data").eq("user_id", uid).eq("key", k(key)).maybeSingle(), T));
      return d ? JSON.stringify(d.data) : undefined;
    },
    // Toutes les lignes du compte en une requête : Map(clé avec préfixe → texte JSON).
    async getAll() {
      const rows = ok(await withTimeout(client.from("user_data").select("key,data").eq("user_id", uid), T * 3));
      return new Map(arr(rows).map(r => [prefix + r.key, JSON.stringify(r.data)]));
    },
    async set(key, json) {
      ok(await withTimeout(client.from("user_data").upsert({ user_id: uid, key: k(key), data: JSON.parse(json) }), T));
    },
    async del(key) {
      ok(await withTimeout(client.from("user_data").delete().eq("user_id", uid).eq("key", k(key)), T));
    },
    // Étape 77 : session bien ouverte pour CE compte (une session absente ou expirée peut renvoyer « aucune ligne » sans erreur).
    async sessionOk() {
      const r = ok(await withTimeout(client.auth.getSession(), T));
      return !!(r && r.session && r.session.user && r.session.user.id === uid);
    }
  };
}

const Storage = (() => {
  let db = null, base = null;  // base = "data/users/<idClaude>" quand le cloud est disponible
  let backend = null;          // adaptateur cloud de l'artifact (null = pas de cloud Claude)
  let sb = null;               // client Supabase (null = pas de Supabase)
  let userId = null, remote = null; // remote = adaptateur du compte connecté
  let remoteOk = false;        // données en ligne lues et comparées : les envois sont permis
  let mode = "local";          // "local" | "cloud" | "syncing" | "offline" | "error"
  let retryTimer = null, failWarned = false, conflictOpen = false;
  let onConflictFn = null, onRetryInitFn = null, onSyncErrorFn = null;
  let timer = null, lastData = null, held = false;
  let chain = Promise.resolve();
  let localSaved = new Map();  // clé → JSON déjà présent dans localStorage
  let remoteSaved = new Map(); // clé → JSON déjà présent dans le cloud
  let dupKeys = new Set();     // étape 89 : morceaux lus qui contenaient une carte en double (à réécrire au prochain envoi)
  let localFullWarned = false;
  const beforeSaveFns = [];    // étape 30 : modifications des listes communes repérées avant chaque sauvegarde (étape 49 : + images)
  let lastErr = "";            // étape 33b : dernière erreur de synchro (message court, affiché en touchant l'indicateur)
  let paused = false;          // étape 48 : mise à jour nécessaire (js/release.js) → aucun envoi, données gardées sur l'appareil
  let guardOpen = false;       // étape 77 : envoi refusé par le garde-fou, fenêtre ouverte → aucun envoi jusqu'au choix
  let unsent = false;          // étape 79 : enregistré sur l'appareil, pas encore confirmé en ligne (indicateur « En attente »)
  let lastOkAt = 0;            // étape 79 : dernière lecture ou dernier envoi en ligne réussi (heure de cet appareil)
  const listeners = [];

  function setMode(m) {
    if (paused && remote && (m === "cloud" || m === "syncing" || m === "error")) m = "paused";   // étape 48
    mode = m; listeners.forEach(fn => { try { fn(m); } catch (e) {} });
  }
  function onMode(fn) { listeners.push(fn); fn(mode); }
  // Étape 79 (indicateur de synchro, js/synchro-ui.js) : état lu sans rien changer ; ping = l'état a changé sans changer de mode.
  function ping() { listeners.forEach(fn => { try { fn(mode); } catch (e) {} }); }
  function okKey() { return CONFIG.LS_USER_PREFIX + "sync:ok:" + userId; }
  function okNow() { lastOkAt = Date.now(); if (userId) { try { localStorage.setItem(okKey(), String(lastOkAt)); } catch (e) {} } }
  function setUnsent(v) { v = !!v && !!remote; if (v !== unsent) { unsent = v; ping(); } }
  function syncInfo() {
    return { remote: !!remote, unsent: !!remote && unsent, lastOkAt, remoteOk, paused, guard: guardOpen, conflict: conflictOpen, held };
  }
  function getMode() { return mode; }
  function isCloud() { return !!backend || !!sb; }
  function isSupabase() { return !!sb; }
  // Supabase : pas de registre de comptes local (Supabase Auth s'en charge).
  function useSupabase(client) { sb = client; backend = null; setMode("cloud"); }
  // Étape 86 : compte ouvert sans session renouvelée (serveur injoignable, PIN vérifié sur l'appareil) = « Hors connexion ».
  function failMode() { setMode(navigator.onLine === false || (typeof ConnLocal !== "undefined" && ConnLocal.waiting()) ? "offline" : "error"); }
  // Message court, sans contenu de données : code / message de l'erreur, clé du morceau en cause.
  function setErr(where, e) {
    const m = typeof e === "string" ? e : [e && e.code, e && (e.message || e.msg), e && e.status].filter(x => x !== undefined && x !== null && x !== "").join(" ") || String(e);
    lastErr = (where + " : " + m).slice(0, 160);
    try { if (typeof ErrLog !== "undefined") ErrLog.sync(lastErr, e); } catch (x) {}   // étape 41 : journal des erreurs (message exact)
  }
  function getLastError() { return lastErr; }
  // Étape 48 : synchro en pause (Release.apply) tant que l'appli doit être mise à jour. Les sauvegardes continuent sur
  // l'appareil ; rien ne part en ligne (indicateur « En pause »). Reprise : envoi de ce qui attend.
  function pause(on) {
    on = !!on;
    if (on === paused) return;
    paused = on;
    if (paused) { clearTimeout(retryTimer); retryTimer = null; if (remote) setMode("paused"); }
    else if (remote) { setMode("cloud"); retryNow(); }
  }
  function isPaused() { return paused; }
  // Étape 48 : format des données en ligne (version du morceau settings) plus récent que celui de l'appli → blocage
  // (js/release.js). Renvoie true si trop récent.
  function tooNew(v) {
    const n = num(Number(v), 0);
    if (n > DATA_VERSION) { try { if (typeof Release !== "undefined") Release.dataTooNew(n); } catch (e) {} return true; }
    return false;
  }

  // --- Synchro : updatedAt des données en ligne à la dernière synchro réussie (null = inconnu) ---
  function getSynced() {
    if (!userId) return null;
    try { const v = localStorage.getItem(CONFIG.LS_SYNCED + userId); return v === null ? null : Number(v); } catch (e) { return null; }
  }
  function setSynced(v) { if (userId) { try { localStorage.setItem(CONFIG.LS_SYNCED + userId, String(v)); } catch (e) {} } }
  // Les données en ligne sont identiques à data : on retient leurs morceaux (évite de tout renvoyer).
  // Étape 33b : seulement les morceaux vraiment lus en ligne (initRemote). Un morceau qui n'existe pas encore en ligne
  // (ex. « streak » ajouté par la migration v3 → v4) reste à envoyer : l'index ne doit jamais citer un morceau absent.
  function markSynced(data) {
    if (!userId) return;
    const { pieces, index } = split(data), known = remoteSaved;
    remoteSaved = new Map(Array.from(pieces).filter(([k]) => known.has(k))); remoteSaved.set(pre() + "index", index);
    // Étape 89 : un morceau en ligne qui contenait une carte en double n'est PAS identique à celui de l'appareil : il repart.
    if (dupKeys.size) { dupKeys.forEach(k => { if (remoteSaved.has(k)) remoteSaved.set(k, null); }); dupKeys = new Set(); }
    setSynced(data.updatedAt);
    unsent = false;                                          // étape 79 : l'appareil et le serveur sont identiques
    if (typeof Guard !== "undefined") Guard.setBase(data);   // étape 77 : état connu de l'appareil ET du serveur
    if (typeof Fusion !== "undefined") Fusion.synced();      // étape 78 : plus aucune modification locale en attente
  }
  // Étape 78 : après une fusion (ou une conversion de format), l'appareil contient la version en ligne lue (updatedAt = at) :
  // le prochain envoi n'est pas un conflit. Les morceaux lus (initRemote) restent connus : seuls ceux qui diffèrent partent.
  function mergedOn(at) { setSynced(num(at, 0)); }
  // « Garder les données de cet appareil » : tout renvoyer et supprimer les morceaux en ligne en trop.
  function forceFullPush(remoteKeys, remoteUpdatedAt) {
    remoteSaved = new Map(arr(remoteKeys).map(k => [k, null]));
    remoteSaved.set(pre() + "index", null);
    setSynced(remoteUpdatedAt);
  }
  function onConflict(fn) { onConflictFn = fn; }
  function onRetryInit(fn) { onRetryInitFn = fn; }
  function setConflictOpen(v) { conflictOpen = !!v; }
  // Étape 77 : fin du choix du garde-fou (version en ligne reprise, ou « Garder cet appareil ») : les envois reprennent.
  function guardReset() { guardOpen = false; }
  // Nouvel essai automatique : relecture en ligne si elle a échoué, sinon nouvel envoi.
  function scheduleRetry() {
    clearTimeout(retryTimer);
    retryTimer = setTimeout(retryNow, CONFIG.RETRY_MS);
  }
  function retryNow() {
    clearTimeout(retryTimer); retryTimer = null;
    if (!userId || !remote || paused) return;
    if (!remoteOk) { if (onRetryInitFn) { try { onRetryInitFn(); } catch (e) {} } }
    else if (lastData) flush();
    else if (mode === "offline" && navigator.onLine !== false) setMode("cloud");   // étape 79 : connexion revenue, rien à envoyer
  }
  // Étape 77 : bouton « Réessayer » de l'écran de première connexion.
  function retryInit() { if (!remoteOk) retryNow(); }
  try { window.addEventListener("online", retryNow); window.addEventListener("offline", () => { if (remote) setMode("offline"); }); } catch (e) {}

  function lsGet(key) { try { const s = localStorage.getItem(key); return s ? JSON.parse(s) : null; } catch (e) { return null; } }
  function lsRaw(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
  function lsSet(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); return true; } catch (e) { return false; } }
  function lsDel(key) { try { localStorage.removeItem(key); } catch (e) {} }
  function oldKey(id) { return "user:" + id; }               // ancien format (un seul bloc)
  function pre() { return "user:" + userId + ":"; }          // préfixe des morceaux du compte connecté
  function byteLen(s) { try { return new TextEncoder().encode(s).length; } catch (e) { return s.length * 3; } }

  // Connexion au cloud (base + identité Claude). Renvoie true si disponible.
  async function connect() {
    try {
      if (typeof window.claude === "undefined" || !window.claude || typeof window.claude.use !== "function") return false;
      const [d, user] = await withTimeout(Promise.all([window.claude.use("db"), window.claude.use("user")]), CONFIG.REMOTE_TIMEOUT_MS + 2000);
      if (!d || !user) return false;
      const id = await withTimeout(user.id(), CONFIG.REMOTE_TIMEOUT_MS);
      if (!id) return false;
      db = d; base = "data/users/" + id;
      backend = claudeDbBackend(db, base);
      setMode("cloud");
      return true;
    } catch (e) {
      db = null; base = null; backend = null;
      setMode("local");
      return false;
    }
  }
  // Lecture d'un document { json } (registre, anciennes données) : objet, ou undefined si vide. Lève une erreur en cas d'échec.
  async function remoteGet(name) {
    const json = await backend.get(name);
    return json ? JSON.parse(json) : undefined;
  }

  // --- Comptes : { accounts: [{ id, salt, pinHash, createdAt }], migrated } ---
  function normReg(r) {
    const d = (r && typeof r === "object") ? r : {};
    return {
      accounts: arr(d.accounts).filter(a => a && a.id && a.pinHash)
        .map(a => ({ id: String(a.id), salt: String(a.salt || ""), pinHash: String(a.pinHash), createdAt: num(a.createdAt, 0) })),
      migrated: !!d.migrated
    };
  }
  function mergeReg(a, b) {
    const out = { accounts: a.accounts.slice(), migrated: a.migrated || b.migrated };
    b.accounts.forEach(x => { if (!out.accounts.some(y => y.id === x.id)) out.accounts.push(x); });
    out.accounts.sort((x, y) => x.createdAt - y.createdAt);
    return out;
  }
  async function loadAccounts() {
    let reg = normReg(lsGet(CONFIG.LS_ACCOUNTS));
    if (backend) {
      try { reg = mergeReg(reg, normReg(await remoteGet(CONFIG.REMOTE_ACCOUNTS))); }
      catch (e) { setMode("error"); }
    }
    lsSet(CONFIG.LS_ACCOUNTS, reg);
    return reg;
  }
  // Relit le registre distant avant d'écrire, pour ne pas écraser un compte créé sur un autre appareil.
  async function saveAccounts(reg) {
    lsSet(CONFIG.LS_ACCOUNTS, reg);
    if (!backend) return;
    try {
      const m = mergeReg(reg, normReg(await remoteGet(CONFIG.REMOTE_ACCOUNTS)));
      await backend.set(CONFIG.REMOTE_ACCOUNTS, JSON.stringify(m), Date.now());
      lsSet(CONFIG.LS_ACCOUNTS, m);
      setMode("cloud");
    } catch (e) { setMode("error"); }
  }

  // --- Anciennes données (avant les comptes) : la version la plus récente entre local et cloud ---
  function readLegacyLocal() { return lsGet(CONFIG.LS_KEY); }
  async function readLegacy() {
    const l = looksLikeAppData(readLegacyLocal()) ? readLegacyLocal() : null;
    let r = null;
    if (backend) { try { const x = await remoteGet(CONFIG.REMOTE_DOC); if (looksLikeAppData(x)) r = x; } catch (e) {} }
    if (l && r) return num(r.updatedAt, 0) >= num(l.updatedAt, 0) ? r : l;
    return l || r;
  }

  // --- Session sur cet appareil (sans Supabase) : localStorage si « Rester connecté », sinon sessionStorage ---
  function getSession() {
    try { return localStorage.getItem(CONFIG.LS_SESSION) || sessionStorage.getItem(CONFIG.LS_SESSION) || null; } catch (e) { return null; }
  }
  function setSession(id) {
    try { localStorage.removeItem(CONFIG.LS_SESSION); sessionStorage.removeItem(CONFIG.LS_SESSION); } catch (e) {}
    if (!id) return;
    try { (rememberMe() ? localStorage : sessionStorage).setItem(CONFIG.LS_SESSION, id); } catch (e) {}
  }

  // --- Découpage : données → Map(clé → JSON) dans l'ordre de l'index ---
  function slices(a, n) { const out = []; for (let i = 0; i < a.length; i += n) out.push(a.slice(i, i + n)); return out; }
  function split(data, prefix) {
    const p = new Map(), P = prefix === undefined ? pre() : prefix;
    const put = (k, v) => p.set(P + k, JSON.stringify(v));
    const ids = data.aiResume ? arr(data.aiResume.ids) : [];
    put("settings", {
      version: data.version, settings: data.settings, updatedAt: data.updatedAt, rejected: data.rejected, lastCheckAt: data.lastCheckAt,
      aiResume: data.aiResume ? { kind: data.aiResume.kind, total: ids.length } : null
    });
    put("folders", data.folders);
    put("lists", data.lists);
    put("history", data.history);
    put("streak", data.streak);
    if (data.xp) put("xp", data.xp);   // étape 43 : nouveau morceau, toujours envoyé avant l'index (règle 33b)
    // Étape 57 : mots difficiles (compteurs, pause, paires) et astuces : deux nouveaux morceaux, toujours envoyés avant l'index
    // (règle 33b) ; absents = vides (pas de morceau). Astuces à part : les compteurs changent à chaque réponse, pas les textes.
    if (hardHas(data.hard)) put("hard", data.hard);
    if (data.tips && Object.keys(data.tips).length) put("tips", data.tips);
    if (progresHas(data.progres)) put("progres", data.progres);   // étape 64 : nouveau morceau, toujours avant l'index (règle 33b)
    if (tombsHas(data.tombs)) put("tombs", data.tombs);           // étape 78 : pierres tombales, avant l'index (règle 33b) ; absent = aucune
    // Étape 45 : histoires, un morceau par liste (listes existantes seulement : une liste supprimée emporte ses histoires).
    // Nouveaux morceaux, toujours envoyés avant l'index (règle 33b). Liste sans histoire : pas de morceau.
    if (arr(data.sentences).length) put("sentences", data.sentences);   // étape 58 : « Ma phrase », un seul morceau, avant l'index (règle 33b)
    const stIds = new Set(arr(data.lists).map(l => l.id)), stories = data.stories || {};
    Object.keys(stories).forEach(L => { if (stIds.has(L) && arr(stories[L]).length) put("stories:" + L, stories[L]); });
    // Cartes : par liste, morceaux de 200 cartes max (et taille limitée, pour les cartes avec de longs exemples).
    // Listes communes (étape 30) : cartes dans shared_cards, ici seulement la progression personnelle (sharedprogress).
    const shIds = new Set(arr(data.lists).filter(isSharedList).map(l => l.id));
    const byList = new Map();
    data.cards.forEach(c => { if (shIds.has(c.listId)) return; if (!byList.has(c.listId)) byList.set(c.listId, []); byList.get(c.listId).push(c); });
    const sigs = data.checkedSig || {};
    byList.forEach((cards, listId) => {
      let n = 0, cur = [], curSig = {}, bytes = 0;
      const out = () => { put("cards:" + listId + ":" + (n++), { cards: cur, sig: curSig }); cur = []; curSig = {}; bytes = 0; };
      cards.forEach(c => {
        const b = byteLen(JSON.stringify(c)) + 40;
        if (cur.length && (cur.length >= CONFIG.CARDS_PER_PIECE || bytes + b > CONFIG.PIECE_MAX_BYTES)) out();
        cur.push(c); bytes += b;
        if (sigs[c.id]) curSig[c.id] = sigs[c.id];
      });
      if (cur.length) out();
    });
    const sp = sharedProgressOf(data);
    Object.keys(sp).forEach(U => {
      const ent = Object.entries(sp[U]);
      slices(ent, SH_PROG_CHUNK).forEach((s, i) => put("sharedprogress:" + U + (i ? ":" + i : ""), Object.fromEntries(s)));
    });
    slices(data.proposals, CONFIG.PROPOSALS_PER_PIECE).forEach((s, i) => put("proposals:" + i, s));
    slices(ids, CONFIG.IDS_PER_PIECE).forEach((s, i) => put("resume:" + i, s));
    const index = JSON.stringify({ v: 2, updatedAt: data.updatedAt, keys: Array.from(p.keys()) });
    return { pieces: p, index };
  }
  // Administration : données d'un autre compte ↔ lignes Supabase. Comme pour le compte lui-même :
  // clé de ligne sans préfixe, mais liste de l'index avec le préfixe "user:<identifiant>:".
  function packRows(data, ident) {
    const P = "user:" + ident + ":";
    const { pieces, index } = split(data, P);
    const rows = Array.from(pieces, ([key, json]) => ({ key: key.slice(P.length), data: JSON.parse(json) }));
    rows.push({ key: "index", data: JSON.parse(index) });  // l'index en dernier
    return rows;
  }
  function unpackRows(rows) {
    const m = new Map(arr(rows).map(r => [r.key, r.data]));
    if (!m.has("index")) return null;
    const idx = Object.assign({}, m.get("index"));
    idx.keys = arr(idx.keys).map(k => String(k).replace(/^user:[^:]*:/, ""));
    return assemble(idx, k => m.get(k), "").data;
  }
  // Morceaux → données (à passer ensuite dans normalizeData). get(clé) → objet ou undefined.
  function assemble(idx, getPiece, prefix) {
    const P = prefix === undefined ? pre() : prefix;
    const s = getPiece(P + "settings") || {};
    const out = {
      version: num(s.version, 1), updatedAt: num(idx.updatedAt, 0),   // pas de version = données de la version 1
      settings: s.settings, rejected: s.rejected, lastCheckAt: s.lastCheckAt,
      folders: arr(getPiece(P + "folders")), lists: arr(getPiece(P + "lists")), history: arr(getPiece(P + "history")),
      streak: getPiece(P + "streak"),   // absent (version 3 et moins) : calculé par normalizeData
      xp: getPiece(P + "xp"),           // absent (version 42 et moins) : XP de départ calculé par normalizeData (étape 43)
      hard: getPiece(P + "hard"),       // étape 57 : absent (version 56 et moins) = aucun mot difficile
      tips: getPiece(P + "tips"),       // étape 57 : absent = aucune astuce
      progres: getPiece(P + "progres"), // étape 64 : absent (version 63 et moins) = rien de compté encore
      tombs: getPiece(P + "tombs"),     // étape 78 : absent (version 77 et moins) = aucune pierre tombale
      cards: [], proposals: [], checkedSig: {}, aiResume: null, sharedProgress: {}, stories: {}, sentences: []
    };
    const ids = [];
    let missing = 0;
    const lost = [];
    const from = [];   // étape 89 : morceau d'origine de chaque carte lue
    arr(idx.keys).forEach(k => {
      const v = getPiece(k);
      // « streak » absent (étape 33b) : pas bloquant, la série est recalculée depuis history (comme en v3) puis renvoyée.
      // « xp » absent (étape 43) : pas bloquant non plus, l'XP de départ est recalculé depuis history puis renvoyé.
      // « hard » et « tips » absents (étape 57) : pas bloquant non plus (données vides). « progres » (étape 64) : pareil.
      // « tombs » absent (étape 78) : pas bloquant (au pire un élément supprimé revient, rien n'est perdu).
      if (v === undefined) { if (k !== P + "streak" && k !== P + "xp" && k !== P + "hard" && k !== P + "tips" && k !== P + "progres" && k !== P + "tombs") { missing++; lost.push(k.slice(P.length)); } return; }
      if (k.startsWith(P + "cards:")) { arr(v.cards).forEach(c => { out.cards.push(c); from.push(k); }); Object.assign(out.checkedSig, v.sig || {}); }
      else if (k.startsWith(P + "proposals:")) out.proposals.push(...arr(v));
      else if (k.startsWith(P + "resume:")) ids.push(...arr(v));
      else if (k === P + "sentences") out.sentences = arr(v);   // étape 58
      else if (k.startsWith(P + "stories:")) out.stories[k.slice((P + "stories:").length)] = arr(v);   // étape 45
      else if (k.startsWith(P + "sharedprogress:") && v && typeof v === "object") {   // étape 30
        const U = k.slice((P + "sharedprogress:").length).split(":")[0];
        out.sharedProgress[U] = Object.assign(out.sharedProgress[U] || {}, v);
      }
    });
    if (s.aiResume && s.aiResume.kind) out.aiResume = { kind: s.aiResume.kind, ids };
    // Étape 89 : même carte lue dans deux morceaux (carte déplacée d'une liste à une autre, lue pendant l'envoi ou après un
    // envoi coupé entre deux morceaux) : une seule est gardée, la plus récemment modifiée (m, étape 78), sinon la dernière lue.
    // Le morceau qui portait l'autre exemplaire est noté (dupKeys) : markSynced le fera réécrire au prochain envoi.
    if (out.cards.length > 1) {
      const at = new Map(), drop = [];
      out.cards.forEach((c, i) => {
        if (!c || !c.id) return;
        const j = at.get(c.id);
        if (j === undefined) { at.set(c.id, i); return; }
        if (num(c.m, 0) >= num(out.cards[j].m, 0)) { drop.push(j); at.set(c.id, i); } else drop.push(i);
      });
      if (drop.length) {
        const gone = new Set(drop);
        if (prefix === undefined) drop.forEach(i => dupKeys.add(from[i]));
        out.cards = out.cards.filter((c, i) => !gone.has(i));
      }
    }
    return { data: out, missing, lost };
  }

  // --- Compte connecté ---
  // sbUid : identifiant Supabase (auth.uid()) du compte, en mode Supabase.
  function setUser(id, sbUid) {
    clearTimeout(timer); timer = null; lastData = null; held = false;
    clearTimeout(retryTimer); retryTimer = null; failWarned = false; conflictOpen = false; remoteOk = false; lastErr = ""; guardOpen = false;
    localSaved = new Map(); remoteSaved = new Map(); dupKeys = new Set(); localFullWarned = false;
    userId = id || null;
    unsent = false; lastOkAt = 0;
    if (userId) { try { lastOkAt = num(Number(localStorage.getItem(okKey())), 0); } catch (e) {} }   // étape 79
    if (!userId) remote = null;
    else if (sb) remote = sbUid ? supabaseBackend(sb, sbUid, "user:" + userId + ":") : null;
    else remote = backend || null;
    try { if (typeof Release !== "undefined") Release.userChanged(); } catch (e) {}   // étape 48
    try { if (typeof Guard !== "undefined") Guard.userChanged(); } catch (e) {}       // étape 77
  }
  function hasRemote() { return !!remote; }   // étape 77 : compte avec des données en ligne possibles (Supabase ou cloud)
  function getUser() { return userId; }
  // Pendant l'ouverture du compte : les sauvegardes restent en mémoire (pas d'écriture avant la migration).
  function hold() { held = true; }
  function release() { held = false; }

  // Lecture locale : { data, old } (old = ancien format, à migrer), ou null si rien.
  function readLocal() {
    if (!userId) return null;
    const P = pre();
    const idxRaw = lsRaw(CONFIG.LS_USER_PREFIX + P + "index");
    if (idxRaw) {
      try {
        const idx = JSON.parse(idxRaw);
        localSaved = new Map([[P + "index", idxRaw]]);
        const { data, missing } = assemble(idx, k => {
          const raw = lsRaw(CONFIG.LS_USER_PREFIX + k);
          if (raw === null) return undefined;
          localSaved.set(k, raw);
          return JSON.parse(raw);
        });
        if (missing) data.updatedAt = 0; // incomplet : une version cloud complète passera devant
        return { data, old: false };
      } catch (e) { /* index illisible : on tente l'ancien format */ }
    }
    const old = lsGet(CONFIG.LS_USER_PREFIX + oldKey(userId));
    return looksLikeAppData(old) ? { data: old, old: true } : null;
  }
  // Écriture locale tout-ou-rien des morceaux modifiés. Renvoie true si tout est écrit.
  function writeLocal(data) {
    if (!userId) return false;
    const { pieces, index } = split(data);
    const P = pre(), done = [];
    try {
      pieces.forEach((json, k) => {
        if (localSaved.get(k) === json) return;
        done.push([k, localSaved.has(k) ? localSaved.get(k) : null]);
        localStorage.setItem(CONFIG.LS_USER_PREFIX + k, json);
        localSaved.set(k, json);
      });
      if (localSaved.get(P + "index") !== index) {
        done.push([P + "index", localSaved.has(P + "index") ? localSaved.get(P + "index") : null]);
        localStorage.setItem(CONFIG.LS_USER_PREFIX + P + "index", index);
        localSaved.set(P + "index", index);
      }
    } catch (e) {
      // Mémoire de l'appareil pleine (ou indisponible) : on remet les morceaux comme avant.
      done.reverse().forEach(([k, prev]) => {
        try {
          if (prev === null) { localStorage.removeItem(CONFIG.LS_USER_PREFIX + k); localSaved.delete(k); }
          else { localStorage.setItem(CONFIG.LS_USER_PREFIX + k, prev); localSaved.set(k, prev); }
        } catch (e2) {}
      });
      return false;
    }
    // Morceaux qui n'existent plus (liste vidée, propositions traitées…).
    Array.from(localSaved.keys()).forEach(k => {
      if (k !== P + "index" && !pieces.has(k)) { lsDel(CONFIG.LS_USER_PREFIX + k); localSaved.delete(k); }
    });
    return true;
  }
  // Après migration réussie : relit le nouveau format et retire l'ancienne clé locale si tout correspond.
  function dropOldLocal(data) {
    if (!userId) return false;
    const back = readLocal();
    if (!back || back.old || !back.data || arr(back.data.cards).length !== data.cards.length) return false;
    lsDel(CONFIG.LS_USER_PREFIX + oldKey(userId));
    return true;
  }

  // Lecture de toutes les lignes du compte (Supabase : une requête ; cloud : l'index puis ses morceaux, 8 à la fois).
  // Renvoie { got: Map(clé → texte JSON), idx: index lu ou null }. Lève une erreur en cas d'échec.
  async function fetchAll() {
    const id = userId, P = pre();
    let got = null, idxRaw;
    if (remote.getAll) { got = await remote.getAll(); idxRaw = got.get(P + "index"); }
    else idxRaw = await remote.get(P + "index");
    if (userId !== id) return { got: null, idx: null, stale: true };
    const idx = idxRaw ? JSON.parse(idxRaw) : null;
    if (idx && !got) {
      const keys = arr(idx.keys);
      got = new Map([[P + "index", idxRaw]]);
      for (let i = 0; i < keys.length; i += 8) {           // 8 lectures à la fois
        const part = keys.slice(i, i + 8);
        const vals = await Promise.all(part.map(k => remote.get(k)));
        part.forEach((k, j) => { if (vals[j] !== undefined) got.set(k, vals[j]); });
      }
    }
    return { got: got || new Map(), idx, stale: userId !== id };
  }
  // Étape 77 : morceaux en ligne SANS index (premier envoi coupé avant l'index, écriture d'une autre version…) : le compte
  // n'est pas vide. On rassemble tout ce qui existe (updatedAt 0 : jamais « plus récent » que l'appareil).
  function assembleNoIndex(got) {
    const keys = Array.from(got.keys()).filter(k => k !== pre() + "index");
    return assemble({ v: 2, updatedAt: 0, keys }, k => got.has(k) ? JSON.parse(got.get(k)) : undefined).data;
  }

  // Lecture cloud. Renvoie { data, old, keys } (données du compte), undefined (cloud dispo mais VRAIMENT vide), null (cloud
  // indisponible, données incomplètes ou trop récentes). En cas d'échec : pas d'envoi (on n'a pas pu comparer), nouvel essai automatique.
  async function initRemote() {
    if (!remote) return null;
    const id = userId, P = pre();
    try {
      const { got, idx, stale } = await fetchAll();
      if (stale || userId !== id) return null;
      if (idx) {
        const keys = arr(idx.keys);
        const { data, missing, lost } = assemble(idx, k => got.has(k) ? JSON.parse(got.get(k)) : undefined);
        // Étape 48 : données en ligne écrites par une version plus récente de l'appli (format > DATA_VERSION) : on ne les
        // reprend pas et on n'écrit rien (blocage « Mise à jour nécessaire », js/release.js). Données de l'appareil gardées.
        if (tooNew(data.version)) { remoteOk = false; setMode("paused"); return null; }
        try { if (typeof Release !== "undefined") Release.dataOk(); } catch (e) {}
        if (missing) throw new Error("incomplete (" + lost.slice(0, 3).join(", ") + ")");
        remoteSaved = new Map(Array.from(got).filter(([k]) => k === P + "index" || keys.includes(k)));
        remoteOk = true; okNow();
        setMode("cloud");
        return { data, old: false, keys: Array.from(got.keys()) };
      }
      if (got.size) {                                          // étape 77 : des lignes, mais pas d'index
        const data = assembleNoIndex(got);
        if (tooNew(data.version)) { remoteOk = false; setMode("paused"); return null; }
        remoteSaved = new Map(Array.from(got.keys(), k => [k, null]));   // tout est renvoyé, index compris
        remoteOk = true; okNow();
        setMode("cloud");
        return { data, old: false, keys: Array.from(got.keys()), partial: true };
      }
      const old = remote.getAll ? undefined : await remoteGet(oldKey(id));
      if (userId !== id) return null;
      // Étape 77 : « aucune ligne » n'est cru que si la session ouverte est bien celle de ce compte (sinon : lecture ratée).
      if (!looksLikeAppData(old) && remote.sessionOk && !(await remote.sessionOk())) throw new Error("session");
      if (userId !== id) return null;
      remoteSaved = new Map();
      remoteOk = true; okNow();
      setMode("cloud");
      return looksLikeAppData(old) ? { data: old, old: true, keys: [] } : undefined;
    } catch (e) {
      if (userId === id) { remoteOk = false; setErr("lecture", e); failMode(); scheduleRetry(); }
      return null;
    }
  }
  // Étape 77 : lecture complète SANS rien changer à la synchro (copie de la version en ligne avant « Garder cet appareil »).
  // Renvoie { data (ou null si rien), keys, updatedAt } ou null en cas d'échec.
  async function peekRemote() {
    if (!remote) return null;
    const id = userId;
    try {
      const { got, idx, stale } = await fetchAll();
      if (stale || userId !== id) return null;
      const keys = Array.from(got.keys());
      if (!idx) return { data: keys.length ? assembleNoIndex(got) : null, keys, updatedAt: 0 };
      const { data, missing, lost } = assemble(idx, k => got.has(k) ? JSON.parse(got.get(k)) : undefined);
      if (missing) throw new Error("incomplete (" + lost.slice(0, 3).join(", ") + ")");
      return { data, keys, updatedAt: num(idx.updatedAt, 0) };
    } catch (e) {
      if (userId === id) setErr("lecture", e);
      return null;
    }
  }

  // Envoi cloud des morceaux modifiés, puis de l'index, puis suppression des morceaux disparus. Renvoie true si tout est à jour.
  // Avant d'écrire : relecture de l'index en ligne ; s'il a changé depuis la dernière synchro → rien n'est écrit, fusion (étape 78).
  async function doFlush() {
    if (paused && remote) { if (mode !== "paused") setMode("paused"); return false; }   // étape 48 : mise à jour nécessaire
    if (!remote || !remoteOk || !lastData || !userId || conflictOpen || guardOpen) return !remote;
    if (typeof Guard !== "undefined" && Guard.isOpen()) return false;   // étape 77 : choix du garde-fou en cours
    const id = userId, P = pre();
    const { pieces, index } = split(lastData);
    const at0 = lastData.updatedAt;                         // updatedAt écrit dans cet index
    const sum0 = typeof Guard !== "undefined" ? Guard.summary(lastData) : null;   // étape 77 : ce qui est envoyé
    const fl0 = typeof Fusion !== "undefined" ? Fusion.flushStart(lastData) : null;   // étape 78 : modifications locales parties avec cet envoi
    const todo = [];
    pieces.forEach((json, k) => { if (remoteSaved.get(k) !== json) todo.push([k, json]); });
    const idxChanged = remoteSaved.get(P + "index") !== index;
    const gone = Array.from(remoteSaved.keys()).filter(k => k !== P + "index" && !pieces.has(k));
    if (!todo.length && !idxChanged && !gone.length) {   // étape 79 : plus rien en attente (l'indicateur repasse au vert)
      const was = unsent; unsent = false;
      if (mode !== "cloud") setMode("cloud"); else if (was) ping();
      return true;
    }
    if (todo.some(([, json]) => byteLen(json) > CONFIG.MAX_DOC_BYTES)) { setErr("envoi", "too big"); setMode("error"); toast(t("save.tooBig")); syncErr("too big"); return false; }
    try {
      setMode("syncing");
      const S = getSynced();
      // Étape 77 : l'index en ligne est toujours relu (avant : seulement quand une synchro avait déjà réussi sur l'appareil).
      const rIdx = await remote.get(P + "index");
      if (userId !== id) return false;
      const rI = rIdx ? JSON.parse(rIdx) : null;
      const r = rI ? num(rI.updatedAt, 0) : 0;
      // Étape 78 : « modifié ailleurs » = l'index en ligne n'est plus celui de la dernière synchro (égalité seulement : plus
      // de comparaison entre les horloges de deux appareils). Rien n'est écrit : syncWithRemote relit tout et fusionne.
      if (rI && r !== at0 && (S === null || r !== S)) {
        // Étape 48 : écrit par une version plus récente (format des données) → blocage, aucune écriture.
        try {
          const rs = await remote.get(P + "settings");
          if (userId !== id) return false;
          if (rs && tooNew(JSON.parse(rs).version)) { remoteOk = false; setMode("paused"); return false; }
        } catch (e) {}
        conflictOpen = true;
        if (onConflictFn) setTimeout(() => { try { onConflictFn(); } catch (e) {} }, 0);
        return false;
      }
      // Étape 77 : garde-fou. Serveur changé depuis la base (ou sans index : premier envoi) → ses listes, dossiers et réglages
      // sont relus ; l'envoi est refusé s'il ferait disparaître une liste, une langue, ou beaucoup de cartes.
      if (typeof Guard !== "undefined" && !Guard.allowed()) {
        const b = Guard.base();
        let rem = null;
        if (!rI || !b || b.at !== r) {
          const get = async k => { const v = await remote.get(P + k); return v === undefined ? undefined : JSON.parse(v); };
          const [rl, rs, rf] = await Promise.all([get("lists"), get("settings"), get("folders")]);
          if (userId !== id) return false;
          if (rl !== undefined || rI) rem = Guard.summary({ lists: arr(rl), folders: arr(rf), settings: rs && rs.settings, cards: [] });
        }
        const pb = Guard.check(lastData, rem);
        if (pb) {
          guardOpen = true;
          setErr("envoi", "guard (" + [pb.lists.length + " lists", pb.langs.join("/"), pb.drop ? pb.drop.was + ">" + pb.drop.now : ""].filter(Boolean).join(", ") + ")");
          setMode("error");
          const data = lastData;
          setTimeout(() => { try { Guard.refuse(pb, data); } catch (e) {} }, 0);
          return false;
        }
      }
      for (const [k, json] of todo) {                         // un morceau à la fois
        await remote.set(k, json, lastData.updatedAt);
        if (userId !== id) return false;
        remoteSaved.set(k, json);
      }
      await remote.set(P + "index", index, lastData.updatedAt);
      remoteSaved.set(P + "index", index);
      setSynced(at0);                                         // étape 78 : la date écrite dans l'index (pas celle d'une modification faite pendant l'envoi)
      for (const k of gone) { await remote.del(k); remoteSaved.delete(k); }
      if (typeof Guard !== "undefined") Guard.written(sum0, at0);   // étape 77 : nouvelle base = ce qui vient d'être écrit
      if (typeof Fusion !== "undefined") Fusion.pushed(fl0, lastData);   // étape 78 : ce qui est parti n'est plus « modifié ici »
      failWarned = false;
      okNow();                                                // étape 79 : envoi réussi
      if (lastData && lastData.updatedAt === at0) unsent = false;   // rien n'a été modifié pendant l'envoi
      setMode("cloud");
      return true;
    } catch (e) {
      if (userId === id) {
        setErr("envoi", e);
        failMode();
        if (navigator.onLine !== false && sbErrKind(e) !== "net") syncErr((e && (e.code || e.message)) || e);   // journal (pas « hors ligne »)
        if (!failWarned && navigator.onLine !== false) { failWarned = true; toast(t("save.retry")); }
        scheduleRetry();
      }
      return false;
    }
  }
  // Erreur d'envoi (journal d'activité, étape 24) : message court transmis au déclencheur enregistré par onSyncError.
  function syncErr(msg) { if (onSyncErrorFn) { try { onSyncErrorFn(String(msg || "").slice(0, 120)); } catch (e) {} } }
  function onSyncError(fn) { onSyncErrorFn = fn; }
  // Les envois cloud passent l'un après l'autre (jamais deux écritures en même temps).
  function flush() {
    const p = chain.then(doFlush, doFlush);
    chain = p.catch(() => false);
    return p;
  }

  // Sauvegarde du compte connecté : immédiate en local (morceaux modifiés), différée (regroupée) vers le cloud.
  // Renvoie false si l'appareil n'a pas pu enregistrer.
  function onBeforeSave(fn) { if (typeof fn === "function" && !beforeSaveFns.includes(fn)) beforeSaveFns.push(fn); }
  function beforeSave(data) { beforeSaveFns.forEach(fn => { try { fn(data); } catch (e) {} }); }
  function save(data) {
    if (!userId) return false;
    beforeSave(data);
    lastData = data;
    setUnsent(true);                                          // étape 79
    if (held) return true;
    const ok = writeLocal(data);
    if (!ok) { setErr("appareil", "localStorage full"); setMode("error"); if (!localFullWarned) { localFullWarned = true; toast(t("save.localFull")); } }
    else localFullWarned = false;
    if (remote) {
      clearTimeout(timer);
      timer = setTimeout(() => { timer = null; flush(); }, CONFIG.SAVE_DELAY_MS);
    }
    return ok;
  }
  // Sauvegarde complète tout de suite (import par lots). Renvoie { local, remote } (true = réussi ou sans objet).
  async function saveNow(data) {
    if (!userId) return { local: false, remote: false };
    beforeSave(data);
    lastData = data;
    setUnsent(true);                                          // étape 79
    clearTimeout(timer); timer = null;
    const local = writeLocal(data);
    if (!local) { setErr("appareil", "localStorage full"); setMode("error"); return { local: false, remote: false }; }
    const r = (remote && remoteOk) ? await flush() : true;  // en ligne pas encore relu : envoi plus tard
    return { local: true, remote: r };
  }

  // Appli fermée ou mise en arrière-plan avant le délai, fin de session de révision : on envoie tout de suite.
  function flushNow() { if (timer) { clearTimeout(timer); timer = null; flush(); } }
  try {
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flushNow(); });
    window.addEventListener("pagehide", flushNow);
  } catch (e) {}

  // Avant de changer de compte : envoie ce qui attend et attend la fin des écritures.
  async function flushWait() {
    flushNow();
    try { await chain; } catch (e) {}
  }

  return {
    connect, isCloud, isSupabase, useSupabase, onMode, getMode,
    loadAccounts, saveAccounts, readLegacy, readLegacyLocal, getSession, setSession,
    setUser, getUser, hold, release, readLocal, writeLocal, dropOldLocal, initRemote, save, saveNow, flushNow, flushWait,
    getSynced, markSynced, forceFullPush, onConflict, onRetryInit, onSyncError, setConflictOpen, packRows, unpackRows, onBeforeSave, getLastError,
    pause, isPaused,   // étape 48
    hasRemote, retryInit, peekRemote, guardReset,   // étape 77
    mergedOn,                                       // étape 78
    syncInfo, retry: retryNow                       // étape 79 (js/synchro-ui.js) : lecture de l'état, « Réessayer »
  };
})();

