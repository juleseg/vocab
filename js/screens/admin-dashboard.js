"use strict";

// === ADMINISTRATION : TABLEAU DE BORD ===
// (suite de la découpe : même section, fichier séparé pour rester sous 120 Ko)
// --- Tableau de bord (admin, étape 25) : écran #admin, accueil de l'Administration ---
// Fonctions SQL du script supabase-etape25.sql (security definer, contrôle is_admin()) : admin_dash_kpis (chiffres clés,
// + ménage du journal > 90 j et du contenu des demandes Claude > 30 j), admin_dash_series (30 jours / 12 mois),
// admin_dash_rankings (top 10, 7 j / 30 j), admin_dash_alerts (seuil d'inactivité réglable, 7 j par défaut).
// « Aujourd'hui » = date dans le fuseau horaire de cet appareil. Graphiques SVG dessinés ici, à la largeur de l'écran ;
// toucher un graphique = valeur du point le plus proche. Export CSV (";" + UTF-8 avec BOM) sur chaque tableau.
// Script pas lancé : message « Lancez le script SQL de l'étape 25 », les autres écrans admin restent accessibles.
const DASH_CHARTS = [["reviews", "dash.ch.reviews"], ["active", "dash.ch.active"], ["new_accounts", "dash.ch.new"], ["cards_added", "dash.ch.added"], ["claude", "dash.ch.claude"]];
const DASH_RANKS = [["active", "dash.rk.active"], ["streaks", "dash.rk.streaks"], ["success", "dash.rk.success"], ["lists", "dash.rk.lists"]];
const dash = {
  kpis: null, series: {}, period: "day", rank: {}, rankDays: 7, alerts: null, inactive: 7, bk: null, bkMissing: false,   // bk : admin_backup_status (étape 50)
  busy: {}, err: {}, missing: false, started: false, sel: {}
};
function dashTz() { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch (e) { return "UTC"; } }
function dashRerender() { if (currentScreen === "admin") renderAdmin(); }
// Charge une partie du tableau de bord ("kpis" | "series" | "rank" | "alerts"). Les autres parties restent affichées.
async function dashLoadPart(part) {
  const tz = dashTz();
  dash.busy[part] = true; dash.err[part] = "";
  dashRerender();
  try {
    if (part === "kpis") {
      const k = await aqRpc("admin_dash_kpis", { p_tz: tz });
      dash.kpis = k || {};
      alCleaned = true; aq.cleaned = true;            // ménage déjà fait par admin_dash_kpis
      if (Number(dash.kpis.cleaned_log) > 0) Activity.log("admin_activity_cleanup", { n: Number(dash.kpis.cleaned_log) });
      await aixLoadNewCount();                        // étape 52 : idées nouvelles (script absent : rien d'affiché)
    } else if (part === "series") {
      const p = dash.period;
      dash.series[p] = arr(await aqRpc("admin_dash_series", { p_tz: tz, p_period: p }));
    } else if (part === "rank") {
      const d = dash.rankDays;
      dash.rank[d] = (await aqRpc("admin_dash_rankings", { p_tz: tz, p_days: d })) || {};
    } else if (part === "alerts") {
      dash.alerts = (await aqRpc("admin_dash_alerts", { p_tz: tz, p_inactive: dash.inactive })) || {};
      // Étape 50 : dernière sauvegarde réussie. Jamais bloquant : script absent = pas d'état, sans erreur.
      try { dash.bk = await aqRpc("admin_backup_status"); dash.bkMissing = false; }
      catch (e) { dash.bk = null; dash.bkMissing = alIsMissing(e); }
    }
    dash.missing = false;
  } catch (e) {
    if (alIsMissing(e)) {
      dash.missing = true;
      alCleanup();                                       // ménage par les fonctions des étapes 23 et 24
      if (!aq.cleaned) { aq.cleaned = true; aqRpc("admin_claude_cleanup").catch(() => {}); }
    }
    dash.err[part] = alIsMissing(e) ? t("dash.missing") : aqErrText(e);
  }
  dash.busy[part] = false;
  dashRerender();
}
function dashReload() {
  dash.started = true; dash.series = {}; dash.rank = {}; dash.sel = {};
  ["kpis", "series", "rank", "alerts"].forEach(dashLoadPart);
}
// Lien « voir le compte » (alertes, classements) : ouvre la fiche du compte (étape 26).
function dashGoAccount(userId) { openAccountFiche(userId, "admin"); }
// Historique des demandes Claude filtré (compte, statut).
function dashGoRequests(userId, status) {
  aq.f = { user: userId || "", kind: "", status: status || "", days: "" };
  aq.page = 0; aq.hist = null; aq.histErr = "";
  location.hash = "#" + HASH_OF.adminreq;
  if (aq.stats) aqLoadHist().then(() => { const h = $("#aqHist"); if (h) try { h.scrollIntoView({ block: "start" }); } catch (e) {} });
}
// Export CSV commun aux tableaux de l'administration.
async function dashSaveCsv(base, head, rows) {
  const csv = csvText(head, rows);
  const okSave = await fxSave(base + "-" + todayStr() + ".csv", inClaude() ? csv : new Blob([csv], { type: "text/csv;charset=utf-8" }));
  if (okSave === true) { toast(t("dash.csvDone", { n: rows.length })); Activity.log("admin_csv_export", { table: base, n: rows.length }); }
  else if (okSave !== "declined") showExportText(csv);
}
function dashNum(v) { return num(Number(v), 0); }
// Taux pour le CSV : nombre seul, virgule décimale si la langue de l'interface l'utilise (lisible par Excel).
function dashRateCsv(v) { try { return (Number(v) || 0).toLocaleString(state.settings.uiLang, { maximumFractionDigits: 1, useGrouping: false }); } catch (e) { return String(Number(v) || 0); } }
function dashRate(v) { try { return (Number(v) || 0).toLocaleString(state.settings.uiLang, { maximumFractionDigits: 1 }) + " %"; } catch (e) { return (Number(v) || 0) + " %"; } }
function dashFmt(v) { try { return dashNum(v).toLocaleString(state.settings.uiLang); } catch (e) { return String(dashNum(v)); } }
function dashBucketDate(s) { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || "")); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(NaN); }
function dashBucketLabel(s, month, long) {
  const d = dashBucketDate(s);
  if (isNaN(d)) return String(s || "");
  const o = month ? (long ? { month: "long", year: "numeric" } : { month: "short" })
                  : (long ? { weekday: "short", day: "numeric", month: "long" } : { day: "numeric", month: "numeric" });
  try { return d.toLocaleDateString(state.settings.uiLang, o); } catch (e) { return String(s); }
}

