"use strict";

// === ÉCRAN : STATS ===
// Filtres gardés en mémoire tant que l'appli est ouverte :
//   stv.lang  : langue apprise ("" = toutes) ; stv.scope : "" (tout) | "f:<idDossier>" | "l:<idListe>".
// Taux de réussite = réponses « Su » / toutes les réponses (stats.correct / stats.seen).
// Étape 37 : on compte des « vues » (carte, langue étudiée) — Leitner.units — : une carte étudiée en coréen et en
// italien compte deux fois (une par langue) ; filtre de langue = une seule langue. Bloc « Par langue étudiée ».
const stv = { lang: "", scope: "", cap: "" };

function catCounts(cards) {
  const n = { known: 0, review: 0, unknown: 0 };
  cards.forEach(c => n[Leitner.category(c)]++);
  return n;
}
function rateOf(cards) {
  let seen = 0, ok = 0;
  cards.forEach(c => { seen += c.stats.seen; ok += c.stats.correct; });
  return { seen, ok, pct: seen ? Math.round(ok * 100 / seen) : null };
}
// Rétention estimée (étape 47) : moyenne de la rétrievabilité FSRS, maintenant, des vues déjà révisées ; null si aucune.
function retAvg(units, now) {
  let n = 0, sum = 0;
  units.forEach(u => { const r = fsrsRetrievability(u, now); if (r != null) { n++; sum += r; } });
  return n ? { pct: Math.round(sum * 100 / n), n } : null;
}
function retText(units, now) { const r = retAvg(units, now); return r ? t("stats.pct", { n: r.pct }) : "—"; }
function pctText(r) { return r.pct == null ? "—" : t("stats.pct", { n: r.pct }); }
function catBar(n, total) {
  const bar = el("div", "st-bar");
  [["known", "st-ok"], ["review", "st-warn"], ["unknown", "st-bad"]].forEach(([k, cls]) => {
    if (!n[k]) return;
    const s = el("span", cls);
    s.style.width = (n[k] * 100 / total) + "%";
    bar.appendChild(s);
  });
  return bar;
}
function stTile(value, label) {
  const d = el("div", "st-tile");
  d.append(el("div", "st-num", String(value)), el("div", "st-lbl", label));
  return d;
}
// Ligne « nom + N cartes · taux + barre des catégories » (par dossier, par liste).
function stGroupRow(name, cards) {
  const row = el("div", "st-list");
  row.append(el("div", "st-list-hd", name), el("div", "st-list-sub", t("stats.listLine", { n: cards.length, r: pctText(rateOf(cards)) })));
  if (cards.length) row.appendChild(catBar(catCounts(cards), cards.length));
  return row;
}

