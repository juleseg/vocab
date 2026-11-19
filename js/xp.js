"use strict";

// === XP, NIVEAUX, DÉFIS DU JOUR ET BADGES (ÉTAPE 43) ===
// Données : state.xp, morceau « xp » du STORAGE (clé user:<id>:xp), envoyé avant l'index (règle 33b) :
//   { v: 1, total, byLang { <langue>: XP }, days { "AAAA-MM-JJ": { x, l { <langue>: XP } } } (70 derniers jours),
//     answers (réponses qui ont rapporté de l'XP), perfects (sans-faute), levelSeen (dernier niveau animé),
//     badges [{ id, day }], use { <mode>: sessions ou parties terminées },
//     ch { day, list [{ id, k, p, n, v, done }], bonus } (défis du jour), chDone (défis réussis), chDays [jours aux 3 défis],
//     init { at, from } (XP de départ calculé depuis l'historique, étape 43) }
// - XP d'une réponse (Leitner.grade / gradeGame → XP.onAnswer) : barème du mode (XP_RULES.answer) si juste, XP_RULES.wrong sinon.
//   Même carte, même langue, répondue deux fois en moins d'une minute : pas d'XP la 2e fois (mémoire de l'appareil).
// - Session ou partie terminée (au moins XP_RULES.sessionMin cartes) : XP_RULES.session. Jour de série validé : XP_RULES.streakDay.
// - XP par langue : réponses (et session d'une seule langue). Défis, bonus et série : total seulement.
// - Semaine = lundi → dimanche (jours locaux de l'appareil), comme le classement des amis.
// - Défis du jour : 3 défis tirés au sort chaque jour local (même tirage sur tous les appareils : graine jour + compte), selon
//   les modes déjà utilisés (use) ; XP_RULES.challenge par défi, XP_RULES.allChallenges si les 3 sont faits. Notification
//   « défi terminé » seulement dans l'appli (message), jamais en push.
// - Niveau : seuil du niveau n = XP_RULES.levelStep × n × (n − 1) (100, 300, 600, 1000, 1500…). Animation une seule fois
//   par niveau (levelSeen, synchronisé). Badges : animation une seule fois (gagné = enregistré).
// - Migration (pas de morceau xp) : XP de départ calculé depuis history (réponses justes au barème du mode Cartes, fausses
//   à XP_RULES.wrong) + jours de série validés ; badges déjà atteints donnés sans animation ; aucun défi ; rien supprimé.

// --- Barème (un seul objet de configuration) ---
const XP_RULES = {
  answer: {                   // réponse juste, par mode
    cards: 2, quiz: 2,        // Cartes, Interrogateur
    write: 4, table: 4,       // Écrit, Tableau (modes difficiles)
    dictation: 4, speak: 4,   // Dictée, Prononciation (étape 46)
    mcq: 1, race: 1, pairs: 1, order: 2   // jeux (étape 42)
  },
  wrong: 1,                   // réponse fausse ou « À revoir » : l'effort compte
  repeatMs: 60000,            // anti-triche : même carte répondue deux fois en moins d'une minute → pas d'XP la 2e fois
  session: 10,                // session ou partie terminée…
  sessionMin: 5,              // …d'au moins 5 cartes
  challenge: 20,              // défi du jour réussi
  allChallenges: 30,          // bonus : les 3 défis du jour
  streakDay: 10,              // jour de série validé (objectif du jour atteint)
  levelStep: 50,              // seuil du niveau n = 50 × n × (n − 1)
  keepDays: 70,               // jours gardés pour l'XP de la semaine
  duel: {                     // duels entre amis (étape 44) : réponses au barème du mode ci-dessous (QCM : juste 1, fausse
    mode: "mcq",              // XP_RULES.wrong), partie terminée XP_RULES.session, et bonus de victoire (une fois par duel)
    win: 20
  },
  story: {                    // histoires (étape 45, js/story.js) : une fois par histoire et par question
    correct: 5,               // bonne réponse à une question de compréhension (premier choix)
    read: 10                  // histoire lue (bouton « J'ai lu l'histoire », ou toutes les questions répondues)
  },
  sentence: {                 // « Ma phrase » (étape 58, js/sentences.js) : une fois par phrase envoyée à Claude
    send: 5
  },
  gender: {                   // mode « le / la ? » (étape 60, js/genre.js) : entraînement seulement, XP et rien d'autre
    correct: 1                // bonne réponse (0 si faux ; une même carte rapporte au plus une fois par XP_RULES.repeatMs)
  }
};
// Badges de l'étape 43 (affichés dans Stats avec les badges de série).
const XP_BADGES = [
  { id: "perfect1", icon: "🎯" },
  { id: "cards100", icon: "📗", cards: 100 }, { id: "cards1000", icon: "📘", cards: 1000 }, { id: "cards5000", icon: "📚", cards: 5000 },
  { id: "ch7", icon: "🗓️", chDays: 7 },
  { id: "race1", icon: "⏱️" },
  { id: "lvl5", icon: "⭐", level: 5 }, { id: "lvl10", icon: "🌟", level: 10 }, { id: "lvl20", icon: "💫", level: 20 },
  { id: "lvl30", icon: "🏵️", level: 30 }, { id: "lvl50", icon: "👑", level: 50 },
  { id: "idea1", icon: "💡" },   // « Idée retenue » (étape 52) : donné seulement par une récompense de l'admin (XP.onIdea)
  { id: "team1", icon: "🏆" }    // « Équipe en or » (étape 54) : 1er objectif d'équipe atteint (XP.onTeam, récompense réservée sur le serveur)
];
const XP_BADGE_IDS = XP_BADGES.map(b => b.id);
// Défis possibles : k = sorte, n = objectif. Modes proposés seulement s'ils ont déjà été utilisés (use) ;
// Interrogateur jamais (il faut une 2e personne). « lang » : seulement avec 2 langues étudiées ou plus.
const XP_CH_MODES = ["write", "table", "mcq", "race", "pairs", "order", "dictation", "speak"];   // + Dictée, Prononciation (étape 46)
const XP_PERFECT_MIN = 10;     // sans-faute : 10 cartes ou plus, aucune erreur
const XP_MAX = 100000000;

