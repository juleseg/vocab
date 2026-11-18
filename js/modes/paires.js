"use strict";

// === JEU : PAIRES (ÉTAPE 42) ===
// Grille de 6 à 8 paires : à gauche les mots de la langue étudiée, à droite leur traduction (1re langue d'appui
// remplie), chaque colonne mélangée. Toucher un mot puis sa traduction (dans n'importe quel ordre).
// Bonne paire : les deux cases se grisent ; mauvaise : les deux cases tremblent, une erreur de plus.
// Temps (chronomètre) et erreurs comptés. Chaque carte est notée une fois, quand sa paire est trouvée :
// juste si elle n'a jamais fait partie d'une mauvaise paire, sinon comme « À revoir ».
// Nombre de paires : nombre de cartes demandé, entre 6 et 8. Mots et traductions tous différents dans la grille.
// 360 px : deux colonnes de cases (largeur 1fr), texte qui passe à la ligne, jamais de défilement horizontal.
function pairsNewGame(pool, cfg) {
  const want = Math.max(GAME.PAIRS_MIN, Math.min(GAME.PAIRS_MAX, num(cfg.count, GAME.PAIRS_MAX)));
  const seenL = new Set(), seenR = new Set(), picked = [];
  for (const q of pool) {
    if (picked.length >= want) break;
    const c = state.cards.find(x => x.id === q.id);
    if (!c) continue;
    const lg = gameLg(c, q.lang), sup = supportTerms(c, lg);
    const a = term(c, q.lang).trim();
    if (!a || !sup.length) continue;
    const ka = normText(a), kb = sup[0].code + ":" + normText(sup[0].text);
    if (seenL.has(ka) || seenR.has(kb)) continue;
    seenL.add(ka); seenR.add(kb);
    picked.push({ q, a, b: sup[0].text, bl: sup[0].code });
  }
  if (picked.length < GAME.PAIRS_MIN) return null;
  return {
    left: shuffle(picked.map(p => ({ id: p.q.id, text: p.a, lng: p.q.lang }))),
    right: shuffle(picked.map(p => ({ id: p.q.id, text: p.b, lng: p.bl }))),
    matched: [], errIds: [], sel: null, errors: 0, found: 0,
    all: picked.map(p => p.q), start: pairsStart
  };
}
function pairsStart(g) {
  g.timer = setInterval(() => {
    if (!gameIsLive(g)) { clearInterval(g.timer); return; }
    pairsShowClock(g);
  }, 1000);
}
function pairsShowClock(g) {
  const n = document.getElementById("gmClock");
  if (n) n.textContent = "⏱️ " + gameDuration(Math.floor((Date.now() - g.startedAt) / 1000));
}
function renderPairsSession(root, g) {
  gameHeader(root, g, "", "gmClock");
  pairsShowClock(g);
  const prog = el("span", "gm-pairs-prog", t("gm.pairs.found", { n: g.found, m: g.left.length }));
  const hl = el("div", "gm-hint");
  hl.append(el("span", null, t("gm.pairs.hint") + " "), prog);
  root.appendChild(hl);
  const grid = el("div", "gm-pairs");
  const nodes = { L: {}, R: {} };
  const mk = (side, x) => {
    const b = el("button", "gm-tile");
    b.type = "button"; b.lang = x.lng;
    b.textContent = x.text;
    b.dataset.side = side; b.dataset.id = x.id;
    if (g.matched.includes(x.id)) { b.classList.add("done"); b.disabled = true; }
    if (g.sel && g.sel.side === side && g.sel.id === x.id) b.classList.add("sel");
    b.addEventListener("click", () => tap(side, x));
    nodes[side][x.id] = b;
    return b;
  };
  for (let i = 0; i < g.left.length; i++) { grid.appendChild(mk("L", g.left[i])); grid.appendChild(mk("R", g.right[i])); }
  root.appendChild(grid);
  const live = el("div", "sr-only"); live.setAttribute("aria-live", "polite");
  root.appendChild(live);
  gameQuitLink(root, g);

  const setSel = v => {
    if (g.sel) { const o = nodes[g.sel.side][g.sel.id]; if (o) o.classList.remove("sel"); }
    g.sel = v;
    if (v) nodes[v.side][v.id].classList.add("sel");
  };
  const score = () => {
    const sc = document.querySelector("#screen-review .gm-score");
    if (sc) { sc.querySelector(".gm-okn").textContent = "✓ " + g.ok; sc.querySelector(".gm-badn").textContent = "✗ " + g.errors; }
    prog.textContent = t("gm.pairs.found", { n: g.found, m: g.left.length });
  };
  function tap(side, x) {
    if (!gameIsLive(g) || g.matched.includes(x.id)) return;
    if (side === "L") gameSpeak(x.text, x.lng);              // mot de la langue étudiée : lu au toucher
    if (!g.sel || g.sel.side === side) { setSel(g.sel && g.sel.side === side && g.sel.id === x.id ? null : { side, id: x.id }); return; }
    const other = g.sel;
    setSel(null);
    const a = nodes[side][x.id], b = nodes[other.side][other.id];
    if (other.id === x.id) {                                  // bonne paire
      g.matched.push(x.id); g.found++;
      gameGrade(g, x.id, !g.errIds.includes(x.id));
      [a, b].forEach(n => { n.classList.add("done"); n.disabled = true; gameFlash(n, true); });
      GameSound.play("ok");
      live.textContent = t("gm.right");
      if (side !== "L") { const w = g.left.find(y => y.id === x.id); if (w) gameAutoSpeak(w.text, w.lng); }
      score();
      if (g.found >= g.left.length) setTimeout(() => { if (gameIsLive(g)) { gameFinish(g); gameRerender(g); } }, 500);
    } else {                                                  // mauvaise paire : les deux cartes seront « À revoir »
      g.errors++;
      [x.id, other.id].forEach(id => { if (!g.errIds.includes(id)) g.errIds.push(id); });
      [a, b].forEach(n => gameFlash(n, false));
      GameSound.play("bad");
      live.textContent = t("gm.wrong");
      score();
    }
  }
}
