"use strict";

// === ÉCRAN RÉVISER : APPRENDRE / JOUER (ÉTAPE 75) ===
// Choix d'une session simplifié. Remplace l'ancien renderSessionConfig de js/screens/reviser.js (étapes 3 à 73) :
// - deux gros choix en haut : « Apprendre » (modes qui font avancer les cartes) et « Jouer » (jeux et entraînements) ;
// - une courte liste de modes par côté (RC_SIDES.main), le reste sous « Autres modes » / « Autres jeux » (RC_SIDES.more) ;
// - le Mix (étape 70) est le mode par défaut de « Apprendre » ; QCM celui de « Jouer » ;
// - un seul gros bouton « Commencer », avec le nombre de cartes ;
// - tous les réglages d'avant (périmètre, mots, langues, types, conjugaison, sens, nombre de cartes, sous-choix du mode)
//   sont sous « Plus d'options », replié par défaut. Rien n'est supprimé ; rv.cfg garde les mêmes champs et valeurs.
// Retenu sur l'APPAREIL seulement (localStorage vocabfr.ux:rv, jamais dans le compte) : dernier côté, dernier mode de
// chaque côté, « Plus d'options » ouvert ou non. Les filtres (rv.cfg) restent en mémoire : « Tout » à chaque lancement.
const RC_SIDES = {
  learn: { ic: "📖", main: ["mix", "cards", "write", "dictation"], more: ["speak", "quiz", "table"] },
  play: { ic: "🎮", main: ["mcq", "pairs", "order", "race"], more: ["gender", "minimal", "shadow"] }
};
const RC_DEF = { learn: "mix", play: "mcq" };
const RC_LS = CONFIG.LS_USER_PREFIX + "ux:rv";
const rcUi = { oth: { learn: false, play: false } };   // « Autres modes » / « Autres jeux » dépliés (mémoire seulement)

