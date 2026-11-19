"use strict";

// === GENRE DES NOMS (ÉTAPE 60) ===
// Langues à genre : français, italien, espagnol, portugais (LANGUAGES[code].gender ; l'allemand n'a pas de genre ici).
// Le genre vient de la nature grammaticale de la carte pour la langue étudiée : nm / nmpl = masculin, nf / nfpl = féminin,
// nmf = les deux. Couleur fixe partout où le mot de la langue étudiée est affiché (cartes, listes, révision, jeux) :
// bleu = masculin (.gd-m), rouge = féminin (.gd-f), violet = les deux (.gd-mf) ; couleurs lisibles en clair et en sombre
// (variables --gd-* de css/app.css, section GENRE DES NOMS).
// Réglages (settings.gender = { colors, symbols }, normGender dans js/storage.js) : « colors » (activé par défaut) coupe les
// couleurs ; « symbols » (mode daltonien, désactivé par défaut) ajoute ♂ / ♀ / ⚥ à côté du mot, en plus de la couleur et
// même si les couleurs sont coupées.
// Mode rapide « le / la ? » (mode "gender" de Réviser) : le mot est affiché sans article, on choisit l'article. ENTRAÎNEMENT
// SEULEMENT : n'appelle jamais Leitner (box, dueAt, stats, progress), ni Hard (mots difficiles), ni l'historique, la série, les
// défis ou le journal ; seulement XP.onGender (+XP). Cartes sans genre renseigné, pluriels (nmpl / nfpl) et verbes exclus.
// Noms sans genre renseigné (nature « n » dans une langue à genre, posNeedsGender de js/completion.js) : badge « genre
// manquant » ; demande à Claude par la file d'attente (type « complete » existant, champ pos:<langue> ; tout arrive dans
// « À valider »), sinon « Préparer pour Claude ».

const GD_SYM = { m: "♂", f: "♀", mf: "⚥" };
const GD_CODE = { nm: "m", nmpl: "m", nf: "f", nfpl: "f", nmf: "mf" };
// Articles de base par langue (défini, indéfini) ; les formes réelles (l', lo, uno, un'…) sont calculées par gdPhrase.
const GD_ART = {
  fr: { def: { m: "le", f: "la" }, indef: { m: "un", f: "une" } },
  it: { def: { m: "il", f: "la" }, indef: { m: "un", f: "una" } },
  es: { def: { m: "el", f: "la" }, indef: { m: "un", f: "una" } },
  pt: { def: { m: "o", f: "a" }, indef: { m: "um", f: "uma" } }
};
const GD_ART_KINDS = ["def", "indef", "mix"];
const GD_NEXT_MS = 800;

// --- Réglages ---
function genderSettings() {
  const g = state && state.settings && state.settings.gender;
  return { colors: !(g && g.colors === false), symbols: !!(g && g.symbols === true) };
}

// --- Genre d'une carte ---
// "m" | "f" | "mf" (couleurs : plusieurs formes de nature acceptées) pour une langue à genre, sinon "".
function genderOf(c, lng) {
  if (!c || !lng || !LANGUAGES[lng] || !LANGUAGES[lng].gender || !c.pos || typeof c.pos !== "object") return "";
  return GD_CODE[String(c.pos[lng] || "")] || "";
}
// Langue étudiée dans la session en cours (une langue par carte), sinon langues étudiées de la liste.
function genderStudied(c, lng) {
  if (!c || !isVocab(c)) return false;
  const sl = studyCtxLang(c);
  return sl ? sl === lng : cardStudyLangs(c).includes(lng);
}
function genderName(g) { return t("gd." + g); }
// Petit symbole (mode daltonien, ou toujours dans le mode « le / la ? »).
function genderSym(g) {
  const s = el("span", "gd-sym", GD_SYM[g]);
  s.title = genderName(g);
  s.setAttribute("aria-label", genderName(g));
  return s;
}
// Colore le nœud (texte du mot) selon le genre, et ajoute le symbole si le mode daltonien est actif. À appeler APRÈS le mot et
// AVANT l'étiquette de nature. Sans effet pour une langue sans genre, un mot sans genre ou une langue qui n'est pas étudiée.
function genderMark(node, c, lng) {
  if (!node) return node;
  const g = genderOf(c, lng);
  if (!g || !genderStudied(c, lng)) return node;
  const s = genderSettings();
  if (s.colors) node.classList.add("gd-" + g);
  if (s.symbols) node.appendChild(genderSym(g));
  return node;
}

