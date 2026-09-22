-- migration 048 — every star that moves is written down, and "revenue" means money in.
--
-- Found 2026-09-22 by reconciling every balance against its ledger: 12 of 13
-- accounts with a balance matched to the star; one did not. Every LIVE function
-- that changes stars_balance was then checked for a matching star_transactions
-- insert, and three credit stars without one:
--
--   reward_referrer_qualified  — CALLED on every app open (referrals.js)
--   reward_referrer_capped     — no caller in the code
--   increment_stars_by_tg      — no caller in the code
--
-- The first is the one that matters. No referral has qualified yet, so nobody is
-- affected today — but the first real one would have put 15 stars in a user's
-- balance with no record of where they came from, and a balance you cannot
-- explain is a balance you cannot defend when someone disputes it.
--
-- SECOND FIX, same audit. stats_dashboard summed deposits AND spends into one
-- "revenue" figure. A user who tops up 100 ⭐ and spends 50 of them on a report
-- would have shown as 150 ⭐ of revenue: the same money counted twice. Invisible
-- so far only because no real user has paid. Revenue is now money IN —
-- customer top-ups — and spending stays visible as the per-feature breakdown.
--
-- Grants are never revenue: completion bonuses and referral rewards are stars
-- WE give away. Counting them would make the product look richer the more
-- generous it is.
--
-- NOT dropped: the two uncalled legacy functions. Removing them is a
-- destructive change and needs an explicit decision; they are already
-- service-role only (migration 037), so nothing outside the server can call them.
--
-- NOT back-filled: the owner's historical +32. It predates this ledger logging
-- credits at all, and inventing entries to make an old balance reconcile would
-- be fabricating financial history — the opposite of the point.

-- AMBIGUITY FIX (applied separately to prod as fix_referral_reward_ambiguity,
-- folded in here so re-running this file can never reintroduce it). The OUT
-- parameter referrer_tg from RETURNS TABLE shadowed the column of the same name,
-- and PL/pgSQL raised "column reference is ambiguous" — only when that line ran,
-- i.e. only when a payout was actually due. Every referral reward would have
-- crashed and rolled back. Every reference below is table-qualified for that reason.
create or replace function public.reward_referrer_qualified(
  p_invited uuid, p_bonus integer, p_min_depth integer, p_min_days integer, p_rule text
)
returns table(status text, referrer_tg bigint, hour_count integer)
language plpgsql
set search_path to 'public'
as $function$
declare
  v_ref     bigint;
  v_ref_id  uuid;
  v_hour    int;
begin
  update public.users u
     set referral_rewarded = true
   where u.id = p_invited
     and u.referral_rewarded = false
     and u.referred_by is not null
     and coalesce(u.profile_depth, 0) >= p_min_depth
     and u.last_active >= u.created_at + (p_min_days || ' days')::interval
   returning u.referred_by into v_ref;

  if v_ref is null then
    return;
  end if;

  insert into public.referral_rewards (invited_user, referrer_tg, qualified_via)
  values (p_invited, v_ref, p_rule);

  update public.users u
     set stars_balance = u.stars_balance + p_bonus
   where u.telegram_id = v_ref
   returning u.id into v_ref_id;

  -- The line that was missing. Same function as the credit, so the balance and
  -- its explanation can never disagree.
  if v_ref_id is not null then
    insert into public.star_transactions (user_id, feature, amount)
    values (v_ref_id, 'referral_reward', p_bonus);
  end if;

  select count(*) into v_hour
    from public.referral_rewards rr
   where rr.referrer_tg = v_ref and rr.created_at > now() - interval '1 hour';

  return query select 'rewarded'::text, v_ref, v_hour;
end;
$function$;

create or replace function public.stats_dashboard(p_since timestamptz, p_until timestamptz)
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  with countable as (
    -- Real customers only, and never a grant we handed out ourselves.
    select t.*
    from public.star_transactions t
    join public.users u on u.id = t.user_id
    where u.is_test is not true
      and t.feature not in ('stars_deposit_self', 'profile_completion_bonus', 'referral_reward')
  )
  select jsonb_build_object(
    'total_users', (select count(*) from public.users),
    'male',        (select count(*) from public.users where gender = 'male'),
    'female',      (select count(*) from public.users where gender = 'female'),
    'age_18_21',   (select count(*) from public.users where age between 18 and 21),
    'age_22_25',   (select count(*) from public.users where age between 22 and 25),
    'age_26_30',   (select count(*) from public.users where age between 26 and 30),
    'age_31_plus', (select count(*) from public.users where age >= 31),
    'top_cities',  (select coalesce(
                      jsonb_agg(jsonb_build_object('city', city, 'n', cnt) order by cnt desc),
                      '[]'::jsonb)
                    from (select city, count(*) cnt from public.users
                          where city is not null and city <> ''
                          group by city order by count(*) desc limit 5) t),
    'premium_active', (select count(*) from public.users
                        where premium_until is not null and premium_until > now()),
    'new_users_period', (select count(*) from public.users
                          where created_at >= p_since and created_at < p_until),
    -- Money IN. Spending already-bought stars is not new revenue; counting both
    -- the top-up and the spend was counting the same money twice.
    'revenue_all',    (select coalesce(sum(amount),0) from countable
                        where feature = 'stars_deposit'),
    'revenue_period', (select coalesce(sum(amount),0) from countable
                        where feature = 'stars_deposit'
                          and created_at >= p_since and created_at < p_until),
    'self_funding',   (select coalesce(sum(t.amount),0)
                        from public.star_transactions t
                        join public.users u on u.id = t.user_id
                        where t.feature = 'stars_deposit_self'
                           or (u.is_test and t.feature = 'stars_deposit')),
    'tx_all', (select coalesce(jsonb_object_agg(feature, n), '{}'::jsonb)
                 from (select feature, count(*) n from countable
                       group by feature) a),
    'rev_period_by_feature', (select coalesce(jsonb_object_agg(feature, s), '{}'::jsonb)
                 from (select feature, sum(amount) s from countable
                       where created_at >= p_since and created_at < p_until
                       group by feature) b),
    'tx_period_by_feature', (select coalesce(jsonb_object_agg(feature, n), '{}'::jsonb)
                 from (select feature, count(*) n from countable
                       where created_at >= p_since and created_at < p_until
                       group by feature) c),
    'referral_signups', (select count(*) from public.users where referred_by is not null),
    'referrers',        (select count(distinct referred_by) from public.users where referred_by is not null),
    'ai_interviews',    (select count(*) from public.profiles),
    'ai_matches',       (select count(*) from public.matches)
  );
$$;

revoke all on function public.reward_referrer_qualified(uuid, integer, integer, integer, text) from public, anon, authenticated;
revoke all on function public.stats_dashboard(timestamptz, timestamptz) from public, anon, authenticated;
