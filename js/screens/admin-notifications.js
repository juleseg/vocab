"use strict";

// === NOTIFICATIONS PUSH (ADMIN) ===
// Étape 32. Écran #admin-notifications (Administration → Notifications), onglets Envoyer, Modèles, Ciblages,
// Programmées et Automatiques (étape 34), Historique.
// - Modèles et ciblages : tables notification_templates / notification_segments (lecture et écriture réservées à l'admin
//   par les règles RLS). Modèles et ciblages fournis : builtin renseigné, nom traduit dans l'interface (nom non modifiable).
// - Nombres ciblés / joignables et comptes exemples : admin_push_target(filtre, catégorie).
// - Envoi et test : fonction Supabase send-push (actions send / test) ; à l'ouverture de l'écran : action deferred
//   (notifications reportées par les heures calmes dont l'heure est venue).
// - Historique : admin_push_history (50 par page), détail admin_push_campaign, export CSV.
// - Journal : chaque envoi, test, modèle ou ciblage créé / modifié / supprimé → admin_push (data.action).
// Script SQL absent : « Lancez supabase-etape32.sql » ; fonction absente : envoi impossible (message), le reste marche.
// Étape 34 : envois programmés et règles automatiques (section ENVOIS PROGRAMMÉS ET AUTOMATIQUES, en bas) ; après un
// envoi, la vraie raison de ce qui n'est pas parti (réponse reasons de send-push) ; historique avec le type d'envoi.
// Étape 38 : onglet « Inviter à activer » (fichier js/screens/admin-invite.js, fonction npInviteTab).
// Étape 48 : onglet « Versions » (fichier js/screens/admin-release.js, fonction npReleaseTab) : annoncer une version.
const NP_PAGE = 50;
const NP_FILTER_KEYS = ["streak_min", "streak_max", "goal", "inactive_min", "active_within", "target_lang", "ui_lang",
  "due_min", "pending_min", "device_type", "installed"];
const nps = {
  tab: "send", started: false, loading: false, err: "", missing: false, fn: "unknown",   // fn : unknown | ok | missing
  templates: null, segments: null, sample: null,
  send: { src: "tpl", tplId: "", text: { title: {}, body: {} }, category: "announcements", screen: "home", image: "",
          seg: "", users: [], filter: {}, calc: null, calcBusy: false, calcErr: "", lang: "", sampleIdx: 0, busy: false },
  hist: { page: 0, data: null, loading: false, err: "" },
  fnVersion: "",                                                                     // version de send-push (GET)
  auto: { loaded: false, loading: false, err: "", missing: false, schedules: [], rules: [], state: null }   // étape 34
};
function npRerender() { if (currentScreen === "adminpush") renderAdminPush(); }
function npErr(e) { return alIsMissing(e) ? t("np.missingAdmin") : aqErrText(e); }
function npLog(action, data) { Activity.log("admin_push", Object.assign({ action }, data || {})); }
function npSegName(s) { return s ? (s.builtin && I18N.fr["np.seg." + s.builtin] ? t("np.seg." + s.builtin) : s.name) : ""; }
function npTplName(tp) { return tp ? (tp.builtin && I18N.fr["np.tpl." + tp.builtin] ? t("np.tpl." + tp.builtin) : tp.name) : ""; }
function npLangsOf(tx) { return AN_LANGS.filter(l => String((tx.title || {})[l] || "").trim() || String((tx.body || {})[l] || "").trim()); }
function npTable(name) { return Supa.client().from(name); }
async function npQ(p) { const r = await withTimeout(p, 20000); if (r && r.error) throw r.error; return r ? r.data : null; }

// Appel de la fonction send-push. Renvoie { ok, data, err } ; err = texte lisible ; fn manquante → nps.fn = "missing".
async function npInvoke(body) {
  try {
    const r = await withTimeout(Supa.client().functions.invoke(PUSH_FN, { body }), 120000);
    if (r && r.error) {
      const e = r.error, ctx = e && e.context;
      let status = 0, info = null;
      if (ctx && typeof ctx.status === "number") { status = ctx.status; try { info = await ctx.json(); } catch (x) {} }
      if (status === 404 || (!status && /fetch|relay|failed to send/i.test(String(e.message || e.name || "")))) {
        nps.fn = "missing"; return { ok: false, err: t("np.fnMissing") };
      }
      nps.fn = "ok";
      if (status === 403) return { ok: false, err: t("aq.err.denied") };
      if (info && info.error === "vapid_missing") return { ok: false, err: t("np.vapidMissing") };
      if (info && info.error === "empty_text") return { ok: false, err: t("np.err.text") };
      if (info && info.error === "template_not_found") return { ok: false, err: t("np.err.tplGone") };
      return { ok: false, err: t("np.err.send") + (info && info.message ? " (" + String(info.message).slice(0, 120) + ")" : "") };
    }
    nps.fn = "ok";
    return { ok: true, data: r ? r.data : null };
  } catch (e) {
    return { ok: false, err: sbErrKind(e) === "net" ? t("np.err.net") : t("np.err.send") };
  }
}

async function npLoad() {
  nps.started = true; nps.loading = true; nps.err = "";
  npRerender();
  try {
    const [tp, sg] = await Promise.all([
      npQ(npTable("notification_templates").select("*").order("created_at")),
      npQ(npTable("notification_segments").select("*").order("created_at"))
    ]);
    nps.templates = arr(tp); nps.segments = arr(sg); nps.missing = false;
    if (!nps.send.tplId && nps.templates.length) nps.send.tplId = nps.templates[0].id;
    if (!nps.send.seg) { const all = nps.segments.find(s => s.builtin === "all"); nps.send.seg = all ? all.id : (nps.segments[0] ? nps.segments[0].id : "__custom"); }
  } catch (e) { nps.missing = alIsMissing(e); nps.err = npErr(e); }
  try { if (!adm.list) adm.list = arr(await Supa.listAccounts()); } catch (e) {}
  if (!nps.missing) {
    try { const r = await aqRpc("admin_push_target", { p_filter: {}, p_category: null }); nps.sample = arr(r && r.sample); } catch (e) {}
    npInvoke({ action: "deferred" }).then(r => { if (!r.ok) npRerender(); });   // notifications reportées arrivées à échéance
    npVersion();
    npCalc();
  }
  nps.loading = false;
  npRerender();
}

function renderAdminPush() {
  const root = $("#screen-adminpush");
  if (!root) return;
  root.textContent = "";
  const back = el("button", "link-btn", t("aq.back"));
  back.addEventListener("click", () => { location.hash = "#" + HASH_OF.admin; });
  root.appendChild(back);
  const top = el("div", "adm-top");
  top.appendChild(el("h2", null, t("np.adminTitle")));
  const ref = el("button", "link-btn", t("admin.refresh"));
  ref.addEventListener("click", () => { nps.hist.data = null; if (typeof rls !== "undefined") rls.started = false; npLoad(); });   // étape 48 : onglet Versions relu aussi
  top.appendChild(ref);
  root.appendChild(top);
  if (!nps.started) { npLoad(); return; }
  if (nps.loading && !nps.templates) { root.appendChild(el("div", "empty", t("admin.loading"))); return; }
  if (nps.err) root.appendChild(el("div", "card q-err", nps.err));
  if (nps.missing) return;
  if (nps.fn === "missing") root.appendChild(el("div", "card np-msg", t("np.fnMissing")));
  const tabs = el("div", "seg np-tabs");
  [["send", "np.tab.send"], ["templates", "np.tab.templates"], ["segments", "np.tab.segments"], ["scheduled", "np.tab.scheduled"],
   ["auto", "np.tab.auto"], ["history", "np.tab.history"], ["invite", "ni.tab"], ["versions", "rl.tab"]].forEach(([k, lab]) => {
    const b = el("button", null, t(lab));
    b.type = "button";
    b.setAttribute("aria-pressed", String(nps.tab === k));
    b.addEventListener("click", () => { nps.tab = k; renderAdminPush(); });
    tabs.appendChild(b);
  });
  root.appendChild(tabs);
  if (nps.tab === "send") npSendTab(root);
  else if (nps.tab === "templates") npTemplatesTab(root);
  else if (nps.tab === "segments") npSegmentsTab(root);
  else if (nps.tab === "history") npHistoryTab(root);
  else if (nps.tab === "scheduled") npScheduledTab(root);
  else if (nps.tab === "invite") npInviteTab(root);   // étape 38 : js/screens/admin-invite.js
  else if (nps.tab === "versions") npReleaseTab(root);   // étape 48 : js/screens/admin-release.js
  else npAutoTab(root);
}

