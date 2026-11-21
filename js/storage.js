"use strict";

// ====================================================================================================
// js/storage.js — DATA MODEL (DATA_VERSION, normalizeData, migrations, morceaux hard / tips / progres / tombs)
// Modèle de données et normalisation ; règles des mots difficiles (57), de l'apprentissage auditif (55), des bons moments (61)
// et des progrès visibles (64). Étape 65 : la couche STORAGE est dans js/storage-sync.js, SUPABASE et EXPORT / IMPORT
// dans js/storage-supabase.js (chargés juste après, dans cet ordre).
// ====================================================================================================

// === DATA MODEL ===
// Version 2 : cartes multilingues (terms), dossiers, langue apprise et langues d'appui par compte / dossier / liste.
// Version 3 : types de cartes (champ type : vocab, conj, cloze, fix, rule — voir TYPES DE CARTES).
// Version 4 : séries façon Duolingo (settings.dailyGoal, settings.privacy, streak — voir SÉRIES).
// Version 5 : profil de langues (settings.learning) et exemples par langue (cards[].examples) — étape 35, voir LANGUES.
// Version 6 : langues étudiées d'une liste (lists[].targets) et progression par langue (cards[].progress) — étape 37.
// Version 7 : répétition FSRS — champs s, d, last, reps, lapses, state (+ lb) dans cards[].progress[langue] — étape 47.
// Version 8 : progrès visibles — étape 64 : morceau « progres » (mots appris de la semaine, bilan d'oubli), dernière réponse
//   cards[].progress[langue].lr, réglage settings.privacy.learned. Migration 7 → 8 sans rien changer d'autre (morceau vide,
//   réglage activé par défaut) ; export JSON de sécurité avant (syncWithRemote). Un appareil en version 63 voit alors des
//   données « trop récentes » (Release.dataTooNew) et n'écrit plus rien tant qu'il n'est pas mis à jour.
// Version 9 : fusion des appareils — étape 78 (js/fusion.js) : date de dernière modification du contenu `m` (facultative) sur
//   chaque carte, liste, dossier et sur settings ; morceau « tombs » (pierres tombales des cartes, listes et dossiers
//   supprimés : { c | l | f: { id: [date, m de l'élément supprimé] } }). Migration 8 → 9 : rien n'est touché (tombs vide,
//   aucun `m`) ; copie de sécurité et export JSON avant (syncWithRemote). Un appareil en version 77 ou moins est bloqué.
const DATA_VERSION = 9;
const PRIVACY_KEYS = ["streak", "today", "week", "success", "badges", "ranking", "shared", "xp", "learned"];   // ce que mes amis voient (étape 29 ; shared : étape 30 ; xp : étape 43 ; learned : mots appris de la semaine, étape 64)
function defaultPrivacy() { const o = {}; PRIVACY_KEYS.forEach(k => { o[k] = true; }); return o; }
function normPrivacy(p) { const o = defaultPrivacy(); if (p && typeof p === "object") PRIVACY_KEYS.forEach(k => { if (p[k] === false) o[k] = false; }); return o; }
// Jeux d'entraînement (étape 42) : settings.games = { sounds (désactivé par défaut), records { clé: meilleur score } }.
// Dans le morceau settings (aucun nouveau morceau) ; 200 records au plus.
// Écoute et parole (étape 46) : settings.listen = { slow } (vitesse de la dictée), aussi dans le morceau settings.
// FSRS (étape 47) : settings.retention = taux de rétention visé en % (75 à 97, 90 par défaut ; FSRS_RET), dans le morceau settings.
function normGames(g) {
  const o = { sounds: false, records: {} };
  if (!g || typeof g !== "object") return o;
  o.sounds = g.sounds === true;
  const r = g.records && typeof g.records === "object" && !Array.isArray(g.records) ? g.records : {};
  Object.keys(r).slice(-200).forEach(k => { const v = clampInt(r[k], 0, 100000, 0); if (k.length <= 120 && v > 0) o.records[k] = v; });
  return o;
}

// Langue de l'interface à la première ouverture : celle du téléphone si ko ou fr, sinon anglais.
function defaultLang() {
  const l = (navigator.language || "").toLowerCase();
  if (l.startsWith("ko")) return "ko";
  if (l.startsWith("fr")) return "fr";
  return "en"; // anglais, ou toute autre langue du téléphone
}

// target : 1re langue apprise ; support : sa langue d'appui (facultative, null = aucune).
function defaultSettings(target, support) {
  const tg = isLang(target) ? target : (isLang(LANG_DEFAULT) ? LANG_DEFAULT : LANG_CODES[0]);
  return {
    uiLang: defaultLang(), theme: "auto", sessionSize: 20,
    learning: normLearning([{ lang: tg, support: isLang(support) ? support : null }]),   // profil de langues (étape 35)
    defaultTarget: tg, defaultSupport: [],                                             // anciens champs, ignorés
    audio: { auto: true, langs: "target", learn: normAudLearn(null) },                 // learn : apprentissage auditif (étape 55)
    dailyGoal: 10, privacy: defaultPrivacy(),
    games: normGames(null),                                                            // jeux (étape 42)
    listen: { slow: false },                                                           // dictée : lecture lente (étape 46)
    retention: FSRS_RET.def,                                                           // FSRS : taux de rétention visé (étape 47)
    sentence: { on: true },                                                            // « Ma phrase » : proposition après un « Trouvé » (étape 58)
    gender: { colors: true, symbols: false },                                          // genre des noms : couleurs (défaut oui), mode daltonien ♂♀⚥ (étape 60)
    morning: normMorning(null)                                                         // rappel du matin, heure du soir, notification (étape 61)
  };
}

