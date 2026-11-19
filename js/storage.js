"use strict";

// === DATA MODEL ===
// Version 2 : cartes multilingues (terms), dossiers, langue apprise et langues d'appui par compte / dossier / liste.
// Version 3 : types de cartes (champ type : vocab, conj, cloze, fix, rule — voir TYPES DE CARTES).
// Version 4 : séries façon Duolingo (settings.dailyGoal, settings.privacy, streak — voir SÉRIES).
// Version 5 : profil de langues (settings.learning) et exemples par langue (cards[].examples) — étape 35, voir LANGUES.
// Version 6 : langues étudiées d'une liste (lists[].targets) et progression par langue (cards[].progress) — étape 37.
// Version 7 : répétition FSRS — champs s, d, last, reps, lapses, state (+ lb) dans cards[].progress[langue] — étape 47.
const DATA_VERSION = 7;
const PRIVACY_KEYS = ["streak", "today", "week", "success", "badges", "ranking", "shared", "xp"];   // ce que mes amis voient (étape 29 ; shared : étape 30 ; xp : étape 43)
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
    retention: FSRS_RET.def                                                            // FSRS : taux de rétention visé (étape 47)
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
    stories: {},     // histoires par liste (étape 45, js/story.js) : { <id de liste>: [histoire…] }
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
// === APPRENTISSAGE AUDITIF (étape 55) ===
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
  });
  return out;
}
// Langues étudiées enregistrées d'une liste (étape 37) : codes connus, sans doublon.
function normTargets(t) { const out = []; arr(t).forEach(x => { if (isLang(x) && !out.includes(x)) out.push(x); }); return out.length ? { targets: out } : {}; }

// Date de la dernière « Mise à jour » d'une liste ou d'un dossier (absente si jamais faite).
function lastUpdateOf(o) { const v = num(o && o.lastUpdate, 0); return v > 0 ? { lastUpdate: v } : {}; }

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
      retention: clampInt(s.retention, FSRS_RET.min, FSRS_RET.max, FSRS_RET.def)   // FSRS : taux de rétention visé (étape 47)
    },
    folders: arr(d.folders).filter(f => f && f.id).map((f, i) => Object.assign(
      { id: String(f.id), name: String(f.name || ""), order: num(f.order, i) }, normLangPair(f), lastUpdateOf(f), normSharedMark(f))),
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
  out.streak = normStreak(d.streak, out.history);
  // Étape 43 : XP, défis, badges (morceau xp). Absent → XP de départ calculé depuis history (migration douce, rien supprimé).
  out.xp = normXp(d.xp, out.history, out.streak, out.settings);
  const folderIds = new Set(out.folders.map(f => f.id));
  out.lists = arr(d.lists).filter(l => l && l.id).map((l, i) => Object.assign({
    id: String(l.id), name: String(l.name || ""),
    folderId: l.folderId && folderIds.has(String(l.folderId)) ? String(l.folderId) : null,
    order: num(l.order, i), createdAt: num(l.createdAt, Date.now())
  }, normLangPair(l), normTargets(l.targets), lastUpdateOf(l), normSharedMark(l), normImgSide(l), normListAudLearn(l)));   // audioLearn : étape 55
  // Ordres renumérotés 0, 1, 2… (dossiers, puis listes de chaque dossier)
  const renum = items => items.map((x, i) => [x, i]).sort((a, b) => a[0].order - b[0].order || a[1] - b[1]).forEach(([x], i) => { x.order = i; });
  renum(out.folders);
  [null].concat(out.folders.map(f => f.id)).forEach(fid => renum(out.lists.filter(l => l.folderId === fid)));

  const cardIds = new Set(out.cards.map(c => c.id));
  const listIds0 = new Set(out.lists.map(l => l.id));
  out.stories = normStories(d.stories, listIds0);   // étape 45 : histoires des listes existantes seulement
  // Listes communes (étape 30) : leurs cartes arrivent après (cache du partage), les propositions sont gardées.
  const keepUnknown = out.lists.some(isSharedList);
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

// === STORAGE ===
// Couche d'accès unique. Données du compte connecté (<id> = identifiant de l'appli) découpées en morceaux :
//   user:<id>:index                 { v: 2, updatedAt, keys: [...] } — liste des morceaux, écrit en dernier
//   user:<id>:settings              { version (modèle de données), settings, updatedAt, rejected, lastCheckAt, aiResume: { kind, total } }
//   user:<id>:folders / :lists / :history
//   user:<id>:streak                série (étape 28, voir SÉRIES) — aussi modifiée par les fonctions admin de l'étape 28
//   user:<id>:xp                    XP, niveau, défis du jour, badges de l'étape 43 (voir js/xp.js)
//   user:<id>:stories:<listId>      histoires de la liste (étape 45, voir js/story.js), 20 max par liste
//   user:<id>:proposals:<n>         propositions « À valider » (500 max par morceau)
//   user:<id>:cards:<listId>:<n>    { cards: [200 max], sig: { idCarte: empreinte vérifiée } }
//   user:<id>:resume:<n>            ids des cartes restant à compléter (complétion en pause, 2000 max par morceau)
//   user:<id>:sharedprogress:<listeCommune>[:<n>]  progression personnelle sur une liste commune (étape 30) :
//                                   { idCarte: [boîte, dueAt, vues, sues, ratées, dernière vue] }, 2000 cartes max par morceau.
//                                   Les cartes d'une liste commune ne sont pas ici : table shared_cards (voir PARTAGE).
// Seuls les morceaux modifiés sont écrits (comparaison avec ce qui a déjà été écrit).
//  - local : localStorage "vocabfr." + clé (écriture tout-ou-rien : en cas d'échec, les morceaux déjà écrits sont restaurés)
//  - cloud : document data/users/<idClaude>/<clé> = { json, updatedAt } (adaptateur claudeDbBackend)
//  - Supabase (si config.js est rempli) : table user_data, une ligne par morceau, clé primaire (user_id, key),
//    clé sans le préfixe "user:<id>:" — adaptateur supabaseBackend, voir supabase.sql
// Conflits : localStorage "vocabfr.synced:<id>" = updatedAt des données en ligne à la dernière synchro réussie.
// Avant chaque envoi, l'index en ligne est relu : s'il a changé depuis (autre appareil), on demande quelles données garder.
// Envoi raté : données gardées sur l'appareil, nouvel essai automatique (CONFIG.RETRY_MS, et au retour de la connexion).
// Ancien format (un seul bloc) : localStorage "vocabfr.user:<id>" + document "user:<id>". Migré automatiquement,
// après un export JSON de sécurité. Le document cloud ancien n'est jamais effacé ; la clé locale ancienne
// est retirée seulement après relecture réussie du nouveau format.
// Registre des comptes : localStorage "vocabfr.accounts" + document data/users/<idClaude>/accounts.
// Anciennes données (avant les comptes) : "vocabfr.data.v1" + data/users/<idClaude>/state, lues pour la migration, jamais effacées.

