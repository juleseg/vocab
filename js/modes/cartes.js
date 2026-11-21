"use strict";

// === MODE CARTES ===
// Tap = retourner. Swipe droite = Su, gauche = Pas su, haut = À revoir. Boutons équivalents sous la carte.
// Libellés (étape 56) : réponses = clés ans.* (Trouvé / Hésité / Raté : tampons, boutons, fin de session) ;
// catégorie de la carte (en haut) = clés cat.* (Acquis / En cours / À apprendre). Noms techniques inchangés.
const SWIPE = { DIST: 90, OUT_MS: 280 };
let cardsBusy = false; // vrai pendant l'animation de sortie (évite une double notation)

// Faces question / réponse selon le sens : face « langues d'appui » (traductions remplies, dans l'ordre)
// et face « langue apprise ». target = langue apprise de la carte (langue de l'exemple).
// items = mots de la face dans l'ordre ([{ text, lng }]) : lus à la suite, nature affichée à côté de chacun.
// Autres types de cartes : typedFaces (sens ignoré).
function cardFaces(c, dir) {
  if (!isVocab(c)) return typedFaces(c);
  const lg = cardLangs(c);
  const sup = supportTerms(c, lg);
  const supFace = {
    lang: sup.map(x => langName(x.code)).join(" · "),
    main: sup.length ? sup[0].text : "—", lng: sup.length ? sup[0].code : lg.support[0],
    sub: sup.slice(1).map(x => x.text).join(" · "), subLng: sup.length > 1 ? sup[1].code : "",
    items: sup.map(x => ({ text: x.text, lng: x.code }))
  };
  const tgText = term(c, lg.target);
  const tgFace = { lang: langName(lg.target), main: tgText || "—", lng: lg.target, sub: "", subLng: "",
    items: tgText ? [{ text: tgText, lng: lg.target }] : [] };
  return dir === "fromT" ? { q: tgFace, a: supFace, target: lg.target, lg } : { q: supFace, a: tgFace, target: lg.target, lg };
}
// Mot principal d'une face (+ nature si withPos).
function faceMain(cls, f, c, withPos) {
  if (f.mainNode) return f.mainNode(cls);           // affichage riche (phrase à trous, différences surlignées)
  const m = el("div", cls); m.lang = f.lng;
  m.appendChild(document.createTextNode(f.main));
  if (withPos) genderMark(m, c, f.lng);   // genre des noms (étape 60) : couleur / symbole
  const p = withPos ? posTag(c, f.lng) : null;
  if (p) m.appendChild(p);
  return m;
}
// Autres mots de la face (langues d'appui suivantes), chacun avec sa nature si withPos. null s'il n'y en a pas.
function faceSub(cls, f, c, withPos) {
  if (f.noSub) return null;
  const rest = f.items.slice(1);
  if (!rest.length) return null;
  const d = el("div", cls);
  rest.forEach((x, i) => {
    if (i) d.appendChild(el("span", "sub-sep", " · "));
    const sp = el("span", "sub-item", x.text); sp.lang = x.lng;
    if (withPos) genderMark(sp, c, x.lng);
    const p = withPos ? posTag(c, x.lng) : null;
    if (p) sp.appendChild(p);
    d.appendChild(sp);
  });
  return d;
}
// example : nœud « exemple + traductions » (exampleNode) ou null.
function faceNode(cls, f, c, example) {
  const d = el("div", "sw-face " + cls + (isVocab(c) ? "" : " ty-face ty-" + cardType(c)) + (f.long ? " sw-long" : ""));
  d.appendChild(el("div", "sw-lang", f.lang));
  const sp = speakItemsBtn(f.items);
  if (sp) d.appendChild(sp);
  const b = el("div", "sw-body");
  b.appendChild(faceMain("sw-main", f, c, true));
  const sub = faceSub("sw-sub", f, c, true);
  if (sub) b.appendChild(sub);
  if (example) b.appendChild(example);
  faceExtras(f).forEach(n => b.appendChild(n));
  d.appendChild(b);
  return d;
}
// Étape 55 (mémoire visuelle) : au dos d'une carte vocab, sous la réponse, rappel des mots de la question
// (réponse en grand, question en petit dessous : « tree » puis « arbre · 나무 », ou l’inverse selon le sens), avant l'exemple. Rien pour les autres types.
function cardsOtherSide(back, c, q) {
  if (!back || !isVocab(c) || !q || !q.items.length) return;
  const d = el("div", "sw-other");
  q.items.forEach((x, i) => {
    if (i) d.appendChild(el("span", "sub-sep", " · "));
    const sp = el("span", "sub-item", x.text); sp.lang = x.lng;
    d.appendChild(sp);
  });
  const body = back.querySelector(".sw-body") || back;
  body.insertBefore(d, body.querySelector(".sw-ex"));
}
function swipeResult(dx, dy) {
  if (-dy > SWIPE.DIST && -dy > Math.abs(dx)) return "review";
  if (dx > SWIPE.DIST) return "known";
  if (dx < -SWIPE.DIST) return "unknown";
  return null;
}
function clamp01(v) { return Math.max(0, Math.min(1, v)); }

