"use strict";

// === ADMINISTRATION : INVITER À ACTIVER LES NOTIFICATIONS (ÉTAPE 38) ===
// Onglet « Inviter à activer » de Administration → Notifications (renderAdminPush, js/screens/admin-notifications.js).
// - Ciblage : mêmes ciblages et filtres que les notifications (ciblages enregistrés, comptes choisis, filtres).
// - Nombres avant envoi (admin_invite_target) : comptes concernés (sans notifications actives sur au moins un appareil),
//   dont sans aucun appareil abonné / avec un appareil abonné et un autre non, appareils connus sans notifications.
// - Texte par défaut dans les 3 langues (clés ni.def.* de chaque fichier de langue), modifiable ; durée d'affichage.
// - Envoi (admin_invite_send) : la fenêtre s'affiche au prochain lancement sur chaque appareil concerné non abonné,
//   une seule fois (js/notif-invite.js). Ce n'est pas une notification push.
// - Suivi (admin_invite_list, admin_invite_detail) : affichées, activées, plus tard, refusées, à installer ; arrêter
//   (admin_invite_stop) ; export CSV (admin_invite_export).
// - Journal : admin_push, action invite_send / invite_stop.
// Script SQL absent : « Lancez le script SQL de l'étape 38 » ; le reste de l'écran Notifications marche.
const NI_PAGE = 20;
const nvi = {
  started: false, missing: false, seg: "", users: [], filter: {}, calc: null, calcBusy: false, calcErr: "", calcKey: "",
  text: null, days: 30, busy: false, list: null, listErr: "", listLoading: false, page: 0
};
function niRerender() { if (currentScreen === "adminpush" && nps.tab === "invite") renderAdminPush(); }
function niErr(e) { if (alIsMissing(e)) { nvi.missing = true; return t("ni.missing"); } return aqErrText(e); }
function niDefaultText() {
  const title = {}, body = {};
  AN_LANGS.forEach(l => { const d = I18N[l] || {}; title[l] = d["ni.def.title"] || ""; body[l] = d["ni.def.body"] || ""; });
  return { title, body };
}
function niCurrentFilter() {
  if (nvi.seg === "__users") return { users: nvi.users.slice() };
  if (nvi.seg === "__custom") return npCleanFilter(nvi.filter);
  const sg = arr(nps.segments).find(x => x.id === nvi.seg);
  return sg ? npCleanFilter(Object.assign({}, sg.filter)) : {};
}
function niSegmentName() {
  const sg = arr(nps.segments).find(x => x.id === nvi.seg);
  if (sg) return npSegName(sg);
  if (nvi.seg === "__users") return t("np.pickUsers") + " (" + nvi.users.length + ")";
  return t("np.custom") + " : " + npFilterText(nvi.filter);
}
function niTitleOf(x) {
  const tx = Ann.texts({ title: x.title || {}, body: x.body || {} }, state.settings.uiLang);
  return tx ? (tx.title || tx.body).slice(0, 80) : "—";
}
let niCalcT = null;
function niCalcSoon() { clearTimeout(niCalcT); niCalcT = setTimeout(niCalc, 400); }
async function niCalc() {
  if (nvi.seg === "__users" && !nvi.users.length) {
    nvi.calc = { targeted: 0, accounts: 0, accounts_none: 0, accounts_partial: 0, devices: 0, sample: [] }; niRerender(); return;
  }
  const f = niCurrentFilter(), key = JSON.stringify(f);
  nvi.calcKey = key; nvi.calcBusy = true; nvi.calcErr = "";
  niRerender();
  try {
    const r = await aqRpc("admin_invite_target", { p_filter: f });
    if (nvi.calcKey !== key) return;
    nvi.calc = r || null; nvi.missing = false;
  } catch (e) { if (nvi.calcKey === key) { nvi.calc = null; nvi.calcErr = niErr(e); } }
  nvi.calcBusy = false;
  niRerender();
}
async function niLoadList() {
  nvi.listLoading = true; nvi.listErr = "";
  niRerender();
  try {
    const r = await aqRpc("admin_invite_list", { p_limit: NI_PAGE, p_offset: nvi.page * NI_PAGE });
    nvi.list = { total: num(Number(r && r.total), 0), rows: arr(r && r.rows) };
  } catch (e) { nvi.list = null; nvi.listErr = niErr(e); }
  nvi.listLoading = false;
  niRerender();
}
function niStart() {
  nvi.started = true;
  nvi.text = niDefaultText();
  if (!nvi.seg) { const all = arr(nps.segments).find(s => s.builtin === "all"); nvi.seg = all ? all.id : "__custom"; }
  niCalc();
  niLoadList();
}

