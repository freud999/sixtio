-- Migration 002: classic dating-profile fields + photo storage.
-- Run in Supabase Dashboard -> SQL Editor -> New query -> Run.

alter table public.users
  add column if not exists gender text,
  add column if not exists seeking_gender text,
  add column if not exists goal text,
  add column if not exists age int,
  add column if not exists city text,
  add column if not exists interests jsonb,
  add column if not exists bio text,
  add column if not exists photo_url text;

-- Public bucket for profile photos (uploads go through the service role;
-- public read is what makes photo_url directly viewable).
insert into storage.buckets (id, name, public)
values ('photos', 'photos', true)
on conflict (id) do nothing;
