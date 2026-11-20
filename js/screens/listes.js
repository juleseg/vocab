"use strict";

// ====================================================================================================
// js/screens/listes.js — ÉCRAN : LISTES (dossiers, listes, menus, réinitialiser la progression)
// Étape 65 : l'éditeur de carte (ajouter, modifier, déplacer, supprimer une carte) est dans js/screens/listes-cartes.js
// (chargé juste après).
// ====================================================================================================

// === ÉCRAN : LISTES ===
// Vue en cours : listId null = vue d'ensemble (dossiers et listes) ; query = texte de recherche ;
// reorder = mode « Réorganiser » (boutons ↑ ↓ sur les dossiers et les listes).
// Dossiers repliables (état gardé sur l'appareil : localStorage "vocabfr.collapsed:<identifiant>").
// Sur ordinateur : glisser une liste sur un dossier (ou sur « Sans dossier ») pour l'y déplacer.
const lv = { listId: null, query: "", reorder: false };

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
// Texte comparable : minuscules, sans accents, espaces simplifiés (le coréen reste intact).
function normText(s) {
  return String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").normalize("NFC")
    .toLowerCase().replace(/\s+/g, " ").trim();
}
// Doublon = même mot dans la langue apprise ET même traduction dans la première langue d'appui remplie.
// Ainsi « voler / 날다 » et « voler / 훔치다 » restent deux cartes distinctes.
// terms : { code: texte } ; lg : langues de la liste.
function dupKey(terms, lg) {
  const f = normText(terms[lg.target]).split("/").map(x => x.trim()).filter(Boolean).join("/");
  const s = lg.support.find(code => normText(terms[code]));
  return f + "|" + (s ? s + ":" + normText(terms[s]) : "");
}
function getList(id) { return state.lists.find(l => l.id === id) || null; }
function cardsOf(listId) { return state.cards.filter(c => c.listId === listId); }
function parseTags(s) { return String(s || "").split(",").map(x => x.trim()).filter(Boolean); }
function cardMatches(c, q) {
  return normText(cardSearchText(c) + " " + c.tags.join(" ")).includes(q);
}
// À réviser : une unité par langue étudiée (étape 37) ; vue de statistiques (Leitner.unit) : sa seule langue.
function dueCount(cards, now) { now = now || Date.now(); return cards.reduce((n, c) => n + (Leitner.isUnit(c) ? (Leitner.isDue(c, now) ? 1 : 0) : Leitner.dueLangs(c, now).length), 0); }
// À réviser par langue étudiée : { <langue>: n }.
function dueByLang(cards, now) {
  now = now || Date.now();
  const o = {};
  cards.forEach(c => Leitner.dueLangs(c, now).forEach(L => { o[L] = (o[L] || 0) + 1; }));
  return o;
}

// --- Dossiers repliés (sur cet appareil) ---
function collapsedKey() { return CONFIG.LS_USER_PREFIX + "collapsed:" + (Storage.getUser() || ""); }
function getCollapsed() { try { return new Set(JSON.parse(localStorage.getItem(collapsedKey()) || "[]")); } catch (e) { return new Set(); } }
function toggleCollapsed(id) {
  const s = getCollapsed();
  if (s.has(id)) s.delete(id); else s.add(id);
  try { localStorage.setItem(collapsedKey(), JSON.stringify([...s])); } catch (e) {}
}
const canDrag = (() => { try { return window.matchMedia("(hover: hover) and (pointer: fine)").matches; } catch (e) { return false; } })();

