"use strict";

// === ADMINISTRATION : GESTION DES COMPTES (ANNONCES, LISTES MODÈLES) ===
// (suite de la découpe : même section, fichier séparé ; taille visée depuis l'étape 65 : 60 Ko au plus par fichier)
// --- Gestion des comptes (admin, étape 27) : annonces (#admin-annonces) et listes modèles (#admin-modeles) ---
// Fonctions SQL du script supabase-etape27.sql (security definer, contrôle is_admin()).
// Script pas lancé : « Lancez le script SQL de l'étape 27 » dans ces écrans, le reste de l'administration marche.
function st27Missing(e) { return alIsMissing(e) ? t("st27.missing") : aqErrText(e); }
// Liste des comptes et comptes bloqués, chargés une fois si besoin (sélection des comptes visés).
async function admEnsureList() {
  if (!adm.list) { try { adm.list = arr(await Supa.listAccounts()); } catch (e) {} }
  if (!Object.keys(adm.blocked || {}).length && !adm.blockMissing) await admLoadBlocked();
  return arr(adm.list);
}
// Date ISO ↔ valeur d'un champ datetime-local (heure de cet appareil).
function anToLocal(iso) {
  const d = iso ? new Date(iso) : new Date();
  if (isNaN(d)) return "";
  const p = n => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + "T" + p(d.getHours()) + ":" + p(d.getMinutes());
}
function anFromLocal(v) { if (!v) return null; const d = new Date(v); return isNaN(d) ? undefined : d.toISOString(); }
// Case à cocher d'un compte (sélection multiple) ; tags admin / bloqué.
function admAccountCheck(a, checked, onChange) {
  const r = el("label", "check");
  const cb = el("input"); cb.type = "checkbox"; cb.checked = !!checked;
  cb.addEventListener("change", () => onChange(cb.checked));
  const sp = el("span", null, a.identifiant);
  if (admIsBlocked(a.user_id)) sp.appendChild(el("span", "tag bad", t("blk.tag")));
  r.append(cb, sp);
  return { row: r, cb };
}

