"use strict";

// === SÉRIES ===
// Étape 28 : séries façon Duolingo. Données : state.streak, clé user:<id>:streak (morceau « streak » du STORAGE).
//   { current, best, since, lastValidDay, checkedDay, freezes, run, validDays [], frozenDays [], badges [{ days, day }],
//     lost { value, day, since } | null, adjustments [{ id, kind, value, freezes, delta, before, since, reason, at, by, seen }] }
// Jours = dates locales de l'appareil ("YYYY-MM-DD"), comparées comme du texte.
// - Jour validé : au moins dailyGoal cartes révisées ce jour-là (Réglages, 5 à 100, 10 par défaut). Validé une seule
//   fois (lastValidDay) : pas de double comptage, même si l'heure ou le fuseau changent.
// - Jours passés « fermés » un par un (checkedDay = dernier jour fermé) : jour non validé → 1 gel utilisé s'il en
//   reste (série gardée, jour gelé), sinon série à 0 (lost = valeur perdue, pour la restauration par l'admin). Record gardé.
// - 1 gel gagné tous les 7 jours validés d'affilée (run), 2 au maximum. Badges à 7, 30, 100 et 365 jours (une seule fois).
// - Modifications de l'admin (fonctions SQL admin_streak_* de l'étape 28) : écrites directement dans la clé streak
//   (adjustments, seen = false). Au lancement, l'appli les applique (valeurs absolues : rejouer ne change rien),
//   les marque vues et affiche un message. Un déclencheur SQL empêche l'appli d'effacer une modification pas encore vue.
// - Migration 3 → 4 : streakFromHistory (jours avec au moins 1 révision = validés, série actuelle gardée, 0 gel).
const STREAK_BADGES = [7, 30, 100, 365];
const STREAK_MAX_FREEZES = 2, STREAK_FREEZE_EVERY = 7, STREAK_KEEP_DAYS = 400, STREAK_ADJ_MAX = 50, STREAK_MAX = 100000;
function skDay(v) { return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null; }
// Jour + n (en jours calendaires, midi local : pas d'effet des changements d'heure)
function skAdd(day, n) { const [y, m, d] = day.split("-").map(Number); return todayStr(new Date(y, m - 1, d + n, 12)); }
function skDiff(a, b) { const u = s => { const [y, m, d] = s.split("-").map(Number); return Date.UTC(y, m - 1, d); }; return Math.round((u(b) - u(a)) / 86400000); }
function skDays(list) { return Array.from(new Set(arr(list).map(skDay).filter(Boolean))).sort().slice(-STREAK_KEEP_DAYS); }
function skLocalDay(iso) { const ts = Date.parse(iso || ""); return isNaN(ts) ? null : todayStr(new Date(ts)); }

