-- Migration 019 — Atomic, idempotent profile-completion bonus (Task 21).
-- Run in Supabase Dashboard -> SQL Editor -> New query -> Run.
--
-- Background: reaching exactly 100% profile_depth awards a one-time +2 ⭐ bonus
-- (see api/me.js submitExtraQuestion). Until now that credit was applied as a
-- JS-side read-modify-write (patch.stars_balance = user.stars_balance + 2) — the
-- ONLY non-atomic balance mutation in the app. Under concurrency it could read a
-- stale balance and overwrite a coincident credit (a referral bonus or, since
-- Task 19, a real-money Stars deposit), silently losing those ⭐.
--
-- This replaces it with an atomic RPC. Idempotency is DB-enforced: a partial
-- unique index allows at most ONE 'profile_completion_bonus' ledger row per user,
-- so the bonus can never be double-claimed even under a race, and the credit +
-- ledger insert commit together (one function = one transaction). All additive.

-- --- One bonus per user, enforced by the database ------------------------------
-- Safe to build now: 'profile_completion_bonus' is a brand-new feature label, so
-- no pre-existing rows can violate the uniqueness constraint.
create unique index if not exists star_tx_profile_bonus_once
  on public.star_transactions (user_id)
  where feature = 'profile_completion_bonus';

-- --- Atomic, idempotent credit ------------------------------------------------
-- Returns the resulting balance. First claim: inserts the ledger marker, credits
-- +2, returns the new balance. Repeat claim: the partial unique index makes the
-- insert a no-op, so we skip the credit and just return the current balance —
-- never a second +2, never a clobbered concurrent credit.
create or replace function public.credit_profile_completion_bonus(user_id_param uuid)
returns int
language plpgsql
as $$
declare new_balance int;
begin
  -- Idempotency gate: the marker inserts only on the first claim (partial unique
  -- index). ON CONFLICT DO NOTHING + FOUND turns a repeat claim into a clean skip.
  insert into public.star_transactions (user_id, feature, amount)
  values (user_id_param, 'profile_completion_bonus', 2)
  on conflict do nothing;

  if not found then
    select stars_balance into new_balance from public.users where id = user_id_param;
    return new_balance;               -- already awarded — no double credit
  end if;

  update public.users
     set stars_balance = stars_balance + 2
   where id = user_id_param
   returning stars_balance into new_balance;

  return new_balance;                 -- fresh +2 applied atomically
end;
$$;
