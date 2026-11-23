// What a stranger is told about someone on their card (2026-11-23).
//
// The card printed raw analyst tags: "guarded", "evasive", "no data",
// "narcissistic" — in English, under a Ukrainian UI, as the reason to like them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { presentTags, ALLOWED_TAGS } from '../api/_lib/whytags.js';

test('placeholders and criticisms are never shown', () => {
  const raw = ['no data', 'unknown', 'insufficient data', 'guarded', 'evasive',
    'narcissistic', 'low-effort', 'hostile', 'balanced', 'no-signal'];
  assert.deepEqual(presentTags(raw, 'uk'), []);
});

test('strengths are shown in the reader\'s language', () => {
  assert.deepEqual(presentTags(['loyal', 'guarded', 'empathetic'], 'uk'), ['вірність', 'емпатія']);
  assert.deepEqual(presentTags(['loyal'], 'ru'), ['верность']);
  assert.deepEqual(presentTags(['Loyal '], 'en'), ['loyal']);
  assert.deepEqual(presentTags(['loyal'], 'xx'), ['вірність'], 'unknown language falls back to uk');
});

test('synonyms collapse, and a card never gets more than three', () => {
  assert.deepEqual(presentTags(['warm', 'warm-hearted'], 'uk'), ['теплота']);
  assert.equal(presentTags(['loyal', 'warm', 'calm', 'honest', 'creative'], 'uk').length, 3);
});

test('every allowed word has all three translations', () => {
  for (const tag of ALLOWED_TAGS) {
    for (const l of ['uk', 'ru', 'en']) {
      const [w] = presentTags([tag], l);
      assert.ok(w && w.length > 1, `${tag} has no ${l} translation`);
    }
  }
  assert.ok(!ALLOWED_TAGS.includes('balanced'), 'the old padding word must not be shown');
});

test('every server path that sends tags to a client filters them', () => {
  const feed = readFileSync('api/feed.js', 'utf8');
  const interact = readFileSync('api/interact.js', 'utf8');
  assert.doesNotMatch(feed, /hit\.tags \|\| \[\]\)\.slice/);
  assert.doesNotMatch(interact, /hit\.tags \|\| \[\]\)\.slice/);
  assert.equal((feed.match(/presentTags\(hit\.tags, lang\)/g) || []).length, 2);
  assert.match(interact, /presentTags\(hit\.tags, lang\)/);
});

test('the model is told to pick strengths from the same list', () => {
  const p = readFileSync('api/_lib/personality.js', 'utf8');
  assert.match(p, /Choose ONLY from:\s*\n\s*\$\{ALLOWED_TAGS\.join\(', '\)\}/);
  assert.doesNotMatch(p, /push\('balanced'\)/, 'no filler padding');
});
