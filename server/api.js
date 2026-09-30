/**
 * REST API. Every route returns JSON; see README.md for the full reference.
 * Player routes need a session (cookie set by /api/auth/login, or an
 * "Authorization: Bearer <token>" header) and only give access to your own player.
 */
import { BOOSTER, ERAS, RARITIES, RARITY_IDS, TYPES } from './config.js';
import { boosterOdds, openBooster } from './booster.js';
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

export function randomPlayerName(rng = Math.random) {
  const pick = (list) => list[Math.floor(rng() * list.length)];
  return `${pick(ADJECTIVES)} ${pick(NOUNS)} ${100 + Math.floor(rng() * 900)}`;
}

export function cleanPlayerName(value) {
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

export function createApi({ catalog, store, rng = Math.random, secureCookies = false }) {
  const router = createRouter();
  const odds = boosterOdds();
  const totalCards = catalog.cards.length;
  const setIds = catalog.sets.map((set) => set.id);
  const loginLimiter = createRateLimiter({ max: 10, windowMs: 15 * 60 * 1000 });

  const publicSet = (set) => ({
    id: set.id,
    name: set.name,
    jp: set.jp,
    tagline: set.tagline,
    era: set.era,
    colors: set.colors,
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
  function currentPlayer(req) {
    const token = readSessionToken(req);
    return token ? store.sessionPlayer(hashToken(token)) : null;
  }

  function requireLogin(req) {
    const player = currentPlayer(req);
    if (!player) throw new HttpError(401, 'Log in first (POST /api/auth/login)', null, 'not_authenticated');
    return player;
  }

  /** Logged in AND the :playerId of the URL is you. */
  function requireSelf(req, playerId) {
    const player = requireLogin(req);
    if (player.id !== playerId) throw new HttpError(403, 'This is not your player', null, 'forbidden');
    return player;
  }

  function startSession(player, status, extra = {}) {
    const token = newSessionToken();
    store.createSession(player.id, hashToken(token), SESSION_DAYS);
    return reply(status, { player: profile(player), token, ...extra }, { 'Set-Cookie': sessionCookie(token, { secure: secureCookies }) });
  }

  // ── Profiles ───────────────────────────────────────────────────────────────

  /** Collection rows (cards still in the catalog) + completion numbers. */
  function collectionOf(playerId) {
    const entries = store.collection(playerId).filter((row) => catalog.getCard(row.cardId));
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
        bySet: Object.fromEntries(catalog.sets.map((set) => [set.id, progress(set.cards)])),
      },
    };
  }

  function profile(player) {
    const stats = store.stats(player.id);
    const cardsPulled = Object.values(stats.pullsByRarity).reduce((sum, n) => sum + n, 0);
    return {
      id: player.id,
      name: player.name,
      email: player.email,
      createdAt: player.createdAt,
      stats: { ...stats, cardsPulled, ...collectionOf(player.id).summary },
    };
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
    sets: catalog.sets.map(publicSet),
    booster: { ...BOOSTER, odds },
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
          `${card.name} ${card.nameJa ?? ''} ${card.description} ${card.fr?.name ?? ''}`.toLowerCase().includes(search)),
    );
    return { total: cards.length, cards: [...cards].sort(SORTS[sort]) };
  });

  router.get('/api/cards/:cardId', ({ params }) => {
    const card = catalog.getCard(params.cardId);
    if (!card) throw new HttpError(404, 'Card not found');
    return card;
  });

  router.get('/api/sets', () => ({ sets: catalog.sets.map(publicSet) }));

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
    if (store.findLogin(email)) throw new HttpError(409, 'An account already exists with this e-mail', null, 'email_taken');
    const passwordHash = await hashPassword(password);

    let player = null;
    if (typeof body.claimPlayerId === 'string' && store.claimPlayer(body.claimPlayerId, { name, email, passwordHash })) {
      player = store.getPlayer(body.claimPlayerId);
    }
    try {
      player ??= store.createPlayer(name, { email, passwordHash });
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
    const login = email ? store.findLogin(email) : null;
    const valid = login ? await verifyPassword(password, login.passwordHash) : (await burnPasswordCheck(password), false);
    if (!valid) {
      loginLimiter.fail(limiterKey);
      throw new HttpError(401, 'Wrong e-mail or password', null, 'invalid_credentials');
    }
    loginLimiter.reset(limiterKey);
    return startSession(store.getPlayer(login.id), 200);
  });

  router.post('/api/auth/logout', ({ req }) => {
    const token = readSessionToken(req);
    if (token) store.deleteSession(hashToken(token));
    return reply(200, { ok: true }, { 'Set-Cookie': clearedSessionCookie() });
  });

  /** The logged-in player, or { player: null } (not an error: it is how a page checks if someone is logged in). */
  router.get('/api/auth/me', ({ req }) => {
    const player = currentPlayer(req);
    return { player: player ? profile(player) : null };
  });

  /** Body: { currentPassword, newPassword }. Logs out your other sessions. */
  router.post('/api/auth/password', async ({ req, body }) => {
    const player = requireLogin(req);
    const ok = await verifyPassword(String(body.currentPassword ?? ''), store.getPasswordHash(player.id));
    if (!ok) throw new HttpError(401, 'The current password is wrong', null, 'wrong_password');
    store.setPasswordHash(player.id, await hashPassword(checkPassword(body.newPassword)));
    store.deleteOtherSessions(player.id, hashToken(readSessionToken(req)));
    return { ok: true };
  });

  // ── Players (your own only) ────────────────────────────────────────────────

  router.get('/api/players/:playerId', ({ req, params }) => profile(requireSelf(req, params.playerId)));

  router.patch('/api/players/:playerId', ({ req, params, body }) => {
    requireSelf(req, params.playerId);
    return profile(store.renamePlayer(params.playerId, cleanPlayerName(body.name)));
  });

  router.post('/api/players/:playerId/boosters', ({ req, params, body }) => {
    const player = requireSelf(req, params.playerId);
    const setId = oneOf(body.setId, setIds, 'setId') ?? 'all-stars';
    const count = intParam(body.count, { name: 'count', min: 1, max: BOOSTER.maxPerRequest, fallback: 1 });
    const set = catalog.getSet(setId);

    const opened = Array.from({ length: count }, () => openBooster(set, { rng }));
    const saved = store.recordBoosters(player.id, setId, opened);
    return reply(201, {
      boosters: saved.map((booster) => ({
        id: booster.id,
        setId: booster.setId,
        openedAt: booster.openedAt,
        cards: booster.pulls.map(({ card, isNew }) => ({ ...card, isNew })),
      })),
      player: profile(player),
    });
  });

  router.get('/api/players/:playerId/boosters', ({ req, params, query }) => {
    requireSelf(req, params.playerId);
    const limit = intParam(query.get('limit'), { name: 'limit', min: 1, max: 100, fallback: 20 });
    return {
      boosters: store.history(params.playerId, limit).map((booster) => ({
        id: booster.id,
        setId: booster.setId,
        openedAt: booster.openedAt,
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

  router.get('/api/players/:playerId/collection', ({ req, params }) => {
    requireSelf(req, params.playerId);
    const { entries, summary } = collectionOf(params.playerId);
    return { ...summary, cards: entries };
  });

  router.delete('/api/players/:playerId/collection', ({ req, params }) => {
    const player = requireSelf(req, params.playerId);
    const deletedBoosters = store.resetCollection(player.id);
    return { deletedBoosters, player: profile(player) };
  });

  router.get('/api/leaderboard', ({ req, query }) => {
    const limit = intParam(query.get('limit'), { name: 'limit', min: 1, max: 100, fallback: 10 });
    const you = currentPlayer(req)?.id;
    return {
      players: store.leaderboard(limit).map((row, index) => ({
        rank: index + 1,
        name: row.name,
        you: row.id === you,
        uniqueCards: Math.min(row.uniqueCards, totalCards),
        completion: Math.min(row.uniqueCards, totalCards) / totalCards,
        boostersOpened: row.boostersOpened,
        cardsPulled: row.cardsPulled,
      })),
    };
  });

  return router;
}
