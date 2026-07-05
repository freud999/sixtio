-- Migration 012 — Profile Depth + Psychological Achievements (gamification).
-- Run in Supabase Dashboard -> SQL Editor -> New query -> Run.
--
-- Two new columns on public.users:
--   * profile_depth — 0..100 completeness meter. Starts at 40 (base onboarding),
--     each answered "extra" deep question adds +20 (see api/me.js
--     op:'submit_extra_question'). Reaching exactly 100 credits a +2 ⭐ bonus.
--   * achievements  — earned psychological badge keys, e.g. {crystal_empath,
--     explorer}. Synced automatically from the user's Big Five traits every time
--     the profile is fetched (api/me.js computeAchievements()), never set by hand.
--
-- The badge thresholds themselves live in application code so they can evolve
-- without a migration; this column is just the persisted, precomputed result.

alter table public.users
  add column if not exists profile_depth integer not null default 40,
  add column if not exists achievements  text[]  not null default '{}';

-- Keep the meter honest: always inside the 0..100 range.
alter table public.users
  drop constraint if exists users_profile_depth_range;
alter table public.users
  add constraint users_profile_depth_range
    check (profile_depth between 0 and 100);
