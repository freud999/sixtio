import test from 'node:test';
import assert from 'node:assert/strict';
import { localizeProfiles, sourceLang } from '../api/_lib/translate.js';

// These tests deliberately never let a network call happen. Every case below
// must be resolved from the cache or by recognising there is nothing to do — if
// one ever reaches Gemini it would need GEMINI_API_KEY, and its absence makes
// translateBundle return {} and the assertion falls back to the original, which
// is exactly the behaviour we also want to pin down.

test('sourceLang prefers the recorded language over the guess', () => {
  assert.equal(sourceLang('en', 'uk'), 'en');
});

test('sourceLang falls back to the user language for pre-migration rows', () => {
  // A null lang means "written before we started recording it", not "unknown
  // forever" — the account language is the best available guess.
  assert.equal(sourceLang(null, 'ru'), 'ru');
  assert.equal(sourceLang(undefined, 'en'), 'en');
});

test('sourceLang has a last resort so it never returns null', () => {
  assert.equal(sourceLang(null, null), 'uk');
});

test('sourceLang believes the text over a recorded language that contradicts it', () => {
  // The bug this was written for: a Ukrainian profile stamped `lang: 'ru'` after
  // its owner switched the app to Russian. Trusting the stamp made a Russian
  // reader an exact source-language match, translation was skipped as pointless,
  // and Ukrainian tags rendered under a Russian interface.
  const ukText = 'щира і надійна, творча натура, охоронниця меж';
  assert.equal(sourceLang('ru', 'ru', ukText), 'uk');
});

test('a mislabelled profile is translated instead of passed through', async () => {
  // Same row, through the real entry point: no cache for 'ru' and no API key in
  // tests, so the assertion is that it TRIED (and fell back to the original)
  // rather than returning early on a bogus source === target match.
  const out = await localizeProfiles([{
    key: 'me', userId: 'u9',
    profile: {
      traits_json: ['щира і надійна', 'творча натура'],
      summary_text: 'Ти любиш глибину, але з чітким розумінням своєї вартості.',
      lang: 'ru',                      // the wrong stamp
      i18n: { ru: { trait0: 'искренняя и надёжная', trait1: 'творческая натура' } },
    },
    user: { language_code: 'ru' },
  }], 'ru');

  // The 'ru' cache is now reachable, which it never was while the row claimed to
  // already BE Russian.
  assert.deepEqual(out.me.traits, ['искренняя и надёжная', 'творческая натура']);
});

test('same language in and out is left completely alone', async () => {
  const out = await localizeProfiles([{
    key: 'me', userId: 'u1',
    profile: { traits_json: ['теплий'], vibe: 'тихий шторм', summary_text: 'Двa речення.', lang: 'uk', i18n: {} },
    user: { bio: 'Люблю каву', bio_lang: 'uk', bio_i18n: {}, language_code: 'uk' },
  }], 'uk');

  assert.deepEqual(out.me.traits, ['теплий']);
  assert.equal(out.me.vibe, 'тихий шторм');
  assert.equal(out.me.summary, 'Двa речення.');
  assert.equal(out.me.bio, 'Люблю каву');
});

test('a cached translation is used without calling the model', async () => {
  const out = await localizeProfiles([{
    key: 'p1', userId: 'u2',
    profile: {
      traits_json: ['теплий', 'уважний'], vibe: 'тихий шторм', summary_text: 'Двa речення.',
      lang: 'uk',
      i18n: { en: { trait0: 'warm', trait1: 'attentive', vibe: 'a quiet storm', summary: 'Two sentences.' } },
    },
    user: { bio: 'Люблю каву', bio_lang: 'uk', bio_i18n: { en: 'I love coffee' }, language_code: 'uk' },
  }], 'en');

  assert.deepEqual(out.p1.traits, ['warm', 'attentive']);
  assert.equal(out.p1.vibe, 'a quiet storm');
  assert.equal(out.p1.summary, 'Two sentences.');
  assert.equal(out.p1.bio, 'I love coffee');
});

test('a partially cached trait list keeps the untranslated ones readable', async () => {
  // A cache written when the profile had fewer traits must not blank the rest.
  const out = await localizeProfiles([{
    key: 'p1', userId: 'u2',
    profile: {
      traits_json: ['теплий', 'уважний', 'смішний'], lang: 'uk',
      i18n: { en: { trait0: 'warm' } },
    },
    user: { language_code: 'uk' },
  }], 'en');

  assert.deepEqual(out.p1.traits, ['warm', 'уважний', 'смішний']);
});

test('a missing profile yields empty fields rather than throwing', async () => {
  const out = await localizeProfiles([
    { key: 'x', userId: 'u3', profile: null, user: { language_code: 'uk' } },
  ], 'en');

  assert.deepEqual(out.x, { traits: [], vibe: '', summary: '', bio: '' });
});

test('an empty bio is never sent for translation', async () => {
  const out = await localizeProfiles([{
    key: 'x', userId: 'u4', profile: null,
    user: { bio: '', bio_lang: 'uk', language_code: 'uk' },
  }], 'en');

  assert.equal(out.x.bio, '');
});

test('every requested key comes back, so a caller can index blindly', async () => {
  const out = await localizeProfiles([
    { key: 'a', userId: 'u1', profile: null, user: { language_code: 'uk' } },
    { key: 'b', userId: 'u2', profile: null, user: { language_code: 'uk' } },
  ], 'en');

  assert.deepEqual(Object.keys(out).sort(), ['a', 'b']);
});
