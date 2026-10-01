/**
 * Game settings the admins change from the admin panel, saved in the database
 * (table game_settings, see supabase/migrations/): the booster odds, the Kira
 * prices and values, and the daily reward. Their defaults come from config.js.
 */
import { BOOSTER, DAILY, MARKET, RARITY_IDS, SUPER_BOOSTER, stockOf } from './config.js';
import { HttpError } from './http.js';

/** Odds are weights in tenths of a percent: the 6 rarities of a slot add up to 1000 (100%). */
export const ODDS_TOTAL = 1000;
const MAX_KIRA = 100_000;
const MAX_SUPER_EVERY = 60;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The defaults, for the booster sets of the shop:
 * { booster, superBooster: { slotWeights, rareSlotWeights }, market: { prices: { setId }, recycle: { rarity } },
 *   daily: { superEvery, sets: [setId offered], superDays: ['YYYY-MM-DD' everyone gets a Super Booster] } }
 */
export function defaultSettings(shopSets) {
  const weights = (rules) => ({ slotWeights: { ...rules.slotWeights }, rareSlotWeights: { ...rules.rareSlotWeights } });
  return {
    booster: weights(BOOSTER),
    superBooster: weights(SUPER_BOOSTER),
    market: {
      prices: Object.fromEntries(shopSets.map((set) => [set.id, MARKET.prices[stockOf(set)]])),
      recycle: { ...MARKET.recycle },
    },
    daily: { superEvery: DAILY.superEvery, sets: shopSets.map((set) => set.id), superDays: [] },
  };
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
  if (total !== ODDS_TOTAL) throw invalid(`The odds of ${name} add up to ${total / 10}%, not 100%`);
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

/**
 * `current` with the sections of `patch` ({ booster, superBooster, market, daily }, each
 * given whole) checked and changed. `setIds`: the shop sets; `today`: past event days are dropped.
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
    };
  }
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
      };
    } else if (key === 'daily') {
      const sets = (value.sets ?? []).filter((id) => context.setIds.includes(id));
      section = { ...defaults.daily, ...value, sets: sets.length ? sets : defaults.daily.sets };
    }
    try {
      settings = mergeSettings(settings, { [key]: section }, context);
    } catch (err) {
      log.warn(`  Saved setting "${key}" ignored: ${err.message}`);
    }
  }
  return settings;
}
