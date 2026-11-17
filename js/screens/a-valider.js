"use strict";

// === ÉCRAN : À VALIDER ===
// Une ligne par proposition : case à cocher, liste, mot de la langue apprise, champ, ancienne → nouvelle valeur (différences surlignées), type.
// Filtres (liste, type, champ) ; la sélection est limitée aux lignes filtrées.
// Pages de CONFIG.PV_PAGE lignes : seule la page affichée est dans le DOM. Sélection = ensemble d'ids en mémoire (pv.sel) :
// menu « Sélectionner » : 50 · 100 · 200 · 500 (les N premières lignes filtrées, dans l'ordre affiché, à partir de la page
// en cours) · Tout (N) (toutes les lignes filtrées, sans les afficher) · Aucune. Un choix remplace la sélection précédente.
// Seules les 50 cases de la page affichée reflètent l'ensemble ; aucune boucle sur des cases à cocher.
// Accepter / Refuser : par paquets de CONFIG.PV_CHUNK, barre de progression, l'écran reste fluide ; reste à faire gardé
// sur l'appareil après chaque paquet (reprise par le bandeau si l'appli est rechargée ou si on arrête).
// Modifier (édition dans la ligne, puis Accepter) ; « Annuler » quelques secondes après une action groupée.
const pv = { folder: "", list: "", type: "", field: "", page: 0, sel: new Set(), editing: new Set(), edits: {}, refreshBar: null };
// Dossier : id, "__none__" (sans dossier) ou "" (tous).
function pvFolderOf(listId) { const l = getList(listId); return l && l.folderId ? l.folderId : "__none__"; }
// Filtre par champ : une traduction (code de langue), l'exemple (et ses traductions, étape 35), la nature (« pos » = toutes
// les langues) ou les doublons.
const PV_FIELDS = LANG_CODES.concat(["example", "pos", "typed", "dup"]);
function pvFieldMatch(p, f) { return f === "pos" ? isPosField(p.field) : f === "typed" ? isTypedField(p.field) : f === "example" ? (p.field === "example" || isExTrField(p.field)) : p.field === f; }
// Champ « généré, non validé » (c.auto) d'un champ de proposition.
function autoKeyOf(f) { return f === "example" ? "example" : isPosField(f) ? "pos." + f.slice(4) : isExTrField(f) ? "extr." + f.slice(5) : "terms." + f; }
// Nature affichée : « n.f. — nom féminin » (abréviation dans la langue du mot, nom dans la langue de l'interface).
function pvPosText(code, lng) { return code ? posLabel(code, lng) + (POS_CODES.includes(code) ? " — " + t("pos." + code) : "") : ""; }
let undoTimer = null;

function pvReset() { pv.folder = ""; pv.list = ""; pv.type = ""; pv.field = ""; pv.page = 0; pvClearSel(); }
function pvClearSel() { pv.sel.clear(); pv.editing.clear(); pv.edits = {}; }
function pvFieldLabel(f) {
  if (f === "dup") return t("pv.field.dup");
  if (f === "example") return t("card.example");
  if (f === "pos") return t("pv.field.posAll");
  if (f === "typed") return t("pv.field.typed");
  if (isTypedField(f)) { const k = f.slice(2); return t(k === "examples" ? "type.rule.examples" : k === "hint" ? "type.hint" : "type." + k).replace(/\s*:\s*$/, ""); }
  if (isPosField(f)) return t("pv.field.pos", { lang: langName(f.slice(4)) });
  if (isExTrField(f)) return t("card.exampleTr", { lang: langName(f.slice(5)) });
  return langName(f);
}
// Propositions sur une langue cachée (ni apprise ni affichée : displayLangs, étape 35) : gardées, mais ni affichées
// ni comptées ; elles réapparaissent si le profil de langues change.
function liveProposals() {
  const byId = new Map(state.cards.map(c => [c.id, c]));
  const lgs = new Map();
  const vis = c => { let x = lgs.get(c.listId); if (!x) { x = visibleLangs(cardLangs(c)); lgs.set(c.listId, x); } return x; };
  return state.proposals.filter(p => {
    if (p.field === "new") return !!getList(p.listId);
    const c = byId.get(p.cardId);
    if (!c) return false;
    const code = fieldCode(p.field);
    return !code || !isVocab(c) || vis(c).includes(code);
  });
}
// Liste d'une proposition (« Nouvelle carte » : liste de destination).
function pvListOf(p, cards) { if (p.field === "new") return p.listId; const c = cards.get(p.cardId); return c ? c.listId : ""; }
function renderPendingBadge() {
  const b = $("#pendingBadge");
  if (!b) return;
  const n = Storage.getUser() ? liveProposals().length : 0;
  b.hidden = !n;
  b.textContent = n > 99 ? "99+" : String(n);
}

