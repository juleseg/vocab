"use strict";

// === ADMINISTRATION : DICTIONNAIRE COMMUN (ÉTAPE 36) ===
// Écran #admin-dictionnaire (admin, mode Supabase). Fonctions SQL du script supabase-etape36.sql (security definer,
// contrôle is_admin()) : admin_dict_summary, admin_dict_proposals, admin_dict_decide, admin_dict_search,
// admin_dict_sense (détail, historique, propositions), admin_dict_revert, admin_dict_merge.
// Onglets : Propositions (en attente / validées / refusées, 50 par page, sélection, Valider / Refuser) et Recherche.
// Toucher un sens : détail (valeurs par langue, historique des versions, retour à une version, fusion d'un doublon).
// Script pas lancé : « Lancez le script SQL de l'étape 36 ». Chaque action est notée au journal (admin_dict).
// Étape 63 : onglet « Faux doublons (N) » (ad.tab = "conf", js/screens/admin-doublons.js) ; compteur relu à chaque chargement.
const AD_PAGE = 50;
const ad = {
  tab: "prop", status: "pending", page: 0, props: null, sum: null, sel: new Set(),
  q: "", lang: "", spage: 0, search: null, loading: false, err: "", missing: false, started: false
};
function adRerender() { if (currentScreen === "admindict") renderAdminDict(); }
function adErr(e) { return alIsMissing(e) ? t("dict.missing") : aqErrText(e); }
function adDate(s) { return s ? queueDate(s) : "—"; }
// Libellé d'une case : « Coréen — mot », « Coréen — traduction de l'exemple (français) »
function adFieldLabel(lang, field, tr) {
  const f = field === "tr" ? t("dict.f.tr", { lang: langName(tr) }) : t("dict.f." + field);
  return (isLang(lang) ? langName(lang) : lang) + " — " + f;
}
function adValText(field, lang, v) { return field === "pos" && v ? posLabel(v, lang) : (v || ""); }
// Mots d'un sens sur une ligne : « FR arbre · KO 나무 · EN tree »
function adWords(vals) {
  const v = vals || {};
  const order = [state.settings.uiLang].concat(Object.keys(v).sort()).filter((L, i, a) => a.indexOf(L) === i && v[L] && v[L].w);
  return order.map(L => L.toUpperCase() + " " + v[L].w).join(" · ") || "—";
}

async function adLoad() {
  if (ad.tab === "conf") { ad.started = true; ad.err = ""; return adcLoad(); }  // onglet Faux doublons (étape 63, js/screens/admin-doublons.js)
  adcLoadCount().then(() => adRerender());                                      // compteur de l'onglet (jamais bloquant)
  if (ad.tab === "img") { ad.started = true; ad.err = ""; return aimLoad(); }   // onglet Images (étape 49, js/screens/admin-images.js)
  ad.started = true; ad.loading = true; ad.err = "";
  adRerender();
  try {
    if (ad.tab === "prop") {
      const [sum, pr] = await Promise.all([aqRpc("admin_dict_summary"), aqRpc("admin_dict_proposals", { p_status: ad.status, p_limit: AD_PAGE, p_offset: ad.page * AD_PAGE })]);
      ad.sum = sum || {}; ad.props = { total: num(Number(pr && pr.total), 0), rows: arr(pr && pr.rows) };
    } else {
      const [sum, r] = await Promise.all([aqRpc("admin_dict_summary"), aqRpc("admin_dict_search", { p_query: ad.q, p_lang: ad.lang || null, p_limit: AD_PAGE, p_offset: ad.spage * AD_PAGE })]);
      ad.sum = sum || {}; ad.search = { total: num(Number(r && r.total), 0), rows: arr(r && r.rows) };
    }
    ad.missing = false;
  } catch (e) { ad.missing = alIsMissing(e); ad.err = adErr(e); }
  ad.loading = false;
  adRerender();
}

