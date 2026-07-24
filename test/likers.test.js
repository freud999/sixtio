import test from 'node:test';
import assert from 'node:assert/strict';
import { likesPassActive, entitlements, LIKES_PASS_DAYS } from '../api/_lib/entitlements.js';

const DAY = 24 * 60 * 60 * 1000;
const inDays = (n) => new Date(Date.now() + n * DAY).toISOString();

test('a live pass reveals everyone', () => {
  const u = { gender: 'male', likes_pass_until: inDays(3) };
  assert.equal(likesPassActive(u), true);
});

test('an expired pass does not', () => {
  const u = { gender: 'male', likes_pass_until: inDays(-1) };
  assert.equal(likesPassActive(u), false);
});

test('no pass at all does not', () => {
  assert.equal(likesPassActive({ gender: 'male' }), false);
  assert.equal(likesPassActive({ gender: 'male', likes_pass_until: null }), false);
});

test('Premium includes it — subscribers are never charged twice', () => {
  const u = { gender: 'male', premium_until: inDays(10) };
  assert.equal(likesPassActive(u), true);
});

test('females are Premium by policy, so they always see their likers', () => {
  assert.equal(likesPassActive({ gender: 'female' }), true);
});

test('a passed-in entitlement is honoured instead of recomputing', () => {
  // The caller already has `ent` in hand on the hot paths; passing it must not
  // change the answer, only skip the work.
  const u = { gender: 'male', premium_until: inDays(10) };
  assert.equal(likesPassActive(u, entitlements(u)), true);
});

test('the pass length is a whole number of days', () => {
  assert.equal(Number.isInteger(LIKES_PASS_DAYS), true);
  assert.ok(LIKES_PASS_DAYS > 0);
});

test('a missing row never throws', () => {
  assert.equal(likesPassActive(null), false);
  assert.equal(likesPassActive(undefined), false);
});
