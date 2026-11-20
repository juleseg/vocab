"use strict";

// === MIX DE MODES (ÉTAPE 70) ===
// Session « Mix » de Réviser (cfg.mode = "mix") : les exercices changent à chaque carte, comme une leçon.
// - Même périmètre, filtres, langues et sens que les autres sessions (sessionQueue, js/screens/reviser.js) ; 10, 20 ou 30 cartes
//   (cfg.mixCount, en mémoire comme le reste de rv.cfg : aucun réglage de compte).
// - Modes du Mix = modes INDIVIDUELS qui notent les cartes : Cartes, Écrit, QCM, Remettre en ordre, Dictée, Prononciation
//   (MIX_MODES), et Paires en grille de MIX_PAIRS cartes. Refusés : Interrogateur (on est deux), Course 60 s (chronométrée),
//   Tableau (un verbe entier d'un coup), « le / la ? », Paires minimales et Répéter après la voix (entraînements sans progression).
// - Exercice de chaque carte tiré AU HASARD parmi ceux qui conviennent à CETTE carte (mixOptions) : Cartes toujours ; Écrit sauf
//   fiche de règle ; QCM, Ordre, Dictée, Prononciation : vocabulaire seulement, avec 3 pièges dans la liste (QCM), un mot ou une
//   phrase à remettre en ordre, une voix pour la langue sur l'appareil (Dictée), la même voix + la reconnaissance vocale du
//   navigateur + une traduction à montrer (Prononciation). Jamais deux fois de suite le même exercice quand un autre est possible (s.mix.last).
//   L'exercice est tiré au moment où la carte arrive (une carte « Raté » qui revient peut changer d'exercice).
// - Paires : par tranche de MIX_PAIRS_EVERY cartes, une fois sur deux (MIX_PAIRS_P), une grille de MIX_PAIRS cartes de la tranche
//   (mots et traductions tous différents), jamais en premier ; elle compte pour MIX_PAIRS cartes dans la barre de progression.
// - Vraie révision : chaque réponse passe par le code du mode d'origine (gradeCurrent → Leitner.grade pour Cartes, Écrit, Dictée,
//   Prononciation ; gameGrade → Leitner.gradeGame pour QCM, Ordre, Paires) ; rv.s.mode = exercice en cours pendant la carte, donc
//   même barème d'XP (XP.onAnswer), même apprentissage auditif (Auditif.plan), mêmes mots difficiles, bilans, « Ma phrase ».
//   Fin : rv.s.mode = "mix", résumé commun (renderSessionSummary : journal « session » mode mix, XP de session, « Rejouer les ratés »
//   en Mix).
// - Prononciation : « Passer » (speakSkip, js/modes/prononciation.js) garde la carte dans un autre exercice et coupe le micro pour
//   le reste de ce Mix (mixSpeakSkip).
// État : rv.s.mix = { total, cur, curLog, last, noSpeak } ; rv.s.queue = éléments { id, lang, dir, m, g?, lk? } ou grille
// { m: "pairs", id, ids, picked, p } ; rv.s.game = partie commune des exercices de jeu (notation, gameIsLive).
const MIX_MODES = ["cards", "write", "mcq", "order", "dictation", "speak"];
const MIX_COUNTS = [10, 20, 30];
const MIX_PAIRS = 4, MIX_PAIRS_EVERY = 10, MIX_PAIRS_P = 0.5;
const MIX_ICON = { mix: "🎲", cards: "🃏", write: "✍️", mcq: GAME_ICON.mcq, order: GAME_ICON.order, pairs: GAME_ICON.pairs,
  dictation: LISTEN_ICON.dictation, speak: LISTEN_ICON.speak };
function isMixMode(m) { return m === "mix"; }
function mixCount(cfg) { return MIX_COUNTS.includes(num(cfg && cfg.mixCount, 0)) ? num(cfg.mixCount, 10) : MIX_COUNTS[0]; }

// --- Choix de la session (appelé par renderSessionConfig, js/screens/reviser.js) ---
// Noms des exercices possibles sur cet appareil (Dictée : une voix ; Prononciation : reconnaissance vocale).
function mixModeNames(langs) {
  const ms = ["cards", "write", "mcq", "pairs", "order"];
  const voice = lisVoiceInfo(arr(langs)).ok;
  if (voice) ms.push("dictation");
  if (voice && lisCanSpeak()) ms.push("speak");
  return ms.map(m => t("mode." + m)).join(", ");
}
function mixField(cfg, langs) {
  const on = isMixMode(cfg.mode);
  const f = el("div", "field mix-field");
  f.appendChild(el("label", null, t("mix.label")));
  const b = el("button", "btn mix-btn" + (on ? " on" : ""), MIX_ICON.mix + " " + t("mode.mix"));
  b.type = "button";
  b.setAttribute("aria-pressed", String(on));
  b.addEventListener("click", () => { cfg.mode = on ? "cards" : "mix"; renderReview(); });
  f.appendChild(b);
  f.appendChild(el("div", "hint", on ? t("mix.hint.on", { modes: mixModeNames(langs), n: MIX_PAIRS }) : t("mix.hint.off")));
  return f;
}
function mixCountField(cfg) {
  cfg.mixCount = mixCount(cfg);
  return segField("review.count", MIX_COUNTS.map(n => [n, ""]), cfg.mixCount, v => { cfg.mixCount = v; }, MIX_COUNTS.map(String));
}
function startMix(cfg) {
  const queue = sessionQueue(cfg, mixCount(cfg));
  if (!queue.length) return false;
  newRun(queue, "mix");   // renderReview → renderMixSession → mixInit
  return true;
}

