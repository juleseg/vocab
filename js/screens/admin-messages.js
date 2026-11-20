"use strict";

// === ADMINISTRATION : MESSAGES (ÉTAPE 53) ===
// Écran #admin-messages (screen-adminmsg, admin et mode Supabase). Script claude/supabase-etape53.sql ; textes amg.* dans
// js/i18n/messages-<langue>.js.
// - Onglet « Conversations » : une conversation par compte (non lues d'abord, badge), recherche, « non lues seulement »,
//   50 par page (admin_msg_threads) ; ouvrir une conversation (admin_msg_thread) marque ses messages comme lus ; réponse en
//   texte libre (500) ou message prédéfini ; « ✉️ Nouveau message » : un compte, plusieurs, tous, ou un ciblage enregistré
//   (mêmes ciblages que les notifications : notification_segments, filtres de push_users) avec le nombre de comptes visés
//   (admin_msg_target) et confirmation → admin_msg_send ; export CSV (admin_msg_export, « ; », BOM).
// - Onglet « Messages prédéfinis » : liste (3 langues, catégorie, envois), ajouter / modifier (admin_cheer_save),
//   activer / désactiver, monter / descendre (admin_cheer_order). Variables : {ami} {serie} {niveau}.
// - Tableau de bord : bouton « 💬 Messages (N) » et tuile « Messages non lus » (admin_msg_unread_count) ; fiche d'un compte :
//   bouton « 💬 Conversation » (amgOpenThread). Journal : admin_message (send, export), admin_cheer (create, edit, order),
//   écrits par le serveur.
const AMG_PAGE = 50;
const AMG_CATS = ["streak", "level", "badge", "goal", "duel", "back", "general", "thanks"];
const amg = {
  started: false, loading: false, err: "", missing: false, tab: "threads",
  data: null, page: 0, q: "", unreadOnly: false,
  thread: null, threadUser: null, threadLoading: false, threadErr: "", from: "admin", draft: "", busy: false,
  cheers: null, cheersErr: "", segs: null, unread: null, at: 0, lastErr: ""
};
function amgRerender() { if (currentScreen === "adminmsg") renderAdminMessages(); }
function amgErrText(e) {
  const h = String((e && e.hint) || "");
  if (h && I18N.fr["mg.err." + h]) return t("mg.err." + h);
  if (Messages.isMissing(e)) return t("amg.missing");
  return aqErrText(e);
}
// Compteur du tableau de bord (null = script absent : rien d'affiché).
async function amgLoadUnread() {
  try { amg.unread = num(Number(await aqRpc("admin_msg_unread_count")), 0); } catch (e) { amg.unread = null; }
  return amg.unread;
}
async function amgLoad() {
  amg.started = true; amg.loading = true; amg.err = "";
  amgRerender();
  try {
    const r = await aqRpc("admin_msg_threads", { p_search: amg.q || null, p_unread: amg.unreadOnly, p_page: amg.page, p_size: AMG_PAGE });
    amg.data = { total: num(Number(r && r.total), 0), unread: num(Number(r && r.unread), 0), unreadThreads: num(Number(r && r.unread_threads), 0), rows: arr(r && r.rows) };
    amg.unread = amg.data.unread; amg.missing = false; amg.at = Date.now();
  } catch (e) { amg.data = null; amg.missing = Messages.isMissing(e); amg.err = amgErrText(e); }
  if (!amg.missing && !amg.cheers) await amgLoadCheers();
  amg.loading = false;
  amgRerender();
}
async function amgLoadCheers() {
  try { amg.cheers = arr(await aqRpc("admin_cheer_list")); amg.cheersErr = ""; }
  catch (e) { amg.cheers = null; amg.cheersErr = amgErrText(e); }
}
// Ouvre la conversation d'un compte (depuis la liste, la fiche du compte ou le tableau de bord).
function amgOpenThread(userId, from) {
  if (!userId) return;
  amg.threadUser = userId; amg.thread = null; amg.threadErr = ""; amg.draft = ""; amg.tab = "threads";
  if (from) amg.from = from;
  if (currentScreen === "adminmsg") amgLoadThread();
  else location.hash = "#" + HASH_OF.adminmsg;
}
async function amgLoadThread() {
  if (!amg.threadUser) return;
  amg.threadLoading = true; amg.threadErr = "";
  amgRerender();
  try {
    amg.thread = await aqRpc("admin_msg_thread", { p_user: amg.threadUser, p_mark: true });
    amgLoadUnread().then(() => { if (amg.data) amgLoad(); });
  } catch (e) { amg.thread = null; amg.threadErr = amgErrText(e); if (Messages.isMissing(e)) amg.missing = true; }
  amg.threadLoading = false;
  amgRerender();
}

