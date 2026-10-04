/**
 * "Open" page: the booster shelf, the booster stocks and the opening stage
 * (shake → tear → 5 face-down cards → flip them one by one).
 * A player gets an era booster every 2 minutes and an All-Stars one every 10
 * (meta.stocks), and keeps up to 10 of each: several boosters can be opened in a
 * row (the packs burst one after the other, then all the cards flip in a cascade),
 * and a full stock of 10 gets the ×10 show: a giant booster whose seal breaks
 * in 3 taps, with anime cut-ins themed after the set (components/booster-show.js).
 * The daily reward (views/daily.js) and the boosters bought with Kira
 * (views/market.js: one, several or the ×10 show too) open here too, and so do
 * the Super Boosters won in the weekly ranking (views/stats.js), from the shelf.
 * While an event is on (events.js), its booster has a spotlight above the shelf and
 * a stock of its own; it cannot be bought, and its stage wears the event's theme.
 */
import { $, $$, escapeHtml, everySecond, fmt, html, mount, raw, wait } from '../dom.js';
import { cardText, errorText, has, rarityName, setName, setTagline, t, tHtml } from '../i18n.js';
import {
  boosterStock,
  buyBoosters,
  byRarity,
  claimDaily,
  dailyStatus,
  openBoosters,
  priceOf,
  refreshDaily,
  refreshMeta,
  reloadPlayer,
  setOf,
  state,
} from '../state.js';
import { cardBackHTML, cardHTML } from '../components/card.js';
import { openCardModal } from '../components/card-modal.js';
import { clearCutIns, confettiStorm, cutIn, scatterPacks, showFor } from '../components/booster-show.js';
import { RARITY_COLORS, burst, flash, onomatopoeia, reverseWorld, shakeScreen } from '../ui/effects.js';
import { kiraHTML } from '../ui/kira.js';
import { pushLayer } from '../ui/layers.js';
import { sfx } from '../ui/sfx.js';
import { toast } from '../ui/toast.js';
import { EVENT_ICONS, applyEventTheme, eventCards, themeEvent } from '../events.js';

const setCards = (set) => (set.event ? eventCards(set.event) : state.cards.filter((card) => !set.era || card.era === set.era));
const packStyle = (set) => `--c1:${set.colors[0]};--c2:${set.colors[1]}`;
const BIG = new Set(['SSR', 'UR', 'REV']);
const isSuper = (set) => set.id === state.meta.daily.superSet?.id;
/** Sold at the Kira market (the booster of an event is not). */
const isBuyable = (set) => set.id in state.meta.market.prices;

/** The picture of a pack: its set's most popular card, or the 4 most popular ones on the Super Booster. */
function packArtHTML(set) {
  const img = (image) => html`<img src="${image.src}" alt="" loading="lazy" draggable="false">`;
  if (isSuper(set)) {
    const top = state.cards.filter((card) => card.image).sort((a, b) => b.power - a.power).slice(0, 4);
    return html`<span class="pack__art pack__art--mosaic">${top.map((card) => img(card.image))}</span>`;
  }
  return html`<span class="pack__art">${set.featured?.image && img(set.featured.image)}</span>`;
}

export function packHTML(set) {
  const variant = isSuper(set) ? ' pack__inner--super' : set.event ? ` pack__inner--event pack__inner--${set.event}` : '';
  return html`<span class="pack__inner${variant}" style="${packStyle(set)}">
    <span class="pack__crimp pack__crimp--top"></span>
    <span class="pack__body">
      ${set.event && html`<span class="pack__sticker" aria-hidden="true">${EVENT_ICONS[set.event]}</span>`}
      <span class="pack__brand">ANIME CLASH</span>
      ${packArtHTML(set)}
      <span class="pack__name">${setName(set.id)}</span>
      <span class="pack__tagline">${setTagline(set.id)}</span>
      <span class="pack__count">${t('open.cards')}</span>
    </span>
    <span class="pack__crimp pack__crimp--bottom"></span>
    <span class="pack__foil" aria-hidden="true"></span>
  </span>`;
}

/** A pack in two halves, torn apart with the class "is-torn". */
const tearablePackHTML = (set) => html`<span class="stage-pack__half stage-pack__half--top">${packHTML(set)}</span>
  <span class="stage-pack__half stage-pack__half--bottom">${packHTML(set)}</span>`;

/**
 * The stock a set is opened from. The Super Booster has none: the daily reward gives it,
 * and the weekly ranking ('super': the ones won); the admins open it as All-Stars (unlimited).
 */
const stockIdOf = (set) => set.stock ?? (state.player.isAdmin ? 'all-stars' : 'super');

/** Boosters of a set opened at once that get the ×10 show: a full stock (10 for the Super Boosters won). */
const showCount = (set) => state.meta.stocks[stockIdOf(set)]?.stackMax ?? state.meta.booster.maxPerRequest;

function packTileHTML(set) {
  const cards = setCards(set);
  const have = cards.filter((card) => state.owned.has(card.id)).length;
  const buyable = Boolean(set.stock) && isBuyable(set);
  const variant = isSuper(set) ? ' pack-tile--super' : set.event ? ` pack-tile--event pack-tile--${set.event}` : '';
  return html`<div class="pack-tile${variant}" data-set="${set.id}" data-stock="${stockIdOf(set)}">
    <button class="pack" type="button" data-open="${set.id}" data-count="1" aria-label="${t('open.openOne', { set: setName(set.id) })}">${packHTML(set)}</button>
    <div class="pack-tile__progress" title="${t('open.progress', { have, total: cards.length })}">
      <span class="meter"><span class="meter__fill" style="width:${((have / cards.length) * 100).toFixed(1)}%"></span></span>
      <span class="pack-tile__count">${have}/${cards.length}</span>
    </div>
    <div class="pack-tile__actions">
      <button class="btn btn--primary" type="button" data-open="${set.id}" data-count="1">${t('open.open')}</button>
      <button class="btn btn--secondary" type="button" data-open="${set.id}" data-count="many" hidden></button>
      ${buyable && html`<button class="btn btn--kira" type="button" data-buy="${set.id}" hidden
        aria-label="${t('market.buyLabel', { set: setName(set.id), price: priceOf(set.id), count: 1 })}">${t('market.buy')} · ${kiraHTML(priceOf(set.id))}</button>`}
    </div>
    ${isSuper(set) && html`<span class="admin-badge">${state.player.isAdmin ? t('open.adminOnly') : `🏆 ${t('open.superWon', { count: state.player.superBoosters })}`}</span>`}
    ${set.event && !set.stock && html`<span class="admin-badge">${t('open.eventOff')}</span>`}
  </div>`;
}

/**
 * The booster of an event, in the spotlight above the shelf: while the event is on, or for the
 * admins (to try it out before or after: their boosters are unlimited).
 */
