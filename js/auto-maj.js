"use strict";

// ====================================================================================================
// js/auto-maj.js — MISE À JOUR AUTOMATIQUE PAR CLAUDE (ÉTAPE 80)
// Chargé juste après js/claude-passage.js. Au chargement : seulement deux écouteurs (online, visibilitychange).
// ====================================================================================================

// === MISE À JOUR AUTOMATIQUE PAR CLAUDE (ÉTAPE 80) ===
// Dès qu'il manque des cases (traductions, nature, genre, exemple) sur des cartes de vocabulaire, l'appli dépose TOUTE SEULE
// une demande « compléter » dans la file d'attente Claude (mode Supabase seulement) : après un ajout, un import, une
// génération, et au lancement s'il reste des trous. Jamais une demande par carte : les cartes sont regroupées
// (AMJ_WAIT_MS après le dernier ajout) ; une demande automatique encore en attente (pas encore prise par Claude) est
// retirée et redéposée avec les nouvelles cartes. Le bouton manuel « Mettre à jour » reste (secours).
// La tâche programmée ne change pas et ne touche jamais user_data : c'est une demande « complete » ordinaire, avec
// payload.auto = 1 ; sa réponse est appliquée par l'appli avec la règle de l'étape 73 (ClAuto.apply : Claude n'écrase que
// ce que Claude a rempli, jamais une case de l'utilisateur), en silence (pas de message, pas de notification push).
// Réglage de l'admin (Administration → Demandes à Claude → « Mise à jour automatique », js/screens/admin-auto.js) :
//   clé « claude_auto » d'app_settings = { on, max } ; lecture par tout compte connecté (claude_auto_get), écriture par
//   l'admin seulement, contrôlée par le SERVEUR (admin_claude_auto_set) : claude/supabase-etape80.sql.
//   Script absent : rien d'automatique (comme si l'interrupteur était coupé). Valeur gardée sur l'appareil (LS_CFG).
// Limite : max = nombre maximum de cartes par jour et par compte. Compte du jour = somme de card_count des demandes du
//   compte créées depuis minuit (heure de l'appareil), types AMJ_KINDS, lues dans claude_requests (ses propres demandes).
//   Au-delà : les cartes attendent le lendemain, sans erreur ni message.
// Pas de boucle : une carte que Claude n'a pas complétée n'est pas redemandée plus de AMJ_TRIES fois pour les mêmes cases ;
//   ensuite elle garde le badge « à compléter » (l'utilisateur peut relancer à la main). Compteur sur l'APPAREIL seulement.
// Badge : une carte prise en charge (demande en cours, ou à déposer) ne compte pas dans « N à compléter » (handled).
// Hors connexion : rien n'est déposé ; la demande part à la reconnexion (drapeau w).
// Deux appareils du même compte : tant qu'une demande automatique d'un AUTRE appareil est en cours (libellé AMJ_MARK), celui-ci
// n'en dépose pas (pas de doublon). La réponse est récupérée par le premier appareil qui passe ; l'autre relit d'abord les
// données en ligne (syncWithRemote : version en ligne ou fusion de l'étape 78) avant de redemander quoi que ce soit.
// Sur l'appareil, jamais dans les données du compte : vocabfr.amj:<compte> = {
//   t: { idCarte: [essais, empreinte des cases manquantes] },
//   r: { idDemande: { at, ids: [cartes] } }   demandes automatiques en cours,
//   w: 1 = des cartes attendent (hors connexion, limite du jour), lim: jour où la limite a été atteinte,
//   fo: 1 = une demande d'un autre appareil était en cours, pl: 1 = un autre appareil a récupéré une de mes réponses
//   (dans les deux cas : données en ligne à relire avant le prochain dépôt),
//   rf: [demandes dont la réponse a déjà été redemandée une fois par cet appareil] }.
// Réponse arrivée sur un appareil qui n'a pas encore les cartes (créées sur un autre appareil du compte) : au lieu d'être
// perdue, elle est relue une fois après une relecture des données en ligne (lost → claude_refetch_request).
const AMJ_DEF = { on: true, max: 200 };   // clé absente d'app_settings : valeurs par défaut (mêmes que dans le SQL)
const AMJ_MAX_MIN = 10, AMJ_MAX_MAX = 5000;
const AMJ_TRIES = 2;                      // essais par carte pour les mêmes cases manquantes
const AMJ_WAIT_MS = 20000;                // regroupement : 20 s après le dernier ajout
const AMJ_BOOT_MS = 8000;                 // au lancement
const AMJ_SOON_MS = 2500;                 // après une génération, une réponse de Claude, la reconnexion
const AMJ_BUSY_MS = 60000;                // session de révision ou traitement en cours : nouvel essai une minute plus tard
const AMJ_PEER_MS = 15000;                // un autre appareil du compte vient de finir : le temps qu'il envoie ses données
const AMJ_FLY_MS = 48 * 3600000;          // une demande sans réponse depuis 48 h ne retient plus ses cartes
const AMJ_KINDS = ["complete", "verify", "generate"];   // demandes comptées dans le total du jour (card_count = cartes)
const AMJ_MARK = "🤖";                    // début du libellé d'une demande automatique (« Demandes en cours », suivi admin)

