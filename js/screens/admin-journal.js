"use strict";

// === ADMINISTRATION : JOURNAL D'ACTIVITÉ ===
// (suite de la découpe : même section, fichier séparé pour rester sous 120 Ko)
// --- Journal d'activité (admin, étape 24) : écran #admin-journal ---
// Fonctions SQL du script supabase-etape24.sql : admin_activity_log (filtres, page), admin_devices, admin_activity_cleanup.
// 50 lignes par page (seule la page affichée est dans le DOM). Filtres compte / type / période. Export CSV du journal filtré
// (séparateur ";", UTF-8 avec BOM pour Excel). Script pas lancé : message « Lancez le script SQL de l'étape 24 ».
const AL_PAGE = 50;
const AL_KINDS = ["login", "session", "cards_added", "import", "validate", "claude_request", "pin_change", "logout", "sync_error", "conflict",
  "friend_request", "friend_accept", "friend_remove", "friend_block",
  "share_sent", "share_accepted", "share_declined", "share_member_removed", "share_left", "share_deleted",
  "push_invite_shown", "push_invite_enabled", "push_invite_later", "push_invite_denied", "game", "admin_*"];   // push_invite_* : étape 38 ; game : étape 42
const al = { f: { user: "", kind: "", days: "7" }, page: 0, data: null, loading: false, err: "", missing: false };
let alCleaned = false;
function alIsMissing(e) {
  const code = String((e && e.code) || ""), msg = String((e && (e.message || e.msg)) || "");
  return ["PGRST202", "42883", "PGRST205", "42P01"].includes(code) || /could not find|does not exist|schema cache/i.test(msg);
}
function alErrText(e) { return alIsMissing(e) ? t("al.missing") : aqErrText(e); }
// Ménage des événements de plus de 90 jours, une fois par ouverture de l'appli (à l'ouverture de l'administration).
async function alCleanup() {
  if (alCleaned || auth.mode !== "supabase" || !auth.isAdmin) return;
  alCleaned = true;
  try { const n = await aqRpc("admin_activity_cleanup"); if (Number(n) > 0) Activity.log("admin_activity_cleanup", { n: Number(n) }); }
  catch (e) {}
}
function alDays(v) { return v === "1" ? 1 : v === "7" ? 7 : v === "30" ? 30 : null; }
function alArgs(page, size) {
  return { p_user: al.f.user || null, p_kind: al.f.kind || null, p_days: alDays(al.f.days), p_page: page, p_size: size };
}
async function alLoad() {
  al.loading = true; al.err = "";
  if (currentScreen === "adminlog") renderAdminLog();
  if (!adm.list) { try { adm.list = arr(await Supa.listAccounts()); } catch (e) {} }   // comptes du filtre
  alCleanup();
  try {
    const r = await aqRpc("admin_activity_log", alArgs(al.page, AL_PAGE));
    al.missing = false;
    al.data = { total: num(Number(r && r.total), 0), rows: arr(r && r.rows) };
    const pages = Math.max(1, Math.ceil(al.data.total / AL_PAGE));
    if (al.page > pages - 1 && al.page > 0) { al.page = pages - 1; al.loading = false; return alLoad(); }
  } catch (e) { al.data = null; al.missing = alIsMissing(e); al.err = alErrText(e); }
  al.loading = false;
  if (currentScreen === "adminlog") renderAdminLog();
}
function alKindLabel(k) {
  k = String(k || "");
  if (k.startsWith("admin_")) return t("al.k.admin") + " · " + (I18N.fr["al.a." + k] ? t("al.a." + k) : k.slice(6));
  return I18N.fr["al.k." + k] ? t("al.k." + k) : k;
}
function alDevLabel(d) {
  if (!d) return "";
  return [t("al.dev." + (d.type || "desktop")), d.os, d.browser, d.installed ? t("al.installed") : t("al.browser")].filter(Boolean).join(" · ");
}
function alTime(s) {
  try { return new Date(s).toLocaleString(state.settings.uiLang, { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }); }
  catch (e) { return String(s || ""); }
}
// Détail lisible d'un événement (dans la langue de l'interface).
function alSummary(r) {
  const d = (r && r.data && typeof r.data === "object") ? r.data : {};
  const n = v => num(Number(v), 0);
  switch (r.kind) {
    case "login": return t("al.s.login." + (["pin", "create", "resume"].includes(d.via) ? d.via : "resume")) + (d.version ? " · v" + d.version : "");
    case "session": return t("al.s.session", { mode: I18N.fr["mode." + d.mode] ? t("mode." + d.mode) : String(d.mode || ""), n: n(d.cards),
      k: n(d.known), r: n(d.review), u: n(d.unknown), min: Math.max(0, Math.round(n(d.seconds) / 6) / 10) })
      + (d.lists ? " · " + t("al.s.lists", { n: n(d.lists) }) : "") + (d.lang ? " · " + String(d.lang).toUpperCase() : "");
    case "game":   // fin d'une partie (étape 42)
      return t("al.s.game", { game: I18N.fr["mode." + d.game] ? t("mode." + d.game) : String(d.game || ""), s: n(d.score), n: n(d.cards),
        e: n(d.errors), min: Math.max(0, Math.round(n(d.seconds) / 6) / 10) })
        + (n(d.record) ? " · 🏆" : "") + (d.lang ? " · " + String(d.lang).toUpperCase() : "");
    case "cards_added": return t("al.s.added", { n: n(d.n) }) + (d.list ? " · " + d.list : "");
    case "import": return t("al.s.import", { n: n(d.n), m: n(d.replaced) }) + (d.list ? " · " + d.list : "") + (d.stopped ? " · " + t("al.s.stopped") : "");
    case "validate": return t("al.s.validate." + (d.action === "reject" ? "reject" : "accept"), { n: n(d.n) }) + (d.skipped ? " · " + t("al.s.skipped", { n: n(d.skipped) }) : "");
    case "claude_request": return (I18N.fr["queue.kind." + d.type] ? t("queue.kind." + d.type) : String(d.type || "")) + " · " + t("queue.meta.cards", { n: n(d.cards) }) + (n(d.requests) > 1 ? " · ×" + n(d.requests) : "");
    case "sync_error": return String(d.msg || "");
    case "conflict": return t("al.s.conflict." + (d.choice === "local" ? "local" : "remote"));
    case "pin_change": return d.forced ? t("al.s.pinForced") : "";
    case "logout": return "";
    case "admin_streak_set": case "admin_streak_restore":   // étape 28
      return [d.target ? t("al.s.target", { id: d.target }) : "", t("al.s.streak", { b: n(d.before), v: n(d.value) }),
        d.reason ? t("al.s.reason", { r: d.reason }) : ""].filter(Boolean).join(" · ");
    case "share_sent": case "share_accepted": case "share_declined": case "share_member_removed": case "share_left": case "share_deleted":   // étape 30
      return [d.name ? "« " + d.name + " »" : "", d.kind ? t(d.kind === "common" ? "sh.modeCommon" : "sh.modeCopy") : "",
        d.what === "folder" ? t("sh.folderWord") : "", d.target ? t("al.s.target", { id: d.target }) : "",
        d.n ? t("sh.al.n", { n: n(d.n) }) : "", d.keep === true ? t("sh.al.keep") : ""].filter(Boolean).join(" · ");
    case "admin_push": {   // étape 32
      const nums = d.targeted != null ? t("np.al.nums", { t: n(d.targeted), s: n(d.sent), f: n(d.failed), i: n(d.skipped), d: n(d.deferred) }) : "";
      return [I18N.fr["np.al." + d.action] ? t("np.al." + d.action) : String(d.action || ""), d.title ? "« " + d.title + " »" : "",
        d.name ? "« " + d.name + " »" : "", d.segment || "", nums, d.filter || ""].filter(Boolean).join(" · ");
    }
    case "push_invite_shown": case "push_invite_enabled": case "push_invite_later": case "push_invite_denied":   // étape 38
      return [t(d.src === "admin" ? "ni.al.admin" : "ni.al.first"), d.mode === "install" ? t("ni.st.install") : d.mode === "denied" ? t("ni.al.help") : "",
        n(d.n) > 1 ? "×" + n(d.n) : ""].filter(Boolean).join(" · ");
    case "admin_streak_freezes":
      return [d.target ? t("al.s.target", { id: d.target }) : "", t("al.s.freezes", { d: (n(d.value) > 0 || Number(d.value) > 0 ? "+" : "") + String(d.value), b: n(d.before) }),
        d.reason ? t("al.s.reason", { r: d.reason }) : ""].filter(Boolean).join(" · ");
  }
  const parts = [];
  if (d.target) parts.push(t("al.s.target", { id: d.target }));
  Object.keys(d).filter(k => k !== "target").forEach(k => parts.push(k + " : " + d[k]));
  return parts.join(" · ");
}