function renderLists() {
  if (lv.listId && !getList(lv.listId)) lv.listId = null;
  const list = lv.listId ? getList(lv.listId) : null;
  $("#lvTop").hidden = !list;
  $("#lvTitleRow").hidden = !list;
  $("#lvLinks").hidden = !list;
  $("#lvMore").hidden = !!list;
  $("#lvBack").textContent = "‹ " + t("nav.lists");
  $("#lvTitle").textContent = list ? list.name : "";
  $("#lvSub").textContent = list ? (getFolder(list.folderId) ? "▸ " + getFolder(list.folderId).name + " · " : "") + pairLabel(listLangs(list))
    + studyExtraLangs(list).map(L => " +" + L.toUpperCase()).join("") + " · " + updDate(list.lastUpdate)
    + (isSharedList(list) ? " · " + shTag(list) : "") : "";
  if (list) { const g = listGapCount(list); $("#lvUpdate").textContent = g ? t("upd.btnN", { n: g }) : t("upd.btn"); }
  if (list) { const n = storiesOf(list.id).length; $("#lvStories").textContent = n ? t("st.listBtnN", { n }) : t("st.listBtn"); }   // étape 45
  $("#lvAsk").hidden = $("#lvAskAll").hidden = !Queue.usable();
  // Listes communes (étape 30) : lecture seule = pas d'ajout ni de mise à jour ; nom et langues : propriétaire seulement.
  const shL = list && isSharedList(list), ro = !!list && !canEditList(list);
  $("#lvShare").textContent = t(shL ? "sh.manageBtn" : "sh.share");
  $("#lvRename").hidden = $("#lvLangs").hidden = !!shL && !shIsOwner(list);
  const imgBtn = $("#lvImages");   // réglage « Images » de la liste (étape 49)
  if (imgBtn) { imgBtn.hidden = !(list && typeof Images !== "undefined" && Images.on()); if (list) imgBtn.textContent = t("img.side.btn", { v: imgSideLabel(list) }); }
  if (list && typeof audListLabel === "function") $("#lvAudio").textContent = t("aud.list.btn", { v: audListLabel(list) });   // étape 55
  $("#lvUpdate").hidden = $("#lvFxOut").hidden = $("#lvFxIn").hidden = ro;
  { const gb = $("#lvGender"), gn = list && !ro ? genderMissingCount(list.id) : 0;   // « Compléter le genre (N) » (étape 60)
    gb.hidden = !gn; if (gn) gb.textContent = t("gd.menu", { n: gn }); }
  if (ro) $("#lvAsk").hidden = true;
  $("#lvActions").hidden = ro;
  $("#lvDelete").textContent = t(shL && !shIsOwner(list) ? "sh.leave" : "lists.delete");
  $("#lvReorder").textContent = t(lv.reorder ? "folders.reorderDone" : "folders.reorder");
  const search = $("#lvSearch");
  search.placeholder = t("lists.search");
  if (document.activeElement !== search) search.value = lv.query;
  $("#lvAdd").textContent = t(list ? "card.add" : "lists.new");

  const box = $("#lvContent");
  box.textContent = "";
  const q = normText(lv.query);

  // Vue d'ensemble : dossiers puis listes sans dossier
  if (!list && !q) {
    if (!state.lists.length && !state.folders.length) { box.appendChild(el("div", "empty", t("lists.empty"))); return; }
    const now = Date.now();
    const collapsed = getCollapsed();
    const folders = sortedFolders();
    folders.forEach((f, i) => box.appendChild(folderSection(f, i, folders.length, collapsed.has(f.id), now)));
    const loose = listsIn(null);
    if (loose.length || folders.length) {
      const sec = el("div", "fd-sec");
      if (folders.length) {
        const hd = el("div", "fd-head fd-none");
        hd.appendChild(el("div", "fd-name", t("folders.none")));
        sec.appendChild(hd);
        dropTarget(hd, null);
      }
      if (loose.length) sec.appendChild(listItems(loose, now));
      else sec.appendChild(el("div", "fd-empty", t("folders.noLists")));
      box.appendChild(sec);
    }
    return;
  }

  // Cartes : d'une liste, ou résultats de recherche dans toutes les listes
  let cards = list ? cardsOf(list.id) : state.cards;
  if (q) cards = cards.filter(c => cardMatches(c, q));
  if (!cards.length) { box.appendChild(el("div", "empty", t(q ? "lists.noResults" : "lists.noCards"))); return; }
  const wrap = el("div", "items");
  cards.forEach(c => wrap.appendChild(cardItem(c, !list)));
  box.appendChild(wrap);
}

// Un dossier : en-tête (repli, nombre de listes / cartes / à réviser, menu ⋯ ou ↑ ↓), puis ses listes.
function folderSection(f, idx, total, isCollapsed, now) {
  const lists = listsIn(f.id);
  const ids = new Set(lists.map(l => l.id));
  const cards = state.cards.filter(c => ids.has(c.listId));
  const sec = el("div", "fd-sec");
  const hd = el("div", "fd-head");
  const tg = el("button", "fd-toggle");
  tg.setAttribute("aria-expanded", String(!isCollapsed));
  const nm = el("div", "fd-name");
  nm.append(el("span", "fd-caret", isCollapsed ? "▸" : "▾"), document.createTextNode(f.name));
  if (isSharedFolder(f)) nm.append(document.createTextNode(" "), el("span", "sh-mark", "👥"));
  const fb = updBadge(folderGapCount(f));
  if (fb) nm.append(document.createTextNode(" "), fb);
  const meta = el("div", "fd-meta", t("folders.meta", { l: lists.length, c: cards.length, d: dueCount(cards, now) }) + " · " + pairLabel(folderLangs(f)) + studyFolderExtra(f)
    + (isSharedFolder(f) ? " · " + shTag(f) : ""));
  tg.append(nm, meta);
  tg.addEventListener("click", () => { toggleCollapsed(f.id); renderLists(); });
  hd.appendChild(tg);
  if (lv.reorder) hd.appendChild(orderBtns(sortedFolders(), idx, total));
  else {
    const mb = el("button", "fd-menu", "⋯");
    mb.setAttribute("aria-label", t("folders.menu"));
    mb.addEventListener("click", () => openFolderMenu(f.id));
    hd.appendChild(mb);
  }
  sec.appendChild(hd);
  dropTarget(hd, f.id);
  if (!isCollapsed) sec.appendChild(lists.length ? listItems(lists, now) : el("div", "fd-empty", t("folders.noLists")));
  return sec;
}

