"use strict";

// === ADMINISTRATION : SIGNALEMENTS DE CARTES (ÉTAPE 84) ===
// Écran « Signalements » (#admin-signalements, screen-adminsig ; mode Supabase ; admin et modérateurs avec la case
// « reports.see » ; « Traité » / « Ignorer » / « Rouvrir » : case « reports.act »). Liste des cartes du dictionnaire commun
// et des listes partagées signalées par les utilisateurs (js/signalements.js) : motif, carte, origine, langue, signaleur,
// nombre de signalements pour le même motif ; filtres motif / état / langue ; « Ouvrir la carte » ; compteur (bouton de
// l'accueil de l'Administration). Les cartes PERSONNELLES ne sont jamais renvoyées par le serveur (elles vont à Claude,
// étape 85) : l'admin voit seulement leur nombre en attente.
// Fonctions : admin_reports, admin_reports_count, admin_report_set (script claude/supabase-etape84.sql). Script absent :
// « Lancez le script SQL de l'étape 84 ». Textes : js/i18n/signal-<langue>.js (clés asg.*). Styles : css/app-9.css (.asg-*).
const ASG_PAGE = 50;
const asg = { started: false, loading: false, err: "", missing: false, data: null, page: 0, f: { status: "open", reason: "", lang: "" }, busy: false, count: null, countAt: 0 };

function asgRerender() { try { if (currentScreen === "adminsig") renderAdminReports(); } catch (e) {} }
function asgErrText(e) {
  const h = String((e && e.hint) || "");
  if (h === "rep_gone") return t("asg.err.gone");
  if (alIsMissing(e)) return t("asg.missing");
  return modErrText(e);
}
async function asgLoad() {
  asg.loading = true; asg.err = ""; asg.started = true;
  asgRerender();
  try {
    asg.data = await aqRpc("admin_reports", { p_status: asg.f.status || null, p_reason: asg.f.reason || null, p_lang: asg.f.lang || null, p_page: asg.page, p_size: ASG_PAGE });
    asg.missing = false;
    asg.count = num(Number(asg.data && asg.data.counts && asg.data.counts.open), 0); asg.countAt = Date.now();
  } catch (e) { asg.missing = alIsMissing(e); asg.err = asgErrText(e); }
  asg.loading = false;
  asgRerender();
}
// Compteur du bouton de l'accueil de l'Administration (au plus une lecture par minute ; jamais bloquant).
async function asgLoadCount() {
  if (!Mod.can("reports.see") || auth.mode !== "supabase" || Date.now() - asg.countAt < 60000) return;
  asg.countAt = Date.now();
  try { asg.count = num(Number(await aqRpc("admin_reports_count")), 0); } catch (e) { return; }
  if (currentScreen === "admin") { try { renderAdmin(); } catch (e) {} }
}
// Bouton de l'accueil de l'Administration (js/screens/admin-dashboard.js) : null sans la case.
function asgNavButton() {
  if (!Mod.canScreen("adminsig") || auth.mode !== "supabase") return null;
  const n = num(asg.count, 0);
  const b = el("button", "btn" + (n ? " aix-navnew" : ""), n ? t("asg.openN", { n }) : t("asg.open"));
  b.type = "button"; b.id = "asgNav";
  b.addEventListener("click", () => { asg.started = false; asg.page = 0; location.hash = "#" + HASH_OF.adminsig; });
  asgLoadCount();
  return b;
}