// Menu « Sélectionner » : tailles proposées.
const PV_SEL_SIZES = [50, 100, 200, 500];
// Remplace la sélection : "none", "all" (toutes les lignes filtrées) ou N lignes à partir de la 1re ligne de la page en cours.
function pvSelect(vis, v) {
  pv.sel.clear();
  if (v === "none") return;
  if (v === "all") { for (let i = 0; i < vis.length; i++) pv.sel.add(vis[i].id); return; }
  const n = parseInt(v, 10);
  if (!(n > 0)) return;
  const start = Math.min(Math.max(0, pv.page | 0) * CONFIG.PV_PAGE, vis.length);
  const end = Math.min(start + n, vis.length);
  for (let i = start; i < end; i++) pv.sel.add(vis[i].id);
}

function renderPending() {
  const root = $("#screen-pending");
  root.textContent = "";
  const qb = queueBanner();             // demandes à Claude en cours (file d'attente)
  if (qb) root.appendChild(qb);
  const all = liveProposals();
  if (!all.length) { pvClearSel(); root.appendChild(el("div", "empty", t("pv.empty"))); return; }
  const cards = new Map(state.cards.map(c => [c.id, c]));
  const listIds = new Set(all.map(p => pvListOf(p, cards)));
  if (pv.list && !listIds.has(pv.list)) pv.list = "";
  const folderIds = new Set([...listIds].map(pvFolderOf));
  if (pv.folder && !folderIds.has(pv.folder)) pv.folder = "";
  if (pv.list && pv.folder && pvFolderOf(pv.list) !== pv.folder) pv.list = "";
  if (pv.field && !all.some(p => pvFieldMatch(p, pv.field))) pv.field = "";
  if (pv.type && !all.some(p => p.type === pv.type)) pv.type = "";
  const vis = all.filter(p => (!pv.folder || pvFolderOf(pvListOf(p, cards)) === pv.folder) && (!pv.list || pvListOf(p, cards) === pv.list) && (!pv.type || p.type === pv.type) && (!pv.field || pvFieldMatch(p, pv.field)));
  const visIds = new Set(vis.map(p => p.id));
  [...pv.sel].forEach(id => { if (!visIds.has(id)) pv.sel.delete(id); });
  [...pv.editing].forEach(id => { if (!visIds.has(id)) pv.editing.delete(id); });

  // Filtres
  const f = el("div", "pv-filters");
  const mkSel = (value, opts, onCh) => {
    const s = el("select", "input");
    opts.forEach(([v, l]) => { const o = el("option", null, l); o.value = v; s.appendChild(o); });
    s.value = value;
    s.addEventListener("change", () => { onCh(s.value); pv.page = 0; renderPending(); });
    return s;
  };
  if (state.folders.length) {
    const fopts = sortedFolders().filter(x => folderIds.has(x.id)).map(x => [x.id, x.name]);
    if (folderIds.has("__none__")) fopts.push(["__none__", t("folders.none")]);
    f.classList.add("four");
    f.appendChild(mkSel(pv.folder, [["", t("pv.allFolders")]].concat(fopts), v => { pv.folder = v; pv.list = ""; }));
  }
  f.append(
    mkSel(pv.list, [["", t("pv.allLists")]].concat(orderedLists().filter(l => listIds.has(l.id) && (!pv.folder || pvFolderOf(l.id) === pv.folder)).map(l => [l.id, l.name])), v => { pv.list = v; }),
    mkSel(pv.type, [["", t("pv.allTypes")], ["completion", t("pv.type.completion")], ["correction", t("pv.type.correction")]]
      .concat(all.some(p => p.type === "newcard") ? [["newcard", t("pv.type.newcard")]] : []), v => { pv.type = v; }),
    mkSel(pv.field, [["", t("pv.allFields")]].concat(PV_FIELDS.filter(x => all.some(p => pvFieldMatch(p, x))).map(x => [x, pvFieldLabel(x)])), v => { pv.field = v; })
  );
  root.appendChild(f);

  // Page affichée
  const pages = Math.max(1, Math.ceil(vis.length / CONFIG.PV_PAGE));
  pv.page = Math.min(Math.max(0, pv.page | 0), pages - 1);
  const pageItems = vis.slice(pv.page * CONFIG.PV_PAGE, (pv.page + 1) * CONFIG.PV_PAGE);

  // Sélection + actions (collées en haut pendant le défilement)
  const sticky = el("div", "pv-sticky");
  const bar = el("div", "pv-bar");
  const menu = el("select", "input pv-selmenu");
  menu.setAttribute("aria-label", t("pv.selMenu"));
  [["", t("pv.selMenu")]].concat(PV_SEL_SIZES.map(n => [String(n), t("pv.selN", { n })]), [["all", t("pv.selAll", { n: vis.length })], ["none", t("pv.selNone")]])
    .forEach(([v, l]) => { const o = el("option", null, l); o.value = v; menu.appendChild(o); });
  menu.addEventListener("change", () => {
    const v = menu.value;
    menu.value = "";
    if (!v) return;
    pvSelect(vis, v);
    renderPending();
  });
  const count = el("span", "pv-count");
  bar.append(menu, count);
  sticky.appendChild(bar);
  // Compteur sans réafficher les lignes (appelé aussi quand on coche une ligne).
  const refresh = () => { count.textContent = t("pv.selectedOf", { n: pv.sel.size, total: vis.length }); };
  pv.refreshBar = refresh;
  refresh();
  const acts = el("div", "btns three");
  const bA = el("button", "btn primary", t("pv.accept"));
  const bR = el("button", "btn danger", t("pv.reject"));
  const bE = el("button", "btn", t("pv.edit"));
  bA.addEventListener("click", pvAccept);
  bR.addEventListener("click", pvReject);
  bE.addEventListener("click", pvEdit);
  acts.append(bA, bR, bE);
  sticky.appendChild(acts);
  if (pv.editing.size) sticky.appendChild(el("div", "pv-hint", t("pv.editHint")));
  root.appendChild(sticky);

  if (!vis.length) { root.appendChild(el("div", "empty", t("lists.noResults"))); return; }
  const pager = () => {
    const w = el("div", "pv-pager");
    if (pages < 2) return null;
    const prev = el("button", "btn", "‹"), next = el("button", "btn", "›");
    prev.setAttribute("aria-label", t("pv.prev")); next.setAttribute("aria-label", t("pv.next"));
    prev.disabled = pv.page === 0; next.disabled = pv.page >= pages - 1;
    const go = d => { pv.page += d; renderPending(); try { root.scrollIntoView({ block: "start" }); } catch (e) { window.scrollTo(0, 0); } };
    prev.addEventListener("click", () => go(-1));
    next.addEventListener("click", () => go(1));
    w.append(prev, el("span", null, t("pv.page", { i: pv.page + 1, n: pages })), next);
    return w;
  };
  const p1 = pager();
  if (p1) root.appendChild(p1);
  const items = el("div", "items");
  pageItems.forEach(p => items.appendChild(p.field === "new" ? pvNewRow(p) : pvRow(p, cards.get(p.cardId))));
  root.appendChild(items);
  const p2 = pager();
  if (p2) root.appendChild(p2);
}

