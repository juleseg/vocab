"use strict";

// === CLAUDE (IA) ===
// Capacité "sample" de l'artifact : interroger Claude depuis la page (sur le compte Claude de la personne).
// status : "pending" (en attente de l'environnement) | "on" | "off" (repli « Préparer pour Claude »).
const AI = (() => {
  let fn = null, status = "pending", readyP = null;
  const listeners = [];
  const OFF_CODES = ["not_granted", "sampling_disabled", "not_declared", "capability_disabled", "capability_removed"];
  function set(s) { status = s; listeners.forEach(f => { try { f(s); } catch (e) {} }); }
  function init() {
    if (readyP) return readyP;
    readyP = (async () => {
      try {
        if (!window.claude || typeof window.claude.use !== "function") { set("off"); return; }
        const s = await withTimeout(window.claude.use("sample"), 12000);
        fn = (typeof s === "function" && typeof s.json === "function") ? s : null;
        set(fn ? "on" : "off");
      } catch (e) { fn = null; set("off"); }
    })();
    return readyP;
  }
  // Réponse JSON de Claude. Rejette { code, message } ; les refus définitifs basculent sur le repli.
  async function ask(prompt, signal) {
    if (!fn) throw { code: "not_granted", message: "unavailable" };
    try { return await fn.json(prompt, { signal, modelTier: "default" }); }
    catch (e) {
      if (e && OFF_CODES.includes(e.code)) { fn = null; set("off"); }
      throw e;
    }
  }
  return {
    init, ready: init, ask,
    status: () => status, isOn: () => status === "on", isOffCode: c => OFF_CODES.includes(c),
    onChange: f => listeners.push(f)
  };
})();

// === COMPLÉTION & VÉRIFICATION ===
// Toutes les propositions vont dans state.proposals (section « À valider ») : rien n'est écrit directement dans les cartes.
// Champs d'une proposition : code de langue (traduction), "example", "extr:<code>" (traduction de l'exemple, étape 35),
// "pos:<code>" (nature grammaticale) ou "dup".
// Complétion : langues affichées (displayLangs), exemple dans la langue apprise et ses traductions dans les langues
// affichées, nature (de chaque langue affichée) vides (la langue apprise est la référence, jamais complétée).
// Vérification : fautes, accents, traductions douteuses (Claude) + doublons (détectés localement).
let aiJob = null; // traitement en cours (un seul à la fois)

function posFields(lg) { return [lg.target].concat(lg.support).map(posField); }
function exFields(lg) { return ["example"].concat(lg.support.map(exTrField)); }
// Étape 37 : + champs des langues étudiées en plus de la liste (mot, nature, exl:<L>, exlt:<L>:<code> — voir
// studyExtraFields), sauf avec noExtra ou des langues d'une langue étudiée (lg.study).
function withStudyFields(c, lg, base, noExtra) { return noExtra || lg.study ? base : base.concat(studyExtraFields(c).filter(f => !base.includes(f))); }
function fillFields(c, lg, noExtra) { if (!isVocab(c)) return []; lg = lg || cardLangs(c); return withStudyFields(c, lg, lg.support.concat(exFields(lg), posFields(lg)), noExtra); }
function checkFields(c, lg) { if (!isVocab(c)) return TYPED_FILL_FIELDS.filter(k => (TYPE_FIELDS[c.type] || []).includes(k) || (k === "examples" && c.type === "rule")).map(typedField); lg = lg || cardLangs(c); return withStudyFields(c, lg, [lg.target].concat(lg.support, exFields(lg), posFields(lg))); }
// Lignes de consigne « exemple » communes (accès direct, file d'attente, copier-coller).
function exPromptLines(prefix) {
  return [
    prefix + "example : une phrase d'exemple courte et simple DANS LA LANGUE APPRISE (niveau débutant) qui utilise le mot.",
    prefix + "extr:<code de langue> : traduction de la phrase d'exemple (celle de la carte, ou celle que tu proposes) dans cette langue.",
    prefix + "exl:<code de langue> : phrase d'exemple courte et simple DANS CETTE LANGUE (langue étudiée en plus, niveau débutant), qui utilise le mot de cette langue.",
    prefix + "exlt:<code>:<code2> : traduction de la phrase exl:<code> dans la langue code2."
  ];
}
// Consignes « nature grammaticale » communes (accès direct et « Préparer pour Claude »).
function posPromptLines(prefix, codes) {
  const L = codes || LANG_CODES;
  const g = L.filter(c => LANGUAGES[c].gender), ng = L.filter(c => !LANGUAGES[c].gender);
  return [
    prefix + "pos:<code de langue> : nature grammaticale du mot dans cette langue (celui de la carte, ou la traduction que tu proposes), avec UN de ces codes : " +
      "nm (nom masculin), nf (nom féminin), nmf (nom masculin et féminin), nmpl (nom masculin pluriel), nfpl (nom féminin pluriel), n (nom, langue sans genre), " +
      "v (verbe), vpr (verbe pronominal), adj, adv, prep, conj, pron, interj, expr (expression).",
    g.length ? prefix + "Langues avec genre (" + g.join(", ") + ") : un nom a TOUJOURS son genre (nm, nf, nmf, nmpl ou nfpl), jamais n." : "",
    ng.length ? prefix + "Langues sans genre (" + ng.join(", ") + ") : n pour un nom." : ""
  ].filter(Boolean);
}
function uiLangNameFr() { return langName(state.settings.uiLang, "fr").toLowerCase(); }
// « fr = français, ko = coréen, en = anglais » (consignes envoyées à Claude) ; codes : langues concernées seulement (étape 31).
function langLegend(codes) { return (codes || LANG_CODES).map(c => c + " = " + LANGUAGES[c].names.fr.toLowerCase()).join(", "); }
// Langues visibles (apprise + appui) des cartes de vocabulaire données, dans l'ordre de LANGUAGES.
function cardsLangs(cards) {
  const set = new Set();
  cards.forEach(c => { if (isVocab(c)) studyVisibleLangs(c.listId).forEach(x => set.add(x)); });   // langues étudiées comprises (étape 37)
  return LANG_CODES.filter(x => set.has(x));
}
// Colonnes d'exemple des langues étudiées en plus (exl:<L>, exlt:<L>:<code>) présentes dans ces cartes (étape 37).
function cardsStudyExCols(cards) {
  const out = [];
  cards.forEach(c => studyExtraFields(c).forEach(f => { if ((isExlField(f) || isExltField(f)) && !out.includes(f)) out.push(f); }));
  return out;
}
// « it (italien) » … : langues étudiées en plus d'une liste, pour les consignes.
function studyExtraText(listId) { return studyExtraLangs(listId).join(", "); }
// Langues affichées en plus de la langue apprise (traductions de l'exemple), dans l'ordre de LANGUAGES.
function cardsSupportLangs(cards) {
  const set = new Set();
  cards.forEach(c => { if (isVocab(c)) cardLangs(c).support.forEach(x => set.add(x)); });
  return LANG_CODES.filter(x => set.has(x));
}

function strHash(s) {
  let h = 2166136261;
  s = String(s || "");
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}
// Empreinte : langue apprise, langues d'appui (dans l'ordre), exemple. Pour une liste fr ← ko, en : identique à la version 1.
function cardSig(c) { const lg = cardLangs(c); return strHash([lg.target].concat(lg.support).map(x => term(c, x)).concat([fieldVal(c, "example", lg)]).join("\u0001")); }
function rejectKey(cardId, field, value) { return cardId + "|" + field + "|" + strHash(normText(value)); }
function missingFields(c) { const lg = cardLangs(c); return fillFields(c, lg).filter(f => !fieldVal(c, f, lg).trim()); }
// Nom sans genre dans une langue à genre (« n », ou « nom » importé tel quel) : à corriger (proposition de type Correction).
function posNeedsGender(c, code) {
  if (!LANGUAGES[code] || !LANGUAGES[code].gender) return false;
  const v = String((c.pos || {})[code] || "").trim();
  return !!v && !POS_GENDERED.includes(v) && (v === "n" || parsePos(v, LANG_CODES.find(x => !LANGUAGES[x].gender) || "") === "n");
}
function genderFields(c, lg) { lg = lg || cardLangs(c); return posFields(lg).filter(f => posNeedsGender(c, f.slice(4))); }
// Type de proposition pour un champ demandé à Claude : complétion (vide), correction (genre manquant), sinon rien.
function fillType(c, f) {
  if (!fieldVal(c, f).trim()) return "completion";
  if (isPosField(f) && posNeedsGender(c, f.slice(4))) return "correction";
  return null;
}
function cardsWithGaps(cards) { return cards.filter(c => missingFields(c).length); }
function chunks(a, n) { const out = []; for (let i = 0; i < a.length; i += n) out.push(a.slice(i, i + n)); return out; }

// Ajoute une proposition si elle est utile : jamais sur un champ rempli à la main (complétion),
// jamais une valeur déjà refusée, une seule proposition en attente par carte et par champ.
function addProposal(p) {
  const c = state.cards.find(x => x.id === p.cardId);
  if (!c) return false;
  if (!canEditList(c.listId)) return false;   // liste commune en lecture seule : pas de proposition (étape 30)
  let nv = String(p.newValue || "").replace(/\s+/g, " ").trim();
  if (isPosField(p.field)) nv = parsePos(nv, p.field.slice(4)); // code valide pour la langue, sinon refusé
  if (p.field !== "dup") {
    if (!nv || !checkFields(c).includes(p.field)) return false;
    const cur = fieldVal(c, p.field).trim();
    if (p.type === "completion" && (cur || p.field === cardLangs(c).target)) return false;
    if (p.type === "correction" && (!cur || cur === nv)) return false;
  }
  if (state.rejected.includes(rejectKey(c.id, p.field, nv))) return false;
  if (state.proposals.some(x => x.cardId === c.id && x.field === p.field)) return false;
  state.proposals.push({
    id: uid(), cardId: c.id, field: p.field, type: p.type,
    oldValue: p.field === "dup" ? "" : fieldVal(c, p.field), newValue: nv,
    reason: String(p.reason || "").slice(0, 300), createdAt: Date.now()
  });
  return true;
}

// Doublons dans une même liste (même règle que l'import texte) : on garde la carte la plus travaillée.
// cards : périmètre (par défaut toutes les cartes).
function dupGroups(cards) {
  const groups = new Map();
  (cards || state.cards).filter(isVocab).forEach(c => {          // vocabulaire seulement
    const k = c.listId + "#" + dupKey(c.terms, cardLangs(c));
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(c);
  });
  return groups;
}
function addDuplicateProposals(cards) {
  const groups = dupGroups(cards);
  let n = 0;
  groups.forEach(g => {
    if (g.length < 2) return;
    const keep = g.slice().sort((a, b) => b.stats.seen - a.stats.seen)[0];
    g.forEach(c => {
      if (c !== keep && addProposal({ cardId: c.id, field: "dup", type: "correction", newValue: "", reason: t("pv.dupReason") })) n++;
    });
  });
  return n;
}

// Enregistre sans tout réafficher (une session de révision peut être en cours).
function commitQuiet() {
  state.updatedAt = Date.now();
  Storage.save(state);
  renderPendingBadge();
  if (currentScreen === "pending" || currentScreen === "settings") renderScreen();
}

// --- Consignes envoyées à Claude (identifiants courts k0, k1… pour limiter la taille) ---
// target = code de la langue apprise de la carte ; puis une entrée par langue remplie (apprise + appui).
function aiItems(batch, withMissing, want) {
  return batch.map((c, i) => {
    const lg = cardLangs(c);
    const o = { id: "k" + i, target: lg.target };
    [lg.target].concat(lg.support).forEach(code => { const v = term(c, code); if (v) o[code] = v; });
    exFields(lg).forEach(f => { const v = fieldVal(c, f, lg); if (v) o[f] = v; });   // exemple et ses traductions (étape 35)
    studyExtraFields(c).forEach(f => { const v = fieldVal(c, f); if (v) o[f] = v; });   // langues étudiées en plus (étape 37)
    if (withMissing) o.missing = (want || missingFields)(c);
    return o;
  });
}
// want(carte) → champs demandés (par défaut : tous les champs vides). Un champ « pos: » déjà rempli = genre à préciser.
function completionPrompt(batch, want) {
  return [
    "Tu aides des apprenants en langues. Voici des cartes de vocabulaire. Codes de langue : " + langLegend(cardsLangs(batch)) + ".",
    "Pour chaque carte, \"target\" est la langue apprise ; le champ de cette langue est la référence : ne le change pas.",
    "Complète UNIQUEMENT les champs listés dans \"missing\" (un champ pos: listé alors que le nom n'a pas de genre : donne le code avec le genre) :",
    "- un code de langue : traduction courte et naturelle du mot de la langue apprise dans cette langue ;",
  ].concat(exPromptLines("- "), posPromptLines("- ", cardsLangs(batch)), [
    "Si le mot de la langue apprise contient plusieurs sens séparés par \"/\", tu peux donner plusieurs traductions séparées par \" / \".",
    "Réponds uniquement avec un tableau JSON, un objet par carte, avec l'id et seulement les champs demandés.",
    "Exemple : [{\"id\":\"k0\",\"en\":\"shelf\",\"example\":\"Le livre est sur l'étagère.\",\"extr:en\":\"The book is on the shelf.\",\"pos:fr\":\"nf\",\"pos:en\":\"n\"}]",
    "",
    "Cartes :",
    JSON.stringify(aiItems(batch, true, want))
  ]).join("\n");
}
function verifyPrompt(batch) {
  return [
    "Tu vérifies des cartes de vocabulaire d'apprenants en langues. Codes de langue : " + langLegend(cardsLangs(batch)) + ".",
    "Pour chaque carte, \"target\" est la langue apprise. Champs : un code de langue par mot (celui de la langue apprise est la réponse attendue ; plusieurs réponses séparées par \"/\"), example (phrase d'exemple dans la langue apprise), extr:<code> (traduction de cette phrase dans cette langue).",
    "Signale seulement les vraies erreurs : fautes d'orthographe, accents manquants ou faux, traductions fausses ou douteuses, exemple incorrect. Pas de remarques de style. Rien pour un champ absent.",
    "Pour chaque erreur : field = le code de langue, example ou extr:<code>, la valeur corrigée COMPLÈTE du champ, et une raison très courte en " + uiLangNameFr() + ".",
    "Réponds uniquement avec un tableau JSON, vide [] si tout est correct.",
    "Exemple : [{\"id\":\"k0\",\"field\":\"fr\",\"value\":\"l'école\",\"reason\":\"accent manquant\"}]",
    "",
    "Cartes :",
    JSON.stringify(aiItems(batch, false))
  ].join("\n");
}
// Applique la réponse d'un lot. Renvoie le nombre de propositions ajoutées.
function applyAiResult(kind, batch, res, want) {
  if (!Array.isArray(res)) return 0;
  let n = 0;
  res.forEach(item => {
    if (!item || typeof item !== "object") return;
    const m = /^k(\d+)$/.exec(String(item.id || ""));
    const c = m && batch[+m[1]];
    if (!c) return;
    if (kind === "complete") {
      (want || fillFields)(c).forEach(f => {
        let v = item[f];
        if (v == null && isPosField(f) && item.pos && typeof item.pos === "object") v = item.pos[f.slice(4)]; // forme { pos: { fr: "nf" } } acceptée aussi
        const type = fillType(c, f);
        if (typeof v === "string" && type && addProposal({ cardId: c.id, field: f, type, newValue: v, reason: type === "correction" ? t("upd.genderReason") : "" })) n++;
      });
    } else if (checkFields(c).includes(item.field) && typeof item.value === "string") {
      if (addProposal({ cardId: c.id, field: item.field, type: "correction", newValue: item.value, reason: typeof item.reason === "string" ? item.reason : "" })) n++;
    }
  });
  return n;
}
function aiErrorText(e) {
  const code = e && e.code;
  if (code === "rate_limited") return t("ai.err.rate");
  if (AI.isOffCode(code)) return t("ai.err.off");
  return t("ai.err.other");
}

