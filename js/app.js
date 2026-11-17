"use strict";

// === STATE ===
let state = emptyData();

// Toute modification des données passe par commit() : horodatage + sauvegarde + rafraîchissement.
function commit() {
  state.updatedAt = Date.now();
  Storage.save(state);
  render();
}

// === THEME ===
function applyTheme() {
  document.documentElement.setAttribute("data-theme", state.settings.theme);
}

// === NAVIGATION ===
const SCREENS = ["home", "review", "lists", "stats", "pending", "friends", "settings", "admin", "requests", "adminreq", "adminlog", "adminacc", "adminfiche", "adminann", "admintpl", "adminpush", "admindict", "adminerr", "about"];
const HASH_OF = { home: "home", review: "review", lists: "lists", stats: "stats", pending: "a-valider", friends: "amis", settings: "reglages", admin: "admin", requests: "demandes", adminreq: "admin-demandes", adminlog: "admin-journal", adminacc: "admin-comptes", adminfiche: "admin-fiche", adminann: "admin-annonces", admintpl: "admin-modeles", adminpush: "admin-notifications", admindict: "admin-dictionnaire", adminerr: "admin-erreurs", about: "a-propos" }; // "settings" est réservé dans l'URL
const ADMIN_SCREENS = ["admin", "adminreq", "adminlog", "adminacc", "adminfiche", "adminann", "admintpl", "adminpush", "admindict", "adminerr"];
const ADMIN_SB_SCREENS = ["adminreq", "adminlog", "adminfiche", "adminann", "admintpl", "adminpush", "admindict", "adminerr"];   // mode Supabase seulement
let currentScreen = "home";

function screenFromHash() {
  const h = (location.hash || "").replace("#", "");
  return SCREENS.find(s => HASH_OF[s] === h) || "home";
}
function showScreen(name) {
  if (!Storage.getUser()) { showAuth(auth.view); return; } // personne de connecté : écran de connexion
  currentScreen = SCREENS.includes(name) ? name : "home";
  if (ADMIN_SCREENS.includes(currentScreen) && !auth.isAdmin) currentScreen = "settings"; // Administration : admin seulement
  if (ADMIN_SB_SCREENS.includes(currentScreen) && auth.mode !== "supabase") currentScreen = "admin";
  if (currentScreen === "requests" && !Queue.usable()) currentScreen = "settings"; // Demandes à Claude : mode Supabase seulement
  document.querySelectorAll(".screen").forEach(el => el.classList.toggle("active", el.id === "screen-" + currentScreen));
  document.querySelectorAll("nav.bottom button").forEach(b => b.classList.toggle("active", b.dataset.nav === currentScreen));
  renderScreen();
  window.scrollTo(0, 0);
}
function initNav() {
  document.querySelectorAll("nav.bottom button").forEach(b => {
    b.addEventListener("click", () => {
      try { history.replaceState(null, "", "#" + HASH_OF[b.dataset.nav]); } catch (e) {}
      showScreen(b.dataset.nav);
    });
  });
  window.addEventListener("hashchange", () => showScreen(screenFromHash()));
}

// === SYNC STATUS ===
function renderSyncStatus(mode) {
  const el = $("#syncStatus");
  el.dataset.mode = mode;
  $("#syncLabel").textContent = t("storage." + mode);
  const infoKey = mode === "error" ? "storage.info.error" : mode === "offline" ? "storage.info.offline" : (mode === "local" ? "storage.info.local" : "storage.info.cloud");
  $("#storageInfo").textContent = t(infoKey);
}
// Étape 33b : toucher l'indicateur en erreur (ou hors ligne) affiche le message exact de la dernière erreur.
function initSyncStatus() {
  // Étape 39 : bouton ⓘ de l'en-tête → À propos.
  const ab = $("#btnAbout");
  if (ab) ab.addEventListener("click", () => {
    try { history.replaceState(null, "", "#" + HASH_OF.about); } catch (e) {}
    showScreen("about");
  });
  const el = $("#syncStatus");
  el.addEventListener("click", () => {
    const m = Storage.getMode();
    if (m !== "error" && m !== "offline") return;
    toast(t("storage.errDetail", { msg: Storage.getLastError() || "—" }));
  });
}

