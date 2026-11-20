"use strict";

// ====================================================================================================
// js/screens/listes-cartes.js — ÉCRAN : LISTES, ÉDITEUR DE CARTE (2e morceau de l'ancien listes.js, étape 65)
// Ajouter, modifier, déplacer, supprimer une carte (formulaires vocabulaire et autres types). Chargé juste après
// js/screens/listes.js.
// ====================================================================================================

// === ÉCRAN : LISTES — CARTES : AJOUTER, MODIFIER, DÉPLACER (CHOIX DE LA LISTE), SUPPRIMER ===
// Formulaire adapté au type (nouvelle carte : menu « Type » ; carte existante : type fixe).
// Vocabulaire : champs selon les langues de la liste choisie (langue apprise obligatoire, puis langues d'appui) ;
// les autres langues de la carte sont gardées telles quelles. Changer de liste garde ce qui a été tapé.
// Autres types : champs du type, dans la langue apprise de la liste (temps et personnes lus dans LANGUAGES.grammar).
let lastNewType = "vocab";
function openCardEditor(cardId, listId) {
  const c = cardId ? state.cards.find(x => x.id === cardId) : null;
  if (cardId && !c) return;
  if (c) Shared.clearFlag(c.id);   // marque « modifiée par … » vue (étape 30)
  if (!canEditList(c ? c.listId : listId)) {
    if (c) { HardUI.tipModal(c, { readOnly: true }); return; }   // liste en lecture seule : seule « Mon astuce » (privée) est modifiable (étape 57)
    toast(t("sh.readOnly")); return;
  }
  if (!state.lists.length) { toast(t("lists.empty")); return; }
  const sel = listSelect(c ? c.listId : listId, false);
  let type = c ? cardType(c) : lastNewType;
  const tags = textInput(c ? c.tags.join(", ") : "", t("type.tagsPh"));
  const body = el("div");
  let form = null;
  const build = () => {
    body.textContent = "";
    form = type === "vocab" ? vocabForm(c, sel) : typedForm(c, sel, type);
    body.appendChild(form.node);
  };
  let ts = null;
  // Types proposés selon la langue apprise de la liste : pas de conjugaison sans grammaire (étape 35).
  const fillTypes = () => {
    if (!ts) return;
    const ok = typesFor(listLangs(sel.value).target);
    ts.textContent = "";
    ok.forEach(x => { const o = el("option", null, TYPE_ICON[x] + "  " + t("type." + x)); o.value = x; ts.appendChild(o); });
    if (!ok.includes(type)) { type = "vocab"; ts.value = type; build(); return true; }
    ts.value = type;
    return false;
  };
  sel.addEventListener("change", () => { if (!fillTypes()) form.redraw(); });
  const wrap = el("div");
  wrap.appendChild(formField(t("card.list"), sel));
  if (!c) {
    ts = el("select", "input");
    if (!typesFor(listLangs(sel.value).target).includes(type)) type = "vocab";
    fillTypes();
    ts.addEventListener("change", () => { type = lastNewType = ts.value; build(); });
    wrap.appendChild(formField(t("type.label"), ts));
  } else if (type !== "vocab") {
    const f = el("div", "field"); f.appendChild(typeBadge(type)); wrap.appendChild(f);
  }
  if (!form) build();
  const tipIn = HardUI.tipInput(c);   // « Mon astuce » (étape 57) : privée, 150 caractères, dans le morceau « tips » (jamais dans la carte)
  wrap.append(body, formField(t("card.tags"), tags), formField(t("hd.tip.label"), tipIn, false, t("hd.tip.hint")));
  const save = () => {
    const before = c ? { img: JSON.stringify(c.image || null), ex: JSON.stringify(c.examples || null) + "|" + (c.example || ""), tip: Hard.tip(c.id) } : null;
    const clBefore = c ? ClAuto.snap(c) : null;    // étape 73 : cases remplies par Claude avant l'enregistrement
    const r = form.save(parseTags(tags.value));
    if (!r) return false;                          // champ manquant : message déjà affiché, fenêtre gardée
    if (c) ClAuto.afterEdit(c, clBefore);          // case changée à la main : elle devient celle de l'utilisateur (conservée)
    const tipId = c ? c.id : (r.added && r.added[0]);
    if (tipId) {
      Hard.setTip(tipId, tipIn.value);
      // Réparation (étape 57) : image, exemple ou astuce ajoutés ou changés sur un mot difficile
      if (c && before && (before.img !== JSON.stringify(c.image || null) || before.ex !== JSON.stringify(c.examples || null) + "|" + (c.example || "") || before.tip !== Hard.tip(c.id))) Hard.markRepaired(c);
    }
    commit();
    if (r.added && r.added.length) {               // journal : cartes ajoutées à la main (regroupées par liste et par heure)
      const per = {};
      r.added.forEach(id => { const x = state.cards.find(y => y.id === id); if (x) per[x.listId] = (per[x.listId] || 0) + 1; });
      Object.keys(per).forEach(l => Activity.cardsAdded(l, per[l]));
    }
    // Dictionnaire commun (étape 36) : liaison de la carte (sens choisi, sinon recherche), puis proposition de complétion
    const linkIds = type === "vocab" ? (r.added && r.added.length ? r.added : r.link || []) : [];
    const afterDict = linkIds.length ? Dict.afterAdd(linkIds, r.dict) : Promise.resolve();
    if (r.added && r.added.length && type === "vocab") afterDict.then(() => offerCompletion(r.added)); // champs vides : proposer de les compléter
    // Image Wikimedia choisie avec « Proposer au dictionnaire commun » (étape 49) : après la liaison de la carte à son sens
    if (r.img) afterDict.then(() => ((r.added && r.added.length) ? r.added : (c ? [c.id] : [])).forEach(id => Images.propose(id)));
    if (r.msg) toast(r.msg);
  };
  openModal(t(c ? "card.editTitle" : "card.newTitle"), wrap, c
    ? [ { label: t("save"), kind: "primary", onClick: save },
        { label: t("card.delete"), kind: "danger", onClick: () => { confirmDeleteCard(c.id); } },
        { label: t("cancel") } ]
    : [ { label: t("cancel") }, { label: t("save"), kind: "primary", onClick: save } ]);
}

