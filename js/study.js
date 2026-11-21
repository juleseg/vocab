"use strict";

// === LANGUES ÉTUDIÉES D'UNE LISTE OU D'UN DOSSIER (ÉTAPE 37) ===
// Une liste peut être étudiée dans plusieurs langues : mêmes cartes (mêmes sens du dictionnaire commun), progression
// séparée par langue (card.progress, voir LEITNER). Règles de langues : js/languages.js (studyLangs, studyLg…).
// - Menu d'une liste (lien « Ajouter une langue étudiée ») ou d'un dossier → openStudyLangs : langues étudiées
//   (à réviser et à compléter par langue), ajout (langues apprises du profil, ou autre langue ajoutée au profil),
//   retrait (progression gardée, cachée). Dossier : appliqué à toutes ses listes.
// - Ajout : l.targets += langue ; remplissage depuis le dictionnaire commun (immédiat), puis bilan (complètes / à compléter :
//   mots, nature, exemples) et « Compléter avec Claude » (direct, file d'attente, copier-coller ou fichier) : tout passe
//   par « À valider » (champs absolus : <langue>, pos:<langue>, exl:<langue>, exlt:<langue>:<code>) ; les valeurs
//   acceptées partent au commun (Dict.track / Dict.changed, comme les autres).
// - Cartes conj / trou / erreur / règle : gardent leur langue (champ lang) ; proposition d'en générer dans la nouvelle langue.
// - Liste commune (étape 30) : l.targets est dans MES données (morceau lists) et la progression dans ma clé
//   sharedprogress : l'ajout ne change ni la liste ni la progression des autres membres. Les mots ajoutés vont dans les
//   cartes communes (cachés pour ceux qui n'étudient pas cette langue). Lecture seule : rien ne peut être complété.

// Listes concernées : une liste, ou toutes les listes d'un dossier.
function studyScopeLists(kind, id) {
  if (kind === "list") { const l = getList(id); return l ? [l] : []; }
  const f = getFolder(id);
  return f ? listsIn(f.id) : [];
}
function studyScopeObj(kind, id) { return kind === "list" ? getList(id) : getFolder(id); }
// Cartes de vocabulaire des listes du périmètre qui étudient la langue L.
function studyVocabCards(lists, L) {
  const ids = new Set(lists.filter(l => studyLangs(l).includes(L)).map(l => l.id));
  return state.cards.filter(c => ids.has(c.listId) && isVocab(c));
}
// Cartes avec des cases à compléter dans la langue L (listes modifiables seulement, comme les badges).
function studyGapCount(cards, L) {   // étape 80 : sans les cartes prises en charge par la mise à jour automatique
  const auto = typeof AutoMaj !== "undefined" && AutoMaj.active();
  return cards.filter(c => canEditList(c.listId) && studyGapFields(c, L).length && !(auto && AutoMaj.handled(c))).length;
}

// Ligne des langues étudiées d'une liste (écran Listes) : « KO · 12 à réviser », « IT · 40 à réviser · 25 à compléter ».
// null si la liste n'a qu'une langue (affichage d'avant l'étape 37).
function studyLangsNode(l, cards, now) {
  const ls = studyLangs(l);
  if (ls.length < 2) return null;
  const byL = dueByLang(cards, now);
  const box = el("div", "study-pills");
  ls.forEach((L, i) => {
    const gaps = studyGapCount(cards.filter(isVocab), L);
    let tx = L.toUpperCase() + " · " + t("study.langDue", { n: byL[L] || 0 });
    if (gaps) tx += " · " + t("study.langGaps", { n: gaps });
    const p = el("span", "study-pill" + (i === 0 ? " main" : "") + (gaps ? " gaps" : ""), tx);
    p.title = langName(L);
    box.appendChild(p);
  });
  return box;
}
// Langues étudiées en plus dans un dossier (méta du dossier) : « +IT ».
function studyFolderExtra(f) {
  const s = new Set();
  listsIn(f.id).forEach(l => studyExtraLangs(l).forEach(L => s.add(L)));
  return s.size ? " · +" + LANG_CODES.filter(L => s.has(L)).map(L => L.toUpperCase()).join(" +") : "";
}

