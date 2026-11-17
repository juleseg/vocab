"use strict";

// === ESPACE DE NOMS (window.App) ===
// Étape 33 : l'appli est répartie en plusieurs scripts classiques, chargés dans l'ordre par index.html.
// Les noms de premier niveau (const, let, function) restent partagés entre les fichiers, comme avant le découpage.
// window.App : seul espace de noms global pour ce qui sera ajouté ensuite.
window.App = window.App || {};

// === CONFIG ===
const CONFIG = {
  LS_KEY: "vocabfr.data.v1",     // anciennes données (avant les comptes), jamais effacées
  REMOTE_DOC: "state",          // anciennes données cloud : data/users/<idClaude>/state, jamais effacées
  LS_USER_PREFIX: "vocabfr.",    // données d'un compte : localStorage "vocabfr.user:<identifiant>"
  LS_ACCOUNTS: "vocabfr.accounts",
  LS_SESSION: "vocabfr.session", // compte connecté sur cet appareil
  REMOTE_ACCOUNTS: "accounts",   // registre des comptes : data/users/<idClaude>/accounts
  SAVE_DELAY_MS: 2000,          // écritures cloud regroupées sur 2 s
  RETRY_MS: 20000,              // nouvel essai automatique après un échec d'envoi
  LS_SYNCED: "vocabfr.synced:", // + identifiant : updatedAt des données en ligne à la dernière synchro réussie (détection des conflits)
  LS_PREFS: "vocabfr.prefs",    // langue et thème de l'écran de connexion
  LS_REMEMBER: "vocabfr.remember", // "0" = ne pas rester connecté sur cet appareil
  LS_SB_PROFILE: "vocabfr.sb.profile", // dernier compte Supabase ouvert (pour l'usage hors connexion)
  SB_CDN: "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2",
  SB_EMAIL_DOMAIN: "vocab.local", // email technique = <identifiant>@vocab.local (jamais affiché, même valeur que dans le SQL)
  REMOTE_TIMEOUT_MS: 10000,
  MAX_DOC_BYTES: 250 * 1024,    // taille max d'un document cloud (un morceau)
  PIECE_MAX_BYTES: 150 * 1024,  // taille visée d'un morceau de cartes (marge sous MAX_DOC_BYTES)
  CARDS_PER_PIECE: 200,         // cartes max par morceau user:<id>:cards:<listId>:<n>
  PROPOSALS_PER_PIECE: 500,     // propositions max par morceau user:<id>:proposals:<n>
  IDS_PER_PIECE: 2000,          // ids max par morceau user:<id>:resume:<n> (complétion en pause)
  IMPORT_BATCH: 200,            // cartes enregistrées par lot pendant un import
  LEITNER_INTERVALS_DAYS: [0, 1, 3, 7, 14, 30], // index = boîte
  AI_BATCH: 20,          // cartes max par appel à Claude (et par partie du texte « Préparer pour Claude »)
  AUTO_CHECK_DAYS: 7,    // vérification automatique au plus une fois par semaine
  UNDO_MS: 6000,         // durée du bouton « Annuler » après une action groupée
  REJECT_MAX: 3000,      // valeurs refusées gardées (pour ne plus les reproposer)
  QUEUE_MAX_BATCHES: 10, // file d'attente Claude : lots de AI_BATCH cartes max par demande (au-delà : plusieurs demandes)
  QUEUE_POLL_MS: 120000, // file d'attente Claude : nouvelle vérification toutes les 2 min tant qu'une demande est en cours
  AI_AWAY_MS: 10000,     // complétion : appli en arrière-plan plus longtemps → lot en cours interrompu, bandeau « Reprendre »
  PV_PAGE: 50,           // « À valider » : lignes max par page (seule la page affichée est dans le DOM)
  PV_CHUNK: 200          // « À valider » : propositions acceptées / refusées par paquet
};
// Numéro de la dernière étape réalisée : affiché en bas des Réglages, envoyé au journal d'activité et dans la fiche appareil.
const APP_VERSION = "38";