// Traitement par lots de CONFIG.AI_BATCH cartes, un lot après l'autre (jamais en parallèle ni en boucle de réessai).
// opts : { silent (vérification automatique), extra (propositions déjà ajoutées, ex. doublons),
//          want (champs demandés par carte, complétion), noEndModal (pas de fenêtre de fin : l'appelant l'affiche),
//          resumeCats (complétion lancée par « Mettre à jour » : catégories gardées pour la reprise) }
// Complétion : cartes restantes enregistrées avant le 1er lot, après chaque lot et dès que l'appli passe en arrière-plan
// (state.aiResume) ; propositions de chaque lot rangées tout de suite dans « À valider ». Champs ayant déjà une proposition
// en attente : jamais redemandés (pas de doublon à la reprise). Écran gardé allumé pendant le traitement (Wake).
// Interruption (appel échoué pendant / après l'arrière-plan, ou absence > AI_AWAY_MS) : pas de fenêtre d'erreur,
// bandeau « Reprendre / Abandonner » ; la reprise repart du lot non terminé.
// Renvoie { added, error, stopped, interrupted } (null si rien n'a été lancé ou si le compte a changé).
async function runAiJob(kind, cards, opts) {
  opts = opts || {};
  if (aiJob) { if (!opts.silent) toast(t("ai.busy")); return null; }
  const st = state, who = Storage.getUser();
  const isComplete = kind === "complete";
  let want = opts.want;
  if (isComplete) {
    const base = opts.want || missingFields;
    const has = new Set(state.proposals.map(p => p.cardId + "|" + p.field));
    want = c => base(c).filter(f => !has.has(c.id + "|" + f));
    cards = cards.filter(c => want(c).length);
  }
  const batches = chunks(cards, CONFIG.AI_BATCH);
  const ctl = new AbortController();
  const job = { ctl, hiddenAt: 0, wasHidden: false, interrupted: false, onHide: null };
  aiJob = job;
  let added = opts.extra || 0, error = null, stopped = false, prog = null, next = 0;
  // Complétion : enregistre les cartes restantes (reprise plus tard), ou rien si tout est fait.
  const saveResume = () => {
    if (!isComplete) return;
    const live = new Set(state.cards.map(c => c.id));
    const ids = [];
    for (let j = next; j < batches.length; j++) batches[j].forEach(c => { if (live.has(c.id)) ids.push(c.id); });
    state.aiResume = ids.length ? { kind: "complete", ids } : null;
    updResumeSync(opts.resumeCats || null);
  };
  const persist = () => { commitQuiet(); Storage.flushNow(); };   // local tout de suite, cloud sans attendre les 2 s
  if (isComplete) job.onHide = () => { if (state === st && Storage.getUser() === who) { saveResume(); persist(); } };
  Wake.on();
  renderResumeBars();
  if (!opts.silent) {
    prog = openProgress(t("ai.progressTitle." + kind), t("ai.progress", { i: 1, n: Math.max(1, batches.length) }),
      [{ label: t(isComplete ? "ai.pause" : "ai.stop"), onClick: () => { ctl.abort(); } }]);
  }
  try {
    if (isComplete && batches.length) { saveResume(); persist(); }
    for (let i = 0; i < batches.length; i++) {
      next = i;
      if (ctl.signal.aborted) { stopped = true; break; }
      if (prog) prog.set(i / batches.length, t("ai.progress", { i: i + 1, n: batches.length }));
      const batch = batches[i];
      job.wasHidden = document.visibilityState === "hidden";
      let res;
      try { res = await AI.ask(isComplete ? completionPrompt(batch, want) : verifyPrompt(batch), ctl.signal); }
      catch (e) {
        if (job.interrupted || job.wasHidden || document.visibilityState === "hidden") { job.interrupted = true; stopped = true; }
        else if (e && e.code === "cancelled") stopped = true;
        else error = e;
        break;
      }
      if (state !== st || Storage.getUser() !== who) return null; // compte changé ou données importées entre-temps
      added += applyAiResult(kind, batch, res, want);
      if (kind === "verify") batch.forEach(c => { if (state.cards.includes(c)) state.checkedSig[c.id] = cardSig(c); });
      next = i + 1;
      saveResume();
      persist();
    }
    if (isComplete && (stopped || error) && state === st && Storage.getUser() === who) { saveResume(); persist(); }
  } finally {
    if (aiJob === job) aiJob = null;
    Wake.off();
    if (prog) prog.close();
    renderResumeBars();
  }
  if (state !== st || Storage.getUser() !== who) return null;
  const interrupted = job.interrupted && stopped;
  const result = { added, error, stopped, interrupted };
  if (opts.silent) { if (added) toast(t("ai.autoDone", { n: added })); return result; }
  if (opts.noEndModal) return result;
  if (interrupted) return result;   // bandeau « Reprendre / Abandonner » (renderResumeBars)
  let msg = error ? aiErrorText(error) : stopped ? t(isComplete ? "ai.paused" : "ai.stopped", { n: added }) : added ? t("ai.done", { n: added }) : t("ai.doneNone");
  if (error && added) msg += " " + t("ai.done", { n: added });
  if (error && isComplete && state.aiResume) msg += " " + t("ai.resumeLater");
  const actions = [{ label: t("close") }];
  if (added) actions.push({ label: t("ai.see"), kind: "primary", onClick: () => { goPending(); } });
  openModal(t("ai.doneTitle"), el("p", null, msg), actions);
  return result;
}

function goPending() {
  try { history.replaceState(null, "", "#" + HASH_OF.pending); } catch (e) {}
  showScreen("pending");
}

// Après l'ajout de cartes (manuel ou import) : proposer de compléter les trous.
function offerCompletion(cardIds) {
  const ids = new Set(cardIds || []);
  const cards = state.cards.filter(c => ids.has(c.id) && missingFields(c).length);
  if (!cards.length) return;
  openModal(t("ai.offerTitle"), el("p", null, t("ai.offer", { n: cards.length })), [
    { label: t("ai.offerNo") },
    { label: t("ai.offerYes"), kind: "primary", onClick: () => { startCompletion(cards.map(c => c.id)); } }
  ]);
}
// ids : cartes ciblées (null = toutes). want : champs demandés par carte (null = tous les champs vides).
// fromResume : reprise depuis les Réglages ; si la complétion en pause venait de « Mettre à jour », mêmes catégories.
async function startCompletion(ids, want, fromResume) {
  await AI.ready();
  const cats = fromResume ? updResumeCats() : null;
  if (cats) want = updWant(cats);
  const set = ids ? new Set(ids) : null;
  await Dict.fillFromCommon(state.cards.filter(c => isVocab(c) && (!set || set.has(c.id))));   // d'abord le dictionnaire commun (étape 36)
  const cards = state.cards.filter(c => (!set || set.has(c.id)) && (want ? want(c) : missingFields(c)).length);
  if (!cards.length) { toast(t("ai.nothingToComplete")); return; }
  if (AI.isOn()) await runAiJob("complete", cards, { want, resumeCats: cats });
  else openPrepare("complete", cards);
}
// Bouton « Vérifier mes listes » : toutes les cartes.
async function startVerify() {
  if (aiJob) { toast(t("ai.busy")); return; }
  await AI.ready();
  if (!state.cards.length) { toast(t("ai.noCards")); return; }
  const nd = addDuplicateProposals();
  if (nd) commitQuiet();
  const cards = state.cards.filter(c => isVocab(c) && canEditList(c.listId)); // vocabulaire seulement, pas les listes communes en lecture seule
  if (!cards.length) { toast(t("ai.noCards")); return; }
  if (!AI.isOn()) { if (nd) toast(t("ai.autoDone", { n: nd })); openPrepare("verify", cards); return; }
  const b = Math.ceil(cards.length / CONFIG.AI_BATCH);
  if (b <= 3) { runAiJob("verify", cards, { extra: nd }); return; }
  openModal(t("ai.verify"), el("p", null, t("ai.verifyConfirm", { n: cards.length, b })), [
    { label: t("cancel") },
    { label: t("confirm"), kind: "primary", onClick: () => { runAiJob("verify", cards, { extra: nd }); } }
  ]);
}

// Au lancement : au plus une fois par semaine, et seulement les cartes nouvelles ou modifiées depuis leur dernière vérification.
// Premier lancement d'un compte : on démarre le compteur sans rien envoyer.
async function autoWeeklyCheck(id) {
  try {
    if (Storage.getUser() !== id) return;
    if (!state.lastCheckAt) { state.lastCheckAt = Date.now(); commitQuiet(); return; }
    if (Date.now() - state.lastCheckAt < CONFIG.AUTO_CHECK_DAYS * 864e5 || !state.cards.length) return;
    const st = state;
    await AI.ready();
    if (Storage.getUser() !== id || state !== st) return;
    state.lastCheckAt = Date.now();
    const nd = addDuplicateProposals();
    commitQuiet();
    const todo = AI.isOn() ? state.cards.filter(c => isVocab(c) && state.checkedSig[c.id] !== cardSig(c)) : [];
    if (!todo.length) { if (nd) toast(t("ai.autoDone", { n: nd })); return; }
    toast(t("ai.autoStart"));
    await runAiJob("verify", todo, { silent: true, extra: nd });
  } catch (e) { /* jamais bloquant */ }
}

// Carte « Complétion et vérification » des Réglages.
function renderAiCard() {
  const box = $("#aiCard");
  if (!box) return;
  box.textContent = "";
  box.appendChild(el("h2", null, t("ai.title")));
  const st = AI.status();
  const p = el("p", "muted", t(st === "pending" ? "ai.checking" : st === "on" ? "ai.on" : "ai.off"));
  p.style.marginTop = "0";
  box.appendChild(p);
  const btns = el("div", "btns");
  const b1 = el("button", "btn", t("ai.complete", { n: cardsWithGaps(state.cards).length }));
  const b2 = el("button", "btn", t("ai.verify"));
  b1.disabled = b2.disabled = st === "pending";
  b1.addEventListener("click", () => startCompletion(null));
  b2.addEventListener("click", () => startVerify());
  btns.append(b1, b2);
  if (state.aiResume && st === "on") {
    const br = el("button", "btn primary", t("ai.resume", { n: state.aiResume.ids.length }));
    br.addEventListener("click", () => startCompletion(state.aiResume.ids.slice(), null, true));
    btns.appendChild(br);
  }
  box.appendChild(btns);
  // Échange par fichier avec Claude (toujours disponible ; l'import lit aussi l'ancien format « Préparer pour Claude »)
  const fxb = el("div", "btns");
  const b4 = el("button", "btn", t("fx.exportBtn"));
  const b3 = el("button", "btn", t("ai.importReply"));
  b4.addEventListener("click", () => openFxExport("all"));
  b3.addEventListener("click", openFxImport);
  fxb.append(b4, b3);
  fxb.style.marginTop = "8px";
  box.appendChild(fxb);
  if (Queue.usable()) box.appendChild(queueAiCardBlock());   // file d'attente Claude (mode Supabase)
  let last = t("ai.never");
  try { if (state.lastCheckAt) last = t("ai.lastCheck", { d: new Date(state.lastCheckAt).toLocaleDateString(state.settings.uiLang) }); } catch (e) {}
  box.appendChild(el("div", "ai-last", last));
}

// === PRÉPARER POUR CLAUDE (REPLI) ===
// Sans accès direct à Claude : texte (consignes + lignes) à copier dans une conversation, puis réimport de la réponse.
// Lignes envoyées : en-tête « liste;<codes de langue>;example » puis une ligne par carte (toutes les langues de LANGUAGES).
// Complétion : en plus, une colonne « pos:<code> » par langue (nature grammaticale).
// Complétion  — reçues : mêmes lignes complétées, avec l'en-tête.
// Vérification — reçues : liste;mot;champ;valeur corrigée;raison (mot = mot de la langue apprise, champ = code de langue ou example).
// Correspondance au réimport : nom de la liste + mot de la langue apprise de cette liste (sans casse ni accents).
const PREP_LIST_WORDS = ["liste", "list", "목록"];