// --- Genre manquant ---
// Langues étudiées de la carte où le nom n'a pas de genre (« n » dans une langue à genre).
function genderMissingLangs(c) {
  if (!c || !isVocab(c) || typeof posNeedsGender !== "function") return [];
  return cardStudyLangs(c).filter(L => posNeedsGender(c, L));
}
// Badge « genre manquant » (null si rien à signaler).
function genderMissingTag(c) {
  if (!genderMissingLangs(c).length) return null;
  const s = el("span", "tag warn gd-miss", t("gd.missing"));
  s.title = t("gd.missingTitle");
  return s;
}
// Champs demandés à Claude pour une carte : « pos:<langue> » des langues où le genre manque.
function genderWant(c) { return genderMissingLangs(c).map(posField); }
function genderMissingCards(cards) {
  return arr(cards).filter(c => isVocab(c) && canEditList(c.listId) && genderMissingLangs(c).length);
}
function genderMissingCount(listId) { return genderMissingCards(state.cards.filter(c => !listId || c.listId === listId)).length; }
// Demande de compléter le genre : file d'attente Claude (type « complete »), sinon « Préparer pour Claude » (copier-coller).
// Les propositions arrivent dans « À valider » (type Correction : nom sans genre).
async function genderAsk(cards, label) {
  cards = genderMissingCards(cards);
  if (!cards.length) { toast(t("ai.nothingToComplete")); return; }
  if (Queue.usable()) { await queueSubmitCards("complete", cards, genderWant, label || null); return; }
  await AI.ready();
  if (AI.isOn()) { await runAiJob("complete", cards, { want: genderWant }); return; }   // Claude directement (artifact), comme js/study.js
  prepScope = { st: state, ids: new Set(cards.map(c => c.id)), want: genderWant };
  openPrepare("complete", cards);
}
// Fenêtre d'offre : n noms sans genre → « Demander à Claude ».
function genderOffer(cards, label) {
  cards = genderMissingCards(cards);
  if (!cards.length) { toast(t("ai.nothingToComplete")); return; }
  const wrap = el("div");
  wrap.appendChild(el("p", null, t(cards.length === 1 ? "gd.ask.text1" : "gd.ask.text", { n: cards.length })));
  if (Queue.usable()) wrap.appendChild(queueCadenceNote());
  else wrap.appendChild(el("p", "muted", t("gd.ask.noQueue")));
  openModal(t("gd.ask.title"), wrap, [
    { label: t("cancel") },
    { label: t(Queue.usable() ? "queue.ask" : "gd.ask.prepare"), kind: "primary", onClick: () => { genderAsk(cards, label); } }
  ]);
}

