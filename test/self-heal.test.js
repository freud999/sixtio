// Self-healing onboarding (2026-08-29).
//
// Measured on production: 40 users had a Digital Twin and only 15 had a Big
// Five vector. 62% of people had no compatibility score — the single number the
// product is sold on — because the extraction was fired exactly once, from the
// onboarding card, at the moment the user taps "Continue". Navigation cancels
// in-flight fetches, so one tap cost the score permanently.
//
// The repair has two halves, and this file pins both:
//   1. the request survives the page (keepalive, not the aborting api() helper);
//   2. the app notices the gap on every open and re-fires until it lands.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const onboarding = readFileSync('onboarding.html', 'utf8');
const matches = readFileSync('matches.html', 'utf8');
const me = readFileSync('api/me.js', 'utf8');

test('the Big Five request outlives the page it was fired from', () => {
  // api() attaches a 25s AbortController and is bound to the document; a raw
  // fetch with keepalive is what survives the navigation.
  assert.match(onboarding, /analyze-traits[\s\S]{0,400}?keepalive:\s*true/,
    'analyze-traits must be fired with keepalive');
  assert.doesNotMatch(onboarding, /api\('\/api\/analyze-traits'/,
    'it must NOT go through api(), whose AbortController is the original bug');
});

test('a failed Digital Twin no longer costs the Big Five too', () => {
  // kickTraits() used to live only in the success path, so a slow /api/profile
  // (which does get killed at 30s) lost both the card and the traits.
  const calls = onboarding.match(/kickTraits\(\)/g) || [];
  assert.ok(calls.length >= 3,
    'kickTraits must be defined and called from BOTH the success and failure paths');
});

test('the server reports what is missing, from rows it already loaded', () => {
  assert.match(me, /needsTraits:\s*!!profile && profile\.trait_extraversion == null/);
  assert.match(me, /needsTwin:\s*!profile && answeredQuestions\.length >= 5/);
});

test('the client repairs it on open, once, and silently', () => {
  assert.match(matches, /needsTwin \? '\/api\/profile'/);
  assert.match(matches, /needsTraits \? '\/api\/analyze-traits'/);
  assert.match(matches, /keepalive:\s*true/, 'the repair must survive navigation too');
  assert.match(matches, /repairFired/, 'at most one repair per app open');
});

test('the matchmaker never runs without room inside the function deadline', () => {
  // vercel.json caps the function at 30s and the AI call at 20s. Starting the
  // matchmaker with less than that left is choosing a hard kill — which loses
  // the whole response — over a skipped pairing, which costs nothing.
  const profile = readFileSync('api/profile.js', 'utf8');
  assert.match(profile, /MATCH_BUDGET_MS/);
  assert.match(profile, /elapsed > MATCH_BUDGET_MS/);
  assert.match(profile, /matching skipped/);
});
