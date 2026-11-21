"use strict";

// ====================================================================================================
// js/claude-nouveau.js — CARTES AJOUTÉES PAR CLAUDE : MARQUE, PASTILLE ET MESSAGE (ÉTAPE 80)
// Chargé juste après js/auto-maj.js. Au chargement : seulement un écouteur (visibilitychange).
// ====================================================================================================

// === REMPLISSAGE DIRECT : CARTES AJOUTÉES PAR CLAUDE, PASTILLE ET MESSAGE (ÉTAPE 80) ===
// Les cartes créées par Claude entrent directement dans leur liste (étape 73 : addGenProposals → pvAcceptNew). Ici :
//  - marque « ajoutée par Claude » sur chaque carte créée, jusqu'à l'ouverture de la liste (pendant cette visite, les cartes
//    portent l'étiquette « 🤖 Ajoutée par Claude » et une ligne en haut de la liste donne leur nombre) ;
//  - pastille (petit chiffre) sur la liste et sur son dossier, dans l'écran Listes ;
//  - message au retour dans l'appli quand les cartes arrivent par la file d'attente : « Claude a ajouté 12 cartes à
//    « Verbes du quotidien ». » avec « Voir » (barre en bas de l'écran, jamais pendant une session de révision ni par-dessus
//    une fenêtre ; jamais de notification push).
// Sur l'APPAREIL seulement (jamais dans les données du compte, aucun champ de carte : DATA_VERSION inchangé) :
//   vocabfr.clnew:<compte> = { l: { idListe: [idCartes] }, m: { idListe: nombre } (message pas encore montré) }.
// L'utilisateur garde la main : une carte ajoutée se modifie ou se supprime comme les autres.
const CLN_BAR_MS = 9000;   // durée d'affichage du message
const CLN_MAX = 500;       // cartes marquées au plus par liste

