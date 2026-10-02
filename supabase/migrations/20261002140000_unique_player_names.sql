-- Players log in with their e-mail or their player name, so two players cannot have
-- the same name, whatever the case ("Luffy" and "luffy" are the same name). Names
-- never contain "@" (the server checks it): that is how a login tells them from e-mails.
-- Can be run again.

-- A name used by several players is kept by the oldest one; the others get their
-- friend code at the end of it (names are at most 24 characters).
update public.players p
set name = rtrim(left(p.name, 16)) || ' #' || coalesce(p.friend_code, left(p.id::text, 6))
from (
  select id, row_number() over (partition by lower(name) order by created_at, id) as rank
  from public.players
) same
where same.id = p.id and same.rank > 1;

create unique index if not exists players_name_key on public.players (lower(name));

-- ── Logging in with a player name ────────────────────────────────────────────
-- The account of a name, whatever its case: [{ id, password_hash }], or [] if none.
create or replace function public.find_login_by_name(p_name text)
returns table (id uuid, password_hash text)
language sql
stable
set search_path = public
as $$
  select p.id, p.password_hash from public.players p where lower(p.name) = lower(p_name);
$$;

-- ── Security (same rules as the other functions) ─────────────────────────────
revoke execute on function public.find_login_by_name(text) from public, anon, authenticated;
grant execute on function public.find_login_by_name(text) to service_role;
