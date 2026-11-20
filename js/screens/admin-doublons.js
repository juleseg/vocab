"use strict";

// === ADMINISTRATION : FAUX DOUBLONS DU DICTIONNAIRE (ÉTAPE 63) ===
// Onglet « Faux doublons (N) » de l'écran Administration → Dictionnaire (js/screens/admin-dictionnaire.js : ad.tab = "conf").
// Un cas = un mot d'une langue qui tombe sur au moins 2 sens non fusionnés, pas marqués « distincts » (ex. 청소하다 →
// « nettoyer » et « faire le ménage »). Fonctions SQL (claude/supabase-etape63.sql, security definer, contrôle is_admin()) :
//   admin_dict_conflict_count (compteur : onglet et alerte du tableau de bord), admin_dict_conflicts (liste : ouverts /
//   fusionnés / séparés, filtre de langue, 20 par page), admin_dict_conflict_scan (« Relancer l'analyse »),
//   admin_dict_conflict_merge (réutilise admin_dict_merge), admin_dict_conflict_distinct, admin_dict_conflict_link.
// Chaque cas : le mot, ses sens (valeurs par langue, cartes reliées, langues étudiées ; toucher = détail du sens), les cartes
// des comptes tombées dessus à l'ajout, les propositions des comptes (choix + commentaire, texte seul). Actions :
//   « Fusionner » (un seul sens, mots combinés avec « / » modifiables avant de confirmer ; les cartes reliées suivent),
//   « Garder séparés » (paires marquées distinctes, plus jamais signalées), « Relier la carte » (une carte rejoint un sens).
// Pas de notification : compteur ici et alerte au tableau de bord seulement. Chaque action est notée au journal (admin_dict).
// Script absent : « Lancez le script SQL de l'étape 63 ». Textes : clés adc.* (js/i18n/doublons-*.js).
const ADC_PAGE = 20;
const adc = { status: "open", lang: "", page: 0, data: null, count: null, props: 0, loading: false, err: "", missing: false };

async function adcLoad() {
  adc.loading = true; adc.err = "";
  adRerender();
  try {
    const r = await aqRpc("admin_dict_conflicts", { p_status: adc.status, p_lang: adc.lang || null, p_limit: ADC_PAGE, p_offset: adc.page * ADC_PAGE });
    adc.data = { total: num(Number(r && r.total), 0), rows: arr(r && r.rows) };
    adc.count = num(Number(r && r.open), 0);
    adc.missing = false;
    if (adc.status === "open" && typeof dpaAfterLoad === "function") await dpaAfterLoad();   // étape 66 : % de pertinence, tri, filtre
  } catch (e) {
    adc.missing = alIsMissing(e);
    adc.err = adc.missing ? t("adc.missing") : adErr(e);
  }
  adc.loading = false;
  adRerender();
}
// Compteur seul (onglet, tableau de bord). Jamais bloquant : script absent = pas de compteur.
async function adcLoadCount() {
  try {
    const r = await aqRpc("admin_dict_conflict_count");
    adc.count = num(Number(r && r.open), 0); adc.props = num(Number(r && r.proposals), 0); adc.missing = false;
  } catch (e) { adc.count = null; if (alIsMissing(e)) adc.missing = true; }
  return adc.count;
}
function adcTabLabel() { return adc.count ? t("adc.tabN", { n: adc.count }) : t("adc.tab"); }
// Ouvre l'onglet depuis le tableau de bord.
function adcOpen() {
  ad.tab = "conf"; adc.status = "open"; adc.page = 0; ad.started = false;
  location.hash = "#" + HASH_OF.admindict;
}
function adcLangName(L) { return isLang(L) ? langName(L) : String(L || "").toUpperCase(); }
// « KO 청소하다 · FR nettoyer » (mots d'une carte ou d'une proposition { langue: mot })
function adcWordsLine(vals, first) {
  const v = vals || {};
  const keys = Object.keys(v).filter(L => v[L]);
  keys.sort((a, b) => (a === first ? -1 : b === first ? 1 : a.localeCompare(b)));
  return keys.map(L => L.toUpperCase() + " " + v[L]).join(" · ") || "—";
}

