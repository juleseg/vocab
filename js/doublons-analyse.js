"use strict";

// === ANALYSE DES FAUX DOUBLONS : PERTINENCE EN POURCENTAGE (ÉTAPE 66) ===
// Onglet « Faux doublons » de Administration → Dictionnaire (js/screens/admin-doublons.js), cas ouverts seulement.
// Chaque cas montre un POURCENTAGE de pertinence de fusion, sa couleur (100 % vert, 70 à 99 % orange, moins rouge), une
// raison courte et son origine :
//   - Appli : calculé par le serveur (dict_conflict_score, claude/supabase-etape66.sql). 100 % SEULEMENT si aucune valeur
//     n'est écrasée (même mot, langues différentes ou cases vides) ; deux valeurs différentes dans la même langue = jamais
//     100 % (estimation de 1 à 95 %) ;
//   - Claude : avis rangé par la file d'attente (demande « dict_dupes », admin_dict_conflict_claude_ask : 50 cas douteux au
//     plus, sans donnée personnelle) ; montré pour un cas à moins de 100 % (l'appli reste la référence des cas sûrs).
//     L'avis de Claude n'est JAMAIS appliqué seul.
// Tri et filtre par % (pages de 20 cas : admin_dict_conflict_scores puis admin_dict_conflict_rows), « Tout sélectionner à
// partir de X % » (100 par défaut), « Sélectionner toutes les cartes qui ajoutent une langue » (100 % et au moins une langue
// ajoutée), puis UNE confirmation avec bilan et fusion cas par cas (admin_dict_conflict_merge, annulable par l'historique de
// chaque sens). Fusion de masse notée au journal (admin_dict, action mass_merge) sous le nom de la personne.
// Cases : sélectionner / fusionner = dict.conflict ; demander l'analyse = dict.claude.
const dpa = { scores: null, byId: new Map(), sort: "def", min: 0, from: 100, sel: new Set(), missing: false };

// % retenu et son origine.
function dpaFinal(s) {
  const app = s.app || {};
  if (Number(app.pct) === 100) return { pct: 100, src: "app" };
  if (s.ai && s.ai.pct != null) return { pct: Number(s.ai.pct), src: "claude" };
  return { pct: app.pct == null ? null : Number(app.pct), src: "app" };
}
function dpaColor(p) { return p >= 100 ? "g" : p >= 70 ? "o" : "r"; }
function dpaLangs(list) { return arr(list).map(adcLangName).join(", "); }
// Raison courte calculée par l'appli.
function dpaReason(app) {
  const a = app || {}, parts = [];
  if (arr(a.diff).length) parts.push(t("dpa.r.diff", { langs: dpaLangs(a.diff) }));
  if (arr(a.part).length) parts.push(t("dpa.r.part", { langs: dpaLangs(a.part) }));
  if (arr(a.pos).length) parts.push(t("dpa.r.pos", { langs: dpaLangs(a.pos) }));
  if (arr(a.ex).length) parts.push(t("dpa.r.ex", { langs: dpaLangs(a.ex) }));
  if (arr(a.adds).length) parts.push(t("dpa.r.adds", { langs: dpaLangs(a.adds) }));
  if (!parts.length) parts.push(t("dpa.r.same"));
  return parts.join(" · ");
}

// Pertinence de tous les cas ouverts (après la liste habituelle, qui remet les cas à jour). Script 66 absent : rien.
async function dpaLoadScores() {
  try {
    const r = arr(await aqRpc("admin_dict_conflict_scores", { p_lang: adc.lang || null }));
    r.forEach(s => { s.f = dpaFinal(s); });
    dpa.scores = r; dpa.byId = new Map(r.map(s => [s.id, s])); dpa.missing = false;
    [...dpa.sel].forEach(id => { if (!dpa.byId.has(id)) dpa.sel.delete(id); });   // cas tranchés entre-temps
  } catch (e) { dpa.scores = null; dpa.byId = new Map(); dpa.missing = alIsMissing(e); }
}
function dpaActive() { return adc.status === "open" && !!dpa.scores && (dpa.sort !== "def" || dpa.min > 0); }
function dpaOrdered() {
  const l = arr(dpa.scores).filter(s => s.f.pct != null && s.f.pct >= dpa.min);
  if (dpa.sort === "desc") l.sort((a, b) => b.f.pct - a.f.pct || String(b.updated_at).localeCompare(String(a.updated_at)));
  else if (dpa.sort === "asc") l.sort((a, b) => a.f.pct - b.f.pct || String(b.updated_at).localeCompare(String(a.updated_at)));
  return l;
}
// Appelée par adcLoad (cas ouverts) : charge les % et, si un tri ou un filtre est choisi, remplace la page affichée.
async function dpaAfterLoad() {
  await dpaLoadScores();
  if (!dpaActive()) return;
  const l = dpaOrdered();
  const ids = l.slice(adc.page * ADC_PAGE, (adc.page + 1) * ADC_PAGE).map(s => s.id);
  try {
    const r = ids.length ? await aqRpc("admin_dict_conflict_rows", { p_ids: ids }) : { rows: [] };
    adc.data = { total: l.length, rows: arr(r && r.rows) };
  } catch (e) { /* page habituelle gardée */ }
}

