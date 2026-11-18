"use strict";

// === ADMINISTRATION ===
// Écran #admin, visible seulement par l'admin (mode Supabase, compte présent dans la table admins).
// Liste des comptes (fonction admin_list_accounts), réinitialiser le PIN (admin_reset_pin : changement obligatoire ensuite),
// exporter / importer les données d'un compte, copier des dossiers ou des listes vers un autre compte,
// supprimer un compte (admin_delete_account, double confirmation). Les fonctions SQL vérifient que l'appelant est admin.
// Étape 26 : toucher un compte de la liste ouvre sa fiche (#admin-fiche, voir « Fiche d'un compte » plus bas) ;
// les actions (PIN, export, import, copie, suppression) restent dans le menu « Actions… » de la fiche.
// Étape 27 : bloquer / réactiver (menu « Actions… » de la fiche, état visible dans la liste et la fiche), annonces
// (#admin-annonces) et listes modèles (#admin-modeles) — voir « Gestion des comptes (admin, étape 27) » plus bas.
// Données d'un autre compte : lignes user_data lues / écrites directement (RLS : accès total pour l'admin).
// Si ce compte est ouvert sur un autre appareil, il verra un conflit à son prochain envoi (choix des données à garder).
// Étape 27 : adm.blocked = { user_id: { reason, at } } (fonction admin_blocked_accounts) ; adm.blockMissing = script pas lancé.
const adm = { list: null, loading: false, error: false, focus: null, blocked: {}, blockMissing: false };

