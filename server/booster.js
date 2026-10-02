/**
 * Booster opening rules (pure functions, no I/O, so they are easy to test).
 */
import { BOOSTER, DAILY, RARITY_IDS, RARITY_RANK, SCORE, SHOP, STOCKS } from './config.js';

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
    const usable = (weights) =>
      Object.fromEntries(Object.entries(weights).filter(([rarity, weight]) => weight > 0 && available(rarity).length));
    let weights = usable(baseWeights);
    if (Object.keys(weights).length === 0) weights = usable(rules.slotWeights);
    // The odds (set by an admin) only give rarities this set does not have: any of its cards.
    if (Object.keys(weights).length === 0) weights = usable(Object.fromEntries(RARITY_IDS.map((id) => [id, 1])));
    if (Object.keys(weights).length === 0) break; // tiny set: fewer cards than slots

    const rarity = weightedPick(weights, rng);
    const pool = available(rarity);
    const card = pool[Math.floor(rng() * pool.length)];
    taken.add(card.id);
    pulls.push(card);
  }

  return pulls.sort((a, b) => RARITY_RANK[a.rarity] - RARITY_RANK[b.rarity]);
}

/**
 * Boosters in a stock (`rules`: one of STOCKS). The stock counts from `since`
 * (players.boosters_from or stars_from, null = never counted: full): one booster
 * every `cooldownSeconds`, at most `stackMax`.
 * Returns { stock, nextIn }: `nextIn` = seconds before the next one (0 when full).
 * Same formula as the SQL function open_boosters (see supabase/migrations/).
 */
export function boosterStock(since, now = Date.now(), rules = STOCKS.era) {
  const every = rules.cooldownSeconds * 1000;
  // A full stock does not grow: count from at most `stackMax` boosters ago.
  const start = Math.max(since ? new Date(since).getTime() : -Infinity, now - rules.stackMax * every);
  const stock = Math.min(rules.stackMax, Math.floor((now - start) / every));
  const nextIn = stock >= rules.stackMax ? 0 : Math.ceil((every - ((now - start) % every)) / 1000);
  return { stock, nextIn };
}

/** Milliseconds `timeZone`'s clock is ahead of UTC at `date`. */
function zoneOffset(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(date);
  const part = (type) => Number(parts.find((p) => p.type === type).value);
  const wall = Date.UTC(part('year'), part('month') - 1, part('day'), part('hour'), part('minute'), part('second'));
  return wall - Math.floor(date.getTime() / 1000) * 1000;
}

/**
 * The day of the daily reward: { today: 'YYYY-MM-DD' in `timeZone`, nextIn: seconds before the next day }.
 */
export function rewardDay(now = Date.now(), timeZone = DAILY.timeZone) {
  const offset = zoneOffset(new Date(now), timeZone);
  const wall = new Date(now + offset);
  const midnight = Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth(), wall.getUTCDate() + 1);
  // The clock may change before midnight (daylight saving time): use the offset of that night.
  const next = midnight - zoneOffset(new Date(midnight - offset), timeZone);
  return { today: wall.toISOString().slice(0, 10), nextIn: Math.max(1, Math.ceil((next - now) / 1000)) };
}

/** 'YYYY-MM-DD' `days` days after `day` (before it when negative). */
export const addDays = (day, days) => new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** Day of the week of 'YYYY-MM-DD': 0 = Sunday, 1 = Monday … 6 = Saturday. */
const weekday = (day) => new Date(`${day}T12:00:00Z`).getUTCDay();

/** The instant (ms) `day` ('YYYY-MM-DD') starts in `timeZone`. */
function zoneMidnight(day, timeZone) {
  const utc = Date.parse(`${day}T00:00:00Z`);
  return utc - zoneOffset(new Date(utc - zoneOffset(new Date(utc), timeZone)), timeZone);
}

/** When the week starting on Monday `week` ('YYYY-MM-DD') starts and ends in `timeZone`: { from, to } (ISO). */
export function weekRange(week, timeZone = DAILY.timeZone) {
  return {
    from: new Date(zoneMidnight(week, timeZone)).toISOString(),
    to: new Date(zoneMidnight(addDays(week, 7), timeZone)).toISOString(),
  };
}