function renderAdmin() {
  const root = $("#screen-admin");
  if (!root) return;
  root.textContent = "";
  const back = el("button", "link-btn", t("admin.back"));
  back.addEventListener("click", () => { location.hash = "#" + HASH_OF.settings; });
  root.appendChild(back);
  const top = el("div", "adm-top");
  top.appendChild(el("h2", null, t("admin.title")));
  const ref = el("button", "link-btn", t("admin.refresh"));
  ref.addEventListener("click", dashReload);
  top.appendChild(ref);
  root.appendChild(top);
  // Autres écrans de l'administration
  const nav = el("div", "dash-nav");
  [["dash.accounts", "adminacc"], ["aq.open", "adminreq"], ["al.open", "adminlog"], ["an.open", "adminann"], ["tp.open", "admintpl"], ["np.open", "adminpush"], ["dict.open", "admindict"], ["ce.open", "adminerr"], ["bk.open", "adminbk"], ["aix.open", "adminidea"]].forEach(([k, scr]) => {
    const n = scr === "adminidea" ? num(aix.newCount, 0) : 0;   // étape 52 : nombre d'idées nouvelles
    const b = el("button", "btn" + (n ? " aix-navnew" : ""), n ? t("aix.openN", { n }) : t(k));
    b.type = "button";
    b.addEventListener("click", () => { if (scr === "adminidea") aixOpenWith(n ? { status: "new" } : null); else location.hash = "#" + HASH_OF[scr]; });
    nav.appendChild(b);
  });
  root.appendChild(nav);
  if (!dash.started) { dashReload(); return; }
  if (dash.missing) { root.appendChild(el("div", "card q-err", t("dash.missing"))); return; }
  root.appendChild(dashKpiSection());
  root.appendChild(dashChartSection());
  root.appendChild(dashRankSection());
  root.appendChild(dashAlertSection());
}
function dashHead(title, onCsv, csvDisabled) {
  const h = el("div", "dash-h");
  h.appendChild(el("h3", null, title));
  if (onCsv) {
    const b = el("button", "btn dash-csv", t("dash.csv"));
    b.type = "button"; b.disabled = !!csvDisabled;
    b.addEventListener("click", onCsv);
    h.appendChild(b);
  }
  return h;
}
function dashState(part, has) {
  if (dash.busy[part] && !has) return el("div", "empty", t("admin.loading"));
  if (dash.err[part]) return el("div", "card q-err", dash.err[part]);
  return null;
}

