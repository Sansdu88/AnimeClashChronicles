-- Admin panel: admins, the game settings they change, and their tools on the
-- players. Can be run again.
--
-- An admin is set from the SQL Editor (never from the website):
--   update public.players set is_admin = true where email = 'you@example.com';

alter table public.players add column if not exists is_admin boolean not null default false;
-- A gift from the admins: the player's next daily reward is a Super Booster.
alter table public.players add column if not exists daily_super boolean not null default false;

-- ── Game settings ────────────────────────────────────────────────────────────
-- One row: the settings changed from the admin panel (booster odds, Kira prices
-- and values, daily reward). Missing values keep their default (server/config.js).
create table if not exists public.game_settings (
  id         boolean primary key default true check (id),
  settings   jsonb not null default '{}',
  updated_at timestamptz not null default now(),
  updated_by uuid references public.players (id) on delete set null
);

-- ── Clearing a player's data ─────────────────────────────────────────────────
-- Deletes everything the player did, but keeps their account: boosters and
-- cards, trades (their friends keep the cards they received), friends, daily
-- rewards and Kira; the booster stocks are full again. Returns the number of
-- boosters deleted.
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
  set kira = 0, boosters_from = null, stars_from = null, daily_super = false
  where id = p_player_id;
  return deleted;
end;
$$;

-- ── Security (same rules as the other tables and functions) ──────────────────
alter table public.game_settings enable row level security;

revoke execute on function public.admin_clear_player(uuid) from public, anon, authenticated;
grant execute on function public.admin_clear_player(uuid) to service_role;