// --- Petits éléments de formulaire ---
function npSelect(opts, val, on) {
  const s = el("select", "input");
  opts.forEach(([v, l]) => { const o = el("option", null, l); o.value = v; s.appendChild(o); });
  s.value = val == null ? "" : String(val);
  if (s.value !== String(val == null ? "" : val)) s.value = opts.length ? opts[0][0] : "";
  s.addEventListener("change", () => on(s.value));
  return s;
}
function npNum(val, on) {
  const i = el("input", "input");
  i.type = "number"; i.min = "0"; i.max = "100000"; i.inputMode = "numeric";
  i.value = val == null ? "" : String(val);
  i.addEventListener("change", () => { const v = i.value === "" ? null : clampInt(i.value, 0, 100000, null); i.value = v == null ? "" : String(v); on(v); });
  return i;
}
function npCatOpts() { return PUSH_CATS.map(k => [k, t("np.cat." + k)]); }
function npScreenOpts() { return PUSH_SCREENS.map(k => [k, t("np.screen." + k)]); }
// Champs titre / message par langue + variables (touchées : insérées dans le dernier champ utilisé).
function npTextEditor(tx, onChange) {
  const wrap = el("div", "np-texts");
  let lastField = null;
  AN_LANGS.forEach(l => {
    const box = el("div", "np-lang");
    box.appendChild(el("div", "np-lang-h", langName(l, l) + " (" + l.toUpperCase() + ")"));
    const ti = textInput((tx.title || {})[l] || "", t("np.f.title"), l);
    ti.maxLength = 120;
    const bo = el("textarea", "input"); bo.rows = 2; bo.maxLength = 400; bo.lang = l; bo.placeholder = t("np.f.body"); bo.value = (tx.body || {})[l] || "";
    const upd = () => { tx.title = Object.assign({}, tx.title, { [l]: ti.value }); tx.body = Object.assign({}, tx.body, { [l]: bo.value }); onChange && onChange(); };
    [ti, bo].forEach(f => { f.addEventListener("input", upd); f.addEventListener("focus", () => { lastField = f; }); });
    box.append(ti, bo);
    wrap.appendChild(box);
  });
  const vars = el("div", "np-vars");
  vars.appendChild(el("span", "hint", t("np.vars")));
  PUSH_VARS.forEach(v => {
    const b = el("button", "tag np-var", "{" + v + "}");
    b.type = "button"; b.title = t("np.var." + v);
    b.addEventListener("mousedown", e => e.preventDefault());
    b.addEventListener("click", () => {
      const f = lastField || wrap.querySelector("input");
      const s = f.selectionStart != null ? f.selectionStart : f.value.length, e2 = f.selectionEnd != null ? f.selectionEnd : s;
      f.value = f.value.slice(0, s) + "{" + v + "}" + f.value.slice(e2);
      f.dispatchEvent(new Event("input"));
      f.focus();
    });
    vars.appendChild(b);
  });
  wrap.appendChild(vars);
  return wrap;
}
// Notification telle qu'elle s'affiche (aperçu).
function npMock(title, body, lang) {
  const m = el("div", "np-mock");
  const ic = el("img", "np-mock-ic"); ic.src = "icons/icon-192.png"; ic.alt = ""; ic.addEventListener("error", () => ic.remove());
  const tx = el("div", "np-mock-tx");
  const a = el("div", "np-mock-t", title || "—"), b = el("div", "np-mock-b", body || "");
  if (lang) { a.lang = lang; b.lang = lang; }
  tx.append(el("div", "np-mock-app", "Vocab"), a, b);
  m.append(ic, tx);
  return m;
}
// Aperçu par langue avec un compte exemple : onglets ko / fr / en + choix du compte.
// Renvoie un bloc qui se redessine lui-même (box._draw()) quand le texte change.
function npPreview(tx, sample, st) {
  const box = el("div", "np-preview");
  const draw = () => {
    box.textContent = "";
    const list = arr(sample);
    const acc = list[Math.min(st.sampleIdx || 0, Math.max(0, list.length - 1))] || null;
    const vars = Object.assign({ ami: t("np.var.amiEx") }, acc ? acc.vars : { identifiant: Storage.getUser() || "?", serie: 12, record: 30, objectif: 10, a_reviser: 25, a_valider: 3, jours_inactif: 8 });
    if (list.length) {
      box.appendChild(formField(t("np.sample"), npSelect(list.map((x, i) => [String(i), x.identifiant + " · " + String(x.ui_lang || "").toUpperCase()]), String(st.sampleIdx || 0),
        v => { st.sampleIdx = Number(v) || 0; st.lang = ""; draw(); })));
    } else box.appendChild(el("p", "hint", t("np.sampleNone")));
    const want = st.lang || (acc && acc.ui_lang) || state.settings.uiLang;
    const seg = el("div", "seg np-langseg");
    AN_LANGS.forEach(l => {
      const b = el("button", null, l.toUpperCase());
      b.type = "button"; b.setAttribute("aria-pressed", String(l === want));
      b.addEventListener("click", () => { st.lang = l; draw(); });
      seg.appendChild(b);
    });
    box.appendChild(seg);
    const l = pushPickLang(tx, want);
    if (!l) { box.appendChild(el("p", "q-err", t("np.err.text"))); return; }
    if (l !== want) box.appendChild(el("p", "hint", t("np.fallback", { a: want.toUpperCase(), b: l.toUpperCase() })));
    box.appendChild(npMock(pushRender((tx.title || {})[l], vars), pushRender((tx.body || {})[l], vars), l));
  };
  box._draw = draw;
  draw();
  return box;
}

// Description lisible d'un filtre.
function npFilterText(f) {
  f = f || {};
  const parts = [];
  if (arr(f.users).length) parts.push(t("np.ft.users", { n: arr(f.users).length }));
  if (f.streak_min != null) parts.push(t("np.ft.streakMin", { n: f.streak_min }));
  if (f.streak_max != null) parts.push(t("np.ft.streakMax", { n: f.streak_max }));
  if (f.goal === "done" || f.goal === "not_done") parts.push(t("np.ft.goal." + f.goal));
  if (f.inactive_min != null) parts.push(t("np.ft.inactive", { n: f.inactive_min }));
  if (f.active_within != null) parts.push(t("np.ft.active", { n: f.active_within }));
  if (f.target_lang) parts.push(t("np.ft.target", { l: langName(f.target_lang) }));
  if (f.ui_lang) parts.push(t("np.ft.ui", { l: langName(f.ui_lang) }));
  if (f.due_min != null) parts.push(t("np.ft.due", { n: f.due_min }));
  if (f.pending_min != null) parts.push(t("np.ft.pending", { n: f.pending_min }));
  if (f.device_type) parts.push(t("np.ft.device", { d: t("al.dev." + f.device_type) }));
  if (f.installed === true || f.installed === false) parts.push(t(f.installed ? "np.ft.installed" : "np.ft.notInstalled"));
  return parts.length ? parts.join(" · ") : t("np.ft.all");
}
function npCleanFilter(f) {
  const o = {};
  NP_FILTER_KEYS.forEach(k => { if (f[k] !== null && f[k] !== undefined && f[k] !== "") o[k] = f[k]; });
  if (arr(f.users).length) o.users = arr(f.users).slice(0, 5000);
  return o;
}
// Éditeur de filtres (tous doivent être vrais). f est modifié en place.
function npFilterEditor(f, onChange) {
  const box = el("div", "np-filter");
  const ch = (k, v) => { if (v === null || v === "" || v === undefined) delete f[k]; else f[k] = v; onChange && onChange(); };
  const grid = el("div", "aq-filters np-fgrid");
  const cell = (lab, input) => { const w = el("label", "aq-f"); w.append(el("span", null, lab), input); grid.appendChild(w); };
  cell(t("np.f.streakMin"), npNum(f.streak_min, v => ch("streak_min", v)));
  cell(t("np.f.streakMax"), npNum(f.streak_max, v => ch("streak_max", v)));
  cell(t("np.f.goal"), npSelect([["", t("np.f.any")], ["done", t("np.f.goalDone")], ["not_done", t("np.f.goalNot")]], f.goal || "", v => ch("goal", v)));
  cell(t("np.f.inactive"), npNum(f.inactive_min, v => ch("inactive_min", v)));
  cell(t("np.f.active"), npNum(f.active_within, v => ch("active_within", v)));
  cell(t("np.f.target"), npSelect([["", t("np.f.any")]].concat(LANG_CODES.map(c => [c, langName(c)])), f.target_lang || "", v => ch("target_lang", v)));
  cell(t("np.f.ui"), npSelect([["", t("np.f.any")]].concat(AN_LANGS.map(c => [c, langName(c, c)])), f.ui_lang || "", v => ch("ui_lang", v)));
  cell(t("np.f.due"), npNum(f.due_min, v => ch("due_min", v)));
  cell(t("np.f.pending"), npNum(f.pending_min, v => ch("pending_min", v)));
  cell(t("np.f.device"), npSelect([["", t("np.f.any")], ["phone", t("al.dev.phone")], ["tablet", t("al.dev.tablet")], ["desktop", t("al.dev.desktop")]], f.device_type || "", v => ch("device_type", v)));
  cell(t("np.f.installed"), npSelect([["", t("np.f.any")], ["true", t("np.f.yes")], ["false", t("np.f.no")]],
    f.installed === true ? "true" : f.installed === false ? "false" : "", v => ch("installed", v === "" ? null : v === "true")));
  box.appendChild(grid);
  return box;
}
// Choix de comptes (recherche, sélection multiple). Comptes bloqués : marqués (jamais ciblés).
function npPickAccounts(selected, onDone) {
  const sel = new Set(arr(selected));
  const accounts = arr(adm.list).slice().sort((a, b) => String(a.identifiant).localeCompare(String(b.identifiant)));
  const wrap = el("div", "np-pick");
  const q = textInput("", t("np.search"));
  const cnt = el("p", "hint");
  const list = el("div", "adm-pick np-picklist");
  const draw = () => {
    list.textContent = "";
    const s = normText(q.value);
    accounts.filter(a => !s || normText(a.identifiant).includes(s)).slice(0, 300).forEach(a => {
      list.appendChild(admAccountCheck(a, sel.has(a.user_id), on => { if (on) sel.add(a.user_id); else sel.delete(a.user_id); cnt.textContent = t("np.selected", { n: sel.size }); }).row);
    });
    cnt.textContent = t("np.selected", { n: sel.size });
  };
  q.addEventListener("input", draw);
  wrap.append(q, cnt, list);
  draw();
  openModal(t("np.pickTitle"), wrap, [
    { label: t("cancel") },
    { label: t("confirm"), kind: "primary", onClick: () => { onDone([...sel]); } }
  ]);
}