// Formulaire vocabulaire. save(tags) → { added: [ids] } ou null (champ manquant).
// Exemple (étape 35) : phrase dans la langue apprise de la liste + sa traduction dans chaque langue affichée (interface,
// appui) ; les exemples des autres langues apprises de la carte sont gardés tels quels.
function vocabForm(c, sel) {
  const vals = Object.assign({}, c ? c.terms : {});
  const posVals = Object.assign({}, c ? c.pos : {});
  const exVals = {};                 // langue apprise → { text, tr } en cours de saisie
  let inputs = {}, posSels = {}, exIn = null, exTrIns = {}, lg = null, stEx = {};
  const termsBox = el("div");
  const exBox = el("div");
  const stBox = el("div");                 // autres langues étudiées de la liste (étape 37) : mot, nature, exemple
  const dictBox = el("div", "dict-box");   // dictionnaire commun (étape 36)
  const node = el("div");
  // Image de la carte (étape 49) : mode Supabase seulement ; mot cherché sur Wikimedia = anglais, sinon interface, sinon appris.
  const imgF = typeof Images !== "undefined" && Images.on() ? imgEditorField(c, { word: () => {
    const v = code => inputs[code] ? inputs[code].value.trim() : String(vals[code] || "").trim();
    const w = [lg && lg.support.includes("en") ? "en" : "", state.settings.uiLang, lg ? lg.target : ""].concat(lg ? lg.support : []).map(x => x && v(x)).find(Boolean) || "";
    return w.split("/")[0].trim();
  } }) : null;
  node.append(dictBox, termsBox);
  if (imgF) node.appendChild(imgF.node);
  node.append(exBox, stBox);
  // --- Dictionnaire commun (étape 36) : carte pas encore reliée → recherche du mot tapé (en quittant le champ) ---
  // Un seul sens probable : cases vides remplies tout de suite (marquées « auto ») ; aucun : nouveau sens.
  // Plusieurs (faux doublon, étape 63) : aucun choix demandé ; cases vides remplies depuis le sens le plus proche s'il est
  // clair, sinon rien ; à l'enregistrement la carte garde ses valeurs et le cas est signalé (Dict.afterAdd).
  const dict = { pick: null, cands: null, q: "", auto: new Set(), busy: 0, conflict: false };
  const canDict = () => Dict.on() && !(c && c.senseId);
  const formVals = () => {
    const o = {};
    Object.keys(inputs).forEach(k => { const v = inputs[k].value.trim(); if (v) o["w:" + k] = v; });
    Object.keys(vals).forEach(k => { if (!inputs[k] && isLang(k) && String(vals[k] || "").trim()) o["w:" + k] = String(vals[k]).trim(); });
    return o;
  };
  const dictDraw = () => {
    dictBox.textContent = "";
    const cf = c ? DictConf.note(c) : null;   // faux doublon (étape 63) : repère + « Faire une proposition »
    if (cf) dictBox.appendChild(cf);
    if (c && c.senseId) { dictBox.appendChild(el("p", "hint dict-hint", t("dict.edLinked"))); return; }
    if (cf || !canDict()) return;
    if (dict.busy) { dictBox.appendChild(el("p", "hint dict-hint", t("dict.edSearching"))); return; }
    if (dict.pick === "new") { dictBox.appendChild(el("p", "hint dict-hint", t("dict.edNone"))); return; }
    if (dict.conflict) {                         // plusieurs sens : aucun choix demandé (étape 63)
      dictBox.appendChild(el("p", "hint dict-hint dcf-edhint", t("dcf.edHint")));
      if (dict.pick && dict.pick.id) dictBox.appendChild(dictSenseNode(dict.pick, [lg.target].concat(lg.support), dict.q.split("|")[0]));
      return;
    }
    if (dict.pick && dict.pick.id) {
      dictBox.appendChild(el("p", "hint dict-hint", t("dict.edFound")));
      dictBox.appendChild(dictSenseNode(dict.pick, [lg.target].concat(lg.support), dict.q.split("|")[0]));
    }
  };
  // Sens choisi : cases vides du formulaire remplies avec les valeurs du commun.
  const dictApply = s => {
    dict.pick = s;
    const v = s.vals || {};
    [lg.target].concat(lg.support).forEach(code => {
      const x = v[code] || {};
      if (inputs[code] && !inputs[code].value.trim() && x.w) { inputs[code].value = x.w; dict.auto.add("w:" + code); }
      const ps = posSels[code];
      if (ps && !ps.value && x.p && [...ps.options].some(o => o.value === x.p)) { ps.value = x.p; dict.auto.add("p:" + code); }
    });
    const xt = v[lg.target] || {};
    if (exIn && !exIn.value.trim() && xt.e) { exIn.value = xt.e; dict.auto.add("e:" + lg.target); }
    Object.keys(exTrIns).forEach(code => {
      const tr = xt.t && xt.t[code];
      if (tr && !exTrIns[code].value.trim()) { exTrIns[code].value = tr; dict.auto.add("t:" + lg.target + ":" + code); }
    });
    dictDraw();
  };
  const dictLookup = async (code, w) => {
    w = String(w || "").trim();
    if (!canDict() || !w) return;
    if (dict.pick && dict.pick.id && code !== lg.target && dict.q.split("|")[0] !== code) return;   // déjà relié : autre langue tapée, rien à chercher
    const q = code + "|" + dictNorm(w);
    if (q === dict.q) return;
    dict.q = q; dict.busy++; dictDraw();
    const res = await Dict.search(code, w);
    dict.busy--;
    if (dict.q !== q) return;                      // autre recherche lancée entre-temps
    if (res === null) { dict.q = ""; dictDraw(); return; }   // hors connexion : liaison à l'enregistrement
    dict.cands = res; dict.pick = null; dict.conflict = false;
    const d = dictDecide(formVals(), res, code);
    if (d === "new") dict.pick = "new";
    else if (d && d.id) dictApply(d);
    else if (d && d.ambig) { dict.conflict = true; if (d.best) dictApply(d.best); }   // faux doublon (étape 63)
    dictDraw();
  };
  const exGet = code => { if (!exVals[code]) { const e = c ? exEntry(c, code) : null; exVals[code] = { text: e ? e.text : "", tr: Object.assign({}, e ? e.tr : {}) }; } return exVals[code]; };
  const keepEx = () => {
    if (!lg || !exIn) return;
    const e = exGet(lg.target);
    e.text = exIn.value;
    Object.keys(exTrIns).forEach(k => { e.tr[k] = exTrIns[k].value; });
    Object.keys(stEx).forEach(L => { const x = exGet(L); x.text = stEx[L].text.value; Object.keys(stEx[L].tr).forEach(k => { x.tr[k] = stEx[L].tr[k].value; }); });
  };
  const draw = () => {
    Object.keys(inputs).forEach(k => { vals[k] = inputs[k].value; });
    Object.keys(posSels).forEach(k => { posVals[k] = posSels[k].value; });
    keepEx();
    termsBox.textContent = ""; inputs = {}; posSels = {};
    lg = listLangs(sel.value);
    const termRow = (box, code, i, noDict) => {
      const inp = textInput(vals[code] || "", langSample(code), code);
      inputs[code] = inp;
      if (!noDict) inp.addEventListener("change", () => { dictLookup(code, inp.value); });   // dictionnaire commun (étape 36)
      // Nature grammaticale du mot dans cette langue (abréviation de la langue + nom dans la langue de l'interface)
      const ps = el("select", "input");
      ps.setAttribute("aria-label", t("pos.label") + " (" + langName(code) + ")");
      const o0 = el("option", null, t("pos.label") + " —"); o0.value = ""; ps.appendChild(o0);
      const codes = posCodesFor(code);
      const cur = posVals[code] || "";
      if (cur && !codes.includes(cur)) codes.push(cur); // valeur importée non reconnue : gardée
      codes.forEach(pc => { const o = el("option", null, posLabel(pc, code) + (POS_CODES.includes(pc) ? " — " + t("pos." + pc) : "")); o.value = pc; ps.appendChild(o); });
      ps.value = cur;
      posSels[code] = ps;
      const row = el("div", "term-row");
      row.append(inp, ps);
      const isAuto = !!(c && (c.auto.includes("terms." + code) || ClAuto.has(c, code)) && (vals[code] || "").trim());   // rempli automatiquement (dictionnaire ou Claude, étape 73), pas encore vérifié
      box.appendChild(i === 0 ? formField(langName(code), row, true, isAuto ? t("card.autoField") : t("card.frHint"))
        : formField(langName(code), row, false, isAuto ? t("card.autoField") : (vals[code] || "").trim() ? "" : t("card.toFillOne")));   // case « à compléter » (étape 31)
    };
    [lg.target].concat(lg.support).forEach((code, i) => termRow(termsBox, code, i));
    exBox.textContent = ""; exTrIns = {};
    const e = exGet(lg.target);
    exIn = el("textarea", "input"); exIn.value = e.text; exIn.lang = lg.target; exIn.rows = 2;
    exBox.appendChild(formField(t("card.exampleIn", { lang: langName(lg.target) }), exIn));
    lg.support.forEach(code => {
      const inp = textInput(e.tr[code] || "", "", code);
      exTrIns[code] = inp;
      exBox.appendChild(formField(t("card.exampleTr", { lang: langName(code) }), inp));
    });
    // Autres langues étudiées (étape 37) : mot (et mots des langues affichées de cette langue), nature, exemple + traductions
    stBox.textContent = ""; stEx = {};
    studyExtraLangs(sel.value).forEach(L => {
      const lgL = studyLg(L), sec = el("div", "study-sec");
      sec.appendChild(el("div", "study-sec-hd", t("study.current") + " · " + langName(L)));
      [L].concat(lgL.support).forEach(code => { if (!inputs[code]) termRow(sec, code, 1, true); });
      const x = exGet(L), ta = el("textarea", "input");
      ta.value = x.text; ta.lang = L; ta.rows = 2;
      stEx[L] = { text: ta, tr: {} };
      sec.appendChild(formField(t("card.exampleIn", { lang: langName(L) }), ta));
      lgL.support.forEach(code => {
        const inp = textInput(x.tr[code] || "", "", code);
        stEx[L].tr[code] = inp;
        sec.appendChild(formField(t("card.exampleTr", { lang: langName(code) }), inp));
      });
      stBox.appendChild(sec);
    });
    dictDraw();
  };
  draw();
  const save = tagList => {
    Object.keys(inputs).forEach(k => { vals[k] = inputs[k].value.trim(); });
    Object.keys(posSels).forEach(k => { posVals[k] = posSels[k].value; });
    keepEx();
    if (!vals[lg.target]) { toast(t("card.targetRequired", { lang: langName(lg.target) })); return null; }
    if (!lg.support.some(code => vals[code])) { toast(t("card.supportRequired", { langs: lg.support.map(x => langName(x)).join(", ") })); return null; }
    const terms = normTerms(vals);
    const pos = normTerms(posVals);
    // Exemples : ceux de la carte (autres langues gardées), plus ceux saisis.
    const exs = Object.assign({}, c ? (exMap(c) || {}) : {});
    if (c && !exMap(c) && c.example && !exVals[lg.target]) exs[lg.target] = { text: c.example, tr: {} };
    Object.keys(exVals).forEach(k => { exs[k] = exVals[k]; });
    const examples = normExamples(exs);
    const exT = examples[lg.target] ? examples[lg.target].text : "";
    if (c) {
      const snap = Dict.track(c);                    // dictionnaire commun (étape 36) : cases modifiées → commun
      // Champ modifié à la main : il n'est plus « généré, non validé »
      c.auto = c.auto.filter(a => !(a.startsWith("terms.") && (terms[a.slice(6)] || "") !== (c.terms[a.slice(6)] || "")) && !(a === "example" && exT !== exText(c, lg.target))
        && !(a.startsWith("extr.") && ((examples[lg.target] || { tr: {} }).tr[a.slice(5)] || "") !== exTr(c, lg.target, a.slice(5)))
        && !(a.startsWith("pos.") && (pos[a.slice(4)] || "") !== ((c.pos || {})[a.slice(4)] || "")));
      c.listId = sel.value; c.terms = terms; c.pos = pos;
      c.examples = examples; c.example = exT; c.tags = tagList;
      if (imgF) { const im = imgF.get(); if (im) c.image = im; else delete c.image; }   // étape 49
      Dict.changed(c, snap);
      // Carte pas encore reliée : sens choisi dans le formulaire (ou recherche) appliqué après l'enregistrement
      return { added: [], link: c.senseId ? [] : [c.id], dict: dictOpts(c.id), img: !!(imgF && imgF.proposeAsked()) };
    }
    const nc = newCard(sel.value, terms, examples, tagList, pos, lg.target);
    if (imgF) { const im = imgF.get(); if (im) nc.image = im; }   // étape 49
    state.cards.push(nc);
    return { added: [nc.id], dict: dictOpts(nc.id), img: !!(imgF && imgF.proposeAsked()) };
  };
  // Choix fait dans le formulaire (sens ou « nouveau sens ») et cases remplies depuis le commun (marquées « auto »).
  const dictOpts = id => {
    const o = {};
    if (dict.pick && !dict.conflict) o.picks = new Map([[id, dict.pick]]);   // faux doublon : la liaison refait la recherche et signale le cas
    if (dict.auto.size) {
      const keep = new Set([...dict.auto].filter(k => { const p = k.split(":"); return p[0] === "w" ? !!vals[p[1]] : true; }));
      o.auto = new Map([[id, keep]]);
    }
    return o;
  };
  return { node, redraw: draw, save };
}

