"use strict";

// === HISTOIRES AVEC MES MOTS (ÉTAPE 45) ===
// Depuis une liste : « Créer une histoire » (langue étudiée de la liste, niveau, longueur, 5 à 15 mots de la liste,
// par défaut ceux à revoir). Claude écrit un court texte dans la langue apprise qui utilise ces mots, avec la traduction
// de chaque phrase dans la langue de l'interface et 3 questions de compréhension (QCM).
// Envoi : file d'attente Claude (type « story », mode Supabase), « Préparer pour Claude » (copier-coller, réponse à
// recoller) ou, dans l'artifact, Claude directement (AI.ask). Même prompt et même format JSON pour les trois voies.
// Données : state.stories = { <id de liste>: [histoire…] } ; morceau user_data « stories:<id de liste> » (nouveau morceau,
// envoyé avant l'index : règle 33b). Une histoire ne modifie JAMAIS les cartes (lecture seule des mots et traductions).
// Histoire : { id, lang, tl (langue des traductions), level, len, title, titleTr, sents [{ t, tr }],
//   words [{ f (forme dans le texte), c (id de carte), w (mot), tr (traduction) }], qs [{ q, qtr, o [], otr [], a }],
//   ans [réponse choisie | -1], read (lue), xp (XP gagnés), at, src: queue | paste | ai }
// XP (XP_RULES.story) : bonne réponse à une question (une fois, premier choix), histoire lue (une fois).

const STORY = {
  minWords: 5, maxWords: 15, defWords: 10,
  perList: 20,                // histoires gardées par liste (au-delà : en supprimer une)
  levels: ["beginner", "intermediate", "advanced"],
  lengths: ["short", "medium"],
  maxSents: 40, maxText: 400, maxQs: 5
};

// --- Modèle ---
function storyStr(v, max) { return typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max || STORY.maxText) : ""; }
function normStory(s) {
  if (!s || typeof s !== "object" || typeof s.id !== "string" || !isLang(s.lang)) return null;
  const sents = arr(s.sents).map(x => x && typeof x === "object" ? { t: storyStr(x.t), tr: storyStr(x.tr) } : null)
    .filter(x => x && x.t).slice(0, STORY.maxSents);
  if (!sents.length) return null;
  const qs = arr(s.qs).map(normStoryQ).filter(Boolean).slice(0, STORY.maxQs);
  return {
    id: s.id.slice(0, 40), lang: s.lang, tl: isLang(s.tl) ? s.tl : s.lang,
    level: STORY.levels.includes(s.level) ? s.level : "beginner", len: STORY.lengths.includes(s.len) ? s.len : "short",
    title: storyStr(s.title, 120), titleTr: storyStr(s.titleTr, 120), sents,
    words: arr(s.words).map(w => w && typeof w === "object" && storyStr(w.f, 80)
      ? { f: storyStr(w.f, 80), c: storyStr(w.c, 60), w: storyStr(w.w, 120), tr: storyStr(w.tr, 200) } : null).filter(Boolean).slice(0, 30),
    qs, ans: qs.map((q, i) => { const v = arr(s.ans)[i]; return Number.isInteger(v) && v >= 0 && v < q.o.length ? v : -1; }),
    read: s.read === true, xp: clampInt(s.xp, 0, 1000, 0), at: num(s.at, 0),
    src: ["queue", "paste", "ai"].includes(s.src) ? s.src : "paste"
  };
}
function normStoryQ(q) {
  if (!q || typeof q !== "object") return null;
  const o = arr(q.o).map(x => storyStr(x, 200)).filter(Boolean).slice(0, 6);
  if (!storyStr(q.q) || o.length < 2 || !Number.isInteger(q.a) || q.a < 0 || q.a >= o.length) return null;
  const otr = arr(q.otr).map(x => storyStr(x, 200)).slice(0, o.length);
  return { q: storyStr(q.q), qtr: storyStr(q.qtr), o, otr, a: q.a };
}
// Données enregistrées → { <liste>: [histoires] } (listes inconnues retirées si listIds est donné).
function normStories(raw, listIds) {
  const out = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  Object.keys(raw).forEach(L => {
    if (listIds && !listIds.has(L)) return;
    const seen = new Set();
    const list = arr(raw[L]).map(normStory).filter(s => s && !seen.has(s.id) && seen.add(s.id)).slice(0, STORY.perList);
    if (list.length) out[L] = list;
  });
  return out;
}
function storiesOf(listId) { return state.stories && Array.isArray(state.stories[listId]) ? state.stories[listId] : []; }
function storyGet(listId, id) { return storiesOf(listId).find(s => s.id === id) || null; }