// --- Outils au-dessus de la liste (cas ouverts) ---
function dpaTools(root) {
  if (adc.status !== "open" || dpa.missing || !dpa.scores) return;
  const c = el("div", "card dpa-tools");
  c.appendChild(el("h3", "aq-h", t("dpa.title")));
  c.appendChild(el("p", "hint", t("dpa.help")));
  const row = el("div", "dpa-row");
  const sort = el("select", "input");
  [["def", "dpa.sort.def"], ["desc", "dpa.sort.desc"], ["asc", "dpa.sort.asc"]].forEach(([v, k]) => { const o = el("option", null, t(k)); o.value = v; sort.appendChild(o); });
  sort.value = dpa.sort;
  sort.addEventListener("change", () => { dpa.sort = sort.value; adc.page = 0; adcLoad(); });
  const min = el("input", "input dpa-n"); min.type = "number"; min.min = "0"; min.max = "100"; min.step = "5"; min.inputMode = "numeric";
  min.value = String(dpa.min);
  min.addEventListener("change", () => { const v = Math.max(0, Math.min(100, Math.round(Number(min.value) || 0))); dpa.min = v; adc.page = 0; adcLoad(); });
  row.append(formField(t("dpa.sort"), sort), formField(t("dpa.min"), min));
  c.appendChild(row);
  if (dpa.min > 0) c.appendChild(el("p", "muted", t("dpa.filtered", { n: dpaOrdered().length, min: dpa.min })));
  // Sélection et fusion de masse (dict.conflict)
  const sel = modGate(el("div", "dpa-sel"), "dict.conflict");
  const r1 = el("div", "dpa-row");
  const from = el("input", "input dpa-n"); from.type = "number"; from.min = "0"; from.max = "100"; from.step = "5"; from.inputMode = "numeric";
  from.value = String(dpa.from);
  from.addEventListener("change", () => { dpa.from = Math.max(0, Math.min(100, Math.round(Number(from.value) || 0))); from.value = String(dpa.from); });
  const bFrom = el("button", "btn", t("dpa.selFromBtn")); bFrom.type = "button";
  bFrom.addEventListener("click", () => {
    dpa.from = Math.max(0, Math.min(100, Math.round(Number(from.value) || 0)));
    arr(dpa.scores).forEach(s => { if (s.f.pct != null && s.f.pct >= dpa.from) dpa.sel.add(s.id); });
    adRerender();
  });
  const lab = el("label", "dpa-from");
  lab.append(el("span", null, t("dpa.selFrom")), from, el("span", null, "%"));
  r1.append(lab, bFrom);
  sel.appendChild(r1);
  const bLang = el("button", "btn", t("dpa.selLang")); bLang.type = "button";
  bLang.addEventListener("click", () => {
    arr(dpa.scores).forEach(s => { if (Number(s.app && s.app.pct) === 100 && arr(s.app.adds).length) dpa.sel.add(s.id); });
    adRerender();
  });
  sel.appendChild(bLang);
  const r2 = el("div", "dpa-row dpa-selbar");
  r2.appendChild(el("span", "muted", t("dpa.selN", { n: dpa.sel.size })));
  const bClear = el("button", "link-btn", t("dpa.clear")); bClear.type = "button"; bClear.disabled = !dpa.sel.size;
  bClear.addEventListener("click", () => { dpa.sel.clear(); adRerender(); });
  const bGo = el("button", "btn primary", t("dpa.mergeSel")); bGo.type = "button"; bGo.disabled = !dpa.sel.size;
  bGo.addEventListener("click", dpaMergeAsk);
  r2.append(bClear, bGo);
  sel.appendChild(r2);
  c.appendChild(sel);
  // Analyse par Claude (dict.claude) : cas douteux sans avis (les sélectionnés d'abord), 50 au plus.
  const ask = modGate(el("div", "dpa-ask"), "dict.claude");
  const doubt = dpaDoubtful();
  const bAsk = el("button", "btn", t("dpa.ask", { n: Math.min(50, doubt.length) })); bAsk.type = "button";
  bAsk.disabled = !doubt.length;
  bAsk.addEventListener("click", () => dpaAsk(bAsk));
  ask.append(bAsk, el("p", "hint", t("dpa.askHelp")));
  if (typeof queueCadenceNote === "function") ask.appendChild(queueCadenceNote());
  c.appendChild(ask);
  root.appendChild(c);
}
function dpaDoubtful() {
  const l = arr(dpa.scores).filter(s => Number(s.app && s.app.pct) < 100 && !s.ai);
  l.sort((a, b) => (dpa.sel.has(b.id) ? 1 : 0) - (dpa.sel.has(a.id) ? 1 : 0));
  return l;
}

