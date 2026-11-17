"use strict";

// === NOTIFICATIONS PUSH ===
// Étape 32. Mode Supabase seulement (script supabase-etape32.sql + fonction send-push + sw.js complété).
// Sans le script : Réglages → Notifications affiche un message clair, le reste de l'appli marche comme avant.
// - Résumé publié (table user_status, jamais lue par les amis) : cartes à réviser aujourd'hui, propositions « À valider »,
//   langues apprises, langue de l'interface, fuseau horaire. Publié au lancement, après chaque session et après
//   « À valider » (UserStatus.publish), seulement s'il a changé.
// - Abonnement de cet appareil : seulement après le bouton « Activer » (jamais de demande d'autorisation au lancement).
//   push_subscribe(device_id, endpoint, clés) ; l'appareil se souvient qu'il est activé pour ce compte
//   (localStorage vocabfr.push:on:<identifiant>) : à la reconnexion, l'abonnement est réenregistré sans rien demander.
//   Déconnexion : l'abonnement de cet appareil est retiré du compte (pas de notification pour un compte déconnecté).
// - Préférences du compte (table notification_prefs) : catégories Rappels / Série / Amis / Annonces, heures calmes
//   (22 h → 8 h par défaut, à l'heure de l'appareil). Valables pour tous les appareils du compte.
// - Notification touchée : sw.js ouvre l'appli sur ?n=<id>#écran (ou envoie un message à l'onglet ouvert) ;
//   l'appli enregistre le clic (push_mark_clicked) puis retire ?n= de l'adresse.
// - Bandeau unique après la première session terminée (vocabfr.push:offered:<identifiant>).
// - Étape 34 : événements pour les notifications automatiques (PushEvents : palier de série atteint, gel utilisé),
//   envoyés au serveur par push_event ; variable {ami} (demande d'ami, invitation de partage).
const PUSH_CATS = ["reminders", "streak", "friends", "announcements"];
const PUSH_SCREENS = ["home", "review", "lists", "pending", "stats", "friends"];
const PUSH_VARS = ["identifiant", "serie", "record", "objectif", "a_reviser", "a_valider", "jours_inactif", "ami"];
const PUSH_FALLBACK = ["fr", "en", "ko"];   // même ordre de repli que les annonces et la fonction send-push
const PUSH_FN = "send-push";

// Texte du modèle dans une langue (langue de l'interface du compte, sinon repli) et variables remplacées.
function pushPickLang(tx, ui) {
  const has = l => !!(String((tx.title || {})[l] || "").trim() || String((tx.body || {})[l] || "").trim());
  return [ui].concat(PUSH_FALLBACK.filter(l => l !== ui)).find(has) || null;
}
function pushRender(text, vars) {
  return String(text || "").replace(/\{([a-z_]+)\}/g, (m, k) => (PUSH_VARS.includes(k) && vars && vars[k] != null ? String(vars[k]) : m));
}
function pushIsMissing(e) { return alIsMissing(e); }

const UserStatus = (() => {
  let last = "", busy = null, status = "unknown";
  function on() { return auth.mode === "supabase" && !!auth.sbUid && !!Supa.client() && !!Storage.getUser(); }
  function row() {
    const langs = new Set();
    try { learningOf().forEach(x => langs.add(x.lang)); langs.add(accountLangs().target); } catch (e) {}   // profil de langues (étape 35)
    arr(state.lists).forEach(l => { try { if (cardsOf(l.id).length) langs.add(listLangs(l).target); } catch (e) {} });
    let pending = 0;
    try { pending = liveProposals().length; } catch (e) {}
    return {
      user_id: auth.sbUid, day: todayStr(),
      due_today: Math.min(dueCount(arr(state.cards), Date.now()), 1000000),
      pending: Math.min(pending, 1000000),
      target_langs: [...langs].filter(isLang).slice(0, 10),
      ui_lang: state.settings.uiLang, tz: dashTz().slice(0, 64), app_version: APP_VERSION
    };
  }
  // Écrit ma ligne si elle a changé. Jamais d'erreur visible.
  function publish(force) {
    if (!on() || status === "missing") return Promise.resolve(false);
    if (busy) return busy.then(() => publish(force));
    let r;
    try { r = row(); } catch (e) { return Promise.resolve(false); }
    const key = JSON.stringify(r);
    if (!force && key === last) return Promise.resolve(true);
    busy = (async () => {
      try {
        const res = await withTimeout(Supa.client().from("user_status").upsert(r, { onConflict: "user_id" }), 15000);
        if (res && res.error) throw res.error;
        last = key; status = "ok";
        return true;
      } catch (e) { if (pushIsMissing(e)) status = "missing"; return false; }
    })();
    return busy.finally(() => { busy = null; });
  }
  return { publish, reset: () => { last = ""; status = "unknown"; } };
})();

