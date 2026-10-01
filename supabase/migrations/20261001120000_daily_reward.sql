-- Daily reward: once a day, a free booster of the player's choice, opened at
-- once (it does not use the booster stock). Every 5th daily reward is a Super
-- Booster: every card, with better odds (DAILY and SUPER_BOOSTER in
-- server/config.js). Can be run again.

-- The Super Booster: not on the shelf, only given by the daily reward.
insert into public.booster_sets (id, position, name, jp, tagline, era, colors) values
  ('super', 5, 'Super Booster', 'スーパー', 'Every card · better odds', null, array['#7b2cbf', '#ffd23f'])
on conflict (id) do nothing;

-- One row per daily reward claimed: a player gets at most one per day.
create table if not exists public.daily_rewards (
  player_id  uuid not null references public.players (id) on delete cascade,
  day        date not null,               -- the reward's day (it changes at midnight in DAILY.timeZone)
  number     int not null,                -- 1 = the player's first daily reward
  set_id     text not null references public.booster_sets (id),
  booster_id bigint references public.boosters (id) on delete set null,
  claimed_at timestamptz not null default now(),
  primary key (player_id, day)
);

-- Daily rewards claimed by each player, and the day of the last one.
create or replace view public.player_daily with (security_invoker = true) as
select player_id, count(*)::int as claims, max(day) as last_day
from public.daily_rewards
group by player_id;

-- ── Claiming the daily reward in one transaction ─────────────────────────────
-- p_day: today's reward day, p_number: the number of this reward (claims so far
-- + 1: the server chose a Super Booster or not from it), p_booster: the 5 cards
-- [{ "id": "naruto", "rarity": "SSR" }, …].
-- Returns { "boosters": <record_boosters result> }, or { "error": "claimed" }
-- when today's reward is already claimed (or another claim changed the number).
create or replace function public.claim_daily(p_player_id uuid, p_day date, p_number int, p_set_id text, p_booster jsonb)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  claims int;
  saved  jsonb;
begin
  -- The player row is locked: two requests cannot claim the same day.
  perform 1 from public.players where id = p_player_id for update;
  if not found then
    return jsonb_build_object('error', 'no_player');
  end if;

  select count(*) into claims from public.daily_rewards where player_id = p_player_id;
  if claims + 1 <> p_number
     or exists (select 1 from public.daily_rewards where player_id = p_player_id and day >= p_day) then
    return jsonb_build_object('error', 'claimed');
  end if;

  saved := public.record_boosters(p_player_id, p_set_id, jsonb_build_array(p_booster));
  insert into public.daily_rewards (player_id, day, number, set_id, booster_id)
  values (p_player_id, p_day, p_number, p_set_id, (saved -> 0 ->> 'id')::bigint);
  return jsonb_build_object('boosters', saved);
end;
$$;

-- ── Security (same rules as the other player tables) ─────────────────────────
alter table public.daily_rewards enable row level security;

revoke all on public.player_daily from anon, authenticated;
revoke execute on function public.claim_daily(uuid, date, int, text, jsonb) from public, anon, authenticated;
grant execute on function public.claim_daily(uuid, date, int, text, jsonb) to service_role;
