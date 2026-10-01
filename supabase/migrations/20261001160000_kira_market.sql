-- The Kira market, and a booster stock of its own for All-Stars. Can be run again.
--
-- Kira (✦) is the game's money: players recycle their duplicates into Kira (by
-- rarity) and buy boosters with it (MARKET in server/config.js).
-- The era boosters keep their stock (players.boosters_from, one every 2 minutes);
-- All-Stars counts from players.stars_from (one every 10 minutes, STOCKS in
-- server/config.js). null = a full stock, like boosters_from.

alter table public.players add column if not exists kira int not null default 0 check (kira >= 0);
alter table public.players add column if not exists stars_from timestamptz;

-- Kira received for a copy recycled at the market (null: a card given in a trade).
alter table public.card_moves add column if not exists kira int;
-- Kira paid for a booster bought at the market (null: a free booster).
alter table public.boosters add column if not exists kira int;

-- ── Opening boosters from their stock, in one transaction ────────────────────
-- Same as before, but a set without an era (All-Stars) is taken from the
-- All-Stars stock (players.stars_from) instead of the era stock.
create or replace function public.open_boosters(p_player_id uuid, p_set_id text, p_boosters jsonb, p_every int, p_max int)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  all_stars boolean;
  since     timestamptz;
  start     timestamptz;
  elapsed   double precision;
  stock     int;
  wanted    int := jsonb_array_length(p_boosters);
  opened    timestamptz := now();
begin
  select era is null into all_stars from public.booster_sets where id = p_set_id;
  -- The player row is locked: two requests cannot spend the same boosters.
  select case when all_stars then stars_from else boosters_from end into since
  from public.players where id = p_player_id for update;
  if not found then
    return jsonb_build_object('error', 'no_player');
  end if;

  -- A full stock does not grow: count from at most p_max boosters ago.
  start := greatest(coalesce(since, '-infinity'::timestamptz), opened - make_interval(secs => p_every * p_max));
  elapsed := extract(epoch from opened - start);
  stock := least(p_max, floor(elapsed / p_every)::int);
  if stock < wanted then
    return jsonb_build_object('error', 'no_booster', 'stock', stock, 'nextIn', ceil(p_every - elapsed::numeric % p_every));
  end if;

  if all_stars then
    update public.players set stars_from = start + make_interval(secs => p_every * wanted) where id = p_player_id;
  else
    update public.players set boosters_from = start + make_interval(secs => p_every * wanted) where id = p_player_id;
  end if;
  return jsonb_build_object('boosters', public.record_boosters(p_player_id, p_set_id, p_boosters));
end;
$$;

-- ── Recycling duplicates into Kira, in one transaction ───────────────────────
-- p_cards: [{ "id": "naruto", "count": 2, "kira": 5 }], one entry per card (kira:
-- for one copy, from its rarity). A player keeps one copy of each card, and the
-- copies promised in open trades. Nothing is recycled if one card cannot be.
-- Returns { "kira": new balance, "recycled": copies, "earned": kira }, or
-- { "error": "not_enough", "id": card } when that card has fewer duplicates.
create or replace function public.recycle_cards(p_player_id uuid, p_cards jsonb)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  item     jsonb;
  spare    int;
  recycled int := 0;
  earned   int := 0;
  balance  int;
begin
  perform 1 from public.players where id = p_player_id for update;
  if not found then
    return jsonb_build_object('error', 'no_player');
  end if;

  for item in select value from jsonb_array_elements(p_cards) loop
    select coalesce(sum(c.count), 0) - 1 - (
             select count(*) from public.trades t
             where (t.from_id = p_player_id and t.from_card_id = item ->> 'id' and t.status in ('pending', 'proposed'))
                or (t.to_id = p_player_id and t.to_card_id = item ->> 'id' and t.status = 'proposed'))
      into spare
    from public.player_collection c
    where c.player_id = p_player_id and c.card_id = item ->> 'id';
    if spare < (item ->> 'count')::int then
      return jsonb_build_object('error', 'not_enough', 'id', item ->> 'id');
    end if;
  end loop;

  for item in select value from jsonb_array_elements(p_cards) loop
    insert into public.card_moves (player_id, card_id, delta, kira)
    select p_player_id, item ->> 'id', -1, (item ->> 'kira')::int
    from generate_series(1, (item ->> 'count')::int);
    recycled := recycled + (item ->> 'count')::int;
    earned := earned + (item ->> 'count')::int * (item ->> 'kira')::int;
  end loop;

  update public.players set kira = kira + earned where id = p_player_id returning kira into balance;
  return jsonb_build_object('kira', balance, 'recycled', recycled, 'earned', earned);
end;
$$;

-- ── Buying a booster with Kira, in one transaction ───────────────────────────
-- p_booster: its 5 cards [{ "id": "naruto", "rarity": "SSR" }, …], p_price: in Kira.
-- Returns { "boosters": <record_boosters result>, "kira": new balance }, or
-- { "error": "no_kira", "kira": balance } when the player cannot pay.
create or replace function public.buy_booster(p_player_id uuid, p_set_id text, p_booster jsonb, p_price int)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  balance int;
  saved   jsonb;
begin
  select kira into balance from public.players where id = p_player_id for update;
  if not found then
    return jsonb_build_object('error', 'no_player');
  end if;
  if balance < p_price then
    return jsonb_build_object('error', 'no_kira', 'kira', balance);
  end if;

  update public.players set kira = kira - p_price where id = p_player_id;
  saved := public.record_boosters(p_player_id, p_set_id, jsonb_build_array(p_booster));
  update public.boosters set kira = p_price where id = (saved -> 0 ->> 'id')::bigint;
  return jsonb_build_object('boosters', saved, 'kira', balance - p_price);
end;
$$;

-- ── Resetting a collection ───────────────────────────────────────────────────
-- Same as before (boosters, traded and recycled cards deleted, open trades
-- canceled), and the Kira goes back to 0.
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
  update public.players set kira = 0 where id = p_player_id;
  return deleted;
end;
$$;

-- ── Security (same rules as the other functions) ─────────────────────────────
revoke execute on function public.recycle_cards(uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.buy_booster(uuid, text, jsonb, int) from public, anon, authenticated;
grant execute on function public.recycle_cards(uuid, jsonb) to service_role;
grant execute on function public.buy_booster(uuid, text, jsonb, int) to service_role;