// Menu « Règle liée » : fiches de règle de la même langue (celles de la liste d'abord).
function ruleSelect(lang, listId, current) {
  const s = el("select", "input");
  const o0 = el("option", null, "—"); o0.value = ""; s.appendChild(o0);
  state.cards.filter(x => cardType(x) === "rule" && x.lang === lang)
    .sort((a, b) => (a.listId === listId ? 0 : 1) - (b.listId === listId ? 0 : 1) || a.title.localeCompare(b.title))
    .forEach(r => { const o = el("option", null, r.title + (r.listId !== listId ? " (" + ((getList(r.listId) || {}).name || "") + ")" : "")); o.value = r.id; s.appendChild(o); });
  s.value = current && [...s.options].some(o => o.value === current) ? current : "";
  return s;
}
function taInput(value, placeholder, lang, rows) {
  const ta = el("textarea", "input"); ta.value = value || ""; ta.rows = rows || 2;
  if (placeholder) ta.placeholder = placeholder;
  if (lang) ta.lang = lang;
  return ta;
}

// Formulaire des autres types (conj, cloze, fix, rule). save(tags) → { added: [ids], msg } ou null.
function typedForm(c, sel, type) {
  const node = el("div");
  const v = Object.assign({}, c || {});           // valeurs en cours (gardées quand la liste change)
  let ins = {};                                   // champs affichés : nom → élément
  let conjMode = c ? "one" : "table";             // conjugaison : une forme, ou tableau entier (nouvelle carte)
  let tableVals = {};                             // tableau : id de personne → forme tapée
  let lang = null;
  const keep = () => {
    Object.keys(ins).forEach(k => { if (k.startsWith("p:")) tableVals[k.slice(2)] = ins[k].value; else v[k] = ins[k].value; });
  };
  const add = (key, label, input, required, hint) => { ins[key] = input; node.appendChild(formField(label, input, required, hint)); return input; };
  const draw = () => {
    keep();
    node.textContent = ""; ins = {};
    lang = listLangs(sel.value).target;
    const ln = langName(lang), sup = listLangs(sel.value).support.map(x => langName(x)).join(", ");
    if (type === "conj") {
      add("verb", t("type.conj.verb") + " (" + ln + ")", textInput(v.verb, "", lang), true);
      const ts = el("select", "input");
      tensesOf(lang).forEach(x => { const o = el("option", null, locText(x.names) + (x.optional ? " — " + t("type.optional") : "")); o.value = x.id; ts.appendChild(o); });
      if (tenseOf(lang, v.tense)) ts.value = v.tense; else v.tense = ts.value;
      ts.addEventListener("change", () => { v.tense = ts.value; draw(); });
      node.appendChild(formField(t("type.conj.tense"), ts, true));
      if (!c) {
        const seg = el("div", "seg");
        [["table", "type.conj.modeTable"], ["one", "type.conj.modeOne"]].forEach(([m, k]) => {
          const b = el("button", null, t(k)); b.type = "button";
          b.setAttribute("aria-pressed", String(m === conjMode));
          b.addEventListener("click", () => { keep(); conjMode = m; draw(); });
          seg.appendChild(b);
        });
        node.appendChild(formField(t("type.conj.mode"), seg));
      }
      const ps = personsOf(lang, v.tense);
      if (conjMode === "table") {
        const box = el("div", "conj-grid");
        ps.forEach(p => {
          const inp = textInput(tableVals[p.id] || "", "", lang);
          ins["p:" + p.id] = inp;
          const lab = el("label", null, personLabel(lang, v.tense, p.id));
          box.append(lab, inp);
        });
        node.appendChild(formField(t("type.conj.forms"), box, true, t("type.conj.formsHint")));
      } else {
        const psel = el("select", "input");
        ps.forEach(p => { const o = el("option", null, personLabel(lang, v.tense, p.id)); o.value = p.id; psel.appendChild(o); });
        if (ps.some(p => p.id === v.person)) psel.value = v.person;
        add("person", t("type.conj.person"), psel, true);
        add("answer", t("type.conj.answer"), textInput(v.answer, "", lang), true, t("card.frHint"));
      }
      add("translation", t("type.translation"), textInput(v.translation, sup), false, t("type.conj.trHint"));
      const note = add("note", t("type.note"), textInput(v.note, "", ""), false);
      const dl = el("datalist"); dl.id = "conjNotes-" + uid();
      arr(grammarOf(lang).notes).forEach(n => { const o = el("option"); o.value = locText(n); dl.appendChild(o); });
      note.setAttribute("list", dl.id); node.appendChild(dl);
      if (c) { const b = el("button", "link-btn", t("type.seeTable")); b.type = "button"; b.addEventListener("click", () => openConjTable(c)); node.appendChild(b); }
    } else if (type === "cloze") {
      add("sentence", t("type.cloze.sentence") + " (" + ln + ")", taInput(v.sentence, langSampleCloze(lang), lang), true, t("type.cloze.sentenceHint"));
      add("answer", t("type.cloze.answer"), textInput(v.answer, "", lang), true, t("card.frHint"));
      add("hint", t("type.hint"), textInput(v.hint, "", ""), false);
      add("explanation", t("type.explanation"), taInput(v.explanation, "", ""), false);
      add("translation", t("type.translationSent"), textInput(v.translation, sup), false);
      add("ruleId", t("type.rule.link"), ruleSelect(lang, sel.value, v.ruleId), false);
    } else if (type === "fix") {
      add("wrong", t("type.fix.wrong") + " (" + ln + ")", taInput(v.wrong, "", lang), true);
      add("correct", t("type.fix.correct"), taInput(v.correct, "", lang), true);
      add("explanation", t("type.explanation"), taInput(v.explanation, "", ""), false);
      add("ruleId", t("type.rule.link"), ruleSelect(lang, sel.value, v.ruleId), false);
    } else if (type === "rule") {
      add("title", t("type.rule.title"), textInput(v.title, "", ""), true);
      add("body", t("type.rule.body"), taInput(v.body, "", "", 5), true, t("type.rule.bodyHint"));
      add("examples", t("type.rule.examples") + " (" + ln + ")", taInput(v.examples != null && Array.isArray(v.examples) ? v.examples.join("\n") : (v.examples || ""), "", lang, 3), false, t("type.rule.examplesHint"));
      add("translation", t("type.rule.translation"), taInput(v.translation, sup, ""), false);
    }
  };
  draw();
  const need = (k, msgKey) => { if (!String(v[k] || "").trim()) { toast(t(msgKey || "type.required", { f: k })); return false; } return true; };
  const save = tagList => {
    keep();
    const listId = sel.value;
    if (type === "conj") {
      if (!String(v.verb || "").trim()) { toast(t("type.err.verb")); return null; }
      const base = { lang, verb: v.verb, tense: v.tense, translation: v.translation, note: v.note };
      if (c) {
        if (!String(v.answer || "").trim()) { toast(t("type.err.answer")); return null; }
        Object.assign(c, normTypedFields("conj", Object.assign(base, { person: v.person, answer: v.answer })), { listId, tags: tagList });
        return { added: [] };
      }
      if (conjMode === "one") {
        if (!String(v.answer || "").trim()) { toast(t("type.err.answer")); return null; }
        const nc = newTypedCard(listId, "conj", Object.assign(base, { person: v.person || personsOf(lang, v.tense)[0].id, answer: v.answer }), tagList);
        state.cards.push(nc);
        return { added: [nc.id] };
      }
      // Tableau : une carte par case remplie ; une carte existante (même liste, verbe, temps, personne) est mise à jour.
      const ps = personsOf(lang, v.tense).filter(p => String(tableVals[p.id] || "").trim());
      if (!ps.length) { toast(t("type.err.table")); return null; }
      const added = []; let upd = 0;
      const vk = normText(v.verb);
      ps.forEach(p => {
        const f = Object.assign({}, base, { person: p.id, answer: tableVals[p.id] });
        const ex = state.cards.find(x => cardType(x) === "conj" && x.listId === listId && x.lang === lang && x.tense === v.tense && x.person === p.id && normText(x.verb) === vk);
        if (ex) { Object.assign(ex, normTypedFields("conj", f)); upd++; }
        else { const nc = newTypedCard(listId, "conj", f, tagList); state.cards.push(nc); added.push(nc.id); }
      });
      return { added, msg: t("type.conj.saved", { n: added.length, m: upd }) };
    }
    if (type === "cloze") {
      if (!CLOZE_GAP.test(v.sentence || "")) { toast(t("type.err.gap")); return null; }
      if (!need("answer", "type.err.answer")) return null;
    }
    if (type === "fix" && (!need("wrong", "type.err.wrong") || !need("correct", "type.err.correct"))) return null;
    if (type === "fix" && wrClean(v.wrong) === wrClean(v.correct)) { toast(t("type.err.same")); return null; }
    if (type === "rule" && (!need("title", "type.err.title") || !need("body", "type.err.body"))) return null;
    const f = Object.assign({}, v, { lang });
    if (type === "rule") f.examples = String(v.examples || "").split("\n");
    if (c) { Object.assign(c, normTypedFields(type, f), { listId, tags: tagList }); return { added: [] }; }
    const nc = newTypedCard(listId, type, f, tagList);
    state.cards.push(nc);
    return { added: [nc.id] };
  };
  return { node, redraw: draw, save };
}
// Exemple de phrase à trous pour une langue : celle de sa démo.
function langSampleCloze(code) { const x = arr((LANGUAGES[code] && LANGUAGES[code].demo || {}).cards).find(y => y.type === "cloze"); return x ? x.sentence : "___"; }

function confirmDeleteCard(id) {
  const c = state.cards.find(x => x.id === id);
  if (!c) return;
  openModal(t("card.delete"), el("p", null, t("card.deleteConfirm", { fr: cardTitle(c) })), [
    { label: t("cancel") },
    { label: t("delete"), kind: "danger", onClick: () => { state.cards = state.cards.filter(x => x.id !== id); commit(); } }
  ]);
}
