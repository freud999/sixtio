-- Sixtio database schema.
-- Run this in Supabase Dashboard -> SQL Editor -> New query -> Run.

create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  telegram_id bigint unique not null,
  name text,
  created_at timestamptz not null default now()
);

create table if not exists public.answers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  question_id text not null,
  answer_text text not null,
  created_at timestamptz not null default now()
);

create index if not exists answers_user_id_idx on public.answers (user_id, created_at);

create table if not exists public.profiles (
  user_id uuid primary key references public.users(id) on delete cascade,
  traits_json jsonb,
  summary_text text,
  updated_at timestamptz not null default now()
);

-- RLS on, no policies: the anon/public key can't read or write anything.
-- Our serverless functions use the service_role key, which bypasses RLS.
alter table public.users enable row level security;
alter table public.answers enable row level security;
alter table public.profiles enable row level security;
