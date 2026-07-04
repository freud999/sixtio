-- Migration 007: Big Five personality traits + mathematical compatibility.
-- Run in Supabase Dashboard -> SQL Editor -> New query -> Run.
--
-- The five OCEAN traits and the compatibility tags live on `profiles`
-- (one row per user, alongside the existing Digital Twin fields). Each trait
-- is an integer 1..100; NULL means "not yet analysed by the onboarding AI".

-- ── Step 1: schema ───────────────────────────────────────────────────────────
alter table public.profiles
  add column if not exists trait_extraversion      integer,
  add column if not exists trait_agreeableness     integer,
  add column if not exists trait_conscientiousness integer,
  add column if not exists trait_neuroticism       integer,
  add column if not exists trait_openness          integer,
  add column if not exists compatibility_tags      text[] default '{}';

-- Keep every trait honest: either NULL (unset) or inside the 1..100 range.
alter table public.profiles
  drop constraint if exists profiles_traits_range;
alter table public.profiles
  add constraint profiles_traits_range check (
    (trait_extraversion      is null or trait_extraversion      between 1 and 100) and
    (trait_agreeableness     is null or trait_agreeableness     between 1 and 100) and
    (trait_conscientiousness is null or trait_conscientiousness between 1 and 100) and
    (trait_neuroticism       is null or trait_neuroticism       between 1 and 100) and
    (trait_openness          is null or trait_openness          between 1 and 100)
  );

-- Only rows that already carry a full Big Five vector are matchable; a partial
-- index keeps the compatibility scan fast and skips half-filled profiles.
create index if not exists profiles_big_five_idx
  on public.profiles (trait_extraversion)
  where trait_extraversion is not null;

-- ── Step 2: mathematical compatibility (RPC) ─────────────────────────────────
-- Inverted Normalized Euclidean Distance across the 5 traits, mapped to 0..100.
--
--   Max_Distance = sqrt(5 * (100 - 1)^2)  ≈ 221.36   (farthest two 5D points, coords 1..100)
--   Distance     = sqrt( Σ (me.trait - them.trait)^2 )
--   Score        = round( (1 - Distance / Max_Distance) * 100 )
--
-- Identical personalities -> 100; polar opposites -> 0. The score is computed
-- dynamically, so it always reflects the latest traits with nothing to cache.
create or replace function public.calculate_compatibility(current_user_id uuid)
returns table (
  user_id             uuid,
  name                text,
  compatibility_tags  text[],
  compatibility_score integer
)
language sql
stable
as $$
  -- The caller's trait vector, pulled once.
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
      (
        1 - (
          sqrt(
            power(p.trait_extraversion      - me.e, 2) +
            power(p.trait_agreeableness     - me.a, 2) +
            power(p.trait_conscientiousness - me.c, 2) +
            power(p.trait_neuroticism       - me.n, 2) +
            power(p.trait_openness          - me.o, 2)
          )
          / sqrt(5 * power(100 - 1, 2))          -- Max_Distance ≈ 221.36
        )
      ) * 100
    )::integer as compatibility_score
  from public.profiles p
  join public.users u on u.id = p.user_id
  cross join me
  where p.user_id <> current_user_id
    and p.trait_extraversion is not null          -- only fully-scored profiles
  order by compatibility_score desc;
$$;

-- The function is invoked from serverless code holding the service_role key,
-- which bypasses RLS. If you ever call it from an authenticated client instead,
-- grant execute explicitly:
--   grant execute on function public.calculate_compatibility(uuid) to authenticated;
