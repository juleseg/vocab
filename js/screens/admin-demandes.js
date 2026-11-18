"use strict";

// === ADMINISTRATION : DEMANDES À CLAUDE ===
// (suite de la découpe : même section, fichier séparé pour rester sous 120 Ko)
// --- Demandes à Claude (suivi admin, étape 23) : écran #admin-demandes ---
// Seulement les demandes de la file d'attente (« Demander à Claude »). Tout passe par les fonctions SQL admin_claude_*
// (security definer, contrôle is_admin()) du script supabase-etape23.sql.
// Compteurs : admin_claude_stats(jours), une ligne par compte, tri par colonne, ligne Total.
// Historique : admin_claude_history(filtres, page), 50 par page, seule la page affichée est dans le DOM.
// Détail : admin_claude_request(id) → cartes envoyées et réponses lot par lot en tableaux, « Voir le JSON ».
// Actions : admin_claude_retry (relancer), admin_claude_delete (supprimer).
const AQ_PAGE = 50;
const AQ_COLS = [
  ["identifiant", "aq.col.account"], ["nb_demandes", "aq.col.total"], ["nb_complete", "aq.col.complete"],
  ["nb_verify", "aq.col.verify"], ["nb_generate", "aq.col.generate"], ["cartes_envoyees", "aq.col.cards"],
  ["recues", "aq.col.received"], ["acceptees", "aq.col.accepted"], ["refusees", "aq.col.rejected"],
  ["en_erreur", "aq.col.errors"], ["derniere_demande", "aq.col.last"]
];
const aq = {
  period: "30",                                   // "7" | "30" | "all"
  stats: null, statsLoading: false, statsErr: "",
  sort: { key: "nb_demandes", dir: -1 },
  f: { user: "", kind: "", status: "", days: "" }, // filtres de l'historique ("" = tous)
  page: 0, hist: null, histLoading: false, histErr: "", cleaned: false
};
async function aqRpc(name, args) {
  const cl = Supa.client();
  if (!cl) throw new Error("no client");
  const r = await withTimeout(cl.rpc(name, args || {}), 20000);
  if (r && r.error) throw r.error;
  return r ? r.data : null;
}
function aqErrText(e) {
  const code = String((e && e.code) || ""), msg = String((e && (e.message || e.msg)) || e || "");
  if (code === "42501" || /réservé à l'admin/i.test(msg)) return t("aq.err.denied");
  if (["PGRST202", "42883", "PGRST205", "42P01"].includes(code) || /could not find|does not exist|schema cache/i.test(msg)) return t("aq.err.missing");
  if (sbErrKind(e) === "net") return t("queue.err.net");
  return t("admin.err");
}
function aqDays(v) { return v === "7" ? 7 : v === "30" ? 30 : null; }
function aqDate(s) { return s ? queueDate(s) : "—"; }
async function aqLoadStats() {
  aq.statsLoading = true; aq.statsErr = "";
  if (currentScreen === "adminreq") renderAdminReq();
  try {
    if (!aq.cleaned) { aq.cleaned = true; try { await aqRpc("admin_claude_cleanup"); } catch (e) {} }   // contenu > 30 jours
    aq.stats = arr(await aqRpc("admin_claude_stats", { p_days: aqDays(aq.period) }));
  } catch (e) { aq.stats = null; aq.statsErr = aqErrText(e); }
  aq.statsLoading = false;
  if (currentScreen === "adminreq") renderAdminReq();
}
async function aqLoadHist() {
  aq.histLoading = true; aq.histErr = "";
  if (currentScreen === "adminreq") renderAdminReq();
  try {
    const r = await aqRpc("admin_claude_history", {
      p_user: aq.f.user || null, p_kind: aq.f.kind || null, p_status: aq.f.status || null,
      p_days: aqDays(aq.f.days), p_page: aq.page, p_size: AQ_PAGE
    });
    aq.hist = { total: num(Number(r && r.total), 0), rows: arr(r && r.rows) };
    const pages = Math.max(1, Math.ceil(aq.hist.total / AQ_PAGE));
    if (aq.page > pages - 1 && aq.page > 0) { aq.page = pages - 1; aq.histLoading = false; return aqLoadHist(); }
  } catch (e) { aq.hist = null; aq.histErr = aqErrText(e); }
  aq.histLoading = false;
  if (currentScreen === "adminreq") renderAdminReq();
}
function aqReload() { aqLoadStats(); aqLoadHist(); }

function renderAdminReq() {
  const root = $("#screen-adminreq");
  if (!root) return;
  root.textContent = "";
  const back = el("button", "link-btn", t("aq.back"));
  back.addEventListener("click", () => { location.hash = "#" + HASH_OF.admin; });
  root.appendChild(back);
  const top = el("div", "adm-top");
  top.appendChild(el("h2", null, t("aq.title")));
  const ref = el("button", "link-btn", t("admin.refresh"));
  ref.addEventListener("click", aqReload);
  top.appendChild(ref);
  root.appendChild(top);
  root.appendChild(el("p", "q-note", t("aq.help")));
  if (!aq.stats && !aq.statsLoading && !aq.statsErr) { aqReload(); return; }

  // Compteurs par compte
  root.appendChild(el("h3", "aq-h", t("aq.counters")));
  const seg = el("div", "seg aq-period");
  [["7", "aq.p7"], ["30", "aq.p30"], ["all", "aq.pAll"]].forEach(([v, k]) => {
    const b = el("button", null, t(k));
    b.type = "button"; b.setAttribute("aria-pressed", String(aq.period === v));
    b.addEventListener("click", () => { if (aq.period === v) return; aq.period = v; aqLoadStats(); });
    seg.appendChild(b);
  });
  root.appendChild(seg);
  if (aq.statsLoading && !aq.stats) root.appendChild(el("div", "empty", t("admin.loading")));
  else if (aq.statsErr) root.appendChild(el("div", "card q-err", aq.statsErr));
  else if (aq.stats) {
    const csv = el("button", "btn dash-csv aq-csv", t("dash.csv"));     // export CSV (étape 25)
    csv.type = "button";
    csv.addEventListener("click", aqStatsCsv);
    root.appendChild(csv);
    root.appendChild(aqStatsTable());
  }

  // Historique
  const hh = el("h3", "aq-h", t("aq.history"));
  hh.id = "aqHist";
  root.appendChild(hh);
  root.appendChild(aqFilters());
  if (aq.f.user) {                                   // fiche du compte filtré (étape 26)
    const fi = el("button", "btn dash-csv aq-csv", t("fc.open"));
    fi.type = "button";
    fi.addEventListener("click", () => openAccountFiche(aq.f.user, "adminreq"));
    root.appendChild(fi);
  }
  if (aq.histLoading && !aq.hist) { root.appendChild(el("div", "empty", t("admin.loading"))); return; }
  if (aq.histErr) { root.appendChild(el("div", "card q-err", aq.histErr)); return; }
  if (!aq.hist) return;
  root.appendChild(el("p", "muted aq-count", t("aq.nReq", { n: aq.hist.total })));
  if (!aq.hist.rows.length) { root.appendChild(el("div", "empty", t("aq.none"))); return; }
  const pages = Math.max(1, Math.ceil(aq.hist.total / AQ_PAGE));
  const pager = () => {
    if (pages < 2) return null;
    const w = el("div", "pv-pager");
    const prev = el("button", "btn", "‹"), next = el("button", "btn", "›");
    prev.setAttribute("aria-label", t("pv.prev")); next.setAttribute("aria-label", t("pv.next"));
    prev.disabled = aq.page === 0 || aq.histLoading; next.disabled = aq.page >= pages - 1 || aq.histLoading;
    const go = d => { aq.page += d; aqLoadHist().then(() => { const h = $("#aqHist"); if (h) try { h.scrollIntoView({ block: "start" }); } catch (e) {} }); };
    prev.addEventListener("click", () => go(-1));
    next.addEventListener("click", () => go(1));
    w.append(prev, el("span", null, t("pv.page", { i: aq.page + 1, n: pages })), next);
    return w;
  };
  const p1 = pager(); if (p1) root.appendChild(p1);
  const list = el("div", "aq-list");
  aq.hist.rows.forEach(r => list.appendChild(aqRow(r)));
  root.appendChild(list);
  const p2 = pager(); if (p2) root.appendChild(p2);
}

function aqStatsTable() {
  const rows = aq.stats.slice();
  const { key, dir } = aq.sort;
  rows.sort((a, b) => {
    let x = a[key], y = b[key];
    if (key === "identifiant") return dir * String(x || "").localeCompare(String(y || ""));
    if (key === "derniere_demande") { x = x ? Date.parse(x) : 0; y = y ? Date.parse(y) : 0; }
    else { x = Number(x) || 0; y = Number(y) || 0; }
    return dir * (x - y) || String(a.identifiant).localeCompare(String(b.identifiant));
  });
  const wrap = el("div", "aq-tablewrap");
  const tb = el("table", "aq-table");
  const thead = el("thead"), hr = el("tr");
  AQ_COLS.forEach(([k, lab]) => {
    const th = el("th");
    const b = el("button", "aq-sort", t(lab) + (key === k ? (dir > 0 ? " ▲" : " ▼") : ""));
    b.type = "button";
    b.addEventListener("click", () => {
      if (aq.sort.key === k) aq.sort.dir = -aq.sort.dir;
      else aq.sort = { key: k, dir: k === "identifiant" ? 1 : -1 };
      renderAdminReq();
    });
    th.appendChild(b);
    hr.appendChild(th);
  });
  thead.appendChild(hr); tb.appendChild(thead);
  const body = el("tbody");
  const tot = {};
  AQ_COLS.forEach(([k]) => { tot[k] = 0; });
  tot.derniere_demande = null;
  rows.forEach(r => {
    const tr = el("tr", "aq-acc");
    tr.dataset.user = r.user_id;
    AQ_COLS.forEach(([k]) => {
      let v = r[k];
      if (k === "identifiant") v = String(v || "?");
      else if (k === "derniere_demande") { if (v && (!tot.derniere_demande || Date.parse(v) > Date.parse(tot.derniere_demande))) tot.derniere_demande = v; v = v ? admDate(v) : "—"; }
      else { v = num(Number(v), 0); tot[k] += v; }
      tr.appendChild(el("td", k === "identifiant" ? "aq-name" : "num", String(v)));
    });
    tr.addEventListener("click", () => {          // historique filtré sur ce compte
      aq.f.user = r.user_id; aq.page = 0;
      aqLoadHist().then(() => { const h = $("#aqHist"); if (h) try { h.scrollIntoView({ block: "start" }); } catch (e) {} });
    });
    body.appendChild(tr);
  });
  tb.appendChild(body);
  const tf = el("tfoot"), fr = el("tr", "aq-total");
  AQ_COLS.forEach(([k]) => {
    const v = k === "identifiant" ? t("aq.totalRow") : k === "derniere_demande" ? (tot.derniere_demande ? admDate(tot.derniere_demande) : "—") : String(tot[k]);
    fr.appendChild(el("td", k === "identifiant" ? "aq-name" : "num", v));
  });
  tf.appendChild(fr); tb.appendChild(tf);
  wrap.appendChild(tb);
  return wrap;
}

// Export CSV des compteurs par compte (période choisie), avec la ligne Total, dans l'ordre de tri affiché.
function aqStatsCsv() {
  const rows = aq.stats.slice();
  const { key, dir } = aq.sort;
  rows.sort((a, b) => {
    let x = a[key], y = b[key];
    if (key === "identifiant") return dir * String(x || "").localeCompare(String(y || ""));
    if (key === "derniere_demande") { x = x ? Date.parse(x) : 0; y = y ? Date.parse(y) : 0; }
    else { x = Number(x) || 0; y = Number(y) || 0; }
    return dir * (x - y) || String(a.identifiant).localeCompare(String(b.identifiant));
  });
  const tot = AQ_COLS.map(([k]) => k === "identifiant" ? t("aq.totalRow") : k === "derniere_demande" ? "" : 0);
  const out = rows.map(r => AQ_COLS.map(([k], i) => {
    if (k === "identifiant") return String(r[k] || "?");
    if (k === "derniere_demande") { if (r[k] && (!tot[i] || Date.parse(r[k]) > Date.parse(tot[i]))) tot[i] = r[k]; return admDay(r[k]); }
    const v = num(Number(r[k]), 0); tot[i] += v; return v;
  }));
  const li = AQ_COLS.findIndex(([k]) => k === "derniere_demande");
  if (li >= 0) tot[li] = admDay(tot[li]);
  out.push(tot);
  dashSaveCsv("demandes-claude-" + (aq.period === "all" ? "tout" : aq.period + "j"), AQ_COLS.map(([, lab]) => t(lab)), out);
}
function aqFilters() {
  const box = el("div", "aq-filters");
  const mk = (label, opts, val, on) => {
    const s = el("select", "input");
    opts.forEach(([v, l]) => { const o = el("option", null, l); o.value = v; s.appendChild(o); });
    s.value = val;
    if (s.value !== val) s.value = "";
    s.setAttribute("aria-label", label);
    s.addEventListener("change", () => { on(s.value); aq.page = 0; aqLoadHist(); });
    const w = el("label", "aq-f");
    w.append(el("span", null, label), s);
    box.appendChild(w);
  };
  const accts = (aq.stats || []).slice().sort((a, b) => String(a.identifiant).localeCompare(String(b.identifiant)));
  mk(t("aq.f.account"), [["", t("aq.f.all")]].concat(accts.map(a => [a.user_id, a.identifiant])), aq.f.user, v => { aq.f.user = v; });
  mk(t("aq.f.kind"), [["", t("aq.f.all")]].concat(["complete", "verify", "generate", "story"].map(k => [k, t("queue.kind." + k)])), aq.f.kind, v => { aq.f.kind = v; });
  mk(t("aq.f.status"), [["", t("aq.f.all")]].concat(["pending", "processing", "done", "error"].map(k => [k, t("aq.st." + k)])), aq.f.status, v => { aq.f.status = v; });
  mk(t("aq.f.period"), [["", t("aq.pAll")], ["7", t("aq.p7")], ["30", t("aq.p30")]], aq.f.days, v => { aq.f.days = v; });
  return box;
}

function aqRow(r) {
  const box = el("button", "card q-item aq-row");
  box.type = "button";
  const head = el("div", "q-head");
  const left = el("div");
  left.appendChild(el("div", "q-title", r.identifiant + " · " + t("queue.kind." + r.kind) + (r.label ? " · " + r.label : "")));
  left.appendChild(el("div", "q-meta", [
    queueMetaCount(r),
    t("aq.batches", { n: r.batch_count }), t("aq.attempts", { n: r.attempts })].join(" · ")));
  head.append(left, el("span", "q-st " + r.status, queueStatusText(r)));
  box.appendChild(head);
  box.appendChild(el("div", "q-meta", [
    t("aq.d.created", { d: aqDate(r.created_at) }), t("aq.d.started", { d: aqDate(r.started_at) }),
    t("aq.d.finished", { d: aqDate(r.finished_at) }), t("aq.d.fetched", { d: aqDate(r.fetched_at) })].join(" · ")));
  box.appendChild(el("div", "q-meta aq-counts", t("aq.props", { r: r.proposals_received || 0, a: r.proposals_accepted || 0, x: r.proposals_rejected || 0 })));
  if (r.error) box.appendChild(el("div", "q-err", r.error));
  const tags = el("div", "adm-tags");
  if (r.hidden_by_user) tags.appendChild(el("span", "tag", t("aq.hidden")));
  if (r.content_cleared_at) tags.appendChild(el("span", "tag", t("aq.cleared")));
  if (tags.childNodes.length) box.appendChild(tags);
  box.addEventListener("click", () => aqOpenDetail(r));
  return box;
}

// --- Détail d'une demande ---
// Cartes d'un lot complete / verify : JSON à la fin du prompt (« Cartes : » puis [{ id: "k0", target, <langues>, example, missing }]).
function aqBatchCards(b) {
  try {
    const p = String((b && b.prompt) || "");
    const i = p.lastIndexOf("Cartes :");
    if (i < 0) return [];
    const j = p.indexOf("[", i);
    return arr(JSON.parse(p.slice(j)));
  } catch (e) { return []; }
}
function aqFieldName(f) {
  try { return pvFieldLabel(String(f)); } catch (e) { return String(f); }
}
function aqTable(head, rows) {
  const wrap = el("div", "aq-tablewrap");
  const tb = el("table", "aq-table aq-detail");
  const hr = el("tr");
  head.forEach(h => hr.appendChild(el("th", null, h)));
  const th = el("thead"); th.appendChild(hr); tb.appendChild(th);
  const body = el("tbody");
  rows.forEach(r => { const tr = el("tr"); r.forEach(c => tr.appendChild(el("td", null, c == null ? "" : String(c)))); body.appendChild(tr); });
  tb.appendChild(body);
  wrap.appendChild(tb);
  return wrap;
}
function aqCardWord(it) { return it ? String(it[it.target] || it.id || "") : ""; }
async function aqOpenDetail(r0) {
  const wrap = el("div", "aq-detailbox");
  wrap.appendChild(el("p", "muted", t("admin.loading")));
  let close = openModal(t("queue.kind." + r0.kind) + " · " + r0.identifiant, wrap, [{ label: t("close") }]);
  let d;
  try { d = await aqRpc("admin_claude_request", { p_id: r0.id }); }
  catch (e) { wrap.textContent = ""; wrap.appendChild(el("p", "q-err", aqErrText(e))); return; }
  close();
  if (!d || !d.request) { toast(t("aq.gone")); aqReload(); return; }
  const r = d.request, props = arr(d.proposals);
  const body = el("div", "aq-detailbox");
  const sum = [
    [t("aq.f.account"), r.identifiant], [t("aq.f.kind"), t("queue.kind." + r.kind)], [t("aq.label"), r.label || "—"],
    [t("aq.f.status"), queueStatusText(r) + (r.error ? " — " + r.error : "")],
    [t("aq.col.cards"), r.card_count], [t("aq.lots"), r.batch_count], [t("aq.tries"), r.attempts],
    [t("aq.dates"), [t("aq.d.created", { d: aqDate(r.created_at) }), t("aq.d.started", { d: aqDate(r.started_at) }),
      t("aq.d.finished", { d: aqDate(r.finished_at) }), t("aq.d.fetched", { d: aqDate(r.fetched_at) })].join(" · ")],
    [t("aq.col.received") + " / " + t("aq.col.accepted") + " / " + t("aq.col.rejected"),
      (r.proposals_received || 0) + " / " + (r.proposals_accepted || 0) + " / " + (r.proposals_rejected || 0)]
  ];
  if (r.hidden_by_user) sum.push([t("aq.hidden"), "✓"]);
  const dl = el("dl", "aq-sum");
  sum.forEach(([k, v]) => { dl.append(el("dt", null, k), el("dd", null, String(v))); });
  body.appendChild(dl);
  const pl = r.payload || {};
  const batches = arr(pl.batches);
  if (r.content_cleared_at) body.appendChild(el("p", "aq-cleared", t("aq.clearedLong")));
  else {
    // Cartes envoyées
    body.appendChild(el("h4", null, t("aq.sent")));
    if (r.kind === "story") {                                     // étape 45 : mots demandés
      const sr = pl.story || (batches[0] && batches[0].story) || {};
      body.appendChild(el("p", "muted", [sr.lang, sr.level, sr.len].filter(Boolean).join(" · ")));
      const rows = arr(sr.words).map(w => [w.k || "", w.w || "", w.tr || ""]);
      body.appendChild(rows.length ? aqTable(["#", t("aq.card"), t("aq.content")], rows) : el("p", "muted", "—"));
    } else if (r.kind === "generate") {
      const req = pl.req || {};
      const rows = Object.keys(req).filter(k => !["lg"].includes(k)).map(k => {
        const v = req[k];
        return [k, Array.isArray(v) ? v.join(", ") : v && typeof v === "object" ? JSON.stringify(v) : String(v == null ? "" : v)];
      }).filter(x => x[1] !== "");
      if (req.lg) rows.unshift(["langues", (req.lg.target || "") + " ← " + arr(req.lg.support).join(", ")]);
      body.appendChild(rows.length ? aqTable([t("aq.param"), t("aq.value")], rows) : el("p", "muted", "—"));
    } else {
      const rows = [];
      batches.forEach((b, bi) => aqBatchCards(b).forEach(it => {
        const other = Object.keys(it).filter(k => !["id", "target", "missing", it.target].includes(k)).map(k => aqFieldName(k) + " : " + it[k]).join(" · ");
        const row = [(bi + 1) + "·" + it.id, aqCardWord(it), other];
        if (r.kind === "complete") row.push(arr(it.missing).map(aqFieldName).join(", "));
        rows.push(row);
      }));
      const head = [t("aq.lot"), t("aq.card"), t("aq.content")];
      if (r.kind === "complete") head.push(t("aq.missing"));
      body.appendChild(rows.length ? aqTable(head, rows) : el("p", "muted", "—"));
    }
    // Réponse de Claude lot par lot
    body.appendChild(el("h4", null, t("aq.answer")));
    if (!props.length) body.appendChild(el("p", "muted", t("aq.noAnswer")));
    props.forEach(p => {
      body.appendChild(el("div", "aq-lothead", t("aq.lotN", { n: num(Number(p.batch), 0) + 1, m: Math.max(batches.length, 1) }) + " · " + aqDate(p.created_at)));
      const cards = new Map(aqBatchCards(batches[p.batch]).map(it => [it.id, it]));
      const res = p.result;
      let rows = [], head;
      if (r.kind === "story") {                                   // étape 45 : titre, phrases, questions
        head = ["#", t("aq.content")];
        const o = res && typeof res === "object" ? res : {};
        if (o.title) rows.push(["", String(o.title)]);
        arr(o.sentences).forEach((x, i) => rows.push([i + 1, String((x && (x.text || x.t)) || x || "") + (x && x.tr ? " — " + x.tr : "")]));
        arr(o.questions).forEach((q, i) => rows.push(["Q" + (i + 1), String((q && q.q) || "") + " → " + String(arr(q && q.options)[num(q && q.answer, -1)] || "?")]));
      } else if (r.kind === "generate") {
        head = ["#", t("aq.type"), t("aq.content")];
        const lines = Array.isArray(res) ? res : res && Array.isArray(res.lines) ? res.lines : [];
        lines.forEach((ln, i) => { const cs = String(ln).split(";"); rows.push([i + 1, cs[0], cs.slice(1).join(" ; ")]); });
      } else {
        head = [t("aq.card"), t("aq.field"), t("aq.proposed")];
        const items = Array.isArray(res) ? res : res && typeof res === "object" ? arr(res.items || res.cards || res.result || res.errors) : [];
        items.forEach(it => {
          if (!it || typeof it !== "object") return;
          const w = aqCardWord(cards.get(String(it.id))) || String(it.id || "");
          if (r.kind === "verify") rows.push([w, aqFieldName(it.field), String(it.value == null ? "" : it.value) + (it.reason ? " (" + it.reason + ")" : "")]);
          else Object.keys(it).filter(k => k !== "id").forEach(k => {
            const v = it[k];
            if (v && typeof v === "object") Object.keys(v).forEach(s => rows.push([w, aqFieldName(k + ":" + s), String(v[s])]));
            else rows.push([w, aqFieldName(k), String(v == null ? "" : v)]);
          });
        });
      }
      body.appendChild(rows.length ? aqTable(head, rows) : el("p", "muted", t("aq.emptyAnswer")));
    });
  }
  const acts = [];
  acts.push({ label: t("aq.json"), onClick: () => { setTimeout(() => aqShowJson(d), 0); return false; } });
  if (["error", "processing"].includes(r.status) && !r.content_cleared_at) acts.push({ label: t("aq.retry"), kind: "primary", onClick: () => { aqRetry(r); } });
  acts.push({ label: t("aq.delete"), kind: "danger", onClick: () => { setTimeout(() => aqDelete(r), 0); } });
  if (r.user_id || r0.user_id) acts.push({ label: t("fc.open"), onClick: () => { openAccountFiche(r.user_id || r0.user_id, "adminreq"); } });
  acts.push({ label: t("close") });
  openModal(t("queue.kind." + r.kind) + " · " + r.identifiant, body, acts);
}
function aqShowJson(d) {
  const pre = el("pre", "aq-json", JSON.stringify(d, null, 2));
  openModal(t("aq.json"), pre, [
    { label: t("aq.copy"), onClick: () => { try { navigator.clipboard.writeText(pre.textContent).then(() => toast(t("aq.copied")), () => {}); } catch (e) {} return false; } },
    { label: t("close") }
  ]);
}
async function aqRetry(r) {
  try { await aqRpc("admin_claude_retry", { p_id: r.id }); toast(t("aq.retried")); Activity.log("admin_claude_retry", { target: r.identifiant, kind: r.kind }); }
  catch (e) { toast(aqErrText(e)); }
  aqReload();
}
function aqDelete(r) {
  openModal(t("aq.delete"), el("p", null, t("aq.delConfirm", { id: r.identifiant })), [
    { label: t("cancel") },
    { label: t("aq.delete"), kind: "danger", onClick: () => {
      (async () => {
        try { await aqRpc("admin_claude_delete", { p_id: r.id }); toast(t("aq.deleted")); Activity.log("admin_claude_delete", { target: r.identifiant, kind: r.kind }); }
        catch (e) { toast(aqErrText(e)); }
        aqReload();
      })();
    } }
  ]);
}