function emptyData(target, support) {
  return {
    version: DATA_VERSION,
    updatedAt: 0,
    settings: defaultSettings(target, support),
    folders: [],     // { id, name, order, target?, legacySupport? }
    lists: [],       // { id, name, folderId|null, order, target?, targets? (langues étudiées, étape 37), support? (code | null : remplace l'appui du profil), legacySupport?, createdAt }
    cards: [],       // { id, listId, type, ... } (voir newCard et TYPES DE CARTES)
    history: [],
    streak: normStreak(null, []),   // série (voir SÉRIES)
    xp: normXp(null, [], null, null),   // XP, niveaux, défis du jour (étape 43, js/xp.js)
    sentences: [],   // « Ma phrase » (étape 58, js/sentences.js) : phrases envoyées à Claude, 200 max
    stories: {},     // histoires par liste (étape 45, js/story.js) : { <id de liste>: [histoire…] }
    hard: normHard(null),   // mots difficiles : compteurs, pause, paires (étape 57, js/difficiles.js)
    tips: {},               // « Mon astuce » privée par carte (étape 57)
    progres: normProgres(null),   // mots appris de la semaine, bilan d'oubli (étape 64, js/progres.js)
    tombs: normTombs(null),       // pierres tombales : cartes, listes, dossiers supprimés (étape 78, js/fusion.js)
    proposals: [],   // propositions « À valider » : { id, cardId, field (code de langue | example | extr:<code> | pos:<code> | dup), type, oldValue, newValue, reason, createdAt }
    rejected: [],    // clés des propositions refusées (carte|champ|empreinte de la valeur) : jamais reproposées
    lastCheckAt: 0,  // dernière vérification automatique (0 = pas encore démarrée)
    checkedSig: {},  // { idCarte: empreinte } des cartes déjà vérifiées par Claude
    aiResume: null   // complétion en pause : { kind: "complete", ids: [cartes restantes] }
  };
}

// terms : { fr: "...", ko: "...", ... } (une entrée par langue, vide permis)
// example : texte (exemple dans la langue apprise de la liste, ou de target si donné) ou objet examples ({ it: { text, tr } }).
function newCard(listId, terms, example, tags, pos, target) {
  let examples = {}, ex = "";
  if (example && typeof example === "object") examples = normExamples(example);
  else if (example) {
    ex = String(example).trim();
    let tg = isLang(target) ? target : "";
    if (!tg) { try { if (getList(listId)) tg = listLangs(listId).target; } catch (e) {} }
    if (tg && ex) examples[tg] = { text: ex, tr: {} };
  }
  if (isLang(target) && examples[target]) ex = examples[target].text;
  return {
    id: uid(), listId, type: "vocab",
    terms: normTerms(terms),
    pos: normTerms(pos),
    examples,
    example: ex,
    tags: tags || [],
    auto: [],
    box: 0,
    dueAt: Date.now(),
    stats: { seen: 0, correct: 0, wrong: 0, lastSeen: null }
  };
}

// Garde les entrées texte non vides dont la clé ressemble à un code de langue (même une langue retirée de LANGUAGES).
function normTerms(o) {
  const out = {};
  if (o && typeof o === "object" && !Array.isArray(o)) {
    Object.keys(o).forEach(k => {
      const v = o[k] == null ? "" : String(o[k]).trim();
      if (v && /^[a-z]{2,3}(-[a-z0-9]+)?$/i.test(k)) out[k] = v;
    });
  }
  return out;
}
// Langue apprise d'un dossier / d'une liste, et remplacement de l'appui (étape 35 : code ou null).
// Ancien tableau support (étapes 1 à 34, ignoré depuis l'étape 31) : gardé dans legacySupport.
function normLangPair(o) {
  const out = {};
  if (!o) return out;
  if (isLang(o.target)) out.target = o.target;
  if (Array.isArray(o.legacySupport)) out.legacySupport = cleanSupport(o.legacySupport, o.target);
  if (Array.isArray(o.support)) { if (!out.legacySupport && isLang(o.target)) out.legacySupport = cleanSupport(o.support, o.target); }
  else { const ov = supportOverride(o); if (ov !== undefined) out.support = ov; }
  return out;
}

// Carte v3 ; carte v2 (sans type → "vocab") ; carte v1 (un champ par langue : { ko, en, fr }) convertie.
function normalizeCard(c) {
  const st = c.stats || {};
  const v1 = {};
  LANG_CODES.forEach(k => { v1[k] = c[k]; });
  const terms = (c.terms && typeof c.terms === "object") ? normTerms(c.terms) : normTerms(v1);
  const type = cardType(c);
  const out = {
    id: String(c.id),
    listId: String(c.listId || ""),
    type,
    terms,
    pos: normTerms(c.pos),
    example: String(c.example || ""),
    tags: arr(c.tags).map(String).filter(Boolean),
    auto: arr(c.auto).map(String),
    box: clampInt(c.box, 0, 5, 0),
    dueAt: num(c.dueAt, Date.now()),
    stats: { seen: num(st.seen, 0), correct: num(st.correct, 0), wrong: num(st.wrong, 0), lastSeen: num(st.lastSeen, null) }
  };
  const pg = normProgress(c.progress);                                               // étape 37 : progression par langue
  if (Object.keys(pg).length) out.progress = pg;
  if (num(c.m, 0) > 0) out.m = num(c.m, 0);                                          // étape 78 : dernière modification du contenu
  if (type === "vocab") {
    out.examples = normExamples(c.examples);                                         // étape 35 (fiche de règle : examples = liste)
    // Dictionnaire commun (étape 36) : sens relié et cases « version perso » ; absents si la carte n'est pas reliée.
    if (typeof c.senseId === "string" && /^[0-9a-f-]{36}$/i.test(c.senseId)) out.senseId = c.senseId;
    const own = [...new Set(arr(c.own).filter(k => typeof k === "string" && /^[wpet]:[a-z]/.test(k)))].slice(0, 200);
    if (out.senseId && own.length) out.own = own;
    const im = normCardImage(c.image);                                               // étape 49 : image de la carte (facultative)
    if (im) out.image = im;
    return out;
  }
  return Object.assign(out, normTypedFields(type, c));
}

