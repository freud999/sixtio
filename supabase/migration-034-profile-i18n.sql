-- Migration 034 — profile text follows the reader's language.
-- Run in Supabase Dashboard -> SQL Editor -> New query -> Run.
--
-- The Digital Twin (traits / vibe / summary) is generated ONCE, in whatever
-- language the user happened to onboard in, and the bio is typed once in the
-- user's own language. Switching the interface language re-labelled every
-- button and left all of that untouched — so an English user reading a
-- Ukrainian profile got a fully English chrome wrapped around text they cannot
-- read, on the one screen where the text is the entire point.
--
-- Re-generating in the new language is the wrong fix: it costs a full interview
-- pass and, worse, the Twin would come back subtly DIFFERENT each time, so a
-- user's own profile would change meaning when they toggled the language.
-- Translation preserves the original reading; only the wording moves.
--
--   * <table>.<col>_i18n — { "en": …, "ru": … } cache, filled lazily on first
--     view in a language and then free forever.
--   * <table>.<col>_lang — the language the ORIGINAL is in. Without it we
--     cannot tell "no translation needed" from "not translated yet", and would
--     either translate uk→uk or serve the wrong language.
--
-- Deliberately NOT backfilled: the original language of existing rows is only
-- knowable by guessing, and the code falls back to users.language_code for a
-- null, which is the same guess without freezing it into the data.

alter table public.profiles
  add column if not exists i18n jsonb not null default '{}'::jsonb,
  add column if not exists lang text;

-- The bio lives on users (it is user-typed, not AI-generated) and needs the
-- same treatment for the same reason.
alter table public.users
  add column if not exists bio_i18n jsonb not null default '{}'::jsonb,
  add column if not exists bio_lang text;
