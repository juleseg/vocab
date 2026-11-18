"use strict";

// === JEU : COURSE 60 S (ÉTAPE 42) ===
// QCM chronométré (questions de js/modes/qcm.js) : le plus de bonnes réponses en 60 s. Les cartes du périmètre
// tournent en boucle (nouvel ordre et nouveaux pièges à chaque tour). Suite automatique après chaque réponse.
// Fin à 60 s pile (setTimeout sur l'heure de départ ; réponse refusée après la fin, même pendant l'affichage).
// Record personnel par liste et par langue : settings.games.records["race:<langues>:<liste ou empreinte des listes>"].
// Record battu → animation (et son si activé).
function raceNewGame(pool, cfg) {
  const ok = pool.filter(q => mcqItem(q));                   // cartes qui ont 3 pièges dans leur liste
  if (!ok.length) return null;
  const langs = [...new Set(ok.map(q => q.lang))].sort();
  const lists = [...new Set(ok.map(q => (state.cards.find(c => c.id === q.id) || {}).listId).filter(Boolean))].sort();
  const key = "race:" + langs.join("+") + ":" + (lists.length === 1 ? lists[0] : "h" + gameHash(lists.join(",")));
  const g = { deck: ok.slice(), base: ok, cur: null, recordKey: key.slice(0, 120), all: ok, start: raceStart };
  g.recordPrev = num(gameSettings().records[g.recordKey], 0);
  return g;
}
function raceStart(g) {
  g.deadline = g.startedAt + GAME.RACE_MS;
  raceNext(g);
  g.timeout = setTimeout(() => raceTimeUp(g), GAME.RACE_MS);
  g.timer = setInterval(() => {
    if (!gameIsLive(g)) { clearInterval(g.timer); return; }
    if (Date.now() >= g.deadline) { raceTimeUp(g); return; }
    raceShowClock(g);
  }, 200);
}
function raceTimeUp(g) {
  if (!gameIsLive(g)) return;
  g.timeUp = true;
  gameFinish(g);
  gameRerender(g);
}
function raceLeft(g) { return Math.max(0, Math.ceil((g.deadline - Date.now()) / 1000)); }
function raceShowClock(g) {
  const n = document.getElementById("gmClock");
  if (!n) return;
  const s = raceLeft(g);
  n.textContent = "⏱️ " + t("gm.sec", { s });
  n.classList.toggle("gm-hurry", s <= 10);
}
// Question suivante : prochaine carte du paquet ; paquet vide → nouveau tour mélangé (pas deux fois la même de suite).
function raceNext(g) {
  for (let guard = 0; guard < 3; guard++) {
    if (!g.deck.length) {
      g.deck = shuffle(g.base.slice());
      if (g.cur && g.deck.length > 1 && g.deck[0].id === g.cur.id) g.deck.push(g.deck.shift());
    }
    while (g.deck.length) {
      const q = g.deck.shift();
      const it = sessionCard(q.id) ? mcqItem(q) : null;
      if (it) { g.cur = it; g.n = (g.n || 0) + 1; return true; }
    }
  }
  g.cur = null;
  return false;
}
function renderRaceSession(root, g) {
  if (!g.cur || !sessionCard(g.cur.id)) {
    if (!raceNext(g)) { gameFinish(g); renderGameSummary(root, g); return; }
  }
  gameHeader(root, g, "", "gmClock");
  raceShowClock(g);
  const rec = g.recordPrev ? el("div", "gm-recline", t("gm.race.best", { n: g.recordPrev })) : null;
  if (rec) root.appendChild(rec);
  mcqQuestion(root, g, g.cur, () => {
    if (!gameIsLive(g)) return;
    if (Date.now() >= g.deadline) { raceTimeUp(g); return; }
    if (!raceNext(g)) { gameFinish(g); }
    gameRerender(g);
  }, { timed: true, expired: () => Date.now() >= g.deadline });
  gameQuitLink(root, g);
}
