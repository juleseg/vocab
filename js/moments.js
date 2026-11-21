"use strict";

// === BONS MOMENTS POUR RÉVISER (ÉTAPE 61) ===
// 1. Rappel du matin : les cartes vues (ou ratées) le soir — après l'heure du soir réglée (19 h par défaut) jusqu'à 4 h —
//    sont reproposées le lendemain matin (de 4 h à midi) dans une petite session en mode Cartes (20 cartes au plus,
//    ratées d'abord). Bouton sur l'Accueil avec le nombre de cartes ; il disparaît quand la session est finie (résumé
//    affiché : marque « fait » sur cet appareil) ou à midi. Une carte revue entre-temps (dernière vue hors de la soirée)
//    sort d'elle-même du rappel : rien n'est enregistré dans les données, tout se lit dans la progression
//    (progress[langue].stats.lastSeen). Réglage dans Réglages (settings.morning, js/storage.js : normMorning).
// 2. Notification du matin (mode Supabase) : l'appli publie dans user_status (UserStatus, js/notifications.js) le jour du
//    prochain rappel, le nombre de cartes et l'heure choisie (null = notification coupée) ; la règle « morning_recall »
//    (claude/supabase-etape61.sql) l'envoie à cette heure-là, seulement s'il y a des cartes, avant midi, dans la limite de
//    2 notifications par jour. La toucher ouvre directement le rappel du matin.
// 3. Micro-session « 2 minutes » : bouton sur l'Accueil, 5 cartes à réviser (même tirage qu'une session normale, tout le
//    périmètre), mode Cartes. La notification « Rappel de l'objectif du jour » (règle goal_reminder existante) l'ouvre
//    directement. La règle d'une notification touchée est lue par push_open_rule(id) (js/notifications.js → fromPush).
// Progression : ces sessions passent par newRun / gradeCurrent → Leitner.grade (FSRS, historique, objectif, série, XP,
// mots difficiles) exactement comme une session normale ; une carte revue avant son échéance = révision anticipée normale.
// Les cartes en pause (étape 57) sont toujours exclues.
const MOM_MORNING_START = 4;     // heure où commence le matin (avant : encore la nuit, la soirée continue)
const MOM_MORNING_END = 12;      // midi : le rappel du matin disparaît
const MOM_MAX = 20;              // cartes au plus dans un rappel du matin
const MOM_MICRO = 5;             // cartes d'une micro-session « 2 minutes »

function momSettings() { return normMorning(state.settings && state.settings.morning); }
function momAt(base, dayOffset, hour) { const d = new Date(base); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + dayOffset); d.setHours(hour); return d.getTime(); }

// Rappel concerné à l'heure « now » : jour du matin (AAAA-MM-JJ), fenêtre du soir [from, to) et moment de la journée.
//   soir (heure ≥ heure du soir) : rappel de demain matin, soirée en cours ;
//   nuit et matin (avant midi)   : rappel de ce matin, soirée d'hier ;
//   après-midi                   : rappel de ce matin, déjà passé.
function momPlan(now) {
  now = now || Date.now();
  const h = new Date(now).getHours(), ev = momSettings().evening;
  if (h >= ev) return { day: todayStr(new Date(momAt(now, 1, 12))), from: momAt(now, 0, ev), to: momAt(now, 1, MOM_MORNING_START), phase: "evening" };
  return { day: todayStr(new Date(now)), from: momAt(now, -1, ev), to: momAt(now, 0, MOM_MORNING_START),
    phase: h < MOM_MORNING_START ? "night" : h < MOM_MORNING_END ? "morning" : "day" };
}
function momDoneKey() { return CONFIG.LS_USER_PREFIX + "morning:done:" + (Storage.getUser() || ""); }
function momDone(day) { try { return localStorage.getItem(momDoneKey()) === day; } catch (e) { return false; } }
function momMarkDone(day) { try { localStorage.setItem(momDoneKey(), day); } catch (e) {} }

