-- Migration 017 — Executive analytics: Stars transaction ledger + dashboard RPC.
-- Run in Supabase Dashboard -> SQL Editor -> New query -> Run.
--
-- Powers the owner-only /stats dashboard (api/_lib/analytics.js, routed through
-- the Telegram webhook on /api/chat). Until now money was only a running
-- users.stars_balance with no history, so revenue-over-time, feature splits and
-- the 24h/7d/30d/MoM filters were impossible. This adds an append-only ledger and
-- teaches every spend RPC to log one row per PAID spend (via a data-modifying CTE,
-- which Postgres always executes even when its output is unused). All additive:
-- balances and existing return contracts are untouched. Metrics accrue from now on
-- (no historical backfill exists).

-- --- Append-only revenue ledger -----------------------------------------------
create table if not exists public.star_transactions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references public.users(id) on delete set null, -- keep revenue if user deletes
  feature    text    not null,   -- 'premium' | 'swipe_pack' | 'mystery_match' | 'lootbox' | 'why_factor'
  amount     integer not null,   -- Stars spent, always > 0 (gross revenue)
  created_at timestamptz not null default now()
);
create index if not exists star_tx_created_idx on public.star_transactions (created_at);
create index if not exists star_tx_feature_idx on public.star_transactions (feature, created_at);

-- --- The Why Factor spend (was migration-016; now logs) ------------------------
-- Drop the old 2-arg version so only the logging one remains (CREATE OR REPLACE
-- with a new defaulted arg would otherwise leave a stale overload behind).
drop function if exists public.spend_stars(uuid, int);
create or replace function public.spend_stars(buyer uuid, price int, feat text default 'why_factor')
returns int
language plpgsql
as $$
declare new_balance int;
begin
  update public.users
     set stars_balance = stars_balance - price
   where id = buyer and stars_balance >= price
   returning stars_balance into new_balance;

  if new_balance is not null and price > 0 then
    insert into public.star_transactions (user_id, feature, amount)
    values (buyer, feat, price);
  end if;

  return new_balance;   -- null = insufficient funds / no such user
end;
$$;

-- --- Premium (150 stars / 30d) — same guard, now logs -------------------------
create or replace function public.purchase_premium(buyer uuid, price int, days int)
returns integer
language sql
as $$
  with upd as (
    update public.users
      set stars_balance = stars_balance - price,
          premium = true,
          premium_until = greatest(now(), coalesce(premium_until, now()))
                          + (days || ' days')::interval
      where id = buyer and stars_balance >= price
      returning id, stars_balance
  ), logged as (
    insert into public.star_transactions (user_id, feature, amount)
    select id, 'premium', price from upd
    returning 1
  )
  select stars_balance from upd;
$$;

-- --- +30 likes top-up (10 stars) — now logs ----------------------------------
create or replace function public.purchase_swipe_pack(buyer uuid, price int)
returns integer
language sql
as $$
  with upd as (
    update public.users
      set stars_balance = stars_balance - price,
          daily_likes_count = greatest(0, daily_likes_count - 30)
      where id = buyer and stars_balance >= price
      returning id, stars_balance
  ), logged as (
    insert into public.star_transactions (user_id, feature, amount)
    select id, 'swipe_pack', price from upd
    returning 1
  )
  select stars_balance from upd;
$$;

-- --- Mystery Match unlock (10 stars) — now logs ------------------------------
create or replace function public.unlock_mystery_match(buyer uuid, price int)
returns integer
language sql
as $$
  with upd as (
    update public.users
      set stars_balance = stars_balance - price,
          mystery_match_unlocked = true
      where id = buyer
        and stars_balance >= price
        and mystery_match_unlocked = false
      returning id, stars_balance
  ), logged as (
    insert into public.star_transactions (user_id, feature, amount)
    select id, 'mystery_match', price from upd
    returning 1
  )
  select stars_balance from upd;
$$;

-- --- Lootbox open (first free / then 5 stars) — logs only PAID opens ----------
create or replace function public.open_lootbox(opener uuid, subsequent_price int, reward text)
returns table (charged integer, opened_today integer, balance integer)
language plpgsql
as $$
declare
  cur_opened int;
  cost       int;
  r_opened   int;
  r_balance  int;
