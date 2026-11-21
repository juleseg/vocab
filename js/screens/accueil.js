"use strict";

// === ÉCRAN : ACCUEIL ===
// Série en cours (étape 28 : objectif du jour atteint, gels compris — voir SÉRIES).
// Étape 43 : niveau et XP (#homeXp), défis du jour (#homeChallenges), dessinés par renderHomeXp (js/xp.js).
// Étape 61 : boutons « ☀️ Rappel du matin » et « ⚡ 2 minutes » (#homeQuick), dessinés par renderMomentsHome (js/moments.js).
// Étape 64 : carte « 🌱 Mots appris cette semaine » (#homeLearned) et rappel du lundi du bilan d'oubli (#homeBilanMon),
//            dessinés par renderProgresHome (js/progres.js).
// Étape 67 : en haut « À réviser » (touche = Réviser), série et objectif du jour (visibles) ; puis 4 raccourcis (#homeShort) ;
//            « Mots appris », « XP et niveau » et « Défis du jour » en cartes repliables (data-fold, js/ecrans.js).
// Étape 75 : Accueil simplifié (index.html) : « À réviser » avec le bouton « Réviser maintenant » ; série et objectif du jour
//            dans une seule carte (#homeDay ; record et gels dans Stats → Mes progrès) ; un seul bouton rapide ; 2 raccourcis au
//            plus ; « Mots appris », « XP et niveau » et « Défis du jour » dans UNE carte repliable « Mes progrès » (#homeProg).
// Étape 74 : bandeau « 🔔 Active les notifications » (#homeNotifRappel), dessiné par NotifRappel.home (js/rappel-notifs.js).
function computeStreak() { return Streak.data().current; }
function renderHome() {
  const now = Date.now();
  $("#homeDue").textContent = dueCount(state.cards, now);
  renderMomentsHome();   // rappel du matin et micro-session « 2 minutes » (étape 61, js/moments.js)
  if (typeof NotifRappel !== "undefined") NotifRappel.home();   // étape 74 : rappel d'activer les notifications
  // À réviser par langue étudiée (étape 37), s'il y en a plusieurs
  const byL = dueByLang(state.cards, now), dl = $("#homeDueLangs");
  if (dl) {
    const ls = LANG_CODES.filter(L => byL[L]);
    dl.textContent = ls.length > 1 ? ls.map(L => t("study.langDueShort", { l: L.toUpperCase(), n: byL[L] })).join(" · ") : "";
    dl.hidden = ls.length < 2;
  }
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
  renderProgresHome();   // mots appris cette semaine, rappel du lundi (étape 64, js/progres.js)
  renderHomeXp();   // niveau, XP et défis du jour (étape 43, js/xp.js)
  if (typeof Ecr !== "undefined") Ecr.home();   // étape 67 : raccourcis et cartes repliables (js/ecrans.js)
}
