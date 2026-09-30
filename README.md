# Anime Clash Chronicles · アニメ・クラッシュ・クロニクル

A manga-style trading card game in the browser: open **a booster of 5 anime cards every 2 minutes**,
Pokémon-TCG style. There are **151 cards**, one per anime, each built from the anime's
**Wikipedia page**: a picture, a short summary, and a **rarity based on how popular the page is**.
Play in **English or French** (the card texts come from the English or the French Wikipedia),
with an **account** (e-mail + password) that keeps your collection.

It is a small full-stack project: a **REST API** (Node.js + Supabase/PostgreSQL) and a **web UI**
(vanilla JavaScript), with **zero dependencies**.

## Quick start: one command

```bash
npm start
```

The game opens in your browser at **http://localhost:3000**. Create an account (e-mail +
password) and start opening boosters. There is nothing to install (no `npm install`, the
project has no dependencies).

- Requirement: **Node.js 22.13 or newer** (developed with Node 24).
- If port 3000 is busy, the server uses the next free port and prints the address.
- Stop with `Ctrl+C`. Your progress is saved in `storage/anime-clash-chronicles.db`.
- Card pictures load from Wikimedia, so you need an internet connection to see them.

## Play online

The game is also published on **GitHub Pages**: https://sansdu88.github.io/AnimeClashChronicles/

GitHub Pages only hosts static files, so the online version runs without the Node.js server:
the game logic runs in the browser ([client/js/local-api.js](client/js/local-api.js)) and your
account and cards are saved in your browser only (so friends can only be added between
accounts created in the same browser). `npm run build:pages` builds this version in
`dist/`, and [.github/workflows/pages.yml](.github/workflows/pages.yml) deploys it at every push
on `main`. The build reads the cards from Supabase: add `SUPABASE_URL` and
`SUPABASE_PUBLISHABLE_KEY` as repository secrets (**Settings → Secrets and variables → Actions**).

## What's inside

| | |
|---|---|
| **Boosters** | 4 boosters: *All-Stars* (every card) and one per Japanese era: *Shōwa* (before 1989), *Heisei* (1989–2018), *Reiwa* (2019+). One booster every 2 minutes: the server enforces the wait and the page shows a countdown. |
| **Opening** | Shake and tear the pack, then flip 5 face-down cards. Rare cards glow before you flip them, and SSR/UR reveals trigger manga effects (ゴゴゴ, ドーン!!), confetti and sounds (synthesized, can be muted). |
| **Cards** | Picture, Japanese title, type (Action, Mecha, Romance…), year, power level, and a one-sentence summary from Wikipedia. SSR and UR are full-art cards with a holographic effect that follows your mouse. |
| **Collection** | A pokédex-style grid: missing cards show up as `???`. Filters, sorting, and completion per rarity. Click a card for its full Wikipedia summary. |
| **Friends** | Every player has a friend code (e.g. `#K7Q2XM`). Send friend requests by code or e-mail, accept or decline them, look at your friends' collections, and compete in the friends ranking. |
| **Stats** | Luck meter (your pulls compared with the official odds), booster history, global leaderboard. |
| **Accounts** | Sign up with an e-mail and a password, log in from any browser, rename yourself, change your password, log out. Several people on the same network can play on one server (see `HOST` below). |
| **Colorblind mode** | The 👁 button (off by default) switches rarities to colors that stay distinct with every kind of color blindness and adds card-game symbols: ● N · ◆ R · ★ SR · ★★ SSR · ★★★ UR. |
| **Languages** | An **EN / FR** switch in the header translates the whole interface, and French cards use their French Wikipedia title and text (*Goldorak*, *Ken le Survivant*, *Capitaine Albator*…). The first visit follows the browser's language. |

## Rarity: how it works

Rarities use gacha tiers: **N → R → SR → SSR → UR**.

- **Card rarity comes from Wikipedia.** Within each era, the anime whose English Wikipedia page
  was read the most (page views over the last 60 days) get the rarest tiers: top 6% → UR,
  next 12% → SSR, next 20% → SR, next 27% → R, the rest → N. The **PWR** number on a card is that
  popularity rank (9999 = the most-read page of its era). Every booster set contains every rarity.
- **Booster odds.** A booster has 5 different cards. Each card rolls its own rarity, and the last
  card is the "rare slot" (never a Normal):

  | Rarity | Cards 1–4 | Card 5 | At least one per booster |
  |---|---|---|---|
  | UR | 1% | 3% | 6.8% |
  | SSR | 4% | 10% | 29.1% (or better) |
  | SR | 10% | 25% | 67.6% (or better) |
  | R | 27% | 62% | guaranteed |
  | N | 58% | — | — |

