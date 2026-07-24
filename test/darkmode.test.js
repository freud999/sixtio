// Tests for the Dark Mode (18+) gates: kill switch, consent, versioning.
// Pure logic only — no DB — run with `npm test` (node --test).
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  darkModeEnabled, hasCurrentConsent, darkActive, consentStale, DARK_CONSENT_VERSION,
} from '../api/_lib/darkmode.js';

const consented = (over) => ({
  dark_mode_active: true,
  dark_consent_at: '2026-07-24T00:00:00Z',
  dark_consent_version: DARK_CONSENT_VERSION,
  ...over,
});

afterEach(() => { delete process.env.DARK_MODE_ENABLED; });

test('kill switch defaults to ON when unset', () => {
  delete process.env.DARK_MODE_ENABLED;
  assert.equal(darkModeEnabled(), true);
});

test('kill switch recognises every "off" spelling', () => {
  for (const off of ['false', 'FALSE', '0', 'off', 'no', ' Off ']) {
    process.env.DARK_MODE_ENABLED = off;
    assert.equal(darkModeEnabled(), false, off);
  }
});

test('kill switch stays ON for anything else', () => {
  for (const on of ['true', '1', 'yes', '']) {
    process.env.DARK_MODE_ENABLED = on;
    assert.equal(darkModeEnabled(), true, JSON.stringify(on));
  }
});

test('consent requires BOTH a timestamp and the current version', () => {
  assert.equal(hasCurrentConsent(consented()), true);
  assert.equal(hasCurrentConsent(consented({ dark_consent_at: null })), false);
  assert.equal(hasCurrentConsent(consented({ dark_consent_version: 'legacy' })), false);
  assert.equal(hasCurrentConsent(consented({ dark_consent_version: null })), false);
  assert.equal(hasCurrentConsent(null), false);
  assert.equal(hasCurrentConsent(undefined), false);
});

test('darkActive requires all three gates', () => {
  assert.equal(darkActive(consented()), true);
  // 2. own switch off
  assert.equal(darkActive(consented({ dark_mode_active: false })), false);
  // 3. consent missing or superseded
  assert.equal(darkActive(consented({ dark_consent_at: null })), false);
  assert.equal(darkActive(consented({ dark_consent_version: 'legacy' })), false);
  // 1. operator kill switch overrides a fully consenting, opted-in user
  process.env.DARK_MODE_ENABLED = 'false';
  assert.equal(darkActive(consented()), false);
});

test('darkActive is safe on missing/partial rows', () => {
  assert.equal(darkActive(null), false);
  assert.equal(darkActive(undefined), false);
  assert.equal(darkActive({}), false);
  // A row selected without the consent columns must NOT be treated as consenting.
  assert.equal(darkActive({ dark_mode_active: true }), false);
});

test('consentStale flags opted-in users on superseded wording only', () => {
  // The migration-030 backfill case: inside the layer, marked 'legacy'.
  assert.equal(consentStale(consented({ dark_consent_version: 'legacy' })), true);
  assert.equal(consentStale(consented()), false);          // current → not stale
  assert.equal(consentStale({ dark_mode_active: false }), false); // opted out → nothing to re-ask
  assert.equal(consentStale(null), false);
});
