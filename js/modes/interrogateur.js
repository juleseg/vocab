"use strict";

// === MODE INTERROGATEUR ===
// Pour une 2e personne qui tient le téléphone : question en grand, réponse visible pour l'interrogateur
// (bouton Masquer/Afficher, choix gardé tant que l'appli est ouverte), exemple sous la réponse,
// 3 gros boutons Su / À revoir / Pas su (libellés : clés ans.*, étape 56). Fin de session : renderSessionSummary().
let quizHideAnswer = false;

function renderQuizSession(root) {
  const s = rv.s;
  while (s.queue.length && !sessionCard(s.queue[0].id)) s.queue.shift(); // carte supprimée entre-temps
  if (!s.queue.length) { renderSessionSummary(root); return; }
  const item = s.queue[0];
  const c = sessionCard(item.id);
  const f = cardFaces(c, item.dir);
  let a0Class = "";

  audioCard(s, c);
  root.appendChild(audioToggle());
  const meta = el("div", "meta-row");
  meta.append(el("span", null, t("cards.left", { n: s.queue.length })), el("span", null, t("cat." + Leitner.category(c))));
  root.appendChild(meta);
  if (typeof Sgl !== "undefined") Sgl.flag(meta.lastChild, c, "review");   // étape 84 : 🚩 signaler la carte
  HardUI.sessionExtras(root, c, item);   // badge « Mot difficile » et « Mon astuce » (étape 57)

  // Question (en grand)
  const q = el("div", "card qz-q");
  q.appendChild(el("div", "sw-lang", f.q.lang));
  const qImg = Images.place(c, item.dir, "q", "ci-mid");   // image côté question (étape 49)
  if (qImg) q.appendChild(qImg);
  q.appendChild(faceMain("qz-main", f.q, c, true));
  const qs = faceSub("qz-sub", f.q, c, true);
  if (qs) q.appendChild(qs);
  faceExtras(f.q).forEach(n => q.appendChild(n));
  if (!isVocab(c)) { q.classList.add("ty-" + cardType(c)); a0Class = "ty-" + cardType(c); }
  const qsp = spkItemsRow(f.q.items);
  if (qsp) q.appendChild(qsp);
  root.appendChild(q);
  autoSpeak(s, "q", f.q.items, f.lg); // pas de retournement ici : seule la question est lue automatiquement

  // Réponse pour l'interrogateur (+ exemple), masquable
  const a = el("div", "card qz-ans");
  const head = el("div", "qz-head");
  head.appendChild(el("div", "qz-lbl", t("quiz.answer", { lang: f.a.lang })));
  const tg = el("button", "link-btn", t(quizHideAnswer ? "quiz.show" : "quiz.hide"));
  tg.addEventListener("click", () => { quizHideAnswer = !quizHideAnswer; renderReview(); });
  const hr = el("div", "qz-head-r");
  const asp = quizHideAnswer ? null : speakItemsBtn(f.a.items);
  if (asp) hr.appendChild(asp);
  hr.appendChild(tg);
  head.appendChild(hr);
  a.appendChild(head);
  if (quizHideAnswer) {
    a.appendChild(el("div", "qz-hidden", t("quiz.hidden")));
  } else {
    const aImg = Images.place(c, item.dir, "a", "ci-mid");   // image côté réponse (étape 49), cachée avec la réponse
    if (aImg) a.appendChild(aImg);
    a.appendChild(faceMain("qz-amain", f.a, c, true));
    const as = faceSub("qz-asub", f.a, c, true);
    if (as) a.appendChild(as);
    faceExtras(f.a).forEach(n => a.appendChild(n));
    if (a0Class) a.classList.add(a0Class);
    const ex = exampleNode(c, "qz-ex", f.lg); if (ex) a.appendChild(ex);   // exemple + traductions (étape 35)
  }
  root.appendChild(a);

  // Notation
  const g = el("div", "qz-btns");
  [["known", "ok"], ["review", "warn"], ["unknown", "danger"]].forEach(([r, cls]) => {
    const b = el("button", "btn " + cls, t("ans." + r));
    b.addEventListener("click", () => gradeCurrent(r));
    g.appendChild(b);
  });
  root.appendChild(g);

  const quit = el("button", "link-btn", t("cards.quit"));
  quit.addEventListener("click", () => { s.queue = []; renderReview(); });
  root.appendChild(quit);
}
