// Who is actually here (2026-11-23).
//
// Of 47 women visible to men, 26 had never opened the app again after
// registering and only 2 had been active in the last two weeks. Men wrote to
// people who would never answer — and both reports this app has received were
// about such an account, filed as "fake". The obvious fix, hiding everyone
// inactive for 14 days, would have left each man a deck of TWO cards. So the
// deck is ordered by presence and nobody is hidden by default; only the
// matchmaker and Mystery Match skip accounts that never came back.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isAbandoned, activityTier, hideInactiveDays } from '../api/_lib/activity.js';

const NOW = Date.parse('2026-11-23T15:00:00Z');
const DAY = 86400000;
const iso = (t) => new Date(t).toISOString();
const user = (createdDaysAgo, seenDaysAgo) => ({
  created_at: iso(NOW - createdDaysAgo * DAY),
  last_active: iso(NOW - seenDaysAgo * DAY),
});

test('registered and never came back = abandoned', () => {
  assert.equal(isAbandoned(user(40, 40), NOW), true);
});

test('a brand-new account is NOT abandoned — it has not had the chance yet', () => {
  // Every new user's first session has last_active ≈ created_at.
  assert.equal(isAbandoned(user(1, 1), NOW), false);
  assert.equal(isAbandoned(user(2.9, 2.9), NOW), false);
});

test('coming back even once means not abandoned', () => {
  assert.equal(isAbandoned(user(40, 30), NOW), false);
});

test('tiers: here recently, here this season, gone', () => {
  assert.equal(activityTier(user(100, 3), NOW), 0);
  assert.equal(activityTier(user(100, 30), NOW), 1);
  assert.equal(activityTier(user(100, 90), NOW), 2);
  assert.equal(activityTier(user(40, 40), NOW), 2, 'abandoned is always the last tier');
  assert.equal(activityTier({}, NOW), 2);
  assert.equal(activityTier(null, NOW), 2);
});

test('hiding by inactivity is OFF unless explicitly configured', () => {
  // At today's numbers a 14-day cut leaves two women in a man's deck.
  const prev = process.env.FEED_HIDE_INACTIVE_DAYS;
  delete process.env.FEED_HIDE_INACTIVE_DAYS;
  assert.equal(hideInactiveDays(), 0);
  process.env.FEED_HIDE_INACTIVE_DAYS = 'junk';
  assert.equal(hideInactiveDays(), 0, 'a typo must not start hiding people');
  process.env.FEED_HIDE_INACTIVE_DAYS = '30';
  assert.equal(hideInactiveDays(), 30);
  if (prev === undefined) delete process.env.FEED_HIDE_INACTIVE_DAYS; else process.env.FEED_HIDE_INACTIVE_DAYS = prev;
});

test('the deck sorts by presence FIRST, compatibility within it', () => {
  const feed = readFileSync('api/feed.js', 'utf8');
  assert.match(feed, /ranked\.sort\(\(a, b\) => \(a\._tier - b\._tier\) \|\| \(rankScore\(b\) - rankScore\(a\)\)\)/);
  assert.match(feed, /delete c\._tier/, 'the tier is server-side only and never sent');
});

test('Mystery Match never teases someone who has left — it costs Stars', () => {
  const feed = readFileSync('api/feed.js', 'utf8');
  assert.match(feed, /if \(c\._tier >= 2\) continue;/);
});

test('the matchmaker never pairs anyone with an abandoned account', () => {
  const matching = readFileSync('api/_lib/matching.js', 'utf8');
  assert.match(matching, /if \(isAbandoned\(c\)\) continue;/);
  assert.match(matching, /last_active, created_at'\)/, 'and it selects the columns that needs');
});

test('/geminimodels proves models by a real call, never by the catalogue', () => {
  const gf = readFileSync('api/_lib/geminifetch.js', 'utf8');
  const probe = gf.slice(gf.indexOf('export async function probeGeminiModels'));
  assert.match(probe, /await post\(model, payload, 'probe'\)/);
  // The two models in use are always probed, whether or not they are listed.
  assert.match(probe, /\[geminiModelLight\(\), geminiModel\(\), \.\.\.listed\]/);
  const cmd = readFileSync('api/_lib/commands.js', 'utf8');
  // A fallback sharing the translation model's pool is no fallback at all.
  assert.match(cmd, /working\.find\(\(r\) => r\.model !== primary\)/);
});
