"use strict";

// === ADMINISTRATION : FICHE D'UN COMPTE ===
// (suite de la découpe : même section, fichier séparé ; taille visée depuis l'étape 65 : 60 Ko au plus par fichier)
// --- Fiche d'un compte (admin, étape 26) : écran #admin-fiche ---
// Ouverte depuis la liste des comptes, le tableau de bord (alertes, classements), le journal et l'historique des demandes
// Claude (openAccountFiche). Un seul compte à la fois.
// Sources :
//  - user_data du compte (lu par l'admin grâce aux règles RLS) → contenu, difficultés, listes en lecture seule ; calculé
//    ici, dans le navigateur de l'admin (fcCompute), jamais enregistré ;
//  - fonctions SQL du script supabase-etape26.sql (security definer, contrôle is_admin()) : admin_account_summary
//    (en-tête, révisions, calendrier, heures, modes, appareils), admin_account_storage (taille par morceau, version),
//    admin_account_issues (erreurs de synchro et conflits des 30 derniers jours).
// Script pas lancé : « Lancez le script SQL de l'étape 26 », les parties tirées de user_data restent affichées.
// Parties des étapes 28 à 30 (gels, objectif du jour, amis, listes partagées) : « — » en attendant.
// Lecture seule : aucune donnée du compte n'est modifiée ici (les actions existantes ouvrent leurs propres fenêtres).
const FC_LIMIT_KB = 512, FC_WARN_KB = 400, FC_BLOCKED_SEEN = 5, FC_SEARCH_MAX = 200;
const fc = {
  user: null, from: "adminacc", token: 0, loading: false,
  acc: null,                 // ligne de la liste des comptes (identifiant, création, admin…)
  sum: null, store: null, issues: null, part: {}, missing: false,
  data: null, dataErr: "", version: null, view: null,
  q: "", open: {}, cap: ""
};
// Ouvre la fiche d'un compte (userId) ; from = écran de retour.
function openAccountFiche(userId, from) {
  if (!userId) return;
  if (fc.user !== userId) Object.assign(fc, { sum: null, store: null, issues: null, part: {}, missing: false, data: null,
    dataErr: "", version: null, view: null, q: "", open: {}, cap: "", acc: null, friends: null, friendsErr: "", shares: null, sharesErr: "",
    push: null, pushErr: "", xp: null, ideas: null, ideasErr: "" });
  fc.user = userId;
  fc.from = from || (currentScreen !== "adminfiche" ? currentScreen : fc.from) || "adminacc";
  fc.started = false;
  if (currentScreen === "adminfiche") renderAdminFiche();
  else location.hash = "#" + HASH_OF.adminfiche;
}
function fcRerender() { if (currentScreen === "adminfiche") renderAdminFiche(); }
// Calculs sur les données d'un autre compte avec les fonctions de l'appli : state remplacé le temps d'un calcul
// synchrone (langue de l'interface de l'admin gardée), puis remis tel quel. Aucune sauvegarde pendant ce temps.
// Langues affichées selon le profil de l'admin (étape 35) : langue apprise par défaut du compte gardée (1re du profil),
// langues d'appui prises dans le profil de l'admin.
function fcWith(d, fn) {
  const keep = state;
  const first = accountTarget(d.settings), mine = learningOf(keep.settings);
  const learning = [{ lang: first, support: profileSupport(first, keep.settings) }].concat(mine.filter(x => x.lang !== first));
  state = Object.assign({}, d, { settings: Object.assign({}, d.settings, { uiLang: keep.settings.uiLang, theme: keep.settings.theme, learning }) });
  try { return fn(); } finally { state = keep; }
}
async function fcLoad() {
  const user = fc.user, my = ++fc.token;
  fc.loading = true; fc.started = true;
  fcRerender();
  const tz = dashTz();
  if (!adm.list) { try { adm.list = arr(await Supa.listAccounts()); } catch (e) {} }
  await admLoadBlocked();   // état bloqué / actif (étape 27), pour l'en-tête et le menu « Actions… »
  if (my !== fc.token) return;
  fc.acc = arr(adm.list).find(a => a.user_id === user) || fc.acc;
  const part = async (name, fn) => {
    try { fc[name] = await fn(); fc.part[name] = ""; }
    catch (e) { fc[name] = null; if (alIsMissing(e)) fc.missing = true; fc.part[name] = alIsMissing(e) ? t("fc.missing") : aqErrText(e); }
  };
  fc.missing = false;
  await Promise.all([
    part("sum", () => aqRpc("admin_account_summary", { p_user: user, p_tz: tz })),
    part("store", () => aqRpc("admin_account_storage", { p_user: user })),
    part("issues", () => aqRpc("admin_account_issues", { p_user: user, p_days: 30 })),
    (async () => {   // amis et demandes en attente (étape 29) ; script absent : seulement un message dans la section Amis
      try { fc.friends = await aqRpc("admin_friends", { p_user: user }); fc.friendsErr = ""; }
      catch (e) { fc.friends = null; fc.friendsErr = alIsMissing(e) ? t("am.missing") : aqErrText(e); }
    })(),
    (async () => {   // partages et invitations (étape 30) ; script absent : message dans la section Partages
      try { fc.shares = await aqRpc("admin_shares", { p_user: user }); fc.sharesErr = ""; }
      catch (e) { fc.shares = null; fc.sharesErr = alIsMissing(e) ? t("sh.missing") : aqErrText(e); }
    })(),
    fcIdeasLoad(user),   // idées du compte (étape 52, js/screens/admin-idees.js) ; script absent : message dans la section Idées
    (async () => {   // taille des images du compte (étape 49) ; script absent : « — »
      try { fc.img = await aqRpc("admin_image_usage", { p_user: user }); } catch (e) { fc.img = null; }
    })(),
    (async () => {   // XP, niveau, défis réussis (étape 43) ; script absent : calculés depuis les données du compte (fcCompute)
      try { fc.xp = await aqRpc("admin_account_xp", { p_user: user, p_tz: tz }); } catch (e) { fc.xp = null; }
    })(),
    (async () => {   // notifications (étape 32) ; script absent : message dans la section Notifications
      try { fc.push = await aqRpc("admin_push_account", { p_user: user }); fc.pushErr = ""; }
      catch (e) { fc.push = null; fc.pushErr = alIsMissing(e) ? t("np.missingAdmin") : aqErrText(e); }
    })(),
    (async () => {
      try {
        if (user === auth.sbUid) { fc.data = state; fc.version = state.version; fc.skStored = true; }
        else if (!Mod.can("accounts.data")) { fc.data = null; fc.version = null; fc.skStored = false; throw { modNoData: true }; }   // étape 66
        else {
          const raw = Storage.unpackRows(await Supa.readRows(user));
          fc.version = raw ? num(Number(raw.version), null) : null;
          fc.skStored = !!(raw && raw.streak && typeof raw.streak === "object");   // clé streak présente (version 28)
          fc.data = raw ? normalizeData(raw) : null;
        }
        fc.dataErr = "";
      } catch (e) { fc.data = null; fc.dataErr = e && e.modNoData ? t("mod.p.accounts.data") + " : " + t("mod.denied") : aqErrText(e); }
    })()
  ]);
  if (my !== fc.token) return;
  try { fc.view = fc.data ? fcCompute(fc.data) : null; } catch (e) { fc.view = null; fc.dataErr = t("admin.err"); }
  fc.loading = false;
  fcRerender();
}

