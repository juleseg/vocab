"use strict";

// === ÉCRAN : RÉVISER (CHOIX DE SESSION) ===
// rv.phase : "config" (choix de la session) | "run" (session en cours)
// rv.cfg est gardé en mémoire tant que l'appli est ouverte (pas sauvegardé).
// Sens par carte, relatif à la liste de la carte : "toT" = langues d'appui → langue apprise, "fromT" = l'inverse.
// Une session peut mélanger des listes de langues différentes.
// Étape 37 : une liste peut être étudiée dans plusieurs langues. On choisit la ou les langues (cfg.langs, vide = toutes) ;
// chaque carte est posée dans UNE seule langue (tirée au hasard parmi ses langues possibles), notée dans la file
// ({ id, dir, lang }) et dans StudyCtx.cards pendant la session. Sens : par langue (cfg.dirs[langue], sinon cfg.dir).
const rv = { phase: "config", cfg: null, s: null };
const NO_FOLDER = "__none__";

function defaultSessionCfg() {
  return { scope: "all", folderIds: [], listIds: [], tags: [], cat: "unknown", lang: accountLangs().target,
    types: [], tenses: [], verbs: [], persons: [],   // filtres en plus (vide = tout) : types de cartes ; conjugaison (clés « langue|… »)
    onlyDue: true, dir: "toT", count: state.settings.sessionSize, mode: rcDefaultMode(),   // étape 75 : Mix par défaut, ou le dernier mode choisi sur cet appareil (js/reviser-choix.js)
    langs: [], dirs: {},     // étape 37 : langues étudiées choisies (vide = toutes) ; sens par langue
    orderKind: "both",       // étape 42 : jeu « Remettre en ordre » : "words" | "sents" | "both"
    listenKind: "both" };    // étape 46 : Dictée / Prononciation, « À écouter / à dire » : "words" | "sents" | "both"
}
// Clés des filtres de conjugaison (une session peut mélanger plusieurs langues).
function tenseKey(c) { return c.lang + "|" + c.tense; }
function verbKey(c) { return c.lang + "|" + normText(c.verb); }
function personKey(c) { return c.lang + "|" + c.person; }
function conjFilterOn(cfg) { return !!(arr(cfg.tenses).length || arr(cfg.verbs).length || arr(cfg.persons).length); }
function allTags() {
  const s = new Set();
  state.cards.forEach(c => c.tags.forEach(tg => s.add(tg)));
  return [...s].sort((a, b) => a.localeCompare(b));
}
// Langues de chaque liste (calculées une fois pour tout un filtrage).
function langsByList() {
  const m = new Map();
  state.lists.forEach(l => m.set(l.id, listLangs(l)));
  return m;
}
// Langues étudiées présentes dans les listes (toutes les langues de chaque liste, étape 37), dans l'ordre de LANGUAGES.
function targetLangsInUse() {
  const s = new Set();
  state.lists.forEach(l => studyLangs(l).forEach(L => s.add(L)));
  return LANG_CODES.filter(c => s.has(c));
}
// Langues dans lesquelles une carte peut être posée dans cette session (étape 37). lg = langues de sa liste.
// stage "base" : sans le choix des langues (pour construire ce choix).
function sessionLangs(c, cfg, now, lg, stage) {
  const out = [];
  cardStudyLangs(c).forEach((L, i) => {
    if (i === 0 ? !cardUsable(c, lg) : !cardUsable(c, studyLg(L))) return;
    if (Hard.isPaused(c, L)) return;   // mot en pause (étape 57) : ne revient plus en révision
    if (cfg.scope === "cat" && Leitner.category(c, L) !== cfg.cat) return;
    if (cfg.scope === "lang" && L !== cfg.lang) return;
    if ((cfg.scope === "hard" || cfg.scope === "pairs") && !Hard.inScope(c, L, "hard") && !Hard.inScope(c, L, "pairs")) return;   // « Mots difficiles » (étape 57 ; étape 73 : ratés ET qui se ressemblent, une seule portée)
    if (cfg.onlyDue && cfg.scope !== "pairs" && cfg.scope !== "hard" && cfg.mode !== "gender" && !isEarMode(cfg.mode) && !Leitner.isDue(c, now, L)) return;   // paires : les deux mots sont toujours là ; « le / la ? » (étape 60) et l'oreille et la bouche (étape 69) : tout le périmètre
    if (stage !== "base" && arr(cfg.langs).length && !cfg.langs.includes(L)) return;
    // Dictée / Prononciation (étape 46) : mot ou phrase à écouter / dire dans L (dictée : voix de L nécessaire)
    if (!stage && isListenMode(cfg.mode) && !lisKinds(c, L, cfg.mode, cfg.listenKind, i === 0 ? lg : studyLg(L)).length) return;
    if (!stage && cfg.mode === "gender" && !genderDrillOf(c, L)) return;   // « le / la ? » (étape 60) : noms avec un genre renseigné seulement
    if (!stage && cfg.mode === "shadow" && !earSentence(c, L)) return;     // répéter après la voix (étape 69) : phrase d'exemple dans L
    out.push(L);
  });
  return out;
}
// stage : "base" = sans les filtres de type / conjugaison / mode (pour construire ces filtres) ;
//         "types" = avec le filtre de type, sans ceux de conjugaison ; absent = tous les filtres.
function sessionPool(cfg, stage) {
  const now = Date.now();
  const types = arr(cfg.types), conjOn = conjFilterOn(cfg);
  const lgs = langsByList();
  const lists = new Map(state.lists.map(l => [l.id, l]));
  return state.cards.filter(c => {
    const lg = lgs.get(c.listId);
    if (!lg) return false;
    if (!sessionLangs(c, cfg, now, lg, stage).length) return false;   // utilisable, catégorie, langue, à réviser (par langue)
    if (cfg.scope === "folders") {
      const l = lists.get(c.listId);
      if (!cfg.folderIds.includes(l && l.folderId ? l.folderId : NO_FOLDER)) return false;
    }
    if (cfg.scope === "lists" && !cfg.listIds.includes(c.listId)) return false;
    if (cfg.scope === "tags" && !c.tags.some(tg => cfg.tags.includes(tg))) return false;
    if (stage === "base") return true;
    if (types.length && !types.includes(cardType(c))) return false;
    if (stage === "types") return true;
    if (cfg.mode === "write" && cardType(c) === "rule") return false;   // fiche de règle : pas de mode Écrit
    if (cfg.mode === "table" && cardType(c) !== "conj") return false;   // mode Tableau : conjugaison seulement
    if ((isGameMode(cfg.mode) || cfg.mode === "gender" || isEarMode(cfg.mode)) && !isVocab(c)) return false;   // jeux (étape 42), « le / la ? » (étape 60), oreille et bouche (étape 69) : vocabulaire seulement
    if (isListenMode(cfg.mode) && !isVocab(c)) return false;            // Dictée / Prononciation (étape 46) : vocabulaire seulement
    if (conjOn) {                                                        // filtres de conjugaison : seulement des cartes conj
      if (cardType(c) !== "conj") return false;
      if (cfg.tenses.length && !cfg.tenses.includes(tenseKey(c))) return false;
      if (cfg.verbs.length && !cfg.verbs.includes(verbKey(c))) return false;
      if (cfg.persons.length && !cfg.persons.includes(personKey(c))) return false;
    }
    return true;
  });
}
function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
function toggleIn(a, v) { const i = a.indexOf(v); if (i >= 0) a.splice(i, 1); else a.push(v); }

