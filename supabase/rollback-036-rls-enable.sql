-- ⚠️ Відкат для міграції 036. НЕ застосовано (тримати про запас); застосовувати лише щоб відкотити 036.
-- ROLLBACK for migration 036 — return the three tables to RLS-disabled (prior state).
-- Exact inverse: before 036 all three had rowsecurity = false and no policies,
-- so simply disabling RLS restores the original state. No policies were created,
-- so none need dropping.

alter table public.signup_sources  disable row level security;
alter table public.analytics_events disable row level security;
alter table public.ai_reports       disable row level security;
