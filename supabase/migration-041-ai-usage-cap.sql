-- ✅ ЗАСТОСОВАНО НА ПРОДІ 2026-08-05. Additive: дві колонки + одна функція.
-- Перевірено на проді одразу: cap=3 → 1,2,3,NULL,NULL; після зміни дати → 1.
-- migration 041 — per-user daily AI call ceiling (F-13 / SCALE-5).
--
-- Since 2026-08-05 (PRIV-1, option B) every AI call in the app is billed. The
-- in-memory limiter in _lib/ratelimit.js is deliberately per-instance and
-- fail-open — right for burst protection, useless as a spend ceiling, because a
-- cold start resets it and Vercel hands out cold starts freely.
--
-- A spend ceiling has to be durable and atomic, so it lives here. One RPC does
-- read-reset-increment-decide in a single statement: two concurrent onboarding
-- answers cannot both see "1 call used" and both proceed.
--
-- Reversible: drop the function, drop the columns (rollback-041 beside this).

alter table public.users
  add column if not exists ai_calls_today integer     not null default 0,
  add column if not exists ai_calls_day   date;

-- Returns the number of calls used AFTER this one, or NULL when the cap is
-- already spent. NULL means "refuse" — the caller degrades, never errors.
--
-- The day rolls over on first use rather than by a scheduled job: no scheduler
-- means nothing to notice when the scheduler dies, which this project has now
-- been bitten by twice.
create or replace function public.bump_ai_usage(p_user uuid, p_cap integer)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_used integer;
begin
  update public.users
     set ai_calls_today = case
           when ai_calls_day is distinct from current_date then 1
           else ai_calls_today + 1
         end,
         ai_calls_day = current_date
   where id = p_user
     and (ai_calls_day is distinct from current_date or ai_calls_today < p_cap)
  returning ai_calls_today into v_used;

  return v_used;   -- NULL when no row matched, i.e. the cap is spent
end;
$$;

revoke all on function public.bump_ai_usage(uuid, integer) from public, anon, authenticated;
