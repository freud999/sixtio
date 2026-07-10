-- Migration 026 — tag owner self-funded Stars deposits so they don't inflate revenue.
-- Run in Supabase Dashboard -> SQL Editor -> New query -> Run. AFTER migrations 017 + 018.
--
-- Additive/idempotent: recreates two existing functions, changes no table or data.
--
-- Context: to fund Telegram Ads, the owner tops up their OWN account with Stars and
-- deposits them into the bot. Those are not customer revenue — they are the owner
-- moving their own money in. Until now every deposit was logged as 'stars_deposit'
-- and summed into the /stats revenue, so self-funding masqueraded as income.
--
-- Fix: when the payer is the owner (analytics.js passes p_self=true, derived from
-- OWNER_TELEGRAM_ID), the ledger row is tagged 'stars_deposit_self', and the
-- dashboard excludes that feature from revenue while reporting it on its own line.

-- 1) credit_stars_deposit gains p_self. Drop the old 5-arg overload first so a
--    stale signature can't linger (CREATE OR REPLACE with an added arg won't
--    replace the 5-arg version — it would leave two overloads behind).
drop function if exists public.credit_stars_deposit(text, uuid, bigint, int, text);
create or replace function public.credit_stars_deposit(
  p_charge text, p_user uuid, p_tg bigint, p_stars int, p_payload text,
  p_self boolean default false
) returns int
language plpgsql
as $$
declare
  new_balance int;
  v_feature   text := case when p_self then 'stars_deposit_self' else 'stars_deposit' end;
begin
  if p_charge is null or p_stars is null or p_stars <= 0 then
    return null;
  end if;

  -- Idempotency gate: a redelivered webhook for the same charge inserts nothing.
  insert into public.star_deposits (charge_id, user_id, stars, payload)
  values (p_charge, p_user, p_stars, p_payload)
  on conflict (charge_id) do nothing;

  if not found then
    return null;                       -- already credited this payment; do not repeat
  end if;

  update public.users
     set stars_balance = stars_balance + p_stars
   where telegram_id = p_tg
   returning stars_balance into new_balance;

  -- Owner self-funding is tagged separately so the dashboard can exclude it.
  insert into public.star_transactions (user_id, feature, amount)
  values (p_user, v_feature, p_stars);

  return new_balance;
end;
$$;

-- 2) stats_dashboard: exclude 'stars_deposit_self' from revenue, and surface it on
--    its own 'self_funding' line. Same signature -> plain CREATE OR REPLACE.
create or replace function public.stats_dashboard(p_since timestamptz, p_until timestamptz)
returns jsonb
language sql
stable
as $$
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
    -- Revenue EXCLUDES owner self-funding (feature 'stars_deposit_self').
    'revenue_all',    (select coalesce(sum(amount),0) from public.star_transactions
                        where feature <> 'stars_deposit_self'),
    'revenue_period', (select coalesce(sum(amount),0) from public.star_transactions
                        where created_at >= p_since and created_at < p_until
                          and feature <> 'stars_deposit_self'),
    -- Owner self-funding (ad budget), reported separately, never counted as income.
    'self_funding',   (select coalesce(sum(amount),0) from public.star_transactions
                        where feature = 'stars_deposit_self'),
    'tx_all', (select coalesce(jsonb_object_agg(feature, n), '{}'::jsonb)
                 from (select feature, count(*) n from public.star_transactions
                       group by feature) a),
    'rev_period_by_feature', (select coalesce(jsonb_object_agg(feature, s), '{}'::jsonb)
                 from (select feature, sum(amount) s from public.star_transactions
                       where created_at >= p_since and created_at < p_until
                       group by feature) b),
    'tx_period_by_feature', (select coalesce(jsonb_object_agg(feature, n), '{}'::jsonb)
                 from (select feature, count(*) n from public.star_transactions
                       where created_at >= p_since and created_at < p_until
                       group by feature) c),
    'referral_signups', (select count(*) from public.users where referred_by is not null),
    'referrers',        (select count(distinct referred_by) from public.users where referred_by is not null),
    'ai_interviews',    (select count(*) from public.profiles),
    'ai_matches',       (select count(*) from public.matches)
  );
$$;
