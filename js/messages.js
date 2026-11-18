"use strict";

// === MESSAGES D'ENCOURAGEMENT ET MESSAGES DE L'ÉQUIPE (étape 53) — CÔTÉ UTILISATEUR ===
// Mode Supabase seulement (script claude/supabase-etape53.sql). Textes : js/i18n/messages-<langue>.js (clés mg.*).
// RÈGLE ABSOLUE : entre utilisateurs, jamais de texte libre. Un encouragement = l'identifiant d'un message de la liste fixe
// (cheer_messages, textes ko / fr / en) ; le serveur calcule les variables ({ami}, {serie}, {niveau}) ; chacun lit le
// message dans la langue de SON appli (mgText). Le texte libre n'existe qu'avec l'équipe (fil « L'équipe Vocab »).
// - Écran Amis : carte « 💬 Messages reçus » (non lus, 3 derniers encouragements avec « Merci » en un toucher, fil de l'équipe)
//   et carte « Ce que font tes amis » (friend_events : palier de série, niveau, badge, objectif du jour, duel gagné, retour
//   après inactivité, selon la confidentialité de chacun ; le message adapté s'envoie en un toucher) ; bouton
//   « 💬 Encourager » sur la fiche d'un ami (choix d'un message : Messages.openPicker).
// - Écran « Messages » (#messages, screen-messages, bouton Amis allumé) : onglets « Encouragements » et « L'équipe Vocab »
//   (lecture + réponse en texte libre, 500 caractères, 5 par jour). L'ouvrir marque l'onglet comme lu (msg_read).
// - « ✉️ Écrire à l'équipe » : carte des Réglages (#msgTeamCard) et carte d'À propos → écran Messages, onglet équipe.
// - Réglage « Recevoir les encouragements de mes amis » (Réglages → Amis, activé par défaut) : cheer_settings.
// - Badge du menu Amis : + messages non lus (msg_unread, toutes les 5 min avec le badge des demandes d'amis).
// Limites du serveur (erreurs P0001 + hint, messages mg.err.<hint>) : 10 envois par 24 h, le même message au même ami une fois
// par 24 h, seulement entre amis acceptés, jamais vers un compte bloqué ou qui a coupé les encouragements.
const MG_TEAM_MAX = 500;
const MG_EV_ICON = { streak: "🔥", level: "⭐", badge: "🏅", goal: "🎯", duel: "⚔️", back: "👋" };
const mg = {
  status: "unknown",              // unknown | ok | missing (script de l'étape 53 pas lancé)
  catalog: null, catAt: 0,        // messages actifs (cheer_catalog)
  events: null, evErr: "",        // friend_events
  inbox: null, inErr: "", inLoading: false, inAt: 0,
  unread: { cheers: 0, team: 0 },
  tab: "cheers", back: "friends", draft: "", busy: false, fresh: new Set(), showAll: false
};

// Texte d'un message prédéfini dans la langue de l'appli (repli : fr, en, ko), variables remplacées.
function mgText(m, vars) {
  if (!m) return "";
  const L = (state && state.settings && state.settings.uiLang) || "fr";
  const s = String(m[L] || m.fr || m.en || m.ko || "");
  return s.replace(/\{(ami|serie|niveau)\}/g, (x, k) => (vars && vars[k] != null ? String(vars[k]) : x));
}
// Variables demandées par le texte d'un message.
function mgNeeds(m) {
  const s = m ? String(m.ko || "") + String(m.fr || "") + String(m.en || "") : "";
  return { serie: s.includes("{serie}"), niveau: s.includes("{niveau}") };
}
function mgTime(ts) {
  try {
    const d = new Date(ts);
    if (isNaN(d)) return "";
    const today = todayStr(), day = todayStr(d);
    const hm = d.toLocaleTimeString(state.settings.uiLang, { hour: "2-digit", minute: "2-digit" });
    if (day === today) return hm;
    return d.toLocaleDateString(state.settings.uiLang, { day: "numeric", month: "short" }) + " " + hm;
  } catch (e) { return ""; }
}

