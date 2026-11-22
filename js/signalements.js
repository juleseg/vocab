"use strict";

// === SIGNALER UNE CARTE (ÉTAPE 84) ===
// Un petit 🚩 discret (visuel réduit, zone tactile de 44 px) sur la fiche d'une carte (éditeur, « Mon astuce » d'une liste en
// lecture seule), la carte de révision (Cartes, Écrit, Interrogateur, Dictée) et les jeux à une carte (QCM, Course, Remettre
// en ordre, donc aussi le Mix). Il ouvre une liste de motifs FIXES, sans texte libre (SGL_REASONS), puis « Merci, c'est signalé ».
// Mode Supabase seulement (script claude/supabase-etape84.sql) : sans Supabase, hors connexion au lancement ou script pas
// lancé, le 🚩 n'est pas affiché ou répond par un message court, sans erreur.
// Destination : décidée PAR LE SERVEUR (card_report_send). Carte reliée à un sens du dictionnaire commun (senseId, sauf si la
// case signalée est une « version perso ») ou carte d'une liste partagée → modérateurs « Signalements » + admin ; carte
// personnelle → enregistrée pour Claude seulement (étape 85), avec une copie courte de la carte (snap).
// Étape 85 : la copie porte aussi les traductions de l'exemple de la langue apprise (tr) et, hors vocabulaire, les champs
// translation / explanation / note / wrong / correct / body : Claude lit ce qu'il peut corriger (js/signalements-claude.js).
// Anti-abus (serveur) : 1 signalement par compte, par carte et par motif ; SGL_DAY_MAX par jour ; compte bloqué refusé.
// L'appareil retient seulement ce qu'il a déjà envoyé (clé locale vocabfr.sgl:<compte>, jamais dans le compte) pour griser
// les motifs déjà choisis.
// Retour : quand un signalement est traité, pastille « Merci, corrigé » (card_reports_mine, au lancement puis au retour dans
// l'appli, au plus toutes les SGL_CHECK_MS) ; vue = card_reports_seen. Jamais pendant une séance ni par-dessus une fenêtre.
// Textes : js/i18n/signal-<langue>.js (clés sgl.*). Styles : css/app-9.css (.sgl-*).
const SGL_REASONS = ["translation", "gender", "example", "sound", "other"];
const SGL_ICON = { translation: "🔤", gender: "⚥", example: "💬", sound: "🔊", other: "❓" };
const SGL_DAY_MAX = 20;
const SGL_CHECK_MS = 10 * 60000;
const SGL_BOOT_MS = 9000;
const SGL_PILL_MS = 9000;
const SGL_KEEP = 1500;          // signalements retenus sur l'appareil (les plus récents)
const SGL_SNAP_LEN = 160;       // longueur maximale d'un texte de la copie de carte

