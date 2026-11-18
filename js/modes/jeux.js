"use strict";

// === JEUX D'ENTRAÎNEMENT (ÉTAPE 42) : PARTIE COMMUNE ===
// Modes du choix d'une session : "mcq" (QCM, js/modes/qcm.js), "race" (Course 60 s, course.js), "pairs" (Paires,
// paires.js), "order" (Remettre en ordre, ordre.js). Même périmètre que les autres modes ; cartes vocab seulement
// (sessionPool écarte les autres types). Une carte = une langue étudiée (comme les autres modes, étape 37).
// Partie en cours : rv.s.game (rv.phase = "run", rv.s.mode = le jeu). L'affichage est refait à partir de cet état :
// un render() pendant la partie (synchro, voix prêtes…) ne perd rien.
// Progression (poids réduit, Leitner.gradeGame) : bonne réponse = pas de montée de boîte ni de changement de date,
// stats vu / juste ; mauvaise = comme « À revoir ». Les révisions comptent pour l'objectif du jour et la série.
// Réglages : state.settings.games = { sounds (désactivé par défaut), records { clé: score } } (normGames, storage.js).
// Journal : événement "game" (jeu, score, total, erreurs, durée, nombre de cartes, langues) à la fin de la partie.
const GAME_MODES = ["mcq", "race", "pairs", "order"];
const GAME_ICON = { mcq: "🔘", race: "⏱️", pairs: "🧩", order: "🔀" };
const GAME = { RACE_MS: 60000, PAIRS_MIN: 6, PAIRS_MAX: 8, MCQ_MIN: 4, OK_MS: 700, BAD_MS: 1100, ORDER_MAX_TILES: 16, SENT_MIN: 3, SENT_MAX: 12 };
function isGameMode(m) { return GAME_MODES.includes(m); }

// Langues affichées d'une carte posée dans la langue L (langue de la liste, ou langue étudiée en plus).
function gameLg(c, L) {
  const lg = listLangs(c.listId);
  return (!L || L === lg.target) ? lg : studyLg(L);
}
function gameSettings() {
  if (!state.settings.games || typeof state.settings.games !== "object") state.settings.games = normGames(null);
  return state.settings.games;
}

// --- Cartes de la partie : même périmètre que la session, une langue et un sens par carte ---
function gamePool(cfg) {
  const now = Date.now(), lgs = langsByList();
  return shuffle(sessionPool(cfg).filter(c => isVocab(c))).map(c => {
    const ls = sessionLangs(c, cfg, now, lgs.get(c.listId));
    const lang = ls[Math.floor(Math.random() * ls.length)] || primaryLang(c);
    const d = (cfg.dirs && cfg.dirs[lang]) || cfg.dir;
    return { id: c.id, lang, dir: d === "mix" ? (Math.random() < 0.5 ? "toT" : "fromT") : d };
  });
}

// --- Lancement ---
// Renvoie true si la partie démarre ou si un message « pas assez de cartes » a été affiché ; false = aucune carte.
function startGame(cfg) {
  const pool = gamePool(cfg);
  if (!pool.length) return false;
  const mode = cfg.mode;
  let g = null;
  if (mode === "mcq") g = mcqNewGame(pool, cfg);
  else if (mode === "race") g = raceNewGame(pool, cfg);
  else if (mode === "pairs") g = pairsNewGame(pool, cfg);
  else if (mode === "order") g = orderNewGame(pool, cfg);
  if (!g) { gameNeedMsg(mode); return true; }
  g.mode = mode;
  g.startedAt = Date.now();
  g.ok = 0; g.bad = 0; g.done = false;
  g.missed = [];             // ids ratés (une fois chacun), pour « Revoir les erreurs »
  g.meta = {};               // id → { lang, dir }
  g.cardIds = [];            // cartes jouées (une fois chacune)
  const langs = {};
  g.all.forEach(q => { langs[q.id] = q.lang; g.meta[q.id] = { lang: q.lang, dir: q.dir }; });
  rv.s = { queue: [], mode, revealed: false, counts: { known: 0, review: 0, unknown: 0 }, log: [], first: {}, dirs: {}, langs,
    startedAt: g.startedAt, game: g };
  setSessionLangs(langs);
  rv.phase = "run";
  if (g.start) g.start(g);
  renderReview();
  window.scrollTo(0, 0);
  return true;
}
function gameNeedMsg(mode) {
  openModal(t("gm.need.title"), el("p", null, t("gm.need." + mode)), [{ label: t("ann.ok"), kind: "primary" }]);
}
// Affichage de la partie en cours (appelé par renderReview).
function renderGameSession(root) {
  const g = rv.s && rv.s.game;
  if (!g) { endSession(); return; }
  if (g.done) { renderGameSummary(root, g); return; }
  if (g.mode === "mcq") renderMcqSession(root, g);
  else if (g.mode === "race") renderRaceSession(root, g);
  else if (g.mode === "pairs") renderPairsSession(root, g);
  else renderOrderSession(root, g);
}
// Réaffiche seulement si la partie est toujours celle à l'écran.
function gameRerender(g) {
  if (rv.s && rv.s.game === g && currentScreen === "review") renderReview();
}
function gameIsLive(g) { return !!(rv.s && rv.s.game === g && !g.done); }

