"use strict";

// === ADMINISTRATION : IDÉES (étape 52) ===
// Écran #admin-idees (admin, mode Supabase). Fonctions SQL du script supabase-etape52.sql (security definer, contrôle
// is_admin()) : admin_ideas_list (filtres, 50 par page), admin_idea_detail (ouvrir une idée « nouvelle » la passe à « vue »),
// admin_idea_set (état + réponse), admin_idea_reward (seulement retenue / faite, raison obligatoire, une par idée),
// admin_ideas_export, admin_ideas_new_count (tableau de bord). Chaque action est notée au journal par le serveur (admin_idea).
// Textes : js/i18n/ideas-<langue>.js (clés aix.*).
// - Liste : la plus récente d'abord, 50 par page (seule la page affichée est dans le DOM) : catégorie, état, titre, début du
//   texte, compte, date, récompense. Filtres : état (à traiter = nouvelles et vues, par défaut), catégorie, compte, période.
// - Détail (toucher une ligne) : texte complet, compte (→ fiche), état (liste), réponse (500 caractères, langue libre),
//   « Enregistrer » ; « 🎁 Récompenser » (idée retenue ou faite, sans récompense) : XP 50 / 100 / 200 ou valeur libre ≤ 500,
//   0 à 2 gels, badge « Idée retenue », raison obligatoire, aperçu du message vu par l'auteur, confirmation.
// - Export CSV (mêmes filtres, textes complets ; séparateur « ; », UTF-8 avec BOM).
// - Fiche d'un compte : section « Idées » (fcIdeas, chargée par fcLoad).
// - Script pas lancé : « Lancez le script SQL de l'étape 52 ».
const AIX_PAGE = 50;
const AIX_XP = [50, 100, 200];
const aix = { f: { status: "open", cat: "", user: "", days: "" }, page: 0, data: null, loading: false, err: "", missing: false, newCount: null };

function aixRerender() { if (currentScreen === "adminidea") renderAdminIdeas(); }
function aixErrText(e) {
  if (Ideas.isMissing(e)) return t("aix.missing");
  const h = String((e && e.hint) || "");
  if (/^idea_/.test(h) && I18N.fr["ix.err." + h]) return t("ix.err." + h);
  return aqErrText(e);
}
function aixDays(v) { return v === "7" ? 7 : v === "30" ? 30 : v === "90" ? 90 : null; }
function aixArgs() {
  return { p_status: aix.f.status || null, p_category: aix.f.cat || null, p_user: aix.f.user || null, p_days: aixDays(aix.f.days) };
}
function aixCat(c) { return t("ix.cat." + (IX_CATS.includes(c) ? c : "other")); }
function aixStatus(s) { return t("ix.st." + (IX_STATUS.includes(s) ? s : "new")); }
function aixRewardText(rw) {
  if (!rw) return "";
  return Ideas.rewardText({ xp: num(Number(rw.xp), 0), freezes: num(Number(rw.freezes), 0), badgeAsked: !!rw.badge });
}
// Ouvre l'écran avec un filtre (tableau de bord : nouvelles ; fiche : un compte).
function aixOpenWith(f) {
  aix.f = Object.assign({ status: "open", cat: "", user: "", days: "" }, f || {});
  aix.page = 0; aix.data = null; aix.err = "";
  location.hash = "#" + HASH_OF.adminidea;
  if (currentScreen === "adminidea") aixLoad();
}

async function aixLoad() {
  aix.loading = true; aix.err = "";
  aixRerender();
  if (!adm.list) { try { adm.list = arr(await Supa.listAccounts()); } catch (e) {} }   // comptes du filtre
  try {
    const r = await aqRpc("admin_ideas_list", Object.assign(aixArgs(), { p_page: aix.page, p_size: AIX_PAGE }));
    aix.missing = false;
    aix.data = { total: num(Number(r && r.total), 0), counts: (r && r.counts) || {}, rows: arr(r && r.rows) };
    aix.newCount = num(Number(aix.data.counts.new), aix.newCount);
    const pages = Math.max(1, Math.ceil(aix.data.total / AIX_PAGE));
    if (aix.page > pages - 1 && aix.page > 0) { aix.page = pages - 1; aix.loading = false; return aixLoad(); }
  } catch (e) { aix.data = null; aix.missing = Ideas.isMissing(e); aix.err = aixErrText(e); }
  aix.loading = false;
  aixRerender();
}
// Compteur « nouvelles idées » (tableau de bord). null = script absent ou erreur (rien d'affiché).
async function aixLoadNewCount() {
  try { aix.newCount = num(Number(await aqRpc("admin_ideas_new_count")), 0); }
  catch (e) { aix.newCount = null; }
  return aix.newCount;
}

