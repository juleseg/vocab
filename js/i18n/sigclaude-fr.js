"use strict";

// === I18N : CLAUDE PROPOSE UNE CORRECTION POUR CHAQUE SIGNALEMENT (ÉTAPE 85) — FRANÇAIS (fr) ===
// Clés sgc.* (propriétaire d'une carte personnelle, js/signalements-claude.js ; sgc.meta et queue.kind.report : type de
// demande « report » de la file d'attente), asg.ai.* (propositions et « Appliquer » de l'écran Signalements, interrupteur
// de Administration → Demandes à Claude : js/screens/admin-signalements.js). Fichier à part, chargé après signal-fr.js.
Object.assign(I18N.fr, {
  "sgc.reason": "Correction proposée par Claude après ton signalement",
  "sgc.got1": "Claude propose une correction pour ta carte signalée",
  "sgc.gotN": "Claude propose {n} corrections pour tes cartes signalées",
  "sgc.meta": "{n} signalements",
  "queue.kind.report": "Signalements",
  "asg.ai.fix": "Claude propose",
  "asg.ai.applied": "Correction de Claude appliquée",
  "asg.ai.refused": "Proposition de Claude refusée",
  "asg.ai.none": "Claude : rien à corriger",
  "asg.ai.wait": "Claude proposera une correction à son prochain passage",
  "asg.ai.apply": "Appliquer",
  "asg.ai.refuse": "Refuser",
  "asg.ai.confirmDict": "La carte du dictionnaire commun sera corrigée pour tout le monde. L'ancienne version reste dans l'historique du dictionnaire (retour en arrière possible).",
  "asg.ai.confirmShared": "La carte de la liste partagée sera corrigée pour tous ses membres.",
  "asg.ai.done": "Correction appliquée : {n} signalement(s) traité(s). Les signaleurs verront « Merci, corrigé ».",
  "asg.ai.err.stale": "La carte a changé depuis la proposition : rien n'a été modifié.",
  "asg.ai.err.nofix": "Il n'y a plus de correction à appliquer.",
  "asg.ai.err.bad": "Cette correction ne peut pas être appliquée.",
  "asg.ai.off": "Propositions de Claude désactivées (Administration → Demandes à Claude).",
  "asg.ai.h": "Signalements",
  "asg.ai.help": "À chaque passage, Claude lit les cartes signalées (20 au plus) et propose une correction, ou « rien à corriger ». Dictionnaire commun et listes partagées : la proposition s'affiche dans Signalements, avec « Appliquer » et « Refuser ». Carte personnelle : elle arrive chez son propriétaire, dans « À valider ».",
  "asg.ai.on": "Claude propose des corrections pour les signalements",
  "asg.ai.prevOn": "Activé : les signalements en attente partent au prochain passage de Claude.",
  "asg.ai.prevOff": "Désactivé : rien n'est envoyé à Claude. Les signalements restent à traiter à la main.",
  "asg.ai.saved": "Réglage enregistré.",
  "asg.ai.missing": "Lancez le script SQL de l'étape 85 (supabase-etape85.sql)."
});
