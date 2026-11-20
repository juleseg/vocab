"use strict";

// === ADMINISTRATION : MODÉRATEURS (ÉTAPE 66) ===
// Écran #admin-moderateurs (admin et super modérateurs : case « mods.manage »). Liste des modérateurs (catégories, cases à
// lui seul, total), catégories (nom + cases), nommer / modifier / retirer un modo, créer / modifier / supprimer une
// catégorie. Fonctions SQL (claude/supabase-etape66.sql) : mod_admin_overview, mod_accounts_find, mod_member_set,
// mod_member_remove, mod_category_save, mod_category_delete. Le serveur refuse tout ce qui donnerait à un super modo plus
// de pouvoirs que les siens (hint mod_more), une action sur soi-même (mod_self), un super modo nommé par un non-admin
// (mod_super). Chaque changement est noté au journal (admin_mods) sous le nom de la personne.
const amd = { data: null, loading: false, err: "", missing: false, started: false };

function amdRerender() { if (currentScreen === "adminmod") renderAdminMods(); }
async function amdLoad() {
  amd.started = true; amd.loading = true; amd.err = "";
  amdRerender();
  try { amd.data = (await aqRpc("mod_admin_overview")) || null; amd.missing = false; }
  catch (e) { amd.missing = alIsMissing(e); amd.err = amd.missing ? t("mod.missing") : modErrText(e); }
  amd.loading = false;
  amdRerender();
}
// Cases que l'appelant peut donner (null = toutes : admin).
function amdMine() {
  const me = amd.data && amd.data.me;
  return me && me.admin ? null : new Set(arr(me && me.perms));
}
function amdCatName(id) { const c = arr(amd.data && amd.data.categories).find(x => x.id === id); return c ? c.name : "?"; }

function renderAdminMods() {
  const root = $("#screen-adminmod");
  if (!root) return;
  root.textContent = "";
  const back = el("button", "link-btn", t("aq.back"));
  back.addEventListener("click", () => { location.hash = "#" + HASH_OF.admin; });
  root.appendChild(back);
  const top = el("div", "adm-top");
  top.appendChild(el("h2", null, t("mod.title")));
  const ref = el("button", "link-btn", t("admin.refresh"));
  ref.addEventListener("click", amdLoad);
  top.appendChild(ref);
  root.appendChild(top);
  root.appendChild(el("p", "muted", t("mod.help")));
  if (!amd.started) { amdLoad(); return; }
  if (amd.loading && !amd.data) { root.appendChild(el("div", "empty", t("admin.loading"))); return; }
  if (amd.err) root.appendChild(el("div", "card q-err", amd.err));
  if (!amd.data) return;
  const d = amd.data;
  // Modérateurs
  const h1 = el("div", "dash-h mod-h");
  h1.appendChild(el("h3", null, t("mod.members")));
  const add = el("button", "btn primary", t("mod.add")); add.type = "button";
  add.addEventListener("click", amdFind);
  h1.appendChild(add);
  root.appendChild(h1);
  const members = arr(d.members);
  if (!members.length) root.appendChild(el("p", "muted", t("mod.none")));
  members.forEach(m => {
    const c = el("div", "card mod-card");
    const hd = el("div", "adc-h");
    hd.appendChild(el("b", "mod-name", m.identifiant || "?"));
    if (m.super) hd.appendChild(el("span", "tag", t("mod.super")));
    if (m.self) hd.appendChild(el("span", "tag", t("mod.you")));
    if (m.blocked) hd.appendChild(el("span", "tag bad", t("mod.blocked")));
    c.appendChild(hd);
    const cats = arr(m.categories).map(amdCatName);
    c.appendChild(el("div", "muted", t("mod.catsOf", { list: cats.length ? cats.join(", ") : t("mod.noCat") })));
    c.appendChild(el("div", "muted", [arr(m.own_perms).length ? t("mod.ownN", { n: arr(m.own_perms).length }) : "",
      t("mod.permsN", { n: arr(m.perms).filter(p => p.includes(".") && p !== "mods.manage").length })].filter(Boolean).join(" · ")));
    if (m.editable && !m.self) {
      const acts = el("div", "lv-links");
      const ed = el("button", "link-btn", t("mod.edit")); ed.type = "button";
      ed.addEventListener("click", () => amdEditMember(m));
      const rm = el("button", "link-btn danger", t("mod.remove")); rm.type = "button";
      rm.addEventListener("click", () => amdRemove(m));
      acts.append(ed, rm);
      c.appendChild(acts);
    }
    root.appendChild(c);
  });
  // Catégories
  const h2 = el("div", "dash-h mod-h");
  h2.appendChild(el("h3", null, t("mod.cats")));
  const addc = el("button", "btn", t("mod.catAdd")); addc.type = "button";
  addc.addEventListener("click", () => amdEditCat(null));
  h2.appendChild(addc);
  root.appendChild(h2);
  const cats = arr(d.categories);
  if (!cats.length) root.appendChild(el("p", "muted", t("mod.catNone")));
  cats.forEach(cat => {
    const b = el("button", "item mod-cat"); b.type = "button";
    const m = el("div", "main");
    m.appendChild(el("div", "t1", cat.name));
    m.appendChild(el("div", "t2", t("mod.catN", { n: arr(cat.perms).length, m: num(Number(cat.members), 0) })));
    m.appendChild(el("div", "t2 mod-cat-p", arr(cat.perms).map(modPermLabel).join(" · ")));
    b.append(m, el("span", "chev", cat.editable ? "›" : "🔒"));
    b.disabled = !cat.editable;
    b.addEventListener("click", () => amdEditCat(cat));
    root.appendChild(b);
  });
}

