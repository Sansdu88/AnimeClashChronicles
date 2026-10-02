-- Buying several boosters at once at the Kira market. Can be run again.
--
-- buy_booster (one booster) is kept for a server that is not updated yet.

-- ── Buying boosters with Kira, in one transaction ────────────────────────────
-- p_boosters: their cards [[{ "id": "naruto", "rarity": "SSR" }, …], …], p_price: for one
-- booster, in Kira. Nothing is bought if the player cannot pay for all of them.
-- Returns { "boosters": <record_boosters result>, "kira": new balance }, or
-- { "error": "no_kira", "kira": balance } when the player cannot pay.
create or replace function public.buy_boosters(p_player_id uuid, p_set_id text, p_boosters jsonb, p_price int)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  balance int;
  total   int := p_price * jsonb_array_length(p_boosters);
  saved   jsonb;
begin
  select kira into balance from public.players where id = p_player_id for update;
  if not found then
    return jsonb_build_object('error', 'no_player');
  end if;
  if balance < total then
    return jsonb_build_object('error', 'no_kira', 'kira', balance);
  end if;

  update public.players set kira = kira - total where id = p_player_id;
  saved := public.record_boosters(p_player_id, p_set_id, p_boosters);
  update public.boosters set kira = p_price
  where id in (select (value ->> 'id')::bigint from jsonb_array_elements(saved));
  return jsonb_build_object('boosters', saved, 'kira', balance - total);
end;
$$;

-- ── Security (same rules as the other functions) ─────────────────────────────
revoke execute on function public.buy_boosters(uuid, text, jsonb, int) from public, anon, authenticated;
grant execute on function public.buy_boosters(uuid, text, jsonb, int) to service_role;