function renderStats() {
  const root = $("#screen-stats");
  root.textContent = "";
  const langs = targetLangsInUse();
  if (stv.lang && !langs.includes(stv.lang)) stv.lang = "";
  if (stv.scope.startsWith("f:") && !getFolder(stv.scope.slice(2))) stv.scope = "";
  if (stv.scope.startsWith("l:") && !getList(stv.scope.slice(2))) stv.scope = "";
  if (!state.cards.length) { root.appendChild(el("div", "empty", t("stats.empty"))); return; }

  const inLang = l => !stv.lang || studyLangs(l).includes(stv.lang);
  const lists = orderedLists().filter(inLang);
  if (stv.scope.startsWith("l:") && !lists.some(l => l.id === stv.scope.slice(2))) stv.scope = "";

  // Filtres : langue apprise (si plusieurs), puis tout / un dossier / une liste
  const filters = el("div", "st-filters");
  if (langs.length > 1) {
    const ls = el("select", "input");
    [["", t("stats.allLangs")]].concat(langs.map(c => [c, langName(c)])).forEach(([v, l]) => { const o = el("option", null, l); o.value = v; ls.appendChild(o); });
    ls.value = stv.lang;
    ls.addEventListener("change", () => { stv.lang = ls.value; renderStats(); });
    filters.appendChild(ls);
  }
  if (state.lists.length > 1 || state.folders.length) {
    const sel = el("select", "input");
    const add = (parent, v, l) => { const o = el("option", null, l); o.value = v; parent.appendChild(o); };
    add(sel, "", t("stats.allLists"));
    sortedFolders().forEach(f => {
      const fl = lists.filter(l => l.folderId === f.id);
      if (!fl.length) return;
      const g = el("optgroup"); g.label = f.name;
      add(g, "f:" + f.id, t("stats.wholeFolder", { name: f.name }));
      fl.forEach(l => add(g, "l:" + l.id, l.name));
      sel.appendChild(g);
    });
    const loose = lists.filter(l => !l.folderId);
    if (loose.length) {
      const g = state.folders.length ? el("optgroup") : sel;
      if (g !== sel) { g.label = t("folders.none"); sel.appendChild(g); }
      loose.forEach(l => add(g, "l:" + l.id, l.name));
    }
    sel.value = stv.scope;
    sel.addEventListener("change", () => { stv.scope = sel.value; renderStats(); });
    filters.appendChild(sel);
  }
  if (filters.childNodes.length) root.appendChild(filters);

  // Listes du périmètre, puis cartes
  let scopeLists = lists;
  if (stv.scope.startsWith("f:")) scopeLists = lists.filter(l => l.folderId === stv.scope.slice(2));
  else if (stv.scope.startsWith("l:")) scopeLists = lists.filter(l => l.id === stv.scope.slice(2));
  const ids = new Set(scopeLists.map(l => l.id));
  const cards = Leitner.units(state.cards.filter(c => ids.has(c.listId)), stv.lang || null);   // une vue par langue étudiée
  if (!cards.length) { root.appendChild(el("div", "empty", t("lists.noCards"))); return; }
  const now = Date.now();
  const rate = rateOf(cards);

  // Chiffres clés (la série de jours est globale)
  const top = el("div", "card");
  const tiles = el("div", "st-tiles");
  tiles.append(
    stTile(cards.length, t("stats.words")),
    stTile(dueCount(cards, now), t("home.due")),
    stTile(pctText(rate), t("stats.rate")),
    stTile(computeStreak(), t("home.streak"))
  );
  top.appendChild(tiles);
  if (rate.seen) top.appendChild(el("div", "hint", t("stats.rateHint", { c: rate.ok, s: rate.seen })));
  root.appendChild(top);
  const byL = statsByLang(cards, now);
  if (byL) root.appendChild(byL);
  root.appendChild(statsXp());       // XP, niveau, XP par langue, défis réussis (étape 43, js/xp.js)
  root.appendChild(statsStreak());
  const snEntry = sentenceStatsEntry();   // « ✍️ Mes phrases » (étape 58, mode Supabase)
  if (snEntry) root.appendChild(snEntry);

  // Par catégorie
  const n = catCounts(cards);
  const cat = el("div", "card");
  cat.appendChild(el("h2", null, t("stats.byCat")));
  const grid = el("div", "sum-grid");
  grid.style.marginTop = "0";
  [["known", "ok"], ["review", "warn"], ["unknown", "bad"]].forEach(([k, cls]) => {
    const cell = el("div", "sum-cell " + cls);
    cell.append(el("div", "sum-num", String(n[k])), el("div", "sum-lbl", t("cat." + k)));
    grid.appendChild(cell);
  });
  cat.append(grid, catBar(n, cards.length));
  const ra = retAvg(cards, now);   // rétention estimée (FSRS, étape 47)
  const rl = el("div", "fs-retline");
  rl.append(el("b", null, t("fsrs.estRet") + " : " + (ra ? t("stats.pct", { n: ra.pct }) : "—")),
    el("div", "hint", ra ? t("fsrs.estRetHint", { n: ra.n, r: Math.round(fsrsTarget() * 100) }) : t("fsrs.estRetNone")));
  cat.appendChild(rl);
  root.appendChild(cat);

  // Par boîte (0 à 5)
  const boxes = [0, 0, 0, 0, 0, 0];
  cards.forEach(c => boxes[c.box]++);
  const max = Math.max(1, ...boxes);
  const bx = el("div", "card");
  bx.appendChild(el("h2", null, t("stats.byBox")));
  boxes.forEach((v, i) => {
    const row = el("div", "st-row");
    const tr = el("div", "st-track");
    const fill = el("div", "st-fill " + (i === 0 ? "st-bad" : i <= 2 ? "st-warn" : "st-ok"));
    fill.style.width = (v * 100 / max) + "%";
    tr.appendChild(fill);
    row.append(el("div", null, t("stats.box", { n: i })), tr, el("div", "st-n", String(v)));
    bx.appendChild(row);
  });
  root.appendChild(bx);

  // Par type de carte (s'il y a plusieurs types dans le périmètre)
  const typesIn = CARD_TYPES.filter(ty => cards.some(c => cardType(c) === ty));
  if (typesIn.length > 1) {
    const pt = el("div", "card");
    pt.appendChild(el("h2", null, t("stats.byType")));
    typesIn.forEach(ty => pt.appendChild(stGroupRow(TYPE_ICON[ty] + " " + t("type." + ty), cards.filter(c => cardType(c) === ty))));
    root.appendChild(pt);
  }

  // Par temps (cartes de conjugaison), dans l'ordre des temps de chaque langue
  const conj = cards.filter(c => cardType(c) === "conj");
  if (conj.length) {
    const multi = new Set(conj.map(c => c.lang)).size > 1;
    const groups = new Map();
    conj.forEach(c => { const k = tenseKey(c); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(c); });
    const ord = k => { const [lng, id] = k.split("|"); return LANG_CODES.indexOf(lng) * 100 + tensesOf(lng).findIndex(x => x.id === id); };
    const ptn = el("div", "card");
    ptn.appendChild(el("h2", null, t("stats.byTense")));
    [...groups.keys()].sort((a, b) => ord(a) - ord(b)).forEach(k => {
      const [lng, id] = k.split("|");
      const cs = groups.get(k);
      const verbs = new Set(cs.map(verbKey)).size;
      const row = stGroupRow(tenseName(lng, id) + (multi ? " (" + langName(lng) + ")" : ""), cs);
      row.querySelector(".st-list-sub").textContent += " · " + t(verbs > 1 ? "stats.verbs" : "stats.verb1", { n: verbs });
      ptn.appendChild(row);
    });
    root.appendChild(ptn);
  }

  // Par dossier (vue « tout », s'il y a des dossiers)
  if (!stv.scope && state.folders.length) {
    const pf = el("div", "card");
    pf.appendChild(el("h2", null, t("stats.byFolder")));
    sortedFolders().forEach(f => {
      const fl = new Set(lists.filter(l => l.folderId === f.id).map(l => l.id));
      if (fl.size) pf.appendChild(stGroupRow(f.name, cards.filter(c => fl.has(c.listId))));
    });
    const loose = new Set(lists.filter(l => !l.folderId).map(l => l.id));
    if (loose.size) pf.appendChild(stGroupRow(t("folders.none"), cards.filter(c => loose.has(c.listId))));
    if (pf.childNodes.length > 1) root.appendChild(pf);
  }

  // Par liste (périmètre « tout » ou un dossier, s'il y a plusieurs listes)
  if (!stv.scope.startsWith("l:") && scopeLists.length > 1) {
    const pl = el("div", "card");
    pl.appendChild(el("h2", null, t("stats.byList")));
    scopeLists.forEach(l => pl.appendChild(stGroupRow(stv.scope ? l.name : listLabel(l), cards.filter(c => c.listId === l.id))));
    root.appendChild(pl);
  }

  // Mots les plus ratés (10 max)
  const missed = cards.filter(c => c.stats.wrong > 0)
    .sort((a, b) => b.stats.wrong - a.stats.wrong || a.stats.correct - b.stats.correct)
    .slice(0, 10);
  const ms = el("div", "card");
  ms.appendChild(el("h2", null, t("stats.missed")));
  if (!missed.length) ms.appendChild(el("div", "muted", t("stats.noMissed")));
  const multiL = new Set(cards.map(c => c.unitLang)).size > 1;
  missed.forEach(c => {
    const lg = cardLangs(c);   // langues de la vue (langue étudiée, étape 37)
    const row = el("div", "st-miss");
    const m = el("div", "main");
    const f = el("div", "t1", (isVocab(c) ? (targetTerm(c, lg) || "—") : cardTitle(c)) + (multiL ? " (" + c.unitLang.toUpperCase() + ")" : "")); f.lang = lg.target;
    if (!isVocab(c)) f.insertBefore(typeBadge(c.type), f.firstChild);
    m.appendChild(f);
    const sub = isVocab(c) ? supportText(c, lg) : cardSubtitle(c);
    if (sub) m.appendChild(el("div", "t2", sub));
    row.append(m, el("div", "cnt", t("stats.missedCount", { w: c.stats.wrong, s: c.stats.seen })));
    ms.appendChild(row);
  });
  root.appendChild(ms);
  root.appendChild(HardUI.statsCards(cards));   // mots difficiles, mots qui se ressemblent, en pause (étape 57)
}

