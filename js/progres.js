"use strict";

// === PROGRÈS VISIBLES (ÉTAPE 64) ===
// Données : state.progres (morceau user_data « progres », normalisé par normProgres dans js/storage.js) et la dernière
// réponse de chaque carte progress[langue].lr (écrite par Leitner.grade).
// 1. Mots appris cette semaine : un mot (carte + langue étudiée) est « appris » quand sa catégorie passe à « Acquis »
//    (Leitner.grade → Progres.onAnswer : wasKnown faux, isKnown vrai). Compté une fois par carte, langue et semaine
//    (lundi → dimanche, jours locaux, comme les amis et la ligue). Carte supprimée = plus comptée. Total = mots
//    « Acquis » maintenant (toutes les vues carte × langue). Avant la version 64, rien n'était noté : les semaines passées
//    ne sont pas connues (s = jour de départ, affiché tant qu'il est dans la semaine en cours).
// 2. Bilan d'oubli : sur les 30 derniers jours, chaque réponse notée (pas les jeux) d'un mot dont la réponse d'avant
//    était « Trouvé » compte dans ses groupes : nature (nom, verbe… de la langue étudiée), liste, type de carte, temps de
//    conjugaison. Oubli = « Raté » ou « Hésité ». Fiable à partir de PRG_MIN_TOTAL réponses en tout ; un groupe n'est cité
//    qu'à partir de PRG_MIN_GROUP réponses. « Réviser ces mots » : session Cartes avec les mots du groupe ratés / hésités
//    dans les 30 jours (toujours existants, utilisables, pas en pause).
// 3. Rappel du lundi : petite carte sur l'Accueil le lundi, fermable (lundi fermé noté dans state.progres.m, synchronisé).
//    Jamais de notification.
// 4. Amis : nombre de mots appris de la semaine publié dans user_public_stats.learned_week (js/screens/amis.js), visible
//    selon le réglage de confidentialité « mots appris » (settings.privacy.learned), appliqué par le serveur (fr_view).
const PRG_DAYS = 30;          // bilan d'oubli : 30 derniers jours (aujourd'hui compris)
const PRG_MIN_TOTAL = 30;     // réponses au moins (toutes) pour un bilan fiable
const PRG_MIN_GROUP = 8;      // réponses au moins pour citer un groupe
const PRG_TOP = 3;            // groupes cités au plus par famille
const PRG_LIST_MAX = 60;      // mots montrés au plus dans Stats (par langue)
const PRG_DIMS = ["p", "l", "t", "c"];   // nature, liste, type de carte, temps

function prgData() {
  if (!state.progres || typeof state.progres !== "object" || !Array.isArray(state.progres.l)) state.progres = normProgres(null);
  const p = state.progres;
  if (!p.f || typeof p.f !== "object") p.f = {};
  if (!p.s) p.s = todayStr();   // premier usage en version 64 : jour de départ du compte des mots appris
  return p;
}
function prgCard(id) { return state.cards.find(c => c.id === id) || null; }
// Nature regroupée : noms (avec ou sans genre) → n, verbes (pronominaux compris) → v, autres codes tels quels.
function prgPos(c, L) {
  if (!isVocab(c)) return "";
  const v = c.pos && c.pos[L];
  if (!v || !POS_CODES.includes(v)) return "";
  if (v === "n" || POS_GENDERED.includes(v)) return "n";
  if (v === "vpr") return "v";
  return v;
}
// Groupes d'une carte dans une langue étudiée.
function prgKeys(c, L) {
  const ks = ["t:" + cardType(c), "l:" + c.listId];
  const p = prgPos(c, L);
  if (p) ks.push("p:" + p);
  if (cardType(c) === "conj" && c.tense) ks.push("c:" + c.lang + "|" + c.tense);
  return ks.filter(k => PRG_KEY_RE.test(k));
}
function prgWeekStart(day) { return frMonday(day || todayStr()); }
// Mot utilisable en révision dans cette langue (comme les autres sessions) et pas en pause.
function prgUsable(c, L) {
  const ls = cardStudyLangs(c), i = ls.indexOf(L);
  if (i < 0) return false;
  if (i === 0 ? !cardUsable(c, listLangs(c.listId)) : !cardUsable(c, studyLg(L))) return false;
  try { if (Hard.isPaused(c, L)) return false; } catch (e) {}
  return true;
}
// Libellé d'un groupe.
function prgGroupName(k) {
  const d = k.slice(0, 1), v = k.slice(2);
  if (d === "p") return t("pos." + v);
  if (d === "t") return (TYPE_ICON[v] ? TYPE_ICON[v] + " " : "") + t("type." + v);
  if (d === "l") { const l = getList(v); return l ? listLabel(l) : ""; }
  if (d === "c") { const [lng, id] = v.split("|"); return tenseName(lng, id) + (prgConjLangs() > 1 ? " (" + langName(lng) + ")" : ""); }
  return "";
}
function prgConjLangs() { return new Set(state.cards.filter(c => cardType(c) === "conj").map(c => c.lang)).size; }
function prgGroupExists(k) {
  const d = k.slice(0, 1), v = k.slice(2);
  if (d === "l") return !!getList(v);
  if (d === "t") return CARD_TYPES.includes(v);
  if (d === "p") return v === "n" || POS_CODES.includes(v);
  if (d === "c") { const [lng, id] = v.split("|"); return isLang(lng) && !!tenseOf(lng, id); }
  return false;
}

