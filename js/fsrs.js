"use strict";

// === FSRS (RÉPÉTITION INTELLIGENTE, ÉTAPE 47) ===
// FSRS-6 (Free Spaced Repetition Scheduler, version 6), écrit à la main, sans bibliothèque.
// Sources des formules :
//  - « The Algorithm » (wiki open-spaced-repetition / fsrs4anki, section FSRS-6) ;
//  - implémentation de référence py-fsrs 6 (fichier fsrs/scheduler.py : _initial_stability, _initial_difficulty,
//    _next_difficulty, _next_recall_stability, _next_forget_stability, _short_term_stability, get_card_retrievability,
//    _next_interval), dont les valeurs ont servi aux tests de l'étape 47.
// Paramètres : les 21 valeurs publiées par défaut (FSRS-6), sans optimisation par compte.
//
// Notes de l'appli (boutons inchangés) : Pas su = « encore » (1), À revoir = « difficile » (2), Su = « bien » (3).
// Pas de 4e bouton (« facile ») : w[3] et w[16] ne servent qu'au calcul de D0(4) (retour à la moyenne de la difficulté).
//
// Formules (t = jours écoulés depuis la dernière révision, S = stabilité en jours, D = difficulté 1 à 10, G = note) :
//  - rétrievabilité          R(t, S) = (1 + F · t / S)^(−w20), avec F = 0,9^(−1/w20) − 1 (donc R(S, S) = 0,9)
//  - intervalle              I(r, S) = S / F · (r^(−1/w20) − 1)   (r = taux de rétention visé ; r = 0,9 → I = S)
//  - 1re réponse             S0(G) = w[G−1] ; D0(G) = w4 − e^(w5·(G−1)) + 1 (borné 1 à 10)
//  - difficulté              D' = D − w6·(G−3)·(10 − D)/9 ; D'' = w7·D0(4) + (1 − w7)·D' (D0(4) non borné), borné 1 à 10
//  - réussite (G ≥ 2)        S' = S · (1 + e^w8 · (11 − D) · S^(−w9) · (e^(w10·(1−R)) − 1) · (w15 si G = 2))
//  - oubli (G = 1)           S' = min( w11 · D^(−w12) · ((S+1)^w13 − 1) · e^(w14·(1−R)) ,  S / e^(w17·w18) )
//  - même jour (court terme) S' = S · e^(w17·(G − 3 + w18)) · S^(−w19), au moins S si G ≥ 3
//  - S est toujours ≥ 0,001. La stabilité et la difficulté sont calculées avec la difficulté d'AVANT la réponse.
// Choix de l'appli :
//  - « même jour » = même date locale de l'appareil (sinon t = nombre de jours calendaires entre les deux dates) ;
//  - intervalle arrondi au jour, décalage aléatoire ± 5 %, au moins 1 jour, au plus 365 jours ; la carte redevient due
//    à minuit (heure locale) du jour J + intervalle, comme avec Leitner ;
//  - « encore » : la carte revient dans la même session (date de révision = maintenant), état learning / relearning ;
//    « difficile » ou « bien » : état review. Donc état learning / relearning ⇔ dernière réponse = « encore ».
const FSRS_W = Object.freeze([
  0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001, 1.8722, 0.1666, 0.796,
  1.4835, 0.0614, 0.2629, 1.6483, 0.6014, 1.8729, 0.5425, 0.0912, 0.0658, 0.1542
]);
const FSRS_STATES = ["new", "learning", "review", "relearning"];
const FSRS_RET = Object.freeze({ min: 75, max: 97, def: 90 });   // taux de rétention visé, en % (écran « Rythme de révision » :
                                                                  // paliers 95 / 90 / 85 / 80, curseur 75 à 97)

