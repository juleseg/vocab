"use strict";

// === ÉCRAN : ACCUEIL ===
// Série en cours (étape 28 : objectif du jour atteint, gels compris — voir SÉRIES).
function computeStreak() { return Streak.data().current; }
function renderHome() {
  const now = Date.now();
  $("#homeDue").textContent = state.cards.filter(c => Leitner.isDue(c, now)).length;
  // Série : flamme allumée quand l'objectif du jour est atteint, record, gels disponibles
  const s = Streak.data(), done = Streak.doneToday();
  $("#homeStreak").textContent = s.current;
  const fl = $("#homeFlame");
  fl.classList.toggle("off", !done);
  fl.title = t(done ? "sk.flameOn" : "sk.flameOff");
  const sub = $("#homeStreakSub");
  sub.textContent = "";
  sub.append(el("span", null, t("sk.best", { n: s.best })), el("span", null, "❄️ " + t("sk.freezes", { n: s.freezes, m: STREAK_MAX_FREEZES })));
  // Objectif du jour : barre de progression (ex. 6 / 10)
  const g = Streak.goal(), n = Streak.reviewedOn(todayStr());
  const box = $("#homeGoal");
  box.textContent = "";
  const hd = el("div", "sk-goal-hd");
  hd.append(el("h2", null, t("sk.goalTitle")), el("span", "sk-goal-n", t("sk.goalCount", { n: Math.min(n, 9999), g })));
  const bar = el("div", "sk-bar" + (done || n >= g ? " done" : ""));
  const fill = el("span");
  fill.style.width = Math.min(100, Math.round(n * 100 / g)) + "%";
  bar.appendChild(fill);
  bar.setAttribute("role", "progressbar"); bar.setAttribute("aria-valuemin", "0"); bar.setAttribute("aria-valuemax", String(g));
  bar.setAttribute("aria-valuenow", String(Math.min(n, g)));
  const txt = done || n >= g ? t("sk.goalReached") : t("sk.goalLeft", { n: g - n });
  box.append(hd, bar, el("div", "sk-goal-txt", txt));
}
