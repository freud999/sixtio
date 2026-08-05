-- Rollback for migration 041 (per-user daily AI call ceiling).
-- Safe to run at any time: the app treats a missing RPC as "no ceiling" and
-- keeps working (see aiBudget.js — an RPC error degrades to allow, never to
-- refuse, because a broken cost guard must not block paying users).

drop function if exists public.bump_ai_usage(uuid, integer);

alter table public.users
  drop column if exists ai_calls_today,
  drop column if exists ai_calls_day;
