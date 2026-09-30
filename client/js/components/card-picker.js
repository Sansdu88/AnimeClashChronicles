/** Dialog to choose one of your cards (for a trade): a searchable, filterable grid. */
import { $, html, mount } from '../dom.js';
import { cardText, rarityName, t } from '../i18n.js';
import { state } from '../state.js';
import { cardHTML } from './card.js';
import { openModal } from './modal.js';

/**
 * `entries`: [{ card, count, spare, note, highlight }] — only cards with `spare`
 * copies (not promised in other trades) can be picked; `highlight` marks the
 * cards the friend does not have yet, labelled `highlightLabel`.
 * Resolves to the chosen card id, or null when the dialog is closed.
 */
export function pickCard({ title, sub, entries, highlightLabel }) {
  return new Promise((resolve) => {
    let chosen = null;
    const filters = { q: '', rarity: '', missing: false };
    const hasHighlights = entries.some((entry) => entry.highlight);

    const modal = openModal(
      html`<div class="picker">
        <h2 class="dialog__title">${title}</h2>
        ${sub && html`<p class="dialog__text">${sub}</p>`}
        <form class="picker__filters" role="search">
          <label class="field field--search">
            <span class="field__label">${t('collection.search')}</span>
            <input class="input" type="search" name="q" placeholder="${t('collection.searchPlaceholder')}" autocomplete="off">
          </label>
          <label class="field">
            <span class="field__label">${t('collection.rarity')}</span>
            <select class="input" name="rarity">
              <option value="">${t('collection.anyRarity')}</option>
              ${[...state.meta.rarities].reverse().map((r) => html`<option value="${r.id}">${r.id} · ${rarityName(r.id)}</option>`)}
            </select>
          </label>
          ${hasHighlights && html`<label class="check">
            <input type="checkbox" name="missing"> <span>${t('trades.onlyMissing')}</span>
          </label>`}
        </form>
        <p class="result-count" aria-live="polite"></p>
        <ul class="picker__grid"></ul>
      </div>`,
      { label: title, className: 'modal--picker', onClose: () => resolve(chosen) },
    );

    const grid = $('.picker__grid', modal.body);
    const count = $('.result-count', modal.body);

    function renderGrid() {
      const query = filters.q.trim().toLowerCase();
      const shown = entries.filter(({ card, highlight }) => {
        if (filters.rarity && card.rarity !== filters.rarity) return false;
        if (filters.missing && !highlight) return false;
        if (!query) return true;
        return `${card.name} ${card.fr?.name ?? ''} ${cardText(card).description}`.toLowerCase().includes(query);
      });
      count.textContent = t('trades.pickCount', { count: shown.length });
      mount(
        grid,
        shown.length
          ? shown.map(
              (entry) => html`<li class="picker__item ${entry.spare > 0 ? '' : 'is-disabled'}">
                ${cardHTML(entry.card, { count: entry.count, interactive: entry.spare > 0 })}
                ${entry.highlight && html`<span class="picker__tag">${highlightLabel}</span>`}
                <span class="picker__note">${entry.note}</span>
              </li>`,
            )
          : html`<li class="empty"><p>${t('collection.emptyFiltered')}</p></li>`,
      );
    }

    const form = $('.picker__filters', modal.body);
    form.addEventListener('input', (event) => {
      const { name, type, checked, value } = event.target;
      if (name in filters) {
        filters[name] = type === 'checkbox' ? checked : value;
        renderGrid();
      }
    });
    form.addEventListener('submit', (event) => event.preventDefault());

    const pick = (target) => {
      const card = target.closest('.picker__item:not(.is-disabled) .card[data-card]');
      if (!card) return;
      chosen = card.dataset.card;
      modal.close();
    };
    grid.addEventListener('click', (event) => pick(event.target));
    grid.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        pick(event.target);
      }
    });

    renderGrid();
    form.elements.q.focus();
  });
}
