/**
 * REST API. Every route returns JSON; see README.md for the full reference.
 * Player routes need a session (cookie set by /api/auth/login, or an
 * "Authorization: Bearer <token>" header) and only give access to your own player.
 * Admin routes (/api/admin/…) need a player whose is_admin is set in the database.
 */
import { BOOSTER, DAILY, ERAS, RARITIES, RARITY_IDS, SCORE, STOCKS, SUPER_BOOSTER, TYPES, stockOf } from './config.js';
import { boosterOdds, boosterStock, collectionScore, dailyStatus, openBooster, rewardDay } from './booster.js';
import { defaultSettings, loadSettings, mergeSettings } from './settings.js';
import { compareByRarity } from './catalog.js';
import { HttpError, createRouter, reply } from './http.js';
import {
  SESSION_DAYS,
  burnPasswordCheck,
  checkPassword,
  cleanEmail,
  clearedSessionCookie,
  createRateLimiter,
  hashPassword,
  hashToken,
  newSessionToken,
  readSessionToken,
  sessionCookie,
  verifyPassword,
} from './auth.js';

const NAME_MAX_LENGTH = 24;
const ADJECTIVES = ['Brave', 'Sleepy', 'Mighty', 'Shy', 'Lucky', 'Swift', 'Silent', 'Wild', 'Clever', 'Fierce', 'Cosmic', 'Golden', 'Crimson', 'Tiny'];
const NOUNS = ['Ronin', 'Shinobi', 'Mangaka', 'Kitsune', 'Senpai', 'Samurai', 'Tanuki', 'Pilot', 'Otaku', 'Oni', 'Idol', 'Ninja', 'Kaiju', 'Hero'];

function randomPlayerName(rng = Math.random) {
  const pick = (list) => list[Math.floor(rng() * list.length)];
  return `${pick(ADJECTIVES)} ${pick(NOUNS)} ${100 + Math.floor(rng() * 900)}`;
}

function cleanPlayerName(value) {
  if (typeof value !== 'string') throw new HttpError(400, 'The name must be a string', null, 'invalid_name');
  const name = value.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim();
  if (name.length === 0 || [...name].length > NAME_MAX_LENGTH) {
    throw new HttpError(400, `The name must be 1 to ${NAME_MAX_LENGTH} characters long`, null, 'invalid_name');
  }
  return name;
}

function intParam(value, { name, min, max, fallback }) {
  if (value === undefined || value === null || value === '') return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw new HttpError(400, `"${name}" must be an integer between ${min} and ${max}`);
  }
  return number;
}

function oneOf(value, allowed, name) {
  if (value === null || value === undefined || value === '') return null;
  if (!allowed.includes(value)) throw new HttpError(400, `Unknown ${name} "${value}". Use one of: ${allowed.join(', ')}`);
  return value;
}

const SORTS = {
  number: (a, b) => a.number - b.number,
  name: (a, b) => a.name.localeCompare(b.name),
  year: (a, b) => a.year - b.year || a.number - b.number,
  rarity: compareByRarity,
  power: (a, b) => b.power - a.power || a.number - b.number,
};

