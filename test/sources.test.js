// Tests for acquisition-source tracking (Telegram ?start= deep links).
// Pure logic only — no DB — run with `npm test` (node --test).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractStartPayload, parseSource, decideSourceAction } from '../api/_lib/sources.js';

test('extractStartPayload: with a parameter', () => {
  assert.equal(extractStartPayload('/start tgads1'), 'tgads1');
  assert.equal(extractStartPayload('  /start   tgads1  '), 'tgads1'); // extra whitespace
  assert.equal(extractStartPayload('/start@Sixtiobot promo7'), 'promo7'); // group @bot suffix
});

test('extractStartPayload: without a parameter (organic)', () => {
  assert.equal(extractStartPayload('/start'), null);
  assert.equal(extractStartPayload('  /start  '), null);
});

test('extractStartPayload: non-/start messages', () => {
  assert.equal(extractStartPayload('/help'), null);
  assert.equal(extractStartPayload('hello there'), null);
  assert.equal(extractStartPayload(''), null);
  assert.equal(extractStartPayload(null), null);
  assert.equal(extractStartPayload(undefined), null);
});

test('parseSource: valid tokens pass through', () => {
  assert.equal(parseSource('tgads1'), 'tgads1');
  assert.equal(parseSource('spring_promo-2026'), 'spring_promo-2026');
  assert.equal(parseSource('  tgads1  '), 'tgads1'); // trimmed
  assert.equal(parseSource('A'.repeat(64)), 'A'.repeat(64)); // exactly 64 chars
});

test('parseSource: invalid characters are rejected', () => {
  assert.equal(parseSource('tg ads'), null);      // space
  assert.equal(parseSource('drop;table'), null);  // semicolon
  assert.equal(parseSource('ads!'), null);        // punctuation
  assert.equal(parseSource('emoji😀'), null);      // non-ASCII
  assert.equal(parseSource('a/b'), null);         // slash
  assert.equal(parseSource('<script>'), null);    // markup
});

test('parseSource: length + emptiness limits', () => {
  assert.equal(parseSource(''), null);
  assert.equal(parseSource('   '), null);
  assert.equal(parseSource('A'.repeat(65)), null); // over Telegram's 64 limit
  assert.equal(parseSource(null), null);
  assert.equal(parseSource(undefined), null);
});

test('parseSource: referral codes are NOT ad sources', () => {
  assert.equal(parseSource('ref_12345'), null);
  assert.equal(parseSource('REF_12345'), null); // case-insensitive prefix guard
});

test('decideSourceAction: no payload always skips', () => {
  assert.equal(decideSourceAction({ userExists: false, existingSource: null, payload: null }), 'skip');
  assert.equal(decideSourceAction({ userExists: true, existingSource: null, payload: null }), 'skip');
});

test('decideSourceAction: new (unregistered) user stashes pending', () => {
  assert.equal(decideSourceAction({ userExists: false, existingSource: null, payload: 'tgads1' }), 'stash');
});

test('decideSourceAction: existing user without a source is backfilled once', () => {
  assert.equal(decideSourceAction({ userExists: true, existingSource: null, payload: 'tgads1' }), 'backfill');
  assert.equal(decideSourceAction({ userExists: true, existingSource: '', payload: 'tgads1' }), 'backfill');
});

test('decideSourceAction: repeat /start by an attributed user never overwrites', () => {
  // Returning user who already has a source clicks a NEW ad -> attribution frozen.
  assert.equal(decideSourceAction({ userExists: true, existingSource: 'oldads', payload: 'newads' }), 'skip');
});