const Progres = (() => {
  // --- Réponse notée (appelé par Leitner.grade, après la note) ---
  // info = { wasKnown, isKnown (catégorie « Acquis » avant / après), prevK (réponse d'avant = « Trouvé »), game }.
  function onAnswer(c, L, result, now, info) {
    if (!c || !c.id || !isLang(L) || !info) return;
    const p = prgData(), day = todayStr(new Date(now || Date.now()));
    if (!info.wasKnown && info.isKnown) {
      const mon = prgWeekStart(day);
      if (!p.l.some(e => e[1] === c.id && e[2] === L && e[0] >= mon)) p.l.push([day, c.id, L]);
      const from = skAdd(day, -PRG_KEEP_DAYS);
      if (p.l.length && p.l[0][0] < from) p.l = p.l.filter(e => e[0] >= from);
      if (p.l.length > 5000) p.l = p.l.slice(-5000);
    }
    if (info.game || !info.prevK) return;
    let D = p.f[day];
    if (!D) {
      D = p.f[day] = { g: {}, x: [] };
      const from = skAdd(day, -PRG_F_DAYS);
      Object.keys(p.f).forEach(k => { if (k < from) delete p.f[k]; });
    }
    if (!D.g) D.g = {};
    if (!Array.isArray(D.x)) D.x = [];
    prgKeys(c, L).forEach(k => {
      const a = D.g[k] || (D.g[k] = [0, 0, 0]);
      a[0]++;
      if (result === "unknown") a[1]++;
      else if (result === "review") a[2]++;
    });
    if (result !== "known") {
      const code = result === "unknown" ? "u" : "r";
      const e = D.x.find(x => x[0] === c.id && x[1] === L);
      if (e) { if (code === "u") e[2] = "u"; }
      else if (D.x.length < PRG_X_MAX) D.x.push([c.id, L, code]);
    }
  }

  // --- Mots appris ---
  // Mots devenus « Acquis » cette semaine (cartes existantes) : [{ c, L, day }], les plus récents d'abord.
  function week(today) {
    const p = prgData(), mon = prgWeekStart(today), end = today || todayStr(), out = [];
    p.l.forEach(e => {
      if (e[0] < mon || e[0] > end) return;
      const c = prgCard(e[1]);
      if (c) out.push({ c, L: e[2], day: e[0] });
    });
    return out.reverse();
  }
  function weekCount(today) { return week(today).length; }
  // Mots « Acquis » maintenant, par langue étudiée : { total, byLang: { L: n } }.
  function knownNow(units) {
    const out = { total: 0, byLang: {} };
    (units || Leitner.units(state.cards)).forEach(u => {
      if (Leitner.category(u) !== "known") return;
      out.total++;
      out.byLang[u.unitLang] = (out.byLang[u.unitLang] || 0) + 1;
    });
    return out;
  }
  // Jour de départ affiché s'il est dans la semaine en cours (les jours d'avant ne sont pas connus).
  function sinceNote(today) {
    const p = prgData(), mon = prgWeekStart(today);
    return p.s && p.s > mon ? p.s : "";
  }

  // --- Bilan d'oubli ---
  function bilan(today) {
    const p = prgData(), end = today || todayStr(), from = skAdd(end, -(PRG_DAYS - 1));
    const sums = {}, fails = [];
    Object.keys(p.f).forEach(day => {
      if (day < from || day > end) return;
      const D = p.f[day] || {};
      Object.keys(D.g || {}).forEach(k => {
        const a = D.g[k], s = sums[k] || (sums[k] = [0, 0, 0]);
        s[0] += a[0]; s[1] += a[1]; s[2] += a[2];
      });
      arr(D.x).forEach(x => fails.push(x));
    });
    // Total : chaque réponse a exactement un type de carte (clés « t: »).
    let n = 0, u = 0, r = 0;
    Object.keys(sums).forEach(k => { if (k.startsWith("t:")) { n += sums[k][0]; u += sums[k][1]; r += sums[k][2]; } });
    const res = { n, u, r, rate: n ? Math.round((u + r) * 100 / n) : 0, enough: n >= PRG_MIN_TOTAL, dims: {}, fails };
    if (!res.enough) return res;
    PRG_DIMS.forEach(d => {
      const keys = Object.keys(sums).filter(k => k.startsWith(d + ":"));
      if (keys.length < 2) return;   // tout dans le même groupe : rien à comparer
      const gs = keys.filter(k => sums[k][0] >= PRG_MIN_GROUP && sums[k][1] + sums[k][2] > 0 && prgGroupExists(k))
        .map(k => ({ key: k, n: sums[k][0], u: sums[k][1], r: sums[k][2], rate: Math.round((sums[k][1] + sums[k][2]) * 100 / sums[k][0]) }))
        .sort((a, b) => b.rate - a.rate || b.n - a.n)
        .slice(0, PRG_TOP);
      if (gs.length) res.dims[d] = gs;
    });
    return res;
  }
  // Mots d'un groupe ratés / hésités dans les 30 jours, encore là, utilisables et pas en pause : [{ c, L }].
  function groupWords(b, key) {
    const out = [], seen = new Set();
    arr(b && b.fails).forEach(x => {
      const k = x[0] + "|" + x[1];
      if (seen.has(k)) return;
      const c = prgCard(x[0]);
      if (!c || !prgKeys(c, x[1]).includes(key) || !prgUsable(c, x[1])) return;
      seen.add(k);
      out.push({ c, L: x[1], miss: x[2] === "u" });
    });
    out.sort((a, b) => (a.miss === b.miss ? 0 : a.miss ? -1 : 1));
    return out;
  }
  // « Réviser ces mots » : session Cartes avec ces mots (même chemin qu'une session normale : FSRS, historique, XP…).
  function review(words) {
    if (!words.length) { toast(t("prg.b.none")); return false; }
    if (rv.phase === "run" && rv.s) { toast(t("prg.b.busy")); return false; }
    if (!rv.cfg) rv.cfg = defaultSessionCfg();
    const cfg = rv.cfg;
    const dirOf = L => { const d = ((cfg.dirs || {})[L]) || cfg.dir || "toT"; return d === "mix" ? (Math.random() < 0.5 ? "toT" : "fromT") : d; };
    const queue = shuffle(words.slice()).map(w => ({ id: w.c.id, lang: w.L, dir: dirOf(w.L) }));
    try { history.replaceState(null, "", "#" + HASH_OF.review); } catch (e) {}
    newRun(queue, "cards");
    rv.s.kind = "bilan";
    showScreen("review");
    return true;
  }

  // --- Rappel du lundi (Accueil) ---
  function mondayShown(today) {
    const d = today || todayStr();
    const [y, m, dd] = d.split("-").map(Number);
    return new Date(y, m - 1, dd, 12).getDay() === 1 && prgData().m !== d && state.cards.length > 0;
  }
  function closeMonday(today) {
    prgData().m = today || todayStr();
    commitQuiet();
  }
  return { onAnswer, week, weekCount, knownNow, sinceNote, bilan, groupWords, review, mondayShown, closeMonday, keys: prgKeys };
})();

