"use strict";

// === MOTS DIFFICILES : RÈGLES ET DONNÉES (ÉTAPE 57) ===
// Données : state.hard (morceau user_data « hard ») et state.tips (morceau « tips »), voir js/storage.js.
//   state.hard.w[idCarte][langueÉtudiée] = { n, r, o?, h?, f?, p?, at? }
//     n = « Raté » au total, r = « Raté » de suite, h = 1 si le mot est difficile, o = « Trouvé » de suite depuis qu'il est
//     difficile, f = 1 si réparé (image, exemple ou astuce ajoutés depuis), p = 1 si en pause, at = date.
//   state.hard.c = paires qui se ressemblent : { a, b, L, n, at } (a < b, n = nombre de vraies confusions).
//   state.tips[idCarte] = « Mon astuce » (150 caractères), toujours privée : jamais dans une carte, une liste commune ni le dictionnaire.
// Règles :
//  - Un mot (par carte ET par langue étudiée) devient difficile à HD_TOTAL « Raté » au total, ou HD_STREAK « Raté » de suite.
//  - Il cesse de l'être après HD_EXIT « Trouvé » de suite, ou un « Trouvé » après une réparation. Ses compteurs repartent alors de zéro.
//  - « Hésité » ne compte pas comme « Raté » et coupe la série de « Raté ». Les erreurs de jeux ne touchent pas aux compteurs.
//  - Un mot en pause n'est plus jamais « à réviser » (Leitner.isDue) ; sa progression reste intacte.
//  - Une paire est une confusion réelle (mauvaise réponse en Écrit ou en QCM = un autre mot de la même langue étudiée),
//    « qui se ressemble » à partir de HD_PAIR_MIN confusions.
// Seul point d'entrée en écriture pour les réponses : Leitner.grade → Hard.onAnswer (jamais appelé par les jeux).
const HD_TOTAL = 6;
const HD_STREAK = 4;
const HD_EXIT = 3;
const HD_PAIR_MIN = 2;
const HD_TIP_MAX = 150;