function normAdj(a) {
  if (!a || typeof a !== "object" || typeof a.id !== "string" || !a.id) return null;
  if (!["set", "restore", "freezes"].includes(a.kind)) return null;
  const b = a.before && typeof a.before === "object" ? a.before : null;
  return {
    id: a.id.slice(0, 64), kind: a.kind,
    value: clampInt(a.value, 0, STREAK_MAX, 0), freezes: clampInt(a.freezes, 0, STREAK_MAX_FREEZES, 0), delta: clampInt(a.delta, -2, 2, 0),
    before: b ? { current: clampInt(b.current, 0, STREAK_MAX, 0), freezes: clampInt(b.freezes, 0, STREAK_MAX_FREEZES, 0),
                  lost: b.lost == null ? null : clampInt(b.lost, 0, STREAK_MAX, 0) } : null,
    since: skDay(a.since), reason: String(a.reason || "").slice(0, 300), at: typeof a.at === "string" ? a.at : "",
    by: String(a.by || "").slice(0, 60), seen: a.seen === true
  };
}
// Série enregistrée → modèle propre ; absente (données version 3 et moins) → calculée depuis history.
function normStreak(s, history) {
  if (!s || typeof s !== "object" || Array.isArray(s)) return streakFromHistory(history);
  const cur = clampInt(s.current, 0, STREAK_MAX, 0);
  const lv = s.lost && typeof s.lost === "object" ? clampInt(s.lost.value, 0, STREAK_MAX, 0) : 0;
  const seenB = new Set(), badges = [];
  arr(s.badges).forEach(b => {
    const n = typeof b === "number" ? b : num(Number(b && b.days), 0);
    if (STREAK_BADGES.includes(n) && !seenB.has(n)) { seenB.add(n); badges.push({ days: n, day: skDay(b && b.day) }); }
  });
  const ids = new Set();
  return {
    current: cur, best: Math.max(cur, clampInt(s.best, 0, STREAK_MAX, 0)),
    since: cur ? skDay(s.since) : null,
    lastValidDay: skDay(s.lastValidDay), checkedDay: skDay(s.checkedDay),
    freezes: clampInt(s.freezes, 0, STREAK_MAX_FREEZES, 0), run: clampInt(s.run, 0, STREAK_MAX, 0),
    validDays: skDays(s.validDays), frozenDays: skDays(s.frozenDays),
    badges: badges.sort((a, b) => a.days - b.days),
    lost: lv > 0 ? { value: lv, day: skDay(s.lost.day), since: skDay(s.lost.since) } : null,
    adjustments: arr(s.adjustments).map(normAdj).filter(a => a && !ids.has(a.id) && ids.add(a.id)).slice(-STREAK_ADJ_MAX)
  };
}
// Migration 3 → 4 : jours avec au moins 1 révision = validés ; série en cours gardée (aujourd'hui compris s'il a révisé,
// comme l'ancien affichage) ; record = plus longue suite ; badges déjà atteints donnés sans animation ; 0 gel.
function streakFromHistory(history, today) {
  today = today || todayStr();
  const days = Array.from(new Set(arr(history).filter(h => h && num(h.reviewed, 0) > 0).map(h => skDay(h.date)).filter(d => d && d <= today))).sort();
  const set = new Set(days);
  let best = 0, run = 0, prev = null;
  days.forEach(d => { run = prev && skAdd(prev, 1) === d ? run + 1 : 1; best = Math.max(best, run); prev = d; });
  const start = set.has(today) ? today : skAdd(today, -1);
  let cur = 0;
  while (set.has(skAdd(start, -cur))) cur++;
  best = Math.max(best, cur);
  return {
    current: cur, best, since: cur ? skAdd(start, -(cur - 1)) : null, lastValidDay: cur ? start : null,
    checkedDay: skAdd(today, -1), freezes: 0, run: 0,
    validDays: days.slice(-STREAK_KEEP_DAYS), frozenDays: [],
    badges: STREAK_BADGES.filter(b => b <= best).map(b => ({ days: b, day: null })),
    lost: null, adjustments: []
  };
}
// Ferme les jours passés jusqu'à hier (today exclu). Modifie s. Renvoie les événements [{ k: "frozen", day } | { k: "lost", value }].
function streakRoll(s, today) {
  const ev = [];
  let d = s.checkedDay ? skAdd(s.checkedDay, 1) : (s.lastValidDay ? skAdd(s.lastValidDay, 1) : today);
  if (s.lastValidDay && s.lastValidDay >= d) d = skAdd(s.lastValidDay, 1);
  if (d < today && skDiff(d, today) > STREAK_KEEP_DAYS) d = skAdd(today, -STREAK_KEEP_DAYS);
  const valid = new Set(s.validDays);
  for (; d < today; d = skAdd(d, 1)) {
    if (valid.has(d) || d === s.lastValidDay) continue;
    s.run = 0;
    if (s.current <= 0) continue;
    if (s.freezes > 0) { s.freezes--; s.frozenDays.push(d); ev.push({ k: "frozen", day: d }); }
    else { s.lost = { value: s.current, day: d, since: s.since }; ev.push({ k: "lost", value: s.current }); s.current = 0; s.since = null; }
  }
  const y = skAdd(today, -1);                         // tous les jours avant aujourd'hui sont traités
  if (!s.checkedDay || s.checkedDay < y) s.checkedDay = y;
  s.frozenDays = skDays(s.frozenDays);
  return ev;
}
// Objectif du jour atteint ? Valide le jour une seule fois. Renvoie [{ k: "goal", value } | { k: "earned" } | { k: "badge", days }].
function streakValidate(s, today, reviewed, goal) {
  if (reviewed < goal) return [];
  if (s.lastValidDay && s.lastValidDay >= today) return [];   // déjà validé (ou horloge revenue en arrière)
  const ev = [];
  if (s.current <= 0) s.since = today;
  s.current++; s.run++; s.lastValidDay = today;
  s.validDays = skDays(s.validDays.concat(today));
  s.best = Math.max(s.best, s.current);
  ev.push({ k: "goal", value: s.current });
  if (s.run % STREAK_FREEZE_EVERY === 0 && s.freezes < STREAK_MAX_FREEZES) { s.freezes++; ev.push({ k: "earned" }); }
  STREAK_BADGES.forEach(b => {
    if (s.current >= b && !s.badges.some(x => x.days === b)) { s.badges.push({ days: b, day: today }); ev.push({ k: "badge", days: b }); }
  });
  return ev;
}
// Modifications de l'admin pas encore vues : appliquées dans l'ordre (valeurs absolues), puis marquées vues.
// Série posée par l'admin = série du jour de la modification : les jours d'avant ne sont plus à rattraper.
function streakApplyAdj(s, today) {
  const done = [];
  s.adjustments.filter(a => !a.seen).sort((a, b) => a.at.localeCompare(b.at)).forEach(a => {
    let day = skLocalDay(a.at) || today;
    if (day > today) day = today;
    s.freezes = a.freezes;
    if (a.kind !== "freezes") {
      s.current = a.value;
      s.best = Math.max(s.best, a.value);
      s.since = a.value > 0 ? (a.since || skAdd(day, -(a.value - 1))) : null;
      if (a.kind === "restore" || a.value > 0) s.lost = null;
      const y = skAdd(day, -1);
      if (!s.checkedDay || s.checkedDay < y) s.checkedDay = y;
    }
    a.seen = true;
    done.push(a);
  });
  return done;
}
// Données en ligne : ajoute les modifications de l'admin que cet appareil ne connaît pas encore.
function streakMerge(s, raw) {
  if (!s || !raw || typeof raw !== "object") return 0;
  const have = new Set(s.adjustments.map(a => a.id));
  let n = 0;
  arr(raw.adjustments).map(normAdj).filter(Boolean).forEach(a => { if (!have.has(a.id)) { s.adjustments.push(a); have.add(a.id); n++; } });
  if (n) s.adjustments = s.adjustments.slice(-STREAK_ADJ_MAX);
  return n;
}
// Série vue à la date today sans rien modifier (fiche du compte, admin) : copie fermée jusqu'à hier.
function streakEffective(s, today) {
  const c = normStreak(JSON.parse(JSON.stringify(s || {})), []);
  streakRoll(c, today || todayStr());
  return c;
}

