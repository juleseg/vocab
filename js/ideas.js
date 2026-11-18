"use strict";

// === PROPOSITIONS D'AMÉLIORATION ET RÉCOMPENSES (étape 52) — CÔTÉ UTILISATEUR ===
// Mode Supabase seulement (script claude/supabase-etape52.sql). Textes : js/i18n/ideas-<langue>.js (clés ix.*).
// - « 💡 Proposer une idée » (carte des Réglages #ideaCard et carte d'À propos) : fenêtre catégorie (nouvelle fonction /
//   problème / contenu / autre), titre (80), texte (500) → idea_add. Limites du serveur : 3 par 24 h, 30 en attente,
//   compte bloqué refusé (erreurs P0001 + hint idea_*, messages ix.err.<hint>).
// - Écran « Mes idées » (#idees, screen-ideas, bouton Réglages allumé) : état, réponse de l'équipe, récompense reçue.
//   L'ouvrir marque les réponses comme vues (idea_list(true)).
// - Récompense (Ideas.check : au lancement après les autres fenêtres, au retour de la connexion, à l'ouverture de
//   « Mes idées ») : pour chaque récompense pas encore appliquée sur ce compte, d'abord RÉSERVÉE sur le serveur
//   (idea_reward_claim, atomique, avec l'identifiant de l'appareil), puis appliquée une seule fois :
//     XP par XP.onIdea (une fois par idée : xp.ideas, morceau xp synchronisé) ; gels dans le morceau streak dans la limite
//     de STREAK_MAX_FREEZES (2) — gel sans place = IX_FREEZE_XP (50) XP ; badge « Idée retenue » (XP_BADGES, id idea1) ;
//   puis message « Ton idée a été retenue : +100 XP, +1 gel ».
//   Réservée par un autre appareil → rien (ses données arrivent par la synchro). Hors connexion / blocage « Mise à jour
//   nécessaire » / erreur : rien n'est appliqué, nouvel essai plus tard. Appli fermée entre la réservation et
//   l'application : le même appareil la redemande (vocabfr.ix:claim:<compte>) et le serveur la lui redonne.
const IX_CATS = ["feature", "problem", "content", "other"];
const IX_STATUS = ["new", "seen", "kept", "done", "refused"];
const IX_TITLE_MAX = 80, IX_BODY_MAX = 500, IX_FREEZE_XP = 50;
const ix = { data: null, loading: false, err: "", missing: false, started: false, at: 0, markAt: 0, fresh: new Set() };

