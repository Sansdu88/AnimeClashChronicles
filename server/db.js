/**
 * Player data storage, using the SQLite engine built into Node.js (node:sqlite).
 * The card catalog itself is static (data/cards.json) and is not stored here.
 */
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS players (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    created_at    TEXT NOT NULL,
    email         TEXT,
    password_hash TEXT
  );

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

/** Databases created before accounts existed get the new columns. */
function migrate(db) {
  const columns = db.prepare('PRAGMA table_info(players)').all().map((column) => column.name);
  if (!columns.includes('email')) db.exec('ALTER TABLE players ADD COLUMN email TEXT');
  if (!columns.includes('password_hash')) db.exec('ALTER TABLE players ADD COLUMN password_hash TEXT');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS players_by_email ON players (email) WHERE email IS NOT NULL');
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
    insertPlayer: db.prepare('INSERT INTO players (id, name, created_at, email, password_hash) VALUES (?, ?, ?, ?, ?)'),
    getPlayer: db.prepare('SELECT id, name, email, created_at AS createdAt FROM players WHERE id = ?'),
    getLogin: db.prepare('SELECT id, password_hash AS passwordHash FROM players WHERE email = ?'),
    getPasswordHash: db.prepare('SELECT password_hash AS passwordHash FROM players WHERE id = ?'),
    renamePlayer: db.prepare('UPDATE players SET name = ? WHERE id = ?'),
    setPassword: db.prepare('UPDATE players SET password_hash = ? WHERE id = ?'),
    claimPlayer: db.prepare(
      'UPDATE players SET email = ?, password_hash = ?, name = ? WHERE id = ? AND email IS NULL',
    ),
    insertSession: db.prepare('INSERT INTO sessions (token_hash, player_id, created_at, expires_at) VALUES (?, ?, ?, ?)'),
    sessionPlayer: db.prepare(`
      SELECT p.id, p.name, p.email, p.created_at AS createdAt
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
    leaderboard: db.prepare(`
      SELECT pl.id, pl.name,
             COUNT(DISTINCT pu.card_id) AS uniqueCards,
             COUNT(*) AS cardsPulled,
             (SELECT COUNT(*) FROM boosters b WHERE b.player_id = pl.id) AS boostersOpened
      FROM players pl JOIN pulls pu ON pu.player_id = pl.id
      GROUP BY pl.id
      ORDER BY uniqueCards DESC, boostersOpened ASC, pl.created_at ASC
      LIMIT ?`),
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
      const player = { id: randomUUID(), name, email, createdAt: now() };
      sql.insertPlayer.run(player.id, player.name, player.createdAt, email, passwordHash);
      return player;
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

    leaderboard(limit) {
      return sql.leaderboard.all(limit).map((row) => ({ ...row }));
    },

    close() {
      if (closed) return;
      closed = true;
      db.close();
    },
  };
}