// Champs titre / message par langue (sans variables : la fenêtre ne remplace rien).
function niTextEditor(tx) {
  const wrap = el("div", "np-texts");
  AN_LANGS.forEach(l => {
    const box = el("div", "np-lang");
    box.appendChild(el("div", "np-lang-h", langName(l, l) + " (" + l.toUpperCase() + ")"));
    const ti = textInput(tx.title[l] || "", t("np.f.title"), l);
    ti.maxLength = 120;
    const bo = el("textarea", "input"); bo.rows = 3; bo.maxLength = 600; bo.lang = l; bo.placeholder = t("np.f.body"); bo.value = tx.body[l] || "";
    ti.addEventListener("input", () => { tx.title[l] = ti.value; });
    bo.addEventListener("input", () => { tx.body[l] = bo.value; });
    box.append(ti, bo);
    wrap.appendChild(box);
  });
  return wrap;
}

function npInviteTab(root) {
  if (!nvi.started) niStart();
  root.appendChild(el("p", "hint ni-intro", t("ni.adm.intro")));
  if (nvi.missing) { root.appendChild(el("div", "card np-msg", t("ni.missing"))); return; }
  // Ciblage
  const c1 = el("div", "card");
  c1.appendChild(el("h3", "np-h3", t("np.target")));
  const segOpts = arr(nps.segments).map(x => [x.id, npSegName(x)]).concat([["__users", t("np.pickUsers")], ["__custom", t("np.custom")]]);
  c1.appendChild(npSelect(segOpts, nvi.seg, v => {
    nvi.seg = v;
    if (v === "__users" && !nvi.users.length) npPickAccounts(nvi.users, u => { nvi.users = u; niCalc(); });
    niCalc();
  }));
  const sg = arr(nps.segments).find(x => x.id === nvi.seg);
  if (sg) c1.appendChild(el("p", "hint", npFilterText(sg.filter)));
  if (nvi.seg === "__users") {
    const b = el("button", "btn", t("np.pickBtn", { n: nvi.users.length }));
    b.type = "button"; b.addEventListener("click", () => npPickAccounts(nvi.users, u => { nvi.users = u; niCalc(); }));
    c1.appendChild(b);
  }
  if (nvi.seg === "__custom") c1.appendChild(npFilterEditor(nvi.filter, niCalcSoon));
  c1.appendChild(el("p", "hint", t("ni.adm.scope")));
  // Nombres concernés
  const nums = el("div", "np-nums");
  if (nvi.calcBusy && !nvi.calc) nums.appendChild(el("span", "muted", t("admin.loading")));
  else if (nvi.calcErr) nums.appendChild(el("span", "q-err", nvi.calcErr));
  else if (nvi.calc) {
    const k = (lab, v, cls) => { const d = el("div", "np-num" + (cls ? " " + cls : "")); d.append(el("b", null, dashFmt(v)), el("span", null, lab)); nums.appendChild(d); };
    k(t("ni.adm.accounts"), nvi.calc.accounts, "ok");
    k(t("ni.adm.none"), nvi.calc.accounts_none);
    k(t("ni.adm.partial"), nvi.calc.accounts_partial);
    k(t("ni.adm.devices"), nvi.calc.devices, "ok");
  }
  c1.appendChild(nums);
  if (nvi.calc && arr(nvi.calc.sample).length) {
    c1.appendChild(el("p", "hint ni-sample", t("ni.adm.sample") + " " + arr(nvi.calc.sample).map(x =>
      x.identifiant + " (" + num(Number(x.free), 0) + "/" + num(Number(x.devices), 0) + ")").join(", ")));
  }
  c1.appendChild(el("p", "hint", t("ni.adm.devHint")));
  root.appendChild(c1);
  // Texte
  const c2 = el("div", "card");
  c2.appendChild(el("h3", "np-h3", t("ni.adm.text")));
  c2.appendChild(el("p", "hint", t("ni.adm.textHint")));
  c2.appendChild(niTextEditor(nvi.text));
  const reset = el("button", "link-btn", t("ni.adm.default"));
  reset.type = "button";
  reset.addEventListener("click", () => { nvi.text = niDefaultText(); niRerender(); });
  c2.appendChild(reset);
  c2.appendChild(formField(t("ni.adm.days"), npSelect([7, 14, 30, 60, 90].map(d => [String(d), t("ni.adm.daysN", { n: d })]), String(nvi.days),
    v => { nvi.days = clampInt(v, 1, 90, 30); })));
  root.appendChild(c2);
  const go = el("button", "btn primary", nvi.busy ? t("np.sending") : t("ni.adm.send"));
  go.type = "button";
  go.disabled = nvi.busy || !nvi.calc || !num(Number(nvi.calc.accounts), 0);
  go.addEventListener("click", niSend);
  root.appendChild(go);
  // Suivi
  niTrack(root);
}

