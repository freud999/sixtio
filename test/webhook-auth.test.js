// F-01 / P12-1: the payment webhook must not accept anonymous updates.
//
// /api/chat treats any body with `update_id` as a Telegram update, and payment
// crediting runs before the owner check (it must — every user pays, not just the
// owner). Every field it trusts comes from the request body, and idempotency
// keys off an attacker-chosen charge id, so an unauthenticated POST could mint
// Stars — i.e. hand out Premium for free.
//
// Two independent defences are tested here, because each covers the other's
// blind spot: the header gate needs configuration and can drift out of sync,
// while the ledger check needs no configuration at all.
import test from 'node:test';
import assert from 'node:assert/strict';
import { webhookAuthProblem, verifyStarCharge } from '../api/_lib/analytics.js';

const SECRET = 's3cret-token';
const good = { 'x-telegram-bot-api-secret-token': SECRET };

test('with no secret configured the gate stays open — it must not kill the bot', () => {
  // The gate was removed once precisely because a secret mismatch silences the
  // webhook, and a dead webhook cost ten days of signups. Shipping it as
  // mandatory would repeat that on deploy.
  assert.equal(webhookAuthProblem({}, ''), null);
  assert.equal(webhookAuthProblem(good, ''), null);
});

test('with a secret configured, an anonymous update is rejected', () => {
  assert.match(webhookAuthProblem({}, SECRET), /missing/);
  assert.match(webhookAuthProblem({ 'x-telegram-bot-api-secret-token': 'wrong' }, SECRET), /mismatch/);
  assert.equal(webhookAuthProblem(good, SECRET), null);
});

// --- the ledger check -------------------------------------------------------

const realFetch = globalThis.fetch;
function stubBot(payload, { fail = false } = {}) {
  globalThis.fetch = async () => {
    if (fail) throw new Error('network down');
    return { ok: true, status: 200, json: async () => ({ ok: true, result: payload }) };
  };
}

test('a charge Telegram has no record of is a definite forgery', async () => {
  process.env.TELEGRAM_BOT_TOKEN = '123:stub';
  stubBot({ transactions: [{ id: 'real-1', amount: 100 }] });
  try {
    const v = await verifyStarCharge('forged-1', 100);
    assert.equal(v.checked, true);
    assert.equal(v.found, false, 'must be refused, not credited');
  } finally { globalThis.fetch = realFetch; }
});

test('a real charge with the claimed amount passes', async () => {
  stubBot({ transactions: [{ id: 'real-1', amount: 100 }] });
  try {
    const v = await verifyStarCharge('real-1', 100);
    assert.deepEqual([v.checked, v.found], [true, true]);
  } finally { globalThis.fetch = realFetch; }
});

test('a real charge id with an inflated amount is refused', async () => {
  // The subtler attack: replay a genuine charge id claiming 10000 stars.
  stubBot({ transactions: [{ id: 'real-1', amount: 100 }] });
  try {
    const v = await verifyStarCharge('real-1', 10000);
    assert.equal(v.found, false);
    assert.match(v.reason, /amount mismatch/);
  } finally { globalThis.fetch = realFetch; }
});

test('an unreachable ledger is NOT a verdict — a paying customer must not lose out', async () => {
  stubBot(null, { fail: true });
  try {
    const v = await verifyStarCharge('real-1', 100);
    assert.equal(v.checked, false, 'no verdict, so the caller credits and alerts');
  } finally { globalThis.fetch = realFetch; }
});

test('an unrecognised API shape degrades to "cannot tell", never to "fake"', async () => {
  // The mapping from charge id to ledger id is unconfirmed against the live API.
  // If Telegram answers something we do not understand, refusing real payments
  // would be far worse than the hole we are closing.
  stubBot({ something_else: true });
  try {
    const v = await verifyStarCharge('real-1', 100);
    assert.equal(v.checked, false);
  } finally { globalThis.fetch = realFetch; }
});

test('a charge older than the fetched page is "cannot tell", not "fake"', async () => {
  const full = Array.from({ length: 5 }, (_, i) => ({ id: `t${i}`, amount: 1 }));
  stubBot({ transactions: full });
  try {
    const v = await verifyStarCharge('older-charge', 1, 5);   // page is full
    assert.equal(v.checked, false, 'a full page means the charge may be beyond it');
  } finally { globalThis.fetch = realFetch; }
});