function renderReview() {
  const root = $("#screen-review");
  root.textContent = "";
  if (!rv.cfg) rv.cfg = defaultSessionCfg();
  rv.cfg.listIds = rv.cfg.listIds.filter(id => getList(id)); // listes supprimées entre-temps
  rv.cfg.folderIds = rv.cfg.folderIds.filter(id => id === NO_FOLDER || getFolder(id));
  if (rv.phase === "run" && rv.s) {
    if (rv.s.mix || isMixMode(rv.s.mode)) renderMixSession(root);   // Mix de modes (étape 70, js/mix.js) : avant les autres (rv.s.mode = exercice en cours)
    else if (rv.s.mode === "cards") renderCardsSession(root);
    else if (rv.s.mode === "write") renderWriteSession(root);
    else if (rv.s.mode === "table") renderTableSession(root);
    else if (isGameMode(rv.s.mode)) renderGameSession(root);   // jeux d'entraînement (étape 42)
    else if (rv.s.mode === "gender") renderGenderSession(root);   // « le / la ? » (étape 60, js/genre.js)
    else if (isEarMode(rv.s.mode)) renderEarSession(root);        // paires minimales, répéter après la voix (étape 69, js/oreille.js)
    else if (rv.s.mode === "dictation") renderDictationSession(root);   // étape 46
    else if (rv.s.mode === "speak") renderSpeakSession(root);           // étape 46
    else renderQuizSession(root);
  }
  else renderSessionConfig(root);
}

