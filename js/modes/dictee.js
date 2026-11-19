"use strict";

// === ÉCOUTE ET PAROLE : PARTIE COMMUNE (ÉTAPE 46) ===
// Deux modes de rappel du champ « Mode » de Réviser (pas des jeux), cartes de vocabulaire seulement :
// - "dictation" (Dictée, ce fichier) : l'appli lit le mot ou la phrase d'exemple dans la langue étudiée, on l'écrit ;
// - "speak" (Prononciation, js/modes/prononciation.js) : on voit la traduction et on dit le mot ou la phrase.
// Choix « À écouter / à dire » (cfg.listenKind) : words | sents | both. Une langue étudiée par carte (comme les autres modes).
// Élément d'une carte (lisItem) : { kind: "word" | "sent", text (lu / attendu), alts [{ text, lng }] (réponses acceptées),
// tr [{ text, lng }] (traductions affichées), L, lg }. Mot avec plusieurs formes (« voler / s'envoler ») : la 1re est lue,
// toutes sont acceptées. Phrase : l'exemple de la langue étudiée, traductions = celles de l'exemple dans les langues affichées.
// Type choisi au lancement pour chaque carte (file : { id, lang, dir, lk }), gardé pour « Rejouer les ratés » (rv.s.lks).
const LISTEN_MODES = ["dictation", "speak"];
const LISTEN_ICON = { dictation: "🎧", speak: "🎤" };
function isListenMode(m) { return LISTEN_MODES.includes(m); }
function lisFirst(s) { return String(s || "").split("/")[0].trim(); }
// Langues affichées pour une carte posée dans la langue L (langue de sa liste, ou langue étudiée en plus).
function lisLg(c, L) {
  const lg = listLangs(c.listId);
  return (!L || L === lg.target) ? lg : studyLg(L);
}
// Élément « mot » ou « phrase » d'une carte dans la langue L, ou null s'il manque.
function lisItem(c, L, kind, lg) {
  if (!c || !isVocab(c) || !isLang(L)) return null;
  lg = lg || lisLg(c, L);
  if (kind === "sent") {
    const text = exText(c, L).replace(/\s+/g, " ").trim();
    if (!text) return null;
    const tr = lg.support.map(code => ({ text: exTr(c, L, code).trim(), lng: code })).filter(x => x.text);
    return { kind, text, alts: [{ text: wrClean(text), lng: L }], tr, L, lg };
  }
  const w = term(c, L);
  const alts = String(w || "").split("/").map(wrClean).filter(Boolean).map(text => ({ text, lng: L }));
  if (!alts.length) return null;
  return { kind: "word", text: alts[0].text, alts, tr: supportTerms(c, lg).map(x => ({ text: x.text, lng: x.code })), L, lg };
}
// Types possibles pour une carte dans la langue L, selon le choix de la session et le mode.
// Dictée : il faut une voix pour L (même règle que l'audio). Prononciation : il faut une traduction à montrer.
function lisKinds(c, L, mode, listenKind, lg) {
  if (mode === "dictation" && !Speech.has(L)) return [];
  const want = listenKind === "words" ? ["word"] : listenKind === "sents" ? ["sent"] : ["word", "sent"];
  return want.filter(k => { const it = lisItem(c, L, k, lg); return it && (mode !== "speak" || it.tr.length); });
}
// Voix pour la dictée parmi les langues du périmètre : ok = au moins une ; loading = voix pas encore connues ;
// missing = langues sans voix (écartées de la dictée).
function lisVoiceInfo(langs) {
  const st = Speech.status();
  if (st !== "ready") return { ok: false, loading: st === "loading", missing: [] };
  const missing = arr(langs).filter(L => !Speech.has(L));
  return { ok: !langs.length || missing.length < langs.length, loading: false, missing };
}
function lisPickKind(c, L, mode, listenKind) {
  const ks = lisKinds(c, L, mode, listenKind);
  return ks.length ? ks[Math.floor(Math.random() * ks.length)] : "";
}
// Élément de la carte en cours d'une session (type choisi au lancement, sinon choisi maintenant et gardé).
function lisCurrent(s, item) {
  const c = sessionCard(item.id);
  if (!c || !isVocab(c)) return null;
  const L = item.lang || (s.langs || {})[item.id] || primaryLang(c);
  let k = item.lk || (s.lks || {})[item.id];
  if (!k || !lisKinds(c, L, s.mode, k === "sent" ? "sents" : "words").length) k = lisPickKind(c, L, s.mode, (rv.cfg && rv.cfg.listenKind) || "both");
  if (!k) return null;
  item.lk = k;
  if (!s.lks) s.lks = {};
  s.lks[item.id] = k;
  const it = lisItem(c, L, k);
  return it ? { c, it } : null;
}
// État de la carte en cours (dictée : rv.s.d ; prononciation : rv.s.p), remis à zéro quand la carte change.
// Clé = réponses déjà données + id : une carte « Pas su » qui revient repart de zéro.
function lisState(s, field, c, init) {
  const key = s.log.length + ":" + c.id;
  if (!s[field] || s[field].key !== key) s[field] = Object.assign({ key }, init);
  return s[field];
}
// Vitesse de la dictée (settings.listen.slow, synchronisé avec les réglages).
function lisSlow() { return !!(state.settings.listen && state.settings.listen.slow); }
function lisSetSlow(on) {
  if (!state.settings.listen || typeof state.settings.listen !== "object") state.settings.listen = { slow: false };
  if (state.settings.listen.slow === on) return;
  state.settings.listen.slow = on;
  commitQuiet();
}
// Lignes « traduction » (mots ou phrases) d'un élément.
function lisTrNode(it, cls) {
  const d = el("div", cls || "ls-tr");
  if (!it.tr.length) { d.appendChild(el("div", "muted", t("ls.noTr"))); return d; }
  it.tr.forEach((x, i) => { const r = el("div", i ? "ls-tr-sub" : "ls-tr-main", x.text); r.lang = x.lng; d.appendChild(r); });
  return d;
}
// Encadré de résultat comme le mode Écrit : en-tête, ta réponse et la bonne avec les différences surlignées.
// r = résultat de wrCheck ; verdicts : exact | accents | spaces | punct | wrong.
function lisVerdictBox(r) {
  const kind = { exact: "ok", accents: "acc", spaces: "acc", punct: "acc", wrong: "bad" }[r.verdict];
  const box = el("div", "card wr-res " + kind);
  box.appendChild(el("div", "wr-head", t({ exact: "write.ok", accents: "write.accents", spaces: "write.spaces", punct: "write.punct", wrong: "write.wrong" }[r.verdict])));
  if (r.verdict === "exact") box.appendChild(el("div", "wr-diff", r.best));
  else if (!r.typed) {
    box.appendChild(el("div", "wr-lbl", t("write.correct")));
    box.appendChild(el("div", "wr-diff", r.best));
  } else {
    const d = wrLcs(r.typed, r.best);
    box.appendChild(el("div", "wr-lbl", t("write.yours")));
    box.appendChild(wrDiffNode(d.A, d.ma, "wr-bad"));
    box.appendChild(el("div", "wr-lbl", t("write.correct")));
    box.appendChild(wrDiffNode(d.B, d.mb, "wr-miss"));
  }
  return box;
}
// Détails sous le résultat : toutes les formes, nature, traductions, exemple (mot) ou traduction (phrase).
function lisDetails(box, c, it) {
  if (it.kind === "word") {
    if (it.alts.length > 1) box.appendChild(el("div", "wr-lbl", t("write.all", { a: it.alts.map(a => a.text).join(" / ") })));
    const bp = posTag(c, it.L);
    if (bp) { const pd = el("div", "wr-pos"); genderMark(pd, c, it.L); pd.appendChild(bp); box.appendChild(pd); }
  }
  box.appendChild(el("div", "wr-lbl", t("ls.trLbl")));
  box.appendChild(lisTrNode(it, "ls-tr ls-tr-res"));
  if (it.kind === "word") { const ex = exampleNode(c, "wr-ex", it.lg); if (ex) box.appendChild(ex); }
}
// Boutons « Suivant (résultat proposé) » + correction (les deux autres résultats), comme le mode Écrit.
// Libellés : clés ans.* (Trouvé / Hésité / Raté, étape 56).
function lisGradeButtons(root, sug, onGrade) {
  const next = el("button", "btn primary", t("write.next", { r: t("ans." + sug) }));
  next.addEventListener("click", () => onGrade(sug));
  root.appendChild(next);
  root.appendChild(el("div", "wr-fix", t("write.fix")));
  const g = el("div", "btns two");
  [["known", "ok"], ["review", "warn"], ["unknown", "danger"]].filter(([x]) => x !== sug).forEach(([x, cls]) => {
    const b = el("button", "btn " + cls, t("ans." + x));
    b.addEventListener("click", () => onGrade(x));
    g.appendChild(b);
  });
  root.appendChild(g);
  return next;
}
function lisMeta(root, s, c, it) {
  const meta = el("div", "meta-row");
  meta.append(el("span", null, t("cards.left", { n: s.queue.length })), el("span", null, t("cat." + Leitner.category(c, it.L))));
  root.appendChild(meta);
  HardUI.sessionExtras(root, c, { lang: it.L }, { noTip: true });   // badge « Mot difficile » (étape 57)
}

