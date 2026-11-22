"use strict";

// === CLAUDE PROPOSE UNE CORRECTION APRÈS UN SIGNALEMENT — CARTE PERSONNELLE (ÉTAPE 85) ===
// Suite de js/signalements.js (étape 84). Quand une carte PERSONNELLE a été signalée (🚩), Claude lit la copie courte de
// la carte à son prochain passage (file d'attente, demande « report » créée par le serveur) et propose UNE correction
// (un champ + une valeur), ou « rien à corriger ». La tâche programmée ne touche jamais user_data : la proposition reste
// sur le serveur, rangée sur le signalement, et c'est CET écran-ci (le compte du propriétaire) qui vient la chercher.
//  - card_report_fixes() : mes propositions pas encore décidées → rangées dans « À valider » comme une « Correction »
//    ordinaire (state.proposals). L'identifiant de la proposition est « sg-<signalement> » : il voyage avec le compte
//    (aucun nouveau champ de données) et relie la décision au signalement, même sur un autre appareil.
//  - L'utilisateur gagne toujours : rien n'est écrit dans la carte sans « Accepter » ; une case modifiée entre-temps
//    n'est jamais écrasée (règle de « À valider »).
//  - Décision (QStats.decide, js/queue.js) : acceptée → card_report_fix_set « accepted » → le signalement passe « Traité »
//    et la pastille « Merci, corrigé » de l'étape 84 apparaît ; refusée → « Ignoré », sans pastille. L'envoi attend la fin
//    du bouton « Annuler » : une décision annulée (la proposition est revenue dans « À valider ») n'est jamais envoyée.
//    Hors connexion : gardée sur l'appareil (clé locale vocabfr.sgc:<compte>) et renvoyée plus tard.
//  - Proposition inutilisable sur l'appareil (carte supprimée, même valeur, valeur déjà refusée, case inconnue) : refermée
//    (« none » → « Ignoré »). Carte pas encore arrivée sur cet appareil : on attend SGC_GONE_MS avant de refermer.
// Les cartes du dictionnaire commun et des listes partagées ne passent PAS par ici : écran Administration → Signalements
// (js/screens/admin-signalements.js). Script claude/supabase-etape85.sql absent : rien ne se passe, sans erreur.
// Textes : js/i18n/sigclaude-<langue>.js (clés sgc.*). Styles : ceux de la pastille de l'étape 84 (.sgl-pill).
const SGC_ID = "sg-";                        // préfixe de l'identifiant d'une proposition venue d'un signalement
const SGC_CHECK_MS = 10 * 60000;             // au plus une lecture toutes les 10 min (retour dans l'appli, synchro de la file)
const SGC_BOOT_MS = 12000;
const SGC_PILL_MS = 9000;
const SGC_LOST_MS = 3 * 86400000;            // arrivée dans « À valider » mais introuvable depuis 3 jours : refermée
const SGC_GONE_MS = 7 * 86400000;            // carte introuvable sur cet appareil depuis 7 jours : refermée