function listItems(lists, now) {
  const wrap = el("div", "items");
  lists.forEach((l, i) => {
    const cards = cardsOf(l.id);
    const b = el("div", "item");
    b.setAttribute("role", "button"); b.tabIndex = 0;
    const m = el("div", "main");
    const due = dueCount(cards, now);
    const t1 = el("div", "t1", l.name);
    const lb = updBadge(listGapCount(l));
    if (lb) t1.append(document.createTextNode(" "), lb);
    const fl = isSharedList(l) ? Shared.flagCount(l.id) : 0;
    if (fl) t1.append(document.createTextNode(" "), el("span", "sh-flag", "✎ " + fl));
    m.append(t1,
      el("div", "t2", t("lists.count", { n: cards.length }) + (due ? " · " + t("lists.due", { n: due }) : "") + " · " + pairLabel(listLangs(l))));
    const sp = studyLangsNode(l, cards, now);   // langues étudiées : à réviser / à compléter par langue (étape 37)
    if (sp) m.appendChild(sp);
    if (isSharedList(l)) m.appendChild(el("div", "t2 sh-line", shTag(l)));
    b.appendChild(m);
    if (lv.reorder) b.appendChild(orderBtns(lists, i, lists.length));
    else {
      b.appendChild(el("span", "chev", "›"));
      b.addEventListener("click", () => openListView(l.id));
      b.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openListView(l.id); } });
      if (canDrag) {
        b.draggable = true;
        b.addEventListener("dragstart", e => { try { e.dataTransfer.setData("text/plain", "list:" + l.id); e.dataTransfer.effectAllowed = "move"; } catch (err) {} b.classList.add("dragging"); });
        b.addEventListener("dragend", () => b.classList.remove("dragging"));
      }
    }
    wrap.appendChild(b);
  });
  return wrap;
}

// Zone de dépôt (ordinateur) : une liste glissée ici passe dans ce dossier (null = sans dossier), en dernière position.
function dropTarget(node, folderId) {
  if (!canDrag) return;
  node.addEventListener("dragover", e => { e.preventDefault(); node.classList.add("drop-over"); });
  node.addEventListener("dragleave", () => node.classList.remove("drop-over"));
  node.addEventListener("drop", e => {
    e.preventDefault(); node.classList.remove("drop-over");
    let v = "";
    try { v = e.dataTransfer.getData("text/plain") || ""; } catch (err) {}
    if (v.startsWith("list:")) moveListTo(v.slice(5), folderId);
  });
}

// Boutons ↑ ↓ du mode « Réorganiser ». items : éléments dans l'ordre affiché (dossiers ou listes d'un même groupe).
function orderBtns(items, idx, total) {
  const w = el("div", "ord-btns");
  [["↑", -1], ["↓", 1]].forEach(([s, d]) => {
    const b = el("button", "ord-btn", s);
    b.disabled = idx + d < 0 || idx + d >= total;
    b.setAttribute("aria-label", t(d < 0 ? "folders.up" : "folders.down"));
    b.addEventListener("click", e => { e.stopPropagation(); moveOrder(items, idx, d); });
    w.appendChild(b);
  });
  return w;
}
function moveOrder(items, idx, d) {
  const a = items.slice();
  const j = idx + d;
  if (j < 0 || j >= a.length) return;
  [a[idx], a[j]] = [a[j], a[idx]];
  a.forEach((x, i) => { x.order = i; });
  commit();
}
// Déplace une liste dans un dossier (null = sans dossier), en dernière position. Cartes et progression inchangées.
function moveListTo(listId, folderId) {
  const l = getList(listId);
  if (!l || (l.folderId || null) === (folderId || null)) return;
  const before = unusableIds();
  l.folderId = folderId || null;
  l.order = nextOrder(listsIn(folderId).filter(x => x !== l));
  commit();
  warnUnusable(before);
  toast(t("folders.moved", { name: l.name, folder: folderId ? getFolder(folderId).name : t("folders.none") }));
}

