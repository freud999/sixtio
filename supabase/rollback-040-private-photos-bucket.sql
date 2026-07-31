-- ⚠️ Відкат для міграції 040. НЕ застосовано (тримати про запас); застосовувати лише щоб відкотити 040.
-- ROLLBACK for migration 040 — make the `photos` bucket public again.
-- Note: reverting this WITHOUT also reverting the app code is safe (signed URLs
-- keep working on a public bucket); it just re-opens the direct-URL leak (SEC-1).

update storage.buckets set public = true where id = 'photos';
