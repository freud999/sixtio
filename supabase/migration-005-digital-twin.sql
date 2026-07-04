-- Migration 005: richer "Digital Twin" profile fields for deeper matching.
-- Run in Supabase Dashboard -> SQL Editor -> New query -> Run.

alter table public.profiles
  add column if not exists vibe text,
  add column if not exists portrait_json jsonb;
