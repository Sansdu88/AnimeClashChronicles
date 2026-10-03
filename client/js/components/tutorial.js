/**
 * The tutorial: a guided tour of the game, shown to new players and replayed from the Stats
 * page. A spotlight goes from one part of the screen to the next (the booster stocks, the
 * shelf, each page of the menu) with a speech bubble that explains it. Computers and phones
 * have their own tour: the menu is at the top of a computer screen, while a phone has a tab
 * bar at the bottom and the other pages in the "More" sheet. It runs on the "Open" page.
 */
import { $, $$, html, raw, storage } from '../dom.js';
import { t, tHtml } from '../i18n.js';
import { state } from '../state.js';
import { pushLayer } from '../ui/layers.js';
import { sfx } from '../ui/sfx.js';

const SEEN_KEY = 'animeClashChronicles.tutorial';
const PHONE = window.matchMedia('(max-width: 760px)'); // the app layout of base.css
const FOCUSABLE = 'button:not([disabled])';

/**
 * The steps: `target` = what the spotlight shows (a selector: several elements are shown
 * together; none = the bubble in the middle of the screen), `scroll` = scroll the page to it,
 * `wide` = a wider (so shorter) bubble for a target as wide as the page, `sheet` = open the
 * "More" sheet of phones for this step.
 */
const FIRST_STEPS = [
  { id: 'welcome' },
  { id: 'stocks', target: '.view-open .stocks .stock', scroll: true, wide: true },
];
const DESKTOP_STEPS = [
  ...FIRST_STEPS,
  { id: 'shelf', target: '.view-open .shelf .pack', scroll: true, wide: true },
  { id: 'daily', target: '.nav a[data-route="daily"]' },
  { id: 'market', target: '.nav a[data-route="market"]' },
  { id: 'kira', target: '#kira-chip' },
  { id: 'collection', target: '.nav a[data-route="collection"]' },
  { id: 'social', target: '.nav a[data-route="friends"], .nav a[data-route="trades"]' },
  { id: 'statsRules', target: '.nav a[data-route="stats"], .nav a[data-route="rules"]' },
  { id: 'profile', target: '#player-chip' },
  { id: 'end' },
];
const PHONE_STEPS = [
  ...FIRST_STEPS,
  // The shelf is two packs wide on a phone: the first row is enough.
  { id: 'shelf', target: '.view-open .shelf > .pack-tile:nth-child(-n+2)', scroll: true },
  { id: 'daily', target: '.nav a[data-route="daily"]' },
  { id: 'market', target: '.nav a[data-route="market"]' },
  { id: 'kira', target: '#kira-chip' },
  { id: 'collection', target: '.nav a[data-route="collection"]' },
  { id: 'more', target: '#nav-more' },
  { id: 'sheet', target: '#more-sheet .sheet__links, #more-sheet .sheet__settings', sheet: true },
  { id: 'end' },
];

const stepsFor = (phone) => (phone ? PHONE_STEPS : DESKTOP_STEPS);

/** Whether the player has seen (finished or skipped) the tutorial in this browser. */
const seen = (playerId) => storage.get(`${SEEN_KEY}.${playerId}`) === 'done';

/** New players get the tutorial once: those who have not opened a booster yet. */
export const shouldShowTutorial = (player) => !seen(player.id) && player.stats.boostersOpened === 0;

let current = null; // the tutorial on screen: { close }

/** The rarities, from the most common to the rarest: N → R → … → REV. */
const ladderHTML = () =>
  html`<p class="tour__ladder">${state.meta.rarities.map(
    (rarity, i) => html`${i > 0 && html`<span class="tour__ladder-arrow" aria-hidden="true">→</span>`}<span class="mini-chip r-${rarity.id}"><b>${rarity.id}</b></span>`,
  )}</p>`;

/** The texts of a step, with the live numbers of the game (they can change in the admin panel). */
function stepHTML(step) {
  const { meta, player } = state;
  const key = `tour.steps.${step.id}`;
  const params = {
    name: player.name,
    total: meta.totalCards,
    era: meta.stocks.era.cooldownSeconds / 60,
    stars: meta.stocks['all-stars'].cooldownSeconds / 60,
    max: meta.stocks.era.stackMax,
    size: meta.booster.size,
    count: meta.daily.superEvery,
  };
  const icon = { welcome: '🎴', end: '🍀' }[step.id];
  return html`${icon && html`<p class="tour__icon" aria-hidden="true">${icon}</p>`}
    <h2 class="tour__title" id="tour-title">${t(`${key}.title`, params)}</h2>
    <div class="tour__text" id="tour-text">
      <p>${raw(tHtml(`${key}.text`, params))}</p>
      ${step.id === 'welcome' && html`${ladderHTML()}<p>${t(`${key}.after`)}</p>`}
    </div>`;
}