function renderAdminDict() {
  const root = $("#screen-admindict");
  if (!root) return;
  root.textContent = "";
  const back = el("button", "link-btn", t("aq.back"));
  back.addEventListener("click", () => { location.hash = "#" + HASH_OF.admin; });
  root.appendChild(back);
  const top = el("div", "adm-top");
  top.appendChild(el("h2", null, t("dict.title")));
  const ref = el("button", "link-btn", t("admin.refresh"));
  ref.addEventListener("click", adLoad);
  top.appendChild(ref);
  root.appendChild(top);
  if (!ad.started) { adLoad(); return; }
  if (ad.missing) { root.appendChild(el("div", "card q-err", t("dict.missing"))); return; }
  if (ad.sum) root.appendChild(el("p", "muted", t("dict.sum", { s: dashFmt(ad.sum.senses), v: dashFmt(ad.sum.values), p: dashFmt(ad.sum.pending) })));
  // Onglets
  const tabs = el("div", "seg ad-tabs ad-tabs4");   // 4 onglets sur 2 lignes (étape 63)
  [["prop", "dict.tab.prop"], ["search", "dict.tab.search"], ["img", "img.tab"], ["conf", ""]].forEach(([k, lab]) => {
    const b = el("button", k === "conf" && adc.count ? "adc-tabnew" : null, k === "conf" ? adcTabLabel() : t(lab));   // étape 63 : compteur
    b.type = "button"; b.setAttribute("aria-pressed", String(ad.tab === k));
    b.addEventListener("click", () => { if (ad.tab === k) return; ad.tab = k; ad.sel.clear(); adLoad(); });
    tabs.appendChild(b);
  });
  root.appendChild(tabs);
  if (ad.err) root.appendChild(el("p", "q-err", ad.err));
  if (ad.tab === "prop") adPropSection(root); else if (ad.tab === "img") aimSection(root); else if (ad.tab === "conf") adcSection(root); else adSearchSection(root);
}