// Date au format AAAA-MM-JJ (exports CSV), vide si absente.
function admDay(ts) { if (!ts) return ""; const d = new Date(ts); return isNaN(d) ? String(ts).slice(0, 10) : todayStr(d); }
function admDate(ts) {
  if (!ts) return t("admin.never");
  try { return new Date(ts).toLocaleDateString(state.settings.uiLang); } catch (e) { return String(ts).slice(0, 10); }
}
// Liste des comptes : écran #admin-comptes (depuis l'étape 25, l'accueil de l'Administration est le tableau de bord).
// adm.focus = compte à montrer (lien « voir le compte » du tableau de bord) : ligne mise en évidence et amenée à l'écran.
function renderAdminAccounts() {
  const root = $("#screen-adminacc");
  if (!root) return;
  root.textContent = "";
  const back = el("button", "link-btn", t("aq.back"));
  back.addEventListener("click", () => { location.hash = "#" + HASH_OF.admin; });
  root.appendChild(back);
  const top = el("div", "adm-top");
  top.appendChild(el("h2", null, t("dash.accounts")));
  const ref = el("button", "link-btn", t("admin.refresh"));
  ref.addEventListener("click", loadAdmin);
  top.appendChild(ref);
  root.appendChild(top);
  if (!adm.list && !adm.loading && !adm.error) { loadAdmin(); return; }
  if (adm.loading) { root.appendChild(el("div", "empty", t("admin.loading"))); return; }
  if (adm.error || !adm.list) { root.appendChild(el("div", "empty", t("admin.error"))); return; }
  if (!adm.list.length) { root.appendChild(el("div", "empty", t("admin.empty"))); return; }
  if (adm.blockMissing) root.appendChild(el("div", "card q-err", t("st27.missing")));
  const bar = el("div", "al-bar");
  bar.appendChild(el("span", "muted", t("dash.nAccounts", { n: adm.list.length })));
  const csv = el("button", "btn", t("dash.csv"));
  csv.addEventListener("click", adminAccountsCsv);
  bar.appendChild(csv);
  root.appendChild(bar);
  const box = el("div", "items");
  let focusRow = null;
  adm.list.forEach(a => {
    const row = el("button", "item" + (adm.focus === a.user_id ? " adm-focus" : ""));
    const main = el("div", "main");
    main.appendChild(el("div", "t1", a.identifiant));
    main.appendChild(el("div", "t2", [t("admin.created", { d: admDate(a.created_at) }), t("admin.last", { d: admDate(a.last_login) }), t("admin.cards", { n: num(Number(a.nb_cartes), 0) })].join(" · ")));
    const tags = el("div", "adm-tags");
    if (a.user_id === auth.sbUid) tags.appendChild(el("span", "tag", t("admin.you")));
    if (a.est_admin) tags.appendChild(el("span", "tag", t("admin.isAdmin")));
    if (a.pin_a_changer) tags.appendChild(el("span", "tag warn", t("admin.mustChange")));
    if (admIsBlocked(a.user_id)) tags.appendChild(el("span", "tag bad", t("blk.tag")));
    if (tags.childNodes.length) main.appendChild(tags);
    row.append(main, el("span", "chev", "›"));
    row.addEventListener("click", () => openAccountFiche(a.user_id, "adminacc"));   // fiche du compte (étape 26)
    if (adm.focus === a.user_id) focusRow = row;
    box.appendChild(row);
  });
  root.appendChild(box);
  if (focusRow) {
    const r = focusRow;
    setTimeout(() => { try { r.scrollIntoView({ block: "center" }); } catch (e) {} }, 0);
  } else if (adm.focus) toast(t("dash.accGone"));
  adm.focus = null;   // une seule fois
}
async function loadAdmin() {
  adm.loading = true; adm.error = false;
  if (currentScreen === "adminacc") renderAdminAccounts();
  try { adm.list = arr(await Supa.listAccounts()); }
  catch (e) { adm.list = null; adm.error = true; }
  await admLoadBlocked();
  adm.loading = false;
  if (currentScreen === "adminacc") renderAdminAccounts();
  else if (currentScreen === "admin") renderAdmin();
  alCleanup();   // journal : événements de plus de 90 jours effacés (une fois par ouverture de l'appli)
}
// Comptes bloqués (étape 27). Script pas lancé : adm.blockMissing, la liste des comptes marche comme avant.
async function admLoadBlocked() {
  try {
    const m = {};
    arr(await aqRpc("admin_blocked_accounts")).forEach(b => { if (b && b.user_id) m[b.user_id] = { reason: String(b.blocked_reason || ""), at: b.blocked_at || null }; });
    adm.blocked = m; adm.blockMissing = false;
  } catch (e) { adm.blocked = {}; adm.blockMissing = alIsMissing(e); }
}
function admIsBlocked(userId) { return !!(adm.blocked && adm.blocked[userId]); }
// Export CSV de la liste des comptes.
function adminAccountsCsv() {
  const yes = t("dash.yes"), no = "";
  const rows = arr(adm.list).map(a => [a.identifiant, admDay(a.created_at), admDay(a.last_login), num(Number(a.nb_cartes), 0),
    a.est_admin ? yes : no, a.pin_a_changer ? yes : no, admIsBlocked(a.user_id) ? yes : no, admIsBlocked(a.user_id) ? adm.blocked[a.user_id].reason : ""]);
  dashSaveCsv("comptes", [t("aq.f.account"), t("dash.c.created"), t("dash.c.last"), t("dash.c.cards"), t("admin.isAdmin"), t("admin.mustChange"),
    t("blk.tag"), t("blk.reason")], rows);
}
function adminActions(a) {
  const self = a.user_id === auth.sbUid;
  const acts = [];
  if (!self) acts.push({ label: t("admin.resetPin"), onClick: () => { setTimeout(() => adminResetPin(a), 0); } });
  // Étape 27 : bloquer / réactiver (jamais son propre compte)
  if (!self && admIsBlocked(a.user_id)) acts.push({ label: t("blk.unblock"), onClick: () => { setTimeout(() => adminUnblock(a), 0); } });
  else if (!self) acts.push({ label: t("blk.block"), kind: "danger", onClick: () => { setTimeout(() => adminBlock(a), 0); } });
  // Étape 28 : série du compte (raison obligatoire, notée dans sa clé streak et au journal)
  acts.push({ label: "🔥 " + t("sk.adm.set"), onClick: () => { setTimeout(() => skAdmin(a, "set"), 0); } });
  acts.push({ label: "🔥 " + t("sk.adm.restore"), onClick: () => { setTimeout(() => skAdmin(a, "restore"), 0); } });
  acts.push({ label: "❄️ " + t("sk.adm.freezes"), onClick: () => { setTimeout(() => skAdmin(a, "freezes"), 0); } });
  acts.push({ label: t("admin.export"), onClick: () => { adminExport(a); } });
  acts.push({ label: t("admin.import"), onClick: () => { setTimeout(() => adminImport(a), 0); } });
  if (adm.list.length > 1) acts.push({ label: t("admin.copy"), onClick: () => { adminCopy(a); } });
  acts.push({ label: t("al.devices"), onClick: () => { setTimeout(() => adminDevices(a), 0); } });
  acts.push({ label: t("al.open"), onClick: () => { al.f.user = a.user_id; al.page = 0; al.data = null; al.err = ""; location.hash = "#" + HASH_OF.adminlog; } });
  if (!self) acts.push({ label: t("admin.delete"), kind: "danger", onClick: () => { setTimeout(() => adminDelete(a), 0); } });
  acts.push({ label: t("close") });
  openModal(a.identifiant, null, acts);
}
// Données d'un compte (le sien : les données ouvertes). null si le compte n'a encore rien enregistré.
async function admRead(a) {
  if (a.user_id === auth.sbUid) return state;
  const raw = Storage.unpackRows(await Supa.readRows(a.user_id));
  return raw ? normalizeData(raw) : null;
}
async function admWrite(a, data) {
  if (a.user_id === auth.sbUid) { state = data; Shared.attach(state); applyTheme(); commit(); return; }
  data.updatedAt = Date.now();
  await Supa.writeRows(a.user_id, Storage.packRows(data, a.identifiant));
}
async function adminExport(a) {
  try {
    const d = await admRead(a);
    if (!d) { toast(t("admin.noData")); return; }
    await exportData(d, "vocabulaire-" + a.identifiant + "-" + todayStr() + ".json");
    Activity.log("admin_export", { target: a.identifiant });
  } catch (e) { toast(t("admin.err")); }
}
function adminImport(a) {
  if (a.user_id === auth.sbUid) { openImport(); return; }
  openImport({
    id: a.identifiant,
    apply: async data => { await admWrite(a, data); Activity.log("admin_import", { target: a.identifiant, cards: arr(data && data.cards).length }); loadAdmin(); }
  });
}
function adminResetPin(a) {
  const f = { n1: "", n2: "" };
  const wrap = el("div");
  wrap.appendChild(formField(t("pin.new"), pinInput("", v => { f.n1 = v; })));
  wrap.appendChild(formField(t("pin.new2"), pinInput("", v => { f.n2 = v; })));
  let close = null;
  close = openModal(t("admin.resetPin") + " — " + a.identifiant, wrap, [
    { label: t("cancel") },
    { label: t("confirm"), kind: "primary", onClick: () => {
      if (!validPin(f.n1)) { toast(t("auth.err.pin")); return false; }
      if (f.n1 !== f.n2) { toast(t("auth.err.pin2")); return false; }
      (async () => {
        try { await Supa.resetPin(a.user_id, await Supa.password(a.identifiant, f.n1)); toast(t("admin.resetDone")); Activity.log("admin_reset_pin", { target: a.identifiant }); loadAdmin(); }
        catch (e) { toast(t("admin.err")); }
      })();
    } }
  ]);
}
function adminDelete(a) {
  const run = async () => {
    try { if (typeof Images !== "undefined") await Images.purgeUser(a.user_id);   // étape 49 : images du compte supprimées
      await Supa.deleteAccount(a.user_id); toast(t("admin.delDone")); Activity.log("admin_delete", { target: a.identifiant }); loadAdmin(); }
    catch (e) { toast(t("admin.err")); }
  };
  openModal(t("admin.delete"), el("p", null, t("admin.del1", { id: a.identifiant })), [
    { label: t("cancel") },
    { label: t("admin.delete"), kind: "danger", onClick: () => {
      setTimeout(() => openModal(t("admin.delete"), el("p", null, t("admin.del2", { id: a.identifiant })), [
        { label: t("cancel") },
        { label: t("admin.delete"), kind: "danger", onClick: () => { run(); } }
      ]), 0);
    } }
  ]);
}
// --- Bloquer / réactiver un compte (étape 27) : admin_block_account (raison obligatoire), admin_unblock_account ---
// Le compte bloqué voit l'écran « Compte bloqué » à sa prochaine connexion (ou ouverture) ; ses données sont gardées.
function admAfterBlock() {
  loadAdmin();
  if (currentScreen === "adminfiche") { fc.started = false; renderAdminFiche(); }
}
function admBlockErr(e) {
  if (alIsMissing(e)) return t("st27.missing");
  const h = String((e && e.hint) || "");
  if (h === "self") return t("blk.err.self");
  if (h === "reason") return t("blk.err.reason");
  if (h === "gone") return t("dash.accGone");
  return aqErrText(e);
}
function adminBlock(a) {
  if (a.user_id === auth.sbUid) { toast(t("blk.err.self")); return; }
  const wrap = el("div");
  wrap.appendChild(el("p", null, t("blk.ask", { id: a.identifiant })));
  const ta = el("textarea", "input blk-ta");
  ta.maxLength = 300; ta.rows = 3;
  wrap.appendChild(formField(t("blk.reason"), ta, true, t("blk.reasonHint")));
  let busy = false;
  const close = openModal(t("blk.block") + " — " + a.identifiant, wrap, [
    { label: t("cancel") },
    { label: t("blk.block"), kind: "danger", onClick: () => {
      const reason = ta.value.trim();
      if (!reason) { toast(t("blk.err.reason")); ta.focus(); return false; }
      if (busy) return false;
      busy = true;
      (async () => {
        try {
          await aqRpc("admin_block_account", { p_user: a.user_id, p_reason: reason });
          Activity.log("admin_block", { target: a.identifiant, reason: reason.slice(0, 100) });
          toast(t("blk.done", { id: a.identifiant }));
          close();
          admAfterBlock();
        } catch (e) { busy = false; toast(admBlockErr(e)); }
      })();
      return false;
    } }
  ]);
  setTimeout(() => { try { ta.focus(); } catch (e) {} }, 50);
}
function adminUnblock(a) {
  const b = adm.blocked[a.user_id] || {};
  const wrap = el("div");
  wrap.appendChild(el("p", null, t("blk.askUnblock", { id: a.identifiant })));
  if (b.reason) wrap.appendChild(el("p", "muted", t("blk.reason") + " : " + b.reason));
  openModal(t("blk.unblock") + " — " + a.identifiant, wrap, [
    { label: t("cancel") },
    { label: t("blk.unblock"), kind: "primary", onClick: () => {
      (async () => {
        try {
          await aqRpc("admin_unblock_account", { p_user: a.user_id });
          Activity.log("admin_unblock", { target: a.identifiant });
          toast(t("blk.undone", { id: a.identifiant }));
          admAfterBlock();
        } catch (e) { toast(admBlockErr(e)); }
      })();
    } }
  ]);
}

