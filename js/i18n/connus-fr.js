"use strict";

// === I18N : GÉNÉRER SANS DOUBLONS (ÉTAPE 76) — FRANÇAIS (fr) ===
// Champ « Mots » de « Générer des cartes », bilan des mots déjà connus (js/generer-connus.js, clés gnd.*).
// Fichier à part, chargé après simplif-fr.js.

Object.assign(I18N.fr, {
  "gnd.words": "Mots (facultatif)",
  "gnd.wordsPh": "Un mot par ligne (ou séparés par des virgules)",
  "gnd.wordsHint": "Les mots que tu as déjà (dans tes listes ou le dictionnaire commun) sont copiés tout de suite ; seuls les autres sont envoyés à Claude. Avec une liste de mots, le nombre de cartes ne compte pas.",
  "gnd.tooMany": "{n} mots au plus par demande.",
  "gnd.searching": "Recherche des mots que tu as déjà…",
  "gnd.title": "Mots déjà connus",
  "gnd.known": "{n} mots déjà connus (copiés)",
  "gnd.known1": "1 mot déjà connu (copié)",
  "gnd.send": "{n} envoyés à Claude",
  "gnd.send1": "1 envoyé à Claude",
  "gnd.send0": "rien à envoyer à Claude",
  "gnd.inList": "{n} mots déjà dans cette liste",
  "gnd.inList1": "1 mot déjà dans cette liste",
  "gnd.fromList": "copié de « {l} »",
  "gnd.fromDict": "copié du dictionnaire commun",
  "gnd.toClaude": "Envoyés à Claude :",
  "gnd.noDict": "Hors connexion : le dictionnaire commun n'a pas été consulté.",
  "gnd.goBoth": "Copier et envoyer",
  "gnd.goSend": "Envoyer",
  "gnd.goCopy": "Copier",
  "gnd.done": "{n} cartes copiées dans « {l} ».",
  "gnd.done1": "1 carte copiée dans « {l} ».",
  "gnd.nothing": "Tous ces mots sont déjà dans cette liste : rien à faire.",
  "gnd.seeList": "Voir la liste"
});
