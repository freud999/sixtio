-- Migration 008 — Telegram Stars balance + referral system.
-- Run in Supabase Dashboard -> SQL Editor -> New query -> Run.
--
-- Referral flow (no bot webhook required):
--   1. A user shares  https://t.me/Sixtiobot?startapp=ref_<their_telegram_id>
--   2. The invited user opens the Mini App; Telegram delivers "ref_<id>" as the
--      signed start_param inside initData. We store it as users.referred_by once.
--   3. When the invited user finishes onboarding (Digital Twin generated), the
--      referrer is credited +15 stars exactly once (guarded by referral_rewarded).

-- Star wallet: earned via referrals, spent later on premium features.
alter table public.users
  add column if not exists stars_balance integer not null default 0;

-- Referrer's telegram_id, captured once at first app open. Never overwritten.
alter table public.users
  add column if not exists referred_by bigint;

-- Guard so a referrer is credited only once per invited user, even if the
-- invited user re-runs onboarding (e.g. "deepen" mode also hits api/profile).
alter table public.users
  add column if not exists referral_rewarded boolean not null default false;

-- Finding "who did I refer" and crediting the referrer both key off telegram_id.
create index if not exists users_referred_by_idx
  on public.users (referred_by)
  where referred_by is not null;

-- Atomic credit: increments the referrer's balance by telegram_id in a single
-- statement (no read-modify-write race) and returns the new balance.
create or replace function public.increment_stars_by_tg(tg bigint, amount integer)
returns integer
language sql
as $$
  update public.users
  set stars_balance = stars_balance + amount
  where telegram_id = tg
  returning stars_balance;
$$;
