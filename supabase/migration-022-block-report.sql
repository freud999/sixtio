-- Migration 022 — Block & Report (safety, pre-launch).
-- Run in Supabase Dashboard -> SQL Editor -> New query -> Run.
--
-- Dating with real women (+ 18+ Dark Mode) needs blocking and reporting BEFORE
-- any growth push. Two mechanisms:
--   1. Block  — a private, two-way hide. If A blocks B, neither ever sees the
--               other in the feed, matches, or chat. Stored as an array on the
--               user row (mirrors liked_users / disliked_users from migration 009).
--   2. Report — flags a user to the owner for review. Once REPORT_HIDE_THRESHOLD
--               distinct people report someone, they're shadow-hidden from every
--               feed/match automatically until an owner clears it.

-- Block list on the user row (same shape/convention as liked_users).
alter table public.users
  add column if not exists blocked_users uuid[]  not null default '{}',
  add column if not exists shadow_hidden boolean not null default false;

-- Fast "who is hidden by reports" lookups + array-contains scans for "who blocked me".
create index if not exists users_blocked_users_idx on public.users using gin (blocked_users);
create index if not exists users_shadow_hidden_idx on public.users (shadow_hidden) where shadow_hidden;

-- One report per (reporter, reported) pair; a re-report just refreshes the reason.
create table if not exists public.reports (
  id          uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.users(id) on delete cascade,
  reported_id uuid not null references public.users(id) on delete cascade,
  reason      text,
  created_at  timestamptz not null default now(),
  unique (reporter_id, reported_id)
);
create index if not exists reports_reported_idx on public.reports (reported_id);

-- Atomic block / unblock (dedup-guarded, no read-modify-write race).
create or replace function public.block_user(blocker uuid, target uuid)
returns void language plpgsql as $$
begin
  update public.users
    set blocked_users = array_append(blocked_users, target)
    where id = blocker and not (target = any(blocked_users));
end; $$;

create or replace function public.unblock_user(blocker uuid, target uuid)
returns void language plpgsql as $$
begin
  update public.users
    set blocked_users = array_remove(blocked_users, target)
    where id = blocker;
end; $$;

-- Report + auto-hide: upsert the report, recount distinct reporters for the
-- target, and flip shadow_hidden on once the threshold is reached. Returns the
-- new distinct-reporter count so the caller can log/observe it.
create or replace function public.report_user(
  reporter uuid, target uuid, reason_text text, hide_threshold int
) returns int language plpgsql as $$
declare cnt int;
begin
  insert into public.reports (reporter_id, reported_id, reason)
    values (reporter, target, reason_text)
    on conflict (reporter_id, reported_id)
    do update set reason = excluded.reason, created_at = now();

  select count(*) into cnt from public.reports where reported_id = target;
  if cnt >= hide_threshold then
    update public.users set shadow_hidden = true where id = target;
  end if;
  return cnt;
end; $$;

-- Called from serverless code holding the service_role key (bypasses RLS).
