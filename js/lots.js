"use strict";

// ====================================================================================================
// js/lots.js — MODIFICATION PAR LOTS (ÉTAPE 89)
// Chargé juste après js/listes-menus.js. Au chargement : déclarations seulement (rien n'est exécuté, rien n'est ajouté
// à la page ; la barre et l'en-tête de sélection sont créés au premier usage).
// ====================================================================================================

// === MODIFICATION PAR LOTS (ÉTAPE 89) ===
// Idée d'un utilisateur : sélectionner plusieurs cartes d'une même liste pour leur appliquer une action commune.
// Entrée : menu « ⋯ » d'une liste ouverte → « Sélectionner des cartes » (js/listes-menus.js, lmListMenu → Lots.menuItem).
// En mode « Sélectionner » : une case par carte (toucher la carte = cocher), « Tout sélectionner » (les cartes affichées,
// recherche comprise), compteur, « Terminer », et une barre d'actions en bas de l'écran :
//   1. Déplacer / copier vers une autre liste personnelle, ou une nouvelle liste (mêmes langues que la liste d'origine) ;
//   2. Modifier : UN seul changement pour toutes les cartes cochées — la langue, le type de carte ou la nature du mot ;
//   3. Claude : demande « compléter » ou « vérifier » déposée dans la file d'attente existante (js/queue.js), comptée dans
//      le plafond du jour du compte (étape 80 : AutoMaj.dayCount / AutoMaj.settings) ; ce qui dépasse le plafond ne part pas ;
//   4. Supprimer.
// Chaque action : fenêtre de confirmation avec le BILAN (combien de cartes seront touchées, combien sont laissées et
// pourquoi), puis message « Fait : … » avec « Annuler » pendant LT_UNDO_MS, qui remet l'état d'avant (cartes, progression,
// ordre, liste créée). Un changement impossible pour une carte n'est jamais forcé : la carte est comptée dans le bilan.
// RÈGLES RESPECTÉES :
//   - étape 77 : une suppression voulue appelle Guard.noteDeleted (pas de refus à tort) ; une copie de sécurité locale
//     (type « lot », comptée à part : GF_LOT_MAX) est faite AVANT toute action qui retire ou transforme LT_COPY_MIN cartes
//     ou plus ; copie impossible sur l'appareil : rien n'est fait sans un accord explicite ;
//   - étape 78 : supprimer = enlever de state (la pierre tombale est posée toute seule) ; déplacer = changer listId de la
//     MÊME carte (même identifiant : ni doublon ni perte à la fusion) ; jamais d'écriture de `m` ni de `tombs` ; après un
//     await, abandon seulement si le COMPTE a changé (les cartes sont relues par leur identifiant) ;
//   - étapes 73 / 36 : une case changée ici devient celle de l'utilisateur (ClAuto.snap / afterEdit) ; nature changée d'une
//     carte reliée au dictionnaire commun : Dict.track / Dict.changed, comme l'éditeur de carte ;
//   - étape 79 : la demande à Claude porte data-net="1" (grisée hors connexion) ; tout le reste marche hors connexion ;
//   - étape 80 : cartes copiées ou modifiées avec des cases vides → AutoMaj.kick.
// Listes communes (étape 30) : pas de mode « Sélectionner » (leurs cartes vivent dans shared_cards, avec leurs propres
// règles) ; elles ne sont pas non plus proposées comme destination. Liste en lecture seule : pareil.
// Rien de nouveau dans les données du compte (DATA_VERSION inchangé), aucun SQL. Journal d'activité : « batch ».
// Textes : clés lt.* (js/i18n/lots-<langue>.js). Styles : .lt-* (css/app-9.css).
const LT_COPY_MIN = 10;    // copie de sécurité locale avant une action qui retire ou transforme au moins N cartes
const LT_UNDO_MS = 8000;   // durée du bouton « Annuler » (moins que les 15 s du ménage des images, js/images.js)
const LT_SHOW_MAX = 30;    // cartes laissées de côté nommées dans un bilan (au-delà : « … et N autres »)

