-- Migration 032 — referrals: drop the caps, raise the bar instead.
-- Run in Supabase Dashboard -> SQL Editor -> New query -> Run.
--
-- The old design paid 15 ⭐ on the invited user's FIRST SWIPE and then fought
-- farming with caps (10/day, 100 total). That was backwards: a swipe is trivial
-- to fake, so the caps were doing all the work — and they also punished the rare
-- honest user who really does invite thirty friends.
--
-- The caps are gone. What replaces them is a qualification that a farm cannot
-- cheaply fake, because it costs TIME and EFFORT rather than one tap:
--
--   * profile_depth >= 60  — the invited user actually filled a profile in;
--   * a D3 return          — they were still opening the app three days later.
--
-- A throwaway account can do either one of those, but doing both for every fake
-- invite is no longer cheaper than just earning the Stars. And since the reward
-- is internal currency, over-paying a genuine super-inviter costs us nothing.
--
-- referral_rewarded therefore must NOT flip until the user qualifies — the old
-- RPC flipped it immediately, which would now permanently deny the reward to
-- everyone who had not yet earned it. The single UPDATE below carries the whole
-- qualification in its WHERE clause, so it stays a win-the-race atomic flip:
-- unqualified calls simply match 0 rows and are a cheap no-op, which is what
-- lets us safely re-check on every app open.

-- Which rule granted a reward. Rules will change; without this, a later cohort
-- would be indistinguishable from an earlier one in the stats.
alter table public.referral_rewards
  add column if not exists qualified_via text;

create or replace function public.reward_referrer_qualified(
  p_invited   uuid,
  p_bonus     integer,
  p_min_depth integer,
  p_min_days  integer,
  p_rule      text
)
returns table(status text, referrer_tg bigint, hour_count integer)
language plpgsql
as $$
declare
  v_ref  bigint;
  v_hour int;
begin
  -- Atomic flip, gated on the full qualification. Only the caller that wins the
  -- false->true race for an ALREADY-QUALIFIED user proceeds; everybody else
  -- (not yet deep enough, not yet back on D3, no referrer, already paid) matches
  -- no rows and falls straight through.
  update public.users
     set referral_rewarded = true
   where id = p_invited
     and referral_rewarded = false
     and referred_by is not null
     and coalesce(profile_depth, 0) >= p_min_depth
     and last_active >= created_at + (p_min_days || ' days')::interval
   returning referred_by into v_ref;

  if v_ref is null then
    return;                                   -- not qualified (yet) — no-op
  end if;

  insert into public.referral_rewards (invited_user, referrer_tg, qualified_via)
  values (p_invited, v_ref, p_rule);

  update public.users
     set stars_balance = stars_balance + p_bonus
   where telegram_id = v_ref;

  -- No cap any more, but velocity is still worth watching: many qualifying
  -- invites inside one hour is either a viral moment or a well-funded farm, and
  -- the owner should hear about it either way.
  select count(*) into v_hour from public.referral_rewards
   where referrer_tg = v_ref and created_at > now() - interval '1 hour';

  return query select 'rewarded'::text, v_ref, v_hour;
end;
$$;