function renderAdminIdeas() {
  const root = $("#screen-adminidea");
  if (!root) return;
  root.textContent = "";
  const back = el("button", "link-btn", t("aq.back"));
  back.addEventListener("click", () => { location.hash = "#" + HASH_OF.admin; });
  root.appendChild(back);
  const top = el("div", "adm-top");
  top.appendChild(el("h2", null, "💡 " + t("aix.title")));
  const ref = el("button", "link-btn", t("admin.refresh"));
  ref.addEventListener("click", aixLoad);
  top.appendChild(ref);
  root.appendChild(top);
  if (!aix.data && !aix.loading && !aix.err) { aixLoad(); return; }
  if (aix.missing) { root.appendChild(el("div", "card q-err", t("aix.missing"))); return; }
  root.appendChild(el("p", "q-note", t("aix.help")));
  root.appendChild(aixFilters());
  if (aix.loading && !aix.data) { root.appendChild(el("div", "empty", t("admin.loading"))); return; }
  if (aix.err) { root.appendChild(el("div", "card q-err", aix.err)); return; }
  if (!aix.data) return;
  const c = aix.data.counts;
  const chips = el("div", "adm-tags");
  [["new", "bad"], ["seen", ""], ["kept", "ok"], ["done", "ok"], ["refused", ""]].forEach(([s, cls]) => {
    chips.appendChild(el("span", "tag" + (cls ? " " + cls : ""), aixStatus(s) + " : " + num(Number(c[s]), 0)));
  });
  root.appendChild(chips);
  const bar = el("div", "al-bar");
  bar.appendChild(el("span", "muted", t("aix.count", { n: aix.data.total })));
  const csv = el("button", "btn", t("aix.csv"));
  csv.disabled = !aix.data.total;
  csv.addEventListener("click", aixExportCsv);
  bar.appendChild(csv);
  root.appendChild(bar);
  if (!aix.data.rows.length) { root.appendChild(el("div", "empty", t("aix.none"))); return; }
  const pages = Math.max(1, Math.ceil(aix.data.total / AIX_PAGE));
  const pager = () => {
    if (pages < 2) return null;
    const w = el("div", "pv-pager");
    const prev = el("button", "btn", "‹"), next = el("button", "btn", "›");
    prev.setAttribute("aria-label", t("pv.prev")); next.setAttribute("aria-label", t("pv.next"));
    prev.disabled = aix.page === 0 || aix.loading; next.disabled = aix.page >= pages - 1 || aix.loading;
    const go = d => { aix.page += d; aixLoad().then(() => window.scrollTo(0, 0)); };
    prev.addEventListener("click", () => go(-1));
    next.addEventListener("click", () => go(1));
    w.append(prev, el("span", null, t("pv.page", { i: aix.page + 1, n: pages })), next);
    return w;
  };
  const p1 = pager(); if (p1) root.appendChild(p1);
  const list = el("div", "al-list");
  aix.data.rows.forEach(r => list.appendChild(aixRow(r, true)));
  root.appendChild(list);
  const p2 = pager(); if (p2) root.appendChild(p2);
}

