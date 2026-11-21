"use strict";

// ====================================================================================================
// js/generer.js — GÉNÉRER DES CARTES (3e morceau de l'ancien js/completion.js, étape 65)
// Fenêtre « Générer des cartes » (avec Claude ou par copier-coller). Chargé juste après js/echange-fichier.js.
// ====================================================================================================

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
// Étape 76 : vocabulaire avec une liste de mots (mots déjà connus copiés avant l'envoi) et cartes proches pour les autres
// demandes (« reprendre;nX ») : js/generer-connus.js (GenKnown).
// Rien n'est écrit dans les listes : chaque carte (ou tableau de conjugaison) devient une proposition
// « Nouvelle carte » dans « À valider » : { id, cardId: "", listId, field: "new", type: "newcard", cards: [{ type, fields, ruleRef }], key, reason, createdAt }.
const GEN_TYPES = ["vocab", "conj", "cloze", "fix", "rule"];
const GEN_MAX = 30;          // cartes max par demande (sujet libre)
const GEN_VERBS_PER_CALL = 5; // conjugaison : verbes par appel à Claude
let gv = null;               // réglages de la fenêtre, gardés tant que l'appli est ouverte

function genDefaults(listId) {
  const l = listId ? getList(listId) : null;
  return { listId: l ? l.id : (state.lists[0] ? orderedLists()[0].id : "__new__"), newName: "", folder: l ? (l.folderId || "") : "",
    newTarget: accountLangs().target, type: "conj", verbs: "", words: "", tenses: [], persons: [], topic: "", count: 10, withRule: false };
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
    if (o.type === "vocab") {                                             // étape 76 : liste de mots (js/generer-connus.js)
      const wd = el("textarea", "input gen-ta");
      wd.value = o.words || "";
      wd.lang = L;
      wd.placeholder = t("gnd.wordsPh");
      wd.addEventListener("input", () => { o.words = wd.value; });
      wrap.appendChild(formField(t("gnd.words"), wd, false, t("gnd.wordsHint")));
    }
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
  if (!AI.isOn() && Queue.usable()) wrap.appendChild(queueCadenceNote());   // étape 59

  const check = () => {
    if (o.listId === "__new__" && !o.newName.trim()) { toast(t("lists.nameRequired")); return null; }
    const req = genRequest(o);
    if (req.type === "conj" && !req.verbs.length) { toast(t("gen.needVerbs")); return null; }
    if (req.type !== "conj" && req.type !== "vocab" && !req.topic) { toast(t("gen.needTopic")); return null; }
    if (req.words.length > GND_WORDS_MAX) { toast(t("gnd.tooMany", { n: GND_WORDS_MAX })); return null; }
    return req;
  };
  const acts = [];
  // Étape 76 : mots déjà connus copiés, cartes proches jointes (GenKnown.before), puis l'envoi habituel.
  if (AI.isOn()) acts.push({ label: t("gen.run"), kind: "primary", onClick: () => { const r = check(); if (!r) return false; GenKnown.before(r, runGenerate); } });
  const useQueue = !AI.isOn() && Queue.usable();
  if (useQueue) acts.push({ label: t("queue.ask"), kind: "primary", onClick: () => { const r = check(); if (!r) return false; GenKnown.before(r, queueSubmitGenerate); } });
  acts.push({ label: t("gen.prepare"), kind: AI.isOn() || useQueue ? "" : "primary", onClick: () => { const r = check(); if (!r) return false; GenKnown.before(r, openGenPrepare); } });
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
  req.words = req.type === "vocab" ? gndWords(o.words) : [];            // étape 76 : liste de mots (vocabulaire)
  if (req.words.length) req.count = req.words.length;
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
  if (req.type === "vocab" && arr(req.words).length) return t("type.vocab") + " · " + req.words.slice(0, 4).join(", ") + (req.words.length > 4 ? "…" : "");
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
    if (Array.isArray(verbs) && verbs.length) {                        // étape 76 : liste de mots (les mots déjà connus ont été copiés)
      body.push("Crée une carte de vocabulaire pour chacun de ces mots en " + Ln + ", dans cet ordre (garde chaque mot tel quel, corrige seulement une faute évidente) : " + verbs.join(" | ") + ".");
      if (req.topic) body.push("Contexte donné par l'apprenant : " + req.topic + ".");
    } else body.push("Crée " + req.count + " cartes de vocabulaire" + (req.topic ? " sur le thème : " + req.topic : "") + ".");
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
  body.push(...GenKnown.nearLines(req));                                // étape 76 : cartes proches, « reprendre;nX »
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
    const k0 = normText(cols[0]).replace(/\s+/g, "");
    if (k0 === "reprendre" || k0 === "reuse") { out.lines++; out.drafts.push({ type: "reuse", ref: cols[1] || "" }); return; }   // étape 76
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
  // Étape 76 : « reprendre;nX » = carte proche copiée dans la liste (js/generer-connus.js), comptée comme une carte de Claude.
  const reuse = drafts.filter(d => d.type === "reuse");
  drafts = drafts.filter(d => d.type !== "reuse");
  if (reuse.length) { const n = GenKnown.reuse(reuse, req); if (n) { genCreated += n; res.added++; res.cards += n; } }
  if (!drafts.length) { if (pvNewIds.length) { const ids = pvNewIds; pvNewIds = []; Dict.afterAdd(ids); } return res; }
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
    const prop = { id: uid(), cardId: "", listId, field: "new", type: "newcard", cards: fresh,
      oldValue: "", newValue: "", reason: genLabel(req), createdAt: Date.now() };
    // Étape 73 : cartes créées directement dans la liste, toutes leurs cases marquées « Claude » (js/claude-auto.js).
    // Une case non valide : rien n'est créé, le groupe reste dans « À valider » (à modifier), comme avant.
    const r = pvAcceptNew(prop, null);
    if (r.added) {
      r.ids.forEach(id => ClAuto.markCard(state.cards.find(c => c.id === id)));
      genCreated += r.added;
      res.added++; res.cards += r.added;
    } else if (!r.dupOnly) {
      state.proposals.push(prop);
      res.added++; res.cards += fresh.length; res.pending = (res.pending || 0) + 1;
    }
  });
  if (pvNewIds.length) { const ids = pvNewIds; pvNewIds = []; Dict.afterAdd(ids); }   // dictionnaire commun (étape 36)
  return res;
}
let genCreated = 0;   // étape 73 : cartes créées directement par « Générer » depuis le lancement (compteur de la file d'attente)

// --- Accès direct (capacité sample) ---
async function runGenerate(req) {
  if (aiJob) { toast(t("ai.busy")); return; }
  const parts = GenKnown.parts(req);                                    // étape 76 : mots par 30
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
  if (tot.added) acts.push({ label: t("ai.see"), kind: "primary", onClick: () => { goPendingFor({ kind: "list", id: genListId(req) }); } });   // étape 73 : ouvre la liste (ou « À valider » s'il y reste un groupe)
  openModal(t("gen.title"), wrap, acts);
}

// --- Repli : « Préparer pour Claude » ---
function openGenPrepare(req) {
  const parts = GenKnown.parts(req);                                    // étape 76 : mots par 30
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