// --- Calculs (navigateur de l'admin, ce compte seulement) ---
function fcCompute(d) {
  return fcWith(d, () => {
    const cards = arr(d.cards), listIds = new Set(arr(d.lists).map(l => l.id));
    const v = { folders: arr(d.folders).length, lists: arr(d.lists).length, cards: cards.length, types: {}, boxes: [0, 0, 0, 0, 0, 0],
      targets: {}, gaps: 0, proposals: arr(d.proposals).length, missed: [], tenses: [], blocked: [] };
    CARD_TYPES.forEach(ty => { v.types[ty] = [0, 0, 0, 0, 0, 0]; });
    const tense = new Map();
    cards.forEach(c => {
      const ty = cardType(c), b = Math.max(0, Math.min(5, Math.round(num(c.box, 0))));
      v.types[ty][b]++; v.boxes[b]++;
      const lg = listIds.has(c.listId) ? cardLangs(c) : null;
      const tg = ty === "vocab" ? (lg && lg.target) : (c.lang || (lg && lg.target));
      if (tg) v.targets[tg] = (v.targets[tg] || 0) + 1;
      if (lg && gapFields(c, lg).length) v.gaps++;
      const s = c.stats || {}, seen = num(s.seen, 0), ok = num(s.correct, 0), wrong = num(s.wrong, 0);
      if (b === 0 && seen >= FC_BLOCKED_SEEN && ok === 0) v.blocked.push(c);
      if (wrong > 0) v.missed.push(c);
      if (ty === "conj" && c.tense) {
        const k = (c.lang || "") + "|" + c.tense;
        const x = tense.get(k) || { lang: c.lang, tense: c.tense, cards: 0, seen: 0, correct: 0, wrong: 0 };
        x.cards++; x.seen += seen; x.correct += ok; x.wrong += wrong;
        tense.set(k, x);
      }
    });
    const wr = c => num((c.stats || {}).wrong, 0), sn = c => num((c.stats || {}).seen, 0);
    const line = c => ({ id: c.id, type: cardType(c), title: cardTitle(c), sub: cardSubtitle(c), list: (getList(c.listId) || {}).name || "?",
      wrong: wr(c), seen: sn(c), correct: num((c.stats || {}).correct, 0), box: num(c.box, 0) });
    v.missed = v.missed.sort((a, b) => wr(b) - wr(a) || sn(b) - sn(a)).slice(0, 20).map(line);
    v.blocked = v.blocked.sort((a, b) => sn(b) - sn(a)).map(line);
    v.tenses = Array.from(tense.values()).filter(x => x.wrong > 0)
      .sort((a, b) => b.wrong - a.wrong || b.seen - a.seen).slice(0, 10)
      .map(x => Object.assign(x, { name: tenseName(x.lang, x.tense) }));
    // Série (étape 28) : clé streak du compte (sinon calculée depuis history par normalizeData, comme la migration),
    // vue aujourd'hui : jours manqués pas encore traités par l'appli du compte couverts par les gels, sinon série perdue.
    const sk = streakEffective(d.streak || normStreak(null, d.history), todayStr());
    v.streak = sk.current; v.best = sk.best; v.freezes = sk.freezes; v.lost = sk.lost;
    v.goal = clampInt(d.settings && d.settings.dailyGoal, 5, 100, 10);
    v.valid = new Set(sk.validDays);
    v.adjustments = arr(sk.adjustments).slice().reverse();
    v.uiLang = (d.settings && d.settings.uiLang) || "";
    v.langs = Object.keys(v.targets).filter(isLang);
    arr(d.lists).forEach(l => { const tg = listLangs(l).target; if (!v.langs.includes(tg)) v.langs.push(tg); });
    learningOf(d.settings).forEach(x => { if (!v.langs.includes(x.lang)) v.langs.push(x.lang); });   // profil de langues (étape 35)
    v.frozen = new Set(sk.frozenDays);   // jours gelés (étape 28)
    // XP (étape 43) : morceau xp du compte (sinon XP de départ calculé depuis history, comme la migration)
    const x = d.xp || normXp(null, d.history, sk, d.settings);
    v.xp = { total: x.total, week: xpWeek(x).total, level: xpLevel(x.total), chDone: x.chDone, chDays: x.chDays.length, badges: x.badges.length };
    return v;
  });
}
function fcRate(ok, seen) { return seen > 0 ? dashRate(Math.round(1000 * Math.min(ok, seen) / seen) / 10) : "—"; }
function fcDash(v) { return v == null || v === "" ? "—" : String(v); }
function fcKb(bytes) { const kb = num(Number(bytes), 0) / 1024; try { return kb.toLocaleString(state.settings.uiLang, { maximumFractionDigits: kb < 10 ? 1 : 0 }) + " " + t("fc.kb"); } catch (e) { return Math.round(kb) + " Ko"; } }
function fcLastActivity() {
  const a = fc.sum && fc.sum.account, cands = [];
  if (a) { if (a.last_day) cands.push(Date.parse(a.last_day + "T12:00:00")); [a.last_seen_at, a.last_sign_in_at].forEach(x => { if (x) cands.push(Date.parse(x)); }); }
  else if (fc.acc && fc.acc.last_login) cands.push(Date.parse(fc.acc.last_login));
  const m = cands.filter(x => !isNaN(x));
  return m.length ? new Date(Math.max(...m)).toISOString() : null;
}
function fcIdent() { return (fc.sum && fc.sum.account && fc.sum.account.identifiant) || (fc.acc && fc.acc.identifiant) || "?"; }
function fcAccountObj() {
  return fc.acc || { user_id: fc.user, identifiant: fcIdent(), created_at: fc.sum && fc.sum.account && fc.sum.account.created_at };
}

