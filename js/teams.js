"use strict";

// === ÉQUIPES (ÉTAPE 54) — CÔTÉ UTILISATEUR ===
// Mode Supabase seulement (script claude/supabase-etape54.sql). Textes : js/i18n/teams-<langue>.js (clés tm.*).
// À ne pas confondre avec « L'équipe Vocab » (fil de messages avec l'admin, étape 53 : msg_team_send, js/messages.js).
// - Une équipe par compte, 2 à 10 membres, chef / membre. Créer (nom 30 caractères + emoji de la liste fixe), inviter un ami
//   accepté (chef ; 20 invitations en attente au plus), accepter / refuser, quitter (chef compris : le rôle passe au membre
//   le plus ancien ; équipe vide supprimée), retirer un membre, passer le rôle de chef. Un compte bloqué ne peut ni créer
//   ni rejoindre (le serveur refuse : team_blocked).
// - Écran Amis : carte « 👥 Mon équipe » (ou « Créer une équipe ») + invitations reçues (Teams.friendsCard).
// - Écran « Équipe » (#equipe, screen-team, bouton Amis allumé) : membres (XP de la semaine, cartes, série selon LEUR
//   confidentialité), objectif de la semaine, classement des équipes, messages d'équipe (messages prédéfinis de l'étape 53,
//   jamais de texte libre), listes d'équipe (listes communes de l'étape 30).
// - Objectif atteint : +30 XP par membre une fois par semaine, et badge « Équipe en or » la 1re fois. La récompense est
//   réservée sur le serveur (team_reward_claim, appareil noté) puis appliquée ici une seule fois (XP.onTeam, xp.teams),
//   même principe que les récompenses d'idées (étape 52). Vérifié au lancement (après Ideas.check), à l'ouverture de
//   l'écran Équipe et au retour de la connexion.
// - Quitter l'équipe : la fenêtre propose « Garder une copie des listes d'équipe » (comme quitter une liste commune).
// Toutes les données viennent de team_get / team_ranking (aucune lecture directe des tables).
const TM_MAX = 10, TM_INVITES = 20, TM_NAME_MAX = 30, TM_POLL_MS = 60000;
const tm = {
  status: "unknown",              // unknown | ok | missing (script de l'étape 54 pas lancé)
  data: null, at: 0, tried: 0, loading: false, err: "",     // team_get (tried : dernier essai, réussi ou non)
  rank: null, rankAt: 0, rankErr: "",             // team_ranking
  busy: false, form: { name: "", emoji: "" }, back: "friends"
};

