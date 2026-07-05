-- Migration 011 — Dark Mode (18+): anonymous intimate-compatibility matching.
-- Run in Supabase Dashboard -> SQL Editor -> New query -> Run.
--
-- Opt-in, Pure-style layer on top of the normal feed. Two new columns on
-- public.users:
--   * dark_mode_active — the user has switched Dark Mode ON. Intimate data is
--     ONLY ever computed/exposed between two users who BOTH have this true;
--     for everyone else the candidate card is byte-for-byte the standard card.
--   * kink_markers    — standardized, non-graphic compatibility tags derived by
--     the AI kink-interview (api/_lib/kink.js). Plain text[] of vocabulary
--     tokens like {dominant, sensual, roleplay} — never free-text or PII.
--
-- The intimate-compatibility % itself is computed in JS (api/_lib/entitlements.js
-- intimateCompatibility()), read via api/feed.js — no AI and no SQL math at read
-- time, mirroring how Big Five ranking is precomputed.

alter table public.users
  add column if not exists dark_mode_active boolean not null default false,
  add column if not exists kink_markers     text[]  not null default '{}';

-- Fast candidate filtering / future "dark-only" queries on the marker set.
create index if not exists users_kink_markers_gin
  on public.users using gin (kink_markers);

-- Partial index so the dark-mode candidate pool is cheap to scan.
create index if not exists users_dark_mode_active_idx
  on public.users (dark_mode_active) where dark_mode_active = true;

-- Exposure is enforced in application code (service_role reads), not RLS: feed.js
-- attaches intimate fields ONLY when me.dark_mode_active AND candidate
-- dark_mode_active are both true, so opting out fully hides these columns.