The rules live in [server/config.js](server/config.js). Change the numbers there to tweak the game.

## Project structure

```
├── package.json            npm start / npm run sync / npm run db:import
├── server/                 REST API (Node.js built-ins only)
│   ├── index.js            entry point: starts the server, opens the browser
│   ├── app.js              HTTP server: /api routes + web UI files
│   ├── api.js              API route handlers
│   ├── auth.js             passwords (scrypt), session tokens, cookies
│   ├── http.js             tiny router, JSON helpers, static file server
│   ├── booster.js          booster opening logic (pure functions)
│   ├── catalog.js          builds the card catalog and booster sets (read from Supabase)
│   ├── supabase-store.js   database access (Supabase REST API): cards, accounts, sessions, boosters, friends
│   └── config.js           rarities, drop rates, types, eras
├── client/                 web UI (HTML/CSS/JS modules, no build step)
│   ├── index.html
│   ├── css/                base, card, booster, views
│   └── js/                 main.js (router), i18n (EN/FR), state, api, components/, views/, ui/
├── data/
│   └── anime-list.js       the 151 anime (input of npm run sync)
├── supabase/
│   └── schema.sql          creates the Supabase tables (run it in the SQL Editor)
├── scripts/
│   ├── sync-wikipedia.js   rebuilds the cards in Supabase from Wikipedia
│   ├── import-cards.js     copies a cards JSON file into Supabase (npm run db:import)
│   ├── supabase-env.js     opens the database for the scripts (.env)
│   └── text-utils.js       picks the summary sentence for each card
```

## Database: Supabase

Everything is stored in a **Supabase** (PostgreSQL) database: the card catalog (`cards`,
`booster_sets`, `catalog_info`) and the players, sessions, boosters and friends.
To set it up (once):

1. In the Supabase dashboard, open **SQL Editor → New query**, paste
   [supabase/schema.sql](supabase/schema.sql) and click **Run** (it creates the tables and the
   booster sets; it can be run again safely, for example after an update).
2. Copy `.env.example` to `.env` and fill in your project URL and keys
   (**Project Settings → API Keys**). `.env` is in `.gitignore`: it is never committed.
3. Fill the cards: `npm run sync` (from Wikipedia), or `npm run db:import` to copy a
   `data/cards.json` file made by an older version. `npm run db:import -- --sql` writes
   `supabase/seed-cards.sql` instead, to paste in the SQL Editor.
4. `npm start` — the startup message shows `Database: Supabase (…)`.

Only the server uses the database, with the **secret** key (it never reaches the browser).
Row Level Security is enabled on every table. The card catalog is public and read-only (the
publishable key can read it, used by the GitHub Pages build); nothing else is readable with
the publishable key.

## Score and rankings

Rankings (between friends, and the global leaderboard) use a **collection score** that grows
with both the number and the rarity of your cards: each different card is worth
**N 10 · R 25 · SR 60 · SSR 150 · UR 400** points, and each extra copy adds 10% of that.
The values are in `SCORE` in [server/config.js](server/config.js).

## Accounts and security

- Passwords are hashed with **scrypt** (random salt) and never stored or returned in clear.
- Logging in creates a **session** (valid 30 days) kept in an `HttpOnly`, `SameSite=Lax` cookie.
  API clients can use the returned token instead: `Authorization: Bearer <token>`. Only a
  SHA-256 hash of each token is stored in the database.
- Player routes only give access to **your own** player (401 when logged out, 403 for someone else).
- **10 failed logins** in 15 minutes for the same e-mail block further attempts for a while (429).
- Requests that change data must be sent as JSON, which stops other websites from submitting
  forms with your session cookie (CSRF).
- Players created by the first version of the game (before accounts) are not lost: signing up
  in the same browser moves their cards to the new account.

## REST API

All routes return JSON. Examples use `curl`; replace `$ID` with your player id and `$TOKEN`
with the token returned by register/login.