// Code de langue, "example" ou "extr:<code>" pour un nom de champ (code, nom de langue, exemple…), sinon null.
function fieldAlias(s) {
  const m = /^(?:pos|nature)\s*[:_\-\s]\s*([a-z]{2,3})$/i.exec(String(s || "").trim()); // pos:fr, nature fr…
  if (m && isLang(m[1].toLowerCase())) return posField(m[1].toLowerCase());
  const x = /^(?:extr|trad_exemple|example_tr)\s*[:_\-\s]\s*([a-z]{2,3})$/i.exec(String(s || "").trim()); // extr:en (étape 35)
  if (x && isLang(x[1].toLowerCase())) return exTrField(x[1].toLowerCase());
  const y = /^exl\s*:\s*([a-z]{2,3})$/i.exec(String(s || "").trim()), z = /^exlt\s*:\s*([a-z]{2,3})\s*:\s*([a-z]{2,3})$/i.exec(String(s || "").trim());   // étape 37
  if (y && isLang(y[1].toLowerCase())) return exlField(y[1].toLowerCase());
  if (z && isLang(z[1].toLowerCase()) && isLang(z[2].toLowerCase())) return exltField(z[1].toLowerCase(), z[2].toLowerCase());
  const k = headerKind(s); return isLang(k) || k === "example" ? k : null;
}
function prepCell(s) { return String(s || "").replace(/[;\r\n]+/g, " ").trim(); }
function prepListName(id) { const l = getList(id); return prepCell(l ? l.name : ""); }
// Colonnes de langue : langues affichées des cartes (displayLangs, étape 35) ; case d'une langue cachée pour une carte : vide.
// Exemple : colonne example (langue apprise) puis extr:<code> (sa traduction) pour chaque langue affichée en plus.
function prepText(kind, cards) {
  const langs = cardsLangs(cards);
  const posCols = kind === "complete" ? langs.map(posField) : [];
  const exCols = cardsSupportLangs(cards).map(exTrField).concat(cardsStudyExCols(cards));   // + exl:/exlt: (étape 37)
  const cols = ["liste"].concat(langs, ["example"], exCols, posCols);
  // Langue apprise et langues d'appui de chaque liste présente
  const seen = new Set(), perList = [];
  cards.forEach(c => {
    if (seen.has(c.listId)) return;
    seen.add(c.listId);
    const lg = listLangs(c.listId);
    const ex = studyExtraText(c.listId);
    perList.push("- " + prepListName(c.listId) + " : langue apprise " + lg.target + ", langues d'appui " + (lg.support.join(", ") || "—") + (ex ? ", langues étudiées en plus " + ex : ""));
  });
  const head = kind === "complete" ? [
    "Complète les champs vides de ces cartes de vocabulaire, pour des apprenants en langues.",
    "Codes de langue : " + langLegend(langs) + ".",
    "Langues de chaque liste :"
  ].concat(perList, [
    "Colonnes (voir la ligne d'en-tête) : " + cols.join(";"),
    "- Remplis seulement les champs vides des langues d'appui de la liste, l'exemple, ses traductions (colonnes extr:) et la nature (colonnes pos:) des mots présents ou que tu ajoutes. Ne change jamais la liste, le mot de la langue apprise, ni un champ déjà rempli. Une colonne d'une langue qui n'est ni la langue apprise ni une langue d'appui de la liste reste vide.",
    "- Seule exception : une nature « n » (nom sans genre) dans une langue avec genre : remplace-la par le code avec le genre.",
    "- Traductions courtes ; exemple : une phrase courte et simple DANS LA LANGUE APPRISE de la liste (niveau débutant) qui utilise le mot ; extr:<code> = traduction de cette phrase dans cette langue.",
    "- Langue étudiée en plus d'une liste : remplis aussi le mot dans cette langue (traduction du mot de la langue apprise), sa nature (pos:), exl:<code> = phrase d'exemple courte dans cette langue, exlt:<code>:<code2> = traduction de cette phrase dans code2."
  ], posPromptLines("- ", langs), [
    "- Pas de « ; » à l'intérieur d'un champ.",
    "Réponds uniquement avec la ligne d'en-tête puis les lignes complétées, dans le même format, une par ligne, sans autre texte."
  ]) : [
    "Vérifie ces cartes de vocabulaire d'apprenants en langues.",
    "Codes de langue : " + langLegend(langs) + ".",
    "Langues de chaque liste :"
  ].concat(perList, [
    "Colonnes (voir la ligne d'en-tête) : " + cols.join(";"),
    "Repère seulement les vraies erreurs : fautes d'orthographe, accents manquants ou faux, traductions fausses ou douteuses, exemple incorrect.",
    "Réponds uniquement avec une ligne par erreur, au format : liste;mot;champ;valeur corrigée;raison",
    "- mot = le mot de la langue apprise de la liste, tel qu'il est écrit ci-dessous, même s'il contient l'erreur.",
    "- champ = le code de langue (" + langs.join(", ") + "), example ou extr:<code>.",
    "- valeur corrigée = le contenu complet du champ corrigé, sans « ; ».",
    "- raison = très courte, en " + uiLangNameFr() + ".",
    "Si tout est correct, réponds seulement : RAS"
  ]);
  const lines = cards.map(c => {
    const lg = cardLangs(c), vis = studyVisibleLangs(c.listId), ext = studyExtraFields(c);
    const own = f => ((isExlField(f) || isExltField(f)) ? ext.includes(f) : isExTrField(f) ? lg.support.includes(fieldCode(f)) : vis.includes(fieldCode(f))) ? fieldVal(c, f, lg) : "";   // langue cachée : jamais envoyée
    return [prepListName(c.listId)].concat(langs.map(own), [fieldVal(c, "example", lg)], exCols.map(own), posCols.map(own)).map(prepCell).join(";");
  });
  return head.concat([""], [cols.join(";")], lines).join("\n");
}
function copyText(text, ta) {
  try { navigator.clipboard.writeText(text).then(() => toast(t("copied")), () => { ta.select(); }); }
  catch (e) { ta.select(); }
}
function openPrepare(kind, cards) {
  const parts = chunks(cards, CONFIG.AI_BATCH);
  let idx = 0;
  const wrap = el("div");
  wrap.appendChild(el("p", "muted", t("prep.help")));
  const ta = el("textarea");
  ta.readOnly = true;
  const fill = () => { ta.value = prepText(kind, parts[idx]); };
  if (parts.length > 1) {
    const sel = el("select", "input");
    sel.style.marginBottom = "10px";
    parts.forEach((p, i) => {
      const a = i * CONFIG.AI_BATCH + 1;
      const o = el("option", null, t("prep.part", { i: i + 1, n: parts.length, a, b: a + p.length - 1 }));
      o.value = String(i);
      sel.appendChild(o);
    });
    sel.addEventListener("change", () => { idx = +sel.value || 0; fill(); });
    wrap.appendChild(sel);
  }
  fill();
  wrap.appendChild(ta);
  const acts = [
    { label: t("copy"), kind: "primary", onClick: () => { copyText(ta.value, ta); return false; } },
    { label: t("prep.import"), onClick: () => { openReplyImport(); } },
    { label: t("close") }
  ];
  if (Queue.usable()) {                  // file d'attente Claude : même travail, sans copier-coller
    wrap.insertBefore(el("p", "q-note", t("queue.prepNote")), wrap.firstChild);
    const want = kind === "complete" ? (c => prepWantFor(c) || missingFields(c)) : null;
    acts.unshift({ label: t("queue.ask"), kind: "primary", onClick: () => { queueSubmitCards(kind, cards, want, null); } });
    acts[1].kind = "";
  }
  openModal(t("prep.title." + kind), wrap, acts);
}

function findCardsFor(listName, word) {
  const ln = normText(prepCell(listName)), w = normText(word);
  if (!w) return [];
  const lists = state.lists.filter(l => normText(prepCell(l.name)) === ln);
  const ids = new Map(lists.map(l => [l.id, listLangs(l).target]));
  return state.cards.filter(c => ids.has(c.listId) && normText(term(c, ids.get(c.listId))) === w);
}
// Analyse la réponse collée. Renvoie { added, unknown }.
function importReply(text) {
  let added = 0, unknown = 0;
  let cols = LANG_CODES.concat(["example"]); // colonnes après « liste » (remplacées par la ligne d'en-tête si présente)
  let sawHeader = false;                       // en-tête vu = réponse de complétion
  String(text || "").split(/\r?\n/).forEach(raw => {
    const line = raw.trim().replace(/^[-*•]\s+/, "");
    if (!line || line.startsWith("```") || /^ras\.?$/i.test(line) || !line.includes(";")) return;
    const parts = line.split(";").map(s => s.trim());
    if (PREP_LIST_WORDS.includes(normText(parts[0]))) { // ligne d'en-tête
      cols = parts.slice(1).map(x => fieldAlias(x) || "ignore");
      sawHeader = true;
      return;
    }
    if (parts.length < 3) { unknown++; return; }
    const field = !sawHeader && parts.length >= 4 ? fieldAlias(parts[2]) : null;
    if (field && parts.length <= 6) {                // vérification : liste;mot;champ;valeur;raison
      const cands = findCardsFor(parts[0], parts[1]);
      if (cands.length) {
        const reason = parts.slice(4).join("; ");
        for (const c of cands) if (addProposal({ cardId: c.id, field, type: "correction", newValue: parts[3], reason })) { added++; break; }
        return;
      }
    }
    // complétion : liste;<colonnes>
    const vals = {};
    cols.forEach((k, i) => { if (k !== "ignore") vals[k] = parts[i + 1] || ""; });
    if (cols[cols.length - 1] === "example" && parts.length > cols.length + 1) vals.example = parts.slice(cols.length).join("; ");
    const lists = state.lists.filter(l => normText(prepCell(l.name)) === normText(prepCell(parts[0])));
    let cands = [];
    for (const l of lists) { const tg = listLangs(l).target; if (vals[tg]) cands = cands.concat(findCardsFor(parts[0], vals[tg]).filter(c => c.listId === l.id)); }
    if (!cands.length) { unknown++; return; }
    const same = (a, b) => !String(a || "").trim() || !b || normText(a) === normText(b);
    const fit = cands.filter(x => cardLangs(x).support.every(code => same(term(x, code), vals[code])));
    const c = fit.find(x => missingFields(x).length) || fit[0] || cands.find(x => missingFields(x).length) || cands[0];
    (prepWantFor(c) || fillFields(c)).forEach(f => {
      const type = fillType(c, f);
      if (vals[f] && type && addProposal({ cardId: c.id, field: f, type, newValue: vals[f], reason: type === "correction" ? t("upd.genderReason") : "" })) added++;
    });
  });
  return { added, unknown };
}
function openReplyImport() {
  const wrap = el("div");
  wrap.appendChild(el("p", "muted", t("reply.help")));
  const ta = el("textarea");
  ta.spellcheck = false;
  ta.setAttribute("autocapitalize", "off"); ta.setAttribute("autocorrect", "off");
  wrap.appendChild(ta);
  openModal(t("reply.title"), wrap, [
    { label: t("cancel") },
    { label: t("reply.analyze"), kind: "primary", onClick: () => {
      const r = importReply(ta.value);
      if (!r.added) { toast(t("reply.none") + (r.unknown ? " · " + t("reply.done", { n: 0, m: r.unknown }) : "")); return false; }
      commit();
      openModal(t("ai.doneTitle"), el("p", null, t("reply.done", { n: r.added, m: r.unknown })), [
        { label: t("close") },
        { label: t("ai.see"), kind: "primary", onClick: () => { goPending(); } }
      ]);
    } }
  ]);
  setTimeout(() => { try { ta.focus(); } catch (e) {} }, 50);
}

// === ÉCHANGE PAR FICHIER AVEC CLAUDE ===
// Troisième voie de complétion (en plus du copier-coller et de la file d'attente) :
// 1. « Télécharger le fichier pour Claude » : périmètre (tout / dossier / liste) + champs à compléter ; seulement les cartes
//    avec au moins un champ choisi vide ; fichiers de FX_MAX cartes max (plusieurs parties → un .zip, ou fichiers séparés).
//    Contenu : consignes « # » pour Claude, puis une section par type de carte (ligne d'en-tête + une ligne par carte),
//    séparateur « ; », 1re colonne = id de la carte, 2e = type, dernière = sig (empreinte de la carte à l'export).
//    Case vide = à remplir ; case « - » = ne pas remplir (champ non choisi ou hors langues de la liste).
// 2. « Importer la réponse de Claude » : un ou plusieurs fichiers .txt / .csv, ou texte collé ; lignes « # » et texte avant
//    la 1re ligne d'en-tête ignorés ; correspondance par id uniquement ; seulement les cases vides dans l'appli
//    (case remplie changée par Claude = « Correction proposée », signalée à part, envoyée seulement si on coche la case) ;
//    bilan avant validation ; tout va dans « À valider » (addProposal) : importer deux fois le même fichier ne crée rien.
// Lecture : bulkLines / bulkSeparator / readTextFile (import en masse). Sans en-tête « id;type » : ancien format
// « Préparer pour Claude » (importReply).
const FX_MAX = 200;                  // cartes max par fichier
const FX_EMPTY = "-";                // case à ne pas remplir
// Champs des autres types de cartes que Claude peut compléter.
const FX_TYPED = { conj: ["translation"], cloze: ["hint", "explanation", "translation"], fix: ["explanation"], rule: ["examples", "translation"] };
// Colonnes de chaque section : [nom de colonne, clé] ; clé = champ (fieldVal) ou info (lecture seule).
const FX_TYPED_COLS = {
  conj: [["verbe", "i:verb"], ["temps", "i:tense"], ["personne", "i:person"], ["forme", "i:answer"], ["traduction", "f:translation"], ["note", "f:note"]],
  cloze: [["phrase", "i:sentence"], ["reponse", "i:answer"], ["indice", "f:hint"], ["explication", "f:explanation"], ["traduction", "f:translation"]],
  fix: [["phrase_fautive", "i:wrong"], ["phrase_corrigee", "i:correct"], ["explication", "f:explanation"]],
  rule: [["titre", "i:title"], ["texte", "i:body"], ["exemples", "f:examples"], ["traduction", "f:translation"]]
};
const FX_CHOICES = ["tr", "pos", "example", "other"];   // example : exemple et ses traductions (étape 35)