async function niSend() {
  const c = nvi.calc || {};
  const tx = { title: Object.assign({}, nvi.text.title), body: Object.assign({}, nvi.text.body) };
  if (!AN_LANGS.some(l => String(tx.title[l] || "").trim() || String(tx.body[l] || "").trim())) { toast(t("np.err.text")); return; }
  const seg = niSegmentName(), filter = niCurrentFilter();
  openModal(t("ni.adm.confirmTitle"), el("p", null, t("ni.adm.confirm", { n: num(Number(c.accounts), 0), d: num(Number(c.devices), 0), j: nvi.days })), [
    { label: t("cancel") },
    { label: t("ni.adm.send"), kind: "primary", onClick: () => {
      (async () => {
        nvi.busy = true; niRerender();
        try {
          const r = await aqRpc("admin_invite_send", { p_title: tx.title, p_body: tx.body, p_filter: filter, p_segment_name: seg.slice(0, 200), p_days: nvi.days });
          npLog("invite_send", { segment: seg.slice(0, 60), accounts: num(Number(r && r.accounts), 0), devices: num(Number(r && r.devices), 0) });
          toast(t("ni.adm.sent", { n: num(Number(r && r.accounts), 0) }));
          nvi.page = 0;
          niLoadList();
        } catch (e) {
          const h = String((e && e.hint) || "");
          toast(h === "ni_empty" ? t("ni.adm.empty") : h === "ni_text" ? t("np.err.text") : niErr(e));
        }
        nvi.busy = false; niRerender(); niCalc();
      })();
    } }
  ]);
}