function renderAdminLog() {
  const root = $("#screen-adminlog");
  if (!root) return;
  root.textContent = "";
  const back = el("button", "link-btn", t("aq.back"));
  back.addEventListener("click", () => { location.hash = "#" + HASH_OF.admin; });
  root.appendChild(back);
  const top = el("div", "adm-top");
  top.appendChild(el("h2", null, t("al.title")));
  const ref = el("button", "link-btn", t("admin.refresh"));
  ref.addEventListener("click", alLoad);
  top.appendChild(ref);
  root.appendChild(top);
  if (!al.data && !al.loading && !al.err) { alLoad(); return; }
  if (al.missing) { root.appendChild(el("div", "card q-err", t("al.missing"))); return; }
  root.appendChild(el("p", "q-note", t("al.help")));
  root.appendChild(alFilters());
  if (al.loading && !al.data) { root.appendChild(el("div", "empty", t("admin.loading"))); return; }
  if (al.err) { root.appendChild(el("div", "card q-err", al.err)); return; }
  if (!al.data) return;
  const bar = el("div", "al-bar");
  bar.appendChild(el("span", "muted", t("al.nEvents", { n: al.data.total })));
  const csv = el("button", "btn", t("al.csv"));
  csv.disabled = !al.data.total;
  csv.addEventListener("click", alExportCsv);
  bar.appendChild(csv);
  if (al.f.user) {
    const fi = el("button", "btn", t("fc.open"));          // fiche du compte (étape 26)
    fi.addEventListener("click", () => openAccountFiche(al.f.user, "adminlog"));
    bar.appendChild(fi);
    const dv = el("button", "btn", t("al.devices"));
    dv.addEventListener("click", () => { const a = arr(adm.list).find(x => x.user_id === al.f.user); adminDevices(a || { user_id: al.f.user, identifiant: "?" }); });
    bar.appendChild(dv);
  }
  root.appendChild(bar);
  if (!al.data.rows.length) { root.appendChild(el("div", "empty", t("al.none"))); return; }
  const pages = Math.max(1, Math.ceil(al.data.total / AL_PAGE));
  const pager = () => {
    if (pages < 2) return null;
    const w = el("div", "pv-pager");
    const prev = el("button", "btn", "‹"), next = el("button", "btn", "›");
    prev.setAttribute("aria-label", t("pv.prev")); next.setAttribute("aria-label", t("pv.next"));
    prev.disabled = al.page === 0 || al.loading; next.disabled = al.page >= pages - 1 || al.loading;
    const go = d => { al.page += d; alLoad().then(() => window.scrollTo(0, 0)); };
    prev.addEventListener("click", () => go(-1));
    next.addEventListener("click", () => go(1));
    w.append(prev, el("span", null, t("pv.page", { i: al.page + 1, n: pages })), next);
    return w;
  };
  const p1 = pager(); if (p1) root.appendChild(p1);
  const list = el("div", "al-list");
  al.data.rows.forEach(r => list.appendChild(alRow(r)));
  root.appendChild(list);
  const p2 = pager(); if (p2) root.appendChild(p2);
}
function alFilters() {
  const box = el("div", "aq-filters al-filters");
  const mk = (label, opts, val, on) => {
    const s = el("select", "input");
    opts.forEach(([v, l]) => { const o = el("option", null, l); o.value = v; s.appendChild(o); });
    s.value = val;
    if (s.value !== val) s.value = "";
    s.setAttribute("aria-label", label);
    s.addEventListener("change", () => { on(s.value); al.page = 0; alLoad(); });
    const w = el("label", "aq-f");
    w.append(el("span", null, label), s);
    box.appendChild(w);
  };
  const accts = arr(adm.list).slice().sort((a, b) => String(a.identifiant).localeCompare(String(b.identifiant)));
  mk(t("aq.f.account"), [["", t("aq.f.all")]].concat(accts.map(a => [a.user_id, a.identifiant])), al.f.user, v => { al.f.user = v; });
  mk(t("aq.f.kind"), [["", t("aq.f.all")]].concat(AL_KINDS.map(k => [k, k === "admin_*" ? t("al.k.admin") : alKindLabel(k)])), al.f.kind, v => { al.f.kind = v; });
  mk(t("aq.f.period"), [["1", t("al.p1")], ["7", t("aq.p7")], ["30", t("aq.p30")], ["", t("al.pAll")]], al.f.days, v => { al.f.days = v; });
  return box;
}
function alRow(r) {
  const box = el("button", "card al-row");
  box.type = "button";
  const head = el("div", "al-head");
  head.append(el("span", "al-who", r.identifiant), el("span", "al-time", alTime(r.created_at)));
  box.appendChild(head);
  const k = el("div", "al-kind");
  k.appendChild(el("span", "al-tag" + (String(r.kind).startsWith("admin_") ? " adm" : r.kind === "sync_error" || r.kind === "conflict" ? " bad" : ""), alKindLabel(r.kind)));
  const sum = alSummary(r);
  if (sum) k.appendChild(el("span", "al-sum", sum));
  box.appendChild(k);
  const dv = alDevLabel(r.device);
  if (dv) box.appendChild(el("div", "al-dev", dv));
  box.addEventListener("click", () => alOpenRow(r));
  return box;
}
function alOpenRow(r) {
  const body = el("div", "aq-detailbox");
  const dl = el("dl", "aq-sum");
  [[t("aq.f.account"), r.identifiant], [t("al.when"), alTime(r.created_at)], [t("al.day"), r.day], [t("aq.f.kind"), alKindLabel(r.kind) + " (" + r.kind + ")"],
   [t("al.detail"), alSummary(r) || "—"], [t("al.device"), alDevLabel(r.device) || (r.device_id ? String(r.device_id).slice(0, 8) : "—")]]
    .forEach(([a, b]) => dl.append(el("dt", null, a), el("dd", null, String(b))));
  body.appendChild(dl);
  body.appendChild(el("pre", "aq-json", JSON.stringify(r.data || {}, null, 2)));
  const acts = [];
  const a = arr(adm.list).find(x => x.user_id === r.user_id);
  if (al.f.user !== r.user_id) acts.push({ label: t("al.onlyThis"), onClick: () => { al.f.user = r.user_id; al.page = 0; alLoad(); } });
  acts.push({ label: t("al.devices"), onClick: () => { setTimeout(() => adminDevices(a || { user_id: r.user_id, identifiant: r.identifiant }), 0); } });
  if (r.user_id) acts.push({ label: t("fc.open"), onClick: () => { openAccountFiche(r.user_id, "adminlog"); } });
  acts.push({ label: t("close") });
  openModal(alKindLabel(r.kind), body, acts);
}

