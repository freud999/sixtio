-- Migration 029 — Referral / acquisition source tracking (Telegram deep links).
-- Run in Supabase Dashboard -> SQL Editor -> New query -> Run.
--
-- Tracks WHERE users come from, using the `start` payload of a Telegram deep
-- link (t.me/Sixtiobot?start=tgads1). That payload arrives at the bot WEBHOOK as
-- "/start tgads1" — BEFORE the users row exists (a row is only created when the
-- Mini App finishes onboarding). So we stage the payload in `signup_sources`
-- keyed by telegram_id, then copy it onto users.source exactly once, at
-- registration. All additive; nothing existing changes.

-- --- Attribution columns on the user (destination, set once) -------------------
alter table public.users
  add column if not exists source text,
  add column if not exists source_first_seen_at timestamptz;

-- Fast per-source aggregation for /stats_sources.
create index if not exists users_source_idx on public.users (source);

-- --- Staging table: /start clicks before the user has registered ---------------
-- One row per telegram_id, written the FIRST time they hit a tracked /start link.
-- We never overwrite it, so the earliest attribution wins even if the same person
-- later clicks a different ad before registering.
create table if not exists public.signup_sources (
  telegram_id   bigint primary key,
  source        text not null,
  first_seen_at timestamptz not null default now()
);
create index if not exists signup_sources_source_idx on public.signup_sources (source);

-- --- Per-source funnel used by /stats_sources ---------------------------------
-- clicks        = people who hit a tracked /start link (signup_sources)
-- registrations = users who finished onboarding carrying that source
-- reg_7d/30d    = of those registrations, how many in the last 7 / 30 days
-- key_action    = registered users who reached the product core: >=1 match OR
--                 >=1 paid Stars deposit
-- Completion rate (registrations / clicks) is derived by the caller.
create or replace function public.source_stats()
returns table (
  source        text,
  clicks        bigint,
  registrations bigint,
  reg_7d        bigint,
  reg_30d       bigint,
  key_action    bigint
)
language sql
stable
as $$
  with clicks as (
    select s.source, count(*)::bigint as c
    from public.signup_sources s
    group by s.source
  ),
  regs as (
    select
      u.source,
      count(*)::bigint as r,
      count(*) filter (where u.created_at >= now() - interval '7 days')::bigint  as r7,
      count(*) filter (where u.created_at >= now() - interval '30 days')::bigint as r30,
      count(*) filter (
        where exists (select 1 from public.matches m
                      where m.user_a = u.id or m.user_b = u.id)
           or exists (select 1 from public.star_deposits d
                      where d.user_id = u.id)
      )::bigint as ka
    from public.users u
    where u.source is not null
    group by u.source
  )
  select
    coalesce(c.source, r.source)      as source,
    coalesce(c.c, 0)                  as clicks,
    coalesce(r.r, 0)                  as registrations,
    coalesce(r.r7, 0)                 as reg_7d,
    coalesce(r.r30, 0)                as reg_30d,
    coalesce(r.ka, 0)                 as key_action
  from clicks c
  full outer join regs r on r.source = c.source
  order by registrations desc, clicks desc;
$$;
