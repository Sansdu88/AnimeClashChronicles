-- The Forge and the Wheel of Fortune. Can be run again.
--
-- The Forge (FORGE in server/config.js): duplicates of one rarity are melted into a random
-- card of the next rarity (5 N → 1 R … 5 UR → 1 REV by default); gems stand in for the
-- missing duplicates. A forge is a row of public.forges, and its cards are card moves: -1
-- for each duplicate melted, +1 for the card forged.
-- The Wheel of Fortune (WHEEL in server/config.js): a spin costs Kira (1,000 by default) or
-- gems, and wins boosters (opened at once), Super Boosters (players.super_boosters) or a card
-- (a card move). A spin is a row of public.wheel_spins.

-- ── Forge ────────────────────────────────────────────────────────────────────
create table if not exists public.forges (
  id        bigint generated always as identity primary key,
  player_id uuid not null references public.players (id) on delete cascade,
  rarity    text not null,                                 -- the rarity of the duplicates melted
  card_id   text not null references public.cards (id),    -- the card forged
  cards     int not null default 0,                        -- duplicates melted
  gems      int not null default 0,                        -- gems paid for the missing ones
  forged_at timestamptz not null default now()
);
create index if not exists forges_by_player on public.forges (player_id);

-- The forge a card move belongs to (a duplicate melted, or the card forged).
alter table public.card_moves add column if not exists forge_id bigint references public.forges (id) on delete cascade;