const Messages = (() => {
  let token = 0, who = null;
  function on() {
    try { return auth.mode === "supabase" && !!auth.sbUid && !!Supa.client() && !!Storage.getUser(); } catch (e) { return false; }
  }
  async function rpc(name, args) {
    const cl = Supa.client();
    if (!cl) throw new Error("no client");
    const r = await withTimeout(cl.rpc(name, args || {}), 20000);
    if (r && r.error) throw r.error;
    return r ? r.data : null;
  }
  function isMissing(e) {
    const code = String((e && e.code) || ""), msg = String((e && (e.message || e.msg)) || "");
    return ["PGRST202", "42883", "PGRST205", "42P01"].includes(code) || /could not find|does not exist|schema cache/i.test(msg);
  }
  function errText(e) {
    const h = String((e && e.hint) || "");
    if (h && I18N.fr["mg.err." + h]) return t("mg.err." + h);
    if (isMissing(e)) return t("mg.missing");
    if (sbErrKind(e) === "net") return t("mg.err.offline");
    return t("mg.err.other");
  }
  function miss(e) { if (isMissing(e)) mg.status = "missing"; }
  function checkUser() {
    const u = auth.sbUid || null;
    if (u !== who) {
      who = u; token++;
      mg.status = "unknown"; mg.catalog = null; mg.catAt = 0; mg.events = null; mg.evErr = ""; mg.inbox = null; mg.inErr = "";
      mg.inAt = 0; mg.unread = { cheers: 0, team: 0 }; mg.tab = "cheers"; mg.draft = ""; mg.busy = false; mg.fresh.clear(); mg.showAll = false;
    }
  }
  function rerender() {
    try {
      if (currentScreen === "friends") renderFriends();
      else if (currentScreen === "messages") renderMessages();
      else if (currentScreen === "settings") { renderTeamCard(); renderFriendsPrivCard(); }
      else if (currentScreen === "about") renderAbout();
    } catch (e) {}
    try { Friends.renderBadge(); } catch (e) {}
  }

  // --- Chargements (jamais d'erreur levée) ---
  async function loadCatalog(force) {
    if (!on()) return null;
    if (!force && mg.catalog && Date.now() - mg.catAt < 600000) return mg.catalog;
    try { mg.catalog = arr(await rpc("cheer_catalog")); mg.catAt = Date.now(); mg.status = "ok"; }
    catch (e) { miss(e); }
    return mg.catalog;
  }
  async function loadEvents() {
    checkUser();
    if (!on() || mg.status === "missing") return null;
    try { mg.events = await rpc("friend_events", { p_today: todayStr() }); mg.evErr = ""; mg.status = "ok"; }
    catch (e) { miss(e); mg.evErr = errText(e); }
    return mg.events;
  }
  async function loadInbox() {
    checkUser();
    if (!on() || mg.status === "missing") return null;
    const my = token;
    mg.inLoading = true;
    try {
      const d = await rpc("msg_inbox");
      if (my !== token) return null;
      mg.inbox = d || null; mg.inErr = ""; mg.status = "ok"; mg.inAt = Date.now();
      if (d) mg.unread = { cheers: num(Number(d.unread_cheers), 0), team: num(Number(d.unread_team), 0) };
    } catch (e) { if (my === token) { miss(e); mg.inErr = errText(e); } }
    mg.inLoading = false;
    return mg.inbox;
  }
  // Avec l'écran Amis (Friends.load) : liste, événements et messages reçus.
  async function loadAll() {
    checkUser();
    if (!on()) return;
    await loadCatalog(false);
    if (mg.status === "missing") return;
    await Promise.all([loadEvents(), loadInbox()]);
  }
  async function refreshUnread() {
    checkUser();
    if (!on() || mg.status === "missing") return;
    try {
      const u = await rpc("msg_unread");
      const old = mg.unread;
      mg.unread = { cheers: num(Number(u && u.cheers), 0), team: num(Number(u && u.team), 0) }; mg.status = "ok";
      // Nouveaux messages pendant que l'écran Amis ou Messages est ouvert : liste relue et écran redessiné.
      if ((mg.unread.cheers !== old.cheers || mg.unread.team !== old.team) && ["friends", "messages", "settings", "about"].includes(currentScreen)) {
        if (currentScreen === "friends" || currentScreen === "messages") loadInbox().then(rerender); else rerender();
      }
    } catch (e) { miss(e); }
  }
  function unreadCount() { return on() && mg.status !== "missing" ? mg.unread.cheers + mg.unread.team : 0; }
  function receive() { return !mg.inbox || mg.inbox.receive !== false; }

  // --- Envoyer ---
  function friendOff(uid) { return arr(mg.events && mg.events.off).includes(uid); }
  function alreadySent(uid, mid) { return arr(mg.events && mg.events.sent).some(x => x && x.to === uid && x.message === mid); }
  function dayLeft() {
    const e = mg.events;
    return e ? Math.max(0, num(Number(e.day_max), 10) - num(Number(e.day_used), 0)) : 10;
  }
  async function send(friend, mid, after) {
    if (!on() || mg.busy) return false;
    mg.busy = true;
    rerender();
    let ok = false;
    try {
      const r = await rpc("cheer_send", { p_friend: friend.user_id, p_message: mid });
      ok = true;
      toast(t("mg.sent", { id: friend.identifiant || "?" }));
      if (mg.events && r) {
        mg.events.sent = arr(mg.events.sent).concat([{ to: friend.user_id, message: mid }]);
        mg.events.day_used = num(Number(r.day_used), num(Number(mg.events.day_used), 0) + 1);
        arr(mg.events.events).forEach(ev => { if (ev.user_id === friend.user_id && ev.message === mid) ev.sent = true; });
      }
    } catch (e) { toast(errText(e)); if (["cheer_off", "cheer_day", "cheer_same"].includes(String((e && e.hint) || ""))) loadEvents().then(rerender); }
    mg.busy = false;
    if (after) after(ok);
    rerender();
    return ok;
  }
  // Fenêtre « 💬 Encourager » : messages actifs ; grisés si la variable manque (série / niveau cachés), si déjà envoyé à cet
  // ami aujourd'hui ; ami qui a coupé les encouragements ou limite du jour atteinte : explication.
  async function openPicker(friend, stats) {
    if (!on()) { toast(t("mg.local")); return; }
    if (!mg.catalog) await loadCatalog(true);
    if (mg.status === "missing") { toast(t("mg.missing")); return; }
    if (!mg.events) await loadEvents();
    const box = el("div", "mg-pick");
    box.appendChild(el("p", "muted", t("mg.pickIntro", { id: friend.identifiant })));
    let close = null;
    if (friendOff(friend.user_id)) box.appendChild(el("p", "q-note", t("mg.err.cheer_off")));
    else if (!dayLeft()) box.appendChild(el("p", "q-note", t("mg.err.cheer_day")));
    else {
      const s = stats || {};
      const list = el("div", "mg-pick-list");
      arr(mg.catalog).filter(m => m.category !== "thanks").forEach(m => {
        const need = mgNeeds(m);
        const vars = { ami: Storage.getUser(), serie: num(Number(s.streak), 0) || null, niveau: num(Number(s.level), 0) || null };
        const noVar = (need.serie && !vars.serie) || (need.niveau && !vars.niveau);
        if (!vars.serie) vars.serie = "…";
        if (!vars.niveau) vars.niveau = "…";
        const sent = alreadySent(friend.user_id, m.id);
        const b = el("button", "mg-pick-btn", mgText(m, vars));
        b.type = "button";
        b.disabled = noVar || sent;
        if (sent) b.appendChild(el("small", "muted", " · " + t("mg.sentToday")));
        else if (noVar) b.appendChild(el("small", "muted", " · " + t("mg.noVar")));
        b.addEventListener("click", () => { send(friend, m.id, ok => { if (ok && close) close(); }); });
        list.appendChild(b);
      });
      box.appendChild(list);
      box.appendChild(el("p", "hint", t("mg.left", { n: dayLeft() })));
      box.appendChild(el("p", "hint", t("mg.noFree")));
    }
    close = openModal("💬 " + t("mg.cheerTitle", { id: friend.identifiant }), box, [{ label: t("cancel") }]);
  }
  async function thanks(c) {
    if (!on() || mg.busy) return;
    mg.busy = true;
    rerender();
    try {
      const r = await rpc("cheer_thanks", { p_cheer: c.id });
      c.thanked_at = new Date().toISOString();
      if (!c.read_at) { c.read_at = c.thanked_at; mg.unread.cheers = Math.max(0, mg.unread.cheers - 1); }
      toast(r && r.already ? t("mg.thanksAlready", { id: c.identifiant }) : t("mg.thanksSent", { id: c.identifiant }));
    } catch (e) { toast(errText(e)); }
    mg.busy = false;
    rerender();
  }

  // --- Fil « L'équipe Vocab » ---
  async function sendTeam(text) {
    const body = String(text || "").trim();
    if (!body) { toast(t("mg.err.msg_body")); return false; }
    if (!on() || mg.busy) return false;
    mg.busy = true;
    rerender();
    let ok = false;
    try {
      await rpc("msg_team_send", { p_body: body.slice(0, MG_TEAM_MAX) });
      ok = true; mg.draft = "";
      toast(t("mg.teamSent"));
      await loadInbox();
    } catch (e) { toast(errText(e)); }
    mg.busy = false;
    rerender();
    return ok;
  }
  // Marque un onglet comme lu (serveur) ; les messages restent mis en évidence pendant cette visite.
  async function markRead(kind) {
    if (!on() || mg.status === "missing" || !mg.inbox) return;
    const n = kind === "team" ? mg.unread.team : mg.unread.cheers;
    if (!n) return;
    const now = new Date().toISOString();
    if (kind === "team") arr(mg.inbox.team).forEach(m => { if (m.dir === "to_user" && !m.read_at) { mg.fresh.add(m.id); m.read_at = now; } });
    else arr(mg.inbox.cheers).forEach(c => { if (!c.read_at) { mg.fresh.add(c.id); c.read_at = now; } });
    if (kind === "team") mg.unread.team = 0; else mg.unread.cheers = 0;
    try { Friends.renderBadge(); } catch (e) {}
    try { await rpc("msg_read", { p_kind: kind }); } catch (e) {}
  }
  async function setReceive(v) {
    if (!on()) return;
    try {
      await rpc("cheer_settings", { p_receive: !!v });
      if (mg.inbox) mg.inbox.receive = !!v;
      toast(t(v ? "mg.receiveOn" : "mg.receiveOff"));
    } catch (e) { toast(errText(e)); }
    rerender();
  }
  function openScreen(tab, back) {
    mg.tab = tab === "team" ? "team" : "cheers";
    mg.back = back || (typeof currentScreen !== "undefined" ? currentScreen : "friends");
    if (!["friends", "settings", "about"].includes(mg.back)) mg.back = "friends";
    location.hash = "#" + HASH_OF.messages;
  }

  // --- Cartes « Écrire à l'équipe » (Réglages, À propos) ---
  function teamBody(card) {
    card.appendChild(el("h2", null, "✉️ " + t("mg.teamTitle")));
    card.appendChild(el("p", "muted mg-sub", t("mg.teamHelp")));
    const btns = el("div", "btns");
    const b = el("button", "btn", t("mg.writeTeam"));
    b.type = "button";
    b.addEventListener("click", () => openScreen("team"));
    btns.appendChild(b);
    if (mg.unread.team) {
      const n = el("span", "mg-dot", String(mg.unread.team));
      n.setAttribute("aria-label", t("mg.unreadN", { n: mg.unread.team }));
      b.appendChild(n);
    }
    card.appendChild(btns);
  }
  function renderTeamCard() {
    const card = $("#msgTeamCard");
    if (!card) return;
    card.hidden = !on() || mg.status === "missing";
    if (card.hidden) return;
    card.textContent = "";
    teamBody(card);
  }
  function aboutCard() {
    if (!on() || mg.status === "missing") return null;
    const card = el("div", "card mg-about");
    teamBody(card);
    return card;
  }

  // --- Écran Amis : cartes « Messages reçus » et « Ce que font tes amis » ---
  function friendsCards(root, friendsCount) {
    if (!on() || mg.status === "missing") return;
    const ib = mg.inbox;
    // Messages reçus
    const c = el("div", "card mg-card");
    const head = el("div", "mg-head");
    const n = unreadCount();
    head.appendChild(el("h2", null, "💬 " + t("mg.inboxTitle") + (n ? " " : "")));
    if (n) head.querySelector("h2").appendChild(el("span", "mg-dot", String(n)));
    const all = el("button", "link-btn", t("mg.seeAll"));
    all.type = "button";
    all.addEventListener("click", () => openScreen(mg.unread.cheers || !mg.unread.team ? "cheers" : "team", "friends"));
    head.appendChild(all);
    c.appendChild(head);
    if (!ib) c.appendChild(el("p", "muted", mg.inErr || t("am.loading")));
    else {
      const cheers = arr(ib.cheers);
      if (!cheers.length) c.appendChild(el("p", "muted mg-sub", t("mg.noCheers")));
      cheers.slice(0, 3).forEach(x => c.appendChild(cheerRow(x, true)));
      const team = el("button", "mg-team-line", "");
      team.type = "button";
      team.append(el("span", null, "✉️ " + t("mg.team")), el("span", "muted", mg.unread.team ? t("mg.unreadN", { n: mg.unread.team }) : t("mg.teamOpen")));
      if (mg.unread.team) team.classList.add("on");
      team.addEventListener("click", () => openScreen("team", "friends"));
      c.appendChild(team);
      if (ib.receive === false) c.appendChild(el("p", "hint", t("mg.offHint")));
    }
    root.appendChild(c);
    // Ce que font tes amis
    if (!friendsCount) return;
    const e = el("div", "card mg-card");
    e.appendChild(el("h2", null, "✨ " + t("mg.evTitle")));
    const evs = arr(mg.events && mg.events.events);
    if (!mg.events) e.appendChild(el("p", "muted", mg.evErr || t("am.loading")));
    else if (!evs.length) e.appendChild(el("p", "muted mg-sub", t("mg.evNone")));
    else {
      const shown = mg.showAll ? evs : evs.slice(0, 6);
      shown.forEach(ev => e.appendChild(eventRow(ev)));
      if (evs.length > shown.length) {
        const more = el("button", "link-btn", t("mg.evMore", { n: evs.length - shown.length }));
        more.type = "button";
        more.addEventListener("click", () => { mg.showAll = true; rerender(); });
        e.appendChild(more);
      }
      e.appendChild(el("p", "hint", t("mg.left", { n: dayLeft() })));
    }
    root.appendChild(e);
  }
  function evText(ev) {
    const v = { id: ev.identifiant, n: ev.value };
    if (ev.kind === "streak") return t(ev.badge ? "mg.ev.streakBadge" : "mg.ev.streak", v);
    return t("mg.ev." + (MG_EV_ICON[ev.kind] ? ev.kind : "goal"), v);
  }
  function eventRow(ev) {
    const row = el("div", "mg-ev");
    row.appendChild(el("span", "mg-ev-ic", MG_EV_ICON[ev.kind] || "✨"));
    const tx = el("div", "mg-ev-tx");
    tx.append(el("div", null, evText(ev)), el("div", "muted mg-time", mgTime(ev.at)));
    row.appendChild(tx);
    const m = arr(mg.catalog).find(x => x.id === ev.message);
    if (m) {
      const off = friendOff(ev.user_id);
      const b = el("button", "am-btn" + (ev.sent || off ? "" : " primary") + " mg-ev-btn", ev.sent ? "✓ " + t("mg.sentShort") : "💬 " + mgText(m, { serie: ev.kind === "streak" ? ev.value : null, niveau: ev.kind === "level" ? ev.value : null }));
      b.type = "button";
      b.disabled = !!ev.sent || off || mg.busy || !dayLeft();
      if (off) b.title = t("mg.err.cheer_off");
      b.addEventListener("click", () => send({ user_id: ev.user_id, identifiant: ev.identifiant }, m.id));
      row.appendChild(b);
    }
    return row;
  }
  // Un encouragement reçu : expéditeur, message (langue de l'appli), heure, « 😊 Merci ».
  function cheerRow(x, compact) {
    const row = el("div", "mg-cheer" + (!x.read_at || mg.fresh.has(x.id) ? " mg-new" : ""));
    const tx = el("div", "mg-cheer-tx");
    tx.append(el("div", "mg-cheer-m", mgText(x.message, x.vars)),
      el("div", "muted mg-time", t("mg.from", { id: x.identifiant || "?" }) + " · " + mgTime(x.created_at)));
    row.appendChild(tx);
    const canThank = x.message && x.message.category !== "thanks" && x.friend !== false && arr(mg.catalog).some(m => m.category === "thanks");
    if (x.thanked_at) row.appendChild(el("span", "muted mg-thanked", "✓ " + t("mg.thanked")));
    else if (canThank) {
      const b = el("button", "am-btn", "😊 " + t("mg.thanks"));
      b.type = "button"; b.disabled = mg.busy;
      b.addEventListener("click", () => thanks(x));
      row.appendChild(b);
    }
    if (compact) row.classList.add("mg-compact");
    return row;
  }

  // --- Lancement / arrêt ---
  // Au lancement (Friends.start) : liste des messages et non lus ; ensuite, les non lus sont relus avec le badge des
  // demandes d'amis (Friends.refreshBadge, toutes les 5 min et au retour au premier plan).
  function start() {
    checkUser();
    if (!on()) return;
    loadCatalog(true).then(() => refreshUnread()).then(() => { try { Friends.renderBadge(); renderTeamCard(); } catch (e) {} });
  }
  function reset() { who = "__reset__"; checkUser(); }
  return {
    on, rpc, isMissing, errText, loadAll, loadEvents, loadInbox, loadCatalog, refreshUnread, unreadCount, receive, start, reset,
    openPicker, send, thanks, sendTeam, markRead, setReceive, openScreen, renderTeamCard, aboutCard, friendsCards, cheerRow,
    status: () => mg.status
  };
})();

