-- Rollback for 046. Removing the column restores the endless 48h drip, which is
-- what got the bot blocked by a third of its users — so drop the cap in the
-- code first, or do not run this at all.
alter table public.users drop column if exists retention_push_count;