// === FENÊTRE « MON BILAN D'OUBLI » ===
function openBilan() {
  const b = Progres.bilan();
  const body = el("div", "prg-bilan");
  let close = null;
  body.appendChild(el("p", "hint prg-b-period", t("prg.b.period", { d: PRG_DAYS })));
  if (!b.enough) {
    body.appendChild(el("div", "prg-b-empty", t("prg.b.notEnough")));
    body.appendChild(el("p", "hint", t("prg.b.notEnoughHint", { min: PRG_MIN_TOTAL, n: b.n, g: PRG_MIN_GROUP })));
  } else {
    body.appendChild(el("div", "prg-b-overall", t("prg.b.overall", { n: b.n, p: b.rate })));
    body.appendChild(el("div", "hint", t("prg.b.detail", { u: b.u, r: b.r })));
    const dims = PRG_DIMS.filter(d => b.dims[d]);
    if (!b.u && !b.r) body.appendChild(el("p", "prg-b-good", t("prg.b.nothing")));
    else if (!dims.length) body.appendChild(el("p", "hint", t("prg.b.noGroup", { g: PRG_MIN_GROUP })));
    else {
      const most = dims.map(d => prgGroupName(b.dims[d][0].key)).filter(Boolean);
      if (most.length) body.appendChild(el("p", "prg-b-most", t("prg.b.most", { x: most.join(" · ") })));
    }
    dims.forEach(d => {
      const sec = el("div", "prg-b-sec");
      sec.appendChild(el("h4", null, t("prg.b.dim." + d)));
      b.dims[d].forEach(g => {
        const row = el("div", "prg-b-row");
        const m = el("div", "prg-b-main");
        m.append(el("div", "prg-b-name", prgGroupName(g.key)),
          el("div", "prg-b-sub", t("prg.b.row", { p: g.rate, n: g.n }) + " · " + t("prg.b.detail", { u: g.u, r: g.r })));
        const bar = el("div", "prg-b-bar");
        const fill = el("span");
        fill.style.width = Math.max(2, Math.min(100, g.rate)) + "%";
        bar.appendChild(fill);
        m.appendChild(bar);
        row.appendChild(m);
        const words = Progres.groupWords(b, g.key);
        if (words.length) {
          const go = el("button", "btn prg-b-go", t("prg.b.review", { n: words.length }));
          go.type = "button";
          go.addEventListener("click", () => { if (Progres.review(words) && close) close(); });
          row.appendChild(go);
        }
        sec.appendChild(row);
      });
      body.appendChild(sec);
    });
  }
  close = openModal(t("prg.b.title"), body, [{ label: t("prg.b.close") }]);
  return close;
}