// Libellés du sens (étape 73) : ma langue = langue de l'appli (si c'est aussi une langue apprise de la session : la 1re
// langue d'aide de cette langue) ; langues apprises = celles de la session (noms complets, « / » entre elles).
function dirLabels(targets) {
  const ui = state.settings.uiLang;
  const ts = LANG_CODES.filter(L => targets.includes(L));
  let mine = ui;
  if (ts.length && ts.every(L => L === ui)) mine = (studyLg(ui).support || [])[0] || "";
  const me = isLang(mine) ? langName(mine) : t("dir73.mine");
  const learn = ts.filter(L => L !== mine).map(L => langName(L)).join(" / ") || t("dir73.learn");
  return { toT: me + " → " + learn, fromT: learn + " → " + me };
}
// options : [[valeur, cléI18n], ...] ; labels : textes déjà traduits (optionnel, remplace les clés)
function segField(labelKey, options, current, onPick, labels) {
  const seg = el("div", "seg");
  options.forEach(([v, k], i) => {
    const b = el("button", null, labels ? labels[i] : t(k));
    b.setAttribute("aria-pressed", String(v === current));
    b.addEventListener("click", () => { onPick(v); renderReview(); });
    seg.appendChild(b);
  });
  return formField(t(labelKey), seg);
}
function chipsField(items, selected, onToggle) {
  const f = el("div", "field");
  const w = el("div", "chips");
  items.forEach(it => {
    const b = el("button", null, it.label);
    b.setAttribute("aria-pressed", String(selected.includes(it.value)));
    b.addEventListener("click", () => { onToggle(it.value); renderReview(); });
    w.appendChild(b);
  });
  f.appendChild(w);
  return f;
}

// Étape 75 : le choix d'une session (« Apprendre » / « Jouer », « Commencer », « Plus d'options ») est dessiné par
// renderSessionConfig, dans js/reviser-choix.js (chargé juste après ce fichier). Les réglages et leurs valeurs (rv.cfg)
// sont inchangés ; segField et chipsField ci-dessus servent toujours à « Plus d'options ».

