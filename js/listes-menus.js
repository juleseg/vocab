"use strict";

// === LISTES : MENUS « ⋯ » ET « 🤖 CLAUDE », « RÉVISER CETTE LISTE », ÉDITEUR DE CARTE REPLIÉ (ÉTAPE 75) ===
// Moins d'actions visibles sur l'écran Listes ; RIEN n'est supprimé :
// - les anciens liens (#lvRename, #lvMove, … #lvFxInAll) et les boutons #lvBulk / #lvGen restent dans la page, cachés
//   (index.html, #lmOld), avec leurs branchements (initLists) et leurs règles d'affichage (renderLists : lecture seule d'une
//   liste commune, propriétaire, mode Supabase…). Les feuilles ci-dessous lisent leur texte et les activent par click() :
//   une action cachée par renderLists n'est pas proposée ;
// - vue d'ensemble : « + Nouvelle liste » et « ⋯ Plus » ; liste ouverte : « ▶ Réviser cette liste », « + Ajouter une carte »,
//   « 🤖 Claude » et « ⋯ » à côté du titre ; menu d'un dossier : 6 entrées au plus (lmFolderMenu) ;
// - éditeur de carte : mot, traductions et exemple visibles ; le reste sous « Plus de détails (N remplis) » (lmDetails),
//   replié par défaut, état retenu sur l'appareil (vocabfr.ux:det). L'enregistrement de la carte ne change pas.

// Bouton d'origine s'il est proposé ici (pas caché par renderLists) ; #lvBulk et #lvGen : pas dans une liste en lecture seule.
function lmOrig(sel) {
  const b = $(sel);
  if (!b || b.hidden) return null;
  if ((sel === "#lvBulk" || sel === "#lvGen") && $("#lvActions").hidden) return null;
  return b;
}
// Entrée de feuille à partir d'un bouton d'origine : même texte (un emoji en tête devient l'icône), même action.
function lmFrom(sel, ic, o) {
  const b = lmOrig(sel);
  if (!b) return null;
  let label = b.textContent.trim();
  const m = /^(\p{Extended_Pictographic}️?)\s*/u.exec(label);
  if (m) { ic = m[1]; label = label.slice(m[0].length); }
  label = label.replace(/^\+\s*/, "");   // « + Nouveau dossier » : l'icône suffit
  return Object.assign({ ic, label, act: () => b.click() }, o || {});
}
// Groupe d'entrées : absent s'il est vide, l'entrée elle-même s'il n'y en a qu'une, sinon une sous-feuille.
function lmGroup(ic, label, subs) {
  subs = subs.filter(Boolean);
  if (!subs.length) return null;
  if (subs.length === 1) return subs[0];
  return { ic, label, more: subs };
}
// Feuille (fenêtre du bas, comme « Plus ») : items = [{ ic, label, sub, n, danger, act | more }] ; back = retour à la feuille d'avant.
function lmSheet(title, items, back, info) {
  items = items.filter(Boolean);
  const box = el("div", "ecr-more lm-sheet");
  let close = null;
  items.forEach(it => {
    const b = el("button", "item ecr-more-it" + (it.danger ? " lm-danger" : ""));
    b.type = "button";
    const ic = el("span", "ecr-more-ic", it.ic || "");
    ic.setAttribute("aria-hidden", "true");
    const m = el("div", "main");
    m.appendChild(el("div", "t1", it.label));
    if (it.sub) m.appendChild(el("div", "t2", it.sub));
    b.append(ic, m);
    if (it.n) b.appendChild(el("span", "ecr-more-n lm-n", String(it.n)));
    if (it.more) b.appendChild(el("span", "chev", "›"));
    b.addEventListener("click", () => {
      if (close) close();
      if (it.more) lmSheet(it.label, it.more, () => lmSheet(title, items, back, info));
      else it.act();
    });
    box.appendChild(b);
  });
  const body = el("div");
  if (info) body.appendChild(info);
  body.appendChild(box);
  const acts = [];
  if (back) acts.push({ label: "‹ " + t("lm.back"), onClick: () => { back(); } });
  acts.push({ label: t("close") });
  close = openModal(title, body, acts);
  const bg = document.querySelectorAll(".modal-bg");
  if (bg.length) bg[bg.length - 1].classList.add("ecr-sheet", "lm-bg");
}