function renderAdminMessages() {
  const root = $("#screen-adminmsg");
  if (!root) return;
  root.textContent = "";
  const back = el("button", "link-btn", t("aq.back"));
  back.type = "button";
  back.addEventListener("click", () => {
    if (amg.threadUser && amg.from === "adminfiche") { amg.threadUser = null; amg.thread = null; location.hash = "#" + HASH_OF.adminfiche; return; }
    if (amg.threadUser) { amg.threadUser = null; amg.thread = null; amgRerender(); return; }
    location.hash = "#" + HASH_OF.admin;
  });
  root.appendChild(back);
  const top = el("div", "adm-top");
  top.appendChild(el("h2", null, "💬 " + t("amg.title")));
  const ref = el("button", "link-btn", t("admin.refresh"));
  ref.type = "button";
  ref.addEventListener("click", () => { amg.cheers = null; if (amg.threadUser) amgLoadThread(); amgLoad(); });
  top.appendChild(ref);
  root.appendChild(top);
  if (!amg.started) { amgLoad(); if (amg.threadUser) amgLoadThread(); return; }
  if (!amg.loading && amg.at && Date.now() - amg.at > 60000) setTimeout(amgLoad, 0);   // liste de plus d'une minute : relue
  if (amg.missing) { root.appendChild(el("div", "card q-err", t("amg.missing"))); return; }
  if (amg.threadUser) {
    if (!amg.thread && !amg.threadLoading && !amg.threadErr) { amgLoadThread(); return; }   // ouverte depuis la fiche ou le tableau de bord
    amgThreadView(root); return;
  }
  const tabs = el("div", "seg amg-tabs");
  [["threads", t("amg.tabThreads")], ["cheers", t("amg.tabCheers")]].forEach(([k, lab]) => {
    const b = el("button", null, lab);
    b.type = "button"; b.setAttribute("aria-pressed", String(amg.tab === k));
    b.addEventListener("click", () => { amg.tab = k; renderAdminMessages(); });
    tabs.appendChild(b);
  });
  root.appendChild(tabs);
  if (amg.tab === "cheers") { amgCheersTab(root); return; }
  amgThreadsTab(root);
}