function cardItem(c, showList) {
  if (!isVocab(c)) return typedCardItem(c, showList);
  const lg = cardLangs(c);
  const b = el("button", "item");
  const m = el("div", "main");
  const t1 = el("div", "t1", targetTerm(c, lg) || "—"); t1.lang = lg.target;
  genderMark(t1, c, lg.target);   // genre des noms (étape 60)
  const tp = posTag(c, lg.target);
  if (tp) t1.appendChild(tp);
  m.appendChild(t1);
  const sup = supportTerms(c, lg);
  if (sup.length) {
    const t2 = el("div", "t2");
    sup.forEach((x, i) => {
      if (i) t2.appendChild(document.createTextNode(" · "));
      const sp = el("span", null, x.text); sp.lang = x.code;
      const p = posTag(c, x.code);
      if (p) sp.appendChild(p);
      t2.appendChild(sp);
    });
    m.appendChild(t2);
  }
  const stMiss = [];
  studyExtraLangs(c.listId).forEach(L => {         // autres langues étudiées de la liste (étape 37)
    const w = term(c, L);
    if (!w) { stMiss.push(L); return; }
    const t3 = el("div", "t2 study-word", L.toUpperCase() + " · " + w); t3.lang = L;
    genderMark(t3, c, L);
    const p = posTag(c, L);
    if (p) t3.appendChild(p);
    m.appendChild(t3);
  });
  const extra = el("div");
  if (showList) { const l = getList(c.listId); if (l) extra.appendChild(el("span", "tag", "▸ " + l.name)); }
  const miss = missingSupport(c, lg).concat(stMiss);  // traduction manquante dans une langue d'appui (étape 31) ou étudiée (étape 37)
  if (miss.length) extra.appendChild(el("span", "tag warn", t("card.toFill", { langs: miss.map(x => langName(x)).join(", ") })));
  shFlagTag(c, extra);
  { const gm = genderMissingTag(c); if (gm && canEditList(c.listId)) extra.appendChild(gm); }   // « Genre manquant » (étape 60)
  DictConf.tag(c, extra);   // « Ce mot existe déjà dans le dictionnaire autrement » (faux doublon, étape 63)
  HardUI.tags(c, extra);   // « Mot difficile » / « En pause » (étape 57)
  c.tags.forEach(tg => extra.appendChild(el("span", "tag", "#" + tg)));
  if (extra.childNodes.length) m.appendChild(extra);
  const im = typeof Images !== "undefined" ? Images.info(c) : null;   // vignette de l'image (étape 49) : toucher = agrandir
  if (im) b.appendChild(Images.node(im, { cls: "ci-thumb", lazy: true }));
  b.append(m, el("span", "chev", "›"));
  b.addEventListener("click", () => openCardEditor(c.id));
  return b;
}
// Carte d'une liste commune modifiée par quelqu'un d'autre (étape 30) : petite marque discrète.
function shFlagTag(c, box) {
  const f = Shared.flagOf(c.id);
  if (f) { const s = el("span", "tag sh-flag", "✎ " + f.by); s.title = t("sh.flagTitle", { id: f.by }); box.appendChild(s); }
}

// Carte d'un autre type dans une liste : badge du type, titre court, réponse en dessous.
function typedCardItem(c, showList) {
  const b = el("button", "item");
  const m = el("div", "main");
  const t1 = el("div", "t1"); t1.lang = c.lang;
  t1.append(typeBadge(c.type), document.createTextNode(cardTitle(c)));
  m.appendChild(t1);
  const sub = cardSubtitle(c);
  if (sub) { const t2 = el("div", "t2", sub); t2.lang = c.lang; m.appendChild(t2); }
  const extra = el("div");
  if (showList) { const l = getList(c.listId); if (l) extra.appendChild(el("span", "tag", "▸ " + l.name)); }
  if (!typedUsable(c)) extra.appendChild(el("span", "tag warn", t("type.incomplete")));
  shFlagTag(c, extra);
  HardUI.tags(c, extra);   // « Mot difficile » / « En pause » (étape 57)
  c.tags.forEach(tg => extra.appendChild(el("span", "tag", "#" + tg)));
  if (extra.childNodes.length) m.appendChild(extra);
  b.append(m, el("span", "chev", "›"));
  b.addEventListener("click", () => openCardEditor(c.id));
  return b;
}

function openListView(id) {
  lv.listId = id; lv.query = ""; lv.reorder = false;
  renderLists();
  window.scrollTo(0, 0);
}

function initLists() {
  $("#lvBack").addEventListener("click", () => openListView(null));
  $("#lvSearch").addEventListener("input", e => { lv.query = e.target.value; renderLists(); });
  $("#lvAdd").addEventListener("click", () => { if (lv.listId) openCardEditor(null, lv.listId); else openListName(null); });
  $("#lvBulk").addEventListener("click", () => {
    const l = lv.listId ? getList(lv.listId) : null;
    openBulkImport({ text: "", target: l ? l.id : "__new__", newName: "", folder: l ? (l.folderId || "") : "" });
  });
  $("#lvGen").addEventListener("click", () => openGenerate(lv.listId || null));
  $("#lvRename").addEventListener("click", () => openListName(lv.listId));
  $("#lvMove").addEventListener("click", () => openMoveList(lv.listId));
  $("#lvLangs").addEventListener("click", () => { const l = getList(lv.listId); if (l) openLangEditor("list", l); });
  $("#lvImages").addEventListener("click", () => { if (lv.listId) openImgSide(lv.listId); });   // étape 49
  $("#lvAudio").addEventListener("click", () => { if (lv.listId) openAudList(lv.listId); });   // apprentissage auditif (étape 55)
  $("#lvStudy").addEventListener("click", () => { if (lv.listId) openStudyLangs("list", lv.listId); });   // étape 37
  $("#lvStoryNew").addEventListener("click", () => { if (lv.listId) openStoryCreate(lv.listId); });   // étape 45
  $("#lvStories").addEventListener("click", () => { if (lv.listId) goStories(lv.listId); });
  $("#lvReset").addEventListener("click", () => { if (lv.listId) openResetProgress("list", lv.listId); });   // étape 47
  $("#lvDelete").addEventListener("click", () => confirmDeleteList(lv.listId));
  $("#lvShare").addEventListener("click", () => { const l = getList(lv.listId); if (!l) return; if (isSharedList(l)) openShareManage("list", l.id); else openShare("list", l.id); });
  $("#lvNewFolder").addEventListener("click", () => openFolderName(null));
  $("#lvReorder").addEventListener("click", () => { lv.reorder = !lv.reorder; renderLists(); });
  $("#lvUpdate").addEventListener("click", () => { if (lv.listId) openUpdate({ kind: "list", id: lv.listId }); });
  $("#lvUpdateAll").addEventListener("click", () => openUpdate({ kind: "all" }));
  $("#lvGender").addEventListener("click", () => { const l = getList(lv.listId); if (l) genderOffer(state.cards.filter(c => c.listId === l.id), l.name); });   // étape 60
  $("#lvAsk").addEventListener("click", () => { if (lv.listId) openAskClaude({ kind: "list", id: lv.listId }); });
  $("#lvAskAll").addEventListener("click", () => openAskClaude({ kind: "all" }));
  $("#lvFxOut").addEventListener("click", () => { if (lv.listId) openFxExport("list:" + lv.listId); });
  $("#lvFxIn").addEventListener("click", openFxImport);
  $("#lvFxOutAll").addEventListener("click", () => openFxExport("all"));
  $("#lvFxInAll").addEventListener("click", openFxImport);
}

