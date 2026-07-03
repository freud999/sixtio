-- Migration 003: matches table + Telegram username for contact links.
-- Run in Supabase Dashboard -> SQL Editor -> New query -> Run.

alter table public.users
  add column if not exists tg_username text;

create table if not exists public.matches (
  id uuid primary key default gen_random_uuid(),
  user_a uuid not null references public.users(id) on delete cascade,
  user_b uuid not null references public.users(id) on delete cascade,
  score int,
  reason text,
  created_at timestamptz not null default now(),
  unique (user_a, user_b)
);

create index if not exists matches_user_a_idx on public.matches (user_a);
create index if not exists matches_user_b_idx on public.matches (user_b);

alter table public.matches enable row level security;