// --- Propositions ---
function adPropSection(root) {
  const st = el("div", "seg ad-tabs");
  ["pending", "accepted", "rejected"].forEach(k => {
    const b = el("button", null, t("dict.st." + k)); b.type = "button"; b.setAttribute("aria-pressed", String(ad.status === k));
    b.addEventListener("click", () => { if (ad.status === k) return; ad.status = k; ad.page = 0; ad.sel.clear(); adLoad(); });
    st.appendChild(b);
  });
  root.appendChild(st);
  if (ad.loading && !ad.props) { root.appendChild(el("p", "muted", t("queue.loading"))); return; }
  const data = ad.props || { total: 0, rows: [] };
  if (!data.rows.length) { root.appendChild(el("p", "muted", t("dict.none"))); return; }
  const pending = ad.status === "pending";
  let bar = null;
  if (pending) {
    bar = el("div", "ad-bar");
    const info = el("span", "muted");
    const bAll = el("button", "link-btn", t("dict.selPage")); bAll.type = "button";
    const bOk = el("button", "btn primary", t("dict.accept")), bNo = el("button", "btn", t("dict.reject"));
    bOk.type = bNo.type = "button";
    const upd = () => { info.textContent = t("dict.selN", { n: ad.sel.size }); bOk.disabled = bNo.disabled = !ad.sel.size; };
    bAll.addEventListener("click", () => {
      const all = data.rows.every(r => ad.sel.has(r.id));
      data.rows.forEach(r => { if (all) ad.sel.delete(r.id); else ad.sel.add(r.id); });
      adRerender();
    });
    bOk.addEventListener("click", () => adDecide([...ad.sel], true));
    bNo.addEventListener("click", () => adDecide([...ad.sel], false));
    const btns = el("div", "btns two"); btns.append(bNo, bOk);
    bar.append(info, bAll, btns);
    upd();
    bar.upd = upd;
    root.appendChild(bar);
  }
  const list = el("div", "ad-list");
  data.rows.forEach(r => list.appendChild(adPropRow(r, pending, bar)));
  root.appendChild(list);
  root.appendChild(adPager(ad.page, data.total, p => { ad.page = p; ad.sel.clear(); adLoad(); }));
}
function adPropRow(r, pending, bar) {
  const row = el(pending ? "label" : "div", "pv-row ad-row" + (ad.sel.has(r.id) ? " sel" : ""));
  if (pending) {
    const cb = el("input", "pv-cb"); cb.type = "checkbox"; cb.checked = ad.sel.has(r.id);
    cb.addEventListener("change", () => { if (cb.checked) ad.sel.add(r.id); else ad.sel.delete(r.id); row.classList.toggle("sel", cb.checked); if (bar) bar.upd(); });
    row.appendChild(cb);
  }
  const m = el("div", "main");
  const w = el("button", "link-btn ad-words", adWords(r.vals)); w.type = "button";
  w.addEventListener("click", e => { e.preventDefault(); e.stopPropagation(); adOpenSense(r.sense_id); });
  m.appendChild(w);
  m.appendChild(el("div", "pv-field", adFieldLabel(r.lang, r.field, r.tr_lang)));
  const a = adValText(r.field, r.lang, r.old_value), b = adValText(r.field, r.lang, r.new_value);
  const lc = wrLcs(a, b);
  const d = el("div", "pv-diff");
  d.appendChild(a ? wrDiffNode(lc.A, lc.ma, "wr-bad") : el("div", "wr-diff muted", "—"));
  d.appendChild(el("span", "pv-arrow", "→"));
  d.appendChild(wrDiffNode(lc.B, lc.mb, "wr-miss"));
  d.lang = r.field === "tr" ? r.tr_lang : r.lang;
  m.appendChild(d);
  if (pending && r.current !== r.old_value) m.appendChild(el("div", "pv-reason", t("dict.current", { v: adValText(r.field, r.lang, r.current) || "—" })));
  m.appendChild(el("div", "muted ad-meta", t("dict.by", { id: r.by || "?", d: adDate(r.created_at) }) +
    (r.status !== "pending" ? " · " + t("dict.st." + r.status) + " " + adDate(r.decided_at) : "")));
  row.appendChild(m);
  return row;
}
async function adDecide(ids, accept) {
  if (!ids.length) return;
  let done = 0, skipped = 0;
  try {
    for (let i = 0; i < ids.length; i += 200) {
      const r = await aqRpc("admin_dict_decide", { p_ids: ids.slice(i, i + 200), p_accept: accept });
      done += num(Number(r && r.done), 0); skipped += num(Number(r && r.skipped), 0);
    }
    Activity.log("admin_dict", { action: accept ? "accept" : "reject", n: done });
    toast(t("dict.decided", { n: done }));
  } catch (e) { toast(adErr(e)); }
  ad.sel.clear();
  adLoad();
}
function adPager(page, total, go) {
  const pages = Math.max(1, Math.ceil(total / AD_PAGE));
  const p = el("div", "ad-pager");
  if (pages <= 1) return p;
  const prev = el("button", "btn", "‹"), next = el("button", "btn", "›");
  prev.type = next.type = "button";
  prev.disabled = page <= 0; next.disabled = page >= pages - 1;
  prev.addEventListener("click", () => go(page - 1));
  next.addEventListener("click", () => go(page + 1));
  p.append(prev, el("span", "muted", t("dict.page", { p: page + 1, n: pages })), next);
  return p;
}