// === ACCUEIL : CARTE « MOTS APPRIS CETTE SEMAINE » ET RAPPEL DU LUNDI ===
function renderProgresHome() {
  const box = $("#homeLearned"), mon = $("#homeBilanMon");
  if (mon) {
    mon.textContent = "";
    const show = Progres.mondayShown();
    mon.hidden = !show;
    if (show) {
      const tx = el("div", "prg-mon-tx", t("prg.mon.text"));
      const go = el("button", "link-btn prg-mon-go", t("prg.bilan.btn"));
      go.type = "button";
      go.addEventListener("click", () => { Progres.closeMonday(); renderProgresHome(); openBilan(); });
      const x = el("button", "prg-mon-x", "✕");
      x.type = "button";
      x.setAttribute("aria-label", t("prg.mon.close")); x.title = t("prg.mon.close");
      x.addEventListener("click", () => { Progres.closeMonday(); renderProgresHome(); });
      const m = el("div", "prg-mon-m");
      m.append(tx, go);
      mon.append(m, x);
    }
  }
  if (!box) return;
  box.textContent = "";
  box.hidden = !state.cards.length;
  if (box.hidden) return;
  const w = Progres.week(), k = Progres.knownNow();
  const hd = el("div", "prg-home-hd");
  hd.append(el("h2", null, t("prg.home.title")), el("span", "prg-home-n", String(w.length)));
  box.appendChild(hd);
  box.appendChild(el("div", "prg-home-sub", t("prg.home.total", { n: k.total })));
  const byL = {};
  w.forEach(x => { byL[x.L] = (byL[x.L] || 0) + 1; });
  const ls = LANG_CODES.filter(L => byL[L] || k.byLang[L]);
  if (ls.length > 1) box.appendChild(el("div", "prg-home-langs", ls.map(L => t("prg.home.lang", { l: L.toUpperCase(), n: byL[L] || 0 })).join(" · ")));
  const btns = el("div", "prg-home-btns");
  const det = el("button", "link-btn", t("prg.home.detail"));
  det.type = "button";
  det.addEventListener("click", () => {
    try { history.replaceState(null, "", "#" + HASH_OF.stats); } catch (e) {}
    showScreen("stats");
    const s = $("#stLearned");
    if (s) try { s.scrollIntoView({ block: "start" }); } catch (e) {}
  });
  const bl = el("button", "link-btn", t("prg.bilan.btn"));
  bl.type = "button";
  bl.id = "homeBilanBtn";
  bl.addEventListener("click", () => openBilan());
  btns.append(det, bl);
  box.appendChild(btns);
}