// --- Affichage ---
function renderAdminFiche() {
  const root = $("#screen-adminfiche");
  if (!root) return;
  root.textContent = "";
  const back = el("button", "link-btn", t("aq.back"));
  back.addEventListener("click", () => { location.hash = "#" + HASH_OF[SCREENS.includes(fc.from) && fc.from !== "adminfiche" ? fc.from : "adminacc"]; });
  root.appendChild(back);
  if (!fc.user) { root.appendChild(el("div", "empty", t("fc.none"))); return; }
  if (!fc.started) { fcLoad(); return; }
  const top = el("div", "adm-top");
  top.appendChild(el("h2", null, t("fc.title", { id: fcIdent() })));
  const ref = el("button", "link-btn", t("admin.refresh"));
  ref.addEventListener("click", () => { fc.started = false; renderAdminFiche(); });
  top.appendChild(ref);
  root.appendChild(top);
  if (fc.loading) {
    const ld = el("div", "card fc-loading");
    ld.append(el("span", "fc-spin"), el("span", null, t("fc.loading", { id: fcIdent() })));
    root.appendChild(ld);
    return;
  }
  if (fc.missing) root.appendChild(el("div", "card q-err", t("fc.missing")));
  if (fc.sum === null && !fc.part.sum && !fc.acc) { root.appendChild(el("div", "empty", t("fc.gone"))); return; }
  // Liens et actions
  const nav = el("div", "fc-nav");
  const btn = (label, on, cls) => { const b = el("button", "btn" + (cls ? " " + cls : ""), label); b.type = "button"; b.addEventListener("click", on); nav.appendChild(b); return b; };
  modGate(btn(t("fc.journal"), () => { al.f.user = fc.user; al.f.kind = ""; al.f.days = ""; al.page = 0; al.data = null; al.err = ""; location.hash = "#" + HASH_OF.adminlog; }), "log.see");   // étape 66
  modGate(btn(t("fc.requests"), () => dashGoRequests(fc.user, "")), "claude.see");
  btn(t("fc.csv"), fcCsv);
  modGate(btn(t("amg.fcBtn"), () => amgOpenThread(fc.user, "adminfiche")), "msg.see");   // conversation avec ce compte (étape 53)
  btn(t("fc.actions"), () => { if (adm.list) adminActions(fcAccountObj()); else toast(t("admin.err")); });
  root.appendChild(nav);
  root.appendChild(fcHeader());
  root.appendChild(fcFriends());
  root.appendChild(fcShares());   // étape 30
  root.appendChild(fcPush());     // notifications (étape 32)
  root.appendChild(fcIdeas());    // idées proposées (étape 52)
  root.appendChild(fcReviews());
  root.appendChild(fcContent());
  root.appendChild(fcDifficulties());
  root.appendChild(fcBrowse());
  root.appendChild(fcHealth());
}
function fcSec(title, cls) {
  const s = el("section", "dash-sec fc-sec" + (cls ? " " + cls : ""));
  s.appendChild(el("h3", "fc-h", title));
  return s;
}
function fcDl(pairs) {
  const dl = el("dl", "fc-dl");
  pairs.forEach(([k, v]) => { dl.append(el("dt", null, k), v instanceof Node ? (() => { const dd = el("dd"); dd.appendChild(v); return dd; })() : el("dd", null, fcDash(v))); });
  return dl;
}
function fcTable(head, rows, numFrom, foot) {
  const wrap = el("div", "aq-tablewrap");
  const tb = el("table", "aq-table fc-table");
  const thead = el("thead"), hr = el("tr");
  head.forEach((h, i) => hr.appendChild(el("th", i >= numFrom ? "num" : null, h)));
  thead.appendChild(hr); tb.appendChild(thead);
  const body = el("tbody");
  const addRow = (r, cls, parent) => {
    const tr = el("tr", cls || null);
    r.forEach((c, i) => tr.appendChild(el("td", i >= numFrom ? "num" : (i === 0 ? "fc-wrap" : null), typeof c === "number" ? dashFmt(c) : String(c == null ? "" : c))));
    parent.appendChild(tr);
  };
  rows.forEach(r => addRow(r, null, body));
  tb.appendChild(body);
  if (foot) { const tf = el("tfoot"); addRow(foot, "aq-total", tf); tb.appendChild(tf); }
  wrap.appendChild(tb);
  return wrap;
}
function fcLangsText(codes) { return arr(codes).length ? arr(codes).map(c => langName(c)).join(", ") : "—"; }

