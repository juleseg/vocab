"use strict";

// === STOCKAGE HORS LIGNE AU CHOIX : CACHE GÉRÉ PAR L'APPLI (ÉTAPE 79) ===
// L'utilisateur choisit ce que CET APPAREIL garde pour réviser sans Internet (Réglages → Données et stockage,
// js/screens/stockage.js). Rien de tout cela n'est dans le compte : aucune donnée, aucun réglage de compte, aucun SQL.
// sw.js n'est PAS modifié : tout passe par des caches gérés depuis la page.
//
// Ce qui est déjà sur l'appareil sans rien choisir (inchangé) :
//  - le TEXTE de toutes les cartes (morceaux du compte dans localStorage, js/storage-sync.js) ;
//  - les cartes des listes communes (cache localStorage « vocabfr.shared:<compte> », js/partage.js) ;
//  - les SONS : ce sont les voix du téléphone (synthèse vocale du navigateur, js/audio.js) : il n'y a aucun fichier
//    à télécharger. L'appli dit seulement, par langue, si la voix marche hors ligne (voix « locale ») ou non.
// Ce que les choix ajoutent :
//  - IMAGES des listes gardées : téléchargées dans le cache d'images existant (Cache API « vocab-img », js/images.js),
//    et « épinglées » : elles ne comptent plus dans la limite de 300 images et ne sont jamais retirées par le ménage
//    automatique (Offline.pinned, lu par Images). Ce cache est gardé par sw.js et par « Mettre à jour » (étape 48).
//  - DICTIONNAIRE COMMUN : copie locale (IndexedDB « vocab-hors-ligne », magasin « dict ») des sens qui ont un mot dans les
//    langues du profil, lue par Dict.search quand il n'y a pas de connexion (ajout d'une carte). Lecture directe des
//    tables dict_senses et dict_values (lisibles par tout compte connecté depuis l'étape 36) : aucune fonction nouvelle.
//
// Sur l'appareil seulement :
//  - « vocabfr.hl:<compte> » = { v, img, dict, lists: { idListe: 1 }, job, miss } — job : 0 rien, 1 téléchargement
//    à reprendre tout seul (coupé par le réseau ou la fermeture de l'appli), 2 mis en pause par l'utilisateur ;
//  - « vocabfr.hl:dict » = { at, n, bytes, cur, done, langs, since, upd } — état de la copie du dictionnaire (commune aux
//    comptes de l'appareil) ; cur = dernier sens enregistré : la reprise repart de là ; since = plus grand updated_at des
//    sens lus (heure du SERVEUR) ; upd = mise à jour demandée ou pas terminée.
// Dictionnaire (correctif 79, vérifié en base le 21/11) : dict_senses n'est lisible QUE par colonnes (id, created_at,
// updated_at, version, merged_into ; created_by masquée) : jamais de select « * ». Toutes les lectures sont paginées
// (HL_PAGE lignes, jusqu'à une page vide). Les sens fusionnés (merged_into) et leurs valeurs sont ignorés. La 1re copie
// lit tout ; « Mettre à jour » ne relit que les sens dont updated_at a changé (une valeur modifiée fait toujours avancer
// updated_at et version de son sens). Une page qui échoue : copie notée « à terminer », jamais « à jour ». Compte bloqué
// (la règle RLS ne renvoie aucune ligne) ou lecture refusée (42501) : message court dans Stockage, pas d'erreur.
// Téléchargement : HL_PAR images à la fois ; ce qui manque = ce qui est voulu moins ce qui est déjà dans le cache, donc
// une reprise ne retélécharge rien. Un petit complément (HL_AUTO_MAX images au plus, ex. une carte ajoutée) part tout
// seul ; au-delà, c'est le bouton « Télécharger » (avec le conseil du Wi-Fi pour un gros téléchargement).
// « Libérer de la place » retire les images et le dictionnaire téléchargés, JAMAIS les cartes ni la progression.
const HL_DB = "vocab-hors-ligne";       // IndexedDB : copie du dictionnaire commun
const HL_PAGE = 1000;                   // lignes par lecture du dictionnaire
const HL_DICT_MAX = 60000;              // sens au plus dans la copie
const HL_DICT_MARGIN = 120000;          // mise à jour du dictionnaire : marge avant la dernière heure vue (ms)
const HL_IMG_AVG = 60 * 1024;           // taille supposée d'une image dont la taille n'est pas connue
const HL_BIG = 5 * 1048576;             // au-delà : « gros téléchargement », le Wi-Fi est conseillé
const HL_CELL_BIG = 1048576;            // sur le réseau mobile (quand le téléphone le dit) : conseillé dès 1 Mo
const HL_AUTO_MAX = 30;                 // complément automatique : images au plus
const HL_PAR = 4;                       // images téléchargées en même temps
const HL_BOOT_MS = 9000;                // reprise / complément : délai après l'ouverture du compte

