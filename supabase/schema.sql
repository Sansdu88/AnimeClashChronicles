-- ============================================================================
-- Anime Clash Chronicles — database schema for Supabase (PostgreSQL)
--
-- Run it once: Supabase dashboard → SQL Editor → New query → paste → Run.
-- It can be run again safely (it only creates what is missing).
--
-- Only the Node.js server talks to these tables, with the SECRET key (which
-- bypasses Row Level Security). RLS is enabled with no policy, so the public
-- (publishable) key cannot read or change anything.
-- ============================================================================

-- ── Players & accounts ───────────────────────────────────────────────────────
create table if not exists public.players (
  id            uuid primary key,
  name          text not null check (char_length(name) between 1 and 24),
  email         text unique,              -- stored in lower case by the server
  password_hash text,                     -- scrypt hash, never the password
  friend_code   text unique,              -- e.g. K7Q2XM, shown as #K7Q2XM
  created_at    timestamptz not null default now()
);

-- Login sessions: only a SHA-256 hash of each session token is stored.
create table if not exists public.sessions (
  token_hash text primary key,
  player_id  uuid not null references public.players (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists sessions_by_player on public.sessions (player_id);
create index if not exists sessions_by_expiry on public.sessions (expires_at);

-- ── Boosters & cards pulled ──────────────────────────────────────────────────
create table if not exists public.boosters (
  id        bigint generated always as identity primary key,
  player_id uuid not null references public.players (id) on delete cascade,
  set_id    text not null,                -- all-stars, showa, heisei, reiwa
  opened_at timestamptz not null default now()
);
create index if not exists boosters_by_player on public.boosters (player_id, id);

create table if not exists public.pulls (
  booster_id bigint not null references public.boosters (id) on delete cascade,
  position   smallint not null,           -- 1 to 5, in reveal order
  player_id  uuid not null references public.players (id) on delete cascade,
  card_id    text not null,               -- id of the card in data/cards.json
  rarity     text not null check (rarity in ('N', 'R', 'SR', 'SSR', 'UR')),
  is_new     boolean not null,            -- first copy of this card for the player
  primary key (booster_id, position)
);
create index if not exists pulls_by_player on public.pulls (player_id, card_id);

-- ── Friends ──────────────────────────────────────────────────────────────────
create table if not exists public.friendships (
  requester_id uuid not null,
  addressee_id uuid not null,
  status       text not null check (status in ('pending', 'accepted')),
  created_at   timestamptz not null default now(),
  responded_at timestamptz,
  primary key (requester_id, addressee_id),
  constraint friendships_requester_fk foreign key (requester_id) references public.players (id) on delete cascade,
  constraint friendships_addressee_fk foreign key (addressee_id) references public.players (id) on delete cascade,
  constraint friendships_not_self check (requester_id <> addressee_id)
);
create index if not exists friendships_by_addressee on public.friendships (addressee_id, status);

-- ── Summaries used by the API ────────────────────────────────────────────────
-- security_invoker: the views follow the Row Level Security of the tables.

-- Copies of each card per player.
create or replace view public.player_collection with (security_invoker = true) as
select p.player_id,
       p.card_id,
       count(*)::int    as count,
       min(b.opened_at) as first_pulled_at,
       max(b.opened_at) as last_pulled_at
from public.pulls p
join public.boosters b on b.id = p.booster_id
group by p.player_id, p.card_id;

create or replace view public.player_rarity_counts with (security_invoker = true) as
select player_id, rarity, count(*)::int as count
from public.pulls
group by player_id, rarity;

create or replace view public.player_booster_counts with (security_invoker = true) as
select player_id, set_id, count(*)::int as count
from public.boosters
group by player_id, set_id;

-- Players who opened at least one booster (global leaderboard).
create or replace view public.collectors with (security_invoker = true) as
select pl.id, pl.name, pl.created_at, count(b.id)::int as boosters_opened
from public.players pl
join public.boosters b on b.player_id = pl.id
group by pl.id;

-- ── Saving opened boosters in one transaction ────────────────────────────────
-- p_boosters: [[{ "id": "naruto", "rarity": "SSR" }, … 5 cards], …]
-- Returns:    [{ "id": 12, "openedAt": "…", "pulls": [{ "id": "naruto", "isNew": true }, …] }, …]
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
  select coalesce(array_agg(distinct card_id), '{}') into owned
  from public.pulls where player_id = p_player_id;

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

-- ── Security ─────────────────────────────────────────────────────────────────
alter table public.players     enable row level security;
alter table public.sessions    enable row level security;
alter table public.boosters    enable row level security;
alter table public.pulls       enable row level security;
alter table public.friendships enable row level security;

-- Nothing is readable or callable with the public keys: only the server (secret key).
revoke all on public.player_collection, public.player_rarity_counts, public.player_booster_counts, public.collectors
  from anon, authenticated;
revoke execute on function public.record_boosters(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.record_boosters(uuid, text, jsonb) to service_role;
