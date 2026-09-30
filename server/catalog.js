import { readFileSync } from 'node:fs';
import { RARITY_IDS, RARITY_RANK, SETS } from './config.js';

export const DEFAULT_CATALOG_FILE = new URL('../data/cards.json', import.meta.url);

/** Card as returned by the API. */
function toPublicCard(card) {
  return {
    id: card.id,
    number: card.number,
    name: card.name,
    nameJa: card.nameJa,
    rarity: card.rarity,
    type: card.type,
    year: card.year,
    era: card.era,
    power: card.power,
    views: card.views,
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

export function createCatalog(rawCards, meta = {}) {
  const cards = rawCards.map(toPublicCard).sort((a, b) => a.number - b.number);
  const byId = new Map(cards.map((card) => [card.id, card]));

  const sets = SETS.map((set) => {
    const setCards = cards.filter((card) => !set.era || card.era === set.era);
    const byRarity = Object.fromEntries(RARITY_IDS.map((id) => [id, setCards.filter((c) => c.rarity === id)]));
    const featured = [...setCards].sort(compareByRarity)[0] ?? null;
    return { ...set, cards: setCards, byRarity, featured };
  });
  const setsById = new Map(sets.map((set) => [set.id, set]));

  return {
    cards,
    sets,
    meta: {
      generatedAt: meta.generatedAt ?? null,
      popularity: meta.popularity ?? null,
      license: meta.license ?? null,
    },
    getCard: (id) => byId.get(id) ?? null,
    getSet: (id) => setsById.get(id) ?? null,
  };
}

export function loadCatalog(file = DEFAULT_CATALOG_FILE) {
  const data = JSON.parse(readFileSync(file, 'utf8'));
  if (!Array.isArray(data.cards) || data.cards.length === 0) {
    throw new Error(`No cards in ${file}. Run "npm run sync" to build the catalog.`);
  }
  return createCatalog(data.cards, data);
}