/** The box around all the elements of `selector` that are on screen, or null. */
function targetBox(selector) {
  const boxes = $$(selector)
    .map((element) => element.getBoundingClientRect())
    .filter((box) => box.width > 0 && box.height > 0);
  if (!boxes.length) return null;
  const left = Math.min(...boxes.map((box) => box.left));
  const top = Math.min(...boxes.map((box) => box.top));
  const right = Math.max(...boxes.map((box) => box.right));
  const bottom = Math.max(...boxes.map((box) => box.bottom));
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

const clamp = (value, min, max) => Math.max(min, Math.min(value, Math.max(min, max)));

/**
 * Starts the tutorial (on the "Open" page). `onClose` is called when it ends, finished or
 * skipped; either way it counts as seen.
 */
export function startTutorial({ onClose } = {}) {
  if (current) return;
  const previousFocus = document.activeElement;
  let phone = PHONE.matches;
  let steps = stepsFor(phone);
  let index = 0;
  let openedSheet = false; // the tutorial opened the "More" sheet: it closes it
  let frame = 0;
  let placed = ''; // last position painted (nothing is written while it stays the same)

  const root = document.createElement('div');
  root.className = 'tour';
  root.innerHTML = String(html`<div class="tour__spot" aria-hidden="true"></div>
    <div class="tour__bubble" role="dialog" aria-modal="true" aria-label="${t('tour.label')}" tabindex="-1">
      <div class="tour__inner">
        <p class="tour__count"></p>
        <div class="tour__body" aria-live="polite"></div>
        <div class="tour__dots" aria-hidden="true"></div>
        <div class="tour__actions">
          <button class="link-button tour__skip" type="button" data-tour="skip">${t('tour.skip')}</button>
          <span class="tour__buttons">
            <button class="btn btn--ghost" type="button" data-tour="back">← ${t('tour.back')}</button>
            <button class="btn btn--primary" type="button" data-tour="next"></button>
          </span>
        </div>
      </div>
    </div>`);
  const spot = $('.tour__spot', root);
  const bubble = $('.tour__bubble', root);
  const nextButton = $('[data-tour="next"]', root);
  const backButton = $('[data-tour="back"]', root);
  document.body.append(root);
  document.body.classList.add('has-tour');
  const removeLayer = pushLayer(close);

  const sheet = $('#more-sheet');
  const sheetOpen = () => sheet.classList.contains('is-open');

  function leaveStep() {
    if (openedSheet && sheetOpen()) $('[data-close-sheet]', sheet).click();
    openedSheet = false;
  }

  /** Scrolls the page so the target sits under the header, with room for the bubble below. */
  function bringIntoView(step) {
    const element = step.target && $(step.target);
    if (!element) return;
    if (!step.scroll) {
      // A link of the menu: the menu itself scrolls sideways on mid-size screens.
      element.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      return;
    }
    const header = $('.topbar').getBoundingClientRect().bottom;
    window.scrollTo({ top: window.scrollY + element.getBoundingClientRect().top - header - 16 });
  }

  function showStep(next) {
    leaveStep();
    index = next;
    const step = steps[index];
    if (step.sheet && !sheetOpen()) {
      $('#nav-more').click();
      openedSheet = true;
    }
    const last = index === steps.length - 1;
    $('.tour__count', root).textContent = `${index + 1} / ${steps.length}`;
    $('.tour__body', root).innerHTML = String(stepHTML(step));
    $('.tour__dots', root).innerHTML = String(
      html`${steps.map((_, i) => html`<span class="${i === index ? 'is-current' : i < index ? 'is-done' : ''}"></span>`)}`,
    );
    nextButton.textContent = index === 0 ? t('tour.start') : last ? t('tour.done') : `${t('tour.next')} →`;
    backButton.hidden = index === 0;
    $('[data-tour="skip"]', root).hidden = last;
    root.classList.toggle('tour--centered', !step.target);
    bubble.classList.toggle('tour__bubble--wide', Boolean(step.wide));
    // The bubble pops in again for each step.
    bubble.classList.remove('is-popping');
    void bubble.offsetWidth;
    bubble.classList.add('is-popping');
    if (step.id === 'welcome') window.scrollTo({ top: 0 });
    else bringIntoView(step);
    placed = '';
    nextButton.focus({ preventScroll: true });
  }

  /** Puts the spotlight on the target and the bubble next to it; called on every frame. */
  function place() {
    frame = requestAnimationFrame(place);
    const step = steps[index];
    const box = step.target ? targetBox(step.target) : null;
    const width = document.documentElement.clientWidth;
    const height = window.innerHeight;
    const bubbleWidth = bubble.offsetWidth;
    const bubbleHeight = bubble.offsetHeight;
    const pad = 6;
    const gap = 18;

    let spotBox;
    let left;
    let top;
    let side = '';
    let arrow = 0;
    if (!box) {
      // Nothing to show (a step in the middle, or the target is not on screen): the bubble is centered.
      spotBox = { left: width / 2, top: height / 2, width: 0, height: 0 };
      left = (width - bubbleWidth) / 2;
      top = (height - bubbleHeight) / 2;
    } else {
      spotBox = { left: box.left - pad, top: box.top - pad, width: box.width + pad * 2, height: box.height + pad * 2 };
      const below = height - (box.bottom + pad + gap);
      const above = box.top - pad - gap;
      if (below >= bubbleHeight || below >= above) {
        side = below >= bubbleHeight ? 'below' : '';
        top = Math.min(box.bottom + pad + gap, height - bubbleHeight - 12);
      } else {
        side = above >= bubbleHeight ? 'above' : '';
        top = Math.max(box.top - pad - gap - bubbleHeight, 12);
      }
      left = clamp(box.left + box.width / 2 - bubbleWidth / 2, 12, width - bubbleWidth - 12);
      arrow = clamp(box.left + box.width / 2 - left, 26, bubbleWidth - 26);
    }

    const position = [spotBox.left, spotBox.top, spotBox.width, spotBox.height, left, top, side, arrow].map((n) => (typeof n === 'number' ? Math.round(n) : n)).join(' ');
    if (position === placed) return;
    placed = position;
    spot.style.transform = `translate(${Math.round(spotBox.left)}px, ${Math.round(spotBox.top)}px)`;
    spot.style.width = `${Math.round(spotBox.width)}px`;
    spot.style.height = `${Math.round(spotBox.height)}px`;
    bubble.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
    bubble.style.setProperty('--arrow-x', `${Math.round(arrow)}px`);
    bubble.classList.toggle('tour__bubble--below', side === 'below');
    bubble.classList.toggle('tour__bubble--above', side === 'above');
    // No glide from the top left corner the first time.
    if (!root.classList.contains('is-ready')) requestAnimationFrame(() => root.classList.add('is-ready'));
  }

  function go(delta) {
    const next = index + delta;
    if (next < 0) return;
    sfx.play('click');
    if (next >= steps.length) close({ finished: true });
    else showStep(next);
  }

  root.addEventListener('click', (event) => {
    const action = event.target.closest('[data-tour]')?.dataset.tour;
    if (action === 'next') go(1);
    else if (action === 'back') go(-1);
    else if (action === 'skip') close();
  });

  // Escape ends the tutorial (even with the "More" sheet open over the page), the arrows go
  // from step to step, and Tab stays in the bubble.
  function onKey(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if (event.key === 'ArrowRight' && !event.target.matches?.('input, textarea')) {
      event.preventDefault();
      go(1);
    } else if (event.key === 'ArrowLeft' && !event.target.matches?.('input, textarea')) {
      event.preventDefault();
      go(-1);
    } else if (event.key === 'Tab') {
      const items = $$(FOCUSABLE, bubble).filter((element) => element.offsetParent !== null);
      if (!items.length) return;
      const [first, last] = [items[0], items.at(-1)];
      if (!bubble.contains(document.activeElement)) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  }
  document.addEventListener('keydown', onKey, true);

  // The window crosses the phone width: the tour of the other layout goes on at the same step.
  function onLayout() {
    if (PHONE.matches === phone) return;
    leaveStep();
    const id = steps[index].id;
    phone = PHONE.matches;
    steps = stepsFor(phone);
    const same = steps.findIndex((step) => step.id === id);
    showStep(same === -1 ? Math.min(index, steps.length - 1) : same);
  }
  PHONE.addEventListener('change', onLayout);

  function close({ finished = false } = {}) {
    if (current?.close !== close) return;
    current = null;
    cancelAnimationFrame(frame);
    document.removeEventListener('keydown', onKey, true);
    PHONE.removeEventListener('change', onLayout);
    leaveStep();
    removeLayer();
    storage.set(`${SEEN_KEY}.${state.player.id}`, 'done');
    root.classList.add('is-leaving');
    setTimeout(() => root.remove(), 250);
    document.body.classList.remove('has-tour');
    // Finished: straight to the first booster to open.
    const firstPack = finished && $('.view-open .pack-tile [data-open][data-count="1"].btn:not([disabled])');
    if (firstPack) {
      firstPack.scrollIntoView({ block: 'center' });
      firstPack.focus({ preventScroll: true });
    } else {
      previousFocus?.focus?.({ preventScroll: true });
    }
    onClose?.();
  }

  current = { close };
  showStep(0);
  place();
}
