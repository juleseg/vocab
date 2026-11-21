"use strict";

// === FILE D'ATTENTE CLAUDE ===
// Mode Supabase seulement (GitHub Pages, sans accès direct à Claude) : l'appli dépose une demande dans la table
// claude_requests ; une tâche programmée Claude (connecteur Supabase) la traite plus tard et écrit ses réponses
// dans claude_proposals. L'appli les récupère (fonction claude_claim_proposals) et les applique avec les mêmes règles que
// l'accès direct (addProposal, addGenProposals). Étape 73 : écrites directement dans les cartes (règle des cases, js/claude-auto.js).
//
// Demande (ligne claude_requests) : { kind: "complete"|"verify"|"generate"|"story"|"sentence", label, card_count, batch_count, payload }
// payload = {
//   v: 1, app: "vocab", kind, uiLang, created: date ISO,
//   answer: format de la réponse attendue pour chaque lot,
//   batches: [{
//     prompt,          // consignes complètes du lot, rédigées par l'appli (mêmes que l'accès direct à Claude)
//     ids,             // complete / verify : ids des cartes ; k0, k1… dans le prompt = ids[0], ids[1]…
//     missing,         // complete : champs demandés par carte (même ordre que ids)
//     sigs             // verify : empreinte des cartes au moment de la demande (cardSig)
//   }],
//   req               // generate : demande figée (genRequest), listId = liste de destination
//   story             // story (étape 45) : demande d'histoire figée (storyRequest : liste, langue, niveau, longueur, mots)
//   auto              // complete (étape 80) : 1 = demande déposée toute seule par l'appli (js/auto-maj.js) ; réponse appliquée en silence
//   cjq               // verify (étape 83) : 1 = correction des consignes de conjugaison floues (js/conjugaison.js) ; réponse → « À valider »
// }
// Réponse d'un lot (ligne claude_proposals, colonne result) : la valeur JSON demandée par le prompt du lot
//   complete : [{ "id": "k0", "<champ>": "valeur", … }]   verify : [{ "id", "field", "value", "reason" }]
//   generate : { "lines": ["ligne au format de l'import", …] }
//   story    : { "title", "title_tr", "sentences": [{ "text", "tr" }], "words": [{ "id", "form" }], "questions": [...] }
//              → rangée dans les histoires de la liste (js/story.js), jamais dans « À valider » ni dans les cartes
const Queue = (() => {
  let status = "unknown";      // unknown | ok | missing (tables pas installées)
  let items = [];              // demandes du compte (50 plus récentes)
  let loaded = false, busy = null, timer = null, lastError = "";
  let v23 = null;              // script de l'étape 23 installé ? (null = pas encore su) — sinon ancien fonctionnement
  const T = 15000;
  const COLS = "id,kind,status,label,card_count,batch_count,error,result_count,created_at,started_at,finished_at,fetched_at";
  const COLS23 = COLS + ",hidden_by_user,content_cleared_at";
  const OPEN = ["pending", "processing"];

  // --- Fréquence de passage de Claude (étape 59) ---
  // Texte d'information seulement : la valeur est réglée par l'admin (claude_cadence_get / admin_claude_cadence_set,
  // supabase-etape59.sql) et ne modifie PAS la tâche programmée. Lue par tout compte connecté, gardée sur l'appareil
  // (hors connexion : dernière valeur connue ; sans valeur : message sans chiffre). { value, unit: "h" | "min" }.
  const LS_CAD = CONFIG.LS_USER_PREFIX + "claudecadence";
  const CAD_GAP_MS = 60000;
  let cad = null, cadAt = 0, cadBusy = null;
  function cadNorm(r) {
    if (!r || typeof r !== "object") return null;
    const u = r.unit === "h" ? "h" : r.unit === "min" ? "min" : null, v = Number(r.value);
    return u && Number.isInteger(v) && v >= 1 && v <= (u === "h" ? 72 : 180) ? { value: v, unit: u } : null;
  }
  try { cad = cadNorm(JSON.parse(localStorage.getItem(LS_CAD) || "null")); } catch (e) { cad = null; }
  function setCadence(r) {
    const n = cadNorm(r);
    if (!n) return;                                              // réponse illisible : on garde la dernière valeur connue
    if (cad && cad.value === n.value && cad.unit === n.unit) return;
    cad = n;
    try { localStorage.setItem(LS_CAD, JSON.stringify(n)); } catch (e) {}
    try {
      if (typeof currentScreen !== "undefined") {
        if (currentScreen === "requests") renderRequests();
        else if (currentScreen === "settings") renderAiCard();
      }
    } catch (e) {}
  }
  function cadFetch(force) {
    if (!usable()) return Promise.resolve();
    if (cadBusy) return cadBusy;
    if (!force && Date.now() - cadAt < CAD_GAP_MS) return Promise.resolve();
    cadBusy = (async () => {
      try {
        const r = await withTimeout(client().rpc("claude_cadence_get"), T);
        if (r && !r.error) { cadAt = Date.now(); setCadence(r.data); }   // erreur, fonction absente, hors connexion : valeur gardée
      } catch (e) { /* hors connexion : dernière valeur connue */ }
      finally { cadBusy = null; }
    })();
    return cadBusy;
  }

  function usable() { return auth.mode === "supabase" && !!auth.sbUid && !!Supa.client() && !!Storage.getUser(); }
  function client() { return Supa.client(); }
  function ok(r) { if (r && r.error) throw r.error; return r ? r.data : null; }
  // "missing" (script SQL de l'étape 18 pas lancé) | "net" | "limit" | "big" | "server"
  function errKind(e) {
    const code = String((e && e.code) || ""), msg = String((e && (e.message || e.msg)) || e || "");
    if (["42P01", "PGRST205", "PGRST202", "42883"].includes(code) || /does not exist|schema cache|could not find/i.test(msg)) return "missing";
    if (/trop de demandes/i.test(msg)) return "limit";
    if (/trop grosse/i.test(msg)) return "big";
    if (/sentence_day/i.test(String((e && e.hint) || "") + " " + msg)) return "sentday";   // étape 58 : 10 phrases par jour
    if (code === "23514" && /kind/i.test(msg)) return "kind";   // type « story » refusé : script de l'étape 45 pas lancé
    if (sbErrKind(e) === "net") return "net";
    return "server";
  }
  function noteError(e) {
    const k = errKind(e);
    if (k === "missing") status = "missing";
    lastError = k;
    return k;
  }
  function errText(k) { return t("queue.err." + (k || "server")); }
  // Colonne de l'étape 23 absente (script supabase-etape23.sql pas lancé)
  function isNoCol23(e) {
    const code = String((e && e.code) || ""), msg = String((e && (e.message || e.msg)) || "");
    return code === "42703" || /hidden_by_user|content_cleared_at/i.test(msg);
  }

  async function refresh() {
    if (!usable()) return false;
    const get = with23 => {
      let q = client().from("claude_requests").select(with23 ? COLS23 : COLS).eq("user_id", auth.sbUid);
      if (with23) q = q.eq("hidden_by_user", false);          // demandes masquées : plus sur cet écran (gardées pour l'admin)
      return withTimeout(q.order("created_at", { ascending: false }).limit(50), T);
    };
    try {
      let r = v23 === false ? null : await get(true);
      if (r && r.error && isNoCol23(r.error)) { v23 = false; r = null; }
      else if (r && !r.error) v23 = true;
      if (!r) r = await get(false);
      items = arr(ok(r)); loaded = true; status = "ok"; lastError = "";
      return true;
    } catch (e) { noteError(e); return false; }
  }
  // Récupère les réponses arrivées et les range dans « À valider ». Renvoie le résultat de queueApply (ou null).
  async function claim(quiet) {
    if (!usable()) return null;
    const who = Storage.getUser();
    let resp;
    try { resp = ok(await withTimeout(client().rpc("claude_claim_proposals"), T * 2)); }
    catch (e) { noteError(e); return null; }
    status = "ok";
    if (!resp || !arr(resp.proposals).length) return { added: 0, cards: 0, bad: 0, stories: 0, sentences: 0 };
    // Étape 78 : les réponses sont déjà marquées « récupérées » sur le serveur : elles ne sont abandonnées que si le COMPTE a
    // changé. Si seul l'objet state a été remplacé pendant l'appel (version en ligne prise, fusion), elles sont appliquées
    // au nouvel état (avant : abandonnées en silence, à redemander par « Récupérer à nouveau »).
    if (Storage.getUser() !== who) return null;
    const kept0 = ClAuto.kept();
    const r = queueApply(resp);
    const kept = ClAuto.kept() - kept0;   // étape 73 : cases de l'utilisateur gardées
    // Étape 80 : les complétions automatiques (r.auto) sont appliquées en silence ; les cartes créées par Claude (r.gen)
    // sont annoncées par « Claude a ajouté N cartes à … » (ClNew.flush) et non par ce message.
    const shown = r.added - num(r.auto, 0) - num(r.gen, 0);
    if (r.added) {
      commitQuiet();
      if (r.autoSeen || r.gen) Storage.flushNow();   // étape 80 : envoyé tout de suite (un autre appareil du compte relit ces données avant de redemander)
      if (!quiet && shown > 0) toast(queueGotText(shown) + (kept ? " " + t("cl.kept", { n: kept }) : ""));
    }
    else if (kept && !quiet && !r.autoSeen) toast(t("queue.nothingNew") + " " + t("cl.kept", { n: kept }));
    if (r.pending && !quiet) toast(t(r.pending === 1 ? "pvw.genPending1" : "pvw.genPending", { n: r.pending }));   // cartes générées à corriger (« À valider »)
    if (r.gen && typeof ClNew !== "undefined") { try { ClNew.flush(); } catch (e) {} if (currentScreen === "lists" && !document.querySelector(".modal-bg")) renderScreen(); }
    if (arr(r.lost).length && typeof AutoMaj !== "undefined") AutoMaj.lost(r.lost);   // réponse pour des cartes créées sur un autre appareil : relue une fois après synchro
    if ((r.autoSeen || r.gen) && typeof AutoMaj !== "undefined") AutoMaj.kick("claim", arr(r.lost).length ? AMJ_PEER_MS : AMJ_SOON_MS);   // cases encore vides : 2e essai ; cartes créées incomplètes : complétées
    if (r.stories) {                                               // histoires (étape 45)
      commitQuiet();
      toast(t(r.stories === 1 ? "st.got1" : "st.got", { n: r.stories }));
      if (currentScreen === "stories" || currentScreen === "lists") renderScreen();
    }
    if (r.sentences) {                                             // « Ma phrase » (étape 58) : corrections reçues
      commitQuiet();
      toast(t(r.sentences === 1 ? "sn.got1" : "sn.got", { n: r.sentences }));
      if (currentScreen === "sentences") renderScreen();
    }
    return r;
  }
  // Récupération + liste des demandes (un seul appel à la fois), puis prochaine vérification si une demande est en cours.
  function sync(opts) {
    opts = opts || {};
    if (!usable()) return Promise.resolve(null);
    if (busy) return busy;
    busy = (async () => {
      let res = null;
      const cadP = cadFetch();                          // étape 59 : fréquence de passage (jamais bloquant)
      if (typeof ClaudeRun !== "undefined") ClaudeRun.fetch();   // étape 66 : dernier passage de Claude (jamais bloquant)
      try {
        res = await claim(!!opts.report);
        await refresh();
        if (typeof sentenceSyncErrors === "function") sentenceSyncErrors(items);   // « Ma phrase » : demandes en erreur (étape 58)
        QStats.flush();                                 // compteurs en attente (hors connexion) : renvoyés
        await cadP;
      } finally {
        busy = null;
        schedule();
        if (typeof AutoMaj !== "undefined") AutoMaj.tick();   // étape 80 : demande automatique finie par un autre appareil du compte
        if (currentScreen === "requests") renderRequests();
        else if (currentScreen === "settings") renderAiCard();
        else if (currentScreen === "pending" && !(res && res.added)) renderPending();   // bandeau à jour
      }
      const rep = res ? res.added - num(res.gen, 0) : 0;      // étape 80 : cartes créées annoncées à part (ClNew)
      if (opts.report && rep > 0) {
        openModal(t("ai.doneTitle"), el("p", null, queueGotText(rep)), [
          { label: t("close") }, { label: t("ai.see"), kind: "primary", onClick: () => { goPending(); } }]);
      }
      return res;
    })();
    return busy;
  }
  function openCount() { return items.filter(r => OPEN.includes(r.status)).length; }
  function schedule() {
    clearTimeout(timer); timer = null;
    if (!usable() || status === "missing") return;
    if (!items.some(r => OPEN.includes(r.status) || (r.status === "done" && !r.fetched_at))) return;
    timer = setTimeout(() => { if (document.visibilityState !== "hidden") sync(); else schedule(); }, CONFIG.QUEUE_POLL_MS);
  }
  async function submit(rows) {
    if (!usable()) return { error: "server" };
    try {
      for (const row of rows) ok(await withTimeout(client().from("claude_requests").insert(row), T));
      status = "ok";
      await refresh();
      schedule();
      return { error: null };
    } catch (e) { const k = noteError(e); await refresh(); return { error: k }; }
  }
  // Annuler : seulement une demande en attente (la règle RLS de l'étape 23 refuse les autres).
  async function remove(ids) {
    try {
      let q = client().from("claude_requests").delete().eq("user_id", auth.sbUid).in("id", ids);
      if (v23 !== false) q = q.eq("status", "pending");
      ok(await withTimeout(q, T));
      await refresh(); return true;
    } catch (e) { noteError(e); toast(errText(lastError)); return false; }
  }
  // Masquer des demandes terminées (done / error) : elles restent dans l'historique admin.
  // Sans le script de l'étape 23 : ancien fonctionnement (demande effacée).
  async function hide(ids) {
    if (v23 === false) {
      try { ok(await withTimeout(client().from("claude_requests").delete().eq("user_id", auth.sbUid).in("id", ids), T)); }
      catch (e) { noteError(e); toast(errText(lastError)); return false; }
      await refresh(); return true;
    }
    try { ok(await withTimeout(client().rpc("claude_request_hide", { p_ids: ids }), T)); }
    catch (e) { noteError(e); toast(errText(lastError)); return false; }
    await refresh(); return true;
  }
  async function refetch(id) {
    try { ok(await withTimeout(client().rpc("claude_refetch_request", { p_request: id }), T)); }
    catch (e) { noteError(e); toast(errText(lastError)); return; }
    const r = await sync();
    if (r && !r.added) toast(t("queue.nothingNew"));
  }
  function start() {
    reset();
    if (!usable()) return;
    sync();
  }
  function reset() { clearTimeout(timer); timer = null; items = []; loaded = false; lastError = ""; }
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && usable() && loaded) sync(); });
  return {
    usable, sync, submit, remove, hide, refetch, start, reset, refresh, errText,
    items: () => items, loaded: () => loaded, status: () => status, lastError: () => lastError, openCount,
    busy: () => !!busy,
    cadence: () => cad, cadenceFetch: cadFetch, setCadence
  };
})();

