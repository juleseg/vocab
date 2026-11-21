"use strict";

// === TYPES DE CARTES ===
// Chaque carte a un champ type. Tous les types passent par le même Leitner, les mêmes listes, dossiers, stats et « À valider ».
//   vocab : vocabulaire (terms, pos, examples { langue: { text, tr } } — étape 35 ; ancien champ example gardé)
//   conj  : conjugaison, une forme par carte (lang, verb, tense, person, answer, translation, note)
//   cloze : texte à trous (lang, sentence avec ___, answer, hint, explanation, translation, ruleId)
//   fix   : corriger l'erreur (lang, wrong, correct, explanation, ruleId)
//   rule  : fiche de règle (lang, title, body, examples [liste], translation)
// lang = langue apprise de la liste au moment de la création. Plusieurs réponses acceptées avec "/" (conj, cloze).
// Toutes les cartes gardent terms / pos / example (vides hors vocabulaire) : le code commun ne plante jamais.
// conj (et le mode Tableau) : seulement pour les langues qui ont une grammaire dans LANGUAGES (hasGrammar, étape 35).
const CARD_TYPES = ["vocab", "conj", "cloze", "fix", "rule"];
const TYPE_FIELDS = {
  conj: ["lang", "verb", "tense", "person", "answer", "translation", "note"],
  cloze: ["lang", "sentence", "answer", "hint", "explanation", "translation", "ruleId"],
  fix: ["lang", "wrong", "correct", "explanation", "ruleId"],
  rule: ["lang", "title", "body", "translation"]           // + examples (liste)
};
const TYPE_ICON = { vocab: "Aa", conj: "⇄", cloze: "▁", fix: "✎", rule: "§" };
const CLOZE_GAP = /_{2,}/;

function cardType(c) { return c && CARD_TYPES.includes(c.type) ? c.type : "vocab"; }
// Types proposés pour une langue apprise : conj seulement si la langue a une grammaire (étape 35).
function typesFor(lng) { return CARD_TYPES.filter(x => x !== "conj" || hasGrammar(lng)); }
function isVocab(c) { return cardType(c) === "vocab"; }
// Langue du contenu de la carte (langue apprise) : champ lang hors vocabulaire, sinon langue apprise de la liste.
function cardLang(c) { return !isVocab(c) && isLang(c.lang) ? c.lang : cardLangs(c).target; }
function splitAlts(s) { return String(s || "").split("/").map(x => x.trim()).filter(Boolean); }
function uiOf() { return (state && state.settings && state.settings.uiLang) || "fr"; }
// Texte simple, ou { fr, ko, en } (pris dans la langue de l'interface).
function locText(v, ui) {
  if (v == null) return "";
  if (typeof v !== "object") return String(v);
  ui = ui || uiOf();
  return v[ui] || v.fr || v.en || Object.values(v)[0] || "";
}