// --- Chiffres clés ---
function dashKpiRows(k) {
  return [
    ["dash.r.accounts", k.accounts], ["dash.r.new7", k.accounts_new7],
    ["dash.r.active1", k.active_today], ["dash.r.active7", k.active_7], ["dash.r.active30", k.active_30],
    ["dash.r.cards", k.cards], ["dash.r.rev1", k.reviews_today], ["dash.r.rev7", k.reviews_7],
    ["dash.r.cPending", k.claude_pending], ["dash.r.cErr", k.claude_error], ["dash.r.props", k.proposals]
  ].concat(aix.newCount !== null ? [["aix.k.new", aix.newCount]] : []).map(([lab, v]) => [t(lab), dashNum(v)]);
}
function dashKpiSection() {
  const sec = el("section", "dash-sec");
  const k = dash.kpis;
  sec.appendChild(dashHead(t("dash.kpis"), () => {
    if (!dash.kpis) return;
    const rows = dashKpiRows(dash.kpis);
    rows.unshift([t("dash.c.date"), String(dash.kpis.today || todayStr())]);
    dashSaveCsv("chiffres-cles", [t("dash.c.indicator"), t("dash.c.value")], rows);
  }, !k));
  const st = dashState("kpis", !!k);
  if (st) { sec.appendChild(st); if (!k) return sec; }
  if (!k) return sec;
  const grid = el("div", "dash-kpis");
  const tile = (label, value, sub, warn) => {
    const c = el("div", "dash-tile");
    c.appendChild(el("div", "dash-tl", label));
    c.appendChild(el("div", "dash-tv", dashFmt(value)));
    if (sub) c.appendChild(el("div", "dash-ts" + (warn ? " warn" : ""), sub));
    grid.appendChild(c);
  };
  tile(t("dash.k.accounts"), k.accounts, t("dash.k.new7", { n: dashFmt(k.accounts_new7) }));
  tile(t("dash.k.activeToday"), k.active_today, t("dash.k.active", { a: dashFmt(k.active_7), b: dashFmt(k.active_30) }));
  tile(t("dash.k.reviewsToday"), k.reviews_today, t("dash.k.reviews7", { n: dashFmt(k.reviews_7) }));
  tile(t("dash.k.cards"), k.cards, "");
  tile(t("dash.k.claude"), k.claude_pending, t("dash.k.claudeErr", { n: dashFmt(k.claude_error) }), dashNum(k.claude_error) > 0);
  tile(t("dash.k.proposals"), k.proposals, "");
  if (aix.newCount !== null) {                    // étape 52 : idées nouvelles (toucher = liste des idées nouvelles)
    tile(t("aix.k.new"), aix.newCount, t("aix.k.newSub"), aix.newCount > 0);
    const c = grid.lastChild;
    c.classList.add("aix-tile"); c.setAttribute("role", "button"); c.tabIndex = 0;
    const go = () => aixOpenWith({ status: "new" });
    c.addEventListener("click", go);
    c.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } });
  }
  sec.appendChild(grid);
  return sec;
}