function aixFilters() {
  const box = el("div", "aq-filters al-filters");
  const mk = (label, opts, val, on) => {
    const s = el("select", "input");
    opts.forEach(([v, l]) => { const o = el("option", null, l); o.value = v; s.appendChild(o); });
    s.value = val;
    if (s.value !== val) s.value = "";
    s.setAttribute("aria-label", label);
    s.addEventListener("change", () => { on(s.value); aix.page = 0; aixLoad(); });
    const w = el("label", "aq-f");
    w.append(el("span", null, label), s);
    box.appendChild(w);
  };
  mk(t("aix.f.status"), [["open", t("aix.st.open")]].concat(IX_STATUS.map(s => [s, aixStatus(s)]), [["", t("aix.st.all")]]),
    aix.f.status, v => { aix.f.status = v; });
  mk(t("aix.f.cat"), [["", t("aq.f.all")]].concat(IX_CATS.map(c => [c, aixCat(c)])), aix.f.cat, v => { aix.f.cat = v; });
  const accts = arr(adm.list).slice().sort((a, b) => String(a.identifiant).localeCompare(String(b.identifiant)));
  mk(t("aq.f.account"), [["", t("aq.f.all")]].concat(accts.map(a => [a.user_id, a.identifiant])), aix.f.user, v => { aix.f.user = v; });
  mk(t("aq.f.period"), [["7", t("aq.p7")], ["30", t("aq.p30")], ["90", t("aix.p90")], ["", t("aix.pAll")]], aix.f.days, v => { aix.f.days = v; });
  return box;
}

// Une ligne (liste ou fiche d'un compte). who = afficher le compte.
function aixRow(r, who) {
  const box = el("button", "card al-row aix-row" + (r.status === "new" ? " aix-new" : ""));
  box.type = "button";
  const head = el("div", "al-head");
  const tags = el("span", "ix-tags");
  tags.append(el("span", "al-tag", aixCat(r.category)), el("span", "al-tag ix-st ix-st-" + r.status, aixStatus(r.status)));
  if (r.reward) tags.appendChild(el("span", "al-tag ok", "🎁"));
  head.append(tags, el("span", "al-time", alTime(r.created_at)));
  box.appendChild(head);
  box.appendChild(el("div", "ix-t", String(r.title || "")));
  if (r.body) box.appendChild(el("div", "ix-b aix-short", String(r.body)));
  const meta = [who ? String(r.identifiant || "?") : "", r.admin_reply ? "💬 " + t("aix.replied") : "", r.reward ? aixRewardText(r.reward) : ""].filter(Boolean);
  if (meta.length) box.appendChild(el("div", "al-dev", meta.join(" · ")));
  box.addEventListener("click", () => aixOpen(r));
  return box;
}