const AutoMaj = (() => {
  const LS_CFG = CONFIG.LS_USER_PREFIX + "claudeauto";
  const T = 15000;
  let cfg = null, cfgBusy = null, missing = false;      // réglage de l'admin (null = pas encore su)
  let who = null, st = null, fly = null;                // état de l'appareil pour le compte ouvert
  let timer = null, dayTimer = null, runP = null, again = false, last = "";

  function cfgNorm(r) {
    if (!r || typeof r !== "object" || typeof r.on !== "boolean") return null;
    const m = Number(r.max);
    return { on: r.on, max: Number.isInteger(m) ? Math.min(AMJ_MAX_MAX, Math.max(AMJ_MAX_MIN, m)) : AMJ_DEF.max };
  }
  try { cfg = cfgNorm(JSON.parse(localStorage.getItem(LS_CFG) || "null")); } catch (e) { cfg = null; }
  function isMissing(e) {
    const code = String((e && e.code) || ""), msg = String((e && (e.message || e.msg)) || "");
    return ["PGRST202", "42883"].includes(code) || /could not find|does not exist|schema cache/i.test(msg);
  }
  function usable() { return typeof Queue !== "undefined" && Queue.usable(); }
  function active() { return usable() && !missing && !!cfg && cfg.on; }
  function setCfg(r) {
    const n = cfgNorm(r);
    if (!n) return;
    const same = cfg && cfg.on === n.on && cfg.max === n.max;
    cfg = n;
    if (same) return;
    try { localStorage.setItem(LS_CFG, JSON.stringify(n)); } catch (e) {}
    paint();
  }
  // Réglage relu sur le serveur (jamais bloquant ; erreur ou hors connexion : dernière valeur connue).
  function fetchCfg() {
    if (!usable()) return Promise.resolve(cfg);
    if (cfgBusy) return cfgBusy;
    cfgBusy = (async () => {
      try {
        const r = await withTimeout(Supa.client().rpc("claude_auto_get"), T);
        if (r && r.error) { if (isMissing(r.error)) { const was = missing; missing = true; if (!was) paint(); } }
        else if (r) { const was = missing; missing = false; setCfg(r.data); if (was) paint(); }
      } catch (e) { /* hors connexion : dernière valeur connue */ }
      finally { cfgBusy = null; }
      return cfg;
    })();
    return cfgBusy;
  }

  // --- État de l'appareil ---
  function key() { return CONFIG.LS_USER_PREFIX + "amj:" + (Storage.getUser() || ""); }
  function load() {
    const u = Storage.getUser() || "";
    if (st && who === u) return st;
    who = u; fly = null;
    st = { t: {}, r: {}, w: 0, lim: "", fo: 0, pl: 0, rf: [] };
    try {
      const o = JSON.parse(localStorage.getItem(key()) || "null");
      if (o && typeof o === "object") {
        if (o.t && typeof o.t === "object" && !Array.isArray(o.t)) st.t = o.t;
        if (o.r && typeof o.r === "object" && !Array.isArray(o.r)) st.r = o.r;
        st.w = o.w ? 1 : 0; st.lim = typeof o.lim === "string" ? o.lim : "";
        st.fo = o.fo ? 1 : 0; st.pl = o.pl ? 1 : 0;
        st.rf = arr(o.rf).map(String).slice(-30);
      }
    } catch (e) {}
    return st;
  }
  function save() { try { if (st && who) localStorage.setItem(key(), JSON.stringify(st)); } catch (e) {} }
  function setWant(v, limited) {
    const s = load(), w = v ? 1 : 0, lim = v && limited ? todayStr() : "";
    if (s.w === w && s.lim === lim) return;
    s.w = w; s.lim = lim; save();
  }
  function flying() {
    if (!fly) { fly = new Set(); const r = load().r; Object.keys(r).forEach(id => arr(r[id] && r[id].ids).forEach(c => fly.add(c))); }
    return fly;
  }

  // --- Cartes ---
  // Cases manquantes d'une carte (vocabulaire, liste modifiable) : mêmes cases que « Mettre à jour » (gapFields).
  function gapsOf(c) { return c && isVocab(c) && canEditList(c.listId) ? gapFields(c) : []; }
  function sigOf(g) { return strHash(g.slice().sort().join("|")); }
  function triesOf(c, g) { const x = load().t[c.id]; return Array.isArray(x) && x[1] === sigOf(g) ? num(Number(x[0]), 0) : 0; }
  // Carte prise en charge par l'automatisme : pas de badge « à compléter ». g : cases manquantes déjà calculées.
  function handled(c, g) {
    if (!active() || !c || !isVocab(c)) return false;
    g = g || gapsOf(c);
    if (!g.length) return false;
    return flying().has(c.id) || triesOf(c, g) < AMJ_TRIES;
  }
  function eligible() {
    const f = flying(), out = [];
    state.cards.forEach(c => {
      if (!isVocab(c) || f.has(c.id)) return;
      const g = gapsOf(c);
      if (g.length && triesOf(c, g) < AMJ_TRIES) out.push(c);
    });
    return out;
  }
  // Demandes finies (réponse reçue, erreur, annulée, trop vieille) : leurs cartes sont libérées ; compteurs des cartes
  // supprimées ou devenues complètes : retirés.
  function settle() {
    const s = load(), now = Date.now();
    let ch = false;
    if (Queue.loaded() && !Queue.lastError()) {
      const items = Queue.items();
      Object.keys(s.r).forEach(id => {
        const it = items.find(x => x.id === id), x = s.r[id] || {};
        if (!it || it.status === "error" || (it.status === "done" && it.fetched_at) || now - num(Number(x.at), 0) > AMJ_FLY_MS) {
          if (it && it.status === "done" && it.fetched_at && arr(x.ids).length) s.pl = 1;   // réponse récupérée par un autre appareil du compte
          delete s.r[id]; ch = true;
        }
      });
    }
    const byId = new Map(state.cards.map(c => [c.id, c]));
    Object.keys(s.t).forEach(id => { const c = byId.get(id); if (!c || !gapsOf(c).length) { delete s.t[id]; ch = true; } });
    if (ch) { fly = null; save(); }
  }
  // Réponse de Claude reçue pour un lot d'une demande automatique (js/queue.js, queueApply) : ses cartes sont libérées.
  function answered(reqId, ids) {
    const s = load(), x = s.r[reqId];
    if (!x) return;
    const done = new Set(arr(ids));
    x.ids = arr(x.ids).filter(id => !done.has(id));
    if (!x.ids.length) delete s.r[reqId];
    fly = null; save();
  }
  // Une demande automatique encore « en attente » (pas prise par Claude) : retirée, ses cartes repartent avec les nouvelles
  // (une seule demande regroupée). Prise entre-temps : gardée telle quelle.
  async function takeBack() {
    const s = load();
    const pend = Object.keys(s.r).filter(id => { const it = Queue.items().find(x => x.id === id); return it && it.status === "pending"; });
    if (!pend.length) return;
    try {
      const r = await withTimeout(Supa.client().from("claude_requests").delete().eq("user_id", auth.sbUid).eq("status", "pending").in("id", pend), T);
      if (r && r.error) throw r.error;
    } catch (e) { return; }
    await Queue.refresh();
    if (Queue.lastError()) return;
    pend.forEach(id => {
      if (!s.r[id] || Queue.items().some(x => x.id === id)) return;
      arr(s.r[id].ids).forEach(cid => {                     // essai jamais fait : pas compté
        const x = s.t[cid];
        if (Array.isArray(x)) { x[0] = Math.max(0, num(Number(x[0]), 1) - 1); if (!x[0]) delete s.t[cid]; }
      });
      delete s.r[id];
    });
    fly = null; save();
  }
  // Demande automatique en cours déposée par un AUTRE appareil du compte : on attend sa réponse.
  function foreignOpen() {
    const s = load();
    return Queue.items().some(it => it.kind === "complete" && String(it.label || "").startsWith(AMJ_MARK) && !s.r[it.id]
      && (it.status === "pending" || it.status === "processing"));
  }
  // Un autre appareil du compte a travaillé (demande à lui, ou réponse à moi récupérée par lui) : données en ligne relues
  // d'abord, par le chemin habituel (version en ligne si rien n'est à envoyer, sinon fusion de l'étape 78).
  async function pull() {
    try { if (typeof syncWithRemote === "function") await syncWithRemote(Storage.getUser(), {}, false); } catch (e) {}
  }
  // Réponses d'une demande automatique reçues ici pour des cartes que cet appareil n'a pas (encore) : données en ligne relues,
  // puis la réponse est redemandée UNE fois (claude_refetch_request) et appliquée par le passage suivant de la file.
  function lost(reqIds) {
    const s = load(), todo = arr(reqIds).map(String).filter(id => id && !s.rf.includes(id));
    if (!todo.length || !usable()) return;
    s.rf = s.rf.concat(todo).slice(-30); save();
    const u = Storage.getUser();
    setTimeout(async () => {
      try {
        for (let i = 0; i < 40 && Queue.busy(); i++) await new Promise(r => setTimeout(r, 250));
        if (Storage.getUser() !== u || !usable()) return;
        await pull();
        if (Storage.getUser() !== u || !usable()) return;
        for (const id of todo) { const r = await withTimeout(Supa.client().rpc("claude_refetch_request", { p_request: id }), T); if (r && r.error) return; }
        Queue.sync();
      } catch (e) {}
    }, AMJ_SOON_MS);
  }
  // Après chaque passage de la file (js/queue.js, Queue.sync) : un autre appareil a fini → passage rapproché.
  function tick() {
    try {
      if (!usable() || runP || timer) return;
      const s = load(), items = Queue.items();
      const mine = Object.keys(s.r).some(id => { const it = items.find(x => x.id === id); return it && it.status === "done" && it.fetched_at && arr(s.r[id] && s.r[id].ids).length; });
      if (mine || (s.fo && !foreignOpen())) kick("sync", AMJ_PEER_MS);
    } catch (e) {}
  }
  // Cartes demandées aujourd'hui par ce compte (toutes ses demandes de cartes, automatiques ou non).
  async function dayCount() {
    const d0 = new Date(); d0.setHours(0, 0, 0, 0);
    const r = await withTimeout(Supa.client().from("claude_requests").select("card_count,kind").eq("user_id", auth.sbUid).gte("created_at", d0.toISOString()), T);
    if (r && r.error) throw r.error;
    return arr(r && r.data).reduce((n, x) => n + (AMJ_KINDS.includes(x.kind) ? Math.max(0, num(Number(x.card_count), 0)) : 0), 0);
  }
  function sessionBusy() {
    try {
      if (typeof rv !== "undefined" && rv && rv.phase === "run" && currentScreen === "review") return true;
      if (typeof pvJob !== "undefined" && pvJob) return true;
      if (typeof aiJob !== "undefined" && aiJob) return true;
      if (typeof Guard !== "undefined" && Guard.waiting && Guard.waiting()) return true;
    } catch (e) {}
    return false;
  }
  function tomorrow() {
    clearTimeout(dayTimer);
    const d = new Date(); d.setHours(24, 1, 0, 0);
    dayTimer = setTimeout(() => { dayTimer = null; kick("day", AMJ_SOON_MS); }, Math.min(d.getTime() - Date.now(), 2147000000));
  }
  function paint() {
    try { if (typeof currentScreen !== "undefined" && currentScreen === "lists" && Storage.getUser() && !document.querySelector(".modal-bg")) renderLists(); } catch (e) {}
  }

  // --- Dépôt ---
  // Renvoie : "off" | "offline" | "busy" | "other" | "none" | "limit" | "net" | "error" | "sent".
  async function runOnce() {
    if (!usable()) return "off";
    const u = Storage.getUser();
    let stt = state;
    const gone = () => Storage.getUser() !== u || !usable();
    const moved = () => { kick("again", AMJ_SOON_MS); return "busy"; };   // données remplacées pendant l'attente (version en ligne, fusion) : on recommence
    const s0 = load();
    if (navigator.onLine === false) { setWant(1); return "offline"; }
    if (sessionBusy()) { kick("busy", AMJ_BUSY_MS); return "busy"; }
    await fetchCfg();
    if (gone()) return "off";
    if (!active()) return "off";
    await Queue.sync();                                     // réponses déjà arrivées d'abord : rien à redemander pour elles
    if (gone()) return "off";
    if (Queue.lastError() === "net") { setWant(1); return "net"; }
    settle();
    if (foreignOpen()) { if (!s0.fo) { s0.fo = 1; save(); } return "other"; }   // un autre appareil s'en occupe : repris quand sa demande est finie (tick) ou au lancement
    if (s0.fo || s0.pl) {                                   // un autre appareil du compte a travaillé : ses données d'abord
      s0.fo = 0; s0.pl = 0; save();
      await pull();
      if (gone()) return "off";
      stt = state;
      settle();
    }
    let cards = eligible();
    if (!cards.length) { setWant(0); return "none"; }
    try { await Dict.fillFromCommon(cards); } catch (e) {}  // dictionnaire commun d'abord (étape 36), comme « Mettre à jour »
    if (gone()) return "off"; if (state !== stt) return moved();
    if (sessionBusy()) { kick("busy", AMJ_BUSY_MS); return "busy"; }
    cards = eligible();
    if (!cards.length) { setWant(0); return "none"; }
    let used;
    try { used = await dayCount(); } catch (e) { setWant(1); return "net"; }
    if (gone()) return "off"; if (state !== stt) return moved();
    if (cfg.max - used <= 0) { setWant(1, true); tomorrow(); return "limit"; }
    // Il reste de la place aujourd'hui : une demande automatique encore en attente est reprise avec les nouvelles cartes.
    if (Object.keys(load().r).some(id => { const it = Queue.items().find(x => x.id === id); return it && it.status === "pending"; })) {
      await takeBack();
      if (gone()) return "off"; if (state !== stt) return moved();
      cards = eligible();
      if (!cards.length) { setWant(0); return "none"; }
      try { used = await dayCount(); } catch (e) { setWant(1); return "net"; }
      if (gone()) return "off"; if (state !== stt) return moved();
    }
    const left = cfg.max - used;
    if (left <= 0) { setWant(1, true); tomorrow(); return "limit"; }
    const part = cards.length > left;
    if (part) cards = cards.slice(0, left);
    const rows = queueCardRows("complete", cards, gapsOf, AMJ_MARK + " " + queueLangsLabel(cards));
    let sent = 0, res = "sent";
    for (const row of rows) {
      row.payload.auto = 1;
      const ids = [].concat(...arr(row.payload.batches).map(b => arr(b.ids)));
      try {
        const r = await withTimeout(Supa.client().from("claude_requests").insert(row).select("id").single(), T);
        if (r && r.error) throw r.error;
        if (gone()) return "off";
        const s = load(), byId = new Map(cards.map(c => [c.id, c]));
        let id = String((r && r.data && r.data.id) || "");
        if (!id) {                                           // identifiant pas renvoyé : la demande est retrouvée dans la liste relue
          await Queue.refresh();
          if (gone()) return "off";
          const it = Queue.items().find(x => x.kind === "complete" && x.status === "pending" && x.label === row.label && num(Number(x.card_count), -1) === row.card_count && !s.r[x.id]);
          id = it ? String(it.id) : "x" + uid();
        }
        s.r[id] = { at: Date.now(), ids };
        ids.forEach(cid => {
          const c = byId.get(cid); if (!c) return;
          const sg = sigOf(gapsOf(c)), x = s.t[cid];
          s.t[cid] = [Array.isArray(x) && x[1] === sg ? num(Number(x[0]), 0) + 1 : 1, sg];
        });
        fly = null; save();
        sent += ids.length;
      } catch (e) {
        // Réseau, trop de demandes en attente, panne : rien n'est affiché, nouvel essai plus tard (au retour, au lancement).
        res = typeof sbErrKind === "function" && sbErrKind(e) === "net" ? "net" : "error";
        if (res === "error") { try { if (typeof ErrLog !== "undefined") ErrLog.sync("mise à jour auto : " + String((e && e.message) || e).slice(0, 80), e); } catch (x) {} }
        break;
      }
    }
    if (sent) {
      Activity.log("claude_request", { type: "complete", cards: sent, requests: rows.length, auto: true });
      Queue.sync();                                         // liste des demandes à jour + surveillance des réponses
    }
    if (res !== "sent") setWant(1);
    else if (part) { setWant(1, true); tomorrow(); }
    else setWant(0);
    return sent && res === "sent" ? "sent" : res;
  }
  function run() {
    if (runP) { again = true; return runP; }
    runP = runOnce().catch(() => "error").then(r => {
      runP = null; last = r;
      if (again) { again = false; kick("again", AMJ_SOON_MS); }
      if (r === "sent" || r === "none" || r === "limit") paint();
      return r;
    });
    return runP;
  }
  // Demande un passage (regroupé) : ms = délai, par défaut AMJ_WAIT_MS après le dernier appel.
  function kick(why, ms) {
    if (!usable()) return;
    clearTimeout(timer);
    timer = setTimeout(() => { timer = null; run(); }, ms != null ? ms : AMJ_WAIT_MS);
  }
  // Cartes qui viennent d'être ajoutées (à la main, import, copie, génération) : true si l'automatisme s'en occupe
  // (l'appelant ne propose alors pas « Compléter les champs vides ? »).
  function takes(ids, ms) {
    if (!active()) return false;
    kick("add", ms);
    return true;
  }
  function start() {
    reset();
    if (!usable()) return;
    load();
    fetchCfg();
    kick("boot", AMJ_BOOT_MS);
  }
  function reset() {
    clearTimeout(timer); clearTimeout(dayTimer);
    timer = dayTimer = null; who = null; st = null; fly = null; again = false; last = "";
  }
  // Retour de la connexion, retour dans l'appli : cartes en attente déposées (limite du jour atteinte : pas avant demain).
  function resume() {
    if (!usable()) return;
    const s = load();
    if (s.w && s.lim !== todayStr()) kick("back", AMJ_SOON_MS);
  }
  window.addEventListener("online", resume);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") resume(); });

  return {
    start, reset, kick, run, takes, handled, answered, tick, lost, active, fetch: fetchCfg, setCfg, dayCount,
    settings: () => cfg, missing: () => missing,
    // État pour l'affichage et les tests : demandes en cours, cartes en cours, cartes en attente, dernier résultat.
    status: () => { const s = load(); return { on: active(), max: cfg ? cfg.max : null, missing, requests: Object.keys(s.r).length, flying: flying().size, tries: Object.keys(s.t).length, waiting: !!s.w, limited: s.lim === todayStr(), last }; },
    triesOf: c => triesOf(c, gapsOf(c))
  };
})();
