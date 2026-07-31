-- ✅ ЗАСТОСОВАНО НА ПРОДІ 2026-07-31 (project sixtio, ref ncoiiwhjyocqvqqgebla). Повторно НЕ накатувати.
-- migration 036 — enable RLS on the three public tables flagged by Supabase
-- Advisors (rls_disabled_in_public, ERROR level).
--
-- WHY THIS IS SAFE (breaks nothing):
--   * Every writer/reader of these tables in the codebase uses the SERVICE ROLE
--     key (api/_lib/supabase.js -> SUPABASE_SERVICE_ROLE_KEY), which BYPASSES RLS.
--       - signup_sources : api/_lib/sources.js   (server only)
--       - analytics_events: api/_lib/events.js    (server only)
--       - ai_reports      : api/interact.js, api/_lib/translate.js (server only)
--   * No frontend page ships a Supabase anon/publishable client — the browser
--     never touches PostgREST directly.
--   * Enabling RLS with NO policies = deny-all for anon/authenticated over the
--     public API, while service_role continues unaffected. This is exactly the
--     posture we want, and the narrowest possible for ai_reports (personal data).
--
-- Additive and reversible (alter table ... disable row level security).

alter table public.signup_sources  enable row level security;
alter table public.analytics_events enable row level security;
alter table public.ai_reports       enable row level security;

-- Optional defense-in-depth: also strip the base-table DML grants that Supabase
-- hands anon/authenticated by default, so even a future accidental policy can't
-- widen exposure. RLS-with-no-policy already denies these; uncomment to belt-and-braces.
-- revoke all on table public.signup_sources  from anon, authenticated;
-- revoke all on table public.analytics_events from anon, authenticated;
-- revoke all on table public.ai_reports       from anon, authenticated;