// --- Notation (poids réduit) ---
// Une réponse dans un jeu : met à jour la carte, compte la réponse, garde les ratés. Enregistre sans tout réafficher.
function gameGrade(g, id, ok) {
  const c = state.cards.find(x => x.id === id);
  if (!c) return;
  const m = g.meta[id] || {};
  Leitner.gradeGame(c, ok, undefined, m.lang);
  if (ok) g.ok++; else { g.bad++; if (!g.missed.includes(id)) g.missed.push(id); }
  if (!g.cardIds.includes(id)) g.cardIds.push(id);
  if (!(id in rv.s.first)) rv.s.first[id] = ok ? "known" : "review";
  commitQuiet();
}

// --- Fin de partie ---
function gameFinish(g) {
  if (!g || g.done) return;
  g.done = true;
  g.endedAt = Date.now();
  if (g.timer) { clearInterval(g.timer); g.timer = null; }
  if (g.timeout) { clearTimeout(g.timeout); g.timeout = null; }
  if (g.mode === "race") g.endedAt = Math.min(g.endedAt, g.startedAt + GAME.RACE_MS);
  g.seconds = Math.max(0, Math.round((g.endedAt - g.startedAt) / 1000));
  if (g.recordKey) {                                         // record personnel (Course 60 s)
    const gs = gameSettings();
    g.recordPrev = num(gs.records[g.recordKey], 0);
    if (g.ok > g.recordPrev) { gs.records[g.recordKey] = g.ok; g.newRecord = true; }
    g.record = Math.max(g.recordPrev, g.ok);
  }
  if (g.cardIds.length) {
    const langs = [...new Set(g.cardIds.map(id => (g.meta[id] || {}).lang).filter(Boolean))];
    try {
      const byList = {};   // étape 43 : ids des listes jouées (classement « listes les plus révisées » du tableau de bord admin)
      g.cardIds.forEach(id => { const c = state.cards.find(x => x.id === id); if (c) byList[c.listId] = (byList[c.listId] || 0) + 1; });
      const keep = Object.keys(byList).slice(0, 30), bl = {};
      keep.forEach(k => { bl[k] = byList[k]; });
      Activity.log("game", {
        game: g.mode, score: g.ok, total: g.ok + g.bad, errors: g.errors != null ? g.errors : g.bad, seconds: g.seconds,
        cards: g.cardIds.length, hints: g.hints || 0, record: g.newRecord ? 1 : 0,
        lang: langs.join(","), by_list: bl
      });
    } catch (e) {}
    try {   // XP de partie, défis, badges (étape 43) : sans-faute = aucune erreur, 10 cartes ou plus
      XP.onSessionEnd(rv.s && rv.s.game === g ? rv.s : g, { mode: g.mode, game: true, cards: g.cardIds.length, answers: g.ok + g.bad,
        perfect: g.bad === 0 && !(g.errors > 0), record: !!g.newRecord && g.mode === "race", lang: langs.length === 1 ? langs[0] : null });
    } catch (e) {}
    Friends.publish();             // résumé public pour mes amis (étape 29)
    Shared.publishProgress();      // progression sur les listes communes (étape 30)
    UserStatus.publish();          // résumé pour les notifications (étape 32)
  }
  commitQuiet();
  Storage.flushNow();              // synchro en ligne après chaque partie
  GameSound.play(g.newRecord ? "record" : "end");
  if (g.newRecord && g.recordPrev > 0) setTimeout(() => gamePop("🏆", t("gm.record.pop", { n: g.ok })), 200);
}
function gameQuit(g) {
  if (!g.cardIds.length) { gameFinish(g); endSession(); return; }   // arrêt avant la première réponse
  gameFinish(g);
  gameRerender(g);
}
function gameDuration(sec) {
  if (sec <= 60) return t("gm.sec", { s: sec });
  const m = Math.floor(sec / 60), s = sec % 60;
  return m ? t("gm.minsec", { m, s: String(s).padStart(2, "0") }) : t("gm.sec", { s });
}
// Résumé : score, temps, erreurs, record ; Rejouer, Revoir les erreurs (mode Cartes), Nouvelle session.
function renderGameSummary(root, g) {
  Speech.stop();
  const box = el("div", "card gm-sum");
  box.appendChild(el("h2", null, t("gm.sum.title") + " · " + GAME_ICON[g.mode] + " " + t("mode." + g.mode)));
  if (g.timeUp) box.appendChild(el("div", "muted", t("gm.timeUp")));
  const grid = el("div", "sum-grid");
  const cell = (cls, v, k) => { const c = el("div", "sum-cell " + cls); c.append(el("div", "sum-num", v), el("div", "sum-lbl", t(k))); grid.appendChild(c); };
  if (g.mode === "pairs") cell("ok", g.found + " / " + g.left.length, "gm.sum.pairs");
  else if (g.mode === "race") cell("ok", String(g.ok), "gm.sum.score");
  else cell("ok", g.ok + " / " + (g.ok + g.bad), "gm.sum.score");
  cell("", gameDuration(g.seconds), "gm.sum.time");
  cell(g.errors || g.bad ? "bad" : "", String(g.errors != null ? g.errors : g.bad), "gm.sum.errors");
  if (g.mode === "race") cell(g.newRecord ? "warn" : "", String(g.record || 0), "gm.sum.record");
  if (g.mode === "order") cell("", String(g.hints || 0), "gm.sum.hints");
  box.appendChild(grid);
  if (g.mode !== "race") grid.style.gridTemplateColumns = "repeat(" + Math.min(4, grid.childNodes.length) + ",1fr)";
  else grid.style.gridTemplateColumns = "repeat(2,1fr)";
  if (g.newRecord) box.appendChild(el("div", "sum-ok gm-rec", "🏆 " + t("gm.sum.newRecord")));
  const missed = g.missed.filter(id => state.cards.some(c => c.id === id));
  if (!missed.length && g.cardIds.length) box.appendChild(el("div", "sum-ok", t("gm.sum.noErr")));
  const xg = xpGainLine(rv.s);   // « +N XP » gagnés pendant la partie (étape 43)
  if (xg) box.appendChild(xg);
  root.appendChild(box);

  const btns = el("div", "btns");
  const again = el("button", "btn primary", t("gm.sum.replay"));
  again.addEventListener("click", () => {
    rv.cfg.mode = g.mode;
    if (!startGame(rv.cfg)) { toast(t("review.none")); endSession(); }
  });
  btns.appendChild(again);
  if (missed.length) {
    const b = el("button", "btn", t("gm.sum.reviewErrors", { n: missed.length }));
    b.addEventListener("click", () => newRun(shuffle(missed.map(id => ({ id, dir: (g.meta[id] || {}).dir || "toT", lang: (g.meta[id] || {}).lang }))), "cards"));
    btns.appendChild(b);
  }
  const nb = el("button", "btn", t("sum.new"));
  nb.addEventListener("click", endSession);
  btns.appendChild(nb);
  root.appendChild(btns);
}

