"use strict";

// === I18N : FUSION DES APPAREILS (ÉTAPE 78) — FRANÇAIS (fr) ===
// Message après une fusion, liste des cartes modifiées des deux côtés, « Reprendre l'autre version », écran « Fusions récentes »
// (js/fusion.js, clés fu.*) ; al.k.merge (journal) ; save.migratedV9 (conversion 8 → 9). Fichier à part, chargé après garde-fr.js.

Object.assign(I18N.fr, {
  "fu.done": "Tes appareils sont fusionnés : rien n'a été écrasé.",
  "fu.title": "Appareils fusionnés",
  "fu.text1": "1 carte modifiée sur deux appareils : la plus récente a été gardée.",
  "fu.text": "{n} cartes modifiées sur deux appareils : la plus récente a été gardée.",
  "fu.textL1": "1 liste modifiée sur deux appareils : la plus récente a été gardée.",
  "fu.textL": "{n} listes modifiées sur deux appareils : la plus récente a été gardée.",
  "fu.hint": "L'autre version est gardée sur cet appareil. Tu peux la reprendre ici, ou plus tard dans Réglages → Compte et données → Fusions récentes.",
  "fu.more": "… et {n} autres, gardées aussi.",
  "fu.take": "Reprendre l'autre version",
  "fu.back": "Revenir à la version d'avant",
  "fu.taken": "Version changée.",
  "fu.takeErr": "Impossible de reprendre cette version.",
  "fu.listBtn": "Fusions récentes",
  "fu.listTitle": "Fusions récentes de cet appareil",
  "fu.listHint": "Quand une même carte a été modifiée sur deux appareils, la version écartée est gardée ici ({n} dernières fusions).",
  "fu.none": "Aucune carte modifiée sur deux appareils pour l'instant.",
  "fu.count": "{n} à voir",
  "fu.why.c.both.local": "Modifiée ici et sur un autre appareil. Gardée : la version de cet appareil.",
  "fu.why.c.both.remote": "Modifiée ici et sur un autre appareil. Gardée : la version de l'autre appareil.",
  "fu.why.c.delThere.local": "Supprimée sur un autre appareil, puis modifiée ici. La carte est gardée.",
  "fu.why.c.delThere.remote": "Modifiée ici, puis supprimée sur un autre appareil. La carte est supprimée.",
  "fu.why.c.delHere.remote": "Supprimée ici, puis modifiée sur un autre appareil. La carte est gardée.",
  "fu.why.c.delHere.local": "Modifiée sur un autre appareil, puis supprimée ici. La carte est supprimée.",
  "fu.why.c.listGone.remote": "Sa liste a été supprimée après l'ajout de cette carte. La carte est supprimée.",
  "fu.why.c.listGone.local": "Carte reprise, avec sa liste.",
  "fu.why.l.both.local": "Liste modifiée ici et sur un autre appareil. Gardée : la version de cet appareil.",
  "fu.why.l.both.remote": "Liste modifiée ici et sur un autre appareil. Gardée : la version de l'autre appareil.",
  "fu.why.l.delThere.local": "Liste supprimée sur un autre appareil, puis modifiée ici. La liste est gardée.",
  "fu.why.l.delThere.remote": "Liste modifiée ici, puis supprimée sur un autre appareil. La liste est supprimée.",
  "fu.why.l.delHere.remote": "Liste supprimée ici, puis modifiée sur un autre appareil. La liste est gardée.",
  "fu.why.l.delHere.local": "Liste modifiée sur un autre appareil, puis supprimée ici. La liste est supprimée.",
  "fu.why.l.revived.local": "Liste supprimée d'un côté, mais une carte y a été ajoutée ensuite : la liste est gardée.",
  "al.k.merge": "Fusion des appareils",
  "save.migratedV9": "Données mises à jour (version 9 : fusion des appareils). Une sauvegarde a été exportée juste avant."
});
