// An empty Anthropic balance must be reported at once (2026-10-07).
//
// The credits ran out at 20:01 UTC and the daily smoke test reported it at
// 12:41 the next day — sixteen hours later. In between every Digital Twin, Big
// Five, follow-up and photo check failed: five people registered, four finished
// the entire interview, and not one of them got a profile.
//
// It is also the one AI failure the app cannot degrade around. Every other
// fallback assumes the provider recovers by itself; this one stays broken until
// a human pays. So it is detected at the single method every Anthropic call in
// the app passes through, and alerted immediately.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync('api/_lib/claude.js', 'utf8');

test('the detector wraps the one method every AI call goes through', () => {
  // Seven call sites, seven chances to forget one. messages.create is the choke
  // point, the same reasoning as the AI_ENABLED kill switch above it.
  assert.match(src, /client\.messages\.create = async \(\.\.\.args\) =>/);
  assert.match(src, /noteBillingFailure\(e\);\s*throw e;/,
    'it must observe and rethrow, never swallow');
});

test('it recognises the message Anthropic actually sent', () => {
  // Verbatim from production.
  const real = 'BadRequestError: 400 {"type":"error","error":{"type":"invalid_request_error",'
    + '"message":"Your credit balance is too low to access the Anthropic API. '
    + 'Please go to Plans & Billing to upgrade or purchase credits."}}';
  const pattern = /credit balance is too low|billing|insufficient.*(credit|quota|funds)/i;
  assert.equal(pattern.test(real), true);
});

test('it does NOT fire on ordinary failures', () => {
  // A timeout or a rate limit resolves itself; waking someone for those is how
  // alerts stop being read.
  const pattern = /credit balance is too low|billing|insufficient.*(credit|quota|funds)/i;
  for (const other of [
    'Request timed out.',
    '429 rate_limit_error: Number of requests has exceeded your rate limit',
    '500 Internal server error',
    'Claude refused the request',
    '',
  ]) {
    assert.equal(pattern.test(other), false, other);
  }
});

test('the alert is throttled — an outage hits every single request', () => {
  assert.match(src, /'anthropic-billing'[\s\S]{0,900}?60 \* 60 \* 1000/);
});

test('the alert says the one thing that fixes it', () => {
  // No fallback, no retry, no kill switch helps. Only paying does.
  assert.match(src, /console\.anthropic\.com/);
  assert.match(src, /Nothing else will fix it/);
});