// --- Compteurs reçues / acceptées / refusées (suivi admin, étape 23) ---
// Chaque proposition venue de la file garde l'id de sa demande (p.reqId). L'appli compte les propositions reçues à la
// récupération, puis chaque acceptation ou refus dans « À valider », et envoie les hausses à claude_request_add_counts
// (un seul appel pour tout ce qui est en attente : une action groupée = un envoi par paquet). Les compteurs ne font
// qu'augmenter. En attente sur l'appareil (localStorage) tant que l'envoi n'a pas réussi : hors connexion, refait plus
// tard (retour en ligne, synchro de la file, toutes les minutes), sans message d'erreur.
const QStats = (() => {
  const FIELDS = ["received", "accepted", "rejected"];
  let pending = {}, who = null, inflight = null, again = false, timer = null;
  const counted = new Set();            // propositions déjà comptées (acceptées / refusées) depuis l'ouverture
  function key() { return CONFIG.LS_USER_PREFIX + "qstats:" + (Storage.getUser() || ""); }
  function load() {
    const u = Storage.getUser() || "";
    if (who === u) return;
    who = u; pending = {}; counted.clear();
    try {
      const o = JSON.parse(localStorage.getItem(key()) || "{}");
      if (o && typeof o === "object") Object.keys(o).forEach(id => {
        const v = o[id] || {}, x = {};
        FIELDS.forEach(f => { const n = Math.floor(Number(v[f]) || 0); if (n > 0) x[f] = n; });
        if (Object.keys(x).length) pending[id] = x;
      });
    } catch (e) { pending = {}; }
  }
  function store() {
    try { if (Object.keys(pending).length) localStorage.setItem(key(), JSON.stringify(pending)); else localStorage.removeItem(key()); } catch (e) {}
  }
  function add(reqId, field, n) {
    if (!reqId || !FIELDS.includes(field) || !(n > 0)) return;
    load();
    const x = pending[reqId] || (pending[reqId] = {});
    x[field] = (x[field] || 0) + n;
    store();
  }
  // Acceptation / refus d'une proposition de la file (une seule fois par proposition, même après « Annuler »).
  function decide(p, field) {
    if (!p || !p.reqId || p.qc || counted.has(p.id)) return;
    counted.add(p.id);
    add(p.reqId, field, 1);
  }
  function wasCounted(id) { return counted.has(id); }
  function retryLater() { clearTimeout(timer); timer = setTimeout(() => flush(), 60000); }
  // Envoie tout ce qui est en attente (500 demandes max par appel). Rien à envoyer, hors mode Supabase : rien.
  function flush() {
    load();
    if (!Object.keys(pending).length) return Promise.resolve(true);
    if (!Queue.usable()) return Promise.resolve(false);
    if (inflight) { again = true; return inflight; }
    const ids = Object.keys(pending).slice(0, 500);
    const sent = ids.map(id => Object.assign({ id }, pending[id]));
    const u = who, cl = Supa.client();
    inflight = (async () => {
      let okSent = false;
      try {
        const r = await withTimeout(cl.rpc("claude_request_add_counts", { p_items: sent }), 15000);
        if (r && r.error) throw r.error;
        okSent = true;
      } catch (e) { okSent = false; }
      if (who === u && okSent) {
        sent.forEach(s => {                              // retire ce qui a été envoyé (des hausses ont pu arriver entre-temps)
          const x = pending[s.id]; if (!x) return;
          FIELDS.forEach(f => { if (s[f]) { x[f] = (x[f] || 0) - s[f]; if (x[f] <= 0) delete x[f]; } });
          if (!Object.keys(x).length) delete pending[s.id];
        });
        store();
      }
      return okSent;
    })();
    return inflight.then(r => {
      inflight = null;
      if (who !== u) return r;
      if (r && (again || Object.keys(pending).length)) { again = false; return flush(); }
      again = false;
      if (!r) retryLater();
      return r;
    });
  }
  function pendingCount() { load(); return Object.keys(pending).length; }
  window.addEventListener("online", () => { if (pendingCount()) flush(); });
  return { add, decide, wasCounted, flush, pendingCount, reset: () => { who = null; clearTimeout(timer); } };
})();

