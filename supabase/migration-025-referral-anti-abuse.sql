-- Migration 025 — referral anti-abuse: per-referrer caps + velocity signal.
-- Run in Supabase Dashboard -> SQL Editor -> New query -> Run.
--
-- Additive only; nothing existing is dropped or altered destructively.
--
-- Two changes to how the +15-star referral bonus is granted:
--   1. QUALITY GATE — the bonus is no longer credited the moment the invited
--      user finishes onboarding. It is credited only once that user actually
--      ENGAGES (their first real swipe, wired in api/interact.js). A signup that
--      never uses the app never pays out. This is enforced by moving the reward
--      call site; this migration provides the capped, atomic credit it uses.
--   2. CAPS — any one referrer can be credited at most p_daily_cap rewards per
--      rolling 24h and p_total_cap rewards in total, bounding a multi-account
--      farm. Crossing a cap (or a high per-hour velocity) is surfaced to the
--      owner in Telegram by the caller.

-- Ledger of PAID referral rewards — one row per invited user actually credited.
-- Powers the daily/total caps and the last-hour velocity alert. Keyed on the
-- invited user so a reward can be recorded at most once per invited user.
create table if not exists public.referral_rewards (
  invited_user  uuid primary key references public.users(id) on delete cascade,
  referrer_tg   bigint not null,
  created_at    timestamptz not null default now()
);
create index if not exists referral_rewards_referrer_idx
  on public.referral_rewards (referrer_tg, created_at);

-- Atomic, once-only, capped referral credit.
--
-- Fast path: the guarded flip of users.referral_rewarded (false -> true) both
-- enforces exactly-once per invited user AND lets the common case (no referrer,
-- or already processed) bail before any counting — it affects 0 rows and the
-- function returns an empty set.
--
-- Return contract (0 or 1 row):
--   (no row)          -> nothing to do: no referrer attributed, or already handled.
--   status 'rewarded' -> credited +p_bonus; referrer_tg + hour_count (last-hour
--                        rewards for this referrer, for the velocity alert).
--   status 'capped'   -> the flip won but a cap was hit, so NOTHING was credited;
--                        the flag stays set so we never retry. referrer_tg +
--                        day_count report how far over the referrer is.
create or replace function public.reward_referrer_capped(
  p_invited uuid, p_bonus int, p_daily_cap int, p_total_cap int
) returns table (status text, referrer_tg bigint, day_count int, hour_count int)
language plpgsql
as $$
declare
  v_ref   bigint;
  v_day   int;
  v_total int;
  v_hour  int;
begin
  -- Win-the-race flip: only the caller that flips false->true proceeds, and only
  -- when a referrer is attributed. Everyone else affects 0 rows -> return nothing.
  update public.users
     set referral_rewarded = true
   where id = p_invited
     and referral_rewarded = false
     and referred_by is not null
   returning referred_by into v_ref;
  if v_ref is null then
    return;                                   -- no-op: nothing to reward
  end if;

  -- Per-referrer caps, counted from the reward ledger.
  select count(*) into v_total from public.referral_rewards where referrer_tg = v_ref;
  select count(*) into v_day   from public.referral_rewards
    where referrer_tg = v_ref and created_at > now() - interval '24 hours';

  if v_day >= p_daily_cap or v_total >= p_total_cap then
    -- Over the cap: keep referral_rewarded set (no infinite retry) but do NOT
    -- credit. Surface it to the owner via the caller.
    return query select 'capped'::text, v_ref, v_day, 0;
    return;
  end if;

  -- Under the cap: record the reward and credit the wallet.
  insert into public.referral_rewards (invited_user, referrer_tg)
  values (p_invited, v_ref);

  update public.users
     set stars_balance = stars_balance + p_bonus
   where telegram_id = v_ref;

  select count(*) into v_hour from public.referral_rewards
    where referrer_tg = v_ref and created_at > now() - interval '1 hour';

  return query select 'rewarded'::text, v_ref, v_day + 1, v_hour;
end;
$$;
