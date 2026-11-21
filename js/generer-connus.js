"use strict";

// ====================================================================================================
// js/generer-connus.js — NE PLUS CRÉER DE DOUBLONS À LA GÉNÉRATION (ÉTAPE 76)
// Chargé juste après js/generer.js. Objet GenKnown, constantes GND_*, fonctions gnd*, textes gnd.* (js/i18n/connus-<langue>.js),
// classes .gnd-* (css/app-9.css).
// ====================================================================================================

// === GÉNÉRER : MOTS DÉJÀ CONNUS ET CARTES PROCHES (ÉTAPE 76) ===
// « Générer des cartes », type vocabulaire AVEC une liste de mots (champ « Mots ») — avant tout envoi (accès direct,
// file d'attente « Demander à Claude », « Préparer pour Claude ») :
//   1. chaque mot (langue apprise de la liste) est cherché dans les cartes de l'utilisateur (toutes ses listes), puis dans le
//      dictionnaire commun (dict_search, lecture seule ; sauté sans erreur hors connexion ou sans dictionnaire) ;
//      comparaison sans ponctuation ni majuscule (gndKey ; accents gardés : « a » ≠ « à ») ; chaque forme séparée par « / » compte ;
//   2. mot déjà dans la liste de destination : rien (ni copie ni envoi) ; mot connu ailleurs : la carte est COPIÉE dans la liste
//      (mot, traductions, nature, exemple et ses traductions ; lien au dictionnaire commun), sans passer par Claude ;
//      JAMAIS de carte existante modifiée ; mot manquant (ou carte trouvée inutilisable dans cette liste) : envoyé à Claude ;
//   3. bilan avant l'envoi (« N mots déjà connus (copiés), M envoyés à Claude ») dès qu'au moins un mot est connu ;
//      plus rien à envoyer : aucune demande n'est créée.
// Demandes « compliquées » (vocabulaire sur un thème sans liste de mots, conjugaison, texte à trous, phrase à corriger, règle) :
//   req.near = liste courte des cartes proches déjà présentes dans les AUTRES listes de l'utilisateur ({ k: "n1", id, s }),
//   écrite dans le prompt (genPrompt) et gardée dans payload.req (file d'attente). Claude décide : il génère ce qui manque et,
//   pour une carte proche qui convient, répond « reprendre;n1 » → l'appli copie cette carte dans la liste (GenKnown.reuse,
//   appelé par addGenProposals ; conjugaison : tout le tableau du même verbe et du même temps).
// Aucune donnée de compte nouvelle, aucun champ de carte nouveau (DATA_VERSION 8), aucun SQL (dict_search existe depuis l'étape 36).
const GND_WORDS_PER_CALL = 30;   // vocabulaire avec liste de mots : mots par appel à Claude (= GEN_MAX)
const GND_WORDS_MAX = 300;       // mots au plus par demande
const GND_DICT_N = 100;          // mots par appel à dict_search (limite du serveur)
const GND_NEAR_MAX = 30;         // cartes proches jointes à une demande compliquée
const GND_NEAR_LEN = 90;         // longueur d'une ligne de carte proche dans le prompt
const GND_STOP = new Set(["les", "des", "une", "pour", "avec", "dans", "sur", "aux", "par", "est", "sont", "the", "and", "for",
  "with", "from", "del", "las", "los", "con", "per", "der", "die", "das", "und", "mit", "ein", "eine", "que", "qui", "ses", "son"]);