function queueGotText(n) { return n === 1 ? t("queue.got1") : t("queue.got", { n }); }

// --- Préparer une demande ---
function queueLangsLabel(cards) {
  const lists = [...new Set(cards.map(c => c.listId))];
  if (lists.length === 1) return listLabel(getList(lists[0]));
  const folders = [...new Set(lists.map(id => (getList(id) || {}).folderId || ""))];
  if (folders.length === 1 && getFolder(folders[0])) return getFolder(folders[0]).name + " · " + t("queue.nLists", { n: lists.length });
  return t("queue.nLists", { n: lists.length });
}
// complete / verify : lots de AI_BATCH cartes, QUEUE_MAX_BATCHES lots max par demande (au-delà, plusieurs demandes).
function queueCardRows(kind, cards, want, label) {
  const per = CONFIG.AI_BATCH * CONFIG.QUEUE_MAX_BATCHES;
  const parts = chunks(cards, per);
  const base = label || queueLangsLabel(cards);
  return parts.map((part, pi) => {
    const batches = chunks(part, CONFIG.AI_BATCH).map(b => {
      const o = { ids: b.map(c => c.id) };
      if (kind === "complete") { o.prompt = completionPrompt(b, want); o.missing = b.map(c => (want || missingFields)(c)); }
      else { o.prompt = verifyPrompt(b); o.sigs = b.map(cardSig); }
      return o;
    });
    return {
      kind, label: (base + (parts.length > 1 ? " (" + (pi + 1) + "/" + parts.length + ")" : "")).slice(0, 300),
      card_count: part.length, batch_count: batches.length,
      payload: { v: 1, app: "vocab", kind, uiLang: state.settings.uiLang, created: new Date().toISOString(),
        answer: kind === "complete" ? "json-array: [{\"id\":\"k0\", \"<champ>\": \"valeur\"}]" : "json-array: [{\"id\":\"k0\",\"field\":\"…\",\"value\":\"…\",\"reason\":\"…\"}]",
        batches }
    };
  });
}
// Envoi d'une demande complete / verify. want : champs demandés par carte (complétion), null = champs vides.
async function queueSubmitCards(kind, cards, want, label) {
  cards = cards.filter(isVocab);
  if (kind === "complete") await Dict.fillFromCommon(cards);   // dictionnaire commun d'abord (étape 36)
  if (kind === "complete") cards = cards.filter(c => (want || missingFields)(c).length);
  if (!cards.length) { toast(t(kind === "complete" ? "ai.nothingToComplete" : "ai.noCards")); return; }
  const rows = queueCardRows(kind, cards, want, label);
  await queueSend(rows);
}
// Génération : la liste de destination est créée tout de suite si c'est une nouvelle liste (les cartes arrivent plus tard).
async function queueSubmitGenerate(req) {
  const parts = GenKnown.parts(req);                                    // étape 76 : conjugaison par 5 verbes, mots par 30
  if (parts.length > 50) { toast(t("queue.err.big")); return; }
  const isNew = req.listId === "__new__";
  const listId = genListId(req);
  req.listId = listId;
  if (isNew) commit();
  const keep = Object.assign({}, req, { newName: (getList(listId) || {}).name || req.newName });
  delete keep.createdId;
  const batches = parts.map(v => ({ prompt: genPromptJson(req, v), verbs: req.type === "conj" && v ? v : undefined, words: req.type === "vocab" && v ? v : undefined,
    near: arr(req.near).length ? req.near.map(x => ({ k: x.k, s: x.s })) : undefined }));   // étape 76 : cartes proches (aussi dans le prompt)
  const row = {
    kind: "generate", label: (listLabel(getList(listId)) + " · " + genLabel(req)).slice(0, 300),
    card_count: req.type === "conj" ? req.verbs.length : (arr(req.words).length || req.count), batch_count: batches.length,
    payload: { v: 1, app: "vocab", kind: "generate", uiLang: state.settings.uiLang, created: new Date().toISOString(),
      answer: "json-object: {\"lines\": [\"…\"]}", req: keep, batches }
  };
  await queueSend([row]);
}
async function queueSend(rows) {
  const pg = openProgress(t("queue.ask"), t("queue.sending"), []);
  let r;
  try { r = await Queue.submit(rows); } finally { pg.close(); }
  if (r.error) { openModal(t("queue.title"), el("p", null, Queue.errText(r.error)), [{ label: t("close") }]); return; }
  Activity.log("claude_request", { type: rows[0].kind, cards: rows.reduce((m, x) => m + (Number(x.card_count) || 0), 0), requests: rows.length });
  if (["pending", "settings", "requests"].includes(currentScreen)) renderScreen();   // bandeau, compteur, liste à jour
  openModal(t("queue.sentTitle"), el("p", null, t(rows.length > 1 ? "queue.sentN" : "queue.sent", { n: rows.length })), [
    { label: t("close") },
    { label: t("queue.see"), kind: "primary", onClick: () => { goRequests(); } }
  ]);
}