// --- Onglet Conversations ---
function amgThreadsTab(root) {
  root.appendChild(el("p", "hint", t("amg.help")));
  const bar = el("div", "amg-bar");
  const nw = el("button", "btn primary", "✉️ " + t("amg.new"));
  nw.type = "button"; nw.addEventListener("click", () => amgNewMessage(null));
  const csv = el("button", "btn", t("amg.csv"));
  csv.type = "button"; csv.addEventListener("click", () => amgExportCsv(null));
  bar.append(nw, csv);
  root.appendChild(bar);
  const f = el("div", "aq-filters amg-filters");
  const q = el("input", "input");
  q.type = "search"; q.value = amg.q; q.placeholder = t("np.search"); q.setAttribute("aria-label", t("np.search"));
  let tm = null;
  q.addEventListener("input", () => { clearTimeout(tm); tm = setTimeout(() => { amg.q = q.value.trim(); amg.page = 0; amgLoad(); }, 400); });
  const un = el("label", "check");
  const cb = el("input"); cb.type = "checkbox"; cb.checked = amg.unreadOnly;
  cb.addEventListener("change", () => { amg.unreadOnly = cb.checked; amg.page = 0; amgLoad(); });
  un.append(cb, el("span", null, t("amg.unreadOnly")));
  f.append(q, un);
  root.appendChild(f);
  if (amg.err) root.appendChild(el("div", "card q-err", amg.err));
  if (!amg.data) { root.appendChild(el("div", "empty", amg.loading ? t("admin.loading") : "—")); return; }
  root.appendChild(el("p", "muted", t("amg.count", { n: amg.data.total, u: amg.data.unread })));
  if (!amg.data.rows.length) { root.appendChild(el("div", "empty", t("amg.none"))); return; }
  const list = el("div", "al-list");
  amg.data.rows.forEach(r => {
    const box = el("button", "card al-row amg-row" + (r.unread ? " amg-unread" : ""));
    box.type = "button";
    const head = el("div", "al-head");
    const who = el("span", "amg-who", r.identifiant || "?");
    if (r.blocked) who.appendChild(el("span", "tag bad", t("blk.tag")));
    if (r.unread) who.appendChild(el("span", "mg-dot", String(r.unread)));
    head.append(who, el("span", "al-time", alTime(r.last_at)));
    box.appendChild(head);
    const last = r.last || {};
    const txt = last.body ? String(last.body) : last.message ? "💬 " + mgText(last.message, {}) : "";
    box.appendChild(el("div", "amg-last", (last.dir === "to_user" ? t("amg.youPrefix") + " " : "") + txt));
    box.appendChild(el("div", "al-dev", t("amg.total", { n: num(Number(r.total), 0) })));
    box.addEventListener("click", () => amgOpenThread(r.user_id, "adminmsg"));
    list.appendChild(box);
  });
  root.appendChild(list);
  const pages = Math.max(1, Math.ceil(amg.data.total / AMG_PAGE));
  if (pages > 1) {
    const w = el("div", "pv-pager");
    const prev = el("button", "btn", "‹"), next = el("button", "btn", "›");
    prev.setAttribute("aria-label", t("pv.prev")); next.setAttribute("aria-label", t("pv.next"));
    prev.disabled = amg.page === 0 || amg.loading; next.disabled = amg.page >= pages - 1 || amg.loading;
    prev.addEventListener("click", () => { amg.page--; amgLoad(); });
    next.addEventListener("click", () => { amg.page++; amgLoad(); });
    w.append(prev, el("span", null, t("pv.page", { i: amg.page + 1, n: pages })), next);
    root.appendChild(w);
  }
}

// --- Une conversation ---
function amgThreadView(root) {
  const th = amg.thread;
  if (amg.threadErr) root.appendChild(el("div", "card q-err", amg.threadErr));
  if (!th) { root.appendChild(el("div", "empty", amg.threadLoading ? t("admin.loading") : "—")); return; }
  const head = el("div", "card amg-thead");
  const id = el("h3", "np-h3", th.identifiant || "?");
  if (th.blocked) id.appendChild(el("span", "tag bad", t("blk.tag")));
  head.appendChild(id);
  const nav = el("div", "btns");
  const fiche = el("button", "btn", t("amg.fiche"));
  fiche.type = "button"; fiche.addEventListener("click", () => openAccountFiche(th.user_id, "adminmsg"));
  const csv = el("button", "btn", t("amg.csv"));
  csv.type = "button"; csv.addEventListener("click", () => amgExportCsv(th.user_id));
  nav.append(fiche, csv);
  head.appendChild(nav);
  root.appendChild(head);
  const c = el("div", "card mg-thread");
  const msgs = arr(th.messages);
  if (!msgs.length) c.appendChild(el("p", "muted", t("amg.threadNone")));
  const list = el("div", "mg-bubbles");
  msgs.forEach(m => {
    const team = m.dir === "to_user";                 // message de l'équipe (à droite côté admin)
    const b = el("div", "mg-bubble " + (team ? "mine" : "team"));
    b.appendChild(el("div", "mg-who", team ? t("mg.team") + (m.sent_by ? " · " + m.sent_by : "") : (th.identifiant || "?")));
    b.appendChild(el("div", "mg-body", m.body ? m.body : "💬 " + mgText(m.message, m.vars)));
    const meta = [mgTime(m.created_at)];
    if (team) meta.push(t(m.read_at ? "amg.read" : "amg.notRead"));
    if (num(Number(m.batch_size), 1) > 1) meta.push(t("amg.batch", { n: m.batch_size }));
    b.appendChild(el("div", "mg-time", meta.join(" · ")));
    list.appendChild(b);
  });
  c.appendChild(list);
  root.appendChild(c);
  // Répondre
  const f = el("div", "card mg-compose");
  const ta = el("textarea", "input mg-ta");
  ta.id = "amgReply"; ta.rows = 4; ta.maxLength = MG_TEAM_MAX; ta.value = amg.draft; ta.placeholder = t("amg.replyPh");
  const lab = el("label", null, t("amg.reply")); lab.htmlFor = ta.id;
  const cnt = el("span", "ix-count", ta.value.length + " / " + MG_TEAM_MAX);
  ta.addEventListener("input", () => { amg.draft = ta.value; cnt.textContent = ta.value.length + " / " + MG_TEAM_MAX; });
  const btns = el("div", "btns two");
  const send = el("button", "btn primary", t("mg.send"));
  send.type = "button"; send.disabled = amg.busy || th.exists === false;
  send.addEventListener("click", () => amgSend({ users: [th.user_id] }, ta.value, null, 1, () => { amg.draft = ""; amgLoadThread(); }));
  const pre = el("button", "btn", t("amg.preset"));
  pre.type = "button"; pre.disabled = amg.busy || th.exists === false;
  pre.addEventListener("click", () => amgPickCheer(id => amgSend({ users: [th.user_id] }, null, id, 1, () => amgLoadThread())));
  btns.append(pre, send);
  f.append(lab, ta, cnt, el("p", "hint", t("amg.replyHint")), btns);
  root.appendChild(f);
}

