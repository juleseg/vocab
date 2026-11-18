"use strict";

// === DUELS ENTRE AMIS (ÉTAPE 44) ===
// Mode Supabase seulement, script supabase-etape44.sql (table duels, fonctions duel_*). Sans le script : la carte
// « Duels » de l'écran Amis affiche « Lancez le script SQL de l'étape 44 », le reste ne change pas.
// - Défier : un ami, une de mes listes, une langue. Langue proposée = une langue de la liste que l'ami étudie aussi
//   (langues publiées dans user_status, fonction duel_friend_langs) ; sinon, choix parmi les langues de l'ami : seules les
//   cartes qui ont un mot dans cette langue (dans la carte ou dans le dictionnaire commun) sont gardées.
//   10 cartes vocab tirées au hasard, mots tous différents, avec au moins une traduction. Elles sont COPIÉES dans le
//   duel ({ w: mot, t: { langue: traduction } }, sans progression ni tags) : l'ami n'a jamais accès à mes listes.
// - Le serveur prépare les questions (même ordre, mêmes 4 réponses pour les deux joueurs). QCM chronométré (style des
//   jeux de l'étape 42) : question = traduction dans ma langue (interface, puis appui), réponses dans la langue du duel ;
//   15 s par question (temps écoulé = réponse fausse). Score = bonnes réponses, puis temps (calculés par le serveur).
// - Celui qui défie peut jouer tout de suite ; l'ami joue après avoir accepté. Invitation expirée après 3 jours.
// - Réponses du duel : jamais dans la progression des cartes (pas de Leitner, pas d'historique) ; XP de duel
//   (XP_RULES.duel, js/xp.js) : barème du QCM + partie terminée, bonus de victoire vu dans la liste des duels.
// - Partie en cours gardée sur l'appareil (localStorage "vocabfr.duel:<compte>:<duel>") : reprise après une fermeture,
//   score renvoyé plus tard s'il n'a pas pu partir (hors connexion).
const DUEL = { CARDS: 10, Q_MS: 15000, OK_MS: 700, BAD_MS: 1300, SCAN_MAX: 300, DICT_N: 50 };

