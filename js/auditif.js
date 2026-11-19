"use strict";

// === APPRENTISSAGE AUDITIF (ÉTAPE 55) ===
// Pour ceux qui retiennent à l'oreille : juste après la réponse notée, la carte est lue à voix haute
// « langue apprise… puis traduction », répétée N fois avec une pause (ex. « tree. arbre. tree. arbre. »).
// Réglage du compte : settings.audio.learn = { when: off|wrong|right|always, langs: target|both, repeat: 1..3 }
// (normAudLearn, js/storage.js). Réglage d'une liste : champ audioLearn (absent = comme le compte, "off" = jamais,
// objet = réglage propre). « fausse » = Pas su ou À revoir (Écrit : réponse fausse) ; « bonne » = Su (Écrit : juste).
// Modes : Cartes, Écrit, QCM (AUD_MODES) ; pas l'Interrogateur (on est deux), ni les jeux chronométrés (Course), ni
// Paires, Ordre, Dictée, Prononciation, Tableau. Cartes de vocabulaire seulement.
// Paires (étape 55 aussi, indépendant de ce réglage) : chaque case touchée est lue tout de suite (js/modes/paires.js).
// Traduction = langue de l'appli, sinon langue d'aide (1re traduction remplie, supportTerms) ; aucune : langue apprise seule.
// Langue sans voix : sautée sans erreur ; aucune voix : rien ne se passe (pas de pause d'écoute).
// Cartes / QCM (bonne réponse) : « pause d'écoute » — la note est déjà enregistrée, un bandeau montre le mot
// et « Suivant › » ; la suite arrive seule à la fin de la lecture ; un toucher passe tout de suite (et coupe la lecture).
// Écrit : la répétition remplace la lecture auto de la réponse après « Vérifier » ; « Continuer » coupe la lecture.
// Indépendant de l'interrupteur « Lecture auto » (réglage fait exprès, comme la Dictée).
const AUD_GAP_MS = 600;                                 // pause entre deux lectures (≈ 0,6 s)
const AUD_NEXT_MS = 250;                                // petit temps après la fin de la lecture avant la carte suivante
const AUD_MODES = ["cards", "write", "mcq"];            // modes concernés (pas Interrogateur, Course, Paires, Ordre, Dictée, Prononciation, Tableau)

const Auditif = (() => {
  function account() { return normAudLearn(((state.settings || {}).audio || {}).learn); }
  // Réglage effectif d'une liste (ou du compte si la liste n'a rien).
  function forList(l) {
    if (l && l.audioLearn === "off") return Object.assign(account(), { when: "off" });
    if (l && l.audioLearn && typeof l.audioLearn === "object") return normAudLearn(l.audioLearn);
    return account();
  }
  function forCard(c) { return forList(c ? getList(c.listId) : null); }
  function fires(set, ok) { return set.when === "always" || (set.when === "wrong" && !ok) || (set.when === "right" && ok); }
  // Une lecture de la carte : [langue apprise, traduction?], langues sans voix retirées.
  function once(c, lg, set) {
    if (!c || !isVocab(c)) return [];
    lg = lg || cardLangs(c);
    const out = [];
    const tg = term(c, lg.target).trim();
    if (tg) out.push({ text: tg, lng: lg.target });
    if (set.langs === "both") {
      const tr = supportTerms(c, lg).find(x => x.code !== lg.target);
      if (tr) out.push({ text: tr.text.trim(), lng: tr.code });
    }
    return out.filter(x => Speech.has(x.lng));
  }
  // Éléments à lire (N répétitions), ou null si rien ne doit être lu. ok = réponse bonne (Su / juste).
  function plan(mode, c, lg, ok) {
    if (!AUD_MODES.includes(mode) || !c || !isVocab(c)) return null;
    const set = forCard(c);
    if (!fires(set, ok)) return null;
    const one = once(c, lg, set);
    if (!one.length) return null;
    let out = [];
    for (let i = 0; i < set.repeat; i++) out = out.concat(one);
    return out;
  }
  // Vrai si la répétition aura lieu quelle que soit la note (« tout le temps ») : la lecture auto de la réponse
  // au retournement (mode Cartes) est alors laissée à la répétition (pas de double lecture).
  function always(mode, c, lg) {
    if (!AUD_MODES.includes(mode) || !c || !isVocab(c)) return false;
    const set = forCard(c);
    return set.when === "always" && once(c, lg, set).length > 0;
  }
  function play(items, onEnd) { return Speech.speakSeq(items, { onEnd }, { gap: AUD_GAP_MS }); }
  return { account, forList, forCard, fires, once, plan, always, play };
})();

