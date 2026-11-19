"use strict";

// === I18N: NOUN GENDER (step 60) — ENGLISH (en) ===
// Gender colours and symbols, "le / la ?" mode, "gender missing" badge. Keys gd.* and mode.gender
// Separate file, loaded after difficiles-en.js.
Object.assign(I18N.en, {
  "mode.gender": "le / la ?",
  "gd.m": "Masculine", "gd.f": "Feminine", "gd.mf": "Both",
  "gd.missing": "Gender missing",
  "gd.missingTitle": "The gender of this noun is not filled in: Claude can complete it.",
  "gd.ask": "Which article?",
  "gd.both": "Both are possible: this word is not scored.",
  "gd.need": "No noun with a filled-in gender (masculine or feminine) in this selection.",
  "gd.noProgress": "Practice: your progress is not changed, you only earn XP.",
  "gd.sum.again": "Redo the mistakes ({n})",
  "gd.art": "Article", "gd.art.def": "the (le / la)", "gd.art.indef": "a (un / une)", "gd.art.mix": "Mixed",
  "gd.chipHint": "Pick the article of the noun (practice, no effect on progress).",
  "gd.menu": "Complete gender ({n})",
  "gd.ask.title": "Complete gender",
  "gd.ask.text1": "1 noun has no gender. Ask Claude to complete it? The proposal will arrive in \"Pending\".",
  "gd.ask.text": "{n} nouns have no gender. Ask Claude to complete them? The proposals will arrive in \"Pending\".",
  "gd.ask.noQueue": "The queue is not available: you can prepare a request to copy for Claude.",
  "gd.ask.prepare": "Prepare for Claude",
  "gd.set.title": "Noun gender",
  "gd.set.colors": "Gender colours",
  "gd.set.colorsHint": "Blue = masculine, red = feminine, purple = both. For French, Italian, Spanish and Portuguese.",
  "gd.set.symbols": "Colour-blind mode (♂ ♀ ⚥)",
  "gd.set.symbolsHint": "Adds a small symbol next to the word, even if colours are turned off.",
  "gd.set.missing1": "1 noun has no gender filled in.",
  "gd.set.missing": "{n} nouns have no gender filled in.",
  "gd.set.ask": "Ask Claude to complete"
});
