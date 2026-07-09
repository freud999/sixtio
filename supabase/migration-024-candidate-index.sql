-- Migration 024 — candidate-scan index (scalability).
-- Run in Supabase Dashboard -> SQL Editor -> New query -> Run.
--
-- The feed deck and AI matchmaking now prefilter candidates at the DB by gender
-- and an age window (instead of pulling the whole users table into the serverless
-- function and filtering in JS). This composite index makes that scan cheap even
-- as a partner-network drives the user base into the tens of thousands.
create index if not exists users_gender_age_idx on public.users (gender, age);
