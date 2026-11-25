"use strict";

// === I18N : VERSION MINIMALE ACCEPTÉE PAR LE SERVEUR (ÉTAPE 88) — FRANÇAIS (fr) ===
// Écran « Mise à jour nécessaire » (js/version-minimale.js) et carte « Version minimale acceptée » de
// Administration → Notifications → Versions (js/screens/admin-versionmin.js). Chargé après connlocal-fr.js.
// Réutilise : rl.updating, rl.offline, account.logout, cancel, admin.loading.
Object.assign(I18N.fr, {
  "vm.title": "Mise à jour nécessaire",
  "vm.text": "Cette version de l'appli ({v}) est trop ancienne : le serveur demande la version {n} ou plus.",
  "vm.textNoMin": "Cette version de l'appli ({v}) est trop ancienne pour le serveur.",
  "vm.keep": "Tes données restent sur cet appareil : rien n'est supprimé et tu restes connecté. Ce que tu as fait partira après la mise à jour.",
  "vm.reload": "Recharger l'appli",
  "vm.still": "C'est toujours la version {v} : la nouvelle version n'est peut-être pas encore disponible. Réessaie dans quelques minutes.",
  "vm.back": "Version de nouveau acceptée : la synchro reprend.",
  "vm.logoutSure": "Confirmer : se déconnecter",
  "vm.ad.h": "Version minimale acceptée",
  "vm.ad.help": "Le serveur refuse les appareils plus anciens que cette version, et ceux qui ne disent pas leur version (avant la 88) : ils ne peuvent plus lire ni envoyer leurs données avant d'être à jour. 0 = désactivé. Le compte admin n'est jamais bloqué.",
  "vm.ad.cur": "Réglage actuel",
  "vm.ad.off": "désactivé (0)",
  "vm.ad.on": "version {n} ou plus",
  "vm.ad.by": "réglé par {who} le {date}",
  "vm.ad.seen": "Cet appareil",
  "vm.ad.seenOk": "le serveur reçoit bien sa version ({v})",
  "vm.ad.seenNo": "le serveur ne reçoit pas sa version",
  "vm.ad.notPlugged": "Le contrôle n'est pas complet sur le serveur : relancer le script SQL de l'étape 88. En attendant, le réglage n'est pas sûr.",
  "vm.ad.label": "Version minimale (0 = désactivé)",
  "vm.ad.max": "Au plus {v} : la version de cet appareil.",
  "vm.ad.maxNone": "Le serveur ne reçoit pas la version de cet appareil : seul 0 peut être réglé d'ici.",
  "vm.ad.prev": "Avec {n} : {b} appareil(s) actif(s) seraient bloqués ({a} compte(s)), sur {t} vus ces 30 derniers jours.",
  "vm.ad.prev0": "Avec 0 : aucun appareil n'est bloqué.",
  "vm.ad.prevNone": "Avec {n} : aucun des {t} appareils vus ces 30 derniers jours ne serait bloqué.",
  "vm.ad.prevUnknown": "Nombre d'appareils bloqués : calcul impossible pour l'instant.",
  "vm.ad.prevWait": "Calcul…",
  "vm.ad.invalid": "Entre un nombre entier de 0 à {v}.",
  "vm.ad.save": "Enregistrer",
  "vm.ad.confirmTitle": "Version minimale : {n}",
  "vm.ad.confirm": "{b} appareil(s) actif(s) seraient bloqués ({a} compte(s)).",
  "vm.ad.confirmNone": "Aucun appareil actif ne serait bloqué.",
  "vm.ad.confirmUnknown": "Nombre d'appareils bloqués inconnu (calcul impossible).",
  "vm.ad.confirmHint": "Appareils vus ces 30 derniers jours. Un appareil bloqué ne peut plus lire ni envoyer ses données avant d'être à jour ; rien n'est supprimé.",
  "vm.ad.confirmOff": "Désactiver le blocage ? Tous les appareils seront de nouveau acceptés par le serveur.",
  "vm.ad.go": "Bloquer avant la version {n}",
  "vm.ad.goOff": "Désactiver",
  "vm.ad.saved": "Version minimale réglée : {n}.",
  "vm.ad.savedOff": "Blocage désactivé : toutes les versions sont acceptées.",
  "vm.ad.missing": "Lancez le script SQL de l'étape 88 pour régler une version minimale.",
  "vm.ad.err.vm_self": "Refusé : la version demandée est plus haute que celle de cet appareil, ou le serveur ne reçoit pas sa version.",
  "vm.ad.err.vm_bad": "Valeur refusée (nombre entier de 0 à 100000)."
});