// --- Mots d'une liste dans une langue ---
// Langues de traduction d'une langue étudiée L dans cette liste (interface, puis appui).
function storyLg(l, L) { const lg = listLangs(l); return L === lg.target ? lg : studyLg(L); }
// Langue des traductions de l'histoire : celle de l'interface (sinon la 1re langue d'appui).
function storyTrLang(l, L) { const ui = state.settings.uiLang; return ui !== L ? ui : (storyLg(l, L).support[0] || ui); }
// Cartes de vocabulaire de la liste qui ont un mot dans la langue L : [{ c, w, tr, score }].
function storyCandidates(l, L) {
  const lg = storyLg(l, L), now = Date.now();
  return cardsOf(l.id).filter(c => isVocab(c) && gameFirstAlt(term(c, L))).map(c => {
    const P = Leitner.prog(c, L) || {}, st = P.stats || {};
    const cat = Leitner.category(c, L);
    // « À revoir » d'abord : à réviser aujourd'hui, pas su (déjà vu), boîtes 1-2 ; puis les plus ratés.
    let score = 0;
    if (cat === "review") score += 3;
    if (cat === "unknown" && num(st.seen, 0) > 0) score += 4;
    if (num(P.dueAt, 0) <= now && num(st.seen, 0) > 0) score += 2;
    score += Math.min(3, num(st.wrong, 0) / 2);
    const trs = lg.support.map(x => gameFirstAlt(term(c, x))).filter(Boolean);
    return { c, w: term(c, L).trim(), tr: trs.join(" · "), score, seen: num(st.seen, 0) };
  });
}
// Sélection par défaut : les mots à revoir (jusqu'à STORY.defWords), complétée au hasard jusqu'à STORY.minWords.
function storyDefaultPick(cands) {
  const weak = cands.filter(x => x.score > 0).sort((a, b) => b.score - a.score).slice(0, STORY.defWords);
  const ids = new Set(weak.map(x => x.c.id));
  const rest = cands.filter(x => !ids.has(x.c.id)).sort(() => Math.random() - 0.5);
  while (ids.size < Math.min(STORY.minWords, cands.length) && rest.length) ids.add(rest.shift().c.id);
  return ids;
}

// --- Demande et prompt (même texte pour la file d'attente, le copier-coller et Claude direct) ---
// req = { listId, lang, tl, level, len, words [{ k: "w0", c, w, tr }] }
function storyRequest(l, o, cands) {
  const words = cands.filter(x => o.pick.has(x.c.id)).map((x, i) => ({ k: "w" + i, c: x.c.id, w: x.w, tr: x.tr }));
  return { listId: l.id, lang: o.lang, tl: storyTrLang(l, o.lang), level: o.level, len: o.len, words };
}
function storyLangFr(c) { return LANGUAGES[c] ? LANGUAGES[c].names.fr.toLowerCase() : c; }
const STORY_LEVEL_RULES = {
  beginner: "débutant (niveau A1-A2) : phrases très courtes (5 à 10 mots), surtout au présent, vocabulaire très courant, pas de subordonnées, une seule idée par phrase ; en coréen, style poli 해요체 ; en japonais, forme polie です/ます",
  intermediate: "intermédiaire (niveau B1) : phrases simples ou composées (jusqu'à 15 mots environ), passé et futur, connecteurs courants (mais, parce que, ensuite…)",
  advanced: "avancé (niveau B2-C1) : phrases naturelles et variées, temps et tournures variés, vocabulaire plus riche, dialogue possible"
};
const STORY_LEN_RULES = { short: "courte : 6 à 8 phrases", medium: "moyenne : 12 à 16 phrases" };
function storyPrompt(req) {
  const L = storyLangFr(req.lang), T = storyLangFr(req.tl);
  const words = req.words.map(x => ({ id: x.k, mot: x.w, sens: x.tr || undefined }));
  return [
    "Tu écris une courte histoire pour un apprenant en " + L + " (code " + req.lang + "), dans une appli de vocabulaire.",
    "Langue de l'histoire : " + L + ". Langue des traductions : " + T + " (code " + req.tl + ").",
    "Niveau : " + STORY_LEVEL_RULES[req.level] + ".",
    "Longueur : " + STORY_LEN_RULES[req.len] + ".",
    "",
    "Utilise TOUS les mots de la liste ci-dessous, chacun au moins une fois, avec le sens indiqué. Tu peux les conjuguer, les accorder",
    "ou leur ajouter une particule ou une terminaison (coréen, japonais…). Si un mot a plusieurs formes séparées par « / », utilise l'une d'elles.",
    "Mots (JSON) : " + JSON.stringify(words),
    "",
    "Règles :",
    "- Une histoire cohérente et agréable, avec un titre ; contenu adapté à tous les âges : rien de violent, sexuel, haineux, dangereux,",
    "  choquant ou triste ; pas de marques ni de personnes réelles ; prénoms simples.",
    "- Découpe le texte en phrases (une phrase par élément de \"sentences\", sans numéro). Orthographe et ponctuation exactes.",
    "- \"tr\" : traduction naturelle et fidèle de chaque phrase en " + T + ".",
    "- \"words\" : une entrée par mot de la liste (même \"id\"), avec \"form\" = la forme exacte du mot telle qu'elle est écrite dans",
    "  une des phrases (copiée caractère pour caractère, avec sa terminaison ou sa particule si elle est collée au mot).",
    "- \"questions\" : exactement 3 questions de compréhension sur l'histoire, en " + L + " simple (même niveau), chacune avec 4 réponses",
    "  possibles dont une seule juste ; \"answer\" = position de la bonne réponse dans \"options\" (0 = la première) ;",
    "  \"q_tr\" et \"options_tr\" : traductions en " + T + ".",
    "",
    "Réponds uniquement avec un objet JSON valide, sans aucun autre texte, exactement de cette forme :",
    "{\"title\": \"titre en " + L + "\", \"title_tr\": \"titre en " + T + "\",",
    " \"sentences\": [{\"text\": \"phrase en " + L + "\", \"tr\": \"traduction en " + T + "\"}],",
    " \"words\": [{\"id\": \"w0\", \"form\": \"forme dans le texte\"}],",
    " \"questions\": [{\"q\": \"question en " + L + "\", \"q_tr\": \"question en " + T + "\", \"options\": [\"…\", \"…\", \"…\", \"…\"],",
    "   \"options_tr\": [\"…\", \"…\", \"…\", \"…\"], \"answer\": 0}]}"
  ].join("\n");
}

