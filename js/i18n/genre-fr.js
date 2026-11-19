"use strict";

// === I18N : GENRE DES NOMS (étape 60) — FRANÇAIS (fr) ===
// Couleurs et symboles du genre, mode « le / la ? », badge « genre manquant ». Clés gd.* et mode.gender
// Fichier à part, chargé après difficiles-fr.js.
Object.assign(I18N.fr, {
  "mode.gender": "le / la ?",
  "gd.m": "Masculin", "gd.f": "Féminin", "gd.mf": "Les deux",
  "gd.missing": "Genre manquant",
  "gd.missingTitle": "Le genre de ce nom n'est pas renseigné : Claude peut le compléter.",
  "gd.ask": "Quel article ?",
  "gd.both": "Les deux sont possibles : ce mot n'est pas noté.",
  "gd.need": "Aucun nom avec un genre renseigné (masculin ou féminin) dans cette sélection.",
  "gd.noProgress": "Entraînement : ta progression n'est pas modifiée, tu gagnes seulement de l'XP.",
  "gd.sum.again": "Refaire les erreurs ({n})",
  "gd.art": "Article", "gd.art.def": "le / la", "gd.art.indef": "un / une", "gd.art.mix": "Mélangé",
  "gd.chipHint": "Choisir l'article du nom (entraînement, sans effet sur la progression).",
  "gd.menu": "Compléter le genre ({n})",
  "gd.ask.title": "Compléter le genre",
  "gd.ask.text1": "1 nom n'a pas de genre. Demander à Claude de le compléter ? La proposition arrivera dans « À valider ».",
  "gd.ask.text": "{n} noms n'ont pas de genre. Demander à Claude de les compléter ? Les propositions arriveront dans « À valider ».",
  "gd.ask.noQueue": "La file d'attente n'est pas disponible : tu peux préparer une demande à copier pour Claude.",
  "gd.ask.prepare": "Préparer pour Claude",
  "gd.set.title": "Genre des noms",
  "gd.set.colors": "Couleurs du genre",
  "gd.set.colorsHint": "Bleu = masculin, rouge = féminin, violet = les deux. Pour le français, l'italien, l'espagnol et le portugais.",
  "gd.set.symbols": "Mode daltonien (♂ ♀ ⚥)",
  "gd.set.symbolsHint": "Ajoute un petit symbole à côté du mot, même si les couleurs sont coupées.",
  "gd.set.missing1": "1 nom n'a pas de genre renseigné.",
  "gd.set.missing": "{n} noms n'ont pas de genre renseigné.",
  "gd.set.ask": "Demander à Claude de compléter"
});
