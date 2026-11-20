"use strict";

// === ADMINISTRATION : ERREURS (ÉTAPE 41) ===
// Écran #admin-erreurs (admin, mode Supabase). Fonctions SQL du script supabase-etape41.sql (security definer,
// contrôle is_admin()) : admin_errors_list (liste regroupée, filtres, page), admin_error_detail, admin_error_set_state,
// admin_errors_export. Textes : js/i18n/errors-<langue>.js.
// - Liste : une ligne par erreur (empreinte), la plus récente d'abord, 50 par page (seule la page affichée est dans le
//   DOM) : type, état, message, nombre (dans le filtre), comptes touchés, appareils, versions, dernière fois.
// - Filtres : état (nouvelles et vues par défaut), type, version, compte, période (24 h / 7 j / 30 j / tout = 90 jours).
// - Détail (toucher une ligne) : message, origine, pile, dates, total, par version, comptes, appareils, écrans,
//   30 dernières occurrences. Ouvrir une erreur « nouvelle » la marque « vue ». Boutons « Corrigée » (version de
//   l'appli notée : une occurrence dans une version plus récente la rouvrira) et « Rouvrir ».
// - Export CSV : une ligne par occurrence enregistrée, mêmes filtres (séparateur « ; », UTF-8 avec BOM).
// - Script pas lancé : « Lancez le script SQL de l'étape 41 » (la capture reste sur l'appareil, sans erreur).
// - Étape 68 : sélection multiple (cases à cocher, « Tout sélectionner » selon les filtres, barre d'actions) :
//   section « ERREURS : SÉLECTION MULTIPLE (ÉTAPE 68) » à la fin de ce fichier ; fonction SQL admin_errors_set_state_bulk.
const CE_PAGE = 50;
const CE_KINDS = ["js", "promise", "sync", "supabase", "push"];
const ce = { f: { state: "open", kind: "", version: "", user: "", days: "30" }, page: 0, data: null, loading: false, err: "", missing: false };

function ceRerender() { if (currentScreen === "adminerr") renderAdminErrors(); }
function ceErrText(e) { return alIsMissing(e) ? t("ce.missing") : aqErrText(e); }
function ceArgs() {
  return { p_state: ce.f.state || null, p_version: ce.f.version || null, p_user: ce.f.user || null,
           p_days: alDays(ce.f.days), p_kind: ce.f.kind || null };
}
function ceKind(k) { return I18N.fr["ce.k." + k] ? t("ce.k." + k) : String(k || ""); }
function ceState(s) { return I18N.fr["ce.st." + s] ? t("ce.st." + s) : String(s || ""); }
function ceWho(id, ident) { return id ? (ident || "?") : t("ce.d.anon"); }

async function ceLoad() {
  ce.loading = true; ce.err = "";
  ceRerender();
  if (!adm.list) { try { adm.list = arr(await Supa.listAccounts()); } catch (e) {} }   // comptes du filtre
  try {
    const r = await aqRpc("admin_errors_list", Object.assign(ceArgs(), { p_page: ce.page, p_size: CE_PAGE }));
    ce.missing = false;
    ce.data = { total: num(Number(r && r.total), 0), occ: num(Number(r && r.occurrences), 0), counts: (r && r.counts) || {},
                versions: arr(r && r.versions), rows: arr(r && r.rows) };
    const pages = Math.max(1, Math.ceil(ce.data.total / CE_PAGE));
    if (ce.page > pages - 1 && ce.page > 0) { ce.page = pages - 1; ce.loading = false; return ceLoad(); }
  } catch (e) { ce.data = null; ce.missing = alIsMissing(e); ce.err = ceErrText(e); }
  ce.loading = false;
  ceRerender();
}