// --- Préparation (au premier affichage ; aussi pour « Rejouer les ratés », qui relance newRun en mode "mix") ---
function mixInit(s) {
  const flat = arr(s.queue).filter(q => q && q.id && !q.ids);
  s.mode = "mix";
  s.mix = { total: new Set(flat.map(q => q.id)).size, cur: null, curLog: -1, last: null, noSpeak: false };
  s.game = { mode: "mix", ok: 0, bad: 0, errors: null, hints: 0, missed: [], cardIds: [], meta: {}, done: false, startedAt: s.startedAt };
  if (!s.lks) s.lks = {};
  flat.forEach(q => {
    q.lang = q.lang || (s.langs || {})[q.id];
    q.dir = q.dir || (s.dirs || {})[q.id] || "toT";
    s.game.meta[q.id] = { lang: q.lang, dir: q.dir };
  });
  s.queue = mixPlan(flat);
}
// Grilles de paires : une par tranche de MIX_PAIRS_EVERY cartes, une fois sur deux, jamais en tête de tranche.
function mixPlan(flat) {
  const out = [];
  for (let i = 0; i < flat.length; i += MIX_PAIRS_EVERY) {
    const chunk = flat.slice(i, i + MIX_PAIRS_EVERY);
    let rest = chunk;
    if (chunk.length > MIX_PAIRS && Math.random() < MIX_PAIRS_P) {
      const picked = pairsPick(shuffle(chunk.slice()), MIX_PAIRS);
      if (picked.length === MIX_PAIRS) {
        const ids = picked.map(p => p.q.id);
        rest = chunk.filter(q => !ids.includes(q.id));
        rest.splice(1 + Math.floor(Math.random() * rest.length), 0, { m: "pairs", id: ids[0], ids, picked });
      }
    }
    out.push(...rest);
  }
  return out;
}
// Cartes encore à faire (une grille compte ses cartes pas encore trouvées).
function mixLeft(s) {
  const ids = new Set();
  s.queue.forEach(q => {
    if (q.ids) q.ids.forEach(id => { if (!(q.p && q.p.matched.includes(id))) ids.add(id); });
    else ids.add(q.id);
  });
  return ids.size;
}

// --- Exercices possibles pour une carte : [{ m, g? (question de jeu préparée), lk? (mot ou phrase) }] ---
function mixOptions(s, c, item) {
  const L = item.lang, dir = item.dir || "toT";
  const out = [{ m: "cards" }];
  const pick = a => a[Math.floor(Math.random() * a.length)];
  if (cardType(c) !== "rule" && wrAlts(c, dir).length) out.push({ m: "write" });   // conjugaison, texte à trous, phrase à corriger : réponse écrite
  if (!isVocab(c)) return out;                                                     // autres types : Cartes et Écrit seulement
  const q = { id: c.id, lang: L, dir };
  const mq = mcqItem(q); if (mq) out.push({ m: "mcq", g: mq });
  const oq = orderItem(q, "both"); if (oq) out.push({ m: "order", g: oq });
  const lg = gameLg(c, L);
  const dk = lisKinds(c, L, "dictation", "both", lg); if (dk.length) out.push({ m: "dictation", lk: pick(dk) });
  if (!s.mix.noSpeak && lisCanSpeak() && Speech.has(L)) { const sk = lisKinds(c, L, "speak", "both", lg); if (sk.length) out.push({ m: "speak", lk: pick(sk) }); }
  return out;
}
// Tire l'exercice de l'élément en tête (nouvelle carte, ou carte « Raté » revenue). false = carte inutilisable.
function mixAssign(s, item) {
  s.revealed = false; s.w = null; s.d = null; s.p = null;
  if (item.ids) {
    item.m = "pairs";
    if (!item.p) item.p = pairsState(item.picked);
  } else {
    const c = sessionCard(item.id);
    if (!c) return false;
    item.lang = item.lang || (s.langs || {})[item.id] || primaryLang(c);
    const opts = mixOptions(s, c, item);
    let choice = opts.filter(o => o.m !== s.mix.last);
    if (!choice.length) choice = opts;
    const o = choice[Math.floor(Math.random() * choice.length)];
    item.m = o.m; item.g = o.g || null; item.lk = o.lk || "";
    if (o.lk) s.lks[item.id] = o.lk;
    if ((o.m === "dictation" || o.m === "speak") && !lisCurrent(Object.assign({}, s, { mode: o.m }), item)) { item.m = "cards"; item.g = null; }
  }
  s.mix.cur = item; s.mix.curLog = s.log.length; s.mix.last = item.m;
  return true;
}
// Grille dont une carte a été supprimée entre-temps : remplacée par ses cartes restantes, une par une.
function mixUnfold(s, item) {
  const keep = item.ids.filter(id => sessionCard(id) && !(item.p && item.p.matched.includes(id)));
  s.queue.splice(0, 1, ...keep.map(id => Object.assign({ id }, s.game.meta[id] || {})));
}

