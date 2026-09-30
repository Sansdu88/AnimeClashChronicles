/**
 * Browser-only version of the REST API, used when the page is served without
 * the Node.js server (for example on GitHub Pages). It answers the same routes
 * as server/api.js, but everything is saved in this browser (localStorage):
 * accounts only exist on this device.
 *
 * Built by `npm run build:pages`, which also copies server/config.js and
 * server/booster.js to js/shared/ and writes data/meta.json + data/cards.json.
 */
import { BOOSTER, RARITY_IDS } from './shared/config.js';
import { openBooster } from './shared/booster.js';

const STORE_KEY = 'animeClashChronicles.local';
const HISTORY_LIMIT = 50;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ADJECTIVES = ['Brave', 'Sleepy', 'Mighty', 'Shy', 'Lucky', 'Swift', 'Silent', 'Wild', 'Clever', 'Fierce', 'Cosmic', 'Golden', 'Crimson', 'Tiny'];
const NOUNS = ['Ronin', 'Shinobi', 'Mangaka', 'Kitsune', 'Senpai', 'Samurai', 'Tanuki', 'Pilot', 'Otaku', 'Oni', 'Idol', 'Ninja', 'Kaiju', 'Hero'];

class LocalApiError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const fail = (status, message, code) => {
  throw new LocalApiError(status, message, code);
};