| Method | Route | Description |
|---|---|---|
| GET | `/api/health` | Server status |
| GET | `/api/meta` | Rarities (with odds), types, eras, booster sets |
| GET | `/api/cards` | All cards. Filters: `rarity`, `type`, `era`, `set`, `q` (search), `sort` (`number`, `rarity`, `name`, `year`, `power`) |
| GET | `/api/cards/:cardId` | One card |
| GET | `/api/sets` · `/api/sets/:setId` | Booster sets (with their cards) |
| POST | `/api/auth/register` | Create an account. Body: `{ "email", "password", "name"? }` → `{ player, token }` + session cookie |
| POST | `/api/auth/login` | Log in. Body: `{ "email", "password" }` → `{ player, token }` + session cookie |
| POST | `/api/auth/logout` | Log out (ends the session) |
| GET | `/api/auth/me` | The logged-in player (`{ "player": null }` when logged out) |
| POST | `/api/auth/password` | Change password. Body: `{ "currentPassword", "newPassword" }` |
| GET | `/api/players/:playerId` | Profile and stats |
| PATCH | `/api/players/:playerId` | Rename. Body: `{ "name": "…" }` (1–24 characters) |
| POST | `/api/players/:playerId/boosters` | Open a booster. Body: `{ "setId": "all-stars" }`. One every 2 minutes: too early → 429 `booster_cooldown` with `details.retryIn` (seconds). Profiles include `nextBoosterIn` |
| GET | `/api/players/:playerId/boosters?limit=20` | Booster history, newest first |
| GET | `/api/players/:playerId/collection` | Owned cards (with copies) and completion |
| DELETE | `/api/players/:playerId/collection` | Reset the collection |
| GET | `/api/players/:playerId/friends` | Your friend code, friends, requests received/sent and the friends ranking |
| POST | `/api/players/:playerId/friends` | Send a friend request. Body: `{ "code": "#K7Q2XM" }` (a friend code or an e-mail) |
| POST | `/api/players/:playerId/friends/:friendId/accept` | Accept a friend request |
| POST | `/api/players/:playerId/friends/:friendId/decline` | Decline a friend request |
| DELETE | `/api/players/:playerId/friends/:friendId` | Remove a friend, or cancel a request you sent |
| GET | `/api/players/:playerId/friends/:friendId/collection` | A friend's collection (friends only) |
| GET | `/api/leaderboard?limit=10` | Best collectors by score |

Routes under `/api/players/:playerId` require being logged in as that player.

```bash
curl http://localhost:3000/api/cards?rarity=UR
curl -X POST http://localhost:3000/api/auth/register -H "Content-Type: application/json" -d "{\"email\":\"luffy@example.com\",\"password\":\"one-piece-1\"}"
curl -X POST http://localhost:3000/api/players/$ID/boosters -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d "{\"setId\":\"heisei\",\"count\":1}"
```

Every card includes a `fr` object with its French name, texts and Wikipedia link (`null` for
the few anime without a French page).

Opening a booster returns the 5 cards in reveal order (rarest last), each with `isNew: true`
the first time you get it. Errors come back as `{ "error": "message", "code": "…" }` with a 4xx
status (the `code`, e.g. `invalid_credentials`, lets the UI show a translated message).

## Configuration

Optional environment variables for `npm start`:

| Variable | Default | Use |
|---|---|---|
| `PORT` | `3000` | First port to try |
| `HOST` | `127.0.0.1` | Use `0.0.0.0` to let other devices on your network play |
| `NO_OPEN` | *(unset)* | Set to `1` to not open the browser automatically |
| `SUPABASE_URL`, `SUPABASE_SECRET_KEY` | *(required)* | Your Supabase database (usually set in `.env`) |
| `SECURE_COOKIES` | *(unset)* | Set to `1` when the site is served over HTTPS |

In PowerShell: `$env:PORT=4000; npm start`. In bash: `PORT=4000 npm start`.

## Refreshing or adding cards

The card catalog lives in the Supabase table `cards`. To rebuild it from the English and French
Wikipedia (new summaries, pictures, and rarities from the latest page views), then restart the
server:

```bash
npm run sync
```

To **add an anime**, add a line to [data/anime-list.js](data/anime-list.js) (the English
Wikipedia page title, the year of its first anime release, and a type), then run `npm run sync`.

The French page is found automatically through Wikipedia's language links (`frTitle` and
`nameFr` in the list let you override it).

When an intro does not tell the story (common on French Wikipedia), the sync also reads the
article's "Plot"/"Synopsis" section. Wikimedia limits anonymous scripts to 10 requests per
minute, so the first sync takes about 15–20 minutes; later syncs reuse the sections of the
articles that did not change and take a few minutes. Set `WIKIMEDIA_CONTACT` to your e-mail or
website to identify yourself and sync much faster
(`$env:WIKIMEDIA_CONTACT="you@example.com"; npm run sync`).

## Credits

- Card texts come from [Wikipedia](https://en.wikipedia.org) and [Wikipédia](https://fr.wikipedia.org), under the
  [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) license. Each card links to its article.
- Pictures (manga covers, posters) belong to their respective owners. They are displayed from
  Wikimedia's servers and are not included in this project. Each card links to its picture's source page.
- Japanese titles come from [Wikidata](https://www.wikidata.org).
- Fonts: Bangers, Dela Gothic One and Nunito from Google Fonts.

This is a fan-made, non-commercial project.
