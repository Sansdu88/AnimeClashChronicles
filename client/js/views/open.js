/**
 * "Open" page: the booster shelf, the booster stock and the opening stage
 * (shake → tear → 5 face-down cards → flip them one by one).
 * A player gets one booster every 2 minutes (BOOSTER.cooldownSeconds) and can
 * keep up to 10 (BOOSTER.stackMax): several boosters can be opened in a row
 * (the packs burst one after the other, then all the cards flip in a cascade),
 * and a full stock of 10 gets the ×10 show: a giant booster whose seal breaks
 * in 3 taps, with anime cut-ins themed after the set (components/booster-show.js).
 */
import { $, $$, escapeHtml, fmt, html, mount, raw, wait } from '../dom.js';
import { cardText, errorText, rarityName, setName, setTagline, t, tHtml } from '../i18n.js';
import { boosterStock, byRarity, openBoosters, reloadPlayer, setOf, state } from '../state.js';
import { cardBackHTML, cardHTML } from '../components/card.js';
import { openCardModal } from '../components/card-modal.js';
import { clearCutIns, confettiStorm, cutIn, scatterPacks, showFor } from '../components/booster-show.js';
import { RARITY_COLORS, burst, flash, onomatopoeia, reverseWorld, shakeScreen } from '../ui/effects.js';
import { pushLayer } from '../ui/layers.js';
import { sfx } from '../ui/sfx.js';
import { toast } from '../ui/toast.js';

const setCards = (set) => state.cards.filter((card) => !set.era || card.era === set.era);
const packStyle = (set) => `--c1:${set.colors[0]};--c2:${set.colors[1]}`;
const BIG = new Set(['SSR', 'UR', 'REV']);

