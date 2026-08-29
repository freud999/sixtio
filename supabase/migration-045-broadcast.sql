-- migration 045 — broadcast support. APPLIED TO PROD 2026-08-29.
--
-- last_broadcast_at guards the accident that actually happens: running
-- `/broadcast send` twice. A per-recipient stamp is stronger than a global
-- lock, because a send that dies halfway can be resumed without re-messaging
-- the people who already got it.
alter table public.users
  add column if not exists last_broadcast_at timestamptz;

-- Who has a match they have never written a single message to.
--
-- Used to choose the "someone is waiting" copy, which must be TRUE for the
-- person receiving it — a dating app that invents matches is finished. One
-- query for the whole audience, not one per person: 66 round trips inside a
-- 30s function is how a broadcast gets truncated halfway.
create or replace function public.users_with_silent_match()
returns table (user_id uuid)
language sql
stable
set search_path = public, pg_temp
as $$
  select distinct u.id
  from public.users u
  join public.matches m on m.user_a = u.id or m.user_b = u.id
  where not exists (
    select 1 from public.messages g
    where g.match_id = m.id and g.sender_id = u.id
  );
$$;

revoke all on function public.users_with_silent_match() from public, anon, authenticated;
