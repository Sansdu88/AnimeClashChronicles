/**
 * Client state: the card catalog (loaded once), the logged-in player and what
 * they own. The session itself lives in an HttpOnly cookie set by the server.
 */
import { api } from './api.js';
import { cardText } from './i18n.js';

// Players created before accounts existed were remembered by this key; registering adopts them.
const LEGACY_PLAYER_KEY = 'mangaBooster.playerId';
const listeners = new Set();

export const state = {
  meta: null,
  cards: [],
  cardsById: new Map(),
  player: null,
  /** cardId → { count, firstPulledAt, lastPulledAt } */
  owned: new Map(),
};

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit() {
  for (const listener of listeners) listener(state);
}

// Booster stocks (era boosters, All-Stars): the server tells how many boosters the
// player has in each and when the next one comes; from that, the page counts on its
// own (one every cooldownSeconds of that stock, see meta.stocks).
const stockFrom = {}; // stock id → local time (ms) it counts from
let nextDayAt = 0; // local time (ms) the daily reward's day changes

function setDaily(daily) {
  state.player.daily = daily;
  nextDayAt = Date.now() + daily.nextIn * 1000;
}

function setPlayer(player) {
  state.player = player;
  if (!player) return;
  for (const [id, { cooldownSeconds }] of Object.entries(state.meta.stocks)) {
    const every = cooldownSeconds * 1000;
    const { stock = 0, nextIn = 0 } = player.stocks?.[id] ?? {};
    // nextIn = 0 means a full stock: counted as one more period (the count stops at the maximum).
    stockFrom[id] = Date.now() - stock * every - (nextIn ? every - nextIn * 1000 : every);
  }
  setDaily(player.daily);
}

/**
 * A booster stock ('era' or 'all-stars', see setOf(id).stock): { stock, max, every, nextIn }:
 * boosters you can open now, the most you can keep, seconds between two of them, and
 * seconds before the next one (0 when full).
 */
export function boosterStock(id) {
  const { cooldownSeconds: every, stackMax: max } = state.meta.stocks[id];
  const elapsed = Date.now() - stockFrom[id];
  const stock = Math.max(0, Math.min(max, Math.floor(elapsed / (every * 1000))));
  const nextIn = stock >= max ? 0 : Math.ceil((every * 1000 - (elapsed % (every * 1000))) / 1000);
  return { stock, max, every, nextIn };
}

/** Kira price of a booster of a set at the market (set by the admins: an era booster costs less than All-Stars). */
export const priceOf = (setId) => state.meta.market.prices[setId];

/**
 * Today's daily reward (see dailyStatus in server/booster.js): { today, available, claims, day,
 * cycle, super, nextIn }, `nextIn` counted down here. `newDay`: the day changed since the
 * server said it was claimed, ask it again (refreshDaily).
 */
export function dailyStatus() {
  const nextIn = Math.max(0, Math.ceil((nextDayAt - Date.now()) / 1000));
  return { ...state.player.daily, nextIn, newDay: nextIn === 0 };
}

export const rarityOf = (id) => state.meta.rarities.find((r) => r.id === id);
export const typeOf = (id) => state.meta.types.find((t) => t.id === id);
/** A booster set: the ones of the shelf, or the Super Booster of the daily reward. */
export const setOf = (id) => state.meta.sets.find((s) => s.id === id) ?? (state.meta.daily.superSet?.id === id ? state.meta.daily.superSet : undefined);
const rarityRank = (id) => state.meta.rarities.findIndex((r) => r.id === id);

/** Rarest first, then most popular. */
export const byRarity = (a, b) =>
  rarityRank(b.rarity) - rarityRank(a.rarity) || b.power - a.power || b.views - a.views || a.number - b.number;

export const byLocalName = (a, b) => cardText(a).name.localeCompare(cardText(b).name);

export async function loadCatalog() {
  const [meta, { cards }] = await Promise.all([api('/meta'), api('/cards')]);
  state.meta = meta;
  state.cards = cards;
  state.cardsById = new Map(cards.map((card) => [card.id, card]));
}

/** Reloads the game rules (an admin changed the prices, the odds or the daily reward). */
export async function refreshMeta() {
  state.meta = await api('/meta');
  emit();
}

// ── Account ──────────────────────────────────────────────────────────────────