// En-tête
function fcHeader() {
  const sec = fcSec(t("fc.header"), "fc-head");
  const a = (fc.sum && fc.sum.account) || {}, v = fc.view;
  const tags = el("div", "adm-tags");
  if (fc.user === auth.sbUid) tags.appendChild(el("span", "tag", t("admin.you")));
  if (a.is_admin || (fc.acc && fc.acc.est_admin)) tags.appendChild(el("span", "tag", t("admin.isAdmin")));
  if (a.must_change_pin || (fc.acc && fc.acc.pin_a_changer)) tags.appendChild(el("span", "tag warn", t("admin.mustChange")));
  const bk = adm.blocked && adm.blocked[fc.user];
  const blocked = a.blocked === true || (a.blocked == null && !!bk);
  const reason0 = a.blocked_reason || (bk && bk.reason) || "";
  const state0 = a.blocked == null && !fc.sum && !bk ? "—" : blocked ? t("fc.blocked") + (reason0 ? " — " + reason0 : "") : t("fc.active");
  if (blocked) tags.appendChild(el("span", "tag bad", t("blk.tag")));   // étape 27
  if (tags.childNodes.length) sec.appendChild(tags);
  const devs = fc.sum ? arr(fc.sum.devices) : null;
  let devNode = "—";
  if (devs) {
    devNode = el("div", "fc-devs");
    if (!devs.length) devNode.appendChild(el("span", "muted", t("al.noDevice")));
    devs.forEach(d => {
      const row = el("div", "fc-dev");
      row.appendChild(el("div", null, [t("al.dev." + (d.type || "desktop")), d.os, d.browser].filter(Boolean).join(" · ")));
      row.appendChild(el("div", "muted fc-small", [d.installed ? t("al.installed") : t("al.browser"), d.app_version ? "v" + d.app_version : "", d.ui_lang ? String(d.ui_lang).toUpperCase() : "",
        t("fc.devSeen", { d: alTime(d.last_seen) })].filter(Boolean).join(" · ")));
      devNode.appendChild(row);
    });
  }
  sec.appendChild(fcDl([
    [t("aq.f.account"), fcIdent()],
    [t("dash.c.created"), admDate(a.created_at || (fc.acc && fc.acc.created_at))],
    [t("fc.lastAct"), fcLastActivity() ? admDate(fcLastActivity()) : "—"],
    [t("fc.state"), state0],
    [t("fc.streak"), v ? t("fc.days", { n: v.streak }) : "—"],
    [t("fc.best"), v ? t("fc.days", { n: v.best }) : "—"],
    [t("fc.freezes"), v ? v.freezes + " / " + STREAK_MAX_FREEZES : "—"],
    [t("fc.goal"), v ? t("sk.goalCards", { n: v.goal }) : "—"],
    [t("xp.fc.xp"), fcXp() ? t("xp.fc.xpVal", { t: dashFmt(fcXp().total), w: dashFmt(fcXp().week) }) : "—"],   // étape 43
    [t("xp.fc.level"), fcXp() ? String(fcXp().level) : "—"],
    [t("xp.fc.ch"), fcXp() ? t("xp.fc.chVal", { n: dashFmt(fcXp().chDone), d: dashFmt(fcXp().chDays) }) : "—"],
    [t("fc.uiLang"), v && v.uiLang ? langName(v.uiLang) : "—"],
    [t("fc.langs"), v ? fcLangsText(v.langs) : "—"],
    [t("fc.devices"), devNode],
    [t("fc.friends"), fc.friends ? t("am.fc.count", { n: arr(fc.friends.friends).length,
      p: arr(fc.friends.incoming).length + arr(fc.friends.outgoing).length }) : "—"]
  ]));
  if (v) {
    if (v.lost && v.streak === 0) sec.appendChild(el("p", "q-note", t("sk.fcLost", { n: v.lost.value, d: v.lost.day ? dashBucketLabel(v.lost.day, false, true) : "?" })));
    sec.appendChild(el("p", "q-note", t(fc.skStored ? "fc.streakNote" : "sk.fcNoKey")));
    // Modifications de la série par l'admin (clé streak, adjustments), les plus récentes d'abord
    if (v.adjustments.length) {
      sec.appendChild(el("h4", "fc-h4", t("sk.adjTitle")));
      v.adjustments.slice(0, 10).forEach(a => {
        const row = el("div", "sk-adj");
        row.appendChild(el("div", null, skAdjLabel(a)));
        row.appendChild(el("div", "muted fc-small", [a.at ? alTime(a.at) : "", a.by, t(a.seen ? "sk.adjSeen" : "sk.adjUnseen")].filter(Boolean).join(" · ")));
        if (a.reason) row.appendChild(el("div", "muted fc-small", t("al.s.reason", { r: a.reason })));
        sec.appendChild(row);
      });
    }
  }
  return sec;
}
// XP du compte (étape 43) : fonction admin_account_xp (script de l'étape 43), sinon calcul depuis ses données.
function fcXp() {
  const x = fc.xp;
  if (x && typeof x === "object" && x.total != null) {
    return { total: num(Number(x.total), 0), week: num(Number(x.week), 0), level: num(Number(x.level), 1),
      chDone: num(Number(x.challenges_done), 0), chDays: num(Number(x.full_days), 0) };
  }
  return fc.view && fc.view.xp ? fc.view.xp : null;
}
// Amis (étape 29) : amis, demandes en attente (reçues / envoyées), blocages.
function fcFriends() {
  const sec = fcSec(t("am.fc.title"), "fc-friends");
  if (!fc.friends) { sec.appendChild(el("p", "q-note", fc.friendsErr || "—")); return sec; }
  const f = fc.friends;
  const people = (list, dateKey) => {
    const a = arr(list);
    if (!a.length) return el("span", "muted", t("am.fc.none"));
    const box = el("div", "am-fc-list");
    a.forEach(x => {
      const b = el("button", "link-btn am-fc-who", x.identifiant + (x[dateKey] ? " · " + admDate(x[dateKey]) : ""));
      b.type = "button";
      b.addEventListener("click", () => openAccountFiche(x.user_id, fc.from));
      box.appendChild(b);
    });
    return box;
  };
  sec.appendChild(fcDl([
    [t("am.fc.friends") + " (" + arr(f.friends).length + ")", people(f.friends, "since")],
    [t("am.fc.incoming") + " (" + arr(f.incoming).length + ")", people(f.incoming, "created_at")],
    [t("am.fc.outgoing") + " (" + arr(f.outgoing).length + ")", people(f.outgoing, "created_at")],
    [t("am.fc.blocked"), people(f.blocked, "at")],
    [t("am.fc.blockedBy"), people(f.blocked_by, "at")]
  ]));
  return sec;
}
function skAdjLabel(a) {
  if (a.kind === "freezes") return t("sk.adm.freezesDone", { d: (a.delta > 0 ? "+" : "") + a.delta, n: a.freezes });
  return t(a.kind === "restore" ? "sk.adm.restoreDone" : "sk.adm.setDone", { b: a.before ? a.before.current : "?", n: a.value });
}