// Case d'une ligne : met à jour la sélection, la ligne et la barre, sans réafficher l'écran.
function pvRowCheck(row, cb, id) {
  cb.addEventListener("change", () => {
    if (cb.checked) pv.sel.add(id); else pv.sel.delete(id);
    row.classList.toggle("sel", cb.checked);
    if (pv.refreshBar) pv.refreshBar();
  });
}

function pvRow(p, c) {
  const row = el("label", "pv-row" + (pv.sel.has(p.id) ? " sel" : ""));
  const cb = el("input", "pv-cb");
  cb.type = "checkbox";
  cb.checked = pv.sel.has(p.id);
  pvRowCheck(row, cb, p.id);
  const m = el("div", "main");
  const top = el("div", "pv-top");
  const l = getList(c.listId);
  top.append(el("span", "tag", "▸ " + (l ? l.name : "")), el("span", "pv-type " + p.type, t("pv.type." + p.type)), el("span", "pv-field", pvFieldLabel(p.field)));
  const lg = cardLangs(c);
  const w = el("div", "pv-fr", targetTerm(c, lg) || "—"); w.lang = lg.target;
  m.append(top, w);
  if (isExTrField(p.field)) { const tx = exText(c, lg.target); if (tx) { const e = el("div", "pv-field", tx); e.lang = lg.target; m.appendChild(e); } }
  if (p.field === "dup") {
    const sub = supportText(c, lg);
    if (sub) m.appendChild(el("div", "pv-field", sub));
    m.appendChild(el("div", "pv-act", "→ " + t("pv.dupAction")));
  } else if (isPosField(p.field)) { // nature : libellés lisibles, modification par liste déroulante
    const lng = p.field.slice(4);
    const d = el("div", "pv-diff");
    const oldT = pvPosText(p.oldValue, lng);
    d.appendChild(oldT ? el("div", "wr-diff", "") : el("div", "wr-diff muted", "—"));
    if (oldT) d.lastChild.appendChild(el("mark", "wr-bad", oldT));
    d.appendChild(el("span", "pv-arrow", "→"));
    const editing = pv.editing.has(p.id);
    if (!editing) { const nd = el("div", "wr-diff"); nd.appendChild(el("mark", "wr-miss", pvPosText(p.newValue, lng))); d.appendChild(nd); }
    m.appendChild(d);
    if (editing) {
      const ps = el("select", "input");
      const codes = posCodesFor(lng);
      const cur = pv.edits[p.id] != null ? pv.edits[p.id] : p.newValue;
      if (cur && !codes.includes(cur)) codes.push(cur);
      codes.forEach(pc => { const o = el("option", null, pvPosText(pc, lng)); o.value = pc; ps.appendChild(o); });
      ps.value = cur;
      ps.addEventListener("change", () => { pv.edits[p.id] = ps.value; });
      m.appendChild(ps);
    }
  } else {
    const r = wrLcs(p.oldValue, p.newValue);
    const d = el("div", "pv-diff");
    d.appendChild(p.oldValue ? wrDiffNode(r.A, r.ma, "wr-bad") : el("div", "wr-diff muted", "—"));
    d.appendChild(el("span", "pv-arrow", "→"));
    const editing = pv.editing.has(p.id);
    if (!editing) d.appendChild(wrDiffNode(r.B, r.mb, "wr-miss"));
    m.appendChild(d);
    if (editing) { // édition directe de la nouvelle valeur, puis « Accepter »
      const inp = textInput(pv.edits[p.id] != null ? pv.edits[p.id] : p.newValue, "", fieldCode(p.field) || lg.target);
      inp.addEventListener("input", () => { pv.edits[p.id] = inp.value; });
      m.appendChild(inp);
    }
  }
  if (p.reason) m.appendChild(el("div", "pv-reason", p.reason));
  row.append(cb, m);
  return row;
}

