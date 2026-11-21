"use strict";

// === ADMINISTRATION : VERSIONS — APPAREILS RESTÉS SUR UNE VERSION (ÉTAPE 81) ===
// Administration → Notifications → onglet « Versions » (npReleaseTab, js/screens/admin-release.js) :
// - « Par version » devient une liste de lignes à toucher (rvdVersionList) : version, appareils, comptes.
// - Toucher une ligne ouvre la liste des appareils restés sur cette version (rvdView, dans le même onglet) :
//   compte, type d'appareil, système + navigateur, appli installée ou navigateur, dernière visite (date + « il y a X jours »).
//   Filtre « Vus ces 30 derniers jours » (par défaut, même règle que le suivi de l'étape 48) / « Tous les appareils »,
//   recherche par compte, tri par dernière visite, export CSV (dashSaveCsv, comme les autres tableaux), bouton retour.
//   Toucher un compte ouvre sa fiche (étape 26, seulement avec la case accounts.see) ; retour = cet onglet, liste gardée.
// - LECTURE SEULE : aucune action sur un appareil. Les commandes portent data-mod-keep : un modo qui n'a que
//   « Notifications → voir » (l'onglet est alors en lecture seule, modRO) peut quand même filtrer, chercher et exporter.
// Données : RPC admin_release_version_devices(p_version, p_days) (claude/supabase-etape81.sql) ; p_days 30, ou 0 = tous.
// Contrôle SERVEUR : même règle que admin_release_devices (admin, ou modo notif.see / notif.release ; sinon 42501 mod_denied).
// Fonction absente (script pas lancé) : l'onglet reste comme en version 80 (puces non cliquables), aucune erreur.
// Rien n'est retenu sur l'appareil ; aucune donnée de compte, DATA_VERSION inchangé.
const RVD_MAX = 2000;
const rvd = {
  counts: null, countsBusy: false, countsMissing: false,   // { version: { devices, accounts } } (30 jours)
  version: null, days: 30, data: null, busy: false, err: "", missing: false,
  q: "", sort: "new", seq: 0
};

function rvdRerender() { if (typeof rlRerender === "function") rlRerender(); }
function rvdErrText(e) {
  if (typeof modErrText === "function" && (String((e && e.hint) || "") === "mod_denied" || String((e && e.code) || "") === "42501")) return modErrText(e);
  return typeof rlErrText === "function" ? rlErrText(e) : String((e && e.message) || e || "");
}
function rvdVLabel(v) { return v ? t("rl.vN", { v }) : t("rl.vUnknown"); }

// Comptes par version (30 jours), appelé par rlLoad juste après admin_release_devices.
async function rvdCounts() {
  if (rvd.countsBusy) return;
  rvd.countsBusy = true;
  try {
    const r = await aqRpc("admin_release_version_devices", { p_version: null, p_days: 30 });
    const m = {};
    arr(r && r.by_version).forEach(x => { m[num(Number(x.version), 0)] = { devices: num(Number(x.devices), 0), accounts: num(Number(x.accounts), 0) }; });
    rvd.counts = m; rvd.countsMissing = false;
  } catch (e) { rvd.countsMissing = alIsMissing(e); rvd.counts = null; }
  rvd.countsBusy = false;
}

// Liste « Par version » : une ligne à toucher par version (remplace les puces de l'étape 48).
function rvdVersionList(bv, target) {
  const box = el("div", "rvd-vers");
  box.appendChild(el("p", "hint rvd-tip", t("rvd.tapHint")));
  bv.forEach(x => {
    const v = num(Number(x.version), 0), dev = num(Number(x.devices), 0);
    const c = rvd.counts && rvd.counts[v];
    const b = el("button", "rvd-vrow" + (v >= target ? " ok" : ""));
    b.type = "button"; b.setAttribute("data-mod-keep", ""); b.setAttribute("data-version", String(v));
    b.append(el("b", null, rvdVLabel(v)),
      el("span", null, c ? t("rvd.row", { d: dev, a: c.accounts }) : t("rvd.rowDev", { d: dev })),
      el("span", "rvd-go", "›"));
    b.addEventListener("click", () => rvdOpen(v));
    box.appendChild(b);
  });
  return box;
}

