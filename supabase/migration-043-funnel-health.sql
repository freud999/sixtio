-- migration 043 — funnel health in one query.
--
-- WHY. On 2026-08-29, 40 users had a Digital Twin and only 15 had a Big Five
-- vector: two thirds of the userbase with no compatibility percentage, for a
-- month, with no error anywhere. The request that computes the traits was
-- cancelled by a page navigation, and a cancelled request is not an error — not
-- in the logs, not in Vercel's error groups, not in an error reporter. The only
-- thing that could ever have noticed was a question asked of the OUTCOME.
--
-- WHY IN SQL. The first version counted these in JavaScript and got the
-- DENOMINATOR wrong, which is the whole game. It compared Twins against
-- "everyone who filled the questionnaire" (66) instead of "everyone who
-- finished the interview" (43) — turning a healthy 93% into an alarming 61%.
-- A monitor that cries wolf is worse than none, so the definition of each
-- cohort lives here, once, where it can be read and argued with.
--
-- interview_done deliberately ignores follow-up answers (ids ending in '_f'):
-- a follow-up is an extra, not one of the five questions that make an interview.
--
-- Additive: one read-only function. Rollback beside this file.

create or replace function public.funnel_health()
returns table (
  users          bigint,
  questionnaire  bigint,
  interview_done bigint,
  twins          bigint,
  big_five       bigint,
  photos         bigint,
  matches        bigint,
  messages       bigint,
  active_24h     bigint,
  active_7d      bigint,
  new_7d         bigint
)
language sql
stable
set search_path = public, pg_temp
as $$
  select
    (select count(*) from public.users),
    (select count(*) from public.users where gender is not null and age is not null),
    (select count(*) from (
       select a.user_id
       from public.answers a
       where a.question_id not like '%\_f'
       group by a.user_id
       having count(distinct a.question_id) >= 5
     ) done),
    (select count(*) from public.profiles),
    (select count(*) from public.profiles where trait_extraversion is not null),
    (select count(*) from public.users where photo_url is not null),
    (select count(*) from public.matches),
    (select count(*) from public.messages),
    (select count(*) from public.users where last_active > now() - interval '24 hours'),
    (select count(*) from public.users where last_active > now() - interval '7 days'),
    (select count(*) from public.users where created_at > now() - interval '7 days');
$$;

revoke all on function public.funnel_health() from public, anon, authenticated;
