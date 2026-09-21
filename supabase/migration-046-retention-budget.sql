-- migration 046 — a lifetime budget for retention nudges. APPLIED 2026-09-21.
--
-- Measured: 44 of 133 users blocked the bot AFTER receiving at least one
-- message from it. The cron re-nudged every inactive account every 48 hours
-- with no end, so someone who drifted away for three weeks collected roughly
-- ten "come back" messages.
--
-- Nobody is persuaded by the tenth. They block — and a blocked bot can never
-- deliver the one message that would actually bring them back, a real match.
-- Retention spam does not merely fail; it destroys the channel it runs on.
alter table public.users
  add column if not exists retention_push_count integer not null default 0;

-- Anyone already nudged has had at least one. Conservative on purpose: it
-- under-counts rather than silencing someone who has not been bothered yet.
update public.users
set retention_push_count = 1
where last_retention_push is not null and retention_push_count = 0;
