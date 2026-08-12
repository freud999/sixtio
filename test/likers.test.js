import test from 'node:test';
import assert from 'node:assert/strict';
import { likesPassActive, entitlements, LIKES_PASS_DAYS } from '../api/_lib/entitlements.js';

const DAY = 24 * 60 * 60 * 1000;
const inDays = (n) => new Date(Date.now() + n * DAY).toISOString();

// The welcome bonus (2026-08-12) makes everyone Premium until a date, so the
// paywall's real behaviour is only observable with that window CLOSED. These
// tests close it explicitly rather than depending on today's date — otherwise
// the whole paywall would silently stop being tested for a month and then start
// passing again on its own, which is worse than a red test.
function withPaywallOn(fn) {
  const prev = process.env.WELCOME_FREE_UNTIL;
  process.env.WELCOME_FREE_UNTIL = '2000-01-01T00:00:00Z';
  try { return fn(); } finally {
    if (prev === undefined) delete process.env.WELCOME_FREE_UNTIL;
    else process.env.WELCOME_FREE_UNTIL = prev;
  }
}

test('a live pass reveals everyone', () => {
  withPaywallOn(() => {
    assert.equal(likesPassActive({ gender: 'male', likes_pass_until: inDays(3) }), true);
  });
});

test('an expired pass does not', () => {
  withPaywallOn(() => {
    assert.equal(likesPassActive({ gender: 'male', likes_pass_until: inDays(-1) }), false);
  });
});

test('no pass at all does not', () => {
  withPaywallOn(() => {
    assert.equal(likesPassActive({ gender: 'male' }), false);
    assert.equal(likesPassActive({ gender: 'male', likes_pass_until: null }), false);
  });
});

test('Premium includes it — subscribers are never charged twice', () => {
  withPaywallOn(() => {
    assert.equal(likesPassActive({ gender: 'male', premium_until: inDays(10) }), true);
  });
});

test('females are Premium by policy, so they always see their likers', () => {
  withPaywallOn(() => {
    assert.equal(likesPassActive({ gender: 'female' }), true);
  });
});

test('a passed-in entitlement is honoured instead of recomputing', () => {
  // The caller already has `ent` in hand on the hot paths; passing it must not
  // change the answer, only skip the work.
  withPaywallOn(() => {
    const u = { gender: 'male', premium_until: inDays(10) };
    assert.equal(likesPassActive(u, entitlements(u)), true);
  });
});

test('the pass length is a whole number of days', () => {
  assert.equal(Number.isInteger(LIKES_PASS_DAYS), true);
  assert.ok(LIKES_PASS_DAYS > 0);
});

test('a missing row never throws', () => {
  withPaywallOn(() => {
    assert.equal(likesPassActive(null), false);
    assert.equal(likesPassActive(undefined), false);
  });
});