function renderAdminErrors() {
  const root = $("#screen-adminerr");
  if (!root) return;
  root.textContent = "";
  const back = el("button", "link-btn", t("aq.back"));
  back.addEventListener("click", () => { location.hash = "#" + HASH_OF.admin; });
  root.appendChild(back);
  const top = el("div", "adm-top");
  top.appendChild(el("h2", null, t("ce.title")));
  const ref = el("button", "link-btn", t("admin.refresh"));
  ref.addEventListener("click", ceLoad);
  top.appendChild(ref);
  root.appendChild(top);
  const local = ErrLog.pending();
  if (!ce.data && !ce.loading && !ce.err) { ceLoad(); return; }
  if (ce.missing) {
    root.appendChild(el("div", "card q-err", t("ce.missing")));
    if (local) root.appendChild(el("p", "q-note", t("ce.queue", { n: local })));
    return;
  }
  root.appendChild(el("p", "q-note", t("ce.help")));
  if (local) root.appendChild(el("p", "q-note", t("ce.queue", { n: local })));
  root.appendChild(ceFilters());
  if (ce.loading && !ce.data) { root.appendChild(el("div", "empty", t("admin.loading"))); return; }
  if (ce.err) { root.appendChild(el("div", "card q-err", ce.err)); return; }
  if (!ce.data) return;
  const c = ce.data.counts;
  const chips = el("div", "adm-tags ce-counts");
  [["new", "bad"], ["seen", ""], ["fixed", "ok"]].forEach(([s, cls]) => {
    chips.appendChild(el("span", "tag" + (cls ? " " + cls : ""), ceState(s) + " : " + num(Number(c[s]), 0)));
  });
  root.appendChild(chips);
  const bar = el("div", "al-bar");
  bar.appendChild(el("span", "muted", t("ce.count", { n: ce.data.total, o: ce.data.occ })));
  const csv = el("button", "btn", t("ce.csv"));
  csv.disabled = !ce.data.total;
  csv.addEventListener("click", ceExportCsv);
  bar.appendChild(csv);
  root.appendChild(bar);
  if (!ce.data.rows.length) { root.appendChild(el("div", "empty", t("ce.none"))); return; }
  const tools = cemTools(); if (tools) root.appendChild(tools);   // étape 68 : sélection multiple
  const pages = Math.max(1, Math.ceil(ce.data.total / CE_PAGE));
  const pager = () => {
    if (pages < 2) return null;
    const w = el("div", "pv-pager");
    const prev = el("button", "btn", "‹"), next = el("button", "btn", "›");
    prev.setAttribute("aria-label", t("pv.prev")); next.setAttribute("aria-label", t("pv.next"));
    prev.disabled = ce.page === 0 || ce.loading; next.disabled = ce.page >= pages - 1 || ce.loading;
    const go = d => { ce.page += d; ceLoad().then(() => window.scrollTo(0, 0)); };
    prev.addEventListener("click", () => go(-1));
    next.addEventListener("click", () => go(1));
    w.append(prev, el("span", null, t("pv.page", { i: ce.page + 1, n: pages })), next);
    return w;
  };
  const p1 = pager(); if (p1) root.appendChild(p1);
  const list = el("div", "al-list");
  ce.data.rows.forEach(r => list.appendChild(cemRow(r, ceRow(r))));   // étape 68 : case à cocher
  root.appendChild(list);
  const p2 = pager(); if (p2) root.appendChild(p2);
}

function ceFilters() {
  const box = el("div", "aq-filters al-filters");
  const mk = (label, opts, val, on) => {
    const s = el("select", "input");
    opts.forEach(([v, l]) => { const o = el("option", null, l); o.value = v; s.appendChild(o); });
    s.value = val;
    if (s.value !== val) s.value = "";
    s.setAttribute("aria-label", label);
    s.addEventListener("change", () => { on(s.value); ce.page = 0; cemReset(); ceLoad(); });   // étape 68 : un filtre change = sélection effacée
    const w = el("label", "aq-f");
    w.append(el("span", null, label), s);
    box.appendChild(w);
  };
  mk(t("ce.f.state"), [["open", t("ce.st.open")], ["new", t("ce.st.new")], ["seen", t("ce.st.seen")], ["fixed", t("ce.st.fixed")], ["", t("ce.st.all")]],
    ce.f.state, v => { ce.f.state = v; });
  mk(t("aq.f.kind"), [["", t("aq.f.all")]].concat(CE_KINDS.map(k => [k, ceKind(k)])), ce.f.kind, v => { ce.f.kind = v; });
  const vers = arr(ce.data && ce.data.versions);
  if (ce.f.version && !vers.includes(ce.f.version)) vers.unshift(ce.f.version);
  mk(t("ce.f.version"), [["", t("aq.f.all")]].concat(vers.map(v => [String(v), "v" + v])), ce.f.version, v => { ce.f.version = v; });
  const accts = arr(adm.list).slice().sort((a, b) => String(a.identifiant).localeCompare(String(b.identifiant)));
  mk(t("aq.f.account"), [["", t("aq.f.all")]].concat(accts.map(a => [a.user_id, a.identifiant])), ce.f.user, v => { ce.f.user = v; });
  mk(t("aq.f.period"), [["1", t("al.p1")], ["7", t("aq.p7")], ["30", t("aq.p30")], ["", t("ce.pAll")]], ce.f.days, v => { ce.f.days = v; });
  return box;
}

