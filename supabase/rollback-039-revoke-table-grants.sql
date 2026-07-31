-- ⚠️ Відкат для міграції 039. НЕ застосовано (тримати про запас); застосовувати лише щоб відкотити 039.
-- ROLLBACK for migration 039 — restore the default anon/authenticated table grants.
-- Original grant set for both roles was the full ALL (INSERT, SELECT, UPDATE,
-- DELETE, TRUNCATE, REFERENCES, TRIGGER), so `grant all` reproduces it exactly.

do $$
declare r record;
begin
  for r in
    select format('%I.%I', schemaname, tablename) as t
    from pg_tables where schemaname = 'public'
  loop
    execute format('grant all on table %s to anon, authenticated;', r.t);
  end loop;
end $$;

alter default privileges in schema public
  grant all on tables to anon, authenticated;
