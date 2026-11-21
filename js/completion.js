"use strict";

// ====================================================================================================
// js/completion.js — CLAUDE (IA), COMPLÉTION & VÉRIFICATION, PRÉPARER POUR CLAUDE
// Accès à Claude (AI), complétion et vérification des cartes par lots, repli « Préparer pour Claude » (copier-coller).
// Étape 65 : la suite de l'ancien fichier est dans js/echange-fichier.js, js/generer.js et js/maj-listes.js (chargés juste après).
// ====================================================================================================

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
// Étape 73 : les réponses de Claude s'appliquent directement aux cartes (règle des cases : js/claude-auto.js) ;
// seuls les doublons vont encore dans state.proposals (section « À valider »).
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

// Réponse de Claude pour une case (étape 73 : appliquée directement, voir ClAuto.apply) ou doublon (« dup », proposition
// « À valider ») : jamais une valeur déjà refusée, une seule proposition en attente par carte et par champ.
function addProposal(p) {
  const c = state.cards.find(x => x.id === p.cardId);
  if (!c) return false;
  if (!canEditList(c.listId)) return false;   // liste commune en lecture seule : pas de proposition (étape 30)
  let nv = String(p.newValue || "").replace(/\s+/g, " ").trim();
  if (isPosField(p.field)) nv = parsePos(nv, p.field.slice(4)); // code valide pour la langue, sinon refusé
  if (p.field !== "dup") {
    if (!nv || !checkFields(c).includes(p.field)) return false;
    const cur = fieldVal(c, p.field).trim();
    if (p.type === "completion" && p.field === cardLangs(c).target) return false;   // étape 73 : case remplie → règle des cases (ClAuto.apply)
    if (p.type === "correction" && cur === nv) return false;
  }
  if (state.rejected.includes(rejectKey(c.id, p.field, nv))) return false;
  // Étape 73 : une réponse de Claude s'applique directement (règle des cases : js/claude-auto.js) ; seuls les doublons
  // (« dup », suppression d'une carte) passent encore par « À valider ». Renvoie true si une case a été écrite.
  if (p.field !== "dup") return ClAuto.apply(c, p.field, p.type, nv);
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
// opts : { silent (vérification automatique ; quiet en plus : aucun message, étape 80), extra (propositions déjà ajoutées, ex. doublons),
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
  const kept0 = ClAuto.kept();   // étape 73 : cases de l'utilisateur gardées (message de fin)
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
  if (opts.silent) { if (added && !opts.quiet) toast(t("ai.autoDone", { n: added })); return result; }   // quiet (étape 80) : sans message
  if (opts.noEndModal) return result;
  if (interrupted) return result;   // bandeau « Reprendre / Abandonner » (renderResumeBars)
  let msg = error ? aiErrorText(error) : stopped ? t(isComplete ? "ai.paused" : "ai.stopped", { n: added }) : added ? t("ai.done", { n: added }) : t("ai.doneNone");
  if (error && added) msg += " " + t("ai.done", { n: added });
  if (error && isComplete && state.aiResume) msg += " " + t("ai.resumeLater");
  if (ClAuto.kept() > kept0) msg += " " + t("cl.kept", { n: ClAuto.kept() - kept0 });
  const actions = [{ label: t("close") }];
  if (added) actions.push({ label: t("ai.see"), kind: "primary", onClick: () => { goPending(); } });
  openModal(t("ai.doneTitle"), el("p", null, msg), actions);
  return result;
}

// Étape 73 : « Voir » après une demande à Claude : « À valider » s'il y reste quelque chose (doublons), sinon les listes.
function goPending() {
  if (!liveProposals().length) { try { history.replaceState(null, "", "#" + HASH_OF.lists); } catch (e) {} showScreen("lists"); return; }
  try { history.replaceState(null, "", "#" + HASH_OF.pending); } catch (e) {}
  showScreen("pending");
}

// Après l'ajout de cartes (manuel ou import) : proposer de compléter les trous.
// Étape 80 : avec la mise à jour automatique (file d'attente, js/auto-maj.js), rien n'est demandé : l'appli dépose toute
// seule une demande regroupée pour les cartes qui ont des trous.
function offerCompletion(cardIds) {
  const ids = new Set(cardIds || []);
  const cards = state.cards.filter(c => ids.has(c.id) && missingFields(c).length);
  if (!cards.length) return;
  if (typeof AutoMaj !== "undefined" && AutoMaj.takes(cards.map(c => c.id))) return;
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
    wrap.insertBefore(queueCadenceNote(), wrap.firstChild);          // étape 59
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

