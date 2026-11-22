"use strict";

// === I18N : CONNEXION HORS LIGNE FIABLE (ÉTAPE 86) — FRANÇAIS (fr) ===
// Clés cxl.* (js/connexion-locale.js) : phrase de l'écran de connexion hors ligne, messages du PIN vérifié sur l'appareil
// (compte inconnu ici, PIN faux, attente), retour d'Internet, session refusée par le serveur, fenêtre « PIN changé ».
// Fichier à part, chargé après sigclaude-fr.js.
Object.assign(I18N.fr, {
  "cxl.offHint": "Hors connexion : avec ton PIN, tu peux ouvrir un compte déjà connecté sur cet appareil.",
  "cxl.err.unknown": "Hors connexion : « {id} » ne peut pas s'ouvrir sans Internet sur cet appareil. Connecte-toi d'abord une fois en ligne avec ton PIN.",
  "cxl.err.wrong": "PIN incorrect. Essais restants avant une attente : {n}.",
  "cxl.err.wait": "Trop d'erreurs de PIN hors connexion. Réessaie dans {min} min, ou connecte-toi à Internet.",
  "cxl.opened": "Ouvert hors connexion. La synchro reprendra au retour d'Internet.",
  "cxl.back": "Connexion rétablie : ton compte est de nouveau connecté.",
  "cxl.refused": "Ta session a été fermée par le serveur (PIN changé ou compte modifié). Reconnecte-toi avec ton PIN. Tes données restent sur cet appareil.",
  "cxl.pin.title": "PIN changé",
  "cxl.pin.text": "Le PIN de « {id} » a été changé ailleurs. Saisis le nouveau PIN pour reprendre la synchro. Ce que tu as fait hors connexion est gardé sur cet appareil.",
  "cxl.pin.label": "Nouveau PIN",
  "cxl.pin.ok": "Valider",
  "cxl.pin.wrong": "PIN incorrect.",
  "cxl.pin.net": "Connexion impossible pour l'instant. Réessaie dans un moment."
});