// --- Onglet Envoyer ---
function npCurrentFilter() {
  const s = nps.send;
  if (s.seg === "__users") return { users: s.users.slice() };
  if (s.seg === "__custom") return npCleanFilter(s.filter);
  const sg = arr(nps.segments).find(x => x.id === s.seg);
  return sg ? npCleanFilter(Object.assign({}, sg.filter)) : {};
}
function npCurrentMessage() {
  const s = nps.send;
  if (s.src === "tpl") {
    const tp = arr(nps.templates).find(x => x.id === s.tplId);
    return tp ? { tx: { title: tp.title || {}, body: tp.body || {} }, category: tp.category, screen: tp.screen, image: tp.image || "", tpl: tp } : null;
  }
  return { tx: s.text, category: s.category, screen: s.screen, image: s.image, tpl: null };
}
let npCalcT = null;
function npCalcSoon() { clearTimeout(npCalcT); npCalcT = setTimeout(npCalc, 400); }
async function npCalc() {
  const s = nps.send, m = npCurrentMessage();
  if (s.seg === "__users" && !s.users.length) { s.calc = { targeted: 0, reachable: 0, no_subscription: 0, category_off: 0, sample: [] }; npRerender(); return; }
  s.calcBusy = true; s.calcErr = "";
  const key = JSON.stringify([npCurrentFilter(), m ? m.category : null]);
  s.calcKey = key;
  try {
    const r = await aqRpc("admin_push_target", { p_filter: npCurrentFilter(), p_category: m ? m.category : null });
    if (s.calcKey !== key) return;
    s.calc = r || null; s.sampleIdx = 0; s.lang = "";
  } catch (e) { if (s.calcKey === key) { s.calc = null; s.calcErr = npErr(e); } }
  s.calcBusy = false;
  if (nps.tab === "send") npRerender();
}
function npSendTab(root) {
  const s = nps.send;
  // Message
  const c1 = el("div", "card");
  c1.appendChild(el("h3", "np-h3", t("np.message")));
  const src = el("div", "seg");
  [["tpl", "np.fromTpl"], ["text", "np.fromText"]].forEach(([k, lab]) => {
    const b = el("button", null, t(lab)); b.type = "button"; b.setAttribute("aria-pressed", String(s.src === k));
    b.addEventListener("click", () => { s.src = k; npCalcSoon(); npRerender(); });
    src.appendChild(b);
  });
  c1.appendChild(src);
  if (s.src === "tpl") {
    const tps = arr(nps.templates);
    if (!tps.length) c1.appendChild(el("p", "muted", t("np.noTpl")));
    else {
      c1.appendChild(formField(t("np.tpl"), npSelect(tps.map(tp => [tp.id, npTplName(tp)]), s.tplId, v => { s.tplId = v; s.lang = ""; npCalcSoon(); npRerender(); })));
      const tp = tps.find(x => x.id === s.tplId);
      if (tp) c1.appendChild(el("p", "hint", t("np.cat." + tp.category) + " · " + t("np.opens", { s: t("np.screen." + tp.screen) }) + " · " + npLangsOf(tp).map(l => l.toUpperCase()).join(" · ")));
    }
  } else {
    const row = el("div", "aq-filters");
    const cell = (lab, input) => { const w = el("label", "aq-f"); w.append(el("span", null, lab), input); row.appendChild(w); };
    cell(t("np.f.category"), npSelect(npCatOpts(), s.category, v => { s.category = v; npCalcSoon(); }));
    cell(t("np.f.screen"), npSelect(npScreenOpts(), s.screen, v => { s.screen = v; }));
    c1.appendChild(row);
    let pv = null;
    c1.appendChild(npTextEditor(s.text, () => { if (pv) pv._draw(); }));
    const img = textInput(s.image, "https://…");
    img.addEventListener("input", () => { s.image = img.value.trim(); });
    c1.appendChild(formField(t("np.f.image"), img, false, t("np.f.imageHint")));
    c1._setPv = n => { pv = n; };
  }
  root.appendChild(c1);
  // Ciblage
  const c2 = el("div", "card");
  c2.appendChild(el("h3", "np-h3", t("np.target")));
  const segOpts = arr(nps.segments).map(x => [x.id, npSegName(x)]).concat([["__users", t("np.pickUsers")], ["__custom", t("np.custom")]]);
  c2.appendChild(npSelect(segOpts, s.seg, v => { s.seg = v; if (v === "__users" && !s.users.length) npPickAccounts(s.users, u => { s.users = u; npCalc(); }); npCalc(); npRerender(); }));
  const sg = arr(nps.segments).find(x => x.id === s.seg);
  if (sg) c2.appendChild(el("p", "hint", npFilterText(sg.filter)));
  if (s.seg === "__users") {
    const b = el("button", "btn", t("np.pickBtn", { n: s.users.length }));
    b.type = "button"; b.addEventListener("click", () => npPickAccounts(s.users, u => { s.users = u; npCalc(); npRerender(); }));
    c2.appendChild(b);
  }
  if (s.seg === "__custom") c2.appendChild(npFilterEditor(s.filter, npCalcSoon));
  c2.appendChild(el("p", "hint", t("np.blockedNote")));
  root.appendChild(c2);
  // Aperçu et nombres
  const c3 = el("div", "card");
  c3.appendChild(el("h3", "np-h3", t("np.preview")));
  const nums = el("div", "np-nums");
  if (s.calcBusy && !s.calc) nums.appendChild(el("span", "muted", t("admin.loading")));
  else if (s.calcErr) nums.appendChild(el("span", "q-err", s.calcErr));
  else if (s.calc) {
    const k = (lab, v, cls) => { const d = el("div", "np-num" + (cls ? " " + cls : "")); d.append(el("b", null, dashFmt(v)), el("span", null, lab)); nums.appendChild(d); };
    k(t("np.targeted"), s.calc.targeted);
    k(t("np.reachable"), s.calc.reachable, "ok");
    k(t("np.noSub"), s.calc.no_subscription);
    k(t("np.catOff"), s.calc.category_off);
  }
  c3.appendChild(nums);
  const m = npCurrentMessage();
  if (m) {
    const pv = npPreview(m.tx, s.calc && s.calc.sample, s);
    c3.appendChild(pv);
    if (c1._setPv) c1._setPv(pv);
  }
  root.appendChild(c3);
  // Boutons
  const btns = el("div", "btns two");
  const test = el("button", "btn", t("np.testMe")), go = el("button", "btn primary", t("np.send"));
  test.type = go.type = "button";
  test.disabled = go.disabled = s.busy || !m || nps.fn === "missing";
  test.addEventListener("click", () => npSendNow(true));
  go.addEventListener("click", () => npSendNow(false));
  btns.append(test, go);
  root.appendChild(btns);
  if (s.busy) root.appendChild(el("p", "muted", t("np.sending")));
}
// Vraie raison de ce qui n'est pas parti (send-push 34 : d.reasons = { http_403: 1, expired: 1, … }).
// Ancienne fonction (sans reasons) : raison générale, jamais « aucun appareil » par défaut.
function npWhyText(k, test) {
  if (/^http_\d+$/.test(k)) return t("np.why.http", { c: k.slice(5) });
  if (k === "no_subscription") return t(test ? "np.why.no_subscription_test" : "np.why.no_subscription");
  return I18N.fr["np.why." + k] ? t("np.why." + k) : t("np.why.other", { r: k });
}
function npWhyLines(d, test) {
  const r = d && d.reasons && typeof d.reasons === "object" ? d.reasons : null;
  if (r) return Object.keys(r).filter(k => num(Number(r[k]), 0) > 0)
    .sort((a, b) => num(Number(r[b]), 0) - num(Number(r[a]), 0))
    .map(k => npWhyText(k, test) + (num(Number(r[k]), 0) > 1 ? " (× " + r[k] + ")" : ""));
  if (num(d && d.sent, 0)) return [];
  if (num(d && d.failed, 0)) return [t("np.why.failedOld")];
  if (num(d && d.deferred, 0)) return [t("np.why.quiet_hours")];
  if (num(d && d.skipped, 0)) return [t("np.why.skippedOld")];
  return num(d && d.targeted, 0) ? [] : [t("np.why.noTarget")];
}
function npPayload() {
  const s = nps.send, m = npCurrentMessage();
  const sg = arr(nps.segments).find(x => x.id === s.seg);
  const c = {
    filter: npCurrentFilter(),
    segment_id: sg ? sg.id : null,
    segment_name: sg ? npSegName(sg) : s.seg === "__users" ? t("np.pickUsers") + " (" + s.users.length + ")" : t("np.custom") + " : " + npFilterText(s.filter)
  };
  if (m.tpl) c.template_id = m.tpl.id;
  else Object.assign(c, { title: m.tx.title, body: m.tx.body, category: m.category, screen: m.screen, image: m.image || null });
  return c;
}
async function npSendNow(test) {
  const s = nps.send, m = npCurrentMessage();
  if (!m) return;
  if (!pushPickLang(m.tx, state.settings.uiLang)) { toast(t("np.err.text")); return; }
  if (m.image && !/^https:\/\/\S+$/.test(m.image)) { toast(t("np.err.image")); return; }
  const label = m.tpl ? npTplName(m.tpl) : (pushRender((m.tx.title || {})[pushPickLang(m.tx, state.settings.uiLang)] || "", {}) || "—");
  const run = async () => {
    s.busy = true; npRerender();
    const r = await npInvoke({ action: test ? "test" : "send", campaign: npPayload() });
    s.busy = false;
    if (!r.ok) { npRerender(); openModal(t("np.sendFail"), el("p", "q-err", r.err), [{ label: t("close") }]); return; }
    const d = r.data || {};
    npLog(test ? "test" : "send", { title: label.slice(0, 60), segment: test ? "" : String(npPayload().segment_name || "").slice(0, 60),
      targeted: num(d.targeted, 0), sent: num(d.sent, 0), failed: num(d.failed, 0), skipped: num(d.skipped, 0), deferred: num(d.deferred, 0) });
    nps.hist.data = null;
    npRerender();
    const body = el("div");
    body.appendChild(el("p", null, t("np.result", { t: num(d.targeted, 0), s: num(d.sent, 0), f: num(d.failed, 0), i: num(d.skipped, 0), d: num(d.deferred, 0) })));
    if (num(d.expired, 0)) body.appendChild(el("p", "hint", t("np.resultExpired", { n: num(d.expired, 0) })));
    const why = npWhyLines(d, test);
    if (why.length) {
      const box = el("div", num(d.sent, 0) ? "np-why" : "np-msg np-why");
      box.appendChild(el("div", "np-why-h", t(num(d.sent, 0) ? "np.why.partial" : "np.why.none")));
      why.forEach(x => box.appendChild(el("div", null, "• " + x)));
      body.appendChild(box);
    }
    openModal(t(test ? "np.testDone" : "np.sentTitle"), body, [
      { label: t("np.tab.history"), onClick: () => { nps.tab = "history"; npRerender(); } },
      { label: t("close"), kind: "primary" }
    ]);
  };
  if (test) { run(); return; }
  const c = s.calc || {};
  openModal(t("np.confirmTitle"), el("p", null, t("np.confirm", { title: label, n: num(Number(c.targeted), 0), m: num(Number(c.reachable), 0) })), [
    { label: t("cancel") },
    { label: t("np.send"), kind: "primary", onClick: () => { run(); } }
  ]);
}