function packHTML(set) {
  const art = set.featured?.image;
  return html`<span class="pack__inner" style="${packStyle(set)}">
    <span class="pack__crimp pack__crimp--top"></span>
    <span class="pack__body">
      <span class="pack__brand">ANIME CLASH</span>
      <span class="pack__art">${art && html`<img src="${art.src}" alt="" loading="lazy" draggable="false">`}</span>
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

function packTileHTML(set) {
  const cards = setCards(set);
  const have = cards.filter((card) => state.owned.has(card.id)).length;
  return html`<div class="pack-tile">
    <button class="pack" type="button" data-open="${set.id}" data-count="1" aria-label="${t('open.openOne', { set: setName(set.id) })}">${packHTML(set)}</button>
    <div class="pack-tile__progress" title="${t('open.progress', { have, total: cards.length })}">
      <span class="meter"><span class="meter__fill" style="width:${((have / cards.length) * 100).toFixed(1)}%"></span></span>
      <span class="pack-tile__count">${have}/${cards.length}</span>
    </div>
    <div class="pack-tile__actions">
      <button class="btn btn--primary" type="button" data-open="${set.id}" data-count="1">${t('open.open')}</button>
      <button class="btn btn--secondary" type="button" data-open="${set.id}" data-count="many" hidden></button>
    </div>
  </div>`;
}

/** Calls `paint()` now and every second, until it returns false. */
function everySecond(paint) {
  const tick = () => {
    if (paint() !== false) setTimeout(tick, 1000);
  };
  tick();
}

/** Opens `count` boosters of a set: one, several in a row, or the ×10 show for a full stock. */
function startOpening(setId, count, stage) {
  if (count >= state.meta.booster.stackMax) openTen(setId, stage);
  else if (count > 1) openMany(setId, count, stage);
  else openSingle(setId, stage);
}

/** Text and look of an "Open ×N" button (the full stock gets the ×10 show). */
function paintManyButton(button, count, setId) {
  const special = count >= state.meta.booster.stackMax;
  button.textContent = special ? t('open.openTen', { count }) : t('open.openMany', { count });
  button.classList.toggle('btn--special', special);
  button.setAttribute('aria-label', t(special ? 'open.openTenLabel' : 'open.openManyLabel', { count, set: setName(setId) }));
}

export function renderOpen(main) {
  const { player, meta } = state;
  const max = meta.booster.stackMax;
  mount(
    main,
    html`<section class="view view-open">
      <div class="hero">
        <h1 class="hero__title">${t('open.title')}</h1>
        <p class="hero__sub">${raw(tHtml('open.sub', { minutes: meta.booster.cooldownSeconds / 60, max }))}</p>
      </div>
      <div class="stock" role="status">
        <div class="stock__slots" aria-hidden="true">
          ${Array.from({ length: max }, (_, i) => html`<span class="stock__slot" style="--i:${i}"></span>`)}
        </div>
        <p class="stock__text"><b class="stock__count">0</b>/${max} <span>${t('open.stockLabel')}</span></p>
        <p class="stock__next"></p>
      </div>
      <div class="shelf">${meta.sets.map(packTileHTML)}</div>
      <p class="open-footer">
        <span>${t('open.collection')} <strong>${player.stats.uniqueCards}/${player.stats.totalCards}</strong>
          (${fmt.percent(player.stats.completion)})</span>
        <span>${t('open.opened')} <strong>${fmt.number(player.stats.boostersOpened)}</strong></span>
        <a class="link" href="#/rules">${t('open.howRarity')}</a>
      </p>
    </section>`,
  );

  $('.shelf', main).addEventListener('click', (event) => {
    const button = event.target.closest('[data-open]');
    if (!button) return;
    sfx.play('click');
    const { stock } = boosterStock();
    startOpening(button.dataset.open, button.dataset.count === 'many' ? Math.min(stock, meta.booster.maxPerRequest) : 1);
  });

  // The stock fills up while the page is open: slots, countdown, buttons.
  const panel = $('.stock', main);
  const slots = $$('.stock__slot', panel);
  const openButtons = $$('[data-open]', main);
  const manyButtons = $$('[data-count="many"]', main);
  let previous = null;
  everySecond(() => {
    if (!panel.isConnected) return false; // the page was left or redrawn
    const { stock, nextIn } = boosterStock();
    const every = meta.booster.cooldownSeconds;
    slots.forEach((slot, i) => {
      slot.classList.toggle('is-full', i < stock);
      slot.classList.toggle('is-charging', i === stock);
      if (i === stock) slot.style.setProperty('--progress', ((every - nextIn) / every).toFixed(3));
    });
    panel.classList.toggle('is-full', stock >= max);
    panel.classList.toggle('is-empty', stock === 0);
    $('.stock__count', panel).textContent = stock;
    $('.stock__next', panel).textContent =
      stock >= max ? t('open.stockFull') : `⏳ ${t('open.nextIn', { time: fmt.duration(nextIn) })}`;
    for (const button of openButtons) button.disabled = stock === 0;
    const many = Math.min(stock, meta.booster.maxPerRequest);
    for (const button of manyButtons) {
      button.hidden = many < 2;
      paintManyButton(button, many, button.dataset.open);
    }
    // A booster arrived while the player was waiting on this page.
    if (previous !== null && stock > previous && !document.querySelector('.stage')) {
      if (previous === 0) {
        sfx.play('R');
        toast(t('open.ready'), 'success');
      } else if (stock >= max) {
        toast(t('open.stockFullToast', { max }), 'info');
      }
    }
    previous = stock;
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
      window.dispatchEvent(new CustomEvent('mb:refresh'));
    },
  };
  const removeLayer = pushLayer(() => stage.close());
  element.querySelector('.stage__close').addEventListener('click', () => stage.close());
  return stage;
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

/** Asks the server for boosters; a failed request closes the stage (the stock is reloaded if it was wrong). */
async function requestBoosters(stage, setId, count, minWait) {
  try {
    const [boosters] = await Promise.all([openBoosters(setId, count), wait(minWait)]);
    return boosters;
  } catch (err) {
    toast(errorText(err), 'error');
    if (err.code === 'booster_cooldown') reloadPlayer().catch(() => {});
    stage.close();
    return null;
  }
}

/**
 * "Open another" / "Open ×N" buttons at the end of an opening, or a countdown
 * when the stock is empty. Kept up to date every second while shown.
 */
function nextButtons(slot, set, stage) {
  let shown = null;
  let waited = false;
  everySecond(() => {
    if (!slot.isConnected || stage.closed) return false;
    const { stock, nextIn } = boosterStock();
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
        : html`<button class="btn btn--primary btn--big" type="button" disabled>⏳ ${t('open.nextIn', { time: fmt.duration(nextIn) })}</button>`,
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
  };
}

// ── Single booster ──────────────────────────────────────────────────────────

async function openSingle(setId, stage = createStage()) {
  const set = setOf(setId);
  const run = ++stage.run;
  const stale = () => stage.closed || stage.run !== run;
  stage.element.dataset.phase = 'pack';
  delete stage.element.dataset.show;
  stage.element.style.cssText = packStyle(set);

  mount(
    stage.content,
    html`<div class="stage-pack-wrap">
      <button class="stage-pack" type="button" aria-label="${t('stage.tearLabel', { set: setName(set.id) })}">
        ${tearablePackHTML(set)}
      </button>
      <p class="stage__hint bubble">${t('stage.tapPack')}</p>
    </div>`,
  );
  const pack = $('.stage-pack', stage.content);
  pack.focus({ preventScroll: true });
  await nextClick(pack);
  if (stale()) return;

  pack.disabled = true;
  pack.classList.add('is-shaking');
  $('.stage__hint', stage.content).textContent = t('stage.opening');
  sfx.play('shake');

  const boosters = await requestBoosters(stage, setId, 1, 650);
  if (!boosters) return;
  const [booster] = boosters;
  await preloadImages(booster.cards);
  if (stale()) return;

  pack.classList.remove('is-shaking');
  pack.classList.add('is-torn');
  sfx.play('tear');
  const box = pack.getBoundingClientRect();
  flash('rgba(255,255,255,.8)', 280);
  onomatopoeia(t('fx.tear'), { x: box.left + box.width / 2, y: box.top + box.height * 0.12, color: '#fff', size: 'l' });
  await wait(600);
  if (stale()) return;
  showReveal(stage, set, booster, run);
}

function showReveal(stage, set, booster, run) {
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
    const pause = celebrate(flip.getBoundingClientRect(), card.rarity);
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
          <span class="btn-row" data-slot="next"></span>
          <a class="btn btn--ghost-light" href="#/collection">${t('stage.myCollection')}</a>
        </div>`,
    );
    nextButtons($('[data-slot="next"]', stage.content), set, stage);
  }

  stage.content.onclick = (event) => {
    if (event.target.closest('[data-action="reveal-all"]')) revealAll();
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

// ── Several boosters in a row ───────────────────────────────────────────────

async function openMany(setId, count, stage = createStage()) {
  const set = setOf(setId);
  const run = ++stage.run;
  const stale = () => stage.closed || stage.run !== run;
  stage.element.dataset.phase = 'packs';
  delete stage.element.dataset.show;
  stage.element.style.cssText = packStyle(set);

  // The packs arrive as a fanned-out hand.
  mount(
    stage.content,
    html`<div class="mega">
      <p class="mega__title">${t('mega.title', { count })}</p>
      <button class="mega__packs" type="button" style="--n:${count}" aria-label="${t('mega.tearLabel', { count, set: setName(set.id) })}">
        ${Array.from({ length: count }, (_, i) => html`<span class="mega-pack" style="--i:${i}">${tearablePackHTML(set)}</span>`)}
      </button>
      <p class="stage__hint bubble">${t('mega.tap')}</p>
    </div>`,
  );
  const packs = $('.mega__packs', stage.content);
  packs.focus({ preventScroll: true });
  await nextClick(packs);
  if (stale()) return;

  packs.disabled = true;
  packs.classList.add('is-shaking');
  $('.stage__hint', stage.content).textContent = t('stage.opening');
  sfx.play('shake');
  setTimeout(() => !stale() && sfx.play('charge'), 350);

  const boosters = await requestBoosters(stage, setId, count, 1100);
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
  flash('rgba(255,255,255,.9)', 420);
  shakeScreen();
  burst(box.left + box.width / 2, box.top + box.height / 2, { colors: ['#fff', '#ffd23f', '#ff2e88', '#3a86ff'], count: 110, power: 1.6 });
  onomatopoeia(t('fx.tear'), { x: box.left + box.width / 2, y: box.top + box.height * 0.3, color: '#fff', size: 'xl' });
  await wait(750);
  if (stale()) return;
  showManyReveal(stage, set, boosters, run);
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

async function openTen(setId, stage = createStage()) {
  const set = setOf(setId);
  const count = state.meta.booster.stackMax;
  const show = showFor(set);
  const run = ++stage.run;
  const stale = () => stage.closed || stage.run !== run;
  stage.element.dataset.phase = 'giant';
  stage.element.dataset.show = show.theme;
  stage.element.style.cssText = packStyle(set);

  mount(
    stage.content,
    html`<div class="giant" data-hit="0">
      <p class="mega__title giant__title">${t('show.title', { count })}</p>
      <p class="giant__sub">${t(`show.sub.${show.theme}`)}</p>
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
    request ??= requestBoosters(stage, setId, count, 0); // asked at the first tap, ready at the last
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
  await wait(skipped ? 350 : 650);
  if (stale()) return;

  // …then explosion, confetti storm, and the 10 boosters fly out.
  const box = display.getBoundingClientRect();
  display.classList.add('is-empty');
  sfx.play('boom');
  flash('#fff', 750);
  shakeScreen();
  confettiStorm(show.colors, { rounds: 8 });
  scatterPacks(packHTML(set), count, box.left + box.width / 2, box.top + box.height * 0.45);
  onomatopoeia(t('show.boom'), { x: box.left + box.width / 2, y: box.top + box.height * 0.3, color: '#ffd23f', size: 'xl', tilt: -10 });
  await Promise.race([wait(1500), skip.then(() => wait(400))]);
  skipButton.remove();
  if (stale()) return;
  showManyReveal(stage, set, boosters, run, show);
}

/** `show` (×10 only): the finale gets a confetti storm and a cut-in of the best card. */
function showManyReveal(stage, set, boosters, run, show = null) {
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
    const pause = !quick || big ? celebrate(flip.getBoundingClientRect(), card.rarity) : 0;
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
          <span class="btn-row" data-slot="next"></span>
          <a class="btn btn--ghost-light" href="#/collection">${t('stage.myCollection')}</a>
        </div>`,
    );
    nextButtons($('[data-slot="next"]', stage.content), set, stage);
    stage.element.scrollTo({ top: 0, behavior: 'smooth' });
  }

  stage.content.onclick = (event) => {
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (action === 'reveal-all') cascade();
    else if (action === 'skip') skip();
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
 * Sound + particles + lettering for a revealed card, centered on `box`.
 * Returns how long (ms) the reveal should wait before going on (the REVERSE moment).
 */
function celebrate(box, rarity) {
  const x = box.left + box.width / 2;
  const y = box.top + box.height / 2;
  const colors = RARITY_COLORS[rarity];
  sfx.play(rarity === 'REV' ? 'reverse' : rarity);
  switch (rarity) {
    case 'R':
      burst(x, y, { colors, count: 14, power: 0.7 });
      break;
    case 'SR':
      burst(x, y, { colors, count: 32 });
      onomatopoeia(t('fx.sparkle'), { x, y: box.top, color: '#e0aaff', size: 'm', tilt: 6 });
      break;
    case 'SSR':
      flash('rgba(255, 210, 63, .55)', 420);
      burst(x, y, { colors, count: 70, power: 1.3 });
      onomatopoeia(t('fx.rumble'), { x, y: box.top - 10, color: '#ffd23f', size: 'l' });
      break;
    case 'UR':
      flash('#fff', 650);
      shakeScreen();
      burst(x, y, { colors, count: 120, power: 1.7 });
      setTimeout(() => burst(x, y, { colors, count: 60, power: 1.2 }), 280);
      onomatopoeia(t('fx.boom'), { x, y: box.top - 20, color: '#ff2e88', size: 'xl' });
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
        reverseWorld({
          title: t('reverse.title'),
          subtitle: t('reverse.sub', { count: rev?.cardCount ?? 0, total: state.meta.totalCards }),
        });
      }, 850);
      return REVERSE_MS;
    }
    default:
      break;
  }
  return 0;
}
