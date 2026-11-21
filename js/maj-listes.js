"use strict";

// ====================================================================================================
// js/maj-listes.js — MISE À JOUR DES LISTES (4e morceau de l'ancien js/completion.js, étape 65)
// « Mettre à jour » une liste, un dossier ou tout ; commitQuiet. Chargé juste après js/generer.js, avant js/queue.js.
// ====================================================================================================

// === MISE À JOUR DES LISTES ===
// « Mettre à jour » une liste, un dossier ou tout (scope = { kind: "list"|"folder"|"all", id }).
// 1. Analyse : rien n'est modifié, bilan par catégorie avec le nombre de cartes concernées.
// 2. Cases à cocher, puis « Lancer » : complétion / vérification existantes (lots de 20, Pause, reprise depuis
//    les Réglages), toutes les propositions vont dans « À valider », ouvert filtré sur la liste ou le dossier.
// Catégories : "tr:<code>" (traduction manquante), "pos" (nature manquante + noms sans genre), "example",
//   "pending" (propositions en attente ou champs « auto »), "verify" (cartes jamais vérifiées ou modifiées depuis),
//   "dup" (doublons), "legacy" (cartes à l'ancien format, normalement aucune : migration au lancement).
// Badge « N à compléter » (listes et dossiers) = cartes avec un champ vide ou un nom sans genre, recalculé à chaque affichage
// (étape 80 : sans les cartes que la mise à jour automatique prend en charge).

// Trous d'une carte : champs vides (langues d'appui, exemple, natures) + noms sans genre.
function gapFields(c, lg) {
  lg = lg || cardLangs(c);
  return fillFields(c, lg).filter(f => !fieldVal(c, f, lg).trim()).concat(genderFields(c, lg));
}
// Étape 80 : une carte prise en charge par la mise à jour automatique (demande en cours ou à déposer, js/auto-maj.js) ne
// compte pas : le badge ne montre que ce que Claude n'a pas pu compléter (ou tout, si l'automatisme est coupé).
function listGapCount(l) {
  if (!canEditList(l)) return 0;
  const lg = listLangs(l), auto = typeof AutoMaj !== "undefined" && AutoMaj.active();
  return cardsOf(l.id).filter(c => { const g = gapFields(c, lg); return g.length && !(auto && AutoMaj.handled(c, g)); }).length;
}
// Cartes d'une liste que Claude est en train de compléter tout seul (étape 80).
function listAutoCount(l) {
  if (!canEditList(l) || typeof AutoMaj === "undefined" || !AutoMaj.active()) return 0;
  const lg = listLangs(l);
  return cardsOf(l.id).filter(c => { const g = gapFields(c, lg); return g.length && AutoMaj.handled(c, g); }).length;
}
function folderGapCount(f) { return listsIn(f.id).reduce((n, l) => n + listGapCount(l), 0); }
function updBadge(n) { return n ? el("span", "upd-badge", t("upd.badge", { n })) : null; }
function updDate(ts) {
  if (!ts) return t("upd.never");
  try { return t("upd.last", { d: new Date(ts).toLocaleDateString(state.settings.uiLang) }); } catch (e) { return t("upd.never"); }
}

// Mise à jour (traductions, nature, exemple, vérification, doublons) : cartes de vocabulaire seulement.
function updScopeCards(scope) {
  const ok = c => isVocab(c) && canEditList(c.listId);   // listes communes en lecture seule exclues (étape 30)
  if (scope.kind === "list") return getList(scope.id) ? cardsOf(scope.id).filter(ok) : [];
  if (scope.kind === "folder") { const f = getFolder(scope.id); return f ? cardsUnder("folder", f).filter(ok) : []; }
  return state.cards.filter(ok);
}
function updScopeObj(scope) { return scope.kind === "list" ? getList(scope.id) : scope.kind === "folder" ? getFolder(scope.id) : null; }
// Ancien format (la migration v1 → v2 est faite au lancement : normalement aucune).
function isLegacyCard(c) { return !c.terms || typeof c.terms !== "object" || !c.pos || typeof c.pos !== "object" || !Array.isArray(c.auto); }