// === STATS : « MOTS APPRIS CETTE SEMAINE » ET « BILAN D'OUBLI » ===
// units : vues (carte × langue) du périmètre de Stats (filtres langue / dossier / liste).
function statsProgres(units) {
  const wrap = el("div", "prg-stats");
  const inScope = new Set(units.map(u => u.id + "|" + u.unitLang));
  const w = Progres.week().filter(x => inScope.has(x.c.id + "|" + x.L));
  const k = Progres.knownNow(units);
  const card = el("div", "card prg-st");
  card.id = "stLearned";
  card.appendChild(el("h2", null, t("prg.st.title")));
  card.appendChild(el("div", "hint", t("prg.st.hint")));
  const since = Progres.sinceNote();
  if (since) card.appendChild(el("div", "hint", t("prg.st.since", { d: frDayLabel(since, { weekday: "long", day: "numeric", month: "long" }) })));
  const tiles = el("div", "st-tiles prg-tiles");
  tiles.append(stTile(w.length, t("prg.st.week")), stTile(k.total, t("prg.st.total")));
  card.appendChild(tiles);
  const ls = LANG_CODES.filter(L => w.some(x => x.L === L) || k.byLang[L]);
  if (!w.length) card.appendChild(el("p", "muted", t("prg.st.none")));
  ls.forEach(L => {
    const ws = w.filter(x => x.L === L);
    const sec = el("div", "prg-st-lang");
    sec.appendChild(el("h3", null, langName(L) + " — " + t("prg.st.line", { w: ws.length, t: k.byLang[L] || 0 })));
    ws.slice(0, PRG_LIST_MAX).forEach(x => {
      const c = x.c, lg = gameLg(c, L);
      const row = el("div", "st-miss prg-word");
      const m = el("div", "main");
      const f = el("div", "t1", isVocab(c) ? (term(c, L) || "—") : cardTitle(c)); f.lang = L;
      if (!isVocab(c)) f.insertBefore(typeBadge(c.type), f.firstChild);
      m.appendChild(f);
      const sub = isVocab(c) ? supportText(c, lg) : cardSubtitle(c);
      if (sub) m.appendChild(el("div", "t2", sub));
      row.append(m, el("div", "prg-day", frDayLabel(x.day, { weekday: "short" })));
      sec.appendChild(row);
    });
    if (ws.length > PRG_LIST_MAX) sec.appendChild(el("div", "hint", t("prg.st.more", { n: ws.length - PRG_LIST_MAX })));
    if (ws.length || ls.length > 1) card.appendChild(sec);
  });
  wrap.appendChild(card);
  // Bilan d'oubli : résumé (tout le compte) + « Voir mon bilan »
  const b = Progres.bilan();
  const bc = el("div", "card prg-st-b");
  bc.id = "stBilan";
  bc.appendChild(el("h2", null, t("prg.st.bilanTitle")));
  bc.appendChild(el("div", "hint", b.enough ? t("prg.st.bilanShort", { p: b.rate, n: b.n }) : t("prg.st.bilanWait", { n: b.n, min: PRG_MIN_TOTAL })));
  const go = el("button", "btn primary prg-st-go", t("prg.bilan.btn"));
  go.type = "button";
  go.id = "stBilanBtn";
  go.addEventListener("click", () => openBilan());
  bc.appendChild(go);
  wrap.appendChild(bc);
  return wrap;
}