const Ideas = (() => {
  let checking = false, token = 0, who = null;

  function on() {
    try { return auth.mode === "supabase" && !!auth.sbUid && !!Supa.client(); } catch (e) { return false; }
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
    if (/^idea_/.test(h) && I18N.fr["ix.err." + h]) return t("ix.err." + h);
    if (isMissing(e)) return t("ix.missing");
    if (sbErrKind(e) === "net") return t("ix.err.offline");
    return t("ix.err.other");
  }
  function checkUser() { const u = auth.sbUid || null; if (u !== who) { who = u; ix.data = null; ix.started = false; ix.err = ""; ix.missing = false; ix.at = 0; ix.markAt = 0; ix.fresh.clear(); } }

  // --- Mes idées ---
  async function load(markSeen) {
    checkUser();
    if (!on()) return null;
    ix.loading = true; ix.err = ""; ix.at = Date.now();   // heure du dernier essai (jamais deux lectures de suite en boucle)
    if (!ix.data) rerender();
    try {
      ix.data = await rpc("idea_list", { p_mark_seen: !!markSeen });
      ix.missing = false;
      if (markSeen) arr(ix.data && ix.data.ideas).forEach(i => { if (unseenOne(i)) i.reply_seen_at = new Date().toISOString(); });
    } catch (e) { ix.missing = isMissing(e); ix.err = errText(e); }
    ix.loading = false; ix.started = true;
    rerender();
    return ix.data;
  }
  function rerender() {
    try {
      if (currentScreen === "ideas") renderIdeas();
      else if (currentScreen === "settings") renderCard();
      else if (currentScreen === "about") renderAbout();
    } catch (e) {}
  }
  // Réponse ou décision de l'équipe pas encore vue.
  function unseenOne(i) { return !i.reply_seen_at && (!!i.admin_reply || ["kept", "done", "refused"].includes(i.status) || !!i.reward); }
  function unseen() { return arr(ix.data && ix.data.ideas).filter(unseenOne).length; }

  // --- Proposer une idée ---
  function openForm() {
    if (!on()) { toast(t("ix.local")); return; }
    const f = { cat: "feature", title: "", body: "" };
    const box = el("div", "ix-form");
    box.appendChild(el("p", "muted", t("ix.form.intro")));
    const lc = el("div", "field");
    lc.appendChild(el("label", null, t("ix.f.cat")));
    const seg = el("div", "seg seg-wrap ix-cats");
    seg.setAttribute("role", "group"); seg.setAttribute("aria-label", t("ix.f.cat"));
    IX_CATS.forEach(c => {
      const b = el("button", null, t("ix.cat." + c));
      b.type = "button"; b.dataset.value = c; b.setAttribute("aria-pressed", String(c === f.cat));
      b.addEventListener("click", () => { f.cat = c; seg.querySelectorAll("button").forEach(x => x.setAttribute("aria-pressed", String(x.dataset.value === c))); });
      seg.appendChild(b);
    });
    lc.appendChild(seg);
    box.appendChild(lc);
    const counter = (input, max) => {
      const c = el("span", "ix-count", "0 / " + max);
      input.addEventListener("input", () => { c.textContent = input.value.length + " / " + max; });
      return c;
    };
    const lt = el("div", "field");
    const ti = el("input", "input");
    ti.id = "ixTitle"; ti.maxLength = IX_TITLE_MAX; ti.autocomplete = "off";
    const ltl = el("label", null, t("ix.f.title")); ltl.htmlFor = ti.id;
    const tc = counter(ti, IX_TITLE_MAX);
    lt.append(ltl, ti, tc);
    box.appendChild(lt);
    const lb = el("div", "field");
    const ta = el("textarea", "input ix-body");
    ta.id = "ixBody"; ta.maxLength = IX_BODY_MAX; ta.rows = 5;
    ta.placeholder = t("ix.f.bodyPh");
    const lbl = el("label", null, t("ix.f.body")); lbl.htmlFor = ta.id;
    lb.append(lbl, ta, counter(ta, IX_BODY_MAX));
    box.appendChild(lb);
    const d = ix.data;
    if (d && Number(d.day_used) >= 0) {
      const left = Math.max(0, num(Number(d.day_max), 3) - num(Number(d.day_used), 0));
      box.appendChild(el("p", "hint ix-left", t(left === 1 ? "ix.leftOne" : "ix.left", { n: left })));
    }
    const msg = el("p", "q-err ix-err");
    msg.hidden = true;
    box.appendChild(msg);
    let busy = false, closeFn = null;
    const send = async () => {
      if (busy) return false;
      f.title = ti.value.replace(/\s+/g, " ").trim();
      f.body = ta.value.trim();
      if (!f.title) { msg.textContent = t("ix.err.idea_title"); msg.hidden = false; ti.focus(); return false; }
      busy = true; msg.hidden = true;
      const btn = box.parentNode ? box.parentNode.querySelector(".btns .btn.primary") : null;
      if (btn) btn.disabled = true;
      try {
        await rpc("idea_add", { p_category: f.cat, p_title: f.title.slice(0, IX_TITLE_MAX), p_body: f.body.slice(0, IX_BODY_MAX) });
        if (closeFn) closeFn();
        toast(t("ix.sent"));
        load(false);
      } catch (e) {
        msg.textContent = errText(e); msg.hidden = false;
        if (btn) btn.disabled = false;
      }
      busy = false;
      return false;
    };
    closeFn = openModal("💡 " + t("ix.propose"), box, [
      { label: t("cancel") },
      { label: t("ix.send"), kind: "primary", onClick: () => { send(); return false; } }
    ]);
    setTimeout(() => { try { ti.focus(); } catch (e) {} }, 50);
    if (!ix.data) load(false);
  }

  // --- Carte des Réglages et d'À propos ---
  function cardBody(card) {
    card.appendChild(el("h2", null, "💡 " + t("ix.title")));
    card.appendChild(el("p", "muted", t("ix.cardHelp")));
    const btns = el("div", "btns two");
    const bP = el("button", "btn primary", t("ix.propose"));
    bP.type = "button"; bP.addEventListener("click", openForm);
    const n = unseen();
    const bM = el("button", "btn ix-mine", t("ix.mine"));
    bM.type = "button";
    if (n) { const dot = el("span", "ix-dot", String(n)); dot.setAttribute("aria-label", t("ix.unseen", { n })); bM.appendChild(dot); }
    bM.addEventListener("click", () => { location.hash = "#" + HASH_OF.ideas; });
    btns.append(bP, bM);
    card.appendChild(btns);
  }
  function renderCard() {
    const card = $("#ideaCard");
    if (!card) return;
    card.hidden = !on();
    if (card.hidden) return;
    card.textContent = "";
    cardBody(card);
  }
  function aboutCard() {
    if (!on()) return null;
    const card = el("div", "card ix-about");
    cardBody(card);
    return card;
  }

  // --- Récompenses ---
  function claimKey() { return CONFIG.LS_USER_PREFIX + "ix:claim:" + (auth.sbUid || ""); }
  function claiming() { try { return arr(JSON.parse(localStorage.getItem(claimKey()) || "[]")).filter(x => UUID_RE.test(String(x))); } catch (e) { return []; } }
  function setClaiming(ids) { try { if (ids.length) localStorage.setItem(claimKey(), JSON.stringify(ids.slice(-50))); else localStorage.removeItem(claimKey()); } catch (e) {} }
  function applied(id) { try { return arr(XP.data().ideas).includes(id); } catch (e) { return false; } }
  // Applique une récompense réservée (une seule fois par idée sur ce compte) et renvoie ce qui a été donné.
  function apply(id, r) {
    const xp = clampInt(r && r.xp, 0, 500, 0), fr = clampInt(r && r.freezes, 0, 2, 0), badge = !!(r && r.badge);
    const s = state.streak;
    const room = Math.max(0, STREAK_MAX_FREEZES - clampInt(s && s.freezes, 0, STREAK_MAX_FREEZES, 0));
    const give = Math.min(room, fr), extra = (fr - give) * IX_FREEZE_XP;
    const got = XP.onIdea(id, xp + extra, badge);
    if (!got) return null;                             // déjà appliquée sur ce compte (autre appareil, synchro)
    if (give && s) s.freezes = Math.min(STREAK_MAX_FREEZES, s.freezes + give);
    commit();
    return { xp: xp + extra, freezes: give, swapped: fr - give, badge: got.badge, badgeAsked: badge };
  }
  function rewardText(g) {
    const parts = [];
    if (g.xp) parts.push(t("ix.r.xp", { n: g.xp }));
    if (g.freezes) parts.push(t(g.freezes === 1 ? "ix.r.freeze" : "ix.r.freezes", { n: g.freezes }));
    if (g.badgeAsked) parts.push(t("ix.r.badge"));
    return parts.join(", ");
  }
  function showReward(g, idea) {
    const body = el("div", "ix-reward");
    body.appendChild(el("p", "ix-reward-main", t("ix.r.msg", { list: rewardText(g) })));
    if (idea && idea.title) body.appendChild(el("p", "muted", "« " + idea.title + " »"));
    if (g.swapped) body.appendChild(el("p", "hint", t(g.swapped === 1 ? "ix.r.fullOne" : "ix.r.full", { n: g.swapped, x: IX_FREEZE_XP })));
    if (idea && idea.admin_reply) {
      const rp = el("div", "ix-reply");
      rp.append(el("b", null, t("ix.reply")), el("p", null, idea.admin_reply));
      body.appendChild(rp);
    }
    return new Promise(res => {
      openModal("🎁 " + t("ix.r.title"), body, [{ label: t("ix.ok"), kind: "primary", onClick: () => { res(); } }], { locked: true });
    });
  }
  // Récompenses en attente : réservées puis appliquées, l'une après l'autre. Renvoie le nombre appliqué.
  async function claimAll(list) {
    const dev = (typeof deviceId === "function") ? deviceId() : null;
    let n = 0;
    for (const i of list) {
      if (!on() || auth.sbUid !== who) break;
      if (applied(i.id)) { setClaiming(claiming().filter(x => x !== i.id)); continue; }
      setClaiming(claiming().filter(x => x !== i.id).concat(i.id));    // avant l'appel : appli fermée → redemandée par cet appareil
      let r;
      try { r = await rpc("idea_reward_claim", { p_idea: i.id, p_device: dev }); }
      catch (e) {
        const h = String((e && e.hint) || "");
        if (h === "idea_none") { setClaiming(claiming().filter(x => x !== i.id)); continue; }
        break;                                           // hors connexion, blocage, erreur : nouvel essai plus tard
      }
      if (!r || !r.ok) { setClaiming(claiming().filter(x => x !== i.id)); continue; }   // réservée par un autre appareil
      const g = apply(i.id, r);
      setClaiming(claiming().filter(x => x !== i.id));
      if (i.reward) i.reward.claimed_at = i.reward.claimed_at || new Date().toISOString();
      if (!g) continue;
      n++;
      if (!(await whenNoModal(() => auth.sbUid === who && !!Storage.getUser()))) break;
      await showReward(g, i);
    }
    return n;
  }
  // Au lancement (après les autres fenêtres), au retour de la connexion, à l'ouverture de « Mes idées ».
  async function check() {
    checkUser();
    if (checking || !on() || auth.blocked) return;
    try { if (Release.blocked()) return; } catch (e) {}
    checking = true;
    const my = ++token;
    try {
      const d = ix.data && ix.started ? ix.data : await load(false);
      if (!d || my !== token) return;
      const mine = claiming();
      const todo = arr(d.ideas).filter(i => i.reward && !applied(i.id) && (!i.reward.claimed_at || mine.includes(i.id)));
      const got = todo.length ? await claimAll(todo) : 0;
      // Réponses de l'équipe pas encore vues (sans récompense) : petit message au lancement, une fois par lancement.
      const replies = arr(d.ideas).filter(i => unseenOne(i) && !(i.reward && todo.some(x => x.id === i.id))).length;
      if (replies && !got && !check.told) { check.told = true; toast(t(replies === 1 ? "ix.newReplyOne" : "ix.newReply", { n: replies })); }
      rerender();
    } finally { checking = false; }
  }
  function reset() { token++; checking = false; who = null; ix.data = null; ix.started = false; ix.err = ""; ix.missing = false; ix.at = 0; ix.markAt = 0; ix.fresh.clear(); check.told = false; }
  try { window.addEventListener("online", () => { if (on()) setTimeout(check, 3000); }); } catch (e) {}

  return { on, load, check, reset, openForm, renderCard, aboutCard, unseen, unseenOne, errText, isMissing, rpc, rewardText };
})();

