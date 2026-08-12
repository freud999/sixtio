// The welcome bonus: everything free for everyone, until a date (2026-08-12).
//
// The risk here is not that it fails to work — you would notice on day one. It
// is that it never ENDS, or that it ends by accident: a typo in an env var
// silently giving the product away, or a stale banner promising a bonus the
// server already stopped granting. So most of this pins the boundaries.
import test from 'node:test';
import assert from 'node:assert/strict';
import { entitlements, welcomeBonusActive, welcomeFreeUntil, FREE_DAILY_LIMIT } from '../api/_lib/entitlements.js';

function withWindow(value, fn) {
  const prev = process.env.WELCOME_FREE_UNTIL;
  if (value === undefined) delete process.env.WELCOME_FREE_UNTIL;
  else process.env.WELCOME_FREE_UNTIL = value;
  try { return fn(); } finally {
    if (prev === undefined) delete process.env.WELCOME_FREE_UNTIL;
    else process.env.WELCOME_FREE_UNTIL = prev;
  }
}

const OPEN = '2099-01-01T00:00:00Z';
const CLOSED = '2000-01-01T00:00:00Z';

test('while the window is open, a free male gets everything', () => {
  withWindow(OPEN, () => {
    const ent = entitlements({ gender: 'male' });
    assert.equal(ent.premiumActive, true);
    assert.equal(ent.blur, false, 'photos must not be blurred');
    assert.equal(ent.likesLeft, Infinity, 'likes must be unlimited');
    assert.equal(ent.rateLimited, false);
    assert.equal(ent.welcomeBonus, true);
    assert.ok(ent.welcomeBonusUntil, 'the UI needs an end date to show');
  });
});

test('when it closes, the paywall comes back exactly as it was', () => {
  withWindow(CLOSED, () => {
    const ent = entitlements({ gender: 'male' });
    assert.equal(ent.premiumActive, false);
    assert.equal(ent.blur, true);
    assert.equal(ent.likesLeft, FREE_DAILY_LIMIT);
    assert.equal(ent.welcomeBonus, false);
    assert.equal(ent.welcomeBonusUntil, null);
  });
});

test('a real subscription is NOT overwritten by the bonus', () => {
  // The whole reason this is a date and not a row rewrite: someone who paid
  // must still have what they paid for on the day the bonus ends.
  const paidUntil = new Date(Date.now() + 90 * 24 * 3600 * 1000).toISOString();
  const user = { gender: 'male', premium_until: paidUntil };
  const during = withWindow(OPEN, () => entitlements(user));
  const after = withWindow(CLOSED, () => entitlements(user));
  assert.equal(during.premiumActive, true);
  assert.equal(after.premiumActive, true, 'their paid subscription must survive the bonus ending');
  assert.equal(after.premiumUntil, new Date(paidUntil).toISOString());
});

test('welcomeBonus is reported separately from premium — never call someone a subscriber', () => {
  withWindow(OPEN, () => {
    assert.equal(entitlements({ gender: 'male' }).welcomeBonus, true);
    // A woman is entitled by policy anyway, but during the window she is also
    // inside it; the flag describes the window, not the person.
    assert.equal(entitlements({ gender: 'female' }).welcomeBonus, true);
  });
  withWindow(CLOSED, () => {
    const her = entitlements({ gender: 'female' });
    assert.equal(her.premiumActive, true, 'policy, not bonus');
    assert.equal(her.welcomeBonus, false);
  });
});

test('a garbled date does NOT give the product away for free, and does not throw', () => {
  // The dangerous typo. An unparseable value must fall back to the built-in
  // date rather than resolving to "always open" or crashing every request.
  for (const junk of ['soon', '', '   ', 'null', '2026-13-45']) {
    withWindow(junk, () => {
      assert.doesNotThrow(() => welcomeBonusActive());
      assert.equal(Number.isFinite(welcomeFreeUntil()), true, `finite for ${JSON.stringify(junk)}`);
    });
  }
});

test('the window can be closed instantly from the dashboard', () => {
  // The operator escape hatch: one env var, no deploy.
  withWindow(CLOSED, () => assert.equal(welcomeBonusActive(), false));
  withWindow(OPEN, () => assert.equal(welcomeBonusActive(), true));
});

test('the built-in default is a real, finite date — not "forever"', () => {
  withWindow(undefined, () => {
    const until = welcomeFreeUntil();
    assert.equal(Number.isFinite(until), true);
    // A bonus with no end is not a bonus, it is a free product.
    assert.ok(until < Date.parse('2027-01-01T00:00:00Z'), 'must expire on its own');
  });
});