// Analyse sans rien modifier.
function analyzeUpdate(cards) {
  const lgs = new Map();
  const L = c => { let x = lgs.get(c.listId); if (!x) { x = cardLangs(c); lgs.set(c.listId, x); } return x; };
  const pend = new Set(state.proposals.map(p => p.cardId));
  const a = { total: cards.length, tr: {}, pos: 0, gender: 0, genderLangs: new Set(), example: 0, pending: 0, verify: 0, dup: 0, legacy: 0, study: {} };
  cards.forEach(c => {
    if (isLegacyCard(c)) { a.legacy++; return; }
    const lg = L(c);
    studyExtraLangs(c.listId).forEach(x => { if (!(x in a.study)) a.study[x] = 0; if (studyGapFields(c, x).length) a.study[x]++; });   // étape 37
    lg.support.forEach(code => { if (!(code in a.tr)) a.tr[code] = 0; if (!term(c, code).trim()) a.tr[code]++; });
    const g = genderFields(c, lg);
    g.forEach(f => a.genderLangs.add(f.slice(4)));
    if (g.length || posFields(lg).some(f => !fieldVal(c, f).trim())) a.pos++;
    if (g.length) a.gender++;
    if (exFields(lg).some(f => !fieldVal(c, f, lg).trim())) a.example++;   // exemple ou une de ses traductions (étape 35)
    if (pend.has(c.id) || ClAuto.legacyAuto(c).length) a.pending++;   // étape 73 : les cases de Claude (« cl: ») ne sont plus « à valider »
    if (state.checkedSig[c.id] !== cardSig(c)) a.verify++;
  });
  dupGroups(cards).forEach(g => { if (g.length > 1) a.dup += g.length - 1; });
  return a;
}

// Champs demandés à Claude pour une carte, selon les catégories cochées.
function updWant(cats) {
  return c => {
    const lg = cardLangs(c), out = [];
    lg.support.forEach(code => { if (cats.includes("tr:" + code) && !term(c, code).trim()) out.push(code); });
    if (cats.includes("example")) exFields(lg).forEach(f => { if (!fieldVal(c, f, lg).trim()) out.push(f); });
    if (cats.includes("pos")) posFields(lg).forEach(f => { if (!fieldVal(c, f).trim() || posNeedsGender(c, f.slice(4))) out.push(f); });
    studyExtraLangs(c.listId).forEach(x => { if (cats.includes("study:" + x)) studyGapFields(c, x).forEach(f => { if (!out.includes(f)) out.push(f); }); });   // étape 37
    return out;
  };
}

// Reprise (Réglages) d'une complétion mise en pause pendant une mise à jour : mêmes catégories.
// Gardé sur cet appareil (localStorage), à côté de state.aiResume.
function updResumeKey() { return CONFIG.LS_USER_PREFIX + "updResume:" + (Storage.getUser() || ""); }
function updResumeCats() {
  try { const r = JSON.parse(localStorage.getItem(updResumeKey()) || "null"); return state.aiResume && r && Array.isArray(r.cats) ? r.cats : null; }
  catch (e) { return null; }
}
function updResumeSync(cats) {
  try {
    if (state.aiResume && cats) localStorage.setItem(updResumeKey(), JSON.stringify({ cats }));
    else localStorage.removeItem(updResumeKey());
  } catch (e) {}
}

// Repli « Préparer pour Claude » : à la réimportation, seuls les champs des catégories cochées sont proposés.
let prepScope = null; // { st, ids: Set, want }
function prepWantFor(c) { return prepScope && prepScope.st === state && prepScope.ids.has(c.id) ? prepScope.want(c) : null; }