// Par langue étudiée (étape 37), s'il y en a plusieurs : cartes, à réviser, réussite, catégories, révisions sur 7 jours,
// jours d'affilée avec au moins une révision dans cette langue (la série et l'objectif du jour restent pour toutes les langues).
function statsByLang(units, now) {
  const ls = LANG_CODES.filter(L => units.some(u => u.unitLang === L));
  if (ls.length < 2) return null;
  const card = el("div", "card");
  card.appendChild(el("h2", null, t("study.byLang")));
  ls.forEach(L => {
    const us = units.filter(u => u.unitLang === L);
    const row = stGroupRow(langName(L), us);
    row.querySelector(".st-list-sub").textContent = t("study.statLine", { n: us.length, d: dueCount(us, now), r: pctText(rateOf(us)) })
      + " · " + t("fsrs.estRetShort", { r: retText(us, now) });   // rétention estimée par langue (étape 47)
    const w = langReviewed(L, 7);
    row.appendChild(el("div", "st-list-sub", t("study.statDays", { r: w.reviewed, p: w.reviewed ? Math.round(w.correct * 100 / w.reviewed) : 0, s: langRunDays(L) })));
    card.appendChild(row);
  });
  return card;
}

// Série (étape 28) : chiffres, calendrier des 12 dernières semaines (jours gelés, objectif atteint), badges
// (badges de série puis, depuis l'étape 43, badges XP : xpBadgeCells).
function statsStreak() {
  const s = Streak.data(), wrap = el("div");
  const card = el("div", "card");
  card.appendChild(el("h2", null, "🔥 " + t("sk.title")));
  const tiles = el("div", "st-tiles");
  tiles.append(stTile(s.current, t("home.streak")), stTile(s.best, t("sk.bestLbl")),
    stTile(s.freezes + " / " + STREAK_MAX_FREEZES, "❄️ " + t("sk.freezesLbl")), stTile(Streak.goal(), t("sk.goalTitle")));
  card.appendChild(tiles);
  card.appendChild(el("div", "hint", t("sk.rules", { g: Streak.goal() })));
  wrap.appendChild(card);
  // Calendrier : du lundi d'il y a 11 semaines à aujourd'hui (même dessin que la fiche du compte)
  const today = new Date(), dow = (today.getDay() + 6) % 7;
  const from = todayStr(new Date(today.getFullYear(), today.getMonth(), today.getDate() - dow - 77, 12));
  const days = state.history.filter(h => h.reviewed > 0 && h.date >= from).map(h => ({ day: h.date, reviewed: h.reviewed, sessions: 0 }));
  wrap.appendChild(fcCalendar({ from, to: todayStr(), days },
    { frozen: new Set(s.frozenDays), valid: new Set(s.validDays), store: stv, line: n => t("sk.calCards", { n }) }));
  // Badges : les 4 paliers, obtenus en couleur avec leur date
  const bc = el("div", "card");
  bc.appendChild(el("h2", null, t("sk.badges")));
  const grid = el("div", "sk-badges");
  STREAK_BADGES.forEach(b => {
    const got = s.badges.find(x => x.days === b);
    const c = el("div", "sk-badge " + (got ? "on" : "off"));
    c.append(el("div", "ic", badgeIcon(b)), el("div", "nm", t("sk.badgeName", { n: b })),
      el("div", "dt", got ? (got.day ? dashBucketLabel(got.day, false, true) : t("sk.badgeGot")) : t("sk.badgeTodo")));
    c.title = t("sk.badgeName", { n: b }) + " — " + (got ? t("sk.badgeGot") : t("sk.badgeTodo"));
    grid.appendChild(c);
  });
  xpBadgeCells(grid);   // badges de l'étape 43 (sans-faute, cartes, défis, Course 60 s, niveaux)
  bc.appendChild(grid);
  wrap.appendChild(bc);
  return wrap;
}
