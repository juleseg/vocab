"use strict";

// === I18N : BONS MOMENTS POUR RÉVISER (étape 61) — FRANÇAIS ===
// Rappel du matin, micro-session « 2 minutes », réglages, règle de notification « morning_recall ». Clés mom.*
// Fichier à part (fr.js approche la limite de taille), chargé juste après genre-fr.js.
Object.assign(I18N.fr, {
  "mom.morning": "Rappel du matin",
  "mom.morningSub": "{n} cartes vues hier soir",
  "mom.morningSub1": "1 carte vue hier soir",
  "mom.micro": "2 minutes",
  "mom.microSub": "{n} cartes à réviser",
  "mom.microSub1": "1 carte à réviser",
  "mom.none": "Pas de rappel du matin pour l'instant : rien vu hier soir, ou c'est déjà fait.",
  "mom.off": "Le rappel du matin est coupé (Réglages).",
  "mom.microNone": "Rien à réviser pour l'instant.",
  "mom.hour": "{h} h",
  "mom.set.title": "Rappel du matin",
  "mom.set.on": "Reproposer le matin les cartes vues le soir",
  "mom.set.onHint": "Les cartes vues après {h} sont reproposées le lendemain matin (jusqu'à midi) dans une petite session, sur l'Accueil. Revoir un mot après une nuit de sommeil aide à le retenir.",
  "mom.set.evening": "Le soir commence à",
  "mom.set.notif": "Notification du matin",
  "mom.set.hour": "Heure de la notification",
  "mom.set.notifHint": "Envoyée seulement s'il y a des cartes à revoir, et dans la limite de 2 notifications par jour. Les notifications doivent être activées sur cet appareil (carte Notifications, catégorie Rappels).",
  "mom.set.notifLocal": "La notification du matin demande un compte en ligne.",

  // Administration → Notifications → Automatiques
  "np.rule.morning_recall": "Rappel du matin",
  "np.rule.morning_recall.d": "Le matin, aux comptes qui ont vu des cartes la veille au soir et ne les ont pas encore revues, à l'heure choisie par chaque compte dans ses Réglages (8 h par défaut ; coupée par le compte = rien), avant midi. Catégorie Rappels : compte dans la limite de 2 notifications par jour. La toucher ouvre le rappel du matin.",
  "np.ru.userTime": "Heure choisie par chaque compte (Réglages → Rappel du matin).",
  "np.tpl.morning_recall": "Rappel du matin",
  "np.rule.goal_reminder.d": "Rien révisé aujourd'hui à l'heure choisie. Toucher la notification lance la micro-session « 2 minutes » (5 cartes à réviser)."
});