// --- Propositions « Nouvelle carte » (écran « Générer des cartes ») ---
function pvNewRank(p) { return p.cards.some(d => d.type === "rule") ? 0 : 1; }
// Carte temporaire pour l'affichage (titres, sous-titres) d'un brouillon.
// Exemples d'un brouillon de vocabulaire : { <langue apprise>: { text, tr } } (étape 35).
function draftExamples(d, tg) {
  const text = String(d.fields.example || "").trim(), tr = normTerms(d.fields.exTr);
  return text || Object.keys(tr).length ? { [tg]: { text, tr } } : {};
}
function draftCard(d, listId) {
  if (d.type === "vocab") return Object.assign(newCard(listId, d.fields.terms, draftExamples(d, listLangs(listId).target), [], d.fields.pos, listLangs(listId).target), { id: "" });
  return Object.assign({ type: d.type, listId, id: "", examples: [] }, d.fields);
}
function pvNewRow(p) {
  const row = el("label", "pv-row" + (pv.sel.has(p.id) ? " sel" : ""));
  const cb = el("input", "pv-cb");
  cb.type = "checkbox";
  cb.checked = pv.sel.has(p.id);
  pvRowCheck(row, cb, p.id);
  const m = el("div", "main");
  const top = el("div", "pv-top");
  const l = getList(p.listId);
  const ty = p.cards[0].type;
  top.append(el("span", "tag", "▸ " + (l ? l.name : "")), el("span", "pv-type newcard", t("pv.type.newcard")), typeBadge(ty));
  if (p.cards.length > 1) top.appendChild(el("span", "pv-field", t("pv.newN", { n: p.cards.length })));
  m.appendChild(top);
  const lg = listLangs(p.listId);
  const editing = pv.editing.has(p.id);
  const ds = editing ? pv.edits[p.id] : p.cards;
  const box = el("div", "pv-new");
  if (ty === "conj") {
    const c0 = draftCard(ds[0], p.listId);
    const h = el("div", "pv-new-t1", c0.verb + " — " + tenseName(c0.lang, c0.tense)); h.lang = c0.lang;
    box.appendChild(h);
    const tb = el("table", "ty-table");
    ds.forEach((d, i) => {
      const c = draftCard(d, p.listId);
      const tr = el("tr");
      tr.appendChild(el("td", "muted", personLabel(c.lang, c.tense, c.person)));
      const td = el("td"); td.lang = c.lang;
      if (editing) { const inp = textInput(d.fields.answer, "", c.lang); inp.addEventListener("input", () => { d.fields.answer = inp.value; }); td.appendChild(inp); }
      else td.textContent = conjFull(c);
      tr.appendChild(td);
      tb.appendChild(tr);
    });
    box.appendChild(tb);
    if (editing) pvNewInputs(box, ds, ["translation", "note"], lg);
    else {
      const extra = [ds[0].fields.translation, ds[0].fields.note].filter(Boolean).join(" · ");
      if (extra) box.appendChild(el("div", "pv-new-t2", extra));
    }
  } else if (editing) {
    pvNewInputs(box, ds, ty === "vocab" ? ["t:" + lg.target].concat(lg.support.map(x => "t:" + x), ["example"], lg.support.map(x => "x:" + x)) : (TYPE_FIELDS[ty] || []).filter(f => !["lang", "ruleId"].includes(f)).concat(ty === "rule" ? ["examples"] : []), lg);
  } else {
    const d = ds[0], c = draftCard(d, p.listId);
    const t1 = el("div", "pv-new-t1", ty === "vocab" ? (term(c, lg.target) + (d.fields.pos && d.fields.pos[lg.target] ? "  " + posLabel(d.fields.pos[lg.target], lg.target) : "")) : cardTitle(c));
    t1.lang = ty === "vocab" ? lg.target : c.lang;
    box.appendChild(t1);
    const sub = ty === "vocab" ? supportText(c, lg) : cardSubtitle(c);
    if (sub) box.appendChild(el("div", "pv-new-t2", sub));
    const more = ty === "vocab" ? [d.fields.example].concat(lg.support.map(x => (d.fields.exTr || {})[x])) : [d.fields.hint ? t("type.hint") + " " + d.fields.hint : "", d.fields.explanation, ty === "rule" ? arr(d.fields.examples).join(" · ") : "", d.fields.translation];
    more.filter(Boolean).forEach(x => box.appendChild(el("div", "pv-new-t2", x)));
    if (d.ruleRef) box.appendChild(el("div", "pv-new-t2", "§ " + d.ruleRef));
  }
  m.appendChild(box);
  if (p.reason) m.appendChild(el("div", "pv-reason", p.reason));
  row.append(cb, m);
  return row;
}
// Champs modifiables d'un brouillon (la ligne reste un <label> : les clics sur les champs ne cochent pas la case).
function pvNewInputs(box, ds, fields, lg) {
  const w = el("div", "pv-edit");
  const d = ds[0];
  const stop = e => { e.stopPropagation(); };
  fields.forEach(f => {
    let label, get, set, multi = false, lng = d.fields.lang || lg.target;
    if (f.startsWith("t:")) { const code = f.slice(2); label = langName(code); lng = code; get = () => (d.fields.terms || {})[code] || ""; set = v => { d.fields.terms = Object.assign({}, d.fields.terms, { [code]: v }); }; }
    else if (f.startsWith("x:")) { const code = f.slice(2); label = t("card.exampleTr", { lang: langName(code) }); lng = code; get = () => (d.fields.exTr || {})[code] || ""; set = v => { d.fields.exTr = Object.assign({}, d.fields.exTr, { [code]: v }); }; }
    else if (f === "examples") { label = t("type.rule.examples"); multi = true; get = () => arr(d.fields.examples).join("\n"); set = v => { d.fields.examples = v.split("\n").map(x => x.trim()).filter(Boolean); }; }
    else {
      const LBL = { example: "card.example", sentence: "type.cloze.sentence", answer: "type.cloze.answer", hint: "type.hint", explanation: "type.explanation",
        translation: "type.translation", wrong: "type.fix.wrong", correct: "type.fix.correct", title: "type.rule.title", body: "type.rule.body", note: "type.note" };
      label = t(LBL[f] || "type." + f).replace(/\s*:\s*$/, "");
      multi = f === "body";
      get = () => d.fields[f] || "";
      set = v => { ds.forEach(x => { x.fields[f] = v; }); };   // conjugaison : traduction / note communes au tableau
    }
    w.appendChild(el("label", null, label));
    const inp = multi ? el("textarea", "input") : textInput(get(), "", ["translation", "explanation", "hint", "note"].includes(f) ? "" : f.startsWith("x:") ? f.slice(2) : lng);
    if (multi) inp.value = get();
    inp.addEventListener("input", () => set(inp.value));
    inp.addEventListener("click", stop);
    w.appendChild(inp);
  });
  box.appendChild(w);
}
// Crée les cartes d'une proposition dans sa liste. Renvoie { added, dupOnly }.
function pvAcceptNew(p, edited) {
  const listId = p.listId;
  if (!getList(listId)) return { added: 0, dupOnly: true };
  const lg = listLangs(listId);
  const ds = edited || p.cards;
  const have = new Set(cardsOf(listId).map(c => isVocab(c) ? "vocab|" + dupKey(c.terms, lg) : typedKey(c.type, c)));
  const fresh = [];
  let dups = 0, bad = 0;
  ds.forEach(d => {
    let c;
    if (d.type === "vocab") {
      const terms = {}; Object.keys(d.fields.terms || {}).forEach(k => { const v = String(d.fields.terms[k] || "").replace(/\s+/g, " ").trim(); if (v) terms[k] = v; });
      c = newCard(listId, terms, draftExamples(d, lg.target), [], d.fields.pos || {}, lg.target);
    } else c = newTypedCard(listId, d.type, Object.assign({}, d.fields, { lang: d.fields.lang || lg.target }));
    const k = isVocab(c) ? "vocab|" + dupKey(c.terms, lg) : typedKey(c.type, c);
    if (have.has(k)) { dups++; return; }
    if (!cardUsable(c, lg)) { bad++; return; }
    if (d.ruleRef) {
      const r = state.cards.concat(fresh).find(x => x.listId === listId && cardType(x) === "rule" && normText(x.title) === normText(d.ruleRef));
      if (r) c.ruleId = r.id;
    }
    have.add(k);
    fresh.push(c);
  });
  if (bad) return { added: 0, dupOnly: false };            // une case non valide : rien n'est créé, la ligne reste (à modifier)
  state.cards.push(...fresh);
  fresh.forEach(c => { if (isVocab(c)) { state.checkedSig[c.id] = cardSig(c); pvNewIds.push(c.id); } });
  return { added: fresh.length, dupOnly: !fresh.length && dups > 0 };
}