function rcSideOf(mode) { return RC_SIDES.play.main.includes(mode) || RC_SIDES.play.more.includes(mode) ? "play" : "learn"; }
function rcModes(side) { return RC_SIDES[side].main.concat(RC_SIDES[side].more); }
function rcIcon(m) {
  return m === "quiz" ? "👥" : m === "table" ? "📋" : m === "race" ? GAME_ICON.race : m === "gender" ? "♂♀"
    : (EAR_ICON[m] || MIX_ICON[m] || "");
}
function rcLs() {
  let o = null;
  try { o = JSON.parse(localStorage.getItem(RC_LS)); } catch (e) { o = null; }
  if (!o || typeof o !== "object") o = {};
  return { side: o.side === "play" ? "play" : "learn",
    learn: rcModes("learn").includes(o.learn) ? o.learn : RC_DEF.learn,
    play: rcModes("play").includes(o.play) ? o.play : RC_DEF.play,
    opts: o.opts === true };
}
function rcLsSet(patch) { try { localStorage.setItem(RC_LS, JSON.stringify(Object.assign(rcLs(), patch))); } catch (e) {} }
// Le mode existe-t-il ici ? (Dictée : affichée grisée sans voix ; ctx absent = avant de connaître le périmètre.)
function rcModeOk(m, ctx) {
  try {
    if (m === "speak") return lisCanSpeak();
    if (m === "table") return ctx ? ctx.hasTable : state.cards.some(c => cardType(c) === "conj" && hasGrammar(c.lang));
    if (m === "dictation") return ctx ? (ctx.vo.ok || ctx.vo.loading) : true;
    if (m === "gender") return genderOkAny();
    if (m === "minimal") return earMinimalAny();
    if (m === "shadow") return earShadowAny();
  } catch (e) { return false; }
  return rcModes("learn").includes(m) || rcModes("play").includes(m);
}
// Mode de départ d'un nouveau choix de session (defaultSessionCfg) : le dernier choisi sur cet appareil, sinon le Mix.
function rcDefaultMode() {
  const st = rcLs(), m = st[st.side];
  return rcModeOk(m) ? m : RC_DEF[st.side];
}
// Ouvre Réviser sur un choix précis, sans rien lancer (défis du jour). o : { mode } | { side } | { lang }.
// Pendant une session en cours : montre seulement la session.
function rcOpen(o) {
  o = o || {};
  if (!(rv.phase === "run" && rv.s)) {
    if (!rv.cfg) rv.cfg = defaultSessionCfg();
    const cfg = rv.cfg;
    if (o.mode) {
      cfg.mode = o.mode;
      // Mode demandé absent avec les réglages en cours (ex. Tableau sans conjugaison à réviser aujourd'hui) : tous les mots, puis tout le périmètre
      if (!rcModeOk(cfg.mode, rcContext(cfg))) {
        cfg.onlyDue = false;
        if (!rcModeOk(cfg.mode, rcContext(cfg))) { cfg.scope = "all"; cfg.types = []; cfg.langs = []; }
      }
    }
    else if (o.side && rcSideOf(cfg.mode) !== o.side) { const m = rcLs()[o.side]; cfg.mode = rcModeOk(m) ? m : RC_DEF[o.side]; }
    if (o.lang && isLang(o.lang)) { cfg.scope = "lang"; cfg.lang = o.lang; }
    const side = rcSideOf(cfg.mode);
    if (RC_SIDES[side].more.includes(cfg.mode)) rcUi.oth[side] = true;   // mode rangé sous « Autres… » : déplié
  }
  try { history.replaceState(null, "", "#" + HASH_OF.review); } catch (e) {}
  showScreen("review");
}
// Défi du jour → « Faire » : Réviser, avec le mode, le côté ou la langue du défi déjà choisi.
function rcChallenge(c) {
  if (!c) { rcOpen(); return; }
  if (c.k === "mode") rcOpen({ mode: c.p });
  else if (c.k === "game") rcOpen({ side: "play" });
  else if (c.k === "lang") rcOpen({ lang: c.p });
  else rcOpen();
}
// « Réviser cette liste » (écran Listes) : lance tout de suite un Mix avec les cartes à réviser de la liste ;
// s'il n'y en a pas, ouvre Réviser sur cette liste (« Rien à réviser aujourd'hui » + « Réviser tous les mots »).
function rcReviewList(listId) {
  if (!getList(listId)) return;
  if (rv.phase === "run" && rv.s) { toast(t("prg.b.busy")); rcOpen(); return; }
  rv.cfg = Object.assign(defaultSessionCfg(), { scope: "lists", listIds: [listId], onlyDue: true, mode: "mix" });
  try { history.replaceState(null, "", "#" + HASH_OF.review); } catch (e) {}
  if (sessionPool(rv.cfg).length) startSession();
  showScreen("review");
}

// --- Ce que contient le périmètre (mêmes calculs qu'avant ; nettoie aussi les choix devenus impossibles) ---
function rcContext(cfg) {
  const now = Date.now(), lgs = langsByList(), inPool = new Set();
  const base = sessionPool(cfg, "base");
  base.forEach(c => sessionLangs(c, cfg, now, lgs.get(c.listId), "base").forEach(L => inPool.add(L)));
  const poolLangs = LANG_CODES.filter(L => inPool.has(L));
  cfg.langs = arr(cfg.langs).filter(L => poolLangs.includes(L));
  const present = CARD_TYPES.filter(ty => base.some(c => cardType(c) === ty));
  cfg.types = arr(cfg.types).filter(ty => present.includes(ty));
  const conjCards = sessionPool(cfg, "types").filter(c => cardType(c) === "conj");
  if (!conjCards.length) { cfg.tenses = []; cfg.verbs = []; cfg.persons = []; }
  const vo = lisVoiceInfo(cfg.langs.length ? cfg.langs : poolLangs);
  return { now, lgs, poolLangs, present, conjCards, vo, hasTable: conjCards.some(c => hasGrammar(c.lang)) };
}
// Texte court du périmètre et des filtres en cours (ligne de résumé). on = différent du choix par défaut.
function rcNames(names, emptyKey) {
  if (!names.length) return t(emptyKey) + " : —";
  return names.length <= 2 ? names.join(", ") : names[0] + " +" + (names.length - 1);
}
function rcSummary(cfg, ctx, dirText) {
  const parts = [];
  let sc = t("scope.all");
  if (cfg.scope === "folders") sc = rcNames(cfg.folderIds.map(id => id === NO_FOLDER ? t("folders.none") : (getFolder(id) || {}).name).filter(Boolean), "scope.folders");
  else if (cfg.scope === "lists") sc = rcNames(cfg.listIds.map(id => (getList(id) || {}).name).filter(Boolean), "scope.lists");
  else if (cfg.scope === "tags") sc = rcNames(cfg.tags.map(tg => "#" + tg), "scope.tags");
  else if (cfg.scope === "cat") sc = t("cat." + cfg.cat);
  else if (cfg.scope === "lang") sc = isLang(cfg.lang) ? langName(cfg.lang) : t("scope.lang");
  else if (cfg.scope === "hard") sc = t("hd.scope.hard");
  parts.push({ text: sc, on: cfg.scope !== "all" });
  if (!isEarMode(cfg.mode) && cfg.scope !== "hard") parts.push({ text: t(cfg.onlyDue ? "which.due" : "which.all"), on: !cfg.onlyDue });
  if (dirText) parts.push({ text: dirText, on: false });
  const n = arr(cfg.langs).length + arr(cfg.types).length + arr(cfg.tenses).length + arr(cfg.verbs).length + arr(cfg.persons).length;
  if (n) parts.push({ text: t("rc.sum.filters", { n }), on: true });
  return parts;
}

