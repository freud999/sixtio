-- Migration 027 — smarter Big Five compatibility (v2). Improvement "A".
-- Run in Supabase Dashboard -> SQL Editor -> New query -> Run. AFTER migration 007.
--
-- Additive/idempotent: CREATE OR REPLACE of one function, same signature and same
-- return columns (user_id, name, compatibility_tags, compatibility_score 0..100),
-- so api/feed.js, api/me.js, api/interact.js keep working unchanged. No table or
-- data change.
--
-- WHY: v1 (migration 007) scored compatibility as pure similarity — inverted
-- Euclidean distance across all five OCEAN traits, equal weight. That is wrong in
-- two ways relationship psychology is clear about:
--   1. Neuroticism is NOT "birds of a feather". Two highly anxious people are a
--      fragile pair even though they are *similar*; v1 rewarded that with a
--      perfect neuroticism axis. What predicts a stable pair is a LOW COMBINED
--      level of neuroticism, not a small difference.
--   2. Similarity matters more for some traits than others. Shared openness and
--      conscientiousness (worldview + lifestyle) predict harmony strongly;
--      extraversion differences are easily tolerated, even complementary.
--
-- v2 therefore splits the score into two grounded parts:
--   • Similarity (70%): weighted closeness across openness, conscientiousness,
--     agreeableness, extraversion — neuroticism deliberately excluded here.
--   • Stability (30%): reward a low *combined* neuroticism, so two calm people
--     rank high and two anxious people are correctly discounted.
--
-- Both parts are 0..100, so the blend is always a clean 0..100 integer. Effect:
-- an identical but very-anxious pair drops from 100 to ~71; an identical, calm
-- pair reaches ~97; genuine top matches (high similarity + low neuroticism) still
-- surface first in the feed. NOTE: feed.js Mystery Match still teases >90% — those
-- become rarer and more meaningful, which is the intent; the threshold is revisited
-- in improvement "C".

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
      -- (1) Similarity, 70%. Weighted inverted Euclidean distance across the four
      -- "likeness helps" traits. Weights: openness & conscientiousness 1.0
      -- (worldview + lifestyle), agreeableness 0.8, extraversion 0.6 (differences
      -- are easily tolerated). Neuroticism is NOT here — see the stability term.
      0.70 * (
        (1 - (
          sqrt(
            1.0 * power(p.trait_openness          - me.o, 2) +
            1.0 * power(p.trait_conscientiousness - me.c, 2) +
            0.8 * power(p.trait_agreeableness     - me.a, 2) +
            0.6 * power(p.trait_extraversion      - me.e, 2)
          )
          / sqrt((1.0 + 1.0 + 0.8 + 0.6) * power(100 - 1, 2))   -- max weighted distance
        )) * 100
      )
      -- (2) Emotional stability, 30%. Reward a LOW combined neuroticism level: two
      -- calm people are a strong pair, two anxious people are not — regardless of
      -- how "similar" their neuroticism scores are. 100 - average(neuroticism).
      + 0.30 * (
        100 - ((p.trait_neuroticism + me.n) / 2.0)
      )
    )::integer as compatibility_score
  from public.profiles p
  join public.users u on u.id = p.user_id
  cross join me
  where p.user_id <> current_user_id
    and p.trait_extraversion is not null          -- only fully-scored profiles
  order by compatibility_score desc;
$$;

-- Invoked from serverless code holding the service_role key (bypasses RLS).
