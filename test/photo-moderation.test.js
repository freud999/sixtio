// The photo safety gate's operator override. The only thing worth testing here
// in isolation is the DEFAULT, because the default is the whole security
// property: a variable nobody set must mean "check the photo", not "skip it".
// Run with `npm test` (node --test).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { photoModerationFailOpen } from '../api/_lib/gemini.js';

/** Runs fn with PHOTO_MODERATION_FAIL_OPEN set to `value` (undefined = unset). */
function withFlag(value, fn) {
  const original = process.env.PHOTO_MODERATION_FAIL_OPEN;
  if (value === undefined) delete process.env.PHOTO_MODERATION_FAIL_OPEN;
  else process.env.PHOTO_MODERATION_FAIL_OPEN = value;
  try {
    return fn();
  } finally {
    if (original === undefined) delete process.env.PHOTO_MODERATION_FAIL_OPEN;
    else process.env.PHOTO_MODERATION_FAIL_OPEN = original;
  }
}

test('an unset flag means fail-CLOSED — no check, no upload', () => {
  withFlag(undefined, () => assert.equal(photoModerationFailOpen(), false));
});

test('an empty or blank flag is still fail-closed, not an accidental opt-in', () => {
  for (const raw of ['', '   ', '\n']) {
    withFlag(raw, () => assert.equal(photoModerationFailOpen(), false, JSON.stringify(raw)));
  }
});

test('only an explicit, affirmative value opens the gate', () => {
  for (const raw of ['true', 'TRUE', ' True ', '1', 'on', 'yes']) {
    withFlag(raw, () => assert.equal(photoModerationFailOpen(), true, raw));
  }
});

test('anything else — including near-misses and typos — stays fail-closed', () => {
  for (const raw of ['false', '0', 'off', 'no', 'ture', 'enabled', 'y', '2', 'null']) {
    withFlag(raw, () => assert.equal(photoModerationFailOpen(), false, raw));
  }
});
