"use strict";

// ====================================================================================================
// js/conjugaison.js — CONSIGNES DE CONJUGAISON CLAIRES (ÉTAPE 83)
// Chargé juste après js/claude-nouveau.js. Au chargement : déclarations et deux écouteurs (online, visibilitychange).
// ====================================================================================================

// === CONSIGNES DE CONJUGAISON CLAIRES (ÉTAPE 83) ===
// 1. Affichage (révision Cartes / Écrit / Interrogateur / Mix, mode Tableau, listes) — rien n'est écrit dans les cartes :
//    - carte « conj » : consigne « Conjugue **be** avec **you** — présent simple » (verbe à l'infinitif SANS « to », en gras,
//      pronom à part, temps toujours affiché). Personne sans pronom (coréen : niveau de politesse ; forme unique) :
//      « Conjugue **먹다** — **해요체 (poli)** — passé » ; verbes irréguliers anglais : « Donne la forme « prétérit » de **go** ».
//    - carte « cloze » (phrase à trous) : verbe à conjuguer entre parenthèses après le trou : « She ___ (go) to school. »
//      Si la phrase n'a pas déjà « (…) » après le trou, le verbe est pris dans l'indice quand il y est clairement
//      (« to go », « verbe aller », « verb: go », « 동사 가다 ») ; la réponse affiche la phrase complète sans les parenthèses.
// 2. Anciennes cartes floues (fuzzy) : verbe absent, plusieurs verbes, complément (« to be something »), verbe + objet ;
//    phrase à trous de conjugaison (indice ou explication qui parlent de verbe / temps) sans le verbe à conjuguer.
//    Elles sont envoyées à Claude par la file d'attente EXISTANTE (demande « verify », payload.cjq = 1, payload.auto = 1,
//    libellé « 🤖 ⇄ … »). Les corrections arrivent dans « À valider » (propositions « Correction » sur f:verb, f:sentence,
//    f:hint) : l'utilisateur décide toujours. Aucun nouveau SQL : mêmes tables, même tâche programmée.
//    Conditions : mode Supabase, mise à jour automatique active (AutoMaj.active, réglage de l'admin de l'étape 80),
//    plafond du jour de l'étape 80 (AutoMaj.dayCount : la demande « verify » compte dans le total du jour).
//    Une carte n'est demandée qu'une fois par contenu, et 2 fois au plus en tout (CJQ_TRIES) : pas de boucle.
//    Sur l'appareil seulement, jamais dans les données du compte : vocabfr.cjq:<compte> = { a: { idCarte: [envois, empreinte] } }.
const CJQ_TRIES = 2;                      // envois max par carte (tous contenus confondus)
const CJQ_MAX = 60;                       // cartes max par demande
const CJQ_BOOT_MS = 30000;                // premier passage après le lancement (après la mise à jour automatique)
const CJQ_MARK = "🤖 ⇄";                  // début du libellé d'une demande de correction (Demandes en cours, deux appareils)
const CJQ_FIELDS = { conj: ["f:verb"], cloze: ["f:sentence", "f:hint"] };
// Mots qui montrent un complément ou une phrase au lieu d'un verbe seul (« to be something », « faire qqch »…).
const CJQ_PLACE = /(^|[\s'’(])(something|someone|somebody|sth|smth|sb|smb|qqch|qqc|qqn|qn|quelque\s+chose|quelqu['’]un)(?=$|[\s.,;)])|\.\.\.|…|무엇|뭔가|누군가|어떤\s*것/i;
// Plusieurs verbes dans le champ « verbe ».
const CJQ_MANY = /[\/,;|+&]|\s(ou|or|and|et)\s|또는|그리고/i;
// Particules des verbes à particule anglais (« get up », « look for ») : un verbe seul, pas un complément.
const CJQ_EN_PART = ["up", "down", "out", "off", "on", "in", "away", "back", "over", "for", "after", "at", "into", "around", "about", "through", "along", "by", "with", "from", "forward", "apart"];
// Mots qui montrent qu'une phrase à trous porte sur un verbe à conjuguer (indice, explication).
const CJQ_VERB_HINT = /\b(verb|verbe|verbs|verbes|conjug\w*|tense|tenses)\b|동사|활용|시제/i;
// Mots d'un indice qui ne sont pas un verbe (« verbe irrégulier », « verb tense »…).
const CJQ_NOT_VERB = /^(r[ée]gulier|irr[ée]gulier|pronominal|auxiliaire|conjugu[ée]e?s?|regular|irregular|tense|form|forme|phrasal|modal|past|present|future|participle|infinitive|infinitif|base|au|à|en|du|de|des|불규칙|규칙)$/i;
// Trou déjà suivi du verbe entre parenthèses : « ___ (go) ».
const CJQ_GAP_PAREN = /_{2,}\s*\(([^()]{1,40})\)/;

