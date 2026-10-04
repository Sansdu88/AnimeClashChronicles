-- Events: limited-time events that the admins turn on and off from the admin panel
-- (EVENTS in server/config.js, settings.events). The first one is Halloween. Can be run again.
--
-- An event has its own booster set (booster_sets.event) made of its own cards
-- (cards.event): they form a collection of their own, that the players keep when the
-- event ends. While the event is on, its booster comes from a stock of its own (table
-- event_stocks): one every few hours, a few at most (set from the admin panel).

-- ── Event cards and boosters ─────────────────────────────────────────────────
alter table public.cards add column if not exists event text;        -- null: a card of the main collection
alter table public.booster_sets add column if not exists event text; -- null: a booster of the main collection

-- ── Event booster stocks ─────────────────────────────────────────────────────
-- One row per player and event: the stock counts one booster every p_every seconds
-- from `since`, at most p_max (no row = a full stock, like players.boosters_from).
create table if not exists public.event_stocks (
  player_id uuid not null references public.players (id) on delete cascade,
  event     text not null,
  since     timestamptz not null,
  primary key (player_id, event)
);

-- Opens boosters of an event from the player's stock of that event, in one transaction.
-- p_boosters: [[{ "id": "halloween:death-note", "rarity": "UR" }, … 5 cards], …]
-- p_every: seconds for one booster, p_max: size of the stock.
-- Returns { "boosters": <record_boosters result> }, or when the stock is too small
-- { "error": "no_booster", "stock": n, "nextIn": seconds }.
create or replace function public.open_event_boosters(p_player_id uuid, p_event text, p_set_id text, p_boosters jsonb, p_every int, p_max int)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  counted timestamptz;
  start   timestamptz;
  elapsed double precision;
  stock   int;
  wanted  int := jsonb_array_length(p_boosters);
  opened  timestamptz := now();
begin
  -- The player row is locked: two requests cannot spend the same boosters.
  perform 1 from public.players where id = p_player_id for update;
  if not found then
    return jsonb_build_object('error', 'no_player');
  end if;
  select s.since into counted from public.event_stocks s where s.player_id = p_player_id and s.event = p_event;

  -- A full stock does not grow: count from at most p_max boosters ago.
  start := greatest(coalesce(counted, '-infinity'::timestamptz), opened - make_interval(secs => p_every * p_max));
  elapsed := extract(epoch from opened - start);
  stock := least(p_max, floor(elapsed / p_every)::int);
  if stock < wanted then
    return jsonb_build_object('error', 'no_booster', 'stock', stock, 'nextIn', ceil(p_every - elapsed::numeric % p_every));
  end if;

  insert into public.event_stocks (player_id, event, since)
  values (p_player_id, p_event, start + make_interval(secs => p_every * wanted))
  on conflict (player_id, event) do update set since = excluded.since;
  return jsonb_build_object('boosters', public.record_boosters(p_player_id, p_set_id, p_boosters));
end;
$$;

-- ── Clearing a player's data ─────────────────────────────────────────────────
-- Same as before, and the stocks of the events are full again.
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
  delete from public.boosters where player_id = p_player_id;
  get diagnostics deleted = row_count;
  update public.players
  set kira = 0, super_boosters = 0, boosters_from = null, stars_from = null, daily_super = false
  where id = p_player_id;
  return deleted;
end;
$$;

-- ── Halloween ────────────────────────────────────────────────────────────────
-- The Halloween Booster: 100 spooky monsters of anime and manga. Each card is the
-- Halloween edition of a card of the catalog (same picture and texts, id
-- "halloween:<card id>"), with the monster of that anime as its description. Their
-- rarity follows the popularity of the anime among the 100, with the shares of the
-- main catalog: 1 REV, 5 UR, 12 SSR, 20 SR, 27 R and 35 N. Numbered by year.
insert into public.booster_sets (id, position, name, jp, tagline, era, colors, event) values
  ('halloween', 6, 'Halloween Booster', 'ハロウィン', 'Spooky monsters · limited time', null, array['#ff6b00', '#3c096c'], 'halloween')
on conflict (id) do update set
  name = excluded.name,
  jp = excluded.jp,
  tagline = excluded.tagline,
  colors = excluded.colors,
  event = excluded.event;

insert into public.cards (id, number, name, name_ja, rarity, type, year, era, power, views, languages,
                          description, short, summary, image, wiki_title, url, fr, source, revision, story_text, event, updated_at)