// --- Réception ---
// Ids d'une réponse « k0 » (ou l'id de la carte, accepté aussi) → « k<index> » attendu par applyAiResult.
function queueNormItems(res, ids) {
  let list = res;
  if (list && !Array.isArray(list) && typeof list === "object") list = list.items || list.cards || list.result || list.errors || [];
  return arr(list).map(it => {
    if (!it || typeof it !== "object") return null;
    const id = String(it.id || "");
    if (/^k\d+$/.test(id)) return it;
    const i = ids.indexOf(id);
    return i >= 0 ? Object.assign({}, it, { id: "k" + i }) : null;
  }).filter(Boolean);
}
// Demande de génération enregistrée → demande utilisable (liste supprimée entre-temps : recréée sous le même nom).
function queueGenReq(saved) {
  if (!saved || !saved.lg || !LANGUAGES[saved.lang]) return null;
  const req = Object.assign({}, saved, { verbs: arr(saved.verbs), tenses: arr(saved.tenses), persons: arr(saved.persons), words: arr(saved.words), near: arr(saved.near) });   // étape 76 : words, near
  // Langues affichées au moment de la demande (format de la réponse), sinon celles du profil (étape 35).
  const sup = cleanSupport(saved.lg.support, saved.lg.target);
  req.lg = Array.isArray(saved.lg.support) ? { target: saved.lg.target, support: sup } : langsFor(saved.lg.target);
  if (!getList(req.listId)) { req.listId = "__new__"; req.folder = getFolder(req.folder) ? req.folder : null; }
  return req;
}
// Applique les réponses récupérées (étape 73 : directement dans les cartes, js/claude-auto.js ; doublons et cartes générées
// non valides : « À valider »). Renvoie { added, cards, bad }.
function queueApply(resp) {
  const reqs = new Map(arr(resp.requests).map(r => [r.id, r]));
  const byId = new Map(state.cards.map(c => [c.id, c]));
  const genReqs = new Map();      // une nouvelle liste recréée une seule fois par demande
  const madeFor = new Map();      // étape 77 : liste d'origine absente → UNE seule liste recréée pour toutes les demandes qui la visaient
  const out = { added: 0, cards: 0, bad: 0, stories: 0, sentences: 0, auto: 0, autoSeen: 0, gen: 0, pending: 0, lost: [] };   // étape 80 : auto, autoSeen, gen, pending, lost
  const got = {};                 // demande → propositions ajoutées dans « À valider » (compteur « reçues »)
  const done = {};                // étape 73 : cases écrites directement (comptées reçues ET acceptées)
  arr(resp.proposals).forEach(p => {
    const before = state.proposals.length, ap = ClAuto.applied(), gc = genCreated;
    try { queueApplyOne(p); } catch (e) { out.bad++; }
    // addProposal / addGenProposals ajoutent en fin de tableau : les nouvelles gardent l'id de leur demande
    const fresh = state.proposals.slice(before);
    if (p.request_id && fresh.length) {
      fresh.forEach(x => { x.reqId = String(p.request_id); });
      got[p.request_id] = (got[p.request_id] || 0) + fresh.length;
    }
    const n = ClAuto.applied() - ap + (genCreated - gc);
    if (p.request_id && n > 0) done[p.request_id] = (done[p.request_id] || 0) + n;
  });
  Object.keys(done).forEach(id => { got[id] = (got[id] || 0) + done[id]; QStats.add(id, "accepted", done[id]); });
  Object.keys(got).forEach(id => QStats.add(id, "received", got[id]));
  if (Object.keys(got).length) QStats.flush();
  return out;

  function queueApplyOne(p) {
    {                                                            // un lot de réponse
      const r = reqs.get(p.request_id), pl = r && r.payload;
      const b = pl && arr(pl.batches)[p.batch];
      if (!b) { out.bad++; return; }
      if (r.kind === "story") {                                    // étape 45 : histoire rangée dans sa liste
        if (typeof storyFromQueue === "function" && storyFromQueue(p.result, pl.story || b.story)) out.stories++;
        else out.bad++;
        return;
      }
      if (r.kind === "sentence") {                                // étape 58 : correction rangée dans « Mes phrases »
        if (typeof sentenceFromQueue === "function" && sentenceFromQueue(p.result, pl.sentence || b.sentence, r.id)) out.sentences++;
        else out.bad++;
        return;
      }
      if (r.kind === "generate") {
        let req = genReqs.get(r.id);
        const orig = pl.req && pl.req.listId && pl.req.listId !== "__new__" ? String(pl.req.listId) : "";
        if (!req) {
          req = queueGenReq(pl.req); if (!req) { out.bad++; return; }
          if (orig && req.listId === "__new__" && madeFor.has(orig)) req.createdId = madeFor.get(orig);
          genReqs.set(r.id, req);
        }
        const res = p.result;
        const lines = Array.isArray(res) ? res : res && Array.isArray(res.lines) ? res.lines : [];
        const pr = parseGenReply(lines.map(String).join("\n"), req);
        const a = addGenProposals(pr.drafts, req, { queue: true });   // étape 80 : marque « ajoutée par Claude » + message au retour
        if (orig && req.createdId) madeFor.set(orig, req.createdId);
        out.added += a.added; out.cards += a.cards;
        out.gen += a.added - num(a.pending, 0); out.pending += num(a.pending, 0);
        return;
      }
      const ids = arr(b.ids);
      const batch = ids.map(id => byId.get(id) || null);       // carte supprimée entre-temps : ignorée
      const items = queueNormItems(p.result, ids);
      if (r.kind === "complete") {
        const miss = arr(b.missing);
        const want = c => { const i = ids.indexOf(c.id); return i >= 0 && Array.isArray(miss[i]) ? miss[i] : fillFields(c); };
        const n = applyAiResult("complete", batch, items, want);
        out.added += n; out.cards += n;
        if (pl.auto) {                                           // étape 80 : demande automatique (js/auto-maj.js) : silencieuse
          out.auto += n; out.autoSeen++;
          if (typeof AutoMaj !== "undefined") AutoMaj.answered(String(r.id), ids);
          if (batch.some(c => !c) && !out.lost.includes(String(r.id))) out.lost.push(String(r.id));   // cartes pas (encore) sur cet appareil
        }
      } else if (r.kind === "verify" && pl.cjq && typeof ConjQ !== "undefined") {   // étape 83 : consignes de conjugaison → « À valider »
        const n = ConjQ.apply(batch, items);
        out.added += n; out.cards += n;
      } else if (r.kind === "verify") {
        const n = applyAiResult("verify", batch, items);
        out.added += n; out.cards += n;
        const sigs = arr(b.sigs);
        batch.forEach((c, i) => { if (c && sigs[i] && cardSig(c) === sigs[i]) state.checkedSig[c.id] = sigs[i]; }); // carte inchangée : vérifiée
      }
    }
  }
}