function adcSection(root) {
  if (adc.missing) { root.appendChild(el("div", "card q-err", t("adc.missing"))); return; }
  root.appendChild(el("p", "muted adc-help", t("adc.help")));
  const st = el("div", "seg ad-tabs");
  ["open", "merged", "distinct"].forEach(k => {
    const b = el("button", null, t("adc.st." + k)); b.type = "button"; b.setAttribute("aria-pressed", String(adc.status === k));
    b.addEventListener("click", () => { if (adc.status === k) return; adc.status = k; adc.page = 0; adcLoad(); });
    st.appendChild(b);
  });
  root.appendChild(st);
  const f = el("div", "ad-search adc-tools");
  f.appendChild(langSelect(adc.lang, t("dict.allLangs"), v => { adc.lang = v; adc.page = 0; adcLoad(); }));
  const scan = modGate(el("button", "btn", t("adc.scan")), "dict.conflict"); scan.type = "button";   // étape 66 : case du modo
  scan.addEventListener("click", async () => {
    scan.disabled = true;
    try {
      const r = await aqRpc("admin_dict_conflict_scan");
      Activity.log("admin_dict", { action: "conflict_scan", n: num(Number(r && r.found), 0) });
      toast(t("adc.scanned", { n: num(Number(r && r.open), 0) }));
    } catch (e) { toast(adErr(e)); }
    adcLoad();
  });
  f.appendChild(scan);
  root.appendChild(f);
  if (typeof dpaTools === "function") dpaTools(root);   // étape 66 : pertinence en %, sélection, fusion de masse, analyse Claude
  if (adc.loading && !adc.data) { root.appendChild(el("p", "muted", t("queue.loading"))); return; }
  const data = adc.data || { total: 0, rows: [] };
  if (!data.rows.length) { root.appendChild(el("p", "muted", t(adc.status === "open" ? "adc.none" : "dict.none"))); return; }
  root.appendChild(el("p", "muted", t("adc.results", { n: dashFmt(data.total) })));
  const list = el("div", "adc-list");
  data.rows.forEach(r => list.appendChild(adcCase(r)));
  root.appendChild(list);
  const pages = Math.max(1, Math.ceil(data.total / ADC_PAGE));
  if (pages > 1) {
    const p = el("div", "ad-pager");
    const prev = el("button", "btn", "‹"), next = el("button", "btn", "›");
    prev.type = next.type = "button";
    prev.disabled = adc.page <= 0; next.disabled = adc.page >= pages - 1;
    prev.addEventListener("click", () => { adc.page--; adcLoad(); });
    next.addEventListener("click", () => { adc.page++; adcLoad(); });
    p.append(prev, el("span", "muted", t("dict.page", { p: adc.page + 1, n: pages })), next);
    root.appendChild(p);
  }
}

