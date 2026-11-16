"use strict";

// === AMIS ===
// Étape 29. Mode Supabase seulement (script supabase-etape29.sql). Sans le script : l'écran Amis affiche
// « Lancez le script SQL de l'étape 29 », le reste de l'appli marche comme avant. Hors mode Supabase (artifact,
// navigateur sans config.js) : écran Amis avec un message, rien n'est envoyé.
// - Liens entre comptes : table friendships, changée seulement par les fonctions friend_send / friend_accept /
//   friend_decline / friend_cancel / friend_remove / friend_block / friend_unblock ; lecture : my_friends,
//   friend_incoming_count (badge du menu).
// - Résumé public : table user_public_stats (ma ligne seulement), écrite au lancement, après chaque session de
//   révision et au changement de confidentialité (Réglages → Amis). Les amis la lisent par friends_stats et
//   friends_ranking (confidentialité appliquée côté serveur). Jamais d'accès des amis à user_data.
// - Semaine = lundi → dimanche (jours locaux de l'appareil), d'après history.
// - Journal : friend_request, friend_accept, friend_remove, friend_block (data.target = identifiant de l'autre).
const FRIENDS_MAX_PENDING = 20;
const FRIENDS_POLL_MS = 300000;   // badge des demandes reçues : toutes les 5 min (et au retour au premier plan)
const PRIVACY_ORDER = ["streak", "today", "week", "success", "badges", "ranking", "shared"];

// Lundi de la semaine du jour day ("YYYY-MM-DD").
function frMonday(day) {
  const [y, m, d] = day.split("-").map(Number);
  const dow = (new Date(y, m - 1, d, 12).getDay() + 6) % 7;   // 0 = lundi
  return skAdd(day, -dow);
}
// Cartes révisées et justes depuis lundi (jours locaux).
function frWeekStats(today) {
  const mon = frMonday(today);
  let cards = 0, correct = 0;
  arr(state.history).forEach(h => {
    if (h && typeof h.date === "string" && h.date >= mon && h.date <= today) {
      cards += num(h.reviewed, 0); correct += num(h.correct, 0);
    }
  });
  return { mon, cards, correct: Math.min(correct, cards) };
}
function frDayLabel(day, opts) {
  try { const [y, m, d] = day.split("-").map(Number); return new Date(y, m - 1, d, 12).toLocaleDateString(state.settings.uiLang, opts || { day: "numeric", month: "short" }); }
  catch (e) { return String(day || ""); }
}

