-- Migration 009 — swipe recommendation feed (like / dislike).
-- Run in Supabase Dashboard -> SQL Editor -> New query -> Run.
--
-- The "Find a Match" deck (feed.html) ranks opposite-gender candidates in the
-- user's age range by Big Five compatibility, highest first. Swiping right
-- (like) or left (dislike) records the target on the swiper's own user row so
-- it never resurfaces. All of this is local DB work — no AI is involved.

-- Swipe history + premium flag live directly on the user row.
--   liked_users / disliked_users : ids this user has already acted on (excluded
--                                  from their feed forever).
--   premium                      : gates the un-blurred candidate photo.
alter table public.users
  add column if not exists liked_users    uuid[]  not null default '{}',
  add column if not exists disliked_users uuid[]  not null default '{}',
  add column if not exists premium         boolean not null default false;

-- Atomic swipe: appends `target` to the right array in a single statement,
-- guarded so a repeated swipe can't duplicate the id (no read-modify-write
-- race). Mirrors the increment_stars_by_tg pattern from migration 008.
create or replace function public.record_swipe(swiper uuid, target uuid, liked boolean)
returns void
language plpgsql
as $$
begin
  if liked then
    update public.users
      set liked_users = array_append(liked_users, target)
      where id = swiper
        and not (target = any(liked_users));
  else
    update public.users
      set disliked_users = array_append(disliked_users, target)
      where id = swiper
        and not (target = any(disliked_users));
  end if;
end;
$$;

-- Called from serverless code holding the service_role key (bypasses RLS).