// --- Graphiques ---
function dashChartSection() {
  const sec = el("section", "dash-sec");
  sec.appendChild(dashHead(t("dash.charts")));
  const seg = el("div", "seg aq-period");
  [["day", "dash.p30d"], ["month", "dash.p12m"]].forEach(([v, k]) => {
    const b = el("button", null, t(k));
    b.type = "button"; b.setAttribute("aria-pressed", String(dash.period === v));
    b.addEventListener("click", () => {
      if (dash.period === v) return;
      dash.period = v; dash.sel = {};
      if (dash.series[v]) dashRerender(); else dashLoadPart("series");
    });
    seg.appendChild(b);
  });
  sec.appendChild(seg);
  const data = dash.series[dash.period];
  const st = dashState("series", !!data);
  if (st) { sec.appendChild(st); if (!data) return sec; }
  if (!data) return sec;
  sec.appendChild(el("p", "q-note", t("dash.tap")));
  DASH_CHARTS.forEach(([key, lab]) => {
    const card = el("div", "card dash-chart");
    const head = el("div", "dash-ch-head");
    head.appendChild(el("div", "dash-ch-title", t(lab)));
    head.appendChild(el("div", "dash-ch-total", t(key === "active" ? "dash.maxDay" : "dash.total",
      { n: dashFmt(key === "active" ? Math.max(0, ...data.map(p => dashNum(p[key]))) : data.reduce((m, p) => m + dashNum(p[key]), 0)) })));
    card.appendChild(head);
    const cap = el("div", "dash-ch-cap");
    card.appendChild(cap);
    sec.appendChild(card);
    // Dessiné une fois la carte placée (largeur de l'écran)
    card._draw = () => dashDrawChart(card, cap, data, key);
  });
  setTimeout(() => { sec.querySelectorAll(".dash-chart").forEach(c => { try { c._draw(); } catch (e) {} }); }, 0);
  return sec;
}
const SVGNS = "http://www.w3.org/2000/svg";
function svgEl(tag, attrs) { const n = document.createElementNS(SVGNS, tag); Object.keys(attrs || {}).forEach(k => n.setAttribute(k, attrs[k])); return n; }
// Graphique en ligne (une seule série) : axe des valeurs à gauche, quelques dates en bas, point touché mis en évidence.
function dashDrawChart(card, cap, data, key) {
  const month = dash.period === "month";
  const W = Math.max(240, Math.floor(card.clientWidth - 24)), H = 150;
  const m = { l: 34, r: 10, t: 10, b: 22 };
  const pw = W - m.l - m.r, ph = H - m.t - m.b;
  const vals = data.map(p => dashNum(p[key]));
  let max = Math.max(...vals, 0);
  // Échelle « ronde » : 1, 2, 5 × 10^n
  const nice = v => { if (v <= 4) return 4; const p = Math.pow(10, Math.floor(Math.log10(v))); for (const f of [1, 2, 2.5, 5, 10]) if (f * p >= v) return f * p; return 10 * p; };
  max = nice(max);
  const n = vals.length;
  const x = i => m.l + (n <= 1 ? pw / 2 : i * pw / (n - 1));
  const y = v => m.t + ph - (v / max) * ph;
  const svg = svgEl("svg", { width: W, height: H, viewBox: "0 0 " + W + " " + H, class: "dash-svg", role: "img", "aria-label": cap.previousSibling ? cap.previousSibling.textContent : "" });
  // Grille et valeurs (0, moitié, max)
  [0, max / 2, max].forEach(v => {
    svg.appendChild(svgEl("line", { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v), class: "dash-grid" }));
    const tx = svgEl("text", { x: m.l - 6, y: y(v) + 4, "text-anchor": "end", class: "dash-axis" });
    tx.textContent = dashFmt(v);
    svg.appendChild(tx);
  });
  // Dates : début, milieu, fin
  [...new Set([0, Math.floor((n - 1) / 2), n - 1])].forEach(i => {
    if (i < 0) return;
    const tx = svgEl("text", { x: x(i), y: H - 6, "text-anchor": i === 0 ? "start" : i === n - 1 ? "end" : "middle", class: "dash-axis" });
    tx.textContent = dashBucketLabel(data[i].bucket, month, false);
    svg.appendChild(tx);
  });
  // Aire + ligne
  if (n) {
    const pts = vals.map((v, i) => x(i).toFixed(1) + "," + y(v).toFixed(1));
    svg.appendChild(svgEl("polygon", { points: x(0).toFixed(1) + "," + y(0) + " " + pts.join(" ") + " " + x(n - 1).toFixed(1) + "," + y(0), class: "dash-area" }));
    svg.appendChild(svgEl("polyline", { points: pts.join(" "), class: "dash-line" }));
  }
  // Points (petits) et repère du point touché
  const dots = svgEl("g");
  if (n <= 31) vals.forEach((v, i) => dots.appendChild(svgEl("circle", { cx: x(i), cy: y(v), r: 2.5, class: "dash-dot" })));
  svg.appendChild(dots);
  const guide = svgEl("line", { y1: m.t, y2: m.t + ph, class: "dash-guide" });
  const mark = svgEl("circle", { r: 5, class: "dash-mark" });
  svg.append(guide, mark);
  const select = i => {
    i = Math.max(0, Math.min(n - 1, i));
    dash.sel[key] = i;
    guide.setAttribute("x1", x(i)); guide.setAttribute("x2", x(i));
    mark.setAttribute("cx", x(i)); mark.setAttribute("cy", y(vals[i]));
    cap.textContent = dashBucketLabel(data[i].bucket, month, true) + " : " + dashFmt(vals[i]);
  };
  const pick = ev => {
    const r = svg.getBoundingClientRect();
    if (!r.width || !n) return;
    const px = (ev.clientX - r.left) * (W / r.width);
    select(Math.round(n <= 1 ? 0 : (px - m.l) / (pw / (n - 1))));
  };
  svg.addEventListener("pointerdown", ev => { pick(ev); try { svg.setPointerCapture(ev.pointerId); } catch (e) {} });
  svg.addEventListener("pointermove", ev => { if (ev.buttons || ev.pointerType === "mouse") pick(ev); });
  const old = card.querySelector("svg");
  if (old) old.remove();
  card.appendChild(svg);
  if (n) select(dash.sel[key] != null ? dash.sel[key] : n - 1);   // par défaut : dernier point (aujourd'hui / ce mois)
}
let dashResizeT = null;
window.addEventListener("resize", () => {
  clearTimeout(dashResizeT);
  dashResizeT = setTimeout(() => { if (currentScreen === "admin") document.querySelectorAll("#screen-admin .dash-chart").forEach(c => { try { c._draw && c._draw(); } catch (e) {} }); }, 200);
});