// --- Fenêtre « Langues étudiées » ---
function openStudyLangs(kind, id) {
  const obj = studyScopeObj(kind, id);
  if (!obj) return;
  const lists = studyScopeLists(kind, id);
  if (kind === "folder" && !lists.length) { toast(t("folders.noLists")); return; }
  const now = Date.now();
  const wrap = el("div");
  wrap.appendChild(el("p", "muted", t("study.intro")));
  if (kind === "folder") wrap.appendChild(el("p", "hint", t("study.folderNote", { n: lists.length })));
  const shared = lists.some(isSharedList), ro = lists.some(l => !canEditList(l));
  if (ro) wrap.appendChild(el("p", "q-note", t("study.readOnly")));
  else if (shared) wrap.appendChild(el("p", "q-note", t("study.sharedNote")));

  // Langues déjà étudiées (dans au moins une liste du périmètre)
  const inUse = new Map();   // langue → { lists, main }
  lists.forEach(l => studyLangs(l).forEach((L, i) => {
    const x = inUse.get(L) || { lists: 0, main: 0 };
    x.lists++; if (i === 0) x.main++;
    inUse.set(L, x);
  }));
  const cur = el("div", "study-list");
  let close = null;
  LANG_CODES.filter(L => inUse.has(L)).forEach(L => {
    const x = inUse.get(L);
    const cards = studyVocabCards(lists, L).concat(state.cards.filter(c => !isVocab(c) && lists.some(l => l.id === c.listId) && primaryLang(c) === L));
    const row = el("div", "study-row");
    const m = el("div", "main");
    const hd = el("div", "t1", langName(L));
    if (x.main) hd.appendChild(el("span", "study-tag", t("study.main")));
    m.appendChild(hd);
    const due = cards.reduce((n, c) => n + (Leitner.dueLangs(c, now).includes(L) ? 1 : 0), 0);
    const gaps = studyGapCount(cards.filter(isVocab), L);
    let sub = t("study.langDue", { n: due }) + (gaps ? " · " + t("study.langGaps", { n: gaps }) : "");
    if (kind === "folder") sub += " · " + t("study.listsN", { n: x.lists });
    m.appendChild(el("div", "t2", sub));
    if (x.main) m.appendChild(el("div", "hint", t("study.mainHint")));
    row.appendChild(m);
    const acts = el("div", "study-acts");
    if (x.lists > x.main) {                     // langue en plus dans au moins une liste
      const bb = el("button", "link-btn", t("study.bilanBtn"));
      bb.addEventListener("click", () => { if (close) close(); openStudyBilan(kind, id, L, 0); });
      const rb = el("button", "link-btn danger", t("study.remove"));
      rb.addEventListener("click", () => { if (close) close(); confirmStudyRemove(kind, id, L); });
      acts.append(bb, rb);
    }
    row.appendChild(acts);
    cur.appendChild(row);
  });
  wrap.appendChild(formField(t("study.current"), cur));

  // Ajout : langues apprises du profil, puis les autres (ajoutées au profil)
  const notEverywhere = L => lists.some(l => !studyLangs(l).includes(L));
  const prof = learningOf().map(x => x.lang).filter(notEverywhere);
  const others = LANG_CODES.filter(L => !prof.includes(L) && !learningOf().some(x => x.lang === L) && notEverywhere(L));
  const sel = el("select", "input");
  const grp = (label, codes) => {
    if (!codes.length) return;
    const g = el("optgroup"); g.label = label;
    codes.forEach(L => { const o = el("option", null, langName(L)); o.value = L; g.appendChild(o); });
    sel.appendChild(g);
  };
  grp(t("study.fromProfile"), prof);
  grp(t("study.otherLangs"), others);
  wrap.appendChild(formField(t("study.pick"), sel, false, t("study.zeroHint")));
  close = openModal(t("study.title", { name: obj.name }), wrap, [
    { label: t("close") },
    { label: t("study.addBtn"), kind: "primary", onClick: () => { if (sel.value) studyAdd(kind, id, sel.value); } }
  ]);
}

// Ajoute la langue L aux listes du périmètre, remplit depuis le dictionnaire commun, puis affiche le bilan.
async function studyAdd(kind, id, L) {
  if (!isLang(L)) return;
  const lists = studyScopeLists(kind, id);
  const todo = lists.filter(l => !studyLangs(l).includes(L));
  if (!todo.length) { toast(t("study.already", { lang: langName(L) })); return; }
  ensureLearning(L);                                   // langue hors profil : ajoutée au profil, sans appui
  todo.forEach(l => { l.targets = studyLangs(l).concat([L]); });
  commit();
  toast(t("study.addedN", { lang: langName(L), n: todo.length }));
  // 1. Dictionnaire commun : cases déjà faites par n'importe quel compte, tout de suite (relecture forcée des sens)
  let filled = 0;
  const cards = studyVocabCards(todo, L).filter(c => canEditList(c.listId));
  if (cards.length && Dict.on()) {
    const pg = openProgress(t(kind === "folder" ? "study.addFolder" : "study.add"), t("study.filling"), []);
    const st = state;
    try {
      filled += await Dict.fillFromCommon(cards);
      if (state === st) filled += await Dict.refresh({ cards: cards.filter(c => c.senseId), force: true });
    } catch (e) {} finally { pg.close(); }
    if (state !== st) return;
    commit();
  }
  // 2. Bilan, et complétion par Claude pour ce qui manque
  openStudyBilan(kind, id, L, filled);
}

