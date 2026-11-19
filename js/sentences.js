"use strict";

// === MA PHRASE (étape 58) ===
// Mode Supabase seulement (script claude/supabase-etape58.sql). Textes : js/i18n/sentence-<langue>.js (clés sn.*).
//
// Déroulé :
//  - Après une réponse « Trouvé » sur une carte de vocabulaire (gradeCurrent, js/screens/reviser.js → sentenceAfterKnown),
//    1 fois sur 10 (SENT_P), 3 fois au plus par séance (SENT_SESSION_MAX), l'appli propose d'écrire une phrase avec le mot,
//    dans la langue apprise. Jamais pendant un duel ni un jeu (ils n'appellent pas gradeCurrent), jamais sur la dernière
//    carte de la séance, jamais si une fenêtre est déjà ouverte, jamais si le réglage est coupé
//    (settings.sentence.on === false) ou si la limite du jour est atteinte. Bouton « Passer » : rien n'est envoyé.
//  - Envoi : demande « sentence » dans la file d'attente Claude (claude_requests, une phrase = une demande, 1 lot).
//    Limite : 10 phrases par 24 h glissantes (vérifiée ici, et par le serveur : erreur sentence_day).
//    +5 XP par phrase envoyée (XP.onSentence ; champ xp de la phrase = déjà payé).
//  - Phrases : state.sentences (morceau « sentences », 200 max) :
//    { id (= id de la demande), cardId, lang, word, text, status "pending"|"done"|"error", reqId, at,
//      corrected, explain, ok (phrase juste), used (déjà utilisée comme exemple de la carte), xp }
//  - Réception : queueApply → sentenceFromQueue(résultat, payload.sentence, id de la demande). Réponse attendue :
//    { "correct": true|false, "corrected": "…", "explanation": "…" } (explication dans la langue de l'appli).
//  - Écran « Mes phrases » (#phrases, bouton Stats allumé) : liste, « Utiliser comme exemple de la carte » (version perso :
//    la carte garde cet exemple, il n'est jamais proposé au dictionnaire commun), « Supprimer ».
//  - Réglages : carte #sentCard (réglage + entrée vers l'écran).
const SENT_P = 0.1, SENT_SESSION_MAX = 3, SENT_DAY_MAX = 10, SENT_MAX_LEN = 200, SENT_KEEP = 200, SENT_XP = XP_RULES.sentence.send;

function sentOn() {
  try { return auth.mode === "supabase" && !!auth.sbUid && Queue.usable(); } catch (e) { return false; }
}
function sentEnabled() { return !(state.settings.sentence && state.settings.sentence.on === false); }
function sentList() { if (!Array.isArray(state.sentences)) state.sentences = []; return state.sentences; }
// Phrases envoyées ces 24 dernières heures (sur cet appareil) et envois encore possibles.
function sentUsedToday() { const lim = Date.now() - 86400000; return sentList().filter(r => r.at > lim).length; }
function sentLeft() { return Math.max(0, SENT_DAY_MAX - sentUsedToday()); }
function sentNewId() {
  try { if (window.crypto && crypto.randomUUID) return crypto.randomUUID(); } catch (e) {}
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, ch => { const r = Math.random() * 16 | 0; return (ch === "x" ? r : (r & 3 | 8)).toString(16); });
}
function sentClean(v, max) { return String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, max); }
function sentLangFr(c) { return LANGUAGES[c] ? LANGUAGES[c].names.fr.toLowerCase() : c; }

// --- Texte de la demande (même texte que les consignes de la tâche programmée, gardé dans le lot) ---
function sentencePrompt(s) {
  const L = sentLangFr(s.lang), T = sentLangFr(s.tl);
  return [
    "Tu corriges une phrase écrite par un apprenant de " + L + " (code " + s.lang + "), dans une appli de vocabulaire.",
    "Il devait écrire une phrase avec le mot « " + s.word + " ». Sa phrase : « " + s.text + " ».",
    "Réponds UNIQUEMENT par un objet JSON : {\"correct\": true|false, \"corrected\": \"…\", \"explanation\": \"…\"}.",
    "correct = true si la phrase est juste et naturelle (corrected = la phrase telle quelle). Sinon corrected = la version corrigée la plus proche de",
    "sa phrase, naturelle, en " + L + ", qui garde le mot.",
    "explanation = 1 à 2 phrases courtes, simples, en " + T + " (code " + s.tl + ") : ce qui est corrigé et pourquoi (ou un petit compliment si la phrase est juste)."
  ].join("\n");
}