// --- Onglet Modèles ---
function npTemplatesTab(root) {
  const add = el("button", "btn primary", t("np.tplNew"));
  add.type = "button"; add.addEventListener("click", () => npEditTemplate(null, false));
  root.appendChild(add);
  const list = arr(nps.templates);
  if (!list.length) { root.appendChild(el("div", "empty", t("np.noTpl"))); return; }
  list.forEach(tp => {
    const c = el("div", "card np-item");
    const head = el("div", "an-head");
    head.append(el("div", "an-t", npTplName(tp)), el("span", "tag", t("np.cat." + tp.category)));
    c.appendChild(head);
    const l = pushPickLang(tp, state.settings.uiLang);
    if (l) { const p = el("div", "an-prev", [tp.title[l], tp.body[l]].filter(Boolean).join(" — ")); p.lang = l; c.appendChild(p); }
    c.appendChild(el("div", "an-meta", t("np.opens", { s: t("np.screen." + tp.screen) }) + " · " + t("an.langs") + " : " + npLangsOf(tp).map(x => x.toUpperCase()).join(" · ") + (tp.image ? " · 🖼" : "")));
    const acts = el("div", "an-acts");
    const btn = (lab, cls, on) => { const b = el("button", "btn" + (cls ? " " + cls : ""), lab); b.type = "button"; b.addEventListener("click", on); acts.appendChild(b); };
    btn(t("np.use"), "primary", () => { nps.send.src = "tpl"; nps.send.tplId = tp.id; nps.send.lang = ""; nps.tab = "send"; npCalc(); npRerender(); });
    btn(t("an.edit"), "", () => npEditTemplate(tp, false));
    btn(t("np.duplicate"), "", () => npEditTemplate(tp, true));
    btn(t("delete"), "danger", () => npDeleteTemplate(tp));
    c.appendChild(acts);
    root.appendChild(c);
  });
}
function npEditTemplate(tp, copy) {
  const f = {
    name: tp ? (copy ? t("np.copyOf", { n: npTplName(tp) }) : tp.name) : "",
    category: tp ? tp.category : "announcements", screen: tp ? tp.screen : "home", image: tp && tp.image ? tp.image : "",
    tx: { title: Object.assign({}, tp ? tp.title : {}), body: Object.assign({}, tp ? tp.body : {}) }
  };
  const builtin = tp && tp.builtin && !copy;
  const pst = { sampleIdx: 0, lang: "" };
  const box = el("div", "np-edit");
  const name = textInput(builtin ? npTplName(tp) : f.name, t("np.f.name"));
  name.maxLength = 120; name.disabled = !!builtin;
  name.addEventListener("input", () => { f.name = name.value; });
  box.appendChild(formField(t("np.f.name"), name, true, builtin ? t("np.builtinName") : null));
  const row = el("div", "aq-filters");
  const cell = (lab, input) => { const w = el("label", "aq-f"); w.append(el("span", null, lab), input); row.appendChild(w); };
  cell(t("np.f.category"), npSelect(npCatOpts(), f.category, v => { f.category = v; }));
  cell(t("np.f.screen"), npSelect(npScreenOpts(), f.screen, v => { f.screen = v; }));
  box.appendChild(row);
  let pv = null;
  box.appendChild(npTextEditor(f.tx, () => { if (pv) pv._draw(); }));
  const img = textInput(f.image, "https://…");
  img.addEventListener("input", () => { f.image = img.value.trim(); });
  box.appendChild(formField(t("np.f.image"), img, false, t("np.f.imageHint")));
  box.appendChild(el("h4", "fc-h4", t("np.preview")));
  pv = npPreview(f.tx, nps.sample, pst);
  box.appendChild(pv);
  openModal(t(tp && !copy ? "np.tplEdit" : "np.tplNew"), box, [
    { label: t("cancel") },
    { label: t("save"), kind: "primary", onClick: () => {
      if (!builtin && !f.name.trim()) { toast(t("np.err.name")); return false; }
      if (!npLangsOf(f.tx).length) { toast(t("np.err.text")); return false; }
      if (f.image && !/^https:\/\/\S+$/.test(f.image)) { toast(t("np.err.image")); return false; }
      npSaveTemplate(tp && !copy ? tp : null, f, copy ? "template_copy" : tp ? "template_edit" : "template_create");
    } }
  ]);
}
async function npSaveTemplate(tp, f, action) {
  const clean = o => { const r = {}; AN_LANGS.forEach(l => { const v = String((o || {})[l] || "").trim(); if (v) r[l] = v; }); return r; };
  const row = { category: f.category, screen: f.screen, image: f.image || null, title: clean(f.tx.title), body: clean(f.tx.body) };
  if (!(tp && tp.builtin)) row.name = f.name.trim().slice(0, 120);
  try {
    if (tp) await npQ(npTable("notification_templates").update(row).eq("id", tp.id));
    else await npQ(npTable("notification_templates").insert(row));
    npLog(action, { name: (row.name || npTplName(tp)).slice(0, 60) });
    toast(t("np.saved"));
    await npLoad();
  } catch (e) { toast(npErr(e)); }
}
function npDeleteTemplate(tp) {
  openModal(t("delete"), el("p", null, t("np.tplDelConfirm", { n: npTplName(tp) })), [
    { label: t("cancel") },
    { label: t("delete"), kind: "danger", onClick: async () => {
      try {
        await npQ(npTable("notification_templates").delete().eq("id", tp.id));
        npLog("template_delete", { name: npTplName(tp).slice(0, 60) });
        if (nps.send.tplId === tp.id) nps.send.tplId = "";
        await npLoad();
      } catch (e) { toast(npErr(e)); }
    } }
  ]);
}

// --- Onglet Ciblages ---
function npSegmentsTab(root) {
  const add = el("button", "btn primary", t("np.segNew"));
  add.type = "button"; add.addEventListener("click", () => npEditSegment(null));
  root.appendChild(add);
  const list = arr(nps.segments);
  if (!list.length) { root.appendChild(el("div", "empty", t("np.noSeg"))); return; }
  list.forEach(sg => {
    const c = el("div", "card np-item");
    const head = el("div", "an-head");
    head.appendChild(el("div", "an-t", npSegName(sg)));
    c.appendChild(head);
    c.appendChild(el("div", "an-meta", npFilterText(sg.filter)));
    const res = el("div", "np-segres");
    if (sg._calc) res.textContent = t("np.segCount", { n: dashFmt(sg._calc.targeted), m: dashFmt(sg._calc.reachable) });
    c.appendChild(res);
    const acts = el("div", "an-acts");
    const btn = (lab, cls, on) => { const b = el("button", "btn" + (cls ? " " + cls : ""), lab); b.type = "button"; b.addEventListener("click", on); acts.appendChild(b); };
    btn(t("np.count"), "", async () => {
      res.textContent = t("admin.loading");
      try { sg._calc = await aqRpc("admin_push_target", { p_filter: npCleanFilter(Object.assign({}, sg.filter)), p_category: null });
        res.textContent = t("np.segCount", { n: dashFmt(sg._calc.targeted), m: dashFmt(sg._calc.reachable) }); }
      catch (e) { res.textContent = npErr(e); }
    });
    btn(t("np.use"), "primary", () => { nps.send.seg = sg.id; nps.tab = "send"; npCalc(); npRerender(); });
    btn(t("an.edit"), "", () => npEditSegment(sg));
    btn(t("delete"), "danger", () => npDeleteSegment(sg));
    c.appendChild(acts);
    root.appendChild(c);
  });
}
function npEditSegment(sg) {
  const f = Object.assign({}, sg ? sg.filter : {});
  let name0 = sg ? sg.name : "";
  const builtin = sg && sg.builtin;
  const box = el("div", "np-edit");
  const name = textInput(builtin ? npSegName(sg) : name0, t("np.f.name"));
  name.maxLength = 120; name.disabled = !!builtin;
  name.addEventListener("input", () => { name0 = name.value; });
  box.appendChild(formField(t("np.f.name"), name, true, builtin ? t("np.builtinName") : null));
  const res = el("p", "np-segres");
  const calc = async () => {
    res.textContent = t("admin.loading");
    try { const r = await aqRpc("admin_push_target", { p_filter: npCleanFilter(f), p_category: null }); res.textContent = t("np.segCount", { n: dashFmt(r.targeted), m: dashFmt(r.reachable) }); }
    catch (e) { res.textContent = npErr(e); }
  };
  let ct = null;
  const soon = () => { clearTimeout(ct); ct = setTimeout(calc, 400); };
  const ub = el("button", "btn", t("np.pickBtn", { n: arr(f.users).length }));
  ub.type = "button";
  ub.addEventListener("click", () => npPickAccounts(f.users, u => { f.users = u; ub.textContent = t("np.pickBtn", { n: u.length }); soon(); }));
  box.appendChild(formField(t("np.f.users"), ub, false, t("np.f.usersHint")));
  box.appendChild(npFilterEditor(f, soon));
  box.appendChild(res);
  calc();
  openModal(t(sg ? "np.segEdit" : "np.segNew"), box, [
    { label: t("cancel") },
    { label: t("save"), kind: "primary", onClick: () => {
      if (!builtin && !String(name0).trim()) { toast(t("np.err.name")); return false; }
      npSaveSegment(sg, String(name0).trim(), npCleanFilter(f));
    } }
  ]);
}
async function npSaveSegment(sg, name, filter) {
  const row = { filter };
  if (!(sg && sg.builtin)) row.name = name.slice(0, 120);
  try {
    if (sg) await npQ(npTable("notification_segments").update(row).eq("id", sg.id));
    else await npQ(npTable("notification_segments").insert(row));
    npLog(sg ? "segment_edit" : "segment_create", { name: (row.name || npSegName(sg)).slice(0, 60), filter: npFilterText(filter).slice(0, 110) });
    toast(t("np.saved"));
    await npLoad();
  } catch (e) { toast(npErr(e)); }
}
function npDeleteSegment(sg) {
  openModal(t("delete"), el("p", null, t("np.segDelConfirm", { n: npSegName(sg) })), [
    { label: t("cancel") },
    { label: t("delete"), kind: "danger", onClick: async () => {
      try {
        await npQ(npTable("notification_segments").delete().eq("id", sg.id));
        npLog("segment_delete", { name: npSegName(sg).slice(0, 60) });
        if (nps.send.seg === sg.id) nps.send.seg = "";
        await npLoad();
      } catch (e) { toast(npErr(e)); }
    } }
  ]);
}

