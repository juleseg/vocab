"use strict";

// === I18N : REGULAR REMINDER TO TURN ON NOTIFICATIONS (ÉTAPE 74) — ENGLISH (en) ===
// Home banner (js/rappel-notifs.js) and the “Regular reminder” card of Administration → Notifications → “Invite to turn on”
// (js/screens/admin-rappel.js). Keys nrp.* (+ np.al.reminder_set for the log). Separate file, loaded after simple-en.js.
// Buttons from step 38: ni.enable, ni.later, ni.ok; “blocked” help: ni.denied.ios / android / desktop.

Object.assign(I18N.en, {
  "nrp.def": "Turn on notifications to get your review reminders and keep your streak.",
  "nrp.denied": "Notifications are blocked for Vocab on this device. To turn them back on:",
  "nrp.adm.title": "Regular reminder",
  "nrp.adm.intro": "A small banner on Home for devices without notifications (never a pop-up, never a push notification). “Later”: it comes back after the chosen interval; a successful “Turn on”: no more banner on that device. App not installed on a phone: “Turn on” opens the install guide.",
  "nrp.adm.on": "Reminder on",
  "nrp.adm.every": "Every how many days? (1 to 60)",
  "nrp.adm.max": "Reminders per device at most (1 to 20)",
  "nrp.adm.text": "Reminder text",
  "nrp.adm.textHint": "One text per language. A language left empty uses the text of another language.",
  "nrp.adm.default": "Reset to default texts",
  "nrp.adm.preview": "Preview",
  "nrp.adm.save": "Save reminder",
  "nrp.adm.saved": "Reminder saved",
  "nrp.adm.ro": "Read only: you need the “Notifications → send” box to change these settings.",
  "nrp.adm.missing": "Run the step 74 SQL script (supabase-etape74.sql) in Supabase to set up the reminder. Until then, the app uses the defaults (on, every 7 days, 5 reminders at most).",
  "nrp.adm.offline": "Offline: last known values.",
  "nrp.adm.err.bad": "Interval from 1 to 60 days and 1 to 20 reminders.",
  "nrp.adm.err.text": "Text too long (300 characters at most per language).",
  "nrp.adm.state": "Currently: {s}",
  "nrp.adm.stateOn": "on, every {d} days, {m} reminders at most per device",
  "nrp.adm.stateOff": "off",
  "nrp.adm.stats": "Reminder tracking",
  "nrp.adm.days": "Last {n} days",
  "nrp.st.shown": "Banners shown",
  "nrp.st.devices": "Devices",
  "nrp.st.accounts": "Accounts",
  "nrp.st.enabled": "Turned on",
  "nrp.st.later": "Later",
  "nrp.st.install": "Install guide",
  "nrp.st.denied": "Refused",
  "nrp.st.help": "“Blocked” explanations",
  "nrp.al.src": "Regular reminder",
  "np.al.reminder_set": "Regular reminder changed"
});
