"use strict";

// === ÉCRAN : RÉGLAGES ===
function renderSettings() {
  document.querySelectorAll("#setLang button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.value === state.settings.uiLang)));
  document.querySelectorAll("#setTheme button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.value === state.settings.theme)));
  const inp = $("#setSessionSize");
  if (document.activeElement !== inp) inp.value = state.settings.sessionSize;
  const gi = $("#setDailyGoal");
  if (document.activeElement !== gi) gi.value = Streak.goal();
  $("#accountInfo").textContent = t("account.info", { id: Storage.getUser() || "" });
  $("#adminCard").hidden = !(auth.mode === "supabase" && auth.isAdmin);
  $("#appVersion").textContent = t("settings.version", { v: APP_VERSION });
  renderLangCard();         // Réglages → Langues (profil de langues, étape 35)
  renderAudioCard();
  renderAiCard();
  renderFriendsPrivCard();   // Réglages → Amis (étape 29)
  renderPushCard();          // Réglages → Notifications (étape 32)
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
  document.querySelectorAll("#setLang button").forEach(b => b.addEventListener("click", () => {
    state.settings.uiLang = b.dataset.value; commit();
  }));
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

// === RÉGLAGES → LANGUES (PROFIL DE LANGUES, ÉTAPE 35) ===
// Langue de l'interface : en haut des Réglages (ko / fr / en). Ici : langues apprises, chacune avec sa langue d'appui
// facultative. La 1re langue est celle des listes et dossiers sans langue réglée.
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
  box.appendChild(el("h2", null, t("prof.title")));
  box.appendChild(el("p", "muted prof-help", t("prof.help", { ui: langName(state.settings.uiLang) })));
  const L = learningOf();
  L.forEach((x, i) => {
    const row = el("div", "prof-row");
    const head = el("div", "prof-head");
    head.appendChild(el("b", null, langName(x.lang)));
    if (i === 0 && L.length > 1) head.appendChild(el("span", "tag", t("prof.default")));
    const rm = el("button", "link-btn", t("prof.remove"));
    rm.type = "button";
    rm.disabled = L.length < 2;
    rm.addEventListener("click", () => confirmRemoveLearning(x.lang));
    head.appendChild(rm);
    row.appendChild(head);
    const sp = langSelect(x.support || "", t("prof.none"), v => {
      setLearning(learningOf().map(y => y.lang === x.lang ? { lang: y.lang, support: v || null } : y));
      commit();
    }, [x.lang]);
    row.appendChild(formField(t("prof.support"), sp));
    const lg = langsFor(x.lang);
    row.appendChild(el("div", "muted prof-shown", t("prof.shown") + " : " + visibleLangs(lg).map(c => langName(c)).join(" · ")));
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
    wrap.appendChild(formField(t("langs.target"), langSelect(o.lang, null, v => { o.lang = v; if (o.support === v) o.support = null; draw(); }, null, free)));
    wrap.appendChild(formField(t("prof.support"), langSelect(o.support || "", t("prof.none"), v => { o.support = v || null; draw(); }, [o.lang]), false, t("prof.supportHint")));
    wrap.appendChild(el("div", "muted", t("prof.shown") + " : " + visibleLangs({ target: o.lang, support: supportLangs(o.lang, null, o.support) }).map(c => langName(c)).join(" · ")));
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