// --- Série d'un compte (étape 28) : admin_streak_get, puis admin_streak_set / _restore / _freezes ---
// La modification est écrite par Supabase dans la clé streak du compte (adjustments) et notée au journal (admin_streak_*) ;
// l'appli du compte l'applique et affiche un message à son lancement suivant. Script pas lancé : « Lancez le script… ».
function skAdmErr(e) {
  if (alIsMissing(e)) return t("st28.missing");
  const h = String((e && e.hint) || "");
  if (["reason", "value", "nolost", "freezes_max", "freezes_min"].includes(h)) return t("sk.adm.err." + h);
  if (h === "gone") return t("dash.accGone");
  return aqErrText(e);
}
async function skAdmin(a, kind) {
  let info;
  try { info = await aqRpc("admin_streak_get", { p_user: a.user_id, p_tz: dashTz() }); }
  catch (e) { toast(skAdmErr(e)); return; }
  if (!info) { toast(t("dash.accGone")); return; }
  const sk = info.streak || {}, cur = num(Number(sk.current), 0), fr = num(Number(sk.freezes), 0), lostV = num(Number(sk.lost_value), 0);
  if (kind === "restore" && lostV <= 0) { toast(t("sk.adm.err.nolost")); return; }
  const wrap = el("div");
  wrap.appendChild(el("p", "sk-adm-cur", t("sk.adm.cur", { n: cur, b: num(Number(sk.best), 0), f: fr, m: STREAK_MAX_FREEZES })));
  const f = { value: cur, delta: 0 };
  if (kind === "set") {
    const inp = el("input", "input");
    inp.type = "number"; inp.min = "0"; inp.max = "10000"; inp.inputMode = "numeric"; inp.value = String(cur);
    inp.addEventListener("input", () => { f.value = inp.value; });
    wrap.appendChild(formField(t("sk.adm.newValue"), inp, true));
  } else if (kind === "restore") {
    wrap.appendChild(el("p", null, t("sk.adm.restoreAsk", { n: lostV + cur, l: lostV,
      d: sk.lost_day ? dashBucketLabel(sk.lost_day, false, true) : "?" })));
  } else {
    const seg = el("div", "sk-seg");
    [-2, -1, 1, 2].forEach(d => {
      const b = el("button", null, (d > 0 ? "+" : "−") + Math.abs(d));
      b.type = "button";
      const ok = fr + d >= 0 && fr + d <= STREAK_MAX_FREEZES;
      b.disabled = !ok;
      b.setAttribute("aria-pressed", "false");
      b.addEventListener("click", () => { f.delta = d; seg.querySelectorAll("button").forEach(x => x.setAttribute("aria-pressed", String(x === b))); });
      seg.appendChild(b);
    });
    wrap.appendChild(formField(t("sk.adm.delta"), seg, true, t("sk.adm.deltaHint", { m: STREAK_MAX_FREEZES })));
  }
  const ta = el("textarea", "input blk-ta");
  ta.maxLength = 300; ta.rows = 3;
  wrap.appendChild(formField(t("blk.reason"), ta, true, t("sk.adm.reasonHint")));
  let busy = false;
  const title = t("sk.adm." + kind) + " — " + a.identifiant;
  const close = openModal(title, wrap, [
    { label: t("cancel") },
    { label: t("sk.adm.apply"), kind: "primary", onClick: () => {
      const reason = ta.value.trim();
      if (kind === "set" && (!/^\d{1,5}$/.test(String(f.value).trim()) || Number(f.value) > 10000)) { toast(t("sk.adm.err.value")); return false; }
      if (kind === "freezes" && !f.delta) { toast(t("sk.adm.err.value")); return false; }
      if (!reason) { toast(t("sk.adm.err.reason")); ta.focus(); return false; }
      if (busy) return false;
      busy = true;
      (async () => {
        try {
          const args = { p_user: a.user_id, p_reason: reason, p_tz: dashTz() };
          let r;
          if (kind === "set") r = await aqRpc("admin_streak_set", Object.assign(args, { p_value: Number(f.value) }));
          else if (kind === "restore") r = await aqRpc("admin_streak_restore", args);
          else r = await aqRpc("admin_streak_freezes", Object.assign(args, { p_delta: f.delta }));
          const ns = (r && r.streak) || {};
          toast(t("sk.adm.done", { id: a.identifiant, n: num(Number(ns.current), 0), f: num(Number(ns.freezes), 0) }));
          close();
          if (currentScreen === "adminfiche") { fc.started = false; renderAdminFiche(); }
          else if (currentScreen === "admin") loadAdmin();
        } catch (e) { busy = false; toast(skAdmErr(e)); }
      })();
      return false;
    } }
  ]);
  setTimeout(() => { try { (wrap.querySelector("input") || ta).focus(); } catch (e) {} }, 50);
}