// Adaptateur cloud de l'artifact : get(clé) → texte JSON ou undefined ; set(clé, json, updatedAt) ; del(clé).
function claudeDbBackend(db, base) {
  return {
    async get(key) {
      const snap = await withTimeout(db.doc(base + "/" + key).get(), CONFIG.REMOTE_TIMEOUT_MS);
      if (!snap.exists) return undefined;
      const body = snap.data();
      return body && typeof body.json === "string" ? body.json : undefined;
    },
    async set(key, json, updatedAt) { await withTimeout(db.doc(base + "/" + key).set({ json, updatedAt }), CONFIG.REMOTE_TIMEOUT_MS); },
    async del(key) { await withTimeout(db.doc(base + "/" + key).delete(), CONFIG.REMOTE_TIMEOUT_MS); }
  };
}
// Adaptateur Supabase : table user_data (user_id, key, data jsonb, updated_at), RLS = chacun ses lignes (admin : toutes).
// La clé y est stockée sans le préfixe "user:<id>:". uid = auth.uid() de l'utilisateur connecté.
// updated_at est mis par le serveur (trigger). jsonb ne garde pas l'ordre des champs : voir markSynced().
function supabaseBackend(client, uid, prefix) {
  const k = key => key.startsWith(prefix) ? key.slice(prefix.length) : key;
  const ok = r => { if (r && r.error) throw r.error; return r ? r.data : null; };
  const T = CONFIG.REMOTE_TIMEOUT_MS;
  return {
    async get(key) {
      const d = ok(await withTimeout(client.from("user_data").select("data").eq("user_id", uid).eq("key", k(key)).maybeSingle(), T));
      return d ? JSON.stringify(d.data) : undefined;
    },
    // Toutes les lignes du compte en une requête : Map(clé avec préfixe → texte JSON).
    async getAll() {
      const rows = ok(await withTimeout(client.from("user_data").select("key,data").eq("user_id", uid), T * 3));
      return new Map(arr(rows).map(r => [prefix + r.key, JSON.stringify(r.data)]));
    },
    async set(key, json) {
      ok(await withTimeout(client.from("user_data").upsert({ user_id: uid, key: k(key), data: JSON.parse(json) }), T));
    },
    async del(key) {
      ok(await withTimeout(client.from("user_data").delete().eq("user_id", uid).eq("key", k(key)), T));
    }
  };
}