function pvSelected() { return liveProposals().filter(p => pv.sel.has(p.id)); }
function pvSnapshot() {
  return { st: state, cards: JSON.stringify(state.cards), proposals: JSON.stringify(state.proposals),
    rejected: state.rejected.slice(), checkedSig: Object.assign({}, state.checkedSig) };
}

// --- Accepter / Refuser groupés : paquets de CONFIG.PV_CHUNK, reprise possible ---
let pvJob = null;   // traitement en cours { kind, stop }
let pvNewIds = [];  // cartes de vocabulaire créées par « Nouvelle carte » : reliées au dictionnaire commun à la fin (étape 36)
// Reste à faire, gardé sur cet appareil : { kind: "accept"|"reject", ids, edits, total }
function pvJobKey() { return CONFIG.LS_USER_PREFIX + "pvJob:" + (Storage.getUser() || ""); }
function pvJobSaved() {
  try {
    const r = JSON.parse(localStorage.getItem(pvJobKey()) || "null");
    if (!r || !["accept", "reject"].includes(r.kind) || !Array.isArray(r.ids)) return null;
    const live = new Set(state.proposals.map(p => p.id));
    r.ids = r.ids.filter(id => live.has(id));   // déjà traitées (ou supprimées) : ignorées, pas de doublon
    return r.ids.length ? r : null;
  } catch (e) { return null; }
}
function pvJobStore(r) {
  try { if (r && r.ids.length) localStorage.setItem(pvJobKey(), JSON.stringify(r)); else localStorage.removeItem(pvJobKey()); } catch (e) {}
}