// === ANNONCES ===
// Étape 27, mode Supabase seulement (script supabase-etape27.sql). Au lancement (après l'ouverture des données),
// fonction my_announcements : annonces actives qui visent ce compte et pas encore lues (un admin n'en reçoit pas).
// Une fenêtre par annonce, l'une après l'autre, qui ne se ferme qu'avec « OK » ; « OK » enregistre la lecture
// (announcement_mark_read), une seule fois par compte. Hors connexion : lecture gardée sur l'appareil
// (vocabfr.ann:read:<compte>), l'annonce n'est plus montrée ici et la lecture est renvoyée au lancement suivant.
// Langue : celle de l'interface, sinon une autre langue disponible (français, anglais, coréen, dans cet ordre).
// Script pas lancé : rien ne s'affiche, sans erreur.
// Étape 38 : chaque annonce attend qu'aucune autre fenêtre ne soit ouverte (whenNoModal) ; l'invitation à activer les
// notifications (NotifInvite, js/notif-invite.js) passe après les annonces (auth.js, enterSupabase).
const Ann = (() => {
  const FALLBACK = ["fr", "en", "ko"];
  let busy = false, token = 0;
  const shown = new Set();
  function key() { return CONFIG.LS_USER_PREFIX + "ann:read:" + auth.sbUid; }
  function pending() { try { return arr(JSON.parse(localStorage.getItem(key()) || "[]")).filter(x => UUID_RE.test(String(x))); } catch (e) { return []; } }
  function setPending(ids) { try { if (ids.length) localStorage.setItem(key(), JSON.stringify(ids.slice(-100))); else localStorage.removeItem(key()); } catch (e) {} }
  // Langue à afficher : interface, puis français, anglais, coréen ; seulement une langue qui a un texte.
  function pickLang(a, ui) {
    const has = l => !!(a && ((a.body && String(a.body[l] || "").trim()) || (a.title && String(a.title[l] || "").trim())));
    return [ui].concat(FALLBACK.filter(l => l !== ui)).find(has) || null;
  }
  function texts(a, ui) {
    const l = pickLang(a, ui);
    if (!l) return null;
    return { lang: l, title: String((a.title && a.title[l]) || "").trim(), body: String((a.body && a.body[l]) || "").trim() };
  }
  async function send(id) {
    try { await aqRpc("announcement_mark_read", { p_id: id }); return true; } catch (e) { return false; }
  }
  async function markRead(id) {
    const p = pending();
    if (!p.includes(id)) { p.push(id); setPending(p); }
    if (await send(id)) setPending(pending().filter(x => x !== id));
  }
  async function flush() {
    for (const id of pending()) { if (await send(id)) setPending(pending().filter(x => x !== id)); else break; }
  }
  function showOne(a) {
    return new Promise(res => {
      const tx = texts(a, state.settings.uiLang);
      if (!tx) { res(); return; }
      const body = el("div", "ann-body", tx.body);
      body.lang = tx.lang;
      openModal(tx.title || t("ann.title"), body, [
        { label: t("ann.ok"), kind: "primary", onClick: () => { markRead(a.id); res(); } }
      ], { locked: true });
      const hs = document.querySelectorAll(".modal-bg .modal h3"), h = hs[hs.length - 1];
      if (h && tx.title) h.lang = tx.lang;
    });
  }
  async function check() {
    if (busy || auth.mode !== "supabase" || !auth.sbUid || auth.isAdmin || !Supa.client()) return;
    busy = true;
    const my = ++token, who = auth.sbUid;
    try {
      await flush();
      const list = arr(await aqRpc("my_announcements"));
      const done = new Set(pending());
      for (const a of list) {
        if (my !== token || auth.sbUid !== who || !Storage.getUser()) break;
        if (!a || !a.id || done.has(a.id) || shown.has(a.id)) continue;
        // Étape 38 : jamais par-dessus une autre fenêtre (migration, sauvegarde, conflit…).
        if (!(await whenNoModal(() => my === token && auth.sbUid === who && !!Storage.getUser()))) break;
        shown.add(a.id);
        await showOne(a);
      }
    } catch (e) { /* script de l'étape 27 pas lancé, ou hors connexion : rien */ }
    finally { busy = false; }
  }
  function reset() { token++; busy = false; shown.clear(); }
  return { check, reset, pickLang, texts };
})();