// --- En-tête commun : lecture auto, avancement, score ---
function gameHeader(root, g, leftText, leftId) {
  const au = audioToggle();
  au.classList.add("gm-au");
  root.appendChild(au);
  const meta = el("div", "meta-row gm-meta");
  const l = el("span", "gm-left", leftText);
  if (leftId) l.id = leftId;
  const r = el("span", "gm-score");
  r.append(el("span", "gm-okn", "✓ " + g.ok), document.createTextNode("  "), el("span", "gm-badn", "✗ " + (g.errors != null ? g.errors : g.bad)));
  meta.append(l, r);
  root.appendChild(meta);
}
function gameQuitLink(root, g) {
  const quit = el("button", "link-btn", t("gm.quit"));
  quit.addEventListener("click", () => gameQuit(g));
  root.appendChild(quit);
}

// --- Audio : mot de la langue apprise au toucher, et automatiquement si « Lecture auto » est activée ---
function gameSpeak(text, lng) { if (text) Speech.speak(text, lng); }
function gameAutoSpeak(text, lng) { if (audioSettings().auto && text) Speech.speak(text, lng); }

// --- Animations courtes ---
function gameFlash(node, ok) {
  if (!node) return;
  node.classList.remove("gm-ok", "gm-bad");
  void node.offsetWidth;
  node.classList.add(ok ? "gm-ok" : "gm-bad");
}
function gamePop(icon, text) {
  const box = el("div", "sk-pop gm-pop");
  box.setAttribute("role", "status");
  box.append(el("span", "ic", icon), el("div", "tx", text));
  document.body.appendChild(box);
  setTimeout(() => box.remove(), 3000);
}

