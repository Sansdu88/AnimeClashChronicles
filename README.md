# Anime Clash Chronicles

A manga-style trading card game in the browser: open **a booster of 5 anime cards every 2 minutes**
(an All-Stars one every 10 minutes), Pokémon-TCG style, and recycle your duplicates into **Kira ✦**, the
game's money, to buy more. There are **about 3,000 cards**, one per anime or manga, each built from its
**Wikipedia page**: a picture, a short summary, and a **rarity based on how popular it is**.
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
- It needs a Supabase database, set in `.env` (see [Database: Supabase](#database-supabase)).
- Stop with `Ctrl+C`. Your progress is saved in the database.
- Card pictures load from Wikimedia, so you need an internet connection to see them.

## Play online

The game is hosted on **Render**: https://anime-clash-chronicles.onrender.com

[render.yaml](render.yaml) describes the service (Render dashboard → New → Blueprint). Render
redeploys it at every push on `main`; `SUPABASE_URL` and `SUPABASE_SECRET_KEY` are set in the
Render dashboard, never in the repository. The free plan sleeps when unused, so the first visit
can take a minute.

## What's inside

| | |
|---|---|
| **Boosters** | 4 boosters: *All-Stars* (every card) and one per Japanese era: *Shōwa* (before 1989), *Heisei* (1989–2018), *Reiwa* (2019+). Two stocks fill up on their own: the era boosters share one (+1 every 2 minutes) and All-Stars has its own, slower one (+1 every 10 minutes), up to 10 boosters each. Open them one by one, or several in a row with their own show (the packs burst one after the other, then all the cards flip in a cascade). A full stock of 10 gets the **×10 show**: a booster display (like the display boxes of the Pokémon card game) whose seal breaks in 3 taps or with the Skip button, with manga cut-ins of the favorite anime of that booster (Dragon Ball and Akira for Shōwa, One Piece and Naruto for Heisei, Demon Slayer and Jujutsu Kaisen for Reiwa, Pokémon and Sailor Moon for All-Stars…), a different theme per booster and a confetti storm. The server keeps the stocks; the page shows them with a countdown. An empty stock offers to buy a booster with Kira. |
| **Kira market** | Kira (✦) is the money of the game (in Japan, *kira* cards are the shiny ones). Recycle your duplicates for Kira by rarity: you always keep one copy of each card, and the copies promised in open trades. One card at a time or all the duplicates of the rarities you tick; each recycled copy bursts into sparkles that fly to your wallet. Kira buys boosters, opened at once: one, up to 10 in a row, or as many as your Kira pays for (Max); an era booster costs less than All-Stars. Your Kira is in the header. |
| **Daily shop** | At the market, 5 cards picked for everyone, new ones every day at midnight (Paris time): 3 R, 1 SR and 1 SSR, and on Sundays a **UR** instead of the SSR. Buy one copy of each with Kira (R 100 ✦, SR 250 ✦, SSR 600 ✦, UR 1,500 ✦ by default); the Kira flies from the wallet to the card. |
| **Weekly ranking** | On the Stats page: from Monday to Sunday, every card you pull earns points (a new card is worth the points of its rarity, a duplicate 10%). On Sunday at midnight the best players get their reward: 5 Super Boosters for the 1st, 3 for the 2nd, 1 for the 3rd, Kira from the 4th to the 10th (by default). The Super Boosters wait on the player's shelf; the ranking starts again from zero. The weeks are ended by the server (when it starts, every minute and when the ranking is shown), each one only once. |
| **Daily reward** | Once a day, a **free booster of your choice** (one of the 4), opened at once: it does not use the stock. Every 5th daily reward is a **Super Booster**, a booster of every card with much better odds (see below), with its own entrance: it drops in a rainbow halo, charges up and blows. The first visit of the day opens a popup to claim it, then the **Daily** page (a 5-day stamp card with a countdown to the next day) and a badge on its link remind you. Missing a day loses nothing: it is your 5th reward that is the Super Booster, not your 5th day in a row. The day changes at midnight, Paris time (`DAILY.timeZone`). |
| **Events** | Limited-time events that the admins turn on and off from the admin panel (see [Events](#events)). The first one is **Halloween**: a **Halloween Booster** of **100 spooky monsters** of anime and manga (Ryuk, the Titans, Sukuna, Alucard, No-Face, Kitarō…), with only **1 REV**, its own stock (**+1 every 8 hours, 10 at most** by default, so 3 a day) and a full stock of 10 opened with the ×10 show. While it is on, the whole game wears a Halloween theme (a night header, a moon, bats, ghosts and cobwebs) and plays spooky sounds (an organ, thunder, ghosts and a witch's cackle). The booster is not sold at the market; its cards form a collection of their own, in a tab of the collection, and stay in the players' collections when the event ends. |
| **Opening** | Shake and tear the pack, then flip 5 face-down cards. Rare cards glow before you flip them, and SSR/UR reveals trigger manga effects (RUMBLE, BOOM!!), confetti and sounds (synthesized, can be muted; on an iPhone they play in silent mode too while the game's sound is on). A REV card gets its own moment: two heartbeats, then the whole screen turns negative for a few seconds under a giant **REVERSE**. |
| **Cards** | Picture, type (Action, Mecha, Romance…), year, power level, and a one-sentence summary from Wikipedia. SSR, UR and REV are full-art cards with a holographic effect that follows your mouse; REV (Reversed) cards have inverted colors. |
| **Collection** | A pokédex-style grid: missing cards show up as `???`. Filters, sorting, and completion per rarity, 50 or 100 cards per page with page numbers. Click a card for its full Wikipedia summary. |
| **Friends** | Every player has a friend code (e.g. `#K7Q2XM`). Send friend requests by code or e-mail, accept or decline them, look at your friends' collections, and compete in the friends ranking. |
| **Trades** | Offer one copy of a card to a friend: they choose one of their cards to give back (or decline), then you accept the swap (or cancel it). Each player gives one copy: with ×5 you keep ×4, and trading your only copy removes the card from your collection. The picker shows which cards your friend is missing. |
| **Stats** | Weekly ranking, luck meter (your pulls compared with the official odds), booster history, global leaderboard, and a button to replay the tutorial. |
| **Tutorial** | A new player (no booster opened yet) gets a guided tour once, on the Open page: a spotlight goes from the booster stocks to the shelf and each page of the menu, with a speech bubble that explains the goal of the game, the free boosters, the daily reward, the Kira market and its daily shop, the collection, friends, trades, the weekly ranking and the rules (with the live numbers of the admin panel). Computers and phones have their own tour: on a phone it points at the tab bar and opens the **More** sheet. Skip it at any time (Escape works too); the arrow keys go from step to step. Seen once per player in each browser. |
| **Accounts** | Sign up with an e-mail and a password, log in from any browser with your e-mail or your player name (names are unique), rename yourself, change your password, log out. Several people on the same network can play on one server (see `HOST` below). |
| **Colorblind mode** | The 👁 button (off by default) switches rarities to colors that stay distinct with every kind of color blindness and adds card-game symbols: ● N · ◆ R · ★ SR · ★★ SSR · ★★★ UR · ☆☆☆ REV. |
| **Live drops** | A banner under the menu shows the latest drops of the players of the whole world in an endless carousel: the best card of each of the latest boosters, your friends' first, then the rarest, then the newest (at most 2 per player; yours and the admins' are left out). It stops when hovered, and a click shows the card. |
| **Admin panel** | For the admins only (set from the database console, see [Admins](#admins)): the limited-time events (on or off for everyone, and the stock of their booster: one every N hours, M at most), the Kira price of each booster, of a card of the daily shop by rarity and the Kira of a recycled duplicate, the rewards of the weekly ranking (Super Boosters and Kira for each of the 10 first), the daily reward (a Super Booster every N daily rewards, the boosters the players can choose, Super Booster event days for everyone), the rarity odds of the boosters and of the Super Booster. Every change applies at once. A list of all the players with a search bar, to give a player their daily reward back, give them a Super Booster for their next one, clear their data (cards, boosters, Kira, friends, trades, daily rewards; the account stays) or delete them. |
| **Phones** | Below 760px wide, the game looks like an app: a slim bar at the top (logo and Kira), the main pages as tabs at the bottom (Open, Daily, Market, Collection) and a **More** tab whose sheet holds the other pages (Friends, Trades, Stats, Rules, Admin) with their badges, and the settings (language, sound, colorblind mode, name, log out). The two booster stocks sit side by side, and the collection folds its filters behind a button (the search stays). |
| **Languages** | An **EN / FR** switch in the header translates the whole interface, and French cards use their French Wikipedia title and text (*Goldorak*, *Ken le Survivant*, *Capitaine Albator*…). The first visit follows the browser's language. |

## Rarity: how it works

Rarities use gacha tiers: **N → R → SR → SSR → UR → REV**. **REV** (*Reversed*) is the
rarest: full-art cards with inverted colors, about 30 of them in the whole catalog.

- **Card rarity comes from popularity.** Every card gets a popularity score that mixes how much
  its English Wikipedia page was read (page views over the last 60 days) and in how many
  languages Wikipedia covers it (both as ranks, half each). The most popular cards get the
  rarest tiers, whatever their era: top 1% → REV, next 5% → UR, next 12% → SSR, next 20% → SR,
  next 27% → R, the rest → N. The **PWR** number on a card is that popularity rank (9999 = the
  most popular card). When a booster set has no card of the rarity a slot rolled (an era
  without REV cards, for example), that slot rolls again among the rarities the set has.
- **Booster odds.** A booster has 5 different cards. Each card rolls its own rarity, and the last
  card is the "rare slot" (never a Normal):

  | Rarity | Cards 1–4 | Card 5 | At least one per booster |
  |---|---|---|---|
  | REV | 0.1% | 0.5% | 0.9% |
  | UR | 0.9% | 2.5% | 6.8% (or better) |
  | SSR | 4% | 10% | 29.1% (or better) |
  | SR | 10% | 25% | 67.6% (or better) |
  | R | 27% | 62% | guaranteed |
  | N | 58% | — | — |

- **Super Booster** (every 5th daily reward). Every card can drop, none is a Normal, and the last
  card is SSR or better:

  | Rarity | Cards 1–4 | Card 5 | At least one per booster |
  |---|---|---|---|
  | REV | 1% | 5% | 8.7% |
  | UR | 5% | 25% | 45.3% (or better) |
  | SSR | 14% | 70% | guaranteed |
  | SR | 30% | — | guaranteed |
  | R | 50% | — | guaranteed |

The rules live in [server/config.js](server/config.js) (`BOOSTER`, `DAILY`, `SUPER_BOOSTER`): these are the
defaults. The admins change the odds, the Kira prices and values and the daily reward from the admin panel
(saved in the table `game_settings`), and the game follows at once.

## Project structure

```
├── package.json            npm start / npm run sync / npm run db:import
├── server/                 REST API (Node.js built-ins only)
│   ├── index.js            entry point: starts the server, opens the browser
│   ├── app.js              HTTP server: /api routes + web UI files
│   ├── api.js              API route handlers
│   ├── auth.js             passwords (scrypt), session tokens, cookies
│   ├── http.js             tiny router, JSON helpers, static file server
│   ├── booster.js          booster opening logic, booster stock, daily reward day (pure functions)
│   ├── settings.js         the game settings changed from the admin panel (checked, over the defaults)
│   ├── catalog.js          builds the card catalog and booster sets (read from Supabase)
│   ├── supabase-store.js   database access (Supabase REST API): cards, accounts, sessions, boosters, daily rewards, Kira, friends, trades
│   └── config.js           rarities, drop rates, booster stocks, Kira market, daily reward (defaults), types, eras
├── client/                 web UI (HTML/CSS/JS modules, no build step)
│   ├── index.html
│   ├── css/                base, card, booster, views, events (the look of each event)
│   └── js/                 main.js (router), i18n (EN/FR), state, events, api, components/, views/, ui/
├── data/
│   └── anime-list.js       the anime and manga that become cards (input of npm run sync)
├── supabase/
│   ├── config.toml         Supabase CLI / GitHub integration settings
│   └── migrations/         the database: tables, then the card catalog (applied in order)
├── scripts/
│   ├── sync-wikipedia.js   rebuilds the cards in Supabase from Wikipedia
│   ├── import-cards.js     copies a cards JSON file into Supabase (npm run db:import)
│   ├── supabase-env.js     opens the database for the scripts (.env)
│   └── text-utils.js       picks the summary sentence for each card
```

## Database: Supabase

Everything is stored in a **Supabase** (PostgreSQL) database: the card catalog (`cards`,
`booster_sets`, `catalog_info`; the cards and boosters of the events have their `event` column set) and the
players (with their Kira), sessions, boosters, daily rewards, the stocks of the events' boosters (`event_stocks`), friends and trades.
The database is described by the SQL files of [supabase/migrations/](supabase/migrations/): the
tables first, then the card catalog. The project is linked to Supabase with the **GitHub
integration**, which applies new migrations when they are pushed on `main`. Without it, paste the
files in the **SQL Editor** in order.

To run the game locally, copy `.env.example` to `.env` and fill in your project URL and secret
key (**Project Settings → API Keys**), then `npm start`: the startup message shows
`Database: Supabase (…)`. `.env` is in `.gitignore`: it is never committed.

Only the server uses the database, with the **secret** key (it never reaches the browser).
Row Level Security is enabled on every table: the public (publishable) key can only read the
card catalog, nothing else.

## Events

Limited-time events are listed in `EVENTS` in [server/config.js](server/config.js) and turned on and off
from the admin panel (**Limited-time events**), for every player at once: the pages already open follow
within 10 seconds (the notifications check), without a reload. While an event is on:

- its booster has a spotlight on the Open page and a **stock of its own**: one every N hours, M at most
  (8 hours and 10 by default, set from the admin panel). A player starts with a full stock, like the other
  stocks. It has the odds of the other boosters, is not sold at the market and is not a daily reward;
- the website wears the event's **theme** (`html[data-event="…"]`, [client/css/events.css](client/css/events.css))
  and plays its **sounds** (`sfx.theme`, [client/js/ui/sfx.js](client/js/ui/sfx.js));
- its cards form a **collection of their own** (a tab of the Collection page, numbered #001/100): they do not
  change the completion of the main collection (3021 cards) but count in the score and the weekly ranking.
  Players keep them when the event ends, and can recycle and trade them like any card.

Admins can open the booster of an event at any time (their boosters are unlimited), even when it is off,
to try it out before starting it.

**Halloween** ([supabase/migrations/20261004120000_events_halloween.sql](supabase/migrations/20261004120000_events_halloween.sql)):
the Halloween Booster holds 100 spooky monsters of anime and manga. Each card is the Halloween edition of a
card of the catalog (same picture and texts, id `halloween:<card id>`), with the monster of that anime as its
description (*Ryuk, the Shinigami*, *Ken Kaneki, the half-ghoul*…, in English and French). Their rarity follows
the popularity of the anime among the 100, with the shares of the main catalog: **1 REV** (the Titans), 5 UR,
12 SSR, 20 SR, 27 R and 35 N.

To add an event: a line in `EVENTS` (its id, booster set, hours and max), a migration that adds its booster
set and its cards (`booster_sets.event` and `cards.event` set to its id, like the Halloween one), its texts in
[client/js/i18n.js](client/js/i18n.js) (`events.<id>`, `sets.<id>`, `open.stocks.<id>`), its emblem and decor
in [client/js/events.js](client/js/events.js), its look in [client/css/events.css](client/css/events.css), and
optionally its sounds (`THEMES` in sfx.js) and its ×10 show (`SHOWS` in components/booster-show.js).

## Kira market

| Rarity of a duplicate | N | R | SR | SSR | UR | REV |
|---|---|---|---|---|---|---|
| Kira when recycled | 2 | 5 | 12 | 30 | 100 | 400 |

A booster costs **50 Kira** (Shōwa, Heisei, Reiwa) or **120 Kira** (All-Stars). These are the defaults
(`MARKET` in [server/config.js](server/config.js)); the admins change them from the admin panel. The booster
stocks are in `STOCKS`.

## Score and rankings

Rankings (between friends, and the global leaderboard) use a **collection score** that grows
with both the number and the rarity of your cards: each different card is worth
**N 10 · R 25 · SR 60 · SSR 150 · UR 400 · REV 1000** points, and each extra copy adds 10% of that.
The values are in `SCORE` in [server/config.js](server/config.js). Admins are left out of the rankings (both
the global one and the friends one), since they can change the game.

## Admins

An admin sees the **Admin** link in the menu. Admins are chosen in the database only: in the Supabase
**SQL Editor**, run

```sql
update public.players set is_admin = true where email = 'you@example.com';
```

(`false` to remove it), then log in again. The server checks it on every admin call, and the admin tools
never clear nor delete an admin. Admins have unlimited boosters (no waiting for the stocks), and the Super Booster
as a 5th booster of the Open page (POST `/boosters` with `"setId": "super"`, admins only); they are left out
of the rankings and of the live drops. The settings are kept in memory by the server (one instance, as on
Render's free plan) and saved in `game_settings`, read at startup.

## Accounts and security

- Passwords are hashed with **scrypt** (random salt) and never stored or returned in clear.
- Logging in creates a **session** (valid 30 days) kept in an `HttpOnly`, `SameSite=Lax` cookie.
  API clients can use the returned token instead: `Authorization: Bearer <token>`. Only a
  SHA-256 hash of each token is stored in the database.
- Player routes only give access to **your own** player (401 when logged out, 403 for someone else).
- **10 failed logins** in 15 minutes for the same e-mail or player name block further attempts for a while (429).
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
| GET | `/api/meta` | Rarities (with odds), types, eras, booster sets, the booster stocks (`stocks`, the events' on now too) and the events (`events: [{ id, active, hours, max, set }]`) |
| GET | `/api/cards` | All the cards of the main collection. Filters: `rarity`, `type`, `era`, `set`, `q` (search), `sort` (`number`, `rarity`, `name`, `year`, `power`). The cards of an event: `set=<its booster>`, e.g. `?set=halloween` (they have `"event": "halloween"`) |
| GET | `/api/cards/:cardId` | One card |
| GET | `/api/sets` · `/api/sets/:setId` | Booster sets (with their cards) |
| POST | `/api/auth/register` | Create an account. Body: `{ "email", "password", "name"? }` → `{ player, token }` + session cookie. The name is unique whatever the case (taken → 409 `name_taken`) and cannot contain `@` |
| POST | `/api/auth/login` | Log in with the e-mail or the player name. Body: `{ "login", "password" }` (`"email"` instead of `"login"` works too) → `{ player, token }` + session cookie |
| POST | `/api/auth/logout` | Log out (ends the session) |
| GET | `/api/auth/me` | The logged-in player (`{ "player": null }` when logged out) |
| POST | `/api/auth/password` | Change password. Body: `{ "currentPassword", "newPassword" }` |
| GET | `/api/players/:playerId` | Profile and stats |
| PATCH | `/api/players/:playerId` | Rename. Body: `{ "name": "…" }` (1–24 characters, no `@`; taken → 409 `name_taken`) |
| POST | `/api/players/:playerId/boosters` | Open boosters from their stock. Body: `{ "setId": "all-stars", "count": 1 }` (`count` 1–10). The era boosters share a stock (+1 every 2 minutes), All-Stars has its own (+1 every 10 minutes), 10 at most each: not enough → 429 `booster_cooldown` with `details.retryIn` (seconds) and `details.stock`. `"setId": "super"` opens Super Boosters won in the weekly ranking (not enough → 409 `no_super_booster`). The booster of an event (`"setId": "halloween"`) comes from its own stock while the event is on (off → 409 `event_over`; admins can always open it). Profiles include `stocks` (`{ "era": { "stock", "nextIn" }, "all-stars": { … }, "halloween": { … } }` (the events on now), `nextIn` = seconds before the next one, 0 when full), `kira`, `superBoosters` and `lastWeekly` (what you won when the last week ended, or `null`) |
| GET | `/api/players/:playerId/boosters?limit=20` | Booster history, newest first (`kira`: the price of a booster bought at the market) |
| GET | `/api/players/:playerId/market` | `{ kira, spare, shop }`: your Kira, for each card the duplicates you can recycle, and today's daily shop `{ day, nextIn, items: [{ cardId, rarity, price, bought }] }` |
| POST | `/api/players/:playerId/market/shop` | Buy a card of today's daily shop. Body: `{ "cardId": "naruto", "price": 600 }` (`price`: optional, as for boosters). Returns `{ cardId, isNew, kira, shop, player }`. Not in today's shop → 409 `shop_changed`, already bought today → 409 `already_bought`, not enough Kira → 409 `not_enough_kira` |
| POST | `/api/players/:playerId/market/recycle` | Recycle duplicates into Kira. Body: `{ "cards": [{ "cardId": "naruto", "count": 2 }] }` (all of them or none). Returns `{ recycled, earned, kira, spare, player }`. Too many → 409 `not_enough_copies` |
| POST | `/api/players/:playerId/market/buy` | Buy boosters with Kira, opened at once. Body: `{ "setId": "showa", "count": 3, "price": 50 }` (`count`: 1 to 10, 1 by default; `price`: optional, the price of one booster the player saw: if an admin changed it → 409 `price_changed`). Returns `{ boosters, player }`. Not enough Kira for all of them → 409 `not_enough_kira` with `details.price`, `details.total` and `details.kira` |
| GET | `/api/players/:playerId/daily` | Today's daily reward: `{ today, available, claims, day, cycle, super, superReason, choices, nextIn }` (`day` of the cycle, `super` for a Super Booster because of `superReason`: `cycle`, `event` or `gift`, `choices` = the boosters offered, `nextIn` = seconds before the next day). Profiles include it as `daily` |
| POST | `/api/players/:playerId/daily` | Claim today's daily reward, opened at once. Body: `{ "setId": "heisei" }` (ignored on Super Booster days, when `"super"` is accepted). Returns `{ booster, player }`. Already claimed → 409 `daily_claimed` with `details.nextIn` |
| GET | `/api/players/:playerId/collection` | Owned cards (with copies, the events' too) and the completion of the main collection; `byEvent`: `{ "halloween": { owned, total } }` |
| DELETE | `/api/players/:playerId/collection` | Reset the collection (and the Kira) |
| GET | `/api/players/:playerId/friends` | Your friend code, friends, requests received/sent and the friends ranking |
| POST | `/api/players/:playerId/friends` | Send a friend request. Body: `{ "code": "#K7Q2XM" }` (a friend code or an e-mail) |
| POST | `/api/players/:playerId/friends/:friendId/accept` | Accept a friend request |
| POST | `/api/players/:playerId/friends/:friendId/decline` | Decline a friend request |
| DELETE | `/api/players/:playerId/friends/:friendId` | Remove a friend, or cancel a request you sent |
| GET | `/api/players/:playerId/friends/:friendId/collection` | A friend's collection (friends only) |
| GET | `/api/players/:playerId/trades` | Your open trades (`yourTurn` when one waits for your answer), the latest closed ones, the copies promised in open trades and your friends |
| POST | `/api/players/:playerId/trades` | Offer a card to a friend. Body: `{ "friendId", "cardId" }` (a copy not already promised in another trade) |
| POST | `/api/players/:playerId/trades/:tradeId/propose` | The friend chooses the card they give back. Body: `{ "cardId" }` |
| POST | `/api/players/:playerId/trades/:tradeId/accept` | The player who offered accepts: both cards change hands in one transaction |
| POST | `/api/players/:playerId/trades/:tradeId/decline` | The friend declines the trade, or takes back the card they chose |
| DELETE | `/api/players/:playerId/trades/:tradeId` | The player who offered cancels the trade |
| GET | `/api/players/:playerId/notifications` | `{ friendRequests, trades, events }`: friend requests received, trades waiting for your answer and the events on now (the web page checks every 10 seconds for its badges, and follows when an event starts or ends) |
| GET | `/api/leaderboard?limit=10` | Best collectors by score (admins left out) |
| GET | `/api/weekly` | This week's ranking: `{ week, from, to, nextIn, rewards, players, you, last }` (`players`: the ones who get a reward; `you`: your row; `last`: the last week ended and its winners). Admins left out |
| GET | `/api/drops` | The latest drops for the banner: `{ drops: [{ playerName, friend, cardId, rarity, setId, openedAt }] }`, the best card of each of the latest 100 boosters, the logged-in player's friends first, then the rarest, then the newest (12 at most, 2 per player, without the admins nor yourself) |

Routes under `/api/players/:playerId` require being logged in as that player.

Admin routes (an admin's session only, 403 `not_admin` otherwise):

| Method | Route | Description |
|---|---|---|
| GET | `/api/admin/settings` | `{ settings, defaults }`: `{ booster, superBooster: { slotWeights, rareSlotWeights }, market: { prices, recycle, cardPrices }, daily: { superEvery, sets, superDays }, weekly: { rewards: [{ superBoosters, kira }, …] }, events: { halloween: { enabled, hours, max } } }`; odds in thousandths of a percent (each slot adds up to 100000, so 0.001% is the smallest step); `oddsTotal` |
| PATCH | `/api/admin/settings` | Change sections of the settings (each given whole), e.g. `{ "market": { "prices": {…}, "recycle": {…}, "cardPrices": {…} } }`, `{ "weekly": { "rewards": [10 × { "superBoosters", "kira" }] } }` or `{ "events": { "halloween": { "enabled": true, "hours": 8, "max": 10 } } }` (`hours` 1–168, `max` 1–10). Wrong values → 400 `invalid_settings` |
| GET | `/api/admin/players` | Every player with their cards, boosters, Kira and daily reward |
| POST | `/api/admin/players/:id/daily/reset` | The player can claim today's daily reward again |
| POST | `/api/admin/players/:id/daily/gift` | Body: `{ "super": true }`: their next daily reward is a Super Booster (`false` takes it back) |
| POST | `/api/admin/players/:id/clear` | Clear the player's data (the account stays) |
| DELETE | `/api/admin/players/:id` | Delete the player and everything that is theirs |

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
Wikipedia (new summaries, pictures, and rarities from the latest popularity), then restart the
server:

```bash
npm run sync                                    # straight into Supabase (needs .env)
npm run sync -- --json cards.json               # or into a file…
npm run db:import -- cards.json --sql           # …turned into a new migration to push on main
```

To **add an anime or a manga**, add a line to [data/anime-list.js](data/anime-list.js) (the
English Wikipedia page title, the year of its first release, and a type), then sync.

The French page is found automatically through Wikipedia's language links (`frTitle` and
`nameFr` in the list let you override it).

When an intro does not tell the story (common on French Wikipedia), the sync also reads the
article's "Plot"/"Synopsis" section. Wikimedia limits anonymous scripts to 10 requests per
minute, so a sync of the ~3,000 cards takes hours without `WIKIMEDIA_CONTACT`; later syncs reuse
the sections of the articles that did not change. Set `WIKIMEDIA_CONTACT` to your e-mail or
website to identify yourself and sync much faster
(`$env:WIKIMEDIA_CONTACT="you@example.com"; npm run sync`).

## Credits

- Card texts come from [Wikipedia](https://en.wikipedia.org) and [Wikipédia](https://fr.wikipedia.org), under the
  [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) license. Each card links to its article.
- Pictures (manga covers, posters) belong to their respective owners. They are displayed from
  Wikimedia's servers and are not included in this project. Each card links to its picture's source page.
- Fonts: Bangers and Nunito from Google Fonts.

This is a fan-made, non-commercial project.
