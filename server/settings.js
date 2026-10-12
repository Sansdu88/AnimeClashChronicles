/**
 * Game settings the admins change from the admin panel, saved in the database
 * (table game_settings, see supabase/migrations/): the booster odds, the Kira
 * prices and values (boosters and cards of the daily shop), the value of a gem, the
 * daily reward, the rewards of the weekly ranking, the events, the Forge and the Wheel of Fortune.
 * Their defaults come from config.js.
 */
import { BOOSTER, DAILY, EVENTS, FORGE, GEMS, MARKET, RARITY_IDS, SHOP, SUPER_BOOSTER, WEEKLY, WHEEL, stockOf } from './config.js';
import { HttpError } from './http.js';

/**
 * Odds are weights in thousandths of a percent: the 6 rarities of a slot add up to
 * 100,000 (100%), so an admin can set odds as small as 0.001%.
 */
export const ODDS_TOTAL = 100_000;
const MAX_KIRA = 100_000;
const MAX_SUPER_EVERY = 60;
const MAX_SUPER_BOOSTERS = 50;
const MAX_EVENT_HOURS = 168; // the booster of an event: at least one a week
const MAX_FORGE_CARDS = 20;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** The rarities sold at the daily shop. */
const SHOP_RARITIES = Object.keys(SHOP.prices);
/** The rarities the Forge melts (each into the next one). */
const FORGE_RARITIES = Object.keys(FORGE.cards);
const WHEEL_PRIZES = WHEEL.prizes.map((prize) => prize.id);

/**
 * The defaults, for the booster sets of the shop:
 * { booster, superBooster: { slotWeights, rareSlotWeights },
 *   market: { prices: { setId }, recycle: { rarity }, cardPrices: { rarity sold at the daily shop } },
 *   gems: { kiraPerGem (the Kira a gem is worth: gems prices are the Kira prices divided by it) },
 *   daily: { superEvery, sets: [setId offered], superDays: ['YYYY-MM-DD' everyone gets a Super Booster] },
 *   weekly: { rewards: [{ superBoosters, kira }, …] (the 1st, the 2nd… of the weekly ranking) },
 *   events: { eventId: { enabled, hours, max } (on or off; its booster: one every `hours`, `max` at most) },
 *   forge: { cards: { rarity: duplicates a recipe takes }, gems: { rarity: gems for a missing card (0: none) } },
 *   wheel: { price (Kira of a spin), weights: { prizeId: chance, in ODDS_TOTAL } } }
 */
export function defaultSettings(shopSets) {
  const weights = (rules) => ({ slotWeights: toOddsTotal(rules.slotWeights), rareSlotWeights: toOddsTotal(rules.rareSlotWeights) });
  return {
    booster: weights(BOOSTER),
    superBooster: weights(SUPER_BOOSTER),
    market: {
      prices: Object.fromEntries(shopSets.map((set) => [set.id, MARKET.prices[stockOf(set)]])),
      recycle: { ...MARKET.recycle },
      cardPrices: { ...SHOP.prices },
    },
    gems: { kiraPerGem: GEMS.kiraPerGem },
    daily: { superEvery: DAILY.superEvery, sets: shopSets.map((set) => set.id), superDays: [] },
    weekly: { rewards: WEEKLY.rewards.map((reward) => ({ ...reward })) },
    // Every event is off until an admin turns it on.
    events: Object.fromEntries(Object.entries(EVENTS).map(([id, { hours, max }]) => [id, { enabled: false, hours, max }])),
    forge: { cards: { ...FORGE.cards }, gems: { ...FORGE.gems } },
    wheel: { price: WHEEL.price, weights: toOddsTotal(Object.fromEntries(WHEEL.prizes.map((prize) => [prize.id, prize.weight]))) },
  };
}

/**
 * Relative weights ({ rarity: weight }, like in config.js, or saved when odds were in tenths
 * of a percent) brought to ODDS_TOTAL; the rounding difference goes to the biggest one.
 */
function toOddsTotal(weights) {
  const total = Object.values(weights).reduce((sum, weight) => sum + weight, 0);
  if (!(total > 0)) return weights; // nothing to scale: cleanWeights says what is wrong
  const scaled = Object.fromEntries(Object.entries(weights).map(([id, weight]) => [id, Math.round((weight * ODDS_TOTAL) / total)]));
  const drift = ODDS_TOTAL - Object.values(scaled).reduce((sum, weight) => sum + weight, 0);
  const biggest = Object.keys(scaled).reduce((a, b) => (scaled[a] >= scaled[b] ? a : b));
  scaled[biggest] += drift;
  return scaled;
}

