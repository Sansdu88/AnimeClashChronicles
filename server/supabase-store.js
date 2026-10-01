/**
 * Data storage in Supabase (PostgreSQL): the card catalog, and the players'
 * accounts, sessions, boosters, daily rewards, Kira, collections, friends and the game settings. It talks to the Supabase REST API (PostgREST) with
 * fetch and the secret key from .env, so the project has no dependency.
 *
 * The tables are created by the SQL files of supabase/migrations/.
 */
import { randomInt, randomUUID } from 'node:crypto';
import { cardToRow, rowToCard } from './catalog.js';

// Friend codes avoid look-alike characters (no I, O, 0, 1).
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newFriendCode = () => Array.from({ length: 6 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (value) => typeof value === 'string' && UUID.test(value);

const PLAYER_COLUMNS = 'id,name,email,friend_code,created_at,is_admin';
const toPlayer = (row) =>
  row
    ? { id: row.id, name: row.name, email: row.email, friendCode: row.friend_code, createdAt: row.created_at, isAdmin: row.is_admin === true }
    : null;
const TRADE_COLUMNS =
  'id,status,from_card_id,to_card_id,created_at,proposed_at,closed_at,' +
  'from_player:players!trades_from_fk(id,name,friend_code),to_player:players!trades_to_fk(id,name,friend_code)';
const tradePlayer = (row) => ({ id: row.id, name: row.name, friendCode: row.friend_code });
const toTrade = (row) => ({
  id: row.id,
  status: row.status,
  from: tradePlayer(row.from_player),
  to: tradePlayer(row.to_player),
  fromCardId: row.from_card_id,
  toCardId: row.to_card_id,
  createdAt: row.created_at,
  proposedAt: row.proposed_at,
  closedAt: row.closed_at,
});
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
        get('booster_sets?select=id,position,name,tagline,era,colors&order=position'),
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

    /**
     * Takes the boosters from the player's stock and saves them, in one transaction
     * (function open_boosters, see supabase/migrations/: an All-Stars booster comes from
     * the All-Stars stock, the others from the era stock). Returns the saved boosters,
     * or { error: 'no_booster', stock, nextIn } when the stock is too small.
     */
    async openBoosters(playerId, setId, boosters, { every, max }) {
      const result = await request('POST', 'rpc/open_boosters', {
        body: {
          p_player_id: playerId,
          p_set_id: setId,
          p_boosters: boosters.map((cards) => cards.map((card) => ({ id: card.id, rarity: card.rarity }))),
          p_every: every,
          p_max: max,
        },
      });
      if (result.error) return result;
      return result.boosters.map((booster, i) => ({
        id: booster.id,
        setId,
        openedAt: booster.openedAt,
        pulls: boosters[i].map((card, j) => ({ card, isNew: booster.pulls[j].isNew })),
      }));
    },

    /** Saves boosters without taking them from a stock (admins, function record_boosters). Same result as openBoosters. */
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

    /** Latest boosters first: [{ id, setId, openedAt, kira (paid at the market, or null), pulls: [{ cardId, rarity, isNew }] }] */
    async history(playerId, limit) {
      const rows = await get(
        `boosters?select=id,set_id,opened_at,kira,pulls(position,card_id,rarity,is_new)&player_id=${eq(playerId)}` +
          `&order=id.desc&limit=${Number(limit)}&pulls.order=position.asc`,
      );
      return rows.map((booster) => ({
        id: booster.id,
        setId: booster.set_id,
        openedAt: booster.opened_at,
        kira: booster.kira,
        pulls: booster.pulls.map((pull) => ({ cardId: pull.card_id, rarity: pull.rarity, isNew: pull.is_new })),
      }));
    },

    /**
     * { boostersFrom, starsFrom, kira }: the dates (ISO) the era and the All-Stars stocks count
     * from (null = full, see boosterStock() in booster.js), and the player's Kira.
     */
    async wallet(playerId) {
      const [row] = await get(`players?select=boosters_from,stars_from,kira&id=${eq(playerId)}`);
      return { boostersFrom: row?.boosters_from ?? null, starsFrom: row?.stars_from ?? null, kira: row?.kira ?? 0 };
    },

    /**
     * Recycles duplicates into Kira (function recycle_cards): `cards` = [{ cardId, count, kira }]
     * (kira for one copy), one entry per card. Returns { kira: new balance, recycled, earned },
     * or { error: 'not_enough', id } when a card has fewer duplicates.
     */
    async recycleCards(playerId, cards) {
      return request('POST', 'rpc/recycle_cards', {
        body: { p_player_id: playerId, p_cards: cards.map(({ cardId, count, kira }) => ({ id: cardId, count, kira })) },
      });
    },

    /**
     * Buys a booster of `setId` (its `cards`) for `price` Kira, in one transaction (function
     * buy_booster). Returns the saved booster, or { error: 'no_kira', kira } when the player cannot pay.
     */
    async buyBooster(playerId, setId, cards, price) {
      const result = await request('POST', 'rpc/buy_booster', {
        body: {
          p_player_id: playerId,
          p_set_id: setId,
          p_booster: cards.map((card) => ({ id: card.id, rarity: card.rarity })),
          p_price: price,
        },
      });
      if (result.error) return result;
      const [booster] = result.boosters;
      return {
        id: booster.id,
        setId,
        openedAt: booster.openedAt,
        pulls: cards.map((card, j) => ({ card, isNew: booster.pulls[j].isNew })),
      };
    },

    /**
     * { claims, lastDay, gift }: daily rewards the player claimed, the day ('YYYY-MM-DD') of the
     * last one (null if none), and whether an admin gave them a Super Booster for the next one.
     */
    async dailyClaims(playerId) {
      const [[row], [player]] = await Promise.all([
        get(`player_daily?select=claims,last_day&player_id=${eq(playerId)}`),
        get(`players?select=daily_super&id=${eq(playerId)}`),
      ]);
      return { claims: row?.claims ?? 0, lastDay: row?.last_day ?? null, gift: player?.daily_super === true };
    },

    /** An admin gives (true) or takes back (false) a Super Booster for the player's next daily reward. */
    async setDailyGift(playerId, gift) {
      await request('PATCH', `players?id=${eq(playerId)}`, { body: { daily_super: gift } });
    },

    /** Deletes the daily reward the player claimed on `day`: they can claim it again. False if there was none. */
    async resetDaily(playerId, day) {
      const rows = await request('DELETE', `daily_rewards?player_id=${eq(playerId)}&day=${eq(day)}&select=day`, {
        prefer: 'return=representation',
      });
      return rows.length > 0;
    },

    /**
     * Saves the daily reward `number` of `day` (a booster of `setId`), in one transaction
     * (function claim_daily, see supabase/migrations/). Returns the saved booster, or
     * { error: 'claimed' } when today's reward is already claimed.
     */
    async claimDaily(playerId, { day, number, setId, cards }) {
      const result = await request('POST', 'rpc/claim_daily', {
        body: {
          p_player_id: playerId,
          p_day: day,
          p_number: number,
          p_set_id: setId,
          p_booster: cards.map((card) => ({ id: card.id, rarity: card.rarity })),
        },
      });
      if (result.error) return result;
      const [booster] = result.boosters;
      return {
        id: booster.id,
        setId,
        openedAt: booster.openedAt,
        pulls: cards.map((card, j) => ({ card, isNew: booster.pulls[j].isNew })),
      };
    },

    /** Deletes the player's boosters, traded and recycled cards and Kira, and cancels their open trades (function reset_collection). */
    async resetCollection(playerId) {
      return request('POST', 'rpc/reset_collection', { body: { p_player_id: playerId } });
    },

    /** Copies of one card the player owns (0 if none). */
    async copies(playerId, cardId) {
      const [row] = await get(`player_collection?select=count&player_id=${eq(playerId)}&card_id=${eq(cardId)}`);
      return row?.count ?? 0;
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

    /** Removes a friend, or a request in either direction, and cancels their open trades. False if there was nothing. */
    async removeFriendship(a, b) {
      if (!isUuid(a) || !isUuid(b)) return false;
      const rows = await request('DELETE', `friendships?${between(a, b)}&select=status`, { prefer: 'return=representation' });
      await request(
        'PATCH',
        `trades?or=(and(from_id.eq.${a},to_id.eq.${b}),and(from_id.eq.${b},to_id.eq.${a}))&status=in.(pending,proposed)`,
        { body: { status: 'canceled', closed_at: new Date().toISOString() } },
      );
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

    // ── Trades ───────────────────────────────────────────────────────────────

    /** { open: trades waiting for an answer, closed: the `closedLimit` latest others }, newest first. */
    async trades(playerId, closedLimit) {
      const mine = `select=${TRADE_COLUMNS}&or=(from_id.eq.${playerId},to_id.eq.${playerId})`;
      const [open, closed] = await Promise.all([
        get(`trades?${mine}&status=in.(pending,proposed)&order=id.desc`),
        closedLimit > 0
          ? get(`trades?${mine}&status=in.(accepted,declined,canceled)&order=closed_at.desc&limit=${Number(closedLimit)}`)
          : [],
      ]);
      return { open: open.map(toTrade), closed: closed.map(toTrade) };
    },

    async getTrade(id) {
      const [row] = await get(`trades?select=${TRADE_COLUMNS}&id=eq.${Number(id)}`);
      return row ? toTrade(row) : null;
    },

    /** Returns the new trade's id. */
    async createTrade(fromId, toId, cardId) {
      const [row] = await request('POST', 'trades?select=id', {
        body: { from_id: fromId, to_id: toId, from_card_id: cardId },
        prefer: 'return=representation',
      });
      return row.id;
    },

    /** The friend (`toId`) chooses the card they give back. False if the trade is no longer waiting for it. */
    async proposeTrade(id, toId, cardId) {
      const rows = await request('PATCH', `trades?id=eq.${Number(id)}&to_id=${eq(toId)}&status=eq.pending&select=id`, {
        body: { to_card_id: cardId, status: 'proposed', proposed_at: new Date().toISOString() },
        prefer: 'return=representation',
      });
      return rows.length === 1;
    },

    /**
     * Swaps the two cards (function complete_trade). Returns 'accepted', 'not_found',
     * 'from_card_missing' or 'to_card_missing'.
     */
    async completeTrade(id, fromId) {
      return request('POST', 'rpc/complete_trade', { body: { p_trade_id: Number(id), p_player_id: fromId } });
    },

    /** Numbers for the header badges: friend requests received, trades waiting for the player's answer. */
    async notifications(playerId) {
      const [requests, trades] = await Promise.all([
        get(`friendships?select=requester_id&addressee_id=${eq(playerId)}&status=eq.pending`),
        get(`trades?select=id&or=(and(to_id.eq.${playerId},status.eq.pending),and(from_id.eq.${playerId},status.eq.proposed))`),
      ]);
      return { friendRequests: requests.length, trades: trades.length };
    },

    /** Declines (`side` 'to') or cancels (`side` 'from') an open trade. False if it is not open anymore. */
    async closeTrade(id, side, playerId, status) {
      const rows = await request(
        'PATCH',
        `trades?id=eq.${Number(id)}&${side}_id=${eq(playerId)}&status=in.(pending,proposed)&select=id`,
        { body: { status, closed_at: new Date().toISOString() }, prefer: 'return=representation' },
      );
      return rows.length === 1;
    },

    // ── Game settings & admin tools ──────────────────────────────────────────

    /** The settings saved from the admin panel ({} if none), see server/settings.js. */
    async loadSettings() {
      const [row] = await get('game_settings?select=settings');
      return row?.settings ?? {};
    },

    async saveSettings(settings, playerId) {
      await request('POST', 'game_settings?on_conflict=id', {
        body: { id: true, settings, updated_at: new Date().toISOString(), updated_by: playerId },
        prefer: 'resolution=merge-duplicates',
      });
    },

    /**
     * The latest `limit` boosters opened by anyone, newest first:
     * [{ playerId, playerName, isAdmin, setId, openedAt, pulls: [{ cardId, rarity }] }]
     */
    async recentBoosters(limit) {
      const rows = await get(
        `boosters?select=set_id,opened_at,player:players(id,name,is_admin),pulls(card_id,rarity)&order=id.desc&limit=${Number(limit)}`,
      );
      return rows.map((row) => ({
        playerId: row.player.id,
        playerName: row.player.name,
        isAdmin: row.player.is_admin === true,
        setId: row.set_id,
        openedAt: row.opened_at,
        pulls: row.pulls.map((pull) => ({ cardId: pull.card_id, rarity: pull.rarity })),
      }));
    },

    /** Set of the ids of the admins (left out of the rankings). */
    async adminIds() {
      const rows = await get('players?select=id&is_admin=eq.true');
      return new Set(rows.map((row) => row.id));
    },

    /** Every player, for the admin panel: [{ id, name, email, friendCode, createdAt, isAdmin, kira, dailyGift }] */
    async allPlayers() {
      const rows = await getAll('players?select=id,name,email,friend_code,created_at,is_admin,kira,daily_super&order=created_at');
      return rows.map((row) => ({ ...toPlayer(row), kira: row.kira, dailyGift: row.daily_super }));
    },

    /** Map(playerId → { claims, lastDay }) of every player who claimed a daily reward. */
    async allDailyClaims() {
      const rows = await getAll('player_daily?select=player_id,claims,last_day&order=player_id');
      return new Map(rows.map((row) => [row.player_id, { claims: row.claims, lastDay: row.last_day }]));
    },

    /** Deletes what the player did but keeps the account (function admin_clear_player). Returns the boosters deleted. */
    async clearPlayer(playerId) {
      return request('POST', 'rpc/admin_clear_player', { body: { p_player_id: playerId } });
    },

    /** Deletes the player and everything that is theirs (the tables cascade). False if there was no such player. */
    async deletePlayer(playerId) {
      if (!isUuid(playerId)) return false;
      const rows = await request('DELETE', `players?id=${eq(playerId)}&select=id`, { prefer: 'return=representation' });
      return rows.length === 1;
    },

    close() {
      /* nothing to close: plain HTTP requests */
    },
  };
}
