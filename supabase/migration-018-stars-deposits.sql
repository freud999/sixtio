-- Migration 018 — Real Telegram Stars deposits (Task 19).
-- Run in Supabase Dashboard -> SQL Editor -> New query -> Run.
--
-- Until now the Stars wallet (users.stars_balance) was only *earned* (referrals,
-- profile-completion bonus) and *spent* on features. This adds a real top-up rail:
-- a user pays Telegram Stars (currency XTR) via createInvoiceLink/openInvoice, the
-- successful_payment webhook (api/_lib/analytics.js, routed through /api/chat)
-- credits the wallet, and every deposit is recorded for reconciliation.
--
-- IDEMPOTENCY is the whole point of this table. Telegram delivers webhooks
-- at-least-once, so the same successful_payment can arrive twice. We key the
-- ledger on Telegram's telegram_payment_charge_id (globally unique per payment)
-- and credit ONLY on a fresh insert — a redelivered webhook is a silent no-op and
-- can never double-credit real money. All additive; nothing existing changes.

-- --- Deposit ledger (idempotency key = Telegram charge id) ---------------------
create table if not exists public.star_deposits (
  charge_id   text primary key,                                   -- telegram_payment_charge_id
  user_id     uuid references public.users(id) on delete set null,
  stars       integer not null,                                   -- Stars credited (XTR total_amount)
  payload     text,                                               -- our invoice payload, for audit
  created_at  timestamptz not null default now()
);
create index if not exists star_deposits_user_idx on public.star_deposits (user_id, created_at);

-- --- Atomic, idempotent credit ------------------------------------------------
-- Returns the new balance on a first-time credit, or NULL when this charge was
-- already processed (duplicate webhook) so the caller can no-op. The insert +
-- balance bump + analytics row all run in one statement-set; the ON CONFLICT
-- guard makes the whole thing safe under Telegram's at-least-once delivery.
create or replace function public.credit_stars_deposit(
  p_charge text, p_user uuid, p_tg bigint, p_stars int, p_payload text
) returns int
language plpgsql
as $$
declare new_balance int;
begin
  if p_charge is null or p_stars is null or p_stars <= 0 then
    return null;
  end if;

  -- Idempotency gate: a redelivered webhook for the same charge inserts nothing.
  insert into public.star_deposits (charge_id, user_id, stars, payload)
  values (p_charge, p_user, p_stars, p_payload)
  on conflict (charge_id) do nothing;

  if not found then
    return null;                       -- already credited this payment; do not repeat
  end if;

  -- Credit by telegram_id (the payer is always the authenticated Telegram user).
  update public.users
     set stars_balance = stars_balance + p_stars
   where telegram_id = p_tg
   returning stars_balance into new_balance;

  -- Mirror into the analytics ledger. NOTE: revenue_all / revenue_period in
  -- stats_dashboard sum star_transactions.amount, so deposits will show up there
  -- as real (money-in) revenue under feature 'stars_deposit'. The per-feature
  -- micro-transaction line only renders mystery/why_factor/lootbox, so it is
  -- unaffected. If you later want deposits reported as a separate line (vs. mixed
  -- into feature-spend revenue), that is a one-line dashboard tweak.
  insert into public.star_transactions (user_id, feature, amount)
  values (p_user, 'stars_deposit', p_stars);

  return new_balance;                  -- fresh credit applied
end;
$$;