begin
  update public.users
    set lootboxes_opened_today = 0
    where id = opener
      and (last_lootbox_time is null
           or (last_lootbox_time at time zone 'UTC')::date
              < (now() at time zone 'UTC')::date);

  select lootboxes_opened_today into cur_opened
    from public.users where id = opener for update;
  if cur_opened is null then
    return;                       -- no such user -> empty result
  end if;

  cost := case when cur_opened = 0 then 0 else subsequent_price end;

  if cost > 0 then
    perform 1 from public.users where id = opener and stars_balance >= cost;
    if not found then
      return;                     -- insufficient Stars -> empty result
    end if;
  end if;

  update public.users
    set stars_balance = stars_balance - cost,
        lootboxes_opened_today = lootboxes_opened_today + 1,
        last_lootbox_time = now(),
        daily_likes_count = case when reward = '+3_swipes'
                                 then greatest(0, daily_likes_count - 3)
                                 else daily_likes_count end
    where id = opener
    returning lootboxes_opened_today, stars_balance into r_opened, r_balance;

  if cost > 0 then                -- the free first open of the day is not revenue
    insert into public.star_transactions (user_id, feature, amount)
    values (opener, 'lootbox', cost);
  end if;

  charged := cost; opened_today := r_opened; balance := r_balance;
  return next;
end;
$$;

-- --- One-shot aggregation for the dashboard -----------------------------------
-- Returns the whole executive snapshot as JSON: point-in-time audience/premium/
-- all-time revenue, plus period-bounded [p_since, p_until) revenue & feature
-- counts. The JS layer calls it once per window (twice for MoM). service_role only.
create or replace function public.stats_dashboard(p_since timestamptz, p_until timestamptz)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'total_users', (select count(*) from public.users),
    'male',        (select count(*) from public.users where gender = 'male'),
    'female',      (select count(*) from public.users where gender = 'female'),
    'age_18_21',   (select count(*) from public.users where age between 18 and 21),
    'age_22_25',   (select count(*) from public.users where age between 22 and 25),
    'age_26_30',   (select count(*) from public.users where age between 26 and 30),
    'age_31_plus', (select count(*) from public.users where age >= 31),
    'top_cities',  (select coalesce(
                      jsonb_agg(jsonb_build_object('city', city, 'n', cnt) order by cnt desc),
                      '[]'::jsonb)
                    from (select city, count(*) cnt from public.users
                          where city is not null and city <> ''
                          group by city order by count(*) desc limit 5) t),
    'premium_active', (select count(*) from public.users
                        where premium_until is not null and premium_until > now()),
    'new_users_period', (select count(*) from public.users
                          where created_at >= p_since and created_at < p_until),
    'revenue_all',    (select coalesce(sum(amount),0) from public.star_transactions),
    'revenue_period', (select coalesce(sum(amount),0) from public.star_transactions
                        where created_at >= p_since and created_at < p_until),
    'tx_all', (select coalesce(jsonb_object_agg(feature, n), '{}'::jsonb)
                 from (select feature, count(*) n from public.star_transactions
                       group by feature) a),
    'rev_period_by_feature', (select coalesce(jsonb_object_agg(feature, s), '{}'::jsonb)
                 from (select feature, sum(amount) s from public.star_transactions
                       where created_at >= p_since and created_at < p_until
                       group by feature) b),
    'tx_period_by_feature', (select coalesce(jsonb_object_agg(feature, n), '{}'::jsonb)
                 from (select feature, count(*) n from public.star_transactions
                       where created_at >= p_since and created_at < p_until
                       group by feature) c),
    'referral_signups', (select count(*) from public.users where referred_by is not null),
    'referrers',        (select count(distinct referred_by) from public.users where referred_by is not null),
    'ai_interviews',    (select count(*) from public.profiles),   -- everyone who finished the AI interview
    'ai_matches',       (select count(*) from public.matches)     -- each match ran compatibility scoring
  );
$$;

-- All RPCs are invoked from serverless code holding the service_role key.