// === MODE DICTÉE ===
// La carte s'affiche : lecture automatique (toujours, même si « Lecture auto » est coupée : c'est la question).
// « Réécouter », vitesse normale / lente. Traduction cachée, « Voir la traduction » en indice (sans effet sur la note).
// Comparaison et affichage du mode Écrit (wrCheck : accents faux = juste + différences surlignées), puis confirmer / corriger.
function lisPlay(it) { return Speech.speak(it.text, it.L, { slow: lisSlow() }); }
function dictGrade(result) { rv.s.d = null; gradeCurrent(result); }

function renderDictationSession(root) {
  const s = rv.s;
  let cur = null;
  while (s.queue.length && !(cur = lisCurrent(s, s.queue[0])) ) s.queue.shift();   // carte supprimée, ou plus rien à lire
  if (!s.queue.length || !cur) { renderSessionSummary(root); return; }
  const { c, it } = cur;
  const d = lisState(s, "d", c, { typed: "", res: null, hint: false });
  audioCard(s, c);
  if (!s.audio.done.has("d") && Speech.has(it.L) && lisPlay(it)) s.audio.done.add("d");   // lu une fois à l'apparition

  lisMeta(root, s, c, it);
  const q = el("div", "card ls-q");
  q.appendChild(el("div", "sw-lang", LISTEN_ICON.dictation + " " + t(it.kind === "sent" ? "ls.d.sent" : "ls.d.word", { lang: langName(it.L) })));
  const play = el("button", "btn primary ls-play", t("ls.d.replay"));
  play.type = "button";
  play.addEventListener("click", () => lisPlay(it));
  q.appendChild(play);
  const sp = el("div", "seg ls-speed");
  sp.setAttribute("role", "group");
  sp.setAttribute("aria-label", t("ls.speed"));
  [[false, "ls.speed.normal"], [true, "ls.speed.slow"]].forEach(([v, k]) => {
    const b = el("button", null, t(k));
    b.type = "button";
    b.setAttribute("aria-pressed", String(lisSlow() === v));
    b.addEventListener("click", () => {
      lisSetSlow(v);
      sp.querySelectorAll("button").forEach((x, i) => x.setAttribute("aria-pressed", String((i === 1) === v)));
      lisPlay(it);
    });
    sp.appendChild(b);
  });
  q.appendChild(sp);
  if (d.hint || d.res) q.appendChild(lisTrNode(it));
  else {
    const h = el("button", "link-btn ls-hint", t("ls.hintTr"));
    h.type = "button";
    h.addEventListener("click", () => { d.hint = true; renderReview(); });
    q.appendChild(h);
  }
  root.appendChild(q);

  const inp = textInput(d.typed, t("ls.d.ph", { lang: langName(it.L) }), it.L);
  inp.classList.add("wr-input");
  inp.spellcheck = false;
  inp.setAttribute("autocapitalize", "off");
  inp.setAttribute("autocorrect", "off");
  inp.enterKeyHint = "done";
  root.appendChild(inp);

  if (!d.res) {
    const check = () => { d.typed = inp.value; d.res = wrCheck(inp.value, it.alts); renderReview(); };
    inp.addEventListener("input", () => { d.typed = inp.value; });
    inp.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); check(); } });
    const b = el("button", "btn primary", t("write.check"));
    b.addEventListener("click", check);
    root.appendChild(b);
    setTimeout(() => { try { inp.focus({ preventScroll: true }); } catch (e) {} }, 60);
  } else {
    inp.readOnly = true;
    const box = lisVerdictBox(d.res);
    const asp = spkRow(it.text, it.L);
    if (asp) box.appendChild(asp);
    lisDetails(box, c, it);
    root.appendChild(box);
    const next = lisGradeButtons(root, d.res.verdict === "wrong" ? "unknown" : "known", dictGrade);
    setTimeout(() => { try { next.focus(); } catch (e) {} }, 60);
  }

  const quit = el("button", "link-btn", t("cards.quit"));
  quit.addEventListener("click", () => { s.d = null; s.queue = []; Speech.stop(); renderReview(); });
  root.appendChild(quit);
}