select 'halloween:' || c.id,
       row_number() over (order by c.year, c.name, c.id),
       c.name, c.name_ja, m.rarity, c.type, c.year, c.era, c.power, c.views, c.languages,
       m.monster, c.short, c.summary, c.image, c.wiki_title, c.url,
       case when c.fr is null then null
            else jsonb_set(c.fr - 'storyText' - 'revision', '{description}', to_jsonb(m.monster_fr)) end,
       'Halloween: ' || c.source, null::bigint, null::text, 'halloween', now()
from (values
  ('attack-on-titan', 'REV', 'The Titans', 'Les Titans'),
  ('spirited-away', 'UR', 'No-Face', 'Sans-Visage'),
  ('demon-slayer-kimetsu-no-yaiba', 'UR', 'Muzan Kibutsuji, the first demon', 'Muzan Kibutsuji, le premier démon'),
  ('death-note', 'UR', 'Ryuk, the Shinigami', 'Ryuk, le dieu de la mort'),
  ('jujutsu-kaisen', 'UR', 'Ryomen Sukuna, the King of Curses', 'Ryomen Sukuna, le Roi des Fléaux'),
  ('princess-mononoke', 'UR', 'Nago, the demon boar', 'Nago, le sanglier démon'),
  ('bleach', 'SSR', 'The Hollows', 'Les Hollows'),
  ('berserk', 'SSR', 'The Apostles', 'Les Apôtres'),
  ('chainsaw-man', 'SSR', 'Pochita, the Chainsaw Devil', 'Pochita, le démon Tronçonneuse'),
  ('inuyasha', 'SSR', 'Naraku, the half-demon', 'Naraku, le demi-démon'),
  ('monster', 'SSR', 'Johan Liebert, the human monster', 'Johan Liebert, le monstre humain'),
  ('tokyo-ghoul', 'SSR', 'Ken Kaneki, the half-ghoul', 'Ken Kaneki, la demi-goule'),
  ('yuyu-hakusho', 'SSR', 'Younger Toguro, the human turned demon', 'Toguro cadet, l’humain devenu démon'),
  ('higurashi-when-they-cry', 'SSR', 'Oyashiro-sama''s curse', 'La malédiction d''Oyashiro-sama'),
  ('dandadan', 'SSR', 'Turbo Granny, the speed yōkai', 'Turbo Granny, la yōkai de la vitesse'),
  ('elfen-lied', 'SSR', 'Lucy, the Diclonius', 'Lucy, la Diclonius'),
  ('hellsing', 'SSR', 'Alucard, the vampire', 'Alucard, le vampire'),
  ('the-promised-neverland', 'SSR', 'The demons', 'Les démons'),
  ('soul-eater', 'SR', 'Asura, the Kishin', 'Asura, le Kishin'),
  ('the-summer-hikaru-died', 'SR', 'The thing wearing Hikaru''s face', 'La chose qui a pris le visage de Hikaru'),
  ('uzumaki', 'SR', 'The cursed spiral', 'La spirale maudite'),
  ('black-butler', 'SR', 'Sebastian, the demon butler', 'Sebastian, le majordome démoniaque'),
  ('resident-evil-degeneration', 'SR', 'The G-virus mutant', 'Le mutant du virus G'),
  ('d-gray-man', 'SR', 'The Akuma', 'Les Akuma'),
  ('xxxholic', 'SR', 'The ayakashi spirits', 'Les esprits ayakashi'),
  ('paranoia-agent', 'SR', 'Lil'' Slugger, the boy with the bat', 'Shōnen Bat, le garçon à la batte'),
  ('highschool-of-the-dead', 'SR', '"Them", the walking dead', '« Eux », les morts-vivants'),
  ('kabaneri-of-the-iron-fortress', 'SR', 'The Kabane', 'Les Kabane'),
  ('parasyte', 'SR', 'Migi, the parasite', 'Migi, le parasite'),
  ('blue-exorcist', 'SR', 'Rin Okumura, son of Satan', 'Rin Okumura, fils de Satan'),
  ('seraph-of-the-end', 'SR', 'The vampire nobles', 'Les nobles vampires'),
  ('claymore', 'SR', 'The Yoma', 'Les Yoma'),
  ('kaiju-no-8', 'SR', 'Kaiju No. 8', 'Kaiju n° 8'),
  ('fire-force', 'SR', 'The Infernals', 'Les Infernaux'),
  ('dorohedoro', 'SR', 'Caiman, the lizard-headed man', 'Caïman, l''homme à tête de lézard'),
  ('mob-psycho-100', 'SR', 'Dimple, the evil spirit', 'Ekubo, l’esprit maléfique'),
  ('toilet-bound-hanako-kun', 'SR', 'Hanako-kun, the toilet ghost', 'Hanako-kun, le fantôme des toilettes'),
  ('mushishi', 'SR', 'The Mushi', 'Les mushi'),
  ('noragami', 'R', 'The Phantoms', 'Les ayakashi'),
  ('vampire-knight', 'R', 'Kaname Kuran, the pureblood vampire', 'Kaname Kuran, le vampire sang-pur'),
  ('dororo', 'R', 'The 48 demons', 'Les 48 démons'),
  ('devilman-crybaby', 'R', 'Amon, the demon', 'Amon, le démon'),
  ('vampire-hunter-d-bloodlust', 'R', 'Carmila, the Bloody Countess', 'Carmila, la comtesse sanglante'),
  ('ajin-demi-human', 'R', 'The black ghosts (IBM)', 'Les fantômes noirs (IBM)'),
  ('hell-s-paradise-jigokuraku', 'R', 'The Tensen', 'Les Tensen'),
  ('natsume-s-book-of-friends', 'R', 'Madara, alias Nyanko-sensei', 'Madara, alias Nyanko-sensei'),
  ('hell-girl', 'R', 'Ai Enma, the Hell Girl', 'Ai Enma, la fille des Enfers'),
  ('zombie-land-saga', 'R', 'The zombie idols', 'Les idoles zombies'),
  ('rosario-vampire', 'R', 'Moka Akashiya, the vampire', 'Moka Akashiya, la vampire'),
  ('deadman-wonderland', 'R', 'The Wretched Egg', 'Le Wretched Egg'),
  ('summer-time-rendering', 'R', 'The Shadows', 'Les Ombres'),
  ('tomie', 'R', 'Tomie, who never dies', 'Tomie, celle qui ne meurt jamais'),
  ('undead-unluck', 'R', 'Andy, the Undead', 'Andy, l''Undead'),
  ('the-case-study-of-vanitas', 'R', 'Noé Archiviste, the vampire', 'Noé Archiviste, le vampire'),
  ('phantom-blood', 'R', 'Dio Brando, the vampire', 'Dio Brando, le vampire'),
  ('ghost-stories', 'R', 'Amanojaku, the demon cat', 'Amanojaku, le chat démon'),
  ('mononoke', 'R', 'The mononoke', 'Les mononoke'),
  ('blood-the-last-vampire', 'R', 'Saya, the vampire hunter', 'Saya, la chasseuse de vampires'),
  ('rin-ne', 'R', 'Rinne Rokudō, part shinigami', 'Rinne Rokudō, en partie shinigami'),
  ('gegege-no-kitaro', 'R', 'Kitarō, the graveyard yōkai', 'Kitarō, le yōkai du cimetière'),
  ('i-am-a-hero', 'R', 'The ZQN', 'Les ZQN'),
  ('mieruko-chan', 'R', 'The ghosts only Miko can see', 'Les fantômes que seule Miko voit'),
  ('monster-musume', 'R', 'Miia, the lamia', 'Miia, la lamia'),
  ('ushio-tora', 'R', 'Tora, the tiger yōkai', 'Tora, le yōkai tigre'),
  ('chrono-crusade', 'R', 'Chrno, the demon', 'Chrno, le démon'),
  ('the-girl-from-the-other-side-siuil-a-run', 'N', 'Teacher, the cursed Outsider', 'Professeur, le Maudit'),
  ('tougen-anki', 'N', 'The descendants of the oni', 'Les descendants des oni'),
  ('kemono-jihen', 'N', 'The kemono', 'Les kemono'),
  ('gyo', 'N', 'The walking dead fish', 'Les poissons morts qui marchent'),
  ('sankarea-undying-love', 'N', 'Rea, the zombie girl', 'Rea, la zombie'),
  ('dark-gathering', 'N', 'The vengeful spirits', 'Les esprits vengeurs'),
  ('nura-rise-of-the-yokai-clan', 'N', 'Rikuo Nura, heir of the yōkai', 'Rikuo Nura, héritier des yōkai'),
  ('this-monster-wants-to-eat-me', 'N', 'Shiori, the mermaid', 'Shiori, la sirène'),
  ('godzilla-singular-point', 'N', 'Godzilla', 'Godzilla'),
  ('dead-mount-death-play', 'N', 'The Corpse God', 'Le Dieu des cadavres'),
  ('wicked-city', 'N', 'The demons of the Black World', 'Les démons du Monde noir'),
  ('junji-ito-collection', 'N', 'Souichi, the curse-casting boy', 'Souichi, le garçon qui jette des sorts'),
  ('hell-teacher-jigoku-sensei-nube', 'N', 'Nube''s demon hand', 'La main du démon de Nube'),
  ('yo-kai-watch-the-movie', 'N', 'Jibanyan, the ghost cat', 'Jibanyan, le chat fantôme'),
  ('vampire-princess-miyu', 'N', 'Miyu, the vampire princess', 'Miyu, la princesse vampire'),
  ('dusk-maiden-of-amnesia', 'N', 'Yūko Kanoe, the school ghost', 'Yūko Kanoe, le fantôme de l''école'),
  ('pet-shop-of-horrors', 'N', 'Count D', 'Le comte D'),
  ('blood-lad', 'N', 'Staz, the vampire boss', 'Staz, le boss vampire'),
  ('dance-in-the-vampire-bund', 'N', 'Mina Țepeș, the vampire queen', 'Mina Țepeș, la reine des vampires'),
  ('hozuki-s-coolheadedness', 'N', 'Hōzuki, the oni of Hell', 'Hōzuki, l''oni des Enfers'),
  ('ayakashi-samurai-horror-tales', 'N', 'Oiwa''s vengeful ghost', 'Le fantôme vengeur d''Oiwa'),
  ('baoh', 'N', 'Baoh, the parasite weapon', 'Baoh, l''arme parasite'),
  ('the-monster-kid', 'N', 'Dracula, Wolfman and Franken', 'Dracula, Loup-Garou et Franken'),
  ('ghost-cat-anzu', 'N', 'Anzu, the ghost cat', 'Anzu, le chat fantôme'),
  ('humanoid-monster-bem', 'N', 'Bem, Bela and Belo', 'Bem, Bela et Belo'),
  ('sarazanmai', 'N', 'The kappa zombies', 'Les kappas zombies'),
  ('boogiepop-phantom', 'N', 'Boogiepop, the shinigami', 'Boogiepop, le dieu de la mort'),
  ('how-to-keep-a-mummy', 'N', 'Mii-kun, the tiny mummy', 'Mii-kun, la petite momie'),
  ('don-dracula', 'N', 'Count Dracula', 'Le comte Dracula'),
  ('vampire-in-the-garden', 'N', 'Fine, the vampire queen', 'Fine, la reine des vampires'),
  ('tsukuyomi-moon-phase', 'N', 'Hazuki, the little vampire', 'Hazuki, la petite vampire'),
  ('pupa', 'N', 'Yume, the Pupa', 'Yume, la Pupa'),
  ('kemonozume', 'N', 'The Shokujinki, flesh eaters', 'Les Shokujinki, mangeurs de chair'),
  ('higanjima', 'N', 'The vampires of the island', 'Les vampires de l''île'),
  ('the-record-of-a-fallen-vampire', 'N', 'Akabara, the Vampire King', 'Akabara, le roi des vampires')) as m (card_id, rarity, monster, monster_fr)
join public.cards c on c.id = m.card_id
on conflict (id) do update set
  number = excluded.number,
  name = excluded.name,
  name_ja = excluded.name_ja,
  rarity = excluded.rarity,
  type = excluded.type,
  year = excluded.year,
  era = excluded.era,
  power = excluded.power,
  views = excluded.views,
  languages = excluded.languages,
  description = excluded.description,
  short = excluded.short,
  summary = excluded.summary,
  image = excluded.image,
  wiki_title = excluded.wiki_title,
  url = excluded.url,
  fr = excluded.fr,
  source = excluded.source,
  event = excluded.event,
  updated_at = now();

-- ── Security (same rules as the other tables and functions) ──────────────────
alter table public.event_stocks enable row level security;
revoke all on public.event_stocks from anon, authenticated;

revoke execute on function public.open_event_boosters(uuid, text, text, jsonb, int, int) from public, anon, authenticated;
grant execute on function public.open_event_boosters(uuid, text, text, jsonb, int, int) to service_role;
  