// --- Réglages : carte « Genre des noms » ---
function renderGenderCard() {
  const box = $("#genderCard");
  if (!box) return;
  box.textContent = "";
  const s = genderSettings();
  box.appendChild(el("h2", null, "♂♀ " + t("gd.set.title")));
  const row = (key, on, labelKey, hintKey) => {
    const lab = el("label", "check-row");
    const cb = el("input"); cb.type = "checkbox"; cb.checked = on;
    cb.addEventListener("change", () => {
      const cur = genderSettings();
      state.settings.gender = { colors: cur.colors, symbols: cur.symbols };
      state.settings.gender[key] = cb.checked;
      commit();
    });
    lab.append(cb, el("span", null, t(labelKey)));
    box.appendChild(lab);
    if (hintKey) box.appendChild(el("p", "hint", t(hintKey)));
  };
  row("colors", s.colors, "gd.set.colors", "gd.set.colorsHint");
  const leg = el("div", "gd-legend");
  ["m", "f", "mf"].forEach(g => {
    const x = el("span", "gd-leg gd-" + g, genderName(g));
    x.appendChild(genderSym(g));
    leg.appendChild(x);
  });
  box.appendChild(leg);
  row("symbols", s.symbols, "gd.set.symbols", "gd.set.symbolsHint");
  const n = genderMissingCount(null);
  if (n) {
    box.appendChild(el("p", "hint", t(n === 1 ? "gd.set.missing1" : "gd.set.missing", { n })));
    const b = el("button", "btn", t("gd.set.ask"));
    b.type = "button";
    b.addEventListener("click", () => genderOffer(state.cards, t("queue.scope.all")));
    box.appendChild(b);
  }
}