// Révisions
function fcReviews() {
  const sec = fcSec(t("fc.reviews"));
  const s = fc.sum;
  if (!s) { sec.appendChild(el("div", "card q-err", fc.part.sum || t("fc.missing"))); return sec; }
  const P = s.periods || {}, cols = [["d7", "dash.p7"], ["d30", "dash.p30"], ["all", "fc.pAll"]];
  const g = (k, f) => num(Number((P[k] || {})[f]), 0);
  const rows = [
    [t("dash.col.sessions"), ...cols.map(([k]) => g(k, "sessions"))],
    [t("dash.col.reviewed"), ...cols.map(([k]) => g(k, "reviewed"))],
    [t("dash.col.rate"), ...cols.map(([k]) => fcRate(g(k, "correct"), g(k, "reviewed")))],
    [t("fc.activeDays"), ...cols.map(([k]) => g(k, "active_days"))],
    [t("dash.col.minutes"), ...cols.map(([k]) => g(k, "minutes"))]
  ];
  sec.appendChild(fcTable([""].concat(cols.map(([, l]) => t(l))), rows, 1));
  sec.appendChild(el("p", "q-note", s.log_since ? t("fc.logSince", { d: admDate(s.log_since) }) : t("fc.noLog")));
  sec.appendChild(fcCalendar(s.calendar || {}));
  sec.appendChild(fcHours(arr(s.hours)));
  // Modes utilisés
  sec.appendChild(el("h4", "fc-h4", t("fc.modes")));
  const modes = arr(s.modes);
  if (!modes.length) sec.appendChild(el("p", "muted", t("dash.noData")));
  else sec.appendChild(fcTable([t("review.mode"), t("dash.col.sessions"), t("dash.col.reviewed")],
    modes.map(m => [I18N.fr["mode." + m.mode] ? t("mode." + m.mode) : String(m.mode || "?"), dashNum(m.sessions), dashNum(m.cards)]), 1));
  return sec;
}
// Calendrier des 12 dernières semaines : une colonne par semaine (lundi → dimanche), couleur selon les cartes révisées.
function fcLevel(n) { return n <= 0 ? 0 : n < 10 ? 1 : n < 30 ? 2 : n < 60 ? 3 : 4; }
// o (étape 28, facultatif) : { frozen: Set, valid: Set (objectif atteint), store: objet où garder la légende touchée (cap),
//   line: (n, sessions) → texte d'un jour actif }. Sans o : fiche du compte (fc).
function fcCalendar(cal, o) {
  o = o || { frozen: fc.view && fc.view.frozen, valid: fc.view && fc.view.valid, store: fc };
  const store = o.store || {};
  const box = el("div", "card fc-cal");
  box.appendChild(el("div", "dash-ch-title", t("fc.calendar")));
  const cap = el("div", "dash-ch-cap", store.cap || t("fc.calTap"));
  box.appendChild(cap);
  const from = dashBucketDate(cal.from), to = dashBucketDate(cal.to);
  if (isNaN(from) || isNaN(to)) { box.appendChild(el("p", "muted", "—")); return box; }
  const byDay = new Map(arr(cal.days).map(x => [String(x.day).slice(0, 10), x]));
  const frozen = o.frozen || new Set(), valid = o.valid || new Set();
  const wrap = el("div", "fc-cal-wrap");
  const lab = el("div", "fc-cal-days");
  [0, 2, 4, 6].forEach(i => {     // lun, mer, ven, dim
    const d = new Date(2024, 0, 1 + i);          // 1er janvier 2024 = lundi
    const s = el("span", null, (() => { try { return d.toLocaleDateString(state.settings.uiLang, { weekday: "narrow" }); } catch (e) { return ""; } })());
    s.style.gridRow = String(i + 1);
    lab.appendChild(s);
  });
  wrap.appendChild(lab);
  const grid = el("div", "fc-cal-grid");
  for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
    const k = todayStr(d), x = byDay.get(k), n = x ? dashNum(x.reviewed) : 0, ses = x ? dashNum(x.sessions) : 0;
    const lvl = Math.max(fcLevel(n), ses > 0 ? 1 : 0);
    const c = el("button", "fc-day l" + lvl + (frozen.has(k) ? " frozen" : "") + (valid.has(k) ? " valid" : "") + (k === todayStr() ? " today" : ""));
    c.type = "button";
    c.dataset.day = k;
    const line = lvl ? (o.line ? o.line(n, ses) : t("fc.calLine", { n, s: ses })) : t("fc.calNone");
    const txt = dashBucketLabel(k, false, true) + " : " + (frozen.has(k) ? t("fc.frozen") : line + (valid.has(k) ? " · " + t("sk.calGoal") : ""));
    c.title = txt; c.setAttribute("aria-label", txt);
    c.addEventListener("click", () => { store.cap = txt; cap.textContent = txt; });
    grid.appendChild(c);
  }
  wrap.appendChild(grid);
  box.appendChild(wrap);
  const leg = el("div", "fc-legend");
  leg.appendChild(el("span", "muted", t("fc.less")));
  [0, 1, 2, 3, 4].forEach(l => leg.appendChild(el("span", "fc-day l" + l)));
  leg.appendChild(el("span", "muted", t("fc.more")));
  leg.appendChild(el("span", "fc-day frozen"));
  leg.appendChild(el("span", "muted", t("fc.frozen")));
  leg.appendChild(el("span", "fc-day l1 valid"));
  leg.appendChild(el("span", "muted", t("sk.calGoal")));
  box.appendChild(leg);
  return box;
}
// Heures habituelles : sessions par heure (journal, heure de l'appareil de l'admin)
function fcHours(hours) {
  const box = el("div", "card fc-hours");
  const total = hours.reduce((m, h) => m + dashNum(h.sessions), 0);
  const head = el("div", "dash-ch-head");
  head.append(el("div", "dash-ch-title", t("fc.hours")), el("div", "dash-ch-total", t("fc.nSessions", { n: dashFmt(total) })));
  box.appendChild(head);
  const cap = el("div", "dash-ch-cap", total ? t("fc.hoursTap") : t("dash.noData"));
  box.appendChild(cap);
  if (!total) return box;
  const max = Math.max(1, ...hours.map(h => dashNum(h.sessions)));
  const bars = el("div", "fc-bars");
  for (let i = 0; i < 24; i++) {
    const h = hours.find(x => dashNum(x.h) === i) || { sessions: 0, cards: 0 };
    const b = el("button", "fc-bar");
    b.type = "button";
    const fill = el("span");
    fill.style.height = Math.round(100 * dashNum(h.sessions) / max) + "%";
    b.appendChild(fill);
    const txt = t("fc.hourLine", { h: String(i).padStart(2, "0"), n: dashNum(h.sessions), c: dashNum(h.cards) });
    b.title = txt; b.setAttribute("aria-label", txt);
    b.addEventListener("click", () => { cap.textContent = txt; bars.querySelectorAll(".fc-bar.sel").forEach(x => x.classList.remove("sel")); b.classList.add("sel"); });
    bars.appendChild(b);
  }
  box.appendChild(bars);
  const ax = el("div", "fc-bars-ax");
  ["0", "6", "12", "18", "23"].forEach(x => ax.appendChild(el("span", null, x + " h")));
  box.appendChild(ax);
  return box;
}

// Contenu
function fcContent() {
  const sec = fcSec(t("fc.content"));
  const v = fc.view;
  if (!v) { sec.appendChild(el("div", fc.dataErr ? "card q-err" : "empty dash-empty", fc.dataErr || t("admin.noData"))); return sec; }
  const grid = el("div", "dash-kpis");
  const tile = (label, value) => { const c = el("div", "dash-tile"); c.append(el("div", "dash-tl", label), el("div", "dash-tv", typeof value === "number" ? dashFmt(value) : String(value))); grid.appendChild(c); };
  tile(t("fc.folders"), v.folders); tile(t("fc.lists"), v.lists); tile(t("fc.cards"), v.cards);
  tile(t("fc.gaps"), v.gaps); tile(t("fc.pending"), v.proposals); tile(t("fc.shared"), fcSharedCount());
  sec.appendChild(grid);
  sec.appendChild(el("h4", "fc-h4", t("fc.byTypeBox")));
  const head = [t("fc.type")].concat([0, 1, 2, 3, 4, 5].map(b => t("fc.box", { n: b })), [t("fc.total")]);
  const rows = CARD_TYPES.filter(ty => v.types[ty].some(n => n > 0)).map(ty => [t("type." + ty)].concat(v.types[ty], [v.types[ty].reduce((m, n) => m + n, 0)]));
  sec.appendChild(fcTable(head, rows, 1, [t("fc.total")].concat(v.boxes, [v.cards])));
  sec.appendChild(el("p", "q-note", t("fc.boxNote")));
  sec.appendChild(el("h4", "fc-h4", t("fc.byLang")));
  const langs = Object.keys(v.targets).sort((a, b) => v.targets[b] - v.targets[a]);
  if (!langs.length) sec.appendChild(el("p", "muted", "—"));
  else sec.appendChild(fcTable([t("fc.lang"), t("fc.cards")], langs.map(c => [langName(c), v.targets[c]]), 1));
  return sec;
}