// --- Onglet Historique ---
async function npHistLoad() {
  const h = nps.hist;
  h.loading = true; h.err = "";
  npRerender();
  try { h.data = await aqRpc("admin_push_history", { p_limit: NP_PAGE, p_offset: h.page * NP_PAGE }); }
  catch (e) { h.err = npErr(e); }
  h.loading = false;
  npRerender();
}
// Type d'envoi : immédiat / programmé (nom de l'envoi) / automatique (règle).
function npModeLabel(c) {
  const m = c && c.mode ? c.mode : "immediate", st = (c && c.settings) || {};
  let s = t("np.mode." + m);
  if (m === "auto" && st.rule) s += " · " + t("np.rule." + st.rule);
  else if (m === "scheduled" && st.schedule_name) s += " · " + String(st.schedule_name).slice(0, 60);
  return s;
}
function npCampaignTitle(c) {
  const l = pushPickLang({ title: c.title || {}, body: c.body || {} }, state.settings.uiLang);
  return l ? String((c.title || {})[l] || (c.body || {})[l] || "") : "—";
}
function npStatusLabel(d) {
  const st = t("np.st." + d.status);
  if (!d.reason) return st;
  const key = String(d.reason).startsWith("http_") ? "np.r.http" : "np.r." + d.reason;
  return st + " · " + (I18N.fr[key] ? t(key, { c: String(d.reason).slice(5) }) : String(d.reason));
}
function npHistoryTab(root) {
  const h = nps.hist;
  if (!h.data && !h.loading && !h.err) { npHistLoad(); return; }
  const bar = el("div", "an-acts");
  const b1 = el("button", "btn", t("dash.csv")), b2 = el("button", "btn", t("np.runDeferred"));
  b1.type = b2.type = "button";
  b1.addEventListener("click", npHistCsv);
  b2.addEventListener("click", async () => {
    const r = await npInvoke({ action: "deferred" });
    if (!r.ok) { toast(r.err); return; }
    const d = (r.data && r.data.deferred) || {};
    toast(t("np.deferredDone", { s: num(d.sent, 0), f: num(d.failed, 0), i: num(d.skipped, 0) }));
    npHistLoad();
  });
  bar.append(b1, b2);
  root.appendChild(bar);
  if (h.loading && !h.data) { root.appendChild(el("div", "empty", t("admin.loading"))); return; }
  if (h.err) { root.appendChild(el("div", "card q-err", h.err)); return; }
  const total = num(Number(h.data.total), 0), rows = arr(h.data.rows);
  if (!total) { root.appendChild(el("div", "empty", t("np.histEmpty"))); return; }
  const pages = Math.max(1, Math.ceil(total / NP_PAGE));
  const pager = () => {
    if (pages <= 1) return null;
    const w = el("div", "pv-pager");
    const prev = el("button", "btn", "‹"), next = el("button", "btn", "›");
    prev.disabled = h.page <= 0; next.disabled = h.page >= pages - 1;
    prev.addEventListener("click", () => { h.page--; npHistLoad(); });
    next.addEventListener("click", () => { h.page++; npHistLoad(); });
    w.append(prev, el("span", null, t("pv.page", { i: h.page + 1, n: pages })), next);
    return w;
  };
  const p1 = pager(); if (p1) root.appendChild(p1);
  rows.forEach(c => {
    const card = el("button", "card al-row np-hrow");
    card.type = "button";
    const head = el("div", "al-head");
    head.append(el("span", "al-who", npCampaignTitle(c)), el("span", "al-time", alTime(c.created_at)));
    card.appendChild(head);
    const tags = el("div", "adm-tags");
    tags.appendChild(el("span", "tag np-mode-" + (c.mode || "immediate"), npModeLabel(c)));
    if (c.is_test) tags.appendChild(el("span", "tag warn", t("np.testTag")));
    tags.appendChild(el("span", "tag", c.template_name || t("np.freeText")));
    tags.appendChild(el("span", "tag", t("np.cat." + c.category)));
    if (c.segment_name) tags.appendChild(el("span", "tag", c.segment_name));
    if (c.status !== "done") tags.appendChild(el("span", "tag" + (c.status === "error" ? " bad" : ""), t("np.cst." + c.status)));
    if (c.error === "template_missing") tags.appendChild(el("span", "tag bad", t("np.r.template_missing")));
    card.appendChild(tags);
    card.appendChild(el("div", "np-hnums", t("np.histNums", { t: dashFmt(c.targeted), s: dashFmt(c.sent), f: dashFmt(c.failed), i: dashFmt(c.skipped),
      d: dashFmt(c.deferred), c: dashFmt(c.clicked) })));
    card.addEventListener("click", () => npCampaignDetail(c));
    root.appendChild(card);
  });
  const p2 = pager(); if (p2) root.appendChild(p2);
}
async function npCampaignDetail(c) {
  const wrap = el("div", "aq-detailbox");
  wrap.appendChild(el("p", "muted", t("admin.loading")));
  openModal(npCampaignTitle(c), wrap, [{ label: t("close") }]);
  let d;
  try { d = await aqRpc("admin_push_campaign", { p_id: c.id }); }
  catch (e) { wrap.textContent = ""; wrap.appendChild(el("p", "q-err", npErr(e))); return; }
  wrap.textContent = "";
  const cp = (d && d.campaign) || c, list = arr(d && d.deliveries);
  wrap.appendChild(fcDl([
    [t("np.h.date"), alTime(cp.created_at)], [t("np.h.type"), npModeLabel(Object.assign({}, c, cp))], [t("np.h.by"), c.created_by || "—"],
    [t("np.h.source"), cp.template_name || t("np.freeText")], [t("np.f.category"), t("np.cat." + cp.category)],
    [t("np.target"), (cp.segment_name || "—") + " · " + npFilterText(cp.filter)], [t("np.f.screen"), t("np.screen." + cp.screen)]
  ]));
  const csv = el("button", "btn", t("dash.csv"));
  csv.type = "button";
  const head = [t("np.h.account"), t("np.h.device"), t("np.h.lang"), t("np.h.status"), t("np.h.until"), t("np.h.sent"), t("np.h.clicked"), t("np.f.title"), t("np.f.body")];
  const dev = x => x.device ? [t("al.dev." + (x.device.type || "desktop")), x.device.os, x.device.browser].filter(Boolean).join(" · ") : (x.device_id ? "?" : "—");
  const rowsOf = () => list.map(x => [x.identifiant, dev(x), String(x.lang || "").toUpperCase(), npStatusLabel(x), x.deferred_until ? alTime(x.deferred_until) : "",
    x.sent_at ? alTime(x.sent_at) : "", x.clicked_at ? alTime(x.clicked_at) : "", x.title || "", x.body || ""]);
  csv.addEventListener("click", () => dashSaveCsv("notification-" + String(c.id).slice(0, 8), head, rowsOf()));
  wrap.appendChild(csv);
  if (!list.length) { wrap.appendChild(el("p", "muted", t("np.noDelivery"))); return; }
  wrap.appendChild(fcTable(head.slice(0, 7), rowsOf().map(r => r.slice(0, 7)), 9));
}
async function npHistCsv() {
  try {
    const r = await aqRpc("admin_push_history", { p_limit: 1000, p_offset: 0 });
    const head = [t("np.h.date"), t("np.h.type"), t("np.h.by"), t("np.testTag"), t("np.h.source"), t("np.f.title"), t("np.f.category"), t("np.target"),
      t("np.targeted"), t("np.h.sent"), t("np.st.failed"), t("np.st.skipped"), t("np.st.deferred"), t("np.h.clicked")];
    const rows = arr(r && r.rows).map(c => [alTime(c.created_at), npModeLabel(c), c.created_by || "", c.is_test ? "1" : "", c.template_name || t("np.freeText"), npCampaignTitle(c),
      t("np.cat." + c.category), c.segment_name || "", num(Number(c.targeted), 0), num(Number(c.sent), 0), num(Number(c.failed), 0),
      num(Number(c.skipped), 0), num(Number(c.deferred), 0), num(Number(c.clicked), 0)]);
    dashSaveCsv("notifications", head, rows);
  } catch (e) { toast(npErr(e)); }
}