// --- Petits constructeurs de formulaire ---
function formField(labelText, input, required, hint) {
  const f = el("div", "field");
  const lab = el("label", null, labelText);
  if (required) lab.appendChild(el("span", "req", " *"));
  f.append(lab, input);
  if (hint) f.appendChild(el("div", "hint", hint));
  return f;
}
function textInput(value, placeholder, lang) {
  const i = el("input", "input");
  i.type = "text"; i.value = value || ""; i.autocomplete = "off";
  if (placeholder) i.placeholder = placeholder;
  if (lang) i.lang = lang;
  return i;
}
// Listes groupées par dossier (ordre d'affichage) ; withNew : option « + Nouvelle liste ».
function listSelect(selectedId, withNew) {
  const s = el("select", "input");
  const add = (parent, l) => { const o = el("option", null, l.name); o.value = l.id; parent.appendChild(o); };
  const folders = sortedFolders();
  const editable = fid => listsIn(fid).filter(l => canEditList(l) || l.id === selectedId);   // listes communes en lecture seule exclues (étape 30)
  folders.forEach(f => {
    const ls = editable(f.id);
    if (!ls.length) return;
    const g = el("optgroup"); g.label = f.name;
    ls.forEach(l => add(g, l));
    s.appendChild(g);
  });
  const loose = editable(null);
  if (loose.length) {
    if (folders.length) { const g = el("optgroup"); g.label = t("folders.none"); loose.forEach(l => add(g, l)); s.appendChild(g); }
    else loose.forEach(l => add(s, l));
  }
  if (withNew) { const o = el("option", null, t("bulk.newList")); o.value = "__new__"; s.appendChild(o); }
  if (selectedId && (selectedId === "__new__" ? withNew : getList(selectedId))) s.value = selectedId;
  return s;
}
// Dossiers ("" = sans dossier) ; withNew : option « + Nouveau dossier ».
function folderSelect(selectedId, withNew) {
  const s = el("select", "input");
  const o0 = el("option", null, t("folders.none")); o0.value = ""; s.appendChild(o0);
  sortedFolders().forEach(f => { const o = el("option", null, f.name); o.value = f.id; s.appendChild(o); });
  if (withNew) { const o = el("option", null, t("folders.newOption")); o.value = "__new__"; s.appendChild(o); }
  s.value = selectedId && (selectedId === "__new__" || getFolder(selectedId)) ? selectedId : "";
  return s;
}