const ClNew = (() => {
  let who = null, st = null;
  let seen = { list: null, ids: new Set() };   // liste ouverte en ce moment : cartes à étiqueter pendant la visite
  let showing = false, barTimer = null, barList = null;   // barList : liste annoncée par le message affiché (une seule liste)

  function key() { return CONFIG.LS_USER_PREFIX + "clnew:" + (Storage.getUser() || ""); }
  function load() {
    const u = Storage.getUser() || "";
    if (st && who === u) return st;
    who = u; seen = { list: null, ids: new Set() };
    st = { l: {}, m: {} };
    try {
      const o = JSON.parse(localStorage.getItem(key()) || "null");
      if (o && typeof o === "object") {
        if (o.l && typeof o.l === "object" && !Array.isArray(o.l)) st.l = o.l;
        if (o.m && typeof o.m === "object" && !Array.isArray(o.m)) st.m = o.m;
      }
    } catch (e) {}
    return st;
  }
  function save() {
    try {
      if (!st || !who) return;
      if (Object.keys(st.l).length || Object.keys(st.m).length) localStorage.setItem(key(), JSON.stringify(st));
      else localStorage.removeItem(key());
    } catch (e) {}
  }
  // Cartes créées par Claude dans une liste. msg = true : message à montrer (cartes arrivées par la file d'attente).
  function add(listId, ids, msg) {
    ids = arr(ids).filter(Boolean);
    if (!listId || !ids.length || !Storage.getUser()) return;
    const s = load();
    if (seen.list === listId && typeof currentScreen !== "undefined" && currentScreen === "lists") ids.forEach(id => seen.ids.add(id));   // liste déjà ouverte : étiquetées tout de suite
    else s.l[listId] = arr(s.l[listId]).concat(ids).slice(-CLN_MAX);
    if (msg) s.m[listId] = num(Number(s.m[listId]), 0) + ids.length;
    save();
  }
  // Nombre de cartes ajoutées par Claude pas encore vues dans une liste (cartes supprimées ou déplacées : plus comptées).
  function count(listId) {
    const ids = arr(load().l[listId]);
    if (!ids.length) return 0;
    const set = new Set(ids);
    let n = 0;
    state.cards.forEach(c => { if (c.listId === listId && set.has(c.id)) n++; });
    return n;
  }
  function folderCount(f) { return listsIn(f.id).reduce((n, l) => n + count(l.id), 0); }
  function total() { return Object.keys(load().l).reduce((n, id) => n + (getList(id) ? count(id) : 0), 0); }
  // Pastille (petit chiffre) pour une liste ou un dossier ; null s'il n'y a rien.
  function dot(n) {
    if (!n) return null;
    const s = el("span", "cln-dot", n > 99 ? "99+" : String(n));
    s.title = t(n === 1 ? "cln.dot1" : "cln.dot", { n });
    s.setAttribute("aria-label", s.title);
    return s;
  }
  // Écran Listes affiché (renderLists) : liste ouverte → ses cartes marquées deviennent « vues » (la pastille part), elles
  // gardent leur étiquette tant que la liste reste ouverte. Autre liste ou vue d'ensemble : étiquettes oubliées.
  function view(listId) {
    const s = load();
    if (listId !== seen.list) seen = { list: listId || null, ids: new Set() };
    if (!listId) return;
    if (arr(s.l[listId]).length) { s.l[listId].forEach(id => seen.ids.add(id)); delete s.l[listId]; }
    if (s.m[listId]) delete s.m[listId];       // la liste est ouverte : plus besoin du message
    save();
    if (barList === listId) hideBar();
  }
  function isNew(cardId) { return seen.ids.has(cardId); }
  function tag(c, box) { if (c && isNew(c.id)) box.appendChild(el("span", "tag cln-tag", "🤖 " + t("cln.tag"))); }
  // Ligne en haut de la liste ouverte : « 🤖 12 cartes ajoutées par Claude ». null s'il n'y en a pas.
  function note(listId) {
    if (seen.list !== listId || !seen.ids.size) return null;
    let n = 0;
    state.cards.forEach(c => { if (c.listId === listId && seen.ids.has(c.id)) n++; });
    return n ? el("div", "cln-note", "🤖 " + t(n === 1 ? "cln.note1" : "cln.note", { n })) : null;
  }
  // Ménage : listes supprimées.
  function tidy() {
    const s = load();
    let ch = false;
    Object.keys(s.l).forEach(id => { if (!getList(id)) { delete s.l[id]; ch = true; } });
    Object.keys(s.m).forEach(id => { if (!getList(id)) { delete s.m[id]; ch = true; } });
    if (ch) save();
  }
  function msgText(m) {
    const ids = Object.keys(m), n = ids.reduce((x, id) => x + num(Number(m[id]), 0), 0);
    if (ids.length === 1) return t(n === 1 ? "cln.msg1" : "cln.msg", { n, list: listLabel(getList(ids[0])) });
    return t("cln.msgN", { n, l: ids.length });
  }
  function hideBar() { const b = $("#clnBar"); if (b) b.classList.remove("show"); clearTimeout(barTimer); barList = null; }
  function bar(text, onSee) {
    let b = $("#clnBar");
    if (!b) {
      b = el("div", "undo-bar cln-bar");
      b.id = "clnBar";
      b.setAttribute("role", "status");
      b.append(el("span"), el("button"));
      document.body.appendChild(b);
    }
    b.firstChild.textContent = text;
    b.lastChild.textContent = t("cln.see");
    b.lastChild.onclick = () => { hideBar(); onSee(); };
    b.classList.add("show");
    clearTimeout(barTimer);
    barTimer = setTimeout(hideBar, CLN_BAR_MS);
  }
  // Montre le message en attente dès que la voie est libre (appli visible, aucune fenêtre, pas de session en cours).
  function flush() {
    if (showing || !Storage.getUser()) return;
    tidy();
    if (!Object.keys(load().m).length) return;
    if (document.visibilityState === "hidden") return;        // montré au retour dans l'appli
    const u = Storage.getUser();
    showing = true;
    whenNoModal(() => Storage.getUser() === u).then(ok => {
      showing = false;
      if (!ok || Storage.getUser() !== u) return;
      const s = load(), m = s.m;
      if (!Object.keys(m).length) return;
      const ids = Object.keys(m).filter(id => getList(id));
      s.m = {}; save();
      if (!ids.length) return;
      const only = {}; ids.forEach(id => { only[id] = m[id]; });
      if (ids.length === 1 && seenNow(ids[0])) return;      // la liste est déjà ouverte : les cartes sont sous les yeux
      bar(msgText(only), () => {
        try { history.replaceState(null, "", "#" + HASH_OF.lists); } catch (e) {}
        showScreen("lists");
        openListView(ids.length === 1 ? ids[0] : null);
      });
      barList = ids.length === 1 ? ids[0] : null;
      try { if (currentScreen === "lists" && !document.querySelector(".modal-bg")) renderLists(); } catch (e) {}   // pastilles à jour
    });
  }
  function seenNow(listId) { try { return currentScreen === "lists" && seen.list === listId; } catch (e) { return false; } }
  function reset() { who = null; st = null; seen = { list: null, ids: new Set() }; showing = false; hideBar(); }
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") { try { flush(); } catch (e) {} } });

  return { add, count, folderCount, total, dot, view, isNew, tag, note, flush, reset };
})();
