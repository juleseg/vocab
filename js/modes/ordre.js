"use strict";

// === JEU : REMETTRE EN ORDRE (ÉTAPE 42) ===
// Mot : ses lettres mélangées (syllabes pour le coréen, caractères pour le japonais / chinois : un caractère = une
// case dans tous les cas, après normalisation NFC ; espaces gardés à leur place, pas de case). Mot avec plusieurs
// formes (« voler / s'envoler ») : la 1re. Phrase : les mots de la phrase d'exemple de la langue étudiée (découpés
// aux espaces ; japonais / chinois : Intl.Segmenter si disponible, sinon caractère par caractère).
// Choix dans la session (cfg.orderKind) : mots, phrases, ou les deux (une phrase si la carte en a une, une fois sur deux).
// Toucher une case du bas la place à la suite ; toucher une case placée la renvoie en bas. Ordinateur : glisser-déposer
// (déposer sur une case placée = insérer avant elle). « Indice » : enlève ce qui est faux à la fin et place la case
// suivante. « Vérifier » quand tout est placé : comparaison des textes (deux lettres identiques sont interchangeables).
// Indice utilisé : la réponse juste compte quand même comme juste (nombre d'indices dans le résumé).
const ORDER_NOSPACE = ["ja", "zh"];
function orderChars(s) { return Array.from(String(s || "").normalize("NFC")); }
function orderSentTokens(text, L) {
  const s = String(text || "").normalize("NFC").trim();
  if (!s) return [];
  if (!ORDER_NOSPACE.includes(L)) return s.split(/\s+/).filter(Boolean);
  try {
    if (typeof Intl !== "undefined" && Intl.Segmenter) {
      const out = [];
      for (const p of new Intl.Segmenter(L, { granularity: "word" }).segment(s)) {
        if (!p.segment.trim()) continue;
        if (!p.isWordLike && out.length) out[out.length - 1] += p.segment; else out.push(p.segment);   // ponctuation collée au mot d'avant
      }
      return out;
    }
  } catch (e) {}
  return orderChars(s).filter(x => x.trim());
}
// Élément à remettre en ordre pour une carte, ou null.
function orderItem(q, kind) {
  const c = state.cards.find(x => x.id === q.id);
  if (!c || !isVocab(c)) return null;
  const L = q.lang, lg = gameLg(c, L);
  const word = gameFirstAlt(term(c, L));
  const sent = exText(c, L).trim();
  const sentTok = orderSentTokens(sent, L);
  const sentOk = sentTok.length >= GAME.SENT_MIN && sentTok.length <= GAME.SENT_MAX;
  const chars = orderChars(word);
  const letters = chars.filter(x => x.trim());
  const wordOk = letters.length >= 2 && letters.length <= GAME.ORDER_MAX_TILES && new Set(letters).size > 1;
  let useSent = false;
  if (kind === "sents") { if (!sentOk) return null; useSent = true; }
  else if (kind === "words") { if (!wordOk) return null; }
  else { if (!wordOk && !sentOk) return null; useSent = sentOk && (!wordOk || Math.random() < 0.5); }
  const tokens = useSent ? sentTok : letters;
  const tiles = tokens.map((text, k) => ({ k, text }));
  let order = shuffle(tiles.map(x => x.k));
  for (let i = 0; i < 5 && order.every((k, j) => tiles[k].text === tokens[j]); i++) order = shuffle(order);   // pas déjà dans l'ordre
  return {
    id: c.id, lang: L, dir: q.dir, kind: useSent ? "sent" : "word", tokens, tiles, pool: order, placed: [],
    sep: useSent && !ORDER_NOSPACE.includes(L) ? " " : "",
    shape: useSent ? null : chars.map(ch => !ch.trim()),         // mot : places des espaces
    answer: useSent ? sent : word, hints: 0, checked: null, lg
  };
}
function orderNewGame(pool, cfg) {
  const kind = ["words", "sents", "both"].includes(cfg.orderKind) ? cfg.orderKind : "both";
  const items = [];
  for (const q of pool) {
    if (items.length >= cfg.count) break;
    const it = orderItem(q, kind);
    if (it) items.push(it);
  }
  if (!items.length) return null;
  return { items, idx: 0, hints: 0, all: items.map(x => ({ id: x.id, lang: x.lang, dir: x.dir })) };
}