// Cartes du rappel : une par carte (langue vue le plus tard dans la soirée), jamais en pause, utilisables ;
// ratées (catégorie « À apprendre ») d'abord, puis les plus récentes. Au plus MOM_MAX.
function momCards(plan) {
  const out = [];
  const lists = new Map(arr(state.lists).map(l => [l.id, l]));
  arr(state.cards).forEach(c => {
    const l = lists.get(c.listId);
    if (!l) return;
    const lg = listLangs(l);
    let best = null;
    cardStudyLangs(c).forEach((L, i) => {
      if (i === 0 ? !cardUsable(c, lg) : !cardUsable(c, studyLg(L))) return;
      if (Hard.isPaused(c, L)) return;
      const seen = num(((Leitner.prog(c, L) || {}).stats || {}).lastSeen, 0);
      if (seen >= plan.from && seen < plan.to && (!best || seen > best.seen)) best = { c, L, seen };
    });
    if (best) out.push(best);
  });
  const miss = x => (Leitner.category(x.c, x.L) === "unknown" ? 0 : 1);
  out.sort((a, b) => miss(a) - miss(b) || b.seen - a.seen);
  return out.slice(0, MOM_MAX);
}
// Rappel du matin disponible maintenant (bouton de l'Accueil) : { day, items } ou null.
function momMorningNow(now) {
  const s = momSettings();
  if (!s.on) return null;
  const p = momPlan(now);
  if (p.phase !== "morning" || momDone(p.day)) return null;
  const items = momCards(p);
  return items.length ? { day: p.day, items } : null;
}
// Micro-session : réglage d'une session normale (tout le périmètre, cartes à réviser, mode Cartes).
function momMicroCfg() {
  const base = rv.cfg || defaultSessionCfg();
  return Object.assign(defaultSessionCfg(), { scope: "all", onlyDue: true, mode: "cards", count: MOM_MICRO,
    dir: base.dir, dirs: Object.assign({}, base.dirs || {}), langs: [] });
}
function momMicroCount() { try { return Math.min(MOM_MICRO, sessionPool(momMicroCfg()).length); } catch (e) { return 0; } }

// Sens d'une carte : celui du choix de session en cours (par langue, sinon général ; « Mélange » tiré au hasard).
function momDir(cfg, L) {
  const d = ((cfg && cfg.dirs) || {})[L] || (cfg && cfg.dir) || "toT";
  return d === "mix" ? (Math.random() < 0.5 ? "toT" : "fromT") : d;
}
function momRun(queue, kind, day) {
  if (!rv.cfg) rv.cfg = defaultSessionCfg();
  try { history.replaceState(null, "", "#" + HASH_OF.review); } catch (e) {}
  newRun(queue, "cards");
  rv.s.kind = kind;            // "morning" | "micro" : fin de session → Moments.onSessionEnd
  if (day) rv.s.momDay = day;
  showScreen("review");
}

const Moments = (() => {
  // Lance le rappel du matin. Renvoie true si une session a commencé.
  function startMorning() {
    const m = momMorningNow();
    if (!m) { toast(t(momSettings().on ? "mom.none" : "mom.off")); return false; }
    const cfg = rv.cfg || defaultSessionCfg();
    momRun(shuffle(m.items.slice()).map(x => ({ id: x.c.id, lang: x.L, dir: momDir(cfg, x.L) })), "morning", m.day);
    return true;
  }
  // Lance la micro-session « 2 minutes » (5 cartes à réviser).
  function startMicro() {
    const cfg = momMicroCfg(), now = Date.now(), lgs = langsByList();
    const pool = shuffle(sessionPool(cfg)).slice(0, MOM_MICRO);
    const queue = pool.map(c => {
      const ls = sessionLangs(c, cfg, now, lgs.get(c.listId));
      const L = ls[Math.floor(Math.random() * ls.length)] || primaryLang(c);
      return { id: c.id, lang: L, dir: momDir(cfg, L) };
    });
    if (!queue.length) { toast(t("mom.microNone")); return false; }
    momRun(queue, "micro");
    return true;
  }
  // Fin de session (résumé affiché, js/modes/cartes.js), avant la publication du résumé pour les notifications.
  function onSessionEnd(s) {
    if (s && s.kind === "morning" && s.momDay) momMarkDone(s.momDay);
  }
  // Résumé publié pour la notification du matin (user_status) : jour du prochain rappel, nombre de cartes, heure choisie.
  function status(now) {
    const s = momSettings();
    if (!s.on) return { morning_day: null, morning_n: 0, morning_at: null };
    const p = momPlan(now);
    const n = p.phase === "day" || momDone(p.day) ? 0 : momCards(p).length;
    return { morning_day: p.day, morning_n: n, morning_at: s.notif ? String(s.hour).padStart(2, "0") + ":00" : null };
  }
  // Notification touchée (js/notifications.js, Push.markClicked) : règle lue en base ; rappel du matin → rappel du matin,
  // rappel de l'objectif du jour → « 2 minutes ». Une session déjà en cours n'est jamais interrompue.
  async function fromPush(id) {
    if (auth.mode !== "supabase" || !Supa.client() || !Storage.getUser()) return;
    let rule = null;
    try {
      const r = await withTimeout(Supa.client().rpc("push_open_rule", { p_id: id }), 15000);
      if (r && !r.error) rule = r.data;
    } catch (e) { return; }
    if (rule !== "morning_recall" && rule !== "goal_reminder") return;
    if (rv.phase === "run" && rv.s) return;
    if (rule === "morning_recall") startMorning(); else startMicro();
  }
  // L'appli passe en arrière-plan : résumé republié (s'il a changé) pour que la notification du matin connaisse la soirée.
  function watch() {
    try {
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden" && Storage.getUser()) { try { UserStatus.publish(); } catch (e) {} }
      });
    } catch (e) {}
  }
  watch();
  return { startMorning, startMicro, onSessionEnd, status, fromPush, morningNow: momMorningNow, microCount: momMicroCount, plan: momPlan };
})();

