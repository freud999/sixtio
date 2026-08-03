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

test('a floating alias names no generation, so it is only a guess', () => {
  resetThinkingKnobs();
  // The value matters less than the fact that it IS a guess — a 400 on the
  // first call is what settles it, which is why geminiFetch retries once.
  assert.equal(pickThinkingKnob('gemini-flash-latest'), 'thinkingBudget');
  assert.equal(pickThinkingKnob('gemini-pro-latest'), 'thinkingBudget');
});

test('resetThinkingKnobs clears what a run has learned', () => {
  resetThinkingKnobs();
  assert.equal(pickThinkingKnob('gemini-flash-latest'), 'thinkingBudget');
});

test('geminiModel reads GEMINI_MODEL and falls back to the pinned default', () => {
  const original = process.env.GEMINI_MODEL;
  try {
    process.env.GEMINI_MODEL = 'gemini-flash-latest';
    assert.equal(geminiModel(), 'gemini-flash-latest');
    delete process.env.GEMINI_MODEL;
    assert.equal(geminiModel(), 'gemini-2.5-flash');
  } finally {
    if (original === undefined) delete process.env.GEMINI_MODEL;
    else process.env.GEMINI_MODEL = original;
  }
});
