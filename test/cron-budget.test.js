// The cron's time budget (2026-08-29).
//
// I shipped the Big Five backfill with a COUNT cap and no clock, and put it
// ahead of the retention pushes. Both were wrong, and in the same way: each
// repair is a Claude call of roughly 5-8s, so five of them is 25-40s — past
// vercel.json's maxDuration:30 on its own, before the smoke test (which itself
// makes ~7 live calls, two of them 8s Gemini probes) and the retention pushes
// were counted. The tick would have been killed mid-flight, and the job the
// cron actually exists for would never have run.
//
// The commit that introduced it even said a backfill "must never be able to
// starve the primary job". Then it ran first. This file makes that structural
// rather than a promise in a comment.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const me = readFileSync('api/me.js', 'utf8');

test('repair work runs AFTER the retention pushes, never before', () => {
  const smoke = me.indexOf('await runSmokeTest()');
  const pushes = me.indexOf('await notifyRetention(');
  const backfill = me.indexOf('await backfillMissingTraits(');
  assert.ok(smoke > 0 && pushes > 0 && backfill > 0, 'all three steps must exist');
  assert.ok(backfill > pushes,
    'the backfill must come after the retention loop — it is the optional job');
});

test('the backfill is bounded by a clock, not only by a count', () => {
  // A count bounds the money. Only a clock bounds the function.
  assert.match(me, /TICK_BUDGET_MS/);
  assert.ok(me.indexOf('BACKFILL_PER_RUN') > 0, 'and still bounded by a count, for spend');
});

test('the deadline is re-read inside the loop, not once at the top', () => {
  // The loop is what spends the time; a check that only runs before it starts
  // cannot stop it. Whatever is left over is picked up on the next tick.
  const fn = me.slice(me.indexOf('async function backfillMissingTraits'),
                      me.indexOf('async function cronRetentionTrigger'));
  const checks = (fn.match(/outOfTime\(\)/g) || []).length;
  assert.ok(checks >= 2,
    `expected a guard before the work and one inside the loop, saw ${checks}`);
  // Positional rather than a distance regex: a comment between the `for` and
  // the guard is fine, and pinning a character budget would only make this test
  // break on wording.
  const loopAt = fn.indexOf('for (const row of rows)');
  assert.ok(loopAt > 0, 'the repair loop must exist');
  assert.ok(fn.indexOf('outOfTime()', loopAt) > loopAt,
    'the deadline must be re-read inside the loop, not only before it');
});

test('the budget leaves room to answer inside maxDuration', () => {
  // vercel.json caps the function at 30s. Spending all of it means the response
  // and the dead-man ping never happen — and a cron that dies silently is the
  // exact failure this project has already had twice.
  const m = /TICK_BUDGET_MS = ([\d_]+)/.exec(me);
  assert.ok(m, 'budget must be a literal we can check');
  const budget = Number(m[1].replace(/_/g, ''));
  assert.ok(budget < 30000, 'must be under maxDuration');
  assert.ok(30000 - budget >= 5000, 'must leave at least 5s to respond and ping');
});