// --- Lecture de la réponse de Claude → histoire ---
// raw : texte collé, ou objet JSON (file d'attente, Claude direct). Renvoie { story } ou { error: clé de texte }.
function storyParseJson(raw) {
  if (raw && typeof raw === "object") return raw;
  let s = String(raw || "").replace(/^﻿/, "").trim();
  if (!s) return null;
  s = s.replace(/^```[a-z]*\s*/i, "").replace(/```\s*$/, "").trim();
  try { return JSON.parse(s); } catch (e) {}
  const a = s.indexOf("{"), b = s.lastIndexOf("}");
  if (a >= 0 && b > a) { try { return JSON.parse(s.slice(a, b + 1)); } catch (e) {} }
  return null;
}
function storyLower(s) { const x = String(s).toLocaleLowerCase(); return x.length === String(s).length ? x : String(s); }
function storyFromReply(raw, req, src) {
  let o = storyParseJson(raw);
  if (!o || typeof o !== "object" || Array.isArray(o)) return { error: "st.err.json" };
  if (o.story && typeof o.story === "object") o = o.story;
  const sents = arr(o.sentences).map(x => {
    if (typeof x === "string") return { t: storyStr(x), tr: "" };
    if (!x || typeof x !== "object") return null;
    return { t: storyStr(x.text || x.t || x.sentence), tr: storyStr(x.tr || x.translation) };
  }).filter(x => x && x.t).slice(0, STORY.maxSents);
  if (sents.length < 2) return { error: "st.err.empty" };
  const text = storyLower(sents.map(x => x.t).join("\n"));
  const byK = new Map(req.words.map(w => [w.k, w]));
  const used = new Map();                                   // id de carte → mot trouvé dans le texte
  arr(o.words).forEach(x => {
    if (!x || typeof x !== "object") return;
    const w = byK.get(String(x.id || x.k || "")), f = storyStr(x.form || x.f, 80);
    if (!w || !f || used.has(w.c) || !text.includes(storyLower(f))) return;
    used.set(w.c, { f, c: w.c, w: w.w, tr: w.tr });
  });
  req.words.forEach(w => {                                  // mot oublié dans "words" mais présent tel quel dans le texte
    if (used.has(w.c)) return;
    const f = String(w.w).split("/").map(x => x.trim()).find(x => x && text.includes(storyLower(x)));
    if (f) used.set(w.c, { f, c: w.c, w: w.w, tr: w.tr });
  });
  const qs = arr(o.questions).map(q => {
    if (!q || typeof q !== "object") return null;
    const opts = arr(q.options || q.choices).map(x => storyStr(String(x == null ? "" : x), 200));
    let a = typeof q.answer === "number" ? q.answer : parseInt(q.answer, 10);
    if (!Number.isInteger(a) && typeof q.answer === "string") a = opts.indexOf(storyStr(q.answer, 200));
    return normStoryQ({ q: q.q || q.question, qtr: q.q_tr || q.question_tr, o: opts, otr: arr(q.options_tr), a });
  }).filter(Boolean).slice(0, STORY.maxQs);
  const st = normStory({
    id: uid(), lang: req.lang, tl: req.tl, level: req.level, len: req.len,
    title: storyStr(o.title, 120) || storyStr(sents[0].t, 60), titleTr: storyStr(o.title_tr || o.titleTr, 120),
    sents, words: Array.from(used.values()), qs, ans: [], read: false, xp: 0, at: Date.now(), src
  });
  return st ? { story: st, missing: req.words.length - used.size } : { error: "st.err.empty" };
}
// Range une histoire dans sa liste. Renvoie false si la liste n'existe plus ou est pleine.
function storyAdd(listId, st) {
  if (!getList(listId) || !st) return false;
  if (!state.stories || typeof state.stories !== "object") state.stories = {};
  const list = storiesOf(listId).slice();
  if (list.length >= STORY.perList) return false;
  list.unshift(st);
  state.stories[listId] = list;
  return true;
}
// File d'attente : réponse d'une demande « story » (appelée par queueApply). Renvoie true si l'histoire est rangée.
function storyFromQueue(result, req) {
  if (!req || !isLang(req.lang) || !Array.isArray(req.words)) return false;
  const r = storyFromReply(result, req, "queue");
  if (!r.story) return false;
  return storyAdd(req.listId, r.story);
}