function renderCardsSession(root) {
  const s = rv.s;
  cardsBusy = false;
  if (audPause(root)) return;   // apprentissage auditif (étape 55) : pause d'écoute après la note
  while (s.queue.length && !sessionCard(s.queue[0].id)) s.queue.shift(); // carte supprimée entre-temps
  if (!s.queue.length) { renderSessionSummary(root); return; }

  const item = s.queue[0];
  const c = sessionCard(item.id);
  const f = cardFaces(c, item.dir);
  audioCard(s, c);
  // Étape 55 : « tout le temps » → la réponse n'est pas lue au retournement, la répétition s'en charge (pas de double lecture).
  const ansAuto = () => { if (!Auditif.always(s.mode, c, f.lg)) autoSpeak(s, "a", f.a.items, f.lg); };

  root.appendChild(audioToggle());
  const meta = el("div", "meta-row");
  meta.append(el("span", null, t("cards.left", { n: s.queue.length })), el("span", null, t("cat." + Leitner.category(c))));
  root.appendChild(meta);
  if (typeof Sgl !== "undefined") Sgl.flag(meta.lastChild, c, "review");   // étape 84 : 🚩 signaler la carte
  HardUI.sessionExtras(root, c, item);   // badge « Mot difficile » et « Mon astuce » (étape 57)

  const stage = el("div", "sw-stage");
  const card = el("div", "sw-card sw-enter");
  card.setAttribute("role", "button");
  card.tabIndex = 0;
  const inner = el("div", "sw-inner" + (s.revealed ? " flipped" : ""));
  const fFront = faceNode("sw-front", f.q, c, null), fBack = faceNode("sw-back", f.a, c, exampleNode(c, "sw-ex", f.lg));   // exemple + traductions (étape 35)
  cardsOtherSide(fBack, c, f.q);   // étape 55 : au dos, aussi le mot de la question (les deux langues visibles)
  imgFace(fFront, Images.place(c, item.dir, "q", "ci-card"));   // image de la carte (étape 49) : côté question ou réponse
  imgFace(fBack, Images.place(c, item.dir, "a", "ci-card"));
  inner.append(fFront, fBack);
  card.appendChild(inner);
  const stamps = {};
  ["known", "unknown", "review"].forEach(r => { stamps[r] = el("div", "sw-stamp sw-stamp-" + r, t("ans." + r)); card.appendChild(stamps[r]); });
  stage.appendChild(card);
  root.appendChild(stage);
  root.appendChild(el("div", "sw-hint", t("cards.tap")));

  const flip = () => {
    if (cardsBusy) return;
    s.revealed = !s.revealed;
    inner.classList.toggle("flipped", s.revealed);
    if (s.revealed) ansAuto(); // lecture auto de la réponse au retournement
  };
  if (s.revealed) ansAuto(); else autoSpeak(s, "q", f.q.items, f.lg);
  const resetStamps = () => Object.values(stamps).forEach(x => { x.style.opacity = "0"; });
  // Animation de sortie, puis notation (gradeCurrent sauvegarde et affiche la carte suivante).
  const fly = result => {
    if (cardsBusy) return;
    cardsBusy = true;
    const w = window.innerWidth, h = window.innerHeight;
    const to = result === "known" ? [w * 1.2, 40, 25] : result === "unknown" ? [-w * 1.2, 40, -25] : [0, -h, 0];
    resetStamps();
    stamps[result].style.opacity = "1";
    card.classList.remove("sw-enter");
    card.style.transition = "transform " + SWIPE.OUT_MS + "ms ease-in, opacity " + SWIPE.OUT_MS + "ms ease-in";
    card.style.transform = "translate(" + to[0] + "px," + to[1] + "px) rotate(" + to[2] + "deg)";
    card.style.opacity = "0";
    setTimeout(() => audGrade(c, f.lg, result), SWIPE.OUT_MS);   // note (+ répétition auditive, étape 55)
  };

  // Glisser (doigt ou souris)
  let d = null;
  card.addEventListener("pointerdown", e => {
    if (cardsBusy || (e.pointerType === "mouse" && e.button !== 0)) return;
    d = { x0: e.clientX, y0: e.clientY, dx: 0, dy: 0, moved: false };
    try { card.setPointerCapture(e.pointerId); } catch (err) {}
    card.classList.remove("sw-enter");
    card.style.transition = "none";
  });
  card.addEventListener("pointermove", e => {
    if (!d) return;
    d.dx = e.clientX - d.x0; d.dy = e.clientY - d.y0;
    if (!d.moved && Math.hypot(d.dx, d.dy) > 8) d.moved = true;
    if (!d.moved) return;
    card.style.transform = "translate(" + d.dx + "px," + d.dy + "px) rotate(" + (d.dx / 18) + "deg)";
    const up = -d.dy > Math.abs(d.dx);
    stamps.known.style.opacity = up ? "0" : String(clamp01(d.dx / SWIPE.DIST));
    stamps.unknown.style.opacity = up ? "0" : String(clamp01(-d.dx / SWIPE.DIST));
    stamps.review.style.opacity = up ? String(clamp01(-d.dy / SWIPE.DIST)) : "0";
  });
  const end = () => {
    if (!d) return;
    const g = d; d = null;
    if (!g.moved) { card.style.transition = ""; flip(); return; }
    const r = swipeResult(g.dx, g.dy);
    if (r) { fly(r); return; }
    card.style.transition = "transform .25s ease";   // pas assez loin : retour au centre
    card.style.transform = "";
    resetStamps();
  };
  card.addEventListener("pointerup", end);
  card.addEventListener("pointercancel", () => { if (d) { d.moved = true; d.dx = 0; d.dy = 0; } end(); });
  card.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); flip(); } });

  // Boutons équivalents (même disposition que les gestes)
  const g = el("div", "btns three");
  [["unknown", "danger", "← ", ""], ["review", "warn", "↑ ", ""], ["known", "ok", "", " →"]].forEach(([r, cls, pre, post]) => {
    const b = el("button", "btn " + cls, pre + t("ans." + r) + post);
    b.addEventListener("click", () => fly(r));
    g.appendChild(b);
  });
  root.appendChild(g);

  const quit = el("button", "link-btn", t("cards.quit"));
  quit.addEventListener("click", () => { if (cardsBusy) return; s.queue = []; renderReview(); });
  root.appendChild(quit);
}

