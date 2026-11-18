"use strict";

// === MODE PRONONCIATION (ÉTAPE 46) ===
// On voit la traduction (langues d'appui) et on dit le mot ou la phrase dans la langue étudiée.
// Reconnaissance vocale du navigateur (SpeechRecognition / webkitSpeechRecognition), lang = tts de la langue, jusqu'à
// 5 propositions comparées à toutes les réponses acceptées (lisKey : règles normalize de la langue, ponctuation ignorée).
// Déroulé : 3 essais ; « Écouter le modèle » ; « Voir le mot » / « Voir la phrase » (indice). Note proposée : juste au 1er essai = Su ;
// juste au 2e ou 3e essai, ou avec l'indice = À revoir ; 3 échecs = Pas su. « Compter juste » (la reconnaissance se trompe
// parfois) : le dernier essai compte comme juste. « Passer » : la carte quitte la session sans note.
// Mode masqué si le navigateur n'a pas la reconnaissance vocale. Le micro est demandé par le navigateur au premier
// « Parler » seulement. Micro refusé, réseau, langue non prise en charge : message clair, la session continue (Passer).
// État de la carte en cours : rv.s.p = { key, tries (essais ratés), heard (dernier texte compris), status, hint, err, okTry }.
const SPEAK_TRIES = 3;
const SpeechRec = (() => {
  let cur = null;
  function ctor() {
    try { return window.SpeechRecognition || window.webkitSpeechRecognition || null; } catch (e) { return null; }
  }
  function supported() { return typeof ctor() === "function"; }
  function stop() {
    const r = cur; cur = null;
    if (r) { try { r.abort(); } catch (e) {} }
  }
  function active() { return !!cur; }
  // on = { result([textes]), error(code) } ; codes : not-allowed, service-not-allowed, network, language-not-supported,
  // no-speech, audio-capture, other. Un seul appel (résultat ou erreur) par écoute ; rien si l'écoute a été arrêtée.
  function listen(L, on) {
    stop();
    const R = ctor();
    if (!R) { on.error("other"); return; }
    let r;
    try { r = new R(); } catch (e) { on.error("other"); return; }
    let done = false, err = null;
    const finish = fn => { if (done || cur !== r) return; done = true; cur = null; try { fn(); } catch (e) {} };
    try {
      r.lang = (LANGUAGES[L] && LANGUAGES[L].tts) || L;
      r.interimResults = false;
      r.continuous = false;
      r.maxAlternatives = 5;
    } catch (e) {}
    r.onresult = e => {
      const out = [];
      try {
        const res = e.results[e.resultIndex || 0] || e.results[0];
        for (let i = 0; i < res.length; i++) if (res[i] && res[i].transcript) out.push(String(res[i].transcript));
      } catch (x) {}
      if (out.length) finish(() => on.result(out));
    };
    r.onerror = e => { err = (e && e.error) || "other"; if (err !== "aborted") finish(() => on.error(err)); };
    r.onend = () => finish(() => on.error(err || "no-speech"));
    cur = r;
    try { r.start(); } catch (e) { finish(() => on.error("other")); }
  }
  return { supported, listen, stop, active };
})();
function lisCanSpeak() { return SpeechRec.supported(); }

// Clé de comparaison tolérante : sans casse, accents selon la langue, ponctuation et symboles ignorés, espaces simplifiés
// (retirés pour une langue qui les tolère : coréen, japonais, chinois).
function lisKey(s, L) {
  const r = langRules(L);
  let x = wrClean(s).toLowerCase();
  if (r.accents) x = x.normalize("NFD").replace(/[̀-ͯ]/g, "").normalize("NFC");
  x = x.replace(/[\p{P}\p{S}]/gu, " ").replace(/\s+/g, " ").trim();
  if (r.spaces) x = x.replace(/\s+/g, "");
  return x;
}
// Une des propositions entendues correspond-elle à une réponse acceptée ? Renvoie la proposition juste, sinon null.
function lisMatch(heard, it) {
  const keys = it.alts.map(a => lisKey(a.text, it.L)).filter(Boolean);
  return arr(heard).find(h => { const k = lisKey(h, it.L); return k && keys.includes(k); }) || null;
}
// Note proposée. okTry = numéro de l'essai juste (1 à 3), 0 = pas juste.
function speakResult(p) {
  if (!p.okTry) return "unknown";
  return p.okTry === 1 && !p.hint ? "known" : "review";
}
function speakGrade(result) { SpeechRec.stop(); rv.s.p = null; gradeCurrent(result); }
function speakSkip() {
  SpeechRec.stop(); Speech.stop();
  rv.s.p = null;
  rv.s.queue.shift();
  renderReview();
}
const SPEAK_ERRS = {
  "not-allowed": "ls.s.err.denied", "service-not-allowed": "ls.s.err.denied", "audio-capture": "ls.s.err.mic",
  "network": "ls.s.err.network", "language-not-supported": "ls.s.err.lang", "no-speech": "ls.s.err.nospeech"
};

