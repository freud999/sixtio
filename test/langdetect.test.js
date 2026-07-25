import test from 'node:test';
import assert from 'node:assert/strict';
import { detectLang, readingLang, writableLang } from '../api/_lib/langdetect.js';

// --- the three supported languages ---------------------------------------

test('Ukrainian is recognised by the letters Russian does not have', () => {
  assert.equal(detectLang('щира і надійна, творча натура, охоронниця меж'), 'uk');
  assert.equal(detectLang('Ти любиш глибину, але з чітким розумінням своєї вартості.'), 'uk');
});

test('Russian is recognised by the letters Ukrainian does not have', () => {
  assert.equal(detectLang('Ты человек глубокого ума и чётких принципов'), 'ru');
  assert.equal(detectLang('искренняя и надёжная, творческая натура'), 'ru');
});

test('English is recognised by the absence of Cyrillic', () => {
  assert.equal(detectLang('You are a person of deep principles and clear boundaries'), 'en');
});

// --- the case that caused the bug ----------------------------------------

test('Ukrainian text is still Ukrainian however the row is labelled', () => {
  // The row this whole module exists for: traits written in Ukrainian, `lang`
  // column stamped 'ru' because the owner had switched the interface language.
  const text = 'щира і надійна, творча натура, охоронниця меж, сімейна цінність';
  assert.equal(detectLang(text), 'uk');
  assert.equal(readingLang(text, 'ru', 'ru'), 'uk');
});

test('a detected language overrules the recorded one, which overrules the guess', () => {
  assert.equal(readingLang('чётко и ясно, без лишних слов', 'uk', 'uk'), 'ru');
  assert.equal(readingLang('', 'en', 'uk'), 'en');
  assert.equal(readingLang('', null, 'ru'), 'ru');
  assert.equal(readingLang('', null, null), 'uk');
});

// --- refusing to guess ---------------------------------------------------

test('too short a sample is undecidable rather than guessed', () => {
  // No marker letter here means nothing — plenty of real Ukrainian words have none.
  assert.equal(detectLang('тепла'), null);
  assert.equal(detectLang('warm'), null);
  assert.equal(detectLang(''), null);
  assert.equal(detectLang(null), null);
  assert.equal(detectLang(undefined), null);
});

test('Cyrillic carrying no marker either way is undecidable', () => {
  // "хорошо, спокойно, тактовно" reads the same in both alphabets.
  assert.equal(detectLang('спокойно и тактовно, много тонкости'), null);
});

test('an undecidable sample leaves the recorded language untouched', () => {
  assert.equal(writableLang('тепла', 'en'), 'en');
  assert.equal(readingLang('тепла', 'en', 'uk'), 'en');
});

// --- what may be persisted ----------------------------------------------

test('writableLang never invents a language to store', () => {
  // The reader-language fallback is deliberately absent: writing it down is what
  // turned a guess into a fact and silenced translation for good.
  assert.equal(writableLang('', null), null);
  assert.equal(writableLang('тепла', null), null);
  assert.equal(writableLang('щира і надійна людина', null), 'uk');
});

test('writableLang corrects a contradicted label instead of preserving it', () => {
  assert.equal(writableLang('щира і надійна, творча натура', 'ru'), 'uk');
});

// --- mixed text ----------------------------------------------------------

test('the stronger side of a mixed sample wins', () => {
  const mostlyUk = 'я справді ціную щирість і межі, ещё немного';
  assert.equal(detectLang(mostlyUk), 'uk');
});

test('Cyrillic beats a stray Latin word', () => {
  assert.equal(detectLang('люблю каву і stand-up, читаю щовечора'), 'uk');
});
