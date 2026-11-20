"use strict";

// === ADMINISTRATION : ÉQUIPES (ÉTAPE 54) ===
// Écran « Équipes » (#admin-equipes, screen-adminteam ; admin et mode Supabase) : liste des équipes (recherche par nom ou
// identifiant d'un membre, 50 par page) avec taille, chef, score et objectif de la semaine ; détail d'une équipe (membres
// avec XP et cartes de la semaine, série — sans confidentialité pour l'admin —, invitations en attente, objectif, listes
// d'équipe, 8 dernières semaines figées) ; « Renommer » (nom + emoji) ou « Supprimer » une équipe au nom inadapté, raison
// obligatoire, noté au journal (admin_team). Fonctions : admin_teams, admin_team_detail, admin_team_rename, admin_team_delete
// (script claude/supabase-etape54.sql). Script absent : « Lancez le script SQL de l'étape 54 ».
// Textes : js/i18n/teams-<langue>.js (clés atm.*).
const ATM_PAGE = 50;
const atm = { started: false, loading: false, err: "", missing: false, data: null, page: 0, q: "", open: null, detail: null, detErr: "", busy: false };

function atmRerender() { try { if (currentScreen === "adminteam") renderAdminTeams(); } catch (e) {} }
function atmErrText(e) {
  const h = String((e && e.hint) || "");
  if (I18N.fr["tm.err." + h]) return t("tm.err." + h, { m: TM_MAX, n: TM_INVITES });
  if (Teams.isMissing(e)) return t("atm.missing");
  if (sbErrKind(e) === "net") return t("tm.err.offline");
  return t("tm.err.other");
}
async function atmLoad() {
  atm.loading = true; atm.err = ""; atm.started = true;
  atmRerender();
  try {
    atm.data = await Teams.rpc("admin_teams", { p_search: atm.q || null, p_page: atm.page, p_size: ATM_PAGE, p_today: todayStr() });
    atm.missing = false;
  } catch (e) { atm.missing = Teams.isMissing(e); atm.err = atmErrText(e); }
  atm.loading = false;
  atmRerender();
}
async function atmOpen(id) {
  atm.open = id; atm.detail = null; atm.detErr = "";
  atmRerender();
  try { atm.detail = await Teams.rpc("admin_team_detail", { p_team: id, p_today: todayStr() }); }
  catch (e) { atm.detErr = atmErrText(e); }
  atmRerender();
}

function renderAdminTeams() {
  const root = $("#screen-adminteam");
  if (!root) return;
  root.textContent = "";
  const top = el("div", "adm-top");
  const back = el("button", "link-btn", "‹ " + t("admin.title"));
  back.addEventListener("click", () => { if (atm.open) { atm.open = null; atm.detail = null; atmRerender(); } else location.hash = "#" + HASH_OF.admin; });
  top.appendChild(back);
  const ref = el("button", "link-btn", t("am.refresh"));
  ref.addEventListener("click", () => { if (atm.open) atmOpen(atm.open); else atmLoad(); });
  top.appendChild(ref);
  root.appendChild(top);
  root.appendChild(el("h2", null, "👥 " + t("atm.title")));
  if (!atm.started) { atmLoad(); return; }
  if (atm.missing) { root.appendChild(el("div", "card q-err", t("atm.missing"))); return; }
  if (atm.open) { atmDetail(root); return; }
  root.appendChild(el("p", "muted", t("atm.help")));
  // Recherche
  const f = el("form", "am-add");
  const inp = el("input", "input");
  inp.type = "search"; inp.placeholder = t("atm.search"); inp.value = atm.q; inp.setAttribute("aria-label", t("atm.search"));
  const b = el("button", "btn", t("atm.searchBtn")); b.type = "submit";
  f.addEventListener("submit", e => { e.preventDefault(); atm.q = inp.value.trim(); atm.page = 0; atmLoad(); });
  f.append(inp, b);
  root.appendChild(f);
  if (atm.err) root.appendChild(el("div", "card q-err", atm.err));
  const d = atm.data;
  if (!d) { root.appendChild(el("div", "card muted", atm.loading ? t("am.loading") : "—")); return; }
  root.appendChild(el("p", "muted", t("atm.count", { n: num(Number(d.all), 0), m: num(Number(d.members), 0) })
    + " · " + t("am.rankWeek", { a: frDayLabel(d.week_start), b: frDayLabel(skAdd(d.week_start, 6)) })));
  const rows = arr(d.rows);
  if (!rows.length) root.appendChild(el("div", "card muted", t("atm.none")));
  const list = el("div", "card atm-list");
  rows.forEach(x => {
    const row = el("button", "atm-row");
    row.type = "button";
    const g = x.goal;
    const goal = g ? (g.reached_at ? "🏆 " + t("atm.reached") : "🎯 " + tmGoalVal(g.kind, Math.min(num(Number(g.progress), 0), num(Number(g.target), 0))) + " / " + tmGoalVal(g.kind, g.target)) : "—";
    row.append(el("span", "atm-emo", x.emoji || "👥"),
      el("span", "atm-main", null));
    row.lastChild.append(el("b", null, x.name), el("span", "muted atm-sub",
      t("atm.rowSub", { n: num(Number(x.size), 0), id: x.chef || "?", s: dashFmt(Math.round(num(Number(x.score), 0))) }) + " · " + goal));
    row.addEventListener("click", () => atmOpen(x.id));
    list.appendChild(row);
  });
  if (rows.length) root.appendChild(list);
  const total = num(Number(d.total), 0), pages = Math.max(1, Math.ceil(total / ATM_PAGE));
  if (pages > 1) {
    const nav = el("div", "btns two");
    const p = el("button", "btn", "‹"); p.type = "button"; p.disabled = atm.page <= 0;
    p.addEventListener("click", () => { atm.page--; atmLoad(); });
    const n = el("button", "btn", "›"); n.type = "button"; n.disabled = atm.page >= pages - 1;
    n.addEventListener("click", () => { atm.page++; atmLoad(); });
    nav.append(p, n);
    root.appendChild(nav);
    root.appendChild(el("p", "muted", t("atm.page", { p: atm.page + 1, n: pages })));
  }
}

