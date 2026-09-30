/**
 * Data storage in Supabase (PostgreSQL): the card catalog, and the players'
 * accounts, sessions, boosters, collections and friends. It talks to the Supabase REST API (PostgREST) with
 * fetch and the secret key from .env, so the project has no dependency.
 *
 * The tables are created by supabase/schema.sql.
 */
import { randomInt, randomUUID } from 'node:crypto';
import { cardToRow, rowToCard } from './catalog.js';

// Friend codes avoid look-alike characters (no I, O, 0, 1).
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newFriendCode = () => Array.from({ length: 6 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (value) => typeof value === 'string' && UUID.test(value);

const PLAYER_COLUMNS = 'id,name,email,friend_code,created_at';
const toPlayer = (row) =>
  row ? { id: row.id, name: row.name, email: row.email, friendCode: row.friend_code, createdAt: row.created_at } : null;
const eq = (value) => `eq.${encodeURIComponent(value)}`;
const between = (a, b) => `or=(and(requester_id.eq.${a},addressee_id.eq.${b}),and(requester_id.eq.${b},addressee_id.eq.${a}))`;

export function createSupabaseStore({ url, secretKey }) {
  const base = `${url.replace(/\/+$/, '')}/rest/v1`;

  async function request(method, path, { body, prefer, range } = {}) {
    // New Supabase secret keys go in the "apikey" header only (they are not JWTs).
    const headers = { apikey: secretKey, Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (prefer) headers.Prefer = prefer;
    if (range) headers.Range = range;
    let response;
    try {
      response = await fetch(`${base}/${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      throw new Error(`Supabase cannot be reached (${err.message})`);
    }
    const text = await response.text();
    const data = text ? JSON.parse(text) : null;
    if (!response.ok) {
      const error = new Error(`Supabase: ${data?.message ?? response.statusText}${data?.details ? ` (${data.details})` : ''}`);
      error.code = data?.code;
      throw error;
    }
    return data;
  }

  const get = (path) => request('GET', path);

  /** Every row of a query, page by page (Supabase returns at most 1000 rows per request). */
  async function getAll(path, pageSize = 1000) {
    const rows = [];
    for (let from = 0; ; from += pageSize) {
      const page = await request('GET', path, { range: `${from}-${from + pageSize - 1}` });
      rows.push(...page);
      if (page.length < pageSize) return rows;
    }
  }

  return {
    /** Fails with a clear message if the database is unreachable or the tables are missing. */
    async check() {
      await get('players?select=id&limit=1');
    },

    // ── Card catalog ─────────────────────────────────────────────────────────

    /** { cards, sets, meta }: every card (in number order), the booster sets and the catalog info. */
    async loadCatalog() {
      const [rows, sets, [info]] = await Promise.all([
        getAll('cards?select=*&order=number,id'),
        get('booster_sets?select=id,position,name,jp,tagline,era,colors&order=position'),
        get('catalog_info?select=generated_at,popularity,license'),
      ]);
      return {
        cards: rows.map(rowToCard),
        sets,
        meta: { generatedAt: info?.generated_at ?? null, popularity: info?.popularity ?? null, license: info?.license ?? null },
      };
    },

    /** Adds or updates cards (by id) and the catalog info. Cards that are not given are kept. */
    async saveCatalog(cards, { generatedAt = null, popularity = null, license = null } = {}) {
      const updatedAt = new Date().toISOString();
      for (let i = 0; i < cards.length; i += 50) {
        await request('POST', 'cards?on_conflict=id', {
          body: cards.slice(i, i + 50).map((card) => ({ ...cardToRow(card), updated_at: updatedAt })),
          prefer: 'resolution=merge-duplicates',
        });
      }
      await request('POST', 'catalog_info?on_conflict=id', {
        body: { id: true, generated_at: generatedAt, popularity, license },
        prefer: 'resolution=merge-duplicates',
      });
    },

    // ── Players & accounts ───────────────────────────────────────────────────

    async createPlayer(name, { email = null, passwordHash = null } = {}) {
      for (let attempt = 0; ; attempt++) {
        const row = { id: randomUUID(), name, email, password_hash: passwordHash, friend_code: newFriendCode() };
        try {
          const [created] = await request('POST', `players?select=${PLAYER_COLUMNS}`, { body: row, prefer: 'return=representation' });
          return toPlayer(created);
        } catch (err) {
          // Retry on the (very unlikely) friend code collision; anything else is a real error.
          if (!(err.code === '23505' && /friend_code/.test(err.message)) || attempt >= 5) throw err;
        }
      }
    },

    async getPlayer(id) {
      if (!isUuid(id)) return null;
      const [row] = await get(`players?select=${PLAYER_COLUMNS}&id=${eq(id)}`);
      return toPlayer(row);
    },

    /** { id, passwordHash } for an e-mail, or null. */
    async findLogin(email) {
      const [row] = await get(`players?select=id,password_hash&email=${eq(email)}`);
      return row ? { id: row.id, passwordHash: row.password_hash } : null;
    },

    async getPasswordHash(playerId) {
      const [row] = await get(`players?select=password_hash&id=${eq(playerId)}`);
      return row?.password_hash ?? null;
    },

    async setPasswordHash(playerId, passwordHash) {
      await request('PATCH', `players?id=${eq(playerId)}`, { body: { password_hash: passwordHash } });
    },

    /** Turns a player without e-mail (created before accounts) into an account. */
    async claimPlayer(playerId, { name, email, passwordHash }) {
      if (!isUuid(playerId)) return false;
      const rows = await request('PATCH', `players?id=${eq(playerId)}&email=is.null&select=id`, {
        body: { name, email, password_hash: passwordHash },
        prefer: 'return=representation',
      });
      return rows.length === 1;
    },

    async renamePlayer(id, name) {
      await request('PATCH', `players?id=${eq(id)}`, { body: { name } });
      return this.getPlayer(id);
    },

    /** Player id for a friend code ("#K7Q2XM", "k7q2xm"…), or null. */
    async findByFriendCode(code) {
      const normalized = String(code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (!normalized) return null;
      const [row] = await get(`players?select=id&friend_code=${eq(normalized)}`);
      return row?.id ?? null;
    },

    // ── Sessions ─────────────────────────────────────────────────────────────

    async createSession(playerId, tokenHash, days) {
      const created = new Date();
      const expires = new Date(created.getTime() + days * 24 * 3600 * 1000);
      await request('DELETE', `sessions?expires_at=lte.${encodeURIComponent(created.toISOString())}`);
      await request('POST', 'sessions', {
        body: { token_hash: tokenHash, player_id: playerId, created_at: created.toISOString(), expires_at: expires.toISOString() },
      });
    },

    /** The player a valid, non-expired session belongs to, or null. */
    async sessionPlayer(tokenHash) {
      const now = encodeURIComponent(new Date().toISOString());
      const [row] = await get(`sessions?select=player:players(${PLAYER_COLUMNS})&token_hash=${eq(tokenHash)}&expires_at=gt.${now}`);
      return toPlayer(row?.player);
    },

    async deleteSession(tokenHash) {
      await request('DELETE', `sessions?token_hash=${eq(tokenHash)}`);
    },

    async deleteOtherSessions(playerId, keepTokenHash) {
      await request('DELETE', `sessions?player_id=${eq(playerId)}&token_hash=neq.${encodeURIComponent(keepTokenHash)}`);
    },

    // ── Boosters & collection ────────────────────────────────────────────────

    /** Saves opened boosters in one transaction (function record_boosters of schema.sql). */
    async recordBoosters(playerId, setId, boosters) {
      const saved = await request('POST', 'rpc/record_boosters', {
        body: {
          p_player_id: playerId,
          p_set_id: setId,
          p_boosters: boosters.map((cards) => cards.map((card) => ({ id: card.id, rarity: card.rarity }))),
        },
      });
      return saved.map((booster, i) => ({
        id: booster.id,
        setId,
        openedAt: booster.openedAt,
        pulls: boosters[i].map((card, j) => ({ card, isNew: booster.pulls[j].isNew })),
      }));
    },

    /** [{ cardId, count, firstPulledAt, lastPulledAt }] */
    async collection(playerId) {
      const rows = await get(`player_collection?select=card_id,count,first_pulled_at,last_pulled_at&player_id=${eq(playerId)}`);
      return rows.map((row) => ({
        cardId: row.card_id,
        count: row.count,
        firstPulledAt: row.first_pulled_at,
        lastPulledAt: row.last_pulled_at,
      }));
    },

    async stats(playerId) {
      const [sets, rarities] = await Promise.all([
        get(`player_booster_counts?select=set_id,count&player_id=${eq(playerId)}`),
        get(`player_rarity_counts?select=rarity,count&player_id=${eq(playerId)}`),
      ]);
      return {
        boostersOpened: sets.reduce((sum, row) => sum + row.count, 0),
        boostersBySet: Object.fromEntries(sets.map((row) => [row.set_id, row.count])),
        pullsByRarity: Object.fromEntries(rarities.map((row) => [row.rarity, row.count])),
      };
    },

    /** Latest boosters first: [{ id, setId, openedAt, pulls: [{ cardId, rarity, isNew }] }] */
    async history(playerId, limit) {
      const rows = await get(
        `boosters?select=id,set_id,opened_at,pulls(position,card_id,rarity,is_new)&player_id=${eq(playerId)}` +
          `&order=id.desc&limit=${Number(limit)}&pulls.order=position.asc`,
      );
      return rows.map((booster) => ({
        id: booster.id,
        setId: booster.set_id,
        openedAt: booster.opened_at,
        pulls: booster.pulls.map((pull) => ({ cardId: pull.card_id, rarity: pull.rarity, isNew: pull.is_new })),
      }));
    },

    /** Date (ISO) of the player's last booster, or null. */
    async lastBoosterAt(playerId) {
      const [row] = await get(`boosters?select=opened_at&player_id=${eq(playerId)}&order=id.desc&limit=1`);
      return row?.opened_at ?? null;
    },

    async resetCollection(playerId) {
      const rows = await request('DELETE', `boosters?player_id=${eq(playerId)}&select=id`, { prefer: 'return=representation' });
      return rows.length;
    },

    /** Players who pulled at least one card: [{ id, name, createdAt, boostersOpened }] */
    async collectors() {
      const rows = await getAll('collectors?select=id,name,created_at,boosters_opened&order=id');
      return rows.map((row) => ({ id: row.id, name: row.name, createdAt: row.created_at, boostersOpened: row.boosters_opened }));
    },

    /** Map(playerId → [{ cardId, count }]) for every player. */
    async allCollections() {
      const byPlayer = new Map();
      for (const row of await getAll('player_collection?select=player_id,card_id,count&order=player_id,card_id')) {
        if (!byPlayer.has(row.player_id)) byPlayer.set(row.player_id, []);
        byPlayer.get(row.player_id).push({ cardId: row.card_id, count: row.count });
      }
      return byPlayer;
    },

    // ── Friends ──────────────────────────────────────────────────────────────

    /** { requesterId, addresseeId, status } between two players, or null. */
    async friendship(a, b) {
      if (!isUuid(a) || !isUuid(b)) return null;
      const [row] = await get(`friendships?select=requester_id,addressee_id,status&${between(a, b)}`);
      return row ? { requesterId: row.requester_id, addresseeId: row.addressee_id, status: row.status } : null;
    },

    async requestFriend(fromId, toId) {
      await request('POST', 'friendships', { body: { requester_id: fromId, addressee_id: toId, status: 'pending' } });
    },

    /** Accepts the pending request of `requesterId` to `addresseeId`. False if there is none. */
    async acceptFriend(requesterId, addresseeId) {
      if (!isUuid(requesterId) || !isUuid(addresseeId)) return false;
      const rows = await request(
        'PATCH',
        `friendships?requester_id=${eq(requesterId)}&addressee_id=${eq(addresseeId)}&status=eq.pending&select=status`,
        { body: { status: 'accepted', responded_at: new Date().toISOString() }, prefer: 'return=representation' },
      );
      return rows.length === 1;
    },

    /** Removes a friend, or a request in either direction. False if there was nothing. */
    async removeFriendship(a, b) {
      if (!isUuid(a) || !isUuid(b)) return false;
      const rows = await request('DELETE', `friendships?${between(a, b)}&select=status`, { prefer: 'return=representation' });
      return rows.length > 0;
    },

    /** [{ id, name, friendCode, since }] */
    async friends(playerId) {
      const rows = await get(
        'friendships?select=requester_id,responded_at,' +
          'requester:players!friendships_requester_fk(id,name,friend_code),' +
          'addressee:players!friendships_addressee_fk(id,name,friend_code)' +
          `&status=eq.accepted&or=(requester_id.eq.${playerId},addressee_id.eq.${playerId})`,
      );
      return rows
        .map((row) => {
          const friend = row.requester_id === playerId ? row.addressee : row.requester;
          return { id: friend.id, name: friend.name, friendCode: friend.friend_code, since: row.responded_at };
        })
        .sort((a, b) => a.name.localeCompare(b.name));
    },

    /** { incoming: [{ id, name, friendCode, sentAt }], outgoing: [...] } */
    async friendRequests(playerId) {
      const [incoming, outgoing] = await Promise.all([
        get(
          `friendships?select=created_at,player:players!friendships_requester_fk(id,name,friend_code)` +
            `&addressee_id=${eq(playerId)}&status=eq.pending&order=created_at.desc`,
        ),
        get(
          `friendships?select=created_at,player:players!friendships_addressee_fk(id,name,friend_code)` +
            `&requester_id=${eq(playerId)}&status=eq.pending&order=created_at.desc`,
        ),
      ]);
      const toRequest = (row) => ({ id: row.player.id, name: row.player.name, friendCode: row.player.friend_code, sentAt: row.created_at });
      return { incoming: incoming.map(toRequest), outgoing: outgoing.map(toRequest) };
    },

    close() {
      /* nothing to close: plain HTTP requests */
    },
  };
}