const invalid = (message) => new HttpError(400, message, null, 'invalid_settings');
const isInt = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;

function cleanWeights(value, name) {
  if (!value || typeof value !== 'object') throw invalid(`"${name}" must be { rarity: weight }`);
  const weights = Object.fromEntries(RARITY_IDS.map((id) => [id, value[id] ?? 0]));
  for (const [id, weight] of Object.entries(weights)) {
    if (!isInt(weight, 0, ODDS_TOTAL)) throw invalid(`${name}.${id} must be an integer from 0 to ${ODDS_TOTAL}`);
  }
  const total = Object.values(weights).reduce((sum, weight) => sum + weight, 0);
  if (total !== ODDS_TOTAL) throw invalid(`The odds of ${name} add up to ${(total * 100) / ODDS_TOTAL}%, not 100%`);
  return weights;
}

function cleanAmounts(value, keys, name) {
  return Object.fromEntries(
    keys.map((key) => {
      if (!isInt(value?.[key], 0, MAX_KIRA)) throw invalid(`${name}.${key} must be an integer from 0 to ${MAX_KIRA}`);
      return [key, value[key]];
    }),
  );
}

/** The rewards of the weekly ranking: one { superBoosters, kira } per rank, from the 1st. */
function cleanRewards(value) {
  const count = WEEKLY.rewards.length;
  if (!Array.isArray(value) || value.length !== count) throw invalid(`weekly.rewards must list ${count} rewards, from the 1st to the ${count}th`);
  return value.map((reward, i) => {
    if (!isInt(reward?.superBoosters, 0, MAX_SUPER_BOOSTERS)) {
      throw invalid(`weekly.rewards[${i}].superBoosters must be an integer from 0 to ${MAX_SUPER_BOOSTERS}`);
    }
    if (!isInt(reward?.kira, 0, MAX_KIRA)) throw invalid(`weekly.rewards[${i}].kira must be an integer from 0 to ${MAX_KIRA}`);
    return { superBoosters: reward.superBoosters, kira: reward.kira };
  });
}

/** The events: { enabled, hours, max } for each one of EVENTS. */
function cleanEvents(value) {
  return Object.fromEntries(
    Object.keys(EVENTS).map((id) => {
      const event = value?.[id];
      if (typeof event?.enabled !== 'boolean') throw invalid(`events.${id}.enabled must be true or false`);
      if (!isInt(event.hours, 1, MAX_EVENT_HOURS)) throw invalid(`events.${id}.hours must be an integer from 1 to ${MAX_EVENT_HOURS}`);
      // At most the boosters opened at once, so that a full stock can get the ×10 show.
      if (!isInt(event.max, 1, BOOSTER.maxPerRequest)) throw invalid(`events.${id}.max must be an integer from 1 to ${BOOSTER.maxPerRequest}`);
      return [id, { enabled: event.enabled, hours: event.hours, max: event.max }];
    }),
  );
}

/** The Forge: { cards: { rarity: 1–20 duplicates }, gems: { rarity: gems for a missing card, 0 = gems cannot } }. */
function cleanForge(value) {
  return {
    cards: Object.fromEntries(
      FORGE_RARITIES.map((id) => {
        if (!isInt(value?.cards?.[id], 1, MAX_FORGE_CARDS)) throw invalid(`forge.cards.${id} must be an integer from 1 to ${MAX_FORGE_CARDS}`);
        return [id, value.cards[id]];
      }),
    ),
    gems: cleanAmounts(value?.gems, FORGE_RARITIES, 'forge.gems'),
  };
}

/** The Wheel of Fortune: { price: Kira of a spin, weights: { prizeId: chance } adding up to ODDS_TOTAL }. */
function cleanWheel(value) {
  if (!isInt(value?.price, 1, MAX_KIRA)) throw invalid(`wheel.price must be an integer from 1 to ${MAX_KIRA}`);
  const weights = Object.fromEntries(
    WHEEL_PRIZES.map((id) => {
      if (!isInt(value?.weights?.[id], 0, ODDS_TOTAL)) throw invalid(`wheel.weights.${id} must be an integer from 0 to ${ODDS_TOTAL}`);
      return [id, value.weights[id]];
    }),
  );
  const total = Object.values(weights).reduce((sum, weight) => sum + weight, 0);
  if (total !== ODDS_TOTAL) throw invalid(`The chances of the wheel add up to ${(total * 100) / ODDS_TOTAL}%, not 100%`);
  return { price: value.price, weights };
}

/**
 * `current` with the sections of `patch` ({ booster, superBooster, market, gems, daily, weekly, events, forge, wheel },
 * each given whole) checked and changed. `setIds`: the shop sets; `today`: past event days are dropped.
 * Throws a 400 (invalid_settings) on a wrong value.
 */
