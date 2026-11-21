"use strict";

// === I18N : GÉNÉRER SANS DOUBLONS (ÉTAPE 76) — ANGLAIS (en) ===
// Champ « Mots » de « Générer des cartes », bilan des mots déjà connus (js/generer-connus.js, clés gnd.*).
// Fichier à part, chargé après simplif-en.js.

Object.assign(I18N.en, {
  "gnd.words": "Words (optional)",
  "gnd.wordsPh": "One word per line (or separated by commas)",
  "gnd.wordsHint": "Words you already have (in your lists or the shared dictionary) are copied right away; only the others are sent to Claude. With a word list, the number of cards is not used.",
  "gnd.tooMany": "At most {n} words per request.",
  "gnd.searching": "Looking for words you already have…",
  "gnd.title": "Words you already know",
  "gnd.known": "{n} words already known (copied)",
  "gnd.known1": "1 word already known (copied)",
  "gnd.send": "{n} sent to Claude",
  "gnd.send1": "1 sent to Claude",
  "gnd.send0": "nothing to send to Claude",
  "gnd.inList": "{n} words already in this list",
  "gnd.inList1": "1 word already in this list",
  "gnd.fromList": "copied from “{l}”",
  "gnd.fromDict": "copied from the shared dictionary",
  "gnd.toClaude": "Sent to Claude:",
  "gnd.noDict": "Offline: the shared dictionary was not checked.",
  "gnd.goBoth": "Copy and send",
  "gnd.goSend": "Send",
  "gnd.goCopy": "Copy",
  "gnd.done": "{n} cards copied to “{l}”.",
  "gnd.done1": "1 card copied to “{l}”.",
  "gnd.nothing": "All these words are already in this list: nothing to do.",
  "gnd.seeList": "See the list"
});
