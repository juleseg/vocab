"use strict";

// === NOMS DES TROIS LANGUES : APERÇU DE CARTE ET AIDE « ? » (étape 52, complément) ===
// Création de compte (auth.js) et Réglages → Langues (reglages.js) montrent les mêmes trois choix, dans cet ordre :
//   1. Langue de l'appli (uiLang)  2. Langue apprise (target)  3. Langue d'aide, facultative (support du profil),
// chacun avec une phrase courte, un aperçu en direct d'une carte d'exemple (mot dans la langue apprise en grand, puis
// dans la langue de l'appli, puis dans la langue d'aide) et un bouton « ? » qui explique les trois langues.
// Textes seulement : les noms dans le code et les données ne changent pas (uiLang, target, support…).
const LX_WORD = { ko: "사과", fr: "pomme", en: "apple", it: "mela", es: "manzana", de: "Apfel", pt: "maçã", ja: "りんご", zh: "苹果" };
let lxSeq = 0;

// Champ avec étiquette liée au contrôle (lecteur d'écran) et phrase courte en dessous.
function lxField(label, input, hint) {
  const f = el("div", "field lx-field");
  const lab = el("label", null, label);
  if (input.tagName === "SELECT" || input.tagName === "INPUT") {
    if (!input.id) input.id = "lx" + (++lxSeq);
    lab.htmlFor = input.id;
  } else {
    if (!lab.id) lab.id = "lxl" + (++lxSeq);
    input.setAttribute("role", "group");
    input.setAttribute("aria-labelledby", lab.id);
  }
  f.append(lab, input);
  if (hint) f.appendChild(el("div", "hint", hint));
  return f;
}
// Boutons des 3 langues de l'appli (coréen, français, anglais) ; onPick(code).
function lxAppSeg(onPick) {
  const seg = el("div", "seg lx-app");
  [["ko", "한국어"], ["fr", "Français"], ["en", "English"]].forEach(([code, label]) => {
    const b = el("button", null, label);
    b.type = "button";
    b.lang = code;
    b.dataset.value = code;
    b.setAttribute("aria-pressed", String(state.settings.uiLang === code));
    b.addEventListener("click", () => onPick(code));
    seg.appendChild(b);
  });
  return seg;
}
// Aperçu d'une carte : mot de la langue apprise en grand, puis langue de l'appli, puis langue d'aide (mêmes règles que
// les vraies cartes : supportLangs, langue identique retirée).
function lxPreview(target, help, ui, caption) {
  ui = isLang(ui) ? ui : state.settings.uiLang;
  const box = el("div", "lx-prev");
  if (caption !== false) box.appendChild(el("div", "lx-cap", t("lx.preview")));
  const card = el("div", "lx-card");
  card.setAttribute("aria-live", "polite");
  const big = el("div", "lx-big", LX_WORD[target] || "—");
  big.lang = target;
  card.appendChild(big);
  supportLangs(target, ui, help || null).forEach(c => {
    const row = el("div", "lx-row");
    const w = el("span", "lx-w", LX_WORD[c] || "—");
    w.lang = c;
    row.append(w, el("span", "lx-role", langName(c) + " · " + t(c === ui ? "lx.roleApp" : "lx.roleHelp")));
    card.appendChild(row);
  });
  box.appendChild(card);
  return box;
}
// Titre d'un bloc de langues avec le bouton « ? ».
function lxHead(tag, title) {
  const h = el("div", "lx-head");
  h.append(el(tag, null, title), lxHelpBtn());
  return h;
}
function lxHelpBtn() {
  const b = el("button", "lx-q", "?");
  b.type = "button";
  b.setAttribute("aria-label", t("lx.qBtn"));
  b.title = t("lx.qBtn");
  b.addEventListener("click", lxOpenHelp);
  return b;
}
// Explication des trois langues, avec un exemple adapté à la langue de l'appli.
function lxOpenHelp() {
  const ui = state.settings.uiLang;
  const ex = ui === "ko" ? { app: "ko", target: "fr", help: "en" } : ui === "en" ? { app: "en", target: "ko", help: "fr" } : { app: "fr", target: "ko", help: "en" };
  const body = el("div", "lx-help");
  const ul = el("ul", "lx-list");
  ["lx.qApp", "lx.qTarget", "lx.qHelp"].forEach(k => ul.appendChild(el("li", null, t(k))));
  body.appendChild(ul);
  body.appendChild(el("p", null, t("lx.qEx", { app: langName(ex.app), target: langName(ex.target), help: langName(ex.help) })));
  body.appendChild(lxPreview(ex.target, ex.help, ex.app, false));
  body.appendChild(el("p", "muted lx-more", t("lx.qMore")));
  openModal(t("lx.qTitle"), body, [{ label: t("lx.ok"), kind: "primary" }]);
}