const SglC = (() => {
  let missing = false, busy = false, sending = false, lastCheck = 0, timer = null, sendTimer = null, token = 0;

  function usable() { return typeof Sgl !== "undefined" && Sgl.usable() && !missing; }
  async function rpc(name, args) {
    const cl = Supa.client();
    if (!cl) throw new Error("no client");
    const r = await withTimeout(cl.rpc(name, args || {}), 20000);
    if (r && r.error) throw r.error;
    return r ? r.data : null;
  }
  // Signalement d'une proposition de « À valider » ("" si elle ne vient pas d'un signalement).
  function reportOf(p) {
    const id = p && typeof p.id === "string" && p.id.startsWith(SGC_ID) ? p.id.slice(SGC_ID.length) : "";
    return /^[0-9a-f-]{36}$/i.test(id) ? id : "";
  }

  // --- Décisions en attente d'envoi : { "<signalement>": ["accepted" | "refused", date] } (appareil seulement) ---
  function key() { return CONFIG.LS_USER_PREFIX + "sgc:" + (Storage.getUser() || ""); }
  function load() {
    try { const o = JSON.parse(localStorage.getItem(key()) || "{}"); return o && typeof o === "object" && !Array.isArray(o) ? o : {}; }
    catch (e) { return {}; }
  }
  function store(o) {
    try { if (Object.keys(o).length) localStorage.setItem(key(), JSON.stringify(o)); else localStorage.removeItem(key()); } catch (e) {}
  }
  // Appelée à chaque acceptation ou refus dans « À valider » (QStats.decide) : ne retient que les propositions « sg-… ».
  function decided(p, field) {
    const id = reportOf(p);
    if (!id || !Storage.getUser()) return;
    const o = load();
    o[id] = [field === "accepted" ? "accepted" : "refused", Date.now()];
    store(o);
    clearTimeout(sendTimer);
    sendTimer = setTimeout(() => { flush(); }, CONFIG.UNDO_MS + 3000);   // après la fin du bouton « Annuler »
  }
  async function flush() {
    if (!usable() || sending) return 0;
    const o = load(), my = token, u = Storage.getUser(), now = Date.now();
    const back = new Set(arr(state.proposals).map(reportOf).filter(Boolean));
    const items = [];
    let changed = false;
    Object.keys(o).forEach(id => {
      const st = arr(o[id])[0], at = num(arr(o[id])[1], 0);
      if (back.has(id) || !["accepted", "refused"].includes(st)) { delete o[id]; changed = true; return; }   // « Annuler » : la proposition est revenue
      if (now - at < CONFIG.UNDO_MS) return;                                                                  // le bouton « Annuler » est encore affiché
      if (items.length < 100) items.push({ id, st });
    });
    if (changed) store(o);
    if (!items.length) return 0;
    sending = true;
    try {
      await rpc("card_report_fix_set", { p_items: items });
      if (my !== token || Storage.getUser() !== u) return 0;
      const o2 = load();
      items.forEach(x => { if (o2[x.id] && o2[x.id][0] === x.st) delete o2[x.id]; });
      store(o2);
      if (items.some(x => x.st === "accepted")) { try { Sgl.check(true); } catch (e) {} }   // pastille « Merci, corrigé » (étape 84)
      return items.length;
    } catch (e) {
      if (Sgl.isMissing(e)) missing = true;      // script de l'étape 85 pas lancé : plus d'appel ensuite
      return 0;                                  // hors connexion : gardé, renvoyé plus tard
    } finally { sending = false; }
  }

  // --- Une proposition du serveur → une « Correction » dans « À valider ». Renvoie "queued" | "none" | "wait". ---
  function add(it) {
    const c = state.cards.find(x => x.id === String(it.card));
    if (!c) return "wait";                                         // carte pas (encore) sur cet appareil
    if (!canEditList(c.listId)) return "none";
    const f = String(it.field || "");
    if (!checkFields(c).includes(f)) return "none";                // case inconnue pour cette carte
    let v = String(it.value == null ? "" : it.value).replace(/\s+/g, " ").trim();
    if (isPosField(f)) v = parsePos(v, f.slice(4));
    const cur = fieldVal(c, f);
    if (!v || v === cur.trim()) return "none";                     // rien à changer (déjà corrigée à la main, par exemple)
    if (state.rejected.includes(rejectKey(c.id, f, v))) return "none";   // valeur déjà refusée : jamais reproposée
    if (state.proposals.some(p => p.cardId === c.id && p.field === f)) return "wait";   // une seule proposition par carte et par case
    const r = SGL_REASONS.includes(it.reason) ? t("sgl.r." + it.reason) : "";
    state.proposals.push({ id: SGC_ID + it.id, cardId: c.id, field: f, type: "correction", oldValue: cur, newValue: v,
      reason: ("🚩 " + t("sgc.reason") + (r ? " (" + r + ")" : "")).slice(0, 300), createdAt: Date.now() });
    return "queued";
  }
  // Pastille « Claude propose une correction » : ouvre « À valider ». Jamais pendant une séance ni par-dessus une fenêtre.
  function pill(n) {
    let p = $("#sgcPill");
    if (p) p.remove();
    p = el("button", "sgl-pill sgc-pill", "🚩 " + (n > 1 ? t("sgc.gotN", { n }) : t("sgc.got1")));
    p.id = "sgcPill"; p.type = "button";
    p.setAttribute("role", "status");
    const hide = () => { p.classList.remove("show"); setTimeout(() => p.remove(), 300); };
    p.addEventListener("click", () => { hide(); try { goPending(); } catch (e) {} });
    document.body.appendChild(p);
    requestAnimationFrame(() => p.classList.add("show"));
    setTimeout(hide, SGC_PILL_MS);
  }
  async function check(force) {
    if (!usable() || busy || (typeof Release !== "undefined" && Release.blocked && Release.blocked())) return 0;
    const now = Date.now();
    if (!force && now - lastCheck < SGC_CHECK_MS) return 0;
    lastCheck = now; busy = true;
    const my = token, u = Storage.getUser();
    let added = 0;
    try {
      await flush();
      const list = arr(await rpc("card_report_fixes"));
      if (my !== token || Storage.getUser() !== u) return 0;      // compte changé pendant l'appel (un autre objet state ne compte pas)
      const out = load(), acks = [];
      const here = new Set(arr(state.proposals).map(reportOf).filter(Boolean));
      list.forEach(it => {
        if (!it || typeof it.id !== "string" || !/^[0-9a-f-]{36}$/i.test(it.id) || out[it.id]) return;   // décision en attente d'envoi
        if (here.has(it.id)) { if (!it.fa) acks.push({ id: it.id, st: "queued" }); return; }             // déjà dans « À valider »
        const age = now - (Date.parse(it.fa || it.at || "") || now);
        if (it.fa) {                                               // arrivée sur un appareil du compte, mais plus dans « À valider »
          if (age > SGC_LOST_MS) acks.push({ id: it.id, st: "none" });
          return;
        }
        const r = add(it);
        if (r === "queued") { acks.push({ id: it.id, st: "queued" }); added++; }
        else if (r === "none" || age > SGC_GONE_MS) acks.push({ id: it.id, st: "none" });
      });
      if (added) commitQuiet();
      if (acks.length) { try { await rpc("card_report_fix_set", { p_items: acks.slice(0, 100) }); } catch (e) {} }
      if (added && my === token && Storage.getUser() === u) {
        whenNoModal(() => my === token && Storage.getUser() === u).then(free => { if (free && currentScreen !== "pending") pill(added); });
      }
    } catch (e) { if (Sgl.isMissing(e)) missing = true; }
    finally { busy = false; }
    return added;
  }
  function start() {
    token++; missing = false; lastCheck = 0;
    clearTimeout(timer); clearTimeout(sendTimer);
    const my = token;
    timer = setTimeout(() => { if (my === token) check(true); }, SGC_BOOT_MS);
  }
  function reset() {
    token++; clearTimeout(timer); clearTimeout(sendTimer); lastCheck = 0;
    const p = $("#sgcPill"); if (p) p.remove();
  }
  return { usable, reportOf, decided, flush, check, start, reset, tick: () => check(false) };
})();

document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") { try { SglC.check(false); } catch (e) {} } });
window.addEventListener("online", () => { try { SglC.flush(); } catch (e) {} });