function eventSpotHTML(event) {
  const cards = eventCards(event.id);
  const count = (rarity) => cards.filter((card) => card.rarity === rarity).length;
  return html`<section class="event-spot event-spot--${event.id}" aria-labelledby="event-${event.id}">
    <div class="event-spot__text">
      <p class="event-spot__kicker">${EVENT_ICONS[event.id]} ${t(event.active ? 'open.eventLive' : 'open.eventOffTitle')}</p>
      <h2 class="event-spot__title" id="event-${event.id}">${t(`events.${event.id}.title`)}</h2>
      <p class="event-spot__sub">${raw(tHtml(`events.${event.id}.pitch`, { count: cards.length, rev: count('REV'), ur: count('UR') }))}</p>
      <p class="event-spot__rule">⏳ ${t('open.eventStock', { count: event.hours, max: event.max })}</p>
      <p class="event-spot__rule">✦ ${t('open.eventKeep')}</p>
    </div>
    ${packTileHTML(event.set)}
  </section>`;
}

/** A booster stock ('era' or 'all-stars'): its slots fill up one by one. */
function stockHTML(id) {
  const { stackMax: max } = state.meta.stocks[id];
  return html`<div class="stock stock--${id}" role="status" data-stock="${id}">
    <span class="stock__label">${t(`open.stocks.${id}`)}</span>
    <div class="stock__slots" aria-hidden="true">
      ${Array.from({ length: max }, (_, i) => html`<span class="stock__slot" style="--i:${i}"></span>`)}
    </div>
    <p class="stock__text"><b class="stock__count">0</b><span class="stock__max">/${max}</span></p>
    <p class="stock__next"></p>
  </div>`;
}

/**
 * Opens `count` boosters of a set from its stock, or bought with Kira (`source`: { price }):
 * one (a Super Booster blows up on its own), several in a row, or the ×10 show for a full stock.
 */
function startOpening(setId, count, stage, source = null) {
  const set = setOf(setId);
  if (count >= showCount(set)) openTen(setId, count, stage, source);
  else if (count > 1) openMany(setId, count, stage, source);
  else if (isSuper(set)) openSuper(stage);
  else openSingle(setId, stage, source);
}

/** Asks for `count` boosters: from the stock, or bought with Kira (`source`: { price }). */
const askBoosters = (setId, count, source) => (source?.price ? () => buyBoosters(setId, count) : () => openBoosters(setId, count));

/** Text and look of an "Open ×N" button (the full stock gets the ×10 show). */
function paintManyButton(button, count, setId) {
  const special = count >= showCount(setOf(setId));
  button.textContent = special ? t('open.openTen', { count }) : t('open.openMany', { count });
  button.classList.toggle('btn--special', special);
  button.setAttribute('aria-label', t(special ? 'open.openTenLabel' : 'open.openManyLabel', { count, set: setName(setId) }));
}

export function renderOpen(main) {
  const { player, meta } = state;
  // The Super Booster: the admins' (unlimited like their other boosters), or the ones won in the weekly ranking.
  const withSuper = meta.daily.superSet && (player.isAdmin || player.superBoosters > 0);
  const shelf = withSuper ? [...meta.sets, meta.daily.superSet] : meta.sets;
  // The boosters of the events on now (the admins see the others too, to try them out).
  const events = meta.events.filter((event) => event.active || player.isAdmin);
  mount(
    main,
    html`<section class="view view-open">
      <div class="hero">
        <h1 class="hero__title">${t('open.title')}</h1>
        <p class="hero__sub">${raw(
          tHtml('open.sub', {
            era: meta.stocks.era.cooldownSeconds / 60,
            stars: meta.stocks['all-stars'].cooldownSeconds / 60,
            max: meta.stocks.era.stackMax,
          }),
        )}</p>
      </div>
      <div class="stocks">${Object.keys(meta.stocks).map(stockHTML)}</div>
      <a class="daily-banner" href="#/daily" hidden>
        <span class="daily-banner__text"></span>
        <span class="daily-banner__cta">${t('open.dailyClaim')} →</span>
      </a>
      ${events.map(eventSpotHTML)}
      <div class="shelf${shelf.length > 4 ? ' shelf--five' : ''}">${shelf.map(packTileHTML)}</div>
      <p class="open-footer">
        <span>${t('open.collection')} <strong>${player.stats.uniqueCards}/${player.stats.totalCards}</strong>
          (${fmt.percent(player.stats.completion)})</span>
        <span>${t('open.opened')} <strong>${fmt.number(player.stats.boostersOpened)}</strong></span>
        <a class="link" href="#/market">${t('open.market')}</a>
        <a class="link" href="#/rules">${t('open.howRarity')}</a>
      </p>
    </section>`,
  );

  // The shelf and the boosters of the events.
  $('.view-open', main).addEventListener('click', (event) => {
    const buy = event.target.closest('[data-buy]');
    const button = event.target.closest('[data-open]');
    if (!buy && !button) return;
    sfx.play(button && setOf(button.dataset.open)?.event ? 'ghost' : 'click');
    if (buy) {
      openBought(buy.dataset.buy);
      return;
    }
    const { stock } = boosterStock(stockIdOf(setOf(button.dataset.open)));
    startOpening(button.dataset.open, button.dataset.count === 'many' ? Math.min(stock, meta.booster.maxPerRequest) : 1);
  });

  // The stocks fill up while the page is open: slots, countdowns, buttons (an empty
  // stock offers to buy a booster at the market). The daily reward banner shows while
  // it is waiting to be claimed.
  const panels = $$('.stock', main);
  const tiles = $$('.pack-tile', main);
  const banner = $('.daily-banner', main);
  const previous = {};
  everySecond(() => {
    if (!banner.isConnected) return false; // the page was left or redrawn
    const daily = dailyStatus();
    banner.hidden = !daily.available;
    banner.classList.toggle('daily-banner--super', daily.super);
    $('.daily-banner__text', banner).textContent = `🎁 ${t(daily.super ? 'open.dailySuper' : 'open.dailyReady')}`;

    for (const panel of panels) {
      const id = panel.dataset.stock;
      const label = t(`open.stocks.${id}`);
      const { stock, max, every, nextIn, unlimited } = boosterStock(id);
      $$('.stock__slot', panel).forEach((slot, i) => {
        slot.classList.toggle('is-full', i < stock);
        slot.classList.toggle('is-charging', i === stock);
        if (i === stock) slot.style.setProperty('--progress', ((every - nextIn) / every).toFixed(3));
      });
      panel.classList.toggle('is-full', stock >= max && !unlimited);
      panel.classList.toggle('is-unlimited', Boolean(unlimited));
      panel.classList.toggle('is-empty', stock === 0);
      $('.stock__count', panel).textContent = unlimited ? '∞' : stock;
      $('.stock__next', panel).textContent = unlimited
        ? t('open.unlimited')
        : stock >= max
          ? t('open.stockFull')
          : `⏳ ${t('open.nextIn', { time: fmt.duration(nextIn) })}`;
      // Phones show a shorter text (CSS: attr(data-short)).
      $('.stock__next', panel).dataset.short = unlimited
        ? t('open.unlimitedShort')
        : stock >= max
          ? t('open.stockFullShort')
          : `⏳ ${fmt.duration(nextIn)}`;
      // A booster arrived while the player was waiting on this page.
      if (previous[id] !== undefined && stock > previous[id] && !document.querySelector('.stage')) {
        if (previous[id] === 0) {
          sfx.play('R');
          toast(t('open.ready', { stock: label }), 'success');
        } else if (stock >= max) {
          toast(t('open.stockFullToast', { stock: label, max }), 'info');
        }
      }
      previous[id] = stock;
    }

    for (const tile of tiles) {
      const { stock } = boosterStock(tile.dataset.stock);
      for (const button of $$('[data-open]', tile)) button.disabled = stock === 0;
      const many = Math.min(stock, meta.booster.maxPerRequest);
      const manyButton = $('[data-count="many"]', tile);
      manyButton.hidden = many < 2;
      paintManyButton(manyButton, many, tile.dataset.set);
      const buy = $('[data-buy]', tile);
      if (buy) {
        buy.hidden = stock > 0;
        buy.disabled = state.player.kira < priceOf(tile.dataset.set);
      }
    }
    return true;
  });
}

