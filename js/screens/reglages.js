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
  const lg = accountLangs();
  $("#defaultLangs").textContent = t("langs.defaultInfo", { target: langName(lg.target), support: lg.support.map(x => langName(x)).join(", ") });
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
  const st = Speech.status();
  if (st === "none") box.appendChild(el("div", "au-warn", t("audio.noSpeech")));
  else if (st === "ready") {
    const missing = LANG_CODES.filter(c => !Speech.has(c));
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
  $("#btnDefaultLangs").addEventListener("click", () => openLangEditor("account", state.settings));
  $("#btnExport").addEventListener("click", () => exportData());
  $("#btnLogout").addEventListener("click", () => { logout(); });
  $("#btnChangePin").addEventListener("click", openChangePin);
  $("#btnAdmin").addEventListener("click", () => { location.hash = "#" + HASH_OF.admin; });
  $("#btnImport").addEventListener("click", openImport);
  $("#importFile").addEventListener("change", onImportFile);
}
