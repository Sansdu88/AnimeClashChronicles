import { fmt, html, raw } from '../dom.js';
import { cardText, rarityName, setName, t, typeName } from '../i18n.js';
import { state, typeOf } from '../state.js';
import { EVENT_ICONS, eventOf } from '../events.js';
import { cardHTML } from './card.js';
import { openModal } from './modal.js';

function detailHTML(card, position) {
  const owned = state.owned.get(card.id);
  const text = cardText(card);
  const type = typeOf(card.type);
  // The booster it comes from: its event's, or the one of its era.
  const eraSet = (card.event && eventOf(card.event)?.set) || (state.meta.sets.find((set) => set.era === card.era) ?? { id: 'all-stars' });
  const english = raw(text.translated ? '' : 'lang="en"');

  return html`<div class="detail">
    <div class="detail__visual">
      ${cardHTML(card, { tilt: true, interactive: false, lazy: false, count: owned?.count ?? 0 })}
      <p class="detail__hint">${t('detail.hint')}</p>
    </div>
    <div class="detail__info">
      <p class="detail__kicker">
        #${fmt.pad(card.number)} · ${setName(eraSet.id)}
        ${position && html`<span class="detail__position">${position}</span>`}
      </p>
      <h2 class="detail__title">${text.name}</h2>
      <div class="detail__tags">
        <span class="tag tag--rarity r-${card.rarity}">${card.rarity} · ${rarityName(card.rarity)}</span>
        ${card.event && html`<span class="tag tag--event ev-${card.event}">${EVENT_ICONS[card.event]} ${t(`events.${card.event}.card`)}</span>`}
        <span class="tag tag--type" style="--type:${type.color}">${type.icon} ${typeName(card.type)}</span>
        <span class="tag">📅 ${card.year}</span>
        <span class="tag">⚡ PWR ${card.power}</span>
      </div>
      ${text.description && html`<p class="detail__desc">${card.event ? t(`events.${card.event}.monster`, { monster: text.description }) : text.description}</p>`}
      ${!text.translated && html`<p class="detail__note">${t('detail.englishOnly')}</p>`}
      <div class="detail__summary" ${english}>${text.summary.split(/\n+/).map((p) => html`<p>${p}</p>`)}</div>
      <dl class="detail__facts">
        <div><dt>${t('detail.copies')}</dt><dd>${owned ? owned.count : 0}</dd></div>
        <div><dt>${t('detail.firstPulled')}</dt><dd>${owned ? fmt.date(owned.firstPulledAt) : '—'}</dd></div>
        <div><dt>${t('detail.views')}</dt><dd>${fmt.number(card.views)}</dd></div>
      </dl>
      <div class="detail__links">
        <a class="btn btn--primary" href="${text.wikipediaUrl}" target="_blank" rel="noopener noreferrer">${t('detail.read')}</a>
        ${card.image?.credit && html`<a class="link-muted" href="${card.image.credit}" target="_blank" rel="noopener noreferrer">${t('detail.picture')}</a>`}
      </div>
    </div>
  </div>`;
}

/** Shows a card in big with its Wikipedia summary. `list` enables ← → navigation. */
export function openCardModal(card, { list = null } = {}) {
  const cards = list && list.length > 1 ? list : null;
  let index = cards ? Math.max(0, cards.findIndex((c) => c.id === card.id)) : 0;
  const position = () => (cards ? `${index + 1} / ${cards.length}` : null);

  const modal = openModal(detailHTML(card, position()), { label: cardText(card).name, className: 'modal--card' });
  if (!cards) return modal;

  const nav = document.createElement('div');
  nav.className = 'modal__nav';
  nav.innerHTML = String(html`
    <button class="modal__arrow" type="button" data-step="-1" aria-label="${t('detail.previous')}">‹</button>
    <button class="modal__arrow" type="button" data-step="1" aria-label="${t('detail.next')}">›</button>`);
  modal.root.querySelector('.modal__panel').append(nav);

  const go = (step) => {
    index = (index + step + cards.length) % cards.length;
    modal.setContent(detailHTML(cards[index], position()));
    modal.setLabel(cardText(cards[index]).name);
  };
  nav.addEventListener('click', (event) => {
    const button = event.target.closest('[data-step]');
    if (button) go(Number(button.dataset.step));
  });
  modal.root.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowLeft') go(-1);
    if (event.key === 'ArrowRight') go(1);
  });
  return modal;
}
