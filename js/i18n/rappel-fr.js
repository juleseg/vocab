"use strict";

// === I18N : RAPPEL RÉGULIER D'ACTIVER LES NOTIFICATIONS (ÉTAPE 74) — FRANÇAIS (fr) ===
// Bandeau de l'Accueil (js/rappel-notifs.js) et carte « Rappel régulier » de Administration → Notifications → « Inviter à
// activer » (js/screens/admin-rappel.js). Clés nrp.* (+ np.al.reminder_set pour le journal). Fichier à part, chargé après
// simple-fr.js. Boutons repris de l'étape 38 : ni.enable, ni.later, ni.ok ; aide « bloquées » : ni.denied.ios / android / desktop.

Object.assign(I18N.fr, {
  "nrp.def": "Active les notifications pour recevoir tes rappels de révision et ne pas perdre ta série.",
  "nrp.denied": "Les notifications sont bloquées pour Vocab sur cet appareil. Pour les réactiver :",
  "nrp.adm.title": "Rappel régulier",
  "nrp.adm.intro": "Petit bandeau sur l'Accueil des appareils qui n'ont pas les notifications (jamais une fenêtre, jamais une notification). « Plus tard » : il revient après la fréquence choisie ; « Activer » réussi : plus de bandeau sur cet appareil. Appli pas installée sur téléphone : « Activer » ouvre le guide d'installation.",
  "nrp.adm.on": "Rappel activé",
  "nrp.adm.every": "Tous les combien de jours ? (1 à 60)",
  "nrp.adm.max": "Rappels au plus par appareil (1 à 20)",
  "nrp.adm.text": "Texte du rappel",
  "nrp.adm.textHint": "Un texte par langue. Une langue laissée vide prend le texte d'une autre langue.",
  "nrp.adm.default": "Remettre les textes par défaut",
  "nrp.adm.preview": "Aperçu",
  "nrp.adm.save": "Enregistrer le rappel",
  "nrp.adm.saved": "Rappel enregistré",
  "nrp.adm.ro": "Lecture seule : il faut la case « Notifications → envoyer » pour changer ces réglages.",
  "nrp.adm.missing": "Lancez le script SQL de l'étape 74 (supabase-etape74.sql) dans Supabase pour régler le rappel. En attendant, l'appli utilise les valeurs par défaut (activé, tous les 7 jours, 5 rappels au plus).",
  "nrp.adm.offline": "Hors connexion : dernières valeurs connues.",
  "nrp.adm.err.bad": "Fréquence de 1 à 60 jours et 1 à 20 rappels.",
  "nrp.adm.err.text": "Texte trop long (300 caractères au plus par langue).",
  "nrp.adm.state": "Actuellement : {s}",
  "nrp.adm.stateOn": "activé, tous les {d} jours, {m} rappels au plus par appareil",
  "nrp.adm.stateOff": "coupé",
  "nrp.adm.stats": "Suivi du rappel",
  "nrp.adm.days": "{n} derniers jours",
  "nrp.st.shown": "Bandeaux affichés",
  "nrp.st.devices": "Appareils",
  "nrp.st.accounts": "Comptes",
  "nrp.st.enabled": "Activées",
  "nrp.st.later": "Plus tard",
  "nrp.st.install": "Guide d'installation",
  "nrp.st.denied": "Refusées",
  "nrp.st.help": "Explications « bloquées »",
  "nrp.al.src": "Rappel régulier",
  "np.al.reminder_set": "Rappel régulier modifié"
});
