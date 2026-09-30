/**
 * Player data storage, using the SQLite engine built into Node.js (node:sqlite).
 * The card catalog itself is static (data/cards.json) and is not stored here.
 */
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomInt, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS players (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    created_at    TEXT NOT NULL,
    email         TEXT,
    password_hash TEXT
  );

  CREATE TABLE IF NOT EXISTS friendships (
    requester_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    addressee_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    status       TEXT NOT NULL CHECK (status IN ('pending', 'accepted')),
    created_at   TEXT NOT NULL,
    responded_at TEXT,
    PRIMARY KEY (requester_id, addressee_id)
  );
  CREATE INDEX IF NOT EXISTS friendships_by_addressee ON friendships (addressee_id, status);

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    player_id  TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS sessions_by_player ON sessions (player_id);

  CREATE TABLE IF NOT EXISTS boosters (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    set_id    TEXT NOT NULL,
    opened_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS boosters_by_player ON boosters (player_id, id);

  CREATE TABLE IF NOT EXISTS pulls (
    booster_id INTEGER NOT NULL REFERENCES boosters(id) ON DELETE CASCADE,
    position   INTEGER NOT NULL,
    player_id  TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    card_id    TEXT NOT NULL,
    rarity     TEXT NOT NULL,
    is_new     INTEGER NOT NULL,
    PRIMARY KEY (booster_id, position)
  );
  CREATE INDEX IF NOT EXISTS pulls_by_player ON pulls (player_id, card_id);
`;

// Friend codes avoid look-alike characters (no I, O, 0, 1).
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newFriendCode = () => Array.from({ length: 6 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');

/** Databases created by older versions get the new columns. */
function migrate(db) {
  const columns = db.prepare('PRAGMA table_info(players)').all().map((column) => column.name);
  if (!columns.includes('email')) db.exec('ALTER TABLE players ADD COLUMN email TEXT');
  if (!columns.includes('password_hash')) db.exec('ALTER TABLE players ADD COLUMN password_hash TEXT');
  if (!columns.includes('friend_code')) db.exec('ALTER TABLE players ADD COLUMN friend_code TEXT');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS players_by_email ON players (email) WHERE email IS NOT NULL');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS players_by_friend_code ON players (friend_code) WHERE friend_code IS NOT NULL');
  const setCode = db.prepare('UPDATE players SET friend_code = ? WHERE id = ?');
  for (const { id } of db.prepare('SELECT id FROM players WHERE friend_code IS NULL').all()) setCode.run(newFriendCode(), id);
}

export function openStore(file) {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec(SCHEMA);
  migrate(db);

  const sql = {
    insertPlayer: db.prepare(
      'INSERT INTO players (id, name, created_at, email, password_hash, friend_code) VALUES (?, ?, ?, ?, ?, ?)',
    ),
    getPlayer: db.prepare('SELECT id, name, email, friend_code AS friendCode, created_at AS createdAt FROM players WHERE id = ?'),
    playerByCode: db.prepare('SELECT id FROM players WHERE friend_code = ?'),
    getLogin: db.prepare('SELECT id, password_hash AS passwordHash FROM players WHERE email = ?'),
    getPasswordHash: db.prepare('SELECT password_hash AS passwordHash FROM players WHERE id = ?'),
    renamePlayer: db.prepare('UPDATE players SET name = ? WHERE id = ?'),
    setPassword: db.prepare('UPDATE players SET password_hash = ? WHERE id = ?'),
    claimPlayer: db.prepare(
      'UPDATE players SET email = ?, password_hash = ?, name = ? WHERE id = ? AND email IS NULL',
    ),
    insertSession: db.prepare('INSERT INTO sessions (token_hash, player_id, created_at, expires_at) VALUES (?, ?, ?, ?)'),
    sessionPlayer: db.prepare(`
      SELECT p.id, p.name, p.email, p.friend_code AS friendCode, p.created_at AS createdAt
      FROM sessions s JOIN players p ON p.id = s.player_id
      WHERE s.token_hash = ? AND s.expires_at > ?`),
    deleteSession: db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
    deleteOtherSessions: db.prepare('DELETE FROM sessions WHERE player_id = ? AND token_hash <> ?'),
    purgeSessions: db.prepare('DELETE FROM sessions WHERE expires_at <= ?'),
    ownedCardIds: db.prepare('SELECT DISTINCT card_id AS cardId FROM pulls WHERE player_id = ?'),
    insertBooster: db.prepare('INSERT INTO boosters (player_id, set_id, opened_at) VALUES (?, ?, ?)'),
    insertPull: db.prepare(
      'INSERT INTO pulls (booster_id, position, player_id, card_id, rarity, is_new) VALUES (?, ?, ?, ?, ?, ?)',
    ),
    collection: db.prepare(`
      SELECT p.card_id AS cardId, COUNT(*) AS count,
             MIN(b.opened_at) AS firstPulledAt, MAX(b.opened_at) AS lastPulledAt
      FROM pulls p JOIN boosters b ON b.id = p.booster_id
      WHERE p.player_id = ?
      GROUP BY p.card_id`),
    boosterCount: db.prepare('SELECT COUNT(*) AS n FROM boosters WHERE player_id = ?'),
    boostersBySet: db.prepare('SELECT set_id AS setId, COUNT(*) AS n FROM boosters WHERE player_id = ? GROUP BY set_id'),
    pullsByRarity: db.prepare('SELECT rarity, COUNT(*) AS n FROM pulls WHERE player_id = ? GROUP BY rarity'),
    recentBoosters: db.prepare(
      'SELECT id, set_id AS setId, opened_at AS openedAt FROM boosters WHERE player_id = ? ORDER BY id DESC LIMIT ?',
    ),
    pullsFromBooster: db.prepare(`
      SELECT booster_id AS boosterId, position, card_id AS cardId, rarity, is_new AS isNew
      FROM pulls WHERE player_id = ? AND booster_id >= ? ORDER BY booster_id, position`),
    deleteBoosters: db.prepare('DELETE FROM boosters WHERE player_id = ?'),
    collectors: db.prepare(`
      SELECT pl.id, pl.name, pl.created_at AS createdAt,
             (SELECT COUNT(*) FROM boosters b WHERE b.player_id = pl.id) AS boostersOpened
      FROM players pl WHERE EXISTS (SELECT 1 FROM pulls pu WHERE pu.player_id = pl.id)`),
    allCollections: db.prepare(
      'SELECT player_id AS playerId, card_id AS cardId, COUNT(*) AS count FROM pulls GROUP BY player_id, card_id',
    ),
    friendship: db.prepare(`
      SELECT requester_id AS requesterId, addressee_id AS addresseeId, status FROM friendships
      WHERE (requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?)`),
    insertFriendship: db.prepare(
      "INSERT INTO friendships (requester_id, addressee_id, status, created_at) VALUES (?, ?, 'pending', ?)",
    ),
    acceptFriendship: db.prepare(
      "UPDATE friendships SET status = 'accepted', responded_at = ? WHERE requester_id = ? AND addressee_id = ? AND status = 'pending'",
    ),
    deleteFriendship: db.prepare(
      'DELETE FROM friendships WHERE (requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?)',
    ),
    friends: db.prepare(`
      SELECT p.id, p.name, p.friend_code AS friendCode, f.responded_at AS since
      FROM friendships f
      JOIN players p ON p.id = CASE WHEN f.requester_id = ? THEN f.addressee_id ELSE f.requester_id END
      WHERE f.status = 'accepted' AND (f.requester_id = ? OR f.addressee_id = ?)
      ORDER BY p.name`),
    incomingRequests: db.prepare(`
      SELECT p.id, p.name, p.friend_code AS friendCode, f.created_at AS sentAt
      FROM friendships f JOIN players p ON p.id = f.requester_id
      WHERE f.addressee_id = ? AND f.status = 'pending' ORDER BY f.created_at DESC`),
    outgoingRequests: db.prepare(`
      SELECT p.id, p.name, p.friend_code AS friendCode, f.created_at AS sentAt
      FROM friendships f JOIN players p ON p.id = f.addressee_id
      WHERE f.requester_id = ? AND f.status = 'pending' ORDER BY f.created_at DESC`),
  };

  let closed = false;

  function transaction(fn) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      db.exec('COMMIT');
      return result;
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }

  const now = () => new Date().toISOString();

  return {
    // ── Players & accounts ───────────────────────────────────────────────────

    /** Creates a player; `email`/`passwordHash` are null for players created before accounts. */
    createPlayer(name, { email = null, passwordHash = null } = {}) {
      for (let attempt = 0; ; attempt++) {
        const player = { id: randomUUID(), name, email, friendCode: newFriendCode(), createdAt: now() };
        try {
          sql.insertPlayer.run(player.id, player.name, player.createdAt, email, passwordHash, player.friendCode);
          return player;
        } catch (err) {
          // Retry on the (very unlikely) friend code collision; anything else is a real error.
          if (!/friend_code/.test(err.message) || attempt >= 5) throw err;
        }
      }
    },

    /** Player id for a friend code ("#K7Q2XM", "k7q2xm"…), or null. */
    findByFriendCode(code) {
      const normalized = String(code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      return sql.playerByCode.get(normalized)?.id ?? null;
    },

    getPlayer(id) {
      const row = sql.getPlayer.get(id);
      return row ? { ...row } : null;
    },

    /** { id, passwordHash } for an e-mail, or null. */
    findLogin(email) {
      const row = sql.getLogin.get(email);
      return row ? { ...row } : null;
    },

    getPasswordHash(playerId) {
      return sql.getPasswordHash.get(playerId)?.passwordHash ?? null;
    },

    setPasswordHash(playerId, passwordHash) {
      sql.setPassword.run(passwordHash, playerId);
    },

    /**
     * Turns a player created before accounts existed (no e-mail yet) into an
     * account, keeping its collection. Returns false if that is not possible.
     */
    claimPlayer(playerId, { name, email, passwordHash }) {
      return Number(sql.claimPlayer.run(email, passwordHash, name, playerId).changes) === 1;
    },

    renamePlayer(id, name) {
      sql.renamePlayer.run(name, id);
      return this.getPlayer(id);
    },

    // ── Sessions ─────────────────────────────────────────────────────────────

    createSession(playerId, tokenHash, days) {
      const created = new Date();
      const expires = new Date(created.getTime() + days * 24 * 3600 * 1000);
      sql.purgeSessions.run(created.toISOString());
      sql.insertSession.run(tokenHash, playerId, created.toISOString(), expires.toISOString());
    },

    /** The player a valid, non-expired session belongs to, or null. */
    sessionPlayer(tokenHash) {
      const row = sql.sessionPlayer.get(tokenHash, now());
      return row ? { ...row } : null;
    },

    deleteSession(tokenHash) {
      sql.deleteSession.run(tokenHash);
    },

    /** Logs the player out everywhere except in the current session. */
    deleteOtherSessions(playerId, keepTokenHash) {
      sql.deleteOtherSessions.run(playerId, keepTokenHash);
    },

    // ── Boosters & collection ────────────────────────────────────────────────

    /**
     * Saves opened boosters. `boosters` is a list of card lists (in reveal order).
     * Returns them with their id and, for each card, whether it is new for the player.
     */
    recordBoosters(playerId, setId, boosters) {
      return transaction(() => {
        const owned = new Set(sql.ownedCardIds.all(playerId).map((row) => row.cardId));
        const openedAt = now();
        return boosters.map((cards) => {
          const boosterId = Number(sql.insertBooster.run(playerId, setId, openedAt).lastInsertRowid);
          const pulls = cards.map((card, index) => {
            const isNew = !owned.has(card.id);
            owned.add(card.id);
            sql.insertPull.run(boosterId, index + 1, playerId, card.id, card.rarity, isNew ? 1 : 0);
            return { card, isNew };
          });
          return { id: boosterId, setId, openedAt, pulls };
        });
      });
    },

    /** [{ cardId, count, firstPulledAt, lastPulledAt }] */
    collection(playerId) {
      return sql.collection.all(playerId).map((row) => ({ ...row }));
    },

    stats(playerId) {
      return {
        boostersOpened: sql.boosterCount.get(playerId).n,
        boostersBySet: Object.fromEntries(sql.boostersBySet.all(playerId).map((row) => [row.setId, row.n])),
        pullsByRarity: Object.fromEntries(sql.pullsByRarity.all(playerId).map((row) => [row.rarity, row.n])),
      };
    },

    /** Latest boosters first: [{ id, setId, openedAt, pulls: [{ cardId, rarity, isNew }] }] */
    history(playerId, limit) {
      const boosters = sql.recentBoosters.all(playerId, limit).map((row) => ({ ...row, pulls: [] }));
      if (boosters.length === 0) return boosters;
      const byId = new Map(boosters.map((booster) => [booster.id, booster]));
      for (const pull of sql.pullsFromBooster.all(playerId, boosters.at(-1).id)) {
        byId.get(pull.boosterId)?.pulls.push({ cardId: pull.cardId, rarity: pull.rarity, isNew: pull.isNew === 1 });
      }
      return boosters;
    },

    resetCollection(playerId) {
      return Number(sql.deleteBoosters.run(playerId).changes);
    },

    /** Players who pulled at least one card: [{ id, name, createdAt, boostersOpened }] */
    collectors() {
      return sql.collectors.all().map((row) => ({ ...row }));
    },

    /** Map(playerId → [{ cardId, count }]) for every player. */
    allCollections() {
      const byPlayer = new Map();
      for (const { playerId, cardId, count } of sql.allCollections.all()) {
        if (!byPlayer.has(playerId)) byPlayer.set(playerId, []);
        byPlayer.get(playerId).push({ cardId, count });
      }
      return byPlayer;
    },

    // ── Friends ──────────────────────────────────────────────────────────────

    /** { requesterId, addresseeId, status } between two players, or null. */
    friendship(a, b) {
      const row = sql.friendship.get(a, b, b, a);
      return row ? { ...row } : null;
    },

    requestFriend(fromId, toId) {
      sql.insertFriendship.run(fromId, toId, now());
    },

    /** Accepts the pending request of `requesterId` to `addresseeId`. False if there is none. */
    acceptFriend(requesterId, addresseeId) {
      return Number(sql.acceptFriendship.run(now(), requesterId, addresseeId).changes) === 1;
    },

    /** Removes a friend, or a request in either direction. False if there was nothing. */
    removeFriendship(a, b) {
      return Number(sql.deleteFriendship.run(a, b, b, a).changes) > 0;
    },

    /** [{ id, name, friendCode, since }] */
    friends(playerId) {
      return sql.friends.all(playerId, playerId, playerId).map((row) => ({ ...row }));
    },

    /** { incoming: [{ id, name, friendCode, sentAt }], outgoing: [...] } */
    friendRequests(playerId) {
      return {
        incoming: sql.incomingRequests.all(playerId).map((row) => ({ ...row })),
        outgoing: sql.outgoingRequests.all(playerId).map((row) => ({ ...row })),
      };
    },

    close() {
      if (closed) return;
      closed = true;
      db.close();
    },
  };
}