// === ARTICLES ===
// Premier mot du champ (formes séparées par « / »), sans article éventuellement écrit devant (« le livre » → « livre »).
function genderWord(c, L) {
  let w = String(term(c, L) || "").split("/")[0].trim();
  const strip = { fr: /^(?:l['’]|(?:le|la|les|un|une|des)\s+)/i, it: /^(?:l['’]|un['’]|(?:il|lo|la|i|gli|le|un|uno|una)\s+)/i,
    es: /^(?:(?:el|la|los|las|un|una|unos|unas)\s+)/i, pt: /^(?:(?:o|a|os|as|um|uma|uns|umas)\s+)/i }[L];
  if (strip) { const r = w.replace(strip, "").trim(); if (r.length >= 2) w = r; }
  return w;
}
// Nom dont le genre est interrogé : nm, nf ou nmf (pluriels et autres natures exclus).
function genderDrillOf(c, L) {
  if (!c || !GD_ART[L] || !c.pos) return "";
  const p = String(c.pos[L] || "");
  return p === "nm" ? "m" : p === "nf" ? "f" : p === "nmf" ? "mf" : "";
}
const GD_FR_H_ASPIRE = /^h(?:aricot|ache|aie|aine|all|amac|amburger|amster|andicap|angar|anche|arpe|asard|âte|aut|avre|érisson|éros|ibou|ockey|omard|onte|orde|ousse|uit|utte|urler)/i;
function gdVowelStart(L, w) {
  const x = normText(w);
  if (L === "fr") return /^[aeiouy]/.test(x) || (/^h/.test(x) && !GD_FR_H_ASPIRE.test(String(w).toLowerCase()));
  return /^[aeiou]/.test(x) || (L === "it" && /^h/.test(x));
}
// Italien : « lo » / « uno » devant s + consonne, z, gn, ps, pn, x, y.
function gdItLo(w) { return /^(?:s[^aeiou\W]|z|gn|ps|pn|x|y)/i.test(normText(w)); }
// Espagnol : mots féminins à « a » tonique (el agua, un águila…) : liste courte des plus courants.
const GD_ES_TONIC_A = /^(?:agua|águila|aguila|alma|arma|aula|área|area|hacha|hada|hambre|ala|alba|ancla|arpa|asma|ave|hampa|haya|habla)$/i;
// Articles affichés sur les deux boutons (masculin, féminin) : formes de base, « lo » / « uno » seulement en italien.
function genderButtons(L, kind, word) {
  const a = GD_ART[L][kind];
  const lo = L === "it" && gdItLo(word);
  return { m: lo ? (kind === "def" ? "lo" : "uno") : a.m, f: a.f };
}
// Groupe article + mot tel qu'il s'écrit (l'arbre, il libro, lo studente, un'amica, el agua…).
function genderPhrase(L, kind, g, word) {
  const a = GD_ART[L][kind], v = gdVowelStart(L, word);
  if (L === "fr" && kind === "def" && v) return "l’" + word;
  if (L === "it") {
    if (kind === "def") return v ? "l’" + word : (g === "m" ? (gdItLo(word) ? "lo " : "il ") : "la ") + word;
    return g === "f" ? (v ? "un’" + word : "una " + word) : (gdItLo(word) ? "uno " : "un ") + word;
  }
  if (L === "es" && g === "f" && GD_ES_TONIC_A.test(word)) return (kind === "def" ? "el " : "un ") + word;
  return a[g] + " " + word;
}
// Les deux articles côte à côte pour un nom des deux genres : « le / la élève ».
function genderPhraseBoth(L, kind, word) {
  const m = genderPhrase(L, kind, "m", word), f = genderPhrase(L, kind, "f", word);
  const wm = m.slice(0, m.length - word.length), wf = f.slice(0, f.length - word.length);
  return (wm === wf ? wm : wm.replace(/\s$/, "") + " / " + wf) + word;
}

// === MODE « LE / LA ? » ===
// Session : rv.s = { mode: "gender", queue: [], gd: { items, idx, ok, bad, done, missed, art } } ; items = [{ id, lang, kind, pick }].
// L'affichage est refait à partir de rv.s.gd (un render() pendant la session ne perd rien).
function genderOkAny() { return state.cards.some(c => isVocab(c) && cardStudyLangs(c).some(L => genderDrillOf(c, L))); }

// Lancement. Renvoie true si la session démarre ou si le message « rien à poser » est affiché.
function startGenderDrill(cfg, onlyIds) {
  const art = GD_ART_KINDS.includes(cfg.genderArt) ? cfg.genderArt : "mix";
  const now = Date.now(), lgs = langsByList(), langs = {}, items = [];
  let pool = shuffle(sessionPool(cfg).filter(isVocab));
  if (onlyIds) pool = pool.filter(c => onlyIds.includes(c.id));
  for (const c of pool) {
    if (items.length >= cfg.count) break;
    const ls = sessionLangs(c, cfg, now, lgs.get(c.listId)).filter(L => genderDrillOf(c, L) && genderWord(c, L));
    if (!ls.length) continue;
    const L = ls[Math.floor(Math.random() * ls.length)];
    langs[c.id] = L;
    items.push({ id: c.id, lang: L, kind: art === "mix" ? (Math.random() < 0.5 ? "def" : "indef") : art, pick: null });
  }
  if (!items.length) {
    openModal(t("gm.need.title"), el("p", null, t("gd.need")), [{ label: t("ann.ok"), kind: "primary" }]);
    return true;
  }
  const g = { items, idx: 0, ok: 0, bad: 0, done: false, missed: [], startedAt: Date.now() };
  rv.s = { queue: [], mode: "gender", revealed: false, counts: { known: 0, review: 0, unknown: 0 }, log: [], first: {}, dirs: {}, langs, lks: {},
    startedAt: g.startedAt, gd: g };
  setSessionLangs(langs);
  rv.phase = "run";
  renderReview();
  window.scrollTo(0, 0);
  return true;
}
function genderRerender(g) { if (rv.s && rv.s.gd === g && currentScreen === "review") renderReview(); }
function genderIsLive(g, it) { return !!(rv.s && rv.s.gd === g && !g.done && g.items[g.idx] === it); }

function renderGenderSession(root) {
  const g = rv.s && rv.s.gd;
  if (!g) { endSession(); return; }
  if (g.done) { renderGenderSummary(root, g); return; }
  while (g.idx < g.items.length && !sessionCard(g.items[g.idx].id)) g.idx++;   // carte supprimée entre-temps
  if (g.idx >= g.items.length) { genderFinish(g); renderGenderSummary(root, g); return; }
  const it = g.items[g.idx];
  root.appendChild(audioToggle());
  const meta = el("div", "meta-row gm-meta");
  const sc = el("span", "gm-score");
  sc.append(el("span", "gm-okn", "✓ " + g.ok), document.createTextNode("  "), el("span", "gm-badn", "✗ " + g.bad));
  meta.append(el("span", "gm-left", t("gm.q", { i: g.idx + 1, n: g.items.length })), sc);
  root.appendChild(meta);
  genderQuestion(root, g, it);
  const quit = el("button", "link-btn", t("gm.quit"));
  quit.addEventListener("click", () => { genderFinish(g); genderRerender(g); });
  root.appendChild(quit);
}

function genderQuestion(root, g, it) {
  const c = sessionCard(it.id), L = it.lang;
  const word = genderWord(c, L), gen = genderDrillOf(c, L);
  const q = el("div", "card gm-q");
  q.appendChild(el("div", "sw-lang", langName(L)));
  const m = el("div", "gm-qmain gd-word"); m.lang = L;
  m.appendChild(document.createTextNode(word));   // sans article, sans couleur ni nature : le genre est la réponse
  q.appendChild(m);
  const sp = speakBtn(word, L);
  if (sp) { sp.classList.add("gm-spk"); q.appendChild(sp); }
  const sup = supportTerms(c, gameLg(c, L));
  if (sup.length) { const s = el("div", "gm-qsub", sup.map(x => x.text).join(" · ")); s.lang = sup[0].code; q.appendChild(s); }
  q.appendChild(el("div", "gm-ask", t("gd.ask")));
  root.appendChild(q);
  if (it.pick == null && !it.spoken) { it.spoken = true; gameAutoSpeak(word, L); }

  const bt = genderButtons(L, it.kind, word);
  const grid = el("div", "gm-choices gd-choices");
  const btns = {};
  ["m", "f"].forEach(side => {
    const b = el("button", "gm-choice", bt[side]);
    b.type = "button"; b.lang = L;
    b.addEventListener("click", () => answer(side));
    btns[side] = b;
    grid.appendChild(b);
  });
  root.appendChild(grid);
  const after = el("div", "gm-after");
  root.appendChild(after);
  const live = el("div", "sr-only"); live.setAttribute("aria-live", "polite");
  root.appendChild(live);

  const go = () => {
    if (it.left || !genderIsLive(g, it)) return;
    it.left = true;
    Speech.stop();
    g.idx++;
    if (g.idx >= g.items.length) genderFinish(g);
    genderRerender(g);
  };
  const feedback = () => {
    const fb = el("div", "card gd-fb");
    const p = el("div", "gd-phrase"); p.lang = L;
    if (gen === "mf") {
      p.textContent = genderPhraseBoth(L, it.kind, word);
      p.classList.add("gd-mf");
      p.appendChild(genderSym("mf"));
      fb.appendChild(p);
      fb.appendChild(el("div", "muted", t("gd.both")));
    } else {
      p.textContent = genderPhrase(L, it.kind, gen, word);
      if (genderSettings().colors) p.classList.add("gd-" + gen);
      p.appendChild(genderSym(gen));   // toujours : « l’ » ne montre pas le genre
      fb.appendChild(p);
    }
    const pos = posTag(c, L); if (pos) { const pd = el("div", "wr-pos"); pd.appendChild(pos); fb.appendChild(pd); }
    after.appendChild(fb);
  };
  const show = () => {
    ["m", "f"].forEach(side => {
      btns[side].classList.toggle("right", gen === "mf" || side === gen);
      btns[side].classList.toggle("wrong", gen !== "mf" && side === it.pick && side !== gen);
      btns[side].setAttribute("aria-disabled", "true");
    });
    feedback();
    const ok = gen === "mf" ? null : it.pick === gen;
    if (ok !== true) {
      const nb = el("button", "btn primary", t("gm.next"));
      nb.addEventListener("click", go);
      after.appendChild(nb);
      try { nb.focus({ preventScroll: true }); } catch (e) {}
    }
  };
  if (it.pick != null) { show(); return; }

  function answer(side) {
    if (it.pick != null) return;
    it.pick = side;
    const ok = gen === "mf" ? null : side === gen;
    if (ok === true) g.ok++;
    else if (ok === false) { g.bad++; if (!g.missed.includes(it.id)) g.missed.push(it.id); }
    if (ok === true) { try { XP.onGender(c, L, true); } catch (e) {} }   // +XP seulement : aucune progression
    show();
    gameFlash(btns[side], ok !== false);
    if (ok !== null) GameSound.play(ok ? "ok" : "bad");
    live.textContent = ok === null ? t("gd.both") : t(ok ? "gm.right" : "gm.wrong");
    const sc = document.querySelector("#screen-review .gm-score");
    if (sc) { sc.querySelector(".gm-okn").textContent = "✓ " + g.ok; sc.querySelector(".gm-badn").textContent = "✗ " + g.bad; }
    gameAutoSpeak(word, L);
    if (ok === true) setTimeout(go, GD_NEXT_MS);
  }
}

function genderFinish(g) {
  if (!g || g.done) return;
  g.done = true;
  g.endedAt = Date.now();
  g.seconds = Math.max(0, Math.round((g.endedAt - g.startedAt) / 1000));
  Speech.stop();
  commitQuiet();
  Storage.flushNow();
  GameSound.play("end");
}

function renderGenderSummary(root, g) {
  Speech.stop();
  const answered = g.ok + g.bad;
  const box = el("div", "card gm-sum");
  box.appendChild(el("h2", null, t("gm.sum.title") + " · ♂♀ " + t("mode.gender")));
  const grid = el("div", "sum-grid");
  const cell = (cls, v, k) => { const x = el("div", "sum-cell " + cls); x.append(el("div", "sum-num", v), el("div", "sum-lbl", t(k))); grid.appendChild(x); };
  cell("ok", g.ok + " / " + answered, "gm.sum.score");
  cell("", gameDuration(g.seconds || 0), "gm.sum.time");
  cell(g.bad ? "bad" : "", String(g.bad), "gm.sum.errors");
  grid.style.gridTemplateColumns = "repeat(3,1fr)";
  box.appendChild(grid);
  const missed = g.missed.filter(id => state.cards.some(c => c.id === id));
  if (!missed.length && answered) box.appendChild(el("div", "sum-ok", t("gm.sum.noErr")));
  if (missed.length) {
    const ul = el("div", "gd-missed");
    missed.slice(0, 30).forEach(id => {
      const c = state.cards.find(x => x.id === id), it = g.items.find(x => x.id === id);
      if (!c || !it) return;
      const gen = genderDrillOf(c, it.lang), word = genderWord(c, it.lang);
      const r = el("div", "gd-mrow"); r.lang = it.lang;
      const ph = el("span", genderSettings().colors ? "gd-" + gen : "", genderPhrase(it.lang, it.kind, gen, word));
      ph.appendChild(genderSym(gen));
      r.appendChild(ph);
      ul.appendChild(r);
    });
    box.appendChild(ul);
  }
  const xg = xpGainLine(rv.s);   // « +N XP » gagnés pendant la session
  if (xg) box.appendChild(xg);
  box.appendChild(el("p", "hint", t("gd.noProgress")));
  root.appendChild(box);
  const btns = el("div", "btns");
  const again = el("button", "btn primary", t("gm.sum.replay"));
  again.addEventListener("click", () => { rv.cfg.mode = "gender"; if (!startGenderDrill(rv.cfg)) { toast(t("review.none")); endSession(); } });
  btns.appendChild(again);
  if (missed.length) {
    const b = el("button", "btn", t("gd.sum.again", { n: missed.length }));
    b.addEventListener("click", () => { rv.cfg.mode = "gender"; if (!startGenderDrill(rv.cfg, missed)) endSession(); });
    btns.appendChild(b);
  }
  const nb = el("button", "btn", t("sum.new"));
  nb.addEventListener("click", endSession);
  btns.appendChild(nb);
  root.appendChild(btns);
}