function fxCell(s) { return String(s == null ? "" : s).replace(/[;\t\r\n]+/g, " ").replace(/\s+/g, " ").trim(); }
// Empreinte du contenu d'une carte (changement entre l'export et l'import).
function fxSig(c) {
  const o = isVocab(c)
    ? { t: Object.keys(c.terms || {}).sort().map(k => [k, c.terms[k]]), p: Object.keys(c.pos || {}).sort().map(k => [k, c.pos[k]]), e: fieldVal(c, "example"), x: JSON.stringify(exMap(c) || {}) }
    : normTypedFields(c.type, c);
  return strHash(cardType(c) + "\u0001" + JSON.stringify(o));
}
// Champs qu'une carte peut recevoir par ce fichier (cases à compléter, jamais la langue apprise).
function fxFillable(c, lg) {
  if (!isVocab(c)) return (FX_TYPED[c.type] || []).map(typedField);
  lg = lg || cardLangs(c);
  return withStudyFields(c, lg, lg.support.concat(posFields(lg), exFields(lg)));   // + langues étudiées en plus (étape 37)
}
// Cases demandées (vides) pour les choix cochés.
function fxWanted(c, choice, lg) {
  const out = [];
  if (!isVocab(c)) {
    if (choice.other) (FX_TYPED[c.type] || []).forEach(n => { const f = typedField(n); if (!fieldVal(c, f).trim()) out.push(f); });
    return out;
  }
  lg = lg || cardLangs(c);
  if (choice.tr) lg.support.forEach(code => { if (!term(c, code).trim()) out.push(code); });
  if (choice.pos) [lg.target].concat(lg.support).forEach(code => {
    const f = posField(code);
    if (fieldVal(c, f).trim()) return;
    if (term(c, code).trim() || (choice.tr && code !== lg.target)) out.push(f);   // nature d'un mot présent ou demandé
  });
  if (choice.example) exFields(lg).forEach(f => { if (!fieldVal(c, f, lg).trim()) out.push(f); });
  if (!lg.study) studyExtraFields(c).forEach(f => {                    // langues étudiées en plus (étape 37)
    if (fieldVal(c, f).trim() || out.includes(f)) return;
    if (isExlField(f) || isExltField(f) ? choice.example : isPosField(f) ? choice.pos : choice.tr) out.push(f);
  });
  return out;
}
function fxScopeCards(scope) {
  const [k, id] = String(scope || "all").split(":");
  const ok = c => canEditList(c.listId);   // listes communes en lecture seule exclues (étape 30)
  if (k === "list") return getList(id) ? cardsOf(id).filter(ok) : [];
  if (k === "folder") { const f = getFolder(id); return f ? cardsUnder("folder", f).filter(ok) : []; }
  return state.cards.filter(ok);
}
function fxScopeName(scope) {
  const [k, id] = String(scope || "all").split(":");
  const o = k === "list" ? getList(id) : k === "folder" ? getFolder(id) : null;
  return o ? o.name : "tout";
}
function fxSlug(s) { return String(s || "").normalize("NFC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "liste"; }
function fxFileName(scope, i, n) { return "vocab-completion-" + fxSlug(fxScopeName(scope)) + (n > 1 ? "-partie-" + i + "-sur-" + n : "") + ".txt"; }

// En-tête des colonnes d'une section.
// Vocabulaire : trad_exemple_<code> = traduction de l'exemple dans cette langue (étape 35).
function fxHeader(type, langs, exLangs, stCols) {
  const st = arr(stCols).map(f => { const x = exlParts(f); return isExlField(f) ? "exemple_" + x.L : "trad_exemple_" + x.L + "_" + x.code; });   // étape 37
  if (type === "vocab") return ["id", "type", "liste", "target"].concat(langs, langs.map(x => "pos_" + x), ["exemple"], arr(exLangs).map(x => "trad_exemple_" + x), st, ["sig"]);
  return ["id", "type", "liste", "target"].concat(FX_TYPED_COLS[type].map(x => x[0]), ["sig"]);
}
// Texte d'un fichier (une partie).
function fxFileText(cards, choice, i, n) {
  const lgs = new Map(), lgOf = c => { let x = lgs.get(c.listId); if (!x) { x = cardLangs(c); lgs.set(c.listId, x); } return x; };
  const langs = LANG_CODES.filter(code => cards.some(c => isVocab(c) && studyVisibleLangs(c.listId).includes(code)));   // langues affichées (et étudiées, étape 37) seulement
  const exLangs = LANG_CODES.filter(code => cards.some(c => isVocab(c) && lgOf(c).support.includes(code)));
  const stCols = cardsStudyExCols(cards);   // exemple_<L>, trad_exemple_<L>_<code> (étape 37)
  const seenL = new Set(), perList = [];
  cards.forEach(c => {
    if (seenL.has(c.listId)) return; seenL.add(c.listId);
    const lg = lgOf(c), nm = code => code + " (" + LANGUAGES[code].names.fr.toLowerCase() + ")";
    const ex = studyExtraLangs(c.listId);
    perList.push("#   - " + prepListName(c.listId) + " : langue apprise " + nm(lg.target) + " ; langues d'appui " + (lg.support.map(nm).join(", ") || "—") + (ex.length ? " ; langues étudiées en plus " + ex.map(nm).join(", ") : ""));
  });
  const types = CARD_TYPES.filter(ty => cards.some(c => cardType(c) === ty));
  const g = langs.filter(c => LANGUAGES[c].gender), ng = langs.filter(c => !LANGUAGES[c].gender);
  const head = [
    "# FICHIER DE COMPLÉTION — appli Vocab" + (n > 1 ? " — partie " + i + " sur " + n : "") + " — " + todayStr(),
    "# Rôle : tu complètes des cartes de révision de langues pour des apprenants.",
    "# Codes de langue : " + langLegend(langs.length ? langs : null) + ".",
    "# Langues de chaque liste (colonne « liste ») :"
  ].concat(perList, [
    "# Règles :",
    "# - Remplis seulement les cases VIDES (rien entre deux « ; »).",
    "# - Une case qui contient seulement « - » ne doit pas être remplie : laisse « - ».",
    "# - Ne modifie jamais une case déjà remplie, ni les colonnes id, type, liste, target et sig.",
    "# - Garde toutes les lignes, dans le même ordre, avec le même nombre de colonnes.",
    "# - N'utilise jamais « ; » à l'intérieur d'une case (ni retour à la ligne).",
    "# - Colonne d'une langue (" + langs.join(", ") + ") : traduction courte et naturelle du mot de la langue apprise (target). Plusieurs sens : séparés par « / ».",
    "# - Colonnes pos_<langue> : nature grammaticale du mot de cette langue, avec UN de ces codes : nm, nf, nmf, nmpl, nfpl, n, v, vpr, adj, adv, prep, conj, pron, interj, expr.",
    "#   " + [g.length ? "Langues avec genre (" + g.join(", ") + ") : un nom a toujours son genre (nm, nf, nmf, nmpl, nfpl), jamais n." : "",
      ng.length ? "Langues sans genre (" + ng.join(", ") + ") : n pour un nom." : ""].filter(Boolean).join(" "),
    "# - Colonne exemple : une phrase courte et simple DANS LA LANGUE APPRISE (target), niveau débutant, qui utilise le mot.",
    "# - Colonnes trad_exemple_<langue> : traduction de la phrase de la colonne exemple dans cette langue."
  ]);
  if (stCols.length) head.push(
    "# - Langue étudiée en plus (voir les listes) : sa colonne de langue = traduction du mot de la langue apprise ; exemple_<langue> = phrase courte et simple",
    "#   dans cette langue qui utilise ce mot ; trad_exemple_<langue>_<langue2> = traduction de cette phrase dans langue2."
  );
  if (types.some(ty => ty !== "vocab")) head.push(
    "# - Autres types de cartes : traduction = sens dans les langues d'appui de la liste ; explication = explication courte de la réponse (dans la 1re langue d'appui) ;",
    "#   indice = indice court (ex. « article + nom ») ; exemples (fiche de règle) = 2 ou 3 phrases courtes dans la langue apprise, séparées par « | »."
  );
  head.push(
    "# Format de réponse : « Rends exactement le même fichier, avec les cases vides remplies, sous forme de fichier .txt téléchargeable, sans autre texte. »",
    ""
  );
  const out = head.slice();
  types.forEach(ty => {
    out.push(fxHeader(ty, langs, exLangs, stCols).join(";"));
    cards.filter(c => cardType(c) === ty).forEach(c => {
      const lg = lgOf(c), want = new Set(fxWanted(c, choice, lg));
      const vis = isVocab(c) ? studyVisibleLangs(c.listId) : null, ext = isVocab(c) ? studyExtraFields(c) : [];
      const hidden = f => !!vis && ((isExlField(f) || isExltField(f)) ? !ext.includes(f) : isExTrField(f) ? !lg.support.includes(fieldCode(f)) : (isLang(f) || isPosField(f)) && !vis.includes(fieldCode(f)));
      // Langue cachée pour cette carte (ni apprise ni d'appui) : jamais envoyée, case « - » (étape 31).
      const cell = f => { if (hidden(f)) return FX_EMPTY; const v = fxCell(fieldVal(c, f)); return v || (want.has(f) ? "" : FX_EMPTY); };
      let row = [c.id, ty, prepListName(c.listId), isVocab(c) ? lg.target : cardLang(c)];
      if (ty === "vocab") row = row.concat(langs.map(cell), langs.map(x => cell(posField(x))), [cell("example")], exLangs.map(x => cell(exTrField(x))), stCols.map(cell));
      else row = row.concat(FX_TYPED_COLS[ty].map(([, k]) => k.startsWith("f:") ? cell(k) :
        fxCell(k === "i:tense" ? tenseName(c.lang, c.tense) : k === "i:person" ? personLabel(c.lang, c.tense, c.person) : c[k.slice(2)])));
      row.push(fxSig(c));
      out.push(row.map(fxCell).join(";"));
    });
    out.push("");
  });
  return out.join("\n");
}

// --- Téléchargement : un fichier (capacité downloads dans Claude, sinon lien), ou false ---
async function fxSave(filename, data) {
  try {
    const dl = inClaude() ? await window.claude.use("downloads") : null;
    if (dl) { await dl.save({ filename, data }); return true; }
  } catch (e) { if (e && e.code === "declined") return "declined"; }
  if (inClaude()) return false;
  try {
    const blob = data instanceof Blob ? data : new Blob([data], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    return true;
  } catch (e) { return false; }
}
// Archive .zip sans compression (format « stored »), sans bibliothèque : [{ name, text }] → Blob.
let fxCrcTable = null;
function fxCrc32(bytes) {
  if (!fxCrcTable) { fxCrcTable = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; fxCrcTable[n] = c >>> 0; } }
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) crc = fxCrcTable[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}
function fxZip(files) {
  const enc = new TextEncoder(), parts = [], central = [];
  let offset = 0;
  const d = new Date(), time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  files.forEach(f => {
    const name = enc.encode(f.name), data = enc.encode(f.text), crc = fxCrc32(data);
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
    h.setUint16(10, time, true); h.setUint16(12, date, true); h.setUint32(14, crc, true);
    h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, name.length, true); h.setUint16(28, 0, true);
    parts.push(h.buffer, name, data);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true);
    c.setUint16(12, time, true); c.setUint16(14, date, true); c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true);
    c.setUint16(28, name.length, true); c.setUint16(30, 0, true); c.setUint16(32, 0, true); c.setUint16(34, 0, true); c.setUint16(36, 0, true);
    c.setUint32(38, 0, true); c.setUint32(42, offset, true);
    central.push(c.buffer, name);
    offset += 30 + name.length + data.length;
  });
  const csize = central.reduce((n, x) => n + x.byteLength, 0);
  const e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true);
  e.setUint32(12, csize, true); e.setUint32(16, offset, true);
  return new Blob(parts.concat(central, [e.buffer]), { type: "application/zip" });
}
// Repli (téléchargement impossible) : texte de chaque partie à copier.
function fxShowText(files) {
  let idx = 0;
  const wrap = el("div");
  wrap.appendChild(el("p", "muted", t("fx.textFallback")));
  const ta = el("textarea"); ta.readOnly = true;
  const fill = () => { ta.value = files[idx].text; };
  if (files.length > 1) {
    const sel = el("select", "input"); sel.style.marginBottom = "10px";
    files.forEach((f, i) => { const o = el("option", null, f.name); o.value = String(i); sel.appendChild(o); });
    sel.addEventListener("change", () => { idx = +sel.value || 0; fill(); });
    wrap.appendChild(sel);
  }
  fill();
  wrap.appendChild(ta);
  openModal(t("fx.exportTitle"), wrap, [
    { label: t("copy"), kind: "primary", onClick: () => { copyText(ta.value, ta); return false; } },
    { label: t("close") }
  ]);
}
async function fxDeliver(files, mode) {
  let ok = true;
  if (files.length === 1) ok = await fxSave(files[0].name, files[0].text);
  else if (mode === "zip") ok = await fxSave(files[0].name.replace(/-partie-\d+-sur-\d+\.txt$/, ".zip"), fxZip(files));
  else for (const f of files) { const r = await fxSave(f.name, f.text); if (r !== true) { ok = r; break; } await new Promise(r2 => setTimeout(r2, 400)); }
  if (ok === true) openModal(t("fx.exportTitle"), el("p", null, t("fx.done", { n: files.length })), [{ label: t("close"), kind: "primary" }]);
  else if (ok !== "declined") fxShowText(files);
}

