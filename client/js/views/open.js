/**
 * "Open" page: the booster shelf and the opening stage
 * (shake → tear → 5 face-down cards → flip them one by one).
 * A player can open one booster every 2 minutes (BOOSTER.cooldownSeconds).
 */
import { $, $$, escapeHtml, fmt, html, mount, raw, wait } from '../dom.js';
import { cardText, errorText, rarityName, setName, setTagline, t, tHtml } from '../i18n.js';
import { boosterWait, byRarity, openBoosters, setOf, state } from '../state.js';
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
    </div>
  </div>`;
}

/**
 * Calls `paint(seconds)` now and every second while the wait before the next
 * booster runs (the last call has 0). `paint` returns false to stop.
 */
function countdown(paint) {
  const tick = () => {
    const seconds = boosterWait();
    if (paint(seconds) === false || seconds === 0) return;
    setTimeout(tick, 1000);
  };
  tick();
}

export function renderOpen(main) {
  const { player, meta } = state;
  mount(
    main,
    html`<section class="view view-open">
      <div class="hero">
        <p class="hero__kicker" lang="ja">ブースターを開けよう！</p>
        <h1 class="hero__title">${t('open.title')}</h1>
        <p class="hero__sub">${raw(tHtml('open.sub', { minutes: meta.booster.cooldownSeconds / 60 }))}</p>
      </div>
      <p class="cooldown" role="status" hidden></p>
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
    openSingle(button.dataset.open);
  });

  // While waiting: countdown banner and disabled buttons, then "ready!".
  const banner = $('.cooldown', main);
  const buttons = $$('[data-open]', main);
  let waited = false;
  countdown((seconds) => {
    if (!banner.isConnected) return false; // the page was left or redrawn
    banner.hidden = seconds === 0;
    banner.textContent = `⏳ ${t('open.cooldown', { time: fmt.duration(seconds) })}`;
    for (const button of buttons) button.disabled = seconds > 0;
    if (seconds > 0) waited = true;
    else if (waited && !document.querySelector('.stage')) {
      sfx.play('R');
      toast(t('open.ready'), 'success');
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
          <a class="btn btn--ghost-light" href="#/collection">${t('stage.myCollection')}</a>
        </div>`,
    );
    const again = $('[data-action="again"]', stage.content);
    let waited = false;
    countdown((seconds) => {
      if (!again.isConnected) return false;
      again.disabled = seconds > 0;
      again.textContent = seconds > 0 ? `⏳ ${t('open.cooldown', { time: fmt.duration(seconds) })}` : t('stage.again');
      if (seconds > 0) waited = true;
      else if (waited) sfx.play('R');
      return true;
    });
    (again.disabled ? $('.btn-row a', stage.content) : again).focus({ preventScroll: true });
  }

  stage.content.onclick = (event) => {
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (action === 'reveal-all') revealAll();
    else if (action === 'again') openSingle(set.id, stage);
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