const ConjQ = (() => {
  let timer = null, runP = null, last = "";

  // --- Verbe et personne ---
  // Infinitif affiché : sans « to » en anglais, espaces nettoyés.
  function verbOf(c) {
    let v = String((c && c.verb) || "").replace(/\s+/g, " ").trim();
    if (c && c.lang === "en") v = v.replace(/^to\s+/i, "");
    return v;
  }
  function tenseObj(c) { return tenseOf(c.lang, c.tense); }
  // "with" (pronom sujet), "irr" (verbes irréguliers anglais : base / prétérit / participe), "form" (niveau de politesse, forme).
  function kindOf(c) {
    const p = conjPerson(c), tn = tenseObj(c);
    if (p && p.pronoun) return "with";
    if (tn && tn.persons === "irregular") return "irr";
    return "form";
  }
  function personText(c, kind) {
    const p = conjPerson(c);
    if (!p) return String(c.person || "");
    return kind === "form" ? personLabel(c.lang, c.tense, c.person) : locText(p.label);
  }
  // Parties de la consigne : [{ text, bold, lng }] (texte de l'interface, verbe et personne dans la langue apprise).
  function parts(c) {
    const kind = kindOf(c);
    const tpl = t(kind === "with" ? "cjq.q" : kind === "irr" ? "cjq.qIrr" : "cjq.qForm");
    const vals = { v: verbOf(c) || "…", p: personText(c, kind) };
    const out = [];
    tpl.split(/(\{[vp]\})/).forEach(s => {
      if (!s) return;
      const m = /^\{([vp])\}$/.exec(s);
      out.push(m ? { text: vals[m[1]], bold: true, lng: c.lang, k: m[1] } : { text: s });
    });
    const tn = tenseName(c.lang, c.tense);
    if (tn) out.push({ text: t("cjq.tense", { t: tn }), tense: true });
    return out;
  }
  function text(c) { return parts(c).map(x => x.text).join(""); }
  // Nœud de la consigne (classe cls = sw-main, qz-main…), construit sans innerHTML.
  function node(cls, c) {
    const d = el("div", (cls || "") + " cjq");
    parts(c).forEach(x => {
      const n = x.bold ? el("b", "cjq-" + x.k, x.text) : el("span", x.tense ? "cjq-tn" : null, x.text);
      if (x.lng) n.lang = x.lng;
      d.appendChild(n);
    });
    return d;
  }
  // Mode Tableau : « Conjugue be à chaque personne — présent simple ».
  function tableText(c) {
    const persons = personsOf(c.lang, c.tense);
    const key = persons.some(p => p.pronoun) ? "cjq.table" : "cjq.tableForm";
    return t(key, { v: verbOf(c) || "…" }) + t("cjq.tense", { t: tenseName(c.lang, c.tense) });
  }

  // --- Phrases à trous ---
  // Verbe clairement écrit dans l'indice : « to go », « verbe aller », « verb: go », « 동사 가다 », « 가다 (동사) ».
  function hintVerb(c) {
    const h = String((c && c.hint) || "").replace(/\s+/g, " ").trim();
    if (!h || h.length > 40) return "";
    let v = "";
    let m = /^(?:le\s+)?(?:verbe|verb|동사)\s*[:：]?\s*(?:«\s*)?([^\s«»"“”:+()]+(?:\s[^\s«»"“”:+()]+)?)(?:\s*»)?$/i.exec(h);
    if (m) v = m[1].replace(/^to\s+/i, "");
    else if ((m = /^([^\s()]+(?:\s[^\s()]+)?)\s*\((?:verbe|verb|동사)\)$/i.exec(h))) v = m[1];
    else if (c.lang === "en" && (m = /^to\s+([a-z][a-z'-]*)$/i.exec(h))) v = m[1];
    return v && verbLike(c.lang, v) ? v : "";
  }
  // Indice « verbe, temps » (« go, présent simple ») : le verbe ; l'indice reste affiché (il donne le temps).
  function hintVerbTense(c) {
    const h = String((c && c.hint) || "").replace(/\s+/g, " ").trim();
    const m = /^(?:to\s+)?([^\s,;:()]+(?:\s[^\s,;:()]+)?)\s*[,;:–—]\s*(.+)$/i.exec(h);
    if (!m || h.length > 60 || !verbLike(c.lang, m[1])) return "";
    const rest = normText(m[2]);
    return [...tenseNames(c.lang)].some(n => rest.includes(n)) ? m[1] : "";
  }
  // Noms des temps de la langue (toutes les langues de l'interface), sans accents ni parenthèses.
  function tenseNames(lng) {
    const names = new Set();
    tensesOf(lng).forEach(x => Object.values(x.names || {}).forEach(n => { const k = normText(String(n).replace(/\([^)]*\)/g, "")); if (k.length > 3 || (k.length > 1 && /[^\x00-\x7f]/.test(k))) names.add(k); }));
    return names;
  }
  // Mot qui peut être un infinitif (et pas « verbe irrégulier », « verb tense »…).
  function verbLike(lng, v) {
    const w = v.split(" "), last = w[w.length - 1];
    if (CJQ_NOT_VERB.test(last) || CJQ_NOT_VERB.test(w[0])) return false;
    if (lng === "fr") return /(er|ir|re)$/i.test(last);
    if (lng === "ko") return /다$/.test(last);
    return true;
  }
  // { q: phrase de la question (verbe entre parenthèses après le trou), a: phrase sans les parenthèses (à remplir),
  //   verb: verbe trouvé (ou ""), fromHint: le verbe vient de l'indice (indice alors pas répété) }
  function cloze(c) {
    const s = String((c && c.sentence) || "");
    const has = CJQ_GAP_PAREN.exec(s);
    if (has) return { q: s, a: s.replace(/(_{2,})\s*\([^()]{1,40}\)/g, "$1"), verb: has[1].trim(), fromHint: false };
    const v = hintVerb(c), v2 = v ? "" : hintVerbTense(c);
    if ((v || v2) && CLOZE_GAP.test(s)) return { q: s.replace(CLOZE_GAP, m => m + " (" + (v || v2) + ")"), a: s, verb: v || v2, fromHint: !!v };
    return { q: s, a: s, verb: "", fromHint: false };
  }
  function clozeCard(c, sentence) { return { sentence, lang: c.lang }; }

  // --- Cartes floues ---
  // Raison ("" = carte claire) : noVerb, many, obj, phrase (conj) ; noVerb (phrase à trous de conjugaison sans verbe).
  function fuzzy(c) {
    if (!c || !isLang(c.lang)) return "";
    if (c.type === "conj") {
      if (!hasGrammar(c.lang) || !splitAlts(c.answer).length) return "";      // rien pour deviner le verbe
      const raw = String(c.verb || "").trim(), v = verbOf(c);
      if (!v) return "noVerb";
      if (CJQ_PLACE.test(raw)) return "obj";
      if (CJQ_MANY.test(v)) return "many";
      let w = v.split(" ");
      if (c.lang === "fr") { if (/^(se|s['’])$/i.test(w[0]) && w.length > 1) w = w.slice(1); else if (/^s['’]/i.test(w[0])) w[0] = w[0].slice(2); return w.length > 1 ? "phrase" : ""; }
      if (c.lang === "en") return w.length > 1 && !w.slice(1).every(x => CJQ_EN_PART.includes(x.toLowerCase())) || w.length > 3 ? "phrase" : "";
      return w.length > 2 ? "phrase" : "";
    }
    if (c.type === "cloze") {
      const s = String(c.sentence || "");
      if (!CLOZE_GAP.test(s) || CJQ_GAP_PAREN.test(s) || hintVerb(c) || hintVerbTense(c)) return "";
      const info = [c.hint, c.explanation].filter(Boolean).join(" ");
      if (!info) return "";
      const names = tenseNames(c.lang), low = normText(info);
      return CJQ_VERB_HINT.test(info) || [...names].some(n => low.includes(n)) ? "noVerb" : "";
    }
    return "";
  }

  // --- État de l'appareil ---
  function key() { return CONFIG.LS_USER_PREFIX + "cjq:" + (Storage.getUser() || ""); }
  function load() {
    try { const o = JSON.parse(localStorage.getItem(key()) || "null"); if (o && o.a && typeof o.a === "object" && !Array.isArray(o.a)) return o; } catch (e) {}
    return { a: {} };
  }
  function save(s) { try { localStorage.setItem(key(), JSON.stringify(s)); } catch (e) {} }
  function sig(c) { return strHash([c.verb, c.sentence, c.hint, c.answer].map(x => String(x || "")).join("\u0001")); }
  function asked(s, c) { const x = s.a[c.id]; return Array.isArray(x) && (x[1] === sig(c) || num(Number(x[0]), 0) >= CJQ_TRIES); }
  function pendingOn(c) { const fs = CJQ_FIELDS[c.type] || []; return state.proposals.some(p => p.cardId === c.id && fs.includes(p.field)); }
  function eligible(s) {
    s = s || load();
    return state.cards.filter(c => (c.type === "conj" || c.type === "cloze") && fuzzy(c) && canEditList(c.listId) && !pendingOn(c) && !asked(s, c));
  }

  // --- Demande à Claude (file d'attente existante, type « verify ») ---
  function items(batch) {
    return batch.map((c, i) => {
      const o = { id: "k" + i, type: c.type, lang: c.lang };
      if (c.type === "conj") {
        const p = conjPerson(c), tn = tenseObj(c);
        Object.assign(o, { verb: c.verb || "", tense: tn ? tn.names.fr : c.tense, person: p ? locText(p.label, "fr") : c.person, answer: c.answer });
        if (c.translation) o.translation = c.translation;
      } else {
        Object.assign(o, { sentence: c.sentence, answer: c.answer });
        if (c.hint) o.hint = c.hint;
        if (c.explanation) o.explanation = c.explanation;
      }
      return o;
    });
  }
  function prompt(batch) {
    const codes = LANG_CODES.filter(x => batch.some(c => c.lang === x)), ui = uiLangNameFr();
    return [
      "CONJUGAISON — correction de consignes floues (étape 83). Tu corriges des cartes de conjugaison d'apprenants en langues. Codes de langue : " + langLegend(codes) + ".",
      "Chaque carte a une consigne peu claire. Rends-la claire en changeant SEULEMENT ces champs :",
      "- type conj (une forme conjuguée par carte : verb, tense, person, answer) : field \"f:verb\" = UN seul verbe à l'infinitif, sans « to » en anglais (« be », pas « to be »), sans complément (jamais « something », « qqch »), sans pronom. Déduis-le de answer (forme attendue) et de translation. Ne change jamais tense, person ni answer.",
      "- type cloze (phrase à trous : sentence avec « ___ », answer) : si le trou est un verbe à conjuguer, field \"f:sentence\" = la MÊME phrase avec le verbe à l'infinitif entre parenthèses juste après le trou, ex. « She ___ (go) to school every day. » ; un seul verbe par trou ; garde « ___ » et tout le reste de la phrase tel quel. Si le temps à employer n'est pas clair, field \"f:hint\" = le nom du temps en " + ui + " (ex. « présent simple »). Si le trou n'est pas un verbe : rien.",
      "- Rien d'autre (pas de style, pas d'autre champ). Pas sûr : rien pour cette carte.",
      "Pour chaque correction : id, field, value (valeur COMPLÈTE du champ), reason très courte en " + ui + ".",
      "Réponds uniquement avec un tableau JSON, vide [] si rien à corriger.",
      "Exemple : [{\"id\":\"k0\",\"field\":\"f:verb\",\"value\":\"be\",\"reason\":\"verbe seul, sans « to »\"},{\"id\":\"k1\",\"field\":\"f:sentence\",\"value\":\"She ___ (go) to school every day.\",\"reason\":\"verbe à conjuguer indiqué\"}]",
      "",
      "Cartes :",
      JSON.stringify(items(batch))
    ].join("\n");
  }
  function rows(cards) {
    const lists = [...new Set(cards.map(c => c.listId))];
    const base = CJQ_MARK + " " + t("cjq.label") + " · " + (lists.length === 1 ? listLabel(getList(lists[0])) : t("queue.nLists", { n: lists.length }));
    const batches = chunks(cards, CONFIG.AI_BATCH).map(b => ({ prompt: prompt(b), ids: b.map(c => c.id), sigs: b.map(sig) }));
    return [{
      kind: "verify", label: base.slice(0, 300), card_count: cards.length, batch_count: batches.length,
      payload: { v: 1, app: "vocab", kind: "verify", uiLang: state.settings.uiLang, created: new Date().toISOString(), auto: 1, cjq: 1,
        answer: "json-array: [{\"id\":\"k0\",\"field\":\"f:verb|f:sentence|f:hint\",\"value\":\"…\",\"reason\":\"…\"}]", batches }
    }];
  }
  function usable() { return typeof Queue !== "undefined" && Queue.usable() && typeof AutoMaj !== "undefined"; }
  function busy() {
    try {
      if (typeof rv !== "undefined" && rv && rv.phase === "run" && currentScreen === "review") return true;
      if (typeof pvJob !== "undefined" && pvJob) return true;
      if (typeof aiJob !== "undefined" && aiJob) return true;
      if (typeof Guard !== "undefined" && Guard.waiting && Guard.waiting()) return true;
    } catch (e) {}
    return false;
  }
  // Un passage. Renvoie "off" | "offline" | "busy" | "other" | "none" | "limit" | "net" | "error" | "sent".
  async function runOnce() {
    if (!usable()) return "off";
    const u = Storage.getUser(), gone = () => Storage.getUser() !== u || !usable();
    if (navigator.onLine === false) return "offline";
    if (busy()) { kick(60000); return "busy"; }
    await AutoMaj.fetch();
    if (gone() || !AutoMaj.active()) return "off";
    let cards = eligible();
    if (!cards.length) return "none";
    if (!Queue.loaded()) await Queue.refresh();
    if (gone()) return "off";
    if (Queue.items().some(r => ["pending", "processing"].includes(r.status) && String(r.label || "").startsWith(CJQ_MARK))) return "other";
    let used;
    try { used = await AutoMaj.dayCount(); } catch (e) { return "net"; }
    if (gone()) return "off";
    const cfg = AutoMaj.settings(), left = (cfg ? cfg.max : AMJ_DEF.max) - used;
    if (left <= 0) return "limit";
    cards = eligible().slice(0, Math.min(left, CJQ_MAX));
    if (!cards.length) return "none";
    const r = await Queue.submit(rows(cards));
    if (gone()) return "off";
    if (r && r.error) return r.error === "net" ? "net" : "error";
    const s = load();
    cards.forEach(c => { const x = s.a[c.id]; s.a[c.id] = [(Array.isArray(x) ? num(Number(x[0]), 0) : 0) + 1, sig(c)]; });
    const live = new Set(state.cards.map(c => c.id));
    Object.keys(s.a).forEach(id => { if (!live.has(id)) delete s.a[id]; });   // cartes supprimées : oubliées
    save(s);
    Activity.log("claude_request", { type: "verify", cards: cards.length, requests: 1, auto: true, conj: true });
    Queue.sync();
    return "sent";
  }
  function run() {
    if (runP) return runP;
    runP = runOnce().catch(() => "error").then(r => { runP = null; last = r; return r; });
    return runP;
  }
  function kick(ms) {
    if (!usable()) return;
    clearTimeout(timer);
    timer = setTimeout(() => { timer = null; run(); }, ms != null ? ms : CJQ_BOOT_MS);
  }
  function start() { reset(); kick(CJQ_BOOT_MS); }
  function reset() { clearTimeout(timer); timer = null; last = ""; }

  // --- Réponse (queueApply, demande « verify » avec payload.cjq) : propositions « Correction » dans « À valider » ---
  // Valeur gardée seulement si elle rend la carte claire : verbe seul ; même phrase avec « (verbe) » après le trou.
  function valueOk(c, f, v) {
    if (f === "f:verb") { const x = Object.assign({}, c, { verb: v }); return !!verbOf(x) && !fuzzy(x); }
    if (f === "f:sentence") {
      if (!CJQ_GAP_PAREN.test(v)) return false;
      const strip = s => normText(String(s).replace(/(_{2,})\s*\([^()]{1,40}\)/g, "$1").replace(/_{2,}/g, "___")).replace(/\s+/g, " ");
      return strip(v) === strip(c.sentence);
    }
    return f === "f:hint" && v.length <= 80;
  }
  function apply(batch, res) {
    let n = 0;
    arr(res).forEach(item => {
      if (!item || typeof item !== "object") return;
      const m = /^k(\d+)$/.exec(String(item.id || ""));
      const c = m && batch[+m[1]];
      if (!c || !state.cards.includes(c) || !canEditList(c.listId)) return;
      const f = String(item.field || "");
      if (!(CJQ_FIELDS[c.type] || []).includes(f) || typeof item.value !== "string") return;
      let v = item.value.replace(/\s+/g, " ").trim();
      if (f === "f:verb" && c.lang === "en") v = v.replace(/^to\s+/i, "");
      const cur = fieldVal(c, f);
      if (!v || v === cur.trim() || !valueOk(c, f, v)) return;
      if (state.rejected.includes(rejectKey(c.id, f, v))) return;
      if (state.proposals.some(p => p.cardId === c.id && p.field === f)) return;
      state.proposals.push({ id: uid(), cardId: c.id, field: f, type: "correction", oldValue: cur, newValue: v,
        reason: String(typeof item.reason === "string" ? item.reason : "").slice(0, 300), createdAt: Date.now() });
      n++;
    });
    return n;
  }

  window.addEventListener("online", () => { if (last === "offline" || last === "net") kick(5000); });
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && (last === "offline" || last === "net" || last === "busy")) kick(5000); });

  return {
    verbOf, kindOf, parts, text, node, tableText, hintVerb, cloze, clozeCard, fuzzy, eligible, prompt, rows, apply,
    start, reset, kick, run, last: () => last
  };
})();