function rvdOpen(v) {
  rvd.version = v; rvd.days = 30; rvd.data = null; rvd.err = ""; rvd.missing = false; rvd.q = "";
  rvdLoad();
}
function rvdClose() { rvd.version = null; rvd.data = null; rvd.err = ""; rvd.q = ""; rvdRerender(); }

async function rvdLoad() {
  const seq = ++rvd.seq, v = rvd.version, days = rvd.days;
  rvd.busy = true; rvd.err = "";
  rvdRerender();
  try {
    const r = await aqRpc("admin_release_version_devices", { p_version: v, p_days: days });
    if (seq !== rvd.seq) return;
    rvd.data = r || {}; rvd.missing = false;
  } catch (e) {
    if (seq !== rvd.seq) return;
    rvd.data = null; rvd.missing = alIsMissing(e); rvd.err = rvd.missing ? "" : rvdErrText(e);
  }
  rvd.busy = false;
  rvdRerender();
}

// Jours entiers (calendrier local) depuis la dernière visite.
function rvdDays(s) {
  const d = new Date(s);
  if (isNaN(d)) return null;
  const a = new Date(d.getFullYear(), d.getMonth(), d.getDate()), n = new Date(), b = new Date(n.getFullYear(), n.getMonth(), n.getDate());
  return Math.max(0, Math.round((b - a) / 86400000));
}
function rvdAgo(s) {
  const n = rvdDays(s);
  if (n === null) return "—";
  return n === 0 ? t("rvd.today") : n === 1 ? t("rvd.yesterday") : t("rvd.daysAgo", { n });
}
function rvdDevLine(d) {
  return [t("al.dev." + (d.type || "desktop")), d.os, d.browser, d.installed ? t("al.installed") : t("al.browser")].filter(Boolean).join(" · ");
}
function rvdRows() {
  const q = String(rvd.q || "").trim().toLowerCase();
  let rows = arr(rvd.data && rvd.data.rows);
  if (q) rows = rows.filter(r => String(r.identifiant || "").toLowerCase().includes(q));
  rows = rows.slice().sort((a, b) => {
    const x = new Date(a.last_seen).getTime() || 0, y = new Date(b.last_seen).getTime() || 0;
    return rvd.sort === "old" ? x - y : y - x;
  });
  return rows;
}

function rvdItem(d) {
  const row = el("div", "rvd-dev");
  const name = String(d.identifiant || "?") + (d.blocked ? " (" + t("rvd.blocked") + ")" : "");
  if (d.user_id && Mod.can("accounts.see")) {
    const b = el("button", "link-btn rvd-acc", name);
    b.type = "button"; b.setAttribute("data-mod-keep", "");
    b.addEventListener("click", () => openAccountFiche(d.user_id, "adminpush"));
    row.appendChild(b);
  } else row.appendChild(el("b", "rvd-acc", name));
  row.appendChild(el("div", "rvd-line", rvdDevLine(d)));
  row.appendChild(el("div", "rvd-line muted", t("rvd.seen", { date: rlDate(d.last_seen), ago: rvdAgo(d.last_seen) })));
  return row;
}

// Liste filtrée (recherche, tri) : repeinte sans refaire l'écran (le champ de recherche garde le focus).
function rvdPaint(list, note) {
  const all = arr(rvd.data && rvd.data.rows), rows = rvdRows();
  list.textContent = "";
  if (!all.length) list.appendChild(el("div", "empty", t(rvd.days ? "rvd.empty30" : "rvd.empty")));
  else if (!rows.length) list.appendChild(el("div", "empty", t("rvd.noMatch", { q: String(rvd.q).trim() })));
  else rows.forEach(d => list.appendChild(rvdItem(d)));
  note.textContent = rvd.q.trim() && all.length ? t("rvd.shown", { n: rows.length, t: all.length }) : "";
}