// === RENDER ===
function renderScreen() {
  renderResumeBars();   // traitements interrompus (complétion, Accepter / Refuser groupés)
  if (!Storage.getUser()) { renderAuth(); return; }
  if (currentScreen === "home") renderHome();
  else if (currentScreen === "review") renderReview();
  else if (currentScreen === "lists") renderLists();
  else if (currentScreen === "stats") renderStats();
  else if (currentScreen === "pending") renderPending();
  else if (currentScreen === "settings") renderSettings();
  else if (currentScreen === "friends") renderFriends();
  else if (currentScreen === "admin") renderAdmin();
  else if (currentScreen === "requests") renderRequests();
  else if (currentScreen === "adminreq") renderAdminReq();
  else if (currentScreen === "adminlog") renderAdminLog();
  else if (currentScreen === "adminacc") renderAdminAccounts();
  else if (currentScreen === "adminfiche") renderAdminFiche();
  else if (currentScreen === "adminann") renderAdminAnn();
  else if (currentScreen === "admintpl") renderAdminTpl();
  else if (currentScreen === "adminpush") renderAdminPush();   // notifications push (étape 32)
  else if (currentScreen === "admindict") renderAdminDict();   // dictionnaire commun (étape 36)
  else if (currentScreen === "adminerr") renderAdminErrors();   // journal des erreurs (étape 41)
  else if (currentScreen === "about") renderAbout();   // À propos (étape 39)
  renderPendingBadge();
  Friends.renderBadge();   // demandes d'amis reçues (étape 29)
  Streak.showNotices();   // messages de série en attente (pas pendant une session de révision)
}
function render() {
  if (Storage.getUser()) savePrefs(); // langue et thème repris sur l'écran de connexion
  applyTheme();
  applyI18n();
  renderSyncStatus(Storage.getMode());
  renderScreen();
}

// === INIT ===
// 1) Écran de chargement.
// 2) config.js rempli → Supabase : session gardée sur l'appareil → on entre (nouveau PIN obligatoire si demandé) ;
//    sinon écran de connexion. Bibliothèque Supabase injoignable : dans Claude, repli sur le stockage de l'artifact ;
//    dans le navigateur, message + « Réessayer » (pas de comptes locaux créés par erreur).
// 3) Sans Supabase : cloud de l'artifact (sinon ce navigateur) et registre des comptes, comme avant.
async function init() {
  initNav();
  initSyncStatus();   // étape 33b
  initSettings();
  initLists();
  Streak.watch();   // changement de jour pendant que l'appli est ouverte (étape 28)
  Storage.onMode(m => renderSyncStatus(m));
  Storage.onConflict(() => { const id = Storage.getUser(); if (id) syncWithRemote(id, { conflict: true }, false); });
  Storage.onRetryInit(() => { const id = Storage.getUser(); if (id) syncWithRemote(id, {}, false); });
  Storage.onSyncError(msg => Activity.syncError(msg));   // journal d'activité : erreurs de synchro
  Speech.init(() => { if (!cardsBusy) renderScreen(); }); // affiche les haut-parleurs quand les voix sont prêtes
  AI.onChange(() => { if (Storage.getUser() && currentScreen === "settings") renderSettings(); });
  AI.init(); // Claude depuis la page (capacité "sample"), sinon repli « Préparer pour Claude »

  state = emptyData();
  const old = Storage.readLegacyLocal();
  if (looksLikeAppData(old)) state.settings = normalizeData(old).settings; // langue et thème pour l'écran de connexion
  loadPrefs();
  showAuth("loading");

  if (Supa.configured()) {
    if (await Supa.init()) {
      auth.mode = "supabase";
      Storage.useSupabase(Supa.client());
      let session = null;
      try { session = await Supa.session(); } catch (e) {}
      if (session) {
        try { await enterSupabase(session); return; }
        catch (e) { auth.err = { key: { net: "auth.err.net" }[sbErrKind(e)] || "auth.err.server", vars: null }; }
      }
      showAuth("login");
      return;
    }
    if (!inClaude()) { showAuth("libError"); return; }
  }

  await Storage.connect();
  auth.reg = await Storage.loadAccounts();
  const sid = Storage.getSession();
  if (sid && auth.reg.accounts.some(a => a.id === sid)) { await startUser(sid, null); return; }
  if (!auth.reg.migrated) {
    const legacy = await Storage.readLegacy();
    auth.legacy = legacy ? normalizeData(legacy) : null;
    auth.legacyRaw = legacy || null; // données d'origine (version 1), pour la sauvegarde de sécurité
  }
  showAuth(auth.reg.accounts.length ? "login" : "create");
}

init().catch(() => {
  // Filet de sécurité : l'appli affiche toujours l'écran de connexion.
  try { showAuth(auth.mode === "supabase" || auth.reg.accounts.length ? "login" : "create"); } catch (e) {}
});