// --- Fiche d'un compte : notifications ---
function fcPush() {
  const sec = fcSec(t("np.fc.title"), "fc-push");
  const p = fc.push;
  if (!p) { sec.appendChild(el("p", "q-note", fc.pushErr || "—")); return sec; }
  const subs = arr(p.subscriptions);
  sec.appendChild(el("h4", "fc-h4", t("np.fc.devices", { n: subs.length })));
  if (!subs.length) sec.appendChild(el("p", "muted", t("np.fc.noDevice")));
  subs.forEach(s => {
    const c = el("div", "al-devcard");
    const d = s.device || {};
    c.appendChild(el("div", "al-devt", [d.type ? t("al.dev." + d.type) : "", d.os, d.browser].filter(Boolean).join(" · ") || s.host || "?"));
    const tags = el("div", "adm-tags");
    if (d.installed != null) tags.appendChild(el("span", "tag" + (d.installed ? "" : " muted"), d.installed ? t("al.installed") : t("al.browser")));
    if (s.host) tags.appendChild(el("span", "tag", s.host));
    if (num(Number(s.failures), 0) > 0) tags.appendChild(el("span", "tag warn", t("np.fc.failures", { n: s.failures })));
    c.appendChild(tags);
    c.appendChild(el("div", "al-devm", t("np.fc.since", { a: alTime(s.created_at), b: s.last_ok_at ? alTime(s.last_ok_at) : "—" })));
    sec.appendChild(c);
  });
  const pr = p.prefs || {};
  sec.appendChild(el("h4", "fc-h4", t("np.cats")));
  const tags = el("div", "adm-tags");
  PUSH_CATS.forEach(k => tags.appendChild(el("span", "tag" + (pr[k] === false ? " muted" : " ok"), (pr[k] === false ? "✕ " : "✓ ") + t("np.cat." + k))));
  sec.appendChild(tags);
  sec.appendChild(el("p", "hint", pr.quiet_on === false ? t("np.fc.quietOff") : t("np.fc.quiet", { a: pr.quiet_start || "22:00", b: pr.quiet_end || "08:00", z: pr.tz || "—" })));
  const last = arr(p.last);
  sec.appendChild(el("h4", "fc-h4", t("np.fc.last", { n: last.length })));
  if (!last.length) sec.appendChild(el("p", "muted", t("am.fc.none")));
  else sec.appendChild(fcTable([t("np.h.date"), t("np.f.title"), t("np.h.status"), t("np.h.clicked")],
    last.map(x => [alTime(x.created_at), (x.is_test ? "[" + t("np.testTag") + "] " : "") + (x.title || x.template_name || "—"), npStatusLabel(x), x.clicked_at ? alTime(x.clicked_at) : "—"]), 9));
  return sec;
}

// === ENVOIS PROGRAMMÉS ET AUTOMATIQUES (ÉTAPE 34) ===
// Onglets Programmées et Automatiques. Données : admin_push_schedules / admin_push_rules / admin_push_scheduler
// (script supabase-etape34.sql) ; les envois partent par le planificateur (pg_cron, toutes les 15 minutes) qui appelle
// send-push (action tick, version 34). Script absent : message clair ; fonction trop ancienne ou planificateur
// incomplet : avertissement, le reste de l'écran marche.
// Journal : schedule_create / schedule_edit / schedule_pause / schedule_resume / schedule_delete, rule_on / rule_off / rule_edit.
const NP_RULES = ["streak_danger", "goal_reminder", "inactive", "streak_milestone", "freeze_used", "friend_request", "share_invite",
  "duel_invite", "duel_result", "league_end"];   // étape 44 : duels et fin de ligue (script supabase-etape44.sql)
const NP_EVENT_RULES = ["streak_milestone", "freeze_used", "friend_request", "share_invite", "duel_invite", "duel_result"];
const NP_FRIEND_RULES = ["friend_request", "share_invite", "duel_invite", "duel_result", "league_end"];   // catégorie Amis
const NP_MILESTONES = [7, 30, 100, 365];

// Version de send-push (GET : { version }). 404 : fonction absente.
async function npVersion() {
  try {
    const r = await withTimeout(Supa.client().functions.invoke(PUSH_FN, { method: "GET" }), 15000);
    if (r && r.error) {
      const st = r.error.context && r.error.context.status;
      if (st === 404) { nps.fn = "missing"; npRerender(); }
      return;
    }
    nps.fnVersion = r && r.data && r.data.version ? String(r.data.version) : "";
    if (nps.tab === "scheduled" || nps.tab === "auto") npRerender();
  } catch (e) {}
}
async function npAutoLoad() {
  const a = nps.auto;
  if (a.loading) return;
  a.loading = true; a.err = "";
  npRerender();
  try {
    const [s, r, st] = await Promise.all([aqRpc("admin_push_schedules", {}), aqRpc("admin_push_rules", {}), aqRpc("admin_push_scheduler", {})]);
    a.schedules = arr(s); a.rules = arr(r); a.state = st || null; a.missing = false;
  } catch (e) {
    a.missing = alIsMissing(e);
    a.err = a.missing ? t("np.auto.missingSql") : npErr(e);
  }
  a.loading = false; a.loaded = true;
  npRerender();
}
function npHint(e) { return String((e && (e.hint || (e.details && e.hint))) || ""); }
function npSaveErr(e) {
  const h = npHint(e);
  if (h === "np_past") return t("np.sc.err.past");
  if (h === "np_tpl") return t("np.err.tplGone");
  if (h === "np_gone") return t("np.sc.err.gone");
  if (h === "np_text") return t("np.err.text");
  if (h === "np_name") return t("np.err.name");
  if (h === "np_bad") return t("np.sc.err.bad");
  return npErr(e);
}

// État du planificateur (les deux onglets).
function npSchedulerBox(root) {
  const st = nps.auto.state;
  const box = el("div", "card");
  box.appendChild(el("h3", "np-h3", t("np.auto.scheduler")));
  const warn = [];
  if (nps.fn === "missing") warn.push(t("np.fnMissing"));
  else if (nps.fnVersion && (parseInt(nps.fnVersion, 10) || 0) < 34) warn.push(t("np.auto.fnOld", { v: nps.fnVersion }));
  if (st) {
    if (!st.cron || !st.net) warn.push(t("np.auto.noExt"));
    else if (!st.job) warn.push(t("np.auto.noJob"));
    else if (st.job.active === false) warn.push(t("np.auto.jobOff"));
    if (!st.secret) warn.push(t("np.auto.noSecret"));
    const run = arr(st.runs)[0];
    if (run && run.status === "failed") warn.push(t("np.auto.runFail", { m: String(run.message || "").slice(0, 120) }));
  }
  const last = st && st.last_tick_at ? Date.parse(st.last_tick_at) : NaN;
  if (!isNaN(last) && Date.now() - last > 40 * 60000) warn.push(t("np.auto.late"));
  const tags = el("div", "adm-tags");
  tags.appendChild(el("span", "tag" + (warn.length ? " warn" : " ok"), warn.length ? t("np.auto.notReady") : t("np.auto.ready")));
  box.appendChild(tags);
  box.appendChild(el("p", "hint", isNaN(last) ? t("np.auto.noTick") : t("np.auto.lastTick", { t: alTime(st.last_tick_at) })));
  const errs = st && st.last_tick && arr(st.last_tick.errors);
  if (errs && errs.length) box.appendChild(el("p", "q-err", t("np.auto.tickErr", { e: errs.slice(0, 2).join(" · ").slice(0, 240) })));
  warn.forEach(w => box.appendChild(el("p", "np-msg", w)));
  root.appendChild(box);
}
function npAutoHead(root) {
  const a = nps.auto;
  if (!a.loaded) { if (!a.loading) npAutoLoad(); root.appendChild(el("div", "empty", t("admin.loading"))); return false; }
  if (a.err) { root.appendChild(el("div", "card q-err", a.err)); if (a.missing) return false; }
  npSchedulerBox(root);
  return true;
}

