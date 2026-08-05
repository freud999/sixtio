-- Rollback for migration 042 (bounded compatibility reads + chat previews).
--
-- Safe to run at any time. Every caller of these three functions falls back to
-- the pre-042 path on ANY error (see api/_lib/compat.js): compatibility reverts
-- to the unbounded `calculate_compatibility(uuid)` from migration 027, and the
-- match list reverts to one "last message" query per match. Slower, not broken.

drop function if exists public.calculate_compatibility_for(uuid, uuid[]);
drop function if exists public.calculate_compatibility_page(uuid, text, integer, integer, integer, integer);
drop function if exists public.latest_messages_for_matches(uuid[]);