const Storage = (() => {
  let db = null, base = null;  // base = "data/users/<idClaude>" quand le cloud est disponible
  let backend = null;          // adaptateur cloud de l'artifact (null = pas de cloud Claude)
  let sb = null;               // client Supabase (null = pas de Supabase)
  let userId = null, remote = null; // remote = adaptateur du compte connecté
  let remoteOk = false;        // données en ligne lues et comparées : les envois sont permis
  let mode = "local";          // "local" | "cloud" | "syncing" | "offline" | "error"
  let retryTimer = null, failWarned = false, conflictOpen = false;
  let onConflictFn = null, onRetryInitFn = null, onSyncErrorFn = null;
  let timer = null, lastData = null, held = false;
  let chain = Promise.resolve();
  let localSaved = new Map();  // clé → JSON déjà présent dans localStorage
  let remoteSaved = new Map(); // clé → JSON déjà présent dans le cloud
  let localFullWarned = false;
  const beforeSaveFns = [];    // étape 30 : modifications des listes communes repérées avant chaque sauvegarde (étape 49 : + images)
  let lastErr = "";            // étape 33b : dernière erreur de synchro (message court, affiché en touchant l'indicateur)
  let paused = false;          // étape 48 : mise à jour nécessaire (js/release.js) → aucun envoi, données gardées sur l'appareil
  const listeners = [];

  function setMode(m) {
    if (paused && remote && (m === "cloud" || m === "syncing" || m === "error")) m = "paused";   // étape 48
    mode = m; listeners.forEach(fn => { try { fn(m); } catch (e) {} });
  }
  function onMode(fn) { listeners.push(fn); fn(mode); }
  function getMode() { return mode; }
  function isCloud() { return !!backend || !!sb; }
  function isSupabase() { return !!sb; }
  // Supabase : pas de registre de comptes local (Supabase Auth s'en charge).
  function useSupabase(client) { sb = client; backend = null; setMode("cloud"); }
  function failMode() { setMode(navigator.onLine === false ? "offline" : "error"); }
  // Message court, sans contenu de données : code / message de l'erreur, clé du morceau en cause.
  function setErr(where, e) {
    const m = typeof e === "string" ? e : [e && e.code, e && (e.message || e.msg), e && e.status].filter(x => x !== undefined && x !== null && x !== "").join(" ") || String(e);
    lastErr = (where + " : " + m).slice(0, 160);
    try { if (typeof ErrLog !== "undefined") ErrLog.sync(lastErr, e); } catch (x) {}   // étape 41 : journal des erreurs (message exact)
  }
  function getLastError() { return lastErr; }
  // Étape 48 : synchro en pause (Release.apply) tant que l'appli doit être mise à jour. Les sauvegardes continuent sur
  // l'appareil ; rien ne part en ligne (indicateur « En pause »). Reprise : envoi de ce qui attend.
  function pause(on) {
    on = !!on;
    if (on === paused) return;
    paused = on;
    if (paused) { clearTimeout(retryTimer); retryTimer = null; if (remote) setMode("paused"); }
    else if (remote) { setMode("cloud"); retryNow(); }
  }
  function isPaused() { return paused; }
  // Étape 48 : format des données en ligne (version du morceau settings) plus récent que celui de l'appli → blocage
  // (js/release.js). Renvoie true si trop récent.
  function tooNew(v) {
    const n = num(Number(v), 0);
    if (n > DATA_VERSION) { try { if (typeof Release !== "undefined") Release.dataTooNew(n); } catch (e) {} return true; }
    return false;
  }

  // --- Synchro : updatedAt des données en ligne à la dernière synchro réussie (null = inconnu) ---
  function getSynced() {
    if (!userId) return null;
    try { const v = localStorage.getItem(CONFIG.LS_SYNCED + userId); return v === null ? null : Number(v); } catch (e) { return null; }
  }
  function setSynced(v) { if (userId) { try { localStorage.setItem(CONFIG.LS_SYNCED + userId, String(v)); } catch (e) {} } }
  // Les données en ligne sont identiques à data : on retient leurs morceaux (évite de tout renvoyer).
  // Étape 33b : seulement les morceaux vraiment lus en ligne (initRemote). Un morceau qui n'existe pas encore en ligne
  // (ex. « streak » ajouté par la migration v3 → v4) reste à envoyer : l'index ne doit jamais citer un morceau absent.
  function markSynced(data) {
    if (!userId) return;
    const { pieces, index } = split(data), known = remoteSaved;
    remoteSaved = new Map(Array.from(pieces).filter(([k]) => known.has(k))); remoteSaved.set(pre() + "index", index);
    setSynced(data.updatedAt);
  }
  // « Garder les données de cet appareil » : tout renvoyer et supprimer les morceaux en ligne en trop.
  function forceFullPush(remoteKeys, remoteUpdatedAt) {
    remoteSaved = new Map(arr(remoteKeys).map(k => [k, null]));
    remoteSaved.set(pre() + "index", null);
    setSynced(remoteUpdatedAt);
  }
  function onConflict(fn) { onConflictFn = fn; }
  function onRetryInit(fn) { onRetryInitFn = fn; }
  function setConflictOpen(v) { conflictOpen = !!v; }
  // Nouvel essai automatique : relecture en ligne si elle a échoué, sinon nouvel envoi.
  function scheduleRetry() {
    clearTimeout(retryTimer);
    retryTimer = setTimeout(retryNow, CONFIG.RETRY_MS);
  }
  function retryNow() {
    clearTimeout(retryTimer); retryTimer = null;
    if (!userId || !remote || paused) return;
    if (!remoteOk) { if (onRetryInitFn) { try { onRetryInitFn(); } catch (e) {} } }
    else if (lastData) flush();
  }
  try { window.addEventListener("online", retryNow); window.addEventListener("offline", () => { if (remote) setMode("offline"); }); } catch (e) {}

  function lsGet(key) { try { const s = localStorage.getItem(key); return s ? JSON.parse(s) : null; } catch (e) { return null; } }
  function lsRaw(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
  function lsSet(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); return true; } catch (e) { return false; } }
  function lsDel(key) { try { localStorage.removeItem(key); } catch (e) {} }
  function oldKey(id) { return "user:" + id; }               // ancien format (un seul bloc)
  function pre() { return "user:" + userId + ":"; }          // préfixe des morceaux du compte connecté
  function byteLen(s) { try { return new TextEncoder().encode(s).length; } catch (e) { return s.length * 3; } }

  // Connexion au cloud (base + identité Claude). Renvoie true si disponible.
  async function connect() {
    try {
      if (typeof window.claude === "undefined" || !window.claude || typeof window.claude.use !== "function") return false;
      const [d, user] = await withTimeout(Promise.all([window.claude.use("db"), window.claude.use("user")]), CONFIG.REMOTE_TIMEOUT_MS + 2000);
      if (!d || !user) return false;
      const id = await withTimeout(user.id(), CONFIG.REMOTE_TIMEOUT_MS);
      if (!id) return false;
      db = d; base = "data/users/" + id;
      backend = claudeDbBackend(db, base);
      setMode("cloud");
      return true;
    } catch (e) {
      db = null; base = null; backend = null;
      setMode("local");
      return false;
    }
  }
  // Lecture d'un document { json } (registre, anciennes données) : objet, ou undefined si vide. Lève une erreur en cas d'échec.
  async function remoteGet(name) {
    const json = await backend.get(name);
    return json ? JSON.parse(json) : undefined;
  }

  // --- Comptes : { accounts: [{ id, salt, pinHash, createdAt }], migrated } ---
  function normReg(r) {
    const d = (r && typeof r === "object") ? r : {};
    return {
      accounts: arr(d.accounts).filter(a => a && a.id && a.pinHash)
        .map(a => ({ id: String(a.id), salt: String(a.salt || ""), pinHash: String(a.pinHash), createdAt: num(a.createdAt, 0) })),
      migrated: !!d.migrated
    };
  }
  function mergeReg(a, b) {
    const out = { accounts: a.accounts.slice(), migrated: a.migrated || b.migrated };
    b.accounts.forEach(x => { if (!out.accounts.some(y => y.id === x.id)) out.accounts.push(x); });
    out.accounts.sort((x, y) => x.createdAt - y.createdAt);
    return out;
  }
  async function loadAccounts() {
    let reg = normReg(lsGet(CONFIG.LS_ACCOUNTS));
    if (backend) {
      try { reg = mergeReg(reg, normReg(await remoteGet(CONFIG.REMOTE_ACCOUNTS))); }
      catch (e) { setMode("error"); }
    }
    lsSet(CONFIG.LS_ACCOUNTS, reg);
    return reg;
  }
  // Relit le registre distant avant d'écrire, pour ne pas écraser un compte créé sur un autre appareil.
  async function saveAccounts(reg) {
    lsSet(CONFIG.LS_ACCOUNTS, reg);
    if (!backend) return;
    try {
      const m = mergeReg(reg, normReg(await remoteGet(CONFIG.REMOTE_ACCOUNTS)));
      await backend.set(CONFIG.REMOTE_ACCOUNTS, JSON.stringify(m), Date.now());
      lsSet(CONFIG.LS_ACCOUNTS, m);
      setMode("cloud");
    } catch (e) { setMode("error"); }
  }

  // --- Anciennes données (avant les comptes) : la version la plus récente entre local et cloud ---
  function readLegacyLocal() { return lsGet(CONFIG.LS_KEY); }
  async function readLegacy() {
    const l = looksLikeAppData(readLegacyLocal()) ? readLegacyLocal() : null;
    let r = null;
    if (backend) { try { const x = await remoteGet(CONFIG.REMOTE_DOC); if (looksLikeAppData(x)) r = x; } catch (e) {} }
    if (l && r) return num(r.updatedAt, 0) >= num(l.updatedAt, 0) ? r : l;
    return l || r;
  }

  // --- Session sur cet appareil (sans Supabase) : localStorage si « Rester connecté », sinon sessionStorage ---
  function getSession() {
    try { return localStorage.getItem(CONFIG.LS_SESSION) || sessionStorage.getItem(CONFIG.LS_SESSION) || null; } catch (e) { return null; }
  }
  function setSession(id) {
    try { localStorage.removeItem(CONFIG.LS_SESSION); sessionStorage.removeItem(CONFIG.LS_SESSION); } catch (e) {}
    if (!id) return;
    try { (rememberMe() ? localStorage : sessionStorage).setItem(CONFIG.LS_SESSION, id); } catch (e) {}
  }

  // --- Découpage : données → Map(clé → JSON) dans l'ordre de l'index ---
  function slices(a, n) { const out = []; for (let i = 0; i < a.length; i += n) out.push(a.slice(i, i + n)); return out; }
  function split(data, prefix) {
    const p = new Map(), P = prefix === undefined ? pre() : prefix;
    const put = (k, v) => p.set(P + k, JSON.stringify(v));
    const ids = data.aiResume ? arr(data.aiResume.ids) : [];
    put("settings", {
      version: data.version, settings: data.settings, updatedAt: data.updatedAt, rejected: data.rejected, lastCheckAt: data.lastCheckAt,
      aiResume: data.aiResume ? { kind: data.aiResume.kind, total: ids.length } : null
    });
    put("folders", data.folders);
    put("lists", data.lists);
    put("history", data.history);
    put("streak", data.streak);
    if (data.xp) put("xp", data.xp);   // étape 43 : nouveau morceau, toujours envoyé avant l'index (règle 33b)
    // Étape 45 : histoires, un morceau par liste (listes existantes seulement : une liste supprimée emporte ses histoires).
    // Nouveaux morceaux, toujours envoyés avant l'index (règle 33b). Liste sans histoire : pas de morceau.
    const stIds = new Set(arr(data.lists).map(l => l.id)), stories = data.stories || {};
    Object.keys(stories).forEach(L => { if (stIds.has(L) && arr(stories[L]).length) put("stories:" + L, stories[L]); });
    // Cartes : par liste, morceaux de 200 cartes max (et taille limitée, pour les cartes avec de longs exemples).
    // Listes communes (étape 30) : cartes dans shared_cards, ici seulement la progression personnelle (sharedprogress).
    const shIds = new Set(arr(data.lists).filter(isSharedList).map(l => l.id));
    const byList = new Map();
    data.cards.forEach(c => { if (shIds.has(c.listId)) return; if (!byList.has(c.listId)) byList.set(c.listId, []); byList.get(c.listId).push(c); });
    const sigs = data.checkedSig || {};
    byList.forEach((cards, listId) => {
      let n = 0, cur = [], curSig = {}, bytes = 0;
      const out = () => { put("cards:" + listId + ":" + (n++), { cards: cur, sig: curSig }); cur = []; curSig = {}; bytes = 0; };
      cards.forEach(c => {
        const b = byteLen(JSON.stringify(c)) + 40;
        if (cur.length && (cur.length >= CONFIG.CARDS_PER_PIECE || bytes + b > CONFIG.PIECE_MAX_BYTES)) out();
        cur.push(c); bytes += b;
        if (sigs[c.id]) curSig[c.id] = sigs[c.id];
      });
      if (cur.length) out();
    });
    const sp = sharedProgressOf(data);
    Object.keys(sp).forEach(U => {
      const ent = Object.entries(sp[U]);
      slices(ent, SH_PROG_CHUNK).forEach((s, i) => put("sharedprogress:" + U + (i ? ":" + i : ""), Object.fromEntries(s)));
    });
    slices(data.proposals, CONFIG.PROPOSALS_PER_PIECE).forEach((s, i) => put("proposals:" + i, s));
    slices(ids, CONFIG.IDS_PER_PIECE).forEach((s, i) => put("resume:" + i, s));
    const index = JSON.stringify({ v: 2, updatedAt: data.updatedAt, keys: Array.from(p.keys()) });
    return { pieces: p, index };
  }
  // Administration : données d'un autre compte ↔ lignes Supabase. Comme pour le compte lui-même :
  // clé de ligne sans préfixe, mais liste de l'index avec le préfixe "user:<identifiant>:".
  function packRows(data, ident) {
    const P = "user:" + ident + ":";
    const { pieces, index } = split(data, P);
    const rows = Array.from(pieces, ([key, json]) => ({ key: key.slice(P.length), data: JSON.parse(json) }));
    rows.push({ key: "index", data: JSON.parse(index) });  // l'index en dernier
    return rows;
  }
  function unpackRows(rows) {
    const m = new Map(arr(rows).map(r => [r.key, r.data]));
    if (!m.has("index")) return null;
    const idx = Object.assign({}, m.get("index"));
    idx.keys = arr(idx.keys).map(k => String(k).replace(/^user:[^:]*:/, ""));
    return assemble(idx, k => m.get(k), "").data;
  }
  // Morceaux → données (à passer ensuite dans normalizeData). get(clé) → objet ou undefined.
  function assemble(idx, getPiece, prefix) {
    const P = prefix === undefined ? pre() : prefix;
    const s = getPiece(P + "settings") || {};
    const out = {
      version: num(s.version, 1), updatedAt: num(idx.updatedAt, 0),   // pas de version = données de la version 1
      settings: s.settings, rejected: s.rejected, lastCheckAt: s.lastCheckAt,
      folders: arr(getPiece(P + "folders")), lists: arr(getPiece(P + "lists")), history: arr(getPiece(P + "history")),
      streak: getPiece(P + "streak"),   // absent (version 3 et moins) : calculé par normalizeData
      xp: getPiece(P + "xp"),           // absent (version 42 et moins) : XP de départ calculé par normalizeData (étape 43)
      cards: [], proposals: [], checkedSig: {}, aiResume: null, sharedProgress: {}, stories: {}
    };
    const ids = [];
    let missing = 0;
    const lost = [];
    arr(idx.keys).forEach(k => {
      const v = getPiece(k);
      // « streak » absent (étape 33b) : pas bloquant, la série est recalculée depuis history (comme en v3) puis renvoyée.
      // « xp » absent (étape 43) : pas bloquant non plus, l'XP de départ est recalculé depuis history puis renvoyé.
      if (v === undefined) { if (k !== P + "streak" && k !== P + "xp") { missing++; lost.push(k.slice(P.length)); } return; }
      if (k.startsWith(P + "cards:")) { out.cards.push(...arr(v.cards)); Object.assign(out.checkedSig, v.sig || {}); }
      else if (k.startsWith(P + "proposals:")) out.proposals.push(...arr(v));
      else if (k.startsWith(P + "resume:")) ids.push(...arr(v));
      else if (k.startsWith(P + "stories:")) out.stories[k.slice((P + "stories:").length)] = arr(v);   // étape 45
      else if (k.startsWith(P + "sharedprogress:") && v && typeof v === "object") {   // étape 30
        const U = k.slice((P + "sharedprogress:").length).split(":")[0];
        out.sharedProgress[U] = Object.assign(out.sharedProgress[U] || {}, v);
      }
    });
    if (s.aiResume && s.aiResume.kind) out.aiResume = { kind: s.aiResume.kind, ids };
    return { data: out, missing, lost };
  }

  // --- Compte connecté ---
  // sbUid : identifiant Supabase (auth.uid()) du compte, en mode Supabase.
  function setUser(id, sbUid) {
    clearTimeout(timer); timer = null; lastData = null; held = false;
    clearTimeout(retryTimer); retryTimer = null; failWarned = false; conflictOpen = false; remoteOk = false; lastErr = "";
    localSaved = new Map(); remoteSaved = new Map(); localFullWarned = false;
    userId = id || null;
    if (!userId) remote = null;
    else if (sb) remote = sbUid ? supabaseBackend(sb, sbUid, "user:" + userId + ":") : null;
    else remote = backend || null;
    try { if (typeof Release !== "undefined") Release.userChanged(); } catch (e) {}   // étape 48
  }
  function getUser() { return userId; }
  // Pendant l'ouverture du compte : les sauvegardes restent en mémoire (pas d'écriture avant la migration).
  function hold() { held = true; }
  function release() { held = false; }

  // Lecture locale : { data, old } (old = ancien format, à migrer), ou null si rien.
  function readLocal() {
    if (!userId) return null;
    const P = pre();
    const idxRaw = lsRaw(CONFIG.LS_USER_PREFIX + P + "index");
    if (idxRaw) {
      try {
        const idx = JSON.parse(idxRaw);
        localSaved = new Map([[P + "index", idxRaw]]);
        const { data, missing } = assemble(idx, k => {
          const raw = lsRaw(CONFIG.LS_USER_PREFIX + k);
          if (raw === null) return undefined;
          localSaved.set(k, raw);
          return JSON.parse(raw);
        });
        if (missing) data.updatedAt = 0; // incomplet : une version cloud complète passera devant
        return { data, old: false };
      } catch (e) { /* index illisible : on tente l'ancien format */ }
    }
    const old = lsGet(CONFIG.LS_USER_PREFIX + oldKey(userId));
    return looksLikeAppData(old) ? { data: old, old: true } : null;
  }
  // Écriture locale tout-ou-rien des morceaux modifiés. Renvoie true si tout est écrit.
  function writeLocal(data) {
    if (!userId) return false;
    const { pieces, index } = split(data);
    const P = pre(), done = [];
    try {
      pieces.forEach((json, k) => {
        if (localSaved.get(k) === json) return;
        done.push([k, localSaved.has(k) ? localSaved.get(k) : null]);
        localStorage.setItem(CONFIG.LS_USER_PREFIX + k, json);
        localSaved.set(k, json);
      });
      if (localSaved.get(P + "index") !== index) {
        done.push([P + "index", localSaved.has(P + "index") ? localSaved.get(P + "index") : null]);
        localStorage.setItem(CONFIG.LS_USER_PREFIX + P + "index", index);
        localSaved.set(P + "index", index);
      }
    } catch (e) {
      // Mémoire de l'appareil pleine (ou indisponible) : on remet les morceaux comme avant.
      done.reverse().forEach(([k, prev]) => {
        try {
          if (prev === null) { localStorage.removeItem(CONFIG.LS_USER_PREFIX + k); localSaved.delete(k); }
          else { localStorage.setItem(CONFIG.LS_USER_PREFIX + k, prev); localSaved.set(k, prev); }
        } catch (e2) {}
      });
      return false;
    }
    // Morceaux qui n'existent plus (liste vidée, propositions traitées…).
    Array.from(localSaved.keys()).forEach(k => {
      if (k !== P + "index" && !pieces.has(k)) { lsDel(CONFIG.LS_USER_PREFIX + k); localSaved.delete(k); }
    });
    return true;
  }
  // Après migration réussie : relit le nouveau format et retire l'ancienne clé locale si tout correspond.
  function dropOldLocal(data) {
    if (!userId) return false;
    const back = readLocal();
    if (!back || back.old || !back.data || arr(back.data.cards).length !== data.cards.length) return false;
    lsDel(CONFIG.LS_USER_PREFIX + oldKey(userId));
    return true;
  }

  // Lecture cloud. Renvoie { data, old, keys } (données du compte), undefined (cloud dispo mais vide), null (cloud indisponible).
  // En cas d'échec : pas d'envoi (on n'a pas pu comparer), nouvel essai automatique.
  async function initRemote() {
    if (!remote) return null;
    const id = userId, P = pre();
    try {
      let got = null, idxRaw;
      if (remote.getAll) { got = await remote.getAll(); idxRaw = got.get(P + "index"); }
      else idxRaw = await remote.get(P + "index");
      if (userId !== id) return null;
      if (idxRaw) {
        const idx = JSON.parse(idxRaw);
        const keys = arr(idx.keys);
        if (!got) {
          got = new Map([[P + "index", idxRaw]]);
          for (let i = 0; i < keys.length; i += 8) {           // 8 lectures à la fois
            const part = keys.slice(i, i + 8);
            const vals = await Promise.all(part.map(k => remote.get(k)));
            part.forEach((k, j) => { if (vals[j] !== undefined) got.set(k, vals[j]); });
          }
        }
        if (userId !== id) return null;
        const { data, missing, lost } = assemble(idx, k => got.has(k) ? JSON.parse(got.get(k)) : undefined);
        // Étape 48 : données en ligne écrites par une version plus récente de l'appli (format > DATA_VERSION) : on ne les
        // reprend pas et on n'écrit rien (blocage « Mise à jour nécessaire », js/release.js). Données de l'appareil gardées.
        if (tooNew(data.version)) { remoteOk = false; setMode("paused"); return null; }
        try { if (typeof Release !== "undefined") Release.dataOk(); } catch (e) {}
        if (missing) throw new Error("incomplete (" + lost.slice(0, 3).join(", ") + ")");
        remoteSaved = new Map(Array.from(got).filter(([k]) => k === P + "index" || keys.includes(k)));
        remoteOk = true;
        setMode("cloud");
        return { data, old: false, keys: Array.from(got.keys()) };
      }
      const old = remote.getAll ? undefined : await remoteGet(oldKey(id));
      if (userId !== id) return null;
      remoteSaved = got ? new Map(Array.from(got.keys(), k => [k, null])) : new Map();
      remoteOk = true;
      setMode("cloud");
      return looksLikeAppData(old) ? { data: old, old: true, keys: [] } : undefined;
    } catch (e) {
      if (userId === id) { remoteOk = false; setErr("lecture", e); failMode(); scheduleRetry(); }
      return null;
    }
  }

  // Envoi cloud des morceaux modifiés, puis de l'index, puis suppression des morceaux disparus. Renvoie true si tout est à jour.
  // Avant d'écrire : relecture de l'index en ligne ; s'il a changé depuis la dernière synchro → conflit (on n'écrit rien).
  async function doFlush() {
    if (paused && remote) { if (mode !== "paused") setMode("paused"); return false; }   // étape 48 : mise à jour nécessaire
    if (!remote || !remoteOk || !lastData || !userId || conflictOpen) return !remote;
    const id = userId, P = pre();
    const { pieces, index } = split(lastData);
    const todo = [];
    pieces.forEach((json, k) => { if (remoteSaved.get(k) !== json) todo.push([k, json]); });
    const idxChanged = remoteSaved.get(P + "index") !== index;
    const gone = Array.from(remoteSaved.keys()).filter(k => k !== P + "index" && !pieces.has(k));
    if (!todo.length && !idxChanged && !gone.length) { if (mode !== "cloud") setMode("cloud"); return true; }
    if (todo.some(([, json]) => byteLen(json) > CONFIG.MAX_DOC_BYTES)) { setErr("envoi", "too big"); setMode("error"); toast(t("save.tooBig")); syncErr("too big"); return false; }
    try {
      setMode("syncing");
      const S = getSynced();
      if (S !== null) {
        const rIdx = await remote.get(P + "index");
        if (userId !== id) return false;
        const r = rIdx ? num(JSON.parse(rIdx).updatedAt, 0) : 0;
        if (r > S && r !== lastData.updatedAt) {            // modifié ailleurs depuis la dernière synchro
          // Étape 48 : écrit par une version plus récente (format des données) → blocage, jamais « garder cet appareil ».
          try {
            const rs = await remote.get(P + "settings");
            if (userId !== id) return false;
            if (rs && tooNew(JSON.parse(rs).version)) { remoteOk = false; setMode("paused"); return false; }
          } catch (e) {}
          conflictOpen = true;
          setErr("envoi", "conflict");
          setMode("error");
          if (onConflictFn) setTimeout(() => { try { onConflictFn(); } catch (e) {} }, 0);
          return false;
        }
      }
      for (const [k, json] of todo) {                         // un morceau à la fois
        await remote.set(k, json, lastData.updatedAt);
        if (userId !== id) return false;
        remoteSaved.set(k, json);
      }
      await remote.set(P + "index", index, lastData.updatedAt);
      remoteSaved.set(P + "index", index);
      setSynced(lastData.updatedAt);
      for (const k of gone) { await remote.del(k); remoteSaved.delete(k); }
      failWarned = false;
      setMode("cloud");
      return true;
    } catch (e) {
      if (userId === id) {
        setErr("envoi", e);
        failMode();
        if (navigator.onLine !== false && sbErrKind(e) !== "net") syncErr((e && (e.code || e.message)) || e);   // journal (pas « hors ligne »)
        if (!failWarned && navigator.onLine !== false) { failWarned = true; toast(t("save.retry")); }
        scheduleRetry();
      }
      return false;
    }
  }
  // Erreur d'envoi (journal d'activité, étape 24) : message court transmis au déclencheur enregistré par onSyncError.
  function syncErr(msg) { if (onSyncErrorFn) { try { onSyncErrorFn(String(msg || "").slice(0, 120)); } catch (e) {} } }
  function onSyncError(fn) { onSyncErrorFn = fn; }
  // Les envois cloud passent l'un après l'autre (jamais deux écritures en même temps).
  function flush() {
    const p = chain.then(doFlush, doFlush);
    chain = p.catch(() => false);
    return p;
  }

  // Sauvegarde du compte connecté : immédiate en local (morceaux modifiés), différée (regroupée) vers le cloud.
  // Renvoie false si l'appareil n'a pas pu enregistrer.
  function onBeforeSave(fn) { if (typeof fn === "function" && !beforeSaveFns.includes(fn)) beforeSaveFns.push(fn); }
  function beforeSave(data) { beforeSaveFns.forEach(fn => { try { fn(data); } catch (e) {} }); }
  function save(data) {
    if (!userId) return false;
    beforeSave(data);
    lastData = data;
    if (held) return true;
    const ok = writeLocal(data);
    if (!ok) { setErr("appareil", "localStorage full"); setMode("error"); if (!localFullWarned) { localFullWarned = true; toast(t("save.localFull")); } }
    else localFullWarned = false;
    if (remote) {
      clearTimeout(timer);
      timer = setTimeout(() => { timer = null; flush(); }, CONFIG.SAVE_DELAY_MS);
    }
    return ok;
  }
  // Sauvegarde complète tout de suite (import par lots). Renvoie { local, remote } (true = réussi ou sans objet).
  async function saveNow(data) {
    if (!userId) return { local: false, remote: false };
    beforeSave(data);
    lastData = data;
    clearTimeout(timer); timer = null;
    const local = writeLocal(data);
    if (!local) { setErr("appareil", "localStorage full"); setMode("error"); return { local: false, remote: false }; }
    const r = (remote && remoteOk) ? await flush() : true;  // en ligne pas encore relu : envoi plus tard
    return { local: true, remote: r };
  }

  // Appli fermée ou mise en arrière-plan avant le délai, fin de session de révision : on envoie tout de suite.
  function flushNow() { if (timer) { clearTimeout(timer); timer = null; flush(); } }
  try {
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flushNow(); });
    window.addEventListener("pagehide", flushNow);
  } catch (e) {}

  // Avant de changer de compte : envoie ce qui attend et attend la fin des écritures.
  async function flushWait() {
    flushNow();
    try { await chain; } catch (e) {}
  }

  return {
    connect, isCloud, isSupabase, useSupabase, onMode, getMode,
    loadAccounts, saveAccounts, readLegacy, readLegacyLocal, getSession, setSession,
    setUser, getUser, hold, release, readLocal, writeLocal, dropOldLocal, initRemote, save, saveNow, flushNow, flushWait,
    getSynced, markSynced, forceFullPush, onConflict, onRetryInit, onSyncError, setConflictOpen, packRows, unpackRows, onBeforeSave, getLastError,
    pause, isPaused   // étape 48
  };
})();