export function mergeSettings(current, patch, { setIds, today }) {
  if (!patch || typeof patch !== 'object') throw invalid('Send the settings to change');
  const next = structuredClone(current);
  for (const key of ['booster', 'superBooster']) {
    if (patch[key] === undefined) continue;
    next[key] = {
      slotWeights: cleanWeights(patch[key]?.slotWeights, `${key}.slotWeights`),
      rareSlotWeights: cleanWeights(patch[key]?.rareSlotWeights, `${key}.rareSlotWeights`),
    };
  }
  if (patch.market !== undefined) {
    next.market = {
      prices: cleanAmounts(patch.market?.prices, setIds, 'market.prices'),
      recycle: cleanAmounts(patch.market?.recycle, RARITY_IDS, 'market.recycle'),
      cardPrices: cleanAmounts(patch.market?.cardPrices, SHOP_RARITIES, 'market.cardPrices'),
    };
  }
  if (patch.gems !== undefined) {
    const kiraPerGem = patch.gems?.kiraPerGem;
    if (!isInt(kiraPerGem, 1, MAX_KIRA)) throw invalid(`gems.kiraPerGem must be an integer from 1 to ${MAX_KIRA}`);
    next.gems = { kiraPerGem };
  }
  if (patch.weekly !== undefined) next.weekly = { rewards: cleanRewards(patch.weekly?.rewards) };
  if (patch.events !== undefined) next.events = cleanEvents(patch.events);
  if (patch.forge !== undefined) next.forge = cleanForge(patch.forge);
  if (patch.wheel !== undefined) next.wheel = cleanWheel(patch.wheel);
  if (patch.daily !== undefined) {
    const { superEvery, sets, superDays } = patch.daily ?? {};
    if (!isInt(superEvery, 1, MAX_SUPER_EVERY)) throw invalid(`daily.superEvery must be an integer from 1 to ${MAX_SUPER_EVERY}`);
    if (!Array.isArray(sets) || sets.length === 0 || sets.some((id) => !setIds.includes(id))) {
      throw invalid(`daily.sets must list some of: ${setIds.join(', ')}`);
    }
    if (!Array.isArray(superDays) || superDays.length > 100 || superDays.some((day) => !DAY.test(day) || Number.isNaN(Date.parse(day)))) {
      throw invalid('daily.superDays must be a list of days (YYYY-MM-DD)');
    }
    next.daily = {
      superEvery,
      sets: setIds.filter((id) => sets.includes(id)),
      superDays: [...new Set(superDays)].filter((day) => day >= today).sort(),
    };
  }
  return next;
}

/**
 * The saved settings over the defaults. A section saved by an older version (a booster
 * set added since…) is completed with the defaults; a section that is still wrong is ignored.
 */
export function loadSettings(saved, defaults, context, log = console) {
  let settings = defaults;
  for (const [key, value] of Object.entries(saved ?? {})) {
    if (!(key in defaults) || !value || typeof value !== 'object') continue;
    let section = value;
    if (key === 'market') {
      section = {
        prices: { ...defaults.market.prices, ...value.prices },
        recycle: { ...defaults.market.recycle, ...value.recycle },
        cardPrices: { ...defaults.market.cardPrices, ...value.cardPrices },
      };
    } else if (key === 'booster' || key === 'superBooster') {
      // Odds saved before (in tenths of a percent) are brought to the current precision.
      section = { slotWeights: toOddsTotal(value.slotWeights ?? {}), rareSlotWeights: toOddsTotal(value.rareSlotWeights ?? {}) };
    } else if (key === 'daily') {
      const sets = (value.sets ?? []).filter((id) => context.setIds.includes(id));
      section = { ...defaults.daily, ...value, sets: sets.length ? sets : defaults.daily.sets };
    } else if (key === 'events') {
      // An event added since is off.
      section = Object.fromEntries(Object.entries(defaults.events).map(([id, event]) => [id, { ...event, ...value[id] }]));
    } else if (key === 'forge') {
      section = { cards: { ...defaults.forge.cards, ...value.cards }, gems: { ...defaults.forge.gems, ...value.gems } };
    } else if (key === 'wheel') {
      // A prize added since is never won until an admin gives it a chance (the others still add up to 100%).
      section = { price: value.price, weights: Object.fromEntries(WHEEL_PRIZES.map((id) => [id, value.weights?.[id] ?? 0])) };
    }
    try {
      settings = mergeSettings(settings, { [key]: section }, context);
    } catch (err) {
      log.warn(`  Saved setting "${key}" ignored: ${err.message}`);
    }
  }
  return settings;
}
