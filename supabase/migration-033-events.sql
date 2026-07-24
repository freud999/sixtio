-- Migration 033 — the product funnel as explicit events.
-- Run in Supabase Dashboard -> SQL Editor -> New query -> Run.
--
-- Until now every number on the dashboard was DERIVED: "registrations" meant
-- counting rows in users, "matches" meant counting rows in matches. That works
-- for totals and is useless for a funnel, because it cannot answer WHEN each
-- step happened for a given person, and therefore cannot answer where people
-- fall out. Retention especially: last_active only remembers the most recent
-- visit, so a user who came back on D1 and then vanished is indistinguishable
-- from one who never returned at all.
--
-- The minimum set we care about, in funnel order:
--   start, onboarding_complete, first_like, first_match,
--   return_d1, return_d3, return_d7, paywall_open, purchase
--
-- Most of these are once-per-user by definition ("FIRST like", "returned on
-- D3"), and the code that records them runs on hot paths that fire repeatedly —
-- every app open re-checks retention, every swipe re-checks first_like. Rather
-- than making each call site read-then-write (racy, and two round trips), the
-- uniqueness is enforced HERE and callers just insert with ON CONFLICT DO
-- NOTHING. Idempotency becomes a property of the table, not of nine call sites.
--
-- start / paywall_open / purchase are deliberately NOT unique: how often someone
-- opens the shop and how many times they buy is the whole point of recording them.

create table if not exists public.analytics_events (
  id         bigserial primary key,
  user_id    uuid references public.users(id) on delete cascade,
  event      text        not null,
  props      jsonb       not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- The once-per-user events. Listing them explicitly (rather than a flag on the
-- row) means a typo'd event name can never silently become repeatable.
create unique index if not exists analytics_events_once_idx
  on public.analytics_events (user_id, event)
  where event in (
    'onboarding_complete', 'first_like', 'first_match',
    'return_d1', 'return_d3', 'return_d7'
  );

-- The dashboard always asks "events of type X in window Y".
create index if not exists analytics_events_event_time_idx
  on public.analytics_events (event, created_at desc);

create index if not exists analytics_events_user_idx
  on public.analytics_events (user_id);

-- --- retention, recorded on app open ---------------------------------------
-- D1/D3/D7 mean "survived to at least day N", each recorded once — so a user
-- returning on day 5 earns D1 and D3 but not D7 until day 7. That reading is
-- what makes the three numbers monotonically decreasing and comparable as a
-- cohort curve.
--
-- This lives in SQL rather than in the app for two reasons: it is one round trip
-- instead of three on a hot path, and ON CONFLICT against a PARTIAL unique index
-- must repeat the index predicate — which PostgREST's upsert cannot express, so
-- an application-side upsert would fail to match the index at all.
create or replace function public.track_return(p_user uuid)
returns void
language sql
as $$
  insert into public.analytics_events (user_id, event)
  select p_user, e.event
    from public.users u
    cross join lateral (values
      ('return_d1', 1), ('return_d3', 3), ('return_d7', 7)
    ) as e(event, days)
   where u.id = p_user
     and now() >= u.created_at + (e.days || ' days')::interval
  on conflict (user_id, event) where event in (
    'onboarding_complete', 'first_like', 'first_match',
    'return_d1', 'return_d3', 'return_d7'
  ) do nothing;
$$;

-- --- funnel readout --------------------------------------------------------
-- One round trip for the whole funnel: distinct USERS per event in the window
-- (not raw event counts — "3 people opened the shop" is the useful number,
-- "one person opened it 3 times" is not), plus the raw count where repetition
-- is itself the signal.
-- coalesce(user_id, props->>'tg') because a first-ever /start happens BEFORE the
-- users row exists and so carries a null user_id. Counting distinct user_id
-- alone would collapse every anonymous start into a single "person".
create or replace function public.stats_funnel(p_since timestamptz, p_until timestamptz)
returns table(event text, users bigint, events bigint)
language sql
stable
as $$
  select e.event,
         count(distinct coalesce(e.user_id::text, e.props->>'tg')) as users,
         count(*)                                                  as events
    from public.analytics_events e
   where e.created_at >= p_since
     and e.created_at <  p_until
   group by e.event;
$$;
