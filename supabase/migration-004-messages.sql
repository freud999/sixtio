-- Migration 004: in-app chat messages between matched users.
-- Run in Supabase Dashboard -> SQL Editor -> New query -> Run.

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  sender_id uuid not null references public.users(id) on delete cascade,
  text text not null,
  created_at timestamptz not null default now()
);

create index if not exists messages_match_idx on public.messages (match_id, created_at);

alter table public.messages enable row level security;
