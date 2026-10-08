/**
 * The showcase of a profile: up to 10 cards a player chose among theirs (player.showcase).
 * Yours is changed on your profile (#/profile): add a card in an empty slot, move it with
 * the arrows, take it out with ✕ (saved at once). Your friends see it on your page (#/friends/<id>).
 */
import { $, html, mount, raw } from '../dom.js';
import { cardText, errorText, t } from '../i18n.js';
import { byRarity, saveShowcase, state } from '../state.js';
import { cardHTML } from './card.js';
import { openCardModal } from './card-modal.js';
import { pickCard } from './card-picker.js';
import { toast } from '../ui/toast.js';

export const SHOWCASE_SIZE = 10;

/** The cards of a showcase that the catalog knows. */
const cardsOf = (ids) => ids.map((id) => state.cardsById.get(id)).filter(Boolean);

/** Your cards for the picker, rarest first; the ones already in the showcase cannot be picked again. */
function pickerEntries(ids) {
  return [...state.owned.values()]
    .map((entry) => ({ card: state.cardsById.get(entry.cardId), count: entry.count }))
    .filter(({ card }) => card)
    .sort((a, b) => byRarity(a.card, b.card))
    .map(({ card, count }) => {
      const shown = ids.includes(card.id);
      return { card, count, spare: shown ? 0 : 1, note: shown ? t('showcase.already') : '' };
    });
}

/**
 * Draws a showcase in `container`. `editable`: yours, with its tools and empty slots; else a
 * friend's (`name`), read-only. `onChange(ids)`: called after each change is saved.
 */
export function mountShowcase(container, { cardIds = [], editable = false, name = '', onChange } = {}) {
  let cards = cardsOf(cardIds);
  let busy = false;

  const tool = (action, index, label, symbol, disabled = false) =>
    html`<button class="showcase__tool" type="button" data-action="${action}" data-index="${index}"
      aria-label="${label}" title="${label}" ${raw(disabled ? 'disabled' : '')}>${symbol}</button>`;

  function paint() {
    if (!editable && !cards.length) {
      mount(container, html`<p class="muted showcase__empty">${t('showcase.friendEmpty', { name })}</p>`);
      return;
    }
    const empty = editable ? SHOWCASE_SIZE - cards.length : 0;
    mount(
      container,
      html`<ol class="showcase${editable ? ' showcase--edit' : ''}">
        ${cards.map((card, i) => {
          const cardName = cardText(card).name;
          return html`<li class="showcase__slot">
            ${cardHTML(card, { tilt: true })}
            ${editable && html`<div class="showcase__tools">
              ${tool('left', i, t('showcase.left', { name: cardName }), '◀', i === 0)}
              ${tool('remove', i, t('showcase.remove', { name: cardName }), '✕')}
              ${tool('right', i, t('showcase.right', { name: cardName }), '▶', i === cards.length - 1)}
            </div>`}
          </li>`;
        })}
        ${Array.from(
          { length: empty },
          () => html`<li class="showcase__slot showcase__slot--empty">
            <button class="showcase__add" type="button" data-action="add">
              <span class="showcase__plus" aria-hidden="true">+</span>
              <span>${t('showcase.add')}</span>
            </button>
          </li>`,
        )}
      </ol>`,
    );
  }

  /**
   * Saves the showcase `next` (card ids). Once it is redrawn, the focus goes to the first element
   * found among the selectors `focus` (the keyboard stays where it was), else to an empty slot.
   */
  async function save(next, focus = []) {
    busy = true;
    container.setAttribute('aria-busy', 'true');
    try {
      cards = cardsOf(await saveShowcase(next));
      paint();
      onChange?.(cards.map((card) => card.id));
      const target = [...focus, '.showcase__add'].map((selector) => $(selector, container)).find(Boolean);
      target?.focus({ preventScroll: true });
    } catch (err) {
      toast(errorText(err), 'error');
    } finally {
      busy = false;
      container.removeAttribute('aria-busy');
    }
  }

  async function add() {
    const ids = cards.map((card) => card.id);
    const entries = pickerEntries(ids);
    if (!entries.length) {
      toast(t('showcase.noCards'), 'info');
      return;
    }
    const cardId = await pickCard({
      title: t('showcase.pickTitle'),
      sub: t('showcase.pickSub', { slot: ids.length + 1, size: SHOWCASE_SIZE }),
      entries,
    });
    if (cardId && !busy) await save([...ids, cardId], [`.showcase__slot:nth-child(${ids.length + 1}) .card`]);
  }

  /** Swaps the card `index` with its neighbour `index + step`. */
  function move(index, step) {
    const ids = cards.map((card) => card.id);
    const to = index + step;
    if (to < 0 || to >= ids.length) return;
    [ids[index], ids[to]] = [ids[to], ids[index]];
    const button = step < 0 ? 'left' : 'right';
    save(ids, [`[data-action="${button}"][data-index="${to}"]:not(:disabled)`, `.showcase__slot:nth-child(${to + 1}) .card`]);
  }

  const open = (target) => {
    const card = target.closest('.card[data-card]');
    if (card) openCardModal(state.cardsById.get(card.dataset.card), { list: cards });
    return Boolean(card);
  };

  container.addEventListener('click', (event) => {
    if (open(event.target)) return;
    const button = event.target.closest('[data-action]');
    if (!button || busy) return;
    const index = Number(button.dataset.index);
    if (button.dataset.action === 'add') add();
    else if (button.dataset.action === 'left') move(index, -1);
    else if (button.dataset.action === 'right') move(index, 1);
    else if (button.dataset.action === 'remove') {
      // The focus goes to the card that takes its place, else the one before.
      save(
        cards.filter((_, i) => i !== index).map((card) => card.id),
        [`.showcase__slot:nth-child(${index + 1}) .card`, `.showcase__slot:nth-child(${index}) .card`],
      );
    }
  });
  container.addEventListener('keydown', (event) => {
    if ((event.key === 'Enter' || event.key === ' ') && event.target.matches('.card[data-card]')) {
      event.preventDefault();
      open(event.target);
    }
  });

  paint();
}