// --- Recherche ---
function adSearchSection(root) {
  const f = el("div", "ad-search");
  const q = el("input", "input"); q.type = "search"; q.value = ad.q; q.placeholder = t("dict.searchPh");
  const ls = langSelect(ad.lang, t("dict.allLangs"), v => { ad.lang = v; });
  const go = el("button", "btn primary", t("dict.search")); go.type = "button";
  const run = () => { ad.q = q.value.trim(); ad.spage = 0; adLoad(); };
  go.addEventListener("click", run);
  q.addEventListener("keydown", e => { if (e.key === "Enter") run(); });
  f.append(q, ls, go);
  root.appendChild(f);
  if (ad.loading && !ad.search) { root.appendChild(el("p", "muted", t("queue.loading"))); return; }
  const data = ad.search || { total: 0, rows: [] };
  if (!data.rows.length) { root.appendChild(el("p", "muted", t("dict.noResult"))); return; }
  root.appendChild(el("p", "muted", t("dict.results", { n: dashFmt(data.total) })));
  const list = el("div", "list");
  data.rows.forEach(r => {
    const b = el("button", "item"); b.type = "button";
    const m = el("div", "main");
    m.appendChild(el("div", "t1", adWords(r.vals)));
    const ex = Object.keys(r.vals || {}).map(L => r.vals[L].e).find(Boolean);
    if (ex) m.appendChild(el("div", "t2", ex));
    const extra = el("div");
    extra.appendChild(el("span", "tag", "v" + r.v + " · " + adDate(r.updated_at)));
    if (Number(r.pending) > 0) extra.appendChild(el("span", "tag warn", t("dict.pendingN", { n: r.pending })));
    m.appendChild(extra);
    b.append(m, el("span", "chev", "›"));
    b.addEventListener("click", () => adOpenSense(r.id));
    list.appendChild(b);
  });
  root.appendChild(list);
  root.appendChild(adPager(ad.spage, data.total, p => { ad.spage = p; adLoad(); }));
}

