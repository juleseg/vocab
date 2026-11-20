"use strict";

// === MOTS DIFFICILES : INTERFACE (ÉTAPE 57) ===
// Règles et données : js/difficiles.js (Hard). Ici : badge, « Mon astuce », fenêtre « Réparer ce mot » (jamais bloquante :
// bouton « Plus tard » et fond cliquable), paires côte à côte, listes de Stats, lancement d'une session « Mots difficiles » /
// « Mots qui se ressemblent » (le choix de portée est dans js/screens/reviser.js). Textes : js/i18n/difficiles-*.js (clés hd.*).
const HardUI = (() => {
  const multiLang = c => cardStudyLangs(c).length > 1;
  const suffix = (c, L) => (multiLang(c) ? " (" + L.toUpperCase() + ")" : "");

  // Étape 73 : « Mots difficiles » regroupe les mots souvent ratés ET les mots qui se ressemblent (paire de confusion).
  const paired = (c, L) => !!c && Hard.partnersOf(c.id, L).some(id => Hard.cardOf(id));
  const isHardAny = (c, L) => !!c && !Hard.isPaused(c, L) && (Hard.isHard(c, L) || paired(c, L));

  // --- Badge « Mot difficile » : session (une langue) et listes (étiquettes de la carte) ---
  function badge(c, L) {
    if (!c || !isHardAny(c, L)) return null;
    const b = el("span", "hd-badge", "🔥 " + t("hd.badge"));
    b.title = t("hd.badge");
    return b;
  }
  // Étiquettes ajoutées sous une carte de liste : « 🔥 Mot difficile (KO) », « ⏸ En pause (KO) ».
  function tags(c, box) {
    cardStudyLangs(c).forEach(L => {
      const r = Hard.rec(c.id, L);
      if (isHardAny(c, L)) box.appendChild(el("span", "tag hd-tag", "🔥 " + t("hd.badge") + suffix(c, L)));   // étape 73 : ratés ou qui se ressemblent
      if (r && r.p) box.appendChild(el("span", "tag hd-tag hd-paused", "⏸ " + t("hd.badgePaused") + suffix(c, L)));
    });
  }

  // --- « Mon astuce » en session : bouton qui montre / cache le texte ; ouverte d'office si la carte vient d'être ratée ---
  function tipRow(c, open) {
    const tx = c ? Hard.tip(c.id) : "";
    if (!tx) return null;
    const box = el("div", "hd-tip");
    const txt = el("div", "hd-tip-text", "💡 " + tx);
    const btn = el("button", "link-btn hd-tip-btn");
    btn.type = "button";
    let shown = !!open;
    const sync = () => { txt.hidden = !shown; btn.textContent = t(shown ? "hd.tip.hide" : "hd.tip.show"); btn.setAttribute("aria-expanded", String(shown)); };
    btn.addEventListener("click", () => { shown = !shown; sync(); });
    sync();
    box.append(btn, txt);
    return box;
  }
  // Ligne « badge » ajoutée à la barre d'une carte de session (meta-row) : retourne le nœud ou null.
  function metaBadge(c, item) { return badge(c, item && item.lang); }
  // Ajoute badge + astuce dans une session. open = astuce ouverte d'office (carte ratée plus tôt dans la session).
  function sessionExtras(root, c, item, opts) {
    const s = rv.s, L = (item && item.lang) || (s && s.langs && s.langs[c.id]);
    const wrap = el("div", "hd-extras");
    const b = badge(c, L);
    if (b) wrap.appendChild(b);
    if (!(opts && opts.noTip)) {
      const tp = tipRow(c, !!(s && s.missed && s.missed[c.id]) || !!(opts && opts.open));
      if (tp) wrap.appendChild(tp);
    }
    if (wrap.childNodes.length) root.appendChild(wrap);
    return wrap.childNodes.length ? wrap : null;
  }

  // --- Deux mots côte à côte (après une confusion) ---
  function pairNode(a, b, L) {
    const box = el("div", "card hd-pair");
    box.appendChild(el("div", "hd-pair-title", "⚖️ " + t("hd.pair.title")));
    const row = el("div", "hd-pair-row");
    [a, b].forEach(c => {
      const col = el("div", "hd-pair-col");
      const m = el("div", "hd-pair-main", term(c, L) || "—");
      m.lang = L;
      col.appendChild(m);
      const sub = supportText(c, gameLg(c, L));
      if (sub) col.appendChild(el("div", "hd-pair-sub", sub));
      row.appendChild(col);
    });
    box.appendChild(row);
    box.appendChild(el("div", "hint", t("hd.pair.hint")));
    return box;
  }
  // Écrit : la mauvaise réponse tapée est-elle la réponse d'un autre mot de la même langue étudiée ? Si oui, la paire est
  // notée (une confusion de plus) et l'autre carte est renvoyée. Une seule fois par réponse (res.conf).
  function writeConfusion(c, item, res) {
    if (!c || !res || res.conf !== undefined) return res ? res.conf : null;
    res.conf = null;
    if (!isVocab(c) || res.verdict !== "wrong" || !res.typed) return null;
    const L = item.lang || primaryLang(c);
    const ok = ["exact", "accents", "spaces", "punct"];
    let found = null;
    for (const o of state.cards) {
      if (o.id === c.id || !isVocab(o) || !cardStudyLangs(o).includes(L)) continue;
      const had = StudyCtx.cards.has(o.id);
      if (!had) StudyCtx.cards.set(o.id, L);
      try {
        const alts = wrAlts(o, item.dir);
        if (alts.length && ok.includes(wrCheck(res.typed, alts).verdict)) found = o;
      } catch (e) { /* carte incomplète : ignorée */ }
      finally { if (!had) StudyCtx.cards.delete(o.id); }
      if (found) break;
    }
    if (found) { Hard.confuse(c.id, found.id, L); res.conf = found.id; }
    return res.conf;
  }

  // --- Fenêtres ---
  function pickTipInput(c) {
    const ta = el("textarea", "input");
    ta.value = c ? Hard.tip(c.id) : ""; ta.rows = 3; ta.maxLength = HD_TIP_MAX;
    ta.placeholder = t("hd.tip.ph");
    return ta;
  }
  // « Mon astuce » seule (liste en lecture seule, ou depuis la fenêtre « Réparer »). onDone(texte) après l'enregistrement.
  function tipModal(c, opts) {
    const wrap = el("div");
    if (opts && opts.readOnly) wrap.appendChild(el("p", "hint", t("hd.tip.readOnly")));
    const ta = pickTipInput(c);
    wrap.appendChild(formField(t("hd.tip.label"), ta, false, t("hd.tip.hint")));
    openModal(t("hd.tip.title"), wrap, [
      { label: t("cancel") },
      { label: t("save"), kind: "primary", onClick: () => {
        const v = Hard.setTip(c.id, ta.value);
        if (v) Hard.markRepaired(c);
        commitQuiet();
        toast(t(v && opts && opts.repair ? "hd.repair.done" : "hd.tip.saved"));
        if (opts && opts.after) opts.after();
      } }
    ]);
    setTimeout(() => { try { ta.focus(); } catch (e) {} }, 60);
  }
  function exampleModal(c, L) {
    const cur = exEntry(c, L);
    const ta = taInput(cur ? cur.text : "", t("hd.example.ph"), L, 3);
    const wrap = el("div");
    wrap.appendChild(formField(t("card.exampleIn", { lang: langName(L) }), ta));
    openModal(t("hd.example.title"), wrap, [
      { label: t("cancel") },
      { label: t("save"), kind: "primary", onClick: () => {
        const v = ta.value.trim();
        if (!v) return false;
        setExPart(c, L, null, v, L === listLangs(c.listId).target);
        Hard.markRepaired(c, L);
        commitQuiet();
        toast(t("hd.repair.done"));
      } }
    ]);
    setTimeout(() => { try { ta.focus(); } catch (e) {} }, 60);
  }
  function imageModal(c, L) {
    const f = imgEditorField(c, { word: () => {
      const lg = gameLg(c, L);
      const v = code => String(term(c, code) || "").trim();
      const w = [lg.support.includes("en") ? "en" : "", state.settings.uiLang, lg.target].concat(lg.support).map(x => x && v(x)).find(Boolean) || "";
      return w.split("/")[0].trim();
    } });
    openModal(t("hd.image.title"), f.node, [
      { label: t("cancel") },
      { label: t("save"), kind: "primary", onClick: () => {
        const im = f.get();
        if (!im) return;
        c.image = im;
        Hard.markRepaired(c, L);
        commitQuiet();
        if (f.proposeAsked()) { try { Images.propose(c.id); } catch (e) {} }
        toast(t("hd.repair.done"));
      } }
    ]);
  }
  // « Réparer ce mot » : proposée quand un mot difficile est raté. Jamais bloquante.
  function repair(c, L) {
    if (!c || document.querySelector(".modal-bg")) return;
    const can = canEditList(c.listId);
    const body = el("div", "hd-repair");
    body.appendChild(el("p", null, t("hd.repair.intro")));
    const tm = term(c, L) || cardTitle(c);
    const wd = el("div", "hd-repair-word", tm + suffix(c, L)); wd.lang = L;
    body.appendChild(wd);
    let close = () => {};
    const opt = (label, fn, hint) => {
      const b = el("button", "btn hd-opt", label);
      b.type = "button";
      b.addEventListener("click", () => { close(); fn(); });
      body.appendChild(b);
      if (hint) body.appendChild(el("div", "hint hd-opt-hint", hint));
    };
    if (can && isVocab(c) && typeof Images !== "undefined" && Images.on()) opt("🖼️ " + t("hd.repair.image"), () => imageModal(c, L));
    if (can && isVocab(c)) opt("✏️ " + t("hd.repair.example"), () => exampleModal(c, L));
    opt("💡 " + t("hd.repair.tip"), () => tipModal(c, { repair: true }));
    opt("⏸ " + t("hd.repair.pause"), () => {
      Hard.pause(c, L);
      if (rv.s && rv.s.queue) rv.s.queue = rv.s.queue.filter(x => !(x.id === c.id && (x.lang || primaryLang(c)) === L));   // ne revient plus dans cette session
      commit();
      toast(t("hd.repair.paused"));
    }, t("hd.repair.pauseHint"));
    close = openModal(t("hd.repair.title"), body, [{ label: t("hd.repair.later") }]);
  }
  // Après une réponse : proposer la réparation si un mot difficile vient d'être raté.
  function afterGrade(c, L, r) {
    if (r && r.hard && r.hard.missed) setTimeout(() => repair(c, L), 250);
  }

  // --- Stats : trois listes ---
  function statRow(c, L, right) {
    const lg = gameLg(c, L);
    const row = el("div", "st-miss hd-row");
    const m = el("div", "main");
    const f = el("div", "t1", (isVocab(c) ? (term(c, L) || "—") : cardTitle(c)) + suffix(c, L)); f.lang = L;
    m.appendChild(f);
    const sub = isVocab(c) ? supportText(c, lg) : cardSubtitle(c);
    if (sub) m.appendChild(el("div", "t2", sub));
    row.appendChild(m);
    row.appendChild(right);
    return row;
  }
  function section(title, hint, empty, nodes) {
    const box = el("div", "card hd-card");
    box.appendChild(el("h2", null, title));
    box.appendChild(el("div", "hint", hint));
    if (!nodes.length) box.appendChild(el("div", "muted", empty));
    nodes.slice(0, 30).forEach(n => box.appendChild(n));
    return box;
  }
  // units : cartes (vues) du périmètre de Stats, chacune avec id et unitLang.
  // Filtre affiché dans la carte « Mots difficiles » de Stats (étape 73) : "missed" (souvent ratés) | "alike" (qui se ressemblent).
  let statFilt = "missed";
  function statsCards(units) {
    const inScope = new Set(units.map(u => u.id + "|" + u.unitLang));
    const has = (id, L) => inScope.has(id + "|" + L);
    const frag = el("div", "hd-stats");
    const act = (label, fn, cls) => { const b = el("button", "btn hd-mini " + (cls || ""), label); b.type = "button"; b.addEventListener("click", fn); return b; };

    const hardRows = Hard.hardEntries().filter(e => has(e.c.id, e.L)).map(e => {
      const right = el("div", "hd-right");
      right.appendChild(el("div", "cnt", t("hd.stats.missed", { n: e.r.n || 0 })));
      right.appendChild(act(t("hd.stats.pause"), () => { Hard.pause(e.c, e.L); commit(); }));
      return statRow(e.c, e.L, right);
    });

    const pairRows = Hard.pairs().filter(p => has(p.a, p.L) && has(p.b, p.L)).map(p => {
      const a = Hard.cardOf(p.a), b = Hard.cardOf(p.b);
      const row = el("div", "hd-prow");
      const cols = el("div", "hd-pair-row");
      [a, b].forEach(c => {
        const col = el("div", "hd-pair-col");
        const m = el("div", "hd-pair-main", term(c, p.L) || "—"); m.lang = p.L;
        col.appendChild(m);
        const sub = supportText(c, gameLg(c, p.L));
        if (sub) col.appendChild(el("div", "hd-pair-sub", sub));
        cols.appendChild(col);
      });
      row.appendChild(cols);
      row.appendChild(el("div", "cnt", t("hd.stats.confused", { n: p.n }) + (multiLang(a) ? " · " + p.L.toUpperCase() : "")));
      return row;
    });
    // Étape 73 : UNE carte « Mots difficiles », deux petits filtres « Souvent ratés » / « Qui se ressemblent »,
    // UNE session qui mélange les deux (portée "hard" de js/screens/reviser.js).
    const box = el("div", "card hd-card");
    box.appendChild(el("h2", null, t("hd.stats.hard")));
    box.appendChild(el("div", "hint", t("hd.group.hint")));
    const body = el("div");
    const draw = () => {
      body.textContent = "";
      const seg = el("div", "seg hd-filt");
      [["missed", hardRows.length], ["alike", pairRows.length]].forEach(([k, n]) => {
        const b = el("button", null, t("hd.filt." + k) + " (" + n + ")"); b.type = "button";
        b.setAttribute("aria-pressed", String(statFilt === k));
        b.addEventListener("click", () => { statFilt = k; draw(); });
        seg.appendChild(b);
      });
      body.appendChild(seg);
      const alike = statFilt === "alike", rows = alike ? pairRows : hardRows;
      body.appendChild(el("div", "hint", t(alike ? "hd.stats.pairsHint" : "hd.stats.hardHint")));
      if (!rows.length) body.appendChild(el("div", "muted", t(alike ? "hd.stats.pairsEmpty" : "hd.stats.hardEmpty")));
      rows.slice(0, 30).forEach(n => body.appendChild(n));
    };
    draw();
    box.appendChild(body);
    if (hardRows.length || pairRows.length) box.appendChild(goBtn("hard"));
    frag.appendChild(box);

    const pausedRows = Hard.pausedEntries().filter(e => has(e.c.id, e.L)).map(e => {
      const right = el("div", "hd-right");
      right.appendChild(act(t("hd.stats.resume"), () => { Hard.resume(e.c, e.L); commit(); toast(t("hd.stats.resumed")); }));
      return statRow(e.c, e.L, right);
    });
    frag.appendChild(section(t("hd.stats.paused"), t("hd.stats.pausedHint"), t("hd.stats.pausedEmpty"), pausedRows));
    return frag;
  }
  function goBtn(scope) {
    const b = el("button", "btn primary hd-go", t("hd.stats.review"));
    b.type = "button";
    b.addEventListener("click", () => startScope(scope));
    return b;
  }
  // Lance une session Cartes sur les mots difficiles (étape 73 : ratés ET qui se ressemblent, une seule portée "hard" ;
  // aucune date de révision exigée).
  function startScope(scope) {
    rv.cfg = defaultSessionCfg();
    rv.cfg.scope = "hard"; rv.cfg.onlyDue = false; rv.cfg.mode = "cards";
    rv.phase = "config"; rv.s = null;
    if (!sessionPool(rv.cfg).length) { toast(t("hd.stats.noneToReview")); return; }
    showScreen("review");
    if (!startSession()) toast(t("hd.stats.noneToReview"));
  }

  return { tipInput: pickTipInput, badge, isHardAny, tags, tipRow, sessionExtras, metaBadge, pairNode, writeConfusion, tipModal, repair, afterGrade, statsCards, startScope };
})();
window.App.HardUI = HardUI;
