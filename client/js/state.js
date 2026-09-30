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

export const rarityOf = (id) => state.meta.rarities.find((r) => r.id === id);
export const typeOf = (id) => state.meta.types.find((t) => t.id === id);
export const setOf = (id) => state.meta.sets.find((s) => s.id === id);
export const eraOf = (id) => state.meta.eras.find((e) => e.id === id);
export const rarityRank = (id) => state.meta.rarities.findIndex((r) => r.id === id);

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
  state.player = player;
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

export async function refreshCollection() {
  const collection = await api(playerPath('/collection'));
  state.owned = new Map(collection.cards.map((entry) => [entry.cardId, entry]));
  emit();
}

export async function reloadPlayer() {
  state.player = await api(playerPath());
  emit();
  return state.player;
}

/** Opens `count` boosters of a set. Returns the boosters (cards in reveal order, with isNew). */
export async function openBoosters(setId, count = 1) {
  const result = await api(playerPath('/boosters'), { method: 'POST', body: { setId, count } });
  state.player = result.player;
  for (const booster of result.boosters) {
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
  return result.boosters;
}

export async function renamePlayer(name) {
  state.player = await api(playerPath(), { method: 'PATCH', body: { name } });
  emit();
}

export async function resetCollection() {
  const result = await api(playerPath('/collection'), { method: 'DELETE' });
  state.player = result.player;
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