function ceRow(r) {
  const box = el("button", "card al-row ce-row");
  box.type = "button";
  const head = el("div", "al-head");
  const tags = el("span", "ce-tags");
  tags.append(el("span", "al-tag" + (r.kind === "js" || r.kind === "promise" ? " bad" : ""), ceKind(r.kind)),
              el("span", "al-tag ce-st-" + r.state, ceState(r.state)));
  head.append(tags, el("span", "al-time", alTime(r.last_at)));
  box.appendChild(head);
  box.appendChild(el("div", "ce-msg", String(r.message || "")));
  const vers = arr(r.versions).slice(0, 4).map(v => "v" + v).join(", ") + (arr(r.versions).length > 4 ? "…" : "");
  box.appendChild(el("div", "al-dev", [t("ce.meta", { n: num(Number(r.n), 0), a: num(Number(r.accounts), 0), d: num(Number(r.devices), 0) }), vers,
    r.source ? String(r.source) : ""].filter(Boolean).join(" · ")));
  box.addEventListener("click", () => ceOpen(r));
  return box;
}

// Détail d'une erreur. Une erreur « nouvelle » passe à « vue » à l'ouverture.
async function ceOpen(r) {
  const wrap = el("div", "aq-detailbox");
  wrap.appendChild(el("p", "muted", t("admin.loading")));
  const close = openModal(ceKind(r.kind), wrap, [{ label: t("close") }]);
  let d;
  try { d = await aqRpc("admin_error_detail", { p_fp: r.fingerprint }); }
  catch (e) { wrap.textContent = ""; wrap.appendChild(el("p", "q-err", ceErrText(e))); return; }
  const er = (d && d.error) || r;
  if (er.state === "new") {
    try { if (Number(await aqRpc("admin_error_set_state", { p_fps: [r.fingerprint], p_state: "seen", p_version: APP_VERSION })) > 0) { er.state = "seen"; r.state = "seen"; ceLoad(); } }
    catch (e) {}
  }
  wrap.textContent = "";
  const dl = el("dl", "aq-sum");
  [[t("ce.d.state"), ceState(er.state) + (er.state === "fixed" && er.fixed_version ? " (v" + er.fixed_version + ")" : "")],
   [t("ce.d.message"), er.message], [t("ce.d.source"), er.source || "—"],
   [t("ce.d.first"), alTime(er.first_seen)], [t("ce.d.last"), alTime(er.last_seen)],
   [t("ce.d.total"), String(num(Number(er.total), 0))], [t("ce.f.version"), er.last_version ? "v" + er.last_version : "—"],
   [t("ce.d.screen"), er.last_screen || "—"]]
    .forEach(([a, b]) => dl.append(el("dt", null, a), el("dd", null, String(b == null ? "" : b))));
  wrap.appendChild(dl);
  if (er.stack) { wrap.appendChild(el("h4", null, t("ce.d.stack"))); wrap.appendChild(el("pre", "aq-json", String(er.stack))); }
  const section = (title, rows, line) => {
    rows = arr(rows);
    if (!rows.length) return;
    wrap.appendChild(el("h4", null, title));
    const ul = el("ul", "ce-ul");
    rows.forEach(x => { const li = el("li"); line(li, x); ul.appendChild(li); });
    wrap.appendChild(ul);
  };
  section(t("ce.d.byVersion"), d && d.by_version, (li, x) => { li.textContent = (x.version ? "v" + x.version : "—") + " : ×" + num(Number(x.n), 0) + " · " + alTime(x.last_at); });
  section(t("ce.d.accounts"), d && d.accounts, (li, x) => {
    li.appendChild(document.createTextNode(ceWho(x.user_id, x.identifiant) + " : ×" + num(Number(x.n), 0) + " · " + alTime(x.last_at) + " "));
    if (x.user_id) {
      const b = modGate(el("button", "link-btn", t("fc.open")), "accounts.see");
      b.addEventListener("click", () => { close(); openAccountFiche(x.user_id, "adminerr"); });
      li.appendChild(b);
    }
  });
  section(t("ce.d.devices"), d && d.devices, (li, x) => { li.textContent = (alDevLabel(x) || "—") + " : ×" + num(Number(x.n), 0) + (Number(x.nb) > 1 ? " · " + t("ce.d.nbDev", { n: Number(x.nb) }) : ""); });
  section(t("ce.d.screens"), d && d.screens, (li, x) => { li.textContent = (x.screen || "—") + " : ×" + num(Number(x.n), 0); });
  section(t("ce.d.recent"), d && d.recent, (li, x) => {
    li.textContent = [alTime(x.at), ceWho(x.user_id, x.identifiant), x.version ? "v" + x.version : "", x.screen || "", alDevLabel(x), Number(x.n) > 1 ? "×" + x.n : ""]
      .filter(Boolean).join(" · ");
  });
  // Boutons : Corrigée / Rouvrir, puis Fermer.
  const btns = el("div", "btns two ce-acts");
  const setState = async (st) => {
    try {
      await aqRpc("admin_error_set_state", { p_fps: [r.fingerprint], p_state: st, p_version: APP_VERSION });
      Activity.log("admin_errors_state", { state: st, n: 1, version: APP_VERSION });
      toast(t("ce.done." + st));
      close();
      ceLoad();
    } catch (e) { toast(ceErrText(e)); }
  };
  if (er.state !== "fixed") { const b = el("button", "btn primary", t("ce.act.fixed")); b.addEventListener("click", () => setState("fixed")); btns.appendChild(b); }
  if (er.state !== "new") { const b = el("button", "btn", t("ce.act.reopen")); b.addEventListener("click", () => setState("new")); btns.appendChild(b); }
  modGate(btns, "errors.act");   // étape 66 : case du modo
  wrap.appendChild(btns);
}