// Export CSV du journal filtré : toutes les pages (1000 lignes par appel, 50 000 max).
function csvCell(v) { const s = String(v == null ? "" : v); return /[";\r\n]/.test(s) || /^\s|\s$/.test(s) ? "\"" + s.replace(/"/g, "\"\"") + "\"" : s; }
function csvText(head, rows) { return "﻿" + [head].concat(rows).map(r => r.map(csvCell).join(";")).join("\r\n") + "\r\n"; }
async function alExportCsv() {
  const pg = openProgress(t("al.csv"), t("admin.loading"), []);
  const rows = [];
  try {
    for (let page = 0; page < 50; page++) {
      const r = await aqRpc("admin_activity_log", alArgs(page, 1000));
      const part = arr(r && r.rows);
      part.forEach(x => {
        const d = new Date(x.created_at);
        const iso = isNaN(d) ? String(x.created_at || "") : todayStr(d) + " " + String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0") + ":" + String(d.getSeconds()).padStart(2, "0");
        rows.push([iso, x.day, x.identifiant, x.kind, alKindLabel(x.kind), alSummary(x), JSON.stringify(x.data || {}), alDevLabel(x.device), x.device_id || ""]);
      });
      const total = num(Number(r && r.total), 0);
      pg.set(Math.min(1, rows.length / Math.max(total, 1)), rows.length + " / " + total);
      if (part.length < 1000 || rows.length >= total) break;
    }
  } catch (e) { pg.close(); toast(alErrText(e)); return; }
  pg.close();
  const csv = csvText([t("al.c.date"), t("al.day"), t("aq.f.account"), t("al.c.code"), t("aq.f.kind"), t("al.detail"), t("al.c.data"), t("al.device"), "device_id"], rows);
  const name = "journal-" + todayStr() + ".csv";
  const okSave = await fxSave(name, inClaude() ? csv : new Blob([csv], { type: "text/csv;charset=utf-8" }));
  if (okSave === true) { toast(t("al.csvDone", { n: rows.length })); Activity.log("admin_journal_export", { n: rows.length }); }
  else if (okSave !== "declined") showExportText(csv);
}

// Appareils d'un compte (fiche du compte : bouton « Appareils »).
async function adminDevices(a) {
  const wrap = el("div", "aq-detailbox");
  wrap.appendChild(el("p", "muted", t("admin.loading")));
  const close = openModal(t("al.devicesOf", { id: a.identifiant }), wrap, [{ label: t("close") }]);
  let list;
  try { list = arr(await aqRpc("admin_devices", { p_user: a.user_id })); }
  catch (e) { wrap.textContent = ""; wrap.appendChild(el("p", "q-err", alErrText(e))); return; }
  wrap.textContent = "";
  if (!list.length) { wrap.appendChild(el("p", "muted", t("al.noDevice"))); return; }
  list.forEach(d => {
    const c = el("div", "al-devcard");
    c.appendChild(el("div", "al-devt", [t("al.dev." + (d.type || "desktop")), d.os, d.browser].filter(Boolean).join(" · ")));
    const tags = el("div", "adm-tags");
    tags.appendChild(el("span", "tag" + (d.installed ? "" : " muted"), d.installed ? t("al.installed") : t("al.browser")));
    if (d.app_version) tags.appendChild(el("span", "tag", "v" + d.app_version));
    if (d.ui_lang) tags.appendChild(el("span", "tag", String(d.ui_lang).toUpperCase()));
    if (d.device_id === deviceId() && a.user_id === auth.sbUid) tags.appendChild(el("span", "tag", t("al.thisDevice")));
    c.appendChild(tags);
    c.appendChild(el("div", "al-devm", t("al.firstLast", { a: alTime(d.first_seen), b: alTime(d.last_seen) })));
    wrap.appendChild(c);
  });
  void close;
}
