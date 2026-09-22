-- migration 047 — every new account starts with 10 days of Premium.
--
-- WHY A COLUMN DEFAULT, not code. `upsertUser` is today the only path that
-- creates a users row, but "the only path today" is exactly the kind of fact
-- that stops being true quietly. A default lives in the one place every insert
-- has to pass through, so no future code path can register someone and forget
-- the trial. It also runs in the same statement as the insert — there is no
-- window where the account exists without it.
--
-- NEW ACCOUNTS ONLY. `SET DEFAULT` never touches existing rows, and the new
-- column is added WITHOUT a default first on purpose: `add column ... default
-- now()` would stamp every one of the existing 134 users as having received a
-- trial they never got.
--
-- A REAL premium_until, not a separate "trial" flag the paywall has to know
-- about. purchase_premium already extends from greatest(now(), premium_until),
-- so a user who buys on day 8 keeps their remaining trial days instead of
-- losing them — the trial and the paid subscription are the same clock.
--
-- trial_granted_at is what lets the app tell a trial from a paid subscription
-- (for the welcome message) without a second source of truth: a trial is a
-- premium_until that still equals trial_granted_at + 10 days.

alter table public.users
  add column if not exists trial_granted_at timestamptz;

alter table public.users
  alter column trial_granted_at set default now();

alter table public.users
  alter column premium_until set default (now() + interval '10 days');

comment on column public.users.trial_granted_at is
  'When the 10-day signup Premium trial was granted (null = account predates it).';