// Export CSV : une ligne par occurrence enregistrée (mêmes filtres que la liste).
async function ceExportCsv() {
  const pg = openProgress(t("ce.csv"), t("admin.loading"), []);
  let rows;
  try { rows = arr(await aqRpc("admin_errors_export", ceArgs())); }
  catch (e) { pg.close(); toast(ceErrText(e)); return; }
  pg.close();
  const iso = s => {
    const d = new Date(s);
    return isNaN(d) ? String(s || "") : todayStr(d) + " " + String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0") + ":" + String(d.getSeconds()).padStart(2, "0");
  };
  const csv = csvText([t("al.c.date"), t("ce.c.fp"), t("aq.f.kind"), t("ce.d.state"), t("ce.d.message"), t("ce.d.source"), t("ce.c.n"),
    t("ce.f.version"), t("ce.d.screen"), t("aq.f.account"), t("al.device")],
    rows.map(x => [iso(x.at), x.fingerprint, ceKind(x.kind), ceState(x.state), x.message, x.source || "", num(Number(x.n), 1), x.version || "",
      x.screen || "", ceWho(x.identifiant ? "1" : "", x.identifiant), alDevLabel(x)]));
  const name = "erreurs-" + todayStr() + ".csv";
  const okSave = await fxSave(name, inClaude() ? csv : new Blob([csv], { type: "text/csv;charset=utf-8" }));
  if (okSave === true) { toast(t("ce.csvDone", { n: rows.length })); Activity.log("admin_errors_export", { n: rows.length }); }
  else if (okSave !== "declined") showExportText(csv);
}

