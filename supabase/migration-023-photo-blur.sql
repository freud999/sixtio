-- Migration 023 — server-side photo gating (pre-launch privacy + revenue).
-- Run in Supabase Dashboard -> SQL Editor -> New query -> Run.
--
-- The swipe deck's "blur for free males" used to be CSS-only: the full-resolution
-- photo_url was delivered to every client and trivially recoverable from DevTools
-- (a revenue leak AND a broken privacy promise). We now store a SEPARATE, heavily
-- downscaled+blurred thumbnail generated on the client at upload time. The feed
-- serves ONLY this thumbnail's URL to non-entitled (free male) viewers, so the
-- real photo is never on the wire for them. Entitled viewers (all women + premium
-- males) still get the real photo_url.
--
-- Legacy rows have photo_blur_url = NULL; the feed then sends no photo to free
-- males (safe placeholder) until the user re-uploads.
alter table public.users
  add column if not exists photo_blur_url text;