-- Melts duplicates into a card, in one transaction. p_cards: [{ "id": "naruto", "count": 2 }],
-- one entry per card, all of the rarity p_rarity (checked by the server); p_card_id: the card
-- forged; p_gems: the gems paid for the missing duplicates. A player keeps one copy of each card,
-- and the copies promised in open trades (as recycle_cards). Nothing is done if a card cannot be melted.
-- Returns { "gems": new balance, "isNew": the player's first copy of the card forged }, or
-- { "error": "not_enough", "id": card } or { "error": "no_gems", "gems": balance }.
create or replace function public.forge_card(p_player_id uuid, p_rarity text, p_cards jsonb, p_card_id text, p_gems int)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  item     jsonb;
  spare    int;
  balance  int;
  melted   int := 0;
  new_card boolean;
  forge    bigint;
begin
  select gems into balance from public.players where id = p_player_id for update;
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
    melted := melted + (item ->> 'count')::int;
  end loop;
  if balance < p_gems then
    return jsonb_build_object('error', 'no_gems', 'gems', balance);
  end if;

  new_card := not exists (select 1 from public.player_collection where player_id = p_player_id and card_id = p_card_id);
  insert into public.forges (player_id, rarity, card_id, cards, gems)
  values (p_player_id, p_rarity, p_card_id, melted, p_gems)
  returning id into forge;
  for item in select value from jsonb_array_elements(p_cards) loop
    insert into public.card_moves (player_id, card_id, delta, forge_id)
    select p_player_id, item ->> 'id', -1, forge
    from generate_series(1, (item ->> 'count')::int);
  end loop;
  insert into public.card_moves (player_id, card_id, delta, forge_id) values (p_player_id, p_card_id, 1, forge);

  update public.players set gems = gems - p_gems where id = p_player_id returning gems into balance;
  return jsonb_build_object('gems', balance, 'isNew', new_card);
end;
$$;

-- ── Wheel of Fortune ─────────────────────────────────────────────────────────
create table if not exists public.wheel_spins (
  id        bigint generated always as identity primary key,
  player_id uuid not null references public.players (id) on delete cascade,
  prize     text not null,  -- the prize won (an id of WHEEL.prizes)
  kira      int,            -- Kira paid (null: paid with gems)
  gems      int,            -- gems paid (null: paid with Kira)
  spun_at   timestamptz not null default now()
);
create index if not exists wheel_spins_by_player on public.wheel_spins (player_id);

-- The spin a booster or a card was won at.
alter table public.boosters add column if not exists spin_id bigint references public.wheel_spins (id) on delete set null;
alter table public.card_moves add column if not exists spin_id bigint references public.wheel_spins (id) on delete cascade;

-- Pays a spin (p_kira Kira or p_gems gems) and gives its prize, in one transaction: the boosters
-- p_boosters of p_set_id ([[{ "id": "naruto", "rarity": "SSR" }, … 5 cards], …], opened at once),
-- the card p_card_id, or p_super Super Boosters.
-- Returns { "kira", "gems": new balances, "boosters": <record_boosters result>, "isNew": the
-- player's first copy of the card won (null: no card) }, or { "error": "no_kira", "kira": balance }
-- or { "error": "no_gems", "gems": balance }.
create or replace function public.spin_wheel(
  p_player_id uuid, p_prize text, p_kira int, p_gems int,
  p_set_id text, p_boosters jsonb, p_card_id text, p_super int
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  kira_left int;
  gems_left int;
  spin      bigint;
  saved     jsonb := '[]'::jsonb;
  new_card  boolean;
begin
  select kira, gems into kira_left, gems_left from public.players where id = p_player_id for update;
  if not found then
    return jsonb_build_object('error', 'no_player');
  end if;
  if kira_left < p_kira then
    return jsonb_build_object('error', 'no_kira', 'kira', kira_left);
  end if;
  if gems_left < p_gems then
    return jsonb_build_object('error', 'no_gems', 'gems', gems_left);
  end if;

  insert into public.wheel_spins (player_id, prize, kira, gems)
  values (p_player_id, p_prize, nullif(p_kira, 0), nullif(p_gems, 0))
  returning id into spin;
  update public.players
  set kira = kira - p_kira, gems = gems - p_gems, super_boosters = super_boosters + coalesce(p_super, 0)
  where id = p_player_id
  returning kira, gems into kira_left, gems_left;

  if coalesce(jsonb_array_length(p_boosters), 0) > 0 then
    saved := public.record_boosters(p_player_id, p_set_id, p_boosters);
    update public.boosters set spin_id = spin
    where id in (select (value ->> 'id')::bigint from jsonb_array_elements(saved));
  end if;
  if p_card_id is not null then
    new_card := not exists (select 1 from public.player_collection where player_id = p_player_id and card_id = p_card_id);
    insert into public.card_moves (player_id, card_id, delta, spin_id) values (p_player_id, p_card_id, 1, spin);
  end if;
  return jsonb_build_object('kira', kira_left, 'gems', gems_left, 'boosters', saved, 'isNew', new_card);
end;
$$;

-- ── Resetting a collection ───────────────────────────────────────────────────
-- Same as before, and the forges and the spins of the wheel are deleted too.
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
  delete from public.forges where player_id = p_player_id;
  delete from public.wheel_spins where player_id = p_player_id;
  update public.players set kira = 0, super_boosters = 0, showcase = '{}', collection_reset_at = now() where id = p_player_id;
  return deleted;
end;
$$;

-- ── Clearing a player's data ─────────────────────────────────────────────────
-- Same as before, and the forges and the spins of the wheel are deleted too.
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
  delete from public.event_stocks where player_id = p_player_id;
  delete from public.player_achievements where player_id = p_player_id;
  delete from public.player_gifts where player_id = p_player_id;
  delete from public.boosters where player_id = p_player_id;
  get diagnostics deleted = row_count;
  delete from public.forges where player_id = p_player_id;
  delete from public.wheel_spins where player_id = p_player_id;
  update public.players
  set kira = 0, gems = 0, super_boosters = 0, boosters_from = null, stars_from = null, daily_super = false, showcase = '{}'
  where id = p_player_id;
  return deleted;
end;
$$;

-- ── Security (same rules as the other tables and functions) ──────────────────
alter table public.forges enable row level security;
alter table public.wheel_spins enable row level security;
revoke all on public.forges, public.wheel_spins from anon, authenticated;

revoke execute on function public.forge_card(uuid, text, jsonb, text, int) from public, anon, authenticated;
revoke execute on function public.spin_wheel(uuid, text, int, int, text, jsonb, text, int) from public, anon, authenticated;
grant execute on function public.forge_card(uuid, text, jsonb, text, int) to service_role;
grant execute on function public.spin_wheel(uuid, text, int, int, text, jsonb, text, int) to service_role;