/**
 * The week of the weekly ranking: { week: its Monday ('YYYY-MM-DD'), from, to (ISO),
 * nextIn: seconds before it ends }. A week ends on Sunday at midnight in `timeZone`.
 */
export function rewardWeek(now = Date.now(), timeZone = DAILY.timeZone) {
  const { today } = rewardDay(now, timeZone);
  const week = addDays(today, -((weekday(today) + 6) % 7));
  const { from, to } = weekRange(week, timeZone);
  return { week, from, to, nextIn: Math.max(1, Math.ceil((Date.parse(to) - now) / 1000)) };
}

/** Random numbers from 0 to 1 that only depend on `seed` (a string): the same seed gives the same numbers. */
export function seededRng(seed) {
  let a = 2166136261;
  for (const ch of seed) a = Math.imul(a ^ ch.codePointAt(0), 16777619);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The daily shop of `day` ('YYYY-MM-DD'): its cards, one per rarity of `rules.slots`
 * (`rules.sundaySlots` on Sundays), drawn from `cards` (the catalog, in number order)
 * with random numbers seeded by the day, so everyone gets the same shop. A card is
 * never offered twice the same day; a rarity with no card left is skipped.
 */
export function dailyShop(day, cards, rules = SHOP) {
  const rng = seededRng(`shop:${day}`);
  const taken = new Set();
  const offer = [];
  for (const rarity of weekday(day) === 0 ? rules.sundaySlots : rules.slots) {
    const pool = cards.filter((card) => card.rarity === rarity && !taken.has(card.id));
    if (!pool.length) continue;
    const card = pool[Math.floor(rng() * pool.length)];
    taken.add(card.id);
    offer.push(card);
  }
  return offer;
}

/**
 * The weekly ranking, from the cards pulled during the week: `rows` = [{ playerId, name,
 * rarity, isNew, pulls, lastAt }] (cards of one rarity, new or not, and the last booster).
 * A new card is worth the points of its rarity, a duplicate `duplicateShare` of them (like
 * the collection score). Best first; on a tie, the player who got there first.
 * Returns [{ rank, playerId, name, points, cards, newCards }].
 */
export function weeklyRanking(rows, rules = SCORE) {
  const players = new Map();
  for (const row of rows) {
    if (!players.has(row.playerId)) players.set(row.playerId, { playerId: row.playerId, name: row.name, points: 0, cards: 0, newCards: 0, lastAt: '' });
    const player = players.get(row.playerId);
    const points = rules.points[row.rarity] ?? 0;
    player.points += row.pulls * (row.isNew ? points : points * rules.duplicateShare);
    player.cards += row.pulls;
    if (row.isNew) player.newCards += row.pulls;
    if (row.lastAt > player.lastAt) player.lastAt = row.lastAt;
  }
  return [...players.values()]
    .map((player) => ({ ...player, points: Math.round(player.points) }))
    .sort((a, b) => b.points - a.points || a.lastAt.localeCompare(b.lastAt) || a.name.localeCompare(b.name))
    .map(({ lastAt, ...player }, index) => ({ rank: index + 1, ...player }));
}

/**
 * Daily reward of a player who claimed `claims` of them, the last one on `lastDay` ('YYYY-MM-DD').
 * `day` is the day of the cycle (1 to superEvery) of today's reward: the one to claim
 * when `available`, else the one already claimed. `super`: that reward is a Super Booster,
 * because of `superReason`: 'cycle' (every superEvery-th one), 'event' (today is one of
 * `rules.superDays`, for everyone) or 'gift' (`gift`: given by an admin to this player).
 * `choices`: the boosters a player can choose (`rules.sets`).
 */
export function dailyStatus({ claims = 0, lastDay = null, gift = false } = {}, now = Date.now(), rules = DAILY) {
  const { today, nextIn } = rewardDay(now, rules.timeZone);
  const available = !lastDay || lastDay < today;
  const number = available ? claims + 1 : claims;
  const day = ((number - 1) % rules.superEvery) + 1;
  let superReason = day === rules.superEvery ? 'cycle' : null;
  if (available && !superReason) superReason = rules.superDays?.includes(today) ? 'event' : gift ? 'gift' : null;
  return {
    today,
    available,
    claims,
    day,
    cycle: rules.superEvery,
    super: Boolean(superReason),
    superReason,
    choices: rules.sets ?? [],
    nextIn,
  };
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