// Ouvre « À valider » filtré sur la liste ou le dossier.
function goPendingFor(scope) {
  // Étape 73 : rien à valider pour cette liste → la liste elle-même (les réponses de Claude y sont déjà appliquées).
  if (scope.kind === "list" && getList(scope.id) && !liveProposals().some(p => pvListOf(p, new Map(state.cards.map(c => [c.id, c]))) === scope.id)) {
    try { history.replaceState(null, "", "#" + HASH_OF.lists); } catch (e) {}
    showScreen("lists"); openListView(scope.id); return;
  }
  pvReset();
  if (scope.kind === "list" && getList(scope.id)) { pv.list = scope.id; pv.folder = pvFolderOf(scope.id); }
  else if (scope.kind === "folder" && getFolder(scope.id)) pv.folder = scope.id;
  goPending();
}

async function openUpdate(scope) {
  if (aiJob) { toast(t("ai.busy")); return; }
  const obj = updScopeObj(scope);
  if (scope.kind !== "all" && !obj) return;
  const cards = updScopeCards(scope);
  if (!cards.length) { toast(t("ai.noCards")); return; }
  await AI.ready();
  await Dict.fillFromCommon(cards);   // dictionnaire commun d'abord (étape 36) : le bilan ne compte que ce qui manque encore
  const a = analyzeUpdate(cards);
  const checked = new Set();
  const wrap = el("div");
  wrap.appendChild(el("p", "muted upd-intro", t("upd.intro", { n: a.total })));
  const row = (cat, label, n, hint, on) => {
    const r = el("label", "upd-row" + (n ? "" : " off"));
    const cb = el("input"); cb.type = "checkbox"; cb.disabled = !n; cb.checked = !!n && on;
    if (cb.checked) checked.add(cat);
    cb.addEventListener("change", () => { if (cb.checked) checked.add(cat); else checked.delete(cat); });
    const l = el("div", "upd-l");
    l.appendChild(el("div", null, label));
    if (hint) l.appendChild(el("div", "upd-h", hint));
    r.append(cb, l, el("span", "upd-n", n ? t(n === 1 ? "upd.card1" : "upd.cards", { n }) : "✓"));
    wrap.appendChild(r);
  };
  LANG_CODES.filter(code => code in a.tr).forEach(code => row("tr:" + code, t("upd.cat.tr", { lang: langName(code) }), a.tr[code], "", true));
  row("pos", t("upd.cat.pos"), a.pos, a.gender ? t("upd.cat.gender", { n: a.gender, langs: [...a.genderLangs].map(x => langName(x)).join(", ") }) : "", true);
  row("example", t("upd.cat.example"), a.example, "", true);
  LANG_CODES.filter(x => x in a.study).forEach(x => row("study:" + x, t("study.updCat", { lang: langName(x) }), a.study[x], t("study.updCatHint"), true));   // étape 37
  row("pending", t("upd.cat.pending"), a.pending, t("upd.cat.pendingHint"), true);
  const calls = Math.ceil(a.verify / CONFIG.AI_BATCH);
  row("verify", t("upd.cat.verify"), a.verify, t("upd.cat.verifyHint") + (AI.isOn() && calls ? " · " + t("upd.calls", { b: calls }) : ""), false);
  row("dup", t("upd.cat.dup"), a.dup, "", true);
  if (a.legacy) row("legacy", t("upd.cat.legacy"), a.legacy, "", true);
  else wrap.appendChild(el("div", "upd-last", t("upd.formatOk")));
  if (obj) wrap.appendChild(el("div", "upd-last", updDate(obj.lastUpdate)));
  const name = scope.kind === "all" ? t("upd.allName") : obj.name;
  // Échange par fichier avec Claude (même périmètre)
  let closeUpd = null;
  const fxl = el("div", "lv-links fx-links");
  const lo = el("button", "link-btn", t("fx.exportBtn")), li = el("button", "link-btn", t("ai.importReply"));
  lo.type = li.type = "button";
  lo.addEventListener("click", () => { if (closeUpd) closeUpd(); openFxExport(scope.kind === "all" ? "all" : scope.kind + ":" + scope.id); });
  li.addEventListener("click", () => { if (closeUpd) closeUpd(); openFxImport(); });
  fxl.append(lo, li);
  wrap.appendChild(fxl);
  closeUpd = openModal(t("upd.title", { name }), wrap, [
    { label: t("cancel") },
    { label: t("upd.launch"), kind: "primary", onClick: () => {
      if (!checked.size) { toast(t("upd.pickOne")); return false; }
      runUpdate(scope, [...checked]);
    } }
  ]);
}

