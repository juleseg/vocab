"use strict";

// === JEU : QCM (ÉTAPE 42) ===
// 4 réponses : la bonne + 3 pièges pris dans la MÊME liste, dans la même langue que la réponse, de même nature
// grammaticale si possible (nature du mot dans la langue étudiée), jamais deux réponses identiques (comparées sans
// casse ni accents). Sens de révision respecté : "toT" = question dans les langues d'appui, réponses dans la langue
// étudiée ; "fromT" = l'inverse (réponses dans la 1re langue d'appui remplie de la carte).
// Carte sans 3 pièges possibles dans sa liste : pas posée. Aucune carte posable → message « pas assez de cartes ».
// Bonne réponse : suite automatique ; mauvaise : la bonne réponse est montrée, bouton « Suivant ».

// Question d'une carte : { id, lang, dir, code (langue des réponses), choices [{ id, text }], correct, pick } ou null.
function mcqItem(q) {
  const c = state.cards.find(x => x.id === q.id);
  if (!c || !isVocab(c)) return null;
  const L = q.lang, lg = gameLg(c, L);
  const sup = supportTerms(c, lg);
  if (!term(c, L).trim() || !sup.length) return null;
  const code = q.dir === "fromT" ? sup[0].code : L;
  const right = term(c, code).trim();
  const seen = new Set([normText(right)]);
  const pos = c.pos && c.pos[L];
  const same = [], other = [];
  shuffle(state.cards.filter(x => x.listId === c.listId && x.id !== c.id && isVocab(x))).forEach(x => {
    const tx = term(x, code).trim(), k = normText(tx);
    if (!k || seen.has(k)) return;
    seen.add(k);
    (pos && x.pos && x.pos[L] === pos ? same : other).push({ id: x.id, text: tx });
  });
  const traps = same.concat(other).slice(0, 3);
  if (traps.length < 3) return null;
  const choices = shuffle([{ id: c.id, text: right }].concat(traps));
  return { id: c.id, lang: L, dir: q.dir, code, choices, correct: choices.findIndex(x => x.id === c.id), pick: null };
}
function mcqNewGame(pool, cfg) {
  const items = [];
  for (const q of pool) {
    if (items.length >= cfg.count) break;
    const it = mcqItem(q);
    if (it) items.push(it);
  }
  if (!items.length) return null;
  return { items, idx: 0, all: items.map(x => ({ id: x.id, lang: x.lang, dir: x.dir })) };
}

function renderMcqSession(root, g) {
  while (g.idx < g.items.length && !sessionCard(g.items[g.idx].id)) g.idx++;   // carte supprimée entre-temps
  if (g.idx >= g.items.length) { gameFinish(g); renderGameSummary(root, g); return; }
  gameHeader(root, g, t("gm.q", { i: g.idx + 1, n: g.items.length }));
  mcqQuestion(root, g, g.items[g.idx], () => { g.idx++; if (g.idx >= g.items.length) gameFinish(g); gameRerender(g); }, { aud: true });   // aud : apprentissage auditif (étape 55)
  gameQuitLink(root, g);
}

