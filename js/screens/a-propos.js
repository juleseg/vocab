"use strict";

// === ÉCRAN : À PROPOS (étape 39) ===
// Ouvert depuis les Réglages (carte « À propos ») et depuis le bouton ⓘ de l'en-tête (#a-propos).
// Nom et version de l'appli, « Revoir le tutoriel » (affiché seulement quand le tutoriel existe : étape 40),
// partage de l'appli (Partager / Copier le lien / QR code), puis toutes les nouveautés (js/changelog.js).
const APP_URL = "https://juleseg.github.io/vocab/";

// Points d'une entrée dans la langue de l'interface (sinon français, anglais, coréen).
function changelogPoints(e) {
  const p = (e && e.points) || {};
  const ui = state.settings.uiLang;
  const l = [ui, "fr", "en", "ko"].find(x => arr(p[x]).length) || ui;
  return { lang: l, items: arr(p[l]) };
}
function changelogDate(d) {
  try {
    const [y, m, j] = String(d || "").split("-").map(Number);
    if (!y || !m || !j) return "";
    return new Date(y, m - 1, j).toLocaleDateString(state.settings.uiLang, { year: "numeric", month: "long", day: "numeric" });
  } catch (e) { return String(d || ""); }
}
// Nombre de versions visibles par les utilisateurs (étape 50, réglage admin « Nouveautés visibles ») :
// null = toutes ; 0 = aucune ; N = les N dernières (versions APP_VERSION − N + 1 à APP_VERSION, selon les entrées qui existent).
function newsLimit() {
  try { const n = Release.setting("changelog_count"); return typeof n === "number" && n >= 0 && n <= 100 ? n : null; } catch (e) { return null; }
}
function newsIsAdmin() { try { return !!(auth && auth.isAdmin); } catch (e) { return false; } }
// Entrées montrées dans À propos : l'admin voit toujours tout.
function newsVisible() {
  const n = newsLimit();
  if (n === null || newsIsAdmin()) return CHANGELOG;
  const cur = parseInt(APP_VERSION, 10), min = cur - n + 1;
  return CHANGELOG.filter(e => { const v = parseInt(e.version, 10); return v >= min && v <= cur; });
}
function changelogEntry(e, cls) {
  const box = el("div", "ab-ver" + (cls ? " " + cls : ""));
  const head = el("div", "ab-ver-head");
  head.appendChild(el("b", null, t("about.version", { v: e.version })));
  const d = changelogDate(e.date);
  if (d) head.appendChild(el("span", "muted", d));
  box.appendChild(head);
  const pts = changelogPoints(e), ul = el("ul", "ab-points");
  ul.lang = pts.lang;
  pts.items.forEach(s => ul.appendChild(el("li", null, s)));
  box.appendChild(ul);
  return box;
}

// --- Partage ---
// « Partager » : feuille de partage du téléphone (Web Share API). Pas de partage possible → lien copié.
// Partage annulé par l'utilisateur (AbortError) : rien.
async function shareApp() {
  const data = { title: t("appTitle"), text: t("about.shareText"), url: APP_URL };
  let can = false;
  try { can = !!navigator.share && (!navigator.canShare || navigator.canShare(data)); } catch (e) { can = false; }
  if (!can) { copyAppLink(); return; }
  try { await navigator.share(data); }
  catch (e) {
    if (e && e.name === "AbortError") return;
    copyAppLink();   // partage refusé (aperçu Claude, navigateur sans permission…) : repli
  }
}
function copyAppLink() {
  const done = ok => toast(ok ? t("about.copied") : t("about.copyFail", { url: APP_URL }));
  const legacy = () => {
    try {
      const ta = document.createElement("textarea");
      ta.value = APP_URL; ta.setAttribute("readonly", "");
      ta.style.position = "fixed"; ta.style.opacity = "0"; ta.style.top = "0";
      document.body.appendChild(ta);
      ta.select(); ta.setSelectionRange(0, APP_URL.length);
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch (e) { return false; }
  };
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(APP_URL).then(() => done(true), () => done(legacy()));
      return;
    }
  } catch (e) {}
  done(legacy());
}