const Friends = (() => {
  let status = "unknown";          // unknown | ok | missing (script de l'étape 29 pas lancé)
  let incoming = 0;                // demandes reçues (badge)
  let data = null, stats = null, ranking = null, loadedAt = 0, loading = false, err = "", token = 0;
  let lastPub = "", pubBusy = null, pollTimer = null;
  const view = { input: "", rankTab: "cards", busy: false };
  function on() { return auth.mode === "supabase" && !!auth.sbUid && !!Supa.client() && !!Storage.getUser(); }
  function isMissing(e) { return alIsMissing(e); }
  async function rpc(name, args) {
    const r = await withTimeout(Supa.client().rpc(name, args || {}), 15000);
    if (r && r.error) throw r.error;
    return r ? r.data : null;
  }
  // Message d'erreur lisible (hint des fonctions SQL).
  function errText(e) {
    const hint = String((e && e.hint) || "");
    if (I18N.fr["am.err." + hint]) return t("am.err." + hint, { m: FRIENDS_MAX_PENDING });
    if (isMissing(e)) return t("am.missing");
    if (sbErrKind(e) === "net") return t("am.err.net");
    if (String((e && e.code) || "") === "42501" || /compte bloqué/i.test(String((e && e.message) || ""))) return t("am.err.account_blocked");
    return t("am.err.other");
  }

  // --- Résumé public (user_public_stats) ---
  function publicRow() {
    const today = todayStr(), s = Streak.data(), w = frWeekStats(today);
    return {
      user_id: auth.sbUid,
      streak: clampInt(s.current, 0, 100000, 0), best: clampInt(Math.max(s.best, s.current), 0, 100000, 0),
      last_valid_day: s.lastValidDay || null, freezes: clampInt(s.freezes, 0, 2, 0),
      badges: STREAK_BADGES.filter(b => s.badges.some(x => x.days === b)),
      daily_goal: Streak.goal(),
      today_day: today, today_done: Streak.doneToday(),
      week_start: w.mon, week_cards: Math.min(w.cards, 1000000), week_correct: Math.min(w.correct, w.cards, 1000000),
      privacy: normPrivacy(state.settings.privacy)
    };
  }
  // Écrit ma ligne (rien si elle n'a pas changé depuis la dernière écriture réussie). Jamais d'erreur visible.
  function publish(force) {
    if (!on() || status === "missing") return Promise.resolve(false);
    if (pubBusy) return pubBusy.then(() => publish(force));
    const row = publicRow(), key = JSON.stringify(row);
    if (!force && key === lastPub) return Promise.resolve(true);
    pubBusy = (async () => {
      try {
        const r = await withTimeout(Supa.client().from("user_public_stats").upsert(row, { onConflict: "user_id" }), 15000);
        if (r && r.error) throw r.error;
        lastPub = key; status = "ok";
        return true;
      } catch (e) { if (isMissing(e)) status = "missing"; return false; }
    })();
    return pubBusy.finally(() => { pubBusy = null; });
  }

  // --- Badge du menu : demandes reçues ---
  async function refreshBadge() {
    if (!on()) { incoming = 0; renderBadge(); return; }
    try { incoming = num(Number(await rpc("friend_incoming_count")), 0); status = "ok"; }
    catch (e) { if (isMissing(e)) { status = "missing"; incoming = 0; } }
    renderBadge();
  }
  function renderBadge() {
    const b = $("#friendsBadge");
    if (!b) return;
    const n = on() ? incoming + Shared.inviteCount() : 0;   // demandes d'amis + invitations de partage (étape 30)
    b.hidden = !n;
    b.textContent = n > 99 ? "99+" : String(n);
  }

  // --- Écran Amis : chargement ---
  async function load() {
    if (!on()) return;
    const my = ++token;
    loading = true; err = "";
    if (currentScreen === "friends") renderFriends();
    await publish(false);   // mes chiffres à jour avant le classement
    try {
      const today = todayStr();
      const [d, s, r] = await Promise.all([rpc("my_friends"), rpc("friends_stats", { p_today: today }), rpc("friends_ranking", { p_today: today }),
        Shared.loadFriendsView()]);   // invitations de partage et progression sur les listes partagées (étape 30)
      if (my !== token) return;
      data = d || { incoming: [], outgoing: [], friends: [], blocked: [] };
      stats = arr(s); ranking = r || null; status = "ok"; loadedAt = Date.now();
      incoming = arr(data.incoming).length;
    } catch (e) {
      if (my !== token) return;
      if (isMissing(e)) status = "missing";
      err = errText(e);
    }
    loading = false;
    renderBadge();
    if (currentScreen === "friends") renderFriends();
  }
  function needLoad() { return on() && !loading && (!data || Date.now() - loadedAt > 30000); }

  // --- Actions ---
  async function act(fn, okText, logKind, after) {
    if (view.busy) return;
    view.busy = true;
    if (currentScreen === "friends") renderFriends();
    try {
      const r = await fn();
      if (logKind) Activity.log(logKind, { target: String((r && r.identifiant) || "").slice(0, 40) });
      if (okText) toast(typeof okText === "function" ? okText(r) : okText);
      if (after) after(r);
    } catch (e) {
      toast(errText(e));
    }
    view.busy = false;
    await load();
  }
  function send() {
    const id = normId(view.input);
    if (!validId(id)) { toast(t("am.err.notfound")); return; }
    if (id === Storage.getUser()) { toast(t("am.err.self")); return; }
    act(() => rpc("friend_send", { p_identifiant: id }),
      r => t(r && r.result === "accepted" ? "am.nowFriends" : "am.sent", { id: (r && r.identifiant) || id }),
      null,
      r => { view.input = ""; Activity.log(r && r.result === "accepted" ? "friend_accept" : "friend_request", { target: (r && r.identifiant) || id }); });
  }
  function accept(x) { act(() => rpc("friend_accept", { p_id: x.id }), t("am.accepted", { id: x.identifiant }), "friend_accept"); }
  function decline(x) { act(() => rpc("friend_decline", { p_id: x.id }), t("am.declined", { id: x.identifiant })); }
  function cancel(x) { act(() => rpc("friend_cancel", { p_id: x.id }), t("am.canceled", { id: x.identifiant })); }
  function remove(x) {
    openModal(t("am.remove"), el("p", null, t("am.removeAsk", { id: x.identifiant })), [
      { label: t("cancel") },
      { label: t("am.remove"), kind: "danger", onClick: () => { act(() => rpc("friend_remove", { p_user: x.user_id }), t("am.removed", { id: x.identifiant }), "friend_remove"); } }
    ]);
  }
  function block(x) {
    openModal(t("am.block"), el("p", null, t("am.blockAsk", { id: x.identifiant })), [
      { label: t("cancel") },
      { label: t("am.block"), kind: "danger", onClick: () => { act(() => rpc("friend_block", { p_user: x.user_id }), t("am.blocked", { id: x.identifiant }), "friend_block"); } }
    ]);
  }
  function unblock(x) { act(() => rpc("friend_unblock", { p_user: x.user_id }), t("am.unblocked", { id: x.identifiant })); }

  // --- Lancement / arrêt ---
  function start() {
    stop();
    if (!on()) return;
    status = "unknown";
    publish(true).then(() => refreshBadge());
    pollTimer = setInterval(() => { if (on() && document.visibilityState !== "hidden") refreshBadge(); }, FRIENDS_POLL_MS);
  }
  function stop() { clearInterval(pollTimer); pollTimer = null; }
  function reset() {
    stop(); token++;
    status = "unknown"; incoming = 0; data = null; stats = null; ranking = null; loadedAt = 0; loading = false; err = "";
    lastPub = ""; view.input = ""; view.rankTab = "cards"; view.busy = false;
    renderBadge();
  }
  try {
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && on() && pollTimer) refreshBadge(); });
  } catch (e) {}
  return {
    on, publish, refreshBadge, renderBadge, load, needLoad, start, reset,
    send, accept, decline, cancel, remove, block, unblock, view,
    status: () => status, data: () => data, stats: () => stats, ranking: () => ranking, loading: () => loading, err: () => err
  };
})();