const Duels = (() => {
  let status = "unknown";        // unknown | ok | missing (script de l'étape 44 pas lancé)
  let data = null, invites = 0, err = "", token = 0, busy = false;
  let play = null;               // partie en cours (voir startPlay)
  let tick = null;
  const friendLangs = new Map(); // ami → { known, langs, ui_lang }
  const senseVals = new Map();   // sens du dictionnaire commun → valeurs { "w:<langue>": mot }
  function on() { return Friends.on(); }
  async function rpc(name, args) {
    const r = await withTimeout(Supa.client().rpc(name, args || {}), 20000);
    if (r && r.error) throw r.error;
    return r ? r.data : null;
  }
  function errText(e) {
    const hint = String((e && e.hint) || "");
    if (/^du_/.test(hint) && I18N.fr["du.err." + hint]) return t("du.err." + hint);
    if (alIsMissing(e)) return t("du.missing");
    if (sbErrKind(e) === "net") return t("am.err.net");
    if (String((e && e.code) || "") === "42501") return t("am.err.account_blocked");
    return t("am.err.other");
  }
  function rerender() { if (currentScreen === "friends") renderFriends(); }
  function key(id) { return "vocabfr.duel:" + (Storage.getUser() || "") + ":" + id; }
  function saved(id) { try { const v = JSON.parse(localStorage.getItem(key(id)) || "null"); return v && typeof v === "object" ? v : null; } catch (e) { return null; } }
  function save(p) {
    try { localStorage.setItem(key(p.id), JSON.stringify({ idx: p.idx, answers: p.answers, oks: p.oks, ms: p.ms, lang: p.lang, at: Date.now() })); } catch (e) {}
  }
  function forget(id) { try { localStorage.removeItem(key(id)); } catch (e) {} }

  // --- Liste, badge ---
  async function load() {
    if (!on() || status === "missing") return;
    const my = ++token;
    try {
      const d = await rpc("duel_list");
      if (my !== token) return;
      data = d || { duels: [], stats: [], invites: 0 }; status = "ok"; err = "";
      invites = num(Number(data.invites), 0);
      awardWins();
      retrySubmits();
    } catch (e) {
      if (my !== token) return;
      if (alIsMissing(e)) { status = "missing"; data = null; invites = 0; }
      else err = errText(e);
    }
  }
  async function refreshBadge() {
    if (!on() || status === "missing") { invites = 0; return; }
    try { invites = num(Number(await rpc("duel_badge")), 0); status = "ok"; }
    catch (e) { if (alIsMissing(e)) { status = "missing"; invites = 0; } }
  }
  function inviteCount() { return on() && status !== "missing" ? invites : 0; }
  // Victoires : bonus d'XP une seule fois par duel (clé gardée dans le morceau xp, donc sur tous les appareils).
  function awardWins() {
    if (typeof XP === "undefined") return;
    arr(data && data.duels).forEach(d => {
      if (d.status !== "done" || d.winner !== "me") return;
      const got = XP.onDuelWin(d.id);
      if (got) toast("🏆 " + t("du.winToast", { id: d.other_name, n: got }));
    });
  }
  // Scores gardés sur l'appareil (pas partis) : renvoyés.
  function retrySubmits() {
    arr(data && data.duels).forEach(d => {
      const s = saved(d.id);
      if (!s) return;
      if (d.my_done || !["pending", "active"].includes(d.status)) { forget(d.id); return; }
      if (s.idx >= DUEL.CARDS && (!play || play.id !== d.id)) submitSaved(d, s);
    });
  }
  async function submitSaved(d, s) {
    try {
      await rpc("duel_submit", { p_id: d.id, p_answers: s.answers, p_ms: Math.round(s.ms) });
      forget(d.id);
      if (typeof XP !== "undefined") XP.onDuel(d.id, s.oks, s.lang || d.lang);
      Friends.publish(false);
      load().then(rerender);
    } catch (e) {
      if (sbErrKind(e) !== "net") forget(d.id);   // refusé (déjà envoyé, durée impossible…) : rien à refaire
    }
  }

  // --- Actions sur une invitation ---
  async function act(fn, okText) {
    if (busy) return;
    busy = true; rerender();
    try { const r = await fn(); if (okText) toast(typeof okText === "function" ? okText(r) : okText); }
    catch (e) { toast(errText(e)); }
    busy = false;
    await load(); refreshBadgeView(); rerender();
  }
  function refreshBadgeView() { invites = num(Number(data && data.invites), invites); Friends.renderBadge(); }
  function accept(d) {
    act(async () => {
      const r = await rpc("duel_accept", { p_id: d.id });
      openModal(t("du.acceptedTitle"), el("p", null, t("du.acceptedText", { id: d.other_name })), [
        { label: t("du.later") }, { label: t("du.play"), kind: "primary", onClick: () => { startPlay(r || d); } }]);
      return r;
    });
  }
  function decline(d) { act(() => rpc("duel_decline", { p_id: d.id }), t("du.declined", { id: d.other_name })); }
  function rematch(d) {
    act(async () => {
      const r = await rpc("duel_rematch", { p_id: d.id });
      toast(t("du.sent", { id: d.other_name }));
      askPlay(r);
      return r;
    });
  }
  function askPlay(d) {
    if (!d || !d.can_play) return;
    openModal(t("du.sentTitle"), el("p", null, t("du.sentText", { id: d.other_name })), [
      { label: t("du.later") }, { label: t("du.play"), kind: "primary", onClick: () => { startPlay(d); } }]);
  }

  // --- Défier : choix de l'ami, de la liste et de la langue ---
  function lists() { return arr(state.lists).filter(l => cardsOf(l.id).some(isVocab)); }
  async function friendInfo(uid) {
    if (friendLangs.has(uid)) return friendLangs.get(uid);
    try {
      const r = await rpc("duel_friend_langs", { p_friend: uid });
      const v = { known: !!(r && r.known), langs: arr(r && r.langs).filter(isLang), ui: r && r.ui_lang };
      friendLangs.set(uid, v);
      return v;
    } catch (e) { return { known: false, langs: [], ui: null, err: errText(e) }; }
  }
  // Valeurs du dictionnaire commun des cartes reliées (une seule lecture par sens).
  async function fetchSenses(cards) {
    if (typeof Dict === "undefined" || !Dict.usable() || Dict.status() === "missing") return;
    const ids = [...new Set(cards.map(c => c.senseId).filter(id => id && !senseVals.has(id)))];
    for (let i = 0; i < ids.length; i += DUEL.DICT_N) {
      const part = ids.slice(i, i + DUEL.DICT_N);
      try {
        const res = arr(await rpc("dict_get", { p_ids: part, p_known: {} }));
        res.forEach(x => { if (x && x.id) senseVals.set(x.id, x.gone ? {} : dictSenseVals(x.vals)); });
        part.forEach(id => { if (!senseVals.has(id)) senseVals.set(id, {}); });
      } catch (e) { part.forEach(id => senseVals.set(id, {})); }
    }
  }
  // Cartes possibles d'une liste dans la langue L : mot en L (carte ou dictionnaire), au moins une traduction, mots différents.
  async function candidates(list, L) {
    const cards = shuffle(cardsOf(list.id).filter(isVocab)).slice(0, DUEL.SCAN_MAX);
    await fetchSenses(cards);
    const out = [], seen = new Set();
    cards.forEach(c => {
      const sv = (c.senseId && senseVals.get(c.senseId)) || {};
      const val = code => String(term(c, code) || sv["w:" + code] || "").replace(/\s+/g, " ").trim().slice(0, 120);
      const w = val(L), k = normText(w);
      if (!w || !k || seen.has(k)) return;
      const tr = {};
      Object.keys(LANGUAGES).forEach(code => { if (code !== L) { const v = val(code); if (v) tr[code] = v; } });
      if (!Object.keys(tr).length) return;
      seen.add(k);
      out.push({ w, t: tr });
    });
    return out;
  }
  function openCreate(friend) {
    const friends = arr(Friends.data() && Friends.data().friends);
    if (!friends.length) { toast(t("du.noFriends")); return; }
    const ls = lists();
    if (!ls.length) { toast(t("du.noList")); return; }
    const f = { friend: (friend && friend.user_id) || friends[0].user_id, listId: ls[0].id, lang: "", cands: null, info: null, ver: 0 };
    const body = el("div", "du-create");
    let close = null;
    const sel = (label, opts, value, onChange) => {
      const lab = el("label", "du-f");
      const s = el("select", "input");
      opts.forEach(([v, tx]) => { const o = el("option", null, tx); o.value = v; s.appendChild(o); });
      s.value = value;
      s.addEventListener("change", () => onChange(s.value));
      lab.append(el("span", null, label), s);
      return lab;
    };
    const fname = () => (friends.find(x => x.user_id === f.friend) || {}).identifiant || "?";
    async function refresh() {
      const ver = ++f.ver;
      f.cands = null; f.info = null; draw();
      const info = await friendInfo(f.friend);
      if (ver !== f.ver) return;
      const l = getList(f.listId), mine = studyLangs(l);
      const common = mine.filter(L => info.langs.includes(L));
      let langs, note = "";
      if (common.length) langs = common;
      else if (info.langs.length) { langs = info.langs; note = t("du.otherLang", { id: fname(), l: mine.map(x => langName(x)).join(", ") }); }
      else { langs = mine; note = t("du.langsUnknown", { id: fname() }); }
      if (!langs.includes(f.lang)) f.lang = langs[0];
      f.info = { langs, note };
      draw();
      const cands = await candidates(l, f.lang);
      if (ver !== f.ver) return;
      f.cands = cands;
      draw();
    }
    function draw() {
      body.textContent = "";
      body.appendChild(sel(t("du.friend"), friends.map(x => [x.user_id, x.identifiant]), f.friend, v => { f.friend = v; f.lang = ""; refresh(); }));
      body.appendChild(sel(t("du.list"), ls.map(l => [l.id, listLabel(l)]), f.listId, v => { f.listId = v; f.lang = ""; refresh(); }));
      if (!f.info) { body.appendChild(el("p", "muted", t("am.loading"))); return; }
      body.appendChild(sel(t("du.lang"), f.info.langs.map(L => [L, langName(L)]), f.lang, v => { f.lang = v; refresh(); }));
      if (f.info.note) body.appendChild(el("p", "hint", f.info.note));
      if (!f.cands) { body.appendChild(el("p", "muted", t("du.searching"))); return; }
      const n = f.cands.length;
      body.appendChild(el("p", n >= DUEL.CARDS ? "du-ok" : "q-err",
        n >= DUEL.CARDS ? t("du.enough", { n, l: langName(f.lang) }) : t("du.notEnough", { n, m: DUEL.CARDS, l: langName(f.lang) })));
      body.appendChild(el("p", "hint", t("du.createHint")));
    }
    async function send() {
      if (busy) return;
      if (!f.cands || f.cands.length < DUEL.CARDS) {
        toast(f.cands ? t("du.notEnough", { n: f.cands.length, m: DUEL.CARDS, l: langName(f.lang) }) : t("du.searching"));
        return;
      }
      busy = true;
      try {
        const cards = shuffle(f.cands.slice()).slice(0, DUEL.CARDS);
        const r = await rpc("duel_create", { p_friend: f.friend, p_lang: f.lang, p_cards: cards });
        if (close) close();
        toast(t("du.sent", { id: fname() }));
        busy = false;
        await load(); rerender();
        askPlay(r);
      } catch (e) { busy = false; toast(errText(e)); }
    }
    close = openModal(t("du.create"), body, [
      { label: t("cancel") },
      { label: t("du.send"), kind: "primary", onClick: () => { send(); return false; } }]);
    refresh();
  }

  // --- Partie ---
  async function startPlay(d) {
    if (busy || !d) return;
    if (play && play.id === d.id) { go(); return; }
    busy = true;
    try {
      const r = await rpc("duel_start", { p_id: d.id });
      const cards = arr(r && r.cards), quiz = arr(r && r.quiz);
      if (cards.length < 4 || !quiz.length) throw new Error("bad");
      const s = saved(d.id) || {};
      play = {
        id: d.id, duel: (r && r.duel) || d, cards, quiz, lang: (r && r.duel && r.duel.lang) || d.lang,
        idx: clampInt(s.idx, 0, quiz.length, 0), answers: arr(s.answers).slice(0, quiz.length),
        oks: arr(s.oks).slice(0, quiz.length), ms: num(s.ms, 0), pick: null, qStart: 0, sending: false, result: null, error: "", xp: 0
      };
      play.idx = Math.min(play.idx, play.answers.length, play.oks.length);   // reprise : réponses déjà données gardées
      play.answers = play.answers.slice(0, play.idx); play.oks = play.oks.slice(0, play.idx);
      busy = false;
      go();
      if (play.idx >= quiz.length) submit();
    } catch (e) { busy = false; toast(errText(e)); load().then(rerender); }
  }
  function go() {
    if (currentScreen !== "friends") {
      try { history.replaceState(null, "", "#" + HASH_OF.friends); } catch (e) {}
      showScreen("friends");
    } else rerender();
    startTick();
  }
  function startTick() {
    clearInterval(tick);
    tick = setInterval(() => {
      if (!play || play.result || play.idx >= play.quiz.length) { clearInterval(tick); tick = null; return; }
      if (play.pick == null && play.qStart && Date.now() - play.qStart >= DUEL.Q_MS) { answer(-1); return; }
      const bar = document.getElementById("duBar");
      if (bar && play.qStart) bar.style.width = Math.max(0, 100 - (Date.now() - play.qStart) * 100 / DUEL.Q_MS) + "%";
    }, 200);
  }
  // Langue de la question pour moi : interface, appui de la langue du duel, autres langues d'appui, puis toute langue.
  function qLangs() {
    const out = [state.settings.uiLang];
    try { learningOf().forEach(x => { if (x.lang === play.lang && x.support) out.push(x.support); }); } catch (e) {}
    try { learningOf().forEach(x => { if (x.support) out.push(x.support); if (x.lang !== play.lang) out.push(x.lang); }); } catch (e) {}
    return [...new Set(out.concat(["en", "fr", "ko"], Object.keys(LANGUAGES)))].filter(L => L !== play.lang);
  }
  function answer(i) {
    const p = play;
    if (!p || p.pick != null || p.idx >= p.quiz.length || !p.qStart) return;
    const q = p.quiz[p.idx];
    const ms = Math.min(Math.max(Date.now() - p.qStart, 0), DUEL.Q_MS);
    const choice = i >= 0 ? num(Number(q.o[i]), -1) : -1;
    const ok = choice === num(Number(q.c), -2);
    p.pick = i;
    p.answers.push(choice); p.oks.push(ok); p.ms += ms;
    save(p);
    try { GameSound.play(ok ? "ok" : "bad"); } catch (e) {}
    try { const w = p.cards[q.c] && p.cards[q.c].w; if (w) gameAutoSpeak(w, p.lang); } catch (e) {}
    rerender();
    setTimeout(() => {
      if (play !== p) return;
      p.pick = null; p.idx++; p.qStart = 0;
      if (p.idx >= p.quiz.length) submit();
      rerender();
    }, ok ? DUEL.OK_MS : DUEL.BAD_MS);
  }
  async function submit() {
    const p = play;
    if (!p || p.sending || p.result) return;
    p.sending = true; p.error = ""; rerender();
    try {
      const r = await rpc("duel_submit", { p_id: p.id, p_answers: p.answers, p_ms: Math.round(p.ms) });
      p.result = r || {};
      forget(p.id);
      if (typeof XP !== "undefined") p.xp = XP.onDuel(p.id, p.oks, p.lang);
      try { GameSound.play("end"); } catch (e) {}
      Friends.publish(false);
      await load();
      const d = arr(data && data.duels).find(x => x.id === p.id);
      if (d) p.result = d;
    } catch (e) {
      const hint = String((e && e.hint) || "");
      if (sbErrKind(e) === "net") p.error = t("du.err.netKeep");
      else { forget(p.id); p.error = errText(e); if (hint === "du_already") { await load(); p.result = arr(data && data.duels).find(x => x.id === p.id) || null; } }
    }
    p.sending = false;
    rerender();
  }
  function leave() { play = null; clearInterval(tick); tick = null; load().then(rerender); rerender(); }
  function reset() {
    token++; status = "unknown"; data = null; invites = 0; err = ""; busy = false;
    play = null; clearInterval(tick); tick = null; friendLangs.clear(); senseVals.clear();
  }

  return {
    load, refreshBadge, inviteCount, reset, openCreate, accept, decline, rematch, startPlay, answer, submit, leave, qLangs,
    status: () => status, data: () => data, err: () => err, busy: () => busy, play: () => play, startTick
  };
})();

