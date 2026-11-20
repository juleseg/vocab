"use strict";

// === DERNIER PASSAGE DE CLAUDE (ÉTAPE 66) ===
// La tâche programmée note l'heure de CHAQUE passage, même quand la file est vide (select public.claude_last_run_mark(),
// claude/supabase-etape66.sql : clé claude_last_run de app_settings, date-heure UTC). Tout compte connecté la lit
// (RPC claude_last_run_get, au plus une fois par minute) ; dernière valeur gardée sur l'appareil (vocabfr.claudelastrun)
// pour le hors connexion ; jamais notée : pas de ligne.
// Affichage : dans le message « Claude passe environ toutes les X h » (queueCadenceText, js/queue.js : « Dernier passage à
// 14 h 07 », heure locale de l'appareil) et dans Administration → Demandes à Claude (ClaudeRun.adminCard), avec une alerte
// si Claude n'est pas passé depuis plus de 3 fois la fréquence réglée (aussi en haut de l'accueil de l'Administration).
const ClaudeRun = (() => {
  const LS = "vocabfr.claudelastrun";
  const GAP = 60000;
  let at = null, fetchedAt = 0, busy = false, missing = false;
  try { const v = localStorage.getItem(LS); const d = v ? new Date(v) : null; if (d && !isNaN(d)) at = d; } catch (e) {}
  function set(iso) {
    const d = iso ? new Date(iso) : null;
    if (!d || isNaN(d)) return false;
    const changed = !at || at.getTime() !== d.getTime();
    at = d;
    try { localStorage.setItem(LS, d.toISOString()); } catch (e) {}
    return changed;
  }
  async function fetch(force) {
    if (busy || auth.mode !== "supabase" || !auth.sbUid || !Supa.client()) return at;
    if (!force && Date.now() - fetchedAt < GAP) return at;
    busy = true; fetchedAt = Date.now();
    try {
      const r = await withTimeout(Supa.client().rpc("claude_last_run_get"), 12000);
      if (r && r.error) throw r.error;
      missing = false;
      if (set(r && r.data && r.data.at)) repaint();
    } catch (e) { if (typeof alIsMissing === "function" && alIsMissing(e)) missing = true; }
    busy = false;
    return at;
  }
  function repaint() {
    try {
      if (currentScreen === "requests") renderRequests();
      else if (currentScreen === "adminreq") renderAdminReq();
      else if (currentScreen === "admin") renderAdmin();
    } catch (e) {}
  }
  // Heure locale : « 14 h 07 » (fr), « 14시 7분 » (ko), « 2:07 PM » (en).
  function hm(d) {
    const ui = state.settings.uiLang;
    if (ui === "fr") return d.getHours() + " h " + String(d.getMinutes()).padStart(2, "0");
    if (ui === "ko") return d.getHours() + "시 " + d.getMinutes() + "분";
    try { return d.toLocaleTimeString("en", { hour: "numeric", minute: "2-digit" }); } catch (e) { return d.getHours() + ":" + String(d.getMinutes()).padStart(2, "0"); }
  }
  // « Dernier passage à 14 h 07. » (aujourd'hui) ou « Dernier passage le 19/11 à 14 h 07. » ; "" si jamais noté.
  function text() {
    if (!at) return "";
    const now = new Date();
    if (at.toDateString() === now.toDateString()) return t("cr.last", { t: hm(at) });
    let d;
    try { d = at.toLocaleDateString(state.settings.uiLang, { day: "numeric", month: "numeric" }); } catch (e) { d = at.toISOString().slice(5, 10); }
    return t("cr.lastDay", { d, t: hm(at) });
  }
  // Fréquence réglée (étape 59) en millisecondes ; défaut 1 heure.
  function cadMs() {
    const c = (typeof Queue !== "undefined" && Queue.cadence && Queue.cadence()) || { value: 1, unit: "h" };
    return Math.max(1, Number(c.value) || 1) * (c.unit === "min" ? 60000 : 3600000);
  }
  function cadText() {
    const c = (typeof Queue !== "undefined" && Queue.cadence && Queue.cadence()) || { value: 1, unit: "h" };
    return t(c.unit === "min" ? "cr.min" : "cr.h", { n: Math.max(1, Number(c.value) || 1) });
  }
  // Pas passé depuis plus de 3 fois la fréquence réglée (connu seulement si une heure a déjà été notée).
  function stale() { return !!at && Date.now() - at.getTime() > 3 * cadMs(); }
  function ago() {
    const ms = Math.max(0, Date.now() - (at ? at.getTime() : Date.now()));
    return ms < 3600000 ? t("cr.min", { n: Math.round(ms / 60000) }) : t("cr.h", { n: Math.round(ms / 360000) / 10 });
  }
  // Carte de l'administration (Demandes à Claude) : dernier passage + alerte.
  function adminCard() {
    fetch();
    const c = el("div", "card cr-card" + (stale() ? " cr-stale" : ""));
    c.appendChild(el("h3", "aq-h", t("cr.adminH")));
    if (missing) { c.appendChild(el("div", "np-msg", t("cr.missing"))); return c; }
    if (!at) { c.appendChild(el("p", "muted", t("cr.never"))); return c; }
    c.appendChild(el("p", null, text()));
    c.appendChild(el("p", stale() ? "q-err cr-alert" : "muted", stale() ? t("cr.alert", { h: ago() }) : t("cr.ok", { f: cadText() })));
    return c;
  }
  // Alerte seule (accueil de l'Administration) : null si tout va bien.
  function alertCard() {
    fetch();
    if (!stale()) return null;
    const c = el("div", "card q-err cr-alert", t("cr.alert", { h: ago() }));
    return c;
  }
  return { fetch, text, stale, adminCard, alertCard, get: () => at, isMissing: () => missing };
})();
