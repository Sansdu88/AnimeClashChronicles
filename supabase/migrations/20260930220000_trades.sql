-- Trades between friends. A player offers one copy of a card to a friend, the
-- friend chooses one of their own cards to give back (or declines), then the
-- first player accepts the swap (or cancels it). Can be run again.
--
-- A player's copies of a card = the copies pulled from boosters + the copies
-- received in trades - the copies given in trades (table card_moves).

-- ── Trades ───────────────────────────────────────────────────────────────────
create table if not exists public.trades (
  id           bigint generated always as identity primary key,
  from_id      uuid not null,               -- the player who offers a card
  to_id        uuid not null,               -- the friend who answers
  from_card_id text not null,               -- the card offered
  to_card_id   text,                        -- the card the friend gives back (null until they choose)
  status       text not null default 'pending'
               check (status in ('pending', 'proposed', 'accepted', 'declined', 'canceled')),
  created_at   timestamptz not null default now(),
  proposed_at  timestamptz,                 -- when the friend chose their card
  closed_at    timestamptz,                 -- accepted, declined or canceled
  constraint trades_from_fk foreign key (from_id) references public.players (id) on delete cascade,
  constraint trades_to_fk foreign key (to_id) references public.players (id) on delete cascade,
  constraint trades_from_card_fk foreign key (from_card_id) references public.cards (id),
  constraint trades_to_card_fk foreign key (to_card_id) references public.cards (id),
  constraint trades_not_self check (from_id <> to_id),
  constraint trades_card_chosen check (status not in ('proposed', 'accepted') or to_card_id is not null)
);
create index if not exists trades_by_from on public.trades (from_id, status);
create index if not exists trades_by_to on public.trades (to_id, status);

-- Cards that changed hands: -1 for the player who gave a copy, +1 for the one who got it.
create table if not exists public.card_moves (
  id        bigint generated always as identity primary key,
  player_id uuid not null references public.players (id) on delete cascade,
  card_id   text not null references public.cards (id),
  delta     smallint not null check (delta in (-1, 1)),
  trade_id  bigint references public.trades (id) on delete set null,
  moved_at  timestamptz not null default now()
);
create index if not exists card_moves_by_player on public.card_moves (player_id, card_id);

-- ── Collection = pulls + trades ──────────────────────────────────────────────
-- Same columns as before; first/last_pulled_at now also count the cards received in trades.
create or replace view public.player_collection with (security_invoker = true) as
with moves as (
  select p.player_id, p.card_id, 1 as delta, b.opened_at as at
  from public.pulls p
  join public.boosters b on b.id = p.booster_id
  union all
  select player_id, card_id, delta, moved_at
  from public.card_moves
)
select player_id,
       card_id,
       sum(delta)::int                  as count,
       min(at) filter (where delta > 0) as first_pulled_at,
       max(at) filter (where delta > 0) as last_pulled_at
from moves
group by player_id, card_id
having sum(delta) > 0;

-- A pulled card is "new" when the player does not own it at that moment
-- (they may have received it in a trade, or given away their last copy).
create or replace function public.record_boosters(p_player_id uuid, p_set_id text, p_boosters jsonb)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  booster   jsonb;
  card      jsonb;
  new_booster_id bigint;
  pos       int;
  owned     text[];
  new_card  boolean;
  pulls     jsonb;
  result    jsonb := '[]'::jsonb;
  opened    timestamptz := now();
begin
  select coalesce(array_agg(card_id), '{}') into owned
  from public.player_collection where player_id = p_player_id;

  for booster in select value from jsonb_array_elements(p_boosters) loop
    insert into public.boosters (player_id, set_id, opened_at)
    values (p_player_id, p_set_id, opened)
    returning id into new_booster_id;

    pulls := '[]'::jsonb;
    pos := 0;
    for card in select value from jsonb_array_elements(booster) loop
      pos := pos + 1;
      new_card := not (card ->> 'id' = any (owned));
      if new_card then
        owned := array_append(owned, card ->> 'id');
      end if;
      insert into public.pulls (booster_id, position, player_id, card_id, rarity, is_new)
      values (new_booster_id, pos, p_player_id, card ->> 'id', card ->> 'rarity', new_card);
      pulls := pulls || jsonb_build_object('id', card ->> 'id', 'isNew', new_card);
    end loop;

    result := result || jsonb_build_object('id', new_booster_id, 'openedAt', opened, 'pulls', pulls);
  end loop;

  return result;
end;
$$;

-- ── Accepting a trade in one transaction ─────────────────────────────────────
-- p_player_id is the player who offered the card (the last one to answer).
-- Returns 'accepted', or why the swap was not made: 'not_found' (no trade of
-- this player waiting for their answer), 'from_card_missing' (they no longer
-- own the card they offered) or 'to_card_missing' (same for the friend).
create or replace function public.complete_trade(p_trade_id bigint, p_player_id uuid)
returns text
language plpgsql
set search_path = public
as $$
declare
  trade public.trades;
begin
  select * into trade from public.trades
  where id = p_trade_id and from_id = p_player_id and status = 'proposed'
  for update;
  if not found then
    return 'not_found';
  end if;

  -- Lock both players (always in the same order): two trades cannot give away the same copy.
  perform 1 from public.players where id in (trade.from_id, trade.to_id) order by id for update;

  if not exists (select 1 from public.player_collection where player_id = trade.from_id and card_id = trade.from_card_id) then
    return 'from_card_missing';
  end if;
  if not exists (select 1 from public.player_collection where player_id = trade.to_id and card_id = trade.to_card_id) then
    return 'to_card_missing';
  end if;

  insert into public.card_moves (player_id, card_id, delta, trade_id) values
    (trade.from_id, trade.from_card_id, -1, trade.id),
    (trade.to_id,   trade.from_card_id,  1, trade.id),
    (trade.to_id,   trade.to_card_id,   -1, trade.id),
    (trade.from_id, trade.to_card_id,    1, trade.id);

  update public.trades set status = 'accepted', closed_at = now() where id = trade.id;
  return 'accepted';
end;
$$;

-- ── Resetting a collection ───────────────────────────────────────────────────
-- Deletes the player's boosters and the cards they traded, and cancels their
-- open trades (their friends keep what they received). Returns the number of
-- boosters deleted.
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
  return deleted;
end;
$$;

-- ── Security (same rules as the other player tables) ─────────────────────────
alter table public.trades     enable row level security;
alter table public.card_moves enable row level security;

revoke all on public.player_collection from anon, authenticated;
revoke execute on function public.complete_trade(bigint, uuid) from public, anon, authenticated;
revoke execute on function public.reset_collection(uuid) from public, anon, authenticated;
grant execute on function public.complete_trade(bigint, uuid) to service_role;
grant execute on function public.reset_collection(uuid) to service_role;
