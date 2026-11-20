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
    onlyDue: true, dir: "toT", count: state.settings.sessionSize, mode: "cards",
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
    if ((cfg.scope === "hard" || cfg.scope === "pairs") && !Hard.inScope(c, L, cfg.scope)) return;   // « Mots difficiles » / « Mots qui se ressemblent » (étape 57)
    if (cfg.onlyDue && cfg.scope !== "pairs" && cfg.mode !== "gender" && !isEarMode(cfg.mode) && !Leitner.isDue(c, now, L)) return;   // paires : les deux mots sont toujours là ; « le / la ? » (étape 60) et l'oreille et la bouche (étape 69) : tout le périmètre
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
    if (rv.s.mode === "cards") renderCardsSession(root);
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

function renderSessionConfig(root) {
  const cfg = rv.cfg;
  const box = el("div", "card");

  // Périmètre : un seul choix (pastilles, car 6 options)
  const sc = chipsField(
    [["all", "scope.all"], ["folders", "scope.folders"], ["lists", "scope.lists"], ["tags", "scope.tags"], ["cat", "scope.cat"], ["lang", "scope.lang"], ["hard", "hd.scope.hard"], ["pairs", "hd.scope.pairs"]]
      .map(([v, k]) => ({ value: v, label: t(k) })),
    [cfg.scope], v => { cfg.scope = v; });
  sc.insertBefore(el("label", null, t("review.scope")), sc.firstChild);
  box.appendChild(sc);

  if (cfg.scope === "folders") {
    const items = sortedFolders().map(f => ({ value: f.id, label: f.name }));
    if (items.length && listsIn(null).length) items.push({ value: NO_FOLDER, label: t("folders.none") });
    box.appendChild(items.length
      ? chipsField(items, cfg.folderIds, v => toggleIn(cfg.folderIds, v))
      : el("div", "field hint", t("folders.empty")));
  } else if (cfg.scope === "lists") {
    box.appendChild(state.lists.length
      ? chipsField(orderedLists().map(l => ({ value: l.id, label: listLabel(l) })), cfg.listIds, v => toggleIn(cfg.listIds, v))
      : el("div", "field hint", t("lists.empty")));
  } else if (cfg.scope === "tags") {
    const tags = allTags();
    cfg.tags = cfg.tags.filter(tg => tags.includes(tg));
    box.appendChild(tags.length
      ? chipsField(tags.map(tg => ({ value: tg, label: "#" + tg })), cfg.tags, v => toggleIn(cfg.tags, v))
      : el("div", "field hint", t("review.noTags")));
  } else if (cfg.scope === "cat") {
    box.appendChild(segField("scope.cat",
      [["unknown", "cat.unknown"], ["review", "cat.review"], ["known", "cat.known"]],
      cfg.cat, v => { cfg.cat = v; }));
  } else if (cfg.scope === "hard" || cfg.scope === "pairs") {
    box.appendChild(el("div", "field hint", t(cfg.scope === "hard" ? "hd.scope.hardHint" : "hd.scope.pairsHint")));
  } else if (cfg.scope === "lang") {
    const langs = targetLangsInUse();
    if (langs.length && !langs.includes(cfg.lang)) cfg.lang = langs[0];
    box.appendChild(langs.length
      ? segField("scope.lang", langs.map(c => [c, ""]), cfg.lang, v => { cfg.lang = v; }, langs.map(c => langName(c)))
      : el("div", "field hint", t("lists.empty")));
  }

  if (!isEarMode(cfg.mode))   // l'oreille et la bouche (étape 69) : entraînement sur tout le périmètre
    box.appendChild(segField("review.which", [[true, "which.due"], [false, "which.all"]], cfg.onlyDue, v => { cfg.onlyDue = v; }));

  // Langues étudiées (étape 37) : plusieurs choix, aucun = toutes ; seulement s'il y en a plusieurs dans le périmètre
  const now0 = Date.now(), lgs0 = langsByList(), inPool = new Set();
  sessionPool(cfg, "base").forEach(c => sessionLangs(c, cfg, now0, lgs0.get(c.listId), "base").forEach(L => inPool.add(L)));
  const poolLangs = LANG_CODES.filter(L => inPool.has(L));
  cfg.langs = arr(cfg.langs).filter(L => poolLangs.includes(L));
  if (poolLangs.length > 1) {
    const lf = chipsField(poolLangs.map(L => ({ value: L, label: langName(L) })), cfg.langs, v => toggleIn(cfg.langs, v));
    lf.insertBefore(el("label", null, t("study.reviewLangs")), lf.firstChild);
    lf.appendChild(el("div", "hint", t("study.reviewLangsHint")));
    box.appendChild(lf);
  }

  // Types de cartes (plusieurs choix, aucun = tous), seulement les types présents dans le périmètre
  const base = sessionPool(cfg, "base");
  const present = CARD_TYPES.filter(ty => base.some(c => cardType(c) === ty));
  cfg.types = cfg.types.filter(ty => present.includes(ty));
  if (present.length > 1) {
    const tf = chipsField(present.map(ty => ({ value: ty, label: TYPE_ICON[ty] + " " + t("type." + ty) })), cfg.types, v => toggleIn(cfg.types, v));
    tf.insertBefore(el("label", null, t("review.types")), tf.firstChild);
    tf.appendChild(el("div", "hint", t("review.typesHint")));
    box.appendChild(tf);
  }
  // Conjugaison : temps, verbes, personnes (plusieurs choix, aucun = tous)
  const conjCards = sessionPool(cfg, "types").filter(c => cardType(c) === "conj");
  const keep = (sel, keys) => sel.filter(k => keys.has(k));
  if (conjCards.length) {
    const multi = new Set(conjCards.map(c => c.lang)).size > 1;
    const suf = lng => multi ? " (" + lng.toUpperCase() + ")" : "";
    const tens = new Map(), verbs = new Map(), pers = new Map();
    conjCards.forEach(c => {
      if (!tens.has(tenseKey(c))) tens.set(tenseKey(c), { label: tenseName(c.lang, c.tense) + suf(c.lang), o: [LANG_CODES.indexOf(c.lang), tensesOf(c.lang).findIndex(x => x.id === c.tense)] });
      if (!verbs.has(verbKey(c))) verbs.set(verbKey(c), { label: c.verb + suf(c.lang), o: [LANG_CODES.indexOf(c.lang), 0] });
      if (!pers.has(personKey(c))) {
        const ps = personsOf(c.lang, c.tense);
        pers.set(personKey(c), { label: personLabel(c.lang, c.tense, c.person) + suf(c.lang), o: [LANG_CODES.indexOf(c.lang), ps.findIndex(x => x.id === c.person) + (ps === grammarOf(c.lang).persons ? 0 : 100)] });
      }
    });
    const items = m => [...m.entries()].sort((a, b) => a[1].o[0] - b[1].o[0] || a[1].o[1] - b[1].o[1] || a[1].label.localeCompare(b[1].label)).map(([value, x]) => ({ value, label: x.label }));
    cfg.tenses = keep(cfg.tenses, tens); cfg.verbs = keep(cfg.verbs, verbs); cfg.persons = keep(cfg.persons, pers);
    const cj = el("div", "rv-conj");
    cj.appendChild(el("div", "rv-conj-hd", TYPE_ICON.conj + " " + t("review.conj")));
    [["review.tenses", tens, cfg.tenses], ["review.verbs", verbs, cfg.verbs], ["review.persons", pers, cfg.persons]].forEach(([k, m, sel]) => {
      if (m.size < 2 && !sel.length) return;
      const f = chipsField(items(m), sel, v => toggleIn(sel, v));
      f.insertBefore(el("label", null, t(k)), f.firstChild);
      cj.appendChild(f);
    });
    if (cj.childNodes.length > 1) { cj.appendChild(el("div", "hint", t("review.conjHint"))); box.appendChild(cj); }
  } else { cfg.tenses = []; cfg.verbs = []; cfg.persons = []; }

  // Sens : libellés concrets si toutes les cartes du périmètre ont les mêmes langues (ex. KO·EN → FR).
  // Plusieurs langues étudiées dans la session (étape 37) : un choix de sens par langue.
  const pool = sessionPool(cfg);
  const lgs = langsByList(), nowP = Date.now();
  const sesLangs = new Set();
  pool.forEach(c => { if (isVocab(c)) sessionLangs(c, cfg, nowP, lgs.get(c.listId)).forEach(L => sesLangs.add(L)); });
  const dirOpts = [["toT", "dir.toTarget"], ["fromT", "dir.fromTarget"], ["mix", "dir.mix"]];
  if (isListenMode(cfg.mode) || cfg.mode === "gender" || isEarMode(cfg.mode)) { /* Dictée / Prononciation (étape 46), « le / la ? » (étape 60), oreille et bouche (étape 69) : pas de sens */ }
  else if (sesLangs.size > 1) {
    if (!cfg.dirs || typeof cfg.dirs !== "object") cfg.dirs = {};
    LANG_CODES.filter(L => sesLangs.has(L)).forEach(L => {
      const lg = studyLg(L);
      const f = segField("review.dir", dirOpts, cfg.dirs[L] || cfg.dir, v => { cfg.dirs[L] = v; },
        [pairLabel(lg), langCodes([L]) + " → " + langCodes(lg.support), t("dir.mix")]);
      f.querySelector("label").textContent = t("study.dirFor", { lang: langName(L) });
      box.appendChild(f);
    });
  } else {
    const pairs = new Map();
    pool.forEach(c => { const L = isVocab(c) ? sessionLangs(c, cfg, nowP, lgs.get(c.listId))[0] : ""; const lg = L && L !== lgs.get(c.listId).target ? studyLg(L) : lgs.get(c.listId); pairs.set(pairLabel(lg), lg); });
    let dirLabels = null;
    if (pairs.size === 1) {
      const lg = [...pairs.values()][0];
      dirLabels = [pairLabel(lg), langCodes([lg.target]) + " → " + langCodes(lg.support), t("dir.mix")];
    }
    box.appendChild(segField("review.dir", dirOpts, cfg.dir, v => { cfg.dir = v; }, dirLabels));
  }

  const cnt = el("input");
  cnt.type = "number"; cnt.min = "1"; cnt.max = "500"; cnt.inputMode = "numeric"; cnt.value = cfg.count;
  cnt.addEventListener("change", () => { cfg.count = clampInt(cnt.value, 1, 500, state.settings.sessionSize); cnt.value = cfg.count; });
  box.appendChild(formField(t("review.count"), cnt));

  // Mode Tableau : seulement s'il y a des cartes de conjugaison d'une langue qui a une grammaire (étape 35).
  const modes = [["cards", "mode.cards"], ["write", "mode.write"], ["quiz", "mode.quiz"]];
  if (conjCards.some(c => hasGrammar(c.lang))) modes.push(["table", "mode.table"]);
  else if (cfg.mode === "table") cfg.mode = "cards";
  // Dictée et Prononciation (étape 46). Dictée grisée si aucune langue du périmètre n'a de voix ;
  // Prononciation absente si le navigateur n'a pas la reconnaissance vocale.
  const vo = lisVoiceInfo(cfg.langs.length ? cfg.langs : poolLangs);
  modes.push(["dictation", "mode.dictation"]);
  if (lisCanSpeak()) modes.push(["speak", "mode.speak"]);
  else if (cfg.mode === "speak") cfg.mode = "cards";
  if (cfg.mode === "dictation" && !vo.ok) cfg.mode = "cards";
  const mf = segField("review.mode", modes, cfg.mode, v => { cfg.mode = v; });
  const mseg = mf.querySelector(".seg");
  if (modes.length > 4) mseg.classList.add("seg-wrap");
  if (!vo.ok) mseg.children[modes.findIndex(m => m[0] === "dictation")].disabled = true;
  box.appendChild(mf);
  if (cfg.mode === "table") box.appendChild(el("div", "hint", t("table.modeHint")));
  if (!vo.ok) box.appendChild(el("div", "hint", t(vo.loading ? "ls.voiceLoading" : "ls.noVoice")));
  if (isListenMode(cfg.mode)) {
    box.appendChild(el("div", "hint", t(cfg.mode === "dictation" ? "ls.hint.dictation" : "ls.hint.speak")));
    if (cfg.mode === "dictation" && vo.missing.length) box.appendChild(el("div", "hint", t("ls.noVoiceSome", { langs: vo.missing.map(langName).join(", ") })));
    box.appendChild(segField("ls.kind", [["words", "ls.kind.words"], ["sents", "ls.kind.sents"], ["both", "ls.kind.both"]],
      cfg.listenKind || "both", v => { cfg.listenKind = v; }));
  }
  // Jeux d'entraînement (étape 42) : même périmètre, cartes de vocabulaire seulement. Un seul mode choisi en tout.
  const gf = chipsField(GAME_MODES.map(m => ({ value: m, label: GAME_ICON[m] + " " + t("mode." + m) }))
    .concat(genderOkAny() ? [{ value: "gender", label: "♂♀ " + t("mode.gender") }] : [])   // « le / la ? » (étape 60)
    .concat(earMinimalAny() ? [{ value: "minimal", label: EAR_ICON.minimal + " " + t("mode.minimal") }] : [])   // paires minimales (étape 69)
    .concat(earShadowAny() ? [{ value: "shadow", label: EAR_ICON.shadow + " " + t("mode.shadow") }] : []),      // répéter après la voix (étape 69)
    [cfg.mode], v => { cfg.mode = v; });
  gf.insertBefore(el("label", null, t("review.games")), gf.firstChild);
  gf.appendChild(el("div", "hint", t("review.gamesHint")));
  box.appendChild(gf);
  if (cfg.mode === "gender") {   // « le / la ? » (étape 60) : entraînement, article demandé
    box.appendChild(el("div", "hint gd-chip-hint", t("gd.chipHint")));
    box.appendChild(segField("gd.art", [["def", "gd.art.def"], ["indef", "gd.art.indef"], ["mix", "gd.art.mix"]], cfg.genderArt || "mix", v => { cfg.genderArt = v; }));
  }
  if (cfg.mode === "order") box.appendChild(segField("gm.order.kind", [["words", "gm.order.words"], ["sents", "gm.order.sents"], ["both", "gm.order.both"]],
    cfg.orderKind || "both", v => { cfg.orderKind = v; }));
  const earAvail = isEarMode(cfg.mode) ? earConfig(box, cfg) : null;   // l'oreille et la bouche (étape 69, js/oreille.js)
  root.appendChild(box);

  root.appendChild(el("div", "avail", earAvail || (cfg.mode === "table"
    ? t("table.available", { n: pool.length, m: tableGroups(pool).length })
    : t("review.available", { n: pool.length }))));
  const start = el("button", "btn primary", t("review.start"));
  start.addEventListener("click", () => {
    cfg.count = clampInt(cnt.value, 1, 500, state.settings.sessionSize);
    if ((cfg.scope === "lists" && !cfg.listIds.length) || (cfg.scope === "tags" && !cfg.tags.length) ||
        (cfg.scope === "folders" && !cfg.folderIds.length)) { toast(t("review.pickOne")); return; }
    if (!startSession()) toast(t("review.none"));
  });
  root.appendChild(start);
}