// Clé de comparaison d'un mot : minuscules, sans ponctuation (règle commune WR_PUNCT_RE de l'étape 73), apostrophes unifiées,
// espaces simplifiés. Accents gardés.
function gndKey(s) {
  const x = String(s == null ? "" : s).normalize("NFC").replace(/[’‘ʼ´`]/g, "'").toLowerCase().replace(/\s+/g, " ").trim();
  if (!x) return "";
  return typeof wrNoPunct === "function" ? wrNoPunct(x, false) : x;
}
// Formes d'un mot de carte (« voler / dérober » → 2 clés).
function gndAlts(s) { return String(s == null ? "" : s).split("/").map(gndKey).filter(Boolean); }
// Liste de mots saisie (une par ligne, ou séparés par « , » / « ; ») → mots uniques (premier gardé), dans l'ordre.
function gndWords(text) {
  const seen = new Set(), out = [];
  String(text || "").split(/[\n,;，、]+/).map(x => x.replace(/\s+/g, " ").trim()).filter(Boolean).forEach(w => {
    const k = gndKey(w);
    if (!k || seen.has(k)) return;
    seen.add(k); out.push(w);
  });
  return out;
}
// Le mot (clé k) est-il une forme du mot de la carte dans la langue L ?
function gndHas(c, L, k) { return isVocab(c) && gndAlts(term(c, L)).includes(k); }
function gndShort(s) { return String(s || "").replace(/[;|\n]+/g, " ").replace(/\s+/g, " ").trim().slice(0, GND_NEAR_LEN); }

const GenKnown = (() => {
  // --- Cartes construites (jamais une carte existante modifiée) ---
  // Copie d'une carte de vocabulaire de l'utilisateur : mots, natures, exemples, lien au dictionnaire commun et marques
  // d'origine (c.auto, étape 73) ; sans image, tags ni progression.
  function fromCard(src, listId, lg) {
    const m = exMap(src);
    let ex = m && Object.keys(m).length ? JSON.parse(JSON.stringify(m)) : null;
    if (!ex && src.example) ex = { [lg.target]: { text: String(src.example), tr: {} } };
    const c = newCard(listId, Object.assign({}, src.terms), ex, [], Object.assign({}, src.pos), lg.target);
    if (src.senseId) { c.senseId = src.senseId; if (arr(src.own).length) c.own = arr(src.own).slice(); }
    c.auto = arr(src.auto).slice();
    return c;
  }
  // Carte faite depuis un sens du dictionnaire commun ({ id, vals: { L: { w, p, e, t } } }) : toutes ses cases, reliée au sens.
  function fromSense(s, listId, lg) {
    const v = (s && s.vals) || {}, terms = {}, pos = {}, ex = {};
    Object.keys(v).forEach(L => {
      const x = v[L];
      if (!isLang(L) || !x || typeof x !== "object") return;
      if (x.w) terms[L] = dictClean(x.w);
      if (x.p && POS_CODES.includes(dictClean(x.p))) pos[L] = dictClean(x.p);
      const tr = {};
      if (x.t && typeof x.t === "object") Object.keys(x.t).forEach(C => { if (isLang(C) && x.t[C]) tr[C] = dictClean(x.t[C]); });
      if (x.e || Object.keys(tr).length) ex[L] = { text: dictClean(x.e || ""), tr };
    });
    const c = newCard(listId, terms, ex, [], pos, lg.target);
    if (typeof s.id === "string" && /^[0-9a-f-]{36}$/i.test(s.id)) c.senseId = s.id;
    return c;
  }
  // Meilleure carte de l'utilisateur pour ce mot : même langue apprise d'abord, puis la plus complète ; seulement si elle
  // est utilisable dans la liste de destination (mot + au moins une traduction affichée).
  function bestLocal(k, L, lg, dest) {
    const cands = state.cards.filter(c => c.listId !== dest && getList(c.listId) && gndHas(c, L, k));
    const score = c => {
      let s = 0;
      try { if (listLangs(c.listId).target === L) s += 100; } catch (e) {}
      s += lg.support.filter(x => term(c, x).trim()).length * 10;
      if (exText(c, L)) s += 3;
      if (c.senseId) s += 1;
      return s;
    };
    const sorted = cands.map(c => ({ c, s: score(c) })).sort((a, b) => b.s - a.s);
    for (const x of sorted) if (cardUsable(fromCard(x.c, "", lg), lg)) return x.c;
    return null;
  }
  // Recherche dans le dictionnaire commun (lecture seule). → Map clé → sens, ou null si sautée (hors connexion, pas de
  // dictionnaire, erreur) : jamais d'erreur visible.
  async function dictLookup(items, L, lg) {
    const out = new Map();
    if (!items.length) return out;
    if (typeof Dict === "undefined" || !Dict.on() || navigator.onLine === false || !Supa.client()) return null;
    try {
      for (let i = 0; i < items.length; i += GND_DICT_N) {
        const part = items.slice(i, i + GND_DICT_N);
        const r = await withTimeout(Supa.client().rpc("dict_search", { p_lang: L, p_words: part.map(x => dictClean(x.w)), p_limit: 6 }), 15000);
        if (r && r.error) throw r.error;
        arr(r && r.data).forEach(row => {
          const x = part[Number(row && row.i) - 1];
          if (!x || out.has(x.k)) return;
          // Le serveur compare sans accents : on garde seulement un sens dont le mot est le même (accents compris).
          const s = arr(row.senses).find(s => s && s.vals && s.vals[L] && gndAlts(s.vals[L].w).includes(x.k) && cardUsable(fromSense(s, "", lg), lg));
          if (s) out.set(x.k, s);
        });
      }
    } catch (e) { return null; }
    return out;
  }
  // → { inList: [mot], copy: [{ w, k, src | sense }], send: [mot], dictSkipped }
  async function lookup(req) {
    const L = req.lang, lg = req.lg;
    const dest = req.listId !== "__new__" && getList(req.listId) ? req.listId : (req.createdId && getList(req.createdId) ? req.createdId : null);
    const destCards = dest ? cardsOf(dest) : [];
    const r = { inList: [], copy: [], send: [], dictSkipped: false };
    const rest = [];
    arr(req.words).forEach(w => {
      const k = gndKey(w);
      if (!k) return;
      if (destCards.some(c => gndHas(c, L, k))) { r.inList.push(w); return; }
      const src = bestLocal(k, L, lg, dest);
      if (src) r.copy.push({ w, k, src });
      else rest.push({ w, k });
    });
    const found = await dictLookup(rest, L, lg);
    if (!found) r.dictSkipped = rest.length > 0 && typeof Dict !== "undefined" && Dict.usable();
    rest.forEach(x => {
      const s = found && found.get(x.k);
      if (s) r.copy.push({ w: x.w, k: x.k, sense: s });
      else r.send.push(x.w);
    });
    return r;
  }
  // Copie les cartes connues dans la liste (créée si c'est une nouvelle liste). → nombre de cartes copiées.
  function apply(r, req) {
    if (!r.copy.length) return 0;
    const listId = genListId(req);
    if (!canEditList(listId)) { toast(t("sh.readOnly")); return 0; }
    const lg = listLangs(listId);
    const have = new Set(cardsOf(listId).filter(isVocab).map(c => dupKey(c.terms, lg)));
    const fresh = [];
    r.copy.forEach(x => {
      const c = x.src ? fromCard(x.src, listId, lg) : fromSense(x.sense, listId, lg);
      const k = dupKey(c.terms, lg);
      if (have.has(k) || !cardUsable(c, lg)) return;
      have.add(k);
      fresh.push(c);
    });
    if (!fresh.length) return 0;
    state.cards.push(...fresh);
    fresh.forEach(c => { try { state.checkedSig[c.id] = cardSig(c); } catch (e) {} });
    commit();
    Dict.afterAdd(fresh.map(c => c.id));       // cartes reliées : valeurs du commun relues ; les autres reliées comme un ajout
    return fresh.length;
  }
  // Bilan avant l'envoi. ok() = copier puis envoyer le reste (ou rien).
  function bilan(r, req, ok) {
    const wrap = el("div", "gnd");
    const n = r.copy.length, m = r.send.length, d = r.inList.length;
    const line = [n === 1 ? t("gnd.known1") : t("gnd.known", { n }), m === 0 ? t("gnd.send0") : m === 1 ? t("gnd.send1") : t("gnd.send", { n: m })];
    wrap.appendChild(el("p", "gnd-sum", line.join(", ") + "."));
    if (d) wrap.appendChild(el("p", "muted", (d === 1 ? t("gnd.inList1") : t("gnd.inList", { n: d })) + " : " + r.inList.join(", ")));
    if (n) {
      const ul = el("ul", "gnd-list");
      r.copy.slice(0, 40).forEach(x => {
        const li = el("li");
        const w = el("b", null, x.w); w.lang = req.lang;
        li.append(w, document.createTextNode(" — " + (x.src ? t("gnd.fromList", { l: listLabel(getList(x.src.listId)) }) : t("gnd.fromDict"))));
        ul.appendChild(li);
      });
      if (n > 40) ul.appendChild(el("li", "muted", "…"));
      wrap.appendChild(ul);
    }
    if (m) wrap.appendChild(el("p", "muted", t("gnd.toClaude") + " " + r.send.join(", ")));
    if (r.dictSkipped) wrap.appendChild(el("p", "hint", t("gnd.noDict")));
    openModal(t("gnd.title"), wrap, [
      { label: t("cancel") },
      { label: m ? (n ? t("gnd.goBoth") : t("gnd.goSend")) : t("gnd.goCopy"), kind: "primary", onClick: () => { ok(); } }
    ]);
  }
  function doneCopy(copied, req) {
    const listId = genListId(req);
    const wrap = el("p", null, copied ? (copied === 1 ? t("gnd.done1", { l: listLabel(getList(listId)) }) : t("gnd.done", { n: copied, l: listLabel(getList(listId)) })) : t("gnd.nothing"));
    const acts = [{ label: t("close") }];
    if (copied) acts.push({ label: t("gnd.seeList"), kind: "primary", onClick: () => { goPendingFor({ kind: "list", id: listId }); } });
    openModal(t("gen.title"), wrap, acts);
  }

  // Point d'entrée : avant runGenerate / queueSubmitGenerate / openGenPrepare. next(req) = l'envoi habituel.
  async function before(req, next) {
    if (req.type !== "vocab" || !arr(req.words).length) {   // demande compliquée : cartes proches jointes, Claude décide
      req.near = near(req);
      next(req);
      return;
    }
    req.near = [];
    const pg = openProgress(t("gen.title"), t("gnd.searching"), []);
    let r;
    try { r = await lookup(req); } catch (e) { r = { inList: [], copy: [], send: arr(req.words).slice(), dictSkipped: false }; }
    finally { pg.close(); }
    if (!r.copy.length && !r.inList.length) { next(req); return; }   // rien de connu : envoi direct, comme avant
    bilan(r, req, () => {
      const copied = apply(r, req);
      if (!r.send.length) { doneCopy(copied, req); return; }        // plus rien à envoyer : aucune demande
      if (copied) toast(copied === 1 ? t("gnd.done1", { l: listLabel(getList(genListId(req))) }) : t("gnd.done", { n: copied, l: listLabel(getList(genListId(req))) }));
      req.words = r.send.slice();
      req.count = req.words.length;
      next(req);
    });
  }

  // --- Demandes compliquées : cartes proches (autres listes de l'utilisateur, même type, même langue) ---
  function keysOf(req) {
    if (req.type === "conj") return arr(req.verbs).map(gndKey).filter(Boolean);
    return gndKey(req.topic).split(" ").filter(w => !GND_STOP.has(w) && (w.length >= 3 || /[^\u0000-ɏ]/.test(w)));
  }
  function near(req) {
    const keys = keysOf(req);
    if (!keys.length) return [];
    const L = req.lang;
    const dest = req.listId !== "__new__" ? req.listId : null;
    const type = req.type;
    const seen = new Set(), out = [];
    const cands = [];
    state.cards.forEach(c => {
      if (c.listId === dest || !getList(c.listId) || cardType(c) !== type) return;
      if (type === "vocab" ? !term(c, L).trim() : c.lang !== L) return;
      let score = 0;
      if (type === "conj") score = keys.includes(gndKey(c.verb)) ? 2 : 0;
      else {
        let txt = "";
        try { txt = gndKey(cardSearchText(c) + " " + arr(c.tags).join(" ") + " " + (getList(c.listId).name || "")); } catch (e) { return; }
        score = keys.filter(k => txt.includes(k)).length;
      }
      if (score > 0) cands.push({ c, score });
    });
    cands.sort((a, b) => b.score - a.score);
    for (const x of cands) {
      const c = x.c;
      let s;
      if (type === "vocab") s = term(c, L) + " = " + req.lg.support.map(code => term(c, code)).filter(Boolean).join(" / ");
      else if (type === "conj") s = c.verb + " — " + tenseName(L, c.tense);
      else s = cardTitle(c);
      s = gndShort(s);
      const key = type + "|" + gndKey(s);
      if (!s || seen.has(key)) continue;
      seen.add(key);
      out.push({ k: "n" + (out.length + 1), id: c.id, s });
      if (out.length >= GND_NEAR_MAX) break;
    }
    return out;
  }
  // Lignes ajoutées au prompt (consignes en français, comme le reste du prompt).
  function nearLines(req) {
    const nr = arr(req.near);
    if (!nr.length) return [];
    return ["Cartes proches que l'apprenant a déjà dans d'autres listes (référence = nX) :"]
      .concat(nr.map(x => x.k + " = " + x.s), [
        "Si l'une de ces cartes convient pour cette demande, ne la refais pas : écris à la place une ligne « reprendre;nX » (elle sera copiée telle quelle dans la liste). Ces lignes comptent dans le nombre de cartes demandé. Ne génère que ce qui manque."
      ]);
  }
  // Lignes « reprendre;nX » reçues → copie des cartes proches dans la liste. → nombre de cartes copiées.
  function reuse(drafts, req) {
    const nr = arr(req.near);
    if (!nr.length || !drafts.length) return 0;
    const listId = genListId(req);
    if (!canEditList(listId)) return 0;
    const lg = listLangs(listId);
    const have = new Set(cardsOf(listId).map(c => isVocab(c) ? "vocab|" + dupKey(c.terms, lg) : typedKey(c.type, c)));
    const fresh = [];
    const add = c => {
      const k = isVocab(c) ? "vocab|" + dupKey(c.terms, lg) : typedKey(c.type, c);
      if (have.has(k) || !cardUsable(c, lg)) return;
      have.add(k); fresh.push(c);
    };
    const refs = new Set(drafts.map(d => String(d.ref || "").trim().toLowerCase()));
    nr.filter(x => refs.has(String(x.k).toLowerCase())).forEach(x => {
      const src = state.cards.find(c => c.id === x.id);
      if (!src || !getList(src.listId)) return;
      if (isVocab(src)) { add(fromCard(src, listId, lg)); return; }
      const group = cardType(src) === "conj"
        ? state.cards.filter(c => c.listId === src.listId && cardType(c) === "conj" && c.lang === src.lang && normText(c.verb) === normText(src.verb) && c.tense === src.tense)
        : [src];
      group.forEach(g => add(newTypedCard(listId, cardType(g), Object.assign({}, normTypedFields(cardType(g), g), { ruleId: "" }))));
    });
    if (!fresh.length) return 0;
    state.cards.push(...fresh);
    fresh.forEach(c => { if (isVocab(c)) { try { state.checkedSig[c.id] = cardSig(c); } catch (e) {} pvNewIds.push(c.id); } });
    return fresh.length;
  }
  // Morceaux d'une demande : conjugaison = verbes par 5 ; vocabulaire avec mots = mots par 30 ; sinon un seul.
  function parts(req) {
    if (req.type === "conj") return chunks(arr(req.verbs), GEN_VERBS_PER_CALL);
    if (req.type === "vocab" && arr(req.words).length) return chunks(arr(req.words), GND_WORDS_PER_CALL);
    return [null];
  }
  return { before, lookup, apply, near, nearLines, reuse, parts };
})();
