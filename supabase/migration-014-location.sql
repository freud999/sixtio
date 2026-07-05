-- Migration 014 — Hybrid geolocation (GPS + manual) capture during onboarding.
-- Run in Supabase Dashboard -> SQL Editor -> New query -> Run.
--
-- `city` is captured client-side: either from navigator.geolocation reverse-geocoded
-- via OpenStreetMap Nominatim (no backend footprint), or typed manually in Ukrainian.
-- The value is persisted through api/me.js (op:'update_location'). The column already
-- exists in practice (profile-info.js writes it); `if not exists` keeps this idempotent.
-- The index prepares for future location-based candidate filtering in the feed.

alter table public.users
  add column if not exists city text;

create index if not exists idx_users_city on public.users (city);