// === SUPABASE ===
// Client Supabase, chargé seulement si config.js est rempli (window.APP_CONFIG = { SUPABASE_URL, SUPABASE_ANON_KEY }).
// Clé publique (« publishable » ou « anon ») uniquement : jamais la clé service_role / secrète.
// Connexion : email technique <identifiant>@vocab.local (jamais affiché), mot de passe = SHA-256(identifiant + ":" + PIN).
// Fonctions SQL utilisées (voir supabase.sql) : username_exists, my_profile, touch_last_seen, pin_changed,
// admin_list_accounts, admin_reset_pin, admin_delete_account. Données : table user_data (une ligne par morceau).
function inClaude() { return !!(window.claude && typeof window.claude.use === "function"); }

// SHA-256 en hexadécimal (crypto.subtle, sinon calcul en JavaScript : même résultat).
async function sha256Hex(str) {
  try {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
  } catch (e) { return sha256Js(str); }
}
function sha256Js(str) {
  const ror = (x, n) => (x >>> n) | (x << (32 - n));
  const H = [], K = [];
  for (let n = 2, c = 0; c < 64; n++) {
    let prime = true;
    for (let d = 2; d * d <= n; d++) if (n % d === 0) { prime = false; break; }
    if (!prime) continue;
    if (c < 8) H[c] = (Math.pow(n, 1 / 2) * 4294967296) | 0;
    K[c++] = (Math.pow(n, 1 / 3) * 4294967296) | 0;
  }
  const b = Array.from(new TextEncoder().encode(str)), len = b.length * 8;
  b.push(0x80);
  while (b.length % 64 !== 56) b.push(0);
  for (let i = 7; i >= 0; i--) b.push(i >= 4 ? 0 : (len >>> (8 * i)) & 255);
  const w = new Array(64);
  for (let j = 0; j < b.length; j += 64) {
    for (let i = 0; i < 16; i++) w[i] = (b[j + 4 * i] << 24) | (b[j + 4 * i + 1] << 16) | (b[j + 4 * i + 2] << 8) | b[j + 4 * i + 3];
    for (let i = 16; i < 64; i++) {
      const x = w[i - 15], y = w[i - 2];
      w[i] = (w[i - 16] + (ror(x, 7) ^ ror(x, 18) ^ (x >>> 3)) + w[i - 7] + (ror(y, 17) ^ ror(y, 19) ^ (y >>> 10))) | 0;
    }
    let [a, bb, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const t1 = (h + (ror(e, 6) ^ ror(e, 11) ^ ror(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) | 0;
      const t2 = ((ror(a, 2) ^ ror(a, 13) ^ ror(a, 22)) + ((a & bb) ^ (a & c) ^ (bb & c))) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = bb; bb = a; a = (t1 + t2) | 0;
    }
    [a, bb, c, d, e, f, g, h].forEach((v, i) => { H[i] = (H[i] + v) | 0; });
  }
  return H.map(x => (x >>> 0).toString(16).padStart(8, "0")).join("");
}

// Type d'erreur Supabase → "net" | "wrong" | "exists" | "confirm" | "same" | "server".
function sbErrKind(e) {
  const code = String((e && e.code) || ""), msg = String((e && (e.message || e.msg)) || e || "");
  if (navigator.onLine === false || /fetch|network|timeout|load failed/i.test(msg) || (e && (e.name === "AuthRetryableFetchError" || e.status === 0))) return "net";
  if (code === "invalid_credentials" || /invalid login credentials/i.test(msg)) return "wrong";
  if (code === "user_already_exists" || /already registered|already exists/i.test(msg)) return "exists";
  if (code === "confirm" || code === "email_not_confirmed" || /not confirmed/i.test(msg)) return "confirm";
  if (code === "same_password" || /different from the old/i.test(msg)) return "same";
  return "server";
}

const Supa = (() => {
  let client = null;
  const AUTH_KEY = "vocabfr.sb.auth";
  // Configuration lue dans config.js ; valeurs d'exemple ou vides = pas de Supabase.
  function cfg() {
    const c = (window.APP_CONFIG && typeof window.APP_CONFIG === "object") ? window.APP_CONFIG : {};
    const url = String(c.SUPABASE_URL || "").trim(), key = String(c.SUPABASE_ANON_KEY || "").trim();
    if (!/^https:\/\/\S+$/.test(url) || key.length < 20 || /REMPLACER|VOTRE|xxxx/i.test(url + key)) return null;
    return { url: url.replace(/\/+$/, ""), key };
  }
  function configured() { return !!cfg(); }
  function loadLib() {
    if (window.supabase && typeof window.supabase.createClient === "function") return Promise.resolve();
    return withTimeout(new Promise((res, rej) => {
      const sc = document.createElement("script");
      sc.src = CONFIG.SB_CDN; sc.onload = res; sc.onerror = () => rej(new Error("cdn"));
      document.head.appendChild(sc);
    }), 15000);
  }
  // « Rester connecté » : session Supabase dans localStorage, sinon dans sessionStorage (oubliée à la fermeture).
  const authStorage = {
    getItem(k) { try { const v = localStorage.getItem(k); return v !== null ? v : sessionStorage.getItem(k); } catch (e) { return null; } },
    setItem(k, v) {
      try {
        if (rememberMe()) { localStorage.setItem(k, v); sessionStorage.removeItem(k); }
        else { sessionStorage.setItem(k, v); localStorage.removeItem(k); }
      } catch (e) {}
    },
    removeItem(k) { try { localStorage.removeItem(k); } catch (e) {} try { sessionStorage.removeItem(k); } catch (e) {} }
  };
  async function init() {
    const c = cfg();
    if (!c) return false;
    try {
      await loadLib();
      client = window.supabase.createClient(c.url, c.key, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storage: authStorage, storageKey: AUTH_KEY },
        // Étape 41 : fetch surveillé (erreurs des appels Supabase et de send-push → journal des erreurs).
        // Étape 48 : portillon des écritures (Release.gateFetch) sous le fetch surveillé : rien n'est écrit tant que
        // l'appli doit être mise à jour.
        global: typeof ErrLog !== "undefined" ? { fetch: ErrLog.wrapFetch(typeof Release !== "undefined" ? Release.gateFetch : undefined) }
              : typeof Release !== "undefined" ? { fetch: Release.gateFetch } : {}
      });
      return true;
    } catch (e) { client = null; return false; }
  }
  const T = 15000;
  const ok = r => { if (r && r.error) throw r.error; return r ? r.data : null; };
  function email(id) { return id + "@" + CONFIG.SB_EMAIL_DOMAIN; }
  function password(id, pin) { return sha256Hex(id + ":" + pin); }
  async function session() { return ok(await withTimeout(client.auth.getSession(), T)).session || null; }
  async function signIn(id, pin) {
    return ok(await withTimeout(client.auth.signInWithPassword({ email: email(id), password: await password(id, pin) }), T)).session;
  }
  async function signUp(id, pin) {
    const d = ok(await withTimeout(client.auth.signUp({ email: email(id), password: await password(id, pin) }), T));
    if (!d || !d.session) throw { code: "confirm" };   // confirmation par email encore activée
    return d.session;
  }
  async function signOut() {
    try { await withTimeout(client.auth.signOut({ scope: "local" }), 5000); } catch (e) {}
    authStorage.removeItem(AUTH_KEY);
  }
  async function rpc(name, args) { return ok(await withTimeout(client.rpc(name, args || {}), T)); }
  // Nouveau PIN pour le compte connecté (puis « PIN à changer » retiré).
  async function setPin(id, pin) {
    ok(await withTimeout(client.auth.updateUser({ password: await password(id, pin) }), T));
    await rpc("pin_changed");
  }
  // Administration : lignes user_data d'un compte (RLS : réservé à l'admin pour les autres comptes).
  async function readRows(userUuid) {
    return arr(ok(await withTimeout(client.from("user_data").select("key,data").eq("user_id", userUuid), T * 2)));
  }
  // Remplace toutes les lignes d'un compte : morceaux, puis index, puis suppression des anciennes clés.
  async function writeRows(userUuid, rows) {
    const old = arr(ok(await withTimeout(client.from("user_data").select("key").eq("user_id", userUuid), T))).map(r => r.key);
    const pieces = rows.filter(r => r.key !== "index"), idx = rows.filter(r => r.key === "index");
    for (let i = 0; i < pieces.length; i += 5) {
      ok(await withTimeout(client.from("user_data").upsert(pieces.slice(i, i + 5).map(r => ({ user_id: userUuid, key: r.key, data: r.data }))), T));
    }
    if (idx.length) ok(await withTimeout(client.from("user_data").upsert({ user_id: userUuid, key: "index", data: idx[0].data }), T));
    const keep = new Set(rows.map(r => r.key));
    const del = old.filter(k => !keep.has(k));
    for (let i = 0; i < del.length; i += 50) {
      ok(await withTimeout(client.from("user_data").delete().eq("user_id", userUuid).in("key", del.slice(i, i + 50)), T));
    }
  }
  return {
    configured, init, client: () => client, password, session, signIn, signUp, signOut, setPin, readRows, writeRows,
    usernameExists: id => rpc("username_exists", { p_identifiant: id }),
    myProfile: () => rpc("my_profile"),
    touch: () => rpc("touch_last_seen"),
    listAccounts: () => rpc("admin_list_accounts"),
    resetPin: (userUuid, pwd) => rpc("admin_reset_pin", { p_user_id: userUuid, p_password: pwd }),
    deleteAccount: userUuid => rpc("admin_delete_account", { p_user_id: userUuid })
  };
})();