// --- Un cas ---
function adcCase(r) {
  const box = el("div", "card adc-case");
  const senses = arr(r.senses), cards = arr(r.cards), props = arr(r.proposals);
  const num1 = new Map(senses.map((s, i) => [s.id, i + 1]));
  const senseName = id => num1.has(id) ? t("adc.senseN", { n: num1.get(id) }) : t("adc.senseOther");
  // En-tête : le mot, la langue, les chiffres
  const h = el("div", "adc-h");
  const w = el("span", "adc-word", r.word || "—"); w.lang = r.lang;
  h.append(w, el("span", "tag", adcLangName(r.lang)));
  if (r.status !== "open") h.appendChild(el("span", "tag", t("adc.st." + r.status)));
  box.appendChild(h);
  if (typeof dpaBadge === "function") { const bd = dpaBadge(r); if (bd) box.appendChild(bd); }   // étape 66 : % de pertinence
  const pend = props.filter(p => p.status === "pending").length;
  box.appendChild(el("div", "muted adc-meta", t("adc.meta", { s: senses.length, c: cards.length, p: pend }) + " · " +
    t(r.source === "add" ? "adc.src.add" : "adc.src.scan") + " · " + adDate(r.decided_at || r.updated_at)));
  // Sens du groupe
  const sl = el("div", "adc-senses");
  senses.forEach((s, i) => {
    const b = el("button", "item adc-sense"); b.type = "button";
    const m = el("div", "main");
    m.appendChild(el("div", "t1", t("adc.senseN", { n: i + 1 }) + " — " + adWords(s.vals)));
    const ex = Object.keys(s.vals || {}).map(L => s.vals[L].e).find(Boolean);
    if (ex) m.appendChild(el("div", "t2", ex));
    const extra = el("div");
    extra.appendChild(el("span", "tag", t("adc.cards", { n: num(Number(s.cards), 0) })));
    const learn = arr(s.learn).filter(isLang);
    if (learn.length) extra.appendChild(el("span", "tag", t("adc.learn", { langs: learn.map(L => L.toUpperCase()).join(", ") })));
    m.appendChild(extra);
    b.append(m, el("span", "chev", "›"));
    b.addEventListener("click", () => adOpenSense(s.id));
    sl.appendChild(b);
  });
  box.appendChild(sl);
  // Cartes des comptes tombées sur ce cas
  if (cards.length) {
    box.appendChild(el("h4", "adc-sub", t("adc.cardsTitle", { n: cards.length })));
    cards.forEach(x => {
      const row = el("div", "adc-row");
      const txt = el("div", "adc-row-t");
      txt.append(el("b", null, x.by || "?"), document.createTextNode(" — " + adcWordsLine(x.vals && Object.keys(x.vals).length ? x.vals : { [r.lang]: x.w }, r.lang)));
      row.appendChild(txt);
      const stt = x.to ? (x.applied ? t("adc.card.applied", { s: senseName(x.to) }) : t("adc.card.to", { s: senseName(x.to) }))
                       : x.linked ? t("adc.card.linked", { s: senseName(x.linked) }) : t("adc.card.free");
      row.appendChild(el("div", "muted adc-row-s", stt));
      if (r.status !== "merged" && senses.length) {
        const b = modGate(el("button", "link-btn", t("adc.link")), "dict.conflict"); b.type = "button";
        b.addEventListener("click", () => adcLinkCard(r, x, senses));
        row.appendChild(b);
      }
      box.appendChild(row);
    });
  }
  // Propositions des comptes (commentaire : texte seul)
  if (props.length) {
    box.appendChild(el("h4", "adc-sub", t("adc.propsTitle", { n: props.length })));
    props.forEach(p => {
      const row = el("div", "adc-row adc-prop" + (p.status === "pending" ? "" : " done"));
      const what = p.choice === "existing" ? t("adc.ch.existing", { s: senseName(p.sense) })
        : t(p.choice === "both" ? "adc.ch.both" : "adc.ch.mine") + " : " + adcWordsLine(p.vals, r.lang);
      const txt = el("div", "adc-row-t");
      txt.append(el("b", null, p.by || "?"), document.createTextNode(" — " + what));
      row.appendChild(txt);
      if (p.comment) row.appendChild(el("div", "adc-comment", "« " + p.comment + " »"));
      row.appendChild(el("div", "muted adc-row-s", adDate(p.at) + (p.status === "pending" ? "" : " · " + t("adc.propDone"))));
      box.appendChild(row);
    });
  }
  // Actions
  if (r.status === "open" && senses.length >= 2) {
    const btns = modGate(el("div", "btns two adc-acts"), "dict.conflict");   // étape 66 : case du modo
    const bS = el("button", "btn", t("adc.distinct")), bM = el("button", "btn primary", t("adc.merge"));
    bS.type = bM.type = "button";
    bS.addEventListener("click", () => adcDistinct(r));
    bM.addEventListener("click", () => adcMerge(r));
    btns.append(bS, bM);
    box.appendChild(btns);
  }
  return box;
}

// --- Garder séparés ---
function adcDistinct(r) {
  openModal(t("adc.distinct"), el("p", null, t("adc.distinctAsk", { w: r.word, n: arr(r.senses).length })), [
    { label: t("cancel") },
    { label: t("adc.distinct"), kind: "primary", onClick: () => {
      aqRpc("admin_dict_conflict_distinct", { p_id: r.id })
        .then(() => { Activity.log("admin_dict", { action: "conflict_distinct" }); toast(t("adc.distinctDone")); adcLoad(); })
        .catch(e => toast(adErr(e)));
    } }
  ]);
}

// --- Relier la carte ---
function adcLinkCard(r, x, senses) {
  const wrap = el("div");
  wrap.appendChild(el("p", "muted", t("adc.linkHelp", { by: x.by || "?" })));
  wrap.appendChild(el("div", "t1 adc-row-t", adcWordsLine(x.vals && Object.keys(x.vals).length ? x.vals : { [r.lang]: x.w }, r.lang)));
  const list = el("div", "list");
  let close = null;
  senses.forEach((s, i) => {
    const b = el("button", "item"); b.type = "button";
    const m = el("div", "main");
    m.appendChild(el("div", "t1", t("adc.senseN", { n: i + 1 }) + " — " + adWords(s.vals)));
    b.append(m, el("span", "chev", "›"));
    b.addEventListener("click", () => {
      aqRpc("admin_dict_conflict_link", { p_id: r.id, p_user: x.user_id, p_card: x.card, p_sense: s.id })
        .then(() => { Activity.log("admin_dict", { action: "conflict_link" }); toast(t("adc.linked", { by: x.by || "?" })); if (close) close(); adcLoad(); })
        .catch(e => toast(adErr(e)));
    });
    list.appendChild(b);
  });
  wrap.appendChild(list);
  close = openModal(t("adc.link"), wrap, [{ label: t("cancel") }]);
}