const Teams = (() => {
  let token = 0, who = null, checking = false;
  function on() {
    try { return auth.mode === "supabase" && !!auth.sbUid && !!Supa.client() && !!Storage.getUser(); } catch (e) { return false; }
  }
  async function rpc(name, args) {
    const cl = Supa.client();
    if (!cl) throw new Error("no client");
    const r = await withTimeout(cl.rpc(name, args || {}), 20000);
    if (r && r.error) throw r.error;
    return r ? r.data : null;
  }
  function isMissing(e) {
    const code = String((e && e.code) || ""), msg = String((e && (e.message || e.msg)) || "");
    return ["PGRST202", "42883", "PGRST205", "42P01"].includes(code) || /could not find|does not exist|schema cache/i.test(msg);
  }
  function errText(e) {
    const h = String((e && e.hint) || "");
    if (I18N.fr["tm.err." + h]) return t("tm.err." + h, { m: TM_MAX, n: TM_INVITES });
    if (I18N.fr["mg.err." + h]) return t("mg.err." + h);
    if (I18N.fr["sh.err." + h]) return t("sh.err." + h);
    if (isMissing(e)) return t("tm.missing");
    if (sbErrKind(e) === "net") return t("tm.err.offline");
    if (String((e && e.code) || "") === "42501") return t("tm.err.team_blocked");
    return t("tm.err.other");
  }
  function checkUser() {
    const u = auth.sbUid || null;
    if (u !== who) { who = u; token++; tm.data = null; tm.at = 0; tm.tried = 0; tm.err = ""; tm.rank = null; tm.rankAt = 0; tm.status = "unknown"; tm.busy = false; }
  }
  function team() { return tm.data && tm.data.team ? tm.data.team : null; }
  function isChef() { const x = team(); return !!(x && x.role === "chef"); }
  function inviteCount() { return on() && tm.data ? arr(tm.data.invites_in).length : 0; }
  function rerender() {
    try {
      if (currentScreen === "team") renderTeam();
      else if (currentScreen === "friends") renderFriends();
    } catch (e) {}
  }

  // --- Chargement ---
  async function load(force) {
    checkUser();
    if (!on() || tm.status === "missing") return tm.data;
    if (!force && tm.loading) return tm.data;
    const my = ++token;
    tm.loading = true; tm.tried = Date.now();
    try {
      const d = await rpc("team_get", { p_today: todayStr() });
      if (my !== token) return tm.data;
      tm.data = d; tm.status = "ok"; tm.err = ""; tm.at = Date.now();
    } catch (e) {
      if (my !== token) return tm.data;
      if (isMissing(e)) { tm.status = "missing"; tm.data = null; }
      tm.err = errText(e);
    }
    tm.loading = false;
    try { Friends.renderBadge(); } catch (e) {}
    return tm.data;
  }
  async function loadRanking() {
    if (!on() || tm.status === "missing") return;
    tm.rankAt = Date.now();
    try { tm.rank = await rpc("team_ranking", { p_today: todayStr() }); tm.rankErr = ""; }
    catch (e) { tm.rankErr = errText(e); }
  }
  async function loadAll() {
    await load(true);
    if (team()) await loadRanking();
    rerender();
  }
  function needLoad() { return on() && !tm.loading && Date.now() - Math.max(tm.at, tm.tried) > TM_POLL_MS; }

  // --- Actions (erreur du serveur → toast ; puis rechargement) ---
  async function act(fn, okText, logKind, logData, after) {
    if (tm.busy) return null;
    tm.busy = true; rerender();
    let r = null;
    try {
      r = await fn();
      if (logKind) { try { Activity.log(logKind, logData || {}); } catch (e) {} }
      if (okText) toast(typeof okText === "function" ? okText(r) : okText);
      if (after) await after(r);
    } catch (e) { toast(errText(e)); r = null; }
    tm.busy = false;
    await loadAll();
    return r;
  }
  function create(name, emoji) {
    return act(() => rpc("team_create", { p_name: name, p_emoji: emoji }), t("tm.created", { name }), "team_create", {},
      () => { tm.form = { name: "", emoji: "" }; });
  }
  function answer(inv, accept) {
    return act(() => rpc("team_invite_answer", { p_id: inv.id, p_accept: !!accept }),
      t(accept ? "tm.joined" : "tm.declined", { name: inv.name || "?" }), accept ? "team_join" : null, { name: String(inv.name || "").slice(0, 40) },
      async () => { if (accept) { try { await Shared.sync(); } catch (e) {} } });
  }
  function invite(friend) {
    return act(() => rpc("team_invite", { p_user: friend.user_id }),
      r => t(r && r.in_team ? "tm.invitedInTeam" : "tm.invited", { id: friend.identifiant }), "team_invite", { target: friend.identifiant });
  }
  function cancelInvite(x) { return act(() => rpc("team_invite_cancel", { p_id: x.id }), t("tm.inviteCanceled", { id: x.identifiant })); }
  function remove(m) {
    openModal(t("tm.remove"), el("p", null, t("tm.removeAsk", { id: m.identifiant })), [
      { label: t("cancel") },
      { label: t("tm.remove"), kind: "danger", onClick: () => { act(() => rpc("team_remove", { p_user: m.user_id }), t("tm.removed", { id: m.identifiant }), "team_remove", { target: m.identifiant }); } }
    ]);
  }
  function makeChef(m) {
    openModal(t("tm.makeChef"), el("p", null, t("tm.makeChefAsk", { id: m.identifiant })), [
      { label: t("cancel") },
      { label: t("tm.makeChef"), kind: "primary", onClick: () => { act(() => rpc("team_set_chef", { p_user: m.user_id }), t("tm.chefDone", { id: m.identifiant }), "team_chef", { target: m.identifiant }); } }
    ]);
  }

  // --- Créer / renommer : nom + emoji ---
  function nameForm(init, onOk) {
    const box = el("div", "tm-form");
    const f = { name: init.name || "", emoji: init.emoji || arr(tm.data && tm.data.emojis)[0] || "🦊" };
    const inp = el("input", "input");
    inp.type = "text"; inp.maxLength = TM_NAME_MAX; inp.value = f.name; inp.placeholder = t("tm.namePh");
    inp.autocomplete = "off"; inp.setAttribute("aria-label", t("tm.name"));
    const cnt = el("div", "hint tm-count");
    const err = el("p", "q-err tm-ferr"); err.hidden = true;
    const upd = () => { f.name = inp.value; cnt.textContent = t("tm.chars", { n: TM_NAME_MAX - inp.value.length }); err.hidden = true; };
    inp.addEventListener("input", upd);
    upd();
    const lab = el("label", "tm-lab");
    lab.append(el("span", null, t("tm.name")), inp);
    box.append(lab, cnt);
    box.appendChild(el("div", "tm-lab", t("tm.emoji")));
    const grid = el("div", "tm-emojis");
    grid.setAttribute("role", "radiogroup"); grid.setAttribute("aria-label", t("tm.emoji"));
    arr(tm.data && tm.data.emojis).forEach(e => {
      const b = el("button", "tm-emo", e);
      b.type = "button"; b.setAttribute("role", "radio"); b.setAttribute("aria-checked", String(e === f.emoji));
      b.addEventListener("click", () => { f.emoji = e; grid.querySelectorAll(".tm-emo").forEach(x => x.setAttribute("aria-checked", String(x.textContent === e))); });
      grid.appendChild(b);
    });
    box.append(grid, err, el("p", "hint", t("tm.nameRule")));
    // Contrôle local (le serveur refait les mêmes contrôles) : pas vide, 30 caractères, pas de lien.
    const ok = () => {
      const v = inp.value.replace(/\s+/g, " ").trim();
      let k = "";
      if (!v || v.length > TM_NAME_MAX) k = "tm.err.team_name";
      else if (/(:\/\/|www\.|@|\b[a-z0-9-]+\.(com|net|org|fr|kr|io|app|me|co|info|xyz|ly|gg|tv|link|site|online)\b)/i.test(v)) k = "tm.err.team_name";
      if (k) { err.textContent = t(k); err.hidden = false; return false; }
      onOk(v, f.emoji);
      return true;
    };
    return { node: box, ok, focus: () => { try { inp.focus(); } catch (e) {} } };
  }
  function openCreate() {
    const fm = nameForm(tm.form, (name, emoji) => { tm.form = { name, emoji }; create(name, emoji); });
    openModal("👥 " + t("tm.create"), fm.node, [
      { label: t("cancel") },
      { label: t("tm.createBtn"), kind: "primary", onClick: () => (fm.ok() ? undefined : false) }
    ]);
    setTimeout(fm.focus, 50);
  }
  function openRename() {
    const x = team();
    if (!x) return;
    const fm = nameForm({ name: x.name, emoji: x.emoji }, (name, emoji) => {
      act(() => rpc("team_rename", { p_name: name, p_emoji: emoji }), t("tm.renamed"), "team_rename", {});
    });
    openModal(t("tm.rename"), fm.node, [
      { label: t("cancel") },
      { label: t("tm.save"), kind: "primary", onClick: () => (fm.ok() ? undefined : false) }
    ]);
  }

  // --- Inviter un ami (chef) ---
  async function openInvite() {
    const x = team();
    if (!x) return;
    let friends = arr(Friends.data() && Friends.data().friends);
    if (!Friends.data()) { try { const d = await rpc("my_friends"); friends = arr(d && d.friends); } catch (e) { toast(errText(e)); return; } }
    const members = new Set(arr(x.members).map(m => m.user_id)), pending = new Set(arr(x.invites_out).map(i => i.user_id));
    const box = el("div", "tm-pick");
    if (!friends.length) box.appendChild(el("p", "muted", t("tm.noFriends")));
    box.appendChild(el("p", "hint", t("tm.inviteHint", { n: arr(x.invites_out).length, m: TM_INVITES, s: x.size, max: TM_MAX })));
    let close = null;
    friends.forEach(f => {
      const row = el("div", "am-row");
      row.appendChild(el("div", "am-who tm-pick-id", f.identifiant));
      const isM = members.has(f.user_id), isP = pending.has(f.user_id);
      const b = el("button", "am-btn" + (isM || isP ? "" : " primary"), isM ? t("tm.isMember") : isP ? t("tm.isInvited") : t("tm.inviteBtn"));
      b.type = "button"; b.disabled = isM || isP || tm.busy || x.size >= TM_MAX;
      b.addEventListener("click", () => { if (close) close(); invite(f); });
      row.appendChild(b);
      box.appendChild(row);
    });
    close = openModal("👥 " + t("tm.invite"), box, [{ label: t("tm.close") }]);
  }

  // --- Objectif de la semaine (chef) ---
  function openGoal() {
    const x = team();
    if (!x || !x.goal_options) return;
    const o = x.goal_options;
    const st = { kind: "xp", level: "normal" };
    const box = el("div", "tm-goalset");
    const draw = () => {
      box.textContent = "";
      box.appendChild(el("p", "muted", t("tm.goalIntro", { n: x.size })));
      const seg = el("div", "seg");
      [["xp", t("tm.kind.xp")], ["cards", t("tm.kind.cards")]].forEach(([k, l]) => {
        const b = el("button", null, l); b.type = "button"; b.setAttribute("aria-pressed", String(st.kind === k));
        b.addEventListener("click", () => { st.kind = k; draw(); });
        seg.appendChild(b);
      });
      box.appendChild(seg);
      const cur = num(Number(o[st.kind + "_progress"]), 0);
      ["easy", "normal", "hard"].forEach(lv => {
        const v = num(Number(o[st.kind] && o[st.kind][lv]), 0);
        const b = el("button", "tm-level" + (st.level === lv ? " on" : ""));
        b.type = "button"; b.setAttribute("aria-pressed", String(st.level === lv));
        b.disabled = cur >= v;
        b.append(el("b", null, t("tm.level." + lv)), el("span", null, tmGoalVal(st.kind, v)),
          el("small", "muted", cur >= v ? t("tm.goalPassed") : t("tm.perMember", { n: dashFmt(Math.round(v / Math.max(2, x.size))) })));
        b.addEventListener("click", () => { st.level = lv; draw(); });
        box.appendChild(b);
      });
      box.appendChild(el("p", "hint", t("tm.goalNow", { v: tmGoalVal(st.kind, cur) })));
      box.appendChild(el("p", "hint", t("tm.goalOnce")));
    };
    draw();
    openModal("🎯 " + t("tm.goalChoose"), box, [
      { label: t("cancel") },
      { label: t("tm.save"), kind: "primary", onClick: () => {
        act(() => rpc("team_goal_set", { p_kind: st.kind, p_level: st.level, p_today: todayStr() }), t("tm.goalSaved"), "team_goal", { kind: st.kind, level: st.level });
      } }
    ]);
  }

  // --- Messages d'équipe (messages prédéfinis de l'étape 53, jamais de texte libre) ---
  async function openMessage() {
    try { await Messages.loadCatalog(false); } catch (e) {}
    const cat = arr(mg.catalog).filter(m => m.category !== "thanks" && !mgNeeds(m).serie && !mgNeeds(m).niveau);
    const box = el("div", "mg-pick tm-msgpick");
    box.appendChild(el("p", "muted", t("tm.msgIntro")));
    if (!cat.length) box.appendChild(el("p", "muted", t("tm.msgNone")));
    const list = el("div", "mg-pick-list");
    let close = null;
    cat.forEach(m => {
      const b = el("button", "mg-pick-btn", mgText(m, { ami: Storage.getUser() || "" }));
      b.type = "button"; b.disabled = tm.busy;
      b.addEventListener("click", () => {
        if (close) close();
        act(() => rpc("team_cheer_send", { p_message: m.id }), r => t("tm.msgSent", { n: num(r && r.sent, 0) }), "team_message", { message: m.id },
          () => { try { return Messages.loadInbox(); } catch (e) {} });
      });
      list.appendChild(b);
    });
    box.appendChild(list);
    box.appendChild(el("p", "hint", t("tm.msgHint")));
    close = openModal("💬 " + t("tm.msgTitle"), box, [{ label: t("cancel") }]);
  }

  // --- Listes d'équipe ---
  // Listes et dossiers que je peux partager avec l'équipe : les miens (pas reçus d'un ami), pas une liste d'un dossier commun.
  function shareable() {
    const out = [];
    sortedFolders().forEach(f => {
      if (isSharedFolder(f) && f.shared.role !== "owner") return;
      out.push({ kind: "folder", obj: f, label: "📁 " + f.name });
      listsIn(f.id).forEach(l => { if (!isSharedFolder(f) && (!isSharedList(l) || l.shared.role === "owner")) out.push({ kind: "list", obj: l, label: "　" + l.name }); });
    });
    listsIn(null).forEach(l => { if (!isSharedList(l) || (l.shared.role === "owner" && !l.shared.folder)) out.push({ kind: "list", obj: l, label: l.name }); });
    return out;
  }
  function openAddList() {
    const x = team();
    if (!x) return;
    const items = shareable();
    if (!items.length) { toast(t("tm.listNone")); return; }
    const already = new Set(arr(x.lists).map(l => l.id));
    const box = el("div", "tm-addlist");
    const sel = el("select", "input");
    items.forEach((it, i) => {
      const o = el("option", null, it.label + (it.obj.shared && already.has(it.obj.shared.id) ? " · " + t("tm.listAlready") : ""));
      o.value = String(i);
      sel.appendChild(o);
    });
    const lab = el("label", "tm-lab");
    lab.append(el("span", null, t("tm.listPick")), sel);
    const role = { v: "read" };
    const seg = el("div", "seg");
    [["read", t("tm.role.read")], ["write", t("tm.role.write")]].forEach(([k, l]) => {
      const b = el("button", null, l); b.type = "button"; b.setAttribute("aria-pressed", String(role.v === k));
      b.addEventListener("click", () => { role.v = k; seg.querySelectorAll("button").forEach(y => y.setAttribute("aria-pressed", String(y === b))); });
      seg.appendChild(b);
    });
    const prog = el("p", "hint");
    box.append(lab, el("div", "tm-lab", t("tm.listRole")), seg, el("p", "hint", t("tm.listHint")), prog);
    openModal("📚 " + t("tm.listAdd"), box, [
      { label: t("cancel") },
      { label: t("tm.listShare"), kind: "primary", onClick: () => {
        const it = items[Number(sel.value)];
        if (!it) return false;
        act(async () => {
          const U = it.kind === "folder" ? await Shared.makeCommonFolder(it.obj) : await Shared.makeCommon(it.obj);
          return rpc("team_list_add", { p_list: U, p_role: role.v });
        }, r => t("tm.listAdded", { name: (r && r.name) || it.obj.name }), "team_list", { action: "add", role: role.v },
        async () => { try { await Shared.sync(); } catch (e) {} });
      } }
    ]);
  }
  function listRole(l, role) {
    return act(() => rpc("team_list_role", { p_list: l.id, p_role: role }), t("tm.listRoleDone", { name: l.name }), "team_list", { action: "role", role },
      async () => { try { await Shared.sync(); } catch (e) {} });
  }
  function listRemove(l) {
    openModal(t("tm.listRemove"), el("p", null, t("tm.listRemoveAsk", { name: l.name })), [
      { label: t("cancel") },
      { label: t("tm.listRemove"), kind: "danger", onClick: () => {
        act(() => rpc("team_list_remove", { p_list: l.id }), t("tm.listRemoved", { name: l.name }), "team_list", { action: "remove" },
          async () => { try { await Shared.sync(); } catch (e) {} });
      } }
    ]);
  }

  // --- Quitter l'équipe (avec « Garder une copie des listes d'équipe », comme quitter une liste commune) ---
  function openLeave() {
    const x = team();
    if (!x) return;
    const others = arr(x.lists).filter(l => !l.mine);                 // listes d'équipe des autres : perdues en partant
    const tops = others.map(l => l.id);
    const lists = [].concat(...tops.map(U => shLocalLists(U)));
    const body = el("div");
    let ask = x.size <= 1 ? "tm.leaveLast" : x.role === "chef" ? "tm.leaveChef" : "tm.leaveAsk";
    body.appendChild(el("p", null, t(ask, { name: x.name })));
    if (arr(x.lists).some(l => l.mine)) body.appendChild(el("p", "hint", t("tm.leaveMine")));
    const keep = others.length ? shKeepBox("tm.keepCopy") : null;
    if (keep) { body.appendChild(el("p", "hint", t("tm.leaveLists", { n: others.length }))); body.appendChild(keep.node); }
    openModal(t("tm.leave"), body, [
      { label: t("cancel") },
      { label: t("tm.leave"), kind: "danger", onClick: () => {
        const k = !!(keep && keep.get());
        act(async () => {
          // Copie gardée : images des autres membres recopiées dans mon dossier tant que j'y ai encore accès (comme l'étape 49).
          if (k && typeof Images !== "undefined") { const ids = new Set(lists.map(l => l.id)); await Images.adopt(state.cards.filter(c => ids.has(c.listId) && c.image)); }
          const r = await rpc("team_leave");
          tops.forEach(U => {
            const fd = state.folders.find(f => isSharedFolder(f) && f.shared.id === U);
            if (fd) delete fd.shared;
            const mine = shLocalLists(U);
            mine.forEach(l => { const LU = l.shared.id; if (k) shToPrivate(l, true); Shared.dropList(LU); });
            if (!k) shDropLists(mine);
            Shared.dropList(U);
          });
          if (tops.length) commit();
          return r;
        }, r => t(r && r.deleted ? "tm.leftDeleted" : (k && tops.length ? "tm.leftKept" : "tm.left"), { name: x.name }),
        "team_leave", { name: String(x.name).slice(0, 40), keep: k, lists: tops.length },
        () => { if (currentScreen === "team") location.hash = "#" + HASH_OF.friends; });
      } }
    ]);
  }

  // --- Récompense d'objectif : réservée puis appliquée (une seule fois) ---
  function claimKey() { return CONFIG.LS_USER_PREFIX + "tm:claim:" + (auth.sbUid || ""); }
  function claiming() { try { return arr(JSON.parse(localStorage.getItem(claimKey()) || "[]")).filter(xpDayOk); } catch (e) { return []; } }
  function setClaiming(ws) { try { if (ws.length) localStorage.setItem(claimKey(), JSON.stringify(ws.slice(-20))); else localStorage.removeItem(claimKey()); } catch (e) {} }
  function applied(week) { try { return arr(XP.data().teams).includes(week); } catch (e) { return false; } }
  function showReward(g) {
    const body = el("div", "tm-reward");
    body.appendChild(el("p", "ix-reward-main", t("tm.rewardMsg", { name: g.team_name || "", n: g.xp })));
    if (g.badge) body.appendChild(el("p", null, "🏆 " + t("tm.rewardBadge")));
    return new Promise(res => {
      openModal("🎉 " + t("tm.rewardTitle"), body, [{ label: t("tm.ok"), kind: "primary", onClick: () => { res(); } }], { locked: true });
    });
  }
  async function check() {
    checkUser();
    if (checking || !on() || auth.blocked || tm.status === "missing") return;
    try { if (Release.blocked()) return; } catch (e) {}
    checking = true;
    try {
      const d = tm.data && Date.now() - tm.at < 3000 ? tm.data : await load(true);   // données de moins de 3 s, sinon relues
      if (!d) return;
      const mine = claiming(), dev = (typeof deviceId === "function") ? deviceId() : null;
      const todo = arr(d.rewards).filter(r => xpDayOk(r.week) && !applied(r.week) && (!r.claimed_at || mine.includes(r.week)));
      for (const r of todo) {
        if (!on() || auth.sbUid !== who) break;
        setClaiming(claiming().filter(w => w !== r.week).concat(r.week));   // avant l'appel : appli fermée → redemandée par cet appareil
        let c;
        try { c = await rpc("team_reward_claim", { p_week: r.week, p_device: dev }); }
        catch (e) {
          if (String((e && e.hint) || "") === "team_reward_none") { setClaiming(claiming().filter(w => w !== r.week)); continue; }
          break;                                         // hors connexion, blocage, erreur : nouvel essai plus tard
        }
        if (!c || !c.ok) { setClaiming(claiming().filter(w => w !== r.week)); continue; }   // réservée par un autre appareil
        const got = XP.onTeam(r.week, clampInt(c.xp, 0, 500, 30), !!c.badge);
        setClaiming(claiming().filter(w => w !== r.week));
        r.claimed_at = r.claimed_at || new Date().toISOString();
        if (!got) continue;                              // déjà appliquée sur ce compte (autre appareil, synchro)
        commit();
        if (!(await whenNoModal(() => auth.sbUid === who && !!Storage.getUser()))) break;
        await showReward({ xp: got.xp, badge: !!c.badge, team_name: c.team_name || r.team_name });
      }
    } finally { checking = false; }
  }

  function start() { checkUser(); if (on()) load(false); }
  // Ouverture de l'écran Équipe : équipe et classement relus (au plus une fois toutes les 5 s), puis récompense éventuelle.
  function enter() {
    if (!on() || tm.status === "missing" || tm.loading) return;
    if (Date.now() - tm.tried >= 5000) { loadAll().then(() => { if (tm.data) check(); }); return; }
    if (team() && Date.now() - tm.rankAt >= 5000) loadRanking().then(rerender);   // équipe toute fraîche : classement seulement
  }
  function reset() { who = "__reset__"; checkUser(); checking = false; }
  try {
    window.addEventListener("online", () => { if (on()) setTimeout(check, 4000); });
  } catch (e) {}

  return {
    on, rpc, errText, isMissing, load, loadAll, loadRanking, needLoad, check, start, enter, reset, team, isChef, inviteCount,
    openCreate, openRename, openInvite, cancelInvite, answer, remove, makeChef, openGoal, openMessage, openAddList, listRole,
    listRemove, openLeave, rerender, status: () => tm.status, busy: () => tm.busy
  };
})();

