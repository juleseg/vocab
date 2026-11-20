"use strict";

// ====================================================================================================
// js/screens/admin-notif-auto.js — ENVOIS PROGRAMMÉS ET AUTOMATIQUES (2e morceau de l'ancien admin-notifications.js, étape 65)
// Onglets Programmées et Automatiques (étape 34 ; règles NP_RULES…). Chargé juste après js/screens/admin-notifications.js.
// ====================================================================================================

// === ENVOIS PROGRAMMÉS ET AUTOMATIQUES (ÉTAPE 34) ===
// Onglets Programmées et Automatiques. Données : admin_push_schedules / admin_push_rules / admin_push_scheduler
// (script supabase-etape34.sql) ; les envois partent par le planificateur (pg_cron, toutes les 15 minutes) qui appelle
// send-push (action tick, version 34). Script absent : message clair ; fonction trop ancienne ou planificateur
// incomplet : avertissement, le reste de l'écran marche.
// Journal : schedule_create / schedule_edit / schedule_pause / schedule_resume / schedule_delete, rule_on / rule_off / rule_edit.
const NP_RULES = ["streak_danger", "goal_reminder", "morning_recall", "inactive", "streak_milestone", "freeze_used", "friend_request", "share_invite",
  "duel_invite", "duel_result", "league_end", "idea_reply", "sentence_reply", "cheer", "team_message", "team_invite", "team_goal", "team_week"];   // étape 44 : duels et fin de ligue ; étape 52 : réponse à une idée ; étape 53 : messages ; étape 54 : équipes ; étape 61 : rappel du matin
const NP_EVENT_RULES = ["streak_milestone", "freeze_used", "friend_request", "share_invite", "duel_invite", "duel_result", "idea_reply", "sentence_reply", "cheer", "team_message", "team_invite", "team_goal"];
const NP_USER_TIME_RULES = ["morning_recall"];   // étape 61 : heure choisie par chaque compte (Réglages), pas d'heure ici
const NP_FRIEND_RULES = ["friend_request", "share_invite", "duel_invite", "duel_result", "league_end", "cheer", "team_invite", "team_goal", "team_week"];   // catégorie Amis (cheer : étape 53 ; équipes : étape 54)
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
  if (NP_USER_TIME_RULES.includes(r.key)) {   // étape 61 : rappel du matin, à l'heure de chaque compte
    f.send_time = "";
    cell(t("np.ru.time"), el("span", "hint", t("np.ru.userTime")));
  } else {
    const ti = el("input", "input"); ti.type = "time"; ti.step = 60; ti.value = f.send_time;
    ti.addEventListener("change", () => { f.send_time = ti.value.slice(0, 5); });
    cell(ev ? t("np.ru.timeEv") : t("np.ru.time"), ti);
  }
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
  if (!f.send_time && !NP_EVENT_RULES.includes(r.key) && !NP_USER_TIME_RULES.includes(r.key)) { toast(t("np.ru.err.time")); return; }
  const p = { active: f.active, template_id: f.template_id || null, send_time: f.send_time || null, settings: f.settings };
  try {
    await aqRpc("admin_push_rule_save", { p_key: r.key, p });
    npLog(action, { name: t("np.rule." + r.key).slice(0, 60) });
    toast(t("np.saved"));
  } catch (e) { toast(npSaveErr(e)); }
  nps.auto.loaded = false; npAutoLoad();
}
