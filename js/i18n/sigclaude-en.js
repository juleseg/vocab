"use strict";

// === I18N : CLAUDE PROPOSE UNE CORRECTION POUR CHAQUE SIGNALEMENT (ÉTAPE 85) — ENGLISH (en) ===
// Clés sgc.* (propriétaire d'une carte personnelle, js/signalements-claude.js ; sgc.meta et queue.kind.report : type de
// demande « report » de la file d'attente), asg.ai.* (propositions et « Appliquer » de l'écran Signalements, interrupteur
// de Administration → Demandes à Claude : js/screens/admin-signalements.js). Fichier à part, chargé après signal-en.js.
Object.assign(I18N.en, {
  "sgc.reason": "Fix suggested by Claude after your report",
  "sgc.got1": "Claude suggests a fix for the card you reported",
  "sgc.gotN": "Claude suggests {n} fixes for the cards you reported",
  "sgc.meta": "{n} reports",
  "queue.kind.report": "Reports",
  "asg.ai.fix": "Claude suggests",
  "asg.ai.applied": "Claude's fix applied",
  "asg.ai.refused": "Claude's suggestion declined",
  "asg.ai.none": "Claude: nothing to fix",
  "asg.ai.wait": "Claude will suggest a fix on its next run",
  "asg.ai.apply": "Apply",
  "asg.ai.refuse": "Decline",
  "asg.ai.confirmDict": "The shared dictionary card will be fixed for everyone. The previous version stays in the dictionary history (it can be reverted).",
  "asg.ai.confirmShared": "The shared list card will be fixed for all its members.",
  "asg.ai.done": "Fix applied: {n} report(s) handled. Reporters will see \"Thanks, fixed\".",
  "asg.ai.err.stale": "The card has changed since the suggestion: nothing was modified.",
  "asg.ai.err.nofix": "There is no fix left to apply.",
  "asg.ai.err.bad": "This fix cannot be applied.",
  "asg.ai.off": "Claude's suggestions are off (Administration → Claude requests).",
  "asg.ai.h": "Reports",
  "asg.ai.help": "On each run, Claude reads the reported cards (20 at most) and suggests one fix, or \"nothing to fix\". Shared dictionary and shared lists: the suggestion appears in Reports, with \"Apply\" and \"Decline\". Personal card: it goes to its owner, in \"Pending\".",
  "asg.ai.on": "Claude suggests fixes for reported cards",
  "asg.ai.prevOn": "On: waiting reports are sent on Claude's next run.",
  "asg.ai.prevOff": "Off: nothing is sent to Claude. Reports must be handled by hand.",
  "asg.ai.saved": "Setting saved.",
  "asg.ai.missing": "Run the step 85 SQL script (supabase-etape85.sql)."
});