async function rvdCsv() {
  const rows = rvdRows(), v = rvd.version;
  const yn = b => t(b ? "rvd.yes" : "rvd.no");
  const day = s => { const d = new Date(s); return isNaN(d) ? String(s || "") : todayStr(d) + " " + String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0"); };
  await dashSaveCsv("appareils-v" + v, [t("rvd.c.version"), t("rvd.c.account"), t("rvd.c.blocked"), t("rvd.c.type"), t("rvd.c.os"),
    t("rvd.c.browser"), t("rvd.c.installed"), t("rvd.c.lang"), t("rvd.c.first"), t("rvd.c.last"), t("rvd.c.days"), "device_id"],
    rows.map(d => [v || 0, d.identifiant || "", yn(d.blocked), t("al.dev." + (d.type || "desktop")), d.os || "", d.browser || "",
      yn(d.installed), d.ui_lang || "", day(d.first_seen), day(d.last_seen), rvdDays(d.last_seen) == null ? "" : rvdDays(d.last_seen), d.device_id || ""]));
}

// Écran « Appareils en version N » (dans l'onglet Versions ; npReleaseTab l'appelle quand rvd.version n'est pas null).
function rvdView(root) {
  const keep = n => { n.setAttribute("data-mod-keep", ""); return n; };
  const back = keep(el("button", "link-btn", t("rvd.back")));
  back.type = "button"; back.id = "rvdBack";
  back.addEventListener("click", rvdClose);
  root.appendChild(back);
  const c = el("div", "card rvd");
  c.appendChild(el("h3", "np-h3", t("rvd.title", { v: rvdVLabel(rvd.version) })));
  if (rvd.missing) { c.appendChild(el("div", "np-msg", t("rvd.missing"))); root.appendChild(c); return; }

  const seg = el("div", "seg rvd-seg");
  [[30, "rvd.f30"], [0, "rvd.fAll"]].forEach(([d, k]) => {
    const b = keep(el("button", null, t(k)));
    b.type = "button"; b.setAttribute("aria-pressed", String(rvd.days === d)); b.setAttribute("data-days", String(d));
    b.addEventListener("click", () => { if (rvd.days === d) return; rvd.days = d; rvdLoad(); });
    seg.appendChild(b);
  });
  c.appendChild(seg);

  if (rvd.busy && !rvd.data) { c.appendChild(el("div", "empty", t("admin.loading"))); root.appendChild(c); return; }
  if (rvd.err) c.appendChild(el("div", "q-err", rvd.err));
  if (!rvd.data) { root.appendChild(c); return; }
  const d = rvd.data;
  c.appendChild(el("p", "rvd-sum", t("rvd.sum", { d: num(Number(d.total), 0), a: num(Number(d.accounts), 0) })));

  const tools = el("div", "rvd-tools");
  const q = keep(el("input", "input rvd-q"));
  q.type = "search"; q.id = "rvdSearch"; q.value = rvd.q; q.placeholder = t("rvd.search"); q.setAttribute("aria-label", t("rvd.search"));
  const sort = keep(el("select", "input rvd-sort"));
  sort.id = "rvdSort"; sort.setAttribute("aria-label", t("rvd.sort"));
  [["new", "rvd.sortNew"], ["old", "rvd.sortOld"]].forEach(([v, k]) => { const o = el("option", null, t(k)); o.value = v; sort.appendChild(o); });
  sort.value = rvd.sort;
  const csv = keep(el("button", "btn dash-csv", t("dash.csv")));
  csv.type = "button"; csv.id = "rvdCsv"; csv.disabled = !arr(d.rows).length;
  csv.addEventListener("click", rvdCsv);
  tools.append(q, sort, csv);
  c.appendChild(tools);
  const note = el("p", "hint rvd-note");
  const list = el("div", "rvd-list");
  list.id = "rvdList";
  q.addEventListener("input", () => { rvd.q = q.value; rvdPaint(list, note); csv.disabled = !rvdRows().length; });
  sort.addEventListener("change", () => { rvd.sort = sort.value; rvdPaint(list, note); });
  c.append(note, list);
  rvdPaint(list, note);
  if (d.more) c.appendChild(el("p", "hint", t("rvd.more", { n: RVD_MAX })));
  c.appendChild(el("p", "hint rvd-ro", t("rvd.readOnly")));
  root.appendChild(c);
}
