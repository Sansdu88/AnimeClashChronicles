/**
 * Game rules shared by the API, the sync script and (through /api/meta) the UI.
 */

/**
 * Rarity tiers, from the most common to the rarest (gacha style: N → UR).
 * `share` is the fraction of each era's cards that get this rarity: the anime
 * with the most-read Wikipedia pages of their era get the rarest tiers.
 */
export const RARITIES = [
  { id: 'N', name: 'Normal', jp: 'ノーマル', color: '#8d99ae', share: 0.35 },
  { id: 'R', name: 'Rare', jp: 'レア', color: '#3a86ff', share: 0.27 },
  { id: 'SR', name: 'Super Rare', jp: 'スーパーレア', color: '#9d4edd', share: 0.2 },
  { id: 'SSR', name: 'Super Special Rare', jp: 'スペシャル', color: '#f4a100', share: 0.12 },
  { id: 'UR', name: 'Ultra Rare', jp: 'ウルトラレア', color: '#ff2e88', share: 0.06 },
];

export const RARITY_IDS = RARITIES.map((r) => r.id);

/** Higher = rarer. */
export const RARITY_RANK = Object.fromEntries(RARITY_IDS.map((id, i) => [id, i]));

/**
 * Booster rules. Each card slot rolls its rarity with the weights below
 * (weights are relative, they do not need to add up to 100).
 * The last slot is the "rare slot": it can never be a Normal card.
 * A player can open one booster every `cooldownSeconds`.
 */
export const BOOSTER = {
  size: 5,
  slotWeights: { N: 58, R: 27, SR: 10, SSR: 4, UR: 1 },
  rareSlotWeights: { R: 62, SR: 25, SSR: 10, UR: 3 },
  maxPerRequest: 1,
  cooldownSeconds: 120,
};

/** Card types, like Pokémon energy types. */
export const TYPES = {
  action: { name: 'Action', jp: 'アクション', icon: '⚔️', color: '#e63946' },
  adventure: { name: 'Adventure', jp: '冒険', icon: '🧭', color: '#f77f00' },
  mecha: { name: 'Mecha', jp: 'メカ', icon: '🤖', color: '#577590' },
  scifi: { name: 'Sci-Fi', jp: 'SF', icon: '🚀', color: '#0096c7' },
  fantasy: { name: 'Fantasy', jp: 'ファンタジー', icon: '🔮', color: '#7b2cbf' },
  romance: { name: 'Romance', jp: '恋愛', icon: '💘', color: '#ff4d8d' },
  comedy: { name: 'Comedy', jp: 'コメディ', icon: '😂', color: '#e9a800' },
  slice: { name: 'Slice of Life', jp: '日常', icon: '🍵', color: '#6a994e' },
  sports: { name: 'Sports', jp: 'スポーツ', icon: '🏆', color: '#2a9d8f' },
  mystery: { name: 'Mystery', jp: 'ミステリー', icon: '🔍', color: '#4361ee' },
  dark: { name: 'Dark', jp: 'ダーク', icon: '💀', color: '#6a040f' },
  drama: { name: 'Drama', jp: 'ドラマ', icon: '🎭', color: '#1b998b' },
};

/** Japanese imperial eras, used to split the cards into themed boosters. */
export const ERAS = [
  { id: 'showa', name: 'Shōwa', kanji: '昭和', from: 0, to: 1988 },
  { id: 'heisei', name: 'Heisei', kanji: '平成', from: 1989, to: 2018 },
  { id: 'reiwa', name: 'Reiwa', kanji: '令和', from: 2019, to: 9999 },
];

export function eraForYear(year) {
  const era = ERAS.find((e) => year >= e.from && year <= e.to);
  if (!era) throw new Error(`No era for year ${year}`);
  return era.id;
}

/** Booster sets the player can open. `era: null` means every card. */
export const SETS = [
  {
    id: 'all-stars',
    name: 'All-Stars',
    jp: 'オールスター',
    tagline: 'Every era, every legend',
    era: null,
    colors: ['#e63946', '#ffb703'],
  },
  {
    id: 'showa',
    name: 'Shōwa Classics',
    jp: '昭和',
    tagline: 'The pioneers · before 1989',
    era: 'showa',
    colors: ['#bc6c25', '#fefae0'],
  },
  {
    id: 'heisei',
    name: 'Heisei Legends',
    jp: '平成',
    tagline: 'The golden age · 1989–2018',
    era: 'heisei',
    colors: ['#3a0ca3', '#4cc9f0'],
  },
  {
    id: 'reiwa',
    name: 'Reiwa New Wave',
    jp: '令和',
    tagline: "Today's hits · 2019+",
    era: 'reiwa',
    colors: ['#ff006e', '#8338ec'],
  },
];

/**
 * Collection score used by the rankings: every different card is worth the
 * points of its rarity, and every extra copy adds `duplicateShare` of them.
 */
export const SCORE = {
  points: { N: 10, R: 25, SR: 60, SSR: 150, UR: 400 },
  duplicateShare: 0.1,
};