function legacyPlayerId() {
  try {
    return localStorage.getItem(LEGACY_PLAYER_KEY);
  } catch {
    return null;
  }
}

function forgetLegacyPlayer() {
  try {
    localStorage.removeItem(LEGACY_PLAYER_KEY);
  } catch {
    /* nothing stored */
  }
}

export const hasLegacyPlayer = () => Boolean(legacyPlayerId());

async function signedIn(player) {
  setPlayer(player);
  await refreshCollection();
  return player;
}

/** The player of the current session, or null when logged out. */
export async function restoreSession() {
  const { player } = await api('/auth/me');
  return player ? signedIn(player) : null;
}

export async function login(email, password) {
  const { player } = await api('/auth/login', { method: 'POST', body: { email, password } });
  return signedIn(player);
}

export async function register({ email, password, name }) {
  const body = { email, password, ...(name ? { name } : {}) };
  const legacy = legacyPlayerId();
  if (legacy) body.claimPlayerId = legacy;
  const { player } = await api('/auth/register', { method: 'POST', body });
  forgetLegacyPlayer();
  return signedIn(player);
}

export async function logout() {
  try {
    await api('/auth/logout', { method: 'POST' });
  } finally {
    state.player = null;
    state.owned = new Map();
  }
}

export const changePassword = (currentPassword, newPassword) =>
  api('/auth/password', { method: 'POST', body: { currentPassword, newPassword } });

// ── Collection ───────────────────────────────────────────────────────────────

const playerPath = (suffix = '') => `/players/${encodeURIComponent(state.player.id)}${suffix}`;

async function refreshCollection() {
  const collection = await api(playerPath('/collection'));
  state.owned = new Map(collection.cards.map((entry) => [entry.cardId, entry]));
  emit();
}

export async function reloadPlayer() {
  setPlayer(await api(playerPath()));
  emit();
  return state.player;
}

/** Adds the cards of boosters just opened to your collection. */
function addPulls(boosters) {
  for (const booster of boosters) {
    for (const card of booster.cards) {
      const entry = state.owned.get(card.id);
      if (entry) {
        entry.count += 1;
        entry.lastPulledAt = booster.openedAt;
      } else {
        state.owned.set(card.id, {
          cardId: card.id,
          count: 1,
          firstPulledAt: booster.openedAt,
          lastPulledAt: booster.openedAt,
        });
      }
    }
  }
  emit();
}

/** Opens `count` boosters of a set from its stock. Returns the boosters (cards in reveal order, with isNew). */
export async function openBoosters(setId, count = 1) {
  const result = await api(playerPath('/boosters'), { method: 'POST', body: { setId, count } });
  setPlayer(result.player);
  addPulls(result.boosters);
  return result.boosters;
}

// ── Daily reward ─────────────────────────────────────────────────────────────

/** Asks the server about today's daily reward (the day changed, or it was claimed elsewhere). */
export async function refreshDaily() {
  setDaily(await api(playerPath('/daily')));
  emit();
  return dailyStatus();
}

/**
 * Claims today's daily reward: a booster of `setId` (or the Super Booster on its day), opened at once.
 * Returns [booster] (cards in reveal order, with isNew), like openBoosters.
 */
export async function claimDaily(setId) {
  const result = await api(playerPath('/daily'), { method: 'POST', body: { setId } });
  setPlayer(result.player);
  addPulls([result.booster]);
  return [result.booster];
}

// ── Kira market ──────────────────────────────────────────────────────────────

/** { kira, spare: { cardId: duplicates you can recycle } } */
export async function fetchMarket() {
  const market = await api(playerPath('/market'));
  state.player.kira = market.kira;
  emit();
  return market;
}

/**
 * Recycles duplicates into Kira: `cards` = [{ cardId, count }].
 * Returns { recycled, earned, kira, spare } (spare: what is left to recycle).
 */
export async function recycleCards(cards) {
  const result = await api(playerPath('/market/recycle'), { method: 'POST', body: { cards } });
  for (const { cardId, count } of cards) {
    const entry = state.owned.get(cardId);
    if (entry) entry.count -= count;
  }
  setPlayer(result.player);
  emit();
  return result;
}

/**
 * Buys a booster of `setId` with Kira, opened at once. Returns [booster], like openBoosters.
 * The price shown is sent: if an admin changed it since, the server refuses (price_changed).
 */