// --- Niveaux ---
function xpLevelMin(n) { return XP_RULES.levelStep * n * (n - 1); }
function xpLevel(total) {
  const x = Math.max(0, num(total, 0));
  let n = Math.max(1, Math.floor((1 + Math.sqrt(1 + 4 * x / XP_RULES.levelStep)) / 2));
  while (n > 1 && xpLevelMin(n) > x) n--;
  while (xpLevelMin(n + 1) <= x) n++;
  return Math.min(n, 1000);
}
// Avancement dans le niveau : { level, from, to, into, need, pct }
function xpProgress(total) {
  const L = xpLevel(total), from = xpLevelMin(L), to = xpLevelMin(L + 1);
  const into = Math.max(0, num(total, 0) - from), need = to - from;
  return { level: L, from, to, into, need, pct: need ? Math.min(100, Math.floor(into * 100 / need)) : 100 };
}

// --- Modèle ---
function xpDayOk(v) { return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v); }
function xpInt(v, max) { return clampInt(v, 0, max || XP_MAX, 0); }
function xpLangMap(o) {
  const out = {};
  if (o && typeof o === "object" && !Array.isArray(o)) Object.keys(o).forEach(L => { if (isLang(L)) { const v = xpInt(o[L]); if (v) out[L] = v; } });
  return out;
}
function xpEmpty() {
  return { v: 1, total: 0, byLang: {}, days: {}, answers: 0, perfects: 0, levelSeen: 1, badges: [], use: {},
    ch: null, chDone: 0, chDays: [], init: null, duels: [], ideas: [], teams: [] };
}
function xpTrimDays(days, today) {
  const from = skAdd(today || todayStr(), -(XP_RULES.keepDays - 1));
  Object.keys(days).forEach(d => { if (d < from) delete days[d]; });
  return days;
}
function normXpChallenge(c) {
  if (!c || typeof c !== "object" || typeof c.id !== "string") return null;
  const k = ["cards", "correct", "perfect", "game", "mode", "lang"].includes(c.k) ? c.k : null;
  if (!k) return null;
  const p = typeof c.p === "string" ? c.p.slice(0, 12) : "";
  if (k === "mode" && !XP_CH_MODES.includes(p)) return null;
  if (k === "lang" && !isLang(p)) return null;
  const n = clampInt(c.n, 1, 1000, 1);
  return { id: c.id.slice(0, 24), k, p, n, v: clampInt(c.v, 0, n, 0), done: c.done === true };
}
// Morceau xp enregistré → modèle propre ; absent → XP de départ calculé depuis l'historique (migration, étape 43).
function normXp(raw, history, streak, settings) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return xpFromHistory(history, streak, settings);
  const x = xpEmpty();
  x.total = xpInt(raw.total);
  x.byLang = xpLangMap(raw.byLang);
  if (raw.days && typeof raw.days === "object" && !Array.isArray(raw.days)) {
    Object.keys(raw.days).filter(xpDayOk).forEach(d => {
      const e = raw.days[d] || {}, v = xpInt(e.x);
      if (v) x.days[d] = { x: v, l: xpLangMap(e.l) };
    });
  }
  xpTrimDays(x.days);
  x.answers = xpInt(raw.answers); x.perfects = xpInt(raw.perfects);
  x.levelSeen = clampInt(raw.levelSeen, 1, 1000, 1);
  const seen = new Set();
  arr(raw.badges).forEach(b => { const id = b && b.id; if (XP_BADGE_IDS.includes(id) && !seen.has(id)) { seen.add(id); x.badges.push({ id, day: xpDayOk(b.day) ? b.day : null }); } });
  if (raw.use && typeof raw.use === "object") Object.keys(raw.use).forEach(m => { if (/^[a-z]{2,12}$/.test(m)) { const v = xpInt(raw.use[m], 1000000); if (v) x.use[m] = v; } });
  if (raw.ch && typeof raw.ch === "object" && xpDayOk(raw.ch.day)) {
    const list = arr(raw.ch.list).map(normXpChallenge).filter(Boolean).slice(0, 3);
    if (list.length) x.ch = { day: raw.ch.day, list, bonus: raw.ch.bonus === true };
  }
  x.chDone = xpInt(raw.chDone, 1000000);
  x.chDays = Array.from(new Set(arr(raw.chDays).filter(xpDayOk))).sort().slice(-60);
  x.init = raw.init && typeof raw.init === "object" ? { at: num(raw.init.at, 0), from: xpInt(raw.init.from) } : null;
  x.duels = arr(raw.duels).filter(k => typeof k === "string" && /^[pw]:[0-9a-f-]{36}$/i.test(k)).slice(-200);   // étape 44
  x.ideas = Array.from(new Set(arr(raw.ideas).filter(k => typeof k === "string" && /^[0-9a-f-]{36}$/i.test(k)))).slice(-200);   // étape 52
  x.teams = Array.from(new Set(arr(raw.teams).filter(xpDayOk))).sort().slice(-60);   // étape 54 : semaines (lundi) dont la récompense d'équipe est appliquée
  return x;
}
// Migration : XP de départ depuis history (et les jours de série validés), sans défis. Badges déjà atteints sans animation.
function xpFromHistory(history, streak, settings) {
  const x = xpEmpty(), R = XP_RULES, ok = R.answer.cards, today = todayStr();
  const from = skAdd(today, -(R.keepDays - 1));
  const addDay = (d, v, L) => {
    if (!v || d < from || d > today) return;
    const e = x.days[d] || (x.days[d] = { x: 0, l: {} });
    e.x += v;
    if (L) e.l[L] = (e.l[L] || 0) + v;
  };
  arr(history).forEach(h => {
    if (!h || !xpDayOk(h.date)) return;
    const r = num(h.reviewed, 0), c = Math.min(num(h.correct, 0), r);
    if (r <= 0) return;
    const v = c * ok + (r - c) * R.wrong;
    x.total += v; x.answers += r;
    const ls = h.langs && typeof h.langs === "object" ? h.langs : {};
    let lsum = 0;
    Object.keys(ls).forEach(L => {
      if (!isLang(L) || !Array.isArray(ls[L])) return;
      const lr = num(ls[L][0], 0), lc = Math.min(num(ls[L][1], 0), lr), lv = lc * ok + (lr - lc) * R.wrong;
      if (lv > 0) { x.byLang[L] = (x.byLang[L] || 0) + lv; addDay(h.date, lv, L); lsum += lv; }
    });
    if (v > lsum) addDay(h.date, v - lsum, null);
  });
  arr(streak && streak.validDays).filter(xpDayOk).forEach(d => { x.total += R.streakDay; addDay(d, R.streakDay, null); });
  x.total = Math.min(x.total, XP_MAX);
  const L = xpLevel(x.total);
  x.levelSeen = L;
  XP_BADGES.forEach(b => {
    if ((b.cards && x.answers >= b.cards) || (b.level && L >= b.level)) x.badges.push({ id: b.id, day: null });
  });
  try {
    const rec = settings && settings.games && settings.games.records;
    if (rec && Object.keys(rec).some(k => k.startsWith("race:") && num(rec[k], 0) > 0)) x.badges.push({ id: "race1", day: null });
  } catch (e) {}
  x.init = { at: Date.now(), from: x.total };
  return x;
}
// XP d'une semaine (lundi → aujourd'hui) : { total, byLang }
function xpWeek(x, today) {
  today = today || todayStr();
  const mon = frMonday(today), out = { total: 0, byLang: {} };
  Object.keys((x && x.days) || {}).forEach(d => {
    if (d < mon || d > today) return;
    const e = x.days[d];
    out.total += num(e.x, 0);
    Object.keys(e.l || {}).forEach(L => { out.byLang[L] = (out.byLang[L] || 0) + num(e.l[L], 0); });
  });
  return out;
}
// Petit générateur pseudo-aléatoire à graine (même tirage des défis sur tous les appareils d'un compte).
function xpRng(seed) {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) { h = Math.imul(h ^ seed.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  let a = h >>> 0;
  return () => { a = (a + 0x6D2B79F5) | 0; let t1 = Math.imul(a ^ (a >>> 15), 1 | a); t1 = (t1 + Math.imul(t1 ^ (t1 >>> 7), 61 | t1)) ^ t1; return ((t1 ^ (t1 >>> 14)) >>> 0) / 4294967296; };
}

// --- Côté appli ---
const XP = (() => {
  const recent = new Map();     // anti-triche : "<carte>|<langue>" → heure de la dernière réponse avec XP (cet appareil)
  let pops = [], popBusy = false, who = null;
  function data() {
    if (!state.xp) state.xp = normXp(null, state.history, state.streak, state.settings);
    return state.xp;
  }
  function checkUser() { const u = Storage.getUser(); if (u !== who) { who = u; recent.clear(); pops = []; } }
  function reset() { recent.clear(); pops = []; who = null; }
  function goal() { try { return Streak.goal(); } catch (e) { return 10; } }

  // Ajoute de l'XP (L = langue, ou null : total seulement). Renvoie le nombre ajouté.
  function add(v, L, day) {
    v = Math.max(0, Math.round(num(v, 0)));
    if (!v) return 0;
    const x = data(), d = day || todayStr();
    const before = xpLevel(x.total);
    x.total = Math.min(XP_MAX, x.total + v);
    const e = x.days[d] || (x.days[d] = { x: 0, l: {} });
    e.x += v;
    if (isLang(L)) { x.byLang[L] = (x.byLang[L] || 0) + v; e.l[L] = (e.l[L] || 0) + v; }
    xpTrimDays(x.days, d);
    try { if (rv && rv.s) rv.s.xpGain = (rv.s.xpGain || 0) + v; } catch (e2) {}
    if (xpLevel(x.total) > before) checkLevel();
    return v;
  }

  // --- Défis du jour ---
  function label(c) {
    if (c.k === "mode") return t(GAME_MODES.includes(c.p) ? "xp.ch.modeGame" : "xp.ch.mode", { m: t("mode." + c.p) });
    if (c.k === "lang") return t("xp.ch.lang", { n: c.n, l: langName(c.p) });
    return t("xp.ch." + c.k, { n: c.n });
  }
  function icon(c) {
    return c.k === "cards" ? "📚" : c.k === "correct" ? "✅" : c.k === "perfect" ? "🎯" : c.k === "game" ? "🎮"
      : c.k === "lang" ? "🌍" : (GAME_ICON[c.p] || LISTEN_ICON[c.p] || (c.p === "write" ? "✍️" : "📋"));
  }
  // Tirage des 3 défis d'un jour, selon ce que le compte utilise.
  function pick(day) {
    const x = data(), rnd = xpRng(day + "|" + (Storage.getUser() || ""));
    const g = goal();
    const list = [];
    const first = rnd() < 0.5 ? "cards" : "correct";
    list.push(first === "cards" ? { id: "cards", k: "cards", p: "", n: Math.max(20, Math.ceil((g + 10) / 5) * 5) }
      : { id: "correct", k: "correct", p: "", n: Math.max(15, Math.ceil(g / 5) * 5) });
    const pool = [[{ id: "perfect", k: "perfect", p: "", n: 1 }, 2], [{ id: "game", k: "game", p: "", n: 1 }, 1.5]];
    let hasConj = false;
    try { hasConj = state.cards.some(c => cardType(c) === "conj" && hasGrammar(c.lang)); } catch (e) {}
    XP_CH_MODES.forEach(m => {
      const u = num(x.use[m], 0);
      if (!u || (m === "table" && !hasConj)) return;
      pool.push([{ id: "mode:" + m, k: "mode", p: m, n: 1 }, 1 + Math.min(u, 20) / 10]);
    });
    let langs = [];
    try { langs = targetLangsInUse(); } catch (e) {}
    if (langs.length > 1) {
      const wk = xpWeek(x, day).byLang;
      const L = langs.slice().sort((a, b) => num(wk[a], 0) - num(wk[b], 0) || (rnd() < 0.5 ? -1 : 1))[0];
      pool.push([{ id: "lang:" + L, k: "lang", p: L, n: 10 }, 1.5]);
    }
    while (list.length < 3 && pool.length) {
      const sum = pool.reduce((s, p) => s + p[1], 0);
      let r = rnd() * sum, i = 0;
      while (i < pool.length - 1 && r >= pool[i][1]) { r -= pool[i][1]; i++; }
      list.push(pool.splice(i, 1)[0][0]);
    }
    return list.map(c => Object.assign(c, { v: 0, done: false }));
  }
  // Défis du jour en cours (renouvelés au premier usage d'un nouveau jour local ; horloge revenue en arrière : on garde).
  function challenges() {
    const x = data(), today = todayStr();
    if (!x.ch || x.ch.day < today) { x.ch = { day: today, list: pick(today), bonus: false }; commitLater(); }
    return x.ch;
  }
  let saveTimer = null;
  function commitLater() { clearTimeout(saveTimer); saveTimer = setTimeout(() => { try { if (Storage.getUser()) commitQuiet(); } catch (e) {} }, 300); }
  // Avance un défi ; défi terminé → XP + message ; les 3 → bonus.
  function bump(match, by) {
    const ch = challenges();
    let changed = false;
    ch.list.forEach(c => {
      if (c.done || !match(c)) return;
      c.v = Math.min(c.n, c.v + (by || 1));
      changed = true;
      if (c.v >= c.n) {
        c.done = true;
        const x = data();
        x.chDone = Math.min(1000000, x.chDone + 1);
        const got = add(XP_RULES.challenge, null);
        toast("🎯 " + t("xp.ch.done", { c: label(c), n: got }));
      }
    });
    if (changed && !ch.bonus && ch.list.length && ch.list.every(c => c.done)) {
      ch.bonus = true;
      const x = data();
      if (!x.chDays.includes(ch.day)) x.chDays = x.chDays.concat(ch.day).sort().slice(-60);
      const got = add(XP_RULES.allChallenges, null);
      pop("🏆", t("xp.ch.allDone"), t("xp.plus", { n: got }));
      checkBadges();
    }
    return changed;
  }

  // --- Événements ---
  // Une réponse (Leitner.grade / gradeGame). ok = juste. Mode = celui de la session en cours.
  function onAnswer(c, L, ok, now) {
    checkUser();
    now = now || Date.now();
    const key = (c && c.id) + "|" + (L || "");
    const last = recent.get(key);
    if (last && now - last < XP_RULES.repeatMs) return 0;           // anti-triche
    recent.set(key, now);
    if (recent.size > 2000) { const lim = now - XP_RULES.repeatMs; recent.forEach((v, k) => { if (v < lim) recent.delete(k); }); }
    let mode = "cards";
    try { if (rv && rv.s && rv.s.mode) mode = rv.s.mode; } catch (e) {}
    const v = ok ? num(XP_RULES.answer[mode], XP_RULES.answer.cards) : XP_RULES.wrong;
    const x = data();
    x.answers = Math.min(XP_MAX, x.answers + 1);
    const got = add(v, L, todayStr(new Date(now)));
    bump(ch => ch.k === "cards" || (ch.k === "correct" && ok) || (ch.k === "lang" && ch.p === L));
    checkBadges();
    return got;
  }
  // Fin d'une session ou d'une partie (une seule fois : s.xpDone). info = { mode, cards, answers, perfect, game, record, lang }
  function onSessionEnd(s, info) {
    if (!s || s.xpDone || !info) return 0;
    s.xpDone = true;
    checkUser();
    const x = data(), count = Math.max(num(info.cards, 0), num(info.answers, 0));
    if (count <= 0) return 0;
    const m = String(info.mode || "cards");
    if (/^[a-z]{2,12}$/.test(m)) x.use[m] = Math.min(1000000, num(x.use[m], 0) + 1);
    let got = 0;
    if (count >= XP_RULES.sessionMin) got += add(XP_RULES.session, isLang(info.lang) ? info.lang : null);
    const perfect = !!info.perfect && num(info.cards, 0) >= XP_PERFECT_MIN;
    if (perfect) {
      x.perfects = Math.min(1000000, x.perfects + 1);
      bump(c => c.k === "perfect");
      earn("perfect1");
    }
    if (info.game && count >= XP_RULES.sessionMin) bump(c => c.k === "game");
    if (count >= XP_RULES.sessionMin) bump(c => c.k === "mode" && c.p === m);
    if (info.record) earn("race1");
    checkBadges();
    commitQuiet();
    return got;
  }
  // --- Duels (étape 44) : XP donnés une seule fois par duel (clés « p:<id> » partie jouée, « w:<id> » victoire, morceau xp) ---
  function duelOnce(key) {
    const x = data();
    if (!Array.isArray(x.duels)) x.duels = [];
    if (x.duels.includes(key)) return false;
    x.duels = x.duels.concat(key).slice(-200);
    return true;
  }
  // Partie de duel envoyée : oks = [juste ?] par question, L = langue du duel. Ne touche pas la progression des cartes.
  function onDuel(id, oks, L) {
    checkUser();
    if (!id || !duelOnce("p:" + id)) return 0;
    const x = data(), lang = isLang(L) ? L : null;
    let got = 0;
    arr(oks).forEach(ok => { got += add(ok ? num(XP_RULES.answer[XP_RULES.duel.mode], 1) : XP_RULES.wrong, lang); });
    x.answers = Math.min(XP_MAX, x.answers + arr(oks).length);
    if (arr(oks).length >= XP_RULES.sessionMin) got += add(XP_RULES.session, lang);
    checkBadges();
    commitQuiet();
    return got;
  }
  // Duel gagné (vu dans la liste des duels) : bonus une seule fois.
  function onDuelWin(id) {
    checkUser();
    if (!id || !duelOnce("w:" + id)) return 0;
    const got = add(XP_RULES.duel.win, null);
    checkBadges();
    commitQuiet();
    return got;
  }
  // Histoire (étape 45) : XP donnés par js/story.js (qui garde sur l'histoire ce qui a déjà rapporté). Ne touche pas aux cartes
  // ni aux défis du jour.
  function onStory(v, L) {
    checkUser();
    const got = add(v, isLang(L) ? L : null);
    checkBadges();
    commitQuiet();
    return got;
  }
  // Mode « le / la ? » (étape 60) : +XP_RULES.gender.correct par bonne réponse, rien d'autre (pas de compteur de réponses, de défi,
  // de série ni de fin de session). Anti-triche propre au mode (clé « g|carte|langue »). Renvoie les XP gagnés.
  function onGender(c, L, ok) {
    if (!ok || !c) return 0;
    checkUser();
    const now = Date.now(), key = "g|" + c.id + "|" + (L || "");
    const last = recent.get(key);
    if (last && now - last < XP_RULES.repeatMs) return 0;
    recent.set(key, now);
    const got = add(XP_RULES.gender.correct, isLang(L) ? L : null);
    checkBadges();
    commitQuiet();
    return got;
  }
  // « Ma phrase » (étape 58) : +5 XP à l'envoi ; js/sentences.js garde sur la phrase (champ xp) qu'elle a déjà rapporté.
  function onSentence(L) { return onStory(XP_RULES.sentence.send, L); }
  // Récompense d'une idée (étape 52, js/ideas.js) : une seule fois par idée sur ce compte (xp.ideas, morceau xp synchronisé).
  // v = XP à ajouter (gels sans place déjà convertis), badge = badge « Idée retenue ». Pas de sauvegarde ici : l'appelant
  // enregistre en une fois (XP et gels). Renvoie null si l'idée a déjà été récompensée, sinon { xp, badge (nouveau) }.
  function onIdea(id, v, badge) {
    checkUser();
    const x = data();
    if (!Array.isArray(x.ideas)) x.ideas = [];
    if (!id || x.ideas.includes(id)) return null;
    x.ideas = x.ideas.concat(id).slice(-200);
    const got = add(v, null);
    const b = badge ? earn("idea1") : false;
    checkBadges();
    return { xp: got, badge: b };
  }
  // Récompense d'objectif d'équipe (étape 54) : réservée sur le serveur (team_reward_claim) par js/teams.js, appliquée
  // ici une seule fois par semaine (week = lundi « AAAA-MM-JJ », gardé dans x.teams, morceau xp synchronisé). Sans sauvegarde :
  // l'appelant enregistre (commit). Renvoie { xp, badge } ou null si déjà appliquée.
  function onTeam(week, v, badge) {
    checkUser();
    const x = data();
    if (!Array.isArray(x.teams)) x.teams = [];
    if (!xpDayOk(week) || x.teams.includes(week)) return null;
    x.teams = x.teams.concat(week).sort().slice(-60);
    const got = add(v, null);
    const b = badge ? earn("team1") : false;
    checkBadges();
    return { xp: got, badge: b };
  }
  // Jour de série validé (Streak : objectif du jour atteint).
  function onStreakDay(day) { checkUser(); return add(XP_RULES.streakDay, null, day); }
  // Au lancement et au changement de jour (appelé par Streak.tick) : défis du jour, badges et niveau en retard.
  function tick() {
    if (!Storage.getUser()) return;
    checkUser();
    challenges();
    checkBadges();
    checkLevel();
  }

  // --- Badges et niveaux ---
  function has(id) { return data().badges.some(b => b.id === id); }
  function earn(id) {
    if (!XP_BADGE_IDS.includes(id) || has(id)) return false;
    data().badges.push({ id, day: todayStr() });
    const b = XP_BADGES.find(x => x.id === id);
    pop(b.icon, t("xp.badgeNew"), t("xp.badge." + id));
    commitLater();
    return true;
  }
  function checkBadges() {
    const x = data(), L = xpLevel(x.total);
    XP_BADGES.forEach(b => {
      if ((b.cards && x.answers >= b.cards) || (b.level && L >= b.level) || (b.chDays && x.chDays.length >= b.chDays)) earn(b.id);
    });
  }
  function checkLevel() {
    const x = data(), L = xpLevel(x.total);
    if (L > x.levelSeen) {
      x.levelSeen = L;
      pop("⬆️", t("xp.levelUp", { n: L }), t("xp.levelSub"), "xp-lvl");
      commitLater();
    }
  }
  // Petites animations, l'une après l'autre (jamais superposées).
  function pop(ic, tx, sb, cls) { pops.push({ ic, tx, sb, cls }); runPops(); }
  function runPops() {
    if (popBusy || !pops.length) return;
    popBusy = true;
    const p = pops.shift();
    try {
      const box = el("div", "sk-pop xp-pop" + (p.cls ? " " + p.cls : ""));
      box.setAttribute("role", "status");
      box.append(el("span", "ic", p.ic), el("div", "tx", p.tx));
      if (p.sb) box.appendChild(el("div", "sb", p.sb));
      document.body.appendChild(box);
      setTimeout(() => box.remove(), 3000);
    } catch (e) {}
    setTimeout(() => { popBusy = false; runPops(); }, 3100);
  }

  // --- Lecture (Accueil, Stats, amis) ---
  function summary() {
    const x = data(), w = xpWeek(x);
    return Object.assign(xpProgress(x.total), { total: x.total, week: w.total, weekByLang: w.byLang, byLang: x.byLang,
      chDone: x.chDone, chDays: x.chDays.length, answers: x.answers });
  }
  return { data, reset, tick, onAnswer, onSessionEnd, onStreakDay, onDuel, onDuelWin, onStory, onSentence, onGender, onIdea, onTeam, challenges, label, icon, summary, has, earn };
})();

// --- Affichage commun : barre de niveau (Accueil, Stats) ---
function xpLevelBlock(sum) {
  const box = el("div", "xp-lvl-box");
  const hd = el("div", "xp-lvl-hd");
  hd.append(el("span", "xp-lvl-n", "⭐ " + t("xp.level", { n: sum.level })), el("span", "xp-lvl-x", t("xp.toNext", { a: dashFmt(sum.into), b: dashFmt(sum.need) })));
  const bar = el("div", "sk-bar xp-bar");
  const fill = el("span");
  fill.style.width = sum.pct + "%";
  bar.appendChild(fill);
  bar.setAttribute("role", "progressbar"); bar.setAttribute("aria-valuemin", "0"); bar.setAttribute("aria-valuemax", String(sum.need));
  bar.setAttribute("aria-valuenow", String(sum.into)); bar.setAttribute("aria-label", t("xp.level", { n: sum.level }));
  box.append(hd, bar, el("div", "xp-lvl-sub", t("xp.totalWeek", { t: dashFmt(sum.total), w: dashFmt(sum.week) })));
  return box;
}
// Accueil : niveau + défis du jour.
function renderHomeXp() {
  const lv = $("#homeXp"), cb = $("#homeChallenges");
  if (!lv || !cb || !Storage.getUser()) return;
  const sum = XP.summary();
  lv.textContent = "";
  lv.appendChild(xpLevelBlock(sum));
  cb.textContent = "";
  const ch = XP.challenges();
  const hd = el("div", "sk-goal-hd");
  hd.append(el("h2", null, t("xp.ch.title")), el("span", "sk-goal-n", t("xp.ch.count", { n: ch.list.filter(c => c.done).length })));
  cb.appendChild(hd);
  const ul = el("ul", "xp-ch");
  ch.list.forEach(c => {
    const li = el("li", "xp-ch-row" + (c.done ? " done" : ""));
    li.appendChild(el("span", "xp-ch-ic", c.done ? "✅" : XP.icon(c)));
    const mid = el("div", "xp-ch-mid");
    mid.appendChild(el("div", "xp-ch-lbl", XP.label(c)));
    const bar = el("div", "sk-bar xp-ch-bar" + (c.done ? " done" : ""));
    const f = el("span"); f.style.width = Math.round(c.v * 100 / c.n) + "%"; bar.appendChild(f);
    bar.setAttribute("role", "progressbar"); bar.setAttribute("aria-valuemin", "0"); bar.setAttribute("aria-valuemax", String(c.n));
    bar.setAttribute("aria-valuenow", String(c.v)); bar.setAttribute("aria-label", XP.label(c));
    mid.appendChild(bar);
    li.appendChild(mid);
    li.appendChild(el("span", "xp-ch-v", c.done ? "+" + XP_RULES.challenge : c.v + " / " + c.n));
    ul.appendChild(li);
  });
  cb.appendChild(ul);
  cb.appendChild(el("div", "sk-goal-txt", ch.bonus ? t("xp.ch.bonusGot", { n: XP_RULES.allChallenges }) : t("xp.ch.bonus", { n: XP_RULES.allChallenges })));
}
// Stats : XP, niveau, XP par langue, défis réussis.
function statsXp() {
  const sum = XP.summary(), card = el("div", "card");
  card.appendChild(el("h2", null, "⭐ " + t("xp.title")));
  card.appendChild(xpLevelBlock(sum));
  const tiles = el("div", "st-tiles");
  tiles.append(stTile(dashFmt(sum.total), t("xp.total")), stTile(dashFmt(sum.week), t("xp.week")),
    stTile(dashFmt(sum.chDone), t("xp.chDone")), stTile(dashFmt(sum.chDays), t("xp.chDays")));
  card.appendChild(tiles);
  const langs = LANG_CODES.filter(L => sum.byLang[L] || sum.weekByLang[L]);
  if (langs.length) {
    const tb = el("table", "aq-table xp-langs");
    const hr = el("tr");
    [t("fc.lang"), t("xp.total"), t("xp.week")].forEach((h, i) => hr.appendChild(el("th", i ? "num" : null, h)));
    const th = el("thead"); th.appendChild(hr); tb.appendChild(th);
    const body = el("tbody");
    langs.forEach(L => {
      const tr = el("tr");
      tr.append(el("td", null, langName(L)), el("td", "num", dashFmt(num(sum.byLang[L], 0))), el("td", "num", dashFmt(num(sum.weekByLang[L], 0))));
      body.appendChild(tr);
    });
    tb.appendChild(body);
    card.appendChild(el("h3", "xp-h3", t("xp.byLang")));
    const wrap = el("div", "aq-tablewrap"); wrap.appendChild(tb); card.appendChild(wrap);
  }
  card.appendChild(el("div", "hint", t("xp.rules", { a: XP_RULES.answer.cards, w: XP_RULES.answer.write, s: XP_RULES.session, c: XP_RULES.challenge, b: XP_RULES.allChallenges, d: XP_RULES.streakDay })));
  return card;
}
// Badges de l'étape 43 dans la grille des badges (Stats).
function xpBadgeCells(grid) {
  const x = XP.data();
  XP_BADGES.forEach(b => {
    const got = x.badges.find(y => y.id === b.id);
    const c = el("div", "sk-badge " + (got ? "on" : "off"));
    c.append(el("div", "ic", b.icon), el("div", "nm", t("xp.badge." + b.id)),
      el("div", "dt", got ? (got.day ? dashBucketLabel(got.day, false, true) : t("sk.badgeGot")) : t("sk.badgeTodo")));
    c.title = t("xp.badge." + b.id) + " — " + (got ? t("sk.badgeGot") : t("sk.badgeTodo"));
    grid.appendChild(c);
  });
}
// Résumé de fin de session / partie : « +N XP ».
function xpGainLine(s) {
  const n = num(s && s.xpGain, 0);
  return n > 0 ? el("div", "xp-gain", t("xp.plus", { n })) : null;
}
