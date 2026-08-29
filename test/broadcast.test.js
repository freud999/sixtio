// /broadcast (2026-08-29).
//
// A message to every user is the most irreversible thing this app can do. You
// cannot unsend it, the audience is real people, and the realistic way to hurt
// them is not malice — it is running the command twice, or sending a claim that
// is not true for the person reading it.
//
// So the safety properties are pinned here rather than trusted to care.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync('api/_lib/commands.js', 'utf8');

test('the bare command sends nothing — delivery needs a second, explicit word', () => {
  assert.match(src, /const confirmed = \/\^\\\/broadcast\\s\+send\\b\/i/,
    'only "/broadcast send" may deliver');
  assert.match(src, /Broadcast preview — nothing has been sent/);
});

test('it is owner-only, and silent for everyone else', () => {
  const fn = src.slice(src.indexOf('async function broadcast(msg)'),
                       src.indexOf('async function sendEnvCheck'));
  assert.match(fn, /OWNER_TELEGRAM_ID[\s\S]{0,120}?return;/,
    'a non-owner must be dropped before anything is read or sent');
});

test('a repeat within the cooldown is refused', () => {
  assert.match(src, /BROADCAST_COOLDOWN_MS/);
  assert.match(src, /last_broadcast_at/);
  const m = /BROADCAST_COOLDOWN_MS = (\d+) \* 60 \* 60 \* 1000/.exec(src);
  assert.ok(m && Number(m[1]) >= 12, 'the window must be long enough to survive a double-tap');
});

test('"someone is waiting" is only sent to people it is TRUE for', () => {
  // A dating app that invents matches is finished. The variant is chosen from
  // users_with_silent_match(), not from a guess.
  assert.match(src, /users_with_silent_match/);
  assert.match(src, /waiting\.has\(u\.id\) \? BROADCAST\.waiting : BROADCAST\.comeback/);
});

test('both variants exist in all three languages', () => {
  for (const variant of ['waiting', 'comeback']) {
    for (const lang of ['uk', 'ru', 'en']) {
      assert.match(src, new RegExp(`${variant}:[\\s\\S]{0,700}?${lang}:`),
        `${variant}.${lang} is missing`);
    }
  }
});

test('permanently unreachable accounts are recorded, not retried forever', () => {
  assert.match(src, /isPermanentlyUnreachable\(reason\)/);
  assert.match(src, /bot_unreachable_at: new Date\(\)\.toISOString\(\)/);
  assert.match(src, /\.is\('bot_unreachable_at', null\)/,
    'and excluded from the audience up front');
});

test('the report separates delivered from refused', () => {
  // "sent 66" would be the same lie the retention counter told.
  assert.match(src, /delivered: <b>\$\{sent\}/);
  assert.match(src, /unreachable: <b>\$\{unreachable\}/);
  assert.match(src, /retryable failures: <b>\$\{failed\}/);
});