// --- Écran Amis : partie de duel en cours (remplace le reste de l'écran) ---
function duRenderPlay(root) {
  const p = Duels.play();
  const n = p.quiz.length;
  const top = el("div", "adm-top");
  top.appendChild(el("h2", null, "⚔️ " + t("du.vs", { id: p.duel.other_name || "?" })));
  root.appendChild(top);
  if (p.idx >= n || p.result || p.sending || p.error) { root.appendChild(duResultCard(p)); return; }
  const q = p.quiz[p.idx], card = p.cards[q.c] || { w: "", t: {} };
  if (!p.qStart && p.pick == null) p.qStart = Date.now();
  const meta = el("div", "meta-row gm-meta");
  const ok = p.oks.filter(Boolean).length;
  const sc = el("span", "gm-score");
  sc.append(el("span", "gm-okn", "✓ " + ok), document.createTextNode("  "), el("span", "gm-badn", "✗ " + (p.oks.length - ok)));
  meta.append(el("span", "gm-left", t("gm.q", { i: p.idx + 1, n })), sc);
  root.appendChild(meta);
  const tm = el("div", "sk-bar du-timer");
  const fill = el("span"); fill.id = "duBar";
  fill.style.width = Math.max(0, 100 - (Date.now() - p.qStart) * 100 / DUEL.Q_MS) + "%";
  tm.appendChild(fill);
  root.appendChild(tm);
  // Question : traduction dans ma langue (interface, puis appui…), réponses dans la langue du duel
  const codes = Duels.qLangs().filter(L => card.t && card.t[L]);
  const qc = el("div", "card gm-q");
  if (codes.length) {
    qc.appendChild(el("div", "sw-lang", langName(codes[0])));
    const m = el("div", "gm-qmain", card.t[codes[0]]); m.lang = codes[0];
    qc.appendChild(m);
    if (codes[1]) { const s = el("div", "gm-qsub", card.t[codes[1]]); s.lang = codes[1]; qc.appendChild(s); }
  }
  qc.appendChild(el("div", "gm-ask", t("gm.mcq.pick", { lang: langName(p.lang) })));
  root.appendChild(qc);
  const grid = el("div", "gm-choices");
  arr(q.o).forEach((ci, i) => {
    const c = p.cards[ci] || { w: "?" };
    const b = el("button", "gm-choice", c.w);
    b.type = "button"; b.lang = p.lang;
    if (p.pick != null) {
      if (ci === q.c) b.classList.add("right");
      else if (i === p.pick) b.classList.add("wrong");
      b.setAttribute("aria-disabled", "true");
    }
    b.addEventListener("click", () => Duels.answer(i));
    grid.appendChild(b);
  });
  root.appendChild(grid);
  if (p.pick === -1) root.appendChild(el("p", "gm-res bad", t("du.timeUp")));
  root.appendChild(el("p", "hint", t("du.playHint", { s: DUEL.Q_MS / 1000 })));
  Duels.startTick();
}
// Fin de partie : envoi du score, résultat (et celui de l'ami si le duel est fini), revanche.
function duResultCard(p) {
  const c = el("div", "card gm-sum du-sum");
  const n = p.quiz.length, mine = p.oks.filter(Boolean).length;
  const r = p.result;
  if (p.sending) { c.appendChild(el("p", "muted", t("du.sending"))); return c; }
  if (p.error && !r) {
    c.appendChild(el("p", "q-err", p.error));
    const row = el("div", "btns two");
    const retry = el("button", "btn primary", t("du.retry"));
    retry.addEventListener("click", () => Duels.submit());
    const back = el("button", "btn", t("du.back"));
    back.addEventListener("click", () => Duels.leave());
    if (p.error === t("du.err.netKeep")) row.appendChild(retry);
    row.appendChild(back);
    c.appendChild(row);
    return c;
  }
  if (r && r.status === "done") {
    const w = r.winner;
    c.appendChild(el("h2", "du-verdict " + (w || ""), w === "me" ? "🏆 " + t("du.win") : w === "other" ? t("du.lose") : t("du.tie")));
    c.appendChild(duScoreLine(r));
  } else {
    c.appendChild(el("h2", null, t("du.yourScore", { s: mine, n })));
    c.appendChild(el("p", "muted", t("du.time", { s: duSec(p.ms) })));
    c.appendChild(el("p", "hint", t("du.waitOther", { id: (r && r.other_name) || p.duel.other_name || "?" })));
  }
  if (p.xp) c.appendChild(el("p", "xp-gain", t("xp.plus", { n: p.xp })));
  c.appendChild(el("p", "hint", t("du.noProgress")));
  const row = el("div", "btns" + (r && r.status === "done" ? " two" : ""));
  if (r && r.status === "done") {
    const rb = el("button", "btn primary", "⚔️ " + t("du.rematch"));
    rb.addEventListener("click", () => { Duels.leave(); Duels.rematch(r); });
    row.appendChild(rb);
  }
  const back = el("button", "btn", t("du.back"));
  back.addEventListener("click", () => Duels.leave());
  row.appendChild(back);
  c.appendChild(row);
  return c;
}
function duSec(ms) { return (Math.round(num(Number(ms), 0) / 100) / 10).toLocaleString(state.settings.uiLang); }
// « 8 – 7 · 32,4 s / 35,1 s » (moi d'abord)
function duScoreLine(d) {
  return el("p", "du-score", t("du.scoreLine", { a: d.my_score, b: d.other_score, n: DUEL.CARDS, ta: duSec(d.my_ms), tb: duSec(d.other_ms), id: d.other_name }));
}