const Offline = (() => {
  let pf = null, pfFor = null;          // choix de l'appareil pour le compte ouvert
  let pinSet = null, pinAt = 0;         // images épinglées (calculées, gardées 5 s)
  let job = null;                       // téléchargement en cours
  let bootFor = null, bootTimer = null;
  let dictIdx = null;                   // index en mémoire de la copie du dictionnaire
  let useCache = null, useAt = 0;       // espace utilisé (gardé 30 s)
  let lastErr = "";                     // dernière erreur d'un téléchargement (message exact, affiché dans Stockage)
  const subs = [];

  function safe(fn, d) { try { return fn(); } catch (e) { return d; } }
  function online() { return navigator.onLine !== false; }
  function emit() { subs.forEach(fn => { try { fn(); } catch (e) {} }); }
  function on(fn) { if (typeof fn === "function" && !subs.includes(fn)) subs.push(fn); }

  // --- Choix de l'appareil ---
  function key() { const u = Storage.getUser(); return u ? CONFIG.LS_USER_PREFIX + "hl:" + u : null; }
  function prefs() {
    const u = Storage.getUser();
    if (pf && pfFor === u) return pf;
    pfFor = u; pf = { v: 1, img: true, dict: false, lists: {}, job: 0, miss: 0 };
    const k = key();
    if (k) {
      try {
        const o = JSON.parse(localStorage.getItem(k) || "null");
        if (o && typeof o === "object") {
          pf.img = o.img !== false; pf.dict = o.dict === true;
          if (o.lists && typeof o.lists === "object") Object.keys(o.lists).forEach(id => { if (o.lists[id]) pf.lists[id] = 1; });
          pf.job = o.job === 1 || o.job === 2 ? o.job : 0;
          pf.miss = num(o.miss, 0);
        }
      } catch (e) {}
    }
    return pf;
  }
  function store(quiet) {
    const k = key();
    if (k && pf) { try { localStorage.setItem(k, JSON.stringify(pf)); } catch (e) {} }
    pinSet = null;
    if (!quiet) emit();
  }
  function keptLists() { const p = prefs(); return state.lists.filter(l => p.lists[l.id]); }
  function keptCount() { return safe(() => (Storage.getUser() ? keptLists().length : 0), 0); }
  function setImg(v) { prefs().img = !!v; store(); }
  function setDict(v) { prefs().dict = !!v; store(); }
  function setLists(ids, v) {
    const p = prefs();
    arr(ids).forEach(id => { if (v) p.lists[id] = 1; else delete p.lists[id]; });
    if (v) protect();
    store();
  }
  // Demande au navigateur de ne pas faire le ménage tout seul dans ce que l'appli garde (sans effet s'il refuse).
  function protect() { try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {}); } catch (e) {} }

  // --- Images voulues (listes gardées) ---
  function imgOk() { return safe(() => Images.on(), false); }
  function cacheOk() { return safe(() => !!(window.caches && caches.open), false); }
  // Map chemin → taille connue (0 si inconnue). Sens dont l'image n'est pas encore connue : voir prepare().
  function wanted() {
    const out = new Map(), p = prefs();
    if (!p.img || !Storage.getUser()) return out;
    const ids = new Set(keptLists().map(l => l.id));
    if (!ids.size) return out;
    state.cards.forEach(c => {
      if (!ids.has(c.listId)) return;
      const im = Images.knownImage(c);
      if (im && im.path) out.set(im.path, num(Number(im.size), 0));
    });
    return out;
  }
  function pinned(path) {
    const now = Date.now();
    if (!pinSet || now - pinAt > 5000) { pinSet = safe(() => new Set(wanted().keys()), new Set()); pinAt = now; }
    return pinSet.has(path);
  }
  async function cacheOpen() { try { return cacheOk() ? await caches.open(IMG_CACHE) : null; } catch (e) { return null; } }
  // Chemins présents dans le cache d'images de l'appareil.
  async function haveSet() {
    const out = new Set(), c = await cacheOpen();
    if (!c) return out;
    try { const pre = Images.cacheKey(""); (await c.keys()).forEach(r => { if (r.url.startsWith(pre)) out.add(r.url.slice(pre.length)); }); } catch (e) {}
    return out;
  }
  // Images des sens (dictionnaire commun) des listes gardées : demandées au serveur avant de compter ce qui manque.
  async function prepare() {
    if (!imgOk() || !online() || !prefs().img) return false;
    const ids = new Set(keptLists().map(l => l.id)), senses = new Set();
    state.cards.forEach(c => { if (ids.has(c.listId) && c.senseId && !(c.image && c.image.path)) senses.add(c.senseId); });
    if (!senses.size) return true;
    return await Images.sensesNow([...senses]);
  }

  // --- État par liste (écran Stockage) ---
  // → { rows: [{ id, name, shared, owner, cards, imgs, have, kept }], todo: { img, bytes, dict } }
  async function status() {
    const p = prefs(), have = await haveSet();
    const per = new Map();
    state.cards.forEach(c => {
      let x = per.get(c.listId);
      if (!x) per.set(c.listId, x = { cards: 0, paths: new Map() });
      x.cards++;
      const im = safe(() => Images.knownImage(c), null);
      if (im && im.path) x.paths.set(im.path, num(Number(im.size), 0));
    });
    const rows = state.lists.map(l => {
      const x = per.get(l.id) || { cards: 0, paths: new Map() };
      let h = 0;
      x.paths.forEach((sz, path) => { if (have.has(path)) h++; });
      return { id: l.id, name: safe(() => listLabel(l), l.name) || l.name, shared: safe(() => isSharedList(l), false),
        owner: (l.shared && l.shared.role !== "owner" && l.shared.ownerName) || "", cards: x.cards, imgs: x.paths.size, have: h, kept: !!p.lists[l.id] };
    });
    let img = 0, bytes = 0;
    wanted().forEach((sz, path) => { if (!have.has(path)) { img++; bytes += sz || HL_IMG_AVG; } });
    return { rows, todo: { img, bytes, dict: p.dict && dictNeeded() } };
  }

  // --- Réseau : mobile ou Wi-Fi quand le téléphone le dit (sinon inconnu) ---
  function net() {
    const c = safe(() => navigator.connection || navigator.mozConnection || navigator.webkitConnection, null);
    if (!c) return { cell: null, save: false };
    return { cell: c.type ? c.type === "cellular" : null, save: c.saveData === true };
  }
  // Le Wi-Fi est-il à conseiller pour ce volume ?
  function heavy(bytes, withDict) {
    const n = net();
    if (bytes >= HL_BIG || (withDict && bytes >= HL_BIG / 2)) return true;
    return (n.cell === true || n.save) && (bytes >= HL_CELL_BIG || !!withDict);
  }

  // --- Téléchargement (images puis dictionnaire), avec reprise ---
  function dead(j) { return j.stop || job !== j || Storage.getUser() !== j.who; }
  function jobInfo() { return job ? { phase: job.phase, done: job.done, total: job.total, fail: job.fail, auto: job.auto } : null; }
  async function run(opts) {
    if (job) return false;
    const who = Storage.getUser();
    if (!who || !online()) return false;
    const p = prefs();
    const j = job = { who, phase: "prep", done: 0, total: 0, fail: 0, stop: false, cut: false, err: "", auto: !!(opts && opts.auto) };
    p.job = 1; p.miss = 0; lastErr = ""; store();
    try {
      if (keptLists().some(l => safe(() => isSharedList(l), false)) && safe(() => Shared.on(), false)) {
        try { await withTimeout(Shared.sync(), 30000); } catch (e) {}   // cartes des listes communes relues avant leurs images
        if (dead(j)) return false;
      }
      if (p.img && imgOk() && cacheOk()) {
        await prepare();
        if (dead(j)) return false;
        pinSet = null;
        const have = await haveSet();
        const todo = [...wanted().keys()].filter(x => !have.has(x));
        j.phase = "img"; j.total = todo.length; emit();
        let i = 0;
        const worker = async () => {
          while (i < todo.length && !dead(j) && !j.cut) {
            const path = todo[i++];
            let ok = false;
            try { ok = !!(await Images.url(path, true)); } catch (e) {}
            if (ok) j.done++; else { j.fail++; if (!online()) j.cut = true; }
            emit();
          }
        };
        await Promise.all(Array.from({ length: HL_PAR }, worker));
        if (j.total && !j.done && j.fail) j.cut = true;   // rien n'est passé : réseau ou serveur, on réessaiera
      }
      if (!dead(j) && !j.cut && p.dict && dictNeeded()) {
        j.phase = "dict"; j.done = 0; j.total = 0; emit();
        await dictDownload(j);
      }
      return true;
    } catch (e) {
      if (dictDenied(e)) {                          // compte bloqué ou lecture refusée : pas de reprise automatique
        j.err = safe(() => t("hl.dict.denied"), "dict denied");
      } else {
        j.err = String((e && (e.message || e.code)) || e).slice(0, 120); j.cut = true;
      }
      lastErr = j.err;
      return false;
    } finally {
      if (job === j) job = null;
      useCache = null;
      if (Storage.getUser() === who) {
        const pp = prefs();
        pp.job = j.stop ? 2 : j.cut ? 1 : 0;      // pause voulue / coupé (reprise automatique) / terminé
        pp.miss = j.cut ? 0 : j.fail;              // images introuvables (retirées du serveur…)
        store(true);
      }
      emit();
    }
  }
  function pause() { if (job) { job.stop = true; emit(); } }
  // Reprise ou petit complément, sans rien demander : au lancement (après la synchro) et au retour de la connexion.
  async function auto() {
    try {
      if (job || !Storage.getUser() || !online() || !Storage.syncInfo().remote) return;
      const p = prefs();
      if (p.job === 2 || !(keptLists().length || p.dict)) return;
      if (p.job === 1) { run({ auto: true }); return; }
      await prepare();
      const st = await status();
      if (job || !Storage.getUser()) return;
      if (st.todo.img > 0 && st.todo.img <= HL_AUTO_MAX && !st.todo.dict && !heavy(st.todo.bytes, false)) run({ auto: true });
    } catch (e) {}
  }
  // Appelé à chaque affichage de l'indicateur (js/synchro-ui.js) : compte changé → téléchargement de l'ancien compte arrêté,
  // reprise programmée pour le nouveau.
  function tick() {
    const u = Storage.getUser();
    if (u === bootFor) return;
    bootFor = u; pf = null; pinSet = null; dictIdx = null; useCache = null;
    if (job) job.stop = true;
    clearTimeout(bootTimer);
    if (u) bootTimer = setTimeout(auto, HL_BOOT_MS);
  }
  try { window.addEventListener("online", () => { clearTimeout(bootTimer); bootTimer = setTimeout(auto, 3000); }); } catch (e) {}

  // --- Copie du dictionnaire commun (IndexedDB) ---
  function dictMeta() {
    try {
      const o = JSON.parse(localStorage.getItem(CONFIG.LS_USER_PREFIX + "hl:dict") || "null");
      if (o && typeof o === "object") return { at: num(o.at, 0), n: num(o.n, 0), bytes: num(o.bytes, 0), cur: String(o.cur || ""), done: o.done === true, langs: arr(o.langs).map(String), since: String(o.since || ""), upd: o.upd === true };
    } catch (e) {}
    return null;
  }
  function dictMetaSet(m) {
    try { if (m) localStorage.setItem(CONFIG.LS_USER_PREFIX + "hl:dict", JSON.stringify(m)); else localStorage.removeItem(CONFIG.LS_USER_PREFIX + "hl:dict"); } catch (e) {}
  }
  function dictOk() { return safe(() => Dict.usable() && !!window.indexedDB, false); }
  // Langues du profil : langue de l'appli, langues apprises, langues d'aide.
  function myLangs() {
    const s = new Set();
    safe(() => { s.add(state.settings.uiLang); learningOf().forEach(x => { s.add(x.lang); if (x.support) s.add(x.support); }); });
    return [...s].filter(c => safe(() => isLang(c), false)).sort();
  }
  function dictNeeded() {
    const m = dictMeta();
    return !m || !m.done || m.upd || myLangs().some(L => !m.langs.includes(L));
  }
  // Lecture refusée : erreur 42501 / 401 / 403, ou aucune ligne lisible (règle « compte non bloqué » de dict_senses).
  function dictDenied(e) {
    if (!e) return false;
    if (e.hlDenied) return true;
    const c = String(e.code || ""), st = Number(e.status || 0);
    return c === "42501" || st === 401 || st === 403 || /permission denied/i.test(String(e.message || ""));
  }
  function deniedErr() { const e = new Error("dict denied"); e.hlDenied = true; return e; }
  // Une page de dict_senses (colonnes NOMMÉES : la table entière n'est pas lisible). after = dernier id lu ; since = filtre.
  async function sensePage(c, after, since) {
    let q = c.from("dict_senses").select("id,version,merged_into,updated_at");
    if (since) q = q.gt("updated_at", since);
    if (after) q = q.gt("id", after);
    const r = await withTimeout(q.order("id").limit(HL_PAGE), 30000);
    if (r && r.error) throw r.error;
    return arr(r && r.data);
  }
  function maxIso(a, b) { return !a ? String(b || "") : !b ? a : (Date.parse(b) > Date.parse(a) ? String(b) : a); }
  function idb() {
    return new Promise((res, rej) => {
      let rq;
      try { rq = indexedDB.open(HL_DB, 1); } catch (e) { rej(e); return; }
      rq.onupgradeneeded = () => { const db = rq.result; if (!db.objectStoreNames.contains("dict")) db.createObjectStore("dict", { keyPath: "id" }); };
      rq.onsuccess = () => res(rq.result);
      rq.onerror = () => rej(rq.error || new Error("idb"));
      rq.onblocked = () => rej(new Error("idb blocked"));
    });
  }
  async function idbDo(mode, fn) {
    const db = await idb();
    try {
      return await new Promise((res, rej) => {
        const tx = db.transaction("dict", mode);
        let rq;
        try { rq = fn(tx.objectStore("dict")); } catch (e) { rej(e); return; }
        tx.oncomplete = () => res(rq && "result" in rq ? rq.result : undefined);
        tx.onerror = tx.onabort = () => rej(tx.error || new Error("idb"));
      });
    } finally { try { db.close(); } catch (e) {} }
  }
  function dictVal(r) {
    const o = {};
    if (r.word) o.w = r.word;
    if (r.pos) o.p = r.pos;
    if (r.ex) o.e = r.ex;
    if (r.ex_tr && typeof r.ex_tr === "object" && Object.keys(r.ex_tr).length) o.t = r.ex_tr;
    return o;
  }
  async function dictDownload(j) {
    const c = Supa.client();
    if (!c || !dictOk()) throw new Error("dict unavailable");
    let m = dictMeta();
    const langs = [...new Set((m ? m.langs : []).concat(myLangs()))].sort();
    // Copie complète et mêmes langues : mise à jour (seulement ce qui a changé depuis m.since).
    if (m && m.done && m.since && m.langs.join() === langs.join()) return dictUpdate(j, c, m, langs);
    if (!m || m.done || m.langs.join() !== langs.join()) {       // nouvelle copie (sinon : reprise après m.cur)
      await idbDo("readwrite", st => st.clear());
      m = { at: 0, n: 0, bytes: 0, cur: "", done: false, langs, since: "", upd: false };
      dictMetaSet(m); dictIdx = null;
    }
    // 1) Les sens : version, et ceux qui ont été fusionnés dans un autre (laissés de côté).
    const ver = new Map();
    let since = "", seen = 0;
    for (let cur = ""; ;) {
      const rows = await sensePage(c, cur, "");
      seen += rows.length;
      rows.forEach(x => { if (!x || !x.id) return; since = maxIso(since, x.updated_at); if (!x.merged_into) ver.set(x.id, num(Number(x.version), 0)); });
      if (dead(j)) return;
      if (!rows.length || ver.size >= HL_DICT_MAX) break;       // fin = page vide (ne dépend pas de la taille de page du serveur)
      cur = rows[rows.length - 1].id;
    }
    if (!seen) throw deniedErr();                                 // aucun sens lisible : compte bloqué (règle RLS)
    const order = [...ver.keys()].sort();
    const rank = id => { let a = 0, b = order.length; while (a < b) { const k = (a + b) >> 1; if (order[k] <= id) a = k + 1; else b = k; } return a; };
    j.total = order.length; j.done = m.cur ? rank(m.cur) : 0; emit();
    // 2) Les valeurs, dans l'ordre des sens (reprise : après le dernier sens enregistré).
    for (;;) {
      let q = c.from("dict_values").select("sense_id,lang,word,pos,ex,ex_tr").in("lang", langs);
      if (m.cur) q = q.gt("sense_id", m.cur);
      const r = await withTimeout(q.order("sense_id").order("lang").limit(HL_PAGE), 30000);
      if (r && r.error) throw r.error;
      const rows = arr(r && r.data);
      if (!rows.length) break;                                    // fin = page vide
      const groups = new Map();
      rows.forEach(x => { if (!x || !x.sense_id) return; let g = groups.get(x.sense_id); if (!g) groups.set(x.sense_id, g = {}); g[x.lang] = dictVal(x); });
      const ids = [...groups.keys()];
      if (!ids.length) break;
      if (ids.length > 1) ids.pop();                              // dernier sens de la page peut-être coupé : relu à la page suivante
      const recs = ids.filter(id => ver.has(id)).map(id => ({ id, v: ver.get(id), vals: groups.get(id) }))
        .filter(s => Object.keys(s.vals).some(L => s.vals[L].w));
      if (recs.length) await idbDo("readwrite", st => { let last; recs.forEach(x => { last = st.put(x); }); return last; });
      m.n += recs.length; m.bytes += recs.reduce((a, x) => a + JSON.stringify(x).length * 2, 0); m.cur = ids[ids.length - 1];
      dictMetaSet(m); dictIdx = null;                             // noté tout de suite : une reprise repart après ce sens
      j.done = rank(m.cur); emit();
      if (dead(j)) return;
    }
    m.done = true; m.at = Date.now(); m.since = since; m.upd = false;
    dictMetaSet(m); dictIdx = null;
  }
  // Mise à jour d'une copie complète : seulement les sens dont updated_at > m.since − 2 min (heure du serveur).
  // Sens fusionné ou sans mot dans les langues : retiré de la copie.
  // m.since n'avance qu'à la toute fin : une page qui échoue → tout ce qui a changé sera relu la fois suivante.
  async function dictUpdate(j, c, m, langs) {
    m.upd = true; dictMetaSet(m); emit();
    const chg = [];
    let since = m.since;
    // Marge de 2 min avant le dernier updated_at vu : une écriture en cours au moment de la copie n'est pas perdue
    // (les sens relus deux fois ne font rien de mal).
    const from = new Date(Date.parse(m.since) - HL_DICT_MARGIN).toISOString();
    for (let cur = ""; ;) {                                       // 1) les sens changés
      const rows = await sensePage(c, cur, from);
      rows.forEach(x => { if (x && x.id) { chg.push(x); since = maxIso(since, x.updated_at); } });
      if (dead(j)) return;
      if (!rows.length) break;
      cur = rows[rows.length - 1].id;
    }
    if (!chg.length) {                                            // rien de changé : le dictionnaire est-il encore lisible ?
      const r = await withTimeout(c.from("dict_senses").select("id").limit(1), 30000);
      if (r && r.error) throw r.error;
      if (!arr(r && r.data).length) throw deniedErr();            // compte bloqué depuis : copie gardée, message court
    }
    j.total = chg.length; j.done = 0; emit();
    // Valeurs relues seulement pour les sens absents de la copie ou dont la version a changé (un sens relu à cause de la
    // marge, déjà à jour, ne coûte que sa ligne de dict_senses).
    const mine = new Map(arr(await idbDo("readonly", st => st.getAll())).map(x => [x.id, x.v]));
    const live = chg.filter(x => !x.merged_into && mine.get(x.id) !== num(Number(x.version), 0));
    const gone = chg.filter(x => x.merged_into && mine.has(x.id)).map(x => x.id);
    const vals = new Map();
    for (let i = 0; i < live.length; i += 100) {                  // 2) leurs valeurs, 100 sens par lecture, paginées
      const ids = live.slice(i, i + 100).map(x => x.id);
      for (let off = 0; ; off += HL_PAGE) {
        const q = c.from("dict_values").select("sense_id,lang,word,pos,ex,ex_tr").in("lang", langs).in("sense_id", ids);
        const r = await withTimeout(q.order("sense_id").order("lang").range(off, off + HL_PAGE - 1), 30000);
        if (r && r.error) throw r.error;
        const rows = arr(r && r.data);
        rows.forEach(x => { if (!x || !x.sense_id) return; let g = vals.get(x.sense_id); if (!g) vals.set(x.sense_id, g = {}); g[x.lang] = dictVal(x); });
        if (rows.length < HL_PAGE) break;
      }
      j.done = Math.min(live.length, i + 100); emit();
      if (dead(j)) return;
    }
    const recs = live.map(x => ({ id: x.id, v: num(Number(x.version), 0), vals: vals.get(x.id) || {} }));
    const keep = recs.filter(s => Object.keys(s.vals).some(L => s.vals[L].w));
    const drop = gone.concat(recs.filter(s => !keep.includes(s)).map(s => s.id));
    if (keep.length || drop.length) {
      await idbDo("readwrite", st => { let last; keep.forEach(x => { last = st.put(x); }); drop.forEach(id => { last = st.delete(id); }); return last; });
    }
    const all = arr(await idbDo("readonly", st => st.getAll()));     // compte et taille recalculés (quelques milliers de sens)
    m.n = all.length; m.bytes = all.reduce((a, x) => a + JSON.stringify(x).length * 2, 0);
    m.since = since; m.at = Date.now(); m.upd = false;
    dictMetaSet(m); dictIdx = null;
  }
  // Bouton « Mettre à jour » du dictionnaire : la prochaine fois, relire ce qui a changé (pas tout le dictionnaire).
  // Une copie d'avant ce correctif (sans « since ») est retéléchargée en entier.
  function dictStale() { const m = dictMeta(); if (m) { m.upd = true; if (!m.since) { m.done = false; m.cur = ""; m.langs = []; } dictMetaSet(m); } emit(); }
  async function dictIndex() {
    if (dictIdx) return dictIdx;
    const recs = arr(await idbDo("readonly", st => st.getAll()));
    const by = new Map();                                         // langue → Map(forme normalisée → [sens])
    recs.forEach(s => Object.keys(s.vals || {}).forEach(L => {
      const w = s.vals[L] && s.vals[L].w;
      if (!w) return;
      let mp = by.get(L);
      if (!mp) by.set(L, mp = new Map());
      dictNorms(w).forEach(n => { const a = mp.get(n); if (a) a.push(s); else mp.set(n, [s]); });
    }));
    dictIdx = by;
    return by;
  }
  // Même réponse que dict_search pour un mot : tableau de sens { id, v, vals } (6 au plus, les plus remplis d'abord),
  // [] si le mot est inconnu, null s'il n'y a pas de copie sur l'appareil.
  async function dictSearch(L, w) {
    const m = dictMeta();
    if (!m || !m.n || !window.indexedDB) return null;
    let by;
    try { by = await dictIndex(); } catch (e) { return null; }
    const mp = by.get(L);
    if (!mp) return m.langs.includes(L) ? [] : null;
    const seen = new Set(), out = [];
    dictNorms(w).forEach(n => (mp.get(n) || []).forEach(s => { if (!seen.has(s.id)) { seen.add(s.id); out.push(s); } }));
    const cnt = s => Object.keys(s.vals).filter(k => s.vals[k] && s.vals[k].w).length;
    return out.sort((a, b) => cnt(b) - cnt(a) || b.v - a.v).slice(0, 6);
  }

  // --- Espace utilisé ---
  // → { texts, img: { bytes, n }, dict: { bytes, n }, total, quota } (octets ; total et quota : null si le navigateur ne le dit pas)
  async function usage(fresh) {
    if (!fresh && useCache && Date.now() - useAt < 30000) return useCache;
    const u = { texts: 0, img: { bytes: 0, n: 0 }, dict: { bytes: 0, n: 0 }, total: null, quota: null };
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(CONFIG.LS_USER_PREFIX)) u.texts += (k.length + (localStorage.getItem(k) || "").length) * 2;
      }
    } catch (e) {}
    const c = await cacheOpen();
    if (c) {
      try {
        const keys = await c.keys();
        u.img.n = keys.length;
        for (let i = 0; i < keys.length; i += 8) {
          const part = await Promise.all(keys.slice(i, i + 8).map(k => c.match(k).then(r => (r ? r.blob() : null)).then(b => (b ? b.size : 0)).catch(() => 0)));
          part.forEach(n => { u.img.bytes += n; });
        }
      } catch (e) {}
    }
    const m = dictMeta();
    if (m) { u.dict.bytes = m.bytes; u.dict.n = m.n; }
    try {
      if (navigator.storage && navigator.storage.estimate) {
        const e = await navigator.storage.estimate();
        if (e && isFinite(e.usage)) u.total = Math.max(e.usage, u.img.bytes + u.dict.bytes);
        if (e && isFinite(e.quota) && e.quota > 0) u.quota = e.quota;
      }
    } catch (e) {}
    useCache = u; useAt = Date.now();
    return u;
  }

  // --- « Libérer de la place » : retire ce qui est téléchargé (images, dictionnaire), JAMAIS les cartes ---
  // Les listes ne sont plus gardées hors ligne (sinon tout serait retéléchargé). Renvoie le nombre d'octets libérés.
  async function freeUp() {
    if (job) job.stop = true;
    const before = await usage(true);
    const c = await cacheOpen();
    if (c) {
      try {
        const pre = Images.cacheKey(""), keys = await c.keys();
        const paths = keys.filter(r => r.url.startsWith(pre)).map(r => r.url.slice(pre.length));
        await Images.cacheDel(paths);
        for (const r of keys) { if (!r.url.startsWith(pre)) { try { await c.delete(r); } catch (e) {} } }
      } catch (e) {}
    }
    try { if (window.indexedDB) await idbDo("readwrite", st => st.clear()); } catch (e) {}
    dictMetaSet(null); dictIdx = null;
    const p = prefs();
    p.lists = {}; p.dict = false; p.job = 0; p.miss = 0;
    useCache = null;
    store();
    return before.img.bytes + before.dict.bytes;
  }

  // --- Sons : voix de l'appareil, par langue du profil ---
  // → [{ lang, has (une voix existe), local (elle marche sans Internet) }]
  function voices() {
    let list = [];
    try { list = (window.speechSynthesis && window.speechSynthesis.getVoices()) || []; } catch (e) {}
    const norm = v => String(v.lang || "").toLowerCase().replace("_", "-");
    return myLangs().map(L => {
      const full = String((LANGUAGES[L] && LANGUAGES[L].tts) || "").toLowerCase(), base = full.slice(0, 2);
      const v = list.find(x => norm(x) === full) || list.find(x => base && norm(x).startsWith(base)) || null;
      return { lang: L, has: !!v, local: !!(v && v.localService === true) };
    });
  }

  return {
    on, prefs, setImg, setDict, setLists, keptLists, keptCount, status, prepare, run, pause, auto, tick, job: jobInfo, lastError: () => lastErr,
    pinned, heavy, net, usage, freeUp, voices, imgOk, cacheOk, dictOk, dictMeta, dictNeeded, dictStale, dictSearch
  };
})();