const FSRS = (() => {
  const W = FSRS_W;
  const DECAY = -W[20];
  const FACTOR = Math.pow(0.9, 1 / DECAY) - 1;
  const S_MIN = 0.001, S_MAX = 36500, MAX_IVL = 365, FUZZ = 0.05;
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const clampD = d => clamp(d, 1, 10);
  const clampS = s => clamp(s, S_MIN, S_MAX);

  // Rétrievabilité (probabilité de se souvenir) après t jours (t peut être fractionnaire). S ≤ 0 → 0.
  function retrievability(t, s) {
    if (!(s > 0)) return 0;
    return Math.pow(1 + FACTOR * Math.max(0, t) / s, DECAY);
  }
  function initStability(g) { return clampS(W[g - 1]); }
  function initDifficulty(g, raw) { const d = W[4] - Math.exp(W[5] * (g - 1)) + 1; return raw ? d : clampD(d); }
  function nextDifficulty(d, g) {
    const delta = -W[6] * (g - 3);
    const damped = d + delta * (10 - d) / 9;                        // amortissement linéaire
    return clampD(W[7] * initDifficulty(4, true) + (1 - W[7]) * damped);   // retour à la moyenne vers D0(4)
  }
  function recallStability(d, s, r, g) {
    const hard = g === 2 ? W[15] : 1, easy = g === 4 ? W[16] : 1;
    return clampS(s * (1 + Math.exp(W[8]) * (11 - d) * Math.pow(s, -W[9]) * (Math.exp((1 - r) * W[10]) - 1) * hard * easy));
  }
  function forgetStability(d, s, r) {
    const longTerm = W[11] * Math.pow(d, -W[12]) * (Math.pow(s + 1, W[13]) - 1) * Math.exp((1 - r) * W[14]);
    const shortTerm = s / Math.exp(W[17] * W[18]);
    return clampS(Math.min(longTerm, shortTerm));
  }
  function shortTermStability(s, g) {
    let inc = Math.exp(W[17] * (g - 3 + W[18])) * Math.pow(s, -W[19]);
    if (g >= 3) inc = Math.max(inc, 1);
    return clampS(s * inc);
  }
  // Taux de rétention visé (0,75 à 0,97) depuis un pourcentage (75 à 97) ou une fraction.
  function retention(v) {
    let r = Number(v);
    if (!isFinite(r)) r = FSRS_RET.def;
    if (r > 1) r = r / 100;
    return clamp(r, FSRS_RET.min / 100, FSRS_RET.max / 100);
  }
  // Intervalle en jours (non arrondi) pour la stabilité s et le taux visé.
  function intervalRaw(s, ret) { return s / FACTOR * (Math.pow(retention(ret), 1 / DECAY) - 1); }
  // Intervalle en jours entiers : décalage ± 5 % (rnd dans [0, 1[, absent = pas de décalage), arrondi, 1 à 365.
  function interval(s, ret, rnd) {
    let i = intervalRaw(s, ret);
    if (typeof rnd === "number" && isFinite(rnd)) i *= 1 + (clamp(rnd, 0, 1) * 2 - 1) * FUZZ;
    return clamp(Math.round(i), 1, MAX_IVL);
  }
  // Une réponse. prev = { s, d, state, reps, lapses } (état avant), g = 1 | 2 | 3, elapsed = jours écoulés depuis la
  // dernière révision (0 = même jour → court terme ; null = inconnu → traité comme une révision à l'heure prévue).
  // Renvoie { s, d, state, reps, lapses } (fonction pure).
  function review(prev, g, elapsed) {
    prev = prev || {};
    g = clamp(Math.round(Number(g) || 1), 1, 4);
    const reps = (prev.reps | 0) + 1;
    let lapses = prev.lapses | 0, s, d, st;
    if (!prev.state || prev.state === "new" || !(prev.s > 0)) {      // premier passage
      s = initStability(g); d = initDifficulty(g);
      st = g === 1 ? "learning" : "review";
    } else {
      const d0 = prev.d >= 1 ? clampD(prev.d) : initDifficulty(3);
      if (elapsed != null && elapsed < 1) s = shortTermStability(prev.s, g);
      else {
        const t = elapsed == null ? intervalRaw(prev.s, 0.9) : elapsed;
        const r = retrievability(t, prev.s);
        s = g === 1 ? forgetStability(d0, prev.s, r) : recallStability(d0, prev.s, r, g);
      }
      d = nextDifficulty(d0, g);
      if (g === 1) {
        if (prev.state === "review") { st = "relearning"; lapses++; }
        else st = prev.state === "relearning" ? "relearning" : "learning";
      } else st = "review";
    }
    return { s, d, state: st, reps, lapses };
  }
  return { W, DECAY, FACTOR, MAX_IVL, FUZZ, retrievability, initStability, initDifficulty, nextDifficulty,
    recallStability, forgetStability, shortTermStability, retention, intervalRaw, interval, review };
})();