// --- L'écran ---
function renderSessionConfig(root) {
  const cfg = rv.cfg;
  if (cfg.scope === "pairs") cfg.scope = "hard";   // étape 73 : « Mots qui se ressemblent » est dans « Mots difficiles »
  let ctx = rcContext(cfg);
  if (!rcModeOk(cfg.mode, ctx)) {                    // mode indisponible ici : celui par défaut de son côté
    cfg.mode = RC_DEF[rcSideOf(cfg.mode)];
    ctx = rcContext(cfg);
  }
  const side = rcSideOf(cfg.mode), st = rcLs();
  const pickMode = m => { cfg.mode = m; rcLsSet({ side: rcSideOf(m), [rcSideOf(m)]: m }); renderReview(); };

  // 1. Apprendre / Jouer, puis les modes du côté choisi
  const top = el("div", "card rc-top");
  top.id = "rcTop";
  const sides = el("div", "rc-sides");
  sides.setAttribute("role", "group");
  ["learn", "play"].forEach(sd => {
    const b = el("button", "rc-side" + (sd === side ? " on" : ""));
    b.type = "button";
    b.dataset.side = sd;
    b.setAttribute("aria-pressed", String(sd === side));
    const ic = el("span", "rc-side-ic", RC_SIDES[sd].ic);
    ic.setAttribute("aria-hidden", "true");
    b.append(ic, el("span", "rc-side-t", t("rc." + sd)), el("span", "rc-side-d", t("rc." + sd + ".d")));
    b.addEventListener("click", () => {
      if (sd === side) return;
      const m = rcLs()[sd];
      pickMode(rcModeOk(m, ctx) && (m !== "dictation" || ctx.vo.ok) ? m : RC_DEF[sd]);
    });
    sides.appendChild(b);
  });
  top.appendChild(sides);
  const modeBtn = m => {
    const b = el("button", "rc-mode");
    b.type = "button";
    b.dataset.mode = m;
    b.setAttribute("aria-pressed", String(m === cfg.mode));
    const ic = el("span", "rc-mode-ic", rcIcon(m));
    ic.setAttribute("aria-hidden", "true");
    b.append(ic, el("span", "rc-mode-t", t("mode." + m)));
    if (m === "dictation" && !ctx.vo.ok) b.disabled = true;   // aucune voix pour les langues du périmètre (comme avant)
    b.addEventListener("click", () => pickMode(m));
    return b;
  };
  const grid = el("div", "rc-modes");
  grid.setAttribute("role", "group");
  grid.setAttribute("aria-label", t("rc." + side));
  RC_SIDES[side].main.filter(m => m === "dictation" || rcModeOk(m, ctx)).forEach(m => grid.appendChild(modeBtn(m)));
  top.appendChild(grid);
  const others = RC_SIDES[side].more.filter(m => rcModeOk(m, ctx));
  if (others.length) {
    const open = rcUi.oth[side] || others.includes(cfg.mode);
    const tg = el("button", "link-btn rc-oth", (open ? "▾ " : "▸ ") + t("rc.other." + side));
    tg.type = "button";
    tg.id = "rcOther";
    tg.setAttribute("aria-expanded", String(open));
    tg.addEventListener("click", () => { rcUi.oth[side] = !open; renderReview(); });
    top.appendChild(tg);
    if (open) {
      const g2 = el("div", "rc-modes rc-modes-oth");
      g2.setAttribute("role", "group");
      g2.setAttribute("aria-label", t("rc.other." + side));
      others.forEach(m => g2.appendChild(modeBtn(m)));
      top.appendChild(g2);
    }
  }
  // Une ligne d'aide : celle du mode choisi (textes d'avant), sinon celle du côté
  const hint = (txt, cls) => top.appendChild(el("div", "hint" + (cls ? " " + cls : ""), txt));
  if (isGameMode(cfg.mode)) hint(t("rc.hint.play"));
  else if (isMixMode(cfg.mode)) hint(t("mix.hint.off"));
  else if (cfg.mode === "quiz") hint(t("rc.hint.quiz"));
  else if (cfg.mode === "table") hint(t("table.modeHint"));
  else if (cfg.mode === "gender") hint(t("gd.chipHint"), "gd-chip-hint");
  if (side === "learn" && !ctx.vo.ok) hint(t(ctx.vo.loading ? "ls.voiceLoading" : "ls.noVoice"));
  if (isListenMode(cfg.mode)) {
    hint(t(cfg.mode === "dictation" ? "ls.hint.dictation" : "ls.hint.speak"));
    if (cfg.mode === "dictation" && ctx.vo.missing.length) hint(t("ls.noVoiceSome", { langs: ctx.vo.missing.map(langName).join(", ") }));
  }
  const earAvail = isEarMode(cfg.mode) ? earConfig(top, cfg) : null;   // l'oreille et la bouche (étape 69, js/oreille.js) : aides et avertissements
  root.appendChild(top);

  // 2. Cartes de la session (périmètre + filtres + mode)
  const pool = sessionPool(cfg);
  const sesLangs = new Set();
  pool.forEach(c => {
    if (isVocab(c)) sessionLangs(c, cfg, ctx.now, ctx.lgs.get(c.listId)).forEach(L => sesLangs.add(L));
    else if (isLang(c.lang)) sesLangs.add(c.lang);
  });
  cfg.dirs = {};   // étape 73 : plus de sens par langue, cfg.dir vaut pour toutes
  const hasDir = !(isListenMode(cfg.mode) || cfg.mode === "gender" || isEarMode(cfg.mode));   // pas de sens : Dictée, Prononciation, « le / la ? », oreille et bouche
  const dl = hasDir ? dirLabels([...sesLangs]) : null;

  // 3. « Plus d'options » : tous les réglages d'avant (construits même repliés : ils nettoient aussi les choix impossibles)
  const optsOpen = st.opts;
  const opts = el("div", "card fold rc-opts" + (optsOpen ? " open" : ""));
  const oh = el("button", "fold-hd");
  oh.type = "button";
  oh.id = "rcOptsBtn";
  oh.setAttribute("aria-expanded", String(optsOpen));
  oh.setAttribute("aria-controls", "rcOpts");
  const otx = el("span", "fold-tx");
  otx.append(el("span", "fold-t", t("rc.opts")), el("span", "fold-s", t("rc.opts.d")));
  const och = el("span", "fold-chev");
  och.setAttribute("aria-hidden", "true");
  oh.append(otx, och);
  const toggleOpts = () => { rcLsSet({ opts: !optsOpen }); renderReview(); };
  oh.addEventListener("click", toggleOpts);
  const box = el("div", "fold-body");
  box.id = "rcOpts";
  box.hidden = !optsOpen;
  let paintCount = null;
  const cnt = rcOptions(box, cfg, ctx, dl, () => { if (paintCount) paintCount(); });
  opts.append(oh, box);

  // 4. Résumé des options en cours (toucher = ouvrir « Plus d'options »)
  const sum = el("button", "rc-sum");
  sum.type = "button";
  sum.id = "rcSum";
  sum.setAttribute("aria-label", t("rc.opts"));
  const limit = () => isMixMode(cfg.mode) ? mixCount(cfg) : cfg.count;
  const parts = rcSummary(cfg, ctx, dl ? (cfg.dir === "mix" ? t("dir.mix") : dl[cfg.dir] || "") : "");
  parts.forEach((p, i) => {
    if (i) sum.appendChild(document.createTextNode(" · "));
    sum.appendChild(el("span", p.on ? "rc-on" : null, p.text));
  });
  const sumN = cfg.mode === "race" || cfg.mode === "pairs" ? null : el("span", "rc-sum-n");   // Course et Paires : pas de nombre de cartes
  if (sumN) sum.append(document.createTextNode(" · "), sumN);
  sum.addEventListener("click", () => { if (!optsOpen) toggleOpts(); else { try { box.scrollIntoView({ block: "nearest" }); } catch (e) {} } });
  root.appendChild(sum);

  // 5. Rien à réviser : le dire, et proposer tous les mots
  const whichOn = !isEarMode(cfg.mode) && cfg.scope !== "hard";
  if (!pool.length && !isEarMode(cfg.mode)) {
    const none = el("div", "card rc-none");
    none.id = "rcNone";
    const canAll = whichOn && cfg.onlyDue && sessionPool(Object.assign({}, cfg, { onlyDue: false })).length > 0;
    none.appendChild(el("div", "rc-none-t", t(canAll ? "rc.none.due" : (state.cards.length ? "review.none" : "lists.empty"))));
    if (canAll) {
      const b = el("button", "btn");
      b.type = "button";
      b.id = "rcAll";
      b.textContent = t("rc.none.all");
      b.addEventListener("click", () => { cfg.onlyDue = false; renderReview(); });
      none.appendChild(b);
    }
    root.appendChild(none);
  }

  // 6. Commencer (avec le nombre de cartes)
  const start = el("button", "btn primary rc-start");
  start.type = "button";
  start.id = "rcStart";
  const startN = el("span", "rc-start-n");
  start.append(el("span", "rc-start-t", "▶ " + t("review.start")), startN);
  paintCount = () => {
    if (sumN) sumN.textContent = String(limit());
    if (earAvail) startN.textContent = earAvail;
    else if (cfg.mode === "table") startN.textContent = t("table.available", { n: pool.length, m: tableGroups(pool).length });
    else if (cfg.mode === "race" || cfg.mode === "pairs") startN.textContent = t("review.available", { n: pool.length });
    else startN.textContent = t("rc.start.n", { n: Math.min(limit(), pool.length) });
  };
  paintCount();
  start.addEventListener("click", () => {
    if (cnt) cfg.count = clampInt(cnt.value, 1, 500, state.settings.sessionSize);
    if ((cfg.scope === "lists" && !cfg.listIds.length) || (cfg.scope === "tags" && !cfg.tags.length) ||
        (cfg.scope === "folders" && !cfg.folderIds.length)) {
      toast(t("review.pickOne"));
      if (!optsOpen) toggleOpts();
      return;
    }
    if (!startSession()) toast(t("review.none"));
  });
  root.appendChild(start);
  root.appendChild(opts);
}

