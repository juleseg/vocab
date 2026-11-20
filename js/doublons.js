"use strict";

// === FAUX DOUBLONS DU DICTIONNAIRE : CÔTÉ UTILISATEUR (ÉTAPE 63) ===
// Une carte tombée sur plusieurs sens du dictionnaire commun (ex. 청소하다 → « nettoyer » et « faire le ménage ») garde
// ses valeurs ; le cas est jugé par l'admin (Administration → Dictionnaire → Faux doublons, js/screens/admin-doublons.js).
// Ici : repère discret « Ce mot existe déjà dans le dictionnaire autrement » (liste des cartes : DictConf.tag ;
// éditeur de carte : DictConf.note) et fenêtre « Faire une proposition » (DictConf.open) :
//   (a) garder un sens qui existe, (b) garder le mien (mots de ma carte), (c) les deux combinés (formes réunies avec « / ») ;
//   commentaire facultatif de 200 caractères (texte seul, visible de l'admin seulement).
// Le compte ne modifie jamais le dictionnaire lui-même : la proposition part au serveur (dict_conflict_propose, comptée
// dans la limite des propositions du dictionnaire : 300 par compte et par jour). Cas lus par Dict (js/dictionary.js) :
// Dict.conflictOf, Dict.conflictDetail, Dict.conflictPropose. Textes : clés dcf.* (js/i18n/doublons-*.js).
const DCF_COMMENT_MAX = 200;

// Formes d'un mot coupées sur « / » (espaces autour sans importance), sans doublon (même règle que dictNorms).
function dcfForms(list) {
  const out = [], seen = new Set();
  arr(list).forEach(w => String(w == null ? "" : w).split("/").forEach(f => {
    const v = dictClean(f), k = dictNorm(v);
    if (v && k && !seen.has(k)) { seen.add(k); out.push(v); }
  }));
  return out;
}
// Valeurs « les deux combinés » : pour chaque langue, les formes des sens (puis de la carte) réunies avec « / ».
function dcfCombine(senses, extra) {
  const langs = [];
  arr(senses).forEach(s => Object.keys((s && s.vals) || {}).forEach(L => { if (isLang(L) && s.vals[L].w && !langs.includes(L)) langs.push(L); }));
  Object.keys(extra || {}).forEach(L => { if (isLang(L) && extra[L] && !langs.includes(L)) langs.push(L); });
  const o = {};
  langs.forEach(L => {
    const f = dcfForms(arr(senses).map(s => s && s.vals && s.vals[L] && s.vals[L].w).concat([(extra || {})[L]]));
    if (f.length) o[L] = f.join(" / ").slice(0, 120);
  });
  return o;
}
// Mots d'une carte : { langue: mot } (langue apprise et langues affichées d'abord).
function dcfCardVals(c) {
  const o = {};
  let order = [];
  try { const lg = cardLangs(c); order = [lg.target].concat(lg.support); } catch (e) {}
  order.concat(Object.keys(c.terms || {})).forEach(L => { const v = dictClean(term(c, L)); if (isLang(L) && v && !o[L]) o[L] = v; });
  return o;
}
// « KO 청소하다 · FR nettoyer / faire le ménage »
function dcfValsLine(vals, first) {
  const v = vals || {};
  const keys = Object.keys(v).filter(L => isLang(L) && v[L]);
  keys.sort((a, b) => (a === first ? -1 : b === first ? 1 : 0));
  return keys.map(L => L.toUpperCase() + " " + v[L]).join(" · ") || "—";
}
function dcfErrText(e) {
  const h = String((e && e.hint) || ""), code = String((e && e.code) || "");
  if (h === "limit") return t("dict.limit");
  if (h === "conf_long") return t("dcf.err.long", { n: DCF_COMMENT_MAX });
  if (h === "conf_done") return t("dcf.err.done");
  if (h === "conf_gone" || h === "conf_bad") return t("dcf.err.gone");
  if (code === "42501") return t("dcf.err.gone");
  return t("dcf.err.net");
}