// Fenêtre « Télécharger le fichier pour Claude ». scope : "all" | "folder:<id>" | "list:<id>".
function openFxExport(scope, dictDone) {
  // Dictionnaire commun d'abord (étape 36) : le fichier ne contient que ce qui manque encore.
  if (!dictDone && Dict.on()) { Dict.fillFromCommon(fxScopeCards(scope || "all")).then(() => openFxExport(scope, true)); return; }
  const o = { scope: scope || "all", choice: { tr: true, pos: true, example: true, other: true } };
  const wrap = el("div");
  wrap.appendChild(el("p", "muted", t("fx.help")));
  const sc = el("select", "input");
  [["all", t("queue.scope.all")]].concat(
    sortedFolders().map(f => ["folder:" + f.id, "▸ " + f.name]),
    orderedLists().map(l => ["list:" + l.id, listLabel(l)])
  ).forEach(([v, l]) => { const op = el("option", null, l); op.value = v; sc.appendChild(op); });
  sc.value = o.scope;
  if (sc.value !== o.scope) sc.value = o.scope = "all";
  wrap.appendChild(formField(t("queue.scope"), sc));
  const box = el("div", "fx-choices");
  FX_CHOICES.forEach(k => {
    const r = el("label", "upd-row");
    const cb = el("input"); cb.type = "checkbox"; cb.checked = o.choice[k];
    cb.addEventListener("change", () => { o.choice[k] = cb.checked; upd(); });
    const l = el("div", "upd-l"); l.appendChild(el("div", null, t("fx.f." + k)));
    const n = el("span", "upd-n");
    r.append(cb, l, n);
    r._n = n; r._k = k;
    box.appendChild(r);
  });
  wrap.appendChild(formField(t("fx.what"), box));
  const info = el("p", "muted fx-info");
  wrap.appendChild(info);
  const pick = () => fxScopeCards(o.scope).filter(c => fxWanted(c, o.choice).length);
  function upd() {
    const all = fxScopeCards(o.scope);
    box.querySelectorAll(".upd-row").forEach(r => {
      const one = { [r._k]: true };
      if (r._k === "pos") one.tr = false;
      const n = all.filter(c => fxWanted(c, one).length).length;
      r._n.textContent = n ? t(n === 1 ? "upd.card1" : "upd.cards", { n }) : "✓";
    });
    const n = pick().length;
    info.textContent = n ? t("fx.count", { n, f: Math.ceil(n / FX_MAX) }) : t("fx.count0");
  }
  sc.addEventListener("change", () => { o.scope = sc.value; upd(); });
  upd();
  openModal(t("fx.exportTitle"), wrap, [
    { label: t("cancel") },
    { label: t("fx.download"), kind: "primary", onClick: () => {
      const cards = pick();
      if (!cards.length) { toast(t("fx.count0")); return false; }
      const parts = chunks(cards, FX_MAX);
      const files = parts.map((p, i) => ({ name: fxFileName(o.scope, i + 1, parts.length), text: fxFileText(p, o.choice, i + 1, parts.length) }));
      if (files.length === 1) { fxDeliver(files, "one"); return; }
      openModal(t("fx.partsTitle", { n: files.length }), el("p", "muted", t("fx.partsHelp", { n: files.length, max: FX_MAX })), [
        { label: t("fx.zip"), kind: "primary", onClick: () => { fxDeliver(files, "zip"); } },
        { label: t("fx.separate", { n: files.length }), onClick: () => { fxDeliver(files, "separate"); } },
        { label: t("cancel") }
      ]);
    } }
  ]);
}

// --- Lecture de la réponse ---
// Clé d'une colonne d'en-tête : "id", "type", "liste", "target", "sig", code de langue, "pos:<code>", "example", "f:<champ>",
// "i:<info>" (lecture seule) ou "ignore".
function fxColKey(cell) {
  const n = normText(cell).replace(/[\s-]+/g, "_");
  if (["id", "type", "liste", "target", "sig"].includes(n)) return n;
  if (n === "list") return "liste";
  const m = /^(?:pos|nature)[_:]([a-z]{2,3})$/.exec(n);
  if (m && isLang(m[1])) return posField(m[1]);
  if (["exemple", "example"].includes(n)) return "example";
  const x = /^(?:trad_exemple|extr|exemple_tr)[_:]([a-z]{2,3})$/.exec(n);   // traduction de l'exemple (étape 35)
  if (x && isLang(x[1])) return exTrField(x[1]);
  const y = /^(?:exemple|example|exl)[_:]([a-z]{2,3})$/.exec(n);              // exemple d'une langue étudiée en plus (étape 37)
  if (y && isLang(y[1])) return exlField(y[1]);
  const z = /^(?:trad_exemple|exlt)[_:]([a-z]{2,3})[_:]([a-z]{2,3})$/.exec(n);
  if (z && isLang(z[1]) && isLang(z[2])) return exltField(z[1], z[2]);
  for (const ty of Object.keys(FX_TYPED_COLS)) { const x = FX_TYPED_COLS[ty].find(([nm]) => nm === n); if (x) return x[1]; }
  if (n === "examples") return "f:examples";
  return isLang(n) ? n : "ignore";
}
// texts : [{ name, text }]. Renvoie { rows: Map(id → { cells, file, line }), bad: [{ file, line }], dupRows, files, headers }.
function fxParse(texts) {
  const rows = new Map(), bad = [];
  let headers = 0, dupRows = 0, total = 0;
  texts.forEach(src => {
    const lines = bulkLines(src.text);
    const sep = bulkSeparator(lines.filter(l => !/^\s*#/.test(l)));
    let head = null;
    lines.forEach((raw, i) => {
      const line = raw.trim();
      if (!line || line.startsWith("#") || line.startsWith("```")) return;
      const cells = line.split(sep).map(s => s.trim().replace(/^"(.*)"$/, "$1"));
      if (normText(cells[0]) === "id" && normText(cells[1]) === "type") { head = cells.map(fxColKey); headers++; return; }
      if (!head) return;                                   // texte avant la ligne d'en-tête : ignoré
      total++;
      const ty = TYPE_PREFIX[normText(cells[1] || "").replace(/\s+/g, "")];
      if (cells.length !== head.length || !cells[0] || !ty || ty === "conjtab") { bad.push({ file: src.name, line: i + 1 }); return; }
      if (rows.has(cells[0])) { dupRows++; return; }       // même carte dans deux fichiers : la première ligne compte
      const v = {};
      head.forEach((k, j) => { if (k !== "ignore") v[k] = cells[j]; });
      rows.set(cells[0], { v, type: ty, file: src.name, line: i + 1 });
    });
  });
  return { rows, bad, dupRows, headers, total };
}
function fxSame(c, f, a, b) {
  if (isPosField(f)) return parsePos(a, f.slice(4)) === parsePos(b, f.slice(4));
  const n = s => String(s || "").replace(/\s+/g, " ").replace(/\s*\|\s*/g, " | ").trim();
  return n(a) === n(b);
}
// Pourquoi une proposition ne serait pas ajoutée (mêmes règles qu'addProposal) : "pending", "rejected", "invalid" ou null.
function fxBlock(c, f, v) {
  let nv = String(v || "").replace(/\s+/g, " ").trim();
  if (isPosField(f)) nv = parsePos(nv, f.slice(4));
  if (!nv) return "invalid";
  if (state.proposals.some(x => x.cardId === c.id && x.field === f)) return "pending";
  if (state.rejected.includes(rejectKey(c.id, f, nv))) return "rejected";
  return null;
}
// Analyse sans rien modifier. Renvoie le bilan + les propositions à créer.
function fxAnalyze(parsed) {
  const byId = new Map(state.cards.map(c => [c.id, c]));
  const r = { found: 0, unknown: 0, bad: parsed.bad.slice(), modified: 0, fills: [], already: 0, invalid: 0, corrs: [], corrBlocked: 0, empty: 0 };
  parsed.rows.forEach((row, id) => {
    const c = byId.get(id);
    if (!c) { r.unknown++; return; }
    if (cardType(c) !== row.type) { r.bad.push({ file: row.file, line: row.line }); return; }
    r.found++;
    const modified = !!row.v.sig && row.v.sig !== fxSig(c);
    if (modified) r.modified++;
    const lg = cardLangs(c), fill = new Set(fxFillable(c, lg)), check = new Set(isVocab(c) ? checkFields(c, lg) : fxFillable(c, lg).concat([typedField("note")]));
    let gap = false;
    Object.keys(row.v).forEach(k => {
      const f = k;
      if (!check.has(f) && !fill.has(f)) return;
      const v = String(row.v[k] || "").trim(), cur = fieldVal(c, f).trim();
      if (!cur && fill.has(f) && (!v || v === FX_EMPTY)) { if (!v) gap = true; return; }
      if (!v || v === FX_EMPTY) return;
      if (!cur) {
        if (!fill.has(f)) return;
        const b = fxBlock(c, f, v);
        if (b === "invalid") r.invalid++;
        else if (b) r.already++;
        else r.fills.push({ c, f, v });
      } else if (!fxSame(c, f, v, cur) && !modified) {   // case déjà remplie changée par Claude : jamais appliquée d'office
        const b = fxBlock(c, f, v);
        if (b === "invalid") r.invalid++;
        else if (b) r.corrBlocked++;
        else r.corrs.push({ c, f, v, cur });
      }
    });
    if (gap) r.empty++;
  });
  return r;
}
function fxSummary(parsed, r, nFiles) {
  const wrap = el("div", "fx-sum");
  const line = (txt, cls) => { const d = el("div", "fx-line" + (cls ? " " + cls : ""), txt); wrap.appendChild(d); return d; };
  line(t("fx.sum.files", { n: nFiles, m: parsed.total }), "muted");
  line(t("fx.sum.found", { n: r.found }));
  line(t("fx.sum.filled", { n: r.fills.length }), r.fills.length ? "ok" : "");
  if (r.already) line(t("fx.sum.already", { n: r.already }), "muted");
  if (r.invalid) line(t("fx.sum.invalid", { n: r.invalid }), "warn");
  if (r.empty) line(t("fx.sum.empty", { n: r.empty }), "muted");
  line(t("fx.sum.unknown", { n: r.unknown }), r.unknown ? "warn" : "muted");
  const b = line(t("fx.sum.bad", { n: r.bad.length }), r.bad.length ? "warn" : "muted");
  if (r.bad.length) b.appendChild(el("div", "fx-detail", r.bad.slice(0, 8).map(x => t("fx.sum.badLine", { file: x.file, line: x.line })).join(" · ") + (r.bad.length > 8 ? " …" : "")));
  line(t("fx.sum.modified", { n: r.modified }), r.modified ? "warn" : "muted");
  if (parsed.dupRows) line(t("fx.sum.dupRows", { n: parsed.dupRows }), "muted");
  const sendCorr = { on: false };
  if (r.corrs.length || r.corrBlocked) {
    const box = el("div", "fx-corr");
    box.appendChild(el("div", "fx-line warn", t("fx.sum.corr", { n: r.corrs.length + r.corrBlocked })));
    r.corrs.slice(0, 5).forEach(x => box.appendChild(el("div", "fx-detail", "• " + cardTitle(x.c) + " — " + pvFieldLabel(x.f) + " : " + x.cur + " → " + x.v)));
    if (r.corrs.length > 5) box.appendChild(el("div", "fx-detail", "…"));
    if (r.corrs.length) {
      const lab = el("label", "fx-check");
      const cb = el("input"); cb.type = "checkbox";
      cb.addEventListener("change", () => { sendCorr.on = cb.checked; });
      lab.append(cb, el("span", null, t("fx.sum.corrSend", { n: r.corrs.length })));
      box.appendChild(lab);
    }
    wrap.appendChild(box);
  }
  return { node: wrap, sendCorr };
}
// Ajoute les propositions (complétions, + corrections si demandé). Renvoie le nombre ajouté.
function fxApply(r, withCorr) {
  let n = 0;
  r.fills.forEach(x => { if (state.cards.includes(x.c) && addProposal({ cardId: x.c.id, field: x.f, type: "completion", newValue: x.v, reason: t("fx.reason") })) n++; });
  if (withCorr) r.corrs.forEach(x => { if (state.cards.includes(x.c) && addProposal({ cardId: x.c.id, field: x.f, type: "correction", newValue: x.v, reason: t("fx.corrReason") })) n++; });
  return n;
}

// Fenêtre « Importer la réponse de Claude » : fichiers (plusieurs) et / ou texte collé.
function openFxImport() {
  const files = [];
  const wrap = el("div");
  wrap.appendChild(el("p", "muted", t("fx.importHelp")));
  const fileInp = el("input", "file-input"); fileInp.type = "file"; fileInp.id = "fxFile-" + uid();
  fileInp.accept = ".txt,.csv,.tsv,text/plain,text/csv"; fileInp.multiple = true; fileInp.tabIndex = -1;
  const pick = el("label", "btn file-pick", t("fx.files")); pick.htmlFor = fileInp.id;
  pick.tabIndex = 0; pick.setAttribute("role", "button");
  pick.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileInp.click(); } });
  const zone = el("div", "drop-zone");
  const chips = el("div", "fx-chips");
  zone.append(fileInp, pick, chips, el("div", "drop-hint", t("fx.drop")));
  wrap.appendChild(zone);
  const ta = el("textarea", "bulk-ta");
  ta.spellcheck = false;
  ta.setAttribute("autocapitalize", "off"); ta.setAttribute("autocorrect", "off");
  ta.addEventListener("input", () => autoGrow(ta));
  wrap.appendChild(formField(t("fx.paste"), ta));
  const drawChips = () => {
    chips.textContent = "";
    files.forEach((f, i) => {
      const chip = el("div", "file-chip");
      const rm = el("button", "link-btn", t("bulk.fileRemove")); rm.type = "button";
      rm.addEventListener("click", () => { files.splice(i, 1); drawChips(); });
      chip.append(el("span", null, t("bulk.fileInfo", { name: f.name, n: countBulkLines(f.text) })), rm);
      chips.appendChild(chip);
    });
  };
  const load = async list => {
    for (const f of Array.from(list || [])) {
      if (!/\.(txt|csv|tsv)$/i.test(f.name || "") && !/^text\//.test(f.type || "")) { toast(t("bulk.fileType")); continue; }
      try { const text = await readTextFile(f); if (!files.some(x => x.name === f.name && x.text === text)) files.push({ name: f.name, text }); }
      catch (e) { toast(t("fx.readErr", { name: f.name })); }
    }
    drawChips();
  };
  fileInp.addEventListener("change", () => { const l = Array.from(fileInp.files || []); fileInp.value = ""; load(l); });
  zone.addEventListener("dragover", e => { e.preventDefault(); zone.classList.add("over"); });
  zone.addEventListener("dragleave", () => zone.classList.remove("over"));
  zone.addEventListener("drop", e => { e.preventDefault(); zone.classList.remove("over"); load(e.dataTransfer && e.dataTransfer.files); });
  openModal(t("ai.importReply"), wrap, [
    { label: t("cancel") },
    { label: t("reply.analyze"), kind: "primary", onClick: () => {
      const texts = files.slice();
      if (ta.value.trim()) texts.push({ name: t("fx.pasted"), text: ta.value });
      if (!texts.length) { toast(t("fx.empty")); return false; }
      fxImportTexts(texts);
    } }
  ]);
}
// Analyse puis bilan avant validation. Sans en-tête « id;type » : ancien format « Préparer pour Claude ».
function fxImportTexts(texts) {
  const parsed = fxParse(texts);
  if (!parsed.headers) {
    const res = importReply(texts.map(x => x.text).join("\n"));
    if (!res.added) { toast(t("fx.noHeader")); return; }
    commit();
    openModal(t("ai.doneTitle"), el("p", null, t("reply.done", { n: res.added, m: res.unknown })), [
      { label: t("close") }, { label: t("ai.see"), kind: "primary", onClick: () => { goPending(); } }
    ]);
    return;
  }
  const st = state;
  const r = fxAnalyze(parsed);
  const s = fxSummary(parsed, r, texts.length);
  const acts = [{ label: t("cancel") }];
  if (r.fills.length || r.corrs.length) acts.push({ label: t("fx.send"), kind: "primary", onClick: () => {
    if (state !== st) return;
    const n = fxApply(r, s.sendCorr.on);
    if (!n) { toast(t("fx.nothing")); return; }
    commit();
    openModal(t("ai.doneTitle"), el("p", null, t("fx.sent", { n })), [
      { label: t("close") }, { label: t("ai.see"), kind: "primary", onClick: () => { goPending(); } }
    ]);
  } });
  else s.node.appendChild(el("p", "fx-line warn", t("fx.nothing")));
  openModal(t("fx.sumTitle"), s.node, acts);
}

