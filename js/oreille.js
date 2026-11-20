"use strict";

// === L'OREILLE ET LA BOUCHE (ÉTAPE 69) ===
// Deux modes d'ENTRAÎNEMENT de Réviser (pastilles « Jeux d'entraînement », à côté de « le / la ? ») :
// - "minimal" (👂 Paires minimales) : l'appli lit un mot, on choisit lequel on a entendu parmi deux mots proches.
//   Paires = listes FIXES de js/oreille-paires.js (EAR_PAIRS, fr et ko) + « Mots qui se ressemblent » de l'étape 57
//   (Hard.pairs, deux cartes du périmètre). Langues = langues étudiées du périmètre (et le choix « Langues » s'il y en a un).
// - "shadow" (🗣️ Répéter après la voix) : la phrase d'exemple d'une carte (langue étudiée) est lue, on la répète tout de suite.
//   Micro FACULTATIF : avec la reconnaissance vocale de l'étape 46 (SpeechRec), simple indication « proche » / « à retravailler »,
//   jamais de note ; sans micro (ou micro refusé), on écoute et on répète à voix haute. L'appli n'enregistre et n'envoie rien.
// Voix : synthèse vocale existante (Speech). Sans voix pour une langue : langue écartée ; aucune voix : message clair, pas d'erreur.
// PROGRESSION : jamais touchée (ni Leitner, ni FSRS, ni Hard, ni historique, ni série, ni défis, ni bilans d'oubli).
// XP seulement : XP.onEar (XP_RULES.ear, js/xp.js) = +1 par bonne paire, +1 par phrase répétée, anti-répétition 60 s.
// Session : rv.s = { mode, queue: [], ear: e, … } ; e = { kind, items, idx, ok, bad, said, done, missed, startedAt, seconds }.
// L'affichage est refait à partir de rv.s.ear (un render() pendant la session ne perd rien). Aucun réglage, aucune donnée nouvelle.
const EAR_MODES = ["minimal", "shadow"];
const EAR_ICON = { minimal: "👂", shadow: "🗣️" };
const EAR_NEXT_MS = 900;      // bonne paire : question suivante après ce délai
const EAR_GAP_MS = 600;       // « Écouter les deux » : pause entre les deux mots
const EAR_CLOSE = 0.75;       // répéter : « proche » si la phrase comprise ressemble à 75 % ou plus (sinon « à retravailler »)
const EAR_ERRS = {
  "not-allowed": "ear.sh.err.denied", "service-not-allowed": "ear.sh.err.denied", "audio-capture": "ear.sh.err.mic",
  "network": "ear.sh.err.network", "language-not-supported": "ear.sh.err.lang", "no-speech": "ear.sh.err.nospeech"
};
function isEarMode(m) { return EAR_MODES.includes(m); }

