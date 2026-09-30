-- ============================================================================
-- Anime Clash Chronicles — database schema for Supabase (PostgreSQL)
--
-- Run it once: Supabase dashboard → SQL Editor → New query → paste → Run.
-- It can be run again safely (it only creates what is missing).
--
-- Only the Node.js server talks to these tables, with the SECRET key (which
-- bypasses Row Level Security). RLS is enabled with no policy, so the public
-- (publishable) key cannot read or change anything — except the card catalog
-- (cards, booster_sets, catalog_info), which is public and read-only.
-- ============================================================================

-- ── Card catalog ─────────────────────────────────────────────────────────────
-- Filled by `npm run sync` (from Wikipedia) or `npm run db:import` (from a JSON file).
create table if not exists public.cards (
  id          text primary key,           -- e.g. "naruto"
  number      int not null,               -- collection number, 1 = oldest anime
  name        text not null,
  name_ja     text,
  rarity      text not null check (rarity in ('N', 'R', 'SR', 'SSR', 'UR')),
  type        text not null,              -- see TYPES in server/config.js
  year        int not null,
  era         text not null,              -- showa, heisei, reiwa
  power       int not null,
  views       int not null default 0,     -- Wikipedia page views (decides the rarity)
  description text,
  short       text,
  summary     text,
  image       jsonb,                      -- { src, width, height, file, credit }
  wiki_title  text,
  url         text,
  fr          jsonb,                      -- French texts, null without a French page
  source      text not null,              -- title in data/anime-list.js
  revision    bigint,                     -- Wikipedia revision (lets the sync skip unchanged pages)
  story_text  text,
  updated_at  timestamptz not null default now()
);
create index if not exists cards_by_number on public.cards (number);

-- The boosters players can open. era null = every card.
create table if not exists public.booster_sets (
  id       text primary key,
  position smallint not null,              -- display order
  name     text not null,
  jp       text,
  tagline  text,
  era      text,
  colors   text[] not null
);

insert into public.booster_sets (id, position, name, jp, tagline, era, colors) values
  ('all-stars', 1, 'All-Stars',       'オールスター', 'Every era, every legend',     null,     array['#e63946', '#ffb703']),
  ('showa',     2, 'Shōwa Classics',  '昭和',         'The pioneers · before 1989',  'showa',  array['#bc6c25', '#fefae0']),
  ('heisei',    3, 'Heisei Legends',  '平成',         'The golden age · 1989–2018', 'heisei', array['#3a0ca3', '#4cc9f0']),
  ('reiwa',     4, 'Reiwa New Wave',  '令和',         'Today''s hits · 2019+',      'reiwa',  array['#ff006e', '#8338ec'])
on conflict (id) do nothing;

-- One row: when and how the catalog was built.
create table if not exists public.catalog_info (
  id           boolean primary key default true check (id),
  generated_at timestamptz,
  popularity   jsonb,                     -- { metric, days, until }
  license      text
);

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
  card_id    text not null,               -- id of the card in public.cards
  rarity     text not null check (rarity in ('N', 'R', 'SR', 'SSR', 'UR')),
  is_new     boolean not null,            -- first copy of this card for the player
  primary key (booster_id, position)
);
create index if not exists pulls_by_player on public.pulls (player_id, card_id);

-- Pulled cards and opened boosters must exist in the catalog (a card that a
-- player owns cannot be deleted). "not valid": rows saved before the catalog
-- was in the database are not checked, only new ones.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'pulls_card_fk') then
    alter table public.pulls add constraint pulls_card_fk
      foreign key (card_id) references public.cards (id) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'boosters_set_fk') then
    alter table public.boosters add constraint boosters_set_fk
      foreign key (set_id) references public.booster_sets (id) not valid;
  end if;
end;
$$;

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
alter table public.cards        enable row level security;
alter table public.booster_sets enable row level security;
alter table public.catalog_info enable row level security;

-- The card catalog is public (it is shown on the website): anyone can read it,
-- only the server (secret key) can change it.
drop policy if exists "catalog is public" on public.cards;
create policy "catalog is public" on public.cards for select to anon, authenticated using (true);
drop policy if exists "catalog is public" on public.booster_sets;
create policy "catalog is public" on public.booster_sets for select to anon, authenticated using (true);
drop policy if exists "catalog is public" on public.catalog_info;
create policy "catalog is public" on public.catalog_info for select to anon, authenticated using (true);
grant select on public.cards, public.booster_sets, public.catalog_info to anon, authenticated;

-- Nothing is readable or callable with the public keys: only the server (secret key).
revoke all on public.player_collection, public.player_rarity_counts, public.player_booster_counts, public.collectors
  from anon, authenticated;
revoke execute on function public.record_boosters(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.record_boosters(uuid, text, jsonb) to service_role;
