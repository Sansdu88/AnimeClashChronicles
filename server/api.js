/**
 * REST API. Every route returns JSON; see README.md for the full reference.
 * Player routes need a session (cookie set by /api/auth/login, or an
 * "Authorization: Bearer <token>" header) and only give access to your own player.
 */
import { BOOSTER, ERAS, RARITIES, RARITY_IDS, SCORE, TYPES } from './config.js';
import { boosterOdds, collectionScore, openBooster } from './booster.js';
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
  const opening = new Set(); // players whose booster is being saved (blocks double clicks)

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
        bySet: Object.fromEntries(catalog.sets.map((set) => [set.id, progress(set.cards)])),
      },
    };
  }

  const rarityOfCard = (cardId) => catalog.getCard(cardId)?.rarity;

  /** Seconds before the player can open their next booster (0 = now). */
  async function boosterWait(playerId) {
    const last = await store.lastBoosterAt(playerId);
    if (!last) return 0;
    const remaining = BOOSTER.cooldownSeconds * 1000 - (Date.now() - new Date(last).getTime());
    return Math.max(0, Math.ceil(remaining / 1000));
  }

  async function profile(player) {
    const [stats, { entries, summary }, nextBoosterIn] = await Promise.all([
      store.stats(player.id),
      collectionOf(player.id),
      boosterWait(player.id),
    ]);
    const cardsPulled = Object.values(stats.pullsByRarity).reduce((sum, n) => sum + n, 0);
    return {
      id: player.id,
      name: player.name,
      email: player.email,
      friendCode: player.friendCode,
      createdAt: player.createdAt,
      stats: { ...stats, cardsPulled, ...summary, score: collectionScore(entries, rarityOfCard).score },
      nextBoosterIn,
    };
  }

  /** What friends can see of a player (no e-mail). */
  async function publicProfile(player) {
    const { email, ...rest } = await profile(player);
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
      ranking: ranked,
    };
  }

  async function requireFriend(player, friendId) {
    const link = await store.friendship(player.id, friendId);
    if (link?.status !== 'accepted') throw new HttpError(403, 'This player is not your friend', null, 'not_friends');
    return store.getPlayer(friendId);
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

    const wait = opening.has(player.id) ? BOOSTER.cooldownSeconds : await boosterWait(player.id);
    if (wait > 0) {
      throw new HttpError(429, `You can open one booster every ${BOOSTER.cooldownSeconds / 60} minutes`, { retryIn: wait }, 'booster_cooldown');
    }
    opening.add(player.id);
    let saved;
    try {
      const opened = Array.from({ length: count }, () => openBooster(set, { rng }));
      saved = await store.recordBoosters(player.id, setId, opened);
    } finally {
      opening.delete(player.id);
    }
    return reply(201, {
      boosters: saved.map((booster) => ({
        id: booster.id,
        setId: booster.setId,
        openedAt: booster.openedAt,
        cards: booster.pulls.map(({ card, isNew }) => ({ ...card, isNew })),
      })),
      player: await profile(player),
    });
  });

  router.get('/api/players/:playerId/boosters', async ({ req, params, query }) => {
    await requireSelf(req, params.playerId);
    const limit = intParam(query.get('limit'), { name: 'limit', min: 1, max: 100, fallback: 20 });
    return {
      boosters: (await store.history(params.playerId, limit)).map((booster) => ({
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

  /** Best collectors by score (points by rarity, see SCORE in config.js). */
  router.get('/api/leaderboard', async ({ req, query }) => {
    const limit = intParam(query.get('limit'), { name: 'limit', min: 1, max: 100, fallback: 10 });
    const [collectors, collections, you] = await Promise.all([store.collectors(), store.allCollections(), currentPlayer(req)]);
    const ranked = await rank(collectors, collections, you?.id);
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

  return router;
}