// --- Fenêtre « Créer une histoire » ---
function storyPrepKey(listId) { return CONFIG.LS_USER_PREFIX + "story:prep:" + (Storage.getUser() || "") + ":" + listId; }
function storySavePrep(req) { try { localStorage.setItem(storyPrepKey(req.listId), JSON.stringify(req)); } catch (e) {} }
function storyLastPrep(listId) {
  try { const r = JSON.parse(localStorage.getItem(storyPrepKey(listId)) || "null"); return r && isLang(r.lang) && Array.isArray(r.words) ? r : null; }
  catch (e) { return null; }
}
function storySeg(values, cur, label, onPick) {
  const seg = el("div", "seg");
  values.forEach(v => {
    const b = el("button", null, t(label + v));
    b.type = "button"; b.dataset.value = v;
    b.setAttribute("aria-pressed", String(v === cur));
    b.addEventListener("click", () => { seg.querySelectorAll("button").forEach(x => x.setAttribute("aria-pressed", String(x === b))); onPick(v); });
    seg.appendChild(b);
  });
  return seg;
}
function openStoryCreate(listId) {
  const l = getList(listId);
  if (!l) return;
  if (storiesOf(listId).length >= STORY.perList) { openModal(t("st.create"), el("p", null, t("st.full", { n: STORY.perList })), [{ label: t("close") }]); return; }
  const langs = studyLangs(l);
  const o = { lang: langs[0], level: "beginner", len: "short", pick: new Set(), q: "" };
  let cands = [];
  const wrap = el("div", "sy-create");
  wrap.appendChild(el("p", "muted", t("st.createHelp")));
  if (langs.length > 1) {
    const sel = el("select", "input");
    langs.forEach(L => { const op = el("option", null, langName(L)); op.value = L; sel.appendChild(op); });
    sel.addEventListener("change", () => { o.lang = sel.value; loadWords(); });
    wrap.appendChild(formField(t("st.lang"), sel));
  } else wrap.appendChild(formField(t("st.lang"), el("div", "sy-langone", langName(o.lang))));
  wrap.appendChild(formField(t("st.level"), storySeg(STORY.levels, o.level, "st.lv.", v => { o.level = v; })));
  wrap.appendChild(formField(t("st.length"), storySeg(STORY.lengths, o.len, "st.len.", v => { o.len = v; })));
  const count = el("div", "sy-count");
  const tools = el("div", "sy-wtools");
  const mk = (k, fn) => { const b = el("button", "link-btn", t(k)); b.type = "button"; b.addEventListener("click", fn); tools.appendChild(b); };
  mk("st.pickReview", () => { o.pick = storyDefaultPick(cands); drawWords(); });
  mk("st.pickRandom", () => { o.pick = new Set(cands.slice().sort(() => Math.random() - 0.5).slice(0, STORY.defWords).map(x => x.c.id)); drawWords(); });
  mk("st.pickNone", () => { o.pick = new Set(); drawWords(); });
  const search = el("input", "input sy-wsearch");
  search.type = "search"; search.placeholder = t("lists.search");
  search.addEventListener("input", () => { o.q = search.value; drawWords(); });
  const box = el("div", "sy-words");
  const wf = el("div", "field");
  wf.append(el("label", null, t("st.words")), count, tools, search, box);
  wrap.appendChild(wf);
  function drawWords() {
    box.textContent = "";
    const n = o.pick.size;
    count.textContent = t("st.count", { n, min: STORY.minWords, max: STORY.maxWords });
    count.classList.toggle("bad", n < STORY.minWords || n > STORY.maxWords);
    if (!cands.length) { box.appendChild(el("div", "empty", t("st.noWords"))); return; }
    const q = normText(o.q);
    const shown = cands.filter(x => !q || normText(x.w + " " + x.tr).includes(q))
      .sort((a, b) => (o.pick.has(b.c.id) - o.pick.has(a.c.id)) || (b.score - a.score));
    shown.slice(0, 300).forEach(x => {
      const row = el("label", "sy-wrow");
      const cb = el("input");
      cb.type = "checkbox"; cb.checked = o.pick.has(x.c.id);
      cb.addEventListener("change", () => {
        if (cb.checked) o.pick.add(x.c.id); else o.pick.delete(x.c.id);
        count.textContent = t("st.count", { n: o.pick.size, min: STORY.minWords, max: STORY.maxWords });
        count.classList.toggle("bad", o.pick.size < STORY.minWords || o.pick.size > STORY.maxWords);
      });
      const txt = el("span", "sy-wtxt");
      txt.append(el("b", null, x.w), el("span", "muted", x.tr ? " · " + x.tr : ""));
      row.append(cb, txt);
      if (x.score > 0) row.appendChild(el("span", "sy-wtag", t("st.toReview")));
      box.appendChild(row);
    });
  }
  function loadWords() { cands = storyCandidates(l, o.lang); o.pick = storyDefaultPick(cands); o.q = ""; search.value = ""; drawWords(); }
  loadWords();
  const check = () => {
    const n = o.pick.size;
    if (n < STORY.minWords || n > STORY.maxWords) { toast(t("st.needWords", { min: STORY.minWords, max: STORY.maxWords })); return null; }
    return storyRequest(l, o, cands);
  };
  const acts = [];
  if (AI.isOn()) acts.push({ label: t("st.askDirect"), kind: "primary", onClick: () => { const r = check(); if (!r) return false; storyRunDirect(r); } });
  if (Queue.usable()) acts.push({ label: t("queue.ask"), kind: acts.length ? "" : "primary", onClick: () => { const r = check(); if (!r) return false; storySubmitQueue(r); } });
  acts.push({ label: t("st.prepare"), kind: acts.length ? "" : "primary", onClick: () => { const r = check(); if (!r) return false; setTimeout(() => openStoryPrepare(r), 0); } });
  acts.push({ label: t("cancel") });
  openModal(t("st.create"), wrap, acts);
}