function pvAccept() { pvStart("accept"); }
function pvReject() { pvStart("reject"); }
function pvStart(kind) {
  if (pvJob) { toast(t("pv.busy")); return; }
  let sel = pvSelected();
  if (!sel.length) { toast(t("pv.pickOne")); return; }
  // Nouvelles cartes : fiches de règle d'abord (pour relier les textes à trous / phrases à corriger acceptés en même temps)
  if (kind === "accept") {
    const rank = p => p.field === "new" ? pvNewRank(p) : 2;
    sel = sel.map((p, i) => [p, i]).sort((x, y) => rank(x[0]) - rank(y[0]) || x[1] - y[1]).map(x => x[0]);
  }
  const edits = {};
  if (kind === "accept") sel.forEach(p => { if (pv.editing.has(p.id) && pv.edits[p.id] != null) edits[p.id] = pv.edits[p.id]; });
  pvRun(kind, sel.map(p => p.id), edits, pvSnapshot());
}

// snap : état d'avant (bouton « Annuler ») ; null pour une reprise.
async function pvRun(kind, ids, edits, snap) {
  if (pvJob) { toast(t("pv.busy")); return; }
  const st = state, who = Storage.getUser();
  const job = { kind, stop: false };
  pvJob = job;
  let rest = ids.slice();
  const total = rest.length;
  let ok = 0, skipped = 0, n = 0, prog = null;
  pvJobStore({ kind, ids: rest, edits, total });
  renderResumeBars();
  Wake.on();
  if (total > CONFIG.PV_CHUNK) {
    prog = openProgress(t("pv.progressTitle." + kind), t("pv.progress", { i: 0, n: total }),
      [{ label: t("pv.stop"), onClick: () => { job.stop = true; } }]);
  }
  try {
    while (rest.length && !job.stop) {
      if (state !== st || Storage.getUser() !== who) return;   // compte changé entre-temps
      const part = rest.slice(0, CONFIG.PV_CHUNK);
      const r = kind === "accept" ? pvAcceptPart(part, edits) : pvRejectPart(part);
      ok += r.ok; skipped += r.skipped;
      rest = rest.slice(part.length);
      n += part.length;
      state.updatedAt = Date.now();
      Storage.save(state);                                    // paquet enregistré avant le suivant
      QStats.flush();                                         // compteurs du paquet : un seul envoi (mis en attente hors connexion)
      pvJobStore(rest.length ? { kind, ids: rest, edits, total } : null);
      renderPendingBadge();
      if (prog) prog.set(n / total, t("pv.progress", { i: n, n: total }));
      await yieldUI();                                        // l'écran reste fluide
    }
  } finally {
    if (pvJob === job) pvJob = null;
    Wake.off();
    if (prog) prog.close();
  }
  if (state !== st || Storage.getUser() !== who) return;
  if (pvNewIds.length) { const ids = pvNewIds; pvNewIds = []; Dict.afterAdd(ids); }   // dictionnaire commun (étape 36)
  if (ok || skipped) Activity.log("validate", { action: kind, n: ok, skipped });   // journal : une action groupée = un événement
  UserStatus.publish();   // « À valider » en attente : résumé pour les notifications (étape 32)
  Storage.flushNow();
  pvClearSel();
  render();
  const msg = (kind === "accept" ? t("pv.accepted", { n: ok }) + (skipped ? t("pv.skipped", { n: skipped }) : "") : t("pv.rejected", { n: ok }));
  if (rest.length) toast(msg);                // arrêté : bandeau « Reprendre / Abandonner »
  else if (snap) showUndo(msg, snap);
  else toast(msg);
}

