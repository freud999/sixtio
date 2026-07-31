-- ✅ ЗАСТОСОВАНО НА ПРОДІ 2026-07-31 (project sixtio, ref ncoiiwhjyocqvqqgebla). Повторно НЕ накатувати.
-- migration 037 — lock RPC EXECUTE down to the server (service_role) only.
--
-- CONTEXT: every public function currently carries `=X/postgres` in its ACL,
-- i.e. PUBLIC holds EXECUTE, plus explicit anon=X / authenticated=X. So the
-- public key CAN invoke every money RPC. Today the stars WRITES are still
-- blocked because the functions are SECURITY INVOKER and users/star_transactions
-- have RLS enabled (no policy) — so a direct anon call credits 0 stars. That is
-- defense-by-accident: it collapses the moment any policy is added to users, or
-- any function is switched to SECURITY DEFINER. Revoke the grant instead.
--
-- IMPORTANT: must revoke from PUBLIC as well — revoking only anon/authenticated
-- leaves the `=X/postgres` (PUBLIC) grant, through which they'd still inherit EXECUTE.
-- service_role keeps its own explicit grant; the owner (postgres) is unaffected.
--
-- The app is server-only (no anon-key client, every RPC is called with the
-- service-role key from api/_lib/), so we revoke EXECUTE from public/anon/
-- authenticated on EVERY public function — closes the whole class (money RPCs,
-- the state-mutating ones like record_swipe/try_consume_like/report_user/
-- block_user, and the read RPCs stats_*/source_stats) in one shot.

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
  loop
    execute format('revoke execute on function %s from public, anon, authenticated;', r.sig);
  end loop;
end $$;

-- Stop the hole from reappearing: any FUTURE function created in public would
-- otherwise be born with EXECUTE for PUBLIC again (Postgres default). Strip that
-- default so new RPCs are server-only from birth. (Applies to functions created
-- by the current role — the role migrations run as.)
alter default privileges in schema public
  revoke execute on functions from public, anon, authenticated;