function renderSpeakSession(root) {
  const s = rv.s;
  let cur = null;
  while (s.queue.length && !(cur = lisCurrent(s, s.queue[0]))) s.queue.shift();
  if (!s.queue.length || !cur) { SpeechRec.stop(); renderSessionSummary(root); return; }
  const { c, it } = cur;
  const p = lisState(s, "p", c, { tries: 0, heard: "", status: "idle", hint: false, err: "", okTry: 0 });
  if (s.audio && s.audio.key !== s.log.length + ":" + c.id) SpeechRec.stop();   // nouvelle carte : écoute précédente arrêtée
  audioCard(s, c);
  const finished = p.status === "ok" || p.status === "fail";
  const same = () => rv.s === s && s.p === p;   // la réponse arrive pour la carte toujours affichée

  lisMeta(root, s, c, it);
  const q = el("div", "card ls-q");
  q.appendChild(el("div", "sw-lang", LISTEN_ICON.speak + " " + t(it.kind === "sent" ? "ls.s.saySent" : "ls.s.sayWord", { lang: langName(it.L) })));
  q.appendChild(lisTrNode(it, "ls-tr ls-tr-q"));
  if (p.hint && !finished) {
    const w = el("div", "ls-word", it.text); w.lang = it.L;
    q.appendChild(w);
  }
  root.appendChild(q);

  if (!finished) {
    root.appendChild(el("div", "ls-try", t("ls.s.try", { n: Math.min(p.tries + 1, SPEAK_TRIES), m: SPEAK_TRIES })));
    const listening = p.status === "listening";
    const mic = el("button", "btn primary ls-mic" + (listening ? " on" : ""), t(listening ? "ls.s.listening" : "ls.s.mic"));
    mic.type = "button";
    mic.setAttribute("aria-pressed", String(listening));
    mic.addEventListener("click", () => {
      if (p.status === "listening") { SpeechRec.stop(); p.status = "idle"; renderReview(); return; }
      Speech.stop();
      p.status = "listening"; p.err = "";
      renderReview();
      SpeechRec.listen(it.L, {
        result(heard) {
          if (!same()) return;
          const ok = lisMatch(heard, it);
          p.heard = ok || heard[0];
          if (ok) { p.okTry = p.tries + 1; p.status = "ok"; }
          else { p.tries++; p.status = p.tries >= SPEAK_TRIES ? "fail" : "idle"; }
          renderReview();
        },
        error(code) {
          if (!same()) return;
          p.status = "idle";
          p.err = SPEAK_ERRS[code] || "ls.s.err.other";
          renderReview();
        }
      });
    });
    root.appendChild(mic);
    if (p.err) root.appendChild(el("div", "ls-msg bad", t(p.err, { lang: langName(it.L) })));
    if (p.heard) {
      const h = el("div", "ls-heard");
      h.append(el("div", "wr-lbl", t("ls.s.heard")), el("div", "ls-heard-txt", "« " + p.heard + " »"));
      h.appendChild(el("div", "ls-msg bad", t("ls.s.wrong")));
      root.appendChild(h);
    }
    const tools = el("div", "btns two ls-tools");
    if (Speech.has(it.L)) {
      const m = el("button", "btn", t("ls.s.model"));
      m.type = "button";
      m.addEventListener("click", () => { if (p.status === "listening") { SpeechRec.stop(); p.status = "idle"; renderReview(); } Speech.speak(it.text, it.L); });
      tools.appendChild(m);
    }
    if (!p.hint) {
      const h = el("button", "btn", t(it.kind === "sent" ? "ls.s.showSent" : "ls.s.showWord"));
      h.type = "button";
      h.addEventListener("click", () => { p.hint = true; renderReview(); });
      tools.appendChild(h);
    }
    if (tools.childNodes.length) root.appendChild(tools);
    const row = el("div", "btns two");
    if (p.tries > 0) {
      const ok = el("button", "btn ok", t("ls.s.countOk"));
      ok.addEventListener("click", () => { SpeechRec.stop(); p.okTry = p.tries; p.status = "ok"; p.forced = true; renderReview(); });
      row.appendChild(ok);
    }
    const skip = el("button", "btn", t("ls.s.skip"));
    skip.addEventListener("click", speakSkip);
    row.appendChild(skip);
    root.appendChild(row);
  } else {
    const ok = p.status === "ok";
    const box = el("div", "card wr-res " + (ok ? (speakResult(p) === "known" ? "ok" : "acc") : "bad"));
    box.appendChild(el("div", "wr-head", t(ok ? (p.forced ? "ls.s.okForced" : p.okTry === 1 ? "ls.s.ok1" : "ls.s.okN") : "ls.s.fail", { n: p.okTry })));
    if (p.heard) box.append(el("div", "wr-lbl", t("ls.s.heard")), el("div", "ls-heard-txt", "« " + p.heard + " »"));
    box.appendChild(el("div", "wr-lbl", t("write.correct")));
    const w = el("div", "wr-diff", it.text); w.lang = it.L;
    box.appendChild(w);
    const asp = spkRow(it.text, it.L);
    if (asp) box.appendChild(asp);
    lisDetails(box, c, it);
    root.appendChild(box);
    if (!ok) {
      const cj = el("button", "btn ok", t("ls.s.countOk"));
      cj.addEventListener("click", () => { p.okTry = p.tries; p.status = "ok"; p.forced = true; renderReview(); });
      root.appendChild(cj);
    }
    const next = lisGradeButtons(root, speakResult(p), speakGrade);
    setTimeout(() => { try { next.focus({ preventScroll: true }); } catch (e) {} }, 60);
  }

  const quit = el("button", "link-btn", t("cards.quit"));
  quit.addEventListener("click", () => { SpeechRec.stop(); s.p = null; s.queue = []; Speech.stop(); renderReview(); });
  root.appendChild(quit);
}