// --- Sources ---
function earWord(c, L) { return String(term(c, L) || "").split("/")[0].trim(); }
// Paires disponibles par langue pour le périmètre de la session : { langs, by: { L: { app: [...], mine: [...] } } }.
// Paire = { w: [mot 1, mot 2], hint (son travaillé), src: "app" | "mine" }.
function earMinimalSource(cfg) {
  const now = Date.now(), lgs = langsByList(), set = new Set(), ids = new Set();
  sessionPool(cfg, "base").forEach(c => {
    ids.add(c.id);
    sessionLangs(c, cfg, now, lgs.get(c.listId), "base").forEach(L => set.add(L));
  });
  let langs = LANG_CODES.filter(L => set.has(L));
  if (arr(cfg.langs).length) langs = langs.filter(L => cfg.langs.includes(L));
  const by = {};
  langs.forEach(L => {
    const app = arr(EAR_PAIRS[L]).map(p => ({ w: [p[0], p[1]], hint: p[2] || "", src: "app" }));
    const mine = [];
    Hard.pairs(L).forEach(p => {
      if (!ids.has(p.a) || !ids.has(p.b)) return;
      const ca = state.cards.find(c => c.id === p.a), cb = state.cards.find(c => c.id === p.b);
      const a = ca && earWord(ca, L), b = cb && earWord(cb, L);
      if (!a || !b || lisKey(a, L) === lisKey(b, L)) return;
      mine.push({ w: [a, b], hint: "", src: "mine" });
    });
    if (app.length || mine.length) by[L] = { app, mine };
  });
  return { langs: langs.filter(L => by[L]), by };
}
// Pastille « Paires minimales » : une langue étudiée a une liste fixe, ou il existe des « mots qui se ressemblent ».
function earMinimalAny() {
  try { return targetLangsInUse().some(L => arr(EAR_PAIRS[L]).length) || Hard.pairs().length > 0; } catch (e) { return false; }
}
// Phrase d'exemple d'une carte dans la langue L (ou ""), et ses traductions dans les langues affichées.
function earSentence(c, L) { return isVocab(c) ? exText(c, L).replace(/\s+/g, " ").trim() : ""; }
function earShadowAny() { return state.cards.some(c => isVocab(c) && cardStudyLangs(c).some(L => earSentence(c, L))); }
// Langues des phrases possibles (pour l'avertissement « sans voix »).
function earShadowLangs(cfg) {
  const now = Date.now(), lgs = langsByList(), set = new Set();
  sessionPool(cfg).forEach(c => sessionLangs(c, cfg, now, lgs.get(c.listId)).forEach(L => set.add(L)));
  return LANG_CODES.filter(L => set.has(L));
}

// --- Choix de la session (appelé par renderSessionConfig, js/screens/reviser.js) ---
// Ajoute les explications sous les pastilles et renvoie le texte « N paires / phrases disponibles ».
function earConfig(box, cfg) {
  box.appendChild(el("div", "hint ear-hint", t(cfg.mode === "minimal" ? "ear.hint.minimal" : "ear.hint.shadow")));
  let langs, n;
  if (cfg.mode === "minimal") {
    const src = earMinimalSource(cfg);
    langs = src.langs;
    n = 0; let mine = 0;
    langs.forEach(L => { n += src.by[L].app.length + src.by[L].mine.length; mine += src.by[L].mine.length; });
    if (mine) box.appendChild(el("div", "hint", t("ear.mineCount", { n: mine })));
    if (!langs.length) box.appendChild(el("div", "hint", t("ear.need.minimal")));
  } else {
    langs = earShadowLangs(cfg);
    n = sessionPool(cfg).length;
    if (lisCanSpeak()) box.appendChild(el("div", "hint", t("ear.hint.mic")));
  }
  const vo = lisVoiceInfo(langs);
  if (langs.length && !vo.ok) box.appendChild(el("div", "hint ear-warn", t(vo.loading ? "ls.voiceLoading" : "ear.noVoice")));
  else if (vo.missing.length) box.appendChild(el("div", "hint", t("ear.noVoiceSome", { langs: vo.missing.map(langName).join(", ") })));
  return t(cfg.mode === "minimal" ? "ear.avail.minimal" : "ear.avail.shadow", { n });
}