export async function buyBooster(setId) {
  const result = await api(playerPath('/market/buy'), { method: 'POST', body: { setId, price: priceOf(setId) } });
  setPlayer(result.player);
  addPulls([result.booster]);
  return [result.booster];
}

export async function renamePlayer(name) {
  setPlayer(await api(playerPath(), { method: 'PATCH', body: { name } }));
  emit();
}

export async function resetCollection() {
  const result = await api(playerPath('/collection'), { method: 'DELETE' });
  setPlayer(result.player);
  state.owned = new Map();
  emit();
}

export const fetchHistory = (limit = 12) => api(playerPath(`/boosters?limit=${limit}`));
export const fetchLeaderboard = () => api('/leaderboard?limit=10');

// ── Friends ──────────────────────────────────────────────────────────────────

const friendPath = (id, suffix = '') => playerPath(`/friends/${encodeURIComponent(id)}${suffix}`);

/** { friendCode, friends, incoming, outgoing, ranking, scoring } */
export const fetchFriends = () => api(playerPath('/friends'));
export const addFriend = (code) => api(playerPath('/friends'), { method: 'POST', body: { code } });
export const acceptFriend = (id) => api(friendPath(id, '/accept'), { method: 'POST' });
export const declineFriend = (id) => api(friendPath(id, '/decline'), { method: 'POST' });
export const removeFriend = (id) => api(friendPath(id), { method: 'DELETE' });
export const fetchFriendCollection = (id) => api(friendPath(id, '/collection'));

// ── Trades ───────────────────────────────────────────────────────────────────

const tradePath = (id, suffix = '') => playerPath(`/trades/${encodeURIComponent(id)}${suffix}`);

/** { trades (open, with yourTurn), history, promised: { cardId: copies }, friends } */
export const fetchTrades = () => api(playerPath('/trades'));
export const offerTrade = (friendId, cardId) => api(playerPath('/trades'), { method: 'POST', body: { friendId, cardId } });
export const proposeTrade = (id, cardId) => api(tradePath(id, '/propose'), { method: 'POST', body: { cardId } });
export const declineTrade = (id) => api(tradePath(id, '/decline'), { method: 'POST' });
export const cancelTrade = (id) => api(tradePath(id), { method: 'DELETE' });

/** Swaps the cards: your collection changes. */
export async function acceptTrade(id) {
  const result = await api(tradePath(id, '/accept'), { method: 'POST' });
  setPlayer(result.player);
  await refreshCollection();
  return result;
}

/**
 * Reloads your cards and profile (a friend who accepts a trade changes them).
 * Returns true when your collection changed.
 */
export async function syncCollection() {
  const signature = () => [...state.owned].map(([id, entry]) => `${id}:${entry.count}`).sort().join();
  const before = signature();
  const [player] = await Promise.all([api(playerPath()), refreshCollection()]);
  setPlayer(player);
  emit();
  return signature() !== before;
}

// ── Admin panel (admins only, the server checks it) ──────────────────────────

/** { settings, defaults }: the game settings (see server/settings.js). */
export const fetchAdminSettings = () => api('/admin/settings');

/** Changes some sections of the settings ({ booster, superBooster, market, daily }); the game follows at once. */
export async function saveAdminSettings(sections) {
  const result = await api('/admin/settings', { method: 'PATCH', body: sections });
  await Promise.all([refreshMeta(), refreshDaily()]);
  return result;
}

/** { today, players: [{ id, name, email, friendCode, createdAt, isAdmin, kira, cards, copies, boosters, daily }] } */
export const fetchAdminPlayers = () => api('/admin/players');

const adminPlayerPath = (id, suffix = '') => `/admin/players/${encodeURIComponent(id)}${suffix}`;
export const adminResetDaily = (id) => api(adminPlayerPath(id, '/daily/reset'), { method: 'POST' });
export const adminDailyGift = (id, gift) => api(adminPlayerPath(id, '/daily/gift'), { method: 'POST', body: { super: gift } });
export const adminClearPlayer = (id) => api(adminPlayerPath(id, '/clear'), { method: 'POST' });
export const adminDeletePlayer = (id) => api(adminPlayerPath(id), { method: 'DELETE' });

// ── Notifications ────────────────────────────────────────────────────────────

/** { friendRequests, trades }: friend requests received, trades waiting for your answer. */
export const fetchNotifications = () => api(playerPath('/notifications'));
