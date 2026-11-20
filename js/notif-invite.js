"use strict";

// === INVITATION À ACTIVER LES NOTIFICATIONS (ÉTAPE 38) ===
// Les navigateurs n'activent jamais les notifications sans un geste : l'appli propose une fenêtre avec un bouton.
// Lancée après les annonces (auth.js, enterSupabase) ; attend qu'aucune autre fenêtre ne soit ouverte (whenNoModal).
// Une seule fenêtre d'invitation par lancement.
//
// 1. Fenêtre de première ouverture (marche sans le script SQL de l'étape 38) :
//    - affichée à la première connexion d'un compte et à la première ouverture sur un nouvel appareil
//      (rien d'enregistré sur cet appareil pour ce compte : vocabfr.push:invite:state:<identifiant>) ;
//    - « Activer » = Push.enable() (même chemin que Réglages → Notifications) ; « Plus tard » = pas avant 7 jours ;
//    - jamais si les notifications sont actives sur cet appareil, si le navigateur ne les prend pas en charge,
//      ou si elles ne sont pas installées côté serveur (étape 32 absente, pas de clé publique) ;
//    - autorisation refusée dans le navigateur : seulement l'explication pour la réactiver, une seule fois ;
//    - iPhone / iPad sans appli installée : explication d'installation (« Compris » = revient dans 7 jours).
// 2. Invitations de l'admin (script supabase-etape38.sql) : my_notif_invites(appareil) donne celles à afficher ici
//    (seulement si cet appareil n'est pas abonné, une seule fois par invitation). Affichage enregistré tout de suite
//    (shown), puis la réponse : enabled / later / denied / install (notif_invite_answer). Plusieurs invitations en
//    attente : une seule fenêtre (la plus récente), la réponse vaut pour toutes. Hors connexion : réponses gardées
//    sur l'appareil (vocabfr.push:invite:q:<identifiant>) et renvoyées au lancement suivant.
// Journal : push_invite_shown, push_invite_enabled, push_invite_later, push_invite_denied
//    (data.src = first | admin ; data.mode = install | denied pour les fenêtres d'explication).
// 3. Étape 71 : nouveau compte sur cet appareil (marque `fresh`, js/accueil-notifs.js, AccNotif) : fenêtre juste après la
//    création (avant les annonces), guide d'installation aussi pour Android, « Activer les rappels ? », au plus 2 fenêtres
//    automatiques par appareil ; journal avec data.fresh = true. La fenêtre de première ouverture (point 1) prend les mêmes
//    textes. Les comptes existants gardent les règles des points 1 et 2.
const NotifInvite = (() => {
  const LATER_MS = 7 * 86400000;
  let token = 0, busy = false, missing = false;
  function key(k) { return CONFIG.LS_USER_PREFIX + "push:invite:" + k + ":" + (Storage.getUser() || ""); }
  function readJson(k, d) { try { const v = JSON.parse(localStorage.getItem(key(k)) || "null"); return v == null ? d : v; } catch (e) { return d; } }
  function writeJson(k, v) { try { if (v == null) localStorage.removeItem(key(k)); else localStorage.setItem(key(k), JSON.stringify(v)); } catch (e) {} }
  // État de cet appareil pour ce compte : { seen, later, done, denied, deniedInfo }.
  function rec() { const r = readJson("state", null); return r && typeof r === "object" ? r : null; }
  function setRec(patch) { writeJson("state", Object.assign({}, rec() || {}, patch)); }
  function log(what, data) { try { Activity.log("push_invite_" + what, data || {}); } catch (e) {} }

  // --- Réponses aux invitations de l'admin (file locale, renvoyée plus tard si besoin) ---
  function queue() { return arr(readJson("q", [])).filter(x => x && UUID_RE.test(String(x.id)) && x.s); }
  async function sendOne(x) {
    const r = await withTimeout(Supa.client().rpc("notif_invite_answer", { p_id: x.id, p_device: deviceId(), p_status: x.s }), 15000);
    if (r && r.error) throw r.error;
  }
  async function flush() {
    if (!Push.on()) return;
    for (const x of queue()) {
      try { await sendOne(x); }
      catch (e) {
        if (alIsMissing(e)) { missing = true; writeJson("q", null); return; }
        if (sbErrKind(e) === "net" || String((e && e.message) || "") === "timeout") return;   // plus tard
        // Autre erreur (compte bloqué, invitation supprimée) : réponse abandonnée.
      }
      writeJson("q", queue().filter(y => !(y.id === x.id && y.s === x.s)));
    }
  }
  function answer(ids, s) {
    const q = queue();
    ids.forEach(id => q.push({ id, s }));
    writeJson("q", q.slice(-50));
    flush();
  }
  async function pending() {
    if (missing) return [];
    try {
      const r = await withTimeout(Supa.client().rpc("my_notif_invites", { p_device: deviceId() }), 15000);
      if (r && r.error) throw r.error;
      return arr(r && r.data).filter(a => a && UUID_RE.test(String(a.id)));
    } catch (e) { if (alIsMissing(e)) missing = true; return []; }
  }

  // --- Fenêtres ---
  function para(txt, cls, lang) { const p = el("p", cls || null, txt); if (lang) p.lang = lang; return p; }
  function helpOs() {
    const d = deviceInfo();
    if (d.os === "iOS" || d.os === "iPadOS") return t("ni.denied.ios");
    if (d.os === "Android") return t("ni.denied.android");
    return t("ni.denied.desktop");
  }
  // Ouvre une fenêtre bloquante ; renvoie une promesse avec la clé du bouton touché.
  // buttons : [{ k, label, kind, now(): appelé dans le geste, avant la fermeture }]
  function ask(title, body, buttons, titleLang) {
    return new Promise(res => {
      openModal(title, body, buttons.map(b => ({
        label: b.label, kind: b.kind || "",
        onClick: () => { const p = b.now ? b.now() : null; res({ k: b.k, p }); }
      })), { locked: true });
      if (titleLang) { const hs = document.querySelectorAll(".modal-bg .modal h3"), h = hs[hs.length - 1]; if (h) h.lang = titleLang; }
    });
  }
  // Explication : autorisation refusée dans le navigateur.
  function deniedBody(extra) {
    const b = el("div", "ni-body");
    if (extra) b.appendChild(extra);
    b.appendChild(para(t("ni.denied.text")));
    b.appendChild(para(helpOs(), "ni-steps"));
    b.appendChild(para(t("ni.denied.after"), "hint"));
    return b;
  }
  // Explication : iPhone / iPad sans appli installée.
  function iosBody(extra) {
    const b = el("div", "ni-body");
    if (extra) b.appendChild(extra);
    b.appendChild(para(t("ni.ios.text")));
    const ol = el("ol", "ni-steps");
    ["ni.ios.s1", "ni.ios.s2", "ni.ios.s3"].forEach(k => ol.appendChild(el("li", null, t(k))));
    b.appendChild(ol);
    return b;
  }
  // Après « Activer » : résultat de Push.enable(). Refus dans le navigateur : explication une seule fois.
  async function afterEnable(p, src, valid) {
    let res = "error";
    try { res = await p; } catch (e) {}
    if (res === "on") { setRec({ done: Date.now() }); log("enabled", { src }); return "enabled"; }
    if (res === "denied") {
      setRec({ denied: Date.now() });
      log("denied", { src });
      if (!(rec() || {}).deniedInfo && (await whenNoModal(valid))) {
        setRec({ deniedInfo: Date.now() });
        await ask(t("ni.denied.title"), deniedBody(), [{ k: "ok", label: t("ni.ok"), kind: "primary" }]);
      }
      return "denied";
    }
    // Demande fermée sans réponse ou problème technique : comme « Plus tard ».
    setRec({ later: Date.now() });
    log("later", { src, why: res });
    const e = Push.state().err;
    if (e) toast(e);
    return "later";
  }
  const enableBtn = () => ({ k: "enable", label: t("ni.enable"), kind: "primary", now: () => Push.enable() });   // geste : demande tout de suite
  const laterBtn = () => ({ k: "later", label: t("ni.later") });

  // Fenêtre de première ouverture (ou après « Plus tard » + 7 jours).
  async function showFirst(sup, valid) {
    Push.markOffered();
    setRec({ seen: Date.now() });
    if (sup === "ios_install") {
      log("shown", { src: "first", mode: "install" });
      await ask(t("ni.ios.title"), iosBody(), [{ k: "ok", label: t("ni.ok"), kind: "primary" }]);
      setRec({ later: Date.now() });
      log("later", { src: "first", mode: "install" });
      return;
    }
    log("shown", { src: "first" });
    // Étape 71 : mêmes textes que la fenêtre d'un nouveau compte (« Activer les rappels ? », js/accueil-notifs.js).
    let body = null, title = "🔔 " + t("ni.title");
    if (typeof AccNotif !== "undefined") { body = AccNotif.askBody(); title = "🔔 " + t("acn.title"); }
    else { body = el("div", "ni-body"); body.appendChild(para(t("ni.text"))); body.appendChild(para(t("ni.hint"), "hint")); }
    const r = await ask(title, body, [laterBtn(), enableBtn()]);
    if (r.k === "enable") await afterEnable(r.p, "first", valid);
    else { setRec({ later: Date.now() }); log("later", { src: "first" }); }
  }
  // Explication seule : autorisation déjà refusée dans ce navigateur (une seule fois).
  async function showDenied() {
    setRec({ deniedInfo: Date.now(), seen: Date.now() });
    Push.markOffered();
    log("shown", { src: "first", mode: "denied" });
    await ask(t("ni.denied.title"), deniedBody(), [{ k: "ok", label: t("ni.ok"), kind: "primary" }]);
  }
  // Invitation de l'admin (texte de l'admin dans la langue de l'interface, sinon une autre langue disponible).
  async function showAdmin(list, sup, perm, valid) {
    const ids = list.map(a => a.id), a = list[0];
    const tx = Ann.texts(a, state.settings.uiLang) || { lang: state.settings.uiLang, title: "", body: "" };
    Push.markOffered();
    setRec({ seen: Date.now() });
    answer(ids, "shown");   // enregistré dès l'affichage : jamais remontrée sur cet appareil
    const intro = tx.body ? para(tx.body, "ni-admin", tx.lang) : null;
    const title = tx.title || ("🔔 " + t("ni.title"));
    const tl = tx.title ? tx.lang : null;
    if (sup === "ios_install") {
      log("shown", { src: "admin", mode: "install", n: ids.length });
      await ask(title, iosBody(intro), [{ k: "ok", label: t("ni.ok"), kind: "primary" }], tl);
      answer(ids, "install");
      setRec({ later: Date.now() });
      log("later", { src: "admin", mode: "install" });
      return;
    }
    if (perm === "denied") {
      log("shown", { src: "admin", mode: "denied", n: ids.length });
      setRec({ deniedInfo: Date.now() });
      await ask(title, deniedBody(intro), [{ k: "ok", label: t("ni.ok"), kind: "primary" }], tl);
      answer(ids, "denied");
      log("denied", { src: "admin", mode: "denied" });
      return;
    }
    log("shown", { src: "admin", n: ids.length });
    const body = el("div", "ni-body");
    if (intro) body.appendChild(intro);
    if (!tx.body) body.appendChild(para(t("ni.text")));
    const r = await ask(title, body, [laterBtn(), enableBtn()], tl);
    if (r.k === "enable") answer(ids, await afterEnable(r.p, "admin", valid));
    else { answer(ids, "later"); setRec({ later: Date.now() }); log("later", { src: "admin" }); }
  }

  // Au lancement, après les annonces.
  async function check() {
    if (busy || !Push.on()) return;
    busy = true;
    const my = ++token, who = Storage.getUser();
    const valid = () => my === token && Storage.getUser() === who && Push.on();
    try {
      await Push.ready();
      if (!valid()) return;
      const ps = Push.state();
      if (ps.missing || !ps.st || !ps.st.key) return;   // notifications pas installées côté serveur : rien à proposer
      const sup = Push.support(), perm = Push.permission();
      // Étape 71 : nouveau compte sur cet appareil (js/accueil-notifs.js) : guide d'installation (iPhone ET Android, même
      // dans un navigateur sans notifications, ex. celui de KakaoTalk), puis « Activer les rappels ? ». null = règles ci-dessous.
      const accOn = typeof AccNotif !== "undefined" && sup !== "nosw";
      let acc = accOn ? AccNotif.mode(rec(), sup, perm) : null;
      if (!acc && sup !== "ok" && sup !== "ios_install") return;   // navigateur sans notifications, aperçu Claude…
      await flush();
      if (sup === "ok" && perm === "granted" && ps.st.registered) { setRec({ done: Date.now() }); return; }   // déjà actives
      if (acc === "none") return;
      if (acc === "auto") { await AccNotif.run(acc, api, valid); return; }   // sans fenêtre : pas besoin d'attendre les autres
      const list = acc ? [] : await pending();
      if (!(await whenNoModal(valid))) return;
      // L'état a pu changer pendant l'attente (Réglages → Notifications).
      const ps2 = Push.state();
      if (sup === "ok" && Push.permission() === "granted" && ps2.st && ps2.st.registered) return;
      if (acc) {
        acc = AccNotif.mode(rec(), sup, Push.permission());
        if (acc && acc !== "none") await AccNotif.run(acc, api, valid);
        return;
      }
      if (list.length) { await showAdmin(list, sup, Push.permission(), valid); return; }
      const r = rec() || {};
      if (sup === "ok" && Push.permission() === "denied") { if (!r.deniedInfo) await showDenied(); return; }
      if (r.done || r.denied) return;
      // « Plus tard » (ou fenêtre restée sans réponse : appli fermée) : pas avant 7 jours.
      const last = Math.max(Number(r.later) || 0, Number(r.seen) || 0);
      if (last && Date.now() - last < LATER_MS) return;
      await showFirst(sup, valid);
    } catch (e) { /* jamais d'erreur visible */ }
    finally { busy = false; }
  }
  function reset() { token++; busy = false; missing = false; }
  // Étape 71 : outils prêtés à js/accueil-notifs.js (même fenêtre, même état de l'appareil, même journal).
  const api = { rec, setRec, ask, afterEnable, enableBtn, laterBtn, log, showDenied };
  return { check, reset };
})();
