-- Rollback for migration 045. /broadcast stops choosing a variant and the
-- cooldown stops working, so run it only together with removing the command.
drop function if exists public.users_with_silent_match();
alter table public.users drop column if exists last_broadcast_at;
