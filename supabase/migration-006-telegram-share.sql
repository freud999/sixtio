-- Migration 006: mutual-consent Telegram exchange per match.
-- Run in Supabase Dashboard -> SQL Editor -> New query -> Run.
-- share_a / share_b track whether user_a / user_b agreed to reveal Telegram.

alter table public.matches
  add column if not exists share_a boolean not null default false,
  add column if not exists share_b boolean not null default false;