// --- Affichage (appelé par renderReview tant que rv.s.mix existe ou que rv.s.mode vaut "mix") ---
function renderMixSession(root) {
  const s = rv.s;
  if (!s.mix) mixInit(s);
  if (s.aud) {                                        // pause d'écoute après une réponse en Cartes (apprentissage auditif, étape 55)
    mixHeader(root, s, s.mix.last || "cards");
    if (audPause(root)) return;
    root.textContent = "";
  }
  let item = null;
  while (s.queue.length) {
    item = s.queue[0];
    if (item.ids && item.ids.some(id => !sessionCard(id))) { mixUnfold(s, item); item = null; continue; }
    if (!item.ids && !sessionCard(item.id)) { s.queue.shift(); item = null; continue; }
    if (item === s.mix.cur && s.log.length === s.mix.curLog && item.m) break;   // même exercice, écran redessiné
    if (mixAssign(s, item)) break;
    s.queue.shift(); item = null;
  }
  if (!item) {                                        // fin : résumé commun, rangé sous le mode « mix »
    s.mode = "mix";
    s.game.done = true;
    renderSessionSummary(root);
    return;
  }
  s.mode = item.m;                                    // barème d'XP, apprentissage auditif, etc. du mode d'origine
  mixHeader(root, s, item.m);
  if (item.m === "cards") renderCardsSession(root);
  else if (item.m === "write") renderWriteSession(root);
  else if (item.m === "dictation") renderDictationSession(root);
  else if (item.m === "speak") renderSpeakSession(root);
  else {
    const c = item.ids ? null : sessionCard(item.id);
    mixGameMeta(root, c, item.lang);
    if (item.m === "mcq") mcqQuestion(root, s.game, item.g, () => mixNext(s, item), { aud: true });
    else if (item.m === "order") orderQuestion(root, s.game, item.g, () => mixNext(s, item));
    else pairsBoard(root, s.game, item.p, () => mixNext(s, item));
    const quit = el("button", "link-btn", t("cards.quit"));
    quit.addEventListener("click", () => { Speech.stop(); s.queue = []; renderReview(); });
    root.appendChild(quit);
  }
  const left = root.querySelector(".meta-row > span");   // « N cartes restantes » : cartes du Mix, pas éléments de la file
  if (left) left.textContent = t("cards.left", { n: mixLeft(s) });
}
// Petit titre (mode en cours) et barre de progression.
function mixHeader(root, s, m) {
  const total = Math.max(1, s.mix.total), done = Math.max(0, Math.min(total, total - mixLeft(s)));
  const hd = el("div", "mix-hd");
  const top = el("div", "mix-top");
  top.append(el("span", "mix-title", MIX_ICON.mix + " " + t("mode.mix") + " · " + (MIX_ICON[m] ? MIX_ICON[m] + " " : "") + t("mode." + m)),
    el("span", "mix-count", done + " / " + total));
  hd.appendChild(top);
  const bar = el("div", "progress mix-bar");
  bar.setAttribute("role", "progressbar");
  bar.setAttribute("aria-label", t("mix.progress"));
  bar.setAttribute("aria-valuemin", "0");
  bar.setAttribute("aria-valuemax", String(total));
  bar.setAttribute("aria-valuenow", String(done));
  const fill = el("div", "progress-fill");
  fill.style.width = Math.round(100 * done / total) + "%";
  bar.appendChild(fill);
  hd.appendChild(bar);
  root.appendChild(hd);
}
// En-tête des exercices de jeu (même ligne que les autres modes : lecture auto, cartes restantes, catégorie).
function mixGameMeta(root, c, L) {
  const au = audioToggle();
  au.classList.add("gm-au");
  root.appendChild(au);
  const meta = el("div", "meta-row");
  meta.append(el("span"), el("span", null, c ? t("cat." + Leitner.category(c, L)) : ""));
  root.appendChild(meta);
}
// Exercice de jeu terminé : élément suivant (une seule fois, session toujours affichée).
function mixNext(s, item) {
  if (rv.s !== s || !s.game || s.game.done) return;
  if (s.queue[0] === item) s.queue.shift();
  if (currentScreen === "review") renderReview();
}
// Prononciation, « Passer » : plus de micro dans ce Mix ; la carte reste et reçoit un autre exercice.
function mixSpeakSkip(s) {
  s.mix.noSpeak = true;
  s.mix.cur = null;
  toast(t("mix.noMic"));
  renderReview();
}
