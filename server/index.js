/**
 * Entry point: `npm start`
 *
 * Environment variables (all optional):
 *   PORT     first port to try (default 3000, the next free one is used if taken)
 *   HOST     interface to listen on (default 127.0.0.1; use 0.0.0.0 to play on your LAN)
 *   DB_FILE  SQLite file for players and collections (default storage/anime-clash-chronicles.db)
 *   NO_OPEN  set to 1 to not open the browser automatically
 *   SUPABASE_URL, SUPABASE_SECRET_KEY  store the data in Supabase instead of SQLite
 *
 * These can also be written in a .env file at the root of the project (never
 * committed, see .gitignore and .env.example).
 */
import { exec } from 'node:child_process';
import { existsSync, renameSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { loadCatalog } from './catalog.js';
import { openStore } from './db.js';
import { createSupabaseStore } from './supabase-store.js';

try {
  process.loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url)));
} catch {
  /* no .env file: environment variables only */
}

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1';
const DB_FILE = process.env.DB_FILE || fileURLToPath(new URL('../storage/anime-clash-chronicles.db', import.meta.url));
const CLIENT_DIR = fileURLToPath(new URL('../client', import.meta.url));
const MAX_PORT_ATTEMPTS = 10;

function openBrowser(url) {
  if (process.env.NO_OPEN || process.env.CI) return;
  const command =
    process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
  exec(command, () => {}); // not being able to open a browser is fine
}

function listen(server, port, attempt = 1) {
  return new Promise((resolve, reject) => {
    const onError = (err) => {
      server.off('listening', onListening);
      if (err.code === 'EADDRINUSE' && attempt < MAX_PORT_ATTEMPTS) {
        console.log(`  Port ${port} is busy, trying ${port + 1}…`);
        resolve(listen(server, port + 1, attempt + 1));
      } else {
        reject(err);
      }
    };
    const onListening = () => {
      server.off('error', onError);
      resolve(server.address().port);
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, HOST);
  });
}

async function openDatabase() {
  const { SUPABASE_URL, SUPABASE_SECRET_KEY } = process.env;
  if (SUPABASE_URL && SUPABASE_SECRET_KEY) {
    const store = createSupabaseStore({ url: SUPABASE_URL, secretKey: SUPABASE_SECRET_KEY });
    try {
      await store.check();
    } catch (err) {
      console.error(`\n  ✗ Cannot use the Supabase database: ${err.message}`);
      console.error('    Create the tables first: run supabase/schema.sql in the Supabase SQL Editor.\n');
      process.exit(1);
    }
    return { store, label: `Supabase (${new URL(SUPABASE_URL).host})` };
  }

  // Saves made when the project was called "Manga Booster" keep working.
  const OLD_DB_FILE = fileURLToPath(new URL('../storage/manga-booster.db', import.meta.url));
  if (!process.env.DB_FILE && existsSync(OLD_DB_FILE) && !existsSync(DB_FILE)) {
    for (const suffix of ['', '-wal', '-shm']) {
      if (existsSync(OLD_DB_FILE + suffix)) renameSync(OLD_DB_FILE + suffix, DB_FILE + suffix);
    }
  }
  return { store: openStore(DB_FILE), label: 'SQLite (local file)' };
}

const catalog = loadCatalog();
const { store, label: databaseLabel } = await openDatabase();
const server = createApp({ catalog, store, clientDir: CLIENT_DIR });

const port = await listen(server, PORT);
const shownHost = HOST === '0.0.0.0' || HOST === '127.0.0.1' ? 'localhost' : HOST;
const url = `http://${shownHost}:${port}`;

console.log(`
  ═══════════════════════════════════════════
    ANIME CLASH CHRONICLES · アニメ・クラッシュ・クロニクル
  ═══════════════════════════════════════════
  ${catalog.cards.length} cards · ${catalog.sets.length} boosters · data from Wikipedia
  Database: ${databaseLabel}

  ▶ Play:  ${url}
  ▶ API:   ${url}/api/meta

  Press Ctrl+C to stop.
`);
openBrowser(url);

let stopping = false;
function shutdown() {
  if (stopping) return;
  stopping = true;
  console.log('\n  Bye! さようなら 👋');
  server.close();
  server.closeAllConnections?.();
  store.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