// --- Langues : apprise + d'appui (compte, dossier ou liste) ---
// Dossier / liste : « Utiliser le réglage du compte / du dossier » (héritage) ou réglage propre.
function cardsUnder(kind, obj) {
  if (kind === "list") return cardsOf(obj.id);
  if (kind === "folder") { const ids = new Set(listsIn(obj.id).map(l => l.id)); return state.cards.filter(c => ids.has(c.listId)); }
  return state.cards;
}
function unusableIds() { return new Set(state.cards.filter(c => !cardUsable(c)).map(c => c.id)); }
// Après un changement de langue : cartes qui n'ont pas de mot dans la nouvelle langue apprise (pas proposées en révision).
function warnUnusable(before) {
  const n = state.cards.filter(c => !before.has(c.id) && !cardUsable(c)).length;
  if (n) setTimeout(() => toast(t("langs.unusable", { n })), 2300);
}
// Menu « langue apprise » : langues du profil d'abord, puis les autres (une autre langue est ajoutée au profil à
// l'enregistrement, sans langue d'appui : ensureLearning, étape 35).
function targetSelect(value, onChange) {
  const prof = learningOf().map(x => x.lang);
  const s = el("select", "input");
  const add = (parent, c) => { const o = el("option", null, langName(c)); o.value = c; parent.appendChild(o); };
  prof.forEach(c => add(s, c));
  const others = LANG_CODES.filter(c => !prof.includes(c));
  if (others.length) { const g = el("optgroup"); g.label = t("prof.otherLangs"); others.forEach(c => add(g, c)); s.appendChild(g); }
  s.value = value;
  s.addEventListener("change", () => onChange(s.value));
  return s;
}
// Langues affichées (lecture seule) : « Italien · Français · Anglais ».
function shownLangsInfo(lg, hint) {
  return formField(t("prof.shown"), el("div", "lang-ro", visibleLangs(lg).map(x => langName(x)).join(" · ")), false, hint || "");
}
// Choix de la langue apprise (nouvelle liste de l'import) ; onChange(target, support) : langues affichées calculées.
function langPicker(target, support, onChange) {
  const wrap = el("div");
  wrap.appendChild(formField(t("langs.target"), targetSelect(target, code => onChange(code, langsFor(code).support))));
  wrap.appendChild(shownLangsInfo(langsFor(target), t("prof.shownHint")));
  return wrap;
}
// Langue apprise d'un dossier / d'une liste (héritage possible) ; liste : langue d'appui propre (remplace celle du profil
// ou la retire). Les réglages du compte (profil) sont dans Réglages → Langues.
function openLangEditor(kind, obj) {
  if (kind === "account") { openProfileAdd(); return; }
  const parent = kind === "list" ? folderLangs(getFolder(obj.folderId)) : accountLangs();
  let inherit = !isLang(obj.target);
  let target = (kind === "list" ? listLangs(obj) : folderLangs(obj)).target;
  const ov0 = supportOverride(obj);
  let sup = kind === "list" ? (ov0 === undefined ? "__profile__" : ov0 === null ? "" : ov0) : "__profile__";
  const wrap = el("div");
  const draw = () => {
    wrap.textContent = "";
    wrap.appendChild(el("p", "muted", t(kind === "list" ? "langs.forList" : "langs.forFolder", { name: obj.name })));
    const lab = el("label", "check-row");
    const cb = el("input"); cb.type = "checkbox"; cb.checked = inherit;
    cb.addEventListener("change", () => { inherit = cb.checked; if (inherit) target = parent.target; draw(); });
    lab.append(cb, document.createTextNode(t(kind === "list" && obj.folderId ? "langs.inheritFolder" : "langs.inheritAccount", { pair: langName(parent.target) })));
    wrap.appendChild(lab);
    const tg = inherit ? parent.target : target;
    if (!inherit) wrap.appendChild(formField(t("langs.target"), targetSelect(target, v => { target = v; if (sup === v) sup = "__profile__"; draw(); })));
    if (kind === "list") {
      const ps = profileSupport(tg);
      const s = el("select", "input");
      const opt = (v, l) => { const o = el("option", null, l); o.value = v; s.appendChild(o); };
      opt("__profile__", t("prof.likeProfile", { lang: ps ? langName(ps) : t("prof.none") }));
      LANG_CODES.filter(c => c !== tg).forEach(c => opt(c, langName(c)));
      opt("", t("prof.none"));
      s.value = sup;
      s.addEventListener("change", () => { sup = s.value; draw(); });
      wrap.appendChild(formField(t("prof.support"), s, false, t("prof.listSupportHint")));
    }
    const appui = sup === "__profile__" ? undefined : (sup || null);
    const lg = { target: tg, support: supportLangs(tg, null, appui) };
    wrap.appendChild(shownLangsInfo(lg));
    if (!lg.support.length) wrap.appendChild(el("div", "hint", t("prof.noSupportWarn")));
    const n = cardsUnder(kind, obj).filter(c => isVocab(c) && !term(c, tg).trim()).length;
    if (n) wrap.appendChild(el("div", "hint", t("langs.missing", { n, lang: langName(tg) })));
  };
  draw();
  openModal(t("langs.title"), wrap, [
    { label: t("cancel") },
    { label: t("save"), kind: "primary", onClick: () => {
      const before = unusableIds();
      if (inherit) delete obj.target;
      else { obj.target = target; ensureLearning(target); }
      if (kind === "list") { if (sup === "__profile__") delete obj.support; else obj.support = sup || null; }
      commit();
      warnUnusable(before);
    } }
  ]);
}

