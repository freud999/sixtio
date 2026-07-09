-- Task 38: robust /feedback flow.
-- Short-lived flag set when a user runs a bare "/feedback" in the bot. The next
-- plain message they send (no reply needed) is then treated as their feedback and
-- forwarded to the owner, after which the flag is cleared. NULL = not awaiting
-- feedback. Only messages within a short window (see api/_lib/commands.js) count,
-- so a stale flag can never silently capture an unrelated message much later.
alter table users add column if not exists feedback_pending_at timestamptz;