// XP de fin de session (étape 43, js/xp.js) : sans-faute = toutes les cartes « Su » du premier coup (10 cartes ou plus).
function xpSessionEnd(s, ids, n) {
  try {
    const ls = [...new Set(Object.values(s.langs || {}).filter(isLang))];
    XP.onSessionEnd(s, { mode: s.mode, cards: ids.length, perfect: ids.length > 0 && n.known === ids.length, lang: ls.length === 1 ? ls[0] : null });
  } catch (e) {}
}
// Résumé de fin de session : chaque carte compte une fois, selon sa première réponse.
// Ratés = cartes répondues « Pas su » au moins une fois.
function renderSessionSummary(root) {
  const s = rv.s;
  Speech.stop();
  const ids = Object.keys(s.first);
  if (!ids.length) { endSession(); return; } // arrêt avant la première carte
  const n = { known: 0, review: 0, unknown: 0 };
  ids.forEach(id => n[s.first[id]]++);
  Activity.session(s, ids, n);   // journal : une fois par session
  xpSessionEnd(s, ids, n);       // XP de session, défis, badges (étape 43) : une fois par session
  Friends.publish();             // résumé public pour mes amis (étape 29)
  Shared.publishProgress();      // progression sur les listes communes (étape 30)
  Moments.onSessionEnd(s);       // rappel du matin terminé : il disparaît de l'Accueil (étape 61, js/moments.js)
  UserStatus.publish();          // résumé pour les notifications (étape 32)

  const box = el("div", "card");
  box.appendChild(el("h2", null, t("sum.title")));
  box.appendChild(el("div", "muted", t("sum.cards", { n: ids.length })));
  const grid = el("div", "sum-grid");
  [["known", "ok"], ["review", "warn"], ["unknown", "bad"]].forEach(([r, cls]) => {
    const cell = el("div", "sum-cell " + cls);
    cell.append(el("div", "sum-num", String(n[r])), el("div", "sum-lbl", t("ans." + r)));
    grid.appendChild(cell);
  });
  box.appendChild(grid);
  const xg = xpGainLine(s);   // « +N XP » gagnés pendant la session (étape 43)
  if (xg) box.appendChild(xg);

  const missed = ids.filter(id => s.first[id] === "unknown" && state.cards.some(c => c.id === id));
  if (!missed.length) box.appendChild(el("div", "sum-ok", t("sum.noMiss")));
  root.appendChild(box);
  const pushOffer = Push.banner(s);   // notifications : proposition douce, une seule fois (étape 32)
  if (pushOffer) root.appendChild(pushOffer);

  const btns = el("div", "btns");
  if (missed.length) {
    const b = el("button", "btn primary", t("sum.retry", { n: missed.length }));
    // Même mode, même langue, même sens ; Dictée / Prononciation : même mot ou même phrase (lk, étape 46)
    b.addEventListener("click", () => newRun(shuffle(missed.map(id => ({ id, dir: s.dirs[id] || "toT", lang: (s.langs || {})[id], lk: (s.lks || {})[id] }))), s.mode));
    btns.appendChild(b);
  }
  const nb = el("button", "btn" + (missed.length ? "" : " primary"), t("sum.new"));
  nb.addEventListener("click", endSession);
  btns.appendChild(nb);
  root.appendChild(btns);
}
