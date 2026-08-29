-- Rollback for migration 043 (funnel health).
-- Safe at any time: funnelHealth() returns null on any error, /stats simply
-- omits the health block, and the cron's check logs and moves on.

drop function if exists public.funnel_health();
