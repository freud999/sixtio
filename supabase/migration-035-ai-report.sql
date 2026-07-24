-- Migration 035 — AI-звіт: free reading, paid report.
-- Run in Supabase Dashboard -> SQL Editor -> New query -> Run.
--
-- Two tiers, and the split is what makes this honest:
--
--   * FREE  — the birth date turns into a sun sign, and the Big Five vector the
--             user already has turns into a socionics type. Both are computed in
--             plain JS (api/_lib/astro.js), cost nothing, and are shown in full.
--             Nobody pays to find out what their own type is.
--   * 50 ⭐ — the written report: one long-form AI analysis that reads those
--             facts together with the OCEAN scores, the goal and the values.
--             That is the part with a real marginal cost, so that is the part
--             that is sold.
--
-- The report is bought ONCE and kept forever: re-reading it is free, and so is
-- re-generating it if generation failed after the charge (see the RPC below).

-- --- birth data ------------------------------------------------------------
-- Date only is required; time and place are optional and exist so the reading
-- can say "sun sign only" honestly instead of implying a full natal chart it
-- does not have. `age` already exists on users and stays the field matching and
-- the feed use — birth_date is NOT wired into it, so no existing profile can be
-- silently re-aged by filling this in.
alter table public.users
  add column if not exists birth_date        date,
  add column if not exists birth_time        text,
  add column if not exists birth_place       text,
  add column if not exists ai_report_paid_at timestamptz;

-- --- the report itself -----------------------------------------------------
-- One row per user (the report is singular, so user_id IS the key). The sign and
-- type are stored ALONGSIDE the text: they are computed from data that can
-- change later (a corrected birth date, a re-run of the Big Five), and a report
-- must keep saying what it actually said when it was written.
--
-- lang + i18n mirror profiles.lang / profiles.i18n (migration 034): the original
-- language is recorded, and translations are cached per reader language so the
-- report follows the interface language like every other piece of profile text.
-- `sections` is jsonb ([{ key, body }, …]) rather than one blob of text: the
-- five sections are a fixed, schema-enforced shape (api/_lib/gemini.js), and
-- keeping them separate is what lets the client render real headings and lets
-- the translation cache work per section instead of re-translating the whole
-- report to fix one paragraph.
create table if not exists public.ai_reports (
  user_id    uuid primary key references public.users (id) on delete cascade,
  sections   jsonb not null,
  sign       text,
  socionics  text,
  lang       text,
  i18n       jsonb not null default '{}',
  created_at timestamptz not null default now()
);

-- --- purchase (50 ⭐) -------------------------------------------------------
-- Guarded exactly like every other Stars spend: the balance check and the
-- deduction are the same statement, so concurrent taps cannot double-charge or
-- drive the wallet negative.
--
-- The extra guard here is `ai_report_paid_at is null`, which makes the purchase
-- IDEMPOTENT for the lifetime of the account. That is what lets the endpoint
-- charge BEFORE generating: if Gemini then fails, the flag is already set, so
-- the retry regenerates for free instead of charging a second time for a report
-- the user never received. A refund path would have to be exactly right under
-- concurrency; not needing one is better than getting one right.
--
-- Returns the new balance, or NULL when the guard failed — the caller re-reads
-- the row to tell "already paid" apart from "not enough Stars".
create or replace function public.purchase_ai_report(buyer uuid, price integer)
returns integer
language sql
as $$
  with upd as (
    update public.users
       set stars_balance     = stars_balance - price,
           ai_report_paid_at = now()
     where id = buyer
       and ai_report_paid_at is null
       and stars_balance >= price
     returning id, stars_balance
  ), logged as (
    insert into public.star_transactions (user_id, feature, amount)
    select id, 'ai_report', price from upd
    returning 1
  )
  select stars_balance from upd;
$$;
