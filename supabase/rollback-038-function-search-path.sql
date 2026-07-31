-- ⚠️ Відкат для міграції 038. НЕ застосовано (тримати про запас); застосовувати лише щоб відкотити 038.
-- ROLLBACK for migration 038 — unpin search_path.
-- Verified before applying: NO public function had search_path set previously
-- (select returned zero rows), so resetting it on every public function returns
-- them all to the original "mutable" state exactly — nothing else is disturbed.

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
  loop
    execute format('alter function %s reset search_path;', r.sig);
  end loop;
end $$;