// --- Proposition après un « Trouvé » (appelée par gradeCurrent) ---
// c : carte, lang : langue révisée, s : séance (rv.s). Renvoie true si la fenêtre a été ouverte.
function sentenceAfterKnown(c, lang, s) {
  try {
    if (!c || !s || !isVocab(c) || !s.queue || !s.queue.length) return false;   // dernière carte : pas de fenêtre sur le résumé
    if (!sentEnabled() || !sentOn()) return false;
    if ((s.sentOffered || 0) >= SENT_SESSION_MAX) return false;
    if (!(Math.random() < SENT_P)) return false;
    if (document.querySelector(".modal-bg")) return false;
    const L = isLang(lang) ? lang : cardLangs(c).target;
    const word = String(term(c, L) || "").trim();
    if (!word || sentLeft() <= 0) return false;
    s.sentOffered = (s.sentOffered || 0) + 1;
    sentOpenOffer(c, L, word);
    return true;
  } catch (e) { return false; }
}
function sentOpenOffer(c, L, word) {
  const box = el("div", "sn-offer");
  box.appendChild(el("p", null, t("sn.offerTxt", { w: word, lang: langName(L) })));
  const ta = el("textarea", "input sn-ta");
  ta.rows = 3; ta.maxLength = SENT_MAX_LEN; ta.placeholder = t("sn.ph"); ta.setAttribute("aria-label", t("sn.ph"));
  ta.autocomplete = "off"; ta.autocapitalize = "sentences"; ta.spellcheck = false;
  try { ta.lang = L; } catch (e) {}
  const cnt = el("span", "ix-count", "0 / " + SENT_MAX_LEN);
  ta.addEventListener("input", () => { cnt.textContent = ta.value.length + " / " + SENT_MAX_LEN; });
  box.append(ta, cnt);
  box.appendChild(el("p", "hint sn-left", t("sn.today", { n: sentUsedToday(), max: SENT_DAY_MAX, xp: SENT_XP })));
  const err = el("p", "q-err sn-err"); err.hidden = true;
  box.appendChild(err);
  let busy = false, close = null;
  const go = async () => {
    if (busy) return;
    busy = true; err.hidden = true;
    const btn = box.parentNode && box.parentNode.querySelector(".btns .btn.primary");
    if (btn) btn.disabled = true;
    const r = await sentenceSend(c, L, word, ta.value);
    busy = false;
    if (r.error) {
      err.textContent = sentErrText(r.error); err.hidden = false;
      if (btn) btn.disabled = false;
      return;
    }
    if (close) close();
  };
  close = openModal(t("sn.offerTitle"), box, [
    { label: t("sn.skip") },
    { label: t("sn.send"), kind: "primary", onClick: () => { go(); return false; } }
  ]);
  setTimeout(() => { try { ta.focus(); } catch (e) {} }, 50);
}
function sentErrText(k) {
  if (k === "empty") return t("sn.err.empty");
  if (k === "day") return t("sn.err.day", { max: SENT_DAY_MAX });
  if (k === "sentday") return t("sn.err.sentday");
  if (k === "kind") return t("sn.err.kind");
  if (k === "big") return t("sn.err.bad");
  if (["net", "limit"].includes(k)) return t("sn.err." + k);
  return t("sn.err.server");
}

// --- Envoi dans la file d'attente Claude ---
// Renvoie { error: null } ou { error: "empty"|"day"|"sentday"|"kind"|"net"|"limit"|"big"|"missing"|"server" }.
async function sentenceSend(c, L, word, raw) {
  const text = sentClean(raw, SENT_MAX_LEN);
  if (!text) return { error: "empty" };
  if (!sentOn()) return { error: "net" };
  if (sentLeft() <= 0) return { error: "day" };
  const id = sentNewId();
  const sentence = { id, lang: L, tl: state.settings.uiLang, word, text };
  const row = {
    id, kind: "sentence", label: word.slice(0, 300), card_count: 1, batch_count: 1,
    payload: { v: 1, app: "vocab", kind: "sentence", uiLang: state.settings.uiLang, created: new Date().toISOString(),
      answer: "json-object: {\"correct\": true|false, \"corrected\": \"…\", \"explanation\": \"…\"}",
      sentence, batches: [{ prompt: sentencePrompt(sentence), sentence }] }
  };
  const r = await Queue.submit([row]);
  if (r.error) return { error: r.error };
  if (!Array.isArray(state.sentences)) state.sentences = [];
  state.sentences.unshift({ id, cardId: c.id, lang: L, word, text, status: "pending", reqId: id, at: Date.now(),
    corrected: "", explain: "", ok: false, used: false, xp: true });   // xp : les +5 XP sont donnés ici, une seule fois
  state.sentences = normSentences(state.sentences);
  try { XP.onSentence(L); } catch (e) {}
  commitQuiet();
  toast(t("sn.sent", { xp: SENT_XP }));
  if (currentScreen === "sentences") renderScreen();
  return { error: null };
}