// ---- Annonces ----
const AN_LANGS = ["ko", "fr", "en"];
const an = { list: null, loading: false, err: "", missing: false, started: false };
function anRerender() { if (currentScreen === "adminann") renderAdminAnn(); }
async function anLoad() {
  an.loading = true; an.err = ""; an.started = true;
  anRerender();
  try { an.list = arr(await aqRpc("admin_announcements")); an.missing = false; }
  catch (e) { an.missing = alIsMissing(e); an.err = st27Missing(e); if (an.missing) an.list = null; }
  an.loading = false;
  anRerender();
}
function renderAdminAnn() {
  const root = $("#screen-adminann");
  if (!root) return;
  root.textContent = "";
  const back = el("button", "link-btn", t("aq.back"));
  back.addEventListener("click", () => { location.hash = "#" + HASH_OF.admin; });
  root.appendChild(back);
  const top = el("div", "adm-top");
  top.appendChild(el("h2", null, t("an.title")));
  const ref = el("button", "link-btn", t("admin.refresh"));
  ref.addEventListener("click", anLoad);
  top.appendChild(ref);
  root.appendChild(top);
  if (!an.started) { anLoad(); return; }
  if (an.loading && !an.list) { root.appendChild(el("div", "empty", t("admin.loading"))); return; }
  if (an.err) root.appendChild(el("div", "card q-err", an.err));
  if (an.missing) return;
  root.appendChild(el("p", "muted an-intro", t("an.intro")));
  const add = modGate(el("button", "btn primary", t("an.new")), "ann.act");   // étape 66 : case du modo
  add.addEventListener("click", () => anEdit(null));
  root.appendChild(add);
  const list = arr(an.list);
  if (!list.length) { root.appendChild(el("div", "empty", t("an.empty"))); return; }
  const box = el("div", "an-list");
  list.forEach(a => box.appendChild(anItem(a)));
  root.appendChild(box);
}
function anStatusTag(st) {
  const cls = { active: "ok", scheduled: "", ended: "", inactive: "warn" }[st];
  return el("span", "tag" + (cls ? " " + cls : ""), t("an.st." + (["active", "scheduled", "ended", "inactive"].includes(st) ? st : "inactive")));
}
function anLangsOf(a) { return AN_LANGS.filter(l => String((a.body && a.body[l]) || (a.title && a.title[l]) || "").trim()); }
function anItem(a) {
  const c = el("div", "card an-item");
  const tx = Ann.texts(a, state.settings.uiLang) || { title: "", body: "" };
  const head = el("div", "an-head");
  const h = el("div", "an-t", tx.title || tx.body.slice(0, 60) || "—");
  if (tx.lang) h.lang = tx.lang;
  head.append(h, anStatusTag(a.status));
  c.appendChild(head);
  if (tx.title && tx.body) { const b = el("div", "an-prev", tx.body); if (tx.lang) b.lang = tx.lang; c.appendChild(b); }
  const names = arr(a.targets).map(x => x.identifiant);
  const to = a.target_all ? t("an.toAll") : t("an.toN", { n: names.length }) + " : " + names.slice(0, 6).join(", ") + (names.length > 6 ? "…" : "");
  const meta = el("div", "an-meta");
  [
    t("an.langs") + " : " + anLangsOf(a).map(l => l.toUpperCase()).join(" · "),
    to,
    t("an.from", { d: alTime(a.starts_at) }) + " — " + (a.ends_at ? t("an.to", { d: alTime(a.ends_at) }) : t("an.noEnd")),
    t("an.reads", { r: dashFmt(a.read_count), n: dashFmt(a.target_count) })
  ].forEach(x => meta.appendChild(el("div", null, x)));
  c.appendChild(meta);
  const acts = el("div", "an-acts");
  const btn = (label, cls, on) => { const b = el("button", "btn" + (cls ? " " + cls : ""), label); b.type = "button"; b.addEventListener("click", on); acts.appendChild(b); return b; };
  modGate(btn(t("an.edit"), "", () => anEdit(a)), "ann.act");   // étape 66 : cases du modo
  btn(t("an.readsBtn"), "", () => anReads(a));
  if (a.active) modGate(btn(t("an.off"), "danger", () => anSetActive(a, false)), "ann.act");
  else modGate(btn(t("an.on"), "", () => anSetActive(a, true)), "ann.act");
  c.appendChild(acts);
  return c;
}
async function anEdit(a) {
  const accounts = (await admEnsureList()).filter(x => !x.est_admin);
  const f = {
    title: {}, body: {}, all: a ? !!a.target_all : true,
    targets: new Set(a ? arr(a.targets).map(x => x.user_id) : []),
    starts: anToLocal(a ? a.starts_at : null), ends: a && a.ends_at ? anToLocal(a.ends_at) : ""
  };
  AN_LANGS.forEach(l => { f.title[l] = String((a && a.title && a.title[l]) || ""); f.body[l] = String((a && a.body && a.body[l]) || ""); });
  const wrap = el("div", "an-form");
  wrap.appendChild(el("p", "hint", t("an.langHint")));
  AN_LANGS.forEach(l => {
    const fs = el("fieldset", "an-lang");
    fs.appendChild(el("legend", null, langName(l) + " (" + l.toUpperCase() + ")"));
    const ti = textInput(f.title[l], t("an.titlePh"), l);
    ti.maxLength = 120;
    ti.addEventListener("input", () => { f.title[l] = ti.value; });
    const ta = el("textarea", "input an-ta");
    ta.rows = 4; ta.maxLength = 4000; ta.lang = l; ta.value = f.body[l]; ta.placeholder = t("an.bodyPh");
    ta.addEventListener("input", () => { f.body[l] = ta.value; });
    fs.append(formField(t("an.fTitle"), ti), formField(t("an.fBody"), ta));
    wrap.appendChild(fs);
  });
  // Cible
  const seg = el("div", "seg");
  const pick = el("div", "adm-pick an-pick");
  const cnt = el("div", "hint");
  const showCnt = () => { cnt.textContent = t("an.nChosen", { n: f.targets.size }); };
  const setAll = v => {
    f.all = v;
    seg.querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", String((b.dataset.v === "all") === v)));
    pick.hidden = v; cnt.hidden = v;
  };
  [["all", "an.toAll"], ["some", "an.toSome"]].forEach(([v, k]) => {
    const b = el("button", null, t(k)); b.type = "button"; b.dataset.v = v;
    b.addEventListener("click", () => setAll(v === "all"));
    seg.appendChild(b);
  });
  accounts.forEach(x => pick.appendChild(admAccountCheck(x, f.targets.has(x.user_id), on => { if (on) f.targets.add(x.user_id); else f.targets.delete(x.user_id); showCnt(); }).row));
  if (!accounts.length) pick.appendChild(el("div", "hint", t("admin.empty")));
  const tg = el("div");
  tg.append(seg, pick, cnt);
  wrap.appendChild(formField(t("an.target"), tg, false, t("an.targetHint")));
  setAll(f.all); showCnt();
  // Dates
  const st = el("input", "input"); st.type = "datetime-local"; st.value = f.starts;
  const en = el("input", "input"); en.type = "datetime-local"; en.value = f.ends;
  const row = el("div", "an-dates");
  row.append(formField(t("an.start"), st), formField(t("an.end"), en, false, t("an.endHint")));
  wrap.appendChild(row);
  let busy = false;
  const close = openModal(t(a ? "an.editTitle" : "an.new"), wrap, [
    { label: t("cancel") },
    { label: t("save"), kind: "primary", onClick: () => {
      if (busy) return false;
      const title = {}, body = {};
      AN_LANGS.forEach(l => { const ti = f.title[l].trim(), bo = f.body[l].trim(); if (ti) title[l] = ti; if (bo) body[l] = bo; });
      if (!Object.keys(title).length && !Object.keys(body).length) { toast(t("an.err.text")); return false; }
      if (!f.all && !f.targets.size) { toast(t("an.err.targets")); return false; }
      const s0 = anFromLocal(st.value) || new Date().toISOString(), e0 = anFromLocal(en.value);
      if (e0 === undefined || (e0 && Date.parse(e0) <= Date.parse(s0))) { toast(t("an.err.dates")); return false; }
      busy = true;
      (async () => {
        try {
          const id = await aqRpc("admin_announcement_save", { p_id: a ? a.id : null, p_title: title, p_body: body, p_target_all: f.all,
            p_targets: f.all ? null : Array.from(f.targets), p_starts: s0, p_ends: e0 || null, p_active: a ? !!a.active : true });
          const show = Ann.texts({ title, body }, state.settings.uiLang) || { title: "", body: "" };
          Activity.log(a ? "admin_announce_edit" : "admin_announce_create", { title: (show.title || show.body).slice(0, 60),
            to: f.all ? "all" : f.targets.size, langs: Object.keys(Object.assign({}, title, body)).join(","), id: String(id || "").slice(0, 8) });
          toast(t("an.saved"));
          close();
          anLoad();
        } catch (e) { busy = false; toast(st27Missing(e)); }
      })();
      return false;
    } }
  ]);
}
async function anSetActive(a, on) {
  try {
    await aqRpc("admin_announcement_set_active", { p_id: a.id, p_active: on });
    const tx = Ann.texts(a, state.settings.uiLang) || { title: "", body: "" };
    Activity.log(on ? "admin_announce_on" : "admin_announce_off", { title: (tx.title || tx.body).slice(0, 60) });
    toast(t(on ? "an.onDone" : "an.offDone"));
    anLoad();
  } catch (e) { toast(st27Missing(e)); }
}
async function anReads(a) {
  let d;
  try { d = await aqRpc("admin_announcement_reads", { p_id: a.id }); } catch (e) { toast(st27Missing(e)); return; }
  if (!d) { toast(t("admin.err")); return; }
  const wrap = el("div", "an-reads");
  const read = arr(d.read), unread = arr(d.unread);
  wrap.appendChild(el("h4", "fc-h4", t("an.readBy", { n: read.length })));
  const r1 = el("div", "items an-rl");
  if (!read.length) r1.appendChild(el("div", "hint an-none", t("an.nobody")));
  read.forEach(x => { const it = el("div", "an-r"); it.append(el("span", null, x.identifiant), el("span", "muted", alTime(x.read_at))); r1.appendChild(it); });
  wrap.appendChild(r1);
  wrap.appendChild(el("h4", "fc-h4", t("an.unreadBy", { n: unread.length })));
  const r2 = el("div", "items an-rl");
  if (!unread.length) r2.appendChild(el("div", "hint an-none", t("an.everyone")));
  unread.forEach(x => { const it = el("div", "an-r"); it.appendChild(el("span", null, x.identifiant)); r2.appendChild(it); });
  wrap.appendChild(r2);
  const tx = Ann.texts(a, state.settings.uiLang) || { title: "" };
  openModal(t("an.readsTitle") + (tx.title ? " — " + tx.title : ""), wrap, [{ label: t("close") }]);
}