function renderOrderSession(root, g) {
  while (g.idx < g.items.length && !sessionCard(g.items[g.idx].id)) g.idx++;
  if (g.idx >= g.items.length) { gameFinish(g); renderGameSummary(root, g); return; }
  const it = g.items[g.idx];
  gameHeader(root, g, t("gm.q", { i: g.idx + 1, n: g.items.length }));
  orderQuestion(root, g, it, () => { g.idx++; if (g.idx >= g.items.length) gameFinish(g); gameRerender(g); });
  gameQuitLink(root, g);
}
// Une question (étape 70 : séparée de la partie, pour le Mix, js/mix.js). g = partie (notation, gameIsLive, indices) ;
// it = élément de orderItem ; next() : passer à la suite (une seule fois, partie toujours en cours).
function orderQuestion(root, g, it, next) {
  const c = sessionCard(it.id);
  const L = it.lang, lg = it.lg;

  // Consigne + indice de sens : traductions du mot, ou traduction de la phrase d'exemple
  const q = el("div", "card gm-q");
  q.appendChild(el("div", "gm-ask", t(it.kind === "sent" ? "gm.order.sent" : "gm.order.word", { lang: langName(L) })));
  if (it.kind === "word") {
    const sup = supportTerms(c, lg);
    if (sup.length) {
      const m = el("div", "gm-qmain", sup[0].text); m.lang = sup[0].code; q.appendChild(m);
      if (sup.length > 1) { const s = el("div", "gm-qsub", sup.slice(1).map(x => x.text).join(" · ")); s.lang = sup[1].code; q.appendChild(s); }
    }
  } else {
    const trs = lg.support.map(code => ({ code, v: exTr(c, L, code) })).filter(x => x.v);
    if (trs.length) trs.forEach((x, i) => { const d = el("div", i ? "gm-qsub" : "gm-qtr", x.v); d.lang = x.code; q.appendChild(d); });
    else { const sup = supportTerms(c, lg); if (sup.length) q.appendChild(el("div", "gm-qsub", t("gm.order.with", { w: term(c, L) + " · " + sup[0].text }))); }
  }
  root.appendChild(q);

  // Réponse en construction
  const ans = el("div", "gm-ans" + (it.kind === "sent" ? " sent" : ""));
  ans.lang = L;
  if (it.checked === true) ans.classList.add("right");
  if (it.checked === false) ans.classList.add("wrong");
  let slot = 0;
  const addTile = k => {
    const b = el("button", "gm-tl placed", it.tiles[k].text);
    b.type = "button";
    if (it.checked == null) {
      b.draggable = true;
      b.addEventListener("click", () => { unplace(k); });
      b.addEventListener("dragstart", e => dragStart(e, k));
      b.addEventListener("dragover", e => e.preventDefault());
      b.addEventListener("drop", e => { e.preventDefault(); e.stopPropagation(); dropOn(e, k); });
    } else b.disabled = true;
    ans.appendChild(b);
  };
  if (it.kind === "word") {
    it.shape.forEach(isSpace => {
      if (isSpace) { ans.appendChild(el("span", "gm-gap")); return; }
      if (slot < it.placed.length) addTile(it.placed[slot]); else ans.appendChild(el("span", "gm-slot"));
      slot++;
    });
  } else {
    it.placed.forEach(addTile);
    for (let i = it.placed.length; i < it.tokens.length; i++) ans.appendChild(el("span", "gm-slot wide"));
  }
  ans.addEventListener("dragover", e => e.preventDefault());
  ans.addEventListener("drop", e => { e.preventDefault(); dropOn(e, null); });
  root.appendChild(ans);

  // Cases à placer
  const poolBox = el("div", "gm-pool");
  poolBox.lang = L;
  it.pool.forEach(k => {
    const b = el("button", "gm-tl", it.tiles[k].text);
    b.type = "button";
    if (it.checked == null) {
      b.draggable = true;
      b.addEventListener("click", () => place(k));
      b.addEventListener("dragstart", e => dragStart(e, k));
    } else b.disabled = true;
    poolBox.appendChild(b);
  });
  poolBox.addEventListener("dragover", e => e.preventDefault());
  poolBox.addEventListener("drop", e => { e.preventDefault(); const k = dragK(e); if (k != null && it.placed.includes(k)) unplace(k); });
  root.appendChild(poolBox);

  const after = el("div", "gm-after");
  if (it.checked == null) {
    const row = el("div", "btns two");
    const hb = el("button", "btn", "💡 " + t("gm.order.hint"));
    hb.addEventListener("click", hint);
    const cb = el("button", "btn primary", t("gm.order.check"));
    cb.disabled = it.placed.length < it.tokens.length;
    cb.addEventListener("click", check);
    row.append(hb, cb);
    after.appendChild(row);
  } else {
    const res = el("div", "gm-res " + (it.checked ? "ok" : "bad"));
    res.appendChild(el("span", null, (it.checked ? "✓ " : "✗ ") + t(it.checked ? "gm.right" : "gm.order.answer")));
    const a = el("span", "gm-res-a", it.answer); a.lang = L;
    res.appendChild(a);
    const sp = speakBtn(it.answer, L);
    if (sp) res.appendChild(sp);
    after.appendChild(res);
    if (!it.checked) {
      const nb = el("button", "btn primary", t("gm.next"));
      nb.addEventListener("click", go);
      after.appendChild(nb);
    }
  }
  root.appendChild(after);
  const live = el("div", "sr-only"); live.setAttribute("aria-live", "polite");
  root.appendChild(live);

  function redraw() { gameRerender(g); }
  function place(k) { if (it.checked != null) return; it.pool = it.pool.filter(x => x !== k); it.placed.push(k); redraw(); }
  function unplace(k) { if (it.checked != null) return; it.placed = it.placed.filter(x => x !== k); it.pool.push(k); redraw(); }
  function dragStart(e, k) { try { e.dataTransfer.setData("text/plain", "gm:" + k); e.dataTransfer.effectAllowed = "move"; } catch (err) {} }
  function dragK(e) { try { const v = e.dataTransfer.getData("text/plain"); return /^gm:\d+$/.test(v) ? Number(v.slice(3)) : null; } catch (err) { return null; } }
  // Déposer : sur une case placée → avant elle ; ailleurs dans la réponse → à la fin.
  function dropOn(e, beforeK) {
    if (it.checked != null) return;
    const k = dragK(e);
    if (k == null || k === beforeK) return;
    it.pool = it.pool.filter(x => x !== k);
    it.placed = it.placed.filter(x => x !== k);
    const at = beforeK == null ? -1 : it.placed.indexOf(beforeK);
    if (at < 0) it.placed.push(k); else it.placed.splice(at, 0, k);
    redraw();
  }
  function hint() {
    if (it.checked != null) return;
    let p = 0;
    while (p < it.placed.length && it.tiles[it.placed[p]].text === it.tokens[p]) p++;
    if (p >= it.tokens.length) return;
    it.pool = it.pool.concat(it.placed.slice(p));            // ce qui est faux à la fin retourne en bas
    it.placed = it.placed.slice(0, p);
    const k = it.pool.find(x => it.tiles[x].text === it.tokens[p]);
    if (k == null) return;
    it.pool = it.pool.filter(x => x !== k);
    it.placed.push(k);
    it.hints++; g.hints = (g.hints || 0) + 1;
    redraw();
  }
  function check() {
    if (it.checked != null || it.placed.length < it.tokens.length) return;
    const ok = it.placed.every((k, i) => it.tiles[k].text === it.tokens[i]);
    it.checked = ok;
    gameGrade(g, it.id, ok);
    GameSound.play(ok ? "ok" : "bad");
    gameAutoSpeak(it.answer, L);
    redraw();
    const box = document.querySelector("#screen-review .gm-ans");
    gameFlash(box, ok);
    const lv = document.querySelector("#screen-review .sr-only");
    if (lv) lv.textContent = t(ok ? "gm.right" : "gm.wrong");
    if (ok) setTimeout(go, GAME.OK_MS + 300);
  }
  function go() {
    if (it.left || !gameIsLive(g)) return;
    it.left = true;
    next();
  }
}
