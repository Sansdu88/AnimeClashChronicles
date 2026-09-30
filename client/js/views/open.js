/**
 * "Open" page: the booster shelf and the opening stage
 * (shake → tear → 5 face-down cards → flip them one by one).
 */
import { $, $$, escapeHtml, fmt, html, mount, raw, wait } from '../dom.js';
import { cardText, errorText, rarityName, setName, setTagline, t, tHtml } from '../i18n.js';
import { byRarity, openBoosters, setOf, state } from '../state.js';
import { cardBackHTML, cardHTML } from '../components/card.js';
import { openCardModal } from '../components/card-modal.js';
import { RARITY_COLORS, burst, flash, onomatopoeia, shakeScreen } from '../ui/effects.js';
import { pushLayer } from '../ui/layers.js';
import { sfx } from '../ui/sfx.js';
import { toast } from '../ui/toast.js';

const setCards = (set) => state.cards.filter((card) => !set.era || card.era === set.era);
const packStyle = (set) => `--c1:${set.colors[0]};--c2:${set.colors[1]}`;

function packHTML(set) {
  const art = set.featured?.image;
  return html`<span class="pack__inner" style="${packStyle(set)}">
    <span class="pack__crimp pack__crimp--top"></span>
    <span class="pack__body">
      <span class="pack__brand">ANIME CLASH</span>
      <span class="pack__art">${art && html`<img src="${art.src}" alt="" loading="lazy" draggable="false">`}</span>
      <span class="pack__kanji" lang="ja" style="--chars:${[...set.jp].length}">${set.jp}</span>
      <span class="pack__name">${setName(set.id)}</span>
      <span class="pack__tagline">${setTagline(set.id)}</span>
      <span class="pack__count">${t('open.cards')}</span>
    </span>
    <span class="pack__crimp pack__crimp--bottom"></span>
    <span class="pack__foil" aria-hidden="true"></span>
  </span>`;
}

function packTileHTML(set) {
  const cards = setCards(set);
  const have = cards.filter((card) => state.owned.has(card.id)).length;
  return html`<div class="pack-tile">
    <button class="pack" type="button" data-open="${set.id}" aria-label="${t('open.openOne', { set: setName(set.id) })}">${packHTML(set)}</button>
    <div class="pack-tile__progress" title="${t('open.progress', { have, total: cards.length })}">
      <span class="meter"><span class="meter__fill" style="width:${((have / cards.length) * 100).toFixed(1)}%"></span></span>
      <span class="pack-tile__count">${have}/${cards.length}</span>
    </div>
    <div class="pack-tile__actions">
      <button class="btn btn--primary" type="button" data-open="${set.id}">${t('open.open')}</button>
      <button class="btn btn--secondary" type="button" data-open="${set.id}" data-count="10" title="${t('open.openTen')}">×10</button>
    </div>
  </div>`;
}