// --- Écran « Mes idées » (#idees) ---
function ixDate(s) { try { return s ? new Date(s).toLocaleDateString(state.settings.uiLang, { year: "numeric", month: "short", day: "numeric" }) : ""; } catch (e) { return ""; } }
function ixStatusTag(s) { return el("span", "al-tag ix-st ix-st-" + s, t("ix.st." + (IX_STATUS.includes(s) ? s : "new"))); }
function ixRewardLine(rw) {
  if (!rw) return null;
  const g = { xp: num(Number(rw.xp), 0), freezes: num(Number(rw.freezes), 0), badgeAsked: !!rw.badge };
  const box = el("div", "ix-rw");
  box.appendChild(el("span", null, "🎁 " + t("ix.rewardLine", { list: Ideas.rewardText(g) })));
  box.appendChild(el("span", "muted ix-rw-st", t(rw.claimed_at ? "ix.rewardGot" : "ix.rewardSoon")));
  return box;
}
function renderIdeas() {
  const root = $("#screen-ideas");
  if (!root) return;
  root.textContent = "";
  const back = el("button", "link-btn", "‹ " + t("nav.settings"));
  back.type = "button";
  back.addEventListener("click", () => { location.hash = "#" + HASH_OF.settings; });
  root.appendChild(back);
  const top = el("div", "adm-top");
  top.appendChild(el("h2", null, "💡 " + t("ix.mine")));
  root.appendChild(top);
  if (!Ideas.on()) { root.appendChild(el("div", "card q-note", t("ix.local"))); return; }
  if (!ix.started && !ix.loading) { Ideas.load(true).then(() => Ideas.check()); return; }
  // Réponses pas encore vues : marquées vues (serveur) en gardant leur mise en évidence pendant cette visite ;
  // données de plus d'une minute : relues.
  if (!ix.loading && ((Ideas.unseen() && Date.now() - ix.markAt > 15000) || Date.now() - ix.at > 60000)) {
    const mark = Ideas.unseen() > 0;
    arr(ix.data && ix.data.ideas).forEach(i => { if (Ideas.unseenOne(i)) ix.fresh.add(i.id); });
    if (mark) ix.markAt = Date.now();
    Ideas.load(mark);
  }
  const add = el("button", "btn primary ix-add", "💡 " + t("ix.propose"));
  add.type = "button"; add.addEventListener("click", Ideas.openForm);
  root.appendChild(add);
  if (ix.loading && !ix.data) { root.appendChild(el("div", "empty", t("admin.loading"))); return; }
  if (ix.err) root.appendChild(el("div", "card q-err", ix.err));
  if (!ix.data) return;
  const d = ix.data;
  root.appendChild(el("p", "hint", t("ix.limits", { p: num(Number(d.pending), 0), pm: num(Number(d.pending_max), 30), dm: num(Number(d.day_max), 3) })));
  const list = arr(d.ideas);
  if (!list.length) { root.appendChild(el("div", "empty", t("ix.none"))); return; }
  list.forEach(i => {
    const c = el("div", "card ix-item" + (Ideas.unseenOne(i) || ix.fresh.has(i.id) ? " ix-new" : ""));
    const head = el("div", "al-head");
    const tags = el("span", "ix-tags");
    tags.append(el("span", "al-tag", t("ix.cat." + (IX_CATS.includes(i.category) ? i.category : "other"))), ixStatusTag(i.status));
    head.append(tags, el("span", "al-time", ixDate(i.created_at)));
    c.appendChild(head);
    c.appendChild(el("div", "ix-t", i.title));
    if (i.body) c.appendChild(el("div", "ix-b", i.body));
    if (i.admin_reply) {
      const rp = el("div", "ix-reply");
      rp.append(el("b", null, t("ix.reply")), el("p", null, i.admin_reply));
      c.appendChild(rp);
    }
    const rl = ixRewardLine(i.reward);
    if (rl) c.appendChild(rl);
    root.appendChild(c);
  });
}
