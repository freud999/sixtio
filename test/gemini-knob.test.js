// Which "think less" knob we send Gemini. The interesting case is the one that
// caused the outage: a model name that does NOT say which generation it is, so
// it cannot be classified from its name at all. Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickThinkingKnob, resetThinkingKnobs, geminiModel } from '../api/_lib/geminifetch.js';

test('pinned 2.x names get thinkingBudget', () => {
  resetThinkingKnobs();
  for (const m of ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-2.5-pro', 'gemini-1.5-flash']) {
    assert.equal(pickThinkingKnob(m), 'thinkingBudget', m);
  }
});

test('pinned 3.x+ names get thinkingLevel', () => {
  resetThinkingKnobs();
  for (const m of ['gemini-3.0-flash', 'gemini-3-flash', 'gemini-4.0-pro']) {
    assert.equal(pickThinkingKnob(m), 'thinkingLevel', m);
  }
});

test('a floating alias guesses thinkingLevel — measured, not assumed', () => {
  resetThinkingKnobs();
  // Verified against the live API 2026-08-03: gemini-flash-latest answers 200 to
  // thinkingLevel and 400 to thinkingBudget. It is still a guess — the alias can
  // move — which is why geminiFetch retries once on 400 and remembers.
  assert.equal(pickThinkingKnob('gemini-flash-latest'), 'thinkingLevel');
  assert.equal(pickThinkingKnob('gemini-pro-latest'), 'thinkingLevel');
});

test('resetThinkingKnobs clears what a run has learned', () => {
  resetThinkingKnobs();
  assert.equal(pickThinkingKnob('gemini-flash-latest'), 'thinkingLevel');
});

test('geminiModel falls back to a model that actually answers', () => {
  const original = process.env.GEMINI_MODEL;
  try {
    process.env.GEMINI_MODEL = 'gemini-2.5-flash';
    assert.equal(geminiModel(), 'gemini-2.5-flash');
    delete process.env.GEMINI_MODEL;
    // NOT gemini-2.5-flash: that name is 404 "no longer available to new users"
    // despite still appearing in models.list. A default nobody can call is the
    // outage we just spent a week on.
    assert.equal(geminiModel(), 'gemini-flash-latest');
  } finally {
    if (original === undefined) delete process.env.GEMINI_MODEL;
    else process.env.GEMINI_MODEL = original;
  }
});