// === GÉNÉRER DES CARTES ===
// Écran (fenêtre) « Générer des cartes » : liste de destination, type de carte, paramètres
// (conjugaison : verbes, temps, personnes ; autres types : sujet + nombre), puis :
//   - « Générer avec Claude » si la capacité sample de l'artifact est disponible (pas d'API payante),
//   - « Préparer pour Claude » sinon (ou en plus) : consignes à copier dans une conversation, réponse à recoller.
// Claude répond dans le format de l'import en masse (une ligne par carte, ";") : un seul analyseur (parseTypedLine).
//   vocab;<langue apprise>;<langues d'appui…>;exemple;nature
//   conjtab;verbe;temps;forme1|forme2|…;traduction;note   ou   conj;verbe;temps;personne;forme;traduction;note
//   trou;phrase avec ___;réponse;indice;explication;traduction;titre de la règle
//   erreur;phrase fautive;phrase corrigée;explication;titre de la règle
//   regle;titre;texte;exemple1|exemple2|…;traduction
// Rien n'est écrit dans les listes : chaque carte (ou tableau de conjugaison) devient une proposition
// « Nouvelle carte » dans « À valider » : { id, cardId: "", listId, field: "new", type: "newcard", cards: [{ type, fields, ruleRef }], key, reason, createdAt }.
const GEN_TYPES = ["vocab", "conj", "cloze", "fix", "rule"];
const GEN_MAX = 30;          // cartes max par demande (sujet libre)
const GEN_VERBS_PER_CALL = 5; // conjugaison : verbes par appel à Claude
let gv = null;               // réglages de la fenêtre, gardés tant que l'appli est ouverte

function genDefaults(listId) {
  const l = listId ? getList(listId) : null;
  return { listId: l ? l.id : (state.lists[0] ? orderedLists()[0].id : "__new__"), newName: "", folder: l ? (l.folderId || "") : "",
    newTarget: accountLangs().target, type: "conj", verbs: "", tenses: [], persons: [], topic: "", count: 10, withRule: false };
}
// Langues de la destination (liste existante, ou nouvelle liste : langue choisie + langues d'appui par défaut).
// Étape 37 : o.lang = autre langue étudiée de la liste (cartes conj / trou / erreur / règle dans cette langue).
function genLangs(o) {
  if (o.listId !== "__new__" && getList(o.listId)) {
    if (o.lang && studyExtraLangs(o.listId).includes(o.lang)) return studyLg(o.lang);
    return listLangs(o.listId);
  }
  const fl = folderLangs(getFolder(o.folder));
  return fl.target === o.newTarget ? fl : langsFor(o.newTarget);
}
function genVerbs(o) { return [...new Set(String(o.verbs || "").split(/[\n,;]+/).map(x => x.trim()).filter(Boolean))]; }
// Temps choisis (ids) encore valables pour la langue ; par défaut le 1er temps.
function genTenses(o, lng) {
  const ids = tensesOf(lng).map(x => x.id);
  const sel = o.tenses.filter(id => ids.includes(id));
  return sel.length ? sel : ids.slice(0, 1);
}
// Personnes demandées pour un temps : filtre seulement sur les personnes habituelles de la langue.
function genPersons(o, lng, tenseId) {
  const ps = personsOf(lng, tenseId);
  if (ps !== arr(grammarOf(lng).persons) || !o.persons.length) return ps;
  const sel = ps.filter(p => o.persons.includes(p.id));
  return sel.length ? sel : ps;
}

function openGenerate(listId, lang) {
  if (!gv) gv = genDefaults(listId);
  else if (listId && getList(listId)) { gv.listId = listId; gv.folder = getList(listId).folderId || ""; }
  if (listId) gv.lang = lang || "";                                       // langue étudiée choisie (étape 37)
  if (gv.listId !== "__new__" && !getList(gv.listId)) gv.listId = state.lists.length ? orderedLists()[0].id : "__new__";
  const o = gv;
  const wrap = el("div");
  let close = null;
  const redraw = () => { if (close) close(); openGenerate(); };

  // Destination
  const ls = el("select", "input");
  orderedLists().forEach(l => { const op = el("option", null, listLabel(l)); op.value = l.id; ls.appendChild(op); });
  const nw = el("option", null, t("gen.newList")); nw.value = "__new__"; ls.appendChild(nw);
  ls.value = o.listId;
  ls.addEventListener("change", () => { o.listId = ls.value; redraw(); });   // temps / personnes non valables pour la langue : ignorés
  wrap.appendChild(formField(t("gen.list"), ls));
  if (o.listId === "__new__") {
    const nm = textInput(o.newName, t("gen.newName"));
    nm.addEventListener("input", () => { o.newName = nm.value; });
    wrap.appendChild(formField(t("lists.name"), nm, true));
    const fs = el("select", "input");
    [["", t("folders.none")]].concat(sortedFolders().map(f => [f.id, f.name])).forEach(([v, l]) => { const op = el("option", null, l); op.value = v; fs.appendChild(op); });
    fs.value = getFolder(o.folder) ? o.folder : "";
    fs.addEventListener("change", () => { o.folder = fs.value; redraw(); });
    wrap.appendChild(formField(t("folders.folder"), fs));
    wrap.appendChild(formField(t("langs.target"), targetSelect(o.newTarget, v => { o.newTarget = v; redraw(); })));
  }
  // Liste étudiée dans plusieurs langues (étape 37) : langue des cartes à générer
  const stl = o.listId !== "__new__" && getList(o.listId) ? studyLangs(o.listId) : [];
  if (stl.length > 1) {
    const sl = el("select", "input");
    stl.forEach(x => { const op = el("option", null, langName(x)); op.value = x; sl.appendChild(op); });
    sl.value = stl.includes(o.lang) ? o.lang : stl[0];
    sl.addEventListener("change", () => { o.lang = sl.value === stl[0] ? "" : sl.value; redraw(); });
    wrap.appendChild(formField(t("study.genLang"), sl));
  } else o.lang = "";
  const lg = genLangs(o), L = lg.target;
  wrap.appendChild(el("div", "gen-info", pairLabel(lg)));

  // Type de carte (autre langue étudiée : pas de vocabulaire, les mots de la liste servent déjà dans cette langue)
  const ts = el("select", "input");
  const okTypes = GEN_TYPES.filter(ty => typesFor(L).includes(ty) && !(lg.study && ty === "vocab"));   // pas de conjugaison sans grammaire (étape 35)
  if (!okTypes.includes(o.type)) o.type = okTypes[0] || "vocab";
  okTypes.forEach(ty => { const op = el("option", null, TYPE_ICON[ty] + " " + t("type." + ty)); op.value = ty; ts.appendChild(op); });
  ts.value = o.type;
  ts.addEventListener("change", () => { o.type = ts.value; redraw(); });
  wrap.appendChild(formField(t("type.label"), ts));

  if (o.type === "conj") {
    const vb = el("textarea", "input gen-ta");
    vb.value = o.verbs;
    vb.lang = L;
    vb.placeholder = t("gen.verbsPh", { ex: genVerbExample(L) });
    vb.addEventListener("input", () => { o.verbs = vb.value; });
    wrap.appendChild(formField(t("gen.verbs"), vb, true));
    const tens = genTenses(o, L);
    const tw = el("div", "chips");
    tensesOf(L).forEach(tn => {
      const b = el("button", null, locText(tn.names));
      b.type = "button";
      b.setAttribute("aria-pressed", String(tens.includes(tn.id)));
      b.addEventListener("click", () => { o.tenses = genTenses(o, L).slice(); toggleIn(o.tenses, tn.id); if (!o.tenses.length) o.tenses = [tn.id]; redraw(); });
      tw.appendChild(b);
    });
    wrap.appendChild(formField(t("review.tenses"), tw));
    // Personnes (seulement si un temps choisi utilise les personnes habituelles de la langue)
    const base = arr(grammarOf(L).persons);
    if (base.length > 1 && tens.some(id => personsOf(L, id) === base)) {
      const pw = el("div", "chips");
      base.forEach(p => {
        const b = el("button", null, personLabel(L, "", p.id));
        b.type = "button";
        b.setAttribute("aria-pressed", String(!o.persons.length || o.persons.includes(p.id)));
        b.addEventListener("click", () => {
          if (!o.persons.length) o.persons = base.map(x => x.id);
          toggleIn(o.persons, p.id);
          if (!o.persons.length || o.persons.length === base.length) o.persons = [];
          redraw();
        });
        pw.appendChild(b);
      });
      wrap.appendChild(formField(t("review.persons"), pw, false, t("gen.personsHint")));
    }
  } else {
    const tp = textInput(o.topic, t("gen.topicPh." + o.type), L);
    tp.addEventListener("input", () => { o.topic = tp.value; });
    wrap.appendChild(formField(t("gen.topic"), tp, o.type !== "vocab"));
    const n = el("input", "input");
    n.type = "number"; n.min = "1"; n.max = String(GEN_MAX); n.inputMode = "numeric"; n.value = o.count;
    n.addEventListener("change", () => { o.count = clampInt(n.value, 1, GEN_MAX, 10); n.value = o.count; });
    wrap.appendChild(formField(t("gen.count"), n, false, t("gen.countHint", { n: GEN_MAX })));
    if (o.type === "cloze" || o.type === "fix") {
      const lab = el("label", "gen-chk");
      const cb = el("input"); cb.type = "checkbox"; cb.checked = !!o.withRule;
      cb.addEventListener("change", () => { o.withRule = cb.checked; });
      lab.append(cb, document.createTextNode(t("gen.withRule")));
      wrap.appendChild(lab);
    }
  }
  wrap.appendChild(el("p", "hint", t("gen.help")));

  const check = () => {
    if (o.listId === "__new__" && !o.newName.trim()) { toast(t("lists.nameRequired")); return null; }
    const req = genRequest(o);
    if (req.type === "conj" && !req.verbs.length) { toast(t("gen.needVerbs")); return null; }
    if (req.type !== "conj" && req.type !== "vocab" && !req.topic) { toast(t("gen.needTopic")); return null; }
    return req;
  };
  const acts = [];
  if (AI.isOn()) acts.push({ label: t("gen.run"), kind: "primary", onClick: () => { const r = check(); if (!r) return false; runGenerate(r); } });
  const useQueue = !AI.isOn() && Queue.usable();
  if (useQueue) acts.push({ label: t("queue.ask"), kind: "primary", onClick: () => { const r = check(); if (!r) return false; queueSubmitGenerate(r); } });
  acts.push({ label: t("gen.prepare"), kind: AI.isOn() || useQueue ? "" : "primary", onClick: () => { const r = check(); if (!r) return false; openGenPrepare(r); } });
  acts.push({ label: t("cancel") });
  close = openModal(t("gen.title"), wrap, acts);
}
// Exemple de verbes pour le champ (depuis la démo de la langue).
function genVerbExample(lng) {
  const D = (LANGUAGES[lng] && LANGUAGES[lng].demo) || {};
  const v = arr(D.cards).filter(x => x.type === "conjtab").map(x => x.verb);
  return (v.length ? v : arr(D.words).filter(w => w.pos === "v").map(w => w.term)).slice(0, 3).join(", ") || "…";
}
// Demande figée au moment du clic (la fenêtre peut changer ensuite).
function genRequest(o) {
  const lg = genLangs(o);
  const req = { listId: o.listId, newName: o.newName.trim(), folder: getFolder(o.folder) ? o.folder : null, lg, lang: lg.target, type: o.type,
    verbs: genVerbs(o), topic: String(o.topic || "").trim(), count: clampInt(o.count, 1, GEN_MAX, 10), withRule: !!o.withRule };
  req.tenses = req.type === "conj" ? genTenses(o, req.lang) : [];
  req.persons = o.persons.slice();
  return req;
}
// Liste de destination (créée au premier ajout si c'est une nouvelle liste ; même liste pour les morceaux suivants).
function genListId(req) {
  if (req.listId !== "__new__" && getList(req.listId)) return req.listId;
  if (req.createdId && getList(req.createdId)) return req.createdId;
  const folderId = req.folder && getFolder(req.folder) ? req.folder : null;
  const nl = { id: uid(), name: req.newName || t("gen.title"), folderId, order: nextOrder(listsIn(folderId)), createdAt: Date.now() };
  if (req.lg.target !== folderLangs(getFolder(folderId)).target) nl.target = req.lg.target;   // appui : celui du profil (étape 35)
  ensureLearning(req.lg.target);
  state.lists.push(nl);
  req.createdId = nl.id;
  return nl.id;
}
function genLabel(req) {
  if (req.type === "conj") return t("type.conj") + " · " + req.tenses.map(id => tenseName(req.lang, id)).join(", ");
  return t("type." + req.type) + (req.topic ? " · " + req.topic : "");
}

