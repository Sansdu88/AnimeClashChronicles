/**
 * The banner under the menu: the latest drops of the players of the whole world
 * (your friends' first, then the rarest), scrolling as an endless carousel. The
 * list is read again every minute; hovering it stops it, a click shows the card.
 */
import { $, $$, fmt, html, mount, prefersReducedMotion } from '../dom.js';
import { cardText, rarityName, t } from '../i18n.js';
import { fetchDrops, state } from '../state.js';
import { openCardModal } from './card-modal.js';

const REFRESH_MS = 60_000;
const SPEED = 45; // pixels per second

const banner = () => $('#drops');
let drops = [];
let shown = ''; // the drops on screen (the carousel is only rebuilt when they change)
let timer = 0;

function dropHTML(drop, copy) {
  const card = state.cardsById.get(drop.cardId);
  const name = cardText(card).name;
  return html`<button class="drop r-${drop.rarity}${drop.friend ? ' is-friend' : ''}" type="button" data-card="${drop.cardId}"
      ${copy ? html`tabindex="-1"` : ''} aria-label="${t('drops.item', { player: drop.playerName, rarity: rarityName(drop.rarity), card: name })}">
    <span class="drop__art" aria-hidden="true">${card.image && html`<img src="${card.image.src}" alt="" loading="lazy" draggable="false">`}</span>
    <span class="rarity-badge">${drop.rarity}</span>
    <span class="drop__card">${name}</span>
    <span class="drop__who">
      ${drop.friend && html`<span class="drop__friend">★ ${t('drops.friend')}</span>`}
      ${drop.playerName} · <time data-at="${drop.openedAt}" datetime="${drop.openedAt}">${fmt.timeAgo(drop.openedAt)}</time>
    </span>
  </button>`;
}

/**
 * Builds the carousel: one run of the drops, repeated until it fills the banner, then
 * the whole doubled, so that sliding by one half loops without a seam. The copies are
 * hidden from screen readers and from the keyboard.
 */
function paint() {
  const element = banner();
  element.hidden = drops.length === 0;
  if (!drops.length) return;
  const track = $('.drops__track', element);
  mount(track, html`<div class="drops__run">${drops.map((drop) => dropHTML(drop, false))}</div>`);
  if (prefersReducedMotion()) return; // a still list, scrolled by hand
  const runWidth = $('.drops__run', track).offsetWidth;
  if (!runWidth) return;
  const repeats = Math.max(1, Math.ceil($('.drops__viewport', element).clientWidth / runWidth));
  const copy = String(html`<div class="drops__run" aria-hidden="true">${drops.map((drop) => dropHTML(drop, true))}</div>`);
  track.insertAdjacentHTML('beforeend', copy.repeat(repeats * 2 - 1));
  track.style.setProperty('--duration', `${(repeats * runWidth) / SPEED}s`);
}

/** Only the "x min ago" change: no need to start the carousel again. */
function paintTimes() {
  for (const time of $$('#drops [data-at]')) time.textContent = fmt.timeAgo(time.dataset.at);
}

async function refresh() {
  if (document.hidden || !state.player) return;
  try {
    ({ drops } = await fetchDrops());
  } catch {
    return; /* offline or server restarting: next time */
  }
  const key = JSON.stringify(drops);
  if (key !== shown) {
    shown = key;
    paint();
  } else {
    paintTimes();
  }
}

export function startDrops() {
  clearInterval(timer);
  shown = '';
  refresh();
  timer = setInterval(refresh, REFRESH_MS);
}

export function stopDrops() {
  clearInterval(timer);
  drops = [];
  shown = '';
  banner().hidden = true;
}

/** The texts changed language: build the carousel again. */
export function repaintDrops() {
  if (state.player && drops.length) paint();
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && state.player && timer) refresh();
});

// A wider window may need more copies to stay seamless.
let resizing = 0;
window.addEventListener('resize', () => {
  clearTimeout(resizing);
  resizing = setTimeout(repaintDrops, 300);
});

banner().addEventListener('click', (event) => {
  const drop = event.target.closest('[data-card]');
  const card = drop && state.cardsById.get(drop.dataset.card);
  if (card) openCardModal(card);
});
