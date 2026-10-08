-- The showcase of a profile, and a player resets their own collection once every 14 days
-- at most. Can be run again.
--
-- The showcase: up to 10 cards a player chooses among the ones they own (SHOWCASE in
-- server/config.js), in their order, shown on their profile and to their friends. The
-- server checks the cards when they are saved, and only shows the ones still owned.

alter table public.players add column if not exists showcase text[] not null default '{}' check (cardinality(showcase) <= 10);
-- When the player last reset their own collection (null: never).
alter table public.players add column if not exists collection_reset_at timestamptz;

-- ── Resetting a collection ───────────────────────────────────────────────────
-- Same as before, the showcase is emptied too, and the date is kept.
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
  update public.players set kira = 0, super_boosters = 0, showcase = '{}', collection_reset_at = now() where id = p_player_id;
  return deleted;
end;
$$;

-- A player resets their own collection (reset_collection), once every p_every seconds at most:
-- the date of the last reset is checked in the same transaction (two requests at the same time
-- cannot both reset). Returns { "deletedBoosters": n }, or { "error": "too_soon", "nextAt": date }
-- when the last reset is too recent.
create or replace function public.reset_own_collection(p_player_id uuid, p_every int)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  last_reset timestamptz;
  next_at    timestamptz;
begin
  select collection_reset_at into last_reset from public.players where id = p_player_id for update;
  if not found then
    return jsonb_build_object('error', 'no_player');
  end if;
  next_at := last_reset + make_interval(secs => p_every);
  if next_at > now() then
    return jsonb_build_object('error', 'too_soon', 'nextAt', next_at);
  end if;
  return jsonb_build_object('deletedBoosters', public.reset_collection(p_player_id));
end;
$$;

-- ── Clearing a player's data ─────────────────────────────────────────────────
-- Same as before, and the showcase is emptied too.
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
  set kira = 0, gems = 0, super_boosters = 0, boosters_from = null, stars_from = null, daily_super = false, showcase = '{}'
  where id = p_player_id;
  return deleted;
end;
$$;

-- ── Security (same rules as the other functions) ─────────────────────────────
revoke execute on function public.reset_own_collection(uuid, int) from public, anon, authenticated;
grant execute on function public.reset_own_collection(uuid, int) to service_role;
