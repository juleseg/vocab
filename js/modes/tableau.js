"use strict";

// === MODE TABLEAU ===
// Conjugaison seulement : un verbe + un temps, une case par personne. Validation d'un coup :
// chaque case juste → Su, fausse (ou vide) → Pas su, dans le Leitner de la carte conj correspondante.
// Les cases fausses reviennent en fin de session (tableau réduit à ces personnes).
// File : rv.s.queue = [{ ids }] ; état du tableau en cours : rv.s.tb = { vals: { id: saisie }, res: { id: verdict } | null, show }.
function tableKey(c) { return c.listId + "|" + c.lang + "|" + normText(c.verb) + "|" + c.tense; }
// Regroupe des cartes conj par tableau (liste + langue + verbe + temps), dans l'ordre d'arrivée des tableaux.
function tableGroups(cards) {
  const m = new Map();
  cards.forEach(c => { if (cardType(c) !== "conj") return; const k = tableKey(c); if (!m.has(k)) m.set(k, []); m.get(k).push(c.id); });
  return [...m.values()].map(ids => ({ ids }));
}
// Tableaux du périmètre. « À réviser aujourd'hui » : un tableau entre dès qu'une de ses cases est due,
// avec toutes ses personnes (filtres de personnes respectés). Nombre de cartes : tableaux ajoutés jusqu'à l'atteindre.
function startTableSession(cfg) {
  const due = sessionPool(cfg);
  if (!due.length) return false;
  const keys = new Set(due.map(tableKey));
  const full = cfg.onlyDue ? sessionPool(Object.assign({}, cfg, { onlyDue: false })).filter(c => keys.has(tableKey(c))) : due;
  const groups = shuffle(tableGroups(full));
  const queue = [];
  let n = 0;
  for (const g of groups) { if (queue.length && n >= cfg.count) break; queue.push(g); n += g.ids.length; }
  newRun(queue, "table");
  return true;
}
function tableCards(g) {
  const cs = g.ids.map(sessionCard).filter(c => c && cardType(c) === "conj");
  if (!cs.length) return [];
  const ps = personsOf(cs[0].lang, cs[0].tense).map(p => p.id);
  return cs.sort((a, b) => ps.indexOf(a.person) - ps.indexOf(b.person));
}