const Push = (() => {
  let st = null;               // my_push_state : { key, registered, devices, prefs }
  let loading = false, missing = false, err = "", busy = false, endpoint = null, token = 0;
  let pendingClick = null;     // ?n=<id> à l'ouverture (notification touchée)
  let saveT = null;
  function on() { return auth.mode === "supabase" && !!auth.sbUid && !!Supa.client() && !!Storage.getUser(); }
  function lsKey(k) { return CONFIG.LS_USER_PREFIX + "push:" + k + ":" + (Storage.getUser() || ""); }
  function flag(k) { try { return localStorage.getItem(lsKey(k)) === "1"; } catch (e) { return false; } }
  function setFlag(k, v) { try { if (v) localStorage.setItem(lsKey(k), "1"); else localStorage.removeItem(lsKey(k)); } catch (e) {} }
  async function rpc(name, args) {
    const r = await withTimeout(Supa.client().rpc(name, args || {}), 15000);
    if (r && r.error) throw r.error;
    return r ? r.data : null;
  }
  // Ce que permet cet appareil : ok | ios_install (iPhone / iPad, appli pas installée) | ios_old (iOS trop ancien)
  // | unsupported (navigateur sans notifications push) | nosw (aperçu Claude ou page sans service worker).
  function support() {
    const d = deviceInfo(), ios = d.os === "iOS" || d.os === "iPadOS";
    if (ios && !d.installed) return "ios_install";
    let has = false;
    try { has = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window; } catch (e) {}
    if (!has) return ios ? "ios_old" : "unsupported";
    if (inClaude() || location.protocol !== "https:") return "nosw";
    return "ok";
  }
  function permission() { try { return window.Notification ? Notification.permission : "default"; } catch (e) { return "default"; } }
  async function registration() {
    if (!("serviceWorker" in navigator)) return null;
    try {
      const r = await navigator.serviceWorker.getRegistration();
      if (r) return r;
      return await withTimeout(navigator.serviceWorker.ready, 6000);   // pwa.js l'enregistre au chargement
    } catch (e) { return null; }
  }
  async function browserSub() {
    if (support() !== "ok") return null;
    const reg = await registration();
    if (!reg || !reg.pushManager) return null;
    try { return await reg.pushManager.getSubscription(); } catch (e) { return null; }
  }
  function b64uToBytes(s) {
    let t0 = String(s || "").replace(/-/g, "+").replace(/_/g, "/");
    while (t0.length % 4) t0 += "=";
    const bin = atob(t0), out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function bytesToB64u(buf) {
    const u = new Uint8Array(buf);
    let s = "";
    for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  async function register(sub) {
    const j = sub.toJSON();
    await rpc("push_subscribe", { p_device: deviceId(), p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth });
  }
  function rerender() { if (currentScreen === "settings") renderPushCard(); }
  // État de cet appareil et préférences du compte. Si l'appareil était activé pour ce compte, réenregistre
  // l'abonnement s'il manque (reconnexion, adresse renouvelée par le navigateur).
  async function refresh() {
    if (!on()) return;
    const my = ++token;
    loading = true; err = "";
    rerender();
    try {
      const sub = await browserSub();
      endpoint = sub ? sub.endpoint : null;
      st = await rpc("my_push_state", { p_endpoint: endpoint });
      missing = false;
      if (sub && !st.registered && flag("on") && permission() === "granted") {
        try { await register(sub); st = await rpc("my_push_state", { p_endpoint: endpoint }); } catch (e) {}
      }
    } catch (e) {
      if (pushIsMissing(e)) missing = true;
      else err = sbErrKind(e) === "net" ? t("np.err.net") : t("np.err.other");
    }
    if (my !== token) return;
    loading = false;
    rerender();
  }
  async function enable() {
    if (busy || support() !== "ok") return;
    busy = true; err = ""; rerender();
    try {
      let perm = permission();
      if (perm !== "granted") perm = await Notification.requestPermission();
      if (perm !== "granted") { err = perm === "denied" ? "" : t("np.err.notAllowed"); return; }
      const reg = await registration();
      if (!reg || !reg.pushManager) { err = t("np.nosw"); return; }
      const key = (st && st.key) || await rpc("push_public_key");
      if (!key) { err = auth.isAdmin ? t("np.noKeyAdmin") : t("np.noKey"); return; }
      let sub = await reg.pushManager.getSubscription();
      if (sub) {   // abonnement fait avec une autre clé : on le refait
        let same = true;
        try { const k = sub.options && sub.options.applicationServerKey; if (k) same = bytesToB64u(k) === key; } catch (e) {}
        if (!same) { try { await sub.unsubscribe(); } catch (e) {} sub = null; }
      }
      if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uToBytes(key) });
      await register(sub);
      setFlag("on", true); setFlag("offered", true);
      endpoint = sub.endpoint;
      toast(t("np.enabled"));
      st = await rpc("my_push_state", { p_endpoint: endpoint });
    } catch (e) {
      if (pushIsMissing(e)) missing = true;
      else if (String((e && e.code) || "") === "42501") err = t("am.err.account_blocked");
      else err = sbErrKind(e) === "net" ? t("np.err.net") : t("np.err.subscribe");
    } finally { busy = false; rerender(); }
  }
  async function disable() {
    if (busy) return;
    busy = true; err = ""; rerender();
    try {
      const sub = await browserSub();
      if (sub) { try { await rpc("push_unsubscribe", { p_endpoint: sub.endpoint }); } catch (e) {} try { await sub.unsubscribe(); } catch (e) {} }
      setFlag("on", false);
      endpoint = null;
      st = await rpc("my_push_state", { p_endpoint: null });
      toast(t("np.disabled"));
    } catch (e) { err = sbErrKind(e) === "net" ? t("np.err.net") : t("np.err.other"); }
    finally { busy = false; rerender(); }
  }
  // Préférences : enregistrées 600 ms après le dernier changement.
  function setPref(k, v) {
    if (!st) return;
    st.prefs = Object.assign({}, st.prefs, { [k]: v });
    clearTimeout(saveT);
    saveT = setTimeout(savePrefs, 600);
  }
  async function savePrefs() {
    if (!on() || !st) return;
    const p = st.prefs, hm = v => (/^\d{2}:\d{2}$/.test(v || "") ? v : null);
    const row = {
      user_id: auth.sbUid, cat_reminders: p.reminders !== false, cat_streak: p.streak !== false,
      cat_friends: p.friends !== false, cat_announcements: p.announcements !== false,
      quiet_on: p.quiet_on !== false, quiet_start: hm(p.quiet_start) || "22:00", quiet_end: hm(p.quiet_end) || "08:00",
      tz: dashTz().slice(0, 64)
    };
    try {
      const r = await withTimeout(Supa.client().from("notification_prefs").upsert(row, { onConflict: "user_id" }), 15000);
      if (r && r.error) throw r.error;
      toast(t("np.saved"));
    } catch (e) { toast(sbErrKind(e) === "net" ? t("np.err.net") : t("np.err.save")); }
  }
  // Notification touchée : clic enregistré (une fois), puis l'adresse est nettoyée.
  async function markClicked(id) {
    if (!id || !UUID_RE.test(id) || !on()) return;
    try { await rpc("push_mark_clicked", { p_id: id }); } catch (e) {}
  }
  function readClickParam() {
    try {
      const u = new URL(location.href), n = u.searchParams.get("n");
      if (n && UUID_RE.test(n)) {
        pendingClick = n;
        u.searchParams.delete("n");
        history.replaceState(null, "", u.pathname + (u.search || "") + u.hash);
      }
    } catch (e) {}
  }
  function listen() {
    readClickParam();
    try {
      if ("serviceWorker" in navigator) navigator.serviceWorker.addEventListener("message", ev => {
        const m = ev.data || {};
        if (m.type !== "push-open") return;
        if (m.hash && Storage.getUser()) { try { location.hash = m.hash; } catch (e) {} }
        markClicked(m.id);
      });
    } catch (e) {}
  }
  // Ouverture d'un compte.
  function start() {
    st = null; missing = false; err = ""; endpoint = null;
    if (!on()) return;
    refresh();
    if (pendingClick) { const id = pendingClick; pendingClick = null; markClicked(id); }
    PushEvents.flush();
  }
  // Déconnexion : cet appareil ne reçoit plus les notifications de ce compte.
  async function end() {
    try {
      if (on() && endpoint) await withTimeout(rpc("push_unsubscribe", { p_endpoint: endpoint }), 5000);
    } catch (e) {}
    st = null; endpoint = null; token++;
  }
  // Bandeau après une session terminée : une seule fois par compte et par appareil.
  function canOffer() {
    return on() && !missing && !!st && !!st.key && !st.registered && support() === "ok" && permission() === "default" && !flag("offered");
  }
  function banner(s) {
    if (!s) return null;
    if (!s.pushOffer) {
      if (!canOffer()) return null;
      s.pushOffer = true;
      setFlag("offered", true);
    }
    if (s.pushOfferDone) return null;
    const c = el("div", "card np-banner");
    c.appendChild(el("div", "np-banner-t", "🔔 " + t("np.offer.title")));
    c.appendChild(el("div", "muted", t("np.offer.text")));
    const b = el("div", "btns two");
    const yes = el("button", "btn primary", t("np.enable")), no = el("button", "btn", t("np.offer.later"));
    yes.type = no.type = "button";
    yes.addEventListener("click", async () => { s.pushOfferDone = true; c.remove(); await enable(); });
    no.addEventListener("click", () => { s.pushOfferDone = true; c.remove(); });
    b.append(yes, no);
    c.appendChild(b);
    return c;
  }
  return {
    on, support, permission, refresh, enable, disable, setPref, start, end, listen, banner,
    state: () => ({ st, loading, missing, err, busy, endpoint })
  };
})();
Push.listen();

