"use strict";

// === NOTIFICATIONS À LA CRÉATION DU COMPTE (ÉTAPE 71) ===
// Extension du circuit de l'étape 38 (js/notif-invite.js) : pas de second circuit. NotifInvite.check() appelle
// AccNotif.mode() puis AccNotif.run() avec ses propres outils (fenêtre, état de l'appareil, journal, « Activer »).
//
// Nouveau compte : AccNotif.markNew(identifiant) à la création (auth.js, doCreate / sbCreate) pose `fresh` dans l'état
// de l'invitation de cet appareil pour ce compte (vocabfr.push:invite:state:<identifiant>, même clé que l'étape 38).
// Juste après la création, la fenêtre passe AVANT les annonces (auth.js, enterSupabase : AccNotif.early()).
//  - iPhone / iPad / Android, appli pas installée (pas en mode standalone) : guide d'installation, une seule fois, sans
//    demande d'autorisation (iPhone : Safari → Partager → « Sur l'écran d'accueil » ; Android : menu ⋮ → « Installer
//    l'application », ou bouton « Installer » quand le navigateur le propose : événement beforeinstallprompt).
//  - Appli installée, ou ordinateur : fenêtre « Activer les rappels ? » (courte explication) ; « Activer » = Push.enable()
//    dans le geste (demande du téléphone, puis inscription push tout de suite). Au premier lancement installé après le
//    guide (Android : même stockage que Chrome), c'est cette fenêtre qui s'ouvre.
//  - Autorisation déjà donnée à ce site sur l'appareil : inscription directe, sans fenêtre (notifications actives par défaut).
//  - Autorisation refusée : l'explication de l'étape 38, une seule fois.
// Limite : au plus 2 fenêtres automatiques par appareil pour ce compte (`shows`) : guide puis « Activer les rappels ? »,
// ou « Activer les rappels ? » puis, après « Plus tard », une seule fois de plus au bout de 7 jours. Ensuite plus rien :
// Réglages → Notifications (étape 32). Rien n'est enregistré dans les données du compte (DATA_VERSION inchangé) : les
// catégories et heures calmes du compte gardent leurs valeurs par défaut du serveur (tout activé, 22 h → 8 h).
// iPhone : l'appli installée a son propre stockage ; la marque `fresh` ne la suit pas. Au premier lancement installé,
// rien n'est encore noté pour ce compte : la fenêtre de première ouverture de l'étape 38 s'ouvre (mêmes textes, avant les
// annonces : early()).
const ACN_WAIT_MS = 7 * 86400000;
const ACN_SHOWS_MAX = 2;
const AccNotif = (() => {
  let bip = null;   // événement beforeinstallprompt gardé (Chrome / Edge / Samsung Internet sur Android)
  try {
    window.addEventListener("beforeinstallprompt", e => { bip = e; });
    window.addEventListener("appinstalled", () => { bip = null; });
  } catch (e) {}
  function key(id) { return CONFIG.LS_USER_PREFIX + "push:invite:state:" + (id || ""); }
  function read(id) { try { const v = JSON.parse(localStorage.getItem(key(id)) || "null"); return v && typeof v === "object" ? v : null; } catch (e) { return null; } }
  // À la création du compte (avant l'ouverture des données) : nouveau compte sur cet appareil.
  function markNew(id) {
    if (!id) return;
    try { localStorage.setItem(key(id), JSON.stringify(Object.assign({}, read(id) || {}, { fresh: Date.now(), shows: 0 }))); } catch (e) {}
  }
  function device() {
    const d = deviceInfo();
    return { ios: d.os === "iOS" || d.os === "iPadOS", android: d.os === "Android", installed: !!d.installed };
  }
  // Navigateur intégré à une autre appli (KakaoTalk, Instagram, Facebook, LINE, NAVER…) : pas de menu « Installer ».
  function inApp() { return /KAKAOTALK|Instagram|FBAN|FBAV|\bLine\/|NAVER\(inapp|DaumApps|; wv\)/i.test(String(navigator.userAgent || "")); }

  // Ce qu'il faut faire pour ce compte sur cet appareil.
  // null = pas un nouveau compte (règles de l'étape 38) ; "none" = rien ; "install" = guide d'installation ;
  // "ask" = « Activer les rappels ? » ; "auto" = autorisation déjà donnée : inscription directe ; "denied" = explication.
  function mode(r, sup, perm) {
    if (!r || !r.fresh) return null;
    if (r.done || r.denied) return "none";
    const d = device(), shows = Number(r.shows) || 0;
    if ((d.ios || d.android) && !d.installed) return r.install || shows >= ACN_SHOWS_MAX ? "none" : "install";
    if (sup !== "ok") return "none";
    if (perm === "denied") return r.deniedInfo ? "none" : "denied";
    if (perm === "granted") return "auto";
    if (shows >= ACN_SHOWS_MAX) return "none";
    if (!r.asked) return "ask";
    return r.later && Date.now() - Number(r.later) >= ACN_WAIT_MS ? "ask" : "none";   // « Plus tard » : une fois de plus
  }
  // Au lancement (auth.js) : la fenêtre des notifications passe-t-elle avant les annonces ?
  // Oui pour un nouveau compte qui a une fenêtre à voir, et au premier lancement de l'appli installée (téléphone).
  function early(id) {
    try {
      if (typeof Push === "undefined" || !Push.on()) return false;
      const r = read(id), d = device();
      if (!r) return d.installed && (d.ios || d.android);
      return ["install", "ask", "denied", "auto"].includes(mode(r, Push.support(), Push.permission()));
    } catch (e) { return false; }
  }

  // --- Fenêtres ---
  function para(txt, cls) { return el("p", cls || null, txt); }
  function steps(keys) { const ol = el("ol", "ni-steps"); keys.forEach(k => ol.appendChild(el("li", null, t(k)))); return ol; }
  // « Activer les rappels ? » (aussi la fenêtre de première ouverture de l'étape 38, js/notif-invite.js).
  function askBody() {
    const b = el("div", "ni-body acn-body");
    b.appendChild(para(t("acn.text")));
    b.appendChild(para(t("acn.next"), "acn-next"));
    b.appendChild(para(t("acn.hint"), "hint"));
    return b;
  }
  function androidBody() {
    const b = el("div", "ni-body acn-body");
    b.appendChild(para(t("acn.and.text")));
    if (inApp()) b.appendChild(para(t("acn.and.inapp"), "acn-warn"));
    if (bip) b.appendChild(para(t("acn.and.oneTap")));
    b.appendChild(steps(["acn.and.s1", "acn.and.s2", "acn.and.s3"]));
    b.appendChild(para(t("acn.hint"), "hint"));
    return b;
  }
  function iosBody() {
    const b = el("div", "ni-body acn-body");
    b.appendChild(para(t("ni.ios.text")));
    b.appendChild(steps(["ni.ios.s1", "ni.ios.s2", "ni.ios.s3"]));
    b.appendChild(para(t("acn.hint"), "hint"));
    return b;
  }
  // Bouton « Installer » du navigateur (Android) : la demande part dans le geste.
  function promptInstall() {
    const e = bip;
    if (!e || typeof e.prompt !== "function") return null;
    bip = null;   // une seule demande par événement
    try { e.prompt(); } catch (x) { return null; }
    return e.userChoice ? Promise.resolve(e.userChoice).catch(() => null) : null;
  }

  // Guide d'installation (iPhone : Safari → Partager ; Android : menu ⋮ ou bouton « Installer » du navigateur).
  // Étape 74 : aussi ouvert par « Activer » du bandeau de rappel (js/rappel-notifs.js) quand l'appli n'est pas installée.
  async function guide(api) {
    if (device().ios) {
      await api.ask(t("ni.ios.title"), iosBody(), [{ k: "ok", label: t("ni.ok"), kind: "primary" }]);
      return;
    }
    const btns = bip ? [api.laterBtn(), { k: "install", label: t("acn.and.install"), kind: "primary", now: promptInstall }]
                     : [{ k: "ok", label: t("ni.ok"), kind: "primary" }];
    const res = await api.ask(t("acn.and.title"), androidBody(), btns);
    if (res.k === "install" && res.p) {
      const c = await res.p;
      if (c && c.outcome === "accepted") toast(t("acn.and.done"));
    }
  }

  // api : outils de NotifInvite { rec, setRec, ask, afterEnable, enableBtn, laterBtn, log, showDenied }.
  async function run(m, api, valid) {
    const r = api.rec() || {}, shows = (Number(r.shows) || 0) + 1, now = Date.now();
    if (m === "auto") {   // autorisation déjà donnée sur cet appareil : inscription tout de suite, sans fenêtre
      const res = await Push.enable();
      if (res === "on") { api.setRec({ done: Date.now() }); api.log("enabled", { src: "first", fresh: true, mode: "auto" }); }
      return;
    }
    if (m === "denied") { await api.showDenied(); return; }
    Push.markOffered();   // pas de bandeau après la première session (étape 32)
    if (m === "install") {
      api.setRec({ install: now, seen: now, shows });
      api.log("shown", { src: "first", fresh: true, mode: "install" });
      await guide(api);
      api.log("later", { src: "first", fresh: true, mode: "install" });
      return;
    }
    if (m === "ask") {
      api.setRec({ asked: now, seen: now, shows });
      api.log("shown", { src: "first", fresh: true });
      const res = await api.ask("🔔 " + t("acn.title"), askBody(), [api.laterBtn(), api.enableBtn()]);
      if (res.k === "enable") await api.afterEnable(res.p, "first", valid);
      else { api.setRec({ later: Date.now() }); api.log("later", { src: "first", fresh: true }); }
    }
  }
  return { markNew, mode, early, run, askBody, read, iosBody, androidBody, guide };   // étape 74 : guide, iosBody, androidBody exposés
})();