// --- Textes : jours, dates, répétition ---
function npWd(n) { return t("np.wd." + n); }
function npDateText(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd || "");
  if (!m) return "—";
  try { return new Date(+m[1], +m[2] - 1, +m[3], 12).toLocaleDateString(state.settings.uiLang, { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" }); }
  catch (e) { return ymd; }
}
function npRecurText(s) {
  const h = String(s.send_time || "").slice(0, 5);
  let r;
  if (s.repeat === "daily") r = t("np.sc.r.daily", { h });
  else if (s.repeat === "weekly") r = t("np.sc.r.weekly", { d: arr(s.weekdays).map(npWd).join(", "), h });
  else if (s.repeat === "monthly") r = t("np.sc.r.monthly", { n: s.month_day || "?", h });
  else r = t("np.sc.r.once", { d: npDateText(s.start_date), h });
  return r + " · " + (s.tz_mode === "local" ? t("np.sc.tzLocal") : t("np.sc.tzAdmin", { z: s.tz || "UTC" }));
}
// Prochain envoi : heure de l'admin (dans le fuseau choisi) ou heure locale de chaque compte.
function npNextText(s) {
  if (!s.next_date) return "—";
  if (s.tz_mode === "local") return t("np.sc.nextLocal", { d: npDateText(s.next_date), h: String(s.send_time || "").slice(0, 5) });
  let txt = "";
  try {
    txt = new Date(s.next_run_at).toLocaleString(state.settings.uiLang, { timeZone: s.tz || undefined, weekday: "short",
      day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch (e) { txt = alTime(s.next_run_at); }
  return s.tz && s.tz !== dashTz() ? txt + " (" + s.tz + ")" : txt;
}
function npSchedMsgName(s) {
  if (s.template_id) {
    const tp = arr(nps.templates).find(x => x.id === s.template_id);
    return tp ? npTplName(tp) : (s.template_name || "?");
  }
  return npCampaignTitle(s);
}

// --- Onglet Programmées ---
function npScheduledTab(root) {
  if (!npAutoHead(root)) return;
  const add = el("button", "btn primary", t("np.sc.new"));
  add.type = "button"; add.addEventListener("click", () => npEditSchedule(null));
  root.appendChild(add);
  root.appendChild(el("p", "hint", t("np.sc.note")));
  const list = arr(nps.auto.schedules);
  if (!list.length) { root.appendChild(el("div", "empty", t("np.sc.none"))); return; }
  list.forEach(s => {
    const c = el("div", "card np-item");
    const head = el("div", "an-head");
    const stCls = s.status === "active" ? " ok" : s.status === "paused" ? " warn" : " muted";
    head.append(el("div", "an-t", s.name), el("span", "tag" + stCls, t("np.sc.st." + s.status)));
    c.appendChild(head);
    c.appendChild(el("div", "an-prev", npSchedMsgName(s) + " · " + t("np.cat." + (s.template_category || s.category))));
    c.appendChild(el("div", "an-meta", npRecurText(s)));
    c.appendChild(el("div", "an-meta", t("np.target") + " : " + (s.segment_name || npFilterText(s.filter))));
    if (s.status === "active") c.appendChild(el("div", "np-next", t("np.sc.next", { d: npNextText(s) })));
    else if (s.status === "paused") c.appendChild(el("div", "an-meta", t("np.sc.pausedNote")));
    if (s.last_run_at) c.appendChild(el("div", "an-meta", t("np.sc.last", { d: alTime(s.last_run_at), n: num(Number(s.run_count), 0) })));
    if (s.template_missing) c.appendChild(el("p", "q-err", t("np.r.template_missing")));
    const acts = el("div", "an-acts");
    const btn = (lab, cls, on) => { const b = el("button", "btn" + (cls ? " " + cls : ""), lab); b.type = "button"; b.addEventListener("click", on); acts.appendChild(b); };
    if (s.status === "active") btn(t("np.sc.pause"), "", () => npSchedStatus(s, false));
    else if (s.status === "paused") btn(t("np.sc.resume"), "primary", () => npSchedStatus(s, true));
    btn(t("an.edit"), "", () => npEditSchedule(s));
    btn(t("delete"), "danger", () => npDeleteSchedule(s));
    c.appendChild(acts);
    root.appendChild(c);
  });
}
async function npSchedStatus(s, on) {
  try {
    await aqRpc("admin_push_schedule_status", { p_id: s.id, p_active: on });
    npLog(on ? "schedule_resume" : "schedule_pause", { name: String(s.name).slice(0, 60) });
    toast(t(on ? "np.sc.resumed" : "np.sc.paused"));
  } catch (e) { toast(npSaveErr(e)); }
  nps.auto.loaded = false; npAutoLoad();
}
function npDeleteSchedule(s) {
  openModal(t("delete"), el("p", null, t("np.sc.delConfirm", { n: s.name })), [
    { label: t("cancel") },
    { label: t("delete"), kind: "danger", onClick: async () => {
      try {
        await aqRpc("admin_push_schedule_delete", { p_id: s.id });
        npLog("schedule_delete", { name: String(s.name).slice(0, 60) });
      } catch (e) { toast(npSaveErr(e)); }
      nps.auto.loaded = false; npAutoLoad();
    } }
  ]);
}
// Heure par défaut d'un nouvel envoi : dans une heure, arrondie au quart d'heure.
function npDefaultWhen() {
  const d = new Date(Date.now() + 60 * 60000);
  d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15, 0, 0);
  return { date: todayStr(d), time: String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0") };
}
function npEditSchedule(s) {
  const w = npDefaultWhen();
  const segs = arr(nps.segments);
  const allSeg = segs.find(x => x.builtin === "all");
  const f = {
    name: s ? s.name : "",
    src: s && !s.template_id ? "text" : "tpl",
    tplId: s && s.template_id ? s.template_id : (arr(nps.templates)[0] || {}).id || "",
    text: { title: Object.assign({}, s && !s.template_id ? s.title : {}), body: Object.assign({}, s && !s.template_id ? s.body : {}) },
    category: s ? s.category : "announcements", screen: s ? s.screen : "home", image: s && s.image ? s.image : "",
    seg: s ? (s.segment_id && segs.some(x => x.id === s.segment_id) ? s.segment_id : arr(s.filter && s.filter.users).length ? "__users" : "__custom")
           : (allSeg ? allSeg.id : "__custom"),
    users: s ? arr(s.filter && s.filter.users).slice() : [],
    filter: Object.assign({}, s ? s.filter : {}),
    tz_mode: s ? s.tz_mode : "admin",
    start_date: s ? s.start_date : w.date, send_time: s ? String(s.send_time).slice(0, 5) : w.time,
    repeat: s ? s.repeat : "once",
    weekdays: new Set(arr(s && s.weekdays).map(Number)),
    month_day: s && s.month_day ? s.month_day : null
  };
  delete f.filter.users;
  const box = el("div", "np-edit");
  const name = textInput(f.name, t("np.f.name"));
  name.maxLength = 120;
  name.addEventListener("input", () => { f.name = name.value; });
  box.appendChild(formField(t("np.f.name"), name, true));

  // Message : modèle ou texte
  box.appendChild(el("h4", "fc-h4", t("np.message")));
  const srcSeg = el("div", "seg");
  const msgBox = el("div");
  const drawMsg = () => {
    srcSeg.querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.k === f.src)));
    msgBox.textContent = "";
    if (f.src === "tpl") {
      const tps = arr(nps.templates);
      if (!tps.length) { msgBox.appendChild(el("p", "muted", t("np.noTpl"))); return; }
      msgBox.appendChild(formField(t("np.tpl"), npSelect(tps.map(tp => [tp.id, npTplName(tp)]), f.tplId, v => { f.tplId = v; })));
    } else {
      const row = el("div", "aq-filters");
      const cell = (lab, input) => { const x = el("label", "aq-f"); x.append(el("span", null, lab), input); row.appendChild(x); };
      cell(t("np.f.category"), npSelect(npCatOpts(), f.category, v => { f.category = v; }));
      cell(t("np.f.screen"), npSelect(npScreenOpts(), f.screen, v => { f.screen = v; }));
      msgBox.appendChild(row);
      msgBox.appendChild(npTextEditor(f.text, null));
      const img = textInput(f.image, "https://…");
      img.addEventListener("input", () => { f.image = img.value.trim(); });
      msgBox.appendChild(formField(t("np.f.image"), img, false, t("np.f.imageHint")));
    }
  };
  [["tpl", "np.fromTpl"], ["text", "np.fromText"]].forEach(([k, lab]) => {
    const b = el("button", null, t(lab)); b.type = "button"; b.dataset.k = k;
    b.addEventListener("click", () => { f.src = k; drawMsg(); });
    srcSeg.appendChild(b);
  });
  box.append(srcSeg, msgBox);
  drawMsg();

  // Ciblage (recalculé à chaque envoi)
  box.appendChild(el("h4", "fc-h4", t("np.target")));
  const tgBox = el("div");
  const drawTarget = () => {
    tgBox.textContent = "";
    const opts = segs.map(x => [x.id, npSegName(x)]).concat([["__users", t("np.pickUsers")], ["__custom", t("np.custom")]]);
    tgBox.appendChild(npSelect(opts, f.seg, v => { f.seg = v; drawTarget(); }));
    const sg = segs.find(x => x.id === f.seg);
    if (sg) tgBox.appendChild(el("p", "hint", npFilterText(sg.filter)));
    if (f.seg === "__users") {
      const b = el("button", "btn", t("np.pickBtn", { n: f.users.length }));
      b.type = "button"; b.addEventListener("click", () => npPickAccounts(f.users, u => { f.users = u; drawTarget(); }));
      tgBox.appendChild(b);
    }
    if (f.seg === "__custom") tgBox.appendChild(npFilterEditor(f.filter, null));
  };
  box.appendChild(tgBox);
  drawTarget();

  // Quand
  box.appendChild(el("h4", "fc-h4", t("np.sc.when")));
  const when = el("div", "aq-filters");
  const cell = (lab, input) => { const x = el("label", "aq-f"); x.append(el("span", null, lab), input); when.appendChild(x); return x; };
  const di = el("input", "input"); di.type = "date"; di.value = f.start_date || "";
  di.addEventListener("change", () => { f.start_date = di.value; });
  const ti = el("input", "input"); ti.type = "time"; ti.step = 60; ti.value = f.send_time || "";
  ti.addEventListener("change", () => { f.send_time = ti.value.slice(0, 5); });
  const dCell = cell(t("np.sc.date"), di);
  cell(t("np.sc.time"), ti);
  cell(t("np.sc.repeat"), npSelect([["once", t("np.sc.rep.once")], ["daily", t("np.sc.rep.daily")], ["weekly", t("np.sc.rep.weekly")],
    ["monthly", t("np.sc.rep.monthly")]], f.repeat, v => { f.repeat = v; drawRepeat(); }));
  box.appendChild(when);
  const tzSeg = el("div", "seg");
  const drawTz = () => tzSeg.querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.k === f.tz_mode)));
  [["admin", t("np.sc.tzMine", { z: dashTz() })], ["local", t("np.sc.tzLocal")]].forEach(([k, lab]) => {
    const b = el("button", null, lab); b.type = "button"; b.dataset.k = k;
    b.addEventListener("click", () => { f.tz_mode = k; drawTz(); });
    tzSeg.appendChild(b);
  });
  box.appendChild(tzSeg);
  drawTz();
  const rep = el("div", "np-rep");
  const drawRepeat = () => {
    rep.textContent = "";
    dCell.querySelector("span").textContent = t(f.repeat === "once" ? "np.sc.date" : "np.sc.from");
    if (f.repeat === "weekly") {
      if (!f.weekdays.size && f.start_date) { const d = new Date(f.start_date + "T12:00:00"); if (!isNaN(d)) f.weekdays.add(((d.getDay() + 6) % 7) + 1); }
      rep.appendChild(el("span", "hint", t("np.sc.days")));
      const days = el("div", "seg np-days");
      [1, 2, 3, 4, 5, 6, 7].forEach(n => {
        const b = el("button", null, npWd(n)); b.type = "button"; b.setAttribute("aria-pressed", String(f.weekdays.has(n)));
        b.addEventListener("click", () => { if (f.weekdays.has(n)) f.weekdays.delete(n); else f.weekdays.add(n); b.setAttribute("aria-pressed", String(f.weekdays.has(n))); });
        days.appendChild(b);
      });
      rep.appendChild(days);
    } else if (f.repeat === "monthly") {
      if (!f.month_day && f.start_date) f.month_day = Number(f.start_date.slice(8, 10)) || 1;
      const mi = el("input", "input"); mi.type = "number"; mi.min = "1"; mi.max = "31"; mi.inputMode = "numeric"; mi.value = String(f.month_day || 1);
      mi.addEventListener("change", () => { f.month_day = clampInt(mi.value, 1, 31, 1); mi.value = String(f.month_day); });
      rep.appendChild(formField(t("np.sc.monthDay"), mi, false, t("np.sc.monthHint")));
    }
  };
  box.appendChild(rep);
  drawRepeat();
  box.appendChild(el("p", "hint", t("np.sc.limitNote")));

  const close = openModal(t(s ? "np.sc.edit" : "np.sc.new"), box, [
    { label: t("cancel") },
    { label: t("save"), kind: "primary", onClick: () => {
      if (!String(f.name).trim()) { toast(t("np.err.name")); return false; }
      if (f.src === "tpl" && !f.tplId) { toast(t("np.err.tplGone")); return false; }
      if (f.src === "text" && !npLangsOf(f.text).length) { toast(t("np.err.text")); return false; }
      if (f.src === "text" && f.image && !/^https:\/\/\S+$/.test(f.image)) { toast(t("np.err.image")); return false; }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(f.start_date || "") || !/^\d{2}:\d{2}$/.test(f.send_time || "")) { toast(t("np.sc.err.bad")); return false; }
      if (f.repeat === "weekly" && !f.weekdays.size) { toast(t("np.sc.err.days")); return false; }
      if (f.seg === "__users" && !f.users.length) { toast(t("np.sc.err.users")); return false; }
      npSaveSchedule(s, f).then(ok => { if (ok) close(); });
      return false;
    } }
  ]);
}
async function npSaveSchedule(s, f) {
  const segs = arr(nps.segments), sg = segs.find(x => x.id === f.seg);
  const clean = o => { const r = {}; AN_LANGS.forEach(l => { const v = String((o || {})[l] || "").trim(); if (v) r[l] = v; }); return r; };
  const filter = f.seg === "__users" ? { users: f.users.slice(0, 5000) } : sg ? npCleanFilter(Object.assign({}, sg.filter)) : npCleanFilter(f.filter);
  const p = {
    name: String(f.name).trim().slice(0, 120),
    template_id: f.src === "tpl" ? f.tplId : null,
    title: f.src === "text" ? clean(f.text.title) : {}, body: f.src === "text" ? clean(f.text.body) : {},
    category: f.category, screen: f.screen, image: f.src === "text" ? (f.image || null) : null,
    segment_id: sg ? sg.id : null,
    segment_name: sg ? npSegName(sg) : f.seg === "__users" ? t("np.pickUsers") + " (" + f.users.length + ")" : t("np.custom") + " : " + npFilterText(f.filter),
    filter, tz_mode: f.tz_mode, tz: dashTz(), start_date: f.start_date, send_time: f.send_time, repeat: f.repeat,
    weekdays: [...f.weekdays].sort(), month_day: f.repeat === "monthly" ? f.month_day : null
  };
  try {
    const r = await aqRpc("admin_push_schedule_save", { p_id: s ? s.id : null, p });
    npLog(s ? "schedule_edit" : "schedule_create", { name: p.name.slice(0, 60), segment: String(p.segment_name).slice(0, 60) });
    toast(t("np.sc.saved", { d: r ? npNextText(r) : "—" }));
    nps.auto.loaded = false; npAutoLoad();
    return true;
  } catch (e) { toast(npSaveErr(e)); return false; }
}

