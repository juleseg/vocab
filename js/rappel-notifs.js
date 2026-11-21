"use strict";

// === RAPPEL RÉGULIER D'ACTIVER LES NOTIFICATIONS (ÉTAPE 74) ===
// Petit bandeau sur l'Accueil (#homeNotifRappel), jamais bloquant, jamais une fenêtre, jamais une notification push :
// « 🔔 <texte> » + « Activer » / « Plus tard ». Extension du circuit des étapes 38 et 71 (pas un second circuit) :
// mêmes outils que js/notif-invite.js (NotifInvite.api : état de l'invitation de ce compte sur cet appareil, journal),
// même guide d'installation que js/accueil-notifs.js (AccNotif.guide), même « Activer » (Push.enable() dans le geste).
//
// Qui le voit : tout appareil SANS notifications actives (compte connecté en mode Supabase), y compris après un
// « Plus tard » des étapes 38 / 71 ; jamais un navigateur non compatible (KakaoTalk, ancien iOS…), jamais quand l'état
// des notifications est inconnu (hors connexion) ni quand elles ne sont pas installées côté serveur (pas de clé publique).
//  - Autorisation refusée dans le téléphone : pas de bandeau ; seulement l'explication pour la réactiver, UNE fois par
//    appareil (et jamais si la fenêtre de l'étape 38 l'a déjà montrée pour ce compte : deniedInfo).
//  - iPhone / Android sans appli installée : « Activer » ouvre le guide d'installation de l'étape 71.
//  - Ordinateur ou appli installée : « Activer » = demande du téléphone puis inscription push tout de suite.
// Règles : un bandeau compte comme un rappel quand il est AFFICHÉ, au plus un par jour et par appareil (le même jour il
// reste visible jusqu'à une réponse, sans être recompté) ; le suivant vient « tous les X jours » après le dernier rappel,
// le dernier « Plus tard » ou la dernière fenêtre des étapes 38 / 71 (seen / later) ; au plus N rappels par appareil ;
// « Activer » réussi (ou notifications trouvées actives) = plus jamais de bandeau sur cet appareil.
// Le bandeau attend la fin de la fenêtre du lancement (NotifInvite.checked) et qu'aucune fenêtre ne soit ouverte.
// Quand le rappel est actif, la fenêtre de première ouverture de l'étape 38 ne revient plus d'elle-même tous les 7 jours
// (NotifRappel.active, js/notif-invite.js) : c'est le bandeau qui prend le relais.
// Réglages de l'admin (RPC notif_reminder_get, tout compte connecté) : { on, every, max, text { ko, fr, en } }, relus au
// plus toutes les 10 min ; cache sur l'appareil (vocabfr.notifrappel) ; hors connexion : dernière valeur connue, sinon
// valeurs par défaut ; script SQL de l'étape 74 absent : valeurs par défaut.
// État de CET appareil (vocabfr.notifrappel:dev, rien dans les données du compte) : { n, day, last, ans, later, done,
// help, helpDay, helpOk }.
// Journal : push_invite_shown / enabled / later / denied de l'étape 38, data.src = "reminder" (+ n, mode install | denied).
const NRP_DEF = { on: true, every: 7, max: 5 };
const NRP_GAP_MS = 10 * 60000;
const NotifRappel = (() => {
  const SRC = "reminder";
  const LANGS = ["ko", "fr", "en"];
  let cache = null, fetchedAt = 0, fetching = null, missing = false, waitFor = null;
  const kSet = () => CONFIG.LS_USER_PREFIX + "notifrappel";
  const kDev = () => CONFIG.LS_USER_PREFIX + "notifrappel:dev";
  function isMissing(e) {
    const code = String((e && e.code) || ""), msg = String((e && (e.message || e.msg)) || "");
    return ["PGRST202", "42883", "PGRST205", "42P01"].includes(code) || /could not find|does not exist|schema cache/i.test(msg);
  }

  // --- Réglages de l'admin ---
  function norm(v) {
    v = v && typeof v === "object" ? v : {};
    const text = {}, src = v.text && typeof v.text === "object" ? v.text : {};
    LANGS.forEach(l => { const s = String(src[l] == null ? "" : src[l]).trim(); if (s) text[l] = s.slice(0, 300); });
    return { on: v.on !== false, every: clampInt(v.every, 1, 60, NRP_DEF.every), max: clampInt(v.max, 1, 20, NRP_DEF.max), text, saved: !!v.saved };
  }
  function settings() {
    if (!cache) { try { cache = norm(JSON.parse(localStorage.getItem(kSet()) || "null")); } catch (e) { cache = norm(null); } }
    return cache;
  }
  function apply(v) {
    cache = norm(v);
    try { if (v) localStorage.setItem(kSet(), JSON.stringify(cache)); else localStorage.removeItem(kSet()); } catch (e) {}
    return cache;
  }
  function on() { return typeof Push !== "undefined" && Push.on(); }
  // Relit les réglages (au plus toutes les 10 min, sauf force). Renvoie toujours des réglages utilisables.
  function fetchSettings(force) {
    if (!on()) return Promise.resolve(settings());
    if (!force && Date.now() - fetchedAt < NRP_GAP_MS) return Promise.resolve(settings());
    if (fetching) return fetching;
    fetching = (async () => {
      try {
        const r = await withTimeout(Supa.client().rpc("notif_reminder_get"), 12000);
        if (r && r.error) throw r.error;
        apply(r ? r.data : null);
        missing = false;
        fetchedAt = Date.now();
      } catch (e) {
        if (isMissing(e)) { missing = true; apply(null); fetchedAt = Date.now(); }   // script absent : valeurs par défaut
        else fetchedAt = Date.now() - NRP_GAP_MS + 60000;                            // hors connexion : cache, nouvel essai dans 1 min
      }
      fetching = null;
      return settings();
    })();
    return fetching;
  }
  // Rappel actif ? (js/notif-invite.js : la fenêtre de l'étape 38 ne revient plus d'elle-même tous les 7 jours.)
  function active() { return settings().on; }
  // Texte du bandeau dans la langue de l'interface, sinon une autre langue de l'admin, sinon le texte par défaut.
  function textFor(s, ui) {
    const tx = s.text || {};
    const l = [ui].concat(["fr", "en", "ko"].filter(x => x !== ui)).find(x => String(tx[x] || "").trim());
    if (l) return { lang: l, text: String(tx[l]).trim() };
    return { lang: ui, text: t("nrp.def") };
  }

  // --- État de cet appareil ---
  function dev() { try { const v = JSON.parse(localStorage.getItem(kDev()) || "null"); return v && typeof v === "object" ? v : {}; } catch (e) { return {}; } }
  function setDev(p) { try { localStorage.setItem(kDev(), JSON.stringify(Object.assign(dev(), p))); } catch (e) {} }
  function api() { return typeof NotifInvite !== "undefined" && NotifInvite.api ? NotifInvite.api : null; }
  function log(what, data) { const a = api(); if (a) a.log(what, Object.assign({ src: SRC }, data || {})); }
  function dayDiff(a, b) { return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000); }
  function phone() {
    const d = deviceInfo();
    return { mobile: d.os === "iOS" || d.os === "iPadOS" || d.os === "Android", ios: d.os === "iOS" || d.os === "iPadOS", installed: !!d.installed };
  }
  function helpOs() {
    const d = deviceInfo();
    if (d.os === "iOS" || d.os === "iPadOS") return t("ni.denied.ios");
    if (d.os === "Android") return t("ni.denied.android");
    return t("ni.denied.desktop");
  }
  // Que montrer maintenant ? null | { mode: "ask" | "install" | "denied", fresh } (fresh = nouveau rappel, à compter).
  function decide() {
    const a = api();
    if (!on() || !a || typeof NotifInvite.checked !== "function") return null;
    const who = Storage.getUser();
    if (!who || NotifInvite.checked() !== who) return null;   // la fenêtre du lancement (étapes 38 / 71) d'abord
    const s = settings();
    if (!s.on) return null;
    const ps = Push.state();
    if (!ps.st || ps.missing || !ps.st.key) return null;      // état inconnu (hors connexion) ou notifications pas installées
    const sup = Push.support(), perm = Push.permission(), d = dev(), today = todayStr(), r = a.rec() || {};
    if (sup === "ok" && perm === "granted" && ps.st.registered) { if (!d.done) setDev({ done: Date.now() }); return null; }
    if (d.done || r.done) return null;
    if (sup !== "ok" && sup !== "ios_install") return null;   // navigateur non compatible
    const modal = !!document.querySelector(".modal-bg");
    if (sup === "ok" && perm === "denied") {
      if (d.help) return d.helpDay === today && !d.helpOk ? { mode: "denied" } : null;
      if (r.deniedInfo || modal) return null;                  // explication déjà vue (fenêtre de l'étape 38)
      return { mode: "denied", fresh: true };
    }
    const p = phone(), mode = p.mobile && !p.installed ? "install" : "ask";
    if (d.day === today) return d.ans ? null : { mode };       // même rappel qu'aujourd'hui, pas recompté
    if (modal || (Number(d.n) || 0) >= s.max) return null;
    const ref = Math.max(Number(d.last) || 0, Number(d.later) || 0, Number(r.later) || 0, Number(r.seen) || 0);
    if (ref && dayDiff(todayStr(new Date(ref)), today) < s.every) return null;
    return { mode, fresh: true };
  }
  // Nouveau rappel affiché : compté, noté au journal.
  function count(x) {
    const now = Date.now(), today = todayStr(), a = api();
    if (x.mode === "denied") {
      setDev({ help: now, helpDay: today, helpOk: false });
      if (a) a.setRec({ deniedInfo: now });
      log("shown", { mode: "denied" });
      return;
    }
    const n = (Number(dev().n) || 0) + 1;
    setDev({ n, day: today, last: now, ans: null });
    try { Push.markOffered(); } catch (e) {}   // pas de second bandeau après la première session (étape 32)
    log("shown", x.mode === "install" ? { n, mode: "install" } : { n });
  }

  // --- Bandeau ---
  function bar(icon, textNode, btns) {
    const w = el("div", "nrp-bar");
    w.setAttribute("role", "status");
    w.appendChild(el("span", "nrp-ic", icon)).setAttribute("aria-hidden", "true");
    const m = el("div", "nrp-m");
    m.appendChild(textNode);
    const b = el("div", "nrp-btns");
    btns.forEach(x => b.appendChild(x));
    m.appendChild(b);
    w.appendChild(m);
    return w;
  }
  function button(cls, label, id, onClick) {
    const b = el("button", cls, label);
    b.type = "button";
    if (id) b.id = id;
    b.addEventListener("click", onClick);
    return b;
  }
  // Bandeau seul (aussi l'aperçu de l'administration) : texte + « Activer » / « Plus tard ».
  function view(text, lang, onEnable, onLater) {
    const tx = el("div", "nrp-tx", text);
    if (lang) tx.lang = lang;
    return bar("🔔", tx, [button("btn primary nrp-go", t("ni.enable"), onEnable ? "nrpEnable" : null, onEnable || (() => {})),
                         button("link-btn nrp-later", t("ni.later"), onLater ? "nrpLater" : null, onLater || (() => {}))]);
  }
  function deniedView() {
    const tx = el("div", "nrp-tx");
    tx.append(el("div", null, t("nrp.denied")), el("div", "nrp-help", helpOs()));
    return bar("🔕", tx, [button("btn nrp-ok", t("ni.ok"), "nrpOk", () => { setDev({ helpOk: true }); paint(); })]);
  }
  function paint() {
    const box = $("#homeNotifRappel");
    if (!box) return;
    let x = null;
    try { x = decide(); } catch (e) { x = null; }
    box.textContent = "";
    box.hidden = !x;
    if (!x) return;
    if (x.fresh) count(x);
    if (x.mode === "denied") { box.appendChild(deniedView()); return; }
    const tx = textFor(settings(), state.settings.uiLang);
    box.appendChild(view(tx.text, tx.lang !== state.settings.uiLang ? tx.lang : null, () => enable(x.mode), later));
  }
  function later() {
    const now = Date.now(), a = api();
    setDev({ ans: "later", later: now });
    if (a) a.setRec({ later: now });
    log("later");
    paint();
  }
  function enable(mode) {
    const now = Date.now(), a = api();
    if (mode === "install") {   // appli pas installée : guide de l'étape 71 (iPhone : Safari → Partager ; Android : menu ⋮)
      setDev({ ans: "install", later: now });
      if (a) a.setRec({ later: now });
      paint();
      log("later", { mode: "install" });
      if (typeof AccNotif !== "undefined" && a) AccNotif.guide(a).catch(() => {});
      return;
    }
    const p = Push.enable();   // dans le geste : la demande du téléphone part tout de suite
    const go = $("#nrpEnable");
    if (go) { go.disabled = true; go.textContent = t("np.busy"); }
    Promise.resolve(p).catch(() => "error").then(res => {
      const at = Date.now();
      if (res === "on") { setDev({ done: at, ans: "on" }); if (a) a.setRec({ done: at }); log("enabled"); }
      else if (res === "denied") { setDev({ ans: "denied" }); if (a) a.setRec({ denied: at }); log("denied"); }
      else {   // demande fermée sans réponse ou problème technique : comme « Plus tard »
        setDev({ ans: "later", later: at });
        if (a) a.setRec({ later: at });
        log("later", { why: res });
        const e = Push.state().err;
        if (e) toast(e);
      }
      paint();
    });
  }
  // Appelé par renderHome (js/screens/accueil.js) : dessine tout de suite, puis relit les réglages et attend la fin
  // de la fenêtre du lancement avant le premier rappel.
  function home() {
    paint();
    if (!on()) return;
    const who = Storage.getUser();
    const again = () => { if (Storage.getUser() === who && typeof currentScreen !== "undefined" && currentScreen === "home") paint(); };
    fetchSettings(false).then(again, () => {});
    if (waitFor === who) return;
    waitFor = who;
    (async () => {
      try { await Push.ready(); } catch (e) {}
      const free = () => !document.querySelector(".modal-bg");
      for (let i = 0; i < 900 && Storage.getUser() === who; i++) {   // 15 min au plus
        if (typeof NotifInvite !== "undefined" && NotifInvite.checked && NotifInvite.checked() === who && free()) break;
        await new Promise(r => setTimeout(r, 1000));
      }
      again();
    })().catch(() => {}).finally(() => { if (Storage.getUser() !== who) waitFor = null; });
  }
  function reset() { waitFor = null; fetchedAt = 0; }
  return { home, paint, settings, fetchSettings, apply, active, textFor, view, reset, isMissing: () => missing, dev };
})();