// Mots de la carte signalée : sens du dictionnaire ({ vals }) ou carte d'une liste partagée ({ data }).
function asgWords(x) {
  const c = x.card || {};
  if (x.scope === "dict") { const w = adWords(c.vals); return w === "—" ? "" : w; }
  const d = c.data;
  if (!d || typeof d !== "object") return "";
  const tm = d.terms && typeof d.terms === "object" ? d.terms : null;
  if (tm && Object.keys(tm).some(L => tm[L])) return Object.keys(tm).filter(L => tm[L]).map(L => L.toUpperCase() + " " + tm[L]).join(" · ");
  return [d.verb, d.sentence, d.title, d.question, d.answer].filter(v => typeof v === "string" && v).slice(0, 2).join(" · ");
}
// Contenu d'une carte de liste partagée, en lecture seule (aucun champ modifiable ici).
function asgDataNode(d) {
  const box = el("div", "asg-card");
  const line = (k, v) => { if (v == null || v === "") return; const r = el("div", "asg-kv"); r.append(el("span", "asg-k", k), el("span", "asg-v", String(v))); box.appendChild(r); };
  const tm = d.terms && typeof d.terms === "object" ? d.terms : {};
  Object.keys(tm).forEach(L => line(langName(L), tm[L] + (d.pos && typeof d.pos === "object" && d.pos[L] ? " (" + posLabel(d.pos[L], L) + ")" : "")));
  const ex = d.examples && typeof d.examples === "object" && !Array.isArray(d.examples) ? d.examples : {};
  Object.keys(ex).forEach(L => { const e = ex[L]; line("💬 " + langName(L), e && typeof e === "object" ? e.text : e); });
  ["verb", "tense", "person", "sentence", "answer", "hint", "title", "question"].forEach(f => { if (typeof d[f] === "string") line(f, d[f]); });
  if (!box.childNodes.length) box.appendChild(el("p", "muted", t("asg.cardGone")));
  return box;
}
function asgOpenCard(x) {
  if (x.scope === "dict" && x.sense_id && Mod.can("dict.see")) { adOpenSense(x.sense_id); return; }   // fenêtre du sens (outils du dictionnaire)
  const c = x.card || {};
  let body;
  if (x.scope === "dict") body = c.vals && Object.keys(c.vals).length ? adValsTable(c.vals) : el("p", "muted", t("asg.cardGone"));
  else body = c.data && typeof c.data === "object" ? asgDataNode(c.data) : el("p", "muted", t("asg.cardGone"));
  openModal(asgWords(x) || t("asg.openCard"), body, [{ label: t("close") }]);
}
async function asgSet(x, status) {
  if (asg.busy) return;
  asg.busy = true; asgRerender();
  try {
    const r = await aqRpc("admin_report_set", { p_id: x.id, p_status: status, p_all: true });
    toast(t("asg.set." + status, { n: num(Number(r && r.n), 0) }));
  } catch (e) { toast(asgErrText(e)); }
  asg.busy = false;
  asgLoad();
}
function asgSelect(label, options, value, onPick) {
  const s = el("select", "input");
  options.forEach(([v, text]) => { const o = el("option", null, text); o.value = v; s.appendChild(o); });
  s.value = value;
  s.setAttribute("aria-label", label);
  s.addEventListener("change", () => onPick(s.value));
  return formField(label, s);
}

function renderAdminReports() {
  const root = $("#screen-adminsig");
  if (!root) return;
  root.textContent = "";
  const top = el("div", "adm-top");
  const back = el("button", "link-btn", "‹ " + t("admin.title"));
  back.addEventListener("click", () => { location.hash = "#" + HASH_OF.admin; });
  top.appendChild(back);
  const ref = el("button", "link-btn", t("admin.refresh"));
  ref.addEventListener("click", () => asgLoad());
  top.appendChild(ref);
  root.appendChild(top);
  root.appendChild(el("h2", null, "🚩 " + t("asg.title")));
  if (!asg.started) { asgLoad(); return; }
  if (asg.missing) { root.appendChild(el("div", "card q-err", t("asg.missing"))); return; }
  root.appendChild(el("p", "muted", t("asg.help")));
  const d = asg.data;
  // Filtres : état, motif, langue
  const fl = el("div", "asg-filters");
  const go = () => { asg.page = 0; asgLoad(); };
  fl.appendChild(asgSelect(t("asg.f.status"), [["open", t("asg.s.open")], ["done", t("asg.s.done")], ["ignored", t("asg.s.ignored")], ["", t("asg.all")]], asg.f.status, v => { asg.f.status = v; go(); }));
  fl.appendChild(asgSelect(t("asg.f.reason"), [["", t("asg.all")]].concat(SGL_REASONS.map(r => [r, SGL_ICON[r] + " " + t("sgl.r." + r)])), asg.f.reason, v => { asg.f.reason = v; go(); }));
  const langs = arr(d && d.langs).map(String);
  if (asg.f.lang && !langs.includes(asg.f.lang)) langs.push(asg.f.lang);
  fl.appendChild(asgSelect(t("asg.f.lang"), [["", t("asg.all")]].concat(langs.map(L => [L, langName(L)])), asg.f.lang, v => { asg.f.lang = v; go(); }));
  root.appendChild(fl);
  if (asg.err) root.appendChild(el("div", "card q-err", asg.err));
  if (!d) { root.appendChild(el("div", "card muted", asg.loading ? t("admin.loading") : "—")); return; }
  const cn = d.counts || {};
  const sum = el("p", "muted asg-count", t("asg.count", { o: num(Number(cn.open), 0), d: num(Number(cn.done), 0), i: num(Number(cn.ignored), 0) }));
  sum.id = "asgCount";
  root.appendChild(sum);
  if (d.personal_open != null && num(Number(d.personal_open), 0) > 0) root.appendChild(el("p", "muted asg-personal", "🤖 " + t("asg.personal", { n: num(Number(d.personal_open), 0) })));
  const rows = arr(d.rows);
  if (!rows.length) root.appendChild(el("div", "card muted", t("asg.none")));
  rows.forEach(x => root.appendChild(asgRow(x)));
  const total = num(Number(d.total), 0), pages = Math.max(1, Math.ceil(total / ASG_PAGE));
  if (pages > 1) {
    const nav = el("div", "btns two");
    const p = el("button", "btn", "‹"); p.type = "button"; p.disabled = asg.page <= 0;
    p.addEventListener("click", () => { asg.page--; asgLoad(); });
    const n = el("button", "btn", "›"); n.type = "button"; n.disabled = asg.page >= pages - 1;
    n.addEventListener("click", () => { asg.page++; asgLoad(); });
    nav.append(p, n);
    root.appendChild(nav);
    root.appendChild(el("p", "muted", t("asg.page", { p: asg.page + 1, n: pages })));
  }
}

