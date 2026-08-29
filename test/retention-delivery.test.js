// Retention delivery honesty (2026-08-29).
//
// nudge() swallowed every Telegram error and the cron stamped
// last_retention_push regardless. 53 users were recorded as "pushed" while the
// logs showed 43 "chat not found" and 26 "bot was blocked". The metric counted
// messages Telegram had refused, and every 48 hours the batch spent its slots
// on accounts that can never receive anything.
//
// A send function that cannot say whether it sent makes every number built on
// it a guess.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isPermanentlyUnreachable } from '../api/_lib/bot.js';

const me = readFileSync('api/me.js', 'utf8');
const analytics = readFileSync('api/_lib/analytics.js', 'utf8');

test('the refusals that will never succeed are recognised', () => {
  // Verbatim from production logs.
  for (const msg of [
    'Telegram sendMessage: Forbidden: bot was blocked by the user',
    'Telegram sendMessage: Bad Request: chat not found',
    'Telegram sendPhoto: Bad Request: chat not found',
    'Forbidden: user is deactivated',
  ]) {
    assert.equal(isPermanentlyUnreachable(msg), true, msg);
  }
});

test('a transient failure is NOT treated as permanent', () => {
  // Giving up on these would silently stop nudging healthy users.
  for (const msg of [
    'Telegram sendMessage: 500 Internal Server Error',
    'Too Many Requests: retry after 30',
    'request timed out after 8000ms',
    '',
  ]) {
    assert.equal(isPermanentlyUnreachable(msg), false, JSON.stringify(msg));
  }
});

test('delivery is stamped only when the message was actually delivered', () => {
  // The whole bug: last_retention_push was written unconditionally.
  assert.match(me, /if \(!r \|\| !r\.sent\)[\s\S]{0,400}?continue;/,
    'a failed send must not reach the stamp');
  assert.match(me, /Stamped ONLY on real delivery/);
});

test('permanently unreachable users are recorded and skipped', () => {
  assert.match(me, /bot_unreachable_at: new Date\(\)\.toISOString\(\)/);
  assert.match(me, /\.is\('bot_unreachable_at', null\)/,
    'the batch query must exclude them');
});

test('and the mark is lifted the moment they talk to the bot', () => {
  // Without this the mark is a life sentence: we stopped retrying, so nothing
  // else would ever clear it and the user could never be nudged again.
  assert.match(analytics, /bot_unreachable_at: null/);
  assert.match(analytics, /const talker =/);
});

test('the cron reports the three outcomes separately', () => {
  // "sent" alone cannot distinguish a healthy batch from one where everyone
  // has blocked the bot.
  assert.match(me, /sent, unreachable, failed/);
});