// Détail d'une idée. L'ouvrir passe « nouvelle » → « vue » (fait par le serveur, noté au journal).
async function aixOpen(r) {
  const wrap = el("div", "aq-detailbox aix-detail");
  wrap.appendChild(el("p", "muted", t("admin.loading")));
  const close = openModal("💡 " + String(r.title || ""), wrap, [{ label: t("close") }]);
  let d;
  try { d = await aqRpc("admin_idea_detail", { p_id: r.id }); }
  catch (e) { wrap.textContent = ""; wrap.appendChild(el("p", "q-err", aixErrText(e))); return; }
  const changed = r.status !== d.status;
  Object.assign(r, d);
  if (changed) { aixLoad(); if (aix.newCount) aix.newCount = Math.max(0, aix.newCount - 1); }
  aixFillDetail(wrap, d, close);
}
function aixFillDetail(wrap, d, close) {
  wrap.textContent = "";
  const who = el("button", "link-btn", String(d.identifiant || "?"));
  who.type = "button";
  who.addEventListener("click", () => { close(); openAccountFiche(d.user_id, currentScreen === "adminfiche" ? fc.from : "adminidea"); });
  const dl = el("dl", "aq-sum");
  [[t("aix.d.author"), who], [t("aix.f.cat"), aixCat(d.category)], [t("aix.f.status"), aixStatus(d.status)],
   [t("aix.d.created"), alTime(d.created_at)], [t("aix.d.updated"), alTime(d.updated_at)],
   [t("aix.d.userIdeas"), String(num(Number(d.user_ideas), 1))],
   [t("aix.d.seen"), d.reply_seen_at ? alTime(d.reply_seen_at) : "—"]]
    .forEach(([a, b]) => { const dd = el("dd"); if (b instanceof Node) dd.appendChild(b); else dd.textContent = String(b == null ? "" : b); dl.append(el("dt", null, a), dd); });
  wrap.appendChild(dl);
  wrap.appendChild(el("h4", null, t("aix.d.text")));
  wrap.appendChild(el("p", "ix-full", d.body ? String(d.body) : "—"));

  // État et réponse
  const form = el("div", "aix-form");
  const lsel = el("label", "field");
  lsel.appendChild(el("span", null, t("aix.f.status")));
  const sel = el("select", "input");
  IX_STATUS.forEach(s => { const o = el("option", null, aixStatus(s)); o.value = s; sel.appendChild(o); });
  sel.value = d.status;
  lsel.appendChild(sel);
  form.appendChild(lsel);
  const lrep = el("label", "field");
  lrep.appendChild(el("span", null, t("aix.d.reply")));
  const ta = el("textarea", "input");
  ta.rows = 4; ta.maxLength = IX_BODY_MAX; ta.value = d.admin_reply || ""; ta.placeholder = t("aix.d.replyPh");
  const cnt = el("span", "ix-count", ta.value.length + " / " + IX_BODY_MAX);
  ta.addEventListener("input", () => { cnt.textContent = ta.value.length + " / " + IX_BODY_MAX; });
  lrep.append(ta, cnt);
  form.appendChild(lrep);
  form.appendChild(el("p", "hint", t("aix.d.replyHint")));
  const save = el("button", "btn primary", t("save"));
  save.type = "button";
  save.addEventListener("click", async () => {
    save.disabled = true;
    try {
      const nd = await aqRpc("admin_idea_set", { p_id: d.id, p_status: sel.value, p_reply: ta.value.trim() });
      toast(t("aix.saved"));
      Object.assign(d, nd);
      aixLoad();
      if (currentScreen === "adminfiche") fcIdeasReload();
      aixFillDetail(wrap, d, close);
    } catch (e) { toast(aixErrText(e)); save.disabled = false; }
  });
  form.appendChild(save);
  wrap.appendChild(form);

  // Récompense
  const rs = el("div", "aix-rw-box");
  rs.appendChild(el("h4", null, "🎁 " + t("aix.reward")));
  if (d.reward) {
    const rw = d.reward;
    const rdl = el("dl", "aq-sum");
    [[t("aix.rw.given"), aixRewardText(rw)], [t("aix.rw.reason"), rw.reason || ""], [t("aix.rw.by"), (rw.granted_by || "?") + " · " + alTime(rw.granted_at)],
     [t("aix.rw.state"), rw.claimed_at ? t("aix.rw.claimed", { d: alTime(rw.claimed_at) }) : t("aix.rw.notClaimed")]]
      .forEach(([a, b]) => rdl.append(el("dt", null, a), el("dd", null, String(b))));
    rs.appendChild(rdl);
  } else if (d.status === "kept" || d.status === "done") {
    const b = el("button", "btn aix-reward-btn", "🎁 " + t("aix.rewardBtn"));
    b.type = "button";
    b.addEventListener("click", () => aixRewardForm(d, () => aixFillDetail(wrap, d, close)));
    rs.appendChild(b);
  } else rs.appendChild(el("p", "hint", t("aix.rw.onlyKept")));
  wrap.appendChild(rs);
}