// Image d'une carte vocab (étape 49) : { path, src: "photo" | "wikimedia", author, license, page, size } ou null.
// path = <id du compte>/<nom>.webp|jpg (bucket card-images, Supabase Storage) ; champ facultatif (DATA_VERSION inchangé).
// Les versions 48 et moins ne le connaissent pas : un appareil resté en 48 qui renvoie ses cartes l'efface.
const IMG_PATH_RE = /^(?:[0-9a-f-]{36}|common\/[0-9a-f-]{36})\/[A-Za-z0-9_-]{1,80}\.(?:webp|jpg)$/;
function normCardImage(o) {
  if (!o || typeof o !== "object" || Array.isArray(o) || typeof o.path !== "string" || !IMG_PATH_RE.test(o.path)) return null;
  const txt = (v, n) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, n);
  const page = txt(o.page, 500);
  return { path: o.path, src: o.src === "wikimedia" ? "wikimedia" : "photo", author: txt(o.author, 300), license: txt(o.license, 60),
    page: /^https:\/\//.test(page) ? page : "", size: clampInt(o.size, 0, 10000000, 0) };
}
// Réglage « Images » d'une liste (étape 49) : imgSide = "q" (côté question) | "a" (côté réponse) | "never" ; absent = automatique.
function normImgSide(o) { return o && ["q", "a", "never"].includes(o.imgSide) ? { imgSide: o.imgSide } : {}; }
// === MOTS DIFFICILES (ÉTAPE 57) ===
// state.hard = { v: 1, w: { <idCarte>: { <langue étudiée>: { n, r, o?, h?, f?, p?, at? } } }, c: [ { a, b, L, n, at } ] }
//   n = « Raté » au total, r = « Raté » de suite, o = « Trouvé » de suite (seulement si difficile), h = 1 difficile,
//   f = 1 réparé (image, exemple ou astuce enregistrés depuis que le mot est difficile), p = 1 en pause, at = date (ms).
//   c = paires confondues (a < b, ids de cartes, L = langue étudiée, n = nombre de confusions), 300 au plus.
// state.tips = { <idCarte>: texte (150 caractères au plus) }. Deux morceaux user_data (hard, tips), jamais dans une carte ni dans sharedprogress.
// Champs facultatifs (DATA_VERSION inchangé) : un appareil en version 56 les efface en renvoyant ses données.
const HARD_TIP_MAX = 150;
const HARD_PAIRS_MAX = 300;
function normHardRec(v) {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = { n: clampInt(v.n, 0, 9999, 0), r: clampInt(v.r, 0, 9999, 0) };
  if (v.h) { o.h = 1; o.o = clampInt(v.o, 0, 99, 0); if (v.f) o.f = 1; o.at = num(v.at, 0); }
  if (v.p) o.p = 1;
  return (o.n || o.r || o.h || o.p) ? o : null;
}
function normHard(raw, cardIds, keepUnknown) {
  const out = { v: 1, w: {}, c: [] };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  const known = id => keepUnknown || !cardIds || cardIds.has(id);
  const W = raw.w && typeof raw.w === "object" && !Array.isArray(raw.w) ? raw.w : {};
  Object.keys(W).forEach(id => {
    if (!known(id) || !W[id] || typeof W[id] !== "object") return;
    const e = {};
    Object.keys(W[id]).forEach(L => { if (!isLang(L)) return; const r = normHardRec(W[id][L]); if (r) e[L] = r; });
    if (Object.keys(e).length) out.w[id] = e;
  });
  const seen = new Set();
  arr(raw.c).forEach(p => {
    if (!p || typeof p.a !== "string" || typeof p.b !== "string" || p.a === p.b || !isLang(p.L)) return;
    const a = p.a < p.b ? p.a : p.b, b = p.a < p.b ? p.b : p.a, k = a + "|" + b + "|" + p.L;
    if (seen.has(k) || !known(a) || !known(b)) return;
    seen.add(k);
    out.c.push({ a, b, L: p.L, n: clampInt(p.n, 1, 9999, 1), at: num(p.at, 0) });
  });
  out.c.sort((x, y) => y.n - x.n || y.at - x.at);
  out.c = out.c.slice(0, HARD_PAIRS_MAX);
  return out;
}
function hardHas(h) { return !!h && ((h.w && Object.keys(h.w).length > 0) || arr(h.c).length > 0); }
function normTips(raw, cardIds, keepUnknown) {
  const out = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  Object.keys(raw).forEach(id => {
    if (!(keepUnknown || !cardIds || cardIds.has(id))) return;
    const v = String(raw[id] == null ? "" : raw[id]).replace(/\s+/g, " ").trim().slice(0, HARD_TIP_MAX);
    if (v) out[id] = v;
  });
  return out;
}
// === APPRENTISSAGE AUDITIF (ÉTAPE 55) ===
// Réglage du compte : settings.audio.learn = { when: off|wrong|right|always, langs: target|both, repeat: 1..3 }.
// Réglage d'une liste : audioLearn absent = comme le compte ; "off" = jamais ; objet = réglage propre (même forme).
// Champs facultatifs (DATA_VERSION inchangé) : un appareil en version 54 les efface en renvoyant ses données.
const AUD_WHEN = ["off", "wrong", "right", "always"];
const AUD_LANGS = ["target", "both"];
const AUD_REPEAT = { min: 1, max: 3, def: 2 };
function normAudLearn(o) {
  const x = (o && typeof o === "object" && !Array.isArray(o)) ? o : {};
  return { when: AUD_WHEN.includes(x.when) ? x.when : "off", langs: AUD_LANGS.includes(x.langs) ? x.langs : "both",
    repeat: clampInt(x.repeat, AUD_REPEAT.min, AUD_REPEAT.max, AUD_REPEAT.def) };
}
function normListAudLearn(o) {
  const v = o && o.audioLearn;
  if (v === "off") return { audioLearn: "off" };
  return (v && typeof v === "object" && !Array.isArray(v)) ? { audioLearn: normAudLearn(v) } : {};
}
// === BONS MOMENTS POUR RÉVISER (ÉTAPE 61) ===
// settings.morning = { on, evening, notif, hour } : rappel du matin activé (défaut oui), heure où commence le soir
// (16 à 23 h, défaut 19 h), notification du matin (défaut oui) et son heure (5 à 11 h, défaut 8 h). Logique : js/moments.js.
// Champ facultatif (DATA_VERSION inchangé) : un appareil en version 60 l'efface en renvoyant ses réglages (retour aux défauts).
const MOM_EVENING = { min: 16, max: 23, def: 19 };
const MOM_HOUR = { min: 5, max: 11, def: 8 };
function normMorning(o) {
  const x = (o && typeof o === "object" && !Array.isArray(o)) ? o : {};
  return { on: x.on !== false, evening: clampInt(x.evening, MOM_EVENING.min, MOM_EVENING.max, MOM_EVENING.def),
    notif: x.notif !== false, hour: clampInt(x.hour, MOM_HOUR.min, MOM_HOUR.max, MOM_HOUR.def) };
}
// === PROGRÈS VISIBLES (ÉTAPE 64) ===
// state.progres (morceau user_data « progres », logique dans js/progres.js) :
//   { v: 1, s: jour de départ (AAAA-MM-JJ, premier lancement en version 64),
//     l: [[jour, idCarte, langue]] — mots devenus « Acquis » (une fois par carte, langue et semaine), PRG_KEEP_DAYS jours,
//     f: { jour: { g: { clé de groupe: [réponses, Raté, Hésité] }, x: [[idCarte, langue, "u" | "r"]] } } — réponses notées
//        sur un mot dont la réponse d'avant était « Trouvé » (bilan d'oubli), PRG_F_DAYS jours ; x = mots ratés / hésités
//        (« Réviser ces mots »), PRG_X_MAX par jour. Clés de groupe : "p:<nature>" (n, v, adj…), "l:<liste>", "t:<type>",
//        "c:<langue>|<temps>".
//     m: lundi dont le rappel du bilan a été fermé sur l'Accueil }
// Dernière réponse d'une carte : progress[langue].lr = "k" (Trouvé) | "r" (Hésité) | "u" (Raté), écrit par Leitner.grade.
const PRG_KEEP_DAYS = 70;
const PRG_F_DAYS = 31;
const PRG_X_MAX = 150;
const PRG_DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const PRG_KEY_RE = /^(p|l|t|c):[^\s"]{1,80}$/;
function normProgres(raw, cardIds, keepUnknown) {
  const out = { v: 1, s: "", l: [], f: {}, m: "" };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  const known = id => keepUnknown || !cardIds || cardIds.has(id);
  const today = todayStr();
  if (typeof raw.s === "string" && PRG_DAY_RE.test(raw.s)) out.s = raw.s;
  if (typeof raw.m === "string" && PRG_DAY_RE.test(raw.m)) out.m = raw.m;
  const lFrom = skAdd(today, -PRG_KEEP_DAYS), seen = new Set();
  arr(raw.l).forEach(e => {
    if (!Array.isArray(e) || typeof e[0] !== "string" || !PRG_DAY_RE.test(e[0]) || e[0] < lFrom || e[0] > skAdd(today, 1)) return;
    const id = typeof e[1] === "string" ? e[1].slice(0, 80) : "", L = e[2];
    if (!id || !isLang(L) || !known(id)) return;
    const k = e[0] + "|" + id + "|" + L;
    if (seen.has(k)) return;
    seen.add(k);
    out.l.push([e[0], id, L]);
  });
  out.l.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  if (out.l.length > 5000) out.l = out.l.slice(-5000);
  const F = raw.f && typeof raw.f === "object" && !Array.isArray(raw.f) ? raw.f : {};
  const fFrom = skAdd(today, -PRG_F_DAYS);
  Object.keys(F).forEach(day => {
    const v = F[day];
    if (!PRG_DAY_RE.test(day) || day < fFrom || day > skAdd(today, 1) || !v || typeof v !== "object") return;
    const g = {}, G = v.g && typeof v.g === "object" && !Array.isArray(v.g) ? v.g : {};
    Object.keys(G).slice(0, 400).forEach(k => {
      const a = G[k];
      if (!PRG_KEY_RE.test(k) || !Array.isArray(a)) return;
      const n = clampInt(a[0], 0, 100000, 0);
      if (!n) return;
      const u = clampInt(a[1], 0, n, 0), r = clampInt(a[2], 0, n - u, 0);
      g[k] = [n, u, r];
    });
    const x = [], xs = new Set();
    arr(v.x).forEach(e => {
      if (!Array.isArray(e) || typeof e[0] !== "string" || !isLang(e[1]) || !["u", "r"].includes(e[2])) return;
      const id = e[0].slice(0, 80), k = id + "|" + e[1];
      if (!id || xs.has(k) || !known(id)) return;
      xs.add(k);
      x.push([id, e[1], e[2]]);
    });
    if (Object.keys(g).length || x.length) out.f[day] = { g, x: x.slice(0, PRG_X_MAX) };
  });
  return out;
}
function progresHas(p) { return !!p && (arr(p.l).length > 0 || (p.f && Object.keys(p.f).length > 0) || !!p.m || !!p.s); }

// Progression par langue étudiée (étape 37) : { <langue>: { box, dueAt, stats } }.
// box / dueAt / stats de la carte = copie de la progression de sa langue principale (anciennes versions, fiche admin…).
// Étape 47 : + champs FSRS (s, d, last, reps, lapses, state, lb) gardés s'ils existent (fsrsNorm, js/fsrs.js) ; absents
// (données v6) → ajoutés par la migration 6 → 7 (normalizeData).
function normProgress(p) {
  const out = {};
  if (!p || typeof p !== "object" || Array.isArray(p)) return out;
  Object.keys(p).forEach(L => {
    const v = p[L];
    if (!isLang(L) || !v || typeof v !== "object") return;
    const st = v.stats || {};
    out[L] = { box: clampInt(v.box, 0, 5, 0), dueAt: num(v.dueAt, 0),
      stats: { seen: num(st.seen, 0), correct: num(st.correct, 0), wrong: num(st.wrong, 0), lastSeen: num(st.lastSeen, null) } };
    const F = fsrsNorm(v);
    if (F) Object.assign(out[L], F);
    if (["k", "r", "u"].includes(v.lr)) out[L].lr = v.lr;   // dernière réponse (étape 64, bilan d'oubli)
  });
  return out;
}
// Langues étudiées enregistrées d'une liste (étape 37) : codes connus, sans doublon.
function normTargets(t) { const out = []; arr(t).forEach(x => { if (isLang(x) && !out.includes(x)) out.push(x); }); return out.length ? { targets: out } : {}; }

// Date de la dernière « Mise à jour » d'une liste ou d'un dossier (absente si jamais faite).
function lastUpdateOf(o) { const v = num(o && o.lastUpdate, 0); return v > 0 ? { lastUpdate: v } : {}; }

// Étape 78 : date de dernière modification du contenu d'une liste / d'un dossier (absente si jamais modifié depuis la version 78).
function modAtOf(o) { const v = num(o && o.m, 0); return v > 0 ? { m: v } : {}; }
// Étape 78 : pierres tombales { c, l, f: { id: [date de suppression, m de l'élément supprimé] } }. Un élément qui existe
// (live.c / live.l / live.f : ensembles d'identifiants) n'a jamais de pierre tombale ; gardées TOMB_KEEP_DAYS jours, TOMB_MAX au plus.
const TOMB_KEEP_DAYS = 365;
const TOMB_MAX = 10000;
function normTombs(raw, live) {
  const out = { c: {}, l: {}, f: {} };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  const from = Date.now() - TOMB_KEEP_DAYS * 86400000;
  ["c", "l", "f"].forEach(k => {
    const src = raw[k] && typeof raw[k] === "object" && !Array.isArray(raw[k]) ? raw[k] : {};
    let ent = [];
    Object.keys(src).forEach(id => {
      const v = src[id], at = num(Array.isArray(v) ? v[0] : v, 0);
      if (!id || id.length > 80 || !(at > from) || (live && live[k] && live[k].has(id))) return;
      ent.push([id, at, Array.isArray(v) ? num(v[1], 0) : 0]);
    });
    if (ent.length > TOMB_MAX) ent = ent.sort((a, b) => b[1] - a[1]).slice(0, TOMB_MAX);
    ent.forEach(e => { out[k][e[0]] = [e[1], e[2]]; });
  });
  return out;
}
function tombsHas(t) { return !!t && ["c", "l", "f"].some(k => t[k] && Object.keys(t[k]).length > 0); }

function dataVersion(raw) { return (raw && typeof raw === "object") ? num(raw.version, 1) : DATA_VERSION; }

// Rend n'importe quel objet (stockage, import, version 1 ou 2) conforme au modèle version 3, sans planter.
// Migration v1 → v2 : ko/en/fr → terms, listes dans « Sans dossier », langue apprise fr et langues d'appui ko, en par défaut.
// Migration v2 → v3 : toutes les cartes existantes reçoivent type "vocab" (normalizeCard).
// Migration v3 → v4 : dailyGoal 10, privacy tout à true, streak calculé depuis history (série actuelle gardée, 0 gel).
//   Si la clé streak existe déjà (écrite par un autre appareil ou par l'admin), elle est gardée telle quelle.
// Migration v4 → v5 (étape 35) : settings.learning déduit des dossiers / listes (voir migrateLearning), example de chaque
//   carte de vocabulaire → examples[langue apprise].text ; rien n'est supprimé (example, defaultTarget, defaultSupport,
//   anciens tableaux support → legacySupport). Aucun nouveau morceau : settings, lists, folders et cards existent déjà.
// Migration v5 → v6 (étape 37) : lists[].targets = [langue apprise] ; box / dueAt / stats → cards[].progress[langue]
//   (voir syncPrimaryProgress) ; history[].langs ajouté au fil des révisions. Aucun nouveau morceau (règle 33b) :
//   tout reste dans les morceaux lists et cards. Export JSON de sécurité avant (syncWithRemote, DATA_VERSION).
// Migration v6 → v7 (étape 47) : chaque progress[langue] sans champs FSRS reçoit s, d, last, reps, lapses, state estimés
//   depuis sa boîte et ses stats, et lb = ancienne boîte (fsrsMigrateProg, js/fsrs.js) ; box = équivalent FSRS ; dueAt et
//   stats jamais modifiés ; rien supprimé ; aucun nouveau morceau (tout reste dans les morceaux cards). Une progression qui a
//   déjà ses champs FSRS n'est jamais refaite (relancer ne migre pas deux fois). Export JSON de sécurité avant (DATA_VERSION 7).
// « Ma phrase » (étape 58) : { id, cardId, lang, word, text, status: "pending"|"done"|"error", reqId, at, corrected, explain, ok, used, xp }.
// 200 max (les plus récentes), champs texte bornés.
function normSentences(v) {
  const out = [];
  arr(v).forEach(x => {
    if (!x || !x.id || !String(x.text || "").trim()) return;
    out.push({
      id: String(x.id), cardId: String(x.cardId || ""), lang: String(x.lang || ""), word: String(x.word || "").slice(0, 120),
      text: String(x.text).slice(0, 400), status: ["pending", "done", "error"].includes(x.status) ? x.status : "pending",
      reqId: x.reqId ? String(x.reqId) : "", at: num(x.at, 0),
      corrected: String(x.corrected || "").slice(0, 400), explain: String(x.explain || "").slice(0, 600),
      ok: x.ok === true, used: x.used === true, xp: x.xp === true
    });
  });
  return out.sort((a, b) => b.at - a.at).slice(0, 200);
}
function normalizeData(raw) {
  const d = (raw && typeof raw === "object") ? raw : {};
  const s = d.settings || {};
  const tg = isLang(s.defaultTarget) ? s.defaultTarget : (isLang(LANG_DEFAULT) ? LANG_DEFAULT : LANG_CODES[0]);
  const sup = cleanSupport(s.defaultSupport, tg);
  const au = s.audio || {};
  const out = {
    version: DATA_VERSION,
    updatedAt: num(d.updatedAt, 0),
    settings: {
      uiLang: ["ko", "fr", "en"].includes(s.uiLang) ? s.uiLang : defaultLang(),
      theme: ["light", "dark", "auto"].includes(s.theme) ? s.theme : "auto",
      sessionSize: clampInt(s.sessionSize, 1, 500, 20),
      learning: normLearning(s.learning),
      defaultTarget: tg,
      defaultSupport: sup,
      audio: { auto: au.auto !== false, langs: ["target", "support", "both"].includes(au.langs) ? au.langs : "target",
        learn: normAudLearn(au.learn) },   // apprentissage auditif (étape 55)
      dailyGoal: clampInt(s.dailyGoal, 5, 100, 10),
      privacy: normPrivacy(s.privacy),
      games: normGames(s.games),  // jeux d'entraînement (étape 42)
      listen: { slow: !!(s.listen && s.listen.slow === true) },   // dictée : lecture lente (étape 46)
      retention: clampInt(s.retention, FSRS_RET.min, FSRS_RET.max, FSRS_RET.def),   // FSRS : taux de rétention visé (étape 47)
      sentence: { on: !(s.sentence && s.sentence.on === false) },   // « Ma phrase » (étape 58) : activée par défaut
      gender: { colors: !(s.gender && s.gender.colors === false), symbols: !!(s.gender && s.gender.symbols === true) },   // genre des noms (étape 60) : couleurs oui, symboles non par défaut
      morning: normMorning(s.morning)   // bons moments pour réviser (étape 61) : rappel du matin, heure du soir, notification
    },
    folders: arr(d.folders).filter(f => f && f.id).map((f, i) => Object.assign(
      { id: String(f.id), name: String(f.name || ""), order: num(f.order, i) }, normLangPair(f), lastUpdateOf(f), normSharedMark(f), modAtOf(f))),
    lists: [],
    cards: arr(d.cards).filter(c => c && c.id).map(normalizeCard).filter(cardHasContent),
    history: arr(d.history)
      .filter(h => h && /^\d{4}-\d{2}-\d{2}$/.test(h.date))
      .map(h => Object.assign({ date: h.date, reviewed: num(h.reviewed, 0), correct: num(h.correct, 0) }, normHistLangs(h.langs))),
    streak: null,
    proposals: arr(d.proposals)
      .filter(p => p && p.id && p.cardId && (isLang(p.field) || isPosField(p.field) || isTypedField(p.field) || isExTrField(p.field) || isExlField(p.field) || isExltField(p.field) || ["example", "dup"].includes(p.field)) && ["completion", "correction"].includes(p.type))
      .map(p => Object.assign({ id: String(p.id), cardId: String(p.cardId), field: p.field, type: p.type,
        oldValue: String(p.oldValue || ""), newValue: String(p.newValue || ""), reason: String(p.reason || ""), createdAt: num(p.createdAt, 0) }, propReqFields(p)))
      .concat(arr(d.proposals).map(normNewProposal).filter(Boolean)),   // « Nouvelle carte » (étape 17)
    rejected: arr(d.rejected).map(String).slice(-CONFIG.REJECT_MAX),
    lastCheckAt: num(d.lastCheckAt, 0),
    checkedSig: {},
    aiResume: null,
    sharedProgress: normSharedProgress(d.sharedProgress)   // étape 30 : progression sur les listes communes
  };
  if (num(s.m, 0) > 0) out.settings.m = num(s.m, 0);   // étape 78 : dernière modification des réglages
  out.streak = normStreak(d.streak, out.history);
  // Étape 43 : XP, défis, badges (morceau xp). Absent → XP de départ calculé depuis history (migration douce, rien supprimé).
  out.xp = normXp(d.xp, out.history, out.streak, out.settings);
  const folderIds = new Set(out.folders.map(f => f.id));
  out.lists = arr(d.lists).filter(l => l && l.id).map((l, i) => Object.assign({
    id: String(l.id), name: String(l.name || ""),
    folderId: l.folderId && folderIds.has(String(l.folderId)) ? String(l.folderId) : null,
    order: num(l.order, i), createdAt: num(l.createdAt, Date.now())
  }, normLangPair(l), normTargets(l.targets), lastUpdateOf(l), normSharedMark(l), normImgSide(l), normListAudLearn(l), modAtOf(l)));   // audioLearn : étape 55 ; m : étape 78
  // Ordres renumérotés 0, 1, 2… (dossiers, puis listes de chaque dossier)
  const renum = items => items.map((x, i) => [x, i]).sort((a, b) => a[0].order - b[0].order || a[1] - b[1]).forEach(([x], i) => { x.order = i; });
  renum(out.folders);
  [null].concat(out.folders.map(f => f.id)).forEach(fid => renum(out.lists.filter(l => l.folderId === fid)));

  const cardIds = new Set(out.cards.map(c => c.id));
  const listIds0 = new Set(out.lists.map(l => l.id));
  out.sentences = normSentences(d.sentences);   // étape 58 : phrases envoyées à Claude
  out.stories = normStories(d.stories, listIds0);   // étape 45 : histoires des listes existantes seulement
  // Listes communes (étape 30) : leurs cartes arrivent après (cache du partage), les propositions sont gardées.
  const keepUnknown = out.lists.some(isSharedList);
  out.hard = normHard(d.hard, cardIds, keepUnknown);   // étape 57 : mots difficiles (cartes inconnues gardées s'il y a des listes communes)
  out.tips = normTips(d.tips, cardIds, keepUnknown);   // étape 57 : « Mon astuce » (jamais dans les cartes communes)
  out.progres = normProgres(d.progres, cardIds, keepUnknown);   // étape 64 : mots appris de la semaine, bilan d'oubli
  out.proposals = out.proposals.filter(p => p.field === "new" ? listIds0.has(p.listId) : (cardIds.has(p.cardId) || keepUnknown));
  if (d.aiResume && d.aiResume.kind === "complete") {
    const ids = arr(d.aiResume.ids).map(String).filter(id => cardIds.has(id));
    if (ids.length) out.aiResume = { kind: "complete", ids };
  }
  if (d.checkedSig && typeof d.checkedSig === "object" && !Array.isArray(d.checkedSig)) {
    Object.keys(d.checkedSig).forEach(k => { if (cardIds.has(k) && typeof d.checkedSig[k] === "string") out.checkedSig[k] = d.checkedSig[k]; });
  }
  // Cartes dont la liste n'existe pas (JSON modifié à la main) : sinon invisibles dans l'écran Listes.
  const ids = new Set(out.lists.map(l => l.id));
  const orphans = out.cards.filter(c => !ids.has(c.listId));
  if (orphans.length) {
    const l = { id: uid(), name: "Import", folderId: null, order: out.lists.filter(x => !x.folderId).length, createdAt: Date.now() };
    out.lists.push(l);
    orphans.forEach(c => { c.listId = l.id; });
  }
  // Étape 78 : pierres tombales (jamais pour un élément qui existe).
  out.tombs = normTombs(d.tombs, { c: new Set(out.cards.map(c => c.id)), l: new Set(out.lists.map(l => l.id)), f: folderIds });
  // Profil de langues (étape 35) : absent (données v4 et moins) → déduit des dossiers / listes.
  if (!out.settings.learning.length) out.settings.learning = migrateLearning(out, s);
  out.settings.defaultTarget = accountTarget(out.settings);   // ancien champ, gardé pour les anciennes versions
  const tgOfList = new Map(out.lists.map(l => [l.id, resolveLangs([out.folders.find(f => f.id === l.folderId), l], null, out.settings).target]));
  // Cartes d'un autre type sans langue (JSON modifié à la main) : langue apprise de leur liste.
  out.cards.forEach(c => {
    if (isVocab(c) || isLang(c.lang)) return;
    c.lang = tgOfList.get(c.listId) || accountTarget(out.settings);
  });
  // Migration v4 → v5 : example → examples[langue apprise de la liste].text (seulement depuis l'ancien format).
  if (dataVersion(raw) < 5) out.cards.forEach(c => {
    if (!isVocab(c) || !c.example) return;
    const lt = tgOfList.get(c.listId);
    if (lt && !c.examples[lt]) c.examples[lt] = { text: c.example, tr: {} };
  });
  // Migration v5 → v6 (étape 37) : targets = [target] pour chaque liste ; box, dueAt, stats → progress[langue d'origine]
  // (langue de la liste, ou lang des autres types). Rien n'est supprimé (box / dueAt / stats gardés en copie).
  out.lists.forEach(l => { if (!l.targets) l.targets = [tgOfList.get(l.id)]; });
  out.cards.forEach(c => syncPrimaryProgress(c, isVocab(c) ? tgOfList.get(c.listId) : c.lang));
  // Migration v6 → v7 (étape 47) : champs FSRS ajoutés là où ils manquent, puis copie de la langue principale à jour.
  const now = Date.now();
  out.cards.forEach(c => {
    if (!c.progress) return;
    let changed = false;
    Object.keys(c.progress).forEach(L => { if (fsrsMigrateProg(c.progress[L], now)) changed = true; });
    if (changed) syncPrimaryProgress(c, isVocab(c) ? tgOfList.get(c.listId) : c.lang);
  });
  return out;
}
// Progression de la langue principale ⇄ champs box / dueAt / stats de la carte (étape 37).
//  - aucune progression par langue (données v5, nouvelle carte) : progress[langue principale] = box / dueAt / stats ;
//  - sinon box / dueAt / stats = copie de progress[langue principale] (à zéro si cette langue n'a pas encore été révisée).
function syncPrimaryProgress(c, L) {
  if (!c || !isLang(L)) return;
  const pg = c.progress && typeof c.progress === "object" ? c.progress : {};
  if (!Object.keys(pg).length) {
    c.progress = { [L]: { box: c.box, dueAt: c.dueAt, stats: Object.assign({}, c.stats) } };
    return;
  }
  if (!pg[L]) pg[L] = Object.assign({ box: 0, dueAt: 0, stats: { seen: 0, correct: 0, wrong: 0, lastSeen: null } }, fsrsNewFields());
  c.progress = pg;
  c.box = pg[L].box; c.dueAt = pg[L].dueAt; c.stats = Object.assign({}, pg[L].stats);
}
// Révisions du jour par langue (étape 37) : { langs: { <langue>: [révisées, sues] } }.
function normHistLangs(m) {
  const o = {};
  if (m && typeof m === "object" && !Array.isArray(m)) Object.keys(m).forEach(L => {
    const v = m[L];
    if (isLang(L) && Array.isArray(v)) o[L] = [num(v[0], 0), num(v[1], 0)];
  });
  return Object.keys(o).length ? { langs: o } : {};
}
// Profil déduit (migration 4 → 5) : une entrée par langue apprise des dossiers / listes (langue du compte d'abord si une
// liste en hérite), appui = équivalent de l'ancienne règle de l'étape 31 (legacySupportFor).
function migrateLearning(out, s) {
  const ui = out.settings.uiLang, acct = isLang(s.defaultTarget) ? s.defaultTarget : (isLang(LANG_DEFAULT) ? LANG_DEFAULT : LANG_CODES[0]);
  const found = [];
  const add = x => { if (isLang(x) && !found.includes(x)) found.push(x); };
  out.lists.forEach(l => { const f = out.folders.find(x => x.id === l.folderId); add(isLang(l.target) ? l.target : f && isLang(f.target) ? f.target : acct); });
  out.folders.forEach(f => add(f.target));
  if (!out.lists.length) add(acct);
  else if (found.includes(acct)) { found.splice(found.indexOf(acct), 1); found.unshift(acct); }
  return normLearning(found.map(lang => ({ lang, support: legacySupportFor(lang, ui) })));
}

// Proposition « Nouvelle carte » : { id, cardId: "", listId, field: "new", type: "newcard", cards: [{ type, fields, ruleRef }], reason, createdAt }.
function normNewProposal(p) {
  if (!p || !p.id || p.field !== "new" || p.type !== "newcard" || !p.listId) return null;
  const cards = arr(p.cards).filter(d => d && CARD_TYPES.includes(d.type) && d.fields && typeof d.fields === "object").map(d => {
    const f = d.type === "vocab"
      ? { terms: normTerms(d.fields.terms), pos: normTerms(d.fields.pos), example: String(d.fields.example || ""), exTr: normTerms(d.fields.exTr) }
      : normTypedFields(d.type, d.fields);
    return { type: d.type, fields: f, ruleRef: String(d.ruleRef || "") };
  });
  if (!cards.length) return null;
  return Object.assign({ id: String(p.id), cardId: "", listId: String(p.listId), field: "new", type: "newcard", cards,
    oldValue: "", newValue: "", reason: String(p.reason || "").slice(0, 300), createdAt: num(p.createdAt, 0) }, propReqFields(p));
}
// Proposition venue de la file d'attente Claude (étape 23) : reqId = id de la demande (claude_requests),
// qc = acceptation / refus déjà compté (proposition restaurée par « Annuler »).
function propReqFields(p) {
  const o = {};
  if (p && typeof p.reqId === "string" && /^[0-9a-f-]{36}$/i.test(p.reqId)) { o.reqId = p.reqId; if (p.qc) o.qc = true; }
  return o;
}
function looksLikeAppData(raw) {
  return raw && typeof raw === "object" && Array.isArray(raw.cards) && Array.isArray(raw.lists);
}

