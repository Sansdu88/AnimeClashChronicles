/**
 * Card rendering: face, back, "not collected yet" silhouette, and the
 * holographic tilt effect that follows the pointer.
 */
import { fmt, html, prefersReducedMotion, raw } from '../dom.js';
import { cardText, eraName, rarityName, t, typeName } from '../i18n.js';
import { state, typeOf } from '../state.js';

const FULL_ART = new Set(['SSR', 'UR', 'REV']);

function nameSize(name) {
  if (name.length > 30) return 'xs';
  if (name.length > 22) return 's';
  if (name.length > 14) return 'm';
  return 'l';
}

/**
 * @param card        card from the API
 * @param count       copies owned (a ×N badge is shown above 1)
 * @param isNew       shows a NEW! sticker
 * @param tilt        enables the 3D/holo effect
 * @param interactive makes the card focusable and clickable on its own
 * @param lazy        lazy-load the picture
 */
export function cardHTML(card, { count = 0, isNew = false, tilt = false, interactive = true, lazy = true } = {}) {
  const type = typeOf(card.type);
  const text = cardText(card);
  const classes = ['card', `r-${card.rarity}`, FULL_ART.has(card.rarity) && 'is-fullart', !card.image && 'no-image']
    .filter(Boolean)
    .join(' ');
  const attributes = [tilt && 'data-tilt', interactive && `tabindex="0" role="button"`].filter(Boolean);

  return html`<article class="${classes}" data-card="${card.id}" style="--type:${type.color}" ${raw(attributes.join(' '))}
      aria-label="${t('card.label', { name: text.name, rarity: rarityName(card.rarity) })}">
    <div class="card__frame">
      <div class="card__art">
        ${card.image && html`<img class="card__img" src="${card.image.src}" alt="${text.name}" loading="${lazy ? 'lazy' : 'eager'}" decoding="async" draggable="false">`}
        <span class="card__art-fallback" aria-hidden="true">${type.icon}</span>
      </div>
      <header class="card__head">
        <span class="card__name" data-size="${nameSize(text.name)}">${text.name}</span>
        <span class="card__rarity">${card.rarity}</span>
      </header>
      <div class="card__body">
        <div class="card__meta">
          <span class="card__type">${type.icon} ${typeName(card.type)}</span>
          <span class="card__year">${card.year}</span>
        </div>
        <p class="card__desc">${text.description}</p>
        <p class="card__text" ${raw(text.translated ? '' : 'lang="en"')}>${text.short}</p>
        <footer class="card__foot">
          <span class="card__num">#${fmt.pad(card.number)}/${state.cards.length}</span>
          <span class="card__power">PWR ${card.power}</span>
          <span class="card__era" title="${t('card.era', { era: eraName(card.era) })}">${eraName(card.era)}</span>
        </footer>
      </div>
      <div class="card__shine" aria-hidden="true"></div>
      <div class="card__glare" aria-hidden="true"></div>
    </div>
    ${isNew && html`<span class="card__new" aria-label="${t('card.newLabel')}">${t('card.new')}</span>`}
    ${count > 1 && html`<span class="card__count" title="${t('card.copies', { count })}">×${count}</span>`}
  </article>`;
}

/** Silhouette for a card the player does not own yet. */
export function lockedCardHTML(card) {
  return html`<article class="card card--locked r-${card.rarity}" data-locked="${card.id}" tabindex="0" role="button"
      aria-label="${t('card.locked', { number: card.number, rarity: rarityName(card.rarity) })}">
    <div class="card__frame">
      <span class="locked__num">#${fmt.pad(card.number)}</span>
      <span class="locked__mark" aria-hidden="true">?</span>
      <span class="locked__name">???</span>
      <span class="locked__rarity">${card.rarity}</span>
    </div>
  </article>`;
}

export function cardBackHTML() {
  return html`<div class="card-back" aria-hidden="true">
    <div class="card-back__rays"></div>
    <div class="card-back__seal">
      <span class="card-back__logo">ANIME<br>CLASH</span>
      <span class="card-back__name">CHRONICLES</span>
    </div>
  </div>`;
}

/** Pointer-driven 3D tilt + holographic glare for every `.card[data-tilt]`. */
export function enableCardEffects() {
  const reset = (card) => {
    card.classList.remove('is-active');
    for (const prop of ['--rx', '--ry', '--mx', '--my', '--glare']) card.style.removeProperty(prop);
  };

  document.addEventListener('pointermove', (event) => {
    const card = event.target.closest?.('.card[data-tilt]');
    if (!card) return;
    const box = card.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width));
    const y = Math.min(1, Math.max(0, (event.clientY - box.top) / box.height));
    card.classList.add('is-active');
    card.style.setProperty('--mx', `${(x * 100).toFixed(1)}%`);
    card.style.setProperty('--my', `${(y * 100).toFixed(1)}%`);
    card.style.setProperty('--glare', Math.hypot(x - 0.5, y - 0.5).toFixed(3));
    if (!prefersReducedMotion()) {
      card.style.setProperty('--rx', `${((0.5 - y) * 22).toFixed(2)}deg`);
      card.style.setProperty('--ry', `${((x - 0.5) * 26).toFixed(2)}deg`);
    }
  });

  document.addEventListener('pointerout', (event) => {
    const card = event.target.closest?.('.card[data-tilt]');
    if (card && !card.contains(event.relatedTarget)) reset(card);
  });

  // A picture that fails to load (offline…) falls back to the type emblem.
  document.addEventListener(
    'error',
    (event) => {
      if (event.target instanceof HTMLImageElement && event.target.classList.contains('card__img')) {
        event.target.closest('.card')?.classList.add('no-image');
      }
    },
    true,
  );
}