// Envoi (une réponse, ou un nouveau message après confirmation).
async function amgSend(filter, body, cheer, expected, after) {
  if (amg.busy) return false;
  const text = String(body || "").trim();
  if (!cheer && !text) { toast(t("mg.err.msg_body")); return false; }
  amg.busy = true; amgRerender();
  let ok = false;
  try {
    const r = await aqRpc("admin_msg_send", { p_filter: filter, p_body: cheer ? null : text.slice(0, MG_TEAM_MAX), p_cheer: cheer || null });
    ok = true;
    const n = num(Number(r && r.sent), 0), sk = num(Number(r && r.skipped), 0);
    toast(t(n === 1 ? "amg.sentOne" : "amg.sentN", { n }) + (sk ? " · " + t("amg.skipped", { n: sk }) : ""));
  } catch (e) { toast(amgErrText(e)); }
  amg.busy = false;
  if (ok && after) after();
  if (ok) amgLoad(); else amgRerender();
  return ok;
}
// Choix d'un message prédéfini (actifs, sauf « merci »).
function amgPickCheer(onPick) {
  const box = el("div", "mg-pick");
  const list = el("div", "mg-pick-list");
  let close = null;
  arr(amg.cheers).filter(m => m.active && m.category !== "thanks").forEach(m => {
    const b = el("button", "mg-pick-btn", mgText(m, { serie: "{serie}", niveau: "{niveau}" }));
    b.type = "button";
    b.addEventListener("click", () => { if (close) close(); onPick(m.id); });
    list.appendChild(b);
  });
  box.append(el("p", "hint", t("amg.presetHint")), list);
  close = openModal(t("amg.preset"), box, [{ label: t("cancel") }]);
}