// Un paquet d'acceptations (même règles qu'avant). Renvoie { ok, skipped }.
function pvAcceptPart(ids, edits) {
  const want = new Set(ids);
  const sel = state.proposals.filter(p => want.has(p.id));
  const order = new Map(ids.map((id, i) => [id, i]));
  sel.sort((a, b) => order.get(a.id) - order.get(b.id));
  let ok = 0, skipped = 0;
  const done = new Set(), removed = new Set();
  sel.filter(p => p.field === "new").forEach(p => {
    const r = pvAcceptNew(p, edits[p.id] != null ? edits[p.id] : null);
    if (r.added) { ok++; done.add(p.id); QStats.decide(p, "accepted"); }
    else if (r.dupOnly) { skipped++; done.add(p.id); }   // déjà dans la liste : la proposition disparaît
    else skipped++;                                      // non valide : la ligne reste
  });
  const cards = new Map(state.cards.map(c => [c.id, c]));
  sel.filter(p => p.field !== "new").forEach(p => {
    const c = cards.get(p.cardId);
    if (!c || removed.has(c.id)) { done.add(p.id); return; }
    if (p.field === "dup") {
      removed.add(c.id);
      delete state.checkedSig[c.id];
      done.add(p.id); ok++;
      return;
    }
    const edited = edits[p.id] != null;
    let nv = String(edited ? edits[p.id] : p.newValue).replace(/\s+/g, " ").trim();
    if (isPosField(p.field)) nv = parsePos(nv, p.field.slice(4)); // nature non valide : la ligne reste
    const cur = fieldVal(c, p.field);
    const stale = p.type === "completion" ? !!cur.trim() : cur !== p.oldValue; // champ modifié entre-temps : jamais écrasé
    if (stale) { done.add(p.id); skipped++; return; }
    const next = Object.assign({}, c, { terms: Object.assign({}, c.terms), pos: Object.assign({}, c.pos) });   // setFieldVal ne modifie pas examples en place
    setFieldVal(next, p.field, nv);
    if (!nv || !cardUsable(next)) { skipped++; return; } // valeur non valide : la ligne reste
    const snap = Dict.track(c);                          // dictionnaire commun (étape 36)
    setFieldVal(c, p.field, nv);
    Dict.changed(c, snap);                               // case vide du commun → remplie ; déjà remplie → proposition
    c.auto = c.auto.filter(a => a !== autoKeyOf(p.field)); // validé à la main
    if (isVocab(c)) state.checkedSig[c.id] = cardSig(c);
    done.add(p.id); ok++;
    QStats.decide(p, "accepted");                        // suivi admin (proposition venue de la file d'attente)
  });
  if (removed.size) state.cards = state.cards.filter(c => !removed.has(c.id));
  const cardIds = new Set(state.cards.map(c => c.id));
  const listIds = new Set(state.lists.map(l => l.id));
  state.proposals = state.proposals.filter(p => !done.has(p.id) && (p.field === "new" ? listIds.has(p.listId) : cardIds.has(p.cardId)));
  return { ok, skipped };
}

