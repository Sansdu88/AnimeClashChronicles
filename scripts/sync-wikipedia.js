#!/usr/bin/env node
/**
 * npm run sync — builds the card catalog from Wikipedia, in English and French,
 * and saves it in Supabase (table public.cards, needs SUPABASE_SECRET_KEY in .env).
 *
 * For every anime listed in data/anime-list.js it reads, in batches:
 *   ① the English page: intro, short description, picture, French link
 *   ② the page views of the last 60 days
 *   ③ the Japanese title and the number of Wikipedia languages   wikidata.org
 *   ④ the French page: intro and short description    fr.wikipedia.org
 *   ⑤ when an intro does not tell the story, the "Plot"/"Synopsis" section of
 *      the article (one request per article, cached by page revision)
 * Popularity = half page views, half number of Wikipedia languages (as ranks).
 * The most popular anime and manga get the rarest tiers (see RARITIES in
 * server/config.js), whatever their era.
 *
 * Wikimedia allows 10 requests/minute to clients that do not identify
 * themselves, so requests are batched and paced. Set WIKIMEDIA_CONTACT to your
 * e-mail or website to be allowed to go faster.
 *
 * If a page cannot be fetched, the card already in the database is kept.
 *
 *   npm run sync -- --json cards.json   works on a JSON file instead of the database
 *                                        (then: npm run db:import -- cards.json)
 */
import { readFile, writeFile } from 'node:fs/promises';
import { ANIME } from '../data/anime-list.js';
import { ERAS, RARITIES, RARITY_IDS, TYPES, eraForYear } from '../server/config.js';
import {
  buildSummary,
  capitalize,
  cleanJapaneseTitle,
  makeShort,
  plotSentence,
  slugify,
  storyOpening,
  storySection,
  stripQualifier,
  truncate,
} from './text-utils.js';
import { openStore } from './supabase-env.js';

const jsonArg = process.argv.indexOf('--json');
const JSON_FILE = jsonArg >= 0 ? process.argv[jsonArg + 1] : null;
const SITES = { en: 'https://en.wikipedia.org', fr: 'https://fr.wikipedia.org' };
const CONTACT = process.env.WIKIMEDIA_CONTACT?.trim();
const USER_AGENT = `AnimeClashChronicles/1.0 (hobby trading-card game${CONTACT ? `; ${CONTACT}` : ''}) Node.js`;
const MIN_INTERVAL_MS = CONTACT ? 400 : 6500;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const encodeTitle = (title) => encodeURIComponent(title.replaceAll(' ', '_'));

