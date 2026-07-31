-- ✅ ЗАСТОСОВАНО НА ПРОДІ 2026-07-31 (project sixtio, ref ncoiiwhjyocqvqqgebla). Повторно НЕ накатувати.
-- migration 039 — remove the base-table DML grants Supabase hands anon/authenticated
-- by default, so RLS-with-no-policy is no longer the ONLY thing standing between
-- the public key and the data. Defense-in-depth on top of 036: even a future
-- accidental permissive policy can't widen exposure if the grant itself is gone.
--
-- WHY SAFE: the app is server-only and connects with the service-role key, which
-- (a) bypasses RLS and (b) keeps its own grants — neither is touched here. No
-- frontend uses the anon/publishable key against PostgREST. After this, an anon
-- read returns 401 "permission denied" instead of an empty array (cleaner denial).
--
-- Additive/reversible — see rollback-039-revoke-table-grants.sql.

do $$
declare r record;
begin
  for r in
    select format('%I.%I', schemaname, tablename) as t
    from pg_tables where schemaname = 'public'
  loop
    execute format('revoke all on table %s from anon, authenticated;', r.t);
  end loop;
end $$;

-- Stop new tables from being born with anon/authenticated grants again.
alter default privileges in schema public
  revoke all on tables from anon, authenticated;