// Un paquet de refus. Renvoie { ok, skipped }.
function pvRejectPart(ids) {
  const want = new Set(ids);
  const sel = state.proposals.filter(p => want.has(p.id));
  const have = new Set(state.rejected);
  sel.forEach(p => {
    const ks = p.field === "new"
      ? p.cards.map(d => rejectKey(p.listId, "new", draftKey(d, listLangs(p.listId))))   // ne sera plus proposée par « Générer »
      : [rejectKey(p.cardId, p.field, p.newValue)];
    ks.forEach(k => { if (!have.has(k)) { have.add(k); state.rejected.push(k); } });
    QStats.decide(p, "rejected");                        // suivi admin (proposition venue de la file d'attente)
  });
  if (state.rejected.length > CONFIG.REJECT_MAX) state.rejected = state.rejected.slice(-CONFIG.REJECT_MAX);
  const done = new Set(sel.map(p => p.id));
  state.proposals = state.proposals.filter(p => !done.has(p.id));
  return { ok: sel.length, skipped: 0 };
}

function pvEdit() {
  const sel = pvSelected().filter(p => p.field !== "dup");
  if (!sel.length) { toast(t("pv.pickOne")); return; }
  sel.forEach(p => { pv.editing.add(p.id); if (pv.edits[p.id] == null) pv.edits[p.id] = p.field === "new" ? JSON.parse(JSON.stringify(p.cards)) : p.newValue; });
  renderPending();
  setTimeout(() => { try { const i = $("#screen-pending .pv-row .input"); if (i) i.focus(); } catch (e) {} }, 50);
}

// Barre « Annuler » : restaure cartes, propositions et refus d'avant l'action groupée.
function showUndo(msg, snap) {
  let bar = $("#undoBar");
  if (!bar) {
    bar = el("div", "undo-bar");
    bar.id = "undoBar";
    bar.append(el("span"), el("button"));
    document.body.appendChild(bar);
  }
  const hide = () => { bar.classList.remove("show"); clearTimeout(undoTimer); };
  bar.firstChild.textContent = msg;
  const btn = bar.lastChild;
  btn.textContent = t("pv.undo");
  btn.onclick = () => {
    hide();
    if (state !== snap.st) return; // compte changé entre-temps
    try {
      state.cards = JSON.parse(snap.cards);
      state.proposals = JSON.parse(snap.proposals);
      state.proposals.forEach(p => { if (p.reqId && QStats.wasCounted(p.id)) p.qc = true; }); // déjà comptée : pas deux fois
      state.rejected = snap.rejected;
      state.checkedSig = snap.checkedSig;
      commit();
      toast(t("pv.undone"));
    } catch (e) {}
  };
  bar.classList.add("show");
  clearTimeout(undoTimer);
  undoTimer = setTimeout(hide, CONFIG.UNDO_MS);
}