// --- Progression d'une carte dans une langue (P = progress[L]) : champs FSRS ---
// P = { box, dueAt, stats, s, d, last, reps, lapses, state, lb? }
//  - s : stabilité (jours) ; d : difficulté (1 à 10, 0 = jamais vue) ; last : dernière révision (ms) ; reps : réponses ;
//    lapses : oublis (« encore » sur une carte su) ; state : new | learning | review | relearning ;
//  - lb : ancienne boîte Leitner, copiée une seule fois à la migration 6 → 7 (retour en arrière possible) ;
//  - box : équivalent calculé depuis s (anciens écrans, fiche admin, listes communes) :
//    s < 1 → 0, 1-2 → 1, 3-6 → 2, 7-13 → 3, 14-29 → 4, ≥ 30 → 5 ; en plus, « Pas su » (new / learning / relearning) → 0
//    et une carte su (review) au moins en boîte 1, pour que boîte et catégorie disent toujours la même chose.
function fsrsRound(x, n) { const k = Math.pow(10, n || 4); return Math.round(x * k) / k; }
function fsrsNewFields() { return { s: 0, d: 0, last: null, reps: 0, lapses: 0, state: "new" }; }
function fsrsHas(P) { return !!P && typeof P === "object" && FSRS_STATES.includes(P.state); }
function fsrsBoxOfS(s) { return s < 1 ? 0 : s < 3 ? 1 : s < 7 ? 2 : s < 14 ? 3 : s < 30 ? 4 : 5; }
function fsrsBox(P) {
  if (!fsrsHas(P) || P.state !== "review") return 0;
  return Math.max(1, fsrsBoxOfS(num(P.s, 0)));
}
// Catégories : Pas su = jamais vue (new) ou dernière réponse « encore » (learning / relearning) ; À revoir = s < 7 ; Su = s ≥ 7.
function fsrsCategory(P) {
  const F = fsrsHas(P) ? P : fsrsFromLeitner(P);
  if (F.state !== "review") return "unknown";
  return num(F.s, 0) >= 7 ? "known" : "review";
}
// Champs FSRS lus depuis un objet (données enregistrées) : valeurs bornées ; null si l'état est absent ou inconnu.
function fsrsNorm(v) {
  if (!fsrsHas(v)) return null;
  const o = {
    s: fsrsRound(Math.min(36500, Math.max(0, num(v.s, 0)))),
    d: fsrsRound(Math.min(10, Math.max(0, num(v.d, 0)))),
    last: v.last == null ? null : num(v.last, null),
    reps: clampInt(v.reps, 0, 1000000, 0), lapses: clampInt(v.lapses, 0, 1000000, 0),
    state: v.state
  };
  if (o.state !== "new" && !(o.s > 0)) { o.state = "new"; o.d = 0; }   // donnée abîmée : repart comme une carte jamais vue
  if (v.lb != null) o.lb = clampInt(v.lb, 0, 5, 0);
  return o;
}
// Migration 6 → 7 : champs FSRS estimés depuis la progression Leitner { box, dueAt, stats } (fonction pure).
//  - jamais vue (boîte 0, 0 vue) : state new ;
//  - s de départ selon la boîte (0 vue → 0,5 ; 1 → 1 ; 2 → 3 ; 3 → 7 ; 4 → 14 ; 5 → 30), corrigée par le taux de réussite
//    r = sues / vues (dès 3 vues) : × (0,5 + r), entre × 0,75 et × 1,25 ;
//  - d = 2 + 6 × (1 − r) (r = 1 → 2, r = ½ → 5, r = 0 → 8), 5 sans assez de vues ;
//  - last = dernière vue, sinon dueAt − intervalle Leitner de la boîte (jamais dans le futur) ;
//  - state : boîte ≥ 1 → review ; boîte 0 déjà vue → relearning si déjà sue une fois, sinon learning ;
//  - reps = vues ; lapses = ratées (seulement si la carte a déjà été sue) ; lb = boîte Leitner ; dueAt jamais modifié.
const FSRS_MIG_S = [0.5, 1, 3, 7, 14, 30];
function fsrsFromLeitner(P, now) {
  P = P || {};
  now = now || Date.now();
  const st = P.stats || {}, seen = num(st.seen, 0), ok = num(st.correct, 0), wrong = num(st.wrong, 0);
  const box = clampInt(P.box, 0, 5, 0);
  if (box === 0 && seen <= 0) return Object.assign(fsrsNewFields(), { lb: box });
  const r = seen >= 3 ? Math.min(1, Math.max(0, ok / seen)) : null;
  let s = FSRS_MIG_S[box];
  if (r != null) s *= Math.min(1.25, Math.max(0.75, 0.5 + r));
  const d = r != null ? Math.min(10, Math.max(1, 2 + 6 * (1 - r))) : 5;
  let last = st.lastSeen == null ? null : num(st.lastSeen, null);
  if (last == null && num(P.dueAt, 0) > 0) {
    const ivl = (CONFIG.LEITNER_INTERVALS_DAYS || [0, 1, 3, 7, 14, 30])[box] || 0;
    const x = new Date(num(P.dueAt, 0)); x.setDate(x.getDate() - ivl);
    last = x.getTime();
  }
  if (last != null && last > now) last = now;
  return {
    s: fsrsRound(s), d: fsrsRound(d), last, reps: Math.max(0, seen), lapses: ok > 0 ? Math.max(0, wrong) : 0,
    state: box >= 1 ? "review" : (ok > 0 ? "relearning" : "learning"), lb: box
  };
}
// Ajoute les champs FSRS à une progression qui n'en a pas (migration, en place) et recalcule la boîte équivalente.
// Ne touche jamais dueAt ni stats. Renvoie true si la progression a été migrée.
function fsrsMigrateProg(P, now) {
  if (!P || typeof P !== "object" || fsrsHas(P)) return false;
  Object.assign(P, fsrsFromLeitner(P, now));
  P.box = fsrsBox(P);
  return true;
}
// Jours calendaires (dates locales) entre deux instants ; 0 = même jour.
function fsrsDays(from, to) {
  const a = new Date(from), b = new Date(to);
  const u = d => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  return Math.round((u(b) - u(a)) / 86400000);
}
// Rétrievabilité d'une progression maintenant (jours fractionnaires depuis la dernière révision) ; null si jamais vue.
function fsrsRetrievability(P, now) {
  const F = fsrsHas(P) ? P : fsrsFromLeitner(P, now);
  if (F.state === "new" || !(F.s > 0) || F.last == null) return null;
  return FSRS.retrievability(Math.max(0, ((now || Date.now()) - F.last) / 86400000), F.s);
}
// Taux de rétention visé du compte (0,75 à 0,97).
function fsrsTarget() { try { return FSRS.retention(state.settings.retention); } catch (e) { return FSRS_RET.def / 100; } }
