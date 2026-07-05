-- Migration 016 — generic guarded Stars spend.
-- Run in Supabase Dashboard -> SQL Editor -> New query -> Run.
--
-- Powers the "The Why Factor" AI reveal (api/chat.js op:'the_why_factor'):
-- a non-premium user pays 10 ⭐ per reveal. Deduction is a single guarded
-- statement so a user can never double-spend or go negative — the WHERE only
-- matches when the balance actually covers the price; otherwise it returns null.
create or replace function public.spend_stars(buyer uuid, price int)
returns int
language plpgsql
as $$
declare new_balance int;
begin
  update public.users
     set stars_balance = stars_balance - price
   where id = buyer and stars_balance >= price
   returning stars_balance into new_balance;
  return new_balance;   -- null = insufficient funds / no such user
end;
$$;
