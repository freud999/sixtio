-- ✅ ЗАСТОСОВАНО НА ПРОДІ 2026-08-01 (див. audit/AUDIT_REPORT.md §5-Б, SEC-1).
--    Переперевірено 2026-08-05 вимірюванням: public-URL на реальний обʼєкт → HTTP 400.
--    Відкат: supabase/rollback-040-private-photos-bucket.sql (public = true).
-- migration 040 — make the `photos` storage bucket PRIVATE (SEC-1).
--
-- The bucket was public=true, so the full-res `<user_id>.jpg` was fetchable by
-- anyone who knew a user_id (they leak in feed/interact/match payloads), bypassing
-- the blur paywall and the app's privacy promise. Flipping it private makes the
-- /object/public/ path 400, and all delivery now goes through short-lived signed
-- URLs minted server-side after the entitlement check (api/_lib/photos.js).
--
-- storage.objects already has RLS enabled with 0 policies — no policies are needed:
-- uploads use the service-role key (bypasses RLS) and reads use signed URLs
-- (token-validated, not RLS). Reversible: set public = true.
--
-- REQUIRES the app code that mints signed URLs (this same change set). Apply the
-- code first / together, or existing clients briefly get broken images until they
-- refetch — never a leak.

update storage.buckets set public = false where id = 'photos';
