-- migration 049 — recover what the 47-day AI outage left behind.
--
-- From 2026-10-06 20:01 UTC to 2026-11-23 the Anthropic balance was empty.
-- Every Digital Twin, Big Five and photo check failed for the whole period:
-- 44 people finished the entire interview and got no profile, and 17 photos
-- were stored WITHOUT the 18+ check because PHOTO_MODERATION_FAIL_OPEN was on.
--
-- The client already repairs a user who opens the app again — but only 10 of
-- the 46 who arrived in that window ever did. Recovery has to happen on the
-- server, without waiting for people who are not coming back on their own.

-- 1) Whether a photo has actually passed moderation.
--
-- Until now the app could not tell. photo_url said "has a photo", and a photo
-- stored by the fail-open path looked exactly like one that was checked. So
-- after an outage there was no way to find the unchecked ones except by
-- guessing from timestamps. From here on photo.js stamps this column only
-- when a verdict actually came back; a fail-open upload leaves it NULL, and
-- recovery re-checks every NULL.
alter table public.users
  add column if not exists photo_checked_at timestamptz;

-- Backfill: a photo whose file predates the outage went through the gate that
-- was working then. Everything uploaded since 2026-10-06 20:01 stays NULL and
-- will be re-checked. Matched on the storage object's own timestamp, not on the
-- user's signup date — one existing user replaced their photo mid-outage.
update public.users u
   set photo_checked_at = o.updated_at
  from storage.objects o
 where o.bucket_id = 'photos'
   and o.name = u.id::text || '.jpg'
   and u.photo_url is not null
   and u.photo_checked_at is null
   and o.updated_at < '2026-10-06 20:01:00+00';

-- 2) Who finished the interview but never got a Digital Twin.
--
-- The same definition as funnel_health (migration 043): five distinct main
-- questions answered, follow-ups ('_f') not counted. Ordered oldest first, so
-- the people who have waited longest are repaired first.
create or replace function public.users_needing_twin(p_limit integer default 10)
returns table (user_id uuid, gender text, language_code text)
language sql
stable
set search_path = public, pg_temp
as $$
  select u.id, u.gender, u.language_code
  from public.users u
  where not exists (select 1 from public.profiles p where p.user_id = u.id)
    and (select count(distinct a.question_id)
           from public.answers a
          where a.user_id = u.id
            and a.question_id not like '%\_f') >= 5
  order by u.created_at
  limit greatest(1, coalesce(p_limit, 10));
$$;

revoke all on function public.users_needing_twin(integer) from public, anon, authenticated;
