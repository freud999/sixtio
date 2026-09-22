-- Rollback for 047. Stops granting the trial to NEW accounts. Accounts that
-- already received one keep it — premium_until on their row is untouched, and
-- revoking a gift people were promised in a popup is not something a rollback
-- should do silently.
alter table public.users alter column premium_until drop default;
alter table public.users alter column trial_granted_at drop default;