// === EXPORT / IMPORT ===
// Exporte data (par défaut : les données du compte connecté).
// Renvoie "saved" (fichier enregistré) ou "text" (fenêtre avec le texte à copier).
async function exportData(data, filename) {
  const json = JSON.stringify(data || state, null, 2);
  filename = filename || ("vocabulaire-francais-" + (Storage.getUser() ? Storage.getUser() + "-" : "") + todayStr() + ".json");
  try {
    const dl = window.claude && typeof window.claude.use === "function" ? await window.claude.use("downloads") : null;
    if (dl) { await dl.save({ filename, data: json }); toast(t("export.done")); return "saved"; }
  } catch (e) { /* refusé ou indisponible : on passe au plan B */ }
  if (!inClaude()) {          // navigateur (GitHub Pages) : téléchargement d'un fichier .json
    try {
      const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
      const a = document.createElement("a");
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      toast(t("export.done"));
      return "saved";
    } catch (e) {}
  }
  showExportText(json);
  return "text";
}
function showExportText(json) {
  const wrap = document.createElement("div");
  const p = document.createElement("p"); p.textContent = t("export.fallback");
  const ta = document.createElement("textarea"); ta.readOnly = true; ta.value = json;
  wrap.append(p, ta);
  openModal(t("export.title"), wrap, [
    { label: t("copy"), kind: "primary", onClick: () => {
      try { navigator.clipboard.writeText(json).then(() => toast(t("copied")), () => { ta.select(); }); }
      catch (e) { ta.select(); }
      return false;
    } },
    { label: t("close") }
  ]);
}