// Construit la file : périmètre filtré, ordre aléatoire, coupé au nombre demandé, sens fixé par carte.
function startSession() {
  const cfg = rv.cfg;
  if (cfg.mode === "table") return startTableSession(cfg);
  if (isGameMode(cfg.mode)) return startGame(cfg);   // jeux d'entraînement (étape 42)
  if (cfg.mode === "gender") return startGenderDrill(cfg);   // « le / la ? » (étape 60, js/genre.js)
  if (isEarMode(cfg.mode)) return startEar(cfg);             // l'oreille et la bouche (étape 69, js/oreille.js)
  const all = sessionPool(cfg);
  if (!all.length) return false;
  const lgs = langsByList(), now = Date.now();
  const mk = (c, lang) => {
    const d = (cfg.dirs && cfg.dirs[lang]) || cfg.dir;
    const q = { id: c.id, lang, dir: d === "mix" ? (Math.random() < 0.5 ? "toT" : "fromT") : d };
    if (isListenMode(cfg.mode)) q.lk = lisPickKind(c, lang, cfg.mode, cfg.listenKind);   // mot ou phrase (étape 46)
    return q;
  };
  let queue;
  if (cfg.scope === "pairs") {
    // Étape 57 : les deux mots d'une paire sont posés l'un après l'autre, dans la langue de la paire.
    const byId = new Map(all.map(c => [c.id, c])), used = new Set();
    queue = [];
    shuffle(Hard.pairs().slice()).forEach(p => {
      [p.a, p.b].forEach(id => {
        const c = byId.get(id);
        if (!c || used.has(id) || queue.length >= cfg.count + 1) return;
        if (!sessionLangs(c, cfg, now, lgs.get(c.listId)).includes(p.L)) return;
        used.add(id); queue.push(mk(c, p.L));
      });
    });
  } else {
    queue = shuffle(all).slice(0, cfg.count).map(c => {
      const ls = sessionLangs(c, cfg, now, lgs.get(c.listId));
      return mk(c, ls[Math.floor(Math.random() * ls.length)] || primaryLang(c));   // une seule langue par carte
    });
  }
  if (!queue.length) return false;
  newRun(queue, cfg.mode);
  return true;
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