// --- Écran « Messages » (#messages) : encouragements reçus et fil « L'équipe Vocab » ---
function renderMessages() {
  const root = $("#screen-messages");
  if (!root) return;
  root.textContent = "";
  const backTo = mg.back || "friends";
  const back = el("button", "link-btn", "‹ " + t(backTo === "settings" ? "nav.settings" : backTo === "about" ? "about.title" : "nav.friends"));
  back.type = "button";
  back.addEventListener("click", () => { location.hash = "#" + HASH_OF[backTo]; });
  root.appendChild(back);
  const top = el("div", "adm-top");
  top.appendChild(el("h2", null, "💬 " + t("mg.title")));
  if (Messages.on()) {
    const ref = el("button", "link-btn", t("am.refresh"));
    ref.type = "button";
    ref.addEventListener("click", () => { Messages.loadAll().then(renderMessages); });
    top.appendChild(ref);
  }
  root.appendChild(top);
  if (!Messages.on()) { root.appendChild(el("div", "card q-note", t("mg.local"))); return; }
  if (mg.status === "missing") { root.appendChild(el("div", "card q-err", t("mg.missing"))); return; }
  if (!mg.inbox && !mg.inLoading && !mg.inErr) { root.appendChild(el("div", "empty", t("admin.loading"))); Messages.loadAll().then(() => { if (currentScreen === "messages") renderMessages(); }); return; }
  if (!mg.inbox) {                                     // erreur (hors connexion…) : pas de nouvel essai automatique en boucle
    root.appendChild(el("div", mg.inErr ? "card q-err" : "empty", mg.inErr || t("admin.loading")));
    if (mg.inErr) {
      const b = el("button", "btn", t("am.refresh"));
      b.type = "button";
      b.addEventListener("click", () => { mg.inErr = ""; renderMessages(); });
      root.appendChild(b);
    }
    return;
  }
  // Données de plus d'une minute, ou nouveaux messages signalés par le badge (msg_unread) mais absents de la liste : relues.
  const shownUnread = k => k === "team" ? arr(mg.inbox.team).filter(m => m.dir === "to_user" && !m.read_at).length : arr(mg.inbox.cheers).filter(c => !c.read_at).length;
  if (!mg.inLoading && (Date.now() - mg.inAt > 60000 || mg.unread.team > shownUnread("team") || mg.unread.cheers > shownUnread("cheers"))) {
    Messages.loadInbox().then(() => { if (currentScreen === "messages") renderMessages(); });
    if (mg.unread.team > shownUnread("team") || mg.unread.cheers > shownUnread("cheers")) { root.appendChild(el("div", "empty", t("admin.loading"))); return; }
  }
  const tabs = el("div", "seg mg-tabs");
  [["cheers", t("mg.tabCheers"), mg.unread.cheers], ["team", t("mg.team"), mg.unread.team]].forEach(([k, lab, n]) => {
    const b = el("button", null, lab);
    b.type = "button";
    b.setAttribute("aria-pressed", String(mg.tab === k));
    if (n) b.appendChild(el("span", "mg-dot", String(n)));
    b.addEventListener("click", () => { mg.tab = k; renderMessages(); });
    tabs.appendChild(b);
  });
  root.appendChild(tabs);
  if (mg.inErr) root.appendChild(el("div", "card q-err", mg.inErr));
  if (mg.tab === "team") mgTeamTab(root);
  else mgCheersTab(root);
  Messages.markRead(mg.tab === "team" ? "team" : "cheers");
}
function mgCheersTab(root) {
  const ib = mg.inbox;
  const list = arr(ib.cheers);
  const c = el("div", "card");
  if (!list.length) c.appendChild(el("p", "muted", t("mg.noCheers")));
  list.forEach(x => c.appendChild(Messages.cheerRow(x, false)));
  root.appendChild(c);
  root.appendChild(el("p", "hint", t("mg.keep30")));
  if (ib.receive === false) root.appendChild(el("p", "hint", t("mg.offHint")));
}
function mgTeamTab(root) {
  const ib = mg.inbox;
  const c = el("div", "card mg-thread");
  c.appendChild(el("p", "muted mg-sub", t("mg.teamIntro")));
  const msgs = arr(ib.team);
  if (!msgs.length) c.appendChild(el("p", "muted", t("mg.teamNone")));
  const list = el("div", "mg-bubbles");
  msgs.forEach(m => {
    const mine = m.dir === "to_team";
    const b = el("div", "mg-bubble " + (mine ? "mine" : "team") + (!mine && (!m.read_at || mg.fresh.has(m.id)) ? " mg-new" : ""));
    b.appendChild(el("div", "mg-who", mine ? t("mg.me") : t("mg.team")));
    b.appendChild(el("div", "mg-body", m.body ? m.body : mgText(m.message, m.vars)));
    const meta = mgTime(m.created_at) + (mine ? " · " + t(m.read_at ? "mg.readByTeam" : "mg.notRead") : "");
    b.appendChild(el("div", "mg-time", meta));
    list.appendChild(b);
  });
  c.appendChild(list);
  root.appendChild(c);
  // Écrire
  const f = el("div", "card mg-compose");
  const ta = el("textarea", "input mg-ta");
  ta.id = "mgTeamText"; ta.rows = 4; ta.maxLength = MG_TEAM_MAX; ta.value = mg.draft;
  ta.placeholder = t("mg.teamPh");
  const lab = el("label", null, t("mg.writeTeam")); lab.htmlFor = ta.id;
  const cnt = el("span", "ix-count", ta.value.length + " / " + MG_TEAM_MAX);
  ta.addEventListener("input", () => { mg.draft = ta.value; cnt.textContent = ta.value.length + " / " + MG_TEAM_MAX; });
  const used = num(Number(ib.team_day_used), 0), max = num(Number(ib.team_day_max), 5);
  const left = Math.max(0, max - used);
  const send = el("button", "btn primary", t("mg.send"));
  send.type = "button";
  send.disabled = mg.busy || !left;
  send.addEventListener("click", () => { Messages.sendTeam(ta.value); });
  f.append(lab, ta, cnt, el("p", "hint", left ? t("mg.teamLeft", { n: left }) : t("mg.err.msg_team_day")), send);
  root.appendChild(f);
}