// --- Nouveau message : un compte, plusieurs, tous, ciblage enregistré ---
async function amgNewMessage(preUsers) {
  if (!adm.list) { try { adm.list = arr(await Supa.listAccounts()); } catch (e) {} }
  if (!amg.segs) { try { const r = await withTimeout(Supa.client().from("notification_segments").select("*").order("created_at"), 20000); amg.segs = arr(r && r.data); } catch (e) { amg.segs = []; } }
  const f = { mode: preUsers && preUsers.length ? "users" : "all", users: arr(preUsers), seg: "", src: "text", text: "", cheer: "" };
  const box = el("div", "amg-new");
  // Destinataires
  const lt = el("div", "field");
  lt.appendChild(el("label", null, t("amg.to")));
  const seg = el("div", "seg seg-wrap");
  const segs = arr(amg.segs).filter(s => s.builtin !== "all");
  const modes = [["all", t("amg.toAll")], ["users", t("amg.toUsers")]].concat(segs.length ? [["seg", t("amg.toSeg")]] : []);
  const usersLine = el("div", "hint");
  const segSel = el("select", "input");
  segs.forEach(s => { const o = el("option", null, npSegName(s)); o.value = s.id; segSel.appendChild(o); });
  if (segs.length) f.seg = segs[0].id;
  segSel.addEventListener("change", () => { f.seg = segSel.value; calc(); });
  const pick = el("button", "btn", t("amg.pick"));
  pick.type = "button";
  pick.addEventListener("click", () => npPickAccounts(f.users, sel => { f.users = sel; draw(); calc(); }));
  const extra = el("div", "amg-to");
  const draw = () => {
    seg.querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.value === f.mode)));
    extra.textContent = "";
    if (f.mode === "users") {
      const names = f.users.map(u => (arr(adm.list).find(a => a.user_id === u) || {}).identifiant || "?");
      usersLine.textContent = names.length ? names.slice(0, 12).join(", ") + (names.length > 12 ? " …" : "") : t("amg.noneChosen");
      extra.append(pick, usersLine);
    } else if (f.mode === "seg") {
      extra.appendChild(segSel);
      const sg = segs.find(s => s.id === f.seg);
      if (sg) extra.appendChild(el("p", "hint", npFilterText(sg.filter)));
    } else extra.appendChild(el("p", "hint", t("amg.toAllHint")));
  };
  modes.forEach(([k, lab]) => {
    const b = el("button", null, lab);
    b.type = "button"; b.dataset.value = k;
    b.addEventListener("click", () => { f.mode = k; draw(); calc(); });
    seg.appendChild(b);
  });
  lt.append(seg, extra);
  box.appendChild(lt);
  const count = el("p", "muted amg-count");
  box.appendChild(count);
  // Message
  const lm = el("div", "field");
  lm.appendChild(el("label", null, t("amg.message")));
  const src = el("div", "seg");
  const ta = el("textarea", "input mg-ta");
  ta.rows = 5; ta.maxLength = MG_TEAM_MAX; ta.placeholder = t("amg.textPh");
  const cnt = el("span", "ix-count", "0 / " + MG_TEAM_MAX);
  ta.addEventListener("input", () => { f.text = ta.value; cnt.textContent = ta.value.length + " / " + MG_TEAM_MAX; });
  const cs = el("select", "input");
  arr(amg.cheers).filter(m => m.active && m.category !== "thanks").forEach(m => { const o = el("option", null, mgText(m, { serie: "{serie}", niveau: "{niveau}" })); o.value = m.id; cs.appendChild(o); });
  f.cheer = cs.value;
  cs.addEventListener("change", () => { f.cheer = cs.value; });
  const mbox = el("div");
  const drawSrc = () => {
    src.querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.value === f.src)));
    mbox.textContent = "";
    if (f.src === "text") mbox.append(ta, cnt, el("p", "hint", t("amg.textHint")));
    else mbox.append(cs, el("p", "hint", t("amg.presetHint")));
  };
  [["text", t("amg.free")], ["cheer", t("amg.preset")]].forEach(([k, lab]) => {
    const b = el("button", null, lab);
    b.type = "button"; b.dataset.value = k;
    b.addEventListener("click", () => { f.src = k; drawSrc(); });
    src.appendChild(b);
  });
  lm.append(src, mbox);
  box.appendChild(lm);
  const filterOf = () => f.mode === "users" ? { users: f.users.slice() } : f.mode === "seg"
    ? npCleanFilter(Object.assign({}, (segs.find(s => s.id === f.seg) || {}).filter || {})) : {};
  let calcKey = "", target = null;
  async function calc() {
    const fl = filterOf(), key = JSON.stringify(fl);
    calcKey = key; target = null;
    if (f.mode === "users" && !f.users.length) { count.textContent = t("amg.noneChosen"); return; }
    count.textContent = t("admin.loading");
    try {
      const r = await aqRpc("admin_msg_target", { p_filter: fl });
      if (calcKey !== key) return;
      target = num(Number(r && r.count), 0);
      count.textContent = t("amg.targets", { n: target }) + (arr(r && r.sample).length ? " — " + arr(r.sample).join(", ") + (target > arr(r.sample).length ? " …" : "") : "");
    } catch (e) { if (calcKey === key) count.textContent = amgErrText(e); }
  }
  draw(); drawSrc(); calc();
  openModal("✉️ " + t("amg.new"), box, [
    { label: t("cancel") },
    { label: t("mg.send"), kind: "primary", onClick: () => {
      if (f.src === "text" && !f.text.trim()) { toast(t("mg.err.msg_body")); return false; }
      if (f.mode === "users" && !f.users.length) { toast(t("amg.noneChosen")); return false; }
      if (!target) { toast(t("mg.err.msg_targets")); return false; }
      const fl = filterOf(), n = target;
      openModal(t("amg.confirmTitle"), el("p", null, t(n === 1 ? "amg.confirmOne" : "amg.confirm", { n })), [
        { label: t("cancel") },
        { label: t("mg.send"), kind: "primary", onClick: () => { amgSend(fl, f.src === "text" ? f.text : null, f.src === "cheer" ? f.cheer : null, n); } }
      ]);
    } }
  ]);
}

