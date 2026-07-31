-- ⚠️ Відкат для міграції 037. НЕ застосовано (тримати про запас); застосовувати лише щоб відкотити 037.
-- ROLLBACK for migration 037 — restore the original EXECUTE grants.
-- Original per-function ACL was: PUBLIC=X, anon=X, authenticated=X, service_role=X
-- (service_role was never revoked). Re-granting to public, anon, authenticated
-- reproduces the original ACL exactly. Also undo the default-privileges change.

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
  loop
    execute format('grant execute on function %s to public, anon, authenticated;', r.sig);
  end loop;
end $$;

alter default privileges in schema public
  grant execute on functions to public, anon, authenticated;