/** `savedSettings`: the game settings saved from the admin panel (see settings.js). */
export function createApi({ catalog, store, rng = Math.random, secureCookies = false, savedSettings = {} }) {
  const router = createRouter();
  const totalCards = catalog.cards.length;
  // The Super Booster is only given by the daily reward: the shop sets are the others.
  const superSet = catalog.getSet(DAILY.superSetId);
  const shopSets = catalog.sets.filter((set) => set !== superSet);
  const setIds = shopSets.map((set) => set.id);

  // Game settings: the defaults of config.js, changed from the admin panel (they apply at once).
  const settingsContext = () => ({ setIds, today: rewardDay().today });
  const defaults = defaultSettings(shopSets);
  let settings = loadSettings(savedSettings, defaults, settingsContext());
  const boosterRules = () => ({ ...BOOSTER, ...settings.booster });
  const superRules = () => ({ ...SUPER_BOOSTER, ...settings.superBooster });
  const dailyRules = () => ({ ...DAILY, ...settings.daily });
  const loginLimiter = createRateLimiter({ max: 10, windowMs: 15 * 60 * 1000 });
  const opening = new Set(); // players whose booster is being saved (blocks double clicks)
  const claiming = new Set(); // players whose daily reward is being saved

  const publicSet = (set) => ({
    id: set.id,
    name: set.name,
    tagline: set.tagline,
    era: set.era,
    colors: set.colors,
    // The stock it is opened from (see STOCKS); the Super Booster only comes from the daily reward.
    stock: set === superSet ? null : stockOf(set),
    cardCount: set.cards.length,
    rarityCounts: Object.fromEntries(RARITY_IDS.map((id) => [id, set.byRarity[id].length])),
    featured: set.featured && {
      id: set.featured.id,
      name: set.featured.name,
      rarity: set.featured.rarity,
      image: set.featured.image,
    },
  });

  // ── Sessions ───────────────────────────────────────────────────────────────

  /** The logged-in player of this request, or null. */
  async function currentPlayer(req) {
    const token = readSessionToken(req);
    return token ? store.sessionPlayer(hashToken(token)) : null;
  }

  async function requireLogin(req) {
    const player = await currentPlayer(req);
    if (!player) throw new HttpError(401, 'Log in first (POST /api/auth/login)', null, 'not_authenticated');
    return player;
  }

  /** Logged in AND the :playerId of the URL is you. */
  async function requireSelf(req, playerId) {
    const player = await requireLogin(req);
    if (player.id !== playerId) throw new HttpError(403, 'This is not your player', null, 'forbidden');
    return player;
  }

  async function startSession(player, status, extra = {}) {
    const token = newSessionToken();
    await store.createSession(player.id, hashToken(token), SESSION_DAYS);
    return reply(status, { player: await profile(player), token, ...extra }, { 'Set-Cookie': sessionCookie(token, { secure: secureCookies }) });
  }

  // ── Profiles ───────────────────────────────────────────────────────────────

  /** Collection rows (cards still in the catalog) + completion numbers. */
  async function collectionOf(playerId) {
    const entries = (await store.collection(playerId)).filter((row) => catalog.getCard(row.cardId));
    const owned = new Set(entries.map((row) => row.cardId));
    const progress = (cards) => ({ owned: cards.filter((card) => owned.has(card.id)).length, total: cards.length });
    return {
      entries,
      summary: {
        uniqueCards: owned.size,
        totalCards,
        completion: owned.size / totalCards,
        byRarity: Object.fromEntries(
          RARITY_IDS.map((id) => [id, progress(catalog.cards.filter((card) => card.rarity === id))]),
        ),
        bySet: Object.fromEntries(shopSets.map((set) => [set.id, progress(set.cards)])),
      },
    };
  }

  const rarityOfCard = (cardId) => catalog.getCard(cardId)?.rarity;

  /**
   * { kira, stocks: { era: { stock, nextIn }, 'all-stars': { … } } }: the player's Kira, and for
   * each booster stock the boosters they can open now and the seconds before the next one (0 when full).
   */
  async function walletOf(playerId) {
    const { boostersFrom, starsFrom, kira } = await store.wallet(playerId);
    const since = { era: boostersFrom, 'all-stars': starsFrom };
    const now = Date.now();
    return { kira, stocks: Object.fromEntries(Object.entries(STOCKS).map(([id, rules]) => [id, boosterStock(since[id], now, rules)])) };
  }

  /** Daily reward status (see dailyStatus in booster.js). */
  const dailyOf = async (playerId) => dailyStatus(await store.dailyClaims(playerId), Date.now(), dailyRules());

  /** A booster just opened, as the API returns it: its cards in reveal order, with `isNew`. */
  const openedBooster = (booster) => ({
    id: booster.id,
    setId: booster.setId,
    openedAt: booster.openedAt,
    cards: booster.pulls.map(({ card, isNew }) => ({ ...card, isNew })),
  });

  /** Seconds before a stock (`rules`: one of STOCKS) holds `count` boosters. */
  const secondsUntil = ({ stock, nextIn }, count, rules) =>
    stock >= count ? 0 : nextIn + (count - stock - 1) * rules.cooldownSeconds;

  async function profile(player) {
    const [stats, { entries, summary }, { kira, stocks }, daily] = await Promise.all([
      store.stats(player.id),
      collectionOf(player.id),
      walletOf(player.id),
      dailyOf(player.id),
    ]);
    const cardsPulled = Object.values(stats.pullsByRarity).reduce((sum, n) => sum + n, 0);
    return {
      id: player.id,
      name: player.name,
      email: player.email,
      friendCode: player.friendCode,
      createdAt: player.createdAt,
      isAdmin: player.isAdmin === true,
      stats: { ...stats, cardsPulled, ...summary, score: collectionScore(entries, rarityOfCard).score },
      // Kira (the game's money, see settings.market) and the booster stocks: { era: { stock, nextIn }, 'all-stars': … }.
      kira,
      stocks,
      // Today's daily reward: claimed or not, day of the cycle, Super Booster or not.
      daily,
    };
  }

  /** What friends can see of a player (no e-mail, admin status, daily reward nor Kira). */
  async function publicProfile(player) {
    const { email, isAdmin, daily, kira, ...rest } = await profile(player);
    return rest;
  }

  /** Ranking rows (score, cards…) for a list of players, best first. */
  async function rank(players, collections, youId) {
    const rows = await Promise.all(
      players.map(async (player) => {
        const score = collectionScore(collections.get(player.id) ?? [], rarityOfCard);
        return {
          id: player.id,
          name: player.name,
          you: player.id === youId,
          score: score.score,
          uniqueCards: score.uniqueCards,
          cardsPulled: score.cardsPulled,
          completion: score.uniqueCards / totalCards,
          byRarity: score.byRarity,
          boostersOpened: player.boostersOpened ?? (await store.stats(player.id)).boostersOpened,
          createdAt: player.createdAt,
        };
      }),
    );
    return rows
      .sort((a, b) => b.score - a.score || b.uniqueCards - a.uniqueCards || (a.createdAt ?? '').localeCompare(b.createdAt ?? ''))
      .map(({ createdAt, ...row }, index) => ({ rank: index + 1, ...row }));
  }

  /** A ranking without the admins (they could give themselves cards), ranked again from 1. */
  async function withoutAdmins(rows) {
    const admins = await store.adminIds();
    return rows.filter((row) => !admins.has(row.id)).map((row, index) => ({ ...row, rank: index + 1 }));
  }

  async function friendsOf(player) {
    const [collections, friends, { incoming, outgoing }] = await Promise.all([
      store.allCollections(),
      store.friends(player.id),
      store.friendRequests(player.id),
    ]);
    const ranked = await rank([player, ...friends], collections, player.id);
    const byId = new Map(ranked.map((row) => [row.id, row]));
    return {
      friendCode: player.friendCode,
      scoring: SCORE,
      friends: friends.map((friend) => ({
        ...friend,
        score: byId.get(friend.id).score,
        uniqueCards: byId.get(friend.id).uniqueCards,
        completion: byId.get(friend.id).completion,
      })),
      incoming,
      outgoing,
      ranking: await withoutAdmins(ranked),
    };
  }

  async function requireFriend(player, friendId) {
    const link = await store.friendship(player.id, friendId);
    if (link?.status !== 'accepted') throw new HttpError(403, 'This player is not your friend', null, 'not_friends');
    return store.getPlayer(friendId);
  }

  // ── Trades ─────────────────────────────────────────────────────────────────

  /** cardId → copies the player has promised in open trades (the card they offered, or chose to give back). */
  function promisedCards(openTrades, playerId) {
    const promised = new Map();
    const add = (cardId) => promised.set(cardId, (promised.get(cardId) ?? 0) + 1);
    for (const trade of openTrades) {
      if (trade.from.id === playerId) add(trade.fromCardId);
      else if (trade.status === 'proposed') add(trade.toCardId);
    }
    return promised;
  }

  /** Whose answer an open trade is waiting for: the friend chooses a card, then the player who offered accepts. */
  const yourTurn = (trade, playerId) =>
    trade.status === 'pending' ? trade.to.id === playerId : trade.from.id === playerId;

  async function tradesOf(player) {
    const [{ open, closed }, friends] = await Promise.all([store.trades(player.id, 20), store.friends(player.id)]);
    return {
      trades: open.map((trade) => ({ ...trade, yourTurn: yourTurn(trade, player.id) })),
      history: closed,
      promised: Object.fromEntries(promisedCards(open, player.id)),
      friends: friends.map(({ id, name, friendCode }) => ({ id, name, friendCode })),
    };
  }

  /** `cardId` when it is a card of the catalog, else a 404. */
  function knownCard(cardId) {
    if (typeof cardId !== 'string' || !catalog.getCard(cardId)) throw new HttpError(404, 'Card not found', null, 'card_not_found');
    return cardId;
  }

  /** Throws unless the player has a copy of the card that is not already promised in another open trade. */
  async function requireSpareCopy(playerId, cardId) {
    const [copies, { open }] = await Promise.all([store.copies(playerId, cardId), store.trades(playerId, 0)]);
    if (copies === 0) throw new HttpError(409, 'You do not own this card', null, 'card_not_owned');
    if (copies <= (promisedCards(open, playerId).get(cardId) ?? 0)) {
      throw new HttpError(409, 'All your copies of this card are already in other trades', null, 'card_in_trade');
    }
  }

  /** An open trade of the player: `side` 'from' = they offered it, 'to' = a friend offered it to them. */
  async function openTrade(player, tradeId, side, statuses) {
    const trade = /^\d{1,15}$/.test(tradeId) ? await store.getTrade(Number(tradeId)) : null;
    if (!trade || trade[side].id !== player.id || !statuses.includes(trade.status)) {
      throw new HttpError(404, 'No such trade waiting for you', null, 'trade_not_found');
    }
    return trade;
  }

  // ── Catalog ────────────────────────────────────────────────────────────────
  router.get('/api/health', () => ({ status: 'ok', cards: totalCards, uptime: Math.round(process.uptime()) }));

  router.get('/api/meta', () => ({
    totalCards,
    rarities: RARITIES.map((rarity) => ({
      ...rarity,
      cardCount: catalog.cards.filter((card) => card.rarity === rarity.id).length,
    })),
    types: Object.entries(TYPES).map(([id, type]) => ({ id, ...type })),
    eras: ERAS,
    sets: shopSets.map(publicSet),
    booster: { ...boosterRules(), odds: boosterOdds(boosterRules()) },
    stocks: STOCKS,
    // { prices: { setId: Kira }, recycle: { rarity: Kira } }
    market: settings.market,
    daily: {
      superEvery: settings.daily.superEvery,
      superSet: superSet ? publicSet(superSet) : null,
      superBooster: { ...superRules(), odds: boosterOdds(superRules()) },
    },
    catalog: catalog.meta,
  }));

  router.get('/api/cards', ({ query }) => {
    const rarity = oneOf(query.get('rarity'), RARITY_IDS, 'rarity');
    const type = oneOf(query.get('type'), Object.keys(TYPES), 'type');
    const era = oneOf(query.get('era'), ERAS.map((e) => e.id), 'era');
    const setId = oneOf(query.get('set'), setIds, 'set');
    const sort = oneOf(query.get('sort'), Object.keys(SORTS), 'sort') ?? 'number';
    const search = (query.get('q') ?? '').trim().toLowerCase();

    let cards = setId ? catalog.getSet(setId).cards : catalog.cards;
    cards = cards.filter(
      (card) =>
        (!rarity || card.rarity === rarity) &&
        (!type || card.type === type) &&
        (!era || card.era === era) &&
        (!search ||
          `${card.name} ${card.description} ${card.fr?.name ?? ''}`.toLowerCase().includes(search)),
    );
    return { total: cards.length, cards: [...cards].sort(SORTS[sort]) };
  });

  router.get('/api/cards/:cardId', ({ params }) => {
    const card = catalog.getCard(params.cardId);
    if (!card) throw new HttpError(404, 'Card not found');
    return card;
  });

  router.get('/api/sets', () => ({ sets: shopSets.map(publicSet) }));

  router.get('/api/sets/:setId', ({ params }) => {
    const set = catalog.getSet(params.setId);
    if (!set) throw new HttpError(404, 'Booster set not found');
    return { ...publicSet(set), cards: set.cards };
  });

  // ── Accounts ───────────────────────────────────────────────────────────────

  /**
   * Body: { email, password, name?, claimPlayerId? }. `claimPlayerId` turns a
   * player created before accounts existed into this account (its cards are kept).
   */
  router.post('/api/auth/register', async ({ body }) => {
    const email = cleanEmail(body.email);
    const password = checkPassword(body.password);
    const name = body.name === undefined || body.name === '' ? randomPlayerName(rng) : cleanPlayerName(body.name);
    if (await store.findLogin(email)) throw new HttpError(409, 'An account already exists with this e-mail', null, 'email_taken');
    const passwordHash = await hashPassword(password);

    let player = null;
    if (typeof body.claimPlayerId === 'string' && (await store.claimPlayer(body.claimPlayerId, { name, email, passwordHash }))) {
      player = await store.getPlayer(body.claimPlayerId);
    }
    try {
      player ??= await store.createPlayer(name, { email, passwordHash });
    } catch (err) {
      // Two sign-ups with the same e-mail at the same time: the unique index decides.
      if (/UNIQUE/i.test(err.message)) throw new HttpError(409, 'An account already exists with this e-mail', null, 'email_taken');
      throw err;
    }
    return startSession(player, 201);
  });

  router.post('/api/auth/login', async ({ req, body }) => {
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const limiterKey = `${req.socket.remoteAddress}|${email}`;
    if (loginLimiter.blocked(limiterKey)) {
      throw new HttpError(429, 'Too many failed attempts, try again in a few minutes', null, 'too_many_attempts');
    }
    const login = email ? await store.findLogin(email) : null;
    const valid = login ? await verifyPassword(password, login.passwordHash) : (await burnPasswordCheck(password), false);
    if (!valid) {
      loginLimiter.fail(limiterKey);
      throw new HttpError(401, 'Wrong e-mail or password', null, 'invalid_credentials');
    }
    loginLimiter.reset(limiterKey);
    return startSession(await store.getPlayer(login.id), 200);
  });

  router.post('/api/auth/logout', async ({ req }) => {
    const token = readSessionToken(req);
    if (token) await store.deleteSession(hashToken(token));
    return reply(200, { ok: true }, { 'Set-Cookie': clearedSessionCookie() });
  });

  /** The logged-in player, or { player: null } (not an error: it is how a page checks if someone is logged in). */
  router.get('/api/auth/me', async ({ req }) => {
    const player = await currentPlayer(req);
    return { player: player ? await profile(player) : null };
  });

  /** Body: { currentPassword, newPassword }. Logs out your other sessions. */
  router.post('/api/auth/password', async ({ req, body }) => {
    const player = await requireLogin(req);
    const ok = await verifyPassword(String(body.currentPassword ?? ''), await store.getPasswordHash(player.id));
    if (!ok) throw new HttpError(401, 'The current password is wrong', null, 'wrong_password');
    await store.setPasswordHash(player.id, await hashPassword(checkPassword(body.newPassword)));
    await store.deleteOtherSessions(player.id, hashToken(readSessionToken(req)));
    return { ok: true };
  });

  // ── Players (your own only) ────────────────────────────────────────────────

  router.get('/api/players/:playerId', async ({ req, params }) => profile(await requireSelf(req, params.playerId)));

  router.patch('/api/players/:playerId', async ({ req, params, body }) => {
    await requireSelf(req, params.playerId);
    return profile(await store.renamePlayer(params.playerId, cleanPlayerName(body.name)));
  });

  router.post('/api/players/:playerId/boosters', async ({ req, params, body }) => {
    const player = await requireSelf(req, params.playerId);
    const setId = oneOf(body.setId, setIds, 'setId') ?? 'all-stars';
    const count = intParam(body.count, { name: 'count', min: 1, max: BOOSTER.maxPerRequest, fallback: 1 });
    const set = catalog.getSet(setId);
    const stockId = stockOf(set);
    const rules = STOCKS[stockId];

    const notEnough = (stock) =>
      new HttpError(
        429,
        `Not enough boosters: you have ${stock.stock}, you get one every ${rules.cooldownSeconds / 60} minutes (${rules.stackMax} at most)`,
        { retryIn: secondsUntil(stock, count, rules), stock: stock.stock },
        'booster_cooldown',
      );
    if (opening.has(player.id)) throw new HttpError(429, 'A booster is already being opened', { retryIn: 1 }, 'booster_cooldown');
    const stock = (await walletOf(player.id)).stocks[stockId];
    if (stock.stock < count) throw notEnough(stock);

    opening.add(player.id);
    let saved;
    try {
      const opened = Array.from({ length: count }, () => openBooster(set, { rng, rules: boosterRules() }));
      // The database checks the stock again, in the same transaction as the save.
      saved = await store.openBoosters(player.id, setId, opened, { every: rules.cooldownSeconds, max: rules.stackMax });
    } finally {
      opening.delete(player.id);
    }
    if (saved.error === 'no_booster') throw notEnough(saved);
    if (saved.error) throw new HttpError(404, 'Player not found');
    return reply(201, { boosters: saved.map(openedBooster), player: await profile(player) });
  });

  // ── Daily reward ───────────────────────────────────────────────────────────
  // Once a day, a free booster of the player's choice among the ones offered (settings),
  // opened at once (the stock is not used); every superEvery-th one is a Super Booster,
  // and so is the one of an event day or of an admin's gift.

  router.get('/api/players/:playerId/daily', async ({ req, params }) => dailyOf((await requireSelf(req, params.playerId)).id));

  /** Body: { setId } — the booster chosen, or the Super Booster on its day (any setId is fine that day). */
  router.post('/api/players/:playerId/daily', async ({ req, params, body }) => {
    const player = await requireSelf(req, params.playerId);
    const setId = oneOf(body.setId, [...setIds, DAILY.superSetId], 'setId') ?? settings.daily.sets[0];
    const claimed = (daily) =>
      new HttpError(409, "Today's daily reward is already claimed", daily && { nextIn: daily.nextIn }, 'daily_claimed');
    if (claiming.has(player.id)) throw claimed(null);
    claiming.add(player.id);
    let saved;
    let daily;
    try {
      daily = await dailyOf(player.id);
      if (!daily.available) throw claimed(daily);
      if (setId === DAILY.superSetId && !daily.super) {
        throw new HttpError(409, 'Today\'s daily reward is not a Super Booster: choose a booster', { day: daily.day }, 'not_super_day');
      }
      if (!daily.super && !daily.choices.includes(setId)) {
        throw new HttpError(409, 'This booster is not offered by the daily reward anymore', { choices: daily.choices }, 'daily_changed');
      }
      const set = daily.super ? superSet : catalog.getSet(setId);
      const cards = openBooster(set, { rng, rules: daily.super ? superRules() : boosterRules() });
      // The database checks the day again, in the same transaction as the save.
      saved = await store.claimDaily(player.id, { day: daily.today, number: daily.claims + 1, setId: set.id, cards });
    } finally {
      claiming.delete(player.id);
    }
    if (saved.error === 'claimed') throw claimed(await dailyOf(player.id));
    if (saved.error) throw new HttpError(404, 'Player not found');
    // The admins' gift is used up (an event or a cycle day does not use it).
    if (daily.superReason === 'gift') await store.setDailyGift(player.id, false);
    return reply(201, { booster: openedBooster(saved), player: await profile(player) });
  });

  // ── Kira market ────────────────────────────────────────────────────────────
  // Duplicates are recycled into Kira by rarity (a player keeps one copy of each
  // card, and the copies promised in open trades); Kira buys boosters, opened at once.

  /** cardId → duplicates the player can recycle. */
  async function spareCopies(playerId) {
    const [entries, { open }] = await Promise.all([store.collection(playerId), store.trades(playerId, 0)]);
    const promised = promisedCards(open, playerId);
    return Object.fromEntries(
      entries
        .filter((row) => catalog.getCard(row.cardId))
        .map((row) => [row.cardId, row.count - 1 - (promised.get(row.cardId) ?? 0)])
        .filter(([, spare]) => spare > 0),
    );
  }

  /** { kira, spare: { cardId: duplicates you can recycle } } */
  router.get('/api/players/:playerId/market', async ({ req, params }) => {
    const player = await requireSelf(req, params.playerId);
    const [{ kira }, spare] = await Promise.all([store.wallet(player.id), spareCopies(player.id)]);
    return { kira, spare };
  });

  /** Body: { cards: [{ cardId, count }] } — the duplicates to recycle (all of them or none). */
  router.post('/api/players/:playerId/market/recycle', async ({ req, params, body }) => {
    const player = await requireSelf(req, params.playerId);
    if (!Array.isArray(body.cards) || body.cards.length === 0 || body.cards.length > totalCards) {
      throw new HttpError(400, '"cards" must be a list of { cardId, count }');
    }
    const counts = new Map();
    for (const item of body.cards) {
      const cardId = knownCard(item?.cardId);
      counts.set(cardId, (counts.get(cardId) ?? 0) + intParam(item.count, { name: 'count', min: 1, max: 9999, fallback: 1 }));
    }
    const notEnough = (cardId, spare) =>
      new HttpError(409, `Not enough duplicates of "${cardId}" to recycle`, { cardId, spare }, 'not_enough_copies');
    const spare = await spareCopies(player.id);
    for (const [cardId, count] of counts) if ((spare[cardId] ?? 0) < count) throw notEnough(cardId, spare[cardId] ?? 0);

    // The database checks the duplicates again, in the same transaction as the recycling.
    const cards = [...counts].map(([cardId, count]) => ({ cardId, count, kira: settings.market.recycle[catalog.getCard(cardId).rarity] }));
    const result = await store.recycleCards(player.id, cards);
    if (result.error === 'not_enough') throw notEnough(result.id, (await spareCopies(player.id))[result.id] ?? 0);
    if (result.error) throw new HttpError(404, 'Player not found');
    const [after, me] = await Promise.all([spareCopies(player.id), profile(player)]);
    return { recycled: result.recycled, earned: result.earned, kira: result.kira, spare: after, player: me };
  });

  /**
   * Body: { setId, price? } — buys a booster with Kira (settings.market.prices), opened at once.
   * `price`: the price the player saw; if an admin changed it since → 409 price_changed.
   */
  router.post('/api/players/:playerId/market/buy', async ({ req, params, body }) => {
    const player = await requireSelf(req, params.playerId);
    const set = catalog.getSet(oneOf(body.setId, setIds, 'setId') ?? 'all-stars');
    const price = settings.market.prices[set.id];
    if (body.price !== undefined && body.price !== price) {
      throw new HttpError(409, `The price of this booster changed: it is now ${price} Kira`, { price }, 'price_changed');
    }
    const noKira = (kira) =>
      new HttpError(409, `Not enough Kira: this booster costs ${price}, you have ${kira}`, { price, kira }, 'not_enough_kira');
    const { kira } = await store.wallet(player.id);
    if (kira < price) throw noKira(kira);
    // The database checks the Kira again, in the same transaction as the purchase.
    const saved = await store.buyBooster(player.id, set.id, openBooster(set, { rng, rules: boosterRules() }), price);
    if (saved.error === 'no_kira') throw noKira(saved.kira);
    if (saved.error) throw new HttpError(404, 'Player not found');
    return reply(201, { booster: openedBooster(saved), player: await profile(player) });
  });

  // ── Admin panel ────────────────────────────────────────────────────────────
  // Only for the players whose is_admin is set in the database. The settings
  // apply at once; the tools on players never touch another admin.

  async function requireAdmin(req) {
    const player = await requireLogin(req);
    if (!player.isAdmin) throw new HttpError(403, 'Admins only', null, 'not_admin');
    return player;
  }

  /** A player an admin acts on (404 if there is none, 403 for another admin when `protect`). */
  async function targetPlayer(playerId, { protect = false } = {}) {
    const target = await store.getPlayer(playerId);
    if (!target) throw new HttpError(404, 'Player not found', null, 'player_not_found');
    if (protect && target.isAdmin) {
      throw new HttpError(403, 'Admins can only be changed from the database console', null, 'admin_protected');
    }
    return target;
  }

  /** { settings, defaults } */
  router.get('/api/admin/settings', async ({ req }) => {
    await requireAdmin(req);
    return { settings, defaults };
  });

  /** Body: the sections to change, each whole: { booster, superBooster, market, daily }. */
  router.patch('/api/admin/settings', async ({ req, body }) => {
    const admin = await requireAdmin(req);
    const next = mergeSettings(settings, body, settingsContext());
    await store.saveSettings(next, admin.id);
    settings = next;
    return { settings, defaults };
  });

  /** Every player with their numbers, for the list of the admin panel. */
  router.get('/api/admin/players', async ({ req }) => {
    await requireAdmin(req);
    const [players, collectors, collections, daily] = await Promise.all([
      store.allPlayers(),
      store.collectors(),
      store.allCollections(),
      store.allDailyClaims(),
    ]);
    const boosters = new Map(collectors.map((row) => [row.id, row.boostersOpened]));
    const { today } = rewardDay();
    return {
      today,
      players: players.map((player) => {
        const entries = (collections.get(player.id) ?? []).filter((row) => catalog.getCard(row.cardId));
        const claims = daily.get(player.id);
        return {
          ...player,
          cards: entries.length,
          copies: entries.reduce((sum, row) => sum + row.count, 0),
          boosters: boosters.get(player.id) ?? 0,
          daily: { claims: claims?.claims ?? 0, claimedToday: claims?.lastDay === today, gift: player.dailyGift },
        };
      }),
    };
  });

  /** The player can claim today's daily reward again. */
  router.post('/api/admin/players/:playerId/daily/reset', async ({ req, params }) => {
    await requireAdmin(req);
    const target = await targetPlayer(params.playerId);
    if (!(await store.resetDaily(target.id, rewardDay().today))) {
      throw new HttpError(409, 'This player has not claimed today\'s daily reward', null, 'daily_not_claimed');
    }
    return { ok: true };
  });

  /** Body: { super: true | false } — gives (or takes back) a Super Booster for the player's next daily reward. */
  router.post('/api/admin/players/:playerId/daily/gift', async ({ req, params, body }) => {
    await requireAdmin(req);
    const target = await targetPlayer(params.playerId);
    if (typeof body.super !== 'boolean') throw new HttpError(400, '"super" must be true or false');
    await store.setDailyGift(target.id, body.super);
    return { ok: true, gift: body.super };
  });

  /** Clears everything the player did (cards, boosters, Kira, friends, trades, daily rewards) but keeps the account. */
  router.post('/api/admin/players/:playerId/clear', async ({ req, params }) => {
    await requireAdmin(req);
    const target = await targetPlayer(params.playerId, { protect: true });
    return { ok: true, deletedBoosters: await store.clearPlayer(target.id) };
  });

  /** Deletes the player's account and everything that is theirs. */
  router.delete('/api/admin/players/:playerId', async ({ req, params }) => {
    await requireAdmin(req);
    const target = await targetPlayer(params.playerId, { protect: true });
    if (!(await store.deletePlayer(target.id))) throw new HttpError(404, 'Player not found', null, 'player_not_found');
    return { ok: true };
  });

  router.get('/api/players/:playerId/boosters', async ({ req, params, query }) => {
    await requireSelf(req, params.playerId);
    const limit = intParam(query.get('limit'), { name: 'limit', min: 1, max: 100, fallback: 20 });
    return {
      boosters: (await store.history(params.playerId, limit)).map((booster) => ({
        id: booster.id,
        setId: booster.setId,
        openedAt: booster.openedAt,
        kira: booster.kira ?? null,
        cards: booster.pulls.map((pull) => {
          const card = catalog.getCard(pull.cardId);
          return {
            id: pull.cardId,
            name: card?.name ?? pull.cardId,
            number: card?.number ?? null,
            rarity: pull.rarity,
            isNew: pull.isNew,
          };
        }),
      })),
    };
  });

  router.get('/api/players/:playerId/collection', async ({ req, params }) => {
    await requireSelf(req, params.playerId);
    const { entries, summary } = await collectionOf(params.playerId);
    return { ...summary, cards: entries };
  });

  router.delete('/api/players/:playerId/collection', async ({ req, params }) => {
    const player = await requireSelf(req, params.playerId);
    const deletedBoosters = await store.resetCollection(player.id);
    return { deletedBoosters, player: await profile(player) };
  });

  /** Best collectors by score (points by rarity, see SCORE in config.js); the admins are left out. */
  router.get('/api/leaderboard', async ({ req, query }) => {
    const limit = intParam(query.get('limit'), { name: 'limit', min: 1, max: 100, fallback: 10 });
    const [collectors, collections, you] = await Promise.all([store.collectors(), store.allCollections(), currentPlayer(req)]);
    const ranked = await withoutAdmins(await rank(collectors, collections, you?.id));
    return { scoring: SCORE, players: ranked.slice(0, limit).map(({ id, ...row }) => row) };
  });

  // ── Friends (your own list only) ───────────────────────────────────────────

  router.get('/api/players/:playerId/friends', async ({ req, params }) => friendsOf(await requireSelf(req, params.playerId)));

  /** Body: { code } — a friend code ("#K7Q2XM") or an e-mail address. */
  router.post('/api/players/:playerId/friends', async ({ req, params, body }) => {
    const player = await requireSelf(req, params.playerId);
    const code = typeof body.code === 'string' ? body.code.trim() : '';
    const friendId = code.includes('@') ? (await store.findLogin(code.toLowerCase()))?.id : await store.findByFriendCode(code);
    if (!friendId) throw new HttpError(404, 'No player with this friend code or e-mail', null, 'player_not_found');
    if (friendId === player.id) throw new HttpError(400, 'You cannot add yourself', null, 'cannot_add_self');

    const link = await store.friendship(player.id, friendId);
    if (link?.status === 'accepted') throw new HttpError(409, 'You are already friends', null, 'already_friends');
    if (link?.requesterId === player.id) throw new HttpError(409, 'Request already sent', null, 'request_exists');
    let status = 'pending';
    if (link) {
      // They had already asked you: adding them back accepts their request.
      await store.acceptFriend(friendId, player.id);
      status = 'accepted';
    } else {
      await store.requestFriend(player.id, friendId);
    }
    const friend = await store.getPlayer(friendId);
    return reply(201, {
      status,
      friend: { id: friend.id, name: friend.name, friendCode: friend.friendCode },
      ...(await friendsOf(player)),
    });
  });

  router.post('/api/players/:playerId/friends/:friendId/accept', async ({ req, params }) => {
    const player = await requireSelf(req, params.playerId);
    if (!(await store.acceptFriend(params.friendId, player.id))) {
      throw new HttpError(404, 'No friend request from this player', null, 'request_not_found');
    }
    return friendsOf(player);
  });

  router.post('/api/players/:playerId/friends/:friendId/decline', async ({ req, params }) => {
    const player = await requireSelf(req, params.playerId);
    const link = await store.friendship(player.id, params.friendId);
    if (link?.status !== 'pending' || link.addresseeId !== player.id) {
      throw new HttpError(404, 'No friend request from this player', null, 'request_not_found');
    }
    await store.removeFriendship(player.id, params.friendId);
    return friendsOf(player);
  });

  /** Removes a friend, or cancels a request you sent. */
  router.delete('/api/players/:playerId/friends/:friendId', async ({ req, params }) => {
    const player = await requireSelf(req, params.playerId);
    if (!(await store.removeFriendship(player.id, params.friendId))) {
      throw new HttpError(404, 'Not in your friend list', null, 'not_friends');
    }
    return friendsOf(player);
  });

  router.get('/api/players/:playerId/friends/:friendId/collection', async ({ req, params }) => {
    const friend = await requireFriend(await requireSelf(req, params.playerId), params.friendId);
    const [player, { entries }] = await Promise.all([publicProfile(friend), collectionOf(friend.id)]);
    return { player, cards: entries };
  });

  // ── Trades (with your friends) ─────────────────────────────────────────────
  // 1. You offer a card to a friend · 2. they choose a card to give back, or decline ·
  // 3. you accept (the cards are swapped) or cancel.

  /** Your open trades (with `yourTurn`), the latest closed ones, the copies you promised and your friends. */
  router.get('/api/players/:playerId/trades', async ({ req, params }) => tradesOf(await requireSelf(req, params.playerId)));

  /** Body: { friendId, cardId } — offers one copy of your card. */
  router.post('/api/players/:playerId/trades', async ({ req, params, body }) => {
    const player = await requireSelf(req, params.playerId);
    await requireFriend(player, typeof body.friendId === 'string' ? body.friendId : '');
    const cardId = knownCard(body.cardId);
    await requireSpareCopy(player.id, cardId);
    const id = await store.createTrade(player.id, body.friendId, cardId);
    return reply(201, { id, ...(await tradesOf(player)) });
  });

  /** Body: { cardId } — the friend chooses the card they give back. */
  router.post('/api/players/:playerId/trades/:tradeId/propose', async ({ req, params, body }) => {
    const player = await requireSelf(req, params.playerId);
    const trade = await openTrade(player, params.tradeId, 'to', ['pending']);
    await requireFriend(player, trade.from.id);
    const cardId = knownCard(body.cardId);
    if (cardId === trade.fromCardId) throw new HttpError(400, 'Choose another card than the one you are offered', null, 'same_card');
    await requireSpareCopy(player.id, cardId);
    if (!(await store.proposeTrade(trade.id, player.id, cardId))) {
      throw new HttpError(404, 'No such trade waiting for you', null, 'trade_not_found');
    }
    return tradesOf(player);
  });

  /** The player who offered the card accepts the friend's card: both cards change hands. */
  router.post('/api/players/:playerId/trades/:tradeId/accept', async ({ req, params }) => {
    const player = await requireSelf(req, params.playerId);
    const trade = await openTrade(player, params.tradeId, 'from', ['proposed']);
    await requireFriend(player, trade.to.id);
    const result = await store.completeTrade(trade.id, player.id);
    if (result === 'from_card_missing') throw new HttpError(409, 'You do not own the card you offered anymore', null, 'card_not_owned');
    if (result === 'to_card_missing') throw new HttpError(409, 'Your friend does not own their card anymore', null, 'friend_card_gone');
    if (result !== 'accepted') throw new HttpError(404, 'No such trade waiting for you', null, 'trade_not_found');
    return { ...(await tradesOf(player)), player: await profile(player) };
  });

  /** The friend declines a trade (or takes back the card they chose). */
  router.post('/api/players/:playerId/trades/:tradeId/decline', async ({ req, params }) => {
    const player = await requireSelf(req, params.playerId);
    const trade = await openTrade(player, params.tradeId, 'to', ['pending', 'proposed']);
    if (!(await store.closeTrade(trade.id, 'to', player.id, 'declined'))) {
      throw new HttpError(404, 'No such trade waiting for you', null, 'trade_not_found');
    }
    return tradesOf(player);
  });

  /** Numbers for the header badges; the web page asks every few seconds, so it only makes two small queries. */
  router.get('/api/players/:playerId/notifications', async ({ req, params }) =>
    store.notifications((await requireSelf(req, params.playerId)).id),
  );

  /** The player who offered the card cancels the trade. */
  router.delete('/api/players/:playerId/trades/:tradeId', async ({ req, params }) => {
    const player = await requireSelf(req, params.playerId);
    const trade = await openTrade(player, params.tradeId, 'from', ['pending', 'proposed']);
    if (!(await store.closeTrade(trade.id, 'from', player.id, 'canceled'))) {
      throw new HttpError(404, 'No such trade waiting for you', null, 'trade_not_found');
    }
    return tradesOf(player);
  });

  return router;
}