// --- Petits outils d'affichage ---
function tmGoalVal(kind, v) { return t(kind === "cards" ? "tm.nCards" : "tm.nXp", { n: dashFmt(num(Number(v), 0)) }); }
function tmTitle(x) { return (x.emoji || "👥") + " " + (x.name || "?"); }
function tmBar(cur, max, done) {
  if (done) cur = Math.max(cur, max);                  // objectif atteint (même si un membre est parti depuis) : barre pleine
  const bar = el("div", "sk-bar tm-bar" + (cur >= max ? " done" : ""));
  const s = el("span");
  s.style.width = Math.min(100, max > 0 ? Math.round(100 * cur / max) : 0) + "%";
  bar.appendChild(s);
  bar.setAttribute("role", "progressbar"); bar.setAttribute("aria-valuemin", "0"); bar.setAttribute("aria-valuemax", String(max)); bar.setAttribute("aria-valuenow", String(Math.min(cur, max)));
  return bar;
}
// Invitations reçues (écran Amis et écran Équipe).
function tmInvitesBlock(root) {
  const inv = arr(tm.data && tm.data.invites_in);
  if (!inv.length) return;
  const c = el("div", "card tm-inv");
  c.appendChild(el("h2", null, "👥 " + t("tm.invitesIn", { n: inv.length })));
  const blocked = !!(tm.data && tm.data.blocked);
  const inTeam = !!Teams.team();
  inv.forEach(x => {
    const row = el("div", "am-row");
    const who = el("div", "am-who");
    who.append(el("div", "am-id", tmTitle(x)), el("div", "muted am-sub", t("tm.inviteFrom", { id: x.from || "?", n: num(Number(x.size), 0) })));
    const btns = el("div", "am-btns");
    const a = el("button", "am-btn primary", t("tm.accept")); a.type = "button"; a.disabled = Teams.busy() || blocked || inTeam;
    a.addEventListener("click", () => Teams.answer(x, true));
    const d = el("button", "am-btn", t("tm.decline")); d.type = "button"; d.disabled = Teams.busy();
    d.addEventListener("click", () => Teams.answer(x, false));
    btns.append(a, d);
    row.append(who, btns);
    c.appendChild(row);
  });
  if (inTeam) c.appendChild(el("p", "hint", t("tm.leaveFirst")));
  if (blocked) c.appendChild(el("p", "hint", t("tm.blockedNote")));
  root.appendChild(c);
}
// Carte de l'écran Amis : « 👥 Mon équipe » ou « Créer une équipe ».
function tmFriendsCard(root) {
  if (!Teams.on() || Teams.status() === "missing") return;
  if (!tm.data) {                                      // jamais d'essai en boucle : un nouvel essai 30 s au plus tôt
    if (!tm.loading && Date.now() - tm.tried > 30000) Teams.load(false).then(() => { if (currentScreen === "friends" && tm.data) renderFriends(); });
    return;
  }
  tmInvitesBlock(root);
  const x = Teams.team();
  const c = el("div", "card tm-card");
  if (!x) {
    c.appendChild(el("h2", null, "👥 " + t("tm.title")));
    c.appendChild(el("p", "muted", t("tm.pitch")));
    const b = el("button", "btn primary", t("tm.create")); b.type = "button";
    b.disabled = !!tm.data.blocked || Teams.busy();
    b.addEventListener("click", () => Teams.openCreate());
    c.appendChild(b);
    if (tm.data.blocked) c.appendChild(el("p", "hint", t("tm.blockedNote")));
    root.appendChild(c);
    return;
  }
  c.classList.add("tm-mine");
  c.setAttribute("role", "button"); c.tabIndex = 0;
  const go = () => { tm.back = "friends"; location.hash = "#" + HASH_OF.team; };
  c.addEventListener("click", go);
  c.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } });
  const hd = el("div", "tm-head");
  hd.append(el("span", "tm-emoji", x.emoji || "👥"), el("div", "tm-hname", null));
  hd.lastChild.append(el("div", "tm-small muted", t("tm.myTeam")), el("b", null, x.name));
  hd.appendChild(el("span", "tm-chev", "›"));
  c.appendChild(hd);
  c.appendChild(el("p", "muted tm-sub", t("tm.sizeLine", { n: x.size, m: TM_MAX }) + (x.role === "chef" ? " · " + t("tm.youChef") : "")));
  const g = x.goal;
  if (g) {
    const cur = num(Number(g.progress), 0), max = num(Number(g.target), 1);
    c.appendChild(el("div", "tm-small", "🎯 " + (g.reached_at ? t("tm.goalReached") : t("tm.goalLine", { a: tmGoalVal(g.kind, Math.min(cur, max)), b: tmGoalVal(g.kind, max) }))));
    c.appendChild(tmBar(cur, max, !!g.reached_at));
  } else if (x.size < 2) c.appendChild(el("p", "hint", t("tm.needTwo")));
  root.appendChild(c);
}

