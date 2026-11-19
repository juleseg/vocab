"use strict";

// === I18N: GOOD MOMENTS TO REVIEW (step 61) — ENGLISH ===
// Morning recall, "2 minutes" micro-session, settings, notification rule "morning_recall". Keys mom.*
// Separate file (en.js is close to the size limit), loaded right after genre-en.js.
Object.assign(I18N.en, {
  "mom.morning": "Morning recall",
  "mom.morningSub": "{n} cards seen last night",
  "mom.morningSub1": "1 card seen last night",
  "mom.micro": "2 minutes",
  "mom.microSub": "{n} cards to review",
  "mom.microSub1": "1 card to review",
  "mom.none": "No morning recall right now: nothing seen last night, or it's already done.",
  "mom.off": "The morning recall is turned off (Settings).",
  "mom.microNone": "Nothing to review right now.",
  "mom.hour": "{h}:00",
  "mom.set.title": "Morning recall",
  "mom.set.on": "Show again in the morning the cards seen in the evening",
  "mom.set.onHint": "Cards seen after {h} come back the next morning (until noon) in a short session, on the Home screen. Seeing a word again after a night's sleep helps you remember it.",
  "mom.set.evening": "Evening starts at",
  "mom.set.notif": "Morning notification",
  "mom.set.hour": "Notification time",
  "mom.set.notifHint": "Sent only if there are cards to review again, and within the limit of 2 notifications per day. Notifications must be turned on on this device (Notifications card, Reminders category).",
  "mom.set.notifLocal": "The morning notification needs an online account.",

  // Administration → Notifications → Automatic
  "np.rule.morning_recall": "Morning recall",
  "np.rule.morning_recall.d": "In the morning, to accounts that saw cards the evening before and haven't reviewed them again yet, at the time each account chose in its Settings (8:00 by default; turned off by the account = nothing), before noon. Reminders category: counts in the limit of 2 notifications per day. Tapping it opens the morning recall.",
  "np.ru.userTime": "Time chosen by each account (Settings → Morning recall).",
  "np.tpl.morning_recall": "Morning recall",
  "np.rule.goal_reminder.d": "Nothing reviewed today at the chosen time. Tapping the notification starts the \"2 minutes\" micro-session (5 cards to review)."
});
