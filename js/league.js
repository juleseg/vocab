"use strict";

// === LIGUE DE LA SEMAINE (ÉTAPE 44) ===
// Classement XP entre amis, du lundi au dimanche (jours locaux de l'appareil), moi compris : podium, liste, mon rang et
// l'écart avec le suivant. Mode Supabase seulement, script supabase-etape44.sql (fonction league_week).
// - XP de la semaine = user_public_stats.xp_week, publié par l'appli (Friends.publish) ; le serveur en garde une copie par
//   semaine (table league_weeks), ce qui permet d'afficher les résultats de la semaine passée le lundi et le mardi.
// - Confidentialité : un ami qui cache « XP et niveau » (ou sa présence dans le classement) n'apparaît pas ; je me vois
//   toujours (avec une note si mes amis ne me voient pas). Calculé côté serveur.
// - Script pas lancé : la carte affiche « Lancez le script SQL de l'étape 44 », le reste de l'écran Amis ne change pas.
// Chargée avec l'écran Amis (Friends.load → League.load) ; rappel du dimanche : règle « Fin de ligue » (notifications, étape 34).

const League = (() => {
  let status = "unknown";       // unknown | ok | missing (script de l'étape 44 pas lancé)
  let data = null, err = "", token = 0;
  async function load(today) {
    if (!Friends.on() || status === "missing") return;
    const my = ++token;
    try {
      const r = await withTimeout(Supa.client().rpc("league_week", { p_today: today || todayStr() }), 15000);
      if (r && r.error) throw r.error;
      if (my !== token) return;
      data = r ? r.data : null; status = "ok"; err = "";
    } catch (e) {
      if (my !== token) return;
      if (alIsMissing(e)) { status = "missing"; data = null; }
      else err = sbErrKind(e) === "net" ? t("am.err.net") : t("am.err.other");
    }
  }
  function reset() { token++; status = "unknown"; data = null; err = ""; }
  return { load, reset, status: () => status, data: () => data, err: () => err };
})();

// Rangs : même XP = même rang. Renvoie les lignes avec .rank.
function lgRanked(rows) {
  let rank = 0, prev = null;
  return arr(rows).map((x, i) => {
    const v = num(Number(x.xp), 0);
    if (prev === null || v !== prev) rank = i + 1;
    prev = v;
    return Object.assign({}, x, { xp: v, rank });
  });
}
function lgRankText(n) { return n === 1 ? t("lg.rank1") : t("lg.rankN", { n }); }
// Ma place : « 2e sur 5 », et l'écart avec le suivant (celui juste devant, ou le 2e si je suis 1er).
function lgMyLine(rows) {
  const me = rows.find(x => x.me);
  if (!me) return "";
  let s = t("lg.myRank", { r: lgRankText(me.rank), n: rows.length });
  if (rows.length < 2) return s + " · " + t("lg.alone");
  if (me.rank > 1) {
    const ahead = rows.filter(x => x.xp > me.xp).pop();
    if (ahead) s += " · " + t("lg.toPass", { n: dashFmt(ahead.xp - me.xp + 1), id: ahead.identifiant });
  } else {
    const next = rows.find(x => !x.me && x.xp <= me.xp);
    if (next) s += " · " + (next.xp === me.xp ? t("lg.tied", { id: next.identifiant }) : t("lg.lead", { n: dashFmt(me.xp - next.xp), id: next.identifiant }));
  }
  return s;
}
// Podium : 3 marches (2e, 1er, 3e), seulement les rangs 1 à 3.
function lgPodium(rows) {
  const top = rows.filter(x => x.rank <= 3).slice(0, 3);
  const box = el("div", "lg-podium");
  [top[1], top[0], top[2]].forEach((x, i) => {
    const step = el("div", "lg-step lg-step" + [2, 1, 3][i] + (x && x.me ? " me" : ""));
    if (x) {
      step.append(el("div", "lg-medal", ["🥇", "🥈", "🥉"][x.rank - 1] || ""), el("div", "lg-name", x.identifiant),
        el("div", "lg-xp", t("xp.n", { n: dashFmt(x.xp) })));
    }
    step.appendChild(el("div", "lg-block"));
    box.appendChild(step);
  });
  return box;
}
function lgList(rows, showLevel) {
  const list = el("ol", "am-rank lg-list");
  rows.forEach(x => {
    const li = el("li", "am-rank-row" + (x.me ? " me" : ""));
    li.appendChild(el("span", "am-rank-n", x.rank <= 3 ? ["🥇", "🥈", "🥉"][x.rank - 1] : String(x.rank)));
    li.appendChild(el("span", "am-rank-id", x.identifiant + (x.me ? " (" + t("am.rankMe") + ")" : "")));
    const v = el("span", "am-rank-v", t("xp.n", { n: dashFmt(x.xp) }));
    if (showLevel && x.level != null) v.appendChild(el("small", "muted", " · " + t("xp.level", { n: x.level })));
    li.appendChild(v);
    list.appendChild(li);
  });
  return list;
}

// Carte « Ligue de la semaine » de l'écran Amis.
function lgCard() {
  const c = el("div", "card lg-card");
  c.appendChild(el("h2", null, "🏆 " + t("lg.title")));
  if (League.status() === "missing") { c.appendChild(el("p", "q-err", t("lg.missing"))); return c; }
  const d = League.data();
  if (!d) { c.appendChild(el("p", "muted", League.err() || t("am.loading"))); return c; }
  c.appendChild(el("p", "muted am-sub am-week", t("am.rankWeek", { a: frDayLabel(d.week_start), b: frDayLabel(d.week_end) })));
  const rows = lgRanked(d.rows);
  if (rows.length > 1) c.appendChild(lgPodium(rows));
  c.appendChild(el("p", "lg-me", lgMyLine(rows)));
  c.appendChild(lgList(rows, true));
  if (!num(Number(d.friends), 0)) c.appendChild(el("p", "hint", t("lg.noFriends")));
  if (num(Number(d.hidden), 0) > 0) c.appendChild(el("p", "hint", t("lg.hidden", { n: d.hidden })));
  if (d.me_hidden) c.appendChild(el("p", "hint", t("lg.meHidden")));
  c.appendChild(el("p", "hint", t("lg.how")));
  // Semaine passée : visible le lundi et le mardi
  const p = d.prev && typeof d.prev === "object" ? d.prev : null;
  if (p) {
    const pr = lgRanked(p.rows);
    const box = el("div", "lg-prev");
    box.appendChild(el("h3", "np-h3", t("lg.prevTitle")));
    box.appendChild(el("p", "muted am-sub", t("am.rankWeek", { a: frDayLabel(p.week_start), b: frDayLabel(p.week_end) })));
    if (pr.some(x => x.xp > 0)) {
      if (pr.length > 1) box.appendChild(lgPodium(pr));
      const me = pr.find(x => x.me);
      if (me) box.appendChild(el("p", "lg-me", t("lg.prevMe", { r: lgRankText(me.rank), n: pr.length, x: dashFmt(me.xp) })));
    } else box.appendChild(el("p", "muted", t("lg.prevEmpty")));
    c.appendChild(box);
  }
  return c;
}