// --- Fusionner : sens choisis (tous par défaut), sens gardé, mots combinés avec « / » modifiables ---
function adcMerge(r) {
  const senses = arr(r.senses);
  const sel = new Set(senses.map(s => s.id));
  let keep = senses[0].id;                         // le plus de cartes reliées (liste triée par le serveur)
  const langs = [];
  senses.forEach(s => Object.keys(s.vals || {}).forEach(L => { if (s.vals[L] && s.vals[L].w && !langs.includes(L)) langs.push(L); }));
  langs.sort((a, b) => (a === r.lang ? -1 : b === r.lang ? 1 : a.localeCompare(b)));
  const wrap = el("div", "adc-merge");
  wrap.appendChild(el("p", "muted", t("adc.mergeHelp")));
  const sl = el("div", "adc-msenses");
  const keepName = "adck" + uid();
  senses.forEach((s, i) => {
    const row = el("div", "adc-mrow");
    const cbl = el("label", "adc-mcb");
    const cb = el("input"); cb.type = "checkbox"; cb.checked = true;
    cb.addEventListener("change", () => { if (cb.checked) sel.add(s.id); else sel.delete(s.id); recompute(); });
    cbl.append(cb, el("span", null, t("adc.senseN", { n: i + 1 }) + " — " + adWords(s.vals) + " · " + t("adc.cards", { n: num(Number(s.cards), 0) })));
    const kl = el("label", "adc-keep");
    const rb = el("input"); rb.type = "radio"; rb.name = keepName; rb.checked = s.id === keep;
    rb.addEventListener("change", () => { if (rb.checked) { keep = s.id; recompute(); } });
    kl.append(rb, el("span", "muted", t("adc.keep")));
    row.append(cbl, kl);
    sl.appendChild(row);
  });
  wrap.appendChild(sl);
  wrap.appendChild(el("h4", "adc-sub", t("adc.result")));
  const inputs = {}, edited = {};
  langs.forEach(L => {
    const inp = textInput("", "", L);
    inp.maxLength = 200;
    inp.addEventListener("input", () => { edited[L] = true; });
    inputs[L] = inp;
    wrap.appendChild(formField(adcLangName(L), inp));
  });
  const err = el("p", "q-err"); err.hidden = true;
  wrap.appendChild(err);
  // Valeurs combinées : formes du sens gardé d'abord, puis celles des autres sens choisis (sans doublon).
  const recompute = () => {
    const chosen = senses.filter(s => sel.has(s.id)).sort((a, b) => (a.id === keep ? -1 : b.id === keep ? 1 : 0));
    const comb = dcfCombine(chosen, {});
    langs.forEach(L => { if (!edited[L]) inputs[L].value = comb[L] || ""; });
  };
  recompute();
  let busy = false, close = null;
  const go = async () => {
    if (busy) return false;
    err.hidden = true;
    if (sel.size < 2 || !sel.has(keep)) { err.textContent = t("adc.err.two"); err.hidden = false; return false; }
    const words = {};
    for (const L of langs) {
      const v = dictClean(inputs[L].value);
      if (v.length > 120) { err.textContent = t("adc.err.long", { lang: adcLangName(L) }); err.hidden = false; return false; }
      if (v) words[L] = v;
    }
    busy = true;
    try {
      await aqRpc("admin_dict_conflict_merge", { p_id: r.id, p_keep: keep, p_senses: [...sel], p_words: words });
      Activity.log("admin_dict", { action: "conflict_merge", n: sel.size });
      toast(t("adc.merged"));
      if (close) close();
      adcLoad();
    } catch (e) { err.textContent = adErr(e); err.hidden = false; }
    busy = false;
    return false;
  };
  close = openModal(t("adc.mergeTitle", { w: r.word }), wrap, [
    { label: t("cancel") },
    { label: t("adc.merge"), kind: "primary", onClick: () => { go(); return false; } }
  ]);
}
