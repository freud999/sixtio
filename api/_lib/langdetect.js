// Which language a piece of STORED text is actually written in.
//
// Why this exists: migration 034 records the language a profile was written in
// (`profiles.lang`, `users.bio_lang`) so a reader in another language gets a
// translation. When that column was null, the code guessed — and it guessed the
// *user's current interface language*, then wrote the guess down. A user who
// onboarded in Ukrainian and later switched the app to Russian ended up with a
// row stamped `lang: 'ru'` over Ukrainian text. From then on a Russian reader
// matched the recorded source language exactly, translation was skipped as
// unnecessary, and the profile showed Ukrainian tags under a Russian interface.
//
// The text itself is better evidence than any guess, and for exactly the three
// languages Sixtio supports it is cheap to read: Ukrainian and Russian each use
// letters the other does not, and English is not Cyrillic at all. So this is
// arithmetic on characters — no model, no network, no guess to persist.
//
// It answers null rather than picking a side when the evidence is thin or split.
// A wrong confident answer is worse than none: null lets the caller keep what it
// already knew, while a wrong answer would be written to the database and turn
// this same bug back on.

// Letters that exist in Ukrainian and not in Russian, and vice versa.
const UK_ONLY = /[іїєґІЇЄҐ]/g;
const RU_ONLY = /[ыэъёЫЭЪЁ]/g;
const CYRILLIC = /[Ѐ-ӿ]/g;
const LATIN = /[A-Za-z]/g;

// Below this many letters the sample is a name or a single tag, and the absence
// of a marker letter means nothing — plenty of real Ukrainian words contain none.
const MIN_LETTERS = 8;

/**
 * @param {string} text
 * @returns {'uk'|'ru'|'en'|null} null when undecidable — never a coin flip.
 */
export function detectLang(text) {
  const s = String(text == null ? '' : text);
  if (!s.trim()) return null;

  const cyr = (s.match(CYRILLIC) || []).length;
  const lat = (s.match(LATIN) || []).length;

  // Latin with no Cyrillic at all: English. (Sixtio supports no other Latin
  // language, so there is nothing else this could be mistaken for.)
  if (cyr === 0) return lat >= MIN_LETTERS ? 'en' : null;

  // Cyrillic, but too little of it to have contained a marker by chance.
  if (cyr < MIN_LETTERS) return null;

  const uk = (s.match(UK_ONLY) || []).length;
  const ru = (s.match(RU_ONLY) || []).length;
  if (uk > ru) return 'uk';
  if (ru > uk) return 'ru';
  return null;   // e.g. a Cyrillic sample carrying no marker either way
}

/**
 * The language a stored text should be TREATED as being in.
 *
 * Detection first, because it is evidence; then the recorded column, which is
 * evidence when it was written by a generator that knew; and only then the
 * reader's language, which is the guess that caused the bug and is kept solely
 * so a legacy row does not pay for a translation call on every single view.
 */
export function readingLang(text, stored, fallbackLang) {
  return detectLang(text) || stored || fallbackLang || 'uk';
}

/**
 * The language worth WRITING DOWN for a stored text, or null to leave the column
 * alone. Deliberately excludes the reader-language fallback: an interface
 * language is not evidence of what its owner wrote in, and persisting it is what
 * silenced translation for everyone who ever switched languages.
 */
export function writableLang(text, stored) {
  return detectLang(text) || stored || null;
}