// --- Écran Amis ---
function renderFriends() {
  const root = $("#screen-friends");
  if (!root) return;
  root.textContent = "";
  const top = el("div", "adm-top");
  top.appendChild(el("h2", null, t("am.title")));
  if (Friends.on()) {
    const ref = el("button", "link-btn", t("am.refresh"));
    ref.addEventListener("click", () => Friends.load());
    top.appendChild(ref);
  }
  root.appendChild(top);
  if (!Friends.on()) { root.appendChild(el("div", "card muted", t("am.offline"))); return; }
  if (Friends.status() === "missing") { root.appendChild(el("div", "card q-err", t("am.missing"))); return; }
  if (Friends.needLoad() && !Friends.data()) { Friends.load(); return; }   // load() affiche « Chargement… »
  const d = Friends.data();
  if (!d) {
    root.appendChild(el("div", "card muted", Friends.loading() ? t("am.loading") : (Friends.err() || t("am.loading"))));
    if (!Friends.loading() && Friends.err()) {
      const b = el("button", "btn", t("am.refresh"));
      b.addEventListener("click", () => Friends.load());
      root.appendChild(b);
    }
    return;
  }
  if (Friends.needLoad()) setTimeout(() => Friends.load(), 0);   // données de plus de 30 s : rechargées
  if (Friends.err()) root.appendChild(el("div", "card q-err", Friends.err()));
  root.appendChild(amAddCard());
  const inc = arr(d.incoming);
  if (inc.length) {
    const c = el("div", "card");
    c.appendChild(el("h2", null, t("am.incoming") + " (" + inc.length + ")"));
    inc.forEach(x => c.appendChild(amPersonRow(x, queueDate(x.created_at), [
      [t("am.accept"), "primary", () => Friends.accept(x)],
      [t("am.decline"), "", () => Friends.decline(x)],
      [t("am.block"), "danger", () => Friends.block({ user_id: x.user_id, identifiant: x.identifiant })]
    ])));
    root.appendChild(c);
  }
  const shc = shInvitesCard();   // invitations de partage reçues / envoyées (étape 30)
  if (shc) root.appendChild(shc);
  const out = arr(d.outgoing);
  if (out.length) {
    const c = el("div", "card");
    c.appendChild(el("h2", null, t("am.outgoing", { n: out.length, m: FRIENDS_MAX_PENDING })));
    out.forEach(x => c.appendChild(amPersonRow(x, queueDate(x.created_at), [[t("am.cancel"), "", () => Friends.cancel(x)]])));
    root.appendChild(c);
  }
  root.appendChild(amRankingCard());
  const fr = arr(d.friends);
  const fc = el("div", "card");
  fc.appendChild(el("h2", null, t("am.friends", { n: fr.length })));
  if (!fr.length) fc.appendChild(el("p", "muted am-empty", t("am.noFriends")));
  const byId = {};
  arr(Friends.stats()).forEach(s => { byId[s.user_id] = s; });
  fr.forEach(x => fc.appendChild(amFriendBlock(x, byId[x.user_id])));
  root.appendChild(fc);
  const bl = arr(d.blocked);
  if (bl.length) {
    const c = el("div", "card");
    c.appendChild(el("h2", null, t("am.blockedTitle")));
    bl.forEach(x => c.appendChild(amPersonRow(x, admDate(x.at), [[t("am.unblock"), "", () => Friends.unblock(x)]])));
    root.appendChild(c);
  }
}
function amAddCard() {
  const c = el("div", "card");
  c.appendChild(el("h2", null, t("am.add")));
  const row = el("form", "am-add");
  const inp = el("input", "input");
  inp.type = "text"; inp.placeholder = t("am.addPh"); inp.value = Friends.view.input;
  inp.autocomplete = "off"; inp.setAttribute("autocapitalize", "none"); inp.setAttribute("autocorrect", "off"); inp.spellcheck = false;
  inp.maxLength = 40; inp.setAttribute("enterkeyhint", "send"); inp.setAttribute("aria-label", t("am.addPh"));
  inp.addEventListener("input", () => { Friends.view.input = inp.value; });
  const b = el("button", "btn primary", t("am.send"));
  b.type = "submit"; b.disabled = Friends.view.busy;
  row.addEventListener("submit", e => { e.preventDefault(); Friends.view.input = inp.value; Friends.send(); });
  row.append(inp, b);
  c.append(row, el("div", "hint", t("am.addHint")));
  return c;
}
// Ligne « personne » : identifiant, petite ligne grise, boutons [libellé, style, action].
function amPersonRow(x, sub, actions) {
  const row = el("div", "am-row");
  const who = el("div", "am-who");
  who.append(el("div", "am-id", x.identifiant || "?"), el("div", "muted am-sub", sub || ""));
  const btns = el("div", "am-btns");
  actions.forEach(([label, kind, fn]) => {
    const b = el("button", "am-btn" + (kind ? " " + kind : ""), label);
    b.type = "button"; b.disabled = Friends.view.busy;
    b.addEventListener("click", fn);
    btns.appendChild(b);
  });
  row.append(who, btns);
  return row;
}
// Un ami : stats visibles (selon sa confidentialité), Retirer, Bloquer.
function amFriendBlock(x, s) {
  const box = el("div", "am-friend");
  const head = el("div", "am-row");
  const who = el("div", "am-who");
  who.append(el("div", "am-id", x.identifiant), el("div", "muted am-sub", t("am.since", { d: admDate(x.since) })));
  head.appendChild(who);
  const fire = s && s.streak != null ? el("div", "am-fire" + (s.today_done ? " on" : ""), "🔥 " + s.streak) : null;
  if (fire) head.appendChild(fire);
  box.appendChild(head);
  const hid = el("span", "muted", t("am.hidden"));
  const val = v => v == null ? hid.cloneNode(true) : document.createTextNode(String(v));
  const dl = el("dl", "am-dl");
  const add = (k, v) => { const dd = el("dd"); dd.appendChild(v instanceof Node ? v : val(v)); dl.append(el("dt", null, k), dd); };
  if (!s || !s.published) {
    box.appendChild(el("p", "muted am-sub", t("am.notPublished")));
  } else {
    add(t("am.streak"), s.streak == null ? null : t("am.streakVal", { n: s.streak, b: s.best }));
    add(t("am.today"), s.today_done == null ? null : t(s.today_done ? "am.todayYes" : "am.todayNo"));
    add(t("am.week"), s.week_cards == null ? null : dashFmt(s.week_cards));
    add(t("am.success"), s.week_correct == null ? null : (num(Number(s.week_total), 0) > 0
      ? dashRate(Math.round(1000 * num(Number(s.week_correct), 0) / num(Number(s.week_total), 1)) / 10) : "—"));
    let bd = null;
    if (Array.isArray(s.badges)) {
      bd = el("span", "am-badges");
      if (!s.badges.length) bd.appendChild(el("span", "muted", t("am.noBadge")));
      s.badges.forEach(n => { const b = el("span", "am-badge", badgeIcon(n) + " " + t("sk.badgeName", { n })); bd.appendChild(b); });
    }
    add(t("am.badges"), bd);
  }
  add(t("am.shared"), shFriendProgress(x.user_id));   // progression sur les listes partagées avec moi (étape 30)
  box.appendChild(dl);
  const btns = el("div", "am-btns am-btns-end");
  [[t("am.remove"), "", () => Friends.remove(x)], [t("am.block"), "danger", () => Friends.block(x)]].forEach(([label, kind, fn]) => {
    const b = el("button", "am-btn" + (kind ? " " + kind : ""), label);
    b.type = "button"; b.disabled = Friends.view.busy;
    b.addEventListener("click", fn);
    btns.appendChild(b);
  });
  box.appendChild(btns);
  return box;
}
// Classement de la semaine : cartes révisées / taux de réussite (20 cartes minimum).
function amRankingCard() {
  const r = Friends.ranking();
  const c = el("div", "card");
  c.appendChild(el("h2", null, t("am.rank")));
  if (!r) { c.appendChild(el("p", "muted", "—")); return c; }
  c.appendChild(el("p", "muted am-sub am-week", t("am.rankWeek", { a: frDayLabel(r.week_start), b: frDayLabel(r.week_end) })));
  const seg = el("div", "seg am-seg");
  [["cards", t("am.rankCards")], ["success", t("am.rankSuccess")]].forEach(([k, label]) => {
    const b = el("button", null, label);
    b.type = "button";
    b.setAttribute("aria-pressed", String(Friends.view.rankTab === k));
    b.addEventListener("click", () => { Friends.view.rankTab = k; renderFriends(); });
    seg.appendChild(b);
  });
  c.appendChild(seg);
  const tab = Friends.view.rankTab === "success" ? "success" : "cards";
  const rows = arr(r[tab]);
  const list = el("ol", "am-rank");
  let rank = 0, prev = null;
  rows.forEach((x, i) => {
    const v = tab === "cards" ? num(Number(x.cards), 0) : num(Number(x.rate), 0);
    if (prev === null || v !== prev) rank = i + 1;
    prev = v;
    const li = el("li", "am-rank-row" + (x.me ? " me" : ""));
    li.appendChild(el("span", "am-rank-n", rank <= 3 ? ["🥇", "🥈", "🥉"][rank - 1] : String(rank)));
    const nm = el("span", "am-rank-id", x.identifiant + (x.me ? " (" + t("am.rankMe") + ")" : ""));
    li.appendChild(nm);
    const val = tab === "cards" ? dashFmt(v) : dashRate(v);
    const sub = tab === "success" && x.cards != null ? t("am.cardsN", { n: dashFmt(x.cards) }) : "";
    const vv = el("span", "am-rank-v", val);
    if (sub) vv.appendChild(el("small", "muted", " · " + sub));
    li.appendChild(vv);
    list.appendChild(li);
  });
  if (!rows.length) c.appendChild(el("p", "muted", t("am.rankEmpty")));
  else c.appendChild(list);
  if (tab === "success") c.appendChild(el("p", "hint", t("am.rankMin", { n: num(Number(r.min_cards), 20) })));
  if (!normPrivacy(state.settings.privacy).ranking)
    c.appendChild(el("p", "hint", t("am.rankHiddenMe")));
  return c;
}

// Réglages → Amis : ce que mes amis voient (tout montré par défaut).
function renderFriendsPrivCard() {
  const box = $("#friendsPrivCard");
  if (!box) return;
  box.hidden = !Friends.on();
  box.textContent = "";
  if (box.hidden) return;
  box.appendChild(el("h2", null, t("am.priv.title")));
  box.appendChild(el("p", "muted am-sub", t("am.priv.hint")));
  const pv = normPrivacy(state.settings.privacy);
  PRIVACY_ORDER.forEach(k => {
    const b = el("button", "au-switch am-switch");
    b.type = "button";
    b.setAttribute("role", "switch");
    b.setAttribute("aria-checked", String(pv[k]));
    const track = el("span", "au-track");
    track.appendChild(el("span", "au-knob"));
    b.append(el("span", "au-lbl", t("am.priv." + k)), track);
    b.addEventListener("click", () => {
      const p = normPrivacy(state.settings.privacy);
      p[k] = !p[k];
      state.settings.privacy = p;
      b.setAttribute("aria-checked", String(p[k]));
      commitQuiet();
      Friends.publish(true);   // confidentialité appliquée tout de suite chez mes amis
    });
    box.appendChild(b);
  });
}
