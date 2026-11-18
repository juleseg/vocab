"use strict";

// === ADMINISTRATION : VERSIONS (ÉTAPE 48) ===
// Onglet « Versions » de Administration → Notifications (renderAdminPush, js/screens/admin-notifications.js).
// - Cet appareil : APP_VERSION et DATA_VERSION. Dernière annonce : app_release_latest (via admin_release_devices.releases).
// - Appareils vus ces 30 derniers jours : à jour / en retard (référence = plus haute entre APP_VERSION de l'admin et la
//   dernière version annoncée), par version, comptes en retard (toucher = fiche du compte) — admin_release_devices.
// - « Annoncer la version N » (N = APP_VERSION de cet appareil, après la mise en ligne) : case « Mise à jour obligatoire »
//   (cochée d'office si DATA_VERSION > plus haut format déjà annoncé), aperçu ko / fr / en (titre « Nouvelle version N » +
//   points de CHANGELOG pour N), confirmation (comptes ciblés / joignables : admin_push_target, catégorie Annonces), puis
//   1) admin_release_announce (table app_release, journal admin_release côté serveur), 2) notification par l'envoi immédiat
//   de l'étape 32 (send-push, action send : texte par langue, catégorie announcements, écran home, filtre {} = tous les
//   comptes ; send-push inchangée), journal admin_push action release.
// - « Rendre obligatoire » la dernière annonce (admin_release_mandatory), sans nouvelle notification.
// Script SQL absent : « Lancez le script SQL de l'étape 48 ».
const rls = { started: false, loading: false, err: "", missing: false, data: null, calc: null, busy: false, mand: null, mandTouched: false };

function rlRerender() { if (currentScreen === "adminpush" && nps.tab === "versions") renderAdminPush(); }
function rlErrText(e) {
  const h = String((e && e.hint) || "");
  if (/^rel_/.test(h) && I18N.fr["rl.err." + h]) return t("rl.err." + h);
  return npErr(e);
}
function rlDate(s) { try { return s ? new Date(s).toLocaleDateString(state.settings.uiLang) : "—"; } catch (e) { return "—"; } }
function rlLatest() { const r = rls.data && arr(rls.data.releases)[0]; return r || null; }
function rlMaxData() { return arr(rls.data && rls.data.releases).reduce((m, r) => Math.max(m, num(Number(r.data_version), 0)), 0); }
function rlEntry() { return CHANGELOG.find(e => String(e.version) === String(APP_VERSION)) || null; }

// Texte de la notification pour une langue : titre « Nouvelle version N », message = points du changelog (400 caractères au plus).
function rlPushText(lang, entry) {
  const title = String((I18N[lang] && I18N[lang]["rl.push.title"]) || I18N.fr["rl.push.title"]).split("{n}").join(APP_VERSION);
  let body = "";
  arr(entry && entry.points && entry.points[lang]).forEach(p => {
    const line = "• " + String(p).trim();
    const next = body ? body + "\n" + line : line;
    if (next.length <= 400) body = next;
    else if (!body) body = line.slice(0, 399) + "…";
  });
  return { title, body };
}
function rlNotes(entry) {
  const o = {};
  AN_LANGS.forEach(l => { const p = arr(entry && entry.points && entry.points[l]).map(x => String(x).trim()).filter(Boolean); if (p.length) o[l] = p; });
  return o;
}

async function rlLoad() {
  rls.started = true; rls.loading = true; rls.err = "";
  rlRerender();
  try {
    rls.data = await aqRpc("admin_release_devices", { p_version: parseInt(APP_VERSION, 10), p_days: 30 });
    rls.missing = false;
  } catch (e) { rls.missing = alIsMissing(e); rls.err = rls.missing ? "" : rlErrText(e); }
  if (!rls.missing) {
    try { rls.calc = await aqRpc("admin_push_target", { p_filter: {}, p_category: "announcements" }); } catch (e) { rls.calc = null; }
  }
  if (!rls.mandTouched) rls.mand = null;
  rls.loading = false;
  rlRerender();
}