// Difficultés
function fcCardLine(x, extra) {
  const r = el("div", "fc-cline");
  const m = el("div", "fc-cmain");
  m.appendChild(el("div", "fc-ct", (TYPE_ICON[x.type] || "") + " " + x.title));
  const sub = [x.sub, x.list].filter(Boolean).join(" · ");
  if (sub) m.appendChild(el("div", "muted fc-small", sub));
  r.append(m, el("div", "fc-cnum", extra));
  return r;
}
function fcDifficulties() {
  const sec = fcSec(t("fc.diff"));
  const v = fc.view;
  if (!v) { sec.appendChild(el("div", "empty dash-empty", "—")); return sec; }
  sec.appendChild(el("h4", "fc-h4", t("fc.missed")));
  if (!v.missed.length) sec.appendChild(el("p", "muted", t("stats.noMissed")));
  else { const b = el("div", "card fc-clist"); v.missed.forEach(x => b.appendChild(fcCardLine(x, t("stats.missedCount", { w: x.wrong, s: x.seen })))); sec.appendChild(b); }
  sec.appendChild(el("h4", "fc-h4", t("fc.tenses")));
  if (!v.tenses.length) sec.appendChild(el("p", "muted", t("dash.noData")));
  else sec.appendChild(fcTable([t("fc.tense"), t("fc.wrong"), t("fc.seen"), t("dash.col.rate"), t("fc.cards")],
    v.tenses.map(x => [x.name + (x.lang ? " (" + String(x.lang).toUpperCase() + ")" : ""), x.wrong, x.seen, fcRate(x.correct, x.seen), x.cards]), 1));
  sec.appendChild(el("h4", "fc-h4", t("fc.blocked0", { n: v.blocked.length })));
  sec.appendChild(el("p", "q-note", t("fc.blockedNote", { n: FC_BLOCKED_SEEN })));
  if (!v.blocked.length) sec.appendChild(el("p", "muted", t("fc.noBlocked")));
  else {
    const b = el("div", "card fc-clist fc-blocked");
    v.blocked.slice(0, 100).forEach(x => b.appendChild(fcCardLine(x, t("fc.seenN", { n: x.seen }))));
    if (v.blocked.length > 100) b.appendChild(el("p", "muted", t("fc.andMore", { n: v.blocked.length - 100 })));
    sec.appendChild(b);
  }
  return sec;
}

// Voir ses listes (lecture seule) : dossiers → listes → cartes, avec recherche
function fcBrowse() {
  const sec = fcSec(t("fc.browse"));
  const d = fc.data;
  const acts = el("div", "fc-acts");
  const a = fcAccountObj();
  const cp = el("button", "btn", t("admin.copy"));
  cp.type = "button"; cp.disabled = !d || !arr(d.lists).length || !adm.list || adm.list.length < 2;
  cp.addEventListener("click", () => adminCopy(a));
  const ex = el("button", "btn", t("admin.export"));
  ex.type = "button"; ex.disabled = !d;
  ex.addEventListener("click", () => adminExport(a));
  acts.append(cp, ex);
  sec.appendChild(acts);
  if (!d) { sec.appendChild(el("div", "empty dash-empty", fc.dataErr || t("admin.noData"))); return sec; }
  sec.appendChild(el("p", "q-note", t("fc.readOnly")));
  const inp = el("input", "input fc-search");
  inp.type = "search"; inp.value = fc.q; inp.placeholder = t("fc.search");
  inp.setAttribute("aria-label", t("fc.search"));
  sec.appendChild(inp);
  const out = el("div", "fc-tree");
  sec.appendChild(out);
  const draw = () => { out.textContent = ""; fcWith(d, () => (fc.q.trim() ? fcSearchResults(d, out) : fcTree(d, out))); };
  let tm = null;
  inp.addEventListener("input", () => { clearTimeout(tm); tm = setTimeout(() => { fc.q = inp.value; draw(); }, 200); });
  draw();
  return sec;
}
function fcCardRow(c) {
  const r = el("div", "fc-card");
  const m = el("div", "fc-cmain");
  m.appendChild(el("div", "fc-ct", TYPE_ICON[cardType(c)] + " " + cardTitle(c)));
  const sub = cardSubtitle(c);
  if (sub) m.appendChild(el("div", "muted fc-small", sub));
  const miss = missingSupport(c);                    // langues d'appui calculées (étape 31)
  if (miss.length) m.appendChild(el("span", "tag warn", t("card.toFill", { langs: miss.map(x => langName(x)).join(", ") })));
  const s = c.stats || {};
  r.append(m, el("div", "fc-cnum", t("fc.box", { n: num(c.box, 0) }) + " · " + num(s.correct, 0) + "/" + num(s.seen, 0)));
  return r;
}
function fcListBlock(d, l) {
  const cards = arr(d.cards).filter(c => c.listId === l.id);
  const det = el("details", "fc-list");
  det.open = !!fc.open["l:" + l.id];
  const sm = el("summary");
  sm.append(el("span", "fc-ln", "📄 " + l.name), el("span", "muted fc-small", t("fc.nCards", { n: cards.length }) + " · " + pairLabel(listLangs(l))));
  det.appendChild(sm);
  const body = el("div", "fc-cards");
  det.appendChild(body);
  const fill = () => {
    if (body.childNodes.length) return;
    fcWith(d, () => {
      if (!cards.length) body.appendChild(el("p", "muted", t("fc.noCards")));
      cards.forEach(c => body.appendChild(fcCardRow(c)));
    });
  };
  if (det.open) fill();
  det.addEventListener("toggle", () => { fc.open["l:" + l.id] = det.open; if (det.open) fill(); });
  return det;
}
function fcTree(d, out) {
  const byOrder = (x, y) => num(x.order, 0) - num(y.order, 0);
  const folders = arr(d.folders).slice().sort(byOrder);
  folders.forEach(f => {
    const lists = arr(d.lists).filter(l => l.folderId === f.id).sort(byOrder);
    const det = el("details", "fc-folder");
    det.open = fc.open["f:" + f.id] !== false;
    const sm = el("summary");
    sm.append(el("span", "fc-ln", "📁 " + f.name), el("span", "muted fc-small", t("fc.nLists", { n: lists.length })));
    det.appendChild(sm);
    if (!lists.length) det.appendChild(el("p", "muted fc-small", t("fc.noLists")));
    lists.forEach(l => det.appendChild(fcListBlock(d, l)));
    det.addEventListener("toggle", () => { fc.open["f:" + f.id] = det.open; });
    out.appendChild(det);
  });
  const loose = arr(d.lists).filter(l => !l.folderId || !folders.some(f => f.id === l.folderId)).sort(byOrder);
  if (loose.length) {
    if (folders.length) out.appendChild(el("div", "hint", t("admin.noFolder")));
    loose.forEach(l => out.appendChild(fcListBlock(d, l)));
  }
  if (!folders.length && !loose.length) out.appendChild(el("p", "muted", t("fc.noLists")));
}
function fcSearchResults(d, out) {
  const q = normText(fc.q);
  const found = arr(d.cards).filter(c => { try { return cardMatches(c, q); } catch (e) { return false; } });
  out.appendChild(el("p", "muted", t("fc.found", { n: found.length })));
  const byList = new Map();
  found.slice(0, FC_SEARCH_MAX).forEach(c => { if (!byList.has(c.listId)) byList.set(c.listId, []); byList.get(c.listId).push(c); });
  byList.forEach((cs, lid) => {
    const l = getList(lid), f = l && l.folderId ? getFolder(l.folderId) : null;
    out.appendChild(el("div", "fc-res-h", (f ? "📁 " + f.name + " › " : "") + "📄 " + (l ? l.name : "?")));
    cs.forEach(c => out.appendChild(fcCardRow(c)));
  });
  if (found.length > FC_SEARCH_MAX) out.appendChild(el("p", "muted", t("fc.andMore", { n: found.length - FC_SEARCH_MAX })));
}