// --- Envoi : file d'attente ---
async function storySubmitQueue(req) {
  const l = getList(req.listId);
  const prompt = storyPrompt(req);
  const row = {
    kind: "story", label: ((l ? listLabel(l) : "") + " · " + langName(req.lang)).slice(0, 300),
    card_count: req.words.length, batch_count: 1,
    payload: { v: 1, app: "vocab", kind: "story", uiLang: state.settings.uiLang, created: new Date().toISOString(),
      answer: "json-object: {\"title\", \"title_tr\", \"sentences\": [{\"text\", \"tr\"}], \"words\": [{\"id\", \"form\"}], \"questions\": [{\"q\", \"q_tr\", \"options\", \"options_tr\", \"answer\"}]}",
      story: req, batches: [{ prompt, story: req }] }
  };
  await queueSend([row]);
}
// --- Envoi : Claude directement (artifact) ---
async function storyRunDirect(req) {
  const pg = openProgress(t("st.create"), t("st.writing"), []);
  let res = null, err = null;
  try { res = await AI.ask(storyPrompt(req)); } catch (e) { err = e; }
  pg.close();
  if (err) { openModal(t("st.create"), el("p", null, aiErrorText(err)), [{ label: t("close") }, { label: t("st.prepare"), kind: "primary", onClick: () => { setTimeout(() => openStoryPrepare(req), 0); } }]); return; }
  storyDone(storyFromReply(res, req, "ai"), req);
}
// --- Envoi : copier-coller ---
function openStoryPrepare(req) {
  storySavePrep(req);
  const wrap = el("div");
  wrap.appendChild(el("p", "muted", t("st.prepHelp")));
  const ta = el("textarea");
  ta.readOnly = true;
  ta.value = storyPrompt(req);
  wrap.appendChild(ta);
  openModal(t("st.prepare"), wrap, [
    { label: t("copy"), kind: "primary", onClick: () => { copyText(ta.value, ta); return false; } },
    { label: t("st.paste"), onClick: () => { setTimeout(() => openStoryReply(req), 0); } },
    { label: t("close") }
  ]);
}
function openStoryReply(req) {
  const wrap = el("div");
  wrap.appendChild(el("p", "muted", t("st.replyHelp", { words: req.words.map(w => gameFirstAlt(w.w)).join(", ") })));
  const ta = el("textarea");
  ta.spellcheck = false;
  ta.setAttribute("autocapitalize", "off"); ta.setAttribute("autocorrect", "off");
  const msg = el("p", "q-err sy-err");
  msg.hidden = true;
  wrap.append(ta, msg);
  openModal(t("st.paste"), wrap, [
    { label: t("cancel") },
    { label: t("reply.analyze"), kind: "primary", onClick: () => {
      const r = storyFromReply(ta.value, req, "paste");
      if (!r.story) { msg.textContent = t(r.error); msg.hidden = false; return false; }
      storyDone(r, req);
    } }
  ]);
  setTimeout(() => { try { ta.focus(); } catch (e) {} }, 50);
}
// Histoire reçue (copier-coller ou direct) : rangée puis ouverte.
function storyDone(r, req) {
  if (!r.story) { openModal(t("st.create"), el("p", null, t(r.error || "st.err.json")), [{ label: t("close") }]); return; }
  if (!storyAdd(req.listId, r.story)) { openModal(t("st.create"), el("p", null, t(getList(req.listId) ? "st.full" : "st.err.list", { n: STORY.perList })), [{ label: t("close") }]); return; }
  try { localStorage.removeItem(storyPrepKey(req.listId)); } catch (e) {}
  commitQuiet();
  if (r.missing > 0) toast(t("st.missingWords", { n: r.missing }));
  goStory(req.listId, r.story.id);
}

