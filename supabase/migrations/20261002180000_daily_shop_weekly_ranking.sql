-- The daily shop and the weekly ranking. Can be run again.
--
-- Daily shop: 5 cards a day, the same for everyone (drawn by the server from the
-- day, SHOP in server/config.js); a player can buy each of them once, with Kira.
-- Weekly ranking: the points of the cards pulled from Monday to Sunday (WEEKLY in
-- server/config.js). When the week ends, the best players get Super Boosters
-- (players.super_boosters, opened from the shelf) and Kira.

-- ── Daily shop ───────────────────────────────────────────────────────────────
-- A card bought at the daily shop is a card move (+1) with its day; its "kira" is
-- the Kira paid (for a recycled copy, -1, it is the Kira received).
alter table public.card_moves add column if not exists shop_day date;
create unique index if not exists card_moves_shop_once
  on public.card_moves (player_id, shop_day, card_id) where shop_day is not null;

-- Buys a card of the shop of p_day for p_price Kira, in one transaction.
-- Returns { "kira": new balance, "isNew": the player's first copy }, or
-- { "error": "bought" } when they already bought it that day, or
-- { "error": "no_kira", "kira": balance } when they cannot pay.
create or replace function public.buy_shop_card(p_player_id uuid, p_day date, p_card_id text, p_price int)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  balance  int;
  new_card boolean;
begin
  select kira into balance from public.players where id = p_player_id for update;
  if not found then
    return jsonb_build_object('error', 'no_player');
  end if;
  if exists (select 1 from public.card_moves where player_id = p_player_id and shop_day = p_day and card_id = p_card_id) then
    return jsonb_build_object('error', 'bought');
  end if;
  if balance < p_price then
    return jsonb_build_object('error', 'no_kira', 'kira', balance);
  end if;

  new_card := not exists (select 1 from public.player_collection where player_id = p_player_id and card_id = p_card_id);
  update public.players set kira = kira - p_price where id = p_player_id;
  insert into public.card_moves (player_id, card_id, delta, kira, shop_day) values (p_player_id, p_card_id, 1, p_price, p_day);
  return jsonb_build_object('kira', balance - p_price, 'isNew', new_card);
end;
$$;

-- ── Super Boosters won ───────────────────────────────────────────────────────
alter table public.players add column if not exists super_boosters int not null default 0 check (super_boosters >= 0);

-- Opens Super Boosters the player won (players.super_boosters), in one transaction.
-- p_boosters: [[{ "id": "naruto", "rarity": "SSR" }, … 5 cards], …].
-- Returns { "boosters": <record_boosters result> }, or { "error": "no_booster", "stock": left }.
create or replace function public.open_super_boosters(p_player_id uuid, p_set_id text, p_boosters jsonb)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  left_over int;
  wanted    int := jsonb_array_length(p_boosters);
begin
  select super_boosters into left_over from public.players where id = p_player_id for update;
  if not found then
    return jsonb_build_object('error', 'no_player');
  end if;
  if left_over < wanted then
    return jsonb_build_object('error', 'no_booster', 'stock', left_over);
  end if;

  update public.players set super_boosters = super_boosters - wanted where id = p_player_id;
  return jsonb_build_object('boosters', public.record_boosters(p_player_id, p_set_id, p_boosters));
end;
$$;

-- ── Weekly ranking ───────────────────────────────────────────────────────────
create index if not exists boosters_by_time on public.boosters (opened_at);

-- The cards pulled from p_from to p_to, by player, rarity and new or not, with the
-- time of the player's last booster (admins included: the server leaves them out).
create or replace function public.weekly_pulls(p_from timestamptz, p_to timestamptz)
returns table (player_id uuid, name text, is_admin boolean, rarity text, is_new boolean, pulls int, last_at timestamptz)
language sql
stable
set search_path = public
as $$
  select p.player_id, pl.name, pl.is_admin, p.rarity, p.is_new, count(*)::int, max(b.opened_at)
  from public.pulls p
  join public.boosters b on b.id = p.booster_id
  join public.players pl on pl.id = p.player_id
  where b.opened_at >= p_from and b.opened_at < p_to
  group by p.player_id, pl.name, pl.is_admin, p.rarity, p.is_new;
$$;

-- One row per week ranked (its Monday): the best players and what they won,
-- [{ "playerId", "name", "rank", "points", "superBoosters", "kira" }].
create table if not exists public.weekly_rankings (
  week       date primary key,
  settled_at timestamptz not null default now(),
  results    jsonb not null default '[]'
);

-- Ends the week p_week: saves its results and gives the rewards, in one transaction.
-- Returns false (and changes nothing) when that week was already ended.
create or replace function public.settle_week(p_week date, p_results jsonb)
returns boolean
language plpgsql
set search_path = public
as $$
declare
  item jsonb;
begin
  insert into public.weekly_rankings (week, results) values (p_week, p_results) on conflict (week) do nothing;
  if not found then
    return false;
  end if;
  for item in select value from jsonb_array_elements(p_results) loop
    update public.players
    set super_boosters = super_boosters + coalesce((item ->> 'superBoosters')::int, 0),
        kira = kira + coalesce((item ->> 'kira')::int, 0)
    where id = (item ->> 'playerId')::uuid;
  end loop;
  return true;
end;
$$;

-- The weeks before this one get no rewards: the first ranking to end is this week's.
insert into public.weekly_rankings (week)
values ((date_trunc('week', now() at time zone 'Europe/Paris'))::date - 7)
on conflict (week) do nothing;

-- ── Resetting a collection, clearing a player ────────────────────────────────
-- Same as before, and the Super Boosters won are gone too.
create or replace function public.reset_collection(p_player_id uuid)
returns int
language plpgsql
set search_path = public
as $$
declare
  deleted int;
begin
  perform 1 from public.players where id = p_player_id for update;
  update public.trades set status = 'canceled', closed_at = now()
  where (from_id = p_player_id or to_id = p_player_id) and status in ('pending', 'proposed');
  delete from public.card_moves where player_id = p_player_id;
  delete from public.boosters where player_id = p_player_id;
  get diagnostics deleted = row_count;
  update public.players set kira = 0, super_boosters = 0 where id = p_player_id;
  return deleted;
end;
$$;

create or replace function public.admin_clear_player(p_player_id uuid)
returns int
language plpgsql
set search_path = public
as $$
declare
  deleted int;
begin
  perform 1 from public.players where id = p_player_id for update;
  delete from public.trades where from_id = p_player_id or to_id = p_player_id;
  delete from public.friendships where requester_id = p_player_id or addressee_id = p_player_id;
  delete from public.card_moves where player_id = p_player_id;
  delete from public.daily_rewards where player_id = p_player_id;
  delete from public.boosters where player_id = p_player_id;
  get diagnostics deleted = row_count;
  update public.players
  set kira = 0, super_boosters = 0, boosters_from = null, stars_from = null, daily_super = false
  where id = p_player_id;
  return deleted;
end;
$$;

-- ── Security (same rules as the other tables and functions) ──────────────────
alter table public.weekly_rankings enable row level security;
revoke all on public.weekly_rankings from anon, authenticated;

revoke execute on function public.buy_shop_card(uuid, date, text, int) from public, anon, authenticated;
revoke execute on function public.open_super_boosters(uuid, text, jsonb) from public, anon, authenticated;
revoke execute on function public.weekly_pulls(timestamptz, timestamptz) from public, anon, authenticated;
revoke execute on function public.settle_week(date, jsonb) from public, anon, authenticated;
grant execute on function public.buy_shop_card(uuid, date, text, int) to service_role;
grant execute on function public.open_super_boosters(uuid, text, jsonb) to service_role;
grant execute on function public.weekly_pulls(timestamptz, timestamptz) to service_role;
grant execute on function public.settle_week(date, jsonb) to service_role;