// Question + 4 réponses. next() : passer à la question suivante. opts.timed : Course 60 s (suite automatique même
// après une erreur, réponses refusées après la fin du temps).
function mcqQuestion(root, g, it, next, opts) {
  const timed = !!(opts && opts.timed);
  const go = () => { if (it.left || !gameIsLive(g)) return; it.left = true; if (it.aud) Speech.stop(); next(); };   // une seule fois par question ; coupe la répétition (étape 55)
  const c = sessionCard(it.id);
  const L = it.lang, lg = gameLg(c, L);
  const q = el("div", "card gm-q");
  const qImg = Images.place(c, it.dir, "q", "ci-mid");   // image côté question (étape 49), sous la langue
  if (it.dir === "fromT") {                                  // question = mot de la langue étudiée
    q.appendChild(el("div", "sw-lang", langName(L)));
    const m = el("div", "gm-qmain"); m.lang = L;
    m.appendChild(document.createTextNode(term(c, L)));
    const p = posTag(c, L); if (p) m.appendChild(p);
    q.appendChild(m);
    const sp = speakBtn(term(c, L), L);
    if (sp) { sp.classList.add("gm-spk"); q.appendChild(sp); }
    if (it.pick == null && !it.spoken) { it.spoken = true; gameAutoSpeak(term(c, L), L); }
  } else {                                                    // question = traductions (interface, appui)
    const sup = supportTerms(c, lg);
    q.appendChild(el("div", "sw-lang", sup.map(x => langName(x.code)).join(" · ")));
    const m = el("div", "gm-qmain"); m.lang = sup[0].code;
    m.appendChild(document.createTextNode(sup[0].text));
    const p = posTag(c, sup[0].code); if (p) m.appendChild(p);
    q.appendChild(m);
    if (sup.length > 1) { const s = el("div", "gm-qsub", sup.slice(1).map(x => x.text).join(" · ")); s.lang = sup[1].code; q.appendChild(s); }
  }
  if (qImg) q.insertBefore(qImg, q.children[1] || null);
  q.appendChild(el("div", "gm-ask", t("gm.mcq.pick", { lang: langName(it.code) })));
  root.appendChild(q);

  const grid = el("div", "gm-choices");
  const btns = it.choices.map((ch, i) => {
    const b = el("button", "gm-choice", ch.text);
    b.type = "button"; b.lang = it.code;
    b.addEventListener("click", () => answer(i));
    grid.appendChild(b);
    return b;
  });
  root.appendChild(grid);
  const aImgBox = el("div", "ci-after");   // image côté réponse : montrée après la réponse (étape 49)
  root.appendChild(aImgBox);
  const after = el("div", "gm-after");
  root.appendChild(after);
  const hdBox = el("div", "hd-box");   // étape 57 : deux mots côte à côte après une confusion
  root.appendChild(hdBox);
  const hdShow = () => {
    if (!(opts && opts.aud) || it.pick == null || it.pick === it.correct || hdBox.firstChild) return;
    const o = state.cards.find(x => x.id === it.choices[it.pick].id);
    if (o) hdBox.appendChild(HardUI.pairNode(c, o, L));
  };
  const live = el("div", "sr-only"); live.setAttribute("aria-live", "polite");
  root.appendChild(live);

  const show = () => {
    if (!aImgBox.firstChild) { const n = Images.place(c, it.dir, "a", "ci-mid"); if (n) aImgBox.appendChild(n); }
    btns.forEach((b, i) => {
      b.classList.toggle("right", i === it.correct);
      b.classList.toggle("wrong", i === it.pick && i !== it.correct);
      b.setAttribute("aria-disabled", "true");
    });
  };
  const nextBtn = () => {
    after.textContent = "";
    const nb = el("button", "btn primary", t("gm.next"));
    nb.addEventListener("click", go);
    after.appendChild(nb);
    try { nb.focus({ preventScroll: true }); } catch (e) {}
  };
  if (it.pick != null) { show(); hdShow(); if ((it.pick !== it.correct || it.aud) && !timed) nextBtn(); }

  function answer(i) {
    if (it.pick != null) {                                   // après la réponse : toucher un mot de la langue étudiée le lit
      if (it.code === L) gameSpeak(it.choices[i].text, L);
      return;
    }
    if (timed && opts.expired && opts.expired()) return;
    it.pick = i;
    const ok = i === it.correct;
    if (!ok && opts && opts.aud) Hard.confuse(it.id, it.choices[i].id, L);   // étape 57 : vraie confusion (QCM seul, pas la Course)
    gameGrade(g, it.id, ok);
    show();
    hdShow();
    gameFlash(btns[i], ok);
    if (!ok) gameFlash(btns[it.correct], true);
    GameSound.play(ok ? "ok" : "bad");
    live.textContent = t(ok ? "gm.right" : "gm.wrong");
    const sc = document.querySelector("#screen-review .gm-score");
    if (sc) { sc.querySelector(".gm-okn").textContent = "✓ " + g.ok; sc.querySelector(".gm-badn").textContent = "✗ " + g.bad; }
    // Étape 55 : apprentissage auditif (QCM seul, pas la Course ni les duels) : la répétition remplace la lecture de la
    // réponse ; bonne réponse → pause d'écoute (suite à la fin de la lecture, ou « Suivant »).
    const rep = opts && opts.aud && !timed ? Auditif.plan("mcq", c, lg, ok) : null;
    if (rep) {
      it.aud = true;
      Auditif.play(rep, () => { if (ok) setTimeout(go, AUD_NEXT_MS); });
      nextBtn();
      return;
    }
    // Mot de la langue étudiée : lu au toucher (réponses dans cette langue), ou automatiquement (Lecture auto).
    const target = term(c, L);
    if (it.code === L && !audioSettings().auto) gameSpeak(it.choices[i].text, L);
    else gameAutoSpeak(target, L);
    if (ok || timed) {
      setTimeout(go, ok ? GAME.OK_MS : GAME.BAD_MS);
    } else nextBtn();
  }
}