// Construit la file : périmètre filtré, ordre aléatoire, coupé au nombre demandé, sens fixé par carte.
function startSession() {
  const cfg = rv.cfg;
  if (cfg.mode === "table") return startTableSession(cfg);
  if (isGameMode(cfg.mode)) return startGame(cfg);   // jeux d'entraînement (étape 42)
  if (cfg.mode === "gender") return startGenderDrill(cfg);   // « le / la ? » (étape 60, js/genre.js)
  if (isEarMode(cfg.mode)) return startEar(cfg);             // l'oreille et la bouche (étape 69, js/oreille.js)
  if (isMixMode(cfg.mode)) return startMix(cfg);             // Mix de modes (étape 70, js/mix.js)
  const queue = sessionQueue(cfg, cfg.count);
  if (!queue.length) return false;
  newRun(queue, cfg.mode);
  return true;
}
// File d'une session (étape 70 : séparée de startSession, reprise par le Mix) : [{ id, lang, dir, lk? }], au plus count cartes.
function sessionQueue(cfg, count) {
  const all = sessionPool(cfg);
  if (!all.length) return [];
  const lgs = langsByList(), now = Date.now();
  const mk = (c, lang) => {
    const d = (cfg.dirs && cfg.dirs[lang]) || cfg.dir;
    const q = { id: c.id, lang, dir: d === "mix" ? (Math.random() < 0.5 ? "toT" : "fromT") : d };
    if (isListenMode(cfg.mode)) q.lk = lisPickKind(c, lang, cfg.mode, cfg.listenKind);   // mot ou phrase (étape 46)
    return q;
  };
  let queue;
  if (cfg.scope === "hard" || cfg.scope === "pairs") {
    // Étape 73 : une seule session « Mots difficiles » qui mélange les mots souvent ratés et les mots qui se ressemblent.
    // Unités tirées au hasard : une paire (les deux mots l'un après l'autre, dans la langue de la paire, comme à l'étape 57)
    // ou un mot raté seul. Une paire commencée est toujours finie (count + 1 au plus).
    const byId = new Map(all.map(c => [c.id, c])), used = new Set(), units = [];
    Hard.pairs().forEach(p => {
      const u = [];
      [p.a, p.b].forEach(id => {
        const c = byId.get(id);
        if (!c || used.has(id)) return;
        if (!sessionLangs(c, cfg, now, lgs.get(c.listId)).includes(p.L)) return;
        used.add(id); u.push(mk(c, p.L));
      });
      if (u.length) units.push(u);
    });
    all.forEach(c => {
      if (used.has(c.id)) return;
      const ls = sessionLangs(c, cfg, now, lgs.get(c.listId)).filter(L => Hard.inScope(c, L, "hard"));
      if (!ls.length) return;
      used.add(c.id); units.push([mk(c, ls[Math.floor(Math.random() * ls.length)])]);
    });
    queue = [];
    shuffle(units).forEach(u => { if (queue.length < count) queue.push(...u); });
  } else {
    queue = shuffle(all).slice(0, count).map(c => {
      const ls = sessionLangs(c, cfg, now, lgs.get(c.listId));
      return mk(c, ls[Math.floor(Math.random() * ls.length)] || primaryLang(c));   // une seule langue par carte
    });
  }
  return queue;
}
// Langue de chaque carte de la session (étape 37) : StudyCtx.cards, vidé à la fin de la session.
function setSessionLangs(langs) {
  StudyCtx.cards.clear();
  Object.keys(langs || {}).forEach(id => { if (isLang(langs[id])) StudyCtx.cards.set(id, langs[id]); });
}
// Lance une session à partir d'une file. first = première réponse par carte (résumé, ratés) ; dirs = sens par carte (rejouer).
// Mode Tableau : la file contient des tableaux { ids } (une file de cartes { id } est regroupée par tableau).
function newRun(queue, mode) {
  rv.s = { queue, mode, revealed: false, counts: { known: 0, review: 0, unknown: 0 }, log: [], first: {}, dirs: {}, langs: {}, lks: {}, startedAt: Date.now() };
  if (mode === "table") {
    if (queue.length && !queue[0].ids) rv.s.queue = tableGroups(queue.map(q => state.cards.find(c => c.id === q.id)).filter(Boolean));
    rv.s.queue.forEach(g => g.ids.forEach(id => { rv.s.dirs[id] = "toT"; }));
  } else queue.forEach(q => { rv.s.dirs[q.id] = q.dir; if (q.lang) rv.s.langs[q.id] = q.lang; if (q.lk) rv.s.lks[q.id] = q.lk; });
  setSessionLangs(rv.s.langs);
  rv.phase = "run";
  renderReview();
  window.scrollTo(0, 0);
}

// Note une carte de la session (modes Cartes, Écrit, Interrogateur ; les jeux notent avec gameGrade, js/modes/jeux.js). Pas su → la carte revient en fin de file.
function gradeCurrent(result) {
  const s = rv.s;
  const item = s.queue.shift();
  const c = item && state.cards.find(x => x.id === item.id);
  if (!c) { renderReview(); return; }
  const r = Leitner.grade(c, result, undefined, item.lang || s.langs[item.id]);
  if (result === "unknown") { if (!s.missed) s.missed = {}; s.missed[c.id] = 1; }   // astuce ouverte d'office au retour de la carte (étape 57)
  s.counts[result]++;
  if (!(item.id in s.first)) s.first[item.id] = result;
  s.log.unshift({ word: cardTitle(c), result, from: r.from, to: r.to, dueAt: r.dueAt });
  if (result === "unknown") s.queue.push(item);
  s.revealed = false;
  commit();
  if (result === "known") sentenceAfterKnown(c, item.lang || s.langs[item.id], s);   // « Ma phrase » (étape 58, js/sentences.js)
  HardUI.afterGrade(c, r.lang, r);   // mot difficile raté : « Réparer ce mot » (étape 57)
}
function endSession() { if (typeof SpeechRec !== "undefined") SpeechRec.stop(); rv.phase = "config"; rv.s = null; StudyCtx.cards.clear(); Storage.flushNow(); renderReview(); } // synchro en ligne après chaque session

// Carte encore utilisable dans une session en cours (supprimée, ou langue de la liste changée entre-temps).
function sessionCard(id) {
  const c = state.cards.find(x => x.id === id);
  return c && cardUsable(c) ? c : null;
}