// Copie de dossiers et de listes vers un autre compte : nouvelles cartes sans progression.
// Les langues effectives sont recopiées (les réglages par défaut des deux comptes peuvent différer).
async function adminCopy(src) {
  let d;
  try { d = await admRead(src); } catch (e) { toast(t("admin.err")); return; }
  if (!d || !d.lists.length) { toast(t("admin.noData")); return; }
  const others = adm.list.filter(x => x.user_id !== src.user_id);
  const selF = new Set(), selL = new Set();
  const wrap = el("div");
  wrap.appendChild(el("p", "muted", t("admin.copyWhat")));
  const pick = el("div", "adm-pick");
  const byOrder = (x, y) => num(x.order, 0) - num(y.order, 0);
  const listBoxes = new Map();
  const checkRow = (label, cls, onChange) => {
    const r = el("label", "check" + (cls ? " " + cls : ""));
    const cb = el("input"); cb.type = "checkbox";
    cb.addEventListener("change", () => onChange(cb.checked));
    r.append(cb, el("span", null, label));
    pick.appendChild(r);
    return cb;
  };
  const listRow = (l, sub) => {
    const cb = checkRow(l.name + " (" + d.cards.filter(c => c.listId === l.id).length + ")", sub ? "sub" : "", v => { if (v) selL.add(l.id); else selL.delete(l.id); });
    listBoxes.set(l.id, cb);
  };
  d.folders.slice().sort(byOrder).forEach(f => {
    const lists = d.lists.filter(l => l.folderId === f.id).sort(byOrder);
    checkRow("📁 " + f.name, "", v => {
      if (v) selF.add(f.id); else selF.delete(f.id);
      lists.forEach(l => { const cb = listBoxes.get(l.id); if (cb) { cb.checked = v; if (v) selL.add(l.id); else selL.delete(l.id); } });
    });
    lists.forEach(l => listRow(l, true));
  });
  const loose = d.lists.filter(l => !l.folderId || !d.folders.some(f => f.id === l.folderId)).sort(byOrder);
  if (loose.length && d.folders.length) pick.appendChild(el("div", "hint", t("admin.noFolder")));
  loose.forEach(l => listRow(l, false));
  wrap.appendChild(pick);
  const sel = el("select", "input");
  others.forEach(o => { const op = el("option", null, o.identifiant); op.value = o.user_id; sel.appendChild(op); });
  wrap.appendChild(formField(t("admin.copyTo"), sel, false, t("admin.copyHint")));
  openModal(t("admin.copy"), wrap, [
    { label: t("cancel") },
    { label: t("confirm"), kind: "primary", onClick: () => {
      if (!selF.size && !selL.size) { toast(t("admin.copyNone")); return false; }
      const dest = others.find(o => o.user_id === sel.value);
      if (!dest) return false;
      runAdminCopy(d, dest, selF, selL);
    } }
  ]);
}
async function runAdminCopy(d, dest, selF, selL) {
  try {
    let out = await admRead(dest);
    out = out ? JSON.parse(JSON.stringify(out)) : emptyData();
    const acct = { target: accountTarget(d.settings) };   // langue apprise par défaut du compte source (étape 35)
    const now = Date.now();
    const maxOrder = a => a.reduce((m, x) => Math.max(m, num(x.order, 0)), 0);
    let fo = maxOrder(out.folders), lo = maxOrder(out.lists);
    const fMap = {}, lMap = {};
    d.folders.filter(f => selF.has(f.id)).forEach(f => {
      const lg = resolveLangs([acct, f]);
      const nf = { id: uid(), name: f.name, order: ++fo, target: lg.target };
      addLearningTo(out, lg.target);
      fMap[f.id] = nf.id; out.folders.push(nf);
    });
    d.lists.filter(l => selL.has(l.id)).forEach(l => {
      const f = l.folderId ? d.folders.find(x => x.id === l.folderId) : null;
      const nl = { id: uid(), name: l.name, folderId: (l.folderId && fMap[l.folderId]) || null, order: ++lo, createdAt: now };
      if (l.target) nl.target = l.target;
      else if (!nl.folderId) nl.target = resolveLangs([acct, f, l]).target;
      if (supportOverride(l) !== undefined) nl.support = l.support;   // appui propre à la liste (étape 35)
      if (nl.target) addLearningTo(out, nl.target);
      lMap[l.id] = nl.id; out.lists.push(nl);
    });
    let n = 0;
    const idMap = {};
    d.cards.forEach(c => {
      if (!lMap[c.listId]) return;
      const nc = JSON.parse(JSON.stringify(c));
      nc.id = uid(); nc.listId = lMap[c.listId];
      nc.box = 0; nc.dueAt = now; nc.stats = { seen: 0, correct: 0, wrong: 0, lastSeen: null }; delete nc.progress;
      delete nc.image;   // étape 49 : image dans le dossier de l'autre compte, illisible pour celui-ci → copie sans image
      out.cards.push(nc); n++;
      idMap[c.id] = nc.id;
    });
    out.cards.forEach(c => { if (c.ruleId && idMap[c.ruleId]) c.ruleId = idMap[c.ruleId]; }); // lien vers la règle copiée
    out = normalizeData(out);
    await admWrite(dest, out);
    toast(t("admin.copyDone", { folders: Object.keys(fMap).length, lists: Object.keys(lMap).length, cards: n, id: dest.identifiant }));
    Activity.log("admin_copy", { target: dest.identifiant, folders: Object.keys(fMap).length, lists: Object.keys(lMap).length, cards: n });
    loadAdmin();
  } catch (e) { toast(t("admin.err")); }
}
