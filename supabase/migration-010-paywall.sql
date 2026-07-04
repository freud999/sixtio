-- Migration 010 — paywall, premium expiry, gendered daily like limits.
-- Run in Supabase Dashboard -> SQL Editor -> New query -> Run.
--
-- Business model (virality-first, gender-biased Tinder/Badoo hybrid):
--   * FEMALE users get full Premium for free — never blurred, infinite likes,
--     no counter, no paywall. (Enforced in api/_lib/entitlements.js, not here.)
--   * MALE users get an INFINITE free tier of 30 right-swipes (Likes) per
--     rolling 24h. Left-swipes (Dislikes) are free and unlimited. There is NO
--     hard post-registration block — the window just resets every 24h.
--   * Exhausting the 30 daily likes triggers the paywall: buy Premium (150 ⭐,
--     30 days, un-blurs photos) or a +30 likes top-up pack (10 ⭐).

-- premium_until is the real entitlement; the existing `premium` boolean
-- (migration-009) stays as a cached mirror so feed.js keeps working.
alter table public.users
  add column if not exists premium_until     timestamptz,
  add column if not exists daily_likes_count  integer     not null default 0,
  add column if not exists last_like_reset    timestamptz not null default now();

-- Atomic like-limit consumer. Rolls the 24h window over if stale, then spends
-- one like if the user is still under the cap. Both UPDATEs run inside the RPC's
-- single implicit transaction and row-lock the user, so concurrent likes can't
-- overspend the allowance. Mirrors the increment_stars_by_tg / record_swipe
-- atomic-RPC convention from migrations 008 and 009.
create or replace function public.try_consume_like(swiper uuid, daily_limit int)
returns boolean
language plpgsql
as $$
declare
  ok boolean := false;
begin
  -- Reset the rolling window if the last reset was more than 24h ago.
  update public.users
    set daily_likes_count = 0,
        last_like_reset = now()
    where id = swiper
      and last_like_reset < now() - interval '24 hours';

  -- Spend one like only if still under the daily cap.
  update public.users
    set daily_likes_count = daily_likes_count + 1
    where id = swiper
      and daily_likes_count < daily_limit
    returning true into ok;

  return coalesce(ok, false);
end;
$$;

-- +30 likes top-up. Guarded `stars_balance >= price` single statement, so two
-- concurrent purchases can never drive the balance negative (the second sees the
-- row-locked, already-decremented balance and its WHERE fails). Grants the extra
-- allowance by rolling the counter back by 30 (bound at 0). Returns the new
-- balance, or null when funds are insufficient (no row matched).
create or replace function public.purchase_swipe_pack(buyer uuid, price int)
returns integer
language sql
as $$
  update public.users
    set stars_balance = stars_balance - price,
        daily_likes_count = greatest(0, daily_likes_count - 30)
    where id = buyer
      and stars_balance >= price
    returning stars_balance;
$$;

-- Premium purchase (150 ⭐ / 30 days). Same guarded-single-statement pattern.
-- greatest(now(), coalesce(premium_until, now())) stacks time if the user renews
-- while still subscribed. Returns the new balance, or null when insufficient.
create or replace function public.purchase_premium(buyer uuid, price int, days int)
returns integer
language sql
as $$
  update public.users
    set stars_balance = stars_balance - price,
        premium = true,
        premium_until = greatest(now(), coalesce(premium_until, now()))
                        + (days || ' days')::interval
    where id = buyer
      and stars_balance >= price
    returning stars_balance;
$$;

-- All RPCs are called from serverless code holding the service_role key.