// --- Lancement ---
// Renvoie true si la session démarre ou si un message « rien à écouter » est affiché. items : relancer ces éléments-là.
function startEar(cfg, items) {
  const kind = cfg.mode === "shadow" ? "shadow" : "minimal";
  let list = items ? items.map(it => Object.assign({}, it, { pick: null, played: false, said: false, mic: null, left: false }, it.w ? { ans: Math.random() < 0.5 ? 0 : 1 } : {})) : null;
  const langs = {};
  if (!list) {
    list = kind === "minimal" ? earBuildMinimal(cfg) : earBuildShadow(cfg, langs);
    if (!list.length) return earNothing(kind, cfg);
  } else list.forEach(it => { if (it.id) langs[it.id] = it.L; });
  const e = { kind, items: list, idx: 0, ok: 0, bad: 0, said: 0, done: false, missed: [], startedAt: Date.now() };
  rv.s = { queue: [], mode: kind, revealed: false, counts: { known: 0, review: 0, unknown: 0 }, log: [], first: {}, dirs: {}, langs, lks: {},
    startedAt: e.startedAt, ear: e };
  setSessionLangs(langs);
  rv.phase = "run";
  renderReview();
  window.scrollTo(0, 0);
  return true;
}
function earBuildMinimal(cfg) {
  const src = earMinimalSource(cfg), app = [], mine = [];
  src.langs.filter(L => Speech.has(L)).forEach(L => {
    src.by[L].app.forEach(p => app.push(Object.assign({ L }, p)));
    src.by[L].mine.forEach(p => mine.push(Object.assign({ L }, p)));
  });
  const n = Math.max(1, num(cfg.count, 20));
  const pick = shuffle(mine).slice(0, Math.ceil(n / 2));          // tes paires d'abord (au plus la moitié), puis les listes fixes
  const out = shuffle(pick.concat(shuffle(app).slice(0, n - pick.length)));
  return out.map(p => ({ L: p.L, w: p.w, hint: p.hint, src: p.src, ans: Math.random() < 0.5 ? 0 : 1, pick: null, played: false }));
}
function earBuildShadow(cfg, langs) {
  const now = Date.now(), lgs = langsByList(), out = [];
  const n = Math.max(1, num(cfg.count, 20));
  for (const c of shuffle(sessionPool(cfg).filter(isVocab))) {
    if (out.length >= n) break;
    const ls = sessionLangs(c, cfg, now, lgs.get(c.listId)).filter(L => earSentence(c, L) && Speech.has(L));
    if (!ls.length) continue;
    const L = ls[Math.floor(Math.random() * ls.length)];
    langs[c.id] = L;
    out.push({ id: c.id, L, text: earSentence(c, L), played: false, said: false, mic: null });
  }
  return out;
}
// Rien à poser : message clair (aucune voix, ou pas de paire / phrase).
function earNothing(kind, cfg) {
  const langs = kind === "minimal" ? earMinimalSource(cfg).langs : earShadowLangs(cfg);
  const st = Speech.status();
  const key = st === "none" || (langs.length && !langs.some(L => Speech.has(L)))
    ? (st === "loading" ? "ls.voiceLoading" : "ear.noVoice")
    : (kind === "minimal" ? "ear.need.minimal" : "ear.need.shadow");
  openModal(t("ear.need.title"), el("p", null, t(key)), [{ label: t("ann.ok"), kind: "primary" }]);
  return true;
}

// --- Session ---
function earRerender(e) { if (rv.s && rv.s.ear === e && currentScreen === "review") renderReview(); }
function earIsLive(e, it) { return !!(rv.s && rv.s.ear === e && !e.done && e.items[e.idx] === it); }
function earNext(e, it) {
  if (it.left || !earIsLive(e, it)) return;
  it.left = true;
  Speech.stop();
  if (typeof SpeechRec !== "undefined") SpeechRec.stop();
  e.idx++;
  if (e.idx >= e.items.length) earFinish(e);
  earRerender(e);
}
function earSay(text, L, slow) { Speech.speak(text, L, slow ? { slow: true } : undefined); }
function earBtn(label, cls, fn) {
  const b = el("button", cls || "btn", label);
  b.type = "button";
  b.addEventListener("click", fn);
  return b;
}

