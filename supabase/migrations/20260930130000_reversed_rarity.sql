-- Reversed (REV) rarity, rarer than UR, and the number of Wikipedia languages
-- of each card (used with the page views to rank the cards by popularity).

alter table public.cards add column if not exists languages int not null default 1;

alter table public.cards drop constraint if exists cards_rarity_check;
alter table public.cards add constraint cards_rarity_check
  check (rarity in ('N', 'R', 'SR', 'SSR', 'UR', 'REV'));

alter table public.pulls drop constraint if exists pulls_rarity_check;
alter table public.pulls add constraint pulls_rarity_check
  check (rarity in ('N', 'R', 'SR', 'SSR', 'UR', 'REV'));