function atmDetail(root) {
  const d = atm.detail;
  if (atm.detErr) { root.appendChild(el("div", "card q-err", atm.detErr)); return; }
  if (!d) { root.appendChild(el("div", "card muted", t("am.loading"))); return; }
  const h = el("div", "card");
  const hd = el("div", "tm-head");
  hd.append(el("span", "tm-emoji big", d.emoji || "👥"), el("div", "tm-hname"));
  hd.lastChild.append(el("b", "tm-name", d.name), el("div", "muted tm-small", t("atm.created", { d: admDate(d.created_at), id: d.chef || "?" })));
  h.appendChild(hd);
  h.appendChild(el("p", "tm-small", t("atm.score", { s: dashFmt(Math.round(num(Number(d.score), 0))) })));
  const g = d.goal;
  if (g) {
    const cur = num(Number(g.progress), 0), max = num(Number(g.target), 1);
    h.appendChild(el("p", "tm-small", "🎯 " + tmGoalVal(g.kind, Math.min(cur, max)) + " / " + tmGoalVal(g.kind, max)
      + " · " + (g.auto ? t("atm.goalAuto") : t("atm.goalBy", { id: g.set_by || "?" })) + (g.reached_at ? " · 🏆 " + t("atm.reached") : "")));
    h.appendChild(tmBar(cur, max, !!g.reached_at));
  }
  const btns = el("div", "am-btns am-btns-end");
  const r = el("button", "am-btn", "✏️ " + t("atm.rename")); r.type = "button"; r.disabled = atm.busy;
  r.addEventListener("click", () => atmRename(d));
  const del = el("button", "am-btn danger", t("atm.delete")); del.type = "button"; del.disabled = atm.busy;
  del.addEventListener("click", () => atmDelete(d));
  btns.append(r, del);
  modGate(btns, "teams.act");   // étape 66 : case du modo
  h.appendChild(btns);
  root.appendChild(h);
  // Membres (tout, sans confidentialité)
  const m = el("div", "card");
  m.appendChild(el("h2", null, t("tm.members", { n: arr(d.members).length, m: TM_MAX })));
  const tb = el("table", "aq-table atm-table");
  const thead = el("tr");
  [t("atm.c.who"), t("atm.c.role"), t("tm.xpWeek"), t("tm.cardsWeek"), "🔥"].forEach(x => thead.appendChild(el("th", null, x)));
  tb.appendChild(thead);
  arr(d.members).forEach(x => {
    const tr = el("tr");
    const who = el("td");
    const a = el("button", "link-btn", x.identifiant + (x.blocked ? " · " + t("tm.memberBlocked") : ""));
    a.type = "button"; a.disabled = !Mod.can("accounts.see");   // étape 66 : fiche = case du modo
    a.addEventListener("click", () => { try { openAccountFiche(x.user_id, "adminteam"); } catch (e) {} });
    who.appendChild(a);
    tr.append(who, el("td", null, x.role === "chef" ? "👑 " + t("atm.chef") : t("atm.member")), el("td", null, dashFmt(x.xp_week)),
      el("td", null, dashFmt(x.cards_week)), el("td", null, String(num(Number(x.streak), 0))));
    tb.appendChild(tr);
  });
  const wrap = el("div", "aq-tablewrap"); wrap.appendChild(tb);
  m.appendChild(wrap);
  root.appendChild(m);
  // Invitations, listes, semaines
  const o = el("div", "card");
  o.appendChild(el("h3", "np-h3", t("atm.invites", { n: arr(d.invites).length })));
  if (!arr(d.invites).length) o.appendChild(el("p", "muted", "—"));
  arr(d.invites).forEach(i => o.appendChild(el("p", "tm-small", i.identifiant + " · " + t("atm.invBy", { id: i.from || "?" }) + " · " + admDate(i.created_at))));
  o.appendChild(el("h3", "np-h3", t("atm.lists", { n: arr(d.lists).length })));
  if (!arr(d.lists).length) o.appendChild(el("p", "muted", "—"));
  arr(d.lists).forEach(l => o.appendChild(el("p", "tm-small", (l.is_folder ? "📁 " : "📄 ") + l.name + " · " + (l.owner || "?") + " · " + t(l.role === "write" ? "tm.role.write" : "tm.role.read"))));
  o.appendChild(el("h3", "np-h3", t("atm.weeks")));
  if (!arr(d.weeks).length) o.appendChild(el("p", "muted", "—"));
  arr(d.weeks).forEach(w => o.appendChild(el("p", "tm-small", frDayLabel(w.week_start) + " · " + t("atm.weekLine", { r: num(Number(w.rank), 0), n: num(Number(w.count), 0), s: dashFmt(Math.round(num(Number(w.score), 0))), m: num(Number(w.members), 0) }) + (w.reached ? " · 🏆" : ""))));
  root.appendChild(o);
}
function atmReasonField() {
  const ta = el("textarea", "input atm-reason");
  ta.maxLength = 300; ta.rows = 3; ta.placeholder = t("atm.reasonPh"); ta.setAttribute("aria-label", t("atm.reason"));
  const lab = el("label", "tm-lab");
  lab.append(el("span", null, t("atm.reason")), ta);
  return { node: lab, get: () => ta.value.trim() };
}
function atmRename(d) {
  const fm = el("div");
  const inp = el("input", "input"); inp.type = "text"; inp.maxLength = TM_NAME_MAX; inp.value = d.name;
  const lab = el("label", "tm-lab"); lab.append(el("span", null, t("tm.name")), inp);
  const why = atmReasonField();
  const err = el("p", "q-err"); err.hidden = true;
  fm.append(lab, why.node, err, el("p", "hint", t("atm.renameHint")));
  openModal(t("atm.rename"), fm, [
    { label: t("cancel") },
    { label: t("tm.save"), kind: "primary", onClick: () => {
      if (!why.get()) { err.textContent = t("tm.err.team_reason"); err.hidden = false; return false; }
      atmAct(() => Teams.rpc("admin_team_rename", { p_team: d.id, p_name: inp.value, p_emoji: null, p_reason: why.get() }), t("atm.renamed"));
      return undefined;
    } }
  ]);
}
function atmDelete(d) {
  const fm = el("div");
  fm.appendChild(el("p", null, t("atm.deleteAsk", { name: d.name, n: arr(d.members).length })));
  const why = atmReasonField();
  const err = el("p", "q-err"); err.hidden = true;
  fm.append(why.node, err);
  openModal(t("atm.delete"), fm, [
    { label: t("cancel") },
    { label: t("atm.delete"), kind: "danger", onClick: () => {
      if (!why.get()) { err.textContent = t("tm.err.team_reason"); err.hidden = false; return false; }
      atmAct(() => Teams.rpc("admin_team_delete", { p_team: d.id, p_reason: why.get() }), t("atm.deleted", { name: d.name }), true);
      return undefined;
    } }
  ]);
}
async function atmAct(fn, okText, closeDetail) {
  if (atm.busy) return;
  atm.busy = true; atmRerender();
  try { await fn(); toast(okText); if (closeDetail) { atm.open = null; atm.detail = null; } }
  catch (e) { toast(atmErrText(e)); }
  atm.busy = false;
  if (atm.open) await atmOpen(atm.open);
  await atmLoad();
}
