-- ⏳ НЕ ЗАСТОСОВАНО НА ПРОДІ. Застосувати РАЗОМ із деплоєм коду signed-URL (цей самий
--    набір змін), інакше стара прод-версія віддаватиме мертві public-URL. Механізм
--    перевірено 2026-07-31 коротким toggle (public→400, signed→200), бакет повернуто в public.
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