// --- Suivi ---
function niCounts(x) {
  return t("ni.adm.counts", { a: dashFmt(x.target_accounts), d: dashFmt(x.target_devices), s: dashFmt(x.shown), e: dashFmt(x.enabled),
    l: dashFmt(x.later), r: dashFmt(x.denied), i: dashFmt(x.install) });
}
function niTrack(root) {
  const head = el("div", "adm-top ni-track-h");
  head.appendChild(el("h3", "np-h3", t("ni.adm.track")));
  const acts = el("div", "an-acts");
  const ref = el("button", "link-btn", t("admin.refresh")), csv = el("button", "btn", t("dash.csv"));
  ref.type = csv.type = "button";
  ref.addEventListener("click", niLoadList);
  csv.addEventListener("click", () => niCsv(null, "invitations-notifications"));
  acts.append(ref, csv);
  head.appendChild(acts);
  root.appendChild(head);
  if (nvi.listLoading && !nvi.list) { root.appendChild(el("div", "empty", t("admin.loading"))); return; }
  if (nvi.listErr) { root.appendChild(el("div", "card q-err", nvi.listErr)); return; }
  if (!nvi.list || !nvi.list.total) { root.appendChild(el("div", "empty", t("ni.adm.none0"))); return; }
  const pages = Math.max(1, Math.ceil(nvi.list.total / NI_PAGE));
  nvi.list.rows.forEach(x => {
    const card = el("div", "card ni-row");
    const h = el("div", "al-head");
    h.append(el("span", "al-who", niTitleOf(x)), el("span", "al-time", alTime(x.created_at)));
    card.appendChild(h);
    const tags = el("div", "adm-tags");
    tags.appendChild(el("span", "tag" + (x.open ? " ok" : " muted"), x.open ? t("ni.adm.open", { d: alTime(x.ends_at) }) : t(x.active ? "ni.adm.ended" : "ni.adm.stopped")));
    if (x.segment_name) tags.appendChild(el("span", "tag", x.segment_name));
    card.appendChild(tags);
    card.appendChild(el("div", "np-hnums", niCounts(x)));
    if (num(Number(x.waiting), 0)) card.appendChild(el("div", "hint", t("ni.adm.waitingN", { n: num(Number(x.waiting), 0) })));
    const b = el("div", "an-acts");
    const det = el("button", "btn", t("ni.adm.detail"));
    det.type = "button"; det.dataset.modKeep = "1"; det.addEventListener("click", () => niDetail(x));   // étape 66 : « voir » gardé en lecture seule
    b.appendChild(det);
    if (x.open) {
      const stop = modGate(el("button", "btn danger", t("ni.adm.stop")), "notif.send");
      stop.type = "button"; stop.addEventListener("click", () => niStop(x));
      b.appendChild(stop);
    }
    card.appendChild(b);
    root.appendChild(card);
  });
  if (pages > 1) {
    const w = el("div", "pv-pager");
    const prev = el("button", "btn", "‹"), next = el("button", "btn", "›");
    prev.disabled = nvi.page <= 0; next.disabled = nvi.page >= pages - 1;
    prev.addEventListener("click", () => { nvi.page--; niLoadList(); });
    next.addEventListener("click", () => { nvi.page++; niLoadList(); });
    w.append(prev, el("span", null, t("pv.page", { i: nvi.page + 1, n: pages })), next);
    root.appendChild(w);
  }
}
function niStatusLabel(s) { return I18N.fr["ni.st." + s] ? t("ni.st." + s) : String(s || ""); }
function niDevLabel(d, id) { return d ? [t("al.dev." + (d.type || "desktop")), d.os, d.browser, d.installed ? t("al.installed") : t("al.browser")].filter(Boolean).join(" · ") : (id ? "?" : "—"); }
async function niDetail(x) {
  const wrap = el("div", "aq-detailbox");
  wrap.appendChild(el("p", "muted", t("admin.loading")));
  openModal(niTitleOf(x), wrap, [{ label: t("close") }]);
  let d;
  try { d = await aqRpc("admin_invite_detail", { p_id: x.id }); }
  catch (e) { wrap.textContent = ""; wrap.appendChild(el("p", "q-err", niErr(e))); return; }
  wrap.textContent = "";
  const inv = (d && d.invite) || x;
  wrap.appendChild(fcDl([
    [t("np.h.date"), alTime(inv.created_at)], [t("np.h.by"), x.created_by || "—"],
    [t("np.target"), (inv.segment_name || "—") + " · " + npFilterText(inv.filter)],
    [t("ni.adm.until"), alTime(inv.ends_at) + (inv.stopped_at ? " · " + t("ni.adm.stopped") + " " + alTime(inv.stopped_at) : "")]
  ]));
  wrap.appendChild(el("p", "np-hnums", niCounts(x)));
  const csv = el("button", "btn", t("dash.csv"));
  csv.type = "button";
  csv.addEventListener("click", () => niCsv(x.id, "invitation-" + String(x.id).slice(0, 8)));
  wrap.appendChild(csv);
  const devs = arr(d && d.devices);
  wrap.appendChild(el("h4", "fc-h4", t("ni.adm.devTitle", { n: devs.length })));
  if (!devs.length) wrap.appendChild(el("p", "muted", t("ni.adm.noDev")));
  else wrap.appendChild(fcTable([t("np.h.account"), t("np.h.device"), t("np.h.status"), t("ni.adm.shownAt"), t("ni.adm.answeredAt")],
    devs.map(y => [y.identifiant, niDevLabel(y.device, y.device_id), niStatusLabel(y.status), alTime(y.shown_at), y.answered_at ? alTime(y.answered_at) : "—"]), 9));
  const wait = arr(d && d.waiting);
  wrap.appendChild(el("h4", "fc-h4", t("ni.adm.waitTitle", { n: wait.length })));
  if (wait.length) wrap.appendChild(el("p", "hint", wait.map(y => y.identifiant + (num(Number(y.subs), 0) ? " (" + t("ni.adm.subsNow", { n: y.subs }) + ")" : "")).join(", ")));
}
function niStop(x) {
  openModal(t("ni.adm.stop"), el("p", null, t("ni.adm.stopAsk")), [
    { label: t("cancel") },
    { label: t("ni.adm.stop"), kind: "danger", perm: "notif.send", onClick: () => {   // étape 66 : case du modo
      (async () => {
        try { await aqRpc("admin_invite_stop", { p_id: x.id }); npLog("invite_stop", { title: niTitleOf(x).slice(0, 60) }); niLoadList(); }
        catch (e) { toast(niErr(e)); }
      })();
    } }
  ]);
}
async function niCsv(id, name) {
  try {
    const rows = arr(await aqRpc("admin_invite_export", { p_id: id || null }));
    const head = [t("np.h.date"), t("np.f.title"), t("np.target"), t("np.h.account"), t("np.h.device"), "device_id", t("np.h.status"),
      t("ni.adm.shownAt"), t("ni.adm.answeredAt")];
    dashSaveCsv(name, head, rows.map(r => [alTime(r.created_at), niTitleOf(r), r.segment_name || "", r.identifiant || "", niDevLabel(r.device, r.device_id),
      r.device_id || "", niStatusLabel(r.status), r.shown_at ? alTime(r.shown_at) : "", r.answered_at ? alTime(r.answered_at) : ""]));
  } catch (e) { toast(niErr(e)); }
}
