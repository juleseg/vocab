"use strict";

// === ÉCRAN : RÉVISER (CHOIX DE SESSION) ===
// rv.phase : "config" (choix de la session) | "run" (session en cours)
// rv.cfg est gardé en mémoire tant que l'appli est ouverte (pas sauvegardé).
// Sens par carte, relatif à la liste de la carte : "toT" = langues d'appui → langue apprise, "fromT" = l'inverse.
// Une session peut mélanger des listes de langues différentes.
const rv = { phase: "config", cfg: null, s: null };
const NO_FOLDER = "__none__";

function defaultSessionCfg() {
  return { scope: "all", folderIds: [], listIds: [], tags: [], cat: "unknown", lang: accountLangs().target,
    types: [], tenses: [], verbs: [], persons: [],   // filtres en plus (vide = tout) : types de cartes ; conjugaison (clés « langue|… »)
    onlyDue: true, dir: "toT", count: state.settings.sessionSize, mode: "cards" };
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
// Langues apprises présentes dans les listes, dans l'ordre de LANGUAGES.
function targetLangsInUse() {
  const s = new Set(state.lists.map(l => listLangs(l).target));
  return LANG_CODES.filter(c => s.has(c));
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
    if (!lg || !cardUsable(c, lg)) return false;
    if (cfg.scope === "folders") {
      const l = lists.get(c.listId);
      if (!cfg.folderIds.includes(l && l.folderId ? l.folderId : NO_FOLDER)) return false;
    }
    if (cfg.scope === "lists" && !cfg.listIds.includes(c.listId)) return false;
    if (cfg.scope === "tags" && !c.tags.some(tg => cfg.tags.includes(tg))) return false;
    if (cfg.scope === "cat" && Leitner.category(c) !== cfg.cat) return false;
    if (cfg.scope === "lang" && lg.target !== cfg.lang) return false;
    if (cfg.onlyDue && !Leitner.isDue(c, now)) return false;
    if (stage === "base") return true;
    if (types.length && !types.includes(cardType(c))) return false;
    if (stage === "types") return true;
    if (cfg.mode === "write" && cardType(c) === "rule") return false;   // fiche de règle : pas de mode Écrit
    if (cfg.mode === "table" && cardType(c) !== "conj") return false;   // mode Tableau : conjugaison seulement
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
    [["all", "scope.all"], ["folders", "scope.folders"], ["lists", "scope.lists"], ["tags", "scope.tags"], ["cat", "scope.cat"], ["lang", "scope.lang"]]
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
  } else if (cfg.scope === "lang") {
    const langs = targetLangsInUse();
    if (langs.length && !langs.includes(cfg.lang)) cfg.lang = langs[0];
    box.appendChild(langs.length
      ? segField("scope.lang", langs.map(c => [c, ""]), cfg.lang, v => { cfg.lang = v; }, langs.map(c => langName(c)))
      : el("div", "field hint", t("lists.empty")));
  }

  box.appendChild(segField("review.which", [[true, "which.due"], [false, "which.all"]], cfg.onlyDue, v => { cfg.onlyDue = v; }));

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

  // Sens : libellés concrets si toutes les cartes du périmètre ont les mêmes langues (ex. KO·EN → FR)
  const pool = sessionPool(cfg);
  const lgs = langsByList();
  const pairs = new Map();
  pool.forEach(c => { const lg = lgs.get(c.listId); pairs.set(pairLabel(lg), lg); });
  let dirLabels = null;
  if (pairs.size === 1) {
    const lg = [...pairs.values()][0];
    dirLabels = [pairLabel(lg), langCodes([lg.target]) + " → " + langCodes(lg.support), t("dir.mix")];
  }
  box.appendChild(segField("review.dir", [["toT", "dir.toTarget"], ["fromT", "dir.fromTarget"], ["mix", "dir.mix"]], cfg.dir, v => { cfg.dir = v; }, dirLabels));

  const cnt = el("input");
  cnt.type = "number"; cnt.min = "1"; cnt.max = "500"; cnt.inputMode = "numeric"; cnt.value = cfg.count;
  cnt.addEventListener("change", () => { cfg.count = clampInt(cnt.value, 1, 500, state.settings.sessionSize); cnt.value = cfg.count; });
  box.appendChild(formField(t("review.count"), cnt));

  // Mode Tableau : seulement s'il y a des cartes de conjugaison d'une langue qui a une grammaire (étape 35).
  const modes = [["cards", "mode.cards"], ["write", "mode.write"], ["quiz", "mode.quiz"]];
  if (conjCards.some(c => hasGrammar(c.lang))) modes.push(["table", "mode.table"]);
  else if (cfg.mode === "table") cfg.mode = "cards";
  box.appendChild(segField("review.mode", modes, cfg.mode, v => { cfg.mode = v; }));
  if (cfg.mode === "table") box.appendChild(el("div", "hint", t("table.modeHint")));
  root.appendChild(box);

  root.appendChild(el("div", "avail", cfg.mode === "table"
    ? t("table.available", { n: pool.length, m: tableGroups(pool).length })
    : t("review.available", { n: pool.length })));
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
  const pool = shuffle(sessionPool(cfg)).slice(0, cfg.count);
  if (!pool.length) return false;
  const queue = pool.map(c => ({ id: c.id, dir: cfg.dir === "mix" ? (Math.random() < 0.5 ? "toT" : "fromT") : cfg.dir }));
  newRun(queue, cfg.mode);
  return true;
}
// Lance une session à partir d'une file. first = première réponse par carte (résumé, ratés) ; dirs = sens par carte (rejouer).
// Mode Tableau : la file contient des tableaux { ids } (une file de cartes { id } est regroupée par tableau).
function newRun(queue, mode) {
  rv.s = { queue, mode, revealed: false, counts: { known: 0, review: 0, unknown: 0 }, log: [], first: {}, dirs: {}, startedAt: Date.now() };
  if (mode === "table") {
    if (queue.length && !queue[0].ids) rv.s.queue = tableGroups(queue.map(q => state.cards.find(c => c.id === q.id)).filter(Boolean));
    rv.s.queue.forEach(g => g.ids.forEach(id => { rv.s.dirs[id] = "toT"; }));
  } else queue.forEach(q => { rv.s.dirs[q.id] = q.dir; });
  rv.phase = "run";
  renderReview();
  window.scrollTo(0, 0);
}

// Note une carte de la session (utilisé par tous les modes). Pas su → la carte revient en fin de file.
function gradeCurrent(result) {
  const s = rv.s;
  const item = s.queue.shift();
  const c = item && state.cards.find(x => x.id === item.id);
  if (!c) { renderReview(); return; }
  const r = Leitner.grade(c, result);
  s.counts[result]++;
  if (!(item.id in s.first)) s.first[item.id] = result;
  s.log.unshift({ word: cardTitle(c), result, from: r.from, to: r.to, dueAt: r.dueAt });
  if (result === "unknown") s.queue.push(item);
  s.revealed = false;
  commit();
}
function endSession() { rv.phase = "config"; rv.s = null; Storage.flushNow(); renderReview(); } // synchro en ligne après chaque session

// Carte encore utilisable dans une session en cours (supprimée, ou langue de la liste changée entre-temps).
function sessionCard(id) {
  const c = state.cards.find(x => x.id === id);
  return c && cardUsable(c) ? c : null;
}