// Santé des données
function fcHealth() {
  const sec = fcSec(t("fc.health"));
  const st = fc.store;
  if (!st) { sec.appendChild(el("div", "card q-err", fc.part.store || t("fc.missing"))); }
  else {
    const rows = arr(st.rows), big = rows[0];
    const limit = num(Number(st.limit_kb), FC_LIMIT_KB) * 1024, warn = num(Number(st.warn_kb), FC_WARN_KB) * 1024;
    const bigB = big ? dashNum(big.bytes) : 0;
    const bar = el("div", "fc-meter");
    const fill = el("span", bigB > warn ? "bad" : "");
    fill.style.width = Math.min(100, Math.round(100 * bigB / limit)) + "%";
    bar.appendChild(fill);
    const bigNode = el("div");
    bigNode.append(el("div", null, big ? big.key + " — " + fcKb(bigB) + " / " + fcKb(limit) + " (" + Math.round(100 * bigB / limit) + " %)" : "—"), bar);
    const ver = st.version != null ? st.version : fc.version;
    sec.appendChild(fcDl([
      [t("fc.total"), fcKb(st.total_bytes) + " · " + t("fc.nChunks", { n: dashNum(st.count) })],
      [t("fc.biggest"), bigNode],
      [t("fc.lastSync"), st.last_update ? alTime(st.last_update) : "—"],
      [t("fc.version"), ver == null ? "—" : String(ver) + (Number(ver) < DATA_VERSION ? " " + t("fc.versionOld", { v: DATA_VERSION }) : "")]
    ]));
    const over = rows.filter(r => dashNum(r.bytes) > warn);
    if (over.length) sec.appendChild(el("div", "card q-err", t("fc.bigWarn", { n: over.length, kb: FC_WARN_KB })));
    sec.appendChild(el("h4", "fc-h4", t("fc.chunks")));
    if (rows.length) {
      const wrap = fcTable([t("fc.chunk"), t("fc.size"), t("fc.updated")], rows.map(r => [r.key, fcKb(r.bytes), r.updated_at ? alTime(r.updated_at) : ""]), 1);
      wrap.classList.add("fc-scroll");
      rows.forEach((r, i) => { if (dashNum(r.bytes) > warn) { const tr = wrap.querySelectorAll("tbody tr")[i]; if (tr) tr.classList.add("fc-warnrow"); } });
      sec.appendChild(wrap);
    } else sec.appendChild(el("p", "muted", t("admin.noData")));
  }
  // Images du compte (étape 49) : taille et nombre de fichiers (fonction admin_image_usage)
  sec.appendChild(fcDl([[t("img.fcSize"), fc.img ? t("img.fcVal", { mb: imgMb(fc.img.used), n: dashNum(fc.img.count) }) : "—"]]));
  sec.appendChild(el("h4", "fc-h4", t("fc.issues")));
  const is = fc.issues;
  if (!is) sec.appendChild(el("div", "card q-err", fc.part.issues || t("fc.missing")));
  else if (!is.length) sec.appendChild(el("p", "muted", t("fc.noIssues")));
  else {
    const b = el("div", "card fc-clist");
    is.forEach(r => {
      const line = el("div", "fc-cline");
      const m = el("div", "fc-cmain");
      m.appendChild(el("div", "fc-ct", alKindLabel(r.kind) + (alSummary(r) ? " — " + alSummary(r) : "")));
      const dv = alDevLabel(r.device);
      m.appendChild(el("div", "muted fc-small", [alTime(r.created_at), dv].filter(Boolean).join(" · ")));
      line.appendChild(m);
      b.appendChild(line);
    });
    sec.appendChild(b);
  }
  return sec;
}