// --- Détail d'un sens : valeurs, historique, retour à une version, fusion ---
function adValsTable(vals) {
  const v = vals || {};
  const tb = el("div", "ad-vals");
  Object.keys(v).sort().forEach(L => {
    const x = v[L] || {};
    const r = el("div", "ad-val");
    const h = el("div", "ad-val-h");
    h.appendChild(el("strong", null, isLang(L) ? langName(L) : L));
    const w = el("span", null, " " + (x.w || "—")); w.lang = L; h.appendChild(w);
    if (x.p) h.appendChild(el("span", "pos", posLabel(x.p, L)));
    r.appendChild(h);
    if (x.e) { const e = el("div", "ex-main", x.e); e.lang = L; r.appendChild(e); }
    if (x.t) Object.keys(x.t).forEach(C => { const e = el("div", "ex-tr", C.toUpperCase() + " " + x.t[C]); e.lang = C; r.appendChild(e); });
    tb.appendChild(r);
  });
  if (!tb.childNodes.length) tb.appendChild(el("p", "muted", "—"));
  return tb;
}
async function adOpenSense(id) {
  let d;
  try { d = await aqRpc("admin_dict_sense", { p_id: id }); } catch (e) { toast(adErr(e)); return; }
  if (!d) { toast(t("dict.noResult")); return; }
  const wrap = el("div", "ad-sense");
  if (d.merged_into) wrap.appendChild(el("p", "q-err", t("dict.mergedInto")));
  wrap.appendChild(el("p", "muted", t("dict.createdBy", { id: d.created_by || "?", d: adDate(d.created_at) }) + " · v" + d.v));
  wrap.appendChild(adValsTable(d.vals));
  let close = null;
  const reopen = () => { if (close) close(); adOpenSense(id); };
  // Fusion d'un doublon dans ce sens
  if (!d.merged_into) {
    const mb = el("button", "btn", t("dict.merge")); mb.type = "button";
    mb.addEventListener("click", () => { if (close) close(); adMergeInto(d); });
    wrap.appendChild(mb);
  }
  // Propositions de ce sens
  const props = arr(d.proposals).filter(p => p.status === "pending");
  if (props.length) {
    wrap.appendChild(el("h3", "np-h3", t("dict.tab.prop") + " (" + props.length + ")"));
    props.forEach(p => wrap.appendChild(el("div", "pv-field", adFieldLabel(p.lang, p.field, p.tr_lang) + " : " +
      (adValText(p.field, p.lang, p.old_value) || "—") + " → " + adValText(p.field, p.lang, p.new_value) + " (" + (p.by || "?") + ")")));
  }
  // Historique
  wrap.appendChild(el("h3", "np-h3", t("dict.history")));
  arr(d.versions).forEach((x, i) => {
    const r = el("div", "ad-ver");
    const h = el("div", "ad-ver-h");
    h.appendChild(el("strong", null, t("dict.version", { v: x.version })));
    h.appendChild(el("span", "muted", " " + adDate(x.created_at) + " · " + t("dict.act." + x.action) + (x.by ? " · " + x.by : "")));
    r.appendChild(h);
    const det = el("div", "ad-ver-d"); det.hidden = true;
    det.appendChild(adValsTable(x.data));
    const btns = el("div", "lv-links");
    const see = el("button", "link-btn", t("dict.see")); see.type = "button";
    see.addEventListener("click", () => { det.hidden = !det.hidden; });
    btns.appendChild(see);
    if (i > 0 && !d.merged_into) {
      const rv2 = el("button", "link-btn", t("dict.revert")); rv2.type = "button";
      rv2.addEventListener("click", () => {
        openModal(t("dict.revert"), el("p", null, t("dict.revertAsk", { v: x.version })), [
          { label: t("cancel") },
          { label: t("dict.revert"), kind: "primary", onClick: () => {
            aqRpc("admin_dict_revert", { p_id: id, p_version: x.version })
              .then(() => { Activity.log("admin_dict", { action: "revert", v: x.version }); toast(t("dict.reverted", { v: x.version })); reopen(); adLoad(); })
              .catch(e => toast(adErr(e)));
          } }
        ]);
      });
      btns.appendChild(rv2);
    }
    r.append(btns, det);
    wrap.appendChild(r);
  });
  close = openModal(t("dict.detail"), wrap, [{ label: t("close") }]);
}
// Fusion : chercher le doublon, puis confirmer. Le doublon est fusionné dans le sens ouvert (keep).
function adMergeInto(keep) {
  const wrap = el("div");
  wrap.appendChild(el("p", "muted", t("dict.mergeHelp")));
  wrap.appendChild(el("div", "t1", adWords(keep.vals)));
  const q = el("input", "input"); q.type = "search"; q.placeholder = t("dict.searchPh");
  const firstWord = Object.keys(keep.vals || {}).map(L => keep.vals[L].w).find(Boolean) || "";
  q.value = String(firstWord).split("/")[0].trim();
  const res = el("div", "list");
  const go = el("button", "btn", t("dict.search")); go.type = "button";
  let close = null;
  const run = async () => {
    res.textContent = "";
    let r;
    try { r = await aqRpc("admin_dict_search", { p_query: q.value.trim(), p_lang: null, p_limit: 30, p_offset: 0 }); }
    catch (e) { res.appendChild(el("p", "q-err", adErr(e))); return; }
    const rows = arr(r && r.rows).filter(x => x.id !== keep.id);
    if (!rows.length) { res.appendChild(el("p", "muted", t("dict.noResult"))); return; }
    rows.forEach(x => {
      const b = el("button", "item"); b.type = "button";
      const m = el("div", "main");
      m.appendChild(el("div", "t1", adWords(x.vals)));
      m.appendChild(el("div", "t2", t("dict.mergeThis")));
      b.append(m, el("span", "chev", "›"));
      b.addEventListener("click", () => {
        openModal(t("dict.merge"), el("p", null, t("dict.mergeAsk", { a: adWords(x.vals), b: adWords(keep.vals) })), [
          { label: t("cancel") },
          { label: t("dict.mergeThis"), kind: "danger", onClick: () => {
            aqRpc("admin_dict_merge", { p_keep: keep.id, p_drop: x.id })
              .then(() => { Activity.log("admin_dict", { action: "merge" }); toast(t("dict.merged")); if (close) close(); adLoad(); adOpenSense(keep.id); })
              .catch(e => toast(adErr(e)));
          } }
        ]);
      });
      res.appendChild(b);
    });
  };
  go.addEventListener("click", run);
  q.addEventListener("keydown", e => { if (e.key === "Enter") run(); });
  const f = el("div", "ad-search"); f.append(q, go);
  wrap.append(f, res);
  close = openModal(t("dict.merge"), wrap, [{ label: t("close") }]);
  run();
}