const Lots = (() => {
  let on = false, listId = null, who = null;
  const sel = new Set();
  let shown = [];                                   // cartes affichées (recherche comprise), dans l'ordre
  let head = null, bar = null, wrapNow = null;
  let undo = null, undoTimer = null, busy = false, last = null;

  // --- Petits outils ---
  const tn = (key, n, vars) => t(n === 1 && I18N.fr[key + "1"] ? key + "1" : key, Object.assign({ n }, vars || {}));
  function usableList(l) { return !!l && !isSharedList(l) && canEditList(l); }
  function curList() { return listId ? getList(listId) : null; }
  function picked() { return cardsOf(listId).filter(c => sel.has(c.id)).map(c => c.id); }
  function byIds(ids) { const m = new Map(state.cards.map(c => [c.id, c])); return ids.map(id => m.get(id)).filter(c => c && c.listId === listId); }
  function title(c) { try { return String(cardTitle(c) || "—"); } catch (e) { return "—"; } }
  function jobBusy() {
    try { if (typeof aiJob !== "undefined" && aiJob) return true; if (typeof pvJob !== "undefined" && pvJob) return true; } catch (e) {}
    return false;
  }
  function lastBtn(kind) { const bg = document.querySelectorAll(".modal-bg"); return bg.length ? bg[bg.length - 1].querySelector(".btns .btn." + kind) : null; }
  function log(action, n, skipped) {
    try { const l = curList(); Activity.log("batch", { action, n, skipped: skipped || 0, list: l ? String(l.name).slice(0, 60) : "" }); } catch (e) {}
  }

  // --- Mode « Sélectionner » : en-tête, cases, barre d'actions ---
  function dom() {
    const sc = $("#screen-lists"), content = $("#lvContent");
    if (!sc || !content) return false;
    if (!head) {
      head = el("div", "lt-head");
      head.hidden = true;
      const done = el("button", "link-btn lt-done"); done.type = "button"; done.id = "ltDone";
      const cnt = el("div", "lt-count"); cnt.id = "ltCount"; cnt.setAttribute("role", "status"); cnt.setAttribute("aria-live", "polite");
      const all = el("button", "link-btn lt-all"); all.type = "button"; all.id = "ltAll";
      done.addEventListener("click", leave);
      all.addEventListener("click", toggleAll);
      head.append(done, cnt, all);
      content.parentNode.insertBefore(head, content);
    }
    if (!bar) {
      bar = el("div", "lt-bar");
      bar.id = "ltBar";
      bar.hidden = true;
      bar.setAttribute("role", "toolbar");
      [["move", "📁", openMove], ["edit", "✏️", openEdit], ["claude", "🤖", openClaude], ["del", "🗑️", openDelete]].forEach(([k, ic, fn]) => {
        const b = el("button", "lt-act" + (k === "del" ? " lt-danger" : ""));
        b.type = "button"; b.dataset.act = k;
        if (k === "claude") b.setAttribute("data-net", "1");   // étape 79 : grisé hors connexion (js/synchro-ui.js)
        const i = el("span", "lt-ic", ic); i.setAttribute("aria-hidden", "true");
        b.append(i, el("span", "lt-lab"));
        b.addEventListener("click", () => {
          if (!on) return;
          if (!sel.size) { toast(t("lt.pick")); return; }
          if (busy) return;
          if (jobBusy()) { toast(t("ai.busy")); return; }
          fn();
        });
        bar.appendChild(b);
      });
      sc.appendChild(bar);
    }
    return true;
  }
  function paintHead() {
    if (!head) return;
    head.hidden = !on;
    if (!on) return;
    head.querySelector("#ltDone").textContent = "✕ " + t("lt.done");
    const n = sel.size;
    head.querySelector("#ltCount").textContent = n ? tn("lt.count", n) : t("lt.count0");
    const all = head.querySelector("#ltAll"), full = shown.length > 0 && shown.every(id => sel.has(id));
    all.textContent = t(full ? "lt.none" : "lt.all");
    all.disabled = !shown.length;
  }
  function paintBar() {
    if (!bar) return;
    bar.hidden = !on;
    if (!on) return;
    bar.setAttribute("aria-label", t("lt.menu"));
    bar.querySelectorAll(".lt-act").forEach(b => {
      const k = b.dataset.act;
      b.querySelector(".lt-lab").textContent = t("lt.a." + k);
      if (k === "claude") b.hidden = !(typeof Queue !== "undefined" && Queue.usable());
      b.setAttribute("aria-disabled", String(!sel.size));
    });
    bar.classList.toggle("lt-three", bar.querySelector("[data-act='claude']").hidden);
  }
  function markItem(it) {
    const s = sel.has(it.dataset.lt);
    it.classList.toggle("lt-sel", s);
    it.setAttribute("aria-checked", String(s));
  }
  function toggle(id) {
    if (!on || !id) return;
    if (sel.has(id)) sel.delete(id); else sel.add(id);
    if (wrapNow) { const it = wrapNow.querySelector('[data-lt="' + (window.CSS && CSS.escape ? CSS.escape(id) : id) + '"]'); if (it) markItem(it); }
    paintHead(); paintBar();
  }
  function toggleAll() {
    if (!on || !shown.length) return;
    const full = shown.every(id => sel.has(id));
    shown.forEach(id => { if (full) sel.delete(id); else sel.add(id); });
    if (wrapNow) wrapNow.querySelectorAll("[data-lt]").forEach(markItem);
    paintHead(); paintBar();
  }
  function enter(id) {
    const l = getList(id);
    if (!usableList(l)) return;
    on = true; listId = id; who = Storage.getUser(); sel.clear();
    renderLists();
  }
  function leave() {
    on = false; listId = null; sel.clear();
    if (typeof currentScreen !== "undefined" && currentScreen === "lists") renderLists(); else before(null);
  }
  // Entrée du menu « ⋯ » d'une liste (js/listes-menus.js) : absente d'une liste commune, en lecture seule, ou vide.
  function menuItem(l) {
    if (!usableList(l) || !cardsOf(l.id).length) return null;
    return { ic: "☑️", label: t("lt.menu"), act: () => { enter(l.id); } };
  }
  // Appelé par renderLists (js/screens/listes.js) : au début, puis une fois les cartes dessinées.
  function before(list) {
    if (on && (!list || list.id !== listId || Storage.getUser() !== who || !usableList(list))) { on = false; listId = null; sel.clear(); }
    const sc = $("#screen-lists");
    if (sc) sc.classList.toggle("lt-on", on);
    shown = []; wrapNow = null;
    if (!on) { if (head) head.hidden = true; if (bar) bar.hidden = true; return; }
    if (!dom()) { on = false; return; }
    const ids = new Set(cardsOf(list.id).map(c => c.id));
    Array.from(sel).forEach(id => { if (!ids.has(id)) sel.delete(id); });
    paintHead(); paintBar();
  }
  function paint(list, cards, wrap) {
    if (!on || !list || list.id !== listId || !wrap) return;
    shown = cards.map(c => c.id);
    wrapNow = wrap;
    wrap.classList.add("lt-items");
    Array.from(wrap.children).forEach((it, i) => {
      const c = cards[i];
      if (!c) return;
      it.dataset.lt = c.id;
      it.setAttribute("role", "checkbox");
      const bx = el("span", "lt-box", "✓"); bx.setAttribute("aria-hidden", "true");
      it.insertBefore(bx, it.firstChild);
      markItem(it);
    });
    // Toucher une carte = la cocher : l'écouteur est posé en capture sur la liste, l'éditeur de carte ne s'ouvre pas.
    wrap.addEventListener("click", e => {
      const it = e.target && e.target.closest ? e.target.closest("[data-lt]") : null;
      if (!it || !wrap.contains(it)) return;
      e.preventDefault(); e.stopPropagation();
      toggle(it.dataset.lt);
    }, true);
    paintHead();
  }

  // --- « Fait » + « Annuler » ---
  function hideUndo() { clearTimeout(undoTimer); undoTimer = null; undo = null; const b = $("#ltUndo"); if (b) b.classList.remove("show"); }
  function showDone(msg, fn) {
    let b = $("#ltUndo");
    if (!b) {
      b = el("div", "undo-bar lt-undo");
      b.id = "ltUndo";
      b.setAttribute("role", "status");
      b.append(el("span"), el("button"));
      b.lastChild.type = "button";
      document.body.appendChild(b);
    }
    b.firstChild.textContent = msg;
    b.lastChild.textContent = t("pv.undo");
    undo = fn;
    b.lastChild.onclick = () => { const f = undo; hideUndo(); if (f) { try { f(); } catch (e) {} } };
    b.classList.add("show");
    clearTimeout(undoTimer);
    undoTimer = setTimeout(hideUndo, LT_UNDO_MS);
  }
  // État d'avant, pris juste avant de modifier (jamais avant un await). ids : cartes qui vont être modifiées ou retirées.
  function snapshot(ids) {
    const set = new Set(ids), json = new Map(), objs = new Map();
    state.cards.forEach(c => { if (set.has(c.id)) { json.set(c.id, JSON.stringify(c)); objs.set(c.id, c); } });
    return { st: state, who: Storage.getUser(), list: listId, order: state.cards.map(c => c.id), json, objs, added: new Set(), newList: null, del: 0, sel: Array.from(sel) };
  }
  // Remet l'état d'avant, sans toucher à ce qui a été fait ailleurs entre-temps (carte ajoutée par Claude, autre liste…).
  function restore(s) {
    if (state !== s.st || Storage.getUser() !== s.who) { toast(t("lt.undo.gone")); return false; }
    const cur = new Map(state.cards.map(c => [c.id, c]));
    s.json.forEach((js, id) => {
      const c = s.objs.get(id);
      let o = null;
      try { o = JSON.parse(js); } catch (e) {}
      if (!c || !o) return;
      Object.keys(c).forEach(k => { delete c[k]; });
      Object.assign(c, o);
    });
    const out = [], seen = new Set();
    s.order.forEach(id => { const c = s.objs.get(id) || cur.get(id); if (c && !s.added.has(id) && !seen.has(id)) { out.push(c); seen.add(id); } });
    state.cards.forEach(c => { if (!seen.has(c.id) && !s.added.has(c.id)) { out.push(c); seen.add(c.id); } });
    state.cards = out;
    s.added.forEach(id => { if (state.tips && state.tips[id]) delete state.tips[id]; });
    if (s.newList && !state.cards.some(c => c.listId === s.newList)) state.lists = state.lists.filter(l => l.id !== s.newList);
    if (s.del && typeof Guard !== "undefined") Guard.noteDeleted(-s.del);   // étape 77 : ces cartes ne sont plus « supprimées ici »
    if (on && listId === s.list) { sel.clear(); s.sel.forEach(id => sel.add(id)); }
    commit();
    toast(t("pv.undone"));
    return true;
  }
  // Copie de sécurité locale AVANT (étape 77). Renvoie false si l'action doit être abandonnée.
  async function safeCopy(n) {
    if (n < LT_COPY_MIN || typeof Guard === "undefined") return true;
    const ok = await Guard.backup("lot", state);
    if (ok) return true;
    return await new Promise(res => {
      openModal(t("lt.copy.title"), el("p", null, t("lt.copy.fail")), [
        { label: t("cancel"), onClick: () => { res(false); } },
        { label: t("lt.copy.go"), kind: "danger", onClick: () => { res(true); } }
      ], { locked: true });
    });
  }
  // Lance une action : copie de sécurité si besoin, puis fn() (qui relit les cartes par identifiant et modifie d'un coup).
  async function run(n, withCopy, fn) {
    if (busy) return;
    if (jobBusy()) { toast(t("ai.busy")); return; }
    busy = true;
    const u = Storage.getUser();
    try {
      hideUndo();
      if (withCopy && !(await safeCopy(n))) return;
      if (Storage.getUser() !== u || !on) return;   // compte changé pendant la copie (jamais « state a changé » : étape 78)
      fn();
    } catch (e) {
      try { if (typeof ErrLog !== "undefined") ErrLog.sync("lots : " + String((e && e.message) || e).slice(0, 80), e); } catch (x) {}
    } finally { busy = false; }
  }

  // --- Bilan (fenêtre de confirmation) ---
  // lines : [texte] ; skips : [[texte, cartes]] ; notes : [texte].
  function bilanNode(box, main, skips, notes) {
    box.textContent = "";
    if (main) box.appendChild(el("p", "lt-main", main));
    arr(notes).filter(Boolean).forEach(x => box.appendChild(el("p", "lt-note", x)));
    arr(skips).filter(x => x && x[1].length).forEach(([txt, cards]) => {
      const d = el("details", "lt-skip");
      d.appendChild(el("summary", null, txt));
      const ul = el("ul");
      cards.slice(0, LT_SHOW_MAX).forEach(c => ul.appendChild(el("li", null, title(c))));
      if (cards.length > LT_SHOW_MAX) ul.appendChild(el("li", "muted", t("lt.more", { n: cards.length - LT_SHOW_MAX })));
      d.appendChild(ul);
      box.appendChild(d);
    });
  }
  function seg(values, cur, onPick) {
    const s = el("div", "seg");
    const set = v => s.querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.value === v)));
    values.forEach(([v, label]) => {
      const b = el("button", null, label);
      b.type = "button"; b.dataset.value = v;
      b.addEventListener("click", () => { set(v); onPick(v); });
      s.appendChild(b);
    });
    set(cur);
    return s;
  }

  // ================================= 1. DÉPLACER / COPIER =================================
  function dupKeyOf(c, lg) { return isVocab(c) ? "v|" + dupKey(c.terms || {}, lg) : (typeof typedKey === "function" ? typedKey(cardType(c), c) : ""); }
  function destLists() { return orderedLists().filter(l => l.id !== listId && usableList(l)); }
  // → { ok, dup, lang, lg, dest (liste ou null = nouvelle), name }
  function planMove(cards, o) {
    const src = curList();
    const dest = o.dest === "__new__" ? null : getList(o.dest);
    const lg = dest ? listLangs(dest) : listLangs(src);
    const p = { ok: [], dup: [], lang: [], lg, dest, name: dest ? dest.name : String(o.name || "").trim() };
    const keys = new Set();
    if (dest) cardsOf(dest.id).forEach(c => { const k = dupKeyOf(c, lg); if (k) keys.add(k); });
    cards.forEach(c => {
      const hasWord = isVocab(c) ? !!term(c, lg.target).trim() : c.lang === lg.target;
      if (!hasWord) { p.lang.push(c); return; }
      const k = dupKeyOf(c, lg);
      if (k && keys.has(k)) { p.dup.push(c); return; }
      p.ok.push(c);
    });
    return p;
  }
  // Copie d'une carte : même contenu (mots, natures, exemples, image, tags, lien au dictionnaire commun, « Mon astuce »),
  // nouvelle carte, progression à zéro (règle de l'étape 76 : une copie est toujours une nouvelle carte).
  function cloneCard(src, toList, lg) {
    let c;
    if (isVocab(src)) {
      const m = exMap(src);
      let ex = m && Object.keys(m).length ? JSON.parse(JSON.stringify(m)) : null;
      if (!ex && src.example) ex = { [lg.target]: { text: String(src.example), tr: {} } };
      c = newCard(toList, Object.assign({}, src.terms), ex, arr(src.tags).slice(), Object.assign({}, src.pos), lg.target);
      if (src.senseId) { c.senseId = src.senseId; if (arr(src.own).length) c.own = arr(src.own).slice(); }
      if (src.image) c.image = JSON.parse(JSON.stringify(src.image));
      c.auto = arr(src.auto).slice();
    } else {
      c = newTypedCard(toList, cardType(src), Object.assign({}, src), arr(src.tags).slice());
    }
    const tip = typeof Hard !== "undefined" ? Hard.tip(src.id) : "";
    if (tip) Hard.setTip(c.id, tip);
    return c;
  }
  function newListLike(src, name, folderId) {
    const f = folderId && getFolder(folderId) && !isSharedFolder(getFolder(folderId)) ? folderId : null;
    const nl = { id: uid(), name, folderId: f, order: nextOrder(listsIn(f)), createdAt: Date.now() };
    const lg = listLangs(src);
    state.lists.push(nl);
    if (listLangs(nl).target !== lg.target) nl.target = lg.target;                     // même langue apprise que la liste d'origine
    if (arr(src.targets).length > 1) nl.targets = [lg.target].concat(src.targets.slice(1));   // mêmes langues étudiées en plus (étape 37)
    if (src.support !== undefined && JSON.stringify(listLangs(nl).support) !== JSON.stringify(lg.support)) nl.support = src.support;
    return nl;
  }
  function doMove(ids, o) {
    const src = curList();
    if (!src) return;
    const p = planMove(byIds(ids), o);
    if (!p.ok.length) { toast(t("lt.nothing")); return; }
    if (!p.dest && !p.name) { toast(t("lists.nameRequired")); return; }
    const s = snapshot(o.copy ? [] : p.ok.map(c => c.id));
    let dest = p.dest;
    if (!dest) { dest = newListLike(src, p.name, o.folder); s.newList = dest.id; }
    const lg = listLangs(dest);
    if (o.copy) {
      p.ok.forEach(c => { const nc = cloneCard(c, dest.id, lg); state.cards.push(nc); s.added.add(nc.id); });
    } else {
      const moved = new Set(p.ok.map(c => c.id));
      p.ok.forEach(c => { c.listId = dest.id; });
      state.cards = state.cards.filter(c => !moved.has(c.id)).concat(p.ok);   // à la fin de la liste de destination, dans l'ordre
      sel.clear();
    }
    const n = p.ok.length;
    commit();
    log(o.copy ? "copy" : "move", n, p.dup.length + p.lang.length);
    try { if (typeof AutoMaj !== "undefined") AutoMaj.kick("lots"); } catch (e) {}   // étape 80 : cases vides dans les langues de la destination
    showDone(tn(o.copy ? "lt.ok.copy" : "lt.ok.move", n), () => { restore(s); });
  }
  function openMove() {
    const src = curList(), ids = picked();
    if (!src || !ids.length) return;
    const lists = destLists();
    const o = { copy: false, dest: lists.length ? lists[0].id : "__new__", name: "", folder: src.folderId || "" };
    const wrap = el("div", "lt-win");
    const sl = el("select", "input");
    const byFolder = new Map();
    lists.forEach(l => { const k = l.folderId || ""; if (!byFolder.has(k)) byFolder.set(k, []); byFolder.get(k).push(l); });
    byFolder.forEach((ls, k) => {
      const f = k ? getFolder(k) : null;
      const host = byFolder.size > 1 ? el("optgroup") : sl;
      if (host !== sl) { host.label = f ? f.name : t("folders.none"); sl.appendChild(host); }
      ls.forEach(l => { const op = el("option", null, l.name); op.value = l.id; host.appendChild(op); });
    });
    { const op = el("option", null, t("bulk.newList")); op.value = "__new__"; sl.appendChild(op); }
    sl.value = o.dest;
    const nameIn = textInput("", "");
    const nameF = formField(t("lists.name"), nameIn, true);
    const fs = el("select", "input");
    { const o0 = el("option", null, t("folders.none")); o0.value = ""; fs.appendChild(o0); }
    sortedFolders().filter(f => !isSharedFolder(f)).forEach(f => { const op = el("option", null, f.name); op.value = f.id; fs.appendChild(op); });
    fs.value = o.folder; if (fs.value !== o.folder) { fs.value = ""; o.folder = ""; }
    const folderF = formField(t("folders.folder"), fs);
    const info = el("div", "lt-bilan");
    const upd = () => {
      nameF.hidden = folderF.hidden = o.dest !== "__new__";
      const p = planMove(byIds(ids), o), n = p.ok.length;
      const name = p.name || t("bulk.newList").replace(/^\+\s*/, "");
      bilanNode(info, n ? tn(o.copy ? "lt.mv.willCopy" : "lt.mv.willMove", n, { list: name }) : t("lt.nothing"), [
        [t("lt.sk.dup", { n: p.dup.length }), p.dup],
        [t("lt.sk.lang", { n: p.lang.length, lang: langName(p.lg.target) }), p.lang]
      ], [n && !o.copy && n >= LT_COPY_MIN ? t("lt.copy.note") : ""]);
      const go = lastBtn("primary");
      if (go) { go.textContent = tn(o.copy ? "lt.mv.goCopy" : "lt.mv.goMove", n); go.disabled = !n; }
    };
    sl.addEventListener("change", () => { o.dest = sl.value; upd(); if (o.dest === "__new__") { try { nameIn.focus(); } catch (e) {} } });
    nameIn.addEventListener("input", () => { o.name = nameIn.value; upd(); });
    fs.addEventListener("change", () => { o.folder = fs.value; });
    wrap.append(seg([["move", t("lt.mv.move")], ["copy", t("lt.mv.copy")]], "move", v => { o.copy = v === "copy"; upd(); }),
      formField(t("lt.mv.to"), sl), nameF, folderF, info);
    openModal(t("lt.mv.title"), wrap, [
      { label: t("cancel") },
      { label: "…", kind: "primary", onClick: () => {
        if (o.dest === "__new__" && !String(o.name || "").trim()) { toast(t("lists.nameRequired")); return false; }
        const p = planMove(byIds(ids), o);
        if (!p.ok.length) return false;
        run(p.ok.length, !o.copy, () => doMove(ids, o));
      } }
    ]);
    upd();
  }

  // ================================= 2. MODIFIER (langue, type de carte, nature) =================================
  // Mot de la carte retrouvé dans sa phrase d'exemple → { i, len } ou null. Écritures à espaces (latin, cyrillique, grec) :
  // mot entier seulement ; autres écritures (coréen, japonais…) : le mot peut être suivi d'une particule.
  function findGap(ex, word) {
    const low = ex.toLowerCase();
    if (low.length !== ex.length) return null;
    const alts = splitAlts(word).sort((a, b) => b.length - a.length);
    for (const a of alts) {
      const la = a.toLowerCase();
      if (!la) continue;
      const spaced = /^[\p{Script=Latin}\p{Script=Cyrillic}\p{Script=Greek}\p{M}\s'’\-]+$/u.test(a);
      let i = low.indexOf(la);
      while (i >= 0) {
        const pre = i > 0 ? ex[i - 1] : "", post = ex[i + la.length] || "";
        if (!spaced || (!/[\p{L}\p{M}\p{N}]/u.test(pre) && !/[\p{L}\p{M}\p{N}]/u.test(post))) return { i, len: la.length };
        i = low.indexOf(la, i + 1);
      }
    }
    return null;
  }
  function clozeFromVocab(c) {
    const L = primaryLang(c), w = term(c, L).trim(), ex = exText(c, L).trim();
    if (!w || !ex || CLOZE_GAP.test(ex)) return null;
    const g = findGap(ex, w);
    if (!g) return null;
    const lg = cardLangs(c), sup = supportTerms(c, lg);
    let tr = "";
    lg.support.some(code => { tr = exTr(c, L, code); return !!tr; });
    return { lang: L, sentence: ex.slice(0, g.i) + "___" + ex.slice(g.i + g.len), answer: w, hint: sup.length ? sup[0].text : "", explanation: "", translation: tr, ruleId: "" };
  }
  function vocabFromCloze(c) {
    const s = String(c.sentence || ""), ans = String(c.answer || "").trim();
    if (!isLang(c.lang) || !ans || (s.match(/_{2,}/g) || []).length !== 1) return null;
    let full = "";
    try { full = clozeShow(cjqCloze(c).a, splitAlts(ans)[0]); } catch (e) { full = clozeShow(s, splitAlts(ans)[0]); }
    return { word: ans, ex: String(full || "").trim(), tr: String(c.translation || "").trim() };
  }
  // → { ok, same, type, noword, taken, noex, unusable (nombre), L }
  function planEdit(cards, o) {
    const l = curList(), L = l ? listLangs(l).target : "";
    const p = { ok: [], same: [], type: [], noword: [], taken: [], noex: [], unusable: 0, L };
    cards.forEach(c => {
      const v = isVocab(c);
      if (o.what === "lang") {
        if (!isLang(o.from) || !isLang(o.to) || o.from === o.to) { p.same.push(c); return; }
        if (v) {
          if (!term(c, o.from).trim()) { p.noword.push(c); return; }
          if (term(c, o.to).trim()) { p.taken.push(c); return; }
          if (o.from === L && cardUsable(c)) p.unusable++;
        } else {
          if (c.lang !== o.from) { p.noword.push(c); return; }
          if (c.type === "conj" && !(hasGrammar(o.to) && tenseOf(o.to, c.tense) && personsOf(o.to, c.tense).some(x => x.id === c.person))) { p.type.push(c); return; }
        }
        p.ok.push(c);
      } else if (o.what === "type") {
        const from = cardType(c);
        if (from === o.type) { p.same.push(c); return; }
        if (from === "vocab" && o.type === "cloze") { if (clozeFromVocab(c)) p.ok.push(c); else p.noex.push(c); return; }
        if (from === "cloze" && o.type === "vocab") { if (vocabFromCloze(c)) p.ok.push(c); else p.type.push(c); return; }
        p.type.push(c);
      } else {
        if (!v) { p.type.push(c); return; }
        if (!term(c, L).trim()) { p.noword.push(c); return; }
        if (((c.pos || {})[L] || "") === o.pos) { p.same.push(c); return; }
        p.ok.push(c);
      }
    });
    return p;
  }
  function relang(c, A, B) {
    if (!isVocab(c)) { c.lang = B; return; }
    const cl = ClAuto.snap(c);
    const terms = Object.assign({}, c.terms); terms[B] = terms[A]; delete terms[A]; c.terms = terms;
    const pos = Object.assign({}, c.pos);
    if (pos[A] && !pos[B]) pos[B] = parsePos(pos[A], B) || pos[A];
    delete pos[A]; c.pos = pos;
    const m = exMap(c);
    if (m && Object.keys(m).length) {
      const n = {};
      Object.keys(m).forEach(k => {
        const e = m[k] && typeof m[k] === "object" ? m[k] : { text: m[k] };
        const tr = Object.assign({}, e.tr || {});
        if (tr[A] != null && tr[B] == null) tr[B] = tr[A];
        delete tr[A];
        n[k === A && !m[B] ? B : k] = { text: e.text, tr };
      });
      c.examples = normExamples(n);
    }
    c.example = exText(c, primaryLang(c));
    if (c.progress && c.progress[A] && !c.progress[B]) { c.progress[B] = c.progress[A]; delete c.progress[A]; }
    // Le mot n'est plus celui du sens relié : la carte est détachée du dictionnaire commun (reliée à nouveau plus tard,
    // comme une carte neuve), sans rien proposer au commun.
    delete c.senseId; delete c.own;
    c.auto = arr(c.auto).filter(a => !["terms." + A, "pos." + A, "extr." + A].includes(a));
    ClAuto.afterEdit(c, cl);
    c.auto = arr(c.auto).filter(a => !(String(a).startsWith("cl:") && String(a).split(":").slice(1).includes(A)));
    delete state.checkedSig[c.id];
    // Propositions « À valider » en attente sur les cases de l'ancienne langue : elles n'ont plus d'objet.
    state.proposals = state.proposals.filter(p => !(p.cardId === c.id && (p.field === A || fieldCode(p.field) === A)));
  }
  function retype(c, to) {
    const drop = () => { state.proposals = state.proposals.filter(p => p.cardId !== c.id); delete state.checkedSig[c.id]; };   // cases d'un autre type : propositions sans objet
    if (to === "cloze") {
      const f = clozeFromVocab(c);
      if (!f) return false;
      drop();
      const L = f.lang, P = c.progress && c.progress[L];
      // Progression : celle de la langue apprise de la liste est gardée (même carte, même mot) ; les autres langues étudiées
      // n'existent pas pour une phrase à trous.
      if (P) { c.box = P.box; c.dueAt = P.dueAt; c.stats = Object.assign({}, P.stats); c.progress = { [L]: P }; }
      else if (c.progress && Object.keys(c.progress).length) { c.box = 0; c.dueAt = Date.now(); c.stats = { seen: 0, correct: 0, wrong: 0, lastSeen: null }; delete c.progress; }
      else delete c.progress;
      ["examples", "image", "senseId", "own"].forEach(k => { delete c[k]; });
      c.terms = {}; c.pos = {}; c.example = ""; c.auto = [];
      c.type = "cloze";
      Object.assign(c, normTypedFields("cloze", f));
      return true;
    }
    const f = vocabFromCloze(c);
    if (!f) return false;
    drop();
    const L = c.lang, sup = listLangs(c.listId).support;
    (TYPE_FIELDS.cloze || []).forEach(k => { delete c[k]; });
    c.type = "vocab";
    c.terms = { [L]: f.word }; c.pos = {}; c.auto = [];
    c.examples = normExamples(f.ex ? { [L]: { text: f.ex, tr: f.tr && sup.length ? { [sup[0]]: f.tr } : {} } } : {});
    c.example = L === primaryLang(c) ? f.ex : "";
    return true;
  }
  function repos(c, L, code) {
    const snap = Dict.track(c), cl = ClAuto.snap(c);
    setFieldVal(c, posField(L), code);
    c.auto = arr(c.auto).filter(a => a !== "pos." + L);
    ClAuto.afterEdit(c, cl);
    Dict.changed(c, snap);
  }
  function doEdit(ids, o) {
    const p = planEdit(byIds(ids), o);
    if (!p.ok.length) { toast(t("lt.nothing")); return; }
    const s = snapshot(p.ok.map(c => c.id));
    const sigs = Object.assign({}, state.checkedSig || {}), props = state.proposals.slice();
    let n = 0;
    p.ok.forEach(c => {
      if (o.what === "lang") { relang(c, o.from, o.to); n++; }
      else if (o.what === "type") { if (retype(c, o.type)) n++; }
      else { repos(c, p.L, o.pos); n++; }
    });
    sel.clear();
    commit();
    log(o.what, n, p.same.length + p.type.length + p.noword.length + p.taken.length + p.noex.length);
    try { if (typeof AutoMaj !== "undefined") AutoMaj.kick("lots"); } catch (e) {}
    showDone(tn("lt.ok.edit", n), () => {
      if (state === s.st) {
        p.ok.forEach(c => { if (sigs[c.id]) state.checkedSig[c.id] = sigs[c.id]; });
        const have = new Set(state.proposals.map(x => x.id));
        props.forEach(x => { if (!have.has(x.id)) state.proposals.push(x); });
      }
      restore(s);
    });
  }
  function openEdit() {
    const l = curList(), ids = picked();
    if (!l || !ids.length) return;
    const cards = byIds(ids), L = listLangs(l).target;
    const langs = [];
    cards.forEach(c => { if (isVocab(c)) Object.keys(c.terms || {}).forEach(k => { if (isLang(k) && !langs.includes(k)) langs.push(k); }); else if (isLang(c.lang) && !langs.includes(c.lang)) langs.push(c.lang); });
    const from0 = langs.includes(L) ? L : (langs[0] || L);
    const o = { what: "pos", from: from0, to: LANG_CODES.find(x => x !== from0) || from0, type: cards.some(c => cardType(c) === "cloze") && !cards.some(isVocab) ? "vocab" : "cloze", pos: "" };
    const wrap = el("div", "lt-win");
    const fromS = langSelect(o.from, null, v => { o.from = v; upd(); }, null, langs.length ? langs : [L]);
    const toS = langSelect(o.to, null, v => { o.to = v; upd(); });
    const typeS = el("select", "input");
    CARD_TYPES.forEach(x => { const op = el("option", null, TYPE_ICON[x] + "  " + t("type." + x)); op.value = x; typeS.appendChild(op); });
    typeS.value = o.type;
    typeS.addEventListener("change", () => { o.type = typeS.value; upd(); });
    const posS = el("select", "input");
    posCodesFor(L).forEach(pc => { const op = el("option", null, posLabel(pc, L) + " — " + t("pos." + pc)); op.value = pc; posS.appendChild(op); });
    o.pos = posS.value;
    posS.addEventListener("change", () => { o.pos = posS.value; upd(); });
    const fFrom = formField(t("lt.ed.from"), fromS), fTo = formField(t("lt.ed.to"), toS);
    const fType = formField(t("lt.ed.newType"), typeS), fPos = formField(t("lt.ed.newPos", { lang: langName(L) }), posS);
    const info = el("div", "lt-bilan");
    const upd = () => {
      fFrom.hidden = fTo.hidden = o.what !== "lang";
      fType.hidden = o.what !== "type";
      fPos.hidden = o.what !== "pos";
      const p = planEdit(byIds(ids), o), n = p.ok.length;
      let main = t("lt.nothing");
      const notes = [];
      if (n && o.what === "lang") main = tn("lt.ed.willLang", n, { from: langName(o.from), to: langName(o.to) });
      if (n && o.what === "type") { main = tn("lt.ed.willType", n, { type: t("type." + o.type) }); notes.push(t(o.type === "cloze" ? "lt.ed.noteCloze" : "lt.ed.noteVocab")); }
      if (n && o.what === "pos") main = tn("lt.ed.willPos", n, { pos: t("pos." + o.pos) });
      if (n && p.unusable) notes.push(t("lt.ed.unusable", { n: p.unusable, lang: langName(p.L) }));
      if (n >= LT_COPY_MIN) notes.push(t("lt.copy.note"));
      const lg = o.what === "lang" ? o.from : p.L;
      bilanNode(info, main, [
        [t("lt.sk.same", { n: p.same.length }), p.same],
        [t("lt.sk.type", { n: p.type.length }), p.type],
        [t("lt.sk.noex", { n: p.noex.length }), p.noex],
        [t("lt.sk.noword", { n: p.noword.length, lang: langName(lg) }), p.noword],
        [t("lt.sk.taken", { n: p.taken.length, lang: langName(o.to) }), p.taken]
      ], notes);
      const go = lastBtn("primary");
      if (go) { go.textContent = tn("lt.ed.go", n); go.disabled = !n; }
    };
    wrap.append(formField(t("lt.ed.what"), seg([["lang", t("lt.ed.lang")], ["type", t("lt.ed.type")], ["pos", t("lt.ed.pos")]], o.what, v => { o.what = v; upd(); })),
      fFrom, fTo, fType, fPos, info);
    openModal(t("lt.ed.title"), wrap, [
      { label: t("cancel") },
      { label: "…", kind: "primary", onClick: () => {
        const p = planEdit(byIds(ids), o);
        if (!p.ok.length) return false;
        const keep = Object.assign({}, o);
        run(p.ok.length, true, () => doEdit(ids, keep));
      } }
    ]);
    upd();
  }

  // ================================= 3. DEMANDER LA MISE À JOUR CLAUDE =================================
  // → { ok, cap, notVocab, full, auto } ; left = cartes encore permises aujourd'hui (plafond du jour du compte).
  function planClaude(cards, kind, left) {
    const p = { ok: [], cap: [], notVocab: [], full: [], auto: [] };
    const cand = [];
    cards.forEach(c => {
      if (!isVocab(c)) { p.notVocab.push(c); return; }
      if (kind === "complete") {
        const g = gapFields(c);
        if (!g.length) { p.full.push(c); return; }
        if (typeof AutoMaj !== "undefined" && AutoMaj.handled(c, g)) { p.auto.push(c); return; }
      }
      cand.push(c);
    });
    const room = Math.max(0, left);
    p.ok = cand.slice(0, room); p.cap = cand.slice(room);
    return p;
  }
  async function dayRoom() {
    if (typeof AutoMaj === "undefined") return { max: Infinity, used: 0 };
    try { await AutoMaj.fetch(); } catch (e) {}
    const cfg = AutoMaj.settings() || (typeof AMJ_DEF !== "undefined" ? AMJ_DEF : { max: 200 });
    const used = await AutoMaj.dayCount();
    return { max: num(cfg.max, 200), used: num(used, 0) };
  }
  async function sendClaude(ids, kind) {
    const l = curList();
    if (!l) return;
    const u = Storage.getUser();
    const pg = openProgress(t("lt.cl.title"), t("queue.sending"), []);
    let res = null, n = 0, p = null, newIds = [], room = null;
    try {
      room = await dayRoom();                            // plafond relu au moment de l'envoi
      if (Storage.getUser() !== u) return;
      let cards = byIds(ids);
      if (kind === "complete") { try { await Dict.fillFromCommon(cards.filter(isVocab)); } catch (e) {} }   // dictionnaire commun d'abord (étape 36)
      if (Storage.getUser() !== u) return;
      p = planClaude(byIds(ids), kind, room.max - room.used);
      cards = p.ok;
      if (!cards.length) { res = { error: null, none: true }; return; }
      if (kind === "verify" && addDuplicateProposals(cards)) commitQuiet();   // doublons : détectés sur l'appareil (comme « Demander à Claude »)
      const rows = queueCardRows(kind, cards, kind === "complete" ? gapFields : null, "☑ " + listLabel(l));
      const had = new Set(Queue.items().map(x => x.id));
      res = await Queue.submit(rows);
      if (res.error) return;
      n = cards.length;
      newIds = Queue.items().filter(x => !had.has(x.id) && x.kind === kind && x.status === "pending").map(x => x.id);
      Activity.log("claude_request", { type: kind, cards: n, requests: rows.length, batch: true });
      log("claude", n, p.cap.length + p.notVocab.length + p.full.length + p.auto.length);
    } catch (e) { res = { error: "net" }; }
    finally { pg.close(); }
    if (!res) return;
    if (res.error) { openModal(t("lt.cl.title"), el("p", null, Queue.errText(res.error)), [{ label: t("close") }]); return; }
    if (res.none) { toast(p && p.cap.length ? t("lt.cl.capAll", { max: room ? room.max : "" }) : t("lt.nothing")); return; }
    sel.clear();
    if (typeof currentScreen !== "undefined" && currentScreen === "lists") renderLists();
    last = { action: "claude", sent: n, cap: p.cap.length };
    showDone(tn("lt.ok.claude", n) + (p.cap.length ? " " + t("lt.cl.capShort", { n: p.cap.length }) : ""), async () => {
      if (!newIds.length) { toast(t("lt.cl.taken")); return; }
      let ok = false;
      try { ok = await Queue.remove(newIds); } catch (e) { ok = false; }
      const still = Queue.items().some(x => newIds.includes(x.id));
      toast(t(ok && !still ? "lt.cl.undone" : "lt.cl.taken"));
    });
  }
  async function openClaude() {
    const l = curList(), ids = picked();
    if (!l || !ids.length || typeof Queue === "undefined" || !Queue.usable()) return;
    if (navigator.onLine === false) { toast(t("syn.needNet")); return; }
    const u = Storage.getUser();
    const pg = openProgress(t("lt.cl.title"), t("lt.cl.reading"), []);
    let room = null;
    try { room = await withTimeout(dayRoom(), 20000); } catch (e) { room = null; } finally { pg.close(); }
    if (Storage.getUser() !== u || !on) return;
    if (!room) { openModal(t("lt.cl.title"), el("p", null, t("lt.cl.err")), [{ label: t("close") }]); return; }
    const left = room.max - room.used;
    const o = { kind: byIds(ids).some(c => isVocab(c) && gapFields(c).length && !(typeof AutoMaj !== "undefined" && AutoMaj.handled(c))) ? "complete" : "verify" };
    const wrap = el("div", "lt-win");
    const info = el("div", "lt-bilan");
    const upd = () => {
      const p = planClaude(byIds(ids), o.kind, left), n = p.ok.length;
      const notes = [];
      if (p.cap.length) notes.push(n ? t("lt.cl.cap", { n: p.cap.length, max: room.max, used: room.used }) : t("lt.cl.capAll", { max: room.max }));
      bilanNode(info, n ? tn("lt.cl.will", n) : (p.cap.length ? "" : t("lt.nothing")), [
        [t("lt.sk.cap", { n: p.cap.length }), p.cap],
        [t("lt.sk.notVocab", { n: p.notVocab.length }), p.notVocab],
        [t("lt.sk.full", { n: p.full.length }), p.full],
        [t("lt.sk.auto", { n: p.auto.length }), p.auto]
      ], notes);
      const go = lastBtn("primary");
      if (go) { go.textContent = tn("lt.cl.go", n); go.disabled = !n; }
    };
    wrap.append(formField(t("queue.what"), seg([["complete", t("queue.kind.complete")], ["verify", t("queue.kind.verify")]], o.kind, v => { o.kind = v; upd(); })), info);
    if (typeof queueCadenceNote === "function") { try { wrap.insertBefore(queueCadenceNote(), wrap.firstChild); } catch (e) {} }
    openModal(t("lt.cl.title"), wrap, [
      { label: t("cancel") },
      { label: "…", kind: "primary", onClick: () => {
        const p = planClaude(byIds(ids), o.kind, left);
        if (!p.ok.length) return false;
        const kind = o.kind;
        if (busy) return false;
        hideUndo();
        sendClaude(ids, kind);
      } }
    ]);
    upd();
  }

  // ================================= 4. SUPPRIMER =================================
  function doDelete(ids) {
    const cards = byIds(ids);
    if (!cards.length) { toast(t("lt.nothing")); return; }
    const s = snapshot(cards.map(c => c.id));
    const gone = new Set(cards.map(c => c.id));
    state.cards = state.cards.filter(c => !gone.has(c.id));      // étape 78 : la pierre tombale est posée toute seule
    s.del = cards.length;
    if (typeof Guard !== "undefined") Guard.noteDeleted(cards.length);   // étape 77 : suppression voulue
    sel.clear();
    if (!cardsOf(listId).length) { on = false; }                // liste vide : plus rien à sélectionner
    commit();
    log("delete", cards.length, 0);
    showDone(tn("lt.ok.del", cards.length), () => { restore(s); });
  }
  function openDelete() {
    const l = curList(), ids = picked();
    if (!l || !ids.length) return;
    const n = byIds(ids).length;
    const wrap = el("div", "lt-win");
    const info = el("div", "lt-bilan");
    bilanNode(info, tn("lt.del.will", n, { list: l.name }), [], [n >= LT_COPY_MIN ? t("lt.copy.note") : "", t("lt.del.undo")]);
    wrap.appendChild(info);
    openModal(t("lt.del.title"), wrap, [
      { label: t("cancel") },
      { label: tn("lt.del.go", n), kind: "danger", onClick: () => { run(n, true, () => doDelete(ids)); } }
    ]);
  }

  return {
    menuItem, enter, leave, before, paint, toggle, toggleAll,
    // Pour l'affichage et les tests : état du mode, cartes cochées, bilans calculés sans rien modifier.
    status: () => ({ on, list: listId, selected: Array.from(sel), shown: shown.slice(), busy, undo: !!undo, last }),
    planMove: (ids, o) => planMove(byIds(ids), o), planEdit: (ids, o) => planEdit(byIds(ids), o),
    planClaude: (ids, kind, left) => planClaude(byIds(ids), kind, left)
  };
})();
