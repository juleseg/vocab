"use strict";

// === AUDIO ===
// Synthèse vocale du navigateur : voix donnée par le champ tts de chaque langue (LANGUAGES).
// Le bouton haut-parleur n'est créé que si une voix existe (sinon rien, sans erreur).
// Plusieurs langues sur une face : lues l'une après l'autre. Une nouvelle carte coupe la lecture en cours.
// Lecture auto (state.settings.audio) : question lue à son apparition, réponse au retournement
// (ou après validation en mode Écrit), seulement pour les langues choisies (langue apprise / d'appui / les deux).
const Speech = (() => {
  const LANG = {};
  LANG_CODES.forEach(c => { LANG[c] = LANGUAGES[c].tts; });
  let voices = [], ready = false, token = 0;
  const synth = (() => { try { return window.speechSynthesis || null; } catch (e) { return null; } })();
  function load() { try { voices = (synth && synth.getVoices()) || []; } catch (e) { voices = []; } return voices.length > 0; }
  function voiceFor(lng) {
    const full = (LANG[lng] || "").toLowerCase(), base = full.slice(0, 2);
    const norm = v => String(v.lang || "").toLowerCase().replace("_", "-");
    return voices.find(v => norm(v) === full) || voices.find(v => norm(v).startsWith(base)) || null;
  }
  function has(lng) {
    return !!(synth && typeof SpeechSynthesisUtterance !== "undefined" && LANG[lng] && voiceFor(lng));
  }
  function stop() { token++; try { if (synth) synth.cancel(); } catch (e) {} }
  // items : [{ text, lng }] lus à la suite ; langues sans voix sautées. "voler / s'envoler" : lu avec une pause.
  // cb (étape 45, histoires) : { onItem(index dans items), onEnd() } — appelés seulement si la lecture n'a pas été coupée.
  function speakSeq(items, cb) {
    const list = arr(items).map((x, i) => Object.assign({ i }, x)).filter(x => x && x.text && x.text !== "—" && has(x.lng));
    stop();
    if (!list.length) return false;
    const my = token;
    setTimeout(() => {                       // petit délai : certains navigateurs ignorent speak() juste après cancel()
      if (my !== token) return;
      list.forEach((x, k) => {
        try {
          const u = new SpeechSynthesisUtterance(String(x.text).replace(/\s*\/\s*/g, ", "));
          u.lang = LANG[x.lng];
          u.voice = voiceFor(x.lng);
          if (cb) {
            u.onstart = () => { if (my === token && cb.onItem) { try { cb.onItem(x.i); } catch (e) {} } };
            if (k === list.length - 1) u.onend = () => { if (my === token && cb.onEnd) { try { cb.onEnd(); } catch (e) {} } };
          }
          synth.speak(u);
        } catch (e) {}
      });
    }, 60);
    return true;
  }
  function speak(text, lng) { return speakSeq([{ text, lng }]); }
  // Les voix arrivent souvent après le chargement : onReady est appelé une fois quand elles sont prêtes.
  function init(onReady) {
    if (!synth) return;
    if (load()) { ready = true; return; }
    const h = () => { if (!ready && load()) { ready = true; try { onReady(); } catch (e) {} } };
    try {
      if (synth.addEventListener) synth.addEventListener("voiceschanged", h);
      else synth.onvoiceschanged = h;
    } catch (e) {}
  }
  // "none" (pas de synthèse vocale) | "loading" (voix pas encore connues) | "ready"
  function status() { return !synth || typeof SpeechSynthesisUtterance === "undefined" ? "none" : (ready || load() ? "ready" : "loading"); }
  return { has, speak, speakSeq, stop, init, status };
})();

const SPK_ICON = '<svg viewBox="0 0 24 24"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/></svg>';
// Bouton haut-parleur qui lit items ([{ text, lng }]) à la suite, ou null si aucune de ces langues n'a de voix.
// pointerdown arrêté pour ne pas retourner / faire glisser la carte en mode Cartes.
function speakItemsBtn(items) {
  const list = arr(items).filter(x => x && x.text && x.text !== "—" && Speech.has(x.lng));
  if (!list.length) return null;
  const b = el("button", "spk");
  b.type = "button";
  b.innerHTML = SPK_ICON;
  b.setAttribute("aria-label", t("audio.play"));
  const stop = e => e.stopPropagation();
  b.addEventListener("pointerdown", stop);
  b.addEventListener("keydown", stop);
  b.addEventListener("click", e => { e.stopPropagation(); Speech.speakSeq(list); });
  return b;
}
function speakBtn(text, lng) { return speakItemsBtn([{ text, lng }]); }
function spkRow(text, lng) { return spkItemsRow([{ text, lng }]); }
function spkItemsRow(items) {
  const b = speakItemsBtn(items);
  if (!b) return null;
  const r = el("div", "spk-row");
  r.appendChild(b);
  return r;
}

// --- Lecture auto pendant une session ---
function audioSettings() { return state.settings.audio || { auto: true, langs: "target" }; }
// Langue lue automatiquement selon le réglage (lg = langues de la carte).
function autoLangOk(lng, lg) {
  const m = audioSettings().langs;
  return m === "both" || (m === "target" ? lng === lg.target : lng !== lg.target);
}
// À appeler à l'affichage d'une carte : une nouvelle carte coupe la lecture en cours.
// Clé = nombre de réponses déjà données + id : une carte « Pas su » qui revient compte comme une nouvelle carte.
function audioCard(s, c) {
  const key = s.log.length + ":" + c.id;
  if (!s.audio || s.audio.key !== key) { Speech.stop(); s.audio = { key, done: new Set() }; }
}
// Lit une face (side = "q" ou "a") une seule fois par carte, si la lecture auto est active.
// Rien n'est marqué comme lu si aucune voix n'est encore prête (nouvel essai quand les voix arrivent).
function autoSpeak(s, side, items, lg) {
  if (!audioSettings().auto || !s || !s.audio || s.audio.done.has(side)) return;
  const list = arr(items).filter(x => autoLangOk(x.lng, lg));
  if (Speech.speakSeq(list)) s.audio.done.add(side);
}
// Interrupteur « Lecture auto » : toucher n'importe où sur la ligne, ou glisser le curseur à gauche / à droite.
function audioToggle() {
  const b = el("button", "au-switch");
  b.type = "button";
  b.setAttribute("role", "switch");
  const lbl = el("span", "au-lbl");
  lbl.innerHTML = SPK_ICON;
  lbl.appendChild(el("span", null, t("audio.auto")));
  const track = el("span", "au-track");
  track.appendChild(el("span", "au-knob"));
  b.append(lbl, track);
  const show = () => b.setAttribute("aria-checked", String(!!audioSettings().auto));
  const setOn = on => {
    if (!state.settings.audio) state.settings.audio = { auto: true, langs: "target" };
    if (state.settings.audio.auto === on) return;
    state.settings.audio.auto = on;
    if (!on) Speech.stop();
    show();
    commitQuiet(); // mémorisé, sans réafficher l'écran (la carte en cours reste)
  };
  let x0 = null, dragged = false;
  b.addEventListener("pointerdown", e => { x0 = e.clientX; dragged = false; });
  b.addEventListener("pointerup", e => {
    if (x0 == null) return;
    const dx = e.clientX - x0; x0 = null;
    if (Math.abs(dx) > 18) { dragged = true; setOn(dx > 0); }
  });
  b.addEventListener("pointercancel", () => { x0 = null; });
  b.addEventListener("click", () => { if (dragged) { dragged = false; return; } setOn(!audioSettings().auto); });
  show();
  return b;
}