// --- Écran « Histoires » (hash #histoires) ---
const stView = { listId: null, id: null, showTr: false, open: new Set(), playing: -1 };
function goStories(listId) {
  Speech.stop();
  stView.listId = listId; stView.id = null; stView.playing = -1;
  try { history.replaceState(null, "", "#" + HASH_OF.stories); } catch (e) {}
  showScreen("stories");
}
function goStory(listId, id) {
  Speech.stop();
  stView.listId = listId; stView.id = id; stView.showTr = false; stView.open = new Set(); stView.playing = -1;
  try { history.replaceState(null, "", "#" + HASH_OF.stories); } catch (e) {}
  if (currentScreen === "stories") { renderStories(); window.scrollTo(0, 0); } else showScreen("stories");
}
function storyMeta(s) {
  return [langName(s.lang), t("st.lv." + s.level), t("st.len." + s.len), storyDate(s.at)].join(" · ");
}
function storyDate(ts) { try { return new Date(ts).toLocaleDateString(state.settings.uiLang); } catch (e) { return ""; } }
function storyScore(s) { const n = s.ans.filter((a, i) => a >= 0 && a === s.qs[i].a).length; return { n, total: s.qs.length, done: s.qs.length > 0 && s.ans.every(a => a >= 0) }; }
function renderStories() {
  const root = $("#screen-stories");
  if (!root) return;
  root.textContent = "";
  const l = stView.listId ? getList(stView.listId) : null;
  if (!l) {                                             // liste supprimée, ou page rechargée sur #histoires
    root.appendChild(el("div", "empty", t("st.noList")));
    const b = el("button", "btn", t("nav.lists"));
    b.addEventListener("click", () => { try { history.replaceState(null, "", "#" + HASH_OF.lists); } catch (e) {} showScreen("lists"); });
    root.appendChild(b);
    return;
  }
  const s = stView.id ? storyGet(l.id, stView.id) : null;
  if (s) { renderStoryRead(root, l, s); return; }
  stView.id = null;
  const back = el("button", "link-btn", "‹ " + l.name);
  back.addEventListener("click", () => { Speech.stop(); try { history.replaceState(null, "", "#" + HASH_OF.lists); } catch (e) {} showScreen("lists"); openListView(l.id); });
  root.appendChild(el("div", "lv-top")).appendChild(back);
  root.appendChild(el("h2", null, t("st.title")));
  root.appendChild(el("p", "muted", t("st.help")));
  const prep = storyLastPrep(l.id);
  const btns = el("div", prep ? "btns two" : "btns");
  const nb = el("button", "btn primary", t("st.create"));
  nb.addEventListener("click", () => openStoryCreate(l.id));
  btns.appendChild(nb);
  if (prep) {
    const pb = el("button", "btn", t("st.paste"));
    pb.addEventListener("click", () => openStoryReply(prep));
    btns.appendChild(pb);
  }
  root.appendChild(btns);
  if (Queue.usable()) {
    const n = Queue.items().filter(r => r.kind === "story" && ["pending", "processing"].includes(r.status)).length;
    if (n) {
      const q = el("div", "q-banner");
      q.appendChild(el("span", null, t("st.waiting", { n })));
      const b = el("button", "link-btn", t("queue.see"));
      b.addEventListener("click", goRequests);
      q.appendChild(b);
      root.appendChild(q);
    }
  }
  const list = storiesOf(l.id);
  if (!list.length) { root.appendChild(el("div", "empty", t("st.empty"))); return; }
  list.forEach(st => {
    const c = el("div", "card sy-item");
    const open = el("button", "sy-open");
    open.type = "button";
    open.appendChild(el("div", "sy-ititle", st.title));
    if (st.titleTr) open.appendChild(el("div", "muted sy-isub", st.titleTr));
    const sc = storyScore(st);
    const meta = [storyMeta(st), t("st.nWords", { n: st.words.length })];
    if (sc.done) meta.push(t("st.score", { n: sc.n, total: sc.total }));
    else if (st.read) meta.push(t("st.readTag"));
    open.appendChild(el("div", "q-meta", meta.join(" · ")));
    open.addEventListener("click", () => goStory(l.id, st.id));
    const del = el("button", "link-btn danger", t("delete"));
    del.addEventListener("click", () => storyConfirmDelete(l.id, st.id));
    c.append(open, del);
    root.appendChild(c);
  });
}
function storyConfirmDelete(listId, id) {
  const s = storyGet(listId, id);
  if (!s) return;
  openModal(t("st.delete"), el("p", null, t("st.deleteConfirm", { title: s.title })), [
    { label: t("cancel") },
    { label: t("delete"), kind: "danger", onClick: () => {
      Speech.stop();
      const rest = storiesOf(listId).filter(x => x.id !== id);
      if (rest.length) state.stories[listId] = rest; else delete state.stories[listId];
      if (stView.id === id) stView.id = null;
      commit();
      toast(t("st.deleted"));
    } }
  ]);
}