// --- Grammaire (lue dans LANGUAGES[x].grammar) ---
function grammarOf(lng) { return (LANGUAGES[lng] && LANGUAGES[lng].grammar) || { tenses: [], persons: [] }; }
function tensesOf(lng) { return arr(grammarOf(lng).tenses); }
function tenseOf(lng, id) { return tensesOf(lng).find(x => x.id === id) || null; }
function personsOf(lng, tenseId) {
  const g = grammarOf(lng), tn = tenseOf(lng, tenseId);
  if (tn && Array.isArray(tn.persons)) return tn.persons;
  if (tn && typeof tn.persons === "string") return arr((g.personSets || {})[tn.persons]);
  return arr(g.persons);
}
function tenseName(lng, id) { const x = tenseOf(lng, id); return x ? locText(x.names) : String(id || ""); }
function personLabel(lng, tenseId, pid) {
  const p = personsOf(lng, tenseId).find(x => x.id === pid);
  if (!p) return String(pid || "");
  const n = p.names ? (p.names[uiOf()] || "") : "";
  return locText(p.label) + (n ? " (" + n + ")" : "");
}
function conjPerson(c) { return personsOf(c.lang, c.tense).find(x => x.id === c.person) || null; }
// Forme affichée avec le pronom (« nous irons ») ; telle quelle si la personne n'a pas de pronom (coréen, verbes irréguliers…).
function conjFull(c, form) {
  const f = form == null ? (splitAlts(c.answer)[0] || "") : form;
  const p = conjPerson(c), g = grammarOf(c.lang);
  if (!p || !p.pronoun || !f) return f;
  return typeof g.join === "function" ? g.join(f, p, tenseOf(c.lang, c.tense)) : p.pronoun + " " + f;
}
// Reconnaissance d'un temps / d'une personne saisis (import) : id, ou nom dans n'importe quelle langue d'interface.
function gKey(s) { return normText(s).replace(/\([^)]*\)/g, "").replace(/[\s.'’_-]+/g, ""); }
function gKeys(v) {
  const out = [];
  const add = x => { if (x == null) return; if (typeof x === "object") Object.values(x).forEach(add); else { out.push(gKey(x)); out.push(normText(x).replace(/[\s.'’_()-]+/g, "")); } };
  add(v);
  return out.filter(Boolean);
}
function findTense(lng, raw) {
  const k = gKey(raw), k2 = normText(raw).replace(/[\s.'’_()-]+/g, "");
  if (!k && !k2) return null;
  return tensesOf(lng).find(x => gKeys([x.id, x.names]).some(n => n === k || n === k2)) || null;
}
function findPerson(lng, tenseId, raw) {
  const k = normText(raw).replace(/[\s.'’_()-]+/g, "");
  if (!k) return null;
  const ps = personsOf(lng, tenseId);
  if (/^[1-9]$/.test(k) && ps[+k - 1]) return ps[+k - 1];          // numéro dans l'ordre des personnes
  return ps.find(p => gKeys([p.id, p.label, p.names, p.pronoun]).includes(k))
    || ps.find(p => [p.pronoun, typeof p.label === "string" ? p.label : ""].some(x => String(x || "").split("/").some(y => gKey(y) === k)))
    || null;
}

// --- Modèle ---
function normTypedFields(type, c) {
  const out = {};
  (TYPE_FIELDS[type] || []).forEach(f => { out[f] = c[f] == null ? "" : String(c[f]).trim(); });
  if (type === "rule") out.examples = arr(c.examples).map(x => String(x).trim()).filter(Boolean);
  return out;
}
function newTypedCard(listId, type, fields, tags) {
  const c = Object.assign(newCard(listId, {}, "", tags || []), normTypedFields(type, fields || {}), { type });
  if (type !== "rule") delete c.examples;   // examples (objet) : vocabulaire seulement ; règle : liste de phrases
  return c;
}
function cardHasContent(c) {
  if (isVocab(c)) return Object.keys(c.terms || {}).length > 0;
  return (TYPE_FIELDS[c.type] || []).some(f => f !== "lang" && String(c[f] || "").trim()) || arr(c.examples).length > 0;
}
// Carte utilisable en révision (hors vocabulaire) : champs indispensables remplis, temps et personne connus.
function typedUsable(c) {
  if (!isLang(c.lang)) return false;
  switch (c.type) {
    case "conj": return !!(c.verb && splitAlts(c.answer).length && tenseOf(c.lang, c.tense) && conjPerson(c));
    case "cloze": return CLOZE_GAP.test(c.sentence || "") && splitAlts(c.answer).length > 0;
    case "fix": return !!(c.wrong && c.correct);
    case "rule": return !!(c.title && (c.body || arr(c.examples).length));
  }
  return false;
}
function ruleOf(c) {
  const r = c && c.ruleId ? state.cards.find(x => x.id === c.ruleId) : null;
  return r && cardType(r) === "rule" ? r : null;
}
function clozeShow(sentence, fill) { return String(sentence || "").replace(CLOZE_GAP, fill); }
// Étape 83 (js/conjugaison.js, chargé après) : verbe sans « to » ; phrase à trous avec le verbe entre parenthèses.
// Sans ce fichier : valeurs de la carte telles quelles.
function cjqVerb(c) { return typeof ConjQ !== "undefined" ? ConjQ.verbOf(c) : String(c.verb || ""); }
function cjqCloze(c) { return typeof ConjQ !== "undefined" ? ConjQ.cloze(c) : { q: c.sentence, a: c.sentence, verb: "", fromHint: false }; }

// --- Textes courts (listes, résumé, stats) ---
function cardTitle(c) {
  switch (cardType(c)) {
    case "conj": return cjqVerb(c) + " — " + tenseName(c.lang, c.tense) + " — " + personLabel(c.lang, c.tense, c.person);
    case "cloze": return clozeShow(cjqCloze(c).q, "___");
    case "fix": return c.wrong;
    case "rule": return c.title;
  }
  return targetTerm(c) || "—";
}
function cardSubtitle(c) {
  switch (cardType(c)) {
    case "conj": return [conjFull(c), c.translation].filter(Boolean).join(" · ");
    case "cloze": return clozeShow(cjqCloze(c).a, splitAlts(c.answer)[0] || "___");
    case "fix": return c.correct;
    case "rule": return String(c.body || "").split("\n").map(x => x.replace(/\*\*/g, "").replace(/^\s*-\s*/, "")).filter(Boolean).join(" · ");
  }
  return supportText(c);
}
function typeBadge(type) { return el("span", "type-badge tb-" + type, TYPE_ICON[type] + " " + t("type." + type)); }
// Texte de recherche (écran Listes) : langues affichées seulement (displayLangs) ; exemple et ses traductions affichées.
function cardSearchText(c) {
  if (isVocab(c)) { const lg = cardLangs(c); return visibleLangs(lg).map(code => term(c, code)).concat([exText(c, lg.target)], lg.support.map(code => exTr(c, lg.target, code))).join(" "); }
  return (TYPE_FIELDS[c.type] || []).filter(f => !["lang", "ruleId"].includes(f)).map(f => c[f]).concat(arr(c.examples)).join(" ");
}

// --- Affichage ---
// Corps de règle : texte court ; **gras** et lignes « - … » (liste) autorisés. Construit sans innerHTML.
function richLine(parent, s) {
  String(s).split(/\*\*(.+?)\*\*/).forEach((part, i) => { if (part) parent.appendChild(i % 2 ? el("b", null, part) : document.createTextNode(part)); });
}
function ruleBodyNode(body, lng) {
  const d = el("div", "ty-rbody");
  d.lang = lng || "";
  let ul = null;
  String(body || "").split("\n").forEach(line => {
    const m = line.match(/^\s*[-•]\s+(.*)$/);
    if (m) { if (!ul) { ul = el("ul"); d.appendChild(ul); } const li = el("li"); richLine(li, m[1]); ul.appendChild(li); }
    else if (line.trim()) { ul = null; const p = el("p"); richLine(p, line.trim()); d.appendChild(p); }
  });
  return d;
}
function tyLine(cls, text, lng) { const d = el("div", "ty-line " + (cls || ""), text); if (lng) d.lang = lng; return d; }
function tyLabeled(label, text, lng) {
  const d = el("div", "ty-line");
  d.appendChild(el("span", "ty-lbl", label + " "));
  const s = el("span", null, text); if (lng) s.lang = lng;
  d.appendChild(s);
  return d;
}
// Bouton dans une face de carte : ne retourne pas / ne fait pas glisser la carte.
function faceBtn(label, onClick) {
  const b = el("button", "link-btn ty-btn", label);
  b.type = "button";
  const stop = e => e.stopPropagation();
  b.addEventListener("pointerdown", stop);
  b.addEventListener("pointerup", stop);
  b.addEventListener("keydown", stop);
  b.addEventListener("click", e => { e.stopPropagation(); onClick(); });
  return b;
}
// Phrase à trous : trou visible (question) ou réponse surlignée (réponse).
function clozeNode(cls, c, fill) {
  const d = el("div", cls); d.lang = c.lang;
  const parts = String(c.sentence || "").split(CLOZE_GAP);
  parts.forEach((p, i) => {
    if (p) d.appendChild(document.createTextNode(p));
    if (i < parts.length - 1) d.appendChild(fill ? el("mark", "ty-fill", fill) : el("span", "ty-gap", "＿＿＿"));
  });
  return d;
}
// Phrase corrigée avec les différences surlignées, et la phrase fautive avec les erreurs barrées.
function fixDiffNodes(c) {
  const r = wrLcs(c.wrong, c.correct);
  const good = wrDiffNode(r.B, r.mb, "wr-miss"); good.classList.add("ty-sent"); good.lang = c.lang;
  const bad = wrDiffNode(r.A, r.ma, "wr-bad"); bad.classList.add("ty-wrong"); bad.lang = c.lang;
  return { good, bad };
}
function ruleBtn(c) { const r = ruleOf(c); return r ? faceBtn(t("type.seeRule"), () => openRuleModal(r)) : null; }

// Faces question / réponse d'une carte hors vocabulaire (même forme que cardFaces) :
//   { lang (titre), main (texte), lng, items (lecture audio), mainNode() (affichage riche), extras() (nœuds en plus), noSub, long }
// Le sens de révision est ignoré pour ces types.
function typedFaces(c) {
  const L = c.lang, lg = cardLangs(c);
  const head = t("type." + c.type) + " · " + langName(L);
  const say = text => text ? [{ text, lng: L }] : [];
  let q = {}, a = {};
  if (c.type === "conj") {
    const full = conjFull(c), vb = cjqVerb(c);
    const info = tenseName(L, c.tense) + " — " + personLabel(L, c.tense, c.person);
    // Étape 83 : consigne claire « Conjugue be avec you — présent simple » (js/conjugaison.js) ; sans ce fichier : comme avant.
    if (typeof ConjQ !== "undefined") q = { main: ConjQ.text(c), items: say(vb), mainNode: cls => ConjQ.node(cls, c), extras: () => [] };
    else q = { main: vb, items: say(vb), extras: () => [tyLine("ty-big", info)] };
    a = { main: full, items: say(full), extras: () => [
      tyLine("", vb + " — " + info, L),
      splitAlts(c.answer).length > 1 ? tyLine("", t("type.alsoOk", { a: splitAlts(c.answer).join(" / ") }), L) : null,
      c.translation ? tyLine("ty-tr", c.translation) : null,
      c.note ? tyLine("ty-note", c.note) : null,
      faceBtn(t("type.seeTable"), () => openConjTable(c))
    ] };
  } else if (c.type === "cloze") {
    const ans = splitAlts(c.answer);
    // Étape 83 : verbe à conjuguer entre parenthèses après le trou (question), phrase complète sans les parenthèses (réponse).
    const cz = cjqCloze(c), cq = Object.assign({}, c, { sentence: cz.q }), ca = Object.assign({}, c, { sentence: cz.a });
    q = { main: clozeShow(cz.q, "…"), items: say(clozeShow(cz.a, "…")), mainNode: cls => clozeNode(cls, cq, null),
      extras: () => [c.hint && !cz.fromHint ? tyLabeled(t("type.hint"), c.hint) : null] };
    a = { main: clozeShow(cz.a, ans[0] || ""), items: say(clozeShow(cz.a, ans[0] || "")), mainNode: cls => clozeNode(cls, ca, ans[0] || ""),
      extras: () => [
        ans.length > 1 ? tyLine("", t("type.alsoOk", { a: ans.join(" / ") }), L) : null,
        c.explanation ? tyLine("ty-expl", c.explanation) : null,
        c.translation ? tyLine("ty-tr", c.translation) : null,
        ruleBtn(c)
      ] };
  } else if (c.type === "fix") {
    q = { main: c.wrong, items: say(c.wrong), extras: () => [tyLine("ty-big", t("type.fixQ"))] };
    a = { main: c.correct, items: say(c.correct), mainNode: cls => { const n = fixDiffNodes(c).good; n.classList.add(cls); return n; },
      extras: () => [fixDiffNodes(c).bad, c.explanation ? tyLine("ty-expl", c.explanation) : null, ruleBtn(c)] };
  } else {
    q = { main: c.title, items: say(c.title), extras: () => [tyLine("ty-big", t("type.ruleQ"))] };
    a = { main: c.title, items: say(arr(c.examples).join(". ")), long: true, extras: () => {
      const out = [ruleBodyNode(c.body, "")];
      if (arr(c.examples).length) { const ul = el("ul", "ty-ex"); ul.lang = L; c.examples.forEach(x => ul.appendChild(el("li", null, x))); out.push(ul); }
      if (c.translation) out.push(tyLine("ty-tr", c.translation));
      return out;
    } };
  }
  const base = { lang: head, lng: L, sub: "", subLng: "", noSub: true };
  return { q: Object.assign({}, base, q), a: Object.assign({}, base, a), target: L, lg: { target: L, support: lg.support }, typed: true };
}
// Nœuds en plus d'une face (null retirés).
function faceExtras(f) { return f && f.extras ? f.extras().filter(Boolean) : []; }

// « Voir le tableau » : toutes les cartes du même verbe + temps (même langue), dans l'ordre des personnes.
function conjSiblings(c) {
  const v = normText(c.verb);
  return state.cards.filter(x => cardType(x) === "conj" && x.lang === c.lang && x.tense === c.tense && normText(x.verb) === v)
    .sort((a, b) => (a.listId === c.listId ? 0 : 1) - (b.listId === c.listId ? 0 : 1));
}
function openConjTable(c) {
  const sib = conjSiblings(c);
  const wrap = el("div");
  wrap.appendChild(tyLine("ty-big", tenseName(c.lang, c.tense)));
  const tr0 = sib.map(x => x.translation).find(Boolean);
  if (tr0) wrap.appendChild(tyLine("ty-tr", tr0));
  const tb = el("table", "ty-table");
  personsOf(c.lang, c.tense).forEach(p => {
    const x = sib.find(y => y.person === p.id);
    const tr = el("tr", x && x.id === c.id ? "cur" : null);
    tr.append(el("td", "muted", personLabel(c.lang, c.tense, p.id)));
    const td = el("td", null, x ? conjFull(x) : "—"); td.lang = c.lang;
    tr.appendChild(td);
    tb.appendChild(tr);
  });
  wrap.appendChild(tb);
  const notes = [...new Set(sib.map(x => x.note).filter(Boolean))];
  if (notes.length) wrap.appendChild(tyLine("ty-note", notes.join(" · ")));
  openModal(cjqVerb(c), wrap, [{ label: t("close"), kind: "primary" }]);
}
// « Voir la règle »
function openRuleModal(r) {
  const wrap = el("div");
  wrap.appendChild(ruleBodyNode(r.body, ""));
  if (arr(r.examples).length) { const ul = el("ul", "ty-ex"); ul.lang = r.lang; r.examples.forEach(x => ul.appendChild(el("li", null, x))); wrap.appendChild(ul); }
  if (r.translation) wrap.appendChild(tyLine("ty-tr", r.translation));
  openModal(r.title, wrap, [{ label: t("close"), kind: "primary" }]);
}

// Réponses acceptées en mode Écrit (hors vocabulaire) : [{ text, lng, sentence? }].
// conj : la forme seule ou avec le pronom ; cloze : le mot manquant ; fix : la phrase corrigée entière.
function typedAlts(c) {
  const out = [], add = (text, sentence) => { if (text && !out.some(x => x.text === text)) out.push({ text: wrClean(text), lng: c.lang, sentence: !!sentence }); };
  if (c.type === "conj") splitAlts(c.answer).forEach(x => { add(x); add(conjFull(c, x)); });
  else if (c.type === "cloze") splitAlts(c.answer).forEach(x => add(x));
  else if (c.type === "fix") add(c.correct, true);
  return out;
}

// === DEMO ===
// Liste « Démo » d'un nouveau compte, dans sa langue apprise par défaut : tout vient de LANGUAGES[langue].demo.
// Mots : traductions prises dans les mots de même key des autres langues ; phrase d'exemple dans la langue apprise.
// Autres types : textes { fr, ko, en } pris dans la 1re langue d'appui qui les a (traductions : toutes les langues d'appui).
function addDemoList(data) {
  const lg = resolveLangs([], data.settings.uiLang, data.settings);
  const D = (LANGUAGES[lg.target] && LANGUAGES[lg.target].demo) || {};
  const list = { id: uid(), name: "Démo", folderId: null, order: nextOrder(data.lists.filter(l => !l.folderId)), createdAt: Date.now() };
  data.lists.push(list);
  arr(D.words).forEach(w => {
    const terms = {}, pos = {};
    LANG_CODES.forEach(code => {
      const x = arr((LANGUAGES[code].demo || {}).words).find(y => y.key === w.key);
      if (x) { terms[code] = x.term; if (x.pos) pos[code] = x.pos; }
    });
    data.cards.push(newCard(list.id, terms, w.ex || "", arr(w.tags).slice(), pos, lg.target));
  });
  const order = lg.support.concat([lg.target]);
  const one = v => (v && typeof v === "object") ? (order.map(k => v[k]).find(Boolean) || locText(v, data.settings.uiLang)) : String(v || "");
  const all = v => (v && typeof v === "object") ? lg.support.map(k => v[k]).filter(Boolean).join(" / ") : String(v || "");
  const rules = {};
  const cards = arr(D.cards);
  cards.filter(x => x.type === "rule").concat(cards.filter(x => x.type !== "rule")).forEach(x => {
    const base = { lang: lg.target };
    if (x.type === "rule") {
      const c = newTypedCard(list.id, "rule", Object.assign(base, { title: x.title, body: one(x.body), examples: x.examples, translation: all(x.translation) }));
      rules[x.key] = c.id; data.cards.push(c);
    } else if (x.type === "conjtab") {
      if (!hasGrammar(lg.target)) return;
      personsOf(lg.target, x.tense).forEach((p, i) => {
        if (!x.forms[i]) return;
        data.cards.push(newTypedCard(list.id, "conj", Object.assign({}, base, { verb: x.verb, tense: x.tense, person: p.id, answer: x.forms[i],
          translation: all(x.translation), note: one(x.note) })));
      });
    } else if (x.type === "cloze") {
      data.cards.push(newTypedCard(list.id, "cloze", Object.assign(base, { sentence: x.sentence, answer: x.answer, hint: one(x.hint),
        explanation: one(x.explanation), translation: all(x.translation), ruleId: rules[x.ruleKey] || "" })));
    } else if (x.type === "fix") {
      data.cards.push(newTypedCard(list.id, "fix", Object.assign(base, { wrong: x.wrong, correct: x.correct,
        explanation: one(x.explanation), ruleId: rules[x.ruleKey] || "" })));
    }
  });
  return data;
}
// Exemple de saisie pour un champ de mot (éditeur de carte) : 3e mot de la démo de cette langue.
function langSample(code) { const w = arr((LANGUAGES[code] && LANGUAGES[code].demo || {}).words); return (w[2] || w[0] || {}).term || ""; }
