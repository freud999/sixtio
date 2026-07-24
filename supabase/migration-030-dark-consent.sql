-- Migration 030 — Dark Mode (18+): explicit, recorded consent.
-- Run in Supabase Dashboard -> SQL Editor -> New query -> Run.
--
-- Kink markers are special-category personal data (GDPR Art. 9 / ЗУ «Про захист
-- персональних даних» ст. 7). A clause buried in the privacy policy is NOT valid
-- consent for that category: it must be a separate, affirmative, specific act,
-- and we must be able to demonstrate it afterwards. These three columns are that
-- demonstration — nothing else about Dark Mode changes.
--
--   * dark_consent_at        — when the user affirmatively enabled the layer.
--   * dark_consent_version   — WHICH consent text they saw. Reworded the screen?
--                              Bump the version in api/_lib/darkmode.js and old
--                              consents stop counting, so the record can never
--                              silently drift away from what was actually shown.
--   * dark_age_confirmed_at  — the separate "I am 18+" affirmation. Kept apart
--                              from the consent timestamp on purpose: they are
--                              two different legal statements.
--
-- Withdrawal is deliberately NOT a new column: turning Dark Mode off already
-- clears dark_mode_active, which is what actually stops the processing. The
-- timestamps stay as the audit trail of the consent that was once given.

alter table public.users
  add column if not exists dark_consent_at       timestamptz,
  add column if not exists dark_consent_version  text,
  add column if not exists dark_age_confirmed_at timestamptz;

-- Backfill: users already inside the intimate layer consented under the pre-v1
-- flow (the client-side 18+ checkbox). Mark them explicitly rather than leaving
-- a null that reads as "never asked" — and mark them with a version that is NOT
-- the current one, so the app re-asks them properly on their next toggle.
update public.users
   set dark_consent_at      = coalesce(dark_consent_at, now()),
       dark_consent_version = coalesce(dark_consent_version, 'legacy')
 where dark_mode_active = true
   and dark_consent_at is null;