// --- Nommer : chercher un compte ---
function amdFind() {
  const wrap = el("div");
  const q = textInput("", t("mod.findPh"));
  q.type = "search";
  const res = el("div", "list mod-find");
  wrap.append(formField(t("mod.find"), q), res);
  let close = null, timer = null, token = 0;
  const run = async () => {
    const my = ++token;
    let r;
    try { r = arr(await aqRpc("mod_accounts_find", { p_query: q.value.trim() })); }
    catch (e) { res.textContent = ""; res.appendChild(el("p", "q-err", modErrText(e))); return; }
    if (my !== token) return;
    res.textContent = "";
    if (!r.length) { res.appendChild(el("p", "muted", t("mod.findNone"))); return; }
    r.forEach(a => {
      const b = el("button", "item"); b.type = "button";
      const m = el("div", "main");
      m.appendChild(el("div", "t1", a.identifiant));
      if (a.admin || a.mod) m.appendChild(el("div", "t2", t(a.admin ? "mod.isAdmin" : "mod.isMod")));
      b.append(m, el("span", "chev", "›"));
      b.disabled = !!a.admin || a.user_id === auth.sbUid;
      b.addEventListener("click", () => {
        if (close) close();
        const ex = arr(amd.data && amd.data.members).find(x => x.user_id === a.user_id);
        amdEditMember(ex || { user_id: a.user_id, identifiant: a.identifiant, super: false, categories: [], own_perms: [], editable: true });
      });
      res.appendChild(b);
    });
  };
  q.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(run, 250); });
  close = openModal(t("mod.add"), wrap, [{ label: t("cancel") }]);
  run();
  setTimeout(() => { try { q.focus(); } catch (e) {} }, 50);
}