async function runUpdate(scope, cats) {
  if (aiJob) { toast(t("ai.busy")); return; }
  const st = state;
  const cards = updScopeCards(scope);
  const now = Date.now();
  const stamp = x => { if (x) x.lastUpdate = now; };
  if (scope.kind === "list") stamp(getList(scope.id));
  else if (scope.kind === "folder") { stamp(getFolder(scope.id)); listsIn(scope.id).forEach(stamp); }
  else { state.folders.forEach(stamp); state.lists.forEach(stamp); }
  let added = 0, legacy = 0;
  const kept0 = ClAuto.kept();   // étape 73 : cases de l'utilisateur gardées (message de fin)
  if (cats.includes("legacy")) cards.forEach(c => { if (isLegacyCard(c)) { Object.assign(c, normalizeCard(c)); legacy++; } });
  if (cats.includes("dup")) added += addDuplicateProposals(cards);
  commit();
  const want = updWant(cats);
  const fillCards = cards.filter(c => !isLegacyCard(c) && want(c).length);
  const verifyCards = cats.includes("verify") ? cards.filter(c => state.checkedSig[c.id] !== cardSig(c)) : [];
  const seePending = cats.includes("pending");
  await AI.ready();
  if (state !== st) return;

  // Sans accès direct à Claude : textes à copier (vérification dessous, complétion au-dessus).
  if (!AI.isOn() && (fillCards.length || verifyCards.length)) {
    if (added || legacy) toast(t("ai.autoDone", { n: added }));
    if (verifyCards.length) openPrepare("verify", verifyCards);
    if (fillCards.length) { prepScope = { st: state, ids: new Set(fillCards.map(c => c.id)), want }; openPrepare("complete", fillCards); }
    return;
  }

  let error = null, stopped = false;
  if (fillCards.length) {
    const r = await runAiJob("complete", fillCards, { want, noEndModal: true, resumeCats: cats });
    if (!r || state !== st) return;
    added += r.added; error = r.error; stopped = r.stopped;
    if (r.interrupted) return;   // bandeau « Reprendre / Abandonner »
  }
  if (verifyCards.length && !error && !stopped) {
    const r = await runAiJob("verify", verifyCards, { noEndModal: true });
    if (!r || state !== st) return;
    added += r.added; error = r.error; stopped = r.stopped;
  }
  if (!fillCards.length && !verifyCards.length && !added && !legacy && seePending) { goPendingFor(scope); return; }

  let msg = error ? aiErrorText(error) : stopped ? t(fillCards.length ? "ai.paused" : "ai.stopped", { n: added }) : added ? t("ai.done", { n: added }) : t("ai.doneNone");
  if (error && added) msg += " " + t("ai.done", { n: added });
  if (error && state.aiResume && fillCards.length) msg += " " + t("ai.resumeLater");
  if (ClAuto.kept() > kept0) msg += " " + t("cl.kept", { n: ClAuto.kept() - kept0 });
  if (legacy) msg += " " + t("upd.legacyDone", { n: legacy });
  const actions = [{ label: t("close") }];
  if (added || seePending) actions.push({ label: t("ai.see"), kind: "primary", onClick: () => { goPendingFor(scope); } });
  openModal(t("ai.doneTitle"), el("p", null, msg), actions);
}