// --- Export CSV (tous les messages, ou une conversation) ---
async function amgExportCsv(userId) {
  const pg = openProgress(t("amg.csv"), t("admin.loading"), []);
  let rows;
  try { rows = arr(await aqRpc("admin_msg_export", { p_user: userId || null, p_days: null })); }
  catch (e) { pg.close(); toast(amgErrText(e)); return; }
  pg.close();
  const iso = s => {
    const d = new Date(s);
    return !s || isNaN(d) ? "" : todayStr(d) + " " + String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
  };
  const csv = csvText([t("amg.c.date"), t("aq.f.account"), t("amg.c.dir"), t("amg.c.text"), t("amg.c.preset"), t("amg.c.by"), t("amg.c.read"), t("amg.c.batch")],
    rows.map(x => [iso(x.created_at), x.identifiant || "", t(x.dir === "to_team" ? "amg.c.in" : "amg.c.out"),
      x.body || (x.message ? mgText(x.message, x.vars) : ""), x.cheer || "", x.sent_by || "", iso(x.read_at), x.batch || ""]));
  const name = "messages-" + (userId ? ((arr(adm.list).find(a => a.user_id === userId) || {}).identifiant || "compte") + "-" : "") + todayStr() + ".csv";
  const okSave = await fxSave(name, inClaude() ? csv : new Blob([csv], { type: "text/csv;charset=utf-8" }));
  if (okSave === true) toast(t("amg.csvDone", { n: rows.length }));
  else if (okSave !== "declined") showExportText(csv);
}

