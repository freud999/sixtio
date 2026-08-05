-- migration 042 — bounded compatibility reads + one-shot chat previews.
-- (F-09 / SCALE-1 and F-11 / SCALE-2.)
--
-- Additive and non-destructive: three NEW functions. The original
-- `calculate_compatibility(uuid)` from migration 027 is left exactly as it is,
-- so every existing caller keeps working and a rollback of this file cannot
-- take the feed down. The app falls back to it whenever these are missing.
--
-- WHY. `calculate_compatibility(uuid)` scores EVERY fully-scored profile in the
-- database and returns all of them, ordered. That is the right shape for
-- exactly zero of its callers:
--   • api/me.js wanted the scores of this user's ~8 matched partners;
--   • api/interact.js wanted the score of ONE person (a Mystery reveal);
--   • api/feed.js wanted one page of the opposite gender in an age window.
-- All three asked for the whole table and threw away 99% of it in JavaScript.
-- At 6 users that is invisible; at 10k profiles it is a multi-megabyte payload
-- and a full scan on every screen open, and it degrades everywhere at once.
--
-- The scoring formula below is COPIED VERBATIM from migration 027 (v2: 70%
-- weighted similarity across O/C/A/E + 30% low combined neuroticism). This
-- migration changes WHICH ROWS are computed, never how a pair is scored — the
-- number a user sees today is the number they see after it.

-- 1) Targeted: score this user against a known list of people.
--    Used by the match list (~8 ids) and the Mystery reveal (1 id). Replaces a
--    whole-table scan with an indexed lookup of precisely what was asked for.
create or replace function public.calculate_compatibility_for(
  current_user_id uuid,
  p_user_ids      uuid[]
)
returns table (
  user_id             uuid,
  name                text,
  compatibility_tags  text[],
  compatibility_score integer
)
language sql
stable
set search_path = public, pg_temp
as $$
  with me as (
    select
      trait_extraversion      as e,
      trait_agreeableness     as a,
      trait_conscientiousness as c,
      trait_neuroticism       as n,
      trait_openness          as o
    from public.profiles
    where user_id = current_user_id
      and trait_extraversion is not null
  )
  select
    p.user_id,
    u.name,
    coalesce(p.compatibility_tags, '{}') as compatibility_tags,
    round(
      0.70 * (
        (1 - (
          sqrt(
            1.0 * power(p.trait_openness          - me.o, 2) +
            1.0 * power(p.trait_conscientiousness - me.c, 2) +
            0.8 * power(p.trait_agreeableness     - me.a, 2) +
            0.6 * power(p.trait_extraversion      - me.e, 2)
          )
          / sqrt((1.0 + 1.0 + 0.8 + 0.6) * power(100 - 1, 2))
        )) * 100
      )
      + 0.30 * (100 - ((p.trait_neuroticism + me.n) / 2.0))
    )::integer as compatibility_score
  from public.profiles p
  join public.users u on u.id = p.user_id
  cross join me
  where p.user_id <> current_user_id
    and p.user_id = any(p_user_ids)
    and p.trait_extraversion is not null;
$$;

-- 2) Paged: one screen of the feed, prefiltered in SQL.
--    p_gender / p_min_age / p_max_age are all NULLABLE and a NULL means "do not
--    filter on this" — the feed's 'any' seeking preference and profiles with no
--    age on record both have to keep working, so an absent filter must widen the
--    result, never empty it.
--
--    The ORDER BY carries user_id as a tiebreaker. Without it two profiles on
--    the same score have no defined order between calls, and page 2 can repeat
--    or skip whoever sat on the boundary — the classic pagination bug that looks
--    like "the app shows me the same person twice".
create or replace function public.calculate_compatibility_page(
  current_user_id uuid,
  p_gender        text    default null,
  p_min_age       integer default null,
  p_max_age       integer default null,
  p_limit         integer default 200,
  p_offset        integer default 0
)
returns table (
  user_id             uuid,
  name                text,
  compatibility_tags  text[],
  compatibility_score integer
)
language sql
stable
set search_path = public, pg_temp
as $$
  with me as (
    select
      trait_extraversion      as e,
      trait_agreeableness     as a,
      trait_conscientiousness as c,
      trait_neuroticism       as n,
      trait_openness          as o
    from public.profiles
    where user_id = current_user_id
      and trait_extraversion is not null
  )
  select
    p.user_id,
    u.name,
    coalesce(p.compatibility_tags, '{}') as compatibility_tags,
    round(
      0.70 * (
        (1 - (
          sqrt(
            1.0 * power(p.trait_openness          - me.o, 2) +
            1.0 * power(p.trait_conscientiousness - me.c, 2) +
            0.8 * power(p.trait_agreeableness     - me.a, 2) +
            0.6 * power(p.trait_extraversion      - me.e, 2)
          )
          / sqrt((1.0 + 1.0 + 0.8 + 0.6) * power(100 - 1, 2))
        )) * 100
      )
      + 0.30 * (100 - ((p.trait_neuroticism + me.n) / 2.0))
    )::integer as compatibility_score
  from public.profiles p
  join public.users u on u.id = p.user_id
  cross join me
  where p.user_id <> current_user_id
    and p.trait_extraversion is not null
    and u.shadow_hidden is not true
    and (p_gender  is null or u.gender = p_gender)
    and (p_min_age is null or u.age is null or u.age >= p_min_age)
    and (p_max_age is null or u.age is null or u.age <= p_max_age)
  order by compatibility_score desc, p.user_id
  limit  greatest(1, coalesce(p_limit, 200))
  offset greatest(0, coalesce(p_offset, 0));
$$;

-- 3) Chat previews for a set of matches, in ONE round trip.
--    The match list used to run a separate "last message" query per match, so
--    opening the app cost 3 queries per partner. DISTINCT ON is exactly the tool
--    for "latest row per group" and makes the whole list a single statement.
create or replace function public.latest_messages_for_matches(p_match_ids uuid[])
returns table (
  match_id   uuid,
  text       text,
  sender_id  uuid,
  created_at timestamptz
)
language sql
stable
set search_path = public, pg_temp
as $$
  select distinct on (m.match_id)
    m.match_id, m.text, m.sender_id, m.created_at
  from public.messages m
  where m.match_id = any(p_match_ids)
  order by m.match_id, m.created_at desc;
$$;

-- Service-role only, like every other function here (migration 037).
revoke all on function public.calculate_compatibility_for(uuid, uuid[])                            from public, anon, authenticated;
revoke all on function public.calculate_compatibility_page(uuid, text, integer, integer, integer, integer) from public, anon, authenticated;
revoke all on function public.latest_messages_for_matches(uuid[])                                  from public, anon, authenticated;