// --- Liste ouverte : « ⋯ » ---
function lmListMenu() {
  const l = lv.listId ? getList(lv.listId) : null;
  if (!l) return;
  lmSheet(l.name, [
    lmFrom("#lvRename", "✏️"),
    lmFrom("#lvMove", "📁"),
    lmFrom("#lvShare", "👥"),
    lmGroup("🌐", t("folders.langs"), [lmFrom("#lvLangs", "🌐", { label: t("lm.langs.set") }), lmFrom("#lvStudy", "➕")]),
    lmGroup("📚", t("lm.stories"), [lmFrom("#lvStoryNew", "📖"), lmFrom("#lvStories", "📚")]),
    lmGroup("⚙️", t("lm.listSet"), [lmFrom("#lvImages", "🖼"), lmFrom("#lvAudio", "🔊")]),
    lmFrom("#lvBulk", "📥", { label: t("lm.import") }),
    lmFrom("#lvReset", "↺"),
    lmFrom("#lvDelete", "🗑️", { danger: true })
  ]);
}
// --- Liste ouverte : « 🤖 Claude » ---
function lmClaudeItems(all) {
  return [
    lmFrom(all ? "#lvUpdateAll" : "#lvUpdate", "🔄"),
    lmFrom("#lvGen", "✨", { label: t("lm.gen") }),
    all ? null : lmFrom("#lvGender", "♂♀"),
    lmFrom(all ? "#lvAskAll" : "#lvAsk", "💬"),
    lmGroup("📄", t("lm.fx"), [lmFrom(all ? "#lvFxOutAll" : "#lvFxOut", "⬇️"), lmFrom(all ? "#lvFxInAll" : "#lvFxIn", "⬆️")])
  ];
}
function lmClaudeMenu() {
  if (!lv.listId || !getList(lv.listId)) return;
  lmSheet("🤖 Claude", lmClaudeItems(false));
}
// --- Vue d'ensemble : « ⋯ Plus » ---
function lmOverviewMenu() {
  if (lv.listId) return;
  lmSheet(t("nav.lists"), [
    lmFrom("#lvNewFolder", "📁"),
    lmFrom("#lvReorder", "↕️"),
    lmFrom("#lvBulk", "📥", { label: t("lm.import") }),
    lmGroup("🤖", "Claude", lmClaudeItems(true))
  ]);
}
// --- Menu « ⋯ » d'un dossier (remplace la fenêtre à 10 boutons de openFolderMenu, js/screens/listes.js) ---
// Mêmes règles qu'avant : dossier commun en lecture seule = pas de Claude ; nom et langues : propriétaire seulement.
function lmFolderMenu(id) {
  const f = getFolder(id);
  if (!f) return;
  const lists = listsIn(id);
  const cards = state.cards.filter(c => lists.some(l => l.id === c.listId));
  const shF = isSharedFolder(f), roF = shF && f.shared.role === "read", notOwner = shF && !shIsOwner(f);
  const info = el("div", "lm-info");
  info.appendChild(el("p", "muted", t("folders.meta", { l: lists.length, c: cards.length, d: dueCount(cards) }) + " · " + pairLabel(folderLangs(f))));
  const gap = folderGapCount(f), fb = updBadge(gap);
  if (fb) info.appendChild(fb);
  info.appendChild(el("div", "upd-last", updDate(f.lastUpdate)));
  if (shF) info.appendChild(el("div", "upd-last", shTag(f)));
  lmSheet(f.name, [
    { ic: "👥", label: t(shF ? "sh.manageBtn" : "sh.share"), act: () => { if (shF) openShareManage("folder", id); else openShare("folder", id); } },
    notOwner ? null : { ic: "✏️", label: t("folders.rename"), act: () => { openFolderName(id); } },
    lmGroup("🌐", t("folders.langs"), [
      notOwner ? null : { ic: "🌐", label: t("lm.langs.setF"), act: () => { openLangEditor("folder", f); } },
      { ic: "➕", label: t("study.addFolder"), act: () => { openStudyLangs("folder", id); } }
    ]),
    roF ? null : lmGroup("🤖", "Claude", [
      { ic: "🔄", label: t("upd.btn"), n: gap || 0, act: () => { openUpdate({ kind: "folder", id }); } },
      { ic: "⬇️", label: t("fx.exportBtn"), act: () => { openFxExport("folder:" + id); } },
      { ic: "⬆️", label: t("ai.importReply"), act: () => { openFxImport(); } }
    ]),
    { ic: "↺", label: t("fsrs.reset"), act: () => { openResetProgress("folder", id); } },
    { ic: "🗑️", label: t(notOwner ? "sh.leaveFolder" : "folders.delete"), danger: true, act: () => { confirmDeleteFolder(id); } }
  ], null, info);
}