function renderAbout() {
  const root = $("#screen-about");
  if (!root) return;
  root.textContent = "";
  const cur = CHANGELOG.find(e => e.version === APP_VERSION);

  // En-tête : nom et version.
  const top = el("div", "card ab-top");
  top.appendChild(el("div", "ab-name", t("appTitle")));
  top.appendChild(el("div", "muted", t("about.version", { v: APP_VERSION }) + (cur && cur.date ? " · " + changelogDate(cur.date) : "")));
  top.appendChild(el("p", "muted ab-desc", t("about.desc")));
  // Tutoriel : seulement quand il existe (étape 40).
  if (typeof Tutorial !== "undefined" && Tutorial && typeof Tutorial.start === "function") {
    const tut = el("button", "btn", t("about.tutorial"));
    tut.type = "button";
    tut.addEventListener("click", () => Tutorial.start());
    top.appendChild(tut);
  }
  root.appendChild(top);

  // Étape 52 : « 💡 Proposer une idée » / « Mes idées » (mode Supabase seulement).
  try { const ic = Ideas.aboutCard(); if (ic) root.appendChild(ic); } catch (e) {}
  // Étape 53 : « ✉️ Écrire à l'équipe » (mode Supabase seulement).
  try { const mc = Messages.aboutCard(); if (mc) root.appendChild(mc); } catch (e) {}

  // Partager l'appli.
  const sh = el("div", "card ab-share");
  sh.appendChild(el("h2", null, t("about.shareTitle")));
  sh.appendChild(el("p", "muted", t("about.shareHelp")));
  const btns = el("div", "btns two");
  const bS = el("button", "btn primary", t("about.share")), bC = el("button", "btn", t("about.copy"));
  bS.type = "button"; bC.type = "button";
  bS.addEventListener("click", shareApp);
  bC.addEventListener("click", copyAppLink);
  btns.append(bS, bC);
  sh.appendChild(btns);
  sh.appendChild(el("div", "ab-url", APP_URL));
  const qr = QR.svg(APP_URL, 220);
  if (qr) {
    qr.setAttribute("aria-label", t("about.qrAlt"));
    const q = el("div", "ab-qr");
    q.appendChild(qr);
    sh.appendChild(q);
    sh.appendChild(el("p", "muted ab-qr-help", t("about.qrHelp")));
  }
  root.appendChild(sh);

  // Nouveautés : la plus récente en haut. Utilisateur : les N dernières versions selon le réglage de l'admin (aucun bloc
  // si 0). Admin : toute la liste, avec la note sur ce que voient les utilisateurs.
  const lim = newsLimit(), list = newsVisible();
  if (list.length && !(lim === 0 && !newsIsAdmin())) {
    const nw = el("div", "card");
    nw.appendChild(el("h2", null, t("about.news")));
    if (lim !== null && newsIsAdmin()) nw.appendChild(el("p", "muted ab-newsnote", t(lim === 0 ? "nv.note.zero" : lim === 1 ? "nv.note.one" : "nv.note.n", { n: lim })));
    list.forEach((e, i) => nw.appendChild(changelogEntry(e, i === 0 ? "first" : "")));
    root.appendChild(nw);
  }
}

// === QUOI DE NEUF (étape 39) ===
// Une seule fois au premier lancement d'une nouvelle version, sur chaque appareil et pour chaque compte
// (vocabfr.whatsnew:<identifiant> = dernière version présentée). Lancée APRÈS les autres fenêtres du lancement
// (migration / sauvegarde / conflit, annonces, invitation aux notifications) et jamais par-dessus : whenNoModal.
// Affiche les points de la version en cours (entrée APP_VERSION de js/changelog.js) ; « Tout voir » ouvre À propos.
// Rien d'affiché : version sans entrée (étape sans changement visible), ou compte tout neuf (aucune révision et rien
// de noté sur cet appareil) — la version est alors seulement notée.
const WhatsNew = (() => {
  let token = 0, busy = false;
  function key() { return CONFIG.LS_USER_PREFIX + "whatsnew:" + (Storage.getUser() || ""); }
  function seen() { try { return localStorage.getItem(key()); } catch (e) { return APP_VERSION; } }
  function mark() { try { localStorage.setItem(key(), APP_VERSION); } catch (e) {} }
  async function check() {
    const who = Storage.getUser();
    if (busy || !who) return;
    const s = seen();
    if (s === APP_VERSION || (s && Number(s) >= Number(APP_VERSION))) return;
    const entry = CHANGELOG.find(e => e.version === APP_VERSION);
    if (!entry || newsLimit() === 0 || (s === null && !arr(state.history).length)) { mark(); return; }   // N = 0 (étape 50) : jamais
    busy = true;
    const my = ++token;
    try {
      if (!(await whenNoModal(() => my === token && Storage.getUser() === who))) return;
      mark();   // noté dès l'affichage : jamais remontrée, même si l'appli est fermée pendant la fenêtre
      const body = el("div", "wn-body");
      const pts = changelogPoints(entry), ul = el("ul", "ab-points");
      ul.lang = pts.lang;
      pts.items.forEach(x => ul.appendChild(el("li", null, x)));
      body.appendChild(ul);
      openModal("✨ " + t("wn.title", { v: APP_VERSION }), body, [
        { label: t("wn.all"), onClick: () => { try { history.replaceState(null, "", "#" + HASH_OF.about); } catch (e) {} showScreen("about"); } },
        { label: t("wn.ok"), kind: "primary" }
      ], { locked: true });
    } catch (e) { /* jamais d'erreur visible */ }
    finally { busy = false; }
  }
  function reset() { token++; busy = false; }
  return { check, reset };
})();