// Bilan d'une langue étudiée : cartes complètes / à compléter (mots, nature, exemples), cartes des autres types.
function openStudyBilan(kind, id, L, filled) {
  const obj = studyScopeObj(kind, id);
  if (!obj) return;
  const lists = studyScopeLists(kind, id).filter(l => studyLangs(l).includes(L));
  const cards = studyVocabCards(lists, L);
  const editable = cards.filter(c => canEditList(c.listId));
  const b = { words: 0, pos: 0, ex: 0, gaps: 0 };
  editable.forEach(c => {
    const g = studyGapFields(c, L);
    if (!g.length) return;
    b.gaps++;
    if (g.some(f => isLang(f))) b.words++;
    if (g.some(isPosField)) b.pos++;
    if (g.some(f => isExlField(f) || isExltField(f))) b.ex++;
  });
  const complete = cards.filter(c => !studyGapFields(c, L).length).length;
  const wrap = el("div");
  if (filled) wrap.appendChild(el("p", "study-ok", t("study.bilanFilled", { n: filled })));
  const row = (label, n, cls) => { const r = el("div", "study-b" + (cls ? " " + cls : "")); r.append(el("span", null, label), el("b", null, String(n))); wrap.appendChild(r); };
  row(t("study.bilanComplete", { lang: langName(L) }), complete, "ok");
  row(t("study.bilanToFill"), b.gaps, b.gaps ? "warn" : "");
  if (b.gaps) {
    row("· " + t("study.bilanWords"), b.words);
    row("· " + t("study.bilanPos"), b.pos);
    row("· " + t("study.bilanEx"), b.ex);
  }
  if (editable.length < cards.length) wrap.appendChild(el("p", "q-note", t("study.readOnly")));
  wrap.appendChild(el("p", "hint", t("study.zero", { lang: langName(L) })));
  // Autres types de cartes : ils gardent leur langue ; proposition d'en générer dans la nouvelle langue
  const typed = state.cards.filter(c => !isVocab(c) && lists.some(l => l.id === c.listId) && primaryLang(c) !== L);
  const canGen = lists.some(l => canEditList(l));
  if (canGen) wrap.appendChild(el("p", "hint", t(typed.length ? "study.genHintHas" : "study.genHint", { lang: langName(L), n: typed.length })));
  const target = lists.find(l => canEditList(l));
  const acts = [{ label: t("close") }];
  if (canGen && target) acts.push({ label: t("study.genBtn", { lang: langName(L) }), onClick: () => { openGenerate(target.id, L === studyLangs(target)[0] ? "" : L); } });
  if (b.gaps) acts.push({ label: t("study.completeBtn"), kind: "primary", onClick: () => { studyComplete(kind, id, L); } });
  else if (cards.length) wrap.appendChild(el("p", "study-ok", t("study.nothing", { lang: langName(L) })));
  openModal(t("study.bilanTitle", { lang: langName(L), name: obj.name }), wrap, acts);
}

// « Compléter avec Claude » pour la langue L : seulement les cases de L (mots, nature, exemples) — direct dans Claude,
// sinon au choix : file d'attente, copier-coller ou fichier. Tout arrive dans « À valider ».
async function studyComplete(kind, id, L) {
  const lists = studyScopeLists(kind, id).filter(l => studyLangs(l).includes(L) && canEditList(l));
  const want = c => studyGapFields(c, L);
  const cards = studyVocabCards(lists, L).filter(c => want(c).length);
  if (!cards.length) { toast(t("ai.nothingToComplete")); return; }
  await AI.ready();
  if (AI.isOn()) { await runAiJob("complete", cards, { want }); return; }
  const scope = kind + ":" + id;
  const wrap = el("div");
  wrap.appendChild(el("p", "muted", t("study.howHint", { n: cards.length, lang: langName(L) })));
  const acts = [{ label: t("cancel") }];
  if (Queue.usable()) acts.push({ label: t("study.how.queue"), kind: "primary", onClick: () => {
    queueSubmitCards("complete", cards, want, (studyScopeObj(kind, id) || {}).name + " · " + langName(L));
  } });
  acts.push({ label: t("study.how.paste"), onClick: () => {
    prepScope = { st: state, ids: new Set(cards.map(c => c.id)), want };   // réimport : seulement les cases de cette langue
    openPrepare("complete", cards);
  } });
  acts.push({ label: t("study.how.file"), onClick: () => { openFxExport(scope); } });
  openModal(t("study.completeBtn") + " — " + langName(L), wrap, acts);
}

// Retirer une langue : plus étudiée, progression gardée (cachée), mots gardés.
function confirmStudyRemove(kind, id, L) {
  const lists = studyScopeLists(kind, id).filter(l => studyExtraLangs(l).includes(L));
  if (!lists.length) return;
  openModal(t("study.removeTitle", { lang: langName(L) }), el("p", null, t("study.removeText", { lang: langName(L) })), [
    { label: t("cancel") },
    { label: t("study.remove"), kind: "danger", onClick: () => {
      lists.forEach(l => { l.targets = studyLangs(l).filter(x => x !== L); });
      commit();
      toast(t("study.removed", { lang: langName(L) }));
    } }
  ]);
}