export function renderOpen(main) {
  const { player, meta } = state;
  mount(
    main,
    html`<section class="view view-open">
      <div class="hero">
        <p class="hero__kicker" lang="ja">ブースターを開けよう！</p>
        <h1 class="hero__title">${t('open.title')}</h1>
        <p class="hero__sub">${raw(tHtml('open.sub'))}</p>
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
    const count = Number(button.dataset.count ?? 1);
    if (count > 1) openBulk(button.dataset.open, count);
    else openSingle(button.dataset.open);
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

// ── Single booster ──────────────────────────────────────────────────────────

async function openSingle(setId, stage = createStage()) {
  const set = setOf(setId);
  const run = ++stage.run;
  const stale = () => stage.closed || stage.run !== run;
  stage.element.dataset.phase = 'pack';
  stage.element.style.cssText = packStyle(set);

  mount(
    stage.content,
    html`<div class="stage-pack-wrap">
      <button class="stage-pack" type="button" aria-label="${t('stage.tearLabel', { set: setName(set.id) })}">
        <span class="stage-pack__half stage-pack__half--top">${packHTML(set)}</span>
        <span class="stage-pack__half stage-pack__half--bottom">${packHTML(set)}</span>
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

  let booster;
  try {
    [[booster]] = await Promise.all([openBoosters(setId, 1), wait(650)]);
    await preloadImages(booster.cards);
  } catch (err) {
    toast(errorText(err), 'error');
    stage.close();
    return;
  }
  if (stale()) return;

  pack.classList.remove('is-shaking');
  pack.classList.add('is-torn');
  sfx.play('tear');
  const box = pack.getBoundingClientRect();
  flash('rgba(255,255,255,.8)', 280);
  onomatopoeia('ビリッ!!', { x: box.left + box.width / 2, y: box.top + box.height * 0.12, color: '#fff', size: 'l' });
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
    if (card.rarity === 'UR' || card.rarity === 'SSR') {
      flip.classList.add('is-charging');
      if (card.rarity === 'UR') sfx.play('charge');
      await wait(card.rarity === 'UR' ? 950 : 500);
      if (stale()) return;
      flip.classList.remove('is-charging');
    }
    flip.classList.add('is-flipped');
    sfx.play('flip');
    await wait(260);
    if (stale()) return;
    celebrate(flip.getBoundingClientRect(), card.rarity);
    if (card.isNew) flip.classList.add('show-new');
    flip.dataset.state = 'revealed';
    const params = { name: cardText(card).name, rarity: rarityName(card.rarity) };
    flip.setAttribute('aria-label', t('stage.revealed', { ...params, isNew: card.isNew ? t('stage.revealedNew') : '' }));
    stage.announce(t('stage.announce', { ...params, isNew: card.isNew ? t('stage.announceNew') : '' }));
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
          <button class="btn btn--primary btn--big" type="button" data-action="again">${t('stage.again')}</button>
          <button class="btn btn--secondary" type="button" data-action="bulk">${t('stage.openTen')}</button>
          <a class="btn btn--ghost-light" href="#/collection">${t('stage.myCollection')}</a>
        </div>`,
    );
    $('[data-action="again"]', stage.content).focus({ preventScroll: true });
  }

  stage.content.onclick = (event) => {
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (action === 'reveal-all') revealAll();
    else if (action === 'again') openSingle(set.id, stage);
    else if (action === 'bulk') openBulk(set.id, 10, stage);
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

/** Sound + particles + lettering for a revealed card, centered on `box`. */
function celebrate(box, rarity) {
  const x = box.left + box.width / 2;
  const y = box.top + box.height / 2;
  const colors = RARITY_COLORS[rarity];
  sfx.play(rarity);
  switch (rarity) {
    case 'R':
      burst(x, y, { colors, count: 14, power: 0.7 });
      break;
    case 'SR':
      burst(x, y, { colors, count: 32 });
      onomatopoeia('キラッ', { x, y: box.top, color: '#e0aaff', size: 'm', tilt: 6 });
      break;
    case 'SSR':
      flash('rgba(255, 210, 63, .55)', 420);
      burst(x, y, { colors, count: 70, power: 1.3 });
      onomatopoeia('ゴゴゴ', { x, y: box.top - 10, color: '#ffd23f', size: 'l' });
      break;
    case 'UR':
      flash('#fff', 650);
      shakeScreen();
      burst(x, y, { colors, count: 120, power: 1.7 });
      setTimeout(() => burst(x, y, { colors, count: 60, power: 1.2 }), 280);
      onomatopoeia('ドーン!!', { x, y: box.top - 20, color: '#ff2e88', size: 'xl' });
      break;
    default:
      break;
  }
}

// ── ×10 boosters ────────────────────────────────────────────────────────────

async function openBulk(setId, count, stage = createStage()) {
  const set = setOf(setId);
  const run = ++stage.run;
  stage.element.dataset.phase = 'bulk';
  stage.element.style.cssText = packStyle(set);
  mount(
    stage.content,
    html`<div class="bulk-loading">
      <div class="bulk-loading__packs">${[0, 1, 2].map((i) => html`<span class="pack pack--mini" style="--i:${i}">${packHTML(set)}</span>`)}</div>
      <p class="stage__hint bubble">${t('stage.bulkOpening', { count })}</p>
    </div>`,
  );
  sfx.play('shake');

  let boosters;
  try {
    [boosters] = await Promise.all([openBoosters(setId, count), wait(900)]);
  } catch (err) {
    toast(errorText(err), 'error');
    stage.close();
    return;
  }
  if (stage.closed || stage.run !== run) return;

  const cards = boosters.flatMap((booster) => booster.cards).sort(byRarity);
  const newCount = cards.filter((card) => card.isNew).length;
  const tally = [...state.meta.rarities].reverse().map((rarity) => ({
    rarity,
    count: cards.filter((card) => card.rarity === rarity.id).length,
  }));

  sfx.play('tear');
  mount(
    stage.content,
    html`<div class="bulk">
      <h2 class="bulk__title">${t('stage.bulkTitle', { count, cards: cards.length })}</h2>
      <div class="bulk__tally">
        ${tally.map(({ rarity, count: n }) => html`<span class="tally-chip r-${rarity.id} ${n ? '' : 'is-zero'}">${rarity.id} <b>×${n}</b></span>`)}
        <span class="tally-chip tally-chip--new">${t('stage.bulkNew')} <b>×${newCount}</b></span>
      </div>
      <div class="bulk__grid">
        ${cards.map(
          (card, i) => html`<button class="bulk__item" type="button" data-index="${i}" style="--i:${i}"
              aria-label="${t('stage.revealed', { name: cardText(card).name, rarity: rarityName(card.rarity), isNew: card.isNew ? t('stage.revealedNew') : '' })}">
            ${cardHTML(card, { isNew: card.isNew, interactive: false })}
          </button>`,
        )}
      </div>
      <div class="btn-row">
        <button class="btn btn--primary btn--big" type="button" data-action="bulk">${t('stage.bulkAgain', { count })}</button>
        <button class="btn btn--secondary" type="button" data-action="single">${t('stage.bulkOne')}</button>
        <a class="btn btn--ghost-light" href="#/collection">${t('stage.myCollection')}</a>
      </div>
    </div>`,
  );
  stage.announce(
    t('stage.bulkAnnounce', { cards: cards.length, count: newCount, best: `${cards[0].rarity} ${cardText(cards[0]).name}` }),
  );

  if (['SR', 'SSR', 'UR'].includes(cards[0].rarity)) {
    const title = $('.bulk__title', stage.content).getBoundingClientRect();
    setTimeout(() => celebrate(title, cards[0].rarity), 300);
  }

  stage.content.onclick = (event) => {
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (action === 'bulk') openBulk(set.id, count, stage);
    else if (action === 'single') openSingle(set.id, stage);
    const item = event.target.closest('.bulk__item');
    if (item) openCardModal(cards[Number(item.dataset.index)], { list: cards });
  };
  stage.content.onkeydown = null;
  $('[data-action="bulk"]', stage.content).focus({ preventScroll: true });
}
