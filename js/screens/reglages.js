"use strict";

// === ÉCRAN : RÉGLAGES ===
function renderSettings() {
  document.querySelectorAll("#setTheme button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.value === state.settings.theme)));
  const inp = $("#setSessionSize");
  if (document.activeElement !== inp) inp.value = state.settings.sessionSize;
  const gi = $("#setDailyGoal");
  if (document.activeElement !== gi) gi.value = Streak.goal();
  $("#accountInfo").textContent = t("account.info", { id: Storage.getUser() || "" });
  $("#adminCard").hidden = !(auth.mode === "supabase" && auth.isAdmin);
  $("#appVersion").textContent = t("settings.version", { v: APP_VERSION });
  renderLangCard();         // Réglages → Langues (profil de langues, étape 35)
  renderReviewCard();       // Réglages → Rythme de révision : choix actuel, ouvre l'écran #rythme (FSRS, étape 47)
  renderAudioCard();
  if (typeof renderAudLearnCard === "function") renderAudLearnCard();   // Réglages → Apprentissage auditif (étape 55, js/auditif.js)
  renderAiCard();
  renderFriendsPrivCard();   // Réglages → Amis (étape 29)
  renderPushCard();          // Réglages → Notifications (étape 32)
  Images.renderQuota();      // Réglages → Données : « Images : X Mo sur 50 Mo » (étape 49)
  Ideas.renderCard();        // Réglages → « 💡 Proposer une idée » / « Mes idées » (étape 52, mode Supabase)
  Messages.renderTeamCard(); // Réglages → « ✉️ Écrire à l'équipe » (étape 53, mode Supabase)
}
// Carte « Rythme de révision » (étape 47, complément) : affiche le réglage actuel (ex. « Équilibré · 90 % ») et ouvre
// l'écran « Rythme de révision » (#rythme). Remplace l'ancienne carte « Révision » (saisie du taux).
function renderReviewCard() {
  const box = $("#reviewCard");
  if (!box) return;
  box.textContent = "";
  box.classList.add("fs-entry-card");
  const b = el("button", "fs-entry");
  b.type = "button";
  const txt = el("span", "fs-entry-txt");
  txt.append(el("span", "fs-entry-title", t("fsrs.rhythm")), el("span", "fs-entry-val", rhyLabel(rhyCur())));
  b.append(txt, el("span", "chev", "›"));
  b.addEventListener("click", () => { location.hash = "#" + HASH_OF.rhythm; });
  box.appendChild(b);
}
// Carte « Audio » : lecture auto, langues lues automatiquement, avertissement si une langue n'a pas de voix.
function renderAudioCard() {
  const box = $("#audioCard");
  if (!box) return;
  box.textContent = "";
  box.appendChild(el("h2", null, t("audio.title")));
  box.appendChild(audioToggle());
  const seg = el("div", "seg");
  ["target", "support", "both"].forEach(v => {
    const b = el("button", null, t("audio.langs." + v));
    b.setAttribute("aria-pressed", String(audioSettings().langs === v));
    b.addEventListener("click", () => {
      state.settings.audio = Object.assign({ auto: true }, state.settings.audio, { langs: v });
      commit();
    });
    seg.appendChild(b);
  });
  box.appendChild(formField(t("audio.langs"), seg));
  if (typeof gameSoundsToggle === "function") box.appendChild(gameSoundsToggle());   // sons des jeux (étape 42)
  const st = Speech.status();
  if (st === "none") box.appendChild(el("div", "au-warn", t("audio.noSpeech")));
  else if (st === "ready") {
    const mine = new Set([state.settings.uiLang]);   // langues du profil seulement (étape 35 : 9 langues disponibles)
    learningOf().forEach(x => { mine.add(x.lang); if (x.support) mine.add(x.support); });
    const missing = LANG_CODES.filter(c => mine.has(c) && !Speech.has(c));
    if (missing.length) box.appendChild(el("div", "au-warn", t("audio.noVoice", { langs: missing.map(c => langName(c)).join(", ") })));
  }
}
function initSettings() {
  document.querySelectorAll("#setTheme button").forEach(b => b.addEventListener("click", () => {
    state.settings.theme = b.dataset.value; commit();
  }));
  $("#setSessionSize").addEventListener("change", e => {
    state.settings.sessionSize = clampInt(e.target.value, 1, 500, 20); commit();
  });
  // Objectif du jour (5 à 100) : s'il est déjà atteint avec le nouvel objectif, le jour est validé tout de suite.
  $("#setDailyGoal").addEventListener("change", e => {
    const v = clampInt(e.target.value, 5, 100, 10);
    e.target.value = v;
    if (v === state.settings.dailyGoal) return;
    state.settings.dailyGoal = v; commit();
    Streak.tick(true);
  });
  $("#btnExport").addEventListener("click", () => exportData());
  $("#btnLogout").addEventListener("click", () => { logout(); });
  $("#btnChangePin").addEventListener("click", openChangePin);
  $("#btnAdmin").addEventListener("click", () => { location.hash = "#" + HASH_OF.admin; });
  $("#btnAboutSet").addEventListener("click", () => { location.hash = "#" + HASH_OF.about; });   // À propos (étape 39)
  $("#btnImport").addEventListener("click", openImport);
  $("#importFile").addEventListener("change", onImportFile);
}

// === ÉCRAN : RYTHME DE RÉVISION (ÉTAPE 47, COMPLÉMENT) ===
// settings.retention = taux de rétention visé par FSRS, en % (FSRS_RET : 75 à 97, 90 par défaut).
// 4 paliers à toucher (95 Intensif, 90 Équilibré recommandé, 85 Léger, 80 Minimum) + carte « Personnalisé » (curseur 75 à 97,
// pas de 1). Un seul choix mis en évidence : le palier de même valeur, sinon « Personnalisé ».
// Valeurs affichées, toutes calculées par js/fsrs.js (aucune valeur écrite en dur) :
//  - exemple : un mot prévu dans 10 jours à 90 % (stabilité 10) revient dans FSRS.intervalRaw(10, taux) jours (arrondi) ;
//  - charge : somme, sur les vues (carte, langue) déjà révisées de toutes les langues (Leitner.units, état ≠ new), de
//    1 / intervalle (FSRS.intervalRaw(s, taux), borné 1 à FSRS.MAX_IVL jours) = cartes par jour en régime stable ;
//    rapport à la charge de 90 %. Stabilités lues une fois par affichage, calcul refait en direct pendant le glissement.
// Choix enregistré tout de suite (commit + toast) : palier au toucher, curseur au lâcher. S'applique aux prochaines
// réponses seulement (les dates déjà prévues ne changent pas).
const RHY_PRESETS = [{ v: 95, k: "intense" }, { v: 90, k: "balanced", rec: true }, { v: 85, k: "light" }, { v: 80, k: "min" }];
const RHY_REF = 90;                    // référence de la charge (×1)
const RHY_WARN = { low: 80, high: 95 };   // avertissement doux sous 80 % et au-dessus de 95 %
const rhy = { drag: false, raf: 0, pend: null, ss: [], ui: null };

function rhyCur() { return clampInt(state.settings.retention, FSRS_RET.min, FSRS_RET.max, FSRS_RET.def); }
function rhyPreset(v) { return RHY_PRESETS.find(p => p.v === v) || null; }
function rhyPct(v) { return t("stats.pct", { n: v }); }
function rhyLabel(v) { const p = rhyPreset(v); return t(p ? "fsrs.p." + p.k : "fsrs.custom") + " · " + rhyPct(v); }
function rhyNum(x, dec) {
  try { return Number(x).toLocaleString(state.settings.uiLang, { maximumFractionDigits: dec || 0 }); }
  catch (e) { return String(x); }
}
// Stabilités des vues déjà révisées (toutes langues étudiées, cartes communes comprises).
function rhyStabilities() {
  const out = [];
  try {
    Leitner.units(state.cards).forEach(u => { if (u.state && u.state !== "new" && num(u.s, 0) > 0) out.push(num(u.s, 0)); });
  } catch (e) {}
  return out;
}
// Cartes par jour pour le taux v (null = aucune carte révisée). intervalRaw est proportionnel à s : un seul facteur par taux.
function rhyLoad(ss, v) {
  if (!ss.length) return null;
  const k = FSRS.intervalRaw(1, v), max = FSRS.MAX_IVL;
  let sum = 0;
  for (let i = 0; i < ss.length; i++) {
    const iv = ss[i] * k;
    sum += 1 / (iv < 1 ? 1 : iv > max ? max : iv);
  }
  return sum;
}
function rhyDays(v) { return Math.round(FSRS.intervalRaw(10, v)); }
function rhyExample(v) { return t("fsrs.example", { n: rhyNum(rhyDays(v)) }); }
// Texte de la charge : { main, ratio } ; « pas encore de données » si aucune carte n'a été révisée.
function rhyLoadText(v) {
  const L = rhyLoad(rhy.ss, v);
  if (L == null) return { main: t("fsrs.loadNone"), ratio: "" };
  const n = Math.round(L);
  const main = L < 1 ? t("fsrs.loadLess") : n === 1 ? t("fsrs.loadOne") : t("fsrs.load", { n: rhyNum(n) });
  if (v === RHY_REF) return { main, ratio: t("fsrs.ratioRef") };
  const ref = rhyLoad(rhy.ss, RHY_REF);
  return { main, ratio: ref > 0 ? t("fsrs.ratio", { x: rhyNum(Math.round(L / ref * 10) / 10, 1), ref: rhyPct(RHY_REF) }) : "" };
}
function rhyLoadLine(node, v) {
  const x = rhyLoadText(v);
  node.textContent = "";
  node.appendChild(el("span", "fs-load-n", x.main));
  if (x.ratio) node.appendChild(el("span", "fs-ratio", x.ratio));
}
function rhyWarn(v) { return v < RHY_WARN.low ? t("fsrs.warnLow") : v > RHY_WARN.high ? t("fsrs.warnHigh") : ""; }

function renderRhythm() {
  const root = $("#screen-rhythm");
  if (!root) return;
  if (rhy.drag && root.querySelector("#rhyRange")) return;   // glissement en cours : on ne redessine pas
  const hadFocus = document.activeElement && document.activeElement.id === "rhyRange";
  root.textContent = "";
  rhy.ss = rhyStabilities();
  const cur = rhyCur();

  const back = el("button", "link-btn", "‹ " + t("nav.settings"));
  back.type = "button";
  back.addEventListener("click", () => { location.hash = "#" + HASH_OF.settings; });
  root.appendChild(el("div", "lv-top")).appendChild(back);
  root.appendChild(el("h2", "fs-title", t("fsrs.rhythm")));
  root.appendChild(el("p", "fs-intro", t("fsrs.intro")));

  const ui = { opts: [], custom: null };
  const group = el("div", "fs-opts");
  group.setAttribute("role", "radiogroup");
  group.setAttribute("aria-label", t("fsrs.rhythm"));
  RHY_PRESETS.forEach(p => {
    const b = el("button", "fs-opt");
    b.type = "button";
    b.setAttribute("role", "radio");
    const hd = el("span", "fs-opt-hd");
    hd.append(el("span", "fs-rate", rhyPct(p.v)), el("span", "fs-name", t("fsrs.p." + p.k)));
    if (p.rec) hd.appendChild(el("span", "fs-badge", t("fsrs.recommended")));
    b.appendChild(hd);
    b.appendChild(el("span", "fs-desc", t("fsrs.p." + p.k + ".d")));
    b.appendChild(el("span", "fs-ex", rhyExample(p.v)));
    const ld = el("span", "fs-load");
    rhyLoadLine(ld, p.v);
    b.appendChild(ld);
    b.addEventListener("click", () => rhySave(p.v));
    group.appendChild(b);
    ui.opts.push({ v: p.v, node: b });
  });

  // Personnalisé : curseur 75 à 97, mise à jour en direct (une fois par image) pendant le glissement.
  const c = el("div", "fs-opt fs-custom");
  const chd = el("div", "fs-opt-hd");
  ui.val = el("span", "fs-rate", rhyPct(cur));
  chd.append(ui.val, el("span", "fs-name", t("fsrs.custom")));
  c.appendChild(chd);
  c.appendChild(el("div", "fs-desc", t("fsrs.custom.d")));
  const range = el("input", "fs-range");
  range.type = "range"; range.id = "rhyRange";
  range.min = String(FSRS_RET.min); range.max = String(FSRS_RET.max); range.step = "1"; range.value = String(cur);
  range.setAttribute("aria-label", t("fsrs.retention"));
  const scale = el("div", "fs-scale");
  scale.append(el("span", null, rhyPct(FSRS_RET.min)), el("span", null, rhyPct(FSRS_RET.max)));
  ui.ex = el("div", "fs-ex");
  ui.load = el("div", "fs-load");
  ui.warn = el("div", "fs-warn");
  c.append(range, scale, ui.ex, ui.load, ui.warn);
  group.appendChild(c);
  ui.custom = c; ui.range = range;
  root.appendChild(group);

  root.appendChild(el("p", "fs-note", t("fsrs.keepDates")));
  if (rhy.ss.length) root.appendChild(el("p", "fs-note", t("fsrs.loadBasis", { n: rhyNum(rhy.ss.length) })));

  rhy.ui = ui;
  const live = () => {
    rhy.pend = clampInt(range.value, FSRS_RET.min, FSRS_RET.max, FSRS_RET.def);
    if (!rhy.raf) rhy.raf = requestAnimationFrame(() => { rhy.raf = 0; rhyPaint(rhy.pend); });
  };
  range.addEventListener("pointerdown", () => { rhy.drag = true; });
  range.addEventListener("touchstart", () => { rhy.drag = true; }, { passive: true });
  range.addEventListener("input", live);
  range.addEventListener("change", () => { rhy.drag = false; rhySave(clampInt(range.value, FSRS_RET.min, FSRS_RET.max, FSRS_RET.def)); });
  rhyPaint(cur);
  if (hadFocus) range.focus();
}
// Met à jour la carte « Personnalisé » et la mise en évidence pour la valeur v (sans redessiner l'écran).
function rhyPaint(v) {
  const ui = rhy.ui;
  if (!ui || !ui.range.isConnected) return;
  ui.val.textContent = rhyPct(v);
  ui.ex.textContent = rhyExample(v);
  rhyLoadLine(ui.load, v);
  const w = rhyWarn(v);
  ui.warn.textContent = w;
  ui.warn.hidden = !w;
  const isPreset = !!rhyPreset(v);
  ui.opts.forEach(o => {
    const on = o.v === v;
    o.node.classList.toggle("on", on);
    o.node.setAttribute("aria-checked", String(on));
  });
  ui.custom.classList.toggle("on", !isPreset);
}
// Enregistre le taux v (palier touché ou curseur lâché) : tout de suite, avec un toast. Un palier replace le curseur.
function rhySave(v) {
  v = clampInt(v, FSRS_RET.min, FSRS_RET.max, FSRS_RET.def);
  if (rhy.ui && rhy.ui.range.isConnected) { rhy.ui.range.value = String(v); rhyPaint(v); }
  if (v === state.settings.retention) return;
  state.settings.retention = v;
  commit();
  toast(t("fsrs.saved"));
}
// Fin d'un glissement hors du curseur (doigt relâché ailleurs) : on peut de nouveau redessiner.
window.addEventListener("pointerup", () => { rhy.drag = false; });
window.addEventListener("pointercancel", () => { rhy.drag = false; });
window.addEventListener("touchend", () => { rhy.drag = false; }, { passive: true });

// === RÉGLAGES → LANGUES (PROFIL DE LANGUES, ÉTAPE 35) ===
// Ici (étape 52, complément) : langue de l'appli (ko / fr / en), puis langues apprises, chacune avec sa langue d'aide
// facultative et l'aperçu d'une carte. La 1re langue apprise est celle des listes et dossiers sans langue réglée.
// Retirer une langue ne supprime aucune liste : ses listes gardent leur langue (réglée sur elles si elles en héritaient).
function setLearning(L) {
  state.settings.learning = normLearning(L);
  state.settings.defaultTarget = accountTarget();   // ancien champ, gardé pour les anciennes versions
}
// Ajoute une langue au profil (sans appui) si elle n'y est pas. Renvoie true si ajoutée.
function ensureLearning(code) {
  if (!isLang(code) || learningOf().some(x => x.lang === code)) return false;
  setLearning(learningOf().concat([{ lang: code, support: null }]));
  setTimeout(() => toast(t("prof.added", { lang: langName(code) })), 50);
  return true;
}
function renderLangCard() {
  const box = $("#langCard");
  if (!box) return;
  box.textContent = "";
  // Étape 52 (complément) : mêmes noms, phrases, aperçu et « ? » qu'à la création de compte, dans le même ordre :
  // langue de l'appli (déplacée ici depuis la 1re carte), langues apprises, langue d'aide de chacune.
  box.appendChild(lxHead("h2", t("prof.title")));
  box.appendChild(lxField(t("lx.app"), lxAppSeg(code => { state.settings.uiLang = code; commit(); }), t("lx.appHint")));
  const L = learningOf();
  const tl = el("div", "field lx-field lx-tlabel");
  tl.append(el("div", "lx-lab", t("lx.target")), el("div", "hint", t("lx.targetHint")));
  box.appendChild(tl);
  L.forEach((x, i) => {
    const row = el("div", "prof-row");
    const head = el("div", "prof-head");
    const nm = el("b", null, langName(x.lang));
    nm.id = "profLang" + i;
    head.appendChild(nm);
    if (i === 0 && L.length > 1) head.appendChild(el("span", "tag", t("prof.default")));
    const rm = el("button", "link-btn", t("prof.remove"));
    rm.type = "button";
    rm.disabled = L.length < 2;
    rm.setAttribute("aria-describedby", nm.id);
    rm.addEventListener("click", () => confirmRemoveLearning(x.lang));
    head.appendChild(rm);
    row.appendChild(head);
    const sp = langSelect(x.support || "", t("prof.none"), v => {
      setLearning(learningOf().map(y => y.lang === x.lang ? { lang: y.lang, support: v || null } : y));
      commit();
    }, [x.lang]);
    row.appendChild(lxField(t("lx.help"), sp, i === 0 ? t("lx.helpHint") : null));
    const lg = langsFor(x.lang);
    row.appendChild(lxPreview(x.lang, x.support));
    if (!lg.support.length) row.appendChild(el("div", "hint", t("prof.noSupportWarn")));
    box.appendChild(row);
  });
  const add = el("button", "btn", t("prof.add"));
  add.type = "button";
  add.addEventListener("click", openProfileAdd);
  box.appendChild(add);
}
function openProfileAdd() {
  const have = learningOf().map(x => x.lang);
  const free = LANG_CODES.filter(c => !have.includes(c));
  if (!free.length) { toast(t("prof.allAdded")); return; }
  const o = { lang: free.includes(state.settings.uiLang) ? free.find(c => c !== state.settings.uiLang) || free[0] : free[0], support: null };
  const wrap = el("div");
  const draw = () => {
    wrap.textContent = "";
    wrap.appendChild(lxField(t("lx.target"), langSelect(o.lang, null, v => { o.lang = v; if (o.support === v) o.support = null; draw(); }, null, free), t("lx.targetHint")));
    wrap.appendChild(lxField(t("lx.help"), langSelect(o.support || "", t("prof.none"), v => { o.support = v || null; draw(); }, [o.lang]), t("lx.helpHint")));
    wrap.appendChild(lxPreview(o.lang, o.support));
  };
  draw();
  openModal(t("prof.add"), wrap, [
    { label: t("cancel") },
    { label: t("save"), kind: "primary", onClick: () => {
      setLearning(learningOf().concat([{ lang: o.lang, support: o.support }]));
      commit();
    } }
  ]);
}
// Retirer une langue apprise : aucune liste supprimée. Si c'est la langue par défaut (1re), les dossiers / listes qui en
// héritaient la reçoivent explicitement, pour ne pas changer de langue.
function confirmRemoveLearning(code) {
  const n = state.lists.filter(l => listLangs(l).target === code).length;
  openModal(t("prof.removeTitle", { lang: langName(code) }), el("p", null, t("prof.removeText", { n })), [
    { label: t("cancel") },
    { label: t("prof.remove"), kind: "danger", onClick: () => {
      if (accountTarget() === code) {
        state.folders.forEach(f => { if (!isLang(f.target)) f.target = code; });
        state.lists.forEach(l => { if (!isLang(l.target) && !l.folderId) l.target = code; });
      }
      setLearning(learningOf().filter(x => x.lang !== code));
      commit();
    } }
  ]);
}