// --- Pendant une session (Cartes, Écrit) ---
// Note la carte en cours ; si la répétition se déclenche, la pause d'écoute est préparée (s.aud) avant l'affichage suivant.
function audGrade(c, lg, result) {
  const s = rv.s;
  if (s) {
    const it = Auditif.plan(s.mode, c, lg, result === "known");
    if (it) s.aud = { items: it, lg, word: term(c, lg.target), tr: (supportTerms(c, lg).find(x => x.code !== lg.target) || {}).text || "", started: false };
  }
  gradeCurrent(result);
}
// Pause d'écoute (Cartes) : affichée à la place de la carte suivante. Renvoie true si elle est affichée.
function audPause(root) {
  const s = rv.s, a = s && s.aud;
  if (!a) return false;
  const skip = () => { if (s.aud !== a) return; s.aud = null; Speech.stop(); renderReview(); };
  const box = el("button", "card aud-pause");
  box.type = "button";
  box.appendChild(el("div", "aud-lbl", "🔊 " + t("aud.listening")));
  const w = el("div", "aud-word", a.word); w.lang = a.lg.target;
  box.appendChild(w);
  if (a.tr && a.items.some(x => x.lng !== a.lg.target)) box.appendChild(el("div", "aud-tr", a.tr));
  box.appendChild(el("div", "aud-hint", t("aud.tapNext")));
  box.addEventListener("click", skip);
  root.appendChild(box);
  const nb = el("button", "btn primary aud-next", t("aud.next"));
  nb.addEventListener("click", skip);
  root.appendChild(nb);
  const quit = el("button", "link-btn", t("cards.quit"));
  quit.addEventListener("click", () => { s.aud = null; Speech.stop(); s.queue = []; renderReview(); });
  root.appendChild(quit);
  if (!a.started) {
    a.started = true;
    const ok = Auditif.play(a.items, () => setTimeout(() => {
      if (s.aud !== a) return;
      s.aud = null;
      if (rv.s === s && currentScreen === "review") renderReview();
    }, AUD_NEXT_MS));
    if (!ok) { s.aud = null; setTimeout(() => { if (rv.s === s) renderReview(); }, 0); }
  }
  return true;
}
// Écrit : après « Vérifier ». Renvoie true si la répétition remplace la lecture auto de la réponse.
function audAfterCheck(s, c, lg, ok) {
  if (!s || !s.audio) return false;
  if (s.audio.aud) return true;                       // déjà lancée pour cette carte (écran redessiné)
  const it = Auditif.plan(s.mode, c, lg, ok);
  if (!it) return false;
  s.audio.aud = true;
  s.audio.done.add("a");
  Auditif.play(it);
  return true;
}

// --- Libellés ---
function audLabel(set) {
  if (!set || set.when === "off") return t("aud.when.off");
  return [t("aud.when." + set.when), t("aud.rep.n", { n: set.repeat }), t("aud.langs.short." + set.langs)].join(" · ");
}
// Réglage d'une liste pour son bouton de menu : « Comme le compte (…) », « Jamais » ou le réglage propre.
function audListLabel(l) {
  if (l && l.audioLearn === "off") return t("aud.when.off");
  if (l && l.audioLearn && typeof l.audioLearn === "object") return audLabel(normAudLearn(l.audioLearn));
  return t("aud.list.account");
}

// --- Choix (écran du compte et fenêtre d'une liste) ---
// Dessine les 3 choix (Quand, Langues, Répétitions) de set dans box ; onChange(nouveau réglage).
function audChoices(box, set, onChange) {
  const sec = (title, node) => { const d = el("div", "aud-sec"); d.appendChild(el("h3", "aud-h", title)); d.appendChild(node); box.appendChild(d); return d; };
  const radio = (opts, cur, key) => {
    const g = el("div", "fs-opts aud-opts");
    g.setAttribute("role", "radiogroup");
    opts.forEach(v => {
      const b = el("button", "fs-opt aud-opt" + (cur === v ? " on" : ""));
      b.type = "button";
      b.setAttribute("role", "radio");
      b.setAttribute("aria-checked", String(cur === v));
      b.appendChild(el("span", "fs-name", t("aud." + key + "." + v)));
      b.appendChild(el("span", "fs-desc", t("aud." + key + "." + v + ".d")));
      b.addEventListener("click", () => { if (set[key] !== v) onChange(Object.assign({}, set, { [key]: v })); });
      g.appendChild(b);
    });
    return g;
  };
  sec(t("aud.when"), radio(AUD_WHEN, set.when, "when"));
  const off = set.when === "off";
  const ls = sec(t("aud.langs"), radio(AUD_LANGS, set.langs, "langs"));
  const seg = el("div", "seg aud-rep");
  for (let n = AUD_REPEAT.min; n <= AUD_REPEAT.max; n++) {
    const b = el("button", null, t("aud.rep.n", { n }));
    b.type = "button";
    b.setAttribute("aria-pressed", String(set.repeat === n));
    b.addEventListener("click", () => { if (set.repeat !== n) onChange(Object.assign({}, set, { repeat: n })); });
    seg.appendChild(b);
  }
  const rs = sec(t("aud.rep"), seg);
  ls.classList.toggle("aud-dim", off);
  rs.classList.toggle("aud-dim", off);
}