// --- Modifier un modérateur : super (admin seulement), catégories, cases à lui seul ---
function amdEditMember(m) {
  const me = (amd.data && amd.data.me) || {};
  const mine = amdMine();
  const wrap = el("div", "mod-edit");
  let sup = null;
  if (me.admin) {
    const lab = el("label", "mod-perm mod-super");
    sup = el("input"); sup.type = "checkbox"; sup.checked = !!m.super;
    lab.append(sup, el("span", "mod-perm-t", t("mod.super")));
    wrap.appendChild(lab);
    wrap.appendChild(el("p", "hint", t("mod.superHelp")));
  }
  wrap.appendChild(el("h4", "adc-sub", t("mod.memberCats")));
  const catSel = new Set(arr(m.categories));
  const cats = arr(amd.data && amd.data.categories);
  if (!cats.length) wrap.appendChild(el("p", "muted", t("mod.catNone")));
  cats.forEach(c => {
    const lab = el("label", "mod-perm");
    const cb = el("input"); cb.type = "checkbox"; cb.checked = catSel.has(c.id); cb.disabled = !c.editable;
    cb.addEventListener("change", () => { if (cb.checked) catSel.add(c.id); else catSel.delete(c.id); });
    lab.append(cb, el("span", "mod-perm-t", c.name), el("span", "mod-perm-k muted", t("mod.catN", { n: arr(c.perms).length, m: num(Number(c.members), 0) })));
    if (!c.editable) { lab.classList.add("mod-perm-off"); lab.title = t("mod.notMine"); }
    wrap.appendChild(lab);
  });
  wrap.appendChild(el("h4", "adc-sub", t("mod.memberOwn")));
  const own = new Set(arr(m.own_perms));
  wrap.appendChild(modPermGrid(own, mine));
  const err = el("p", "q-err"); err.hidden = true;
  wrap.appendChild(err);
  let busy = false, close = null;
  const save = async () => {
    if (busy) return false;
    busy = true; err.hidden = true;
    try {
      await aqRpc("mod_member_set", { p_user: m.user_id, p_super: sup ? sup.checked : !!m.super, p_categories: [...catSel], p_own: [...own] });
      toast(t("mod.saved"));
      if (close) close();
      if (m.user_id === auth.sbUid) Mod.refresh(true);
      amdLoad();
    } catch (e) { err.textContent = modErrText(e); err.hidden = false; }
    busy = false;
    return false;
  };
  close = openModal(t("mod.memberTitle", { id: m.identifiant || "?" }), wrap, [
    { label: t("cancel") },
    { label: t("save"), kind: "primary", onClick: () => { save(); return false; } }
  ]);
}

function amdRemove(m) {
  openModal(t("mod.remove"), el("p", null, t("mod.removeAsk", { id: m.identifiant || "?" })), [
    { label: t("cancel") },
    { label: t("mod.remove"), kind: "danger", onClick: () => {
      aqRpc("mod_member_remove", { p_user: m.user_id })
        .then(() => { toast(t("mod.removed", { id: m.identifiant || "?" })); amdLoad(); })
        .catch(e => toast(modErrText(e)));
    } }
  ]);
}

// --- Créer / modifier une catégorie ---
function amdEditCat(cat) {
  const mine = amdMine();
  const wrap = el("div", "mod-edit");
  const name = textInput(cat ? cat.name : "", t("mod.catNamePh"));
  name.maxLength = 60;
  wrap.appendChild(formField(t("mod.catName"), name));
  const sel = new Set(arr(cat && cat.perms));
  wrap.appendChild(modPermGrid(sel, mine));
  const err = el("p", "q-err"); err.hidden = true;
  wrap.appendChild(err);
  let busy = false, close = null;
  const save = async () => {
    if (busy) return false;
    busy = true; err.hidden = true;
    try {
      await aqRpc("mod_category_save", { p_id: cat ? cat.id : null, p_name: name.value.trim(), p_perms: [...sel] });
      toast(t("mod.saved"));
      if (close) close();
      Mod.refresh(true);
      amdLoad();
    } catch (e) { err.textContent = modErrText(e); err.hidden = false; }
    busy = false;
    return false;
  };
  const acts = [{ label: t("cancel") }];
  if (cat) acts.push({ label: t("mod.catDel"), kind: "danger", onClick: () => { setTimeout(() => amdDeleteCat(cat), 0); } });
  acts.push({ label: t("save"), kind: "primary", onClick: () => { save(); return false; } });
  close = openModal(cat ? t("mod.catTitle", { name: cat.name }) : t("mod.catTitleNew"), wrap, acts);
}

function amdDeleteCat(cat) {
  openModal(t("mod.catDel"), el("p", null, t("mod.catDelAsk", { name: cat.name })), [
    { label: t("cancel") },
    { label: t("mod.catDel"), kind: "danger", onClick: () => {
      aqRpc("mod_category_delete", { p_id: cat.id })
        .then(() => { toast(t("mod.catDeleted")); Mod.refresh(true); amdLoad(); })
        .catch(e => toast(modErrText(e)));
    } }
  ]);
}
