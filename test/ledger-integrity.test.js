// Stars ledger integrity (2026-09-22).
//
// Every balance was reconciled against star_transactions on production: 12 of
// 13 funded accounts matched to the star. Then every live function that
// changes stars_balance was checked for a matching ledger insert. Three credit
// stars without one; one of them — the referral reward — is called on every
// app open. And running a full referral payout inside a rolled-back
// transaction found that it could not succeed at all: an ambiguous column
// reference crashed it on exactly the line that only runs when a payout is due.
//
// The full money path was then exercised end to end on production, rolled
// back: deposit, duplicate delivery (no-op), purchase with too little (refused,
// balance untouched), purchase (extends from the trial end: 10 + 30 = 40 days),
// referral payout (credited AND logged), revenue (200, not 200 + 150).
//
// These tests pin the SQL so none of that can quietly regress.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const m048 = readFileSync('supabase/migration-048-ledger-integrity.sql', 'utf8');

test('a referral reward writes the ledger in the same function that credits it', () => {
  const fn = m048.slice(m048.indexOf('create or replace function public.reward_referrer_qualified'),
                        m048.indexOf('create or replace function public.stats_dashboard'));
  assert.match(fn, /set stars_balance = u\.stars_balance \+ p_bonus/);
  assert.match(fn, /insert into public\.star_transactions \(user_id, feature, amount\)\s*values \(v_ref_id, 'referral_reward', p_bonus\)/,
    'a credit with no ledger row is a balance nobody can explain');
});

test('the referral payout can actually run — no ambiguous column reference', () => {
  // RETURNS TABLE(... referrer_tg ...) declares an OUT variable with the same
  // name as the referral_rewards column. An unqualified reference to it is an
  // error PL/pgSQL only raises when the line executes — i.e. only when a payout
  // is due, which is why it was never seen. Every payout would have crashed.
  const fn = m048.slice(m048.indexOf('create or replace function public.reward_referrer_qualified'),
                        m048.indexOf('create or replace function public.stats_dashboard'));
  const code = fn.replace(/--.*$/gm, '');
  assert.match(code, /from public\.referral_rewards rr\s+where rr\.referrer_tg = v_ref/);
  assert.doesNotMatch(code, /where\s+referrer_tg\s*=/, 'no bare referrer_tg in a WHERE');
});

test('revenue is money IN, not money in plus the same money spent', () => {
  // A 100 top-up then a 50 spend used to report 150 of revenue.
  assert.match(m048, /'revenue_all',\s*\(select coalesce\(sum\(amount\),0\) from countable\s*where feature = 'stars_deposit'\)/);
  assert.match(m048, /'revenue_period',\s*\(select coalesce\(sum\(amount\),0\) from countable\s*where feature = 'stars_deposit'/);
});

test('stars we give away are never counted as income', () => {
  assert.match(m048, /t\.feature not in \('stars_deposit_self', 'profile_completion_bonus', 'referral_reward'\)/);
  assert.match(m048, /u\.is_test is not true/, 'and test accounts stay out of it');
});

test('nothing in the migration invents ledger history', () => {
  // The owner's historical +32 predates credit logging. Fabricating entries to
  // make it reconcile would be exactly the wrong fix for a ledger.
  const executable = m048.replace(/--.*$/gm, '');
  assert.doesNotMatch(executable, /insert into public\.star_transactions[^;]*select/i,
    'no back-filling of old balances');
});

test('/envcheck states whether the payment webhook has its first layer', () => {
  const cmd = readFileSync('api/_lib/commands.js', 'utf8');
  assert.match(cmd, /payment webhook auth:/);
  assert.match(cmd, /TELEGRAM_WEBHOOK_SECRET \? 'secret set \(2 layers\)'/);
});