// --- Message « Claude passe environ toutes les X h » (étape 59) ---
// c = { value, unit } (défaut : la valeur connue de l'appareil). 1 heure → « toutes les heures » ; 1 minute → « toutes les minutes » ;
// aucune valeur connue → texte sans chiffre.
function queueCadenceText(c) {
  c = c === undefined ? Queue.cadence() : c;
  if (!c) return t("queue.cad.none");
  const u = c.unit === "min" ? "m" : "h";
  return c.value === 1 ? t("queue.cad." + u + "1") : t("queue.cad." + u, { n: c.value });
}
// Petit texte près d'un bouton « Demander à Claude » (Réglages, fenêtres de demande).
function queueCadenceNote() {
  return el("p", "q-note q-cad", queueCadenceRunText());
}
// Étape 66 : message + « Dernier passage à 14 h 07. » (rien si l'heure n'a jamais été notée).
function queueCadenceRunText() {
  const run = typeof ClaudeRun !== "undefined" ? ClaudeRun.text() : "";
  return queueCadenceText() + (run ? " " + run : "");
}
// --- Écran « Demandes en cours » (demandes de l'utilisateur) ---
function goRequests() {
  try { history.replaceState(null, "", "#" + HASH_OF.requests); } catch (e) {}
  Queue.cadenceFetch();                                   // valeur à jour à l'ouverture (au plus une fois par minute)
  if (typeof ClaudeRun !== "undefined") ClaudeRun.fetch();   // étape 66 : dernier passage
  showScreen("requests");
}
function queueDate(s) {
  try { const d = new Date(s); return d.toLocaleDateString(state.settings.uiLang) + " " + d.toLocaleTimeString(state.settings.uiLang, { hour: "2-digit", minute: "2-digit" }); }
  catch (e) { return ""; }
}
// Nombre de la demande : cartes, cartes à générer, ou mots de l'histoire (étape 45).
function queueMetaCount(r) {
  return t(r.kind === "generate" ? "queue.meta.gen" : r.kind === "story" ? "st.meta" : r.kind === "dict_dupes" ? "dpa.meta" : "queue.meta.cards", { n: r.card_count });   // étape 66 : cas de faux doublons
}
function queueStatusText(r) {
  if (r.status === "done") return t(r.fetched_at ? "queue.st.fetched" : "queue.st.done");
  return t("queue.st." + r.status);
}
function renderRequests() {
  const root = $("#screen-requests");
  if (!root) return;
  root.textContent = "";
  const back = el("button", "link-btn", "‹ " + t("nav.settings"));
  back.addEventListener("click", () => { try { history.replaceState(null, "", "#" + HASH_OF.settings); } catch (e) {} showScreen("settings"); });
  root.appendChild(el("div", "lv-top")).appendChild(back);
  root.appendChild(el("h2", null, t("queue.title")));
  root.appendChild(el("div", "card q-cad", queueCadenceRunText()));   // étape 59 : message visible par tous (étape 66 : + dernier passage)
  root.appendChild(el("p", "q-note", t("queue.help")));
  const top = el("div", "btns two");
  const ask = el("button", "btn primary", t("queue.ask"));
  ask.addEventListener("click", () => openAskClaude({ kind: "all" }));
  const upd = el("button", "btn", Queue.busy() ? t("queue.checking") : t("queue.refresh"));
  upd.disabled = Queue.busy();
  upd.addEventListener("click", () => { Queue.sync({ report: true }); renderRequests(); });
  top.append(ask, upd);
  root.appendChild(top);
  if (Queue.status() === "missing") { root.appendChild(el("div", "card q-err", t("queue.err.missing"))); return; }
  if (Queue.lastError() && Queue.lastError() !== "missing") root.appendChild(el("p", "q-err", Queue.errText(Queue.lastError())));
  const items = Queue.items();
  if (!Queue.loaded()) { root.appendChild(el("div", "empty", t("queue.loading"))); if (!Queue.busy()) Queue.sync(); return; }
  if (!items.length) { root.appendChild(el("div", "empty", t("queue.empty"))); return; }
  items.forEach(r => {
    const box = el("div", "card q-item");
    const head = el("div", "q-head");
    const left = el("div");
    left.appendChild(el("div", "q-title", t("queue.kind." + r.kind) + (r.label ? " · " + r.label : "")));
    const meta = [queueMetaCount(r), t("queue.meta.sent", { d: queueDate(r.created_at) })];
    if (r.finished_at) meta.push(t("queue.meta.done", { d: queueDate(r.finished_at) }));
    left.appendChild(el("div", "q-meta", meta.join(" · ")));
    head.append(left, el("span", "q-st " + r.status, queueStatusText(r)));
    box.appendChild(head);
    if (r.status === "error" && r.error) box.appendChild(el("div", "q-err", r.error));
    const acts = el("div", "q-acts");
    const link = (label, fn, danger) => { const b = el("button", "link-btn" + (danger ? " danger" : ""), label); b.addEventListener("click", fn); acts.appendChild(b); };
    // En attente : annuler (la demande est supprimée). En cours : rien. Terminée : masquer (gardée pour l'admin).
    if (r.status === "pending") {
      link(t("queue.cancel"), () => openModal(t("queue.cancel"), el("p", null, t("queue.cancelConfirm")), [
        { label: t("cancel") },
        { label: t("queue.cancel"), kind: "danger", onClick: () => { Queue.remove([r.id]).then(() => renderRequests()); } }]), true);
    } else if (r.status === "done" || r.status === "error") {
      if (r.status === "done" && r.fetched_at && r.result_count && !r.content_cleared_at) link(t("queue.refetch"), () => { Queue.refetch(r.id); });
      link(t("queue.hide"), () => { Queue.hide([r.id]).then(() => renderRequests()); });
    }
    if (acts.childNodes.length) box.appendChild(acts);
    root.appendChild(box);
  });
  const fin = items.filter(r => r.status === "error" || (r.status === "done" && r.fetched_at));
  if (fin.length > 1) {
    const b = el("button", "btn", t("queue.hideAll", { n: fin.length }));
    b.addEventListener("click", () => { Queue.hide(fin.map(r => r.id)).then(() => renderRequests()); });
    root.appendChild(b);
  }
}
// Bandeau en haut de « À valider » quand des demandes sont en cours.
function queueBanner() {
  if (!Queue.usable() || !Queue.openCount()) return null;
  const box = el("div", "q-banner");
  box.appendChild(el("span", null, Queue.openCount() === 1 ? t("queue.banner1") : t("queue.banner", { n: Queue.openCount() })));
  const b = el("button", "link-btn", t("queue.see"));
  b.addEventListener("click", goRequests);
  box.appendChild(b);
  return box;
}
// Bloc de la carte « Complétion et vérification » (Réglages).
function queueAiCardBlock() {
  const wrap = el("div");
  wrap.style.marginTop = "12px";
  wrap.appendChild(el("p", "q-note", t("queue.info")));
  wrap.appendChild(queueCadenceNote());                   // étape 59
  const btns = el("div", "btns two");
  const a = el("button", "btn primary", t("queue.ask"));
  a.addEventListener("click", () => openAskClaude({ kind: "all" }));
  const n = Queue.openCount();
  const s = el("button", "btn", n ? t("queue.seeN", { n }) : t("queue.see"));
  s.addEventListener("click", goRequests);
  btns.append(a, s);
  wrap.appendChild(btns);
  return wrap;
}
// Fenêtre « Demander à Claude » : compléter les trous, vérifier, ou générer des cartes, sur tout / un dossier / une liste.
function openAskClaude(scope) {
  const o = { kind: "complete", scope: scope && scope.kind !== "all" ? scope.kind + ":" + scope.id : "all" };
  const wrap = el("div");
  wrap.appendChild(queueCadenceNote());                   // étape 59
  wrap.appendChild(el("p", "q-note", t("queue.help")));
  const seg = el("div", "seg");
  const kinds = ["complete", "verify", "generate"];
  const sc = el("select", "input");
  [["all", t("queue.scope.all")]].concat(
    sortedFolders().map(f => ["folder:" + f.id, "▸ " + f.name]),
    orderedLists().map(l => ["list:" + l.id, listLabel(l)])
  ).forEach(([v, l]) => { const op = el("option", null, l); op.value = v; sc.appendChild(op); });
  sc.value = o.scope;
  if (sc.value !== o.scope) sc.value = o.scope = "all";
  const scopeField = formField(t("queue.scope"), sc);
  const info = el("p", "muted");
  const scopeObj = () => { const [k, id] = o.scope.split(":"); return k === "all" ? { kind: "all" } : { kind: k, id }; };
  const pick = () => {
    const cards = updScopeCards(scopeObj());
    if (o.kind === "complete") return cards.filter(c => gapFields(c).length);
    return cards;
  };
  const upd = () => {
    seg.querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.value === o.kind)));
    scopeField.hidden = o.kind === "generate";
    if (o.kind === "generate") { info.textContent = t("queue.genInfo"); return; }
    const n = pick().length;
    info.textContent = o.kind === "complete" ? t("queue.countComplete", { n }) : t("queue.countVerify", { n });
  };
  kinds.forEach(k => {
    const b = el("button", null, t("queue.kind." + k));
    b.type = "button"; b.dataset.value = k;
    b.addEventListener("click", () => { o.kind = k; upd(); });
    seg.appendChild(b);
  });
  sc.addEventListener("change", () => { o.scope = sc.value; upd(); });
  wrap.append(formField(t("queue.what"), seg), scopeField, info);
  upd();
  openModal(t("queue.ask"), wrap, [
    { label: t("cancel") },
    { label: t("queue.send"), kind: "primary", onClick: () => {
      if (o.kind === "generate") { const s = scopeObj(); openGenerate(s.kind === "list" ? s.id : null); return; }
      const cards = pick();
      if (!cards.length) { toast(t(o.kind === "complete" ? "ai.nothingToComplete" : "ai.noCards")); return false; }
      const s = scopeObj(), obj = updScopeObj(s);
      const label = s.kind === "list" ? listLabel(obj) : s.kind === "folder" ? obj.name : t("queue.scope.all");
      if (o.kind === "verify") { if (addDuplicateProposals(cards)) commitQuiet(); }   // doublons : détectés sur l'appareil
      queueSubmitCards(o.kind, cards, o.kind === "complete" ? gapFields : null, label);
    } }
  ]);
}