// --- Classements ---
function dashRankDef(kind) {
  const acc = r => r.identifiant || "?";
  switch (kind) {
    case "active": return { head: ["dash.col.reviewed", "dash.col.sessions", "dash.col.minutes"], cells: r => [dashNum(r.cards), dashNum(r.sessions), dashNum(r.minutes)], acc };
    case "streaks": return { head: ["dash.col.streak", "dash.col.since"], cells: r => [dashNum(r.streak), r.since ? admDate(r.since + "T12:00:00") : ""], acc, note: "dash.rk.streaksNote" };
    case "success": return { head: ["dash.col.rate", "dash.col.correct", "dash.col.reviewed"], cells: r => [dashRate(r.rate), dashNum(r.correct), dashNum(r.cards)], csv: r => [dashRateCsv(r.rate), dashNum(r.correct), dashNum(r.cards)], acc, note: "dash.rk.successNote" };
    case "lists": return { head: ["dash.col.list", "dash.col.reviewed", "dash.col.total"], cells: r => [(r.list || "?") + (r.src === "estimate" ? " ≈" : ""), dashNum(r.cards), dashNum(r.total)], acc, note: "dash.rk.listsNote" };
  }
  return null;
}
function dashRankSection() {
  const sec = el("section", "dash-sec");
  sec.appendChild(dashHead(t("dash.ranks")));
  const seg = el("div", "seg aq-period");
  [[7, "dash.p7"], [30, "dash.p30"]].forEach(([v, k]) => {
    const b = el("button", null, t(k));
    b.type = "button"; b.setAttribute("aria-pressed", String(dash.rankDays === v));
    b.addEventListener("click", () => {
      if (dash.rankDays === v) return;
      dash.rankDays = v;
      if (dash.rank[v]) dashRerender(); else dashLoadPart("rank");
    });
    seg.appendChild(b);
  });
  sec.appendChild(seg);
  const data = dash.rank[dash.rankDays];
  const st = dashState("rank", !!data);
  if (st) { sec.appendChild(st); if (!data) return sec; }
  if (!data) return sec;
  DASH_RANKS.forEach(([kind, lab]) => {
    const def = dashRankDef(kind), rows = arr(data[kind]);
    const head = [t("dash.col.rank"), t("aq.f.account")].concat(def.head.map(h => t(h)));
    sec.appendChild(dashHead(t(lab), () => {
      dashSaveCsv("classement-" + kind + "-" + dash.rankDays + "j", head,
        rows.map((r, i) => [i + 1, def.acc(r)].concat(def.csv ? def.csv(r) : def.cells(r))));
    }, !rows.length));
    if (def.note) sec.appendChild(el("p", "q-note dash-note", t(def.note)));
    if (!rows.length) { sec.appendChild(el("div", "empty dash-empty", t("dash.noData"))); return; }
    const wrap = el("div", "aq-tablewrap");
    const tb = el("table", "aq-table dash-table");
    const hr = el("tr");
    head.forEach((h, i) => hr.appendChild(el("th", i > 1 && !(kind === "lists" && i === 2) ? "num" : null, h)));
    const th = el("thead"); th.appendChild(hr); tb.appendChild(th);
    const body = el("tbody");
    rows.forEach((r, i) => {
      const tr = el("tr");
      tr.appendChild(el("td", "num", String(i + 1)));
      const td = el("td", "aq-name");
      const a = el("button", "dash-link", def.acc(r));
      a.type = "button"; a.title = t("dash.seeAccount");
      a.addEventListener("click", () => dashGoAccount(r.user_id));
      td.appendChild(a);
      tr.appendChild(td);
      def.cells(r).forEach((c, j) => tr.appendChild(el("td", kind === "lists" && j === 0 ? "dash-wrap" : "num", typeof c === "number" ? dashFmt(c) : String(c))));
      body.appendChild(tr);
    });
    tb.appendChild(body);
    wrap.appendChild(tb);
    sec.appendChild(wrap);
  });
  return sec;
}