// --- Dossiers : créer, renommer, menu, supprimer ---
function openFolderName(id, onCreated) {
  const f = id ? getFolder(id) : null;
  const inp = textInput(f ? f.name : "", "");
  const wrap = el("div");
  wrap.appendChild(formField(t("folders.name"), inp, true));
  openModal(t(f ? "folders.renameTitle" : "folders.new"), wrap, [
    { label: t("cancel") },
    { label: t("save"), kind: "primary", onClick: () => {
      const name = inp.value.trim();
      if (!name) { toast(t("folders.nameRequired")); return false; }
      if (f) f.name = name;
      else {
        const nf = { id: uid(), name, order: nextOrder(state.folders) };
        state.folders.push(nf);
        if (onCreated) { onCreated(nf); return; }
      }
      commit();
    } }
  ]);
  setTimeout(() => { try { inp.focus(); } catch (e) {} }, 50);
}
function openFolderMenu(id) {
  const f = getFolder(id);
  if (!f) return;
  const lists = listsIn(id);
  const n = state.cards.filter(c => lists.some(l => l.id === c.listId)).length;
  const p = el("div");
  p.appendChild(el("p", "muted", t("folders.meta", { l: lists.length, c: n, d: dueCount(state.cards.filter(c => lists.some(l => l.id === c.listId))) }) + " · " + pairLabel(folderLangs(f))));
  const fb = updBadge(folderGapCount(f));
  if (fb) p.appendChild(fb);
  p.appendChild(el("div", "upd-last", updDate(f.lastUpdate)));
  if (isSharedFolder(f)) p.appendChild(el("div", "upd-last", shTag(f)));
  // Dossier commun (étape 30) : membre en lecture seule = pas de mise à jour ; nom et langues : propriétaire seulement.
  const shF = isSharedFolder(f), roF = shF && f.shared.role === "read", notOwner = shF && !shIsOwner(f);
  openModal(f.name, p, [
    { label: t(shF ? "sh.manageBtn" : "sh.share"), onClick: () => { if (shF) openShareManage("folder", id); else openShare("folder", id); } },
    roF ? null : { label: t("upd.btn"), onClick: () => { openUpdate({ kind: "folder", id }); } },
    roF ? null : { label: t("fx.exportBtn"), onClick: () => { openFxExport("folder:" + id); } },
    roF ? null : { label: t("ai.importReply"), onClick: () => { openFxImport(); } },
    notOwner ? null : { label: t("folders.rename"), onClick: () => { openFolderName(id); } },
    notOwner ? null : { label: t("folders.langs"), onClick: () => { openLangEditor("folder", f); } },
    { label: t("study.addFolder"), onClick: () => { openStudyLangs("folder", id); } },   // étape 37 (libellé : étape 52, complément)
    { label: t("fsrs.reset"), onClick: () => { openResetProgress("folder", id); } },   // étape 47
    { label: t(notOwner ? "sh.leaveFolder" : "folders.delete"), kind: "danger", onClick: () => { confirmDeleteFolder(id); } },
    { label: t("cancel") }
  ].filter(Boolean));
}
// === RÉINITIALISER LA PROGRESSION (ÉTAPE 47) ===
// Menu d'une liste (#lvReset) ou d'un dossier : choix de la langue étudiée (ou toutes), confirmation avec le nombre de cartes
// concernées (déjà révisées dans cette langue), puis Leitner.reset (boîte, date, stats et champs FSRS à zéro, lb gardé).
// Les autres langues ne bougent pas. Listes communes : seulement ma progression (le contenu des cartes ne change pas),
// même en lecture seule. L'historique, la série, l'XP et les défis ne changent pas.
function resetScopeCards(kind, id) {
  const ids = new Set(studyScopeLists(kind, id).map(l => l.id));
  return state.cards.filter(c => ids.has(c.listId));
}
// Langues proposées : langues étudiées des listes du périmètre + langue des cartes d'autres types, dans l'ordre de LANGUAGES.
function resetLangs(kind, id) {
  const set = new Set();
  studyScopeLists(kind, id).forEach(l => studyLangs(l).forEach(L => set.add(L)));
  resetScopeCards(kind, id).forEach(c => { if (!isVocab(c)) set.add(primaryLang(c)); });
  return LANG_CODES.filter(L => set.has(L));
}
function resetCount(cards, L) { return cards.filter(c => Leitner.hasProgress(c, L || null)).length; }
function openResetProgress(kind, id) {
  const obj = studyScopeObj(kind, id);
  if (!obj) return;
  const lists = studyScopeLists(kind, id);
  if (kind === "folder" && !lists.length) { toast(t("folders.noLists")); return; }
  const cards = resetScopeCards(kind, id), langs = resetLangs(kind, id);
  if (!cards.some(c => Leitner.hasProgress(c, null))) { toast(t("fsrs.resetNone")); return; }
  if (langs.length < 2) { confirmResetProgress(kind, id, langs[0] || null); return; }
  const wrap = el("div");
  wrap.appendChild(el("p", "muted", t("fsrs.resetPick")));
  const opts = el("div", "fs-reset-langs");
  [""].concat(langs).forEach(L => {
    const n = resetCount(cards, L);
    const b = el("button", "btn", (L ? langName(L) : t("fsrs.resetAll")) + " · " + t("fsrs.resetN", { n }));
    b.type = "button";
    b.disabled = !n;
    b.addEventListener("click", () => { close(); confirmResetProgress(kind, id, L || null); });
    opts.appendChild(b);
  });
  wrap.appendChild(opts);
  const close = openModal(t("fsrs.resetTitle", { name: obj.name }), wrap, [{ label: t("cancel") }]);
}
function confirmResetProgress(kind, id, L) {
  const obj = studyScopeObj(kind, id);
  if (!obj) return;
  const cards = resetScopeCards(kind, id), n = resetCount(cards, L);
  if (!n) { toast(t("fsrs.resetNone")); return; }
  const p = el("div");
  p.appendChild(el("p", null, t(L ? "fsrs.resetAskLang" : "fsrs.resetAskAll", { n, name: obj.name, lang: L ? langName(L) : "" })));
  p.appendChild(el("p", "hint", t("fsrs.resetKeep")));
  if (studyScopeLists(kind, id).some(isSharedList)) p.appendChild(el("p", "q-note", t("fsrs.resetShared")));
  openModal(t("fsrs.resetTitle", { name: obj.name }), p, [
    { label: t("cancel") },
    { label: t("fsrs.resetBtn"), kind: "danger", onClick: () => {
      const now = Date.now();
      let done = 0;
      cards.forEach(c => { if (Leitner.reset(c, L ? [L] : null, now)) done++; });
      commit();
      toast(t("fsrs.resetDone", { n: done }));
    } }
  ]);
}

