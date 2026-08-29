// Warn-only probes (2026-08-29).
//
// /envcheck reported "⚠️ Problems found" and ❌ Gemini for gemini-flash-latest
// — a model NOTHING in the app calls. Gemini's only job is translation, and
// translateBundle passes `light: true`, so the failing probe was about a spare
// tyre while the wheel was fine.
//
// An alarm about a dependency nobody uses is worse than no alarm: it is loud,
// it is wrong, and it trains you to ignore the next one. So severity is now
// part of a probe's contract, and this file pins it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { formatSmoke, smokeHealthy } from '../api/_lib/env.js';

const ok = (name) => ({ name, ok: true, detail: 'fine' });
const warn = (name) => ({ name, ok: false, warn: true, detail: 'spare is flat' });
const bad = (name) => ({ name, ok: false, detail: 'wheel is off' });

test('a flat spare is reported but does not make the check red', () => {
  assert.equal(smokeHealthy([ok('Supabase'), warn('Gemini fallback')]), true);
});

test('a real failure still makes it red', () => {
  assert.equal(smokeHealthy([ok('Supabase'), bad('Gemini translation')]), false);
  assert.equal(smokeHealthy([warn('Gemini fallback'), bad('Supabase')]), false);
});

test('the three states are visually distinct', () => {
  const out = formatSmoke([ok('A'), warn('B'), bad('C')]);
  assert.match(out, /✅ A/);
  assert.match(out, /⚠️ B/);
  assert.match(out, /❌ C/);
});

test('an empty result set is healthy, not silently broken', () => {
  assert.equal(smokeHealthy([]), true);
  assert.equal(smokeHealthy(null), true);
});

test('the probe that matters is named for the job, not the model', () => {
  // "Gemini light" told you which model answered. "Gemini translation" tells
  // you what breaks for a user when it does not — which is the only thing
  // worth waking up for.
  const env = readFileSync('api/_lib/env.js', 'utf8');
  assert.match(env, /probe\('Gemini translation'/);
  assert.match(env, /probe\('Gemini fallback'[\s\S]*?warnOnly: true/,
    'the unused model must be warn-only');
});