// --- Réception (appelée par queueApply) ---
function sentenceFromQueue(result, req, reqId) {
  if (!req || !req.id) return false;
  let o = result;
  if (typeof o === "string") { try { o = JSON.parse(o); } catch (e) { return false; } }
  if (!o || typeof o !== "object" || Array.isArray(o)) return false;
  const ok = o.correct === true;
  let corrected = sentClean(o.corrected, 400);
  const explain = sentClean(o.explanation != null ? o.explanation : o.explain, 600);
  if (!corrected && !ok) return false;
  const list = sentList();
  let r = list.find(x => x.id === String(req.id) || (reqId && x.reqId === String(reqId)));
  if (!r) {                                           // phrase envoyée depuis un autre appareil : fiche recréée depuis la demande
    const L = String(req.lang || "");
    const card = state.cards.find(c => isVocab(c) && String(term(c, L) || "").trim() === String(req.word || "").trim());
    r = { id: String(req.id), cardId: card ? card.id : "", lang: L, word: sentClean(req.word, 120), text: sentClean(req.text, 400),
      status: "pending", reqId: String(reqId || req.id), at: Date.now(), corrected: "", explain: "", ok: false, used: false, xp: true };
    if (!r.text) return false;
    list.unshift(r);
  }
  if (!corrected) corrected = r.text;
  r.status = "done"; r.ok = ok; r.corrected = corrected; r.explain = explain;
  state.sentences = normSentences(list);
  return true;
}
// Demandes en erreur (la tâche programmée n'a pas pu répondre) : les phrases en attente passent à « Sans réponse ».
function sentenceSyncErrors(items) {
  let changed = false;
  const by = new Map(arr(items).map(r => [String(r.id), r]));
  sentList().forEach(r => {
    if (r.status !== "pending") return;
    const q = by.get(r.reqId || r.id);
    if (q && q.status === "error") { r.status = "error"; changed = true; }
  });
  if (changed) { commitQuiet(); if (currentScreen === "sentences") renderScreen(); }
}

// --- Utiliser comme exemple de la carte (version perso) ---
function sentenceUse(r) {
  const c = state.cards.find(x => x.id === r.cardId);
  if (!c || !isVocab(c)) { toast(t("sn.nocard")); return; }
  openModal(t("sn.use"), el("p", null, t("sn.useAsk", { w: cardTitle(c) })), [
    { label: t("cancel") },
    { label: t("sn.use"), kind: "primary", onClick: () => { sentenceUseDo(r, c); } }
  ]);
}
function sentenceUseDo(r, c) {
  const L = r.lang, text = sentClean(r.corrected || r.text, 400);
  if (!text || !isLang(L)) return;
  const oldTr = Object.keys(exEntry(c, L) ? exEntry(c, L).tr : {});
  setExPart(c, L, "", text, L === cardLangs(c).target);
  const m = Object.assign({}, exMap(c) || {});
  if (m[L]) { m[L] = { text: m[L].text, tr: {} }; c.examples = m; }       // anciennes traductions : ne vont plus avec la nouvelle phrase
  // Version perso : case gardée sur cette carte, jamais remplacée par le dictionnaire commun, jamais proposée à l'admin.
  if (c.senseId && typeof dictSetOwn === "function") {
    const own = new Set(arr(c.own));
    own.add("e:" + L);
    oldTr.forEach(code => own.add("t:" + L + ":" + code));
    dictSetOwn(c, own);
  }
  if (Array.isArray(c.auto)) {                                             // « généré, non validé » : plus vrai pour cet exemple
    const T = cardLangs(c).target;
    c.auto = c.auto.filter(a => !(L === T && (a === "example" || a.startsWith("extr."))));
  }
  r.used = true;
  commit();
  toast(t("sn.useOk"));
}
function sentenceDelete(r) {
  openModal(t("sn.del"), el("p", null, t("sn.delAsk")), [
    { label: t("cancel") },
    { label: t("sn.del"), kind: "danger", onClick: () => {
      state.sentences = sentList().filter(x => x.id !== r.id);
      commit();
    } }
  ]);
}

