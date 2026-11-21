"use strict";

// === I18N : VERSIONS — APPAREILS RESTÉS SUR UNE VERSION (ÉTAPE 81) — FRANÇAIS (fr) ===
// Administration → Notifications → Versions : liste des versions cliquables, liste des appareils d'une version.
// Fichier à part, chargé après auto-fr.js. Réutilise : al.dev.*, al.installed, al.browser, dash.csv, admin.loading, rl.vN, rl.vUnknown.
Object.assign(I18N.fr, {
  "rvd.row": "{d} appareil(s) · {a} compte(s)",
  "rvd.rowDev": "{d} appareil(s)",
  "rvd.tapHint": "Touche une version pour voir ses appareils.",
  "rvd.back": "‹ Retour aux versions",
  "rvd.title": "Appareils en {v}",
  "rvd.sum": "{d} appareil(s) · {a} compte(s)",
  "rvd.f30": "Vus ces 30 derniers jours",
  "rvd.fAll": "Tous les appareils",
  "rvd.search": "Rechercher un compte",
  "rvd.sortNew": "Plus récentes d'abord",
  "rvd.sortOld": "Plus anciennes d'abord",
  "rvd.sort": "Tri par dernière visite",
  "rvd.seen": "Dernière visite : {date} · {ago}",
  "rvd.today": "aujourd'hui",
  "rvd.yesterday": "hier",
  "rvd.daysAgo": "il y a {n} jours",
  "rvd.blocked": "bloqué",
  "rvd.empty": "Aucun appareil sur cette version.",
  "rvd.empty30": "Aucun appareil vu ces 30 derniers jours sur cette version. Essaie « Tous les appareils ».",
  "rvd.noMatch": "Aucun compte ne correspond à « {q} ».",
  "rvd.shown": "{n} affiché(s) sur {t}",
  "rvd.more": "Seulement les {n} appareils vus le plus récemment sont listés.",
  "rvd.readOnly": "Lecture seule : aucune action sur les appareils.",
  "rvd.missing": "Lancez le script SQL de l'étape 81 (claude/supabase-etape81.sql) pour voir la liste des appareils.",
  "rvd.c.account": "Compte", "rvd.c.blocked": "Bloqué", "rvd.c.type": "Type d'appareil", "rvd.c.os": "Système",
  "rvd.c.browser": "Navigateur", "rvd.c.installed": "Appli installée", "rvd.c.lang": "Langue", "rvd.c.first": "Première visite",
  "rvd.c.last": "Dernière visite", "rvd.c.days": "Jours depuis la dernière visite", "rvd.c.version": "Version",
  "rvd.yes": "oui", "rvd.no": "non"
});
