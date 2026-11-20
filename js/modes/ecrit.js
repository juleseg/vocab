"use strict";

// === MODE ÉCRIT ===
// Saisie de la réponse. Comparaison sans casse, espaces en trop ni accents ; plusieurs réponses acceptées ("/").
// Juste mais accents faux = compté juste + bonne orthographe avec différences surlignées.
// Après vérification : valider le résultat proposé, ou le corriger (Su / À revoir / Pas su).
// Libellés des réponses : clés ans.* (étape 56) ; catégorie de la carte : clés cat.*.
// État de la carte en cours : rv.s.w = { typed, res } (remis à zéro à chaque notation).

// Nettoyage commun : espaces simplifiés, apostrophes unifiées (’ du clavier iPhone = '). Casse et accents gardés.
function wrClean(s) {
  return String(s || "").normalize("NFC").replace(/[’‘ʼ´`]/g, "'").replace(/\s+/g, " ").trim();
}
// Étape 73 : la ponctuation n'est JAMAIS prise en compte quand on vérifie une réponse (tous les modes). SEUL endroit qui la
// définit : WR_PUNCT_RE (ponctuation et symboles Unicode : . , ! ? ; : ' " « » “ ” ‘ ’ - – — ( ) … ~ ・ 。 、 「 」 『 』 《 》 ¿ ¡ …).
// join = false : remplacée par une espace (« peut-être » = « peut être ») ; join = true : retirée (« s'il » = « sil »).
// Texte fait seulement de ponctuation (ex. « ? ») : gardé tel quel. Utilisée par wrCheck (Écrit, Dictée, Tableau, Mix…),
// lisKey (Prononciation, Répéter après la voix) et orderSame (Remettre en ordre).
const WR_PUNCT_RE = /[\p{P}\p{S}]/gu;
function wrNoPunct(s, join) {
  const x = String(s == null ? "" : s);
  const y = x.replace(WR_PUNCT_RE, join ? "" : " ").replace(/\s+/g, " ").trim();
  return y || x.trim();
}
// Réponses acceptées : champ(s) de la face réponse, découpés sur "/" : [{ text, lng }].
// Réponse attendue en langues d'appui : une réponse juste dans l'une d'elles suffit.
function wrAlts(c, dir) {
  if (!isVocab(c)) return typedAlts(c);              // autres types : forme / mot manquant / phrase corrigée
  const lg = cardLangs(c);
  const fields = dir === "fromT" ? supportTerms(c, lg).map(x => [x.text, x.code]) : [[term(c, lg.target), lg.target]];
  const out = [];
  fields.forEach(([f, lng]) => String(f || "").split("/").map(wrClean).filter(Boolean).forEach(x => out.push({ text: x, lng })));
  return out;
}
// Clé de comparaison selon les règles de la langue (LANGUAGES[x].normalize) : sans casse ; accents retirés
// si la langue les tolère ; espaces retirés (noSpaces) si la langue les tolère.
function wrKey(s, rules, noSpaces) {
  let x = wrClean(s).toLowerCase();
  if (rules.accents) x = x.normalize("NFD").replace(/[\u0300-\u036f]/g, "").normalize("NFC");
  if (noSpaces && rules.spaces) x = x.replace(/\s+/g, "");
  return x;
}
// Plus longue sous-séquence commune (sans casse, avec accents) : marque les caractères communs aux deux textes.
function wrLcs(a, b) {
  const A = Array.from(a), B = Array.from(b);
  const ka = A.map(ch => ch.toLowerCase()), kb = B.map(ch => ch.toLowerCase());
  const n = A.length, m = B.length;
  const L = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--)
    L[i][j] = ka[i] === kb[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const ma = new Array(n).fill(false), mb = new Array(m).fill(false);
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (ka[i] === kb[j]) { ma[i] = mb[j] = true; i++; j++; }
    else if (L[i + 1][j] >= L[i][j + 1]) i++; else j++;
  }
  return { A, B, ma, mb, len: L[0][0] };
}
// verdict : "exact" | "accents" (juste, accents faux) | "spaces" (juste, espaces faux) | "wrong".
// Étape 73 : la ponctuation est ignorée à chaque étape (wrNoPunct, deux façons : remplacée par une espace ou retirée) ;
// une réponse qui ne diffère que par la ponctuation est donc « exact » (le verdict "punct" n'est plus produit).
// Casse : toujours ignorée ; accents et espaces : règles de la langue (inchangées).
// best / bestLng = réponse acceptée la plus proche et sa langue.
function wrCheck(typed, alts) {
  const tx = wrClean(typed);
  const res = (verdict, a) => ({ verdict, typed: tx, best: a ? a.text : "—", bestLng: a ? a.lng : "" });
  if (!tx || !alts.length) return res("wrong", alts[0]);
  const same = (a, b, key) => [false, true].some(j => key(wrNoPunct(a, j)) === key(wrNoPunct(b, j)));
  const low = x => wrClean(x).toLowerCase();
  for (const a of alts) if (same(a.text, tx, low)) return res("exact", a);
  for (const a of alts) { const r = langRules(a.lng); if (r.accents && same(a.text, tx, x => wrKey(x, r))) return res("accents", a); }
  for (const a of alts) { const r = langRules(a.lng); if (r.spaces && same(a.text, tx, x => wrKey(x, r, true))) return res("spaces", a); }
  let best = alts[0], score = -1;
  alts.forEach(a => {
    const r = wrLcs(tx, a.text);
    const sc = r.len / Math.max(r.A.length, r.B.length, 1);
    if (sc > score) { score = sc; best = a; }
  });
  return res("wrong", best);
}
// Texte avec les caractères non communs surlignés (cls = wr-miss ou wr-bad).
function wrDiffNode(chars, marks, cls) {
  const d = el("div", "wr-diff");
  let buf = "", hl = null;
  const flush = () => { if (buf) d.appendChild(hl ? el("mark", cls, buf) : document.createTextNode(buf)); buf = ""; };
  chars.forEach((ch, i) => { const h = !marks[i]; if (h !== hl) { flush(); hl = h; } buf += ch; });
  flush();
  return d;
}
function wrGrade(result) { rv.s.w = null; gradeCurrent(result); }

function renderWriteSession(root) {
  const s = rv.s;
  const skip = id => { const c = sessionCard(id); return !c || cardType(c) === "rule"; }; // supprimée entre-temps, ou fiche de règle
  while (s.queue.length && skip(s.queue[0].id)) s.queue.shift();
  if (!s.queue.length) { renderSessionSummary(root); return; }
  const item = s.queue[0];
  const c = sessionCard(item.id);
  if (!s.w) s.w = { typed: "", res: null };
  const w = s.w;
  const f = cardFaces(c, item.dir);
  const alts = wrAlts(c, item.dir);
  const ansLangs = [];
  alts.forEach(a => { if (!ansLangs.includes(a.lng)) ansLangs.push(a.lng); });

  audioCard(s, c);
  root.appendChild(audioToggle());
  const meta = el("div", "meta-row");
  meta.append(el("span", null, t("cards.left", { n: s.queue.length })), el("span", null, t("cat." + Leitner.category(c))));
  root.appendChild(meta);
  HardUI.sessionExtras(root, c, item, { noTip: !w.res });   // badge ; astuce seulement après la réponse (étape 57)

  // Question (nature affichée seulement après la réponse)
  const q = el("div", "card wr-q");
  q.appendChild(el("div", "sw-lang", f.q.lang));
  const qImg = Images.place(c, item.dir, "q", "ci-mid");   // image côté question (étape 49)
  if (qImg) q.appendChild(qImg);
  q.appendChild(faceMain("sw-main", f.q, c, !!w.res));
  const qs = faceSub("sw-sub", f.q, c, !!w.res);
  if (qs) q.appendChild(qs);
  faceExtras(f.q).forEach(n => q.appendChild(n));
  if (!isVocab(c)) q.classList.add("ty-" + cardType(c));
  const qsp = spkItemsRow(f.q.items);
  if (qsp) q.appendChild(qsp);
  root.appendChild(q);
  autoSpeak(s, "q", f.q.items, f.lg);

  // Saisie
  const inp = textInput(w.typed, t("write.ph", { lang: ansLangs.map(x => langName(x)).join(t("write.or")) }), ansLangs[0] || f.a.lng);
  inp.classList.add("wr-input");
  inp.spellcheck = false;
  inp.setAttribute("autocapitalize", "off");
  inp.setAttribute("autocorrect", "off");
  inp.enterKeyHint = "done";
  root.appendChild(inp);

  if (!w.res) {
    const check = () => { w.typed = inp.value; w.res = wrCheck(inp.value, alts); HardUI.writeConfusion(c, item, w.res); renderReview(); };   // étape 57 : confusion avec un autre mot
    inp.addEventListener("input", () => { w.typed = inp.value; });
    inp.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); check(); } });
    const b = el("button", "btn primary", t("write.check"));
    b.addEventListener("click", check);
    root.appendChild(b);
    setTimeout(() => { try { inp.focus(); } catch (e) {} }, 60);
  } else {
    inp.readOnly = true;
    const r = w.res;
    const kind = { exact: "ok", accents: "acc", spaces: "acc", punct: "acc", wrong: "bad" }[r.verdict];
    const box = el("div", "card wr-res " + kind);
    box.appendChild(el("div", "wr-head", t({ exact: "write.ok", accents: "write.accents", spaces: "write.spaces", punct: "write.punct", wrong: "write.wrong" }[r.verdict])));
    const aImg = Images.place(c, item.dir, "a", "ci-mid");   // image côté réponse, après la réponse (étape 49)
    if (aImg) box.appendChild(aImg);
    if (r.verdict === "exact") {
      box.appendChild(el("div", "wr-diff", r.best));
    } else if (!r.typed) {
      box.appendChild(el("div", "wr-lbl", t("write.correct")));
      box.appendChild(el("div", "wr-diff", r.best));
    } else {
      const d = wrLcs(r.typed, r.best);
      box.appendChild(el("div", "wr-lbl", t("write.yours")));
      box.appendChild(wrDiffNode(d.A, d.ma, "wr-bad"));
      box.appendChild(el("div", "wr-lbl", t("write.correct")));
      box.appendChild(wrDiffNode(d.B, d.mb, "wr-miss"));
    }
    const bp = posTag(c, r.bestLng);
    if (bp) { const pd = el("div", "wr-pos"); genderMark(pd, c, r.bestLng); pd.appendChild(bp); box.appendChild(pd); }
    const asp = spkItemsRow(f.a.items);
    if (asp) box.appendChild(asp);
    // Lecture auto de la réponse après validation, remplacée par la répétition auditive si elle se déclenche (étape 55).
    if (!audAfterCheck(s, c, f.lg, r.verdict !== "wrong")) autoSpeak(s, "a", f.a.items, f.lg);
    if (!isVocab(c)) {
      // Autres types : phrase complète (texte à trous), forme avec pronom (conjugaison), explication, règle…
      if (c.type !== "fix") { const full = faceMain("wr-full", f.a, c, false); full.classList.add("wr-full"); box.appendChild(full); }
      faceExtras(f.a).forEach(n => box.appendChild(n));
    } else if (alts.length > 1) {
      box.appendChild(el("div", "wr-lbl", t("write.all", { a: f.a.main + (f.a.sub ? " · " + f.a.sub : "") })));
    }
    const ex = exampleNode(c, "wr-ex", f.lg); if (ex) box.appendChild(ex);   // exemple + traductions (étape 35)
    root.appendChild(box);
    const other = r.conf ? state.cards.find(x => x.id === r.conf) : null;   // étape 57 : deux mots côte à côte
    if (other) root.appendChild(HardUI.pairNode(c, other, item.lang || primaryLang(c)));

    // Résultat proposé + correction possible
    const sug = r.verdict === "wrong" ? "unknown" : "known";
    const next = el("button", "btn primary", t("write.next", { r: t("ans." + sug) }));
    next.addEventListener("click", () => wrGrade(sug));
    root.appendChild(next);
    root.appendChild(el("div", "wr-fix", t("write.fix")));
    const g = el("div", "btns two");
    [["known", "ok"], ["review", "warn"], ["unknown", "danger"]].filter(([x]) => x !== sug).forEach(([x, cls]) => {
      const b = el("button", "btn " + cls, t("ans." + x));
      b.addEventListener("click", () => wrGrade(x));
      g.appendChild(b);
    });
    root.appendChild(g);
    setTimeout(() => { try { next.focus(); } catch (e) {} }, 60);
  }

  const quit = el("button", "link-btn", t("cards.quit"));
  quit.addEventListener("click", () => { s.w = null; s.queue = []; renderReview(); });
  root.appendChild(quit);
}