// --- Consignes envoyées à Claude ---
function genSupportNames(lg) { return lg.support.map(c => LANGUAGES[c].names.fr.toLowerCase()).join(", "); }
// Cartes déjà présentes du même type (à ne pas refaire), 40 max.
function genExisting(req) {
  const lid = req.listId !== "__new__" ? req.listId : req.createdId;
  if (!lid || !getList(lid) || req.type === "conj") return [];   // conjugaison : doublons retirés à la réception (même verbe, autre temps permis)
  const pend = state.proposals.filter(p => p.field === "new" && p.listId === lid).flatMap(p => p.cards).filter(d => d.type === req.type).map(d => draftCard(d, lid));
  const out = cardsOf(lid).filter(c => cardType(c) === req.type).concat(pend).map(c => isVocab(c) ? term(c, req.lang) : cardTitle(c)).filter(Boolean);
  return [...new Set(out)].slice(0, 40);              // cartes de la liste + nouvelles cartes encore à valider
}
function genPrompt(req, verbs) {
  const L = req.lang, Ln = LANGUAGES[L].names.fr.toLowerCase(), sup = genSupportNames(req.lg);
  const head = [
    "Tu crées des cartes de révision pour des apprenants en langues. Langue apprise : " + Ln + " (" + L + "). Langues d'appui : " + sup + " (" + req.lg.support.join(", ") + ").",
    "Niveau débutant à intermédiaire, phrases courtes et naturelles, orthographe et accents exacts."
  ];
  const tail = [
    "Une ligne par carte, colonnes séparées par « ; », jamais de « ; » à l'intérieur d'une colonne. Pas de titre, pas de numéro, pas d'autre texte.",
  ];
  const trNote = "traduction = le sens dans les langues d'appui (" + sup + "), séparées par « / », dans cet ordre";
  let body = [];
  if (req.type === "conj") {
    body.push("Conjugue ces verbes (" + Ln + ") : " + verbs.join(", ") + ".");
    body.push("Temps et personnes demandés (utilise exactement ces identifiants de temps et de personne) :");
    req.tenses.forEach(id => {
      const ps = genPersons(req, L, id), all = personsOf(L, id);
      const tn = tenseOf(L, id), nm = tn ? tn.names.fr : id;
      if (ps.length === all.length) body.push("- temps " + id + " (" + nm + ") : une ligne conjtab par verbe, formes dans cet ordre : " + all.map(p => p.id + " = " + locText(p.label, "fr") + (p.names && p.names.fr ? " (" + p.names.fr + ")" : "")).join(" | "));
      else body.push("- temps " + id + " (" + nm + ") : une ligne conj par verbe et par personne, personnes : " + ps.map(p => p.id + " = " + locText(p.label, "fr") + (p.names && p.names.fr ? " (" + p.names.fr + ")" : "")).join(", "));
    });
    body.push("Formats :");
    body.push("conjtab;verbe à l'infinitif;identifiant du temps;forme1|forme2|forme3|…;traduction;note");
    body.push("conj;verbe à l'infinitif;identifiant du temps;identifiant de la personne;forme;traduction;note");
    body.push("- forme = la forme conjuguée SANS le pronom sujet (ex. « allons », pas « nous allons ») ; temps composés avec l'auxiliaire (ex. « suis allé ») ; plusieurs formes correctes séparées par « / ».");
    if (personsOf(L, req.tenses[0]).some(p => !p.pronoun)) body.push("- pour une personne sans pronom (niveau de politesse, forme…), la forme complète du verbe.");
    body.push("- " + trNote + " ; note = très courte (ex. « auxiliaire être », « irrégulier ») ou vide.");
    body.push("Exemple : " + genConjExample(L, req.tenses[0]));
  } else if (req.type === "vocab") {
    body.push("Crée " + req.count + " cartes de vocabulaire" + (req.topic ? " sur le thème : " + req.topic : "") + ".");
    const sn = req.lg.support.map(c => LANGUAGES[c].names.fr.toLowerCase());
    body.push("Format : vocab;mot en " + Ln + ";" + sn.map(x => "traduction en " + x).join(";") + (sn.length ? ";" : "") + "exemple;" + sn.map(x => "traduction de l'exemple en " + x).join(";") + (sn.length ? ";" : "") + "nature");
    body.push("- exemple = une phrase courte en " + Ln + " qui utilise le mot" + (sn.length ? ", suivie de sa traduction dans chaque langue (" + sn.join(", ") + ")" : "") + " ; nature = un code : nm, nf, nmf, nmpl, nfpl, n (nom sans genre), v, vpr, adj, adv, prep, conj, pron, interj, expr.");
    if (LANGUAGES[L].gender) body.push("- en " + Ln + ", un nom a toujours son genre (nm, nf…) ; le mot sans article (ex. « étagère »).");
  } else if (req.type === "cloze") {
    body.push("Crée " + req.count + " textes à trous en " + Ln + " sur : " + req.topic + ".");
    body.push("Format : trou;phrase avec ___ à la place du trou;réponse;indice;explication;traduction;titre de la règle");
    body.push("- un seul trou « ___ » par phrase ; réponse = le texte exact du trou (plusieurs réponses correctes séparées par « / ») ; indice = très court (ex. « préposition + article »), en " + Ln + " ;");
    body.push("- explication = une phrase courte et simple en " + Ln + " ; traduction = la phrase complète dans les langues d'appui (" + sup + "), séparées par « / ».");
  } else if (req.type === "fix") {
    body.push("Crée " + req.count + " phrases à corriger en " + Ln + " sur : " + req.topic + ".");
    body.push("Format : erreur;phrase avec UNE erreur typique d'apprenant;phrase corrigée;explication;titre de la règle");
    body.push("- la phrase corrigée est la phrase entière sans erreur ; explication = une phrase courte et simple en " + Ln + ".");
  } else {
    body.push("Crée " + req.count + " fiches de règle de grammaire ou d'orthographe en " + Ln + " sur : " + req.topic + ".");
    body.push("Format : regle;titre court;texte de la règle;exemple1|exemple2|exemple3;traduction");
    body.push("- texte = 2 à 4 lignes en " + Ln + " simple, \\n pour aller à la ligne, « - » en début de ligne pour une liste, **gras** permis ; exemples en " + Ln + " ; traduction = résumé de la règle en " + sup + ".");
  }
  if (req.type === "cloze" || req.type === "fix") {
    if (req.withRule) body.push("Ajoute aussi UNE fiche de règle qui explique la notion (format : regle;titre court;texte;exemple1|exemple2|exemple3;traduction — texte en " + Ln + " simple, \\n pour aller à la ligne, traduction = résumé en " + sup + "), et mets son titre exact dans la dernière colonne des autres lignes.");
    else body.push("- titre de la règle : laisse vide.");
  }
  const ex = genExisting(req);
  if (ex.length) body.push("Ne refais pas ces cartes déjà présentes : " + ex.join(" | "));
  return head.concat(body, tail);
}
function genConjExample(lng, tenseId) {
  const D = (LANGUAGES[lng] && LANGUAGES[lng].demo) || {};
  const ct = arr(D.cards).find(x => x.type === "conjtab" && x.tense === tenseId);   // exemple seulement si c'est le même temps
  if (ct) return "conjtab;" + ct.verb + ";" + ct.tense + ";" + ct.forms.join("|") + ";…;";
  return "conjtab;…;" + tenseId + ";" + personsOf(lng, tenseId).map(() => "…").join("|") + ";…;";
}
// Accès direct : réponse JSON { lines: [...] }.
function genPromptJson(req, verbs) {
  return genPrompt(req, verbs).concat(["",
    "Réponds uniquement avec un objet JSON de la forme {\"lines\": [\"ligne 1\", \"ligne 2\", …]}, une chaîne par ligne au format ci-dessus."]).join("\n");
}
// Repli : texte à copier.
function genPromptText(req, verbs) { return genPrompt(req, verbs).join("\n"); }

// --- Lecture de la réponse ---
// → { drafts: [{ type, fields, ruleRef }], errors: [texte], lines }
function parseGenReply(text, req) {
  const out = { drafts: [], errors: [], lines: 0 };
  const L = req.lang, sup = req.lg.support;
  bulkLines(text).forEach(raw => {
    const line = raw.trim().replace(/^[-*•]\s+/, "").replace(/^\d+[.)]\s+/, "");
    if (!line || line.startsWith("```") || !line.includes(";")) return;
    const cols = line.split(";").map(x => x.trim());
    const kind = linePrefix(cols);
    if (!kind) return;                                   // texte d'accompagnement ignoré
    out.lines++;
    if (kind === "vocab") {
      // vocab;mot;traductions…;exemple;traductions de l'exemple…;nature (étape 35) — ancien format sans les traductions de l'exemple accepté
      const terms = {}; terms[L] = cols[1] || "";
      sup.forEach((c, i) => { if (cols[2 + i]) terms[c] = cols[2 + i]; });
      const example = cols[2 + sup.length] || "", withTr = cols.length >= 4 + 2 * sup.length, exTr = {};
      if (withTr) sup.forEach((c, i) => { if (cols[3 + sup.length + i]) exTr[c] = cols[3 + sup.length + i]; });
      const pv = parsePos(cols[(withTr ? 3 + 2 * sup.length : 3 + sup.length)] || "", L);
      if (!terms[L] || (sup.length && !sup.some(c => terms[c]))) { out.errors.push(line); return; }
      out.drafts.push({ type: "vocab", fields: { terms, example, exTr, pos: pv ? { [L]: pv } : {} } });
      return;
    }
    const r = parseTypedLine(kind, cols, L);
    if (r.err) { out.errors.push(line + " — " + r.err); return; }
    const ruleRef = kind === "cloze" ? cols[6] : kind === "fix" ? cols[4] : "";
    r.rows.forEach(row => out.drafts.push({ type: row.type, fields: row.fields, ruleRef: ruleRef || "" }));
  });
  return out;
}
// Clé de doublon d'un brouillon (même règle que l'import).
function draftKey(d, lg) { return d.type === "vocab" ? "vocab|" + dupKey(d.fields.terms, lg) : typedKey(d.type, d.fields); }
// Regroupe les formes d'un même verbe + temps (un tableau = une proposition), le reste une carte par proposition.
function draftGroups(drafts) {
  const out = [], tabs = new Map();
  drafts.forEach(d => {
    if (d.type !== "conj") { out.push([d]); return; }
    const k = normText(d.fields.verb) + "|" + d.fields.tense;
    if (!tabs.has(k)) { const g = []; tabs.set(k, g); out.push(g); }
    tabs.get(k).push(d);
  });
  return out;
}
// Ajoute les propositions « Nouvelle carte ». Cartes déjà dans la liste, déjà proposées ou refusées : ignorées.
// Renvoie { added (propositions), cards (cartes), skipped }.
function addGenProposals(drafts, req) {
  const res = { added: 0, cards: 0, skipped: 0 };
  if (!drafts.length) return res;
  const listId = genListId(req);
  const lg = listLangs(listId);
  const have = new Set(cardsOf(listId).map(c => isVocab(c) ? "vocab|" + dupKey(c.terms, lg) : typedKey(c.type, c)));
  state.proposals.filter(p => p.field === "new" && p.listId === listId).forEach(p => p.cards.forEach(d => have.add(draftKey(d, lg))));
  draftGroups(drafts).forEach(g => {
    const fresh = g.filter(d => {
      const k = draftKey(d, lg);
      if (have.has(k) || state.rejected.includes(rejectKey(listId, "new", k))) { res.skipped++; return false; }
      have.add(k);
      return true;
    });
    if (!fresh.length || !canEditList(listId)) return;
    state.proposals.push({ id: uid(), cardId: "", listId, field: "new", type: "newcard", cards: fresh,
      oldValue: "", newValue: "", reason: genLabel(req), createdAt: Date.now() });
    res.added++; res.cards += fresh.length;
  });
  return res;
}

// --- Accès direct (capacité sample) ---
async function runGenerate(req) {
  if (aiJob) { toast(t("ai.busy")); return; }
  const parts = req.type === "conj" ? chunks(req.verbs, GEN_VERBS_PER_CALL) : [null];
  const ctrl = new AbortController();
  aiJob = { kind: "generate", ctrl };
  let stopped = false;
  const pg = openProgress(t("gen.title"), t("gen.working", { i: 1, n: parts.length }), [
    { label: t("ai.stop"), onClick: () => { stopped = true; try { ctrl.abort(); } catch (e) {} return false; } }
  ]);
  const tot = { added: 0, cards: 0, skipped: 0, errors: [] };
  let error = null;
  try {
    for (let i = 0; i < parts.length && !stopped; i++) {
      pg.set(i / parts.length, t("gen.working", { i: i + 1, n: parts.length }));
      let res;
      try { res = await AI.ask(genPromptJson(req, parts[i]), ctrl.signal); }
      catch (e) { if (!stopped) error = e; break; }
      const lines = Array.isArray(res) ? res : res && Array.isArray(res.lines) ? res.lines : [];
      const r = parseGenReply(lines.map(String).join("\n"), req);
      const a = addGenProposals(r.drafts, req);
      tot.added += a.added; tot.cards += a.cards; tot.skipped += a.skipped; tot.errors.push(...r.errors);
      if (a.added) commitQuiet();
    }
  } finally { aiJob = null; pg.close(); }
  if (tot.added) commit();
  genDone(tot, req, error);
}
function genDone(tot, req, error) {
  const wrap = el("div");
  if (error) wrap.appendChild(el("p", "muted", t("gen.error", { m: (error && (error.message || error.code)) || "?" })));
  wrap.appendChild(el("p", null, tot.cards ? t("gen.done", { n: tot.cards, p: tot.added }) : t("gen.none")));
  if (tot.skipped) wrap.appendChild(el("p", "muted", t("gen.skipped", { n: tot.skipped })));
  if (tot.errors.length) {
    wrap.appendChild(el("p", "muted", t("gen.badLines", { n: tot.errors.length })));
    const ul = el("ul", "hint");
    tot.errors.slice(0, 5).forEach(x => ul.appendChild(el("li", null, x)));
    wrap.appendChild(ul);
  }
  const acts = [{ label: t("close") }];
  if (error) acts.unshift({ label: t("gen.prepare"), onClick: () => { openGenPrepare(req); } });
  if (tot.added) acts.push({ label: t("ai.see"), kind: "primary", onClick: () => { goPendingFor({ kind: "list", id: genListId(req) }); } });
  openModal(t("gen.title"), wrap, acts);
}

