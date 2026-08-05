// The inbound channel check (see env.js webhookProblem).
//
// These cases are not hypothetical: every one of them is a state the production
// bot was actually in on 2026-08-05, or one step away from it. The unset webhook
// cost ten days of signups while every outbound signal said the bot was fine.
import test from 'node:test';
import assert from 'node:assert/strict';
import { webhookProblem } from '../api/_lib/env.js';

const APP = 'https://sixtio.vercel.app';
const OK = { url: `${APP}/api/chat`, pending_update_count: 0 };

test('a healthy webhook is silent', () => {
  assert.equal(webhookProblem(OK, APP), null);
  assert.equal(webhookProblem({ ...OK, pending_update_count: 3 }, APP), null);
});

test('an unset webhook is caught — the exact 2026-08-05 outage', () => {
  const real = { url: '', has_custom_certificate: false, pending_update_count: 369 };
  const bad = webhookProblem(real, APP);
  assert.match(bad, /NOT SET/);
  // The message must name the consequence, not the symptom: "url is empty" sends
  // you reading Telegram docs, "payments are being dropped" sends you to fix it.
  assert.match(bad, /payment/);
});

test('a webhook pointing somewhere else is not healthy', () => {
  assert.match(
    webhookProblem({ url: 'https://old-domain.vercel.app/api/chat' }, APP),
    /expected https:\/\/sixtio\.vercel\.app\/api\/chat/
  );
});

test('a trailing slash on APP_URL does not invent a mismatch', () => {
  assert.equal(webhookProblem(OK, `${APP}/`), null);
});

test('a growing backlog is its own failure, distinct from unset', () => {
  const bad = webhookProblem({ ...OK, pending_update_count: 400 }, APP);
  assert.match(bad, /400 updates queued/);
  assert.doesNotMatch(bad, /NOT SET/);
});

test('a delivery error Telegram already recorded is surfaced', () => {
  assert.match(
    webhookProblem({ ...OK, last_error_message: 'Wrong response from the webhook: 500' }, APP),
    /last delivery failed: Wrong response/
  );
});

test('without APP_URL the destination is not judged, only its existence', () => {
  assert.equal(webhookProblem({ url: 'https://anything/api/chat' }, undefined), null);
  assert.match(webhookProblem({}, undefined), /NOT SET/);
});