// --- Écran « Mes phrases » (#phrases) ---
function sentDate(ms) { try { return ms ? new Date(ms).toLocaleDateString(state.settings.uiLang, { year: "numeric", month: "short", day: "numeric" }) : ""; } catch (e) { return ""; } }
function renderSentences() {
  const root = $("#screen-sentences");
  if (!root) return;
  root.textContent = "";
  const back = el("button", "link-btn", "‹ " + t("nav.stats"));
  back.type = "button";
  back.addEventListener("click", () => { location.hash = "#" + HASH_OF.stats; });
  root.appendChild(back);
  const top = el("div", "adm-top");
  top.appendChild(el("h2", null, "✍️ " + t("sn.title")));
  root.appendChild(top);
  if (!sentOn()) { root.appendChild(el("div", "card q-note", t("sn.local"))); return; }
  root.appendChild(el("p", "hint", t("sn.help")));
  root.appendChild(el("p", "hint", t("sn.today", { n: sentUsedToday(), max: SENT_DAY_MAX, xp: SENT_XP })));
  const list = sentList();
  if (!list.length) { root.appendChild(el("div", "empty", t("sn.none"))); return; }
  list.forEach(r => {
    const c = el("div", "card sn-item");
    const head = el("div", "al-head");
    const tags = el("span", "sn-tags");
    tags.append(el("span", "al-tag", r.word), el("span", "al-tag sn-st sn-st-" + r.status, t("sn.st." + r.status)));
    head.append(tags, el("span", "al-time", sentDate(r.at)));
    c.appendChild(head);
    c.appendChild(el("div", "sn-lbl", t("sn.mine")));
    c.appendChild(el("div", "sn-text", r.text));
    if (r.status === "done") {
      if (r.ok) c.appendChild(el("div", "sn-right", t("sn.right")));
      else {
        c.appendChild(el("div", "sn-lbl", t("sn.corrected")));
        c.appendChild(el("div", "sn-text sn-fixed", r.corrected));
      }
      if (r.explain) { c.appendChild(el("div", "sn-lbl", t("sn.explain"))); c.appendChild(el("div", "sn-expl", r.explain)); }
    } else c.appendChild(el("div", "muted sn-wait", t(r.status === "error" ? "sn.errored" : "sn.waiting")));
    const btns = el("div", "sn-btns");
    if (r.status === "done" && (r.corrected || r.text)) {
      if (r.used) btns.appendChild(el("span", "sn-used", t("sn.used")));
      else if (state.cards.some(x => x.id === r.cardId)) {
        const u = el("button", "btn primary", t("sn.use"));
        u.type = "button"; u.addEventListener("click", () => sentenceUse(r));
        btns.appendChild(u);
      }
    }
    const d = el("button", "btn", t("sn.del"));
    d.type = "button"; d.addEventListener("click", () => sentenceDelete(r));
    btns.appendChild(d);
    c.appendChild(btns);
    root.appendChild(c);
  });
}
// Bouton d'entrée dans Stats (mode Supabase seulement ; null sinon).
function sentenceStatsEntry() {
  if (!sentOn()) return null;
  const n = sentList().length;
  const b = el("button", "btn sn-entry", t(n ? "sn.entryN" : "sn.entry", { n }));
  b.type = "button";
  b.addEventListener("click", () => { location.hash = "#" + HASH_OF.sentences; });
  return b;
}
// Réglages → carte « Ma phrase » : réglage (activé par défaut) et accès à l'écran.
function renderSentCard() {
  const box = $("#sentCard");
  if (!box) return;
  box.textContent = "";
  box.hidden = !sentOn();
  if (box.hidden) return;
  box.appendChild(el("h2", null, "✍️ " + t("sn.setTitle")));
  const lab = el("label", "check-row");
  const cb = el("input"); cb.type = "checkbox"; cb.checked = sentEnabled();
  cb.addEventListener("change", () => {
    state.settings.sentence = { on: cb.checked };
    commit();
  });
  lab.append(cb, el("span", null, t("sn.setOn")));
  box.appendChild(lab);
  box.appendChild(el("p", "hint", t("sn.setHint")));
  const open = el("button", "btn", t("sn.open"));
  open.type = "button"; open.addEventListener("click", () => { location.hash = "#" + HASH_OF.sentences; });
  box.appendChild(open);
}