// target (administration) : { id, apply(data) } pour importer dans un autre compte ; sinon le compte connecté.
let importTarget = null;
function openImport(target) {
  importTarget = target && typeof target.apply === "function" ? target : null;
  const wrap = document.createElement("div");
  const fileBtn = document.createElement("button");
  fileBtn.className = "btn"; fileBtn.textContent = t("import.file");
  const lab = document.createElement("p"); lab.className = "muted"; lab.style.margin = "16px 0 6px"; lab.textContent = t("import.paste");
  const ta = document.createElement("textarea"); ta.placeholder = '{ "version": 2, ... }';
  wrap.append(fileBtn, lab, ta);
  let closeFn = null;
  fileBtn.addEventListener("click", () => { if (closeFn) closeFn(); $("#importFile").click(); });
  closeFn = openModal(t("import.title"), wrap, [
    { label: t("cancel") },
    { label: t("next"), kind: "primary", onClick: () => importFromText(ta.value) ? undefined : false }
  ]);
}
function onImportFile(e) {
  const f = e.target.files && e.target.files[0];
  e.target.value = "";
  if (!f) return;
  const r = new FileReader();
  r.onload = () => importFromText(String(r.result || ""));
  r.onerror = () => toast(t("import.error"));
  r.readAsText(f);
}
function importFromText(text) {
  let raw;
  try { raw = JSON.parse(text); } catch (e) { toast(t("import.error")); return false; }
  if (!looksLikeAppData(raw)) { toast(t("import.error")); return false; }
  const data = normalizeData(raw);
  const tg = importTarget;
  const p = document.createElement("p");
  p.textContent = tg ? t("admin.importConfirm", { id: tg.id, lists: data.lists.length, cards: data.cards.length })
                     : t("import.confirm", { lists: data.lists.length, cards: data.cards.length });
  openModal(t("import.title"), p, [
    { label: t("cancel") },
    { label: t("confirm"), kind: "primary", onClick: () => {
      if (tg) { tg.apply(data).then(() => toast(t("admin.importDone", { id: tg.id })), () => toast(t("admin.err"))); return; }
      state = data; Shared.attach(state); applyTheme(); commit(); toast(t("import.done"));
    } }
  ]);
  return true;
}
