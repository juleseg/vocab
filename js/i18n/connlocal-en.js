"use strict";

// === I18N : CONNEXION HORS LIGNE FIABLE (ÉTAPE 86) — ANGLAIS (en) ===
// Clés cxl.* (js/connexion-locale.js) : phrase de l'écran de connexion hors ligne, messages du PIN vérifié sur l'appareil
// (compte inconnu ici, PIN faux, attente), retour d'Internet, session refusée par le serveur, fenêtre « PIN changé ».
// Fichier à part, chargé après sigclaude-en.js.
Object.assign(I18N.en, {
  "cxl.offHint": "You're offline: with your PIN, you can open an account already signed in on this device.",
  "cxl.err.unknown": "You're offline: \"{id}\" can't be opened without the Internet on this device. Sign in online once with your PIN first.",
  "cxl.err.wrong": "Wrong PIN. Tries left before a wait: {n}.",
  "cxl.err.wait": "Too many wrong PINs offline. Try again in {min} min, or connect to the Internet.",
  "cxl.opened": "Opened offline. Sync will resume when the Internet is back.",
  "cxl.back": "Back online: your account is connected again.",
  "cxl.refused": "Your session was closed by the server (PIN changed or account modified). Sign in again with your PIN. Your data stays on this device.",
  "cxl.pin.title": "PIN changed",
  "cxl.pin.text": "The PIN for \"{id}\" was changed elsewhere. Enter the new PIN to resume sync. What you did offline is kept on this device.",
  "cxl.pin.label": "New PIN",
  "cxl.pin.ok": "Confirm",
  "cxl.pin.wrong": "Wrong PIN.",
  "cxl.pin.net": "Can't connect right now. Try again in a moment."
});