// --- Sons facultatifs (réglage, désactivé par défaut) : petits bips Web Audio, sans fichier ---
const GameSound = (() => {
  let ctx = null;
  const SEQ = {
    ok: [[660, 0.08], [880, 0.12]], bad: [[200, 0.22, "triangle"]],
    end: [[523, 0.1], [784, 0.16]], record: [[523, 0.09], [659, 0.09], [784, 0.09], [1047, 0.2]]
  };
  function on() { try { return gameSettings().sounds === true; } catch (e) { return false; } }
  function play(kind) {
    if (!on() || !SEQ[kind]) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = ctx || new AC();
      if (ctx.state === "suspended") ctx.resume();
      let tm = ctx.currentTime + 0.01;
      SEQ[kind].forEach(([f, d, type]) => {
        const o = ctx.createOscillator(), gn = ctx.createGain();
        o.type = type || "sine"; o.frequency.value = f;
        gn.gain.setValueAtTime(0.0001, tm);
        gn.gain.exponentialRampToValueAtTime(0.12, tm + 0.015);
        gn.gain.exponentialRampToValueAtTime(0.0001, tm + d);
        o.connect(gn); gn.connect(ctx.destination);
        o.start(tm); o.stop(tm + d + 0.02);
        tm += d * 0.9;
      });
    } catch (e) {}
  }
  return { play, on };
})();
// Interrupteur « Sons des jeux » (Réglages → Audio), même aspect que « Lecture auto ».
function gameSoundsToggle() {
  const b = el("button", "au-switch");
  b.type = "button";
  b.setAttribute("role", "switch");
  const lbl = el("span", "au-lbl");
  lbl.append(el("span", "gm-sndic", "🎵"), el("span", null, t("gm.sounds")));
  const track = el("span", "au-track");
  track.appendChild(el("span", "au-knob"));
  b.append(lbl, track);
  const show = () => b.setAttribute("aria-checked", String(gameSettings().sounds === true));
  b.addEventListener("click", () => {
    gameSettings().sounds = !gameSettings().sounds;
    show();
    commitQuiet();
    GameSound.play("ok");
  });
  show();
  const f = el("div", "field");
  f.append(b, el("div", "hint", t("gm.soundsHint")));
  return f;
}

// --- Petits outils ---
function gameFirstAlt(s) { return String(s || "").split("/")[0].trim(); }
// Clé courte et stable pour une liste d'ids (records de plusieurs listes).
function gameHash(s) { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); }