// --- Boutons visibles de l'écran Listes (appelé par renderLists) ---
function lmPaint(list) {
  const more = $("#lmMore"), cl = $("#lmClaude"), rev = $("#lmReview"), done = $("#lmReorderDone"), add = $("#lvAdd");
  if (!more || !cl || !rev || !done || !add) return;
  more.hidden = !!list;
  more.textContent = "⋯ " + t("ecr.more");
  cl.hidden = !list;
  cl.textContent = "🤖 Claude";
  const gap = list ? listGapCount(list) : 0;
  if (gap) cl.appendChild(el("span", "lm-n", gap > 99 ? "99+" : String(gap)));   // cases à compléter
  // « Réviser cette liste » : dès qu'une carte de la liste peut être révisée
  let canRev = false, due = 0;
  if (list) {
    const cs = cardsOf(list.id);
    try { canRev = sessionPool(Object.assign(defaultSessionCfg(), { scope: "lists", listIds: [list.id], onlyDue: false, mode: "mix" })).length > 0; } catch (e) { canRev = false; }
    due = canRev ? dueCount(cs) : 0;
  }
  rev.hidden = !canRev;
  rev.textContent = "";
  if (canRev) {
    rev.appendChild(el("span", null, "▶ " + t("lm.review")));
    if (due) rev.appendChild(el("span", "lm-review-n", t("lists.due", { n: due })));
  }
  add.classList.toggle("primary", !canRev);
  done.hidden = !!list || !lv.reorder;
  done.textContent = "✓ " + t("folders.reorderDone");
}

// --- Éditeur de carte : « Plus de détails (N remplis) » ---
// wrap : corps de la fenêtre. Renvoie { btn, box, add(nœud), watch(champs), setExtra(nœuds, hasImg) }.
// Replié : la classe lm-compact de wrap cache aussi la nature grammaticale à côté de chaque mot (.term-row select).
function lmDetails(wrap) {
  const KEY = CONFIG.LS_USER_PREFIX + "ux:det";
  let open = false;
  try { open = localStorage.getItem(KEY) === "1"; } catch (e) {}
  const btn = el("button", "link-btn lm-det-btn");
  btn.type = "button";
  const box = el("div", "lm-det");
  const slot = el("div", "lm-det-extra");   // image, autres langues apprises (changent avec le type de carte)
  box.appendChild(slot);
  let fields = [], hasImg = null;
  const count = () => {
    let n = 0;
    wrap.querySelectorAll(".term-row select").forEach(s => { if (s.value) n++; });
    slot.querySelectorAll(".study-sec input, .study-sec textarea").forEach(i => { if (i.value.trim()) n++; });
    fields.forEach(i => { if (i && String(i.value || "").trim()) n++; });
    try { if (hasImg && hasImg()) n++; } catch (e) {}
    return n;
  };
  const paint = () => {
    box.hidden = !open;
    wrap.classList.toggle("lm-compact", !open);
    btn.setAttribute("aria-expanded", String(open));
    const n = count();
    btn.textContent = (open ? "▾ " : "▸ ") + t("lm.det") + (n ? " " + t("lm.det.n", { n }) : "");
  };
  btn.addEventListener("click", () => {
    open = !open;
    try { localStorage.setItem(KEY, open ? "1" : "0"); } catch (e) {}
    paint();
  });
  ["input", "change", "click"].forEach(ev => wrap.addEventListener(ev, e => { if (e.target !== btn) setTimeout(paint, 0); }));
  return {
    btn, box, paint,
    add(node) { if (node) box.appendChild(node); },
    watch(list) { fields = list.filter(Boolean); paint(); },
    setExtra(nodes, imgFn) { slot.textContent = ""; arr(nodes).filter(Boolean).forEach(n => slot.appendChild(n)); hasImg = imgFn || null; paint(); }
  };
}

// --- Branchements (le DOM existe : scripts en fin de <body>) ---
(function lmBind() {
  try {
    const on = (sel, fn) => { const b = $(sel); if (b) b.addEventListener("click", fn); };
    on("#lmListMenu", lmListMenu);
    on("#lmClaude", lmClaudeMenu);
    on("#lmMore", lmOverviewMenu);
    on("#lmReview", () => { if (lv.listId) rcReviewList(lv.listId); });
    on("#lmReorderDone", () => { lv.reorder = false; renderLists(); });
  } catch (e) {}
})();
