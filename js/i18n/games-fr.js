"use strict";

// === I18N : JEUX D'ENTRAÎNEMENT (étape 42) — FRANÇAIS ===
// Fichier à part (fr.js approche la limite de taille), chargé après les fichiers de langue principaux.
// Choix d'une session (js/screens/reviser.js), jeux (js/modes/jeux.js, qcm.js, course.js, paires.js, ordre.js),
// Réglages → Audio (sons des jeux), journal d'activité (événement game).
Object.assign(I18N.fr, {
  "mode.mcq": "QCM", "mode.race": "Course 60 s", "mode.pairs": "Paires", "mode.order": "Remettre en ordre",
  "review.games": "Jeux d'entraînement",
  "review.gamesHint": "Vocabulaire seulement. Une bonne réponse dans un jeu ne fait pas monter la carte de boîte ; une erreur compte comme « Hésité ».",
  "gm.order.kind": "À remettre en ordre", "gm.order.words": "Mots", "gm.order.sents": "Phrases", "gm.order.both": "Les deux",
  "gm.need.title": "Pas assez de cartes",
  "gm.need.mcq": "Le QCM a besoin d'au moins 4 cartes de vocabulaire avec des réponses différentes dans une même liste. Ajoute des mots à la liste ou choisis-en une plus grande.",
  "gm.need.race": "La Course 60 s a besoin d'au moins 4 cartes de vocabulaire avec des réponses différentes dans une même liste. Ajoute des mots à la liste ou choisis-en une plus grande.",
  "gm.need.pairs": "Les Paires ont besoin d'au moins 6 cartes de vocabulaire, avec des mots et des traductions différents. Ajoute des mots ou choisis une liste plus grande.",
  "gm.need.order": "Rien à remettre en ordre ici : il faut des mots d'au moins 2 lettres, ou des phrases d'exemple de 3 à 12 mots.",
  "gm.q": "Question {i} / {n}",
  "gm.mcq.pick": "Choisis la bonne réponse ({lang})",
  "gm.next": "Suivant", "gm.quit": "Arrêter la partie",
  "gm.right": "Bonne réponse !", "gm.wrong": "Mauvaise réponse",
  "gm.sec": "{s} s", "gm.minsec": "{m} min {s}",
  "gm.race.best": "Record : {n}",
  "gm.timeUp": "Temps écoulé !",
  "gm.pairs.hint": "Touche un mot, puis sa traduction.",
  "gm.pairs.found": "{n} / {m} paires",
  "gm.order.word": "Remets les lettres dans l'ordre ({lang})",
  "gm.order.sent": "Remets les mots de la phrase dans l'ordre ({lang})",
  "gm.order.with": "Phrase avec : {w}",
  "gm.order.hint": "Indice", "gm.order.check": "Vérifier", "gm.order.answer": "Réponse :",
  "gm.sum.title": "Partie terminée",
  "gm.sum.score": "Score", "gm.sum.pairs": "Paires", "gm.sum.time": "Temps", "gm.sum.errors": "Erreurs", "gm.sum.record": "Record", "gm.sum.hints": "Indices",
  "gm.sum.newRecord": "Nouveau record !",
  "gm.sum.noErr": "Aucune erreur, bravo !",
  "gm.sum.replay": "Rejouer",
  "gm.sum.reviewErrors": "Revoir les erreurs ({n}) en mode Cartes",
  "gm.record.pop": "Nouveau record : {n} !",
  "gm.sounds": "Sons des jeux",
  "gm.soundsHint": "Petits sons pour les bonnes et mauvaises réponses dans les jeux.",
  "al.k.game": "Jeu",
  "al.s.game": "{game} · score {s} · {n} cartes · {e} erreurs · {min} min"
});