function npReleaseTab(root) {
  if (!rls.started) { rlLoad(); }
  root.appendChild(el("p", "hint", t("rl.tip")));
  if (rls.loading && !rls.data) { root.appendChild(el("div", "empty", t("admin.loading"))); return; }
  if (rls.missing) { root.appendChild(el("div", "card np-msg", t("rl.missing"))); return; }
  if (rls.err) root.appendChild(el("div", "card q-err", rls.err));
  if (!rls.data) return;
  const d = rls.data, last = rlLatest(), me = parseInt(APP_VERSION, 10);

  // --- État ---
  const c1 = el("div", "card rl-adm");
  c1.appendChild(el("h3", "np-h3", t("rl.tab")));
  const kv = (k, v, cls) => { const r = el("div", "rl-kv" + (cls ? " " + cls : "")); r.append(el("span", null, k), el("b", null, v)); c1.appendChild(r); };
  kv(t("rl.mine"), t("rl.mineVal", { v: APP_VERSION, d: DATA_VERSION }));
  kv(t("rl.last"), last ? t("rl.lastVal", { n: last.version, date: rlDate(last.announced_at) }) + " · " + t(last.mandatory ? "rl.isMand" : "rl.isOpt") : t("rl.none"));
  c1.appendChild(el("p", "hint rl-devh", t("rl.devices", { d: num(Number(d.days), 30), n: num(Number(d.target), me) })));
  const nums = el("div", "np-nums rl-nums");
  const k = (lab, v, cls) => { const x = el("div", "np-num" + (cls ? " " + cls : "")); x.append(el("b", null, dashFmt(v)), el("span", null, lab)); nums.appendChild(x); };
  k(t("rl.upToDate"), num(Number(d.up_to_date), 0), "ok");
  k(t("rl.late"), num(Number(d.late), 0), num(Number(d.late), 0) ? "rl-late" : "");
  c1.appendChild(nums);
  const bv = arr(d.by_version);
  if (bv.length) {
    c1.appendChild(el("div", "rl-sub", t("rl.byVersion")));
    const ul = el("div", "rl-vers-list");
    bv.forEach(x => {
      const v = num(Number(x.version), 0);
      const chip = el("span", "rl-chip" + (v >= num(Number(d.target), me) ? " ok" : ""), (v ? t("rl.vN", { v }) : t("rl.vUnknown")) + " · " + num(Number(x.devices), 0));
      ul.appendChild(chip);
    });
    c1.appendChild(ul);
  }
  if (num(Number(d.older), 0)) c1.appendChild(el("p", "hint", t("rl.older", { n: num(Number(d.older), 0), d: num(Number(d.days), 30) })));
  const la = arr(d.late_accounts), laTotal = num(Number(d.late_accounts_total), la.length);
  c1.appendChild(el("div", "rl-sub", t("rl.lateAccounts", { n: laTotal })));
  if (!la.length) c1.appendChild(el("p", "muted", t("rl.lateNone")));
  else {
    const list = el("div", "rl-late-list");
    la.forEach(a => {
      const b = el("button", "rl-acc");
      b.type = "button";
      const vs = arr(a.versions).map(v => num(Number(v), 0) ? t("rl.vN", { v }) : t("rl.vUnknown")).join(", ");
      b.append(el("b", null, String(a.identifiant || "?") + (a.blocked ? " (" + t("rl.blockedAcc") + ")" : "")),
        el("span", null, t("rl.lateLine", { v: vs, k: num(Number(a.devices), 0), date: rlDate(a.last_seen) })));
      b.addEventListener("click", () => openAccountFiche(a.user_id, "adminpush"));
      list.appendChild(b);
    });
    c1.appendChild(list);
    if (laTotal > la.length) c1.appendChild(el("p", "hint", t("rl.lateMore", { n: laTotal - la.length })));
  }
  root.appendChild(c1);

  // --- Annoncer la version N ---
  const c2 = el("div", "card");
  c2.appendChild(el("h3", "np-h3", t("rl.h.announce", { n: APP_VERSION })));
  const entry = rlEntry();
  const newer = last && num(Number(last.version), 0) > me;
  const again = last && num(Number(last.version), 0) === me;
  const maxData = rlMaxData();
  const auto = maxData > 0 && DATA_VERSION > maxData;
  if (rls.mand === null) rls.mand = auto;
  c2.appendChild(el("p", "hint", t("rl.annIntro", { n: APP_VERSION })));
  if (newer) c2.appendChild(el("div", "np-msg", t("rl.newer", { n: last.version })));
  else if (!entry) c2.appendChild(el("div", "np-msg", t("rl.noEntry", { n: APP_VERSION })));
  else {
    if (again) c2.appendChild(el("div", "np-msg", t("rl.already", { n: APP_VERSION, date: rlDate(last.announced_at) })));
    const lab = el("label", "rl-check");
    const cb = el("input");
    cb.type = "checkbox"; cb.id = "rlMandatory"; cb.checked = !!rls.mand;
    cb.addEventListener("change", () => { rls.mand = cb.checked; rls.mandTouched = true; });
    lab.append(cb, el("span", null, t("rl.mandatory")));
    c2.appendChild(lab);
    c2.appendChild(el("p", "hint", t("rl.mandatoryHint")));
    if (auto) c2.appendChild(el("p", "hint rl-auto", t("rl.mandatoryAuto", { a: maxData, b: DATA_VERSION })));
    // Aperçu dans les 3 langues
    c2.appendChild(el("div", "rl-sub", t("rl.preview")));
    const pv = el("div", "rl-pv");
    AN_LANGS.forEach(l => {
      const tx = rlPushText(l, entry);
      if (!tx.body) return;
      const b = el("div", "rl-pv-one");
      b.lang = l;
      b.append(el("div", "rl-pv-lang", l.toUpperCase()), el("div", "rl-pv-title", tx.title), el("div", "rl-pv-body", tx.body));
      pv.appendChild(b);
    });
    c2.appendChild(pv);
    const go = el("button", "btn primary", t(again ? "rl.againBtn" : "rl.announceBtn", { n: APP_VERSION }));
    go.type = "button"; go.id = "rlAnnounce";
    go.disabled = rls.busy || nps.fn === "missing";
    go.addEventListener("click", () => rlConfirm(entry));
    c2.appendChild(go);
    if (rls.busy) c2.appendChild(el("p", "muted", t("rl.busy")));
  }
  root.appendChild(c2);

  // --- Rendre obligatoire la dernière annonce ---
  if (last) {
    const c3 = el("div", "card");
    c3.appendChild(el("h3", "np-h3", t("rl.h.mand")));
    if (last.mandatory) c3.appendChild(el("p", "muted", t("rl.mandAlready", { n: last.version, date: rlDate(last.mandatory_at || last.announced_at) })));
    else {
      c3.appendChild(el("p", "hint", t("rl.mandIntro", { n: last.version })));
      const b = el("button", "btn", t("rl.mandBtn", { n: last.version }));
      b.type = "button"; b.id = "rlMakeMand";
      b.disabled = rls.busy;
      b.addEventListener("click", () => rlMakeMandatory(num(Number(last.version), 0)));
      c3.appendChild(b);
    }
    root.appendChild(c3);
  }
}

