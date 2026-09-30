-- Booster stock: a player gets one booster every 2 minutes and can keep up to 10
-- of them, to open them one by one or several in a row. Can be run again.
--
-- players.boosters_from: the stock is the number of 2-minute periods since this
-- date, at most 10 (null = full). Opening k boosters moves it k periods later.

alter table public.players add column if not exists boosters_from timestamptz;

-- Players who already opened boosters: their stock starts from their last booster
-- (the next one comes when it came before, and they get the time since then).
update public.players p
set boosters_from = b.last_opened
from (select player_id, max(opened_at) as last_opened from public.boosters group by player_id) b
where b.player_id = p.id and p.boosters_from is null;

-- ── Opening boosters from the stock, in one transaction ──────────────────────
-- p_boosters: [[{ "id": "naruto", "rarity": "SSR" }, … 5 cards], …] (1 to p_max boosters)
-- p_every: seconds for one booster, p_max: size of the stock.
-- Returns { "boosters": <record_boosters result> }, or when the stock is too
-- small { "error": "no_booster", "stock": n, "nextIn": seconds }.
create or replace function public.open_boosters(p_player_id uuid, p_set_id text, p_boosters jsonb, p_every int, p_max int)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  since   timestamptz;
  start   timestamptz;
  elapsed double precision;
  stock   int;
  wanted  int := jsonb_array_length(p_boosters);
  opened  timestamptz := now();
begin
  -- The player row is locked: two requests cannot spend the same boosters.
  select boosters_from into since from public.players where id = p_player_id for update;
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

  update public.players set boosters_from = start + make_interval(secs => p_every * wanted) where id = p_player_id;
  return jsonb_build_object('boosters', public.record_boosters(p_player_id, p_set_id, p_boosters));
end;
$$;

revoke execute on function public.open_boosters(uuid, text, jsonb, int, int) from public, anon, authenticated;
grant execute on function public.open_boosters(uuid, text, jsonb, int, int) to service_role;
