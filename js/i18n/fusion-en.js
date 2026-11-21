"use strict";

// === I18N : FUSION DES APPAREILS (ÉTAPE 78) — ENGLISH (en) ===
// Message après une fusion, liste des cartes modifiées des deux côtés, « Reprendre l'autre version », écran « Fusions récentes »
// (js/fusion.js, clés fu.*) ; al.k.merge (journal) ; save.migratedV9 (conversion 8 → 9). Fichier à part, chargé après garde-en.js.

Object.assign(I18N.en, {
  "fu.done": "Your devices are merged: nothing was overwritten.",
  "fu.title": "Devices merged",
  "fu.text1": "1 card was edited on two devices: the newest was kept.",
  "fu.text": "{n} cards were edited on two devices: the newest was kept.",
  "fu.textL1": "1 list was edited on two devices: the newest was kept.",
  "fu.textL": "{n} lists were edited on two devices: the newest was kept.",
  "fu.hint": "The other version is kept on this device. Take it back here, or later in Settings → Account and data → Recent merges.",
  "fu.more": "… and {n} more, kept too.",
  "fu.take": "Take the other version",
  "fu.back": "Go back to the previous version",
  "fu.taken": "Version changed.",
  "fu.takeErr": "This version can't be taken back.",
  "fu.listBtn": "Recent merges",
  "fu.listTitle": "Recent merges on this device",
  "fu.listHint": "When the same card was edited on two devices, the version set aside is kept here (last {n} merges).",
  "fu.none": "No card edited on two devices so far.",
  "fu.count": "{n} to check",
  "fu.why.c.both.local": "Edited here and on another device. Kept: this device's version.",
  "fu.why.c.both.remote": "Edited here and on another device. Kept: the other device's version.",
  "fu.why.c.delThere.local": "Deleted on another device, then edited here. The card is kept.",
  "fu.why.c.delThere.remote": "Edited here, then deleted on another device. The card is deleted.",
  "fu.why.c.delHere.remote": "Deleted here, then edited on another device. The card is kept.",
  "fu.why.c.delHere.local": "Edited on another device, then deleted here. The card is deleted.",
  "fu.why.c.listGone.remote": "Its list was deleted after this card was added. The card is deleted.",
  "fu.why.c.listGone.local": "Card taken back, with its list.",
  "fu.why.l.both.local": "List edited here and on another device. Kept: this device's version.",
  "fu.why.l.both.remote": "List edited here and on another device. Kept: the other device's version.",
  "fu.why.l.delThere.local": "List deleted on another device, then edited here. The list is kept.",
  "fu.why.l.delThere.remote": "List edited here, then deleted on another device. The list is deleted.",
  "fu.why.l.delHere.remote": "List deleted here, then edited on another device. The list is kept.",
  "fu.why.l.delHere.local": "List edited on another device, then deleted here. The list is deleted.",
  "fu.why.l.revived.local": "List deleted on one side, but a card was added to it afterwards: the list is kept.",
  "al.k.merge": "Devices merged",
  "save.migratedV9": "Data updated (version 9: merging devices). A backup was exported just before."
});