// --- Écran « Équipe » (#equipe) ---
function renderTeam() {
  const root = $("#screen-team");
  if (!root) return;
  root.textContent = "";
  const top = el("div", "adm-top");
  const back = el("button", "link-btn", "‹ " + t("nav.friends"));
  back.addEventListener("click", () => { location.hash = "#" + HASH_OF.friends; });
  top.append(back);
  if (Teams.on()) {
    const ref = el("button", "link-btn", t("am.refresh"));
    ref.addEventListener("click", () => Teams.loadAll());
    top.appendChild(ref);
  }
  root.appendChild(top);
  root.appendChild(el("h2", "tm-h", "👥 " + t("tm.title")));
  if (!Teams.on()) { root.appendChild(el("div", "card muted", t("tm.offline"))); return; }
  if (Teams.status() === "missing") { root.appendChild(el("div", "card q-err", t("tm.missing"))); return; }
  if (!tm.data) {
    root.appendChild(el("div", "card muted", tm.err || t("am.loading")));
    if (!tm.loading && Date.now() - tm.tried > 30000) Teams.loadAll().then(() => { if (tm.data) Teams.check(); });
    return;
  }
  if (Teams.needLoad()) setTimeout(() => Teams.loadAll(), 0);
  else if (Teams.team() && !tm.rank && Date.now() - tm.rankAt > 30000) Teams.loadRanking().then(() => Teams.rerender());   // ouvert depuis Amis : classement
  if (tm.err) root.appendChild(el("div", "card q-err", tm.err));
  tmInvitesBlock(root);
  const x = Teams.team();
  if (!x) {
    const c = el("div", "card");
    c.appendChild(el("p", null, t("tm.pitch")));
    c.appendChild(el("p", "hint", t("tm.pitch2", { m: TM_MAX })));
    const b = el("button", "btn primary", t("tm.create")); b.type = "button";
    b.disabled = !!tm.data.blocked || Teams.busy();
    b.addEventListener("click", () => Teams.openCreate());
    c.appendChild(b);
    if (tm.data.blocked) c.appendChild(el("p", "hint", t("tm.blockedNote")));
    root.appendChild(c);
    return;
  }
  const chef = x.role === "chef", blocked = !!tm.data.blocked;
  // En-tête
  const h = el("div", "card tm-top");
  const hd = el("div", "tm-head");
  hd.append(el("span", "tm-emoji big", x.emoji || "👥"), el("div", "tm-hname"));
  hd.lastChild.append(el("b", "tm-name", x.name), el("div", "muted tm-small", t("tm.sizeLine", { n: x.size, m: TM_MAX }) + " · " + t(chef ? "tm.youChef" : "tm.youMember")));
  h.appendChild(hd);
  const hb = el("div", "am-btns am-btns-end");
  if (chef) { const r = el("button", "am-btn", "✏️ " + t("tm.rename")); r.type = "button"; r.disabled = Teams.busy() || blocked; r.addEventListener("click", () => Teams.openRename()); hb.appendChild(r); }
  const lv = el("button", "am-btn danger", t("tm.leave")); lv.type = "button"; lv.disabled = Teams.busy();
  lv.addEventListener("click", () => Teams.openLeave());
  hb.appendChild(lv);
  h.appendChild(hb);
  if (blocked) h.appendChild(el("p", "hint", t("tm.blockedMember")));
  root.appendChild(h);
  root.appendChild(tmGoalCard(x, chef, blocked));
  root.appendChild(tmMembersCard(x, chef, blocked));
  root.appendChild(tmRankCard(x));
  root.appendChild(tmMsgCard(x, blocked));
  root.appendChild(tmListsCard(x, chef, blocked));
}
function tmGoalCard(x, chef, blocked) {
  const c = el("div", "card tm-goal");
  c.appendChild(el("h2", null, "🎯 " + t("tm.goalTitle")));
  c.appendChild(el("p", "muted am-sub am-week", t("am.rankWeek", { a: frDayLabel(tm.data.week_start), b: frDayLabel(tm.data.week_end) })));
  const g = x.goal;
  if (!g) { c.appendChild(el("p", "muted", t("tm.needTwo"))); return c; }
  const cur = num(Number(g.progress), 0), max = num(Number(g.target), 1);
  c.appendChild(el("div", "tm-goalv", tmGoalVal(g.kind, Math.min(cur, max)) + " / " + tmGoalVal(g.kind, max)));
  c.appendChild(tmBar(cur, max, !!g.reached_at));
  c.appendChild(el("p", "tm-small", g.reached_at ? "🏆 " + t("tm.goalReachedLong") : t("tm.goalLeft", { v: tmGoalVal(g.kind, Math.max(0, max - cur)) })));
  c.appendChild(el("p", "hint", (g.auto ? t("tm.goalAuto") : t("tm.goalBy", { id: g.set_by || "?", l: t("tm.level." + g.level) })) + " " + t("tm.goalReward")));
  if (chef && g.auto && !g.reached_at && !blocked) {
    const b = el("button", "btn", t("tm.goalChoose")); b.type = "button"; b.disabled = Teams.busy();
    b.addEventListener("click", () => Teams.openGoal());
    c.appendChild(b);
  }
  return c;
}
function tmMembersCard(x, chef, blocked) {
  const c = el("div", "card tm-members");
  c.appendChild(el("h2", null, t("tm.members", { n: x.size, m: TM_MAX })));
  arr(x.members).forEach(m => {
    const box = el("div", "tm-member" + (m.me ? " me" : ""));
    const row = el("div", "am-row");
    const who = el("div", "am-who");
    who.append(el("div", "am-id", (m.role === "chef" ? "👑 " : "") + m.identifiant + (m.me ? " (" + t("am.rankMe") + ")" : "") + (m.blocked ? " · " + t("tm.memberBlocked") : "")),
      el("div", "muted am-sub", t("tm.since", { d: admDate(m.joined_at) })));
    row.appendChild(who);
    if (m.streak != null) row.appendChild(el("div", "am-fire", "🔥 " + m.streak));
    box.appendChild(row);
    const hid = t("am.hidden");
    const st = el("div", "tm-stats");
    st.append(el("span", null, t("tm.xpWeek") + " : " + (m.xp_week == null ? hid : t("xp.n", { n: dashFmt(m.xp_week) }))),
      el("span", null, t("tm.cardsWeek") + " : " + (m.cards_week == null ? hid : dashFmt(m.cards_week))));
    box.appendChild(st);
    if (chef && !m.me && !blocked) {
      const btns = el("div", "am-btns am-btns-end");
      const a = el("button", "am-btn", "👑 " + t("tm.makeChef")); a.type = "button"; a.disabled = Teams.busy();
      a.addEventListener("click", () => Teams.makeChef(m));
      const r = el("button", "am-btn danger", t("tm.remove")); r.type = "button"; r.disabled = Teams.busy();
      r.addEventListener("click", () => Teams.remove(m));
      btns.append(a, r);
      box.appendChild(btns);
    }
    c.appendChild(box);
  });
  c.appendChild(el("p", "hint", t("tm.privacyNote")));
  if (chef && !blocked) {
    const out = arr(x.invites_out);
    if (out.length) {
      c.appendChild(el("h3", "np-h3", t("tm.invitesOut", { n: out.length, m: TM_INVITES })));
      out.forEach(i => {
        const row = el("div", "am-row");
        const who = el("div", "am-who");
        who.append(el("div", "am-id", i.identifiant), el("div", "muted am-sub", queueDate(i.created_at)));
        const b = el("button", "am-btn", t("tm.cancelInvite")); b.type = "button"; b.disabled = Teams.busy();
        b.addEventListener("click", () => Teams.cancelInvite(i));
        row.append(who, b);
        c.appendChild(row);
      });
    }
    const b = el("button", "btn primary", "➕ " + t("tm.invite")); b.type = "button";
    b.disabled = Teams.busy() || x.size >= TM_MAX;
    b.addEventListener("click", () => Teams.openInvite());
    c.appendChild(b);
    if (x.size >= TM_MAX) c.appendChild(el("p", "hint", t("tm.err.team_full", { m: TM_MAX })));
  }
  return c;
}
// Classement : podium (lgPodium de la ligue), ma place, 10 premières ; semaine passée le lundi et le mardi.
function tmRankRows(rows) {
  return arr(rows).map(r => ({ rank: num(Number(r.rank), 0), identifiant: (r.emoji || "") + " " + (r.name || "?"), xp: Math.round(num(Number(r.score), 0)),
    me: !!r.mine, members: num(Number(r.members), 0) }));
}
function tmRankCard(x) {
  const c = el("div", "card lg-card tm-rank");
  c.appendChild(el("h2", null, "🏆 " + t("tm.rankTitle")));
  const r = tm.rank;
  if (!r) { c.appendChild(el("p", "muted", tm.rankErr || t("am.loading"))); return c; }
  c.appendChild(el("p", "muted am-sub am-week", t("am.rankWeek", { a: frDayLabel(r.week_start), b: frDayLabel(r.week_end) })));
  const rows = tmRankRows(r.rows);
  if (!rows.length) c.appendChild(el("p", "muted", x.size < 2 ? t("tm.needTwo") : t("tm.rankEmpty")));
  else {
    if (rows.length > 1) c.appendChild(lgPodium(rows));
    const mine = r.mine;
    if (mine) c.appendChild(el("p", "lg-me", t("tm.rankMine", { r: lgRankText(num(Number(mine.rank), 0)), n: num(Number(r.count), 0), s: dashFmt(Math.round(num(Number(mine.score), 0))) })));
    else if (x.size < 2) c.appendChild(el("p", "hint", t("tm.needTwo")));
    const list = el("ol", "am-rank lg-list");
    rows.forEach(y => {
      const li = el("li", "am-rank-row" + (y.me ? " me" : ""));
      li.append(el("span", "am-rank-n", y.rank <= 3 ? ["🥇", "🥈", "🥉"][y.rank - 1] : String(y.rank)), el("span", "am-rank-id", y.identifiant));
      const v = el("span", "am-rank-v", t("xp.n", { n: dashFmt(y.xp) }));
      v.appendChild(el("small", "muted", " · " + t("tm.membersN", { n: y.members })));
      li.appendChild(v);
      list.appendChild(li);
    });
    c.appendChild(list);
    if (mine && num(Number(mine.rank), 0) > 10) c.appendChild(el("p", "hint", t("tm.rankMineLow")));
  }
  c.appendChild(el("p", "hint", t("tm.rankHow")));
  const p = r.prev && typeof r.prev === "object" ? r.prev : null;
  if (p && arr(p.rows).length) {
    const box = el("div", "lg-prev");
    box.appendChild(el("h3", "np-h3", t("tm.rankPrev")));
    box.appendChild(el("p", "muted am-sub", t("am.rankWeek", { a: frDayLabel(p.week_start), b: frDayLabel(p.week_end) })));
    const pr = tmRankRows(p.rows);
    if (pr.length > 1) box.appendChild(lgPodium(pr));
    if (p.mine) box.appendChild(el("p", "lg-me", t("tm.rankPrevMine", { r: lgRankText(num(Number(p.mine.rank), 0)), n: num(Number(p.mine.count), 0), s: dashFmt(Math.round(num(Number(p.mine.score), 0))) })));
    c.appendChild(box);
  }
  return c;
}
function tmMsgCard(x, blocked) {
  const c = el("div", "card tm-msg");
  c.appendChild(el("h2", null, "💬 " + t("tm.msgTitle")));
  c.appendChild(el("p", "muted", t("tm.msgCard")));
  const b = el("button", "btn", t("tm.msgSend")); b.type = "button";
  b.disabled = Teams.busy() || blocked || x.size < 2 || !Messages.on() || Messages.status() === "missing";
  b.addEventListener("click", () => Teams.openMessage());
  c.appendChild(b);
  if (x.size < 2) c.appendChild(el("p", "hint", t("tm.needTwo")));
  return c;
}
function tmListsCard(x, chef, blocked) {
  const c = el("div", "card tm-lists");
  c.appendChild(el("h2", null, "📚 " + t("tm.listsTitle")));
  const ls = arr(x.lists);
  if (!ls.length) c.appendChild(el("p", "muted", t("tm.listsNone")));
  ls.forEach(l => {
    const box = el("div", "tm-list");
    const row = el("div", "am-row");
    const who = el("div", "am-who");
    who.append(el("div", "am-id", (l.is_folder ? "📁 " : "📄 ") + l.name),
      el("div", "muted am-sub", (l.mine ? t("tm.listMine") : t("tm.listBy", { id: l.owner_ident || "?" })) + " · " + t(l.role === "write" ? "tm.role.write" : "tm.role.read")));
    row.appendChild(who);
    box.appendChild(row);
    if ((chef || l.mine) && !blocked) {
      const btns = el("div", "am-btns am-btns-end");
      const other = l.role === "write" ? "read" : "write";
      const r = el("button", "am-btn", t(other === "write" ? "tm.makeWrite" : "tm.makeRead")); r.type = "button"; r.disabled = Teams.busy();
      r.addEventListener("click", () => Teams.listRole(l, other));
      const d = el("button", "am-btn danger", t("tm.listRemove")); d.type = "button"; d.disabled = Teams.busy();
      d.addEventListener("click", () => Teams.listRemove(l));
      btns.append(r, d);
      box.appendChild(btns);
    }
    c.appendChild(box);
  });
  c.appendChild(el("p", "hint", t("tm.listsHint")));
  if (chef && !blocked) {
    const b = el("button", "btn", "➕ " + t("tm.listAdd")); b.type = "button"; b.disabled = Teams.busy() || ls.length >= 10;
    b.addEventListener("click", () => Teams.openAddList());
    c.appendChild(b);
  }
  return c;
}
