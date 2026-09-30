/**
 * Booster opening rules (pure functions, no I/O, so they are easy to test).
 */
import { BOOSTER, RARITY_IDS, RARITY_RANK, SCORE } from './config.js';

/** Picks a key of `weights` ({ key: relativeWeight }) at random. */
function weightedPick(weights, rng = Math.random) {
  const entries = Object.entries(weights).filter(([, weight]) => weight > 0);
  if (entries.length === 0) throw new Error('Nothing to pick from');
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = rng() * total;
  for (const [key, weight] of entries) {
    roll -= weight;
    if (roll < 0) return key;
  }
  return entries.at(-1)[0];
}

/**
 * Opens one booster of `set` (as built by the catalog: { byRarity: { N: [cards], … } }).
 * Every slot rolls a rarity, then a random card of that rarity. A booster never
 * contains the same card twice. The last slot is the rare slot (no Normal).
 * Cards are returned in reveal order: the rarest one comes last.
 */
export function openBooster(set, { rng = Math.random, rules = BOOSTER } = {}) {
  const taken = new Set();
  const available = (rarity) => (set.byRarity[rarity] ?? []).filter((card) => !taken.has(card.id));
  const pulls = [];

  for (let slot = 0; slot < rules.size; slot++) {
    const isRareSlot = slot === rules.size - 1;
    const baseWeights = isRareSlot ? rules.rareSlotWeights : rules.slotWeights;
    // Rarities with no card left in this set are skipped (their odds are spread over the others).
    let weights = Object.fromEntries(Object.entries(baseWeights).filter(([rarity]) => available(rarity).length));
    if (Object.keys(weights).length === 0) {
      weights = Object.fromEntries(Object.entries(rules.slotWeights).filter(([rarity]) => available(rarity).length));
    }
    if (Object.keys(weights).length === 0) break; // tiny set: fewer cards than slots

    const rarity = weightedPick(weights, rng);
    const pool = available(rarity);
    const card = pool[Math.floor(rng() * pool.length)];
    taken.add(card.id);
    pulls.push(card);
  }

  return pulls.sort((a, b) => RARITY_RANK[a.rarity] - RARITY_RANK[b.rarity]);
}

/** Probability that one slot gives each rarity. */
function slotOdds(weights) {
  const total = Object.values(weights).reduce((sum, w) => sum + w, 0);
  return Object.fromEntries(RARITY_IDS.map((id) => [id, (weights[id] ?? 0) / total]));
}

/**
 * Odds shown on the Rules page: per slot, and the chance that a booster
 * contains at least one card of a given rarity or better.
 */
export function boosterOdds(rules = BOOSTER) {
  const normalSlot = slotOdds(rules.slotWeights);
  const rareSlot = slotOdds(rules.rareSlotWeights);
  const slots = [...Array(rules.size - 1).fill(normalSlot), rareSlot];
  const atLeastOne = {};
  RARITY_IDS.forEach((id, rank) => {
    const orBetter = (odds) => RARITY_IDS.slice(rank).reduce((sum, r) => sum + odds[r], 0);
    atLeastOne[id] = 1 - slots.reduce((pNone, odds) => pNone * (1 - orBetter(odds)), 1);
  });
  const expected = Object.fromEntries(RARITY_IDS.map((id) => [id, slots.reduce((sum, odds) => sum + odds[id], 0)]));
  return { normalSlot, rareSlot, atLeastOne, expected };
}

/**
 * Score of a collection: `entries` = [{ cardId, count }], `rarityOf(cardId)`
 * gives a card's rarity (unknown cards are ignored).
 * Returns { score, uniqueCards, cardsPulled, byRarity: { N: owned, … } }.
 */
export function collectionScore(entries, rarityOf, rules = SCORE) {
  const byRarity = Object.fromEntries(RARITY_IDS.map((id) => [id, 0]));
  let score = 0;
  let uniqueCards = 0;
  let cardsPulled = 0;
  for (const { cardId, count } of entries) {
    const rarity = rarityOf(cardId);
    if (!rarity || count < 1) continue;
    const points = rules.points[rarity];
    score += points + (count - 1) * points * rules.duplicateShare;
    byRarity[rarity] += 1;
    uniqueCards += 1;
    cardsPulled += count;
  }
  return { score: Math.round(score), uniqueCards, cardsPulled, byRarity };
}