const Hard = (() => {
  // --- Accès aux données (créées à la demande) ---
  function H() {
    if (!state.hard || typeof state.hard !== "object" || !state.hard.w) state.hard = { v: 1, w: {}, c: [] };
    if (!Array.isArray(state.hard.c)) state.hard.c = [];
    return state.hard;
  }
  function langIn(c, L) { return L || (c && c.unitLang) || primaryLang(c); }
  function rec(id, L) { const w = H().w[id]; return (w && w[L]) || null; }
  function ensureRec(id, L) {
    const h = H();
    if (!h.w[id]) h.w[id] = {};
    if (!h.w[id][L]) h.w[id][L] = { n: 0, r: 0 };
    return h.w[id][L];
  }
  function tidy(id, L) {   // supprime l'enregistrement s'il est vide (le morceau reste petit)
    const w = H().w[id];
    if (!w || !w[L]) return;
    const r = w[L];
    if (!r.n && !r.r && !r.h && !r.p) delete w[L];
    if (!Object.keys(w).length) delete H().w[id];
  }
  function cardOf(id) { return state.cards.find(c => c.id === id) || null; }

  // --- Lecture ---
  function isHard(c, L) { const r = rec(c.id, langIn(c, L)); return !!(r && r.h); }
  function isPaused(c, L) { const r = rec(c.id, langIn(c, L)); return !!(r && r.p); }
  function hardLangs(c) { const w = H().w[c.id] || {}; return Object.keys(w).filter(L => w[L].h); }
  function counts(c, L) { const r = rec(c.id, langIn(c, L)) || {}; return { n: r.n || 0, r: r.r || 0, o: r.o || 0 }; }

  // --- Réponse à une carte (appelé par Leitner.grade, jamais pour un jeu) ---
  // result : "known" (Trouvé) | "review" (Hésité) | "unknown" (Raté).
  // Renvoie { hard, became, exited, missed } : missed = « Raté » sur un mot difficile → proposer « Réparer ce mot ».
  function onAnswer(c, L, result, now) {
    now = now || Date.now();
    L = langIn(c, L);
    const r = ensureRec(c.id, L);
    const was = !!r.h;
    let became = false, exited = false;
    if (result === "unknown") {
      r.n = Math.min(9999, (r.n || 0) + 1);
      r.r = Math.min(9999, (r.r || 0) + 1);
      if (r.h) r.o = 0;
    } else {
      r.r = 0;
      if (r.h) {
        if (result === "known") {
          r.o = (r.o || 0) + 1;
          if (r.o >= HD_EXIT || r.f) exited = true;
        } else r.o = 0;
      }
    }
    if (exited) { delete r.h; delete r.o; delete r.f; delete r.at; r.n = 0; r.r = 0; }
    else if (!r.h && (r.n >= HD_TOTAL || r.r >= HD_STREAK)) { r.h = 1; r.o = 0; r.at = now; became = true; }
    const out = { hard: !!r.h, became, exited, was, missed: result === "unknown" && !!r.h };
    tidy(c.id, L);
    return out;
  }
  // Réparation faite (image, exemple, astuce enregistrés) : le prochain « Trouvé » libère le mot.
  function markRepaired(c, L) {
    const langs = L ? [L] : hardLangs(c);
    let n = 0;
    langs.forEach(x => { const r = rec(c.id, x); if (r && r.h && !r.f) { r.f = 1; n++; } });
    return n;
  }
  // --- Pause ---
  function pause(c, L) { const r = ensureRec(c.id, langIn(c, L)); r.p = 1; }
  function resume(c, L) { L = langIn(c, L); const r = rec(c.id, L); if (r) { delete r.p; tidy(c.id, L); } }
  // Progression remise à zéro (Leitner.reset) : compteurs, statut et pause des langues concernées (les paires restent).
  function resetCard(id, langs) {
    const w = H().w[id];
    if (!w) return;
    Object.keys(w).forEach(L => { if (!langs || langs.includes(L)) delete w[L]; });
    if (!Object.keys(w).length) delete H().w[id];
  }

  // --- Paires qui se ressemblent ---
  function confuse(aId, bId, L, now) {
    if (!aId || !bId || aId === bId || !isLang(L)) return null;
    const a = aId < bId ? aId : bId, b = aId < bId ? bId : aId;
    const h = H();
    let p = h.c.find(x => x.a === a && x.b === b && x.L === L);
    if (!p) { p = { a, b, L, n: 0, at: 0 }; h.c.push(p); }
    p.n = Math.min(9999, p.n + 1);
    p.at = now || Date.now();
    if (h.c.length > 300) { h.c.sort((x, y) => y.n - x.n || y.at - x.at); h.c.length = 300; }
    return p;
  }
  // Paires « qui se ressemblent » (au moins HD_PAIR_MIN confusions, deux cartes qui existent encore), les plus confondues d'abord.
  function pairs(L) {
    return H().c.filter(p => p.n >= HD_PAIR_MIN && (!L || p.L === L) && cardOf(p.a) && cardOf(p.b))
      .sort((x, y) => y.n - x.n || y.at - x.at);
  }
  function partnersOf(id, L) {
    const out = [];
    H().c.forEach(p => { if (p.n >= HD_PAIR_MIN && (!L || p.L === L)) { if (p.a === id) out.push(p.b); else if (p.b === id) out.push(p.a); } });
    return out;
  }
  function pairOf(aId, bId, L) {
    const a = aId < bId ? aId : bId, b = aId < bId ? bId : aId;
    return H().c.find(x => x.a === a && x.b === b && x.L === L) || null;
  }
  function dropPair(p) { const h = H(); const i = h.c.indexOf(p); if (i >= 0) h.c.splice(i, 1); }

  // --- Listes pour Stats et sessions : [{ c (carte), L, r (enregistrement) }] ---
  function entries(flag) {
    const out = [];
    const w = H().w;
    Object.keys(w).forEach(id => {
      const c = cardOf(id);
      if (!c) return;
      Object.keys(w[id]).forEach(L => {
        const r = w[id][L];
        if (flag === "p" ? r.p : r.h && !r.p) out.push({ c, L, r });
      });
    });
    return out.sort((x, y) => (y.r.n || 0) - (x.r.n || 0) || (y.r.at || 0) - (x.r.at || 0));
  }
  const hardEntries = () => entries("h");
  const pausedEntries = () => entries("p");
  // Une carte est-elle dans la portée « Mots difficiles » / « Mots qui se ressemblent » pour cette langue ?
  function inScope(c, L, scope) {
    if (scope === "hard") { const r = rec(c.id, L); return !!(r && r.h && !r.p); }
    if (scope === "pairs") return partnersOf(c.id, L).some(id => cardOf(id));
    return true;
  }

  // --- « Mon astuce » (privée) ---
  function tip(id) { return (state.tips && state.tips[id]) || ""; }
  function setTip(id, text) {
    if (!state.tips || typeof state.tips !== "object") state.tips = {};
    const v = String(text == null ? "" : text).replace(/\s+/g, " ").trim().slice(0, HD_TIP_MAX);
    if (v) state.tips[id] = v; else delete state.tips[id];
    return v;
  }

  return { onAnswer, markRepaired, pause, resume, resetCard, confuse, pairs, partnersOf, pairOf, dropPair, hardEntries, pausedEntries,
    inScope, isHard, isPaused, hardLangs, counts, rec, tip, setTip, cardOf };
})();
window.App.Hard = Hard;