// ---- Listes modèles ----
// Bibliothèque = listes et dossiers de l'admin marqués « Modèle » (table template_marks). Envoi = copie des cartes sans
// progression (boîte 0) chez chaque compte choisi, dans un dossier nouveau, existant (même nom, créé s'il manque) ou sans
// dossier. Suivi (template_sends) : modèle d'origine → compte, date, correspondance des listes et des cartes.
// Modèle déjà reçu par un compte : ignorer ce compte, ou ajouter seulement les cartes jamais reçues (dans la liste déjà
// reçue si elle existe encore chez lui, sinon dans une nouvelle liste). Bilan à la fin. Chaque envoi noté au journal.
const tp = { marks: null, loading: false, err: "", missing: false, started: false, busy: false };
function tpRerender() { if (currentScreen === "admintpl") renderAdminTpl(); }
async function tpLoad() {
  tp.loading = true; tp.err = ""; tp.started = true;
  tpRerender();
  try { tp.marks = arr(await aqRpc("admin_templates")); tp.missing = false; }
  catch (e) { tp.missing = alIsMissing(e); tp.err = st27Missing(e); if (tp.missing) tp.marks = null; }
  tp.loading = false;
  tpRerender();
}
function tpMark(kind, id) { return arr(tp.marks).find(m => m.kind === kind && m.item_id === id) || null; }
// Contenu d'un modèle (données de l'admin, ouvertes dans l'appli).
function tpSource(kind, id) {
  let name, lists, folderLg = null;
  if (kind === "folder") { const f = getFolder(id); if (!f) return null; name = f.name; lists = listsIn(f.id); folderLg = folderLangs(f); }
  else { const l = getList(id); if (!l) return null; name = l.name; lists = [l]; }
  const ids = new Set(lists.map(l => l.id));
  return { kind, id, name, folderLg, lists: lists.map(l => ({ id: l.id, name: l.name, lg: listLangs(l) })), cards: state.cards.filter(c => ids.has(c.listId)) };
}
function renderAdminTpl() {
  const root = $("#screen-admintpl");
  if (!root) return;
  root.textContent = "";
  const back = el("button", "link-btn", t("aq.back"));
  back.addEventListener("click", () => { location.hash = "#" + HASH_OF.admin; });
  root.appendChild(back);
  const top = el("div", "adm-top");
  top.appendChild(el("h2", null, t("tp.title")));
  const ref = el("button", "link-btn", t("admin.refresh"));
  ref.addEventListener("click", tpLoad);
  top.appendChild(ref);
  root.appendChild(top);
  if (!tp.started) { tpLoad(); return; }
  if (tp.loading && !tp.marks) { root.appendChild(el("div", "empty", t("admin.loading"))); return; }
  if (tp.err) root.appendChild(el("div", "card q-err", tp.err));
  if (tp.missing || !tp.marks) return;
  root.appendChild(el("p", "muted an-intro", t("tp.intro")));
  const n = tp.marks.length;
  root.appendChild(el("div", "hint tp-count", t("tp.nMarked", { n })));
  const box = el("div", "items tp-items");
  const nCards = ids => state.cards.filter(c => ids.has(c.listId)).length;
  sortedFolders().forEach(f => {
    const ls = listsIn(f.id);
    box.appendChild(tpRow("folder", f.id, "📁 " + f.name, t("tp.metaFolder", { l: ls.length, n: nCards(new Set(ls.map(l => l.id))) }), false, f.name));
    ls.forEach(l => box.appendChild(tpRow("list", l.id, l.name, t("tp.metaList", { n: cardsOf(l.id).length }), true, l.name)));
  });
  const loose = listsIn(null);
  if (loose.length && state.folders.length) box.appendChild(el("div", "tp-sep", t("admin.noFolder")));
  loose.forEach(l => box.appendChild(tpRow("list", l.id, l.name, t("tp.metaList", { n: cardsOf(l.id).length }), false, l.name)));
  if (!state.lists.length && !state.folders.length) box.appendChild(el("div", "empty", t("tp.noLists")));
  root.appendChild(box);
  // Marques dont la liste ou le dossier n'existe plus
  const gone = tp.marks.filter(m => m.kind === "folder" ? !getFolder(m.item_id) : !getList(m.item_id));
  if (gone.length) {
    root.appendChild(el("h3", "fc-h", t("tp.gone")));
    const g = el("div", "items tp-items");
    gone.forEach(m => {
      const r = el("div", "tp-row");
      const main = el("div", "tp-main");
      main.append(el("div", "t1", (m.kind === "folder" ? "📁 " : "") + (m.name || "?")), el("div", "t2", tpRecvText(m)));
      const b = el("button", "btn", t("tp.unmark"));
      b.type = "button";
      b.addEventListener("click", () => tpSetMark(m.kind, m.item_id, m.name, false));
      r.append(main, b);
      g.appendChild(r);
    });
    root.appendChild(g);
  }
}
function tpRecvText(m) {
  const a = num(Number(m.accounts), 0);
  return a ? t("tp.recv", { n: a, d: admDate(m.last_sent_at) }) : t("tp.never");
}
function tpRow(kind, id, label, meta, sub, name) {
  const m = tpMark(kind, id);
  const r = el("div", "tp-row" + (sub ? " sub" : "") + (m ? " on" : ""));
  const main = el("div", "tp-main");
  main.appendChild(el("div", "t1", label));
  main.appendChild(el("div", "t2", meta));
  if (m) main.appendChild(el("div", "t2 tp-recv", tpRecvText(m)));
  const acts = el("div", "tp-acts");
  const lab = el("label", "check tp-check");
  const cb = el("input"); cb.type = "checkbox"; cb.checked = !!m; cb.disabled = tp.busy;
  cb.addEventListener("change", () => tpSetMark(kind, id, name, cb.checked));
  lab.append(cb, el("span", null, t("tp.model")));
  acts.appendChild(lab);
  if (m) {
    const b = el("button", "btn primary tp-send", t("tp.send"));
    b.type = "button";
    b.addEventListener("click", () => tpSend(kind, id));
    acts.appendChild(b);
  }
  r.append(main, acts);
  return r;
}
async function tpSetMark(kind, id, name, on) {
  if (tp.busy) return;
  tp.busy = true;
  try { await aqRpc("admin_template_mark", { p_kind: kind, p_item: id, p_name: String(name || "").slice(0, 200), p_on: on }); toast(t(on ? "tp.marked" : "tp.unmarked")); }
  catch (e) { toast(st27Missing(e)); }
  tp.busy = false;
  tpLoad();
}
// Étape 1 : comptes visés.
async function tpSend(kind, id) {
  const src = tpSource(kind, id);
  if (!src) { toast(t("tp.goneOne")); return; }
  if (!src.cards.length) { toast(t("tp.emptyTpl")); return; }
  const accounts = (await admEnsureList()).filter(a => a.user_id !== auth.sbUid);
  if (!accounts.length) { toast(t("tp.noAccounts")); return; }
  const sel = new Set();
  const wrap = el("div");
  wrap.appendChild(el("p", null, t("tp.sendIntro", { name: src.name, n: src.cards.length, l: src.lists.length })));
  const boxes = [];
  const cnt = el("div", "hint");
  const show = () => { cnt.textContent = t("an.nChosen", { n: sel.size }); allCb.checked = sel.size === accounts.length; };
  const allRow = el("label", "check tp-all");
  const allCb = el("input"); allCb.type = "checkbox";
  allCb.addEventListener("change", () => { accounts.forEach((a, i) => { boxes[i].checked = allCb.checked; if (allCb.checked) sel.add(a.user_id); else sel.delete(a.user_id); }); show(); });
  allRow.append(allCb, el("span", null, t("tp.all", { n: accounts.length })));
  wrap.appendChild(allRow);
  const pick = el("div", "adm-pick");
  accounts.forEach(a => {
    const x = admAccountCheck(a, false, on => { if (on) sel.add(a.user_id); else sel.delete(a.user_id); show(); });
    boxes.push(x.cb); pick.appendChild(x.row);
  });
  wrap.append(pick, cnt);
  show();
  openModal(t("tp.sendTitle") + " — " + src.name, wrap, [
    { label: t("cancel") },
    { label: t("tp.next"), kind: "primary", onClick: () => {
      if (!sel.size) { toast(t("an.err.targets")); return false; }
      tpPrepare(src, accounts.filter(a => sel.has(a.user_id)));
    } }
  ]);
}
// Lecture des données des comptes visés et de ce qu'ils ont déjà reçu, puis étape 2.
async function tpPrepare(src, targets) {
  const pg = openProgress(t("tp.reading"), "0 / " + targets.length);
  const data = {};
  let recv = [];
  try {
    recv = arr(await aqRpc("admin_template_received", { p_kind: src.kind, p_item: src.id, p_users: targets.map(a => a.user_id) }));
    for (let i = 0; i < targets.length; i++) {
      const a = targets[i];
      data[a.user_id] = await admRead(a);
      pg.set((i + 1) / targets.length, (i + 1) + " / " + targets.length);
    }
  } catch (e) { pg.close(); toast(st27Missing(e)); return; }
  pg.close();
  tpStep2(src, targets, data, recv);
}
// Étape 2 : dossier de destination, et choix pour les comptes qui ont déjà reçu ce modèle.
function tpStep2(src, targets, data, recv) {
  const recvMap = {};
  recv.forEach(r => { if (r && r.user_id) recvMap[r.user_id] = r; });
  const already = targets.filter(a => recvMap[a.user_id]);
  const opt = { dest: "new", name: src.name, exist: "", again: "add" };
  const wrap = el("div");
  wrap.appendChild(el("p", "muted", t("tp.toN", { n: targets.length }) + " : " + targets.map(a => a.identifiant).slice(0, 12).join(", ") + (targets.length > 12 ? "…" : "")));
  // Dossiers existants chez les comptes visés (par nom)
  const names = new Map();
  targets.forEach(a => {
    const seen = new Set();
    arr(data[a.user_id] && data[a.user_id].folders).forEach(f => {
      const k = String(f.name || "").trim().toLowerCase();
      if (!k || seen.has(k)) return;
      seen.add(k);
      const x = names.get(k) || { name: String(f.name).trim(), n: 0 };
      x.n++; names.set(k, x);
    });
  });
  const seg = el("div", "seg");
  const nameInp = textInput(opt.name, "");
  nameInp.maxLength = 80;
  nameInp.addEventListener("input", () => { opt.name = nameInp.value; });
  const exSel = el("select", "input");
  Array.from(names.values()).sort((x, y) => y.n - x.n || x.name.localeCompare(y.name)).forEach(x => {
    const o = el("option", null, x.name + " (" + x.n + " / " + targets.length + ")"); o.value = x.name; exSel.appendChild(o);
  });
  opt.exist = exSel.value || "";
  exSel.addEventListener("change", () => { opt.exist = exSel.value; });
  const fNew = formField(t("tp.folderName"), nameInp);
  const fEx = formField(t("tp.folderExist"), exSel, false, t("tp.existHint"));
  const fNone = el("div", "hint", t("tp.noneHint"));
  const setDest = v => {
    opt.dest = v;
    seg.querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.v === v)));
    fNew.hidden = v !== "new"; fEx.hidden = v !== "existing"; fNone.hidden = v !== "none";
  };
  [["new", "tp.dNew"], ["existing", "tp.dExist"], ["none", "tp.dNone"]].forEach(([v, k]) => {
    const b = el("button", null, t(k)); b.type = "button"; b.dataset.v = v;
    if (v === "existing" && !names.size) b.disabled = true;
    b.addEventListener("click", () => setDest(v));
    seg.appendChild(b);
  });
  const dbox = el("div");
  dbox.append(seg, fNew, fEx, fNone);
  wrap.appendChild(formField(t("tp.dest"), dbox));
  setDest("new");
  if (already.length) {
    const c = el("div", "card tp-again");
    c.appendChild(el("p", null, t("tp.already", { n: already.length, ids: already.map(a => a.identifiant).slice(0, 12).join(", ") + (already.length > 12 ? "…" : "") })));
    const s2 = el("div", "seg");
    [["add", "tp.addNew"], ["skip", "tp.skip"]].forEach(([v, k]) => {
      const b = el("button", null, t(k)); b.type = "button";
      b.setAttribute("aria-pressed", String(v === opt.again));
      b.addEventListener("click", () => { opt.again = v; s2.querySelectorAll("button").forEach(x => x.setAttribute("aria-pressed", String(x === b))); });
      s2.appendChild(b);
    });
    c.appendChild(s2);
    c.appendChild(el("div", "hint", t("tp.alreadyHint")));
    wrap.appendChild(c);
  }
  openModal(t("tp.sendTitle") + " — " + src.name, wrap, [
    { label: t("cancel") },
    { label: t("tp.go"), kind: "primary", onClick: () => {
      const dest = { mode: opt.dest, name: (opt.dest === "existing" ? opt.exist : opt.name).trim() };
      if (dest.mode !== "none" && !dest.name) { toast(t("tp.err.folder")); return false; }
      tpRun(src, targets, data, recvMap, dest, opt.again);
    } }
  ]);
}
// Copie des cartes d'un modèle dans les données d'un compte (out, modifié sur place). r = ce qu'il a déjà reçu (ou null).
// Renvoie { cards, lists, folderId, listMap, cardMap } (listMap / cardMap : seulement ce qui est créé maintenant).
function tpApply(out, src, dest, r) {
  const now = Date.now();
  const res = { cards: 0, lists: 0, folderId: null, listMap: {}, cardMap: {} };
  const maxOrder = a => a.reduce((m, x) => Math.max(m, num(x.order, -1)), -1);
  const hasFolder = id => !!id && out.folders.some(f => f.id === id);
  const hasList = id => !!id && out.lists.some(l => l.id === id);
  const prevCards = (r && r.card_map && typeof r.card_map === "object") ? r.card_map : {};
  const prevLists = (r && r.list_map && typeof r.list_map === "object") ? r.list_map : {};
  let folderId;   // undefined = pas encore choisi
  const destFolder = () => {
    if (folderId !== undefined) return folderId;
    if (r && hasFolder(r.folder_id)) return (folderId = r.folder_id);           // dossier du premier envoi, s'il existe encore
    if (dest.mode === "none") return (folderId = null);
    if (dest.mode === "existing") {
      const k = dest.name.toLowerCase();
      const f = out.folders.find(x => String(x.name || "").trim().toLowerCase() === k);
      if (f) return (folderId = f.id);
    }
    const nf = { id: uid(), name: dest.name, order: maxOrder(out.folders) + 1 };
    if (src.folderLg) { nf.target = src.folderLg.target; addLearningTo(out, nf.target); }
    out.folders.push(nf);
    return (folderId = nf.id);
  };
  const idMap = Object.assign({}, prevCards);   // carte du modèle → carte du compte (liens vers les règles)
  const made = [];
  src.lists.forEach(l => {
    const cards = src.cards.filter(c => c.listId === l.id && !prevCards[c.id]);
    let lid = hasList(prevLists[l.id]) ? prevLists[l.id] : null;
    if (!cards.length && (r || lid)) return;      // rien de nouveau dans cette liste
    if (!lid) {
      const fid = destFolder();
      const nl = { id: uid(), name: l.name, folderId: fid, order: maxOrder(out.lists.filter(x => (x.folderId || null) === fid)) + 1, createdAt: now,
        target: l.lg.target };   // appui : celui du profil du compte (étape 35)
      addLearningTo(out, nl.target);
      out.lists.push(nl);
      lid = nl.id; res.lists++; res.listMap[l.id] = lid;
    }
    cards.forEach(c => {
      const nc = JSON.parse(JSON.stringify(c));
      nc.id = uid(); nc.listId = lid;
      nc.box = 0; nc.dueAt = now; nc.stats = { seen: 0, correct: 0, wrong: 0, lastSeen: null }; delete nc.progress;   // sans progression
      delete nc.image;   // étape 49 : image dans le dossier de l'admin, illisible pour le compte qui reçoit → sans image
      out.cards.push(nc); made.push(nc);
      idMap[c.id] = nc.id; res.cardMap[c.id] = nc.id; res.cards++;
    });
  });
  made.forEach(c => { if (c.ruleId && idMap[c.ruleId]) c.ruleId = idMap[c.ruleId]; });
  res.folderId = folderId !== undefined ? folderId : (r && hasFolder(r.folder_id) ? r.folder_id : null);
  return res;
}
async function tpRun(src, targets, data, recvMap, dest, again) {
  const results = [];
  const pg = openProgress(t("tp.sending"), "0 / " + targets.length);
  for (let i = 0; i < targets.length; i++) {
    const a = targets[i], r = recvMap[a.user_id] || null;
    pg.set(i / targets.length, a.identifiant + " · " + (i + 1) + " / " + targets.length);
    if (r && again === "skip") { results.push({ a, st: "skipped" }); continue; }
    let wrote = false;
    try {
      let out = data[a.user_id] ? JSON.parse(JSON.stringify(data[a.user_id])) : emptyData();
      const res = tpApply(out, src, dest, r);
      if (r && !res.cards && !res.lists) { results.push({ a, st: "uptodate" }); continue; }
      out = normalizeData(out);
      await admWrite(a, out);
      wrote = true;
      await aqRpc("admin_template_record_send", { p_kind: src.kind, p_item: src.id, p_name: src.name, p_user: a.user_id,
        p_mode: r ? "new_only" : "full", p_folder: res.folderId, p_list_map: res.listMap, p_card_map: res.cardMap, p_cards: res.cards, p_lists: res.lists });
      Activity.log("admin_template_send", { target: a.identifiant, template: src.name, mode: r ? "new_only" : "full", cards: res.cards, lists: res.lists });
      results.push({ a, st: r ? "added" : "sent", cards: res.cards, lists: res.lists });
    } catch (e) {
      results.push({ a, st: wrote ? "notrack" : "error", err: st27Missing(e) });
    }
  }
  pg.set(1, "");
  pg.close();
  tpReport(src, results);
  loadAdmin();
  tpLoad();
}
function tpReport(src, results) {
  const c = k => results.filter(x => x.st === k).length;
  const cards = results.reduce((s, x) => s + num(x.cards, 0), 0);
  const wrap = el("div");
  wrap.appendChild(el("p", null, t("tp.sum", { sent: c("sent"), added: c("added"), up: c("uptodate"), skip: c("skipped"), err: c("error") + c("notrack"), cards })));
  const rows = results.map(x => {
    let txt;
    if (x.st === "sent" || x.st === "added") txt = t("tp.r." + x.st, { n: x.cards, l: x.lists });
    else if (x.st === "error" || x.st === "notrack") txt = t("tp.r." + x.st) + (x.err ? " — " + x.err : "");
    else txt = t("tp.r." + x.st);
    return [x.a.identifiant, txt];
  });
  wrap.appendChild(fcTable([t("aq.f.account"), t("tp.result")], rows, 99));
  openModal(t("tp.reportTitle") + " — " + src.name, wrap, [{ label: t("close"), kind: "primary" }]);
}
