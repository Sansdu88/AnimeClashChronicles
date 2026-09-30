import { RARITY_IDS, RARITY_RANK } from './config.js';

/**
 * Card fields ↔ columns of the Supabase table public.cards (supabase/migrations/).
 * The same card object is used by the sync script, the import script and the server.
 */
const CARD_COLUMNS = {
  id: 'id',
  number: 'number',
  name: 'name',
  nameJa: 'name_ja',
  rarity: 'rarity',
  type: 'type',
  year: 'year',
  era: 'era',
  power: 'power',
  views: 'views',
  languages: 'languages',
  description: 'description',
  short: 'short',
  summary: 'summary',
  image: 'image',
  wikiTitle: 'wiki_title',
  url: 'url',
  fr: 'fr',
  source: 'source',
  revision: 'revision',
  storyText: 'story_text',
};

export const cardToRow = (card) =>
  Object.fromEntries(Object.entries(CARD_COLUMNS).map(([field, column]) => [column, card[field] ?? null]));

export const rowToCard = (row) =>
  Object.fromEntries(Object.entries(CARD_COLUMNS).map(([field, column]) => [field, row[column]]));

/** Card as returned by the API. */
function toPublicCard(card) {
  return {
    id: card.id,
    number: card.number,
    name: card.name,
    rarity: card.rarity,
    type: card.type,
    year: card.year,
    era: card.era,
    power: card.power,
    views: card.views,
    languages: card.languages,
    description: card.description,
    short: card.short,
    summary: card.summary,
    image: card.image
      ? { src: card.image.src, width: card.image.width, height: card.image.height, credit: card.image.credit }
      : null,
    wikipediaUrl: card.url,
    // Same texts from French Wikipedia (null when the anime has no French page).
    fr: card.fr
      ? {
          name: card.fr.name,
          description: card.fr.description,
          short: card.fr.short,
          summary: card.fr.summary,
          wikipediaUrl: card.fr.url,
        }
      : null,
  };
}

/** Rarest first, then most popular. */
export function compareByRarity(a, b) {
  return RARITY_RANK[b.rarity] - RARITY_RANK[a.rarity] || b.power - a.power || b.views - a.views || a.number - b.number;
}

/**
 * rawCards: cards as stored (see CARD_COLUMNS); sets: rows of public.booster_sets;
 * meta: { generatedAt, popularity, license }.
 */
export function createCatalog(rawCards, sets, meta = {}) {
  const cards = rawCards.map(toPublicCard).sort((a, b) => a.number - b.number);
  const byId = new Map(cards.map((card) => [card.id, card]));

  const catalogSets = [...sets].sort((a, b) => a.position - b.position).map(({ position, ...set }) => {
    const setCards = cards.filter((card) => !set.era || card.era === set.era);
    const byRarity = Object.fromEntries(RARITY_IDS.map((id) => [id, setCards.filter((c) => c.rarity === id)]));
    const featured = [...setCards].sort(compareByRarity)[0] ?? null;
    return { ...set, cards: setCards, byRarity, featured };
  });
  const setsById = new Map(catalogSets.map((set) => [set.id, set]));

  return {
    cards,
    sets: catalogSets,
    meta: {
      generatedAt: meta.generatedAt ?? null,
      popularity: meta.popularity ?? null,
      license: meta.license ?? null,
    },
    getCard: (id) => byId.get(id) ?? null,
    getSet: (id) => setsById.get(id) ?? null,
  };
}