// --- Alertes ---
function dashAlertSection() {
  const sec = el("section", "dash-sec");
  sec.appendChild(dashHead(t("dash.alerts")));
  const f = el("label", "dash-inact");
  f.appendChild(el("span", null, t("dash.inactiveDays")));
  const inp = el("input", "input");
  inp.type = "number"; inp.min = "1"; inp.max = "365"; inp.inputMode = "numeric"; inp.value = String(dash.inactive);
  inp.addEventListener("change", () => {
    const v = Math.max(1, Math.min(365, Math.round(Number(inp.value)) || 7));
    inp.value = String(v);
    if (v === dash.inactive) return;
    dash.inactive = v;
    dashLoadPart("alerts");
  });
  f.appendChild(inp);
  sec.appendChild(f);
  const a = dash.alerts;
  const st = dashState("alerts", !!a);
  if (st) { sec.appendChild(st); if (!a) return sec; }
  if (!a) return sec;
  const groups = [
    ["inactive", t("dash.al.inactive", { n: dashNum(a.inactive_days) || dash.inactive }), r => t("dash.al.inactiveLine", { n: dashNum(r.days), d: admDate(r.last_day + "T12:00:00") })],
    ["streak_lost", t("dash.al.streak"), r => t("dash.al.streakLine", { n: dashNum(r.streak) })],
    ["claude_errors", t("dash.al.claude"), r => [t("queue.kind." + r.kind), r.label, admDate(r.created_at), r.error].filter(Boolean).join(" · ")],
    ["proposals", t("dash.al.props"), r => t("dash.al.propsLine", { n: dashFmt(r.n) })],
    ["sync_errors", t("dash.al.sync"), r => t("dash.al.syncLine", { n: dashNum(r.n), d: alTime(r.last_at) })],
    ["big_chunks", t("dash.al.big"), r => t("dash.al.bigLine", { key: r.key, kb: dashFmt(r.kb) })]
  ];
  let any = false;
  // Étape 50 : alerte « sauvegarde » (aucune sauvegarde réussie, ou la dernière a plus de 8 jours ; script pas lancé).
  const bkb = dash.bk, bkLate = !!(bkb && bkb.stale), bkNone = !!dash.bkMissing;
  if (bkLate || bkNone) {
    any = true;
    const box = el("div", "card dash-alert dash-bk");
    box.appendChild(el("div", "dash-al-title", "💾 " + t("bk.title")));
    const it = el("div", "dash-al-item");
    const txt = el("div", "dash-al-txt");
    txt.appendChild(document.createTextNode(bkNone ? t("bk.dash.missing") : bkb.age_days == null ? t("bk.dash.never") : t("bk.dash.stale", { n: dashNum(bkb.age_days) })));
    if (bkLate && bkb.last_error) txt.appendChild(el("div", "muted", t("bk.dash.error", { m: String(bkb.last_error).slice(0, 160) })));
    it.appendChild(txt);
    const acts = el("div", "dash-al-acts");
    const b = el("button", "dash-link", t("bk.dash.see"));
    b.type = "button"; b.id = "dashBkSee";
    b.addEventListener("click", () => { location.hash = "#" + HASH_OF.adminbk; });
    acts.appendChild(b);
    it.appendChild(acts);
    box.appendChild(it);
    sec.appendChild(box);
  }
  groups.forEach(([k, title, line]) => {
    const rows = arr(a[k]);
    if (!rows.length) return;
    any = true;
    const box = el("div", "card dash-alert");
    box.appendChild(el("div", "dash-al-title", title + " (" + rows.length + ")"));
    rows.forEach(r => {
      const it = el("div", "dash-al-item");
      const txt = el("div", "dash-al-txt");
      txt.append(el("b", null, r.identifiant || "?"), document.createTextNode(" — " + line(r)));
      it.appendChild(txt);
      const acts = el("div", "dash-al-acts");
      if (k === "claude_errors") {
        const q = el("button", "dash-link", t("dash.seeRequests"));
        q.type = "button";
        q.addEventListener("click", () => dashGoRequests(r.user_id, "error"));
        acts.appendChild(q);
      }
      const b = el("button", "dash-link", t("dash.seeAccount"));
      b.type = "button";
      b.addEventListener("click", () => dashGoAccount(r.user_id));
      acts.appendChild(b);
      it.appendChild(acts);
      box.appendChild(it);
    });
    sec.appendChild(box);
  });
  if (!any) sec.appendChild(el("div", "empty dash-empty", t("dash.noAlert")));
  return sec;
}
