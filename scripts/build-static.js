#!/usr/bin/env node
/**
 * npm run build:pages — builds dist/, a static version of the game for GitHub
 * Pages (no server: the game logic runs in the browser, see client/js/local-api.js).
 * The cards are read from Supabase: it needs SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY
 * (in .env, or as GitHub repository secrets for the Pages workflow).
 */
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createApi } from '../server/api.js';
import { createCatalog } from '../server/catalog.js';
import { openStore } from './supabase-env.js';

const root = new URL('../', import.meta.url);
const dist = new URL('dist/', root);

rmSync(dist, { recursive: true, force: true });
cpSync(new URL('client/', root), dist, { recursive: true });

// Tells client/js/api.js to use the in-browser API instead of the server.
const indexFile = new URL('index.html', dist);
writeFileSync(
  indexFile,
  readFileSync(indexFile, 'utf8').replace('<meta charset="utf-8">', '<meta charset="utf-8">\n    <meta name="app-mode" content="static">'),
);

// The booster rules are shared with the server.
mkdirSync(new URL('js/shared/', dist), { recursive: true });
cpSync(new URL('server/config.js', root), new URL('js/shared/config.js', dist));
cpSync(new URL('server/booster.js', root), new URL('js/shared/booster.js', dist));

// The answers of GET /api/meta and GET /api/cards, computed by the real API.
const { cards, sets, meta: catalogMeta } = await openStore({ readOnly: true }).loadCatalog();
if (cards.length === 0) throw new Error('The card catalog is empty in Supabase: run "npm run db:import" first.');
const catalog = createCatalog(cards, sets, catalogMeta);
const api = createApi({ catalog, store: null });
const meta = await api.match('GET', '/api/meta').handler({});
mkdirSync(new URL('data/', dist), { recursive: true });
writeFileSync(new URL('data/meta.json', dist), JSON.stringify(meta));
writeFileSync(new URL('data/cards.json', dist), JSON.stringify({ cards: catalog.cards }));

// Serve the files as they are (no Jekyll processing).
writeFileSync(new URL('.nojekyll', dist), '');

console.log(`✔ Static site built in dist/ (${catalog.cards.length} cards)`);