// Fenêtre « Récompenser » : XP (50 / 100 / 200 ou libre ≤ 500), gels (0 à 2), badge, raison obligatoire, aperçu, confirmation.
function aixRewardForm(d, done) {
  const f = { xp: 100, custom: "", freezes: 0, badge: true, reason: "" };
  const box = el("div", "aix-rwf");
  box.appendChild(el("p", "muted", t("aix.rw.intro", { id: d.identifiant || "?" })));
  // XP
  const lx = el("div", "field");
  lx.appendChild(el("label", null, t("aix.rw.xp")));
  const sx = el("div", "seg seg-wrap");
  const custom = el("input", "input aix-xp");
  custom.type = "number"; custom.min = "0"; custom.max = "500"; custom.step = "1"; custom.inputMode = "numeric";
  custom.placeholder = t("aix.rw.customPh"); custom.setAttribute("aria-label", t("aix.rw.custom"));
  const xpOpts = [0].concat(AIX_XP).concat(["c"]);
  const paintX = () => sx.querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.v === (f.custom !== "" ? "c" : String(f.xp)))));
  xpOpts.forEach(v => {
    const b = el("button", null, v === "c" ? t("aix.rw.custom") : (v ? "+" + v : "0"));
    b.type = "button"; b.dataset.v = String(v);
    b.addEventListener("click", () => {
      if (v === "c") { f.custom = custom.value || "0"; custom.hidden = false; custom.focus(); }
      else { f.xp = v; f.custom = ""; custom.hidden = true; }
      paintX(); preview();
    });
    sx.appendChild(b);
  });
  custom.hidden = true;
  custom.addEventListener("input", () => { f.custom = custom.value; preview(); });
  lx.append(sx, custom);
  box.appendChild(lx);
  // Gels
  const lf = el("div", "field");
  lf.appendChild(el("label", null, t("aix.rw.freezes")));
  const sf = el("div", "seg");
  [0, 1, 2].forEach(n => {
    const b = el("button", null, n ? "❄️ " + n : "0");
    b.type = "button"; b.dataset.v = String(n); b.setAttribute("aria-pressed", String(n === f.freezes));
    b.addEventListener("click", () => { f.freezes = n; sf.querySelectorAll("button").forEach(x => x.setAttribute("aria-pressed", String(x.dataset.v === String(n)))); preview(); });
    sf.appendChild(b);
  });
  lf.append(sf, el("p", "hint", t("aix.rw.freezeHint", { x: IX_FREEZE_XP })));
  box.appendChild(lf);
  // Badge
  const lb = el("label", "aix-check");
  const cb = el("input"); cb.type = "checkbox"; cb.checked = f.badge;
  cb.addEventListener("change", () => { f.badge = cb.checked; preview(); });
  lb.append(cb, el("span", null, "💡 " + t("aix.rw.badge")));
  box.appendChild(lb);
  // Raison
  const lr = el("div", "field");
  const ta = el("textarea", "input");
  ta.id = "aixReason"; ta.rows = 2; ta.maxLength = 300; ta.placeholder = t("aix.rw.reasonPh");
  const lrl = el("label", null, t("aix.rw.reason")); lrl.htmlFor = ta.id;
  ta.addEventListener("input", () => { f.reason = ta.value; });
  lr.append(lrl, ta);
  box.appendChild(lr);
  // Aperçu
  const pv = el("div", "aix-preview");
  box.appendChild(pv);
  const err = el("p", "q-err"); err.hidden = true;
  box.appendChild(err);
  const xpVal = () => f.custom !== "" ? Number(f.custom) : f.xp;
  function preview() {
    pv.textContent = "";
    const v = xpVal();
    if (!(Number.isInteger(v) && v >= 0 && v <= 500)) { pv.appendChild(el("p", "q-err", t("ix.err.idea_xp"))); return; }
    if (!v && !f.freezes && !f.badge) { pv.appendChild(el("p", "hint", t("ix.err.idea_empty"))); return; }
    pv.appendChild(el("span", "hint", t("aix.rw.preview")));
    pv.appendChild(el("p", "aix-pv-msg", t("ix.r.msg", { list: Ideas.rewardText({ xp: v, freezes: f.freezes, badgeAsked: f.badge }) })));
  }
  paintX(); preview();
  let busy = false;
  const send = async () => {
    if (busy) return;
    err.hidden = true;
    const v = xpVal(), reason = ta.value.replace(/\s+/g, " ").trim();
    if (!(Number.isInteger(v) && v >= 0 && v <= 500)) { err.textContent = t("ix.err.idea_xp"); err.hidden = false; return; }
    if (!v && !f.freezes && !f.badge) { err.textContent = t("ix.err.idea_empty"); err.hidden = false; return; }
    if (!reason) { err.textContent = t("ix.err.idea_reason"); err.hidden = false; ta.focus(); return; }
    const sum = Ideas.rewardText({ xp: v, freezes: f.freezes, badgeAsked: f.badge });
    openModal(t("aix.rw.confirmTitle"), el("p", null, t("aix.rw.confirm", { id: d.identifiant || "?", list: sum })), [
      { label: t("cancel") },
      { label: t("aix.rw.send"), kind: "primary", onClick: () => { doSend(v, reason); } }
    ]);
  };
  const doSend = async (v, reason) => {
    if (busy) return;
    busy = true;
    try {
      const nd = await aqRpc("admin_idea_reward", { p_id: d.id, p_xp: v, p_freezes: f.freezes, p_badge: f.badge, p_reason: reason.slice(0, 300) });
      Object.assign(d, nd);
      toast(t("aix.rw.done"));
      closeFn();
      aixLoad();
      if (currentScreen === "adminfiche") fcIdeasReload();
      if (done) done();
    } catch (e) { err.textContent = aixErrText(e); err.hidden = false; }
    busy = false;
  };
  const closeFn = openModal("🎁 " + t("aix.rewardBtn"), box, [
    { label: t("cancel") },
    { label: t("aix.rw.send"), kind: "primary", onClick: () => { send(); return false; } }
  ]);
}

