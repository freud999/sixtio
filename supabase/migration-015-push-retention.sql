-- Migration 015 — Push/retention engine (Telegram Bot API).
-- Run in Supabase Dashboard -> SQL Editor -> New query -> Run.
--
-- Powers two notification scenarios, both sent server-side via api/_lib/bot.js:
--   1. Instant match  — fired inline from api/interact.js on a mutual swipe.
--   2. 48h inactivity — fired from the api/me.js op:'cron_retention_trigger'
--                       route, driven by an external/Vercel cron.
-- `last_active` is stamped on every authenticated app load (me.js + feed.js).
-- `last_retention_push` locks the 48h nudge so a dormant user is pinged at most
-- once per 48h window.

alter table public.users
  add column if not exists last_active         timestamptz not null default now(),
  add column if not exists last_retention_push timestamptz;

-- Speeds up the cron's "idle > 48h" scan.
create index if not exists idx_users_last_active on public.users (last_active);