// --- Lecture d'une histoire ---
// Phrase → morceaux [{ t, w }] (w = index du mot de la liste, ou -1), mots surlignés sans chevauchement (le plus long gagne).
// Formes cherchées : la forme donnée par Claude, et le mot lui-même (2 caractères ou plus) s'il apparaît ailleurs tel quel.
function storyForms(words) {
  const out = [];
  words.forEach((w, i) => {
    out.push({ f: w.f, i });
    String(w.w || "").split("/").map(x => x.trim()).filter(x => x.length >= 2 && storyLower(x) !== storyLower(w.f)).forEach(f => out.push({ f, i }));
  });
  return out;
}
function storySegments(text, words) {
  const low = storyLower(text), hits = [];
  storyForms(words).forEach(({ f: f0, i: wi }) => {
    const f = storyLower(f0);
    if (!f) return;
    let i = low.indexOf(f);
    while (i >= 0) { hits.push([i, i + f.length, wi]); i = low.indexOf(f, i + 1); }
  });
  hits.sort((a, b) => a[0] - b[0] || (b[1] - b[0]) - (a[1] - a[0]));
  const out = [];
  let pos = 0;
  hits.forEach(([a, b, wi]) => {
    if (a < pos) return;
    if (a > pos) out.push({ t: text.slice(pos, a), w: -1 });
    out.push({ t: text.slice(a, b), w: wi });
    pos = b;
  });
  if (pos < text.length) out.push({ t: text.slice(pos), w: -1 });
  return out;
}
function storyWordPopup(s, w) {
  const c = state.cards.find(x => x.id === w.c);
  const body = el("div", "sy-pop");
  body.appendChild(el("div", "sy-popw", c ? term(c, s.lang) || w.w : w.w));
  const lg = c && getList(c.listId) ? storyLg(getList(c.listId), s.lang) : null;
  const trs = lg ? lg.support.map(x => [x, term(c, x)]).filter(x => x[1]) : [];
  if (trs.length) trs.forEach(([x, v]) => body.appendChild(el("div", "sy-poptr", x.toUpperCase() + " · " + v)));
  else if (w.tr) body.appendChild(el("div", "sy-poptr", w.tr));
  if (w.f && normText(w.f) !== normText(gameFirstAlt(w.w))) body.appendChild(el("div", "muted", t("st.inText", { f: w.f })));
  const acts = [];
  if (Speech.has(s.lang)) acts.push({ label: "🔊 " + t("st.listen"), kind: "primary", onClick: () => { Speech.speakSeq([{ text: c ? term(c, s.lang) || w.w : w.w, lng: s.lang }]); return false; } });
  acts.push({ label: t("close") });
  openModal(t("st.word"), body, acts);
}
function renderStoryRead(root, l, s) {
  const back = el("button", "link-btn", "‹ " + t("st.title"));
  back.addEventListener("click", () => goStories(l.id));
  root.appendChild(el("div", "lv-top")).appendChild(back);
  const head = el("div", "sy-head");
  head.appendChild(el("h2", "sy-h", s.title));
  if (s.titleTr && stView.showTr) head.appendChild(el("div", "muted sy-htr", s.titleTr));
  head.appendChild(el("div", "q-meta", storyMeta(s)));
  root.appendChild(head);
  // Barre : lire tout / arrêter, traduction tout / rien
  const bar = el("div", "sy-bar");
  const voice = Speech.has(s.lang);
  if (voice) {
    const play = el("button", "btn small", stView.playing >= 0 ? "■ " + t("st.stop") : "▶ " + t("st.playAll"));
    play.addEventListener("click", () => {
      if (stView.playing >= 0) { Speech.stop(); stView.playing = -1; renderStories(); return; }
      storyPlay(s, 0, true);
    });
    bar.appendChild(play);
  }
  const trAll = el("button", "btn small", stView.showTr ? t("st.trHide") : t("st.trShow"));
  trAll.addEventListener("click", () => { stView.showTr = !stView.showTr; stView.open = new Set(); renderStories(); });
  bar.appendChild(trAll);
  root.appendChild(bar);
  if (!voice) root.appendChild(el("p", "muted sy-novoice", t("st.noVoice", { l: langName(s.lang) })));
  // Texte
  const txt = el("div", "card sy-text");
  txt.lang = s.lang;
  s.sents.forEach((x, i) => {
    const row = el("div", "sy-sent" + (stView.playing === i ? " playing" : ""));
    row.dataset.i = String(i);
    const p = el("p", "sy-src");
    storySegments(x.t, s.words).forEach(g => {
      if (g.w < 0) { p.appendChild(document.createTextNode(g.t)); return; }
      const b = el("button", "sy-hl", g.t);
      b.type = "button";
      b.addEventListener("click", () => storyWordPopup(s, s.words[g.w]));
      p.appendChild(b);
    });
    row.appendChild(p);
    const tools = el("div", "sy-stools");
    if (voice) {
      const sp = el("button", "sy-mini", "🔊");
      sp.type = "button"; sp.setAttribute("aria-label", t("st.listenSent"));
      sp.addEventListener("click", () => storyPlay(s, i, false));
      tools.appendChild(sp);
    }
    const showTr = stView.showTr || stView.open.has(i);
    if (x.tr) {
      const tb = el("button", "sy-mini sy-trbtn", showTr && !stView.showTr ? t("st.trOneHide") : t("st.trOne"));
      tb.type = "button";
      tb.hidden = stView.showTr;
      tb.addEventListener("click", () => { if (stView.open.has(i)) stView.open.delete(i); else stView.open.add(i); renderStories(); });
      tools.appendChild(tb);
    }
    row.appendChild(tools);
    if (showTr && x.tr) { const tr = el("p", "sy-tr", x.tr); tr.lang = s.tl; row.appendChild(tr); }
    txt.appendChild(row);
  });
  root.appendChild(txt);
  // Mots de la liste utilisés
  if (s.words.length) {
    const wb = el("div", "sy-wlist");
    wb.appendChild(el("span", "muted", t("st.wordsUsed", { n: s.words.length }) + " "));
    s.words.forEach(w => { const b = el("button", "sy-hl sy-chip", gameFirstAlt(w.w)); b.type = "button"; b.addEventListener("click", () => storyWordPopup(s, w)); wb.appendChild(b); });
    root.appendChild(wb);
  }
  // Histoire lue
  if (!s.read) {
    const rb = el("button", "btn", "✓ " + t("st.markRead", { n: XP_RULES.story.read }));
    rb.addEventListener("click", () => { storyMarkRead(s); renderStories(); });
    root.appendChild(rb);
  } else root.appendChild(el("p", "muted sy-readok", "✓ " + t("st.readDone")));
  // Questions
  if (s.qs.length) {
    const qb = el("div", "card sy-qs");
    qb.appendChild(el("h3", null, t("st.questions")));
    s.qs.forEach((q, qi) => {
      const box = el("div", "sy-q");
      const qt = el("p", "sy-qt", (qi + 1) + ". " + q.q);
      qt.lang = s.lang;
      box.appendChild(qt);
      if (stView.showTr && q.qtr) box.appendChild(el("p", "sy-tr", q.qtr));
      const chosen = s.ans[qi];
      const opts = el("div", "sy-opts");
      q.o.forEach((op, oi) => {
        const b = el("button", "btn sy-opt");
        b.type = "button";
        b.appendChild(el("span", null, op));
        if (stView.showTr && q.otr[oi]) b.appendChild(el("span", "sy-otr", q.otr[oi]));
        if (chosen >= 0) {
          b.disabled = true;
          if (oi === q.a) b.classList.add("ok");
          else if (oi === chosen) b.classList.add("bad");
        }
        b.addEventListener("click", () => storyAnswer(s, qi, oi));
        opts.appendChild(b);
      });
      box.appendChild(opts);
      if (chosen >= 0) box.appendChild(el("p", chosen === q.a ? "sy-res ok" : "sy-res bad", chosen === q.a ? t("st.right", { n: XP_RULES.story.correct }) : t("st.wrong")));
      qb.appendChild(box);
    });
    const sc = storyScore(s);
    if (sc.done) qb.appendChild(el("p", "sy-final", t("st.final", { n: sc.n, total: sc.total, x: s.xp })));
    root.appendChild(qb);
  }
  const acts = el("div", "btns two sy-end");
  const nb = el("button", "btn", t("st.create"));
  nb.addEventListener("click", () => openStoryCreate(l.id));
  const del = el("button", "btn danger", t("st.delete"));
  del.addEventListener("click", () => storyConfirmDelete(l.id, s.id));
  acts.append(nb, del);
  root.appendChild(acts);
}
// Lecture audio phrase par phrase (all = jusqu'à la fin), phrase en cours mise en évidence.
function storyPlay(s, from, all) {
  const items = (all ? s.sents.slice(from) : [s.sents[from]]).map(x => ({ text: x.t, lng: s.lang }));
  const mark = i => {
    stView.playing = i;
    document.querySelectorAll("#screen-stories .sy-sent").forEach(r => r.classList.toggle("playing", Number(r.dataset.i) === i));
    const pb = document.querySelector("#screen-stories .sy-bar .btn");
    if (pb && Speech.has(s.lang)) pb.textContent = i >= 0 ? "■ " + t("st.stop") : "▶ " + t("st.playAll");
  };
  const ok = Speech.speakSeq(items, {
    onItem: k => { if (currentScreen === "stories" && stView.id === s.id) mark(from + k); },
    onEnd: () => { if (currentScreen === "stories" && stView.id === s.id) mark(-1); else stView.playing = -1; }
  });
  if (ok) mark(from);
}
// XP : histoire lue (une fois) et bonne réponse (une fois par question, premier choix).
function storyMarkRead(s) {
  if (s.read) return;
  s.read = true;
  const got = typeof XP !== "undefined" ? XP.onStory(XP_RULES.story.read, s.lang) : 0;
  s.xp += got;
  if (got) toast(t("xp.plus", { n: got }));
  commitQuiet();
}
function storyAnswer(s, qi, oi) {
  if (s.ans[qi] >= 0) return;
  s.ans[qi] = oi;
  const q = s.qs[qi];
  if (oi === q.a && typeof XP !== "undefined") s.xp += XP.onStory(XP_RULES.story.correct, s.lang);
  if (storyScore(s).done && !s.read) storyMarkRead(s);
  commitQuiet();
  renderStories();
}
App.Story = { open: openStoryCreate, list: goStories };