// === ERREURS : SÉLECTION MULTIPLE (ÉTAPE 68) ===
// Case à cocher sur chaque erreur regroupée, « Tout sélectionner » (TOUTES les erreurs des filtres en cours, sur toutes les
// pages, calculées par le serveur) et « Tout désélectionner ». Barre d'actions dès qu'une case est cochée (nombre sélectionné) :
// « Marquer corrigée », « Marquer vue », « Remettre en nouvelle » → bilan demandé au serveur (p_dry) → UNE confirmation
// (« 27 erreurs passeront en corrigée ») → admin_errors_set_state_bulk. Aucune suppression.
// - Sélection gardée quand on change de page (et après « Actualiser ») ; effacée quand un filtre change (« Tout sélectionner »
//   suit les filtres en cours) et après une action réussie.
// - « Tout sélectionner » : cem.all = copie des filtres ; les cases décochées ensuite vont dans cem.except.
// - Droits : case « Erreurs → corriger » (errors.act) des modérateurs ; sans elle, ni cases ni boutons. Le serveur contrôle
//   aussi (perm_guard) et note l'action au journal sous le nom de la personne (admin_errors_state, n, bulk).
// - « Corrigée » note la version de l'appli (APP_VERSION) : une erreur qui revient dans une version plus récente redevient
//   « nouvelle » (règle de l'étape 41, côté serveur).
const CEM_MAX = 5000;
const CEM_ACTS = ["fixed", "seen", "new"];
const cem = { ids: new Set(), except: new Set(), all: null, busy: false };

function cemCan() { return typeof Mod === "undefined" || Mod.can("errors.act"); }
function cemReset() { cem.ids.clear(); cem.except.clear(); cem.all = null; }
function cemCount() { return cem.all ? Math.max(0, cem.all.total - cem.except.size) : cem.ids.size; }
function cemHas(fp) { return cem.all ? !cem.except.has(fp) : cem.ids.has(fp); }
function cemErrText(e) {
  const h = String((e && e.hint) || "");
  if (h === "ce_many") return t("cem.err.many");
  if (alIsMissing(e)) return t("cem.missing");
  if (h === "mod_denied" || String((e && e.code) || "") === "42501") return t("mod.denied");
  return aqErrText(e);
}
// Coche / décoche une erreur. Renvoie false si la limite de 5 000 est atteinte (rien n'est changé).
function cemToggle(fp, on) {
  if (cem.all) {
    if (on) cem.except.delete(fp);
    else { if (cem.except.size >= CEM_MAX) return false; cem.except.add(fp); }
    if (cemCount() <= 0) cemReset();
  } else if (on) { if (cem.ids.size >= CEM_MAX) return false; cem.ids.add(fp); }
  else cem.ids.delete(fp);
  return true;
}
function cemSelectAll() {
  cem.ids.clear(); cem.except.clear();
  cem.all = { f: Object.assign({}, ce.f), total: ce.data ? ce.data.total : 0 };
  if (cemCount() <= 0) cemReset();
}
function cemArgs(st) {
  const a = { p_state: st, p_version: APP_VERSION, p_fps: null, p_filter: null, p_except: null };
  if (cem.all) {
    const f = cem.all.f;
    a.p_filter = { state: f.state || "", version: f.version || "", user: f.user || "", kind: f.kind || "", days: alDays(f.days) };
    a.p_except = Array.from(cem.except);
  } else a.p_fps = Array.from(cem.ids);
  return a;
}

// Case à cocher devant une ligne (la ligne reste un bouton qui ouvre le détail).
function cemRow(r, node) {
  if (!cemCan() || !r || !r.fingerprint) return node;
  const fp = r.fingerprint;
  const w = el("div", "cem-item" + (cemHas(fp) ? " on" : ""));
  w.setAttribute("data-fp", fp);
  const lab = el("label", "cem-pick");
  const cb = el("input");
  cb.type = "checkbox";
  cb.checked = cemHas(fp);
  cb.setAttribute("aria-label", t("cem.pick") + " : " + String(r.message || "").slice(0, 80));
  cb.addEventListener("change", () => {
    if (!cemToggle(fp, cb.checked)) { cb.checked = !cb.checked; toast(t("cem.err.many")); return; }
    cemPaint();
  });
  lab.appendChild(cb);
  w.append(lab, node);
  return w;
}

