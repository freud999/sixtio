-- Migration 031 — "Хто тебе лайкнув": paid reveal of incoming likes.
-- Run in Supabase Dashboard -> SQL Editor -> New query -> Run.
--
-- The COUNT of people who liked you is always free — it is the hook, and hiding
-- it would just make the app feel empty. Identity is what costs:
--
--   * 5 ⭐  — reveal ONE liker forever (recorded in revealed_likers);
--   * 40 ⭐ — a 7-day pass that reveals everyone, including likes that arrive
--            during the window (likes_pass_until).
--
-- Premium (and therefore every female account) sees all of it for free — this is
-- an extra reason to subscribe, not a second tollbooth in front of subscribers.

alter table public.users
  add column if not exists likes_pass_until timestamptz,
  add column if not exists revealed_likers  uuid[] not null default '{}';

-- "Who liked me" is a containment scan over every other user's liked_users.
-- Without this it is a seq scan of the whole table on every screen open.
create index if not exists users_liked_users_gin
  on public.users using gin (liked_users);

-- --- reveal one liker (5 ⭐) ------------------------------------------------
-- Guarded so it can only ever charge for a real, still-pending incoming like:
--   * the liker must actually have the viewer in liked_users (no paying to
--     "reveal" an arbitrary user id someone poked into the request);
--   * not already revealed (idempotent — a double tap costs 5 ⭐ once);
--   * balance must cover the price, checked in the same statement as the
--     deduction, so concurrent taps cannot drive the wallet negative.
-- Returns the new balance, or NULL when any guard failed (caller re-reads the
-- balance to tell "insufficient" apart from "already revealed").
create or replace function public.reveal_liker(viewer uuid, liker uuid, price integer)
returns integer
language sql
as $$
  with upd as (
    update public.users v
       set stars_balance   = v.stars_balance - price,
           revealed_likers = array_append(v.revealed_likers, liker)
     where v.id = viewer
       and v.stars_balance >= price
       and not (liker = any(v.revealed_likers))
       and exists (
         select 1 from public.users l
          where l.id = liker and viewer = any(l.liked_users)
       )
     returning v.id, v.stars_balance
  ), logged as (
    insert into public.star_transactions (user_id, feature, amount)
    select id, 'reveal_liker', price from upd
    returning 1
  )
  select stars_balance from upd;
$$;

-- --- buy the 7-day pass (40 ⭐) --------------------------------------------
-- Extends from whichever is later, now or the current expiry, so buying again
-- mid-pass stacks the days instead of throwing the remainder away.
create or replace function public.buy_likes_pass(buyer uuid, price integer, days integer)
returns timestamptz
language sql
as $$
  with upd as (
    update public.users
       set stars_balance    = stars_balance - price,
           likes_pass_until = greatest(now(), coalesce(likes_pass_until, now()))
                              + (days || ' days')::interval
     where id = buyer and stars_balance >= price
     returning id, likes_pass_until
  ), logged as (
    insert into public.star_transactions (user_id, feature, amount)
    select id, 'likes_pass', price from upd
    returning 1
  )
  select likes_pass_until from upd;
$$;