// --- « Plus d'options » : les réglages d'avant, dans le même ordre (code repris de l'ancien renderSessionConfig) ---
// Renvoie le champ « Nombre de cartes » (lu au moment de commencer), ou null pour un Mix (10 / 20 / 30).
function rcOptions(box, cfg, ctx, dl, onCount) {
  // Périmètre : un seul choix (pastilles)
  const sc = chipsField(
    [["all", "scope.all"], ["folders", "scope.folders"], ["lists", "scope.lists"], ["tags", "scope.tags"], ["cat", "scope.cat"], ["lang", "scope.lang"], ["hard", "hd.scope.hard"]]
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
  } else if (cfg.scope === "hard") {
    box.appendChild(el("div", "field hint", t("hd.scope.hardHint")));
  } else if (cfg.scope === "lang") {
    const langs = targetLangsInUse();
    if (langs.length && !langs.includes(cfg.lang)) cfg.lang = langs[0];
    box.appendChild(langs.length
      ? segField("scope.lang", langs.map(c => [c, ""]), cfg.lang, v => { cfg.lang = v; }, langs.map(c => langName(c)))
      : el("div", "field hint", t("lists.empty")));
  }

  if (!isEarMode(cfg.mode) && cfg.scope !== "hard")   // l'oreille et la bouche (étape 69) : tout le périmètre ; mots difficiles (étape 73) : tous
    box.appendChild(segField("review.which", [[true, "which.due"], [false, "which.all"]], cfg.onlyDue, v => { cfg.onlyDue = v; }));

  // Langues étudiées (étape 37) : plusieurs choix, aucun = toutes ; seulement s'il y en a plusieurs dans le périmètre
  if (ctx.poolLangs.length > 1) {
    const lf = chipsField(ctx.poolLangs.map(L => ({ value: L, label: langName(L) })), cfg.langs, v => toggleIn(cfg.langs, v));
    lf.insertBefore(el("label", null, t("study.reviewLangs")), lf.firstChild);
    lf.appendChild(el("div", "hint", t("study.reviewLangsHint")));
    box.appendChild(lf);
  }

  // Types de cartes (plusieurs choix, aucun = tous), seulement les types présents dans le périmètre
  if (ctx.present.length > 1) {
    const tf = chipsField(ctx.present.map(ty => ({ value: ty, label: TYPE_ICON[ty] + " " + t("type." + ty) })), cfg.types, v => toggleIn(cfg.types, v));
    tf.insertBefore(el("label", null, t("review.types")), tf.firstChild);
    tf.appendChild(el("div", "hint", t("review.typesHint")));
    box.appendChild(tf);
  }
  // Conjugaison : temps, verbes, personnes (plusieurs choix, aucun = tous)
  const conjCards = ctx.conjCards;
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
  }

  // Sens (étape 73) : ma langue → langue apprise, l'inverse, ou mélangé
  if (dl) box.appendChild(segField("review.dir", [["toT", ""], ["fromT", ""], ["mix", "dir.mix"]], cfg.dir, v => { cfg.dir = v; }, [dl.toT, dl.fromT, t("dir.mix")]));

  // Nombre de cartes (Mix : 10, 20 ou 30)
  let cnt = null;
  if (isMixMode(cfg.mode)) {
    const mf = mixCountField(cfg);
    mf.appendChild(el("div", "hint", t("mix.hint.on", { modes: mixModeNames(ctx.poolLangs), n: MIX_PAIRS })));
    box.appendChild(mf);
  } else {
    cnt = el("input");
    cnt.type = "number"; cnt.min = "1"; cnt.max = "500"; cnt.inputMode = "numeric"; cnt.value = cfg.count;
    cnt.id = "rcCount";
    cnt.addEventListener("change", () => { cfg.count = clampInt(cnt.value, 1, 500, state.settings.sessionSize); cnt.value = cfg.count; onCount(); });
    box.appendChild(formField(t("review.count"), cnt));
  }

  // Sous-choix du mode
  if (isListenMode(cfg.mode))
    box.appendChild(segField("ls.kind", [["words", "ls.kind.words"], ["sents", "ls.kind.sents"], ["both", "ls.kind.both"]],
      cfg.listenKind || "both", v => { cfg.listenKind = v; }));
  if (cfg.mode === "gender")
    box.appendChild(segField("gd.art", [["def", "gd.art.def"], ["indef", "gd.art.indef"], ["mix", "gd.art.mix"]], cfg.genderArt || "mix", v => { cfg.genderArt = v; }));
  if (cfg.mode === "order")
    box.appendChild(segField("gm.order.kind", [["words", "gm.order.words"], ["sents", "gm.order.sents"], ["both", "gm.order.both"]],
      cfg.orderKind || "both", v => { cfg.orderKind = v; }));
  return cnt;
}