const Sgl = (() => {
  let missing = false, busy = false, lastCheck = 0, timer = null, token = 0, sent = null, sentFor = "";

  function usable() {
    return typeof auth !== "undefined" && auth.mode === "supabase" && !!auth.sbUid && !!Supa.client() && !!Storage.getUser() && !missing;
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

  // --- Ce que cet appareil a déjà envoyé : { "<carte>|<motif>": 1 } ---
  function key() { return CONFIG.LS_USER_PREFIX + "sgl:" + (Storage.getUser() || ""); }
  function mine() {
    const u = Storage.getUser() || "";
    if (sent && sentFor === u) return sent;
    sentFor = u; sent = [];
    try { sent = arr(JSON.parse(localStorage.getItem(key()) || "[]")).map(String).slice(-SGL_KEEP); } catch (e) { sent = []; }
    return sent;
  }
  function remember(cardId, reason) {
    const k = cardId + "|" + reason, a = mine();
    if (!a.includes(k)) a.push(k);
    if (a.length > SGL_KEEP) a.splice(0, a.length - SGL_KEEP);
    try { localStorage.setItem(key(), JSON.stringify(a)); } catch (e) {}
  }
  function done(c, reason) { return mine().includes(c.id + "|" + reason); }

  // --- Ce qui part au serveur ---
  // Case « version perso » de la carte concernée par le motif : la valeur signalée n'est alors pas celle du dictionnaire commun.
  function ownHit(c, reason) {
    const own = arr(c.own).map(String);
    if (!own.length) return false;
    if (reason === "translation") return own.some(k => k.startsWith("w:"));
    if (reason === "gender") return own.some(k => k.startsWith("p:"));
    if (reason === "example") return own.some(k => k.startsWith("e:") || k.startsWith("t:"));
    return false;
  }
  function cut(v) { return String(v == null ? "" : v).slice(0, SGL_SNAP_LEN); }
  // Copie courte de la carte (gardée par le serveur pour une carte personnelle seulement : Claude, étape 85).
  function snap(c) {
    const o = { type: cardType(c) };
    if (isVocab(c)) {
      o.terms = {};
      Object.keys(c.terms || {}).slice(0, 8).forEach(L => { if (c.terms[L]) o.terms[L] = cut(c.terms[L]); });
      if (c.pos && typeof c.pos === "object") { o.pos = {}; Object.keys(c.pos).slice(0, 8).forEach(L => { if (c.pos[L]) o.pos[L] = cut(c.pos[L]).slice(0, 24); }); }
      else if (c.pos) o.pos = cut(c.pos).slice(0, 24);
      const m = typeof exMap === "function" ? exMap(c) : null;
      if (m) { o.ex = {}; Object.keys(m).slice(0, 4).forEach(L => { const x = typeof exText === "function" ? exText(c, L) : ""; if (x) o.ex[L] = cut(x); }); }
      const tg = cardLangs(c).target, en = tg && typeof exEntry === "function" ? exEntry(c, tg) : null;   // étape 85 : traductions de l'exemple
      if (en && en.text && en.tr) { const tr = {}; Object.keys(en.tr).slice(0, 6).forEach(L => { if (typeof en.tr[L] === "string" && en.tr[L]) tr[L] = cut(en.tr[L]); }); if (Object.keys(tr).length) { o.tr = tr; if (!o.ex) o.ex = {}; if (!o.ex[tg]) o.ex[tg] = cut(en.text); } }
      if (c.gender) o.gender = typeof c.gender === "object" ? JSON.parse(JSON.stringify(c.gender)) : cut(c.gender).slice(0, 12);
    } else {
      ["lang", "verb", "tense", "person", "answer", "sentence", "hint", "title", "question", "translation", "explanation", "note", "wrong", "correct", "body"].forEach(f => { if (typeof c[f] === "string" && c[f]) o[f] = cut(c[f]); });
    }
    let s = "";
    try { s = JSON.stringify(o); } catch (e) { return { type: o.type }; }
    return s.length <= 5000 ? o : { type: o.type };
  }
  function payload(c, reason, ctx) {
    const lg = cardLangs(c), l = getList(c.listId);
    const p = { card: String(c.id), reason, ctx: ctx || "", version: String(APP_VERSION), lang: lg.target || null,
                langs: [lg.target].concat(arr(lg.support)).filter((x, i, a) => x && a.indexOf(x) === i).slice(0, 8), snap: snap(c) };
    if (isVocab(c) && c.senseId && !ownHit(c, reason)) p.sense = String(c.senseId);
    if (isSharedList(l)) p.list = l.shared.id;
    return p;
  }
  function errText(e) {
    const h = String((e && e.hint) || "");
    if (h === "rep_dup") return t("sgl.err.dup");
    if (h === "rep_day") return t("sgl.err.day", { n: SGL_DAY_MAX });
    if (h === "rep_blocked") return t("sgl.err.blocked");
    if (isMissing(e)) return t("sgl.err.other");
    if (typeof sbErrKind === "function" && sbErrKind(e) === "net") return t("sgl.err.offline");
    return t("sgl.err.other");
  }
  async function send(c, reason, ctx) {
    if (busy) return false;
    if (typeof navigator !== "undefined" && navigator.onLine === false) { toast(t("sgl.err.offline")); return false; }
    busy = true;
    const u = Storage.getUser();
    try {
      await rpc("card_report_send", { p: payload(c, reason, ctx) });
      if (Storage.getUser() === u) remember(c.id, reason);
      toast(t("sgl.thanks"));
      try { Activity.log("card_report", { reason, ctx: ctx || "" }); } catch (e) {}
      return true;
    } catch (e) {
      const h = String((e && e.hint) || "");
      if (h === "rep_dup" && Storage.getUser() === u) remember(c.id, reason);   // déjà signalé depuis un autre appareil
      if (isMissing(e)) missing = true;                                           // script de l'étape 84 pas lancé : 🚩 retiré ensuite
      toast(errText(e));
      return false;
    } finally { busy = false; }
  }

  // --- Fenêtre des motifs (liste fixe, aucun texte libre) ---
  function open(c, ctx) {
    if (!c || !usable()) return;
    const body = el("div", "sgl-list");
    body.appendChild(el("p", "hint", t("sgl.help")));
    let close = null;
    SGL_REASONS.forEach(r => {
      const was = done(c, r);
      const b = el("button", "sgl-reason" + (was ? " sgl-done" : ""));
      b.type = "button"; b.dataset.reason = r; b.disabled = was;
      b.append(el("span", "sgl-ri", SGL_ICON[r]), el("span", "sgl-rt", t("sgl.r." + r)));
      if (was) b.appendChild(el("span", "sgl-rk", "✓ " + t("sgl.already")));
      b.addEventListener("click", async () => {
        if (b.disabled) return;
        body.querySelectorAll("button").forEach(x => { x.disabled = true; });
        await send(c, r, ctx);
        if (close) close();
      });
      body.appendChild(b);
    });
    close = openModal("🚩 " + t("sgl.title"), body, [{ label: t("cancel") }]);
  }

  // --- Le 🚩 : petit visuel, zone tactile de 44 px. corner : posé dans le coin d'une carte de question (jeux). ---
  // label : avec un texte court (fiche d'une carte). Renvoie le bouton, ou null (hors Supabase : rien n'est ajouté).
  function flag(host, c, ctx, opts) {
    if (!host || !c || !c.id || !usable()) return null;
    const b = el("button", "sgl-flag" + (opts && opts.corner ? " sgl-corner" : "") + (opts && opts.label ? " sgl-labeled" : ""));
    b.type = "button";
    b.setAttribute("aria-label", t("sgl.flag"));
    b.title = t("sgl.flag");
    b.appendChild(el("span", "sgl-ico", "🚩"));
    if (opts && opts.label) b.appendChild(el("span", "sgl-txt", t("sgl.flag")));
    ["click", "pointerdown", "pointerup", "touchstart", "mousedown", "keydown"].forEach(ev =>
      b.addEventListener(ev, e => { e.stopPropagation(); if (ev === "click") { e.preventDefault(); open(c, ctx); } }));
    if (opts && opts.corner) host.classList.add("sgl-host");
    host.appendChild(b);
    return b;
  }

  // --- Pastille « Merci, corrigé » ---
  function pill(n) {
    let p = $("#sglPill");
    if (p) p.remove();
    p = el("button", "sgl-pill", "🚩 " + t("sgl.fixed") + (n > 1 ? " ×" + n : ""));
    p.id = "sglPill"; p.type = "button";
    p.setAttribute("role", "status");
    const hide = () => { p.classList.remove("show"); setTimeout(() => p.remove(), 300); };
    p.addEventListener("click", hide);
    document.body.appendChild(p);
    requestAnimationFrame(() => p.classList.add("show"));
    setTimeout(hide, SGL_PILL_MS);
  }
  async function check(force) {
    if (!usable() || (typeof Release !== "undefined" && Release.blocked && Release.blocked())) return;
    const now = Date.now();
    if (!force && now - lastCheck < SGL_CHECK_MS) return;
    lastCheck = now;
    const my = token, u = Storage.getUser();
    let d = null;
    try { d = await rpc("card_reports_mine"); } catch (e) { if (isMissing(e)) missing = true; return; }
    const n = num(Number(d && d.fixed), 0);
    if (!n || my !== token || Storage.getUser() !== u) return;
    const free = await whenNoModal(() => my === token && Storage.getUser() === u);   // jamais pendant une séance ni sur une fenêtre
    if (!free) return;
    pill(n);
    try { await rpc("card_reports_seen"); } catch (e) {}
  }
  function start() {
    token++; missing = false; lastCheck = 0; sent = null;
    clearTimeout(timer);
    const my = token;
    timer = setTimeout(() => { if (my === token) check(true); }, SGL_BOOT_MS);
  }
  function reset() {
    token++; clearTimeout(timer); sent = null; lastCheck = 0;
    const p = $("#sglPill"); if (p) p.remove();
  }
  return { usable, flag, open, send, check, start, reset, done, payload, isMissing };
})();

document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") { try { Sgl.check(false); } catch (e) {} } });