// === ÉCRAN : LISTES — DOSSIERS ET LISTES : SUPPRIMER, CRÉER, RENOMMER, DÉPLACER ===
// Supprimer un dossier : au choix, supprimer ses listes (et leurs cartes) ou les sortir du dossier.
function confirmDeleteFolder(id) {
  const f = getFolder(id);
  if (!f) return;
  if (isSharedFolder(f)) { openShareManage("folder", id); return; }   // dossier commun : supprimer / quitter (étape 30)
  const lists = listsIn(id);
  const ids = new Set(lists.map(l => l.id));
  const n = state.cards.filter(c => ids.has(c.listId)).length;
  const drop = () => {
    state.folders = state.folders.filter(x => x.id !== id);
    sortedFolders().forEach((x, i) => { x.order = i; });
  };
  if (!lists.length) {
    openModal(t("folders.delete"), el("p", null, t("folders.deleteEmpty", { name: f.name })), [
      { label: t("cancel") },
      { label: t("delete"), kind: "danger", onClick: () => { drop(); commit(); } }
    ]);
    return;
  }
  openModal(t("folders.delete"), el("p", null, t("folders.deleteAsk", { name: f.name, l: lists.length, c: n })), [
    { label: t("folders.keepLists"), kind: "primary", onClick: () => {
      const before = unusableIds();
      let o = nextOrder(listsIn(null));
      lists.forEach(l => { l.folderId = null; l.order = o++; });
      drop(); commit(); warnUnusable(before);
    } },
    { label: t("folders.deleteLists", { l: lists.length, c: n }), kind: "danger", onClick: () => {
      openModal(t("folders.delete"), el("p", null, t("folders.deleteListsConfirm", { name: f.name, l: lists.length, c: n })), [
        { label: t("cancel") },
        { label: t("delete"), kind: "danger", onClick: () => {
          // Listes communes (étape 30) : jamais supprimées ici, sorties du dossier (supprimer / quitter : menu Partage).
          const keepSh = lists.filter(isSharedList);
          let o = nextOrder(listsIn(null));
          keepSh.forEach(l => { ids.delete(l.id); l.folderId = null; l.order = o++; });
          state.lists = state.lists.filter(l => !ids.has(l.id));
          state.cards = state.cards.filter(c => !ids.has(c.listId));
          drop(); commit();
          if (keepSh.length) toast(t("sh.keptOut", { n: keepSh.length }));
        } }
      ]);
    } },
    { label: t("cancel") }
  ]);
}

// --- Listes : créer (avec dossier), renommer, déplacer, supprimer ---
function openListName(id) {
  const l = id ? getList(id) : null;
  const inp = textInput(l ? l.name : "", "");
  const wrap = el("div");
  wrap.appendChild(formField(t("lists.name"), inp, true));
  const fsel = l ? null : folderSelect("", false);
  if (fsel) wrap.appendChild(formField(t("folders.folder"), fsel));
  openModal(t(l ? "lists.renameTitle" : "lists.new"), wrap, [
    { label: t("cancel") },
    { label: t("save"), kind: "primary", onClick: () => {
      const name = inp.value.trim();
      if (!name) { toast(t("lists.nameRequired")); return false; }
      if (l) l.name = name;
      else {
        const folderId = fsel.value || null;
        const nl = { id: uid(), name, folderId, order: nextOrder(listsIn(folderId)), createdAt: Date.now() };
        state.lists.push(nl); lv.listId = nl.id; lv.query = "";
      }
      commit();
    } }
  ]);
  setTimeout(() => { try { inp.focus(); } catch (e) {} }, 50);
}
// « Déplacer vers… » : choix du dossier (ou nouveau dossier).
function openMoveList(id) {
  const l = getList(id);
  if (!l) return;
  const sel = folderSelect(l.folderId || "", true);
  const wrap = el("div");
  wrap.appendChild(formField(t("folders.moveTo"), sel));
  openModal(t("folders.moveTitle", { name: l.name }), wrap, [
    { label: t("cancel") },
    { label: t("folders.move"), kind: "primary", onClick: () => {
      if (sel.value === "__new__") { openFolderName(null, nf => moveListTo(id, nf.id)); return; }
      moveListTo(id, sel.value || null);
    } }
  ]);
}

function confirmDeleteList(id) {
  const l = getList(id);
  if (!l) return;
  if (isSharedList(l)) { openShareManage("list", id); return; }   // liste commune : supprimer (propriétaire) / quitter (étape 30)
  const p = el("p", null, t("lists.deleteConfirm", { name: l.name, n: cardsOf(id).length }));
  openModal(t("lists.delete"), p, [
    { label: t("cancel") },
    { label: t("delete"), kind: "danger", onClick: () => {
      state.lists = state.lists.filter(x => x.id !== id);
      state.cards = state.cards.filter(c => c.listId !== id);
      lv.listId = null; lv.query = "";
      commit();
    } }
  ]);
}