// === I18N ===
// Textes de l'interface : un fichier par langue (js/i18n/ko.js, fr.js, en.js), chargés après languages.js.
const I18N = {};

function t(key, vars) {
  const lang = (state && state.settings && state.settings.uiLang) || defaultLang();
  let s = (I18N[lang] && I18N[lang][key]) || I18N.fr[key] || key;
  if (vars) for (const k in vars) s = s.split("{" + k + "}").join(String(vars[k]));
  return s;
}

function applyI18n() {
  document.documentElement.lang = state.settings.uiLang;
  document.querySelectorAll("[data-i18n]").forEach(el => { el.textContent = t(el.dataset.i18n); });
  document.title = t("appTitle");
}

// === UTILS ===
const $ = sel => document.querySelector(sel);
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
function num(v, d) { return (typeof v === "number" && isFinite(v)) ? v : d; }
function arr(v) { return Array.isArray(v) ? v : []; }
function clampInt(v, min, max, d) { const n = parseInt(v, 10); return isFinite(n) ? Math.min(max, Math.max(min, n)) : d; }
function todayStr(date) {
  const d = date || new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}
function withTimeout(p, ms) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);
}

// === UI : MODALE & TOAST ===
let toastTimer = null;
function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2200);
}

// actions : [{ label, kind: "primary"|"danger"|"", onClick: () => (false pour garder ouverte) }]
function openModal(title, bodyNode, actions, opts) {
  const bg = document.createElement("div");
  bg.className = "modal-bg";
  const box = document.createElement("div");
  box.className = "modal";
  const h = document.createElement("h3");
  h.textContent = title;
  box.appendChild(h);
  if (bodyNode) box.appendChild(bodyNode);
  const btns = document.createElement("div");
  btns.className = "btns" + (actions.length === 2 ? " two" : "");
  btns.style.marginTop = "16px";
  const close = () => bg.remove();
  actions.forEach(a => {
    const b = document.createElement("button");
    b.className = "btn " + (a.kind || "");
    b.textContent = a.label;
    b.addEventListener("click", () => { const keep = a.onClick ? a.onClick() === false : false; if (!keep) close(); });
    btns.appendChild(b);
  });
  box.appendChild(btns);
  bg.appendChild(box);
  if (!(opts && opts.locked)) bg.addEventListener("click", e => { if (e.target === bg) close(); });
  document.body.appendChild(bg);
  return close;
}
// Étape 38 : attend qu'aucune fenêtre ne soit ouverte (ni séance de révision en cours) avant d'en ouvrir une autre,
// pour ne jamais superposer deux fenêtres au lancement (ordre : migration / sauvegarde, annonce, invitation).
// stillValid() : faux = abandon (déconnexion, changement de compte) ; renvoie true quand la voie est libre.
function whenNoModal(stillValid) {
  const free = () => !document.querySelector(".modal-bg") &&
    !(typeof currentScreen !== "undefined" && currentScreen === "review" && typeof rv !== "undefined" && rv && rv.phase !== "config");
  return new Promise(res => {
    const tick = () => {
      if (stillValid && !stillValid()) { res(false); return; }
      if (free()) res(true); else setTimeout(tick, 600);
    };
    tick();
  });
}
// Fenêtre avec barre de progression (ne se ferme pas en touchant le fond). Renvoie { set(fraction, texte), close }.
function openProgress(title, text, actions) {
  const wrap = document.createElement("div");
  const bar = document.createElement("div"); bar.className = "progress";
  const fill = document.createElement("div"); fill.className = "progress-fill";
  bar.appendChild(fill);
  bar.setAttribute("role", "progressbar"); bar.setAttribute("aria-valuemin", "0"); bar.setAttribute("aria-valuemax", "100");
  const p = document.createElement("p"); p.className = "muted progress-text"; p.textContent = text || "";
  wrap.append(bar, p);
  const close = openModal(title, wrap, actions || [], { locked: true });
  const set = (frac, txt) => {
    const v = Math.max(0, Math.min(100, Math.round((frac || 0) * 100)));
    fill.style.width = v + "%"; bar.setAttribute("aria-valuenow", String(v));
    if (txt !== undefined) p.textContent = txt;
  };
  set(0);
  return { set, close };
}