function renderEarSession(root) {
  const e = rv.s && rv.s.ear;
  if (!e) { endSession(); return; }
  if (e.done) { earSummary(root, e); return; }
  if (e.kind === "shadow") while (e.idx < e.items.length && !sessionCard(e.items[e.idx].id)) e.idx++;   // carte supprimée entre-temps
  if (e.idx >= e.items.length) { earFinish(e); earSummary(root, e); return; }
  const it = e.items[e.idx];
  const meta = el("div", "meta-row gm-meta");
  const sc = el("span", "gm-score");
  if (e.kind === "minimal") sc.append(el("span", "gm-okn", "✓ " + e.ok), document.createTextNode("  "), el("span", "gm-badn", "✗ " + e.bad));
  else sc.append(el("span", "gm-okn", EAR_ICON.shadow + " " + e.said));
  meta.append(el("span", "gm-left", t("gm.q", { i: e.idx + 1, n: e.items.length })), sc);
  root.appendChild(meta);
  if (e.kind === "minimal") earMinimalQuestion(root, e, it);
  else earShadowQuestion(root, e, it);
  const quit = el("button", "link-btn", t("gm.quit"));
  quit.addEventListener("click", () => { earFinish(e); earRerender(e); });
  root.appendChild(quit);
}

// Paire minimale : lecture d'un des deux mots, choix, puis son travaillé et « Écouter les deux » si faux.
function earMinimalQuestion(root, e, it) {
  const L = it.L, heard = it.w[it.ans];
  const q = el("div", "card gm-q ear-q");
  q.appendChild(el("div", "sw-lang", langName(L) + (it.src === "mine" ? " · " + t("ear.mine") : "")));
  q.appendChild(el("div", "gm-ask ear-ask", t("ear.ask")));
  const play = el("div", "ear-play");
  play.append(earBtn(t("ear.replay"), "btn ear-big", () => earSay(heard, L)), earBtn(t("ear.slow"), "btn", () => earSay(heard, L, true)));
  q.appendChild(play);
  root.appendChild(q);
  if (!it.played) { it.played = true; earSay(heard, L); }

  const grid = el("div", "gm-choices ear-choices");
  const btns = it.w.map((w, i) => {
    const b = el("button", "gm-choice", w);
    b.type = "button"; b.lang = L;
    b.addEventListener("click", () => answer(i));
    grid.appendChild(b);
    return b;
  });
  root.appendChild(grid);
  const after = el("div", "gm-after");
  root.appendChild(after);
  const live = el("div", "sr-only"); live.setAttribute("aria-live", "polite");
  root.appendChild(live);

  const show = () => {
    btns.forEach((b, i) => {
      b.classList.toggle("right", i === it.ans);
      b.classList.toggle("wrong", i === it.pick && i !== it.ans);
      b.setAttribute("aria-disabled", "true");
    });
    const fb = el("div", "card ear-fb");
    const p = el("div", "ear-heard"); p.lang = L;
    p.textContent = t("ear.heard", { w: heard });
    fb.appendChild(p);
    if (it.hint) fb.appendChild(el("div", "muted", t("ear.sound", { s: it.hint })));
    after.appendChild(fb);
    if (it.pick !== it.ans) {
      const row = el("div", "btns");
      row.append(earBtn(t("ear.both"), "btn", () => Speech.speakSeq([{ text: it.w[0], lng: L }, { text: it.w[1], lng: L }], null, { gap: EAR_GAP_MS })));
      const nb = earBtn(t("gm.next"), "btn primary", () => earNext(e, it));
      row.appendChild(nb);
      after.appendChild(row);
      try { nb.focus({ preventScroll: true }); } catch (x) {}
    }
  };
  if (it.pick != null) { show(); return; }

  function answer(i) {
    if (it.pick != null || !earIsLive(e, it)) return;
    it.pick = i;
    const ok = i === it.ans;
    if (ok) { e.ok++; try { XP.onEar("minimal", L + "|" + it.w[0] + "|" + it.w[1], L); } catch (x) {} }   // +XP seulement : aucune progression
    else { e.bad++; e.missed.push(it); }
    show();
    gameFlash(btns[i], ok);
    GameSound.play(ok ? "ok" : "bad");
    live.textContent = t(ok ? "gm.right" : "gm.wrong");
    const s2 = document.querySelector("#screen-review .gm-score");
    if (s2 && s2.querySelector(".gm-badn")) { s2.querySelector(".gm-okn").textContent = "✓ " + e.ok; s2.querySelector(".gm-badn").textContent = "✗ " + e.bad; }
    if (ok) setTimeout(() => earNext(e, it), EAR_NEXT_MS);
  }
}