let lastRequestAt = 0;
async function fetchJson(url, attempt = 1) {
  const wait = lastRequestAt + MIN_INTERVAL_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();
  let res;
  try {
    res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    if (attempt >= 4) throw err;
    return fetchJson(url, attempt + 1);
  }
  if ((res.status === 429 || res.status >= 500) && attempt < 5) {
    const seconds = Number(res.headers.get('retry-after')) || 30;
    console.warn(`   … rate limited, waiting ${seconds}s`);
    await sleep(seconds * 1000);
    return fetchJson(url, attempt + 1);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Runs an action API query (following "continue") and returns Map(requested title → page). */
async function queryPages(site, titles, params) {
  const result = new Map();
  const merged = new Map();
  const alias = new Map();
  let cont = {};
  do {
    const query = new URLSearchParams({
      action: 'query',
      format: 'json',
      formatversion: '2',
      redirects: '1',
      ...params,
      ...cont,
      titles: titles.join('|'),
    });
    const data = await fetchJson(`${site}/w/api.php?${query}`);
    for (const { from, to } of [...(data.query?.normalized ?? []), ...(data.query?.redirects ?? [])]) alias.set(from, to);
    for (const page of data.query?.pages ?? []) merged.set(page.title, { ...merged.get(page.title), ...page });
    cont = data.continue ?? null;
  } while (cont);
  for (const title of titles) {
    let current = title;
    for (let hops = 0; hops < 5 && alias.has(current); hops++) current = alias.get(current);
    if (merged.has(current)) result.set(title, merged.get(current));
  }
  return result;
}

/** Removes the "?utm_source=…" tracking parameters the API adds to image URLs. */
function cleanUrl(src) {
  const url = new URL(src);
  for (const key of [...url.searchParams.keys()]) if (key.startsWith('utm_')) url.searchParams.delete(key);
  return url.toString();
}

function toImage(page) {
  if (!page?.thumbnail) return null;
  return {
    src: cleanUrl(page.thumbnail.source),
    width: page.thumbnail.width,
    height: page.thumbnail.height,
    file: page.pageimage ?? null,
    credit: page.pageimage ? `${SITES.en}/wiki/File:${encodeTitle(page.pageimage)}` : null,
  };
}

/** 2 = good card art, 1 = odd shape, 0 = probably a logo, -1 = nothing. */
function imageScore(image) {
  if (!image) return -1;
  if (/logo|wordmark|\.svg$/i.test(image.file ?? image.src)) return 0;
  const ratio = image.width / image.height;
  return ratio > 1.9 || ratio < 0.4 ? 1 : 2;
}

function validateList() {
  const seen = new Set();
  for (const anime of ANIME) {
    if (seen.has(anime.title)) throw new Error(`Duplicate title in anime-list.js: ${anime.title}`);
    seen.add(anime.title);
    if (!TYPES[anime.type]) throw new Error(`Unknown type "${anime.type}" for ${anime.title}`);
    if (!Number.isInteger(anime.year)) throw new Error(`Missing year for ${anime.title}`);
    if (anime.rarity && !RARITY_IDS.includes(anime.rarity)) throw new Error(`Unknown rarity for ${anime.title}`);
  }
}

/** The catalog is read from and saved to Supabase, or to a JSON file with --json. */
function openCatalog() {
  if (!JSON_FILE) return openStore();
  return {
    async loadCatalog() {
      try {
        return JSON.parse(await readFile(JSON_FILE, 'utf8'));
      } catch {
        return { cards: [] };
      }
    },
    async saveCatalog(cards, meta) {
      await writeFile(JSON_FILE, `${JSON.stringify({ ...meta, cards }, null, 2)}\n`);
    },
  };
}

/** The cards already saved, by title of the list. The cards of the events (card.event) are left alone. */
async function loadPrevious(store) {
  const { cards } = await store.loadCatalog();
  return new Map(cards.filter((card) => !card.event).map((card) => [card.source, card]));
}

// ① ───────────────────────────────────────────────────────────────────────────
async function fetchEnglishPages(titles) {
  const pages = new Map();
  for (const group of chunk(titles, 20)) {
    // TextExtracts returns at most 20 intros per request.
    const found = await queryPages(SITES.en, group, {
      prop: 'extracts|pageimages|description|pageprops|info|langlinks',
      exintro: '1',
      explaintext: '1',
      exlimit: '20',
      piprop: 'thumbnail|name',
      pithumbsize: '500',
      pilicense: 'any', // manga covers and posters are "non-free" pictures
      pilimit: '50',
      ppprop: 'wikibase_item|disambiguation',
      inprop: 'url',
      lllang: 'fr',
      lllimit: 'max',
    });
    for (const [title, page] of found) pages.set(title, page);
    process.stdout.write(`   ${pages.size}/${titles.length}\r`);
  }
  return pages;
}

async function fetchImages(titles) {
  const images = new Map();
  for (const group of chunk(titles, 50)) {
    const found = await queryPages(SITES.en, group, {
      prop: 'pageimages',
      piprop: 'thumbnail|name',
      pithumbsize: '500',
      pilicense: 'any',
      pilimit: '50',
    });
    for (const [title, page] of found) images.set(title, toImage(page));
  }
  return images;
}

// ② ───────────────────────────────────────────────────────────────────────────
async function fetchViews(titles) {
  const views = new Map();
  let lastDay = null;
  for (const group of chunk(titles, 50)) {
    const found = await queryPages(SITES.en, group, { prop: 'pageviews', pvipmetric: 'pageviews', pvipdays: '60' });
    for (const [title, page] of found) {
      const days = Object.entries(page.pageviews ?? {});
      views.set(title, days.reduce((sum, [, n]) => sum + (n ?? 0), 0));
      for (const [day] of days) if (!lastDay || day > lastDay) lastDay = day;
    }
  }
  return { views, lastDay };
}

// ③ ───────────────────────────────────────────────────────────────────────────
const NOT_A_LANGUAGE = new Set(['commonswiki', 'specieswiki', 'metawiki', 'mediawikiwiki', 'wikidatawiki', 'sourceswiki', 'simplewiki']);

/** Japanese titles and number of Wikipedia languages, by Wikidata id. */
async function fetchWikidata(ids) {
  const labels = new Map();
  const languages = new Map();
  for (const group of chunk([...new Set(ids)], 50)) {
    const params = new URLSearchParams({
      action: 'wbgetentities',
      format: 'json',
      props: 'labels|sitelinks',
      languages: 'ja',
      ids: group.join('|'),
    });
    const data = await fetchJson(`https://www.wikidata.org/w/api.php?${params}`);
    for (const [id, entity] of Object.entries(data?.entities ?? {})) {
      const label = cleanJapaneseTitle(entity.labels?.ja?.value);
      if (label) labels.set(id, label);
      const wikis = Object.keys(entity.sitelinks ?? {}).filter((site) => site.endsWith('wiki') && !NOT_A_LANGUAGE.has(site));
      languages.set(id, wikis.length);
    }
  }
  return { labels, languages };
}

// ④ ───────────────────────────────────────────────────────────────────────────
async function fetchFrenchPages(titles) {
  const pages = new Map();
  for (const group of chunk(titles, 20)) {
    const found = await queryPages(SITES.fr, group, {
      prop: 'extracts|description|info|pageprops',
      exintro: '1',
      explaintext: '1',
      exlimit: '20',
      inprop: 'url',
      ppprop: 'disambiguation',
    });
    for (const [title, page] of found) {
      if (page.missing || !page.extract || (page.pageprops && 'disambiguation' in page.pageprops)) continue;
      pages.set(title, page);
    }
  }
  return pages;
}

// ⑤ ───────────────────────────────────────────────────────────────────────────
/** The "Plot"/"Synopsis" section of an article ('' if none). */
async function fetchStory(lang, title) {
  const query = new URLSearchParams({
    action: 'query',
    format: 'json',
    formatversion: '2',
    redirects: '1',
    prop: 'extracts',
    explaintext: '1',
    exsectionformat: 'wiki',
    titles: title,
  });
  const data = await fetchJson(`${SITES[lang]}/w/api.php?${query}`);
  return storySection(data.query?.pages?.[0]?.extract ?? '', lang);
}

/** "TV series" → "série TV", "film" → "film"… for the names of cards that share a title. */
function frenchQualifier(qualifier) {
  return qualifier.replace(/TV series/, 'série TV').replace(/^original video animation$/i, 'OAV');
}

/** Card texts in one language: the short text and the long summary. */
function cardTexts(intro, story, lang) {
  let summary = buildSummary(intro);
  const storyParagraph = story?.split('\n')[0];
  if (storyParagraph && summary.length < 500) summary = `${summary}\n\n${truncate(storyParagraph, 1100 - summary.length)}`;
  const short = plotSentence(intro, 200, lang) || storyOpening(story, 200, lang) || makeShort(intro, 200, lang);
  return { short, summary };
}

// Rarity ──────────────────────────────────────────────────────────────────────
/** Sorts the cards from most to least popular: average of the page views rank and the languages rank. */
function sortByPopularity(cards) {
  const percentile = (key) => {
    const sorted = [...cards].sort((a, b) => a[key] - b[key]);
    const result = new Map();
    sorted.forEach((card, i) => {
      // Ties share the rank of their first card.
      const first = sorted.findIndex((other) => other[key] === card[key]);
      result.set(card, cards.length > 1 ? first / (cards.length - 1) : 1);
    });
    return result;
  };
  const views = percentile('views');
  const languages = percentile('languages');
  const score = (card) => (views.get(card) + languages.get(card)) / 2;
  return cards.sort((a, b) => score(b) - score(a) || b.views - a.views || a.name.localeCompare(b.name));
}

/** `group` is sorted from most to least popular. Rarest tiers first, at least one card per tier. */
function assignRarities(group) {
  const tiers = [...RARITIES].reverse();
  let cumulative = 0;
  let index = 0;
  tiers.forEach((tier, t) => {
    cumulative += tier.share;
    const isLast = t === tiers.length - 1;
    const until = isLast ? group.length : Math.max(index + 1, Math.round(group.length * cumulative));
    while (index < until && index < group.length) group[index++].rarity = tier.id;
  });
}

/** "Power level" printed on the card: 9999 for the most popular card, down to 1000. */
function assignPower(group) {
  group.forEach((card, index) => {
    const p = group.length > 1 ? 1 - index / (group.length - 1) : 1;
    card.power = Math.min(9999, Math.round((1000 + 8999 * p) / 10) * 10);
  });
}

// Main ────────────────────────────────────────────────────────────────────────
async function main() {
  validateList();
  const store = openCatalog();
  const previous = await loadPrevious(store);
  if (!CONTACT) console.log('(tip: set WIKIMEDIA_CONTACT=<your e-mail or website> to sync faster)\n');

  console.log(`① Reading ${ANIME.length} English Wikipedia pages…`);
  const pages = await fetchEnglishPages(ANIME.map((anime) => anime.title));
  const valid = new Map();
  for (const anime of ANIME) {
    const page = pages.get(anime.title);
    let problem = null;
    if (!page || page.missing) problem = 'page not found';
    else if (page.pageprops && 'disambiguation' in page.pageprops) problem = 'disambiguation page';
    else if (!page.extract) problem = 'no intro text';
    if (problem) console.warn(`   ✗ ${anime.title}: ${problem}`);
    else valid.set(anime.title, page);
  }

  const extraImageTitles = ANIME.flatMap((anime) => [anime.imagePage ?? []].flat());
  const extraImages = extraImageTitles.length ? await fetchImages(extraImageTitles) : new Map();

  console.log('② Reading page views of the last 60 days…');
  const { views, lastDay } = await fetchViews([...valid.values()].map((page) => page.title));

  console.log('③ Reading Japanese titles and languages from Wikidata…');
  const { labels: japaneseTitles, languages } = await fetchWikidata(
    [...valid.values()].map((page) => page.pageprops?.wikibase_item).filter(Boolean),
  );

  console.log('④ Reading French Wikipedia pages…');
  const frTitleOf = new Map();
  for (const anime of ANIME) {
    const page = valid.get(anime.title);
    const title = anime.frTitle ?? page?.langlinks?.find((link) => link.lang === 'fr')?.title;
    if (title) frTitleOf.set(anime.title, title);
  }
  const frPages = await fetchFrenchPages([...new Set(frTitleOf.values())]);

  // ⑤ Story sections, only for intros that do not tell the story (cached by revision).
  const stories = new Map(); // `${lang}|${source}` → text
  const todo = [];
  for (const anime of ANIME) {
    const prev = previous.get(anime.title);
    const en = valid.get(anime.title);
    const fr = frPages.get(frTitleOf.get(anime.title));
    for (const [lang, page, cached] of [
      ['en', en, prev && { revision: prev.revision, story: prev.storyText }],
      ['fr', fr, prev?.fr && { revision: prev.fr.revision, story: prev.fr.storyText }],
    ]) {
      if (!page || plotSentence(page.extract, 200, lang)) continue;
      if (typeof cached?.story === 'string' && cached.revision === page.lastrevid) stories.set(`${lang}|${anime.title}`, cached.story);
      else todo.push([lang, anime.title, page.title]);
    }
  }
  if (todo.length) {
    const minutes = Math.ceil((todo.length * MIN_INTERVAL_MS) / 60000);
    console.log(`⑤ Reading ${todo.length} "Plot"/"Synopsis" sections (about ${minutes} min)…`);
  }
  for (const [i, [lang, source, title]] of todo.entries()) {
    try {
      stories.set(`${lang}|${source}`, await fetchStory(lang, title));
    } catch (err) {
      console.warn(`   ✗ story of ${title}: ${err.message}`);
    }
    process.stdout.write(`   ${i + 1}/${todo.length}\r`);
  }

  const cards = [];
  for (const anime of ANIME) {
    const page = valid.get(anime.title);
    if (!page) {
      const kept = previous.get(anime.title);
      if (kept) cards.push({ ...kept, languages: kept.languages ?? 1, rarity: null, power: null });
      console.warn(`   ! ${anime.title}: ${kept ? 'kept the previous version' : 'skipped (no data)'}`);
      continue;
    }
    const candidates = [toImage(page), ...[anime.imagePage ?? []].flat().map((title) => extraImages.get(title))];
    const image = candidates.reduce((best, img) => (imageScore(img) > imageScore(best) ? img : best), null);
    const storyEn = stories.get(`en|${anime.title}`) ?? null;
    const name = anime.name ?? stripQualifier(page.title);

    const frPage = frPages.get(frTitleOf.get(anime.title));
    const storyFr = stories.get(`fr|${anime.title}`) ?? null;
    const fr = frPage
      ? {
          name: anime.nameFr ?? stripQualifier(frPage.title),
          description: anime.descriptionFr ?? capitalize(frPage.description ?? ''),
          ...cardTexts(frPage.extract, storyFr, 'fr'),
          url: frPage.fullurl ?? `${SITES.fr}/wiki/${encodeTitle(frPage.title)}`,
          revision: frPage.lastrevid,
          storyText: storyFr,
        }
      : null;

    cards.push({
      id: slugify(name),
      number: 0,
      name,
      nameJa: japaneseTitles.get(page.pageprops?.wikibase_item) ?? null,
      rarity: null,
      type: anime.type,
      year: anime.year,
      era: eraForYear(anime.year),
      power: null,
      views: views.get(page.title) ?? 0,
      languages: languages.get(page.pageprops?.wikibase_item) ?? 1,
      description: page.description ?? '',
      ...cardTexts(page.extract, storyEn, 'en'),
      image,
      wikiTitle: page.title,
      url: page.fullurl ?? `${SITES.en}/wiki/${encodeTitle(page.title)}`,
      fr,
      source: anime.title,
      revision: page.lastrevid,
      storyText: storyEn,
    });
  }

  // Two titles of the list can lead to the same page (redirects), and two pages to the same name.
  const pagesSeen = new Set();
  const ids = new Set();
  for (let i = 0; i < cards.length; i++) {
    const card = cards[i];
    if (pagesSeen.has(card.wikiTitle)) {
      console.warn(`   ! ${card.source}: same page as another title (${card.wikiTitle}), skipped`);
      cards.splice(i--, 1);
      continue;
    }
    pagesSeen.add(card.wikiTitle);
    if (ids.has(card.id)) {
      // Same name as an earlier card (e.g. a manga and its anime): this one gets its
      // Wikipedia qualifier, "One Piece (1999 TV series)" → "One Piece (TV series)".
      const qualifier = card.wikiTitle.match(/\(([^)]+)\)$/)?.[1].replace(/^\d{4}\s+/, '') ?? String(card.year);
      card.name = `${card.name} (${qualifier})`;
      if (card.fr) card.fr.name = `${card.fr.name} (${frenchQualifier(qualifier)})`;
      card.id = slugify(card.name);
    }
    if (ids.has(card.id)) throw new Error(`Two cards have the id "${card.id}"`);
    ids.add(card.id);
  }

  // No usable picture: the picture of the card with the same name (the anime takes the manga's cover).
  const baseOf = (card) => stripQualifier(card.wikiTitle).toLowerCase();
  for (const card of cards.filter((c) => !c.image)) {
    card.image = cards.find((other) => other !== card && other.image && baseOf(other) === baseOf(card))?.image ?? null;
  }

  const byPopularity = sortByPopularity(cards);
  assignRarities(byPopularity);
  assignPower(byPopularity);
  for (const card of cards) {
    const forced = ANIME.find((anime) => anime.title === card.source)?.rarity;
    if (forced) card.rarity = forced;
  }

  cards.sort((a, b) => a.year - b.year || a.name.localeCompare(b.name));
  cards.forEach((card, i) => {
    card.number = i + 1;
  });

  await store.saveCatalog(cards, {
    generatedAt: new Date().toISOString(),
    popularity: { metric: 'English Wikipedia page views and number of Wikipedia languages', days: 60, until: lastDay },
    license:
      'Card texts come from Wikipedia (CC BY-SA 4.0, https://creativecommons.org/licenses/by-sa/4.0/). ' +
      "Pictures belong to their respective owners, see each picture's file page on Wikipedia.",
  });

  console.log(`\n✔ Saved ${cards.length} cards in ${JSON_FILE ?? 'Supabase'} (${cards.filter((c) => c.fr).length} in French)\n`);
  const table = {};
  for (const era of ERAS) {
    table[era.name] = Object.fromEntries(
      RARITY_IDS.map((id) => [id, cards.filter((c) => c.era === era.id && c.rarity === id).length]),
    );
  }
  console.table(table);
  const noImage = cards.filter((card) => !card.image);
  if (noImage.length) console.warn(`No picture for: ${noImage.map((c) => c.name).join(', ')}`);
  const oddImage = cards.filter((card) => card.image && imageScore(card.image) < 2);
  if (oddImage.length) console.warn(`Check the picture of: ${oddImage.map((c) => c.name).join(', ')}`);
  const noFrench = cards.filter((card) => !card.fr);
  if (noFrench.length) console.warn(`No French page for: ${noFrench.map((c) => c.name).join(', ')}`);
  const noViews = cards.filter((card) => !card.views);
  if (noViews.length) console.warn(`No page views for: ${noViews.map((c) => c.name).join(', ')}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