// Export CSV : toutes les idées filtrées, textes complets.
async function aixExportCsv() {
  const pg = openProgress(t("aix.csv"), t("admin.loading"), []);
  let rows;
  try { rows = arr(await aqRpc("admin_ideas_export", aixArgs())); }
  catch (e) { pg.close(); toast(aixErrText(e)); return; }
  pg.close();
  const iso = s => {
    const d = new Date(s);
    return !s || isNaN(d) ? "" : todayStr(d) + " " + String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
  };
  const csv = csvText([t("aix.c.date"), t("aq.f.account"), t("aix.f.cat"), t("aix.f.status"), t("aix.c.title"), t("aix.d.text"), t("aix.d.reply"),
    t("aix.c.updated"), t("aix.c.xp"), t("aix.c.freezes"), t("aix.c.badge"), t("aix.c.reason"), t("aix.c.claimed"), t("aix.c.id")],
    rows.map(x => {
      const rw = x.reward || null;
      return [iso(x.created_at), x.identifiant || "", aixCat(x.category), aixStatus(x.status), x.title || "", x.body || "", x.admin_reply || "",
        iso(x.updated_at), rw ? num(Number(rw.xp), 0) : "", rw ? num(Number(rw.freezes), 0) : "", rw ? (rw.badge ? "1" : "0") : "",
        rw ? rw.reason || "" : "", rw ? iso(rw.claimed_at) : "", x.id];
    }));
  const name = "idees-" + todayStr() + ".csv";
  const okSave = await fxSave(name, inClaude() ? csv : new Blob([csv], { type: "text/csv;charset=utf-8" }));
  if (okSave === true) toast(t("aix.csvDone", { n: rows.length }));
  else if (okSave !== "declined") showExportText(csv);
}

// --- Fiche d'un compte : section « Idées » (données chargées par fcLoad dans fc.ideas) ---
async function fcIdeasLoad(user) {
  try { fc.ideas = await aqRpc("admin_ideas_list", { p_user: user, p_page: 0, p_size: AIX_PAGE }); fc.ideasErr = ""; }
  catch (e) { fc.ideas = null; fc.ideasErr = Ideas.isMissing(e) ? t("aix.missing") : aqErrText(e); }
}
async function fcIdeasReload() { if (fc.user) { await fcIdeasLoad(fc.user); fcRerender(); } }
function fcIdeas() {
  const total = num(Number(fc.ideas && fc.ideas.total), 0);
  const sec = fcSec("💡 " + t("aix.fc.title") + (fc.ideas ? " (" + total + ")" : ""), "fc-ideas");
  if (!fc.ideas) { sec.appendChild(el("p", "q-note", fc.ideasErr || "—")); return sec; }
  const rows = arr(fc.ideas.rows);
  if (!rows.length) { sec.appendChild(el("p", "muted", t("aix.fc.none"))); return sec; }
  const list = el("div", "al-list");
  rows.forEach(r => list.appendChild(aixRow(r, false)));
  sec.appendChild(list);
  if (total > rows.length) {
    const b = el("button", "link-btn", t("aix.fc.all", { n: total }));
    b.type = "button";
    b.addEventListener("click", () => aixOpenWith({ status: "", user: fc.user }));
    sec.appendChild(b);
  }
  return sec;
}