// === ÉVÉNEMENTS POUR LES NOTIFICATIONS AUTOMATIQUES (étape 34) ===
// Palier de série atteint (badge 7 / 30 / 100 / 365) et gel utilisé (jour gelé) : envoyés au serveur (push_event),
// qui décide d'envoyer ou non une notification (règles automatiques de l'admin). File locale par compte
// (vocabfr.push:events:<identifiant>, 20 au maximum), envoyée au lancement et dès qu'un événement arrive ; hors ligne :
// gardée et renvoyée plus tard. Jamais d'erreur visible. Script de l'étape 34 absent : file vidée, rien n'est envoyé.
const PushEvents = (() => {
  let busy = false, missing = false;
  function key() { return CONFIG.LS_USER_PREFIX + "push:events:" + (Storage.getUser() || ""); }
  function load() { try { const v = JSON.parse(localStorage.getItem(key()) || "[]"); return Array.isArray(v) ? v : []; } catch (e) { return []; } }
  function store(q) { try { if (q.length) localStorage.setItem(key(), JSON.stringify(q.slice(-20))); else localStorage.removeItem(key()); } catch (e) {} }
  function add(kind, ref) {
    if (auth.mode !== "supabase" || !Storage.getUser() || missing) return;
    const q = load();
    if (!q.some(x => x.kind === kind && x.ref === ref)) { q.push({ kind, ref }); store(q); }
  }
  // Événements de Streak (leitner.js) : { k: "badge", days } et { k: "frozen", day } (2 derniers jours seulement).
  function fromStreak(ev) {
    try {
      const old = skAdd(todayStr(), -2);
      let n = 0;
      arr(ev).forEach(e => {
        if (e && e.k === "badge" && STREAK_BADGES.includes(e.days)) { add("streak_milestone", String(e.days)); n++; }
        else if (e && e.k === "frozen" && skDay(e.day) && e.day >= old) { add("freeze_used", e.day); n++; }
      });
      if (n) flush();
    } catch (e) {}
  }
  async function flush() {
    if (busy || missing || !Push.on()) return;
    busy = true;
    try {
      let q = load();
      while (q.length) {
        const ev = q[0];
        try {
          const r = await withTimeout(Supa.client().rpc("push_event", { p_kind: ev.kind, p_ref: ev.ref }), 15000);
          if (r && r.error) throw r.error;
        } catch (e) {
          if (pushIsMissing(e)) { missing = true; store([]); return; }
          if (sbErrKind(e) === "net" || String((e && e.message) || "") === "timeout") return;   // plus tard
          // Autre erreur (événement refusé, compte bloqué) : événement abandonné.
        }
        q = load().filter(x => !(x.kind === ev.kind && x.ref === ev.ref));
        store(q);
      }
    } finally { busy = false; }
  }
  return { fromStreak, flush };
})();

