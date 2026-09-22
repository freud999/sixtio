// 10-day Premium trial + reminders (2026-09-22).
//
// The trial itself is a column default (migration 047), verified on production
// with a rolled-back insert: a new row gets exactly 10.00 days, and none of the
// 134 existing accounts received one by accident. What is tested here is the
// decision of WHICH message to show — because the two failures that matter are
// telling a paying user "welcome to your free trial", and telling someone their
// Premium ends tomorrow when it already ended, or never will.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { premiumNotice, TRIAL_DAYS, DAY_MS } from '../api/_lib/entitlements.js';

const NOW = Date.parse('2026-09-22T12:00:00Z');
const at = (days) => new Date(NOW + days * DAY_MS).toISOString();

// A trial user: granted at `grantedDaysAgo`, premium_until = grant + 10 days.
function trialUser(grantedDaysAgo, gender = 'male') {
  const grant = NOW - grantedDaysAgo * DAY_MS;
  return {
    gender,
    trial_granted_at: new Date(grant).toISOString(),
    premium_until: new Date(grant + TRIAL_DAYS * DAY_MS).toISOString(),
  };
}

test('a brand-new account is welcomed, not warned', () => {
  const n = premiumNotice(trialUser(0), NOW);
  assert.equal(n.kind, 'welcome');
  assert.equal(n.daysLeft, 10);
  assert.equal(n.trial, true);
});

test('3 days before the end, the reminder replaces the welcome', () => {
  const n = premiumNotice(trialUser(7), NOW);   // 3 days left
  assert.equal(n.kind, 'd3');
  assert.equal(n.daysLeft, 3);
});

test('on the last day it is the last-day reminder', () => {
  const n = premiumNotice(trialUser(9.5), NOW);   // 12 hours left
  assert.equal(n.kind, 'd1');
  assert.equal(n.daysLeft, 1);
});

test('someone who first opens the app late gets the MOST urgent one', () => {
  // First visit on day 9: a welcome to a gift ending tomorrow is the wrong
  // message. They need the reminder.
  assert.equal(premiumNotice(trialUser(9.2), NOW).kind, 'd1');
});

test('after it has ended there is nothing to say — never "ends tomorrow"', () => {
  assert.equal(premiumNotice(trialUser(10.01), NOW), null);
  assert.equal(premiumNotice(trialUser(30), NOW), null);
});

test('women get no notices: Premium is theirs permanently, by policy', () => {
  // "Your trial ends in 3 days" would be false for them.
  for (const days of [0, 7, 9.5]) {
    assert.equal(premiumNotice(trialUser(days, 'female'), NOW), null);
  }
});

test('a PAYING user is never welcomed to a free trial', () => {
  // purchase_premium moves premium_until, so it no longer equals grant + 10d.
  const u = trialUser(2);
  u.premium_until = at(38);   // bought 30 days on top
  assert.equal(premiumNotice(u, NOW), null, 'nothing to say mid-subscription');
});

test('but a paying user IS reminded before their paid Premium ends', () => {
  const u = { gender: 'male', trial_granted_at: null, premium_until: at(2.5) };
  const n = premiumNotice(u, NOW);
  assert.equal(n.kind, 'd3');
  assert.equal(n.trial, false);
});

test('accounts from before the trial existed get no welcome', () => {
  // trial_granted_at is null for all 134 pre-047 users.
  const u = { gender: 'male', trial_granted_at: null, premium_until: at(8) };
  assert.equal(premiumNotice(u, NOW), null);
});

test('no premium at all means no notice, and nothing throws', () => {
  assert.equal(premiumNotice({ gender: 'male', premium_until: null }, NOW), null);
  assert.equal(premiumNotice(null, NOW), null);
  assert.equal(premiumNotice({}, NOW), null);
});

test('every notice carries the exact expiry, so "seen" resets when they extend', () => {
  // The client keys "already shown" by (until, kind). Extending moves `until`,
  // so the next cycle's reminders fire again with nothing to reset by hand.
  const a = premiumNotice(trialUser(7), NOW);
  const extended = trialUser(7);
  extended.premium_until = at(33);
  const b = premiumNotice({ ...extended, premium_until: at(2) }, NOW);
  assert.notEqual(a.until, b.until);
});

test('the client never re-shows a notice the user has dismissed', () => {
  // A reminder that returns on every open until you pay is how this bot got
  // blocked by 44 of 133 users. Dismissing counts as seen.
  const pw = readFileSync('paywall.js', 'utf8');
  assert.match(pw, /sixtio_pnotice:' \+ notice\.until \+ ':' \+ notice\.kind/);
  assert.match(pw, /Marked seen whatever they tapped, including dismissing it/);
});

test('the trial is a DB default, applied to new rows only', () => {
  const sql = readFileSync('supabase/migration-047-trial-premium.sql', 'utf8');
  assert.match(sql, /alter column premium_until set default \(now\(\) \+ interval '10 days'\)/);
  // Adding the column WITH a default would have stamped every existing user.
  assert.match(sql, /add column if not exists trial_granted_at timestamptz;/);
  assert.doesNotMatch(sql, /add column if not exists trial_granted_at timestamptz default/);
});

test('post-data hooks run on the cached path too — the normal way into the app', () => {
  // index.html fetches /api/me, caches it and redirects to matches.html, whose
  // freshness gate then paints the cache and SKIPS load(). Everything that lived
  // only inside load() — this popup, the Big Five self-repair and the
  // notification-permission ask — silently never ran on that path. Found
  // 2026-09-22 by testing the real open sequence instead of a cold one.
  const m = readFileSync('matches.html', 'utf8');
  assert.match(m, /function afterFreshData\(me\)/);
  assert.match(m, /render\(me\);\s*afterFreshData\(me\);/, 'load() must hand off to it');
  assert.match(m, /else \{ try \{ afterFreshData\(JSON\.parse\(localStorage\.getItem\('sixtio_me'\)/,
    'and the fresh-cache branch must call it as well');
  assert.match(m, /if \(afterFreshDone \|\| !me\) return;/, 'exactly once per load');
  const load = m.slice(m.indexOf('function load(){'), m.indexOf('function afterFreshData'));
  assert.doesNotMatch(load, /repairProfile\(|showNotice\(|SixtioNotify\.ask\(/,
    'nothing that needs current data may live only inside load() again');
});
