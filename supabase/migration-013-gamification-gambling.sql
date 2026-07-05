-- Migration 013 — "Daily Mystery Match" + "Lootboxes" (gamified micro-transactions).
-- Run in Supabase Dashboard -> SQL Editor -> New query -> Run.
--
-- Two curiosity/chance mechanics that spend Telegram Stars:
--   * Mystery Match — once every 24h the feed picks this user's single highest
--     Big Five match (>90%) and shows it fully anonymized (a glowing "?"). The
--     identity is revealed for 10 ⭐ (op:'unlock_mystery_match' in api/interact.js).
--   * Lootboxes — when a free male hits the daily swipe cap, three luck boxes
--     slide up instead of the rigid paywall. The first open today is FREE, each
--     subsequent open costs 5 ⭐; the reward (+3 swipes / 30% discount / empty) is
--     rolled in api/interact.js (op:'open_lootbox').
--
-- NOTE on last_mystery_match_id: the spec calls it "profiles.id", but public.profiles
-- is keyed by user_id (its PK) and has no `id` column. The value we store is a
-- candidate's users.id (what calculate_compatibility + the feed identify people by),
-- which equals profiles.user_id, so we reference public.users(id) — the correct,
-- valid target for that same key.

alter table public.users
  add column if not exists last_mystery_match_id    uuid references public.users(id),
  add column if not exists last_mystery_match_time   timestamptz,
  add column if not exists mystery_match_unlocked    boolean     not null default false,
  add column if not exists last_lootbox_time          timestamptz,
  add column if not exists lootboxes_opened_today     integer     not null default 0;

-- --- Mystery Match unlock (10 ⭐) ------------------------------------------
-- Guarded single statement (mirrors purchase_premium / purchase_swipe_pack from
-- migration 010): deducts the price and flips the reveal flag only if the user
-- has enough Stars AND hasn't already unlocked it — so a double-tap can never
-- charge twice. Returns the new balance, or null when nothing matched
-- (insufficient funds; already-unlocked is handled in api/interact.js first).
create or replace function public.unlock_mystery_match(buyer uuid, price int)
returns integer
language sql
as $$
  update public.users
    set stars_balance = stars_balance - price,
        mystery_match_unlocked = true
    where id = buyer
      and stars_balance >= price
      and mystery_match_unlocked = false
    returning stars_balance;
$$;

-- --- Lootbox open (first free / then 5 ⭐) ---------------------------------
-- Rolls the per-day counter over on a new UTC day, prices the open (0 for the
-- first today, `subsequent_price` after), guards funds for paid opens, then in
-- one locked step charges the cost, bumps the counter, stamps the time, and —
-- when the JS-rolled reward is '+3_swipes' — rolls the user's like usage back by
-- 3 so they can keep swiping. Returns (charged, opened_today, balance); an empty
-- result means no such user or insufficient Stars. Row is locked FOR UPDATE, so
-- concurrent opens serialize and can never overspend or double-count.
create or replace function public.open_lootbox(opener uuid, subsequent_price int, reward text)
returns table (charged integer, opened_today integer, balance integer)
language plpgsql
as $$
declare
  cur_opened int;
  cost       int;
begin
  -- New UTC day since the last open -> reset the daily counter.
  update public.users
    set lootboxes_opened_today = 0
    where id = opener
      and (last_lootbox_time is null
           or (last_lootbox_time at time zone 'UTC')::date
              < (now() at time zone 'UTC')::date);

  -- Lock the row and read the post-reset count.
  select lootboxes_opened_today into cur_opened
    from public.users where id = opener for update;
  if cur_opened is null then
    return;                       -- no such user -> empty result
  end if;

  cost := case when cur_opened = 0 then 0 else subsequent_price end;

  -- Paid opens must be funded (free first open always passes).
  if cost > 0 then
    perform 1 from public.users where id = opener and stars_balance >= cost;
    if not found then
      return;                     -- insufficient Stars -> empty result
    end if;
  end if;

  return query
    update public.users
      set stars_balance = stars_balance - cost,
          lootboxes_opened_today = lootboxes_opened_today + 1,
          last_lootbox_time = now(),
          daily_likes_count = case when reward = '+3_swipes'
                                   then greatest(0, daily_likes_count - 3)
                                   else daily_likes_count end
      where id = opener
      returning cost, lootboxes_opened_today, stars_balance;
end;
$$;

-- All RPCs are called from serverless code holding the service_role key.
