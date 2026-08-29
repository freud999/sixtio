// Permission to message the user (2026-08-29).
//
// Measured on production: 2 of 66 users had ever pressed /start. The other 64
// opened the Mini App directly, which does NOT create a chat with the bot, and
// Telegram then forbids the bot from writing first. A broadcast reached 23 of 66.
//
// The damage was never the broadcast. 14 people had a MATCH and could not be
// told about it. Match -> notification -> return is the entire loop of a dating
// product, and it was broken for two thirds of the userbase — silently, because
// nothing about it looks like an error.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const theme = readFileSync('theme.js', 'utf8');
const onboarding = readFileSync('onboarding.html', 'utf8');
const matches = readFileSync('matches.html', 'utf8');
const me = readFileSync('api/me.js', 'utf8');

test('the ask is version-guarded and never throws', () => {
  // requestWriteAccess is Bot API 6.9+. On an older client the call must be a
  // no-op, not an exception — theme.js runs at startup on every screen, so a
  // throw here would take the whole theme down with it.
  assert.match(theme, /tg\.requestWriteAccess/);
  assert.match(theme, /isVersionAtLeast\('6\.9'\)/);
  assert.match(theme, /catch \(e\) \{ \/\* never let a permission prompt break a screen \*\/ \}/);
});

test('a declined request is a decision, not an invitation to keep asking', () => {
  // 14 users have already blocked the bot. Nagging is how that number grows.
  assert.match(theme, /WEEK = 7 \* 24 \* 3600 \* 1000/);
  assert.match(theme, /state\.askedAt < WEEK/);
  assert.match(theme, /if \(state && state\.granted\) return;/,
    'never ask again once granted');
});

test('it is asked at moments of intent, never on a cold open', () => {
  // Onboarding: they are looking at their own finished portrait.
  assert.match(onboarding, /SixtioNotify\.ask\('onboarding_done'\)/);
  // Matches: only when there is actually a match on screen. A permission prompt
  // over an empty list is noise, and noise is what gets bots blocked.
  assert.match(matches, /\(me\.matches \|\| \[\]\)\.length/);
  assert.match(matches, /SixtioNotify\.ask\('has_match'\)/);
});

test('granting puts the user back on every notification path', () => {
  // Clearing bot_unreachable_at is the entire point: they were excluded from
  // retention, match and new-message notifications alike.
  assert.match(me, /op === 'write_access'/);
  assert.match(me, /async function grantWriteAccess/);
  assert.match(me, /bot_unreachable_at: null, bot_unreachable_reason: null/);
});

test('a lying client costs one wasted message, not a permanent wrong state', () => {
  // The server does not verify the grant — it cannot. What makes that safe is
  // that the next refused send re-marks the row.
  const fn = me.slice(me.indexOf('async function grantWriteAccess'),
                      me.indexOf('async function cronRetentionTrigger'));
  assert.match(fn, /re-mark|re-marks/, 'the self-correcting property must be written down');
});