// --- Écran Amis : carte « Duels » ---
function duCard() {
  const c = el("div", "card du-card");
  c.appendChild(el("h2", null, "⚔️ " + t("du.title")));
  if (Duels.status() === "missing") { c.appendChild(el("p", "q-err", t("du.missing"))); return c; }
  const d = Duels.data();
  if (!d) { c.appendChild(el("p", "muted", Duels.err() || t("am.loading"))); return c; }
  const nb = el("button", "btn primary du-new", "⚔️ " + t("du.create"));
  nb.type = "button"; nb.disabled = Duels.busy() || !arr(Friends.data() && Friends.data().friends).length;
  nb.addEventListener("click", () => Duels.openCreate());
  c.appendChild(nb);
  const all = arr(d.duels);
  const inv = all.filter(x => x.can_answer);
  const mine = all.filter(x => !x.can_answer && x.can_play);
  const wait = all.filter(x => !x.can_answer && !x.can_play && ["pending", "active"].includes(x.status));
  const done = all.filter(x => !["pending", "active"].includes(x.status)).slice(0, 10);
  const sec = (title, list) => {
    if (!list.length) return;
    c.appendChild(el("h3", "np-h3", title));
    list.forEach(x => c.appendChild(duRow(x)));
  };
  sec(t("du.invites", { n: inv.length }), inv);
  sec(t("du.yourTurn"), mine);
  sec(t("du.waiting"), wait);
  sec(t("du.finished"), done);
  if (!all.length) c.appendChild(el("p", "muted am-empty", t("du.none")));
  const st = arr(d.stats);
  if (st.length) {
    c.appendChild(el("h3", "np-h3", t("du.history")));
    const dl = el("dl", "am-dl");
    st.forEach(s => {
      dl.append(el("dt", null, s.identifiant), el("dd", null, t("du.record", { w: num(Number(s.wins), 0), l: num(Number(s.losses), 0), e: num(Number(s.ties), 0) })));
    });
    c.appendChild(dl);
  }
  return c;
}
function duDays(iso) { const ms = Date.parse(iso) - Date.now(); return isNaN(ms) ? 0 : Math.max(1, Math.ceil(ms / 86400000)); }
function duRow(x) {
  const lang = langName(x.lang);
  let sub = "";
  const acts = [];
  if (x.can_answer) {
    sub = t("du.inviteSub", { l: lang, d: duDays(x.expires_at) });
    acts.push([t("am.accept"), "primary", () => Duels.accept(x)], [t("am.decline"), "", () => Duels.decline(x)]);
  } else if (x.can_play) {
    sub = x.status === "pending" ? t("du.notAccepted", { l: lang }) : t("du.toPlay", { l: lang });
    acts.push([t("du.play"), "primary", () => Duels.startPlay(x)]);
  } else if (x.status === "pending" || x.status === "active") {
    sub = t("du.myScore", { s: x.my_score, n: DUEL.CARDS, t: duSec(x.my_ms) }) + " · " +
      (x.status === "pending" ? t("du.notAcceptedShort") : t("du.otherToPlay"));
  } else if (x.status === "done") {
    sub = (x.winner === "me" ? "🏆 " + t("du.win") : x.winner === "other" ? t("du.lose") : t("du.tie")) + " · " +
      t("du.scoreShort", { a: x.my_score, b: x.other_score, ta: duSec(x.my_ms), tb: duSec(x.other_ms) });
    acts.push(["⚔️ " + t("du.rematch"), "", () => Duels.rematch(x)]);
  } else {
    sub = t(x.status === "declined" ? (x.role === "challenger" ? "du.wasDeclined" : "du.youDeclined") : "du.expired");
  }
  const row = amPersonRow({ identifiant: x.other_name }, sub, acts);
  row.querySelectorAll("button").forEach(b => { b.disabled = Duels.busy(); });
  return row;
}