// --- Réglages → carte « Apprentissage auditif » (affiche le réglage actuel, ouvre l'écran #auditif) ---
function renderAudLearnCard() {
  const box = $("#audLearnCard");
  if (!box) return;
  box.textContent = "";
  box.classList.add("fs-entry-card");
  const b = el("button", "fs-entry");
  b.type = "button";
  b.id = "audLearnBtn";
  const txt = el("span", "fs-entry-txt");
  txt.append(el("span", "fs-entry-title", "🔊 " + t("aud.title")), el("span", "fs-entry-val", audLabel(Auditif.account())));
  b.append(txt, el("span", "chev", "›"));
  b.addEventListener("click", () => { location.hash = "#" + HASH_OF.auditory; });
  box.appendChild(b);
}

// --- Écran « Apprentissage auditif » (#auditif) ---
function renderAuditory() {
  const root = $("#screen-auditory");
  if (!root) return;
  root.textContent = "";
  const back = el("button", "link-btn", "‹ " + t("nav.settings"));
  back.type = "button";
  back.addEventListener("click", () => { location.hash = "#" + HASH_OF.settings; });
  root.appendChild(el("div", "lv-top")).appendChild(back);
  root.appendChild(el("h2", "fs-title", t("aud.title")));
  root.appendChild(el("p", "fs-intro", t("aud.intro")));
  const box = el("div", "aud-box");
  audChoices(box, Auditif.account(), v => {
    state.settings.audio = Object.assign({ auto: true, langs: "target" }, state.settings.audio, { learn: normAudLearn(v) });
    commit();
    toast(t("aud.saved"));
  });
  root.appendChild(box);
  root.appendChild(el("p", "fs-note", t("aud.modes")));
  root.appendChild(el("p", "fs-note", t("aud.listNote")));
  if (Speech.status() === "none") root.appendChild(el("div", "au-warn", t("audio.noSpeech")));
}

// --- Menu d'une liste : « 🔊 Apprentissage auditif » (comme le compte / jamais / réglage propre) ---
function openAudList(listId) {
  const l = getList(listId);
  if (!l) return;
  const body = el("div", "aud-modal");
  const draw = () => {
    body.textContent = "";
    const mode = l.audioLearn === "off" ? "off" : (l.audioLearn && typeof l.audioLearn === "object" ? "own" : "account");
    const g = el("div", "fs-opts aud-opts");
    g.setAttribute("role", "radiogroup");
    [["account", t("aud.list.account"), audLabel(Auditif.account())], ["off", t("aud.when.off"), t("aud.list.off.d")], ["own", t("aud.list.own"), t("aud.list.own.d")]].forEach(([k, name, d]) => {
      const b = el("button", "fs-opt aud-opt" + (mode === k ? " on" : ""));
      b.type = "button";
      b.dataset.k = k;
      b.setAttribute("role", "radio");
      b.setAttribute("aria-checked", String(mode === k));
      b.append(el("span", "fs-name", name), el("span", "fs-desc", d));
      b.addEventListener("click", () => {
        if (mode === k) return;
        if (k === "account") delete l.audioLearn;
        else if (k === "off") l.audioLearn = "off";
        else l.audioLearn = Object.assign(Auditif.account(), Auditif.account().when === "off" ? { when: "wrong" } : {});
        commit(); toast(t("aud.saved")); draw();
      });
      g.appendChild(b);
    });
    body.appendChild(g);
    if (mode === "own") {
      const own = el("div", "aud-own");
      audChoices(own, normAudLearn(l.audioLearn), v => { l.audioLearn = normAudLearn(v); commit(); toast(t("aud.saved")); draw(); });
      body.appendChild(own);
    }
  };
  draw();
  openModal(t("aud.list.title", { name: l.name }), body, [{ label: t("aud.close") }]);
}