// ── Stage (full-screen overlay) ─────────────────────────────────────────────

function createStage() {
  const element = document.createElement('div');
  element.className = 'stage';
  element.setAttribute('role', 'dialog');
  element.setAttribute('aria-modal', 'true');
  element.setAttribute('aria-label', t('stage.label'));
  element.innerHTML = `
    <div class="stage__lines" aria-hidden="true"></div>
    <button class="stage__close" type="button" aria-label="${escapeHtml(t('common.close'))}">✕</button>
    <div class="stage__content"></div>
    <p class="sr-only" aria-live="assertive"></p>`;
  document.body.append(element);
  document.body.classList.add('has-stage');

  const stage = {
    element,
    content: element.querySelector('.stage__content'),
    run: 0,
    closed: false,
    announce(message) {
      element.querySelector('[aria-live]').textContent = message;
    },
    close() {
      if (stage.closed) return;
      stage.closed = true;
      removeLayer();
      element.classList.add('is-leaving');
      setTimeout(() => element.remove(), 250);
      document.body.classList.remove('has-stage');
      applyEventTheme(); // the sounds of an event's booster were on stage only
      window.dispatchEvent(new CustomEvent('mb:refresh'));
    },
  };
  const removeLayer = pushLayer(() => stage.close());
  element.querySelector('.stage__close').addEventListener('click', () => stage.close());
  // A link to the page already behind the stage does not change the URL (no hashchange): close the stage.
  const route = (hash) => hash.replace(/^#\/?/, '');
  element.addEventListener('click', (event) => {
    const link = event.target.closest('a[href^="#"]');
    if (link && route(link.hash) === route(location.hash)) stage.close();
  });
  return stage;
}

/**
 * The stage takes the colors of the set, and the theme and the sounds of its event (the
 * Halloween booster…), even when an admin tries it out while the event is off.
 */
function dressStage(stage, set) {
  stage.element.style.cssText = packStyle(set);
  if (set.event) stage.element.dataset.event = set.event;
  else delete stage.element.dataset.event;
  sfx.theme = set.event ?? themeEvent();
}

function preloadImages(cards, timeout = 3500) {
  const loads = cards
    .filter((card) => card.image)
    .map(
      (card) =>
        new Promise((resolve) => {
          const img = new Image();
          img.onload = img.onerror = resolve;
          img.src = card.image.src;
        }),
    );
  return Promise.race([Promise.all(loads), wait(timeout)]);
}

const nextClick = (element) => new Promise((resolve) => element.addEventListener('click', resolve, { once: true }));

/**
 * Asks the server for boosters (`ask()`: openBoosters, claimDaily or buyBoosters); a failed request
 * closes the stage (the stock, the Kira or the daily reward is reloaded if it was wrong).
 */
async function requestBoosters(stage, ask, minWait) {
  try {
    const [boosters] = await Promise.all([ask(), wait(minWait)]);
    return boosters;
  } catch (err) {
    toast(errorText(err), 'error');
    if (['booster_cooldown', 'not_enough_kira', 'no_super_booster'].includes(err.code)) reloadPlayer().catch(() => {});
    if (['daily_claimed', 'not_super_day', 'daily_changed'].includes(err.code)) refreshDaily().catch(() => {});
    if (['price_changed', 'event_over'].includes(err.code)) refreshMeta().catch(() => {});
    stage.close();
    return null;
  }
}

/** A "Buy · 50 ✦" button for the stage, for `count` boosters (disabled without enough Kira). */
function buyButtonHTML(set, label = t('market.buy'), count = 1) {
  const price = priceOf(set.id) * count;
  return html`<button class="btn btn--kira btn--big" type="button" data-buy="${set.id}" data-count="${count}" ${state.player.kira < price ? 'disabled' : ''}
    aria-label="${t('market.buyLabel', { set: setName(set.id), price, count })}">${label} · ${kiraHTML(price)}</button>`;
}

/**
 * "Open another" / "Open ×N" buttons at the end of an opening, or a countdown (and
 * a booster to buy with Kira) when the stock is empty. Kept up to date every second while shown.
 */
function nextButtons(slot, set, stage) {
  let shown = null;
  let waited = false;
  everySecond(() => {
    if (!slot.isConnected || stage.closed) return false;
    const { stock, nextIn } = boosterStock(stockIdOf(set));
    // The Super Boosters won do not come back: nothing more to open.
    if (stock === 0 && !set.stock) {
      mount(slot, '');
      if (shown === null) slot.parentElement.querySelector('a')?.focus({ preventScroll: true });
      return false;
    }
    const many = Math.min(stock, state.meta.booster.maxPerRequest);
    const key = stock > 0 ? `stock ${stock}` : `wait ${nextIn}`;
    if (key === shown) return true;
    // Focus the buttons when they first appear, then only if they had it.
    const takeFocus = shown === null || slot.contains(document.activeElement);
    shown = key;
    mount(
      slot,
      stock > 0
        ? html`<button class="btn btn--primary btn--big" type="button" data-again="1">${t('stage.again')}</button>
            ${many >= 2 && html`<button class="btn btn--secondary btn--big" type="button" data-again="${many}"></button>`}`
        : html`<button class="btn btn--primary btn--big" type="button" disabled>⏳ ${t('open.nextIn', { time: fmt.duration(nextIn) })}</button>
            ${isBuyable(set) && buyButtonHTML(set)}`,
    );
    const manyButton = $('[data-again]:not([data-again="1"])', slot);
    if (manyButton) paintManyButton(manyButton, many, set.id);
    if (stock === 0) waited = true;
    else if (waited) {
      waited = false;
      sfx.play('R');
    }
    if (takeFocus) (slot.querySelector('button:not(:disabled)') ?? slot.parentElement.querySelector('a'))?.focus({ preventScroll: true });
    return true;
  });
  slot.onclick = (event) => {
    const count = Number(event.target.closest('[data-again]')?.dataset.again);
    if (count) startOpening(set.id, count, stage);
    if (event.target.closest('[data-buy]')) openSingle(set.id, stage, { price: priceOf(set.id) });
  };
}

// ── Single booster ──────────────────────────────────────────────────────────

/**
 * One booster from its stock, or from `source`: { daily: { day, cycle } } for the
 * daily reward, { price } for a booster bought with Kira. Either is claimed or paid
 * when the pack is torn open (closing the stage before keeps it).
 */
async function openSingle(setId, stage = createStage(), source = null) {
  const set = setOf(setId);
  const run = ++stage.run;
  const stale = () => stage.closed || stage.run !== run;
  stage.element.dataset.phase = 'pack';
  delete stage.element.dataset.show;
  dressStage(stage, set);

  mount(
    stage.content,
    html`<div class="stage-pack-wrap">
      ${source?.daily && html`<div class="stage-intro">
        <p class="mega__title mega__title--small">🎁 ${t('daily.stageTitle')}</p>
        <p class="giant__sub">${t('daily.stageDay', source.daily)}</p>
      </div>`}
      ${source?.price && html`<div class="stage-intro">
        <p class="mega__title mega__title--small">✦ ${t('market.stageTitle')}</p>
        <p class="giant__sub">${t('market.stageSub', { price: source.price })}</p>
      </div>`}
      <button class="stage-pack" type="button" aria-label="${t('stage.tearLabel', { set: setName(set.id) })}">
        ${tearablePackHTML(set)}
      </button>
      <p class="stage__hint bubble">${t('stage.tapPack')}</p>
    </div>`,
  );
  if (source) {
    sfx.play(source.price ? 'coin' : 'R');
    burst(window.innerWidth * 0.1, window.innerHeight * 0.9, { colors: ['#fff', '#ffd23f', ...set.colors], count: 40, power: 1.6 });
    burst(window.innerWidth * 0.9, window.innerHeight * 0.9, { colors: ['#fff', '#ffd23f', ...set.colors], count: 40, power: 1.6 });
  }
  const pack = $('.stage-pack', stage.content);
  pack.focus({ preventScroll: true });
  await nextClick(pack);
  if (stale()) return;

  pack.disabled = true;
  pack.classList.add('is-shaking');
  $('.stage__hint', stage.content).textContent = t('stage.opening');
  sfx.play(set.event ? 'thunder' : 'shake');

  const ask = source?.daily ? () => claimDaily(setId) : askBoosters(setId, 1, source);
  const boosters = await requestBoosters(stage, ask, 650);
  if (!boosters) return;
  const [booster] = boosters;
  await preloadImages(booster.cards);
  if (stale()) return;

  pack.classList.remove('is-shaking');
  pack.classList.add('is-torn');
  sfx.play('tear');
  if (set.event) sfx.play('cackle');
  const box = pack.getBoundingClientRect();
  flash(set.event ? 'rgba(123,44,191,.75)' : 'rgba(255,255,255,.8)', 280);
  onomatopoeia(t(set.event ? `events.${set.event}.tear` : 'fx.tear'), { x: box.left + box.width / 2, y: box.top + box.height * 0.12, color: '#fff', size: 'l' });
  await wait(600);
  if (stale()) return;
  showReveal(stage, set, booster, run, source);
}

/**
 * `source` (see openSingle): the daily reward ends with a link to the shelf, a booster
 * bought with Kira with "Buy another", instead of "Open another".
 */
function showReveal(stage, set, booster, run, source = null) {
  const cards = booster.cards;
  const stale = () => stage.closed || stage.run !== run;
  stage.element.dataset.phase = 'reveal';

  mount(
    stage.content,
    html`<div class="reveal">
      <p class="stage__hint bubble">${t('stage.clickCards')}</p>
      <div class="reveal__row">
        ${cards.map(
          (card, i) => html`<div class="flip" role="button" tabindex="0" data-index="${i}" data-rarity="${card.rarity}"
              style="--i:${i}" aria-label="${t('stage.reveal', { n: i + 1, total: cards.length })}">
            <div class="flip__inner">
              <div class="flip__face flip__back">${cardBackHTML()}</div>
              <div class="flip__face flip__front">${cardHTML(card, { isNew: card.isNew, interactive: false, lazy: false })}</div>
            </div>
          </div>`,
        )}
      </div>
      <div class="reveal__footer">
        <button class="btn btn--ghost-light" type="button" data-action="reveal-all">${t('stage.revealAll')}</button>
      </div>
    </div>`,
  );

  const flips = $$('.flip', stage.content);
  let revealed = 0;

  async function reveal(flip) {
    if (flip.dataset.state) return;
    flip.dataset.state = 'busy';
    const card = cards[Number(flip.dataset.index)];
    if (BIG.has(card.rarity)) {
      flip.classList.add('is-charging');
      if (card.rarity !== 'SSR') sfx.play('charge');
      await wait({ SSR: 500, UR: 950, REV: 1300 }[card.rarity]);
      if (stale()) return;
      flip.classList.remove('is-charging');
    }
    flip.classList.add('is-flipped');
    sfx.play('flip');
    await wait(260);
    if (stale()) return;
    const pause = celebrate(flip.getBoundingClientRect(), card);
    if (card.isNew) flip.classList.add('show-new');
    flip.dataset.state = 'revealed';
    const params = { name: cardText(card).name, rarity: rarityName(card.rarity) };
    flip.setAttribute('aria-label', t('stage.revealed', { ...params, isNew: card.isNew ? t('stage.revealedNew') : '' }));
    stage.announce(t('stage.announce', { ...params, isNew: card.isNew ? t('stage.announceNew') : '' }));
    if (pause) {
      await wait(pause); // the REVERSE moment
      if (stale()) return;
    }
    revealed += 1;
    if (revealed === cards.length) finish();
  }

  async function revealAll() {
    for (const flip of flips) {
      if (stale()) return;
      if (flip.dataset.state) continue;
      await reveal(flip);
      await wait(220);
    }
  }

  function finish() {
    const newCount = cards.filter((card) => card.isNew).length;
    const best = [...cards].sort(byRarity)[0];
    $('.stage__hint', stage.content).textContent = t('stage.clickDetail');
    mount(
      $('.reveal__footer', stage.content),
      html`<p class="reveal__summary">
          ${newCount ? html`<strong class="new-pill">${t('stage.newCards', { count: newCount })}</strong>` : t('stage.noNew')}
          ${t('stage.best')} <strong class="rarity-text r-${best.rarity}">${best.rarity}</strong> ${cardText(best).name}
        </p>
        <div class="btn-row">
          ${source?.daily && html`<a class="btn btn--primary btn--big" href="#/">${t('daily.openStock')}</a>`}
          ${source?.price && html`${buyButtonHTML(set, t('market.buyAnother'))}<a class="btn btn--ghost-light" href="#/market">${t('nav.market')}</a>`}
          ${!source && html`<span class="btn-row" data-slot="next"></span>`}
          <a class="btn btn--ghost-light" href="#/collection">${t('stage.myCollection')}</a>
        </div>`,
    );
    if (!source) nextButtons($('[data-slot="next"]', stage.content), set, stage);
    else ($('.reveal__footer .btn:not(:disabled)', stage.content) ?? $('.reveal__footer a', stage.content)).focus({ preventScroll: true });
  }

  stage.content.onclick = (event) => {
    if (event.target.closest('[data-action="reveal-all"]')) revealAll();
    if (event.target.closest('.reveal__footer [data-buy]')) openSingle(set.id, stage, { price: priceOf(set.id) });
    const flip = event.target.closest('.flip');
    if (!flip) return;
    if (flip.dataset.state === 'revealed') openCardModal(cards[Number(flip.dataset.index)], { list: cards });
    else reveal(flip);
  };
  stage.content.onkeydown = (event) => {
    const flip = event.target.closest?.('.flip');
    if (flip && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      flip.click();
    }
  };
  flips[0].focus({ preventScroll: true });
}

// ── Daily reward ────────────────────────────────────────────────────────────

const SUPER_COLORS = ['#ffd23f', '#fff3b0', '#ff2e88', '#8338ec', '#3a86ff', '#06d6a0', '#ffffff'];

/**
 * Opens today's daily reward at once: the booster of `setId`, or on its day the
 * Super Booster. It is claimed when the pack is torn open (closing before keeps it).
 */
export function openDaily(setId) {
  const { day, cycle, super: isSuperDay, superReason } = dailyStatus();
  const stage = createStage();
  if (isSuperDay) openSuper(stage, { day, cycle, reason: superReason });
  else openSingle(setId, stage, { daily: { day, cycle } });
}

/** Buys `count` boosters of `setId` with Kira and opens them at once (paid when the packs are torn open). */
export function openBought(setId, count = 1) {
  startOpening(setId, count, createStage(), { price: priceOf(setId) });
}

/**
 * The Super Booster drops from the sky in a rainbow halo; one tap charges it up until it blows.
 * `daily`: { day, cycle, reason } for the daily reward's, else one won in the weekly ranking.
 */
async function openSuper(stage = createStage(), daily = null) {
  const set = setOf(state.meta.daily.superSet.id);
  const run = ++stage.run;
  const stale = () => stage.closed || stage.run !== run;
  stage.element.dataset.phase = 'super';
  stage.element.dataset.show = 'super';
  dressStage(stage, set);

  mount(
    stage.content,
    html`<div class="super">
      <p class="mega__title super__title">${t('daily.stageSuper')}</p>
      <p class="giant__sub">${daily ? ({ event: t('daily.stageEvent'), gift: t('daily.stageGift') }[daily.reason] ?? t('daily.stageDay', daily)) : `🏆 ${t('weekly.stageWon')}`} · ${t('daily.stageSuperSub')}</p>
      <div class="super__scene">
        <div class="giant__rays" aria-hidden="true"></div>
        <span class="super__aura" aria-hidden="true"></span>
        <button class="stage-pack stage-pack--super" type="button" aria-label="${t('daily.superTearLabel')}">${tearablePackHTML(set)}</button>
      </div>
      <p class="stage__hint bubble">${t('daily.superTap')}</p>
    </div>`,
  );
  const scene = $('.super', stage.content);
  const pack = $('.stage-pack', stage.content);
  sfx.play('fanfare');
  setTimeout(() => !stale() && confettiStorm(SUPER_COLORS, { rounds: 3 }), 500);
  pack.focus({ preventScroll: true });
  await nextClick(pack);
  if (stale()) return;

  // It shakes harder and harder and the halo swells while the server answers…
  pack.disabled = true;
  scene.classList.add('is-charging');
  $('.stage__hint', stage.content).textContent = t('stage.opening');
  sfx.play('charge');
  setTimeout(() => !stale() && sfx.play('charge'), 700);
  const boosters = await requestBoosters(stage, daily ? () => claimDaily(set.id) : () => openBoosters(set.id, 1), 1500);
  if (!boosters) return;
  const [booster] = boosters;
  await preloadImages(booster.cards);
  if (stale()) return;

  // …then it blows up.
  scene.classList.remove('is-charging');
  scene.classList.add('is-open');
  pack.classList.add('is-torn');
  const box = pack.getBoundingClientRect();
  sfx.play('boom');
  flash('#fff', 750);
  shakeScreen();
  confettiStorm(SUPER_COLORS, { rounds: 6 });
  onomatopoeia(t('daily.superBoom'), { x: box.left + box.width / 2, y: box.top + box.height * 0.25, color: '#ffd23f', size: 'xl', tilt: -8 });
  await wait(1100);
  if (stale()) return;
  showReveal(stage, set, booster, run, daily && { daily });
}

// ── Several boosters in a row ───────────────────────────────────────────────

/** `source`: { price } for boosters bought with Kira (see openSingle). */
async function openMany(setId, count, stage = createStage(), source = null) {
  const set = setOf(setId);
  const run = ++stage.run;
  const stale = () => stage.closed || stage.run !== run;
  stage.element.dataset.phase = 'packs';
  delete stage.element.dataset.show;
  dressStage(stage, set);

  // The packs arrive as a fanned-out hand.
  mount(
    stage.content,
    html`<div class="mega">
      <p class="mega__title">${t('mega.title', { count })}</p>
      ${source?.price && html`<p class="giant__sub">✦ ${t('market.stageSub', { price: source.price * count })}</p>`}
      <button class="mega__packs" type="button" style="--n:${count}" aria-label="${t('mega.tearLabel', { count, set: setName(set.id) })}">
        ${Array.from({ length: count }, (_, i) => html`<span class="mega-pack" style="--i:${i}">${tearablePackHTML(set)}</span>`)}
      </button>
      <p class="stage__hint bubble">${t('mega.tap')}</p>
    </div>`,
  );
  const packs = $('.mega__packs', stage.content);
  if (source) sfx.play('coin');
  packs.focus({ preventScroll: true });
  await nextClick(packs);
  if (stale()) return;

  packs.disabled = true;
  packs.classList.add('is-shaking');
  $('.stage__hint', stage.content).textContent = t('stage.opening');
  sfx.play(set.event ? 'thunder' : 'shake');
  setTimeout(() => !stale() && sfx.play('charge'), 350);

  const boosters = await requestBoosters(stage, askBoosters(setId, count, source), 1100);
  if (!boosters) return;
  await preloadImages(boosters.flatMap((booster) => booster.cards), 5000);
  if (stale()) return;

  // Chain reaction: the packs burst one after the other, faster and faster.
  packs.classList.remove('is-shaking');
  const items = $$('.mega-pack', packs);
  for (const [i, item] of items.entries()) {
    if (stale()) return;
    item.classList.add('is-torn');
    sfx.play('tear');
    const box = item.getBoundingClientRect();
    burst(box.left + box.width / 2, box.top + box.height * 0.18, { colors: ['#fff', '#ffd23f', set.colors[0], set.colors[1]], count: 18, power: 0.9 });
    await wait(Math.max(70, 190 - i * 14));
  }
  const box = packs.getBoundingClientRect();
  flash(set.event ? 'rgba(123,44,191,.85)' : 'rgba(255,255,255,.9)', 420);
  shakeScreen();
  const colors = set.event ? showFor(set).colors : ['#fff', '#ffd23f', '#ff2e88', '#3a86ff'];
  burst(box.left + box.width / 2, box.top + box.height / 2, { colors, count: 110, power: 1.6 });
  if (set.event) sfx.play('cackle');
  onomatopoeia(t(set.event ? `events.${set.event}.tear` : 'fx.tear'), { x: box.left + box.width / 2, y: box.top + box.height * 0.3, color: '#fff', size: 'xl' });
  await wait(750);
  if (stale()) return;
  showManyReveal(stage, set, boosters, run, null, source);
}

// ── ×10 show ────────────────────────────────────────────────────────────────

const SEALS = 3; // taps to break the display's seal (2 anime cut-ins per tap)

/**
 * A booster display, like the boxes of the Pokémon card game: the boosters
 * stand in two rows behind the printed front panel, under an open lid and a
 * plastic wrap sealed with a ×10 sticker.
 */
function displayHTML(set, count) {
  const art = set.featured?.image;
  const packs = Array.from({ length: count }, (_, i) => html`<span class="display__pack" style="--i:${i}">${packHTML(set)}</span>`);
  const half = Math.ceil(count / 2);
  return html`<span class="display__body" style="${packStyle(set)}">
    <span class="display__lid"><span class="display__lid-brand">ANIME CLASH</span></span>
    <span class="display__box">
      <span class="display__row display__row--back">${packs.slice(0, half)}</span>
      <span class="display__row display__row--front">${packs.slice(half)}</span>
      <span class="display__front">
        <span class="display__art">${art && html`<img src="${art.src}" alt="" draggable="false">`}</span>
        <span class="display__brand">ANIME<br>CLASH</span>
        <span class="display__label">
          <span class="display__name">${setName(set.id)}</span>
          <span class="display__count">${t('show.displayCount', { count })}</span>
        </span>
      </span>
    </span>
    <span class="display__wrap"></span>
    <svg class="display__cracks" viewBox="0 0 100 60" preserveAspectRatio="none" aria-hidden="true">
      <g class="crack crack--1"><polyline points="50,30 44,22 40,10 42,1" /></g>
      <g class="crack crack--2"><polyline points="50,30 62,36 74,34 87,42" /><polyline points="50,30 56,18 66,12" /></g>
      <g class="crack crack--3"><polyline points="50,30 44,40 32,44 17,42" /><polyline points="50,30 53,44 48,59" /><polyline points="66,12 79,4" /></g>
    </svg>
    <span class="display__seal">×${count}</span>
  </span>`;
}

/** `source`: { price } for boosters bought with Kira (see openSingle). */
async function openTen(setId, count, stage = createStage(), source = null) {
  const set = setOf(setId);
  const show = showFor(set);
  const run = ++stage.run;
  const stale = () => stage.closed || stage.run !== run;
  stage.element.dataset.phase = 'giant';
  stage.element.dataset.show = show.theme;
  dressStage(stage, set);

  mount(
    stage.content,
    html`<div class="giant" data-hit="0">
      <p class="mega__title giant__title">${t('show.title', { count })}</p>
      <p class="giant__sub">${t(`show.sub.${show.theme}`)}${source?.price ? ` · ✦ ${t('market.stageSub', { price: source.price * count })}` : ''}</p>
      <div class="giant__scene">
        <div class="giant__rays" aria-hidden="true"></div>
        <button class="display" type="button" aria-label="${t('show.tearLabel', { set: setName(set.id) })}">${displayHTML(set, count)}</button>
      </div>
      <div class="giant__seals" aria-hidden="true">${Array.from({ length: SEALS }, () => html`<span></span>`)}</div>
      <p class="stage__hint bubble">${t('show.tap', { left: SEALS })}</p>
    </div>`,
  );
  const scene = $('.giant', stage.content);
  const display = $('.display', stage.content);
  const hint = $('.stage__hint', stage.content);
  sfx.play('fanfare');
  setTimeout(() => {
    if (stale()) return;
    burst(window.innerWidth * 0.1, window.innerHeight * 0.9, { colors: show.colors, count: 50, power: 1.8 });
    burst(window.innerWidth * 0.9, window.innerHeight * 0.9, { colors: show.colors, count: 50, power: 1.8 });
  }, 450);
  display.focus({ preventScroll: true });

  // "Skip" (bottom right): no more taps nor cut-ins, straight to the cards. It is
  // put on the stage itself, not in the content, which shakes.
  const skipButton = document.createElement('button');
  skipButton.className = 'btn btn--ghost-light stage__skip';
  skipButton.type = 'button';
  skipButton.textContent = t('show.skip');
  stage.element.append(skipButton);
  let skipped = false;
  const skip = new Promise((resolve) =>
    skipButton.addEventListener(
      'click',
      () => {
        skipped = true;
        clearCutIns();
        skipButton.remove();
        resolve();
      },
      { once: true },
    ),
  );

  // Each tap tears the wrap a bit more and calls two anime on stage.
  let request = null;
  for (let hit = 1; hit <= SEALS && !skipped; hit++) {
    await Promise.race([nextClick(display), skip]);
    if (stale()) return;
    request ??= requestBoosters(stage, askBoosters(setId, count, source), 0); // asked at the first tap, ready at the last
    if (skipped) break;
    display.disabled = true;
    scene.dataset.hit = hit;
    display.classList.remove('is-hit');
    void display.offsetWidth; // restart the animation
    display.classList.add('is-hit');
    sfx.play('crack');
    shakeScreen();
    const box = display.getBoundingClientRect();
    burst(box.left + box.width / 2, box.top + box.height * 0.55, { colors: show.colors, count: 40 + hit * 20, power: 1 + hit * 0.25 });
    for (const [i, side] of ['left', 'right'].entries()) {
      const anime = show.anime[(hit - 1) * 2 + i];
      if (!anime || skipped) continue;
      stage.announce(`${cardText(anime.card).name}: ${anime.shout}`);
      await Promise.race([cutIn(anime, { side, theme: show.theme }), skip]);
      if (stale()) return;
    }
    hint.textContent = hit < SEALS && !skipped ? t('show.tap', { left: SEALS - hit }) : t('stage.opening');
    display.disabled = hit === SEALS || skipped;
    if (hit < SEALS && !skipped) display.focus({ preventScroll: true });
  }

  display.disabled = true;
  scene.dataset.hit = SEALS;
  hint.textContent = t('stage.opening');
  display.classList.add('is-charging');
  sfx.play('charge');
  const boosters = await request;
  if (!boosters) return;
  await Promise.all([preloadImages(boosters.flatMap((booster) => booster.cards), 5000), wait(skipped ? 300 : 900)]);
  if (stale()) return;

  // The seal breaks: the wrap flies off, the lid opens and the boosters pop up…
  display.classList.remove('is-charging');
  display.classList.add('is-open');
  sfx.play('tear');
  if (set.event) sfx.play('cackle');
  await wait(skipped ? 350 : 650);
  if (stale()) return;

  // …then explosion, confetti storm, and the 10 boosters fly out.
  const box = display.getBoundingClientRect();
  display.classList.add('is-empty');
  sfx.play('boom');
  flash(set.event ? '#c77dff' : '#fff', 750);
  shakeScreen();
  confettiStorm(show.colors, { rounds: 8 });
  scatterPacks(packHTML(set), count, box.left + box.width / 2, box.top + box.height * 0.45);
  onomatopoeia(t('show.boom'), { x: box.left + box.width / 2, y: box.top + box.height * 0.3, color: '#ffd23f', size: 'xl', tilt: -10 });
  await Promise.race([wait(1500), skip.then(() => wait(400))]);
  skipButton.remove();
  if (stale()) return;
  showManyReveal(stage, set, boosters, run, show, source);
}

/**
 * `show` (×10 only): the finale gets a confetti storm and a cut-in of the best card.
 * `source`: { price } for boosters bought with Kira, which end with "Buy ×N again" instead of "Open another".
 */
function showManyReveal(stage, set, boosters, run, show = null, source = null) {
  const cards = boosters.flatMap((booster) => booster.cards);
  const stale = () => stage.closed || stage.run !== run;
  const rarities = [...state.meta.rarities].reverse(); // rarest first
  const tally = Object.fromEntries(rarities.map((rarity) => [rarity.id, 0]));
  let newCount = 0;
  let revealed = 0;
  let mode = 'manual'; // then 'cascade' (Reveal all) or 'skip'
  stage.element.dataset.phase = 'reveal';

  mount(
    stage.content,
    html`<div class="mega-reveal">
      <div class="mega-reveal__head">
        <p class="mega__title mega__title--small">${t('mega.cards', { count: cards.length, boosters: boosters.length })}</p>
        <div class="mega-tally" aria-hidden="true">
          ${rarities.map((rarity) => html`<span class="tally-chip r-${rarity.id} is-zero" data-tally="${rarity.id}">${rarity.id} <b>0</b></span>`)}
          <span class="tally-chip tally-chip--new is-zero" data-tally="new">${t('card.new')} <b>0</b></span>
        </div>
        <div class="mega-reveal__actions">
          <p class="stage__hint bubble">${t('mega.clickCards')}</p>
          <div class="btn-row">
            <button class="btn btn--primary" type="button" data-action="reveal-all">${t('stage.revealAll')}</button>
            <button class="btn btn--ghost-light" type="button" data-action="skip">${t('mega.skip')}</button>
          </div>
        </div>
      </div>
      <div class="mega-grid">
        ${cards.map(
          (card, i) => html`<div class="flip flip--mini" role="button" tabindex="0" data-index="${i}" data-rarity="${card.rarity}"
              style="--i:${i}" aria-label="${t('stage.reveal', { n: i + 1, total: cards.length })}">
            <div class="flip__inner">
              <div class="flip__face flip__back">${cardBackHTML()}</div>
              <div class="flip__face flip__front">${cardHTML(card, { isNew: card.isNew, interactive: false, lazy: false })}</div>
            </div>
          </div>`,
        )}
      </div>
    </div>`,
  );

  const flips = $$('.flip', stage.content);

  function bump(key, value) {
    const chip = $(`[data-tally="${key}"]`, stage.content);
    chip.querySelector('b').textContent = value;
    chip.classList.remove('is-zero', 'is-bumped');
    void chip.offsetWidth; // restart the animation
    chip.classList.add('is-bumped');
  }

  /** Keeps the card being revealed on screen during the cascade. */
  function follow(flip) {
    const box = flip.getBoundingClientRect();
    if (box.top < 70 || box.bottom > window.innerHeight - 20) flip.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  async function reveal(flip, { quick = false } = {}) {
    if (flip.dataset.state) return;
    flip.dataset.state = 'busy';
    const card = cards[Number(flip.dataset.index)];
    const big = BIG.has(card.rarity);
    if (big && !quick) {
      flip.classList.add('is-charging');
      if (card.rarity !== 'SSR') sfx.play('charge');
      await wait({ SSR: 450, UR: 900, REV: 1250 }[card.rarity]);
      if (stale()) return;
      flip.classList.remove('is-charging');
    }
    flip.classList.add('is-flipped');
    if (!quick || big) sfx.play('flip');
    await wait(quick ? 140 : 240);
    if (stale()) return;
    // Skipping: only the rarest cards still get their effects.
    const pause = !quick || big ? celebrate(flip.getBoundingClientRect(), card) : 0;
    if (card.isNew) flip.classList.add('show-new');
    flip.dataset.state = 'revealed';
    flip.setAttribute('aria-label', t('stage.revealed', {
      name: cardText(card).name,
      rarity: rarityName(card.rarity),
      isNew: card.isNew ? t('stage.revealedNew') : '',
    }));
    tally[card.rarity] += 1;
    bump(card.rarity, tally[card.rarity]);
    if (card.isNew) bump('new', ++newCount);
    if (pause && !quick) {
      await wait(pause); // the REVERSE moment (the cascade waits for it)
      if (stale()) return;
    }
    revealed += 1;
    if (revealed === cards.length) finish();
  }

  /** "Reveal all": a wave through the cards; it pauses on the rare ones for their effects. */
  async function cascade() {
    mode = 'cascade';
    $('[data-action="reveal-all"]', stage.content).hidden = true;
    for (const flip of flips) {
      if (stale() || mode !== 'cascade') return;
      if (flip.dataset.state) continue;
      const card = cards[Number(flip.dataset.index)];
      follow(flip);
      if (BIG.has(card.rarity)) {
        await reveal(flip);
        await wait(300);
      } else {
        reveal(flip);
        await wait(card.rarity === 'SR' ? 230 : 110);
      }
    }
  }

  /** "Skip": everything flips at once (the rarest cards still celebrate). */
  async function skip() {
    mode = 'skip';
    for (const button of $$('.mega-reveal__actions .btn', stage.content)) button.hidden = true;
    for (const flip of flips) {
      if (stale()) return;
      if (flip.dataset.state) continue;
      reveal(flip, { quick: true });
      await wait(22);
    }
  }

  function finish() {
    const best = [...cards].sort(byRarity).slice(0, 3);
    for (const card of best) flips[cards.indexOf(card)].classList.add('is-best');
    finale(best[0].rarity, boosters.length);
    if (show) {
      // ×10: one more confetti storm, and the best card gets its own cut-in.
      confettiStorm(show.colors, { rounds: 5 });
      const title = BIG.has(best[0].rarity) ? t('show.legendary') : t('show.bestPull');
      setTimeout(() => !stale() && cutIn({ card: best[0], shout: title }, { side: 'left', theme: show.theme, duration: 1700 }), 900);
    }
    stage.announce(t('mega.announce', { count: boosters.length, newCount }));
    mount(
      $('.mega-reveal__actions', stage.content),
      html`<p class="mega__done">${t('mega.done', { count: boosters.length })}</p>
        <p class="reveal__summary">
          ${newCount ? html`<strong class="new-pill">${t('stage.newCards', { count: newCount })}</strong>` : t('stage.noNew')}
          ${t('stage.best')}
          ${best.map((card, i) => html`${i ? ' · ' : ''}<strong class="rarity-text r-${card.rarity}">${card.rarity}</strong> ${cardText(card).name}`)}
        </p>
        <p class="stage__hint">${t('stage.clickDetail')}</p>
        <div class="btn-row">
          ${source?.price
            ? html`${buyButtonHTML(set, t('market.buyAgain', { count: boosters.length }), boosters.length)}<a class="btn btn--ghost-light" href="#/market">${t('nav.market')}</a>`
            : html`<span class="btn-row" data-slot="next"></span>`}
          <a class="btn btn--ghost-light" href="#/collection">${t('stage.myCollection')}</a>
        </div>`,
    );
    if (!source) nextButtons($('[data-slot="next"]', stage.content), set, stage);
    else $('.mega-reveal__actions .btn:not(:disabled)', stage.content).focus({ preventScroll: true });
    stage.element.scrollTo({ top: 0, behavior: 'smooth' });
  }

  stage.content.onclick = (event) => {
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (action === 'reveal-all') cascade();
    else if (action === 'skip') skip();
    const buy = event.target.closest('.mega-reveal__actions [data-buy]');
    if (buy) startOpening(set.id, Number(buy.dataset.count), stage, { price: priceOf(set.id) });
    const flip = event.target.closest('.flip');
    if (!flip) return;
    if (flip.dataset.state === 'revealed') openCardModal(cards[Number(flip.dataset.index)], { list: cards });
    else reveal(flip);
  };
  stage.content.onkeydown = (event) => {
    const flip = event.target.closest?.('.flip');
    if (flip && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      flip.click();
    }
  };
  $('[data-action="reveal-all"]', stage.content).focus({ preventScroll: true });
}

/** Fireworks at the end of a multi-opening, bigger when the best card is rarer. */
function finale(rarity, count) {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const colors = [...RARITY_COLORS[rarity], '#fff', '#ffd23f'];
  const rounds = { N: 3, R: 3, SR: 4, SSR: 5, UR: 7, REV: 9 }[rarity] ?? 4;
  for (let k = 0; k < rounds; k++) {
    setTimeout(() => {
      burst(width * (0.12 + Math.random() * 0.76), height * (0.18 + Math.random() * 0.35), { colors, count: 55, power: 1.3 });
      sfx.play(k % 2 ? 'R' : 'SR');
    }, k * 190);
  }
  flash('rgba(255, 255, 255, .55)', 420);
  onomatopoeia(t('mega.boom', { count }), { x: width / 2, y: height * 0.32, color: '#ffd23f', size: 'xl', tilt: -6 });
}

/** Time (ms) the "REVERSE" moment of a Reversed card lasts; the reveal waits for it. */
const REVERSE_MS = 5300;

/**
 * Sound + particles + lettering for a revealed card, centered on `box` (the cards of an
 * event have their own lettering: BOO!…). Returns how long (ms) the reveal should wait
 * before going on (the REVERSE moment).
 */
function celebrate(box, card) {
  const { rarity } = card;
  const x = box.left + box.width / 2;
  const y = box.top + box.height / 2;
  const colors = RARITY_COLORS[rarity];
  const fx = (key) => (card.event && has(`events.${card.event}.fx.${key}`) ? t(`events.${card.event}.fx.${key}`) : t(`fx.${key}`));
  sfx.play(rarity === 'REV' ? 'reverse' : rarity);
  switch (rarity) {
    case 'R':
      burst(x, y, { colors, count: 14, power: 0.7 });
      break;
    case 'SR':
      burst(x, y, { colors, count: 32 });
      onomatopoeia(fx('sparkle'), { x, y: box.top, color: '#e0aaff', size: 'm', tilt: 6 });
      break;
    case 'SSR':
      flash('rgba(255, 210, 63, .55)', 420);
      burst(x, y, { colors, count: 70, power: 1.3 });
      onomatopoeia(fx('rumble'), { x, y: box.top - 10, color: '#ffd23f', size: 'l' });
      break;
    case 'UR':
      flash('#fff', 650);
      shakeScreen();
      burst(x, y, { colors, count: 120, power: 1.7 });
      setTimeout(() => burst(x, y, { colors, count: 60, power: 1.2 }), 280);
      onomatopoeia(fx('boom'), { x, y: box.top - 20, color: '#ff2e88', size: 'xl' });
      break;
    case 'REV': {
      // The rarest card: the heart skips twice (in time with the sound), then the
      // whole screen turns negative under a giant "REVERSE".
      onomatopoeia(t('fx.heartbeat'), { x, y: box.top - 10, color: '#fff', size: 'm', tilt: -5 });
      setTimeout(() => onomatopoeia(t('fx.heartbeat'), { x, y: box.top - 40, color: '#00d177', size: 'l', tilt: 6 }), 280);
      setTimeout(() => {
        flash('#000', 500);
        shakeScreen();
        burst(x, y, { colors, count: 160, power: 2 });
        setTimeout(() => burst(x, y, { colors, count: 90, power: 1.4 }), 300);
        const rev = state.meta.rarities.find((rarity) => rarity.id === 'REV');
        const eventCount = card.event && eventCards(card.event).filter((each) => each.rarity === 'REV').length;
        reverseWorld({
          title: t('reverse.title'),
          subtitle: card.event
            ? t(`events.${card.event}.reverse`, { count: eventCount, total: eventCards(card.event).length })
            : t('reverse.sub', { count: rev?.cardCount ?? 0, total: state.meta.totalCards }),
        });
      }, 850);
      return REVERSE_MS;
    }
    default:
      break;
  }
  return 0;
}