function renderTableSession(root) {
  const s = rv.s;
  while (s.queue.length && !tableCards(s.queue[0]).length) { s.queue.shift(); s.tb = null; }
  if (!s.queue.length) { renderSessionSummary(root); return; }
  const g = s.queue[0];
  const cs = tableCards(g);
  const c0 = cs[0], L = c0.lang;
  if (!s.tb) s.tb = { vals: {}, res: null, show: false };
  const tb = s.tb;

  audioCard(s, c0);
  root.appendChild(audioToggle());
  const left = s.queue.length;
  const meta = el("div", "meta-row");
  meta.append(el("span", null, t(left > 1 ? "table.left" : "table.left1", { n: left })), el("span", null, t("table.cells", { n: cs.length })));
  root.appendChild(meta);

  // En-tête : verbe, temps, traduction, note
  const head = el("div", "card tb-head ty-conj");
  head.appendChild(el("div", "sw-lang", t("type.conj") + " · " + langName(L)));
  const v0 = cjqVerb(c0);                                // étape 83 : verbe sans « to », consigne avec le temps
  const vb = el("div", "tb-verb", v0); vb.lang = L;
  head.appendChild(vb);
  head.appendChild(tyLine("ty-big", typeof ConjQ !== "undefined" ? ConjQ.tableText(c0) : tenseName(L, c0.tense)));
  const tr0 = cs.map(x => x.translation).find(Boolean);
  if (tr0) head.appendChild(tyLine("ty-tr", tr0));
  const sp = spkItemsRow([{ text: v0, lng: L }]);
  if (sp) head.appendChild(sp);
  root.appendChild(head);
  autoSpeak(s, "q", [{ text: v0, lng: L }], { target: L, support: cardLangs(c0).support });

  // Tableau : une ligne par personne
  const table = el("div", "card tb-grid");
  const inputs = [];
  cs.forEach((c, i) => {
    const row = el("div", "tb-row");
    const r = tb.res ? tb.res[c.id] : null;
    if (r) row.classList.add(r.verdict === "wrong" ? "bad" : "ok");
    row.appendChild(el("div", "tb-person", personLabel(L, c.tense, c.person)));
    const cell = el("div", "tb-cell");
    const inp = textInput(tb.vals[c.id] || "", "", L);
    inp.classList.add("tb-input");
    inp.spellcheck = false;
    inp.setAttribute("autocapitalize", "off");
    inp.setAttribute("autocorrect", "off");
    inp.setAttribute("aria-label", personLabel(L, c.tense, c.person));
    inp.enterKeyHint = i < cs.length - 1 ? "next" : "done";
    if (tb.res) inp.readOnly = true;
    else {
      inp.addEventListener("input", () => { tb.vals[c.id] = inp.value; });
      inp.addEventListener("keydown", e => {
        if (e.key !== "Enter") return;
        e.preventDefault();
        if (inputs[i + 1]) inputs[i + 1].focus(); else tableCheck(cs);
      });
    }
    inputs.push(inp);
    cell.appendChild(inp);
    if (r) cell.appendChild(el("span", "tb-mark", r.verdict === "wrong" ? "✗" : "✓"));
    row.appendChild(cell);
    // Correction : différences surlignées (case fausse) ou bonne orthographe (accents…)
    if (r && tb.show && r.verdict !== "exact") {
      const fix = el("div", "tb-fix");
      if (r.typed) {
        const d = wrLcs(r.typed, r.best);
        fix.append(wrDiffNode(d.A, d.ma, "wr-bad"), el("span", "pv-arrow", "→"), wrDiffNode(d.B, d.mb, "wr-miss"));
      } else fix.appendChild(el("div", "wr-diff", r.best));
      fix.lang = L;
      if (r.verdict !== "wrong") fix.appendChild(el("div", "tb-note", t({ accents: "write.accents", spaces: "write.spaces", punct: "write.punct" }[r.verdict])));
      row.appendChild(fix);
    }
    table.appendChild(row);
  });
  root.appendChild(table);

  if (!tb.res) {
    const b = el("button", "btn primary", t("table.check"));
    b.addEventListener("click", () => tableCheck(cs));
    root.appendChild(b);
    setTimeout(() => { try { const f = inputs.find(x => !x.value) || inputs[0]; if (f && !("ontouchstart" in window)) f.focus(); } catch (e) {} }, 60);
  } else {
    const ids = cs.map(c => c.id).filter(id => tb.res[id]);
    const ok = ids.filter(id => tb.res[id].verdict !== "wrong").length;
    const box = el("div", "card wr-res " + (ok === ids.length ? "ok" : ok ? "acc" : "bad"));
    box.appendChild(el("div", "wr-head", t("table.score", { n: ok, m: ids.length })));
    const notes = [...new Set(cs.map(x => x.note).filter(Boolean))];
    if (notes.length) box.appendChild(tyLine("ty-note", notes.join(" · ")));
    const full = cs.map(c => conjFull(c)).join(" · ");
    box.appendChild(tyLine("tb-all", full, L));
    const asp = spkItemsRow(cs.map(c => ({ text: conjFull(c), lng: L })));
    if (asp) box.appendChild(asp);
    root.appendChild(box);
    autoSpeak(s, "a", cs.map(c => ({ text: conjFull(c), lng: L })), { target: L, support: cardLangs(c0).support });
    const btns = el("div", "btns two");
    const show = el("button", "btn", t(tb.show ? "table.hideFix" : "table.showFix"));
    show.addEventListener("click", () => { tb.show = !tb.show; renderReview(); });
    const next = el("button", "btn primary", t("table.next"));
    next.addEventListener("click", tableNext);
    btns.append(show, next);
    root.appendChild(btns);
    setTimeout(() => { try { next.focus(); } catch (e) {} }, 60);
  }

  const quit = el("button", "link-btn", t("cards.quit"));
  quit.addEventListener("click", () => { s.tb = null; s.queue = []; renderReview(); });
  root.appendChild(quit);
}

// Validation d'un coup : chaque case met à jour sa carte dans le Leitner (juste → Su, fausse → Pas su).
function tableCheck(cs) {
  const s = rv.s, tb = s.tb;
  if (!tb || tb.res) return;
  tb.res = {};
  cs.forEach(c => {
    const r = wrCheck(tb.vals[c.id] || "", typedAlts(c));
    tb.res[c.id] = r;
    const result = r.verdict === "wrong" ? "unknown" : "known";
    const g = Leitner.grade(c, result);
    s.counts[result]++;
    if (!(c.id in s.first)) s.first[c.id] = result;
    s.log.unshift({ word: cardTitle(c), result, from: g.from, to: g.to, dueAt: g.dueAt });
  });
  tb.show = cs.some(c => tb.res[c.id].verdict === "wrong");   // correction affichée d'office s'il y a des erreurs
  commit();
}
// Tableau suivant ; les cases fausses reviennent en fin de session.
function tableNext() {
  const s = rv.s, tb = s.tb;
  const g = s.queue.shift();
  if (g && tb && tb.res) {
    const wrong = g.ids.filter(id => tb.res[id] && tb.res[id].verdict === "wrong");
    if (wrong.length) s.queue.push({ ids: wrong });
  }
  s.tb = null;
  renderReview();
  window.scrollTo(0, 0);
}