// Répéter après la voix : phrase lue (une fois à l'apparition), on la répète ; micro facultatif, indication seulement.
function earShadowQuestion(root, e, it) {
  const c = sessionCard(it.id), L = it.L;
  const q = el("div", "card gm-q ear-q");
  q.appendChild(el("div", "sw-lang", langName(L)));
  const sent = el("div", "ear-sent"); sent.lang = L; sent.textContent = it.text;
  q.appendChild(sent);
  const tr = c ? gameLg(c, L).support.map(code => ({ text: exTr(c, L, code).trim(), lng: code })).filter(x => x.text) : [];
  if (tr.length) { const d = el("div", "ear-tr", tr.map(x => x.text).join(" · ")); d.lang = tr[0].lng; q.appendChild(d); }
  const play = el("div", "ear-play");
  play.append(earBtn(t("ear.sh.listen"), "btn ear-big", () => { stopMic(); earSay(it.text, L); }),
    earBtn(t("ear.slow"), "btn", () => { stopMic(); earSay(it.text, L, true); }));
  q.appendChild(play);
  q.appendChild(el("div", "gm-ask ear-ask", t("ear.sh.do")));
  root.appendChild(q);
  if (!it.played) { it.played = true; earSay(it.text, L); }

  // Micro facultatif (reconnaissance vocale de l'étape 46) : jamais de note, seulement « proche » ou « à retravailler ».
  const m = it.mic || (it.mic = { status: "idle", heard: "", close: null, err: "" });
  function stopMic() { if (m.status === "listening") { SpeechRec.stop(); m.status = "idle"; earRerender(e); } }
  const mic = el("div", "card ear-mic");
  if (lisCanSpeak()) {
    const mb = earBtn(m.status === "listening" ? t("ear.sh.listening") : t("ear.sh.mic"), "btn ear-micbtn" + (m.status === "listening" ? " on" : ""), () => {
      if (!earIsLive(e, it)) return;
      if (m.status === "listening") { stopMic(); return; }
      Speech.stop();
      m.status = "listening"; m.err = "";
      earRerender(e);
      SpeechRec.listen(L, {
        result(list) {
          if (!earIsLive(e, it)) return;
          const r = earCompare(list, it.text, L);
          m.status = "done"; m.heard = r.heard; m.close = r.close;
          earRerender(e);
        },
        error(code) {
          if (!earIsLive(e, it)) return;
          m.status = "idle";
          m.err = EAR_ERRS[code] || "ear.sh.err.other";
          earRerender(e);
        }
      });
    });
    mic.appendChild(mb);
    if (m.status === "done") {
      mic.appendChild(el("div", "ear-verdict " + (m.close ? "close" : "work"), t(m.close ? "ear.sh.close" : "ear.sh.work")));
      if (m.heard) { const h = el("div", "muted ear-heardas", t("ear.sh.heardAs", { t: m.heard })); h.lang = L; mic.appendChild(h); }
    }
    if (m.err) mic.appendChild(el("div", "hint ear-warn", t(m.err, { lang: langName(L) })));
  } else mic.appendChild(el("div", "hint", t("ear.sh.noMic")));
  mic.appendChild(el("div", "hint ear-private", t("ear.sh.private")));
  root.appendChild(mic);

  const row = el("div", "btns");
  row.appendChild(earBtn(t("ear.sh.done"), "btn primary", () => {
    if (!earIsLive(e, it)) return;
    if (!it.said) { it.said = true; e.said++; try { if (c) XP.onEar("shadow", c.id + "|" + L, L); } catch (x) {} }   // +XP seulement
    earNext(e, it);
  }));
  root.appendChild(row);
  const skip = el("button", "link-btn", t("ear.sh.skip"));
  skip.addEventListener("click", () => earNext(e, it));
  root.appendChild(skip);
}
// Ressemblance entre ce que le micro a compris (jusqu'à 5 propositions) et la phrase (clés lisKey : casse, accents, ponctuation).
function earCompare(list, text, L) {
  const target = lisKey(text, L);
  let best = { heard: String(arr(list)[0] || ""), score: -1 };
  arr(list).forEach(h => {
    const k = lisKey(h, L);
    if (!k) return;
    const sc = k === target ? 1 : 1 - earDist(k, target) / Math.max(k.length, target.length, 1);
    if (sc > best.score) best = { heard: String(h), score: sc };
  });
  return { heard: best.heard, close: best.score >= EAR_CLOSE };
}
function earDist(a, b) {   // distance d'édition (caractères)
  a = Array.from(a); b = Array.from(b);
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

function earFinish(e) {
  if (!e || e.done) return;
  e.done = true;
  e.seconds = Math.max(0, Math.round((Date.now() - e.startedAt) / 1000));
  Speech.stop();
  if (typeof SpeechRec !== "undefined") SpeechRec.stop();
  commitQuiet();
  Storage.flushNow();
  GameSound.play("end");
}

function earSummary(root, e) {
  Speech.stop();
  const box = el("div", "card gm-sum");
  box.appendChild(el("h2", null, t("gm.sum.title") + " · " + EAR_ICON[e.kind] + " " + t("mode." + e.kind)));
  const grid = el("div", "sum-grid");
  const cell = (cls, v, k) => { const x = el("div", "sum-cell " + cls); x.append(el("div", "sum-num", v), el("div", "sum-lbl", t(k))); grid.appendChild(x); };
  if (e.kind === "minimal") {
    cell("ok", e.ok + " / " + (e.ok + e.bad), "gm.sum.score");
    cell("", gameDuration(e.seconds || 0), "gm.sum.time");
    cell(e.bad ? "bad" : "", String(e.bad), "gm.sum.errors");
    grid.style.gridTemplateColumns = "repeat(3,1fr)";
  } else {
    cell("ok", String(e.said), "ear.sum.said");
    cell("", gameDuration(e.seconds || 0), "gm.sum.time");
    grid.style.gridTemplateColumns = "repeat(2,1fr)";
  }
  box.appendChild(grid);
  if (e.kind === "minimal" && !e.missed.length && e.ok) box.appendChild(el("div", "sum-ok", t("gm.sum.noErr")));
  if (e.missed.length) {
    box.appendChild(el("div", "ear-mhd", t("ear.sum.missed")));
    const ul = el("div", "ear-missed");
    e.missed.slice(0, 30).forEach(it => {
      const r = el("div", "ear-mrow"); r.lang = it.L;
      r.append(el("b", null, it.w[it.ans]), document.createTextNode(" ≠ " + it.w[1 - it.ans]));
      if (it.hint) r.appendChild(el("span", "muted", "  (" + it.hint + ")"));
      ul.appendChild(r);
    });
    box.appendChild(ul);
  }
  const xg = xpGainLine(rv.s);   // « +N XP » gagnés pendant la session
  if (xg) box.appendChild(xg);
  box.appendChild(el("p", "hint", t("ear.noProgress")));
  root.appendChild(box);
  const btns = el("div", "btns");
  btns.appendChild(earBtn(t("gm.sum.replay"), "btn primary", () => { rv.cfg.mode = e.kind; startEar(rv.cfg); }));
  if (e.missed.length) btns.appendChild(earBtn(t("ear.sum.again", { n: e.missed.length }), "btn", () => { rv.cfg.mode = e.kind; startEar(rv.cfg, e.missed); }));
  btns.appendChild(earBtn(t("sum.new"), "btn", endSession));
  root.appendChild(btns);
}