// === ACCUEIL : BOUTONS « RAPPEL DU MATIN » ET « 2 MINUTES » ===
function renderMomentsHome() {
  const box = $("#homeQuick");
  if (!box) return;
  box.textContent = "";
  const btn = (cls, icon, title, sub, onClick, id) => {
    const b = el("button", "mom-btn " + cls);
    b.type = "button";
    if (id) b.id = id;
    b.append(el("span", "mom-ic", icon), el("span", "mom-tx"));
    b.lastChild.append(el("span", "mom-t", title), el("span", "mom-s", sub));
    b.addEventListener("click", onClick);
    box.appendChild(b);
  };
  let m = null, n = 0;
  try { m = momMorningNow(); } catch (e) {}
  if (m) btn("mom-morning", "☀️", t("mom.morning"), t(m.items.length === 1 ? "mom.morningSub1" : "mom.morningSub", { n: m.items.length }),
    () => Moments.startMorning(), "homeMorning");
  n = m ? 0 : momMicroCount();   // étape 75 : un seul bouton rapide sur l'Accueil (le rappel du matin d'abord, sinon « 2 minutes »)
  if (n) btn("mom-micro", "⚡", t("mom.micro"), t(n === 1 ? "mom.microSub1" : "mom.microSub", { n }), () => Moments.startMicro(), "homeMicro");
  box.hidden = !box.childNodes.length;
}

// === RÉGLAGES : CARTE « RAPPEL DU MATIN » ===
function renderMomentsCard() {
  const box = $("#momentsCard");
  if (!box) return;
  box.textContent = "";
  const s = momSettings();
  const save = patch => {
    state.settings.morning = Object.assign(momSettings(), patch);
    commit();
    try { UserStatus.publish(); } catch (e) {}   // notification du matin : heure / coupure connues du serveur
  };
  const hourSel = (min, max, cur, onPick, id) => {
    const sel = el("select", "input mom-sel");
    if (id) sel.id = id;
    for (let h = min; h <= max; h++) {
      const o = el("option", null, t("mom.hour", { h }));
      o.value = String(h);
      if (h === cur) o.selected = true;
      sel.appendChild(o);
    }
    sel.addEventListener("change", () => onPick(clampInt(sel.value, min, max, cur)));
    return sel;
  };
  const check = (on, label, onToggle, id) => {
    const lab = el("label", "check-row");
    const cb = el("input"); cb.type = "checkbox"; cb.checked = on;
    if (id) cb.id = id;
    cb.addEventListener("change", () => onToggle(cb.checked));
    lab.append(cb, el("span", null, label));
    return lab;
  };
  box.appendChild(el("h2", null, "☀️ " + t("mom.set.title")));
  box.appendChild(check(s.on, t("mom.set.on"), v => save({ on: v }), "momOn"));
  box.appendChild(el("p", "hint", t("mom.set.onHint", { h: t("mom.hour", { h: s.evening }) })));
  if (!s.on) return;
  box.appendChild(formField(t("mom.set.evening"), hourSel(MOM_EVENING.min, MOM_EVENING.max, s.evening, v => save({ evening: v }), "momEvening")));
  box.appendChild(check(s.notif, t("mom.set.notif"), v => save({ notif: v }), "momNotif"));
  if (s.notif) box.appendChild(formField(t("mom.set.hour"), hourSel(MOM_HOUR.min, MOM_HOUR.max, s.hour, v => save({ hour: v }), "momHour")));
  box.appendChild(el("p", "hint", t(auth.mode === "supabase" ? "mom.set.notifHint" : "mom.set.notifLocal")));
}