async function fetchJson(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Cannot load ${path}`);
  return response.json();
}

// ── Passwords (PBKDF2 from the Web Crypto API) ───────────────────────────────

const toBase64 = (bytes) => btoa(String.fromCharCode(...bytes));
const fromBase64 = (text) => Uint8Array.from(atob(text), (ch) => ch.charCodeAt(0));

async function hashPassword(password, salt = crypto.getRandomValues(new Uint8Array(16))) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 150_000 }, key, 256);
  return { salt: toBase64(salt), hash: toBase64(new Uint8Array(bits)) };
}

// ── Validation (same rules and error codes as the server) ────────────────────

function cleanEmail(value) {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (email.length > 254 || !EMAIL.test(email)) fail(400, 'Enter a valid e-mail address', 'invalid_email');
  return email;
}

function checkPassword(value) {
  if (typeof value !== 'string' || value.length < 8 || value.length > 128) {
    fail(400, 'The password must be 8 to 128 characters long', 'weak_password');
  }
  return value;
}

function cleanName(value) {
  const name = typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim() : '';
  if (name.length === 0 || [...name].length > 24) fail(400, 'The name must be 1 to 24 characters long', 'invalid_name');
  return name;
}

function randomName() {
  const pick = (list) => list[Math.floor(Math.random() * list.length)];
  return `${pick(ADJECTIVES)} ${pick(NOUNS)} ${100 + Math.floor(Math.random() * 900)}`;
}

// ── The API ──────────────────────────────────────────────────────────────────

export async function createLocalApi() {
  const [meta, { cards }] = await Promise.all([fetchJson('data/meta.json'), fetchJson('data/cards.json')]);
  const cardsById = new Map(cards.map((card) => [card.id, card]));
  const sets = new Map(
    meta.sets.map((set) => {
      const setCards = cards.filter((card) => !set.era || card.era === set.era);
      const byRarity = Object.fromEntries(RARITY_IDS.map((id) => [id, setCards.filter((card) => card.rarity === id)]));
      return [set.id, { cards: setCards, byRarity }];
    }),
  );

  let db;
  try {
    db = JSON.parse(localStorage.getItem(STORE_KEY)) ?? null;
  } catch {
    db = null;
  }
  db ??= { players: {}, session: null };
  const save = () => localStorage.setItem(STORE_KEY, JSON.stringify(db));

  function summary(player) {
    const owned = new Set(Object.keys(player.collection).filter((id) => cardsById.has(id)));
    const progress = (list) => ({ owned: list.filter((card) => owned.has(card.id)).length, total: list.length });
    return {
      uniqueCards: owned.size,
      totalCards: cards.length,
      completion: owned.size / cards.length,
      byRarity: Object.fromEntries(RARITY_IDS.map((id) => [id, progress(cards.filter((card) => card.rarity === id))])),
      bySet: Object.fromEntries([...sets].map(([id, set]) => [id, progress(set.cards)])),
    };
  }

  function profile(player) {
    const cardsPulled = Object.values(player.pullsByRarity).reduce((sum, n) => sum + n, 0);
    return {
      id: player.id,
      name: player.name,
      email: player.email,
      createdAt: player.createdAt,
      stats: {
        boostersOpened: player.boostersOpened,
        boostersBySet: { ...player.boostersBySet },
        pullsByRarity: { ...player.pullsByRarity },
        cardsPulled,
        ...summary(player),
      },
    };
  }

  const findByEmail = (email) => Object.values(db.players).find((player) => player.email === email);
  const current = () => db.players[db.session] ?? null;

  function requireSelf(id) {
    const player = current();
    if (!player) fail(401, 'Log in first', 'not_authenticated');
    if (player.id !== id) fail(403, 'This is not your player', 'forbidden');
    return player;
  }

  function intParam(value, min, max, fallback, name) {
    if (value === undefined || value === null || value === '') return fallback;
    const number = Number(value);
    if (!Number.isInteger(number) || number < min || number > max) fail(400, `"${name}" must be an integer between ${min} and ${max}`);
    return number;
  }

  const routes = [
    ['GET', /^\/meta$/, () => meta],
    ['GET', /^\/cards$/, () => ({ total: cards.length, cards })],

    ['GET', /^\/auth\/me$/, () => ({ player: current() ? profile(current()) : null })],

    [
      'POST',
      /^\/auth\/register$/,
      async ({ body }) => {
        const email = cleanEmail(body.email);
        const password = checkPassword(body.password);
        const name = body.name === undefined || body.name === '' ? randomName() : cleanName(body.name);
        if (findByEmail(email)) fail(409, 'An account already exists with this e-mail', 'email_taken');
        const player = {
          id: crypto.randomUUID(),
          name,
          email,
          createdAt: new Date().toISOString(),
          password: await hashPassword(password),
          boostersOpened: 0,
          boostersBySet: {},
          pullsByRarity: {},
          collection: {},
          history: [],
          nextBoosterId: 1,
        };
        db.players[player.id] = player;
        db.session = player.id;
        save();
        return { player: profile(player) };
      },
    ],

    [
      'POST',
      /^\/auth\/login$/,
      async ({ body }) => {
        const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
        const player = findByEmail(email);
        const attempt = await hashPassword(String(body.password ?? ''), player ? fromBase64(player.password.salt) : undefined);
        if (!player || attempt.hash !== player.password.hash) fail(401, 'Wrong e-mail or password', 'invalid_credentials');
        db.session = player.id;
        save();
        return { player: profile(player) };
      },
    ],

    [
      'POST',
      /^\/auth\/logout$/,
      () => {
        db.session = null;
        save();
        return { ok: true };
      },
    ],

    [
      'POST',
      /^\/auth\/password$/,
      async ({ body }) => {
        const player = current();
        if (!player) fail(401, 'Log in first', 'not_authenticated');
        const attempt = await hashPassword(String(body.currentPassword ?? ''), fromBase64(player.password.salt));
        if (attempt.hash !== player.password.hash) fail(401, 'The current password is wrong', 'wrong_password');
        player.password = await hashPassword(checkPassword(body.newPassword));
        save();
        return { ok: true };
      },
    ],

    ['GET', /^\/players\/([^/]+)$/, ({ params }) => profile(requireSelf(params[0]))],

    [
      'PATCH',
      /^\/players\/([^/]+)$/,
      ({ params, body }) => {
        const player = requireSelf(params[0]);
        player.name = cleanName(body.name);
        save();
        return profile(player);
      },
    ],

    [
      'POST',
      /^\/players\/([^/]+)\/boosters$/,
      ({ params, body }) => {
        const player = requireSelf(params[0]);
        const setId = body.setId ?? 'all-stars';
        const set = sets.get(setId) ?? fail(400, `Unknown setId "${setId}"`);
        const count = intParam(body.count, 1, BOOSTER.maxPerRequest, 1, 'count');
        const openedAt = new Date().toISOString();
        const boosters = Array.from({ length: count }, () => {
          const pulled = openBooster(set).map((card) => {
            const isNew = !player.collection[card.id];
            const entry = (player.collection[card.id] ??= { count: 0, firstPulledAt: openedAt });
            entry.count += 1;
            entry.lastPulledAt = openedAt;
            player.pullsByRarity[card.rarity] = (player.pullsByRarity[card.rarity] ?? 0) + 1;
            return { ...card, isNew };
          });
          const booster = { id: player.nextBoosterId++, setId, openedAt, cards: pulled };
          player.boostersOpened += 1;
          player.boostersBySet[setId] = (player.boostersBySet[setId] ?? 0) + 1;
          player.history.push({
            id: booster.id,
            setId,
            openedAt,
            pulls: pulled.map((card) => [card.id, card.rarity, card.isNew]),
          });
          return booster;
        });
        player.history = player.history.slice(-HISTORY_LIMIT);
        save();
        return { boosters, player: profile(player) };
      },
    ],

    [
      'GET',
      /^\/players\/([^/]+)\/boosters$/,
      ({ params, query }) => {
        const player = requireSelf(params[0]);
        const limit = intParam(query.get('limit'), 1, 100, 20, 'limit');
        return {
          boosters: player.history
            .slice(-limit)
            .reverse()
            .map((booster) => ({
              id: booster.id,
              setId: booster.setId,
              openedAt: booster.openedAt,
              cards: booster.pulls.map(([id, rarity, isNew]) => ({
                id,
                name: cardsById.get(id)?.name ?? id,
                number: cardsById.get(id)?.number ?? null,
                rarity,
                isNew,
              })),
            })),
        };
      },
    ],

    [
      'GET',
      /^\/players\/([^/]+)\/collection$/,
      ({ params }) => {
        const player = requireSelf(params[0]);
        const entries = Object.entries(player.collection)
          .filter(([id]) => cardsById.has(id))
          .map(([cardId, entry]) => ({ cardId, ...entry }));
        return { ...summary(player), cards: entries };
      },
    ],

    [
      'DELETE',
      /^\/players\/([^/]+)\/collection$/,
      ({ params }) => {
        const player = requireSelf(params[0]);
        const deletedBoosters = player.boostersOpened;
        Object.assign(player, { boostersOpened: 0, boostersBySet: {}, pullsByRarity: {}, collection: {}, history: [] });
        save();
        return { deletedBoosters, player: profile(player) };
      },
    ],

    [
      'GET',
      /^\/leaderboard$/,
      ({ query }) => {
        const limit = intParam(query.get('limit'), 1, 100, 10, 'limit');
        return {
          players: Object.values(db.players)
            .map((player) => ({ player, profile: profile(player) }))
            .filter(({ profile: p }) => p.stats.cardsPulled > 0)
            .sort((a, b) => b.profile.stats.uniqueCards - a.profile.stats.uniqueCards || a.player.boostersOpened - b.player.boostersOpened)
            .slice(0, limit)
            .map(({ player, profile: p }, index) => ({
              rank: index + 1,
              name: player.name,
              you: player.id === db.session,
              uniqueCards: p.stats.uniqueCards,
              completion: p.stats.completion,
              boostersOpened: p.stats.boostersOpened,
              cardsPulled: p.stats.cardsPulled,
            })),
        };
      },
    ],
  ];

  return {
    /** Same contract as fetch('/api' + path): resolves to the JSON answer or throws { status, code }. */
    async request(path, { method = 'GET', body } = {}) {
      const url = new URL(path, 'http://local');
      for (const [routeMethod, pattern, handler] of routes) {
        const match = pattern.exec(url.pathname);
        if (!match || routeMethod !== method) continue;
        const params = match.slice(1).map(decodeURIComponent);
        const result = await handler({ params, query: url.searchParams, body: body ?? {} });
        return structuredClone(result);
      }
      return fail(404, `No route ${method} ${url.pathname}`);
    },
  };
}
