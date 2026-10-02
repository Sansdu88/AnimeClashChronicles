/**
 * Game rules shared by the API, the sync script and (through /api/meta) the UI.
 */

/**
 * Rarity tiers, from the most common to the rarest (gacha style: N → UR → REV).
 * `share` is the fraction of all the cards that get this rarity: the most
 * popular anime and manga get the rarest tiers (see scripts/sync-wikipedia.js).
 * REV ("Reversed") cards are full-art cards with inverted colors.
 */
export const RARITIES = [
  { id: 'N', name: 'Normal', color: '#8d99ae', share: 0.35 },
  { id: 'R', name: 'Rare', color: '#3a86ff', share: 0.27 },
  { id: 'SR', name: 'Super Rare', color: '#9d4edd', share: 0.2 },
  { id: 'SSR', name: 'Super Special Rare', color: '#f4a100', share: 0.12 },
  { id: 'UR', name: 'Ultra Rare', color: '#ff2e88', share: 0.05 },
  { id: 'REV', name: 'Reversed', color: '#00d177', share: 0.01 },
];

export const RARITY_IDS = RARITIES.map((r) => r.id);

/** Higher = rarer. */
export const RARITY_RANK = Object.fromEntries(RARITY_IDS.map((id, i) => [id, i]));

/**
 * Booster rules. Each card slot rolls its rarity with the weights below
 * (weights are relative, they do not need to add up to 100).
 * The last slot is the "rare slot": it can never be a Normal card.
 * A player can open up to `maxPerRequest` boosters at once.
 */
export const BOOSTER = {
  size: 5,
  slotWeights: { N: 580, R: 270, SR: 100, SSR: 40, UR: 9, REV: 1 },
  rareSlotWeights: { R: 620, SR: 250, SSR: 100, UR: 25, REV: 5 },
  maxPerRequest: 10,
};

/**
 * Booster stocks: a player gets a booster every `cooldownSeconds` and keeps up to
 * `stackMax` of them (a full stock stops growing). The era boosters (Shōwa, Heisei,
 * Reiwa) share the fast stock; All-Stars, with every card, has its own slower one.
 */
export const STOCKS = {
  era: { cooldownSeconds: 120, stackMax: 10 },
  'all-stars': { cooldownSeconds: 600, stackMax: 10 },
};

/** The stock a booster set is opened from: 'era' for the sets of one era, 'all-stars' for the set of every card. */
export const stockOf = (set) => (set.era ? 'era' : 'all-stars');

/**
 * The Kira market. Kira (✦) is the game's money: a duplicate (a copy beyond the
 * first, not promised in a trade) is recycled into `recycle[rarity]` Kira, and Kira
 * buys boosters, opened at once: `prices[stockOf(set)]`.
 */
export const MARKET = {
  recycle: { N: 2, R: 5, SR: 12, SSR: 30, UR: 100, REV: 400 },
  prices: { era: 50, 'all-stars': 120 },
};

/**
 * The daily shop: 5 cards a day, the same for everyone (drawn from the day), that a
 * player can buy once each with Kira. `slots` give their rarities (`sundaySlots` on
 * Sundays: the last one is a UR), `prices` the Kira of a card by rarity (changed from
 * the admin panel). The shop changes at midnight, with the daily reward (DAILY.timeZone).
 */
export const SHOP = {
  slots: ['R', 'R', 'R', 'SR', 'SSR'],
  sundaySlots: ['R', 'R', 'R', 'SR', 'UR'],
  prices: { R: 100, SR: 250, SSR: 600, UR: 1500 },
};

/**
 * The weekly ranking: the points of the cards pulled from Monday to Sunday (in
 * DAILY.timeZone), counted like the collection score (SCORE): a new card is worth the
 * points of its rarity, a duplicate `duplicateShare` of them. When the week ends
 * (Sunday midnight), `rewards[i]` goes to the player ranked i + 1: Super Boosters
 * (opened from the shelf) and Kira (changed from the admin panel).
 */
export const WEEKLY = {
  rewards: [
    { superBoosters: 5, kira: 0 },
    { superBoosters: 3, kira: 0 },
    { superBoosters: 1, kira: 0 },
    { superBoosters: 0, kira: 300 },
    { superBoosters: 0, kira: 250 },
    { superBoosters: 0, kira: 200 },
    { superBoosters: 0, kira: 150 },
    { superBoosters: 0, kira: 120 },
    { superBoosters: 0, kira: 100 },
    { superBoosters: 0, kira: 80 },
  ],
};

/**
 * Daily reward: once a day, a free booster of the player's choice, opened at
 * once (it does not use the stock). Every `superEvery`-th daily reward is a
 * Super Booster instead (the set `superSetId`, opened with SUPER_BOOSTER).
 * The day changes at midnight in `timeZone`.
 */
export const DAILY = {
  superEvery: 5,
  superSetId: 'super',
  timeZone: 'Europe/Paris',
};

/** Super Booster: every card is Rare or better, and the last one SSR or better. */
export const SUPER_BOOSTER = {
  ...BOOSTER,
  slotWeights: { R: 500, SR: 300, SSR: 140, UR: 50, REV: 10 },
  rareSlotWeights: { SSR: 700, UR: 250, REV: 50 },
};

/** Card types, like Pokémon energy types. */
export const TYPES = {
  action: { name: 'Action', icon: '⚔️', color: '#e63946' },
  adventure: { name: 'Adventure', icon: '🧭', color: '#f77f00' },
  mecha: { name: 'Mecha', icon: '🤖', color: '#577590' },
  scifi: { name: 'Sci-Fi', icon: '🚀', color: '#0096c7' },
  fantasy: { name: 'Fantasy', icon: '🔮', color: '#7b2cbf' },
  romance: { name: 'Romance', icon: '💘', color: '#ff4d8d' },
  comedy: { name: 'Comedy', icon: '😂', color: '#e9a800' },
  slice: { name: 'Slice of Life', icon: '🍵', color: '#6a994e' },
  sports: { name: 'Sports', icon: '🏆', color: '#2a9d8f' },
  mystery: { name: 'Mystery', icon: '🔍', color: '#4361ee' },
  dark: { name: 'Dark', icon: '💀', color: '#6a040f' },
  drama: { name: 'Drama', icon: '🎭', color: '#1b998b' },
};

/** Japanese imperial eras, used to split the cards into themed boosters. */
export const ERAS = [
  { id: 'showa', name: 'Shōwa', from: 0, to: 1988 },
  { id: 'heisei', name: 'Heisei', from: 1989, to: 2018 },
  { id: 'reiwa', name: 'Reiwa', from: 2019, to: 9999 },
];

export function eraForYear(year) {
  const era = ERAS.find((e) => year >= e.from && year <= e.to);
  if (!era) throw new Error(`No era for year ${year}`);
  return era.id;
}

// The booster sets the player can open are in the database (public.booster_sets, see supabase/migrations/).

/**
 * Collection score used by the rankings: every different card is worth the
 * points of its rarity, and every extra copy adds `duplicateShare` of them.
 */
export const SCORE = {
  points: { N: 10, R: 25, SR: 60, SSR: 150, UR: 400, REV: 1000 },
  duplicateShare: 0.1,
};