function rlConfirm(entry) {
  const c = rls.calc || {};
  const f = v => (c && v != null ? dashFmt(v) : "?");
  openModal(t("rl.confirmTitle", { n: APP_VERSION }),
    el("p", null, t("rl.confirm", { t: f(c.targeted), m: f(c.reachable), o: t(rls.mand ? "rl.yes" : "rl.no") })), [
      { label: t("cancel") },
      { label: t("rl.announce"), kind: "primary", onClick: () => { rlAnnounce(entry); } }
    ]);
}

async function rlAnnounce(entry) {
  if (rls.busy) return;
  const v = parseInt(APP_VERSION, 10), mand = !!rls.mand;
  rls.busy = true; rlRerender();
  // 1) Annonce en base
  try {
    await aqRpc("admin_release_announce", { p_version: v, p_data_version: DATA_VERSION, p_mandatory: mand, p_notes: rlNotes(entry) });
  } catch (e) {
    rls.busy = false; rlRerender();
    openModal(t("np.sendFail"), el("p", "q-err", rlErrText(e)), [{ label: t("close") }]);
    return;
  }
  // 2) Notification (envoi immédiat de l'étape 32, tous les comptes)
  const title = {}, body = {};
  AN_LANGS.forEach(l => { const tx = rlPushText(l, entry); if (tx.body) { title[l] = tx.title; body[l] = tx.body; } });
  const r = await npInvoke({ action: "send", campaign: {
    filter: {}, segment_id: null, segment_name: t("rl.segName", { n: APP_VERSION }),
    title, body, category: "announcements", screen: "home", image: null
  } });
  const dd = (r && r.data) || {};
  if (r.ok) npLog("release", { version: v, mandatory: mand, targeted: num(dd.targeted, 0), sent: num(dd.sent, 0),
    failed: num(dd.failed, 0), skipped: num(dd.skipped, 0), deferred: num(dd.deferred, 0) });
  rls.busy = false; rls.mandTouched = false; rls.mand = null;
  nps.hist.data = null;
  try { Release.check(true); } catch (e) {}
  rlLoad();
  const box = el("div");
  if (!r.ok) box.appendChild(el("p", "q-err", t("rl.pushFail", { e: r.err })));
  else {
    box.appendChild(el("p", null, t("np.result", { t: num(dd.targeted, 0), s: num(dd.sent, 0), f: num(dd.failed, 0), i: num(dd.skipped, 0), d: num(dd.deferred, 0) })));
    const why = npWhyLines(dd, false);
    if (why.length) {
      const w = el("div", num(dd.sent, 0) ? "np-why" : "np-msg np-why");
      w.appendChild(el("div", "np-why-h", t(num(dd.sent, 0) ? "np.why.partial" : "np.why.none")));
      why.forEach(x => w.appendChild(el("div", null, "• " + x)));
      box.appendChild(w);
    }
  }
  openModal(t("rl.doneTitle", { n: APP_VERSION }), box, [{ label: t("close"), kind: "primary" }]);
}

function rlMakeMandatory(v) {
  openModal(t("rl.h.mand"), el("p", null, t("rl.mandConfirm", { n: v })), [
    { label: t("cancel") },
    { label: t("rl.h.mand"), kind: "danger", onClick: async () => {
      rls.busy = true; rlRerender();
      try {
        await aqRpc("admin_release_mandatory", { p_version: v });
        toast(t("rl.mandDone", { n: v }));
      } catch (e) { toast(rlErrText(e)); }
      rls.busy = false;
      try { Release.check(true); } catch (e) {}
      rlLoad();
    } }
  ]);
}
