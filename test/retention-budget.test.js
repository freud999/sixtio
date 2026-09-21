// Retention has a lifetime budget (2026-09-21).
//
// Measured on production: 44 of 133 users blocked the bot AFTER receiving at
// least one message from it. The cron re-nudged every inactive account every 48
// hours with no end, so someone who drifted away for three weeks collected
// about ten "come back" messages.
//
// Nobody is persuaded by the tenth. They block — and a blocked bot can never
// deliver the one message that would actually bring them back: a real match.
// Retention spam does not just fail, it destroys the channel it runs on.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const me = readFileSync('api/me.js', 'utf8');

test('there is a hard lifetime cap on unprompted nudges', () => {
  assert.match(me, /RETENTION_MAX_PUSHES = 3/);
  assert.match(me, /\.lt\('retention_push_count', RETENTION_MAX_PUSHES\)/,
    'the cap must be applied in the query, not only in the loop');
});

test('the gaps widen — a reminder, then space, then silence', () => {
  const m = /RETENTION_GAPS_H = \[([^\]]+)\]/.exec(me);
  assert.ok(m, 'the gaps must be a readable literal');
  const gaps = m[1].split(',').map((s) => eval(s.trim()));
  assert.equal(gaps.length, 3);
  for (let i = 1; i < gaps.length; i++) {
    assert.ok(gaps[i] > gaps[i - 1], `gap ${i} must be longer than gap ${i - 1}`);
  }
  assert.ok(gaps[0] >= 48, 'the first nudge waits at least two quiet days');
});

test('the counter increases only on a DELIVERED nudge', () => {
  // A refused message did not bother the user, so it must not spend one of
  // their three. Same rule as the delivery stamp next to it.
  assert.match(me, /last_retention_push: new Date\(\)\.toISOString\(\), retention_push_count: n \+ 1/);
  const loop = me.slice(me.indexOf('for (const u of users || [])'), me.indexOf('if (unreachable || failed'));
  const permanentBranch = loop.slice(loop.indexOf('r.permanent'), loop.indexOf('if (!r || !r.sent)'));
  assert.doesNotMatch(permanentBranch, /retention_push_count/,
    'a permanent refusal must not consume a nudge');
});

test('real events are not rationed — only the unprompted "we miss you" is', () => {
  // The cap lives in the retention cron alone. Match and new-message pings are
  // sent from api/profile.js and api/chat.js and must stay unlimited: those are
  // the messages people actually want.
  const bot = readFileSync('api/_lib/bot.js', 'utf8');
  assert.doesNotMatch(bot, /RETENTION_MAX_PUSHES|retention_push_count/,
    'the budget must not leak into notifyInstantMatch / notifyNewMessage');
});

test('the cron reports how many were held back, not just how many were sent', () => {
  // Without this, a quiet batch looks identical to a broken one.
  assert.match(me, /tooSoon/);
  assert.match(me, /still inside their gap/);
});