// --- Onglet Automatiques ---
function npAutoTab(root) {
  if (!npAutoHead(root)) return;
  const info = el("div", "card");
  info.append(el("h3", "np-h3", t("np.ru.limitsTitle")), el("p", "hint", t("np.ru.limits")));
  root.appendChild(info);
  const byKey = {};
  arr(nps.auto.rules).forEach(r => { byKey[r.key] = r; });
  NP_RULES.forEach(k => { if (byKey[k]) root.appendChild(npRuleCard(byKey[k])); });
}
function npRuleCard(r) {
  const ev = NP_EVENT_RULES.includes(r.key);
  const f = { active: !!r.active, template_id: r.template_id || "", send_time: r.send_time || "", settings: Object.assign({}, r.settings || {}) };
  if (r.key === "streak_milestone" && !Array.isArray(f.settings.milestones)) f.settings.milestones = NP_MILESTONES.slice();
  if (r.key === "streak_danger" && f.settings.streak_min == null) f.settings.streak_min = 3;
  if (r.key === "inactive" && f.settings.days == null) f.settings.days = 7;
  const c = el("div", "card np-item");
  const head = el("div", "an-head");
  head.appendChild(el("div", "an-t", t("np.rule." + r.key)));
  const sw = el("button", "au-switch am-switch");
  sw.type = "button"; sw.setAttribute("role", "switch"); sw.setAttribute("aria-checked", String(f.active));
  sw.setAttribute("aria-label", t("np.ru.active"));
  const track = el("span", "au-track"); track.appendChild(el("span", "au-knob"));
  sw.append(el("span", "au-lbl", t(f.active ? "np.ru.on" : "np.ru.off")), track);
  sw.addEventListener("click", () => {
    f.active = !f.active;
    sw.setAttribute("aria-checked", String(f.active));
    sw.querySelector(".au-lbl").textContent = t(f.active ? "np.ru.on" : "np.ru.off");
    npSaveRule(r, f, f.active ? "rule_on" : "rule_off");
  });
  head.appendChild(sw);
  c.appendChild(head);
  c.appendChild(el("p", "hint", t("np.rule." + r.key + ".d")));
  const tags = el("div", "adm-tags");
  const cat = NP_FRIEND_RULES.includes(r.key) ? "friends" : (r.template_category || "");
  if (cat) tags.appendChild(el("span", "tag", t("np.cat." + cat)));
  if (cat === "friends") tags.appendChild(el("span", "tag ok", t("np.ru.noLimit")));
  c.appendChild(tags);
  const grid = el("div", "aq-filters");
  const cell = (lab, input) => { const x = el("label", "aq-f"); x.append(el("span", null, lab), input); grid.appendChild(x); };
  const tps = arr(nps.templates);
  cell(t("np.tpl"), npSelect([["", "—"]].concat(tps.map(tp => [tp.id, npTplName(tp)])), f.template_id, v => { f.template_id = v; }));
  const ti = el("input", "input"); ti.type = "time"; ti.step = 60; ti.value = f.send_time;
  ti.addEventListener("change", () => { f.send_time = ti.value.slice(0, 5); });
  cell(ev ? t("np.ru.timeEv") : t("np.ru.time"), ti);
  if (r.key === "streak_danger") cell(t("np.f.streakMin"), npNum(f.settings.streak_min, v => { f.settings.streak_min = v == null ? 3 : Math.max(1, v); }));
  if (r.key === "inactive") cell(t("np.ru.days"), npNum(f.settings.days, v => { f.settings.days = v == null ? 7 : Math.max(1, v); }));
  c.appendChild(grid);
  if (r.key === "streak_milestone") {
    c.appendChild(el("span", "hint", t("np.ru.milestones")));
    const ms = el("div", "seg np-days");
    NP_MILESTONES.forEach(n => {
      const on = () => f.settings.milestones.map(Number).includes(n);
      const b = el("button", null, badgeIcon(n) + " " + n); b.type = "button"; b.setAttribute("aria-pressed", String(on()));
      b.addEventListener("click", () => {
        f.settings.milestones = on() ? f.settings.milestones.filter(x => Number(x) !== n) : f.settings.milestones.concat(n);
        b.setAttribute("aria-pressed", String(on()));
      });
      ms.appendChild(b);
    });
    c.appendChild(ms);
  }
  if (r.active && !r.template_id) c.appendChild(el("p", "q-err", t("np.r.template_missing")));
  if (ev) c.appendChild(el("p", "hint", t("np.ru.evHint")));
  const acts = el("div", "an-acts");
  const save = el("button", "btn primary", t("save"));
  save.type = "button"; save.addEventListener("click", () => npSaveRule(r, f, "rule_edit"));
  acts.appendChild(save);
  c.appendChild(acts);
  return c;
}
async function npSaveRule(r, f, action) {
  if (f.active && !f.template_id) { toast(t("np.ru.err.tpl")); nps.auto.loaded = false; npAutoLoad(); return; }
  if (!f.send_time && !NP_EVENT_RULES.includes(r.key)) { toast(t("np.ru.err.time")); return; }
  const p = { active: f.active, template_id: f.template_id || null, send_time: f.send_time || null, settings: f.settings };
  try {
    await aqRpc("admin_push_rule_save", { p_key: r.key, p });
    npLog(action, { name: t("np.rule." + r.key).slice(0, 60) });
    toast(t("np.saved"));
  } catch (e) { toast(npSaveErr(e)); }
  nps.auto.loaded = false; npAutoLoad();
}
