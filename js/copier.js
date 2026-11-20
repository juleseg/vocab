"use strict";

// === COPIER LES PROPOSITIONS (ÉTAPE 73) ===
// Bouton « 📋 Copier » : met dans le presse-papiers le texte de propositions, une par ligne, pour les coller dans une
// conversation avec Claude. Format : « mot | champ | valeur actuelle → valeur proposée | liste » (— pour une case vide).
// - « À valider » (js/screens/a-valider.js) : choix « Tout (N) » (lignes des filtres en cours) ou « Sélection (N) ».
// - Administration → Dictionnaire → Propositions (js/screens/admin-dictionnaire.js) : même choix (page affichée / sélection).
// - Administration → Dictionnaire → Faux doublons (js/screens/admin-doublons.js) : un bouton par cas.
// Textes : clés cpy.* (js/i18n/simple-<langue>.js). Styles : .cpy-* (css/app-8.css).
const CPY_SEP = " | ";

// Copie un texte ; repli pour les navigateurs sans presse-papiers (champ caché + execCommand).
function cpyWrite(text) {
  const ok = () => toast(t("cpy.done", { n: String(text).split("\n").filter(Boolean).length }));
  const legacy = () => {
    try {
      const ta = el("textarea");
      ta.value = text; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = "0"; ta.style.top = "0";
      document.body.appendChild(ta); ta.select();
      const r = document.execCommand("copy");
      ta.remove();
      if (r) ok(); else toast(t("cpy.fail"));
    } catch (e) { toast(t("cpy.fail")); }
  };
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(text).then(ok, legacy); return; }
  } catch (e) { /* repli */ }
  legacy();
}
// Petit bouton « 📋 Copier ».
function cpyBtn(onClick, cls) {
  const b = el("button", "btn cpy-btn" + (cls ? " " + cls : ""), "📋 " + t("cpy.btn"));
  b.type = "button";
  b.addEventListener("click", e => { e.preventDefault(); e.stopPropagation(); onClick(); });
  return b;
}
// Fenêtre « Copier » : Tout (N) ou Sélection (N). all / sel : fonctions qui renvoient les lignes.
function cpyChoose(allN, selN, all, sel) {
  if (!selN) { cpyWrite(all().join("\n")); return; }
  const wrap = el("div", "cpy-pick");
  wrap.appendChild(el("p", "muted", t("cpy.help")));
  let close = () => {};
  const go = f => { close(); cpyWrite(f().join("\n")); };
  const bA = el("button", "btn", t("cpy.all", { n: allN })); bA.type = "button"; bA.addEventListener("click", () => go(all));
  const bS = el("button", "btn primary", t("cpy.sel", { n: selN })); bS.type = "button"; bS.addEventListener("click", () => go(sel));
  wrap.append(bA, bS);
  close = openModal(t("cpy.title"), wrap, [{ label: t("cancel") }]);
}
const cpyVal = v => { const x = String(v == null ? "" : v).replace(/\s+/g, " ").trim(); return x || "—"; };

// --- « À valider » ---
function cpyPendingLine(p, cards) {
  const l = getList(p.field === "new" ? p.listId : ((cards.get(p.cardId) || {}).listId));
  const list = l ? l.name : "";
  if (p.field === "new") {
    const d = p.cards[0], c = draftCard(d, p.listId), lg = listLangs(p.listId);
    const word = d.type === "vocab" ? term(c, lg.target) : cardTitle(c);
    const what = d.type === "vocab" ? supportText(c, lg) : cardSubtitle(c);
    return [cpyVal(word), t("pv.type.newcard") + (p.cards.length > 1 ? " (" + t("pv.newN", { n: p.cards.length }) + ")" : ""), "— → " + cpyVal(what), list].join(CPY_SEP);
  }
  const c = cards.get(p.cardId);
  const word = c ? (isVocab(c) ? targetTerm(c, cardLangs(c)) : cardTitle(c)) : "";
  if (p.field === "dup") return [cpyVal(word), t("pv.field.dup"), "→ " + t("pv.dupAction"), list].join(CPY_SEP);
  const pos = isPosField(p.field), lng = pos ? p.field.slice(4) : "";
  const v = x => pos ? pvPosText(x, lng) : x;
  return [cpyVal(word), pvFieldLabel(p.field), cpyVal(v(p.oldValue)) + " → " + cpyVal(v(p.newValue)), list].join(CPY_SEP)
    + (p.reason ? CPY_SEP + p.reason : "");
}
function cpyPendingBtn(vis) {
  return cpyBtn(() => {
    const cards = new Map(state.cards.map(c => [c.id, c]));
    const sel = vis.filter(p => pv.sel.has(p.id));
    cpyChoose(vis.length, sel.length, () => vis.map(p => cpyPendingLine(p, cards)), () => sel.map(p => cpyPendingLine(p, cards)));
  });
}

// --- Administration → Dictionnaire → Propositions ---
function cpyAdPropLine(r) {
  return [adWords(r.vals), adFieldLabel(r.lang, r.field, r.tr_lang),
    cpyVal(adValText(r.field, r.lang, r.old_value)) + " → " + cpyVal(adValText(r.field, r.lang, r.new_value)),
    t("dict.by", { id: r.by || "?", d: adDate(r.created_at) })].join(CPY_SEP);
}
function cpyAdPropBtn(rows) {
  return cpyBtn(() => {
    const sel = rows.filter(r => ad.sel.has(r.id));
    cpyChoose(rows.length, sel.length, () => rows.map(cpyAdPropLine), () => sel.map(cpyAdPropLine));
  });
}

// --- Administration → Dictionnaire → Faux doublons : un cas ---
function cpyAdcLines(r) {
  const senses = arr(r.senses), cards = arr(r.cards), props = arr(r.proposals);
  const num1 = new Map(senses.map((s, i) => [s.id, i + 1]));
  const sn = id => num1.has(id) ? t("adc.senseN", { n: num1.get(id) }) : t("adc.senseOther");
  const out = [t("cpy.adc.head", { w: r.word || "—", l: adcLangName(r.lang) })];
  senses.forEach((s, i) => out.push(t("adc.senseN", { n: i + 1 }) + CPY_SEP + adWords(s.vals) + CPY_SEP + t("adc.cards", { n: num(Number(s.cards), 0) })));
  cards.forEach(x => out.push(t("cpy.adc.card", { by: x.by || "?" }) + CPY_SEP + adcWordsLine(x.vals && Object.keys(x.vals).length ? x.vals : { [r.lang]: x.w }, r.lang)
    + CPY_SEP + (x.to ? sn(x.to) : x.linked ? sn(x.linked) : t("adc.card.free"))));
  props.forEach(p => {
    const what = p.choice === "existing" ? t("adc.ch.existing", { s: sn(p.sense) }) : t(p.choice === "both" ? "adc.ch.both" : "adc.ch.mine") + " : " + adcWordsLine(p.vals, r.lang);
    out.push(t("cpy.adc.prop", { by: p.by || "?" }) + CPY_SEP + what + (p.comment ? CPY_SEP + "« " + p.comment + " »" : ""));
  });
  return out;
}
function cpyAdcBtn(r) { return cpyBtn(() => cpyWrite(cpyAdcLines(r).join("\n")), "adc-copy"); }