// === TRAITEMENTS LONGS (REPRISE, ÉCRAN ALLUMÉ) ===
// Complétion par Claude et Accepter / Refuser groupés dans « À valider » : écran gardé allumé (Wake Lock, si le téléphone le permet)
// et bandeau « Reprendre / Abandonner » quand un traitement a été interrompu (appli en arrière-plan, rechargée, ou arrêtée).
const Wake = (() => {
  let lock = null, users = 0;
  async function acquire() {
    try {
      if (!users || lock || document.visibilityState !== "visible" || !navigator.wakeLock) return;
      const l = await navigator.wakeLock.request("screen");
      if (!users) { try { l.release(); } catch (e) {} return; }
      lock = l;
      l.addEventListener("release", () => { if (lock === l) lock = null; });
    } catch (e) { lock = null; }   // refusé (économie d'énergie, iframe…) : sans effet
  }
  return {
    on() { users++; acquire(); },
    off() { users = Math.max(0, users - 1); if (!users && lock) { try { lock.release(); } catch (e) {} lock = null; } },
    refresh: acquire                 // le système relâche le verrou quand l'appli passe en arrière-plan
  };
})();

// Bandeau(x) en haut de l'écran : complétion interrompue (state.aiResume), Accepter / Refuser interrompu (pvJobSaved())
// et liaison au dictionnaire commun en pause (étape 36).
function renderResumeBars() {
  const box = $("#resumeBars");
  if (!box) return;
  box.textContent = "";
  try {
    if (!Storage.getUser() || currentScreen === "review") return;
    const bar = (msg, onResume, onDrop) => {
      const b = el("div", "rs-bar");
      b.appendChild(el("div", null, msg));
      const btns = el("div", "btns two");
      const bD = el("button", "btn", t("rs.drop")), bR = el("button", "btn primary", t("rs.resume"));
      bD.addEventListener("click", onDrop);
      bR.addEventListener("click", onResume);
      btns.append(bD, bR);
      b.appendChild(btns);
      box.appendChild(b);
    };
    if (!aiJob && state.aiResume && state.aiResume.ids.length) {
      const n = state.aiResume.ids.length;
      bar(t("rs.ai", { n, b: Math.ceil(n / CONFIG.AI_BATCH) }),
        () => { box.textContent = ""; startCompletion(state.aiResume.ids.slice(), null, true); },
        () => { state.aiResume = null; updResumeSync(null); commitQuiet(); renderResumeBars(); toast(t("rs.dropped")); });
    }
    const pj = !pvJob && pvJobSaved();
    if (pj) {
      bar(t("rs.pv" + pj.kind, { n: pj.ids.length }),
        () => { box.textContent = ""; pvRun(pj.kind, pj.ids, pj.edits || {}, null); },
        () => { pvJobStore(null); renderResumeBars(); toast(t("rs.dropped")); });
    }
    Dict.resumeBar(box);   // liaison au dictionnaire commun en pause (étape 36)
  } catch (e) { box.textContent = ""; }
}

// Arrière-plan / retour pendant une complétion : sauvegarde immédiate, puis au retour reprise du verrou d'écran
// et, après une longue absence, arrêt du lot en cours (il sera refait) → bandeau « Reprendre / Abandonner ».
try {
  document.addEventListener("visibilitychange", () => {
    const job = aiJob;
    if (document.visibilityState === "hidden") {
      if (job) { job.hiddenAt = Date.now(); job.wasHidden = true; if (job.onHide) job.onHide(); }
      return;
    }
    Wake.refresh();
    if (job && job.hiddenAt && Date.now() - job.hiddenAt > CONFIG.AI_AWAY_MS) { job.interrupted = true; job.ctl.abort(); }
    if (job) job.hiddenAt = 0;
    renderResumeBars();
  });
} catch (e) {}

// === EXPORTS (window.App) ===
App.CONFIG = CONFIG;
App.APP_VERSION = APP_VERSION;
App.I18N = I18N;
