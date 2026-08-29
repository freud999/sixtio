-- migration 044 — keep test money out of the revenue numbers.
--
-- The dashboard read "Дохід усього: 1 188 ⭐". Every star of it came from the
-- owner's own account testing the payment path. Revenue from real users: 0.
--
-- NOTHING IS DELETED. A financial record you erase is a financial record you
-- can never audit, and "we removed the rows we did not like" is the worst habit
-- a payments ledger can acquire. The transactions stay exactly where they are;
-- what changes is which of them the word "revenue" is allowed to count.
--
-- Two corrections, and the second applies to everyone, not just the owner:
--
--   1. users.is_test — the account is not a customer, so its spending is not
--      income. A flag rather than a hardcoded Telegram id, because there will
--      be a second test account and hardcoding invites the classic bug where
--      the new one is silently counted.
--
--   2. profile_completion_bonus is stars we GIVE AWAY. Counting a grant as
--      revenue means the more we reward people the richer we appear, which is
--      backwards. It was inflating the figure for real users too.
--
-- Everything else in stats_dashboard is copied verbatim from the previous
-- version — this migration changes the money block and nothing else.

alter table public.users
  add column if not exists is_test boolean not null default false;

comment on column public.users.is_test is
  'Owner/QA account. Excluded from revenue, never from the funnel counts.';

create or replace function public.stats_dashboard(p_since timestamptz, p_until timestamptz)
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  with countable as (
    -- The one definition of "money from a customer": a real account, not a
    -- self-funded top-up, and not a bonus we handed out ourselves.
    select t.*
    from public.star_transactions t
    join public.users u on u.id = t.user_id
    where u.is_test is not true
      and t.feature <> 'stars_deposit_self'
      and t.feature <> 'profile_completion_bonus'
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
    'revenue_all',    (select coalesce(sum(amount),0) from countable),
    'revenue_period', (select coalesce(sum(amount),0) from countable
                        where created_at >= p_since and created_at < p_until),
    -- Self-funding now also carries the test account's top-ups, which is what
    -- that line was always for: money that moved without a customer paying.
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

revoke all on function public.stats_dashboard(timestamptz, timestamptz) from public, anon, authenticated;