// Côté appli : objectif du jour, messages au lancement, célébrations.
const Streak = (() => {
  let notices = [], lastDay = null, watching = false;
  function goal() { return clampInt(state.settings.dailyGoal, 5, 100, 10); }
  function reviewedOn(day) { const h = state.history.find(x => x.date === day); return h ? num(h.reviewed, 0) : 0; }
  function data() { if (!state.streak) state.streak = normStreak(null, state.history); return state.streak; }
  function doneToday() { return data().lastValidDay === todayStr(); }
  // Au lancement, au changement de jour, après une synchro, après un changement d'objectif.
  function tick(show) {
    if (!Storage.getUser()) return;
    const s = data(), today = todayStr();
    lastDay = today;
    const before = JSON.stringify(s);
    streakApplyAdj(s, today).forEach(a => notices.push({ k: "adj", a }));
    const rolled = streakRoll(s, today);
    notices.push(...rolled);
    const ev = streakValidate(s, today, reviewedOn(today), goal());
    xpStreakDay(ev, today);   // jour de série validé : XP (étape 43)
    if (JSON.stringify(s) !== before) commit();
    celebrate(ev);
    skPushEvents(rolled.concat(ev));
    if (show) showNotices();
    try { if (typeof XP !== "undefined") XP.tick(); } catch (e) {}   // défis du jour, badges, niveau (étape 43)
    Friends.publish();   // série, objectif du jour, semaine : résumé public pour mes amis (étape 29)
  }
  // Après chaque réponse (Leitner) : l'appelant enregistre (commit). day = jour de la réponse.
  function onReview(day) {
    const s = data();
    lastDay = todayStr();
    const rolled = streakRoll(s, day);
    notices.push(...rolled);
    const ev = streakValidate(s, day, reviewedOn(day), goal());
    xpStreakDay(ev, day);   // jour de série validé : XP (étape 43)
    celebrate(ev);
    skPushEvents(rolled.concat(ev));
  }
  function celebrate(ev) {
    if (!ev.length) return;
    const g = ev.find(e => e.k === "goal");
    if (g) {
      toast(t("sk.goalDone", { n: g.value }) + (ev.some(e => e.k === "earned") ? " " + t("sk.earned") : ""));
      const fl = $("#homeFlame");
      if (fl) { fl.classList.remove("on"); void fl.offsetWidth; fl.classList.add("on"); }
    }
    ev.filter(e => e.k === "badge").forEach((e, i) => setTimeout(() => badgePop(e.days), 600 + i * 3000));
  }
  // Petite animation au passage d'un palier (une seule fois : le badge est enregistré).
  function badgePop(days) {
    const box = el("div", "sk-pop");
    box.setAttribute("role", "status");
    box.append(el("span", "ic", badgeIcon(days)), el("div", "tx", t("sk.badgeNew", { n: days })), el("div", "sb", t("sk.badgeSub")));
    document.body.appendChild(box);
    setTimeout(() => box.remove(), 3000);
  }
  // Messages en attente (gel utilisé, série perdue, modifications de l'admin) : une fenêtre, hors session de révision.
  function showNotices() {
    if (!notices.length || !Storage.getUser()) return;
    if (rv.phase === "run" && currentScreen === "review") return;   // en pleine session : plus tard
    const list = notices.splice(0), s = data(), body = el("div");
    const p = txt => body.appendChild(el("p", "sk-msg", txt));
    const frozen = list.filter(x => x.k === "frozen").length;
    const lost = list.filter(x => x.k === "lost").pop();
    if (frozen) p("❄️ " + (frozen > 1 ? t("sk.msg.frozenN", { n: frozen }) : t("sk.msg.frozen1")));
    if (lost) p("💔 " + t("sk.msg.lost", { n: lost.value, b: s.best }));
    list.filter(x => x.k === "adj").forEach(({ a }) => {
      if (a.kind === "restore") p("🔥 " + t("sk.msg.restored", { n: a.value }));
      else if (a.kind === "set") p("🔥 " + t("sk.msg.set", { n: a.value }));
      else if (a.delta > 0) p("❄️ " + (a.delta > 1 ? t("sk.msg.giftN", { n: a.delta }) : t("sk.msg.gift1")));
      else if (a.delta < 0) p("❄️ " + t("sk.msg.removed", { n: -a.delta }));
    });
    if (!body.childNodes.length) return;
    if (!lost || s.current > 0) p(t("sk.msg.now", { n: s.current, f: s.freezes }));
    openModal(t("sk.title"), body, [{ label: t("ann.ok"), kind: "primary" }]);
  }
  // Changement de jour pendant que l'appli est ouverte (minuit, fuseau, retour au premier plan).
  function watch() {
    if (watching) return;
    watching = true;
    const check = () => { if (Storage.getUser() && lastDay && todayStr() !== lastDay) tick(true); };
    setInterval(check, 60000);
    try { document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") check(); }); } catch (e) {}
  }
  function reset() { notices = []; lastDay = null; try { if (typeof XP !== "undefined") XP.reset(); } catch (e) {} }
  return { goal, reviewedOn, data, doneToday, tick, onReview, showNotices, watch, reset };
})();
// Palier atteint, gel utilisé → événements pour les notifications automatiques (étape 34, js/notifications.js).
function skPushEvents(ev) {
  try { if (ev.length && typeof PushEvents !== "undefined") PushEvents.fromStreak(ev); } catch (e) {}
}
// Objectif du jour atteint (événement « goal ») → XP du jour de série (étape 43, js/xp.js).
function xpStreakDay(ev, day) {
  try { if (typeof XP !== "undefined" && ev.some(e => e.k === "goal")) XP.onStreakDay(day); } catch (e) {}
}
function badgeIcon(days) { return days >= 365 ? "👑" : days >= 100 ? "🏆" : days >= 30 ? "🥇" : "🏅"; }

// === LEITNER ===
// Boîte 0 = nouveau ou pas su (revient dans la session). Boîtes 1 à 5 : 1, 3, 7, 14, 30 jours.
// Intervalles en jours calendaires : la carte redevient due à minuit (heure locale) du jour J+N.
// Étape 37 : progression par langue étudiée — card.progress = { <langue>: { box, dueAt, stats } }.
//  - Langue utilisée sans précision : celle de la session (StudyCtx), sinon la langue principale de la carte.
//  - Langue jamais révisée : boîte 0, due tout de suite (part de zéro, sans toucher aux autres langues).
//  - Carte sans progression par langue (nouvelle carte) : ses champs box / dueAt / stats = langue principale.
//  - Après une réponse dans la langue principale, box / dueAt / stats de la carte en sont la copie (voir syncPrimaryProgress).
//  - Leitner.unit(carte, langue) : vue en lecture seule (box, dueAt, stats de cette langue) pour les statistiques.
const Leitner = (() => {
  const MAX_BOX = 5;
  const ZERO = Object.freeze({ box: 0, dueAt: 0, stats: Object.freeze({ seen: 0, correct: 0, wrong: 0, lastSeen: null }) });
  function dayStart(ts) { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); }
  function addDays(ts, n) { const d = new Date(dayStart(ts)); d.setDate(d.getDate() + n); return d.getTime(); }
  function isUnit(c) { return !!c && Object.prototype.hasOwnProperty.call(c, "unitLang"); }
  function hasProg(c) { return !!(c.progress && typeof c.progress === "object" && Object.keys(c.progress).length); }
  function langOf(c, lang) { return lang || studyCtxLang(c) || primaryLang(c); }
  // Progression d'une carte dans une langue (objet { box, dueAt, stats }, à ne pas modifier).
  function prog(c, lang) {
    if (isUnit(c) && (!lang || lang === c.unitLang)) return c;
    const L = langOf(c, lang);
    const P = c.progress && c.progress[L];
    if (P) return P;
    if (!hasProg(c) && L === primaryLang(c)) return c;
    return ZERO;
  }
  // Progression modifiable (créée si besoin ; la langue principale garde ses valeurs actuelles).
  function ensure(c, L) {
    if (!hasProg(c)) c.progress = { [primaryLang(c)]: { box: c.box, dueAt: c.dueAt, stats: Object.assign({}, c.stats) } };
    if (!c.progress[L]) c.progress[L] = { box: 0, dueAt: 0, stats: { seen: 0, correct: 0, wrong: 0, lastSeen: null } };
    return c.progress[L];
  }
  function isDue(c, now, lang) { return prog(c, lang).dueAt <= (now || Date.now()); }
  // "unknown" = Pas su (boîte 0), "review" = À revoir (1-2), "known" = Su (3-5)
  function category(c, lang) { const b = prog(c, lang).box; return b === 0 ? "unknown" : (b <= 2 ? "review" : "known"); }
  // Langues étudiées où la carte est à réviser maintenant. Langue en plus : seulement si la carte y est utilisable
  // (mot rempli) ; langue principale : comme avant l'étape 37.
  function dueLangs(c, now) {
    now = now || Date.now();
    const ls = cardStudyLangs(c);
    return ls.filter((L, i) => isDue(c, now, L) && (i === 0 || cardUsable(c, studyLg(L))));
  }
  function unit(c, L) {
    const P = prog(c, L), u = Object.create(c);
    Object.defineProperty(u, "unitLang", { value: L, enumerable: false });
    u.box = P.box; u.dueAt = P.dueAt; u.stats = P.stats;
    return u;
  }
  // Vues (carte, langue) d'une liste de cartes : toutes les langues étudiées (only = une seule langue).
  // Langue en plus : seulement les cartes utilisables dans cette langue.
  function units(cards, only) {
    const out = [];
    arr(cards).forEach(c => cardStudyLangs(c).forEach((L, i) => {
      if (only && L !== only) return;
      if (i > 0 && !cardUsable(c, studyLg(L))) return;
      out.push(unit(c, L));
    }));
    return out;
  }
  function logHistory(now, known, L) {
    const date = todayStr(new Date(now));
    let h = state.history.find(x => x.date === date);
    if (!h) { h = { date, reviewed: 0, correct: 0 }; state.history.push(h); }
    h.reviewed++;
    if (known) h.correct++;
    if (isLang(L)) {                                      // révisions par langue (étape 37)
      if (!h.langs || typeof h.langs !== "object") h.langs = {};
      const v = h.langs[L] || (h.langs[L] = [0, 0]);
      v[0]++; if (known) v[1]++;
    }
    Streak.onReview(date);   // objectif du jour, gels, badges (étape 28) : toutes langues confondues
  }
  // result : "known" (Su) | "review" (À revoir) | "unknown" (Pas su). lang : langue révisée (facultatif).
  // Modifie la carte et l'historique, sans sauvegarder (l'appelant fait commit()).
  function grade(c, result, now, lang) {
    now = now || Date.now();
    const L = langOf(c, lang);
    const P = ensure(c, L);
    const from = P.box;
    if (result === "known") {
      P.box = Math.min(MAX_BOX, P.box + 1);              // boîte 5 : reste en 5, revient dans 30 j
      P.dueAt = addDays(now, CONFIG.LEITNER_INTERVALS_DAYS[P.box]);
    } else if (result === "review") {
      P.dueAt = addDays(now, 1);                        // même boîte, revient demain
    } else {
      P.box = 0;
      P.dueAt = now;                                    // revient dans la session
    }
    P.stats.seen++;
    P.stats.lastSeen = now;
    if (result === "known") P.stats.correct++;
    if (result === "unknown") P.stats.wrong++;
    if (L === primaryLang(c)) { c.box = P.box; c.dueAt = P.dueAt; c.stats = Object.assign({}, P.stats); }
    logHistory(now, result === "known", L);
    xpAnswer(c, L, result === "known", now);   // XP (étape 43)
    return { from, to: P.box, dueAt: P.dueAt, lang: L };
  }
  // Jeux d'entraînement (étape 42) : poids réduit. ok = bonne réponse : pas de montée de boîte, date de révision
  // inchangée, stats « vu / juste » mises à jour. Mauvaise réponse = comme « À revoir ». Compte pour l'objectif du jour.
  function gradeGame(c, ok, now, lang) {
    if (!ok) return grade(c, "review", now, lang);
    now = now || Date.now();
    const L = langOf(c, lang);
    const P = ensure(c, L);
    P.stats.seen++;
    P.stats.correct++;
    P.stats.lastSeen = now;
    if (L === primaryLang(c)) { c.box = P.box; c.dueAt = P.dueAt; c.stats = Object.assign({}, P.stats); }
    logHistory(now, true, L);
    xpAnswer(c, L, true, now);   // XP (étape 43)
    return { from: P.box, to: P.box, dueAt: P.dueAt, lang: L };
  }
  // XP d'une réponse (étape 43, js/xp.js) : jamais bloquant pour la progression.
  function xpAnswer(c, L, ok, now) { try { if (typeof XP !== "undefined") XP.onAnswer(c, L, ok, now); } catch (e) {} }
  // Remise à zéro d'une carte (copie sans progression) : toutes les langues.
  function clear(c, now) {
    c.box = 0; c.dueAt = now || Date.now(); c.stats = { seen: 0, correct: 0, wrong: 0, lastSeen: null };
    delete c.progress;
    return c;
  }
  return { dayStart, addDays, isDue, category, grade, gradeGame, prog, dueLangs, unit, units, clear, isUnit };
})();

// Jours d'affilée avec au moins une révision dans une langue (statistiques par langue, étape 37) ; aujourd'hui
// compte s'il y a déjà une révision, sinon la suite s'arrête à hier.
function langRunDays(L) {
  const days = new Set(state.history.filter(h => h.langs && h.langs[L] && h.langs[L][0] > 0).map(h => h.date));
  const today = todayStr();
  let d = days.has(today) ? today : skAdd(today, -1), n = 0;
  while (days.has(d)) { n++; d = skAdd(d, -1); }
  return n;
}
// Révisions dans une langue sur les n derniers jours (aujourd'hui compris) : { reviewed, correct }.
function langReviewed(L, n) {
  const from = skAdd(todayStr(), -(n - 1));
  let r = 0, c = 0;
  state.history.forEach(h => { if (h.date >= from && h.langs && h.langs[L]) { r += h.langs[L][0]; c += h.langs[L][1]; } });
  return { reviewed: r, correct: c };
}
