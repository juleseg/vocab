"use strict";

// === I18N : CLAUDE REMPLIT ET MET À JOUR TOUT SEUL (ÉTAPE 80) — FRANÇAIS (fr) ===
// Chargé après synchro-fr.js. amj.* = mise à jour automatique (js/auto-maj.js, js/screens/admin-auto.js) ; cln.* = cartes
// ajoutées par Claude (js/claude-nouveau.js) ; pvw.* = lignes ignorées dans « À valider » (js/screens/a-valider.js).
// Textes remplacés ici (c'est là qu'il faut les changer désormais) : gen.help, tuto.pending.text.
Object.assign(I18N.fr, {
  "amj.tag": "Claude complète",
  "amj.busy": "Claude complète {n} cartes",
  "amj.busy1": "Claude complète 1 carte",
  "amj.sheet": "Claude complète tes cartes tout seul : rien à demander.",
  "cln.tag": "Ajoutée par Claude",
  "cln.note": "{n} cartes ajoutées par Claude",
  "cln.note1": "1 carte ajoutée par Claude",
  "cln.dot": "{n} cartes ajoutées par Claude",
  "cln.dot1": "1 carte ajoutée par Claude",
  "cln.msg": "Claude a ajouté {n} cartes à « {list} ».",
  "cln.msg1": "Claude a ajouté 1 carte à « {list} ».",
  "cln.msgN": "Claude a ajouté {n} cartes à {l} listes.",
  "cln.see": "Voir",
  "pvw.title": "Lignes ignorées",
  "pvw.bad": "{n} à corriger : il manque le mot ou une case obligatoire (la ligne reste)",
  "pvw.value": "{n} : valeur non valide (la ligne reste)",
  "pvw.dup": "{n} : déjà dans la liste (ligne retirée)",
  "pvw.stale": "{n} : case déjà remplie ou changée entre-temps (ligne retirée)",
  "pvw.gone": "{n} : la liste n'existe plus (ligne retirée)",
  "pvw.hint": "Pour une ligne qui reste : coche-la, touche « Modifier », corrige-la, puis « Accepter » — ou « Refuser ».",
  "pvw.genPending": "{n} groupes de cartes sont à corriger dans « À valider ».",
  "pvw.genPending1": "1 groupe de cartes est à corriger dans « À valider ».",
  "gen.help": "Claude crée des cartes complètes (traductions, nature, exemple) et les ajoute directement à la liste. Tu peux les modifier ensuite.",
  "tuto.pending.text": "« À valider » est dans « Plus », en bas à droite, et en raccourci sur l'accueil. « Plus » contient aussi Stats, Réglages et « Se déconnecter ». Claude complète tes cartes tout seul (traductions, nature, exemple) ; tu peux aussi ouvrir une liste et toucher « 🤖 Claude » puis « Mettre à jour ».",
  // Administration → Demandes à Claude
  "amj.ad.h": "Mise à jour automatique",
  "amj.ad.help": "L'appli dépose toute seule une demande à Claude dès qu'il manque des cases sur des cartes (après un ajout, un import, une génération, et au lancement). Les réponses sont appliquées directement, sans écraser ce que l'utilisateur a écrit. Le bouton « Mettre à jour » reste disponible.",
  "amj.ad.on": "Activer la mise à jour automatique pour tous les comptes",
  "amj.ad.max": "Nombre maximum de cartes par jour et par compte",
  "amj.ad.unit": "cartes par jour et par compte",
  "amj.ad.prevOn": "Activée : au plus {n} cartes par jour et par compte. Au-delà, les cartes attendent le lendemain, sans erreur.",
  "amj.ad.prevOff": "Coupée : plus rien d'automatique (les demandes faites à la main restent possibles).",
  "amj.ad.default": "(valeur par défaut, pas encore enregistrée)",
  "amj.ad.invalid": "Nombre entier entre {a} et {b}.",
  "amj.ad.saved": "Réglage enregistré",
  "amj.ad.missing": "Lancez le script SQL de l'étape 80 (supabase-etape80.sql). Sans lui, rien n'est automatique.",
  "amj.ad.used": "Mon compte aujourd'hui : {n} cartes demandées à Claude.",
  "amj.ad.adminOnly": "Seul l'administrateur peut changer ce réglage."
});