const DictConf = {
  // Cas ouvert d'une carte (ou null).
  of(c) { try { return Dict.conflictOf(c); } catch (e) { return null; } },
  // Petite marque dans la liste des cartes.
  tag(c, box) {
    const x = this.of(c);
    if (!x || !box) return;
    const s = el("span", "tag dcf-tag", "⚖ " + t("dcf.tag"));
    s.title = t("dcf.note");
    box.appendChild(s);
  },
  // Repère + bouton « Faire une proposition » (éditeur de carte).
  note(c) {
    const x = this.of(c);
    if (!x) return null;
    const box = el("div", "dcf-note");
    box.dataset.card = c.id;
    box.appendChild(el("p", "dcf-note-t", "⚖ " + t("dcf.note")));
    const row = el("div", "dcf-note-r");
    if (x.p) row.appendChild(el("span", "muted dcf-sent", t("dcf.pending")));
    const b = el("button", "link-btn dcf-btn", t(x.p ? "dcf.proposeAgain" : "dcf.propose"));
    b.type = "button";
    b.addEventListener("click", () => this.open(c));
    row.appendChild(b);
    box.appendChild(row);
    return box;
  },
  // Fenêtre « Faire une proposition ».
  async open(c) {
    const x = this.of(c);
    if (!x) { toast(t("dcf.err.gone")); return; }
    let d;
    try { d = await Dict.conflictDetail(x.id); } catch (e) { toast(dcfErrText(e)); return; }
    if (!d || d.st !== "open") { toast(t("dcf.err.done")); return; }
    const senses = arr(d.senses);
    let lg = null;
    try { lg = cardLangs(c); } catch (e) {}
    const shown = lg ? [lg.target].concat(lg.support) : [];
    const mineVals = dcfCardVals(c);
    const both = dcfCombine(senses, mineVals);
    const prev = d.mine || null;
    const wrap = el("div", "dcf-prop");
    wrap.appendChild(el("p", null, t("dcf.intro", { w: d.w || x.w, lang: langName(d.l || x.l) })));
    wrap.appendChild(el("p", "hint", t("dcf.introHint")));
    const opts = el("div", "dcf-opts");
    const name = "dcf" + uid();
    let pick = null;
    const radios = [];
    const opt = (key, title, body, sense) => {
      const lab = el("label", "dcf-opt");
      const r = el("input"); r.type = "radio"; r.name = name; r.value = key;
      r.addEventListener("change", () => { if (r.checked) pick = { key, sense }; });
      radios.push({ r, key, sense });
      const m = el("div", "dcf-opt-m");
      m.appendChild(el("div", "dcf-opt-h", title));
      if (body) m.appendChild(body);
      lab.append(r, m);
      opts.appendChild(lab);
    };
    senses.forEach((s, i) => opt("existing", t("dcf.optExisting", { n: i + 1 }), dictSenseNode(s, shown, d.l || x.l), s.id));
    opt("mine", t("dcf.optMine"), el("div", "dcf-vals", dcfValsLine(mineVals, d.l || x.l)));
    opt("both", t("dcf.optBoth"), el("div", "dcf-vals", dcfValsLine(both, d.l || x.l)));
    wrap.appendChild(opts);
    // Commentaire facultatif (texte seul, 200 caractères, lu par l'admin seulement).
    const ta = el("textarea", "input dcf-ta");
    ta.rows = 3; ta.maxLength = DCF_COMMENT_MAX; ta.placeholder = t("dcf.commentPh"); ta.setAttribute("aria-label", t("dcf.comment"));
    ta.autocomplete = "off";
    const cnt = el("span", "ix-count", "0 / " + DCF_COMMENT_MAX);
    const upd = () => { cnt.textContent = ta.value.length + " / " + DCF_COMMENT_MAX; };
    ta.addEventListener("input", upd);
    const f = el("div", "field");
    f.appendChild(el("label", null, t("dcf.comment")));
    f.append(ta, cnt);
    f.appendChild(el("p", "hint", t("dcf.commentHint")));
    wrap.appendChild(f);
    const err = el("p", "q-err dcf-err"); err.hidden = true;
    wrap.appendChild(err);
    // Proposition déjà envoyée : reprise pour la modifier.
    if (prev) {
      const hit = radios.find(o => o.key === prev.choice && (o.key !== "existing" || o.sense === prev.sense));
      if (hit) { hit.r.checked = true; pick = { key: hit.key, sense: hit.sense }; }
      ta.value = String(prev.comment || "").slice(0, DCF_COMMENT_MAX); upd();
    }
    let busy = false, close = null;
    const send = async () => {
      if (busy) return;
      if (!pick) { err.textContent = t("dcf.err.pick"); err.hidden = false; return; }
      if (ta.value.length > DCF_COMMENT_MAX) { err.textContent = t("dcf.err.long", { n: DCF_COMMENT_MAX }); err.hidden = false; return; }
      busy = true; err.hidden = true;
      try {
        await Dict.conflictPropose(c, x, pick.key, pick.key === "existing" ? pick.sense : null,
          pick.key === "mine" ? mineVals : pick.key === "both" ? both : {}, ta.value.trim());
        if (close) close();
        toast(t("dcf.sent"));
        document.querySelectorAll(".dcf-note").forEach(n => { if (n.dataset.card === c.id) { const nn = this.note(c); if (nn) n.replaceWith(nn); } });
        if (typeof renderScreen === "function" && currentScreen === "lists") renderScreen();
      } catch (e) {
        err.textContent = dcfErrText(e); err.hidden = false;
      }
      busy = false;
    };
    close = openModal(t("dcf.title"), wrap, [
      { label: t("cancel") },
      { label: t("dcf.send"), kind: "primary", onClick: () => { send(); return false; } }
    ]);
  }
};