// Barre de sélection (collée en haut de l'écran quand on fait défiler).
function cemTools() {
  if (!cemCan() || !ce.data) return null;
  if (cem.all && !cem.busy) cem.all.total = ce.data.total;   // « Actualiser » : nombre relu
  const box = el("div", "card cem-bar");
  box.id = "cemBar";
  box.setAttribute("role", "region");
  box.setAttribute("aria-label", t("cem.region"));
  cemFill(box);
  return box;
}
function cemFill(box) {
  box.textContent = "";
  const n = cemCount();
  box.classList.toggle("on", n > 0);
  const top = el("div", "cem-top");
  const st = el("span", "cem-n" + (n ? "" : " muted"), n ? t("cem.n", { n }) : t("cem.hint"));
  st.setAttribute("aria-live", "polite");
  top.appendChild(st);
  const links = el("span", "cem-links");
  const total = ce.data ? ce.data.total : 0;
  if (total && !(cem.all && !cem.except.size)) {
    const all = el("button", "link-btn", t("cem.all", { n: total }));
    all.type = "button";
    all.disabled = cem.busy;
    all.addEventListener("click", () => { cemSelectAll(); cemPaint(); });
    links.appendChild(all);
  }
  if (n) {
    const none = el("button", "link-btn", t("cem.clear"));
    none.type = "button";
    none.disabled = cem.busy;
    none.addEventListener("click", () => { cemReset(); cemPaint(); });
    links.appendChild(none);
  }
  top.appendChild(links);
  box.appendChild(top);
  if (cem.all && n) box.appendChild(el("p", "hint cem-allnote", t("cem.allNote", { n })));
  if (!n) return;
  const acts = el("div", "cem-acts");
  CEM_ACTS.forEach(s => {
    const b = el("button", "btn" + (s === "fixed" ? " primary" : ""), t("cem.act." + s));
    b.type = "button";
    b.disabled = cem.busy;
    b.addEventListener("click", () => cemAct(s));
    acts.appendChild(b);
  });
  box.appendChild(acts);
}
// Met à jour la barre et les lignes affichées, sans refaire l'écran (le focus et la position restent).
function cemPaint() {
  if (currentScreen !== "adminerr") return;
  const box = $("#cemBar");
  if (box) cemFill(box);
  document.querySelectorAll("#screen-adminerr .cem-item[data-fp]").forEach(w => {
    const on = cemHas(w.getAttribute("data-fp"));
    w.classList.toggle("on", on);
    const cb = w.querySelector("input[type=checkbox]");
    if (cb) cb.checked = on;
  });
}

// Action de masse : bilan du serveur, une confirmation, puis le changement.
async function cemAct(st) {
  if (cem.busy || !cemCount()) return;
  const args = cemArgs(st);
  cem.busy = true; cemPaint();
  let pre;
  try { pre = await aqRpc("admin_errors_set_state_bulk", Object.assign({}, args, { p_dry: true })); }
  catch (e) { cem.busy = false; cemPaint(); toast(cemErrText(e)); return; }
  cem.busy = false; cemPaint();
  const n = num(Number(pre && pre.changed), 0), same = num(Number(pre && pre.same), 0);
  const body = el("div", "cem-confirm");
  if (!n) {
    body.appendChild(el("p", null, t("cem.nothing", { n: same, s: ceState(st).toLowerCase() })));
    openModal(t("cem.title"), body, [{ label: t("close") }]);
    return;
  }
  body.appendChild(el("p", "cem-will", t("cem.will." + st, { n })));
  if (same) body.appendChild(el("p", "hint", t("cem.same", { n: same, s: ceState(st).toLowerCase() })));
  if (st === "fixed") body.appendChild(el("p", "hint", t("cem.fixedNote", { v: APP_VERSION })));
  openModal(t("cem.title"), body, [
    { label: t("cancel") },
    { label: t("cem.act." + st), kind: "primary", perm: "errors.act", onClick: () => { cemRun(st, args); } }
  ]);
}
async function cemRun(st, args) {
  if (cem.busy) return;
  cem.busy = true; cemPaint();
  try {
    const r = await aqRpc("admin_errors_set_state_bulk", Object.assign({}, args, { p_dry: false }));
    toast(t("cem.done." + st, { n: num(Number(r && r.changed), 0) }));
    cemReset();
  } catch (e) { toast(cemErrText(e)); }
  cem.busy = false;
  ceLoad();
}