// --- Pourcentage d'un cas (en tête de la carte) ---
function dpaBadge(r) {
  if (r.status !== "open") return null;
  const s = dpa.byId.get(r.id);
  if (!s || s.f.pct == null) return null;
  const b = el("div", "dpa-badge");
  const top = el("div", "dpa-top");
  top.appendChild(el("span", "dpa-pct " + dpaColor(s.f.pct), s.f.pct + " %"));
  top.appendChild(el("span", "tag dpa-src", t(s.f.src === "claude" ? "dpa.src.claude" : "dpa.src.app")));
  if (Mod.can("dict.conflict")) {
    const lab = el("label", "dpa-pick");
    const cb = el("input"); cb.type = "checkbox"; cb.checked = dpa.sel.has(r.id);
    cb.addEventListener("change", () => { if (cb.checked) dpa.sel.add(r.id); else dpa.sel.delete(r.id); adRerender(); });
    lab.append(cb, el("span", null, t("dpa.pick")));
    top.appendChild(lab);
  }
  b.appendChild(top);
  if (s.f.src === "claude") {
    const why = [String(s.ai.reason || "").trim(), s.ai.action ? t("dpa.act." + s.ai.action) : ""].filter(Boolean).join(" · ");
    if (why) b.appendChild(el("div", "dpa-why", why));
    b.appendChild(el("div", "muted dpa-app", t("dpa.src.app") + " : " + s.app.pct + " % — " + dpaReason(s.app)));
  } else b.appendChild(el("div", "dpa-why", dpaReason(s.app)));
  return b;
}

// --- Demander l'analyse à Claude ---
async function dpaAsk(btn) {
  const ids = dpaDoubtful().slice(0, 50).map(s => s.id);
  if (!ids.length) { toast(t("dpa.askNone")); return; }
  btn.disabled = true;
  try {
    const r = await aqRpc("admin_dict_conflict_claude_ask", { p_ids: ids, p_lang: state.settings.uiLang });
    toast(t("dpa.asked", { n: num(Number(r && r.n), ids.length) }));
    try { Queue.sync(); } catch (e) {}
  } catch (e) {
    const h = String((e && e.hint) || "");
    toast(h === "dup_big" || h === "dup_none" ? t("dpa.err." + h) : modErrText(e));
  }
  btn.disabled = false;
}

// --- Fusion de la sélection : bilan, UNE confirmation, puis cas par cas ---
async function dpaMergeAsk() {
  const ids = [...dpa.sel].filter(id => dpa.byId.has(id));
  if (!ids.length) return;
  const rows = [];
  try {
    for (let i = 0; i < ids.length; i += 100) {
      const r = await aqRpc("admin_dict_conflict_rows", { p_ids: ids.slice(i, i + 100) });
      arr(r && r.rows).forEach(x => { if (x.status === "open" && arr(x.senses).length >= 2) rows.push(x); });
    }
  } catch (e) { toast(adErr(e)); return; }
  if (!rows.length) { toast(t("dpa.err.dup_none")); return; }
  const langs = new Set();
  let senses = 0, doubt = 0;
  rows.forEach(r => {
    const s = dpa.byId.get(r.id);
    senses += arr(r.senses).length;
    arr(s && s.app && s.app.adds).forEach(L => langs.add(L));
    if (!s || Number(s.app && s.app.pct) !== 100) doubt++;
  });
  const body = el("div", "dpa-bilan");
  body.appendChild(el("p", null, t("dpa.b.cases", { n: rows.length, s: senses })));
  if (langs.size) body.appendChild(el("p", null, t("dpa.b.langs", { langs: dpaLangs([...langs]) })));
  if (doubt) body.appendChild(el("p", "q-err", t("dpa.b.doubt", { k: doubt })));
  body.appendChild(el("p", "muted", t("dpa.b.undo")));
  openModal(t("dpa.confirmTitle", { n: rows.length }), body, [
    { label: t("cancel") },
    { label: t("dpa.go", { n: rows.length }), kind: "primary", perm: "dict.conflict", onClick: () => { setTimeout(() => dpaMergeRun(rows), 0); } }
  ]);
}
async function dpaMergeRun(rows) {
  const info = el("p", "dpa-prog", t("dpa.progress", { i: 0, n: rows.length }));
  const close = openModal(t("dpa.mergeSel"), info, [], { locked: true });
  let ok = 0, fail = 0;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i], senses = arr(r.senses), s = dpa.byId.get(r.id);
    info.textContent = t("dpa.progress", { i: i + 1, n: rows.length });
    // sens gardé : le plus de cartes reliées (liste triée par le serveur) ; 100 % : cases vides remplies, rien d'autre
    const keep = senses[0].id;
    let words = null;
    if (!s || Number(s.app && s.app.pct) !== 100) {
      const comb = dcfCombine(senses, {});
      words = {};
      Object.keys(comb).forEach(L => { const v = dictClean(comb[L]); if (v && v.length <= 120) words[L] = v; });
    }
    try {
      await aqRpc("admin_dict_conflict_merge", { p_id: r.id, p_keep: keep, p_senses: null, p_words: words });
      ok++; dpa.sel.delete(r.id);
    } catch (e) { fail++; }
  }
  close();
  Activity.log("admin_dict", { action: "mass_merge", n: rows.length, ok, fail, from: dpa.from });
  toast(t("dpa.done", { ok }) + (fail ? t("dpa.fail", { n: fail }) : ""));
  adcLoad();
}
