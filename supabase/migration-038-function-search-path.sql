-- ✅ ЗАСТОСОВАНО НА ПРОДІ 2026-07-31 (project sixtio, ref ncoiiwhjyocqvqqgebla). Повторно НЕ накатувати.
-- migration 038 — pin search_path on every public function.
--
-- Advisors: function_search_path_mutable (WARN) on 24 functions. A function with
-- no `SET search_path` resolves unqualified names against the CALLER's session
-- search_path, which a caller can repoint. (All these functions are SECURITY
-- INVOKER, so there is no privilege escalation across a boundary — this is
-- low-severity hardening, not an active hole — but the linter wants it pinned.)
--
-- Value chosen: `public`. pg_catalog is always searched first implicitly, so
-- built-ins (now(), greatest(), interval, ...) keep resolving; unqualified public
-- objects resolve; pg_temp is forced last, so no temp-table shadowing. Safe to
-- apply to every function regardless of whether its body is fully schema-qualified.
--
-- (The stricter `SET search_path = ''` — forcing full qualification everywhere —
-- is an alternative, but would require auditing all 24 bodies and offers little
-- extra value for SECURITY INVOKER functions.)
--
-- Blanket DO block: pins any public function that isn't already pinned. Idempotent.

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and not exists (
        select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%'
      )
  loop
    execute format('alter function %s set search_path = public;', r.sig);
  end loop;
end $$;
