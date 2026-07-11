-- Migration 028 — life values (Layer 3). Additive; no data change.
-- Run in Supabase Dashboard -> SQL Editor -> New query -> Run.
--
-- Structured "core values" the user picks during onboarding (feminism, sober,
-- therapy_minded, unconditional_love, body_positive, gender_free, non_smoker).
-- Unlike interests (a light feed nudge), values are a DEEP compatibility signal:
-- they are passed to the Claude auto-match judge (api/_lib/claude.js
-- scoreCandidates) and weighed heavily, so shared values strongly draw a pair
-- together and clashing ones push it apart.
--
-- NOTE: the column is named `core_values`, not `values`, because VALUES is a
-- reserved SQL keyword that would need quoting everywhere.

alter table public.users
  add column if not exists core_values jsonb not null default '[]'::jsonb;