// --- Repli : « Préparer pour Claude » ---
function openGenPrepare(req) {
  const parts = req.type === "conj" ? chunks(req.verbs, GEN_VERBS_PER_CALL) : [null];
  let idx = 0;
  const wrap = el("div");
  wrap.appendChild(el("p", "muted", t("gen.prepHelp")));
  const ta = el("textarea");
  ta.readOnly = true;
  const fill = () => { ta.value = genPromptText(req, parts[idx]); };
  if (parts.length > 1) {
    const sel = el("select", "input");
    sel.style.marginBottom = "10px";
    parts.forEach((p, i) => { const op = el("option", null, t("gen.part", { i: i + 1, n: parts.length, v: p.join(", ") })); op.value = String(i); sel.appendChild(op); });
    sel.addEventListener("change", () => { idx = +sel.value || 0; fill(); });
    wrap.appendChild(sel);
  }
  fill();
  wrap.appendChild(ta);
  openModal(t("gen.prepTitle"), wrap, [
    { label: t("copy"), kind: "primary", onClick: () => { copyText(ta.value, ta); return false; } },
    { label: t("prep.import"), onClick: () => { openGenReply(req); } },
    { label: t("close") }
  ]);
}
function openGenReply(req) {
  const wrap = el("div");
  wrap.appendChild(el("p", "muted", t("gen.replyHelp")));
  const ta = el("textarea");
  ta.spellcheck = false;
  ta.setAttribute("autocapitalize", "off"); ta.setAttribute("autocorrect", "off");
  wrap.appendChild(ta);
  openModal(t("reply.title"), wrap, [
    { label: t("cancel") },
    { label: t("reply.analyze"), kind: "primary", onClick: () => {
      const r = parseGenReply(ta.value, req);
      if (!r.drafts.length) { toast(r.errors.length ? t("gen.badLines", { n: r.errors.length }) : t("reply.none")); return false; }
      const a = addGenProposals(r.drafts, req);
      if (a.added) commit();
      genDone({ added: a.added, cards: a.cards, skipped: a.skipped, errors: r.errors }, req, null);
    } }
  ]);
  setTimeout(() => { try { ta.focus(); } catch (e) {} }, 50);
}

// === MISE À JOUR DES LISTES ===
// « Mettre à jour » une liste, un dossier ou tout (scope = { kind: "list"|"folder"|"all", id }).
// 1. Analyse : rien n'est modifié, bilan par catégorie avec le nombre de cartes concernées.
// 2. Cases à cocher, puis « Lancer » : complétion / vérification existantes (lots de 20, Pause, reprise depuis
//    les Réglages), toutes les propositions vont dans « À valider », ouvert filtré sur la liste ou le dossier.
// Catégories : "tr:<code>" (traduction manquante), "pos" (nature manquante + noms sans genre), "example",
//   "pending" (propositions en attente ou champs « auto »), "verify" (cartes jamais vérifiées ou modifiées depuis),
//   "dup" (doublons), "legacy" (cartes à l'ancien format, normalement aucune : migration au lancement).
// Badge « N à compléter » (listes et dossiers) = cartes avec un champ vide ou un nom sans genre, recalculé à chaque affichage.

// Trous d'une carte : champs vides (langues d'appui, exemple, natures) + noms sans genre.
function gapFields(c, lg) {
  lg = lg || cardLangs(c);
  return fillFields(c, lg).filter(f => !fieldVal(c, f, lg).trim()).concat(genderFields(c, lg));
}
function listGapCount(l) { if (!canEditList(l)) return 0; const lg = listLangs(l); return cardsOf(l.id).filter(c => gapFields(c, lg).length).length; }
function folderGapCount(f) { return listsIn(f.id).reduce((n, l) => n + listGapCount(l), 0); }
function updBadge(n) { return n ? el("span", "upd-badge", t("upd.badge", { n })) : null; }
function updDate(ts) {
  if (!ts) return t("upd.never");
  try { return t("upd.last", { d: new Date(ts).toLocaleDateString(state.settings.uiLang) }); } catch (e) { return t("upd.never"); }
}

// Mise à jour (traductions, nature, exemple, vérification, doublons) : cartes de vocabulaire seulement.
function updScopeCards(scope) {
  const ok = c => isVocab(c) && canEditList(c.listId);   // listes communes en lecture seule exclues (étape 30)
  if (scope.kind === "list") return getList(scope.id) ? cardsOf(scope.id).filter(ok) : [];
  if (scope.kind === "folder") { const f = getFolder(scope.id); return f ? cardsUnder("folder", f).filter(ok) : []; }
  return state.cards.filter(ok);
}
function updScopeObj(scope) { return scope.kind === "list" ? getList(scope.id) : scope.kind === "folder" ? getFolder(scope.id) : null; }
// Ancien format (la migration v1 → v2 est faite au lancement : normalement aucune).
function isLegacyCard(c) { return !c.terms || typeof c.terms !== "object" || !c.pos || typeof c.pos !== "object" || !Array.isArray(c.auto); }

// Analyse sans rien modifier.
function analyzeUpdate(cards) {
  const lgs = new Map();
  const L = c => { let x = lgs.get(c.listId); if (!x) { x = cardLangs(c); lgs.set(c.listId, x); } return x; };
  const pend = new Set(state.proposals.map(p => p.cardId));
  const a = { total: cards.length, tr: {}, pos: 0, gender: 0, genderLangs: new Set(), example: 0, pending: 0, verify: 0, dup: 0, legacy: 0, study: {} };
  cards.forEach(c => {
    if (isLegacyCard(c)) { a.legacy++; return; }
    const lg = L(c);
    studyExtraLangs(c.listId).forEach(x => { if (!(x in a.study)) a.study[x] = 0; if (studyGapFields(c, x).length) a.study[x]++; });   // étape 37
    lg.support.forEach(code => { if (!(code in a.tr)) a.tr[code] = 0; if (!term(c, code).trim()) a.tr[code]++; });
    const g = genderFields(c, lg);
    g.forEach(f => a.genderLangs.add(f.slice(4)));
    if (g.length || posFields(lg).some(f => !fieldVal(c, f).trim())) a.pos++;
    if (g.length) a.gender++;
    if (exFields(lg).some(f => !fieldVal(c, f, lg).trim())) a.example++;   // exemple ou une de ses traductions (étape 35)
    if (pend.has(c.id) || c.auto.length) a.pending++;
    if (state.checkedSig[c.id] !== cardSig(c)) a.verify++;
  });
  dupGroups(cards).forEach(g => { if (g.length > 1) a.dup += g.length - 1; });
  return a;
}

// Champs demandés à Claude pour une carte, selon les catégories cochées.
function updWant(cats) {
  return c => {
    const lg = cardLangs(c), out = [];
    lg.support.forEach(code => { if (cats.includes("tr:" + code) && !term(c, code).trim()) out.push(code); });
    if (cats.includes("example")) exFields(lg).forEach(f => { if (!fieldVal(c, f, lg).trim()) out.push(f); });
    if (cats.includes("pos")) posFields(lg).forEach(f => { if (!fieldVal(c, f).trim() || posNeedsGender(c, f.slice(4))) out.push(f); });
    studyExtraLangs(c.listId).forEach(x => { if (cats.includes("study:" + x)) studyGapFields(c, x).forEach(f => { if (!out.includes(f)) out.push(f); }); });   // étape 37
    return out;
  };
}

// Reprise (Réglages) d'une complétion mise en pause pendant une mise à jour : mêmes catégories.
// Gardé sur cet appareil (localStorage), à côté de state.aiResume.
function updResumeKey() { return CONFIG.LS_USER_PREFIX + "updResume:" + (Storage.getUser() || ""); }
function updResumeCats() {
  try { const r = JSON.parse(localStorage.getItem(updResumeKey()) || "null"); return state.aiResume && r && Array.isArray(r.cats) ? r.cats : null; }
  catch (e) { return null; }
}
function updResumeSync(cats) {
  try {
    if (state.aiResume && cats) localStorage.setItem(updResumeKey(), JSON.stringify({ cats }));
    else localStorage.removeItem(updResumeKey());
  } catch (e) {}
}

// Repli « Préparer pour Claude » : à la réimportation, seuls les champs des catégories cochées sont proposés.
let prepScope = null; // { st, ids: Set, want }
function prepWantFor(c) { return prepScope && prepScope.st === state && prepScope.ids.has(c.id) ? prepScope.want(c) : null; }

// Ouvre « À valider » filtré sur la liste ou le dossier.
function goPendingFor(scope) {
  pvReset();
  if (scope.kind === "list" && getList(scope.id)) { pv.list = scope.id; pv.folder = pvFolderOf(scope.id); }
  else if (scope.kind === "folder" && getFolder(scope.id)) pv.folder = scope.id;
  goPending();
}

async function openUpdate(scope) {
  if (aiJob) { toast(t("ai.busy")); return; }
  const obj = updScopeObj(scope);
  if (scope.kind !== "all" && !obj) return;
  const cards = updScopeCards(scope);
  if (!cards.length) { toast(t("ai.noCards")); return; }
  await AI.ready();
  await Dict.fillFromCommon(cards);   // dictionnaire commun d'abord (étape 36) : le bilan ne compte que ce qui manque encore
  const a = analyzeUpdate(cards);
  const checked = new Set();
  const wrap = el("div");
  wrap.appendChild(el("p", "muted upd-intro", t("upd.intro", { n: a.total })));
  const row = (cat, label, n, hint, on) => {
    const r = el("label", "upd-row" + (n ? "" : " off"));
    const cb = el("input"); cb.type = "checkbox"; cb.disabled = !n; cb.checked = !!n && on;
    if (cb.checked) checked.add(cat);
    cb.addEventListener("change", () => { if (cb.checked) checked.add(cat); else checked.delete(cat); });
    const l = el("div", "upd-l");
    l.appendChild(el("div", null, label));
    if (hint) l.appendChild(el("div", "upd-h", hint));
    r.append(cb, l, el("span", "upd-n", n ? t(n === 1 ? "upd.card1" : "upd.cards", { n }) : "✓"));
    wrap.appendChild(r);
  };
  LANG_CODES.filter(code => code in a.tr).forEach(code => row("tr:" + code, t("upd.cat.tr", { lang: langName(code) }), a.tr[code], "", true));
  row("pos", t("upd.cat.pos"), a.pos, a.gender ? t("upd.cat.gender", { n: a.gender, langs: [...a.genderLangs].map(x => langName(x)).join(", ") }) : "", true);
  row("example", t("upd.cat.example"), a.example, "", true);
  LANG_CODES.filter(x => x in a.study).forEach(x => row("study:" + x, t("study.updCat", { lang: langName(x) }), a.study[x], t("study.updCatHint"), true));   // étape 37
  row("pending", t("upd.cat.pending"), a.pending, t("upd.cat.pendingHint"), true);
  const calls = Math.ceil(a.verify / CONFIG.AI_BATCH);
  row("verify", t("upd.cat.verify"), a.verify, t("upd.cat.verifyHint") + (AI.isOn() && calls ? " · " + t("upd.calls", { b: calls }) : ""), false);
  row("dup", t("upd.cat.dup"), a.dup, "", true);
  if (a.legacy) row("legacy", t("upd.cat.legacy"), a.legacy, "", true);
  else wrap.appendChild(el("div", "upd-last", t("upd.formatOk")));
  if (obj) wrap.appendChild(el("div", "upd-last", updDate(obj.lastUpdate)));
  const name = scope.kind === "all" ? t("upd.allName") : obj.name;
  // Échange par fichier avec Claude (même périmètre)
  let closeUpd = null;
  const fxl = el("div", "lv-links fx-links");
  const lo = el("button", "link-btn", t("fx.exportBtn")), li = el("button", "link-btn", t("ai.importReply"));
  lo.type = li.type = "button";
  lo.addEventListener("click", () => { if (closeUpd) closeUpd(); openFxExport(scope.kind === "all" ? "all" : scope.kind + ":" + scope.id); });
  li.addEventListener("click", () => { if (closeUpd) closeUpd(); openFxImport(); });
  fxl.append(lo, li);
  wrap.appendChild(fxl);
  closeUpd = openModal(t("upd.title", { name }), wrap, [
    { label: t("cancel") },
    { label: t("upd.launch"), kind: "primary", onClick: () => {
      if (!checked.size) { toast(t("upd.pickOne")); return false; }
      runUpdate(scope, [...checked]);
    } }
  ]);
}

async function runUpdate(scope, cats) {
  if (aiJob) { toast(t("ai.busy")); return; }
  const st = state;
  const cards = updScopeCards(scope);
  const now = Date.now();
  const stamp = x => { if (x) x.lastUpdate = now; };
  if (scope.kind === "list") stamp(getList(scope.id));
  else if (scope.kind === "folder") { stamp(getFolder(scope.id)); listsIn(scope.id).forEach(stamp); }
  else { state.folders.forEach(stamp); state.lists.forEach(stamp); }
  let added = 0, legacy = 0;
  if (cats.includes("legacy")) cards.forEach(c => { if (isLegacyCard(c)) { Object.assign(c, normalizeCard(c)); legacy++; } });
  if (cats.includes("dup")) added += addDuplicateProposals(cards);
  commit();
  const want = updWant(cats);
  const fillCards = cards.filter(c => !isLegacyCard(c) && want(c).length);
  const verifyCards = cats.includes("verify") ? cards.filter(c => state.checkedSig[c.id] !== cardSig(c)) : [];
  const seePending = cats.includes("pending");
  await AI.ready();
  if (state !== st) return;

  // Sans accès direct à Claude : textes à copier (vérification dessous, complétion au-dessus).
  if (!AI.isOn() && (fillCards.length || verifyCards.length)) {
    if (added || legacy) toast(t("ai.autoDone", { n: added }));
    if (verifyCards.length) openPrepare("verify", verifyCards);
    if (fillCards.length) { prepScope = { st: state, ids: new Set(fillCards.map(c => c.id)), want }; openPrepare("complete", fillCards); }
    return;
  }

  let error = null, stopped = false;
  if (fillCards.length) {
    const r = await runAiJob("complete", fillCards, { want, noEndModal: true, resumeCats: cats });
    if (!r || state !== st) return;
    added += r.added; error = r.error; stopped = r.stopped;
    if (r.interrupted) return;   // bandeau « Reprendre / Abandonner »
  }
  if (verifyCards.length && !error && !stopped) {
    const r = await runAiJob("verify", verifyCards, { noEndModal: true });
    if (!r || state !== st) return;
    added += r.added; error = r.error; stopped = r.stopped;
  }
  if (!fillCards.length && !verifyCards.length && !added && !legacy && seePending) { goPendingFor(scope); return; }

  let msg = error ? aiErrorText(error) : stopped ? t(fillCards.length ? "ai.paused" : "ai.stopped", { n: added }) : added ? t("ai.done", { n: added }) : t("ai.doneNone");
  if (error && added) msg += " " + t("ai.done", { n: added });
  if (error && state.aiResume && fillCards.length) msg += " " + t("ai.resumeLater");
  if (legacy) msg += " " + t("upd.legacyDone", { n: legacy });
  const actions = [{ label: t("close") }];
  if (added || seePending) actions.push({ label: t("ai.see"), kind: "primary", onClick: () => { goPendingFor(scope); } });
  openModal(t("ai.doneTitle"), el("p", null, msg), actions);
}