function asgRow(x) {
  const row = el("div", "card asg-row");
  row.dataset.id = x.id; row.dataset.status = x.status; row.dataset.scope = x.scope;
  const head = el("div", "asg-head");
  const known = SGL_REASONS.includes(x.reason);
  head.appendChild(el("b", "asg-reason", (known ? SGL_ICON[x.reason] + " " + t("sgl.r." + x.reason) : String(x.reason))));
  head.appendChild(el("span", "tag asg-st asg-st-" + x.status, t("asg.s." + (["open", "done", "ignored"].includes(x.status) ? x.status : "open"))));
  row.appendChild(head);
  const w = asgWords(x);
  const words = el("div", "asg-words", w || t("asg.cardGone"));
  if (!w) words.classList.add("muted");
  row.appendChild(words);
  const scope = x.scope === "dict" ? t("asg.scope.dict") : (x.list_name ? t("asg.scope.sharedName", { name: x.list_name }) : t("asg.scope.shared"));
  const bits = [scope];
  if (x.lang) bits.push(langName(x.lang));
  if (x.ctx && I18N.fr["asg.ctx." + x.ctx]) bits.push(t("asg.ctx." + x.ctx));
  bits.push(admDate(x.created_at));
  row.appendChild(el("div", "muted asg-sub", bits.join(" · ")));
  const who = el("div", "muted asg-sub");
  const a = el("button", "link-btn asg-who", t("asg.by", { id: x.by || "?" }));
  a.type = "button"; a.disabled = !Mod.can("accounts.see") || !x.user_id;
  a.addEventListener("click", () => { try { openAccountFiche(x.user_id, "adminsig"); } catch (e) {} });
  who.appendChild(a);
  if (num(Number(x.same), 0) > 1) who.appendChild(el("span", "tag asg-same", "×" + x.same + " · " + t("asg.same", { n: x.same })));
  row.appendChild(who);
  if (x.status !== "open" && x.decided_at) row.appendChild(el("div", "muted asg-sub", t("asg.decided", { s: t("asg.s." + x.status), id: x.decided_by || "?", d: admDate(x.decided_at) })));
  const btns = el("div", "am-btns asg-btns");
  const o = el("button", "am-btn", x.scope === "dict" && Mod.can("dict.see") ? t("asg.inDict") : t("asg.openCard"));
  o.type = "button"; o.dataset.act = "open";
  o.addEventListener("click", () => asgOpenCard(x));
  btns.appendChild(o);
  const act = (status, label, cls) => {
    const b = el("button", "am-btn" + (cls ? " " + cls : ""), label);
    b.type = "button"; b.dataset.act = status; b.disabled = asg.busy;
    b.setAttribute("data-net", "1");
    b.addEventListener("click", () => asgSet(x, status));
    btns.appendChild(modGate(b, "reports.act"));
  };
  if (x.status === "open") { act("done", "✓ " + t("asg.done"), "primary"); act("ignored", t("asg.ignore")); }
  else act("open", t("asg.reopen"));
  row.appendChild(btns);
  return row;
}