// Export CSV de la fiche : une ligne par information (section ; information ; valeur).
function fcCsv() {
  const rows = [], S = (sec, k, v) => rows.push([sec, k, v == null || v === "" ? "—" : v]);
  const a = (fc.sum && fc.sum.account) || {}, v = fc.view, H = t("fc.header");
  S(H, t("aq.f.account"), fcIdent());
  S(H, t("dash.c.created"), admDay(a.created_at || (fc.acc && fc.acc.created_at)));
  S(H, t("fc.lastAct"), admDay(fcLastActivity()));
  S(H, t("fc.state"), fc.sum ? (a.blocked === true ? t("fc.blocked") : t("fc.active")) : "—");
  S(H, t("fc.streak"), v ? v.streak : "—"); S(H, t("fc.best"), v ? v.best : "—");
  S(H, t("fc.freezes"), v ? v.freezes : "—"); S(H, t("fc.goal"), v ? v.goal : "—");
  const fx = fcXp();   // étape 43
  S(H, t("xp.total"), fx ? fx.total : "—"); S(H, t("xp.week"), fx ? fx.week : "—"); S(H, t("xp.fc.level"), fx ? fx.level : "—");
  S(H, t("xp.chDone"), fx ? fx.chDone : "—"); S(H, t("xp.chDays"), fx ? fx.chDays : "—");
  S(H, t("fc.uiLang"), v && v.uiLang ? langName(v.uiLang) : "—"); S(H, t("fc.langs"), v ? fcLangsText(v.langs) : "—");
  arr(fc.sum && fc.sum.devices).forEach(d => S(H, t("fc.devices"), [t("al.dev." + (d.type || "desktop")), d.os, d.browser, d.installed ? t("al.installed") : t("al.browser"), d.app_version ? "v" + d.app_version : "", admDay(d.last_seen)].filter(Boolean).join(" · ")));
  if (fc.friends) {   // amis et demandes en attente (étape 29)
    const F = t("am.fc.title"), f = fc.friends;
    [["friends", "am.fc.friends"], ["incoming", "am.fc.incoming"], ["outgoing", "am.fc.outgoing"], ["blocked", "am.fc.blocked"], ["blocked_by", "am.fc.blockedBy"]]
      .forEach(([k, l]) => S(F, t(l) + " (" + arr(f[k]).length + ")", arr(f[k]).map(x => x.identifiant).join(", ")));
  } else S(H, t("fc.friends"), "—");
  if (fc.shares) {   // partages et invitations (étape 30)
    const SH = t("sh.fc.title"), x = fc.shares;
    arr(x.owned).forEach(o => S(SH, t("sh.fc.ownedOne") + " : " + o.name, t("lists.count", { n: num(Number(o.cards), 0) }) + " · " + arr(o.members).map(m => m.identifiant + " (" + t("sh.role." + m.role) + ")").join(", ")));
    arr(x.member_of).forEach(o => S(SH, t("sh.fc.memberOne") + " : " + o.name, o.owner_ident + " · " + t("sh.role." + o.role)));
    S(SH, t("sh.fc.sent", { n: arr(x.sent).length }), arr(x.sent).map(i => i.identifiant + " · " + i.name + " · " + t("sh.st." + i.status)).join(" | "));
    S(SH, t("sh.fc.received", { n: arr(x.received).length }), arr(x.received).map(i => i.identifiant + " · " + i.name + " · " + t("sh.st." + i.status)).join(" | "));
  }
  if (fc.sum) {
    const R = t("fc.reviews"), P = fc.sum.periods || {};
    [["d7", "dash.p7"], ["d30", "dash.p30"], ["all", "fc.pAll"]].forEach(([k, l]) => {
      const p = P[k] || {}, g = f => num(Number(p[f]), 0), per = " (" + t(l) + ")";
      S(R, t("dash.col.sessions") + per, g("sessions"));
      S(R, t("dash.col.reviewed") + per, g("reviewed"));
      S(R, t("dash.col.rate") + per, g("reviewed") ? dashRateCsv(Math.round(1000 * Math.min(g("correct"), g("reviewed")) / g("reviewed")) / 10) : "—");
      S(R, t("fc.activeDays") + per, g("active_days"));
      S(R, t("dash.col.minutes") + per, g("minutes"));
    });
    arr(fc.sum.hours).filter(h => dashNum(h.sessions) > 0).forEach(h => S(R, t("fc.hours") + " " + String(h.h).padStart(2, "0") + " h", dashNum(h.sessions)));
    arr(fc.sum.modes).forEach(m => S(R, t("fc.modes") + " : " + (I18N.fr["mode." + m.mode] ? t("mode." + m.mode) : m.mode), dashNum(m.sessions)));
  }
  if (v) {
    const C = t("fc.content");
    S(C, t("fc.folders"), v.folders); S(C, t("fc.lists"), v.lists); S(C, t("fc.cards"), v.cards);
    CARD_TYPES.forEach(ty => { if (v.types[ty].some(n => n > 0)) v.types[ty].forEach((n, b) => S(C, t("type." + ty) + " · " + t("fc.box", { n: b }), n)); });
    v.boxes.forEach((n, b) => S(C, t("fc.total") + " · " + t("fc.box", { n: b }), n));
    Object.keys(v.targets).forEach(c => S(C, t("fc.lang") + " : " + langName(c), v.targets[c]));
    S(C, t("fc.gaps"), v.gaps); S(C, t("fc.pending"), v.proposals); S(C, t("fc.shared"), fcSharedCount());
    const D = t("fc.diff");
    v.missed.forEach((x, i) => S(D, t("fc.missed") + " " + (i + 1), [x.title, x.sub].filter(Boolean).join(" · ") + " — " + t("stats.missedCount", { w: x.wrong, s: x.seen })));
    v.tenses.forEach(x => S(D, t("fc.tenses") + " : " + x.name, t("stats.missedCount", { w: x.wrong, s: x.seen })));
    S(D, t("fc.blocked0", { n: v.blocked.length }), v.blocked.length);
    v.blocked.forEach(x => S(D, t("fc.blockedOne"), [x.title, x.sub].filter(Boolean).join(" · ") + " — " + t("fc.seenN", { n: x.seen })));
  }
  if (fc.store) {
    const Hh = t("fc.health");
    S(Hh, t("fc.total"), Math.round(dashNum(fc.store.total_bytes) / 1024) + " " + t("fc.kb"));
    S(Hh, t("fc.lastSync"), fc.store.last_update ? alTime(fc.store.last_update) : "—");
    S(Hh, t("fc.version"), fc.store.version != null ? fc.store.version : fc.version);
    if (fc.img) S(Hh, t("img.fcSize"), t("img.fcVal", { mb: imgMb(fc.img.used), n: dashNum(fc.img.count) }));   // étape 49
    arr(fc.store.rows).forEach(r => S(Hh, t("fc.chunk") + " " + r.key, Math.round(dashNum(r.bytes) / 1024) + " " + t("fc.kb") + (dashNum(r.bytes) > FC_WARN_KB * 1024 ? " ⚠" : "")));
    arr(fc.issues).forEach(r => S(Hh, alKindLabel(r.kind) + " " + admDay(r.created_at), alSummary(r)));
  }
  dashSaveCsv("fiche-" + fcIdent(), [t("fc.c.section"), t("dash.c.indicator"), t("dash.c.value")], rows);
}