// Réglages → Notifications.
function renderPushCard() {
  const box = $("#pushCard");
  if (!box) return;
  box.hidden = false;
  box.textContent = "";
  box.appendChild(el("h2", null, t("np.title")));
  if (!Push.on()) { box.appendChild(el("p", "muted np-note", t("np.needOnline"))); return; }
  const ps = Push.state(), sup = Push.support(), perm = Push.permission();
  if (ps.missing) { box.appendChild(el("p", "q-err np-note", auth.isAdmin ? t("np.missingAdmin") : t("np.missing"))); return; }
  if (!ps.st) {
    box.appendChild(el("p", "muted np-note", ps.err || t("admin.loading")));
    if (ps.err) { const r = el("button", "btn", t("np.retry")); r.type = "button"; r.addEventListener("click", () => Push.refresh()); box.appendChild(r); }
    return;
  }
  const st = ps.st;
  // Cet appareil
  const dev = el("div", "np-device");
  let line = "", cls = "", msg = "";
  if (sup === "ios_install") { line = t("np.dev.off"); msg = t("np.ios"); }
  else if (sup === "ios_old") { line = t("np.dev.off"); msg = t("np.iosOld"); }
  else if (sup === "unsupported") { line = t("np.dev.off"); msg = t("np.unsupported"); }
  else if (sup === "nosw") { line = t("np.dev.off"); msg = t("np.nosw"); }
  else if (perm === "denied") { line = t("np.dev.blocked"); cls = "bad"; msg = t("np.denied"); }
  else if (st.registered && perm === "granted") { line = t("np.dev.on"); cls = "ok"; }
  else line = t("np.dev.off");
  dev.appendChild(el("div", "np-dev-line" + (cls ? " " + cls : ""), t("np.thisDevice") + " : " + line));
  dev.appendChild(el("div", "hint", t("np.devices", { n: num(Number(st.devices), 0) })));
  box.appendChild(dev);
  if (msg) box.appendChild(el("div", "np-msg", msg));
  if (ps.err) box.appendChild(el("div", "q-err np-note", ps.err));
  if (!st.key && sup === "ok") box.appendChild(el("div", "np-msg", auth.isAdmin ? t("np.noKeyAdmin") : t("np.noKey")));
  if (sup === "ok" && perm !== "denied") {
    const b = el("button", "btn" + (st.registered ? "" : " primary"), ps.busy ? t("np.busy") : t(st.registered ? "np.disable" : "np.enable"));
    b.type = "button"; b.disabled = ps.busy || (!st.key && !st.registered);
    b.addEventListener("click", () => (st.registered ? Push.disable() : Push.enable()));
    box.appendChild(b);
    if (!st.registered) box.appendChild(el("div", "hint", t("np.askHint")));
  }
  // Catégories (compte entier)
  box.appendChild(el("h3", "np-h3", t("np.cats")));
  box.appendChild(el("p", "hint np-sub", t("np.catsHint")));
  const p = st.prefs || {};
  const sw = (label, on, onToggle) => {
    const s = el("button", "au-switch am-switch");
    s.type = "button"; s.setAttribute("role", "switch"); s.setAttribute("aria-checked", String(!!on));
    const track = el("span", "au-track"); track.appendChild(el("span", "au-knob"));
    s.append(el("span", "au-lbl", label), track);
    s.addEventListener("click", () => { const v = s.getAttribute("aria-checked") !== "true"; s.setAttribute("aria-checked", String(v)); onToggle(v); });
    return s;
  };
  PUSH_CATS.forEach(k => box.appendChild(sw(t("np.cat." + k), p[k] !== false, v => Push.setPref(k, v))));
  // Heures calmes
  box.appendChild(el("h3", "np-h3", t("np.quiet")));
  const times = el("div", "np-times");
  const tm = (lab, k, def) => {
    const i = el("input", "input"); i.type = "time"; i.value = p[k] || def; i.step = 60;
    i.addEventListener("change", () => { if (/^\d{2}:\d{2}/.test(i.value)) Push.setPref(k, i.value.slice(0, 5)); });
    const w = el("label", "np-time"); w.append(el("span", null, lab), i);
    return w;
  };
  times.append(tm(t("np.quietFrom"), "quiet_start", "22:00"), tm(t("np.quietTo"), "quiet_end", "08:00"));
  box.appendChild(sw(t("np.quietOn"), p.quiet_on !== false, v => { Push.setPref("quiet_on", v); times.hidden = !v; }));
  times.hidden = p.quiet_on === false;
  box.appendChild(times);
  box.appendChild(el("p", "hint", t("np.quietHint")));
}
