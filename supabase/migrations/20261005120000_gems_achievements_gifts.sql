-- Gems, achievements and gifts. Can be run again.
--
-- Gems (💎) are the rare money of the game (GEMS in server/config.js): they buy the same
-- boosters and daily shop cards as Kira, at the Kira price divided by the rate set from the
-- admin panel (rounded up). Kira cannot be turned into gems: players get them from the
-- achievements (ACHIEVEMENTS: complete a booster, 200 gems each) and from gifts (GIFTS),
-- each claimed once from a popup.

alter table public.players add column if not exists gems int not null default 0 check (gems >= 0);
-- Gems paid for a booster bought at the market (null: not bought with gems).
alter table public.boosters add column if not exists gems int;
-- Gems paid for a card of the daily shop (null: not bought with gems).
alter table public.card_moves add column if not exists gems int;

-- ── Buying boosters with gems, in one transaction ────────────────────────────
-- Same as buy_boosters, paid with gems: p_price is the gems of one booster.
-- Returns { "boosters": <record_boosters result>, "gems": new balance }, or
-- { "error": "no_gems", "gems": balance } when the player cannot pay for all of them.
create or replace function public.buy_boosters_with_gems(p_player_id uuid, p_set_id text, p_boosters jsonb, p_price int)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  balance int;
  total   int := p_price * jsonb_array_length(p_boosters);
  saved   jsonb;
begin
  select gems into balance from public.players where id = p_player_id for update;
  if not found then
    return jsonb_build_object('error', 'no_player');
  end if;
  if balance < total then
    return jsonb_build_object('error', 'no_gems', 'gems', balance);
  end if;

  update public.players set gems = gems - total where id = p_player_id;
  saved := public.record_boosters(p_player_id, p_set_id, p_boosters);
  update public.boosters set gems = p_price
  where id in (select (value ->> 'id')::bigint from jsonb_array_elements(saved));
  return jsonb_build_object('boosters', saved, 'gems', balance - total);
end;
$$;

-- ── Buying a card of the daily shop with gems, in one transaction ────────────
-- Same as buy_shop_card, paid with gems (a card is bought once a day, Kira or gems).
-- Returns { "gems": new balance, "isNew": the player's first copy }, or { "error": "bought" }
-- or { "error": "no_gems", "gems": balance }.
create or replace function public.buy_shop_card_with_gems(p_player_id uuid, p_day date, p_card_id text, p_price int)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  balance  int;
  new_card boolean;
begin
  select gems into balance from public.players where id = p_player_id for update;
  if not found then
    return jsonb_build_object('error', 'no_player');
  end if;
  if exists (select 1 from public.card_moves where player_id = p_player_id and shop_day = p_day and card_id = p_card_id) then
    return jsonb_build_object('error', 'bought');
  end if;
  if balance < p_price then
    return jsonb_build_object('error', 'no_gems', 'gems', balance);
  end if;

  new_card := not exists (select 1 from public.player_collection where player_id = p_player_id and card_id = p_card_id);
  update public.players set gems = gems - p_price where id = p_player_id;
  insert into public.card_moves (player_id, card_id, delta, gems, shop_day) values (p_player_id, p_card_id, 1, p_price, p_day);
  return jsonb_build_object('gems', balance - p_price, 'isNew', new_card);
end;
$$;

-- ── Achievements ─────────────────────────────────────────────────────────────
-- One row per achievement a player unlocked (ACHIEVEMENTS in server/config.js), with
-- the gems it gave. seen_at: when the player saw the popup that celebrates it.
create table if not exists public.player_achievements (
  player_id   uuid not null references public.players (id) on delete cascade,
  achievement text not null,
  gems        int not null default 0,
  unlocked_at timestamptz not null default now(),
  seen_at     timestamptz,
  primary key (player_id, achievement)
);

-- Unlocks achievements and gives their gems, in one transaction; an achievement is
-- only unlocked (and paid) once. p_achievements: [{ "id": "complete-showa", "gems": 200 }].
-- Returns { "unlocked": [ids unlocked now], "gems": new balance }.
create or replace function public.unlock_achievements(p_player_id uuid, p_achievements jsonb)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  item     jsonb;
  unlocked jsonb := '[]'::jsonb;
  balance  int;
begin
  select gems into balance from public.players where id = p_player_id for update;
  if not found then
    return jsonb_build_object('error', 'no_player');
  end if;
  for item in select value from jsonb_array_elements(p_achievements) loop
    insert into public.player_achievements (player_id, achievement, gems)
    values (p_player_id, item ->> 'id', coalesce((item ->> 'gems')::int, 0))
    on conflict (player_id, achievement) do nothing;
    if found then
      unlocked := unlocked || to_jsonb(item ->> 'id');
      balance := balance + coalesce((item ->> 'gems')::int, 0);
    end if;
  end loop;
  update public.players set gems = balance where id = p_player_id;
  return jsonb_build_object('unlocked', unlocked, 'gems', balance);
end;
$$;

-- ── Gifts ────────────────────────────────────────────────────────────────────
-- One row per gift a player claimed (GIFTS in server/config.js): a gift is claimed once.
create table if not exists public.player_gifts (
  player_id  uuid not null references public.players (id) on delete cascade,
  gift       text not null,
  gems       int not null default 0,
  claimed_at timestamptz not null default now(),
  primary key (player_id, gift)
);

-- Claims a gift of p_gems gems, in one transaction. Returns { "gems": new balance },
-- or { "error": "claimed" } when the player already claimed it.
create or replace function public.claim_gift(p_player_id uuid, p_gift text, p_gems int)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  balance int;
begin
  perform 1 from public.players where id = p_player_id for update;
  if not found then
    return jsonb_build_object('error', 'no_player');
  end if;
  insert into public.player_gifts (player_id, gift, gems) values (p_player_id, p_gift, p_gems)
  on conflict (player_id, gift) do nothing;
  if not found then
    return jsonb_build_object('error', 'claimed');
  end if;
  update public.players set gems = gems + p_gems where id = p_player_id returning gems into balance;
  return jsonb_build_object('gems', balance);
end;
$$;

-- ── Clearing a player's data ─────────────────────────────────────────────────
-- Same as before, and their gems, achievements and gifts are gone too (a player who
-- resets their own collection keeps them: see reset_collection).
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
  update public.players
  set kira = 0, gems = 0, super_boosters = 0, boosters_from = null, stars_from = null, daily_super = false
  where id = p_player_id;
  return deleted;
end;
$$;

-- ── Security (same rules as the other tables and functions) ──────────────────
alter table public.player_achievements enable row level security;
alter table public.player_gifts enable row level security;
revoke all on public.player_achievements, public.player_gifts from anon, authenticated;

revoke execute on function public.buy_boosters_with_gems(uuid, text, jsonb, int) from public, anon, authenticated;
revoke execute on function public.buy_shop_card_with_gems(uuid, date, text, int) from public, anon, authenticated;
revoke execute on function public.unlock_achievements(uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.claim_gift(uuid, text, int) from public, anon, authenticated;
grant execute on function public.buy_boosters_with_gems(uuid, text, jsonb, int) to service_role;
grant execute on function public.buy_shop_card_with_gems(uuid, date, text, int) to service_role;
grant execute on function public.unlock_achievements(uuid, jsonb) to service_role;
grant execute on function public.claim_gift(uuid, text, int) to service_role;