// --- Onglet Messages prédéfinis ---
function amgCheersTab(root) {
  root.appendChild(el("p", "hint", t("amg.cheersHelp")));
  const add = el("button", "btn primary", "＋ " + t("amg.cheerAdd"));
  add.type = "button"; add.addEventListener("click", () => amgEditCheer(null));
  root.appendChild(add);
  if (amg.cheersErr) root.appendChild(el("div", "card q-err", amg.cheersErr));
  const list = arr(amg.cheers);
  if (!list.length) { root.appendChild(el("div", "empty", amg.cheers ? t("amg.cheersNone") : t("admin.loading"))); if (!amg.cheers) amgLoadCheers().then(amgRerender); return; }
  list.forEach((m, i) => {
    const c = el("div", "card amg-cheer" + (m.active ? "" : " amg-off"));
    const head = el("div", "an-head");
    const tags = el("div", "adm-tags");
    tags.append(el("span", "tag", t("amg.cat." + m.category)), el("span", "tag" + (m.active ? " ok" : " bad"), t(m.active ? "amg.active" : "amg.inactive")),
      el("span", "tag", t("amg.uses", { n: num(Number(m.uses), 0) })));
    head.appendChild(tags);
    const sw = el("button", "au-switch am-switch");
    sw.type = "button"; sw.setAttribute("role", "switch"); sw.setAttribute("aria-checked", String(!!m.active));
    sw.setAttribute("aria-label", t("amg.active"));
    const track = el("span", "au-track"); track.appendChild(el("span", "au-knob"));
    sw.appendChild(track);
    sw.addEventListener("click", () => amgSaveCheer(m, { category: m.category, ko: m.ko, fr: m.fr, en: m.en, active: !m.active }));
    head.appendChild(sw);
    c.appendChild(head);
    const dl = el("dl", "amg-langs");
    AN_LANGS.forEach(l => { dl.append(el("dt", null, l.toUpperCase()), el("dd", null, m[l] || "—")); });
    c.appendChild(dl);
    const acts = el("div", "an-acts");
    const up = el("button", "btn", "↑"), down = el("button", "btn", "↓"), ed = el("button", "btn", t("amg.edit"));
    up.type = down.type = ed.type = "button";
    up.setAttribute("aria-label", t("amg.up")); down.setAttribute("aria-label", t("amg.down"));
    up.disabled = i === 0 || amg.busy; down.disabled = i === list.length - 1 || amg.busy;
    up.addEventListener("click", () => amgMove(i, -1));
    down.addEventListener("click", () => amgMove(i, 1));
    ed.addEventListener("click", () => amgEditCheer(m));
    acts.append(up, down, ed);
    c.appendChild(acts);
    root.appendChild(c);
  });
}
async function amgMove(i, d) {
  const ids = arr(amg.cheers).map(m => m.id);
  const j = i + d;
  if (j < 0 || j >= ids.length || amg.busy) return;
  [ids[i], ids[j]] = [ids[j], ids[i]];
  amg.busy = true; amgRerender();
  try { amg.cheers = arr(await aqRpc("admin_cheer_order", { p_ids: ids })); }
  catch (e) { toast(amgErrText(e)); }
  amg.busy = false; amgRerender();
}
function amgEditCheer(m) {
  const f = { category: m ? m.category : "general", ko: m ? m.ko : "", fr: m ? m.fr : "", en: m ? m.en : "", active: m ? !!m.active : true };
  const box = el("div", "amg-edit");
  const lc = el("label", "aq-f");
  lc.append(el("span", null, t("amg.category")), npSelect(AMG_CATS.map(k => [k, t("amg.cat." + k)]), f.category, v => { f.category = v; }));
  box.appendChild(lc);
  AN_LANGS.forEach(l => {
    const w = el("div", "field");
    const ta = el("textarea", "input");
    ta.id = "amgCheer-" + l; ta.rows = 2; ta.maxLength = 200; ta.value = f[l] || ""; ta.lang = l;
    ta.addEventListener("input", () => { f[l] = ta.value; });
    const lab = el("label", null, langName(l, l) + " (" + l + ")"); lab.htmlFor = ta.id;
    w.append(lab, ta);
    box.appendChild(w);
  });
  box.appendChild(el("p", "hint", t("amg.varsHint")));
  const err = el("p", "q-err"); err.hidden = true;
  box.appendChild(err);
  openModal(m ? t("amg.cheerEdit") : t("amg.cheerAdd"), box, [
    { label: t("cancel") },
    { label: t("save"), kind: "primary", onClick: () => {
      amgSaveCheer(m, f).then(ok => { if (ok) { const bg = box.closest(".modal-bg"); if (bg) bg.remove(); } else { err.textContent = amg.lastErr || ""; err.hidden = !amg.lastErr; } });
      return false;
    } }
  ]);
}
async function amgSaveCheer(m, f) {
  if (amg.busy) return false;
  amg.busy = true; amg.lastErr = "";
  let ok = false;
  try {
    await aqRpc("admin_cheer_save", { p_id: m ? m.id : null, p_category: f.category, p_ko: f.ko || "", p_fr: f.fr || "", p_en: f.en || "",
      p_active: f.active !== false, p_sort: null });
    ok = true;
    toast(t("amg.cheerSaved"));
    await amgLoadCheers();
    try { Messages.loadCatalog(true); } catch (e) {}
  } catch (e) { amg.lastErr = amgErrText(e); toast(amg.lastErr); }
  amg.busy = false;
  amgRerender();
  return ok;
}
