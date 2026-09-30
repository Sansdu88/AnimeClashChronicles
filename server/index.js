/**
 * Entry point: `npm start`
 *
 * Environment variables (usually written in the .env file, never committed —
 * see .gitignore and .env.example):
 *   SUPABASE_URL, SUPABASE_SECRET_KEY  the Supabase database (required)
 *   PORT            first port to try (default 3000, the next free one is used if taken)
 *   HOST            interface to listen on (default 127.0.0.1; 0.0.0.0 on a server)
 *   NO_OPEN         set to 1 to not open the browser automatically
 *   SECURE_COOKIES  set to 1 when the site is served over HTTPS
 */
import { exec } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { createCatalog } from './catalog.js';
import { createSupabaseStore } from './supabase-store.js';

try {
  process.loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url)));
} catch {
  /* no .env file: environment variables only */
}

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1';
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

/** Connects to Supabase, or explains what is missing. */
async function openDatabase() {
  const { SUPABASE_URL, SUPABASE_SECRET_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
    console.error('\n  ✗ No database configured.');
    console.error('    Copy .env.example to .env and fill in SUPABASE_URL and SUPABASE_SECRET_KEY.\n');
    process.exit(1);
  }
  const store = createSupabaseStore({ url: SUPABASE_URL, secretKey: SUPABASE_SECRET_KEY });
  try {
    await store.check();
  } catch (err) {
    console.error(`\n  ✗ Cannot use the Supabase database: ${err.message}`);
    console.error('    Create the tables first: apply the SQL files of supabase/migrations/ (in order).\n');
    process.exit(1);
  }
  return { store, label: `Supabase (${new URL(SUPABASE_URL).host})` };
}

/** The cards and booster sets, read once at startup (restart the server after a sync). */
async function loadCatalog(store) {
  const { cards, sets, meta } = await store.loadCatalog();
  if (cards.length === 0 || sets.length === 0) {
    console.error('\n  ✗ The card catalog is empty in Supabase.');
    console.error('    Apply supabase/migrations/, or run "npm run sync".\n');
    process.exit(1);
  }
  return createCatalog(cards, sets, meta);
}

const { store, label: databaseLabel } = await openDatabase();
const catalog = await loadCatalog(store);
const server = createApp({ catalog, store, clientDir: CLIENT_DIR, secureCookies: process.env.SECURE_COOKIES === '1' });

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
