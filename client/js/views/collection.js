/** "Collection" page: every card, owned ones face up, missing ones as ??? silhouettes. */
import { $, fmt, html, mount, raw } from '../dom.js';
import { cardText, eraName, rarityName, t, tHtml, typeName } from '../i18n.js';
import { byLocalName, byRarity, state } from '../state.js';
import { cardHTML, lockedCardHTML } from '../components/card.js';
import { openCardModal } from '../components/card-modal.js';
import { toast } from '../ui/toast.js';

// Kept between visits of the page.
const filters = { q: '', show: 'all', rarity: '', type: '', era: '', sort: 'number' };

// The collection on screen: yours, or a friend's (see renderCollection's options).
let owned = new Map();
const ownedEntry = (card) => owned.get(card.id);
const SORTS = {
  number: (a, b) => a.number - b.number,
  rarity: byRarity,
  name: byLocalName,
  year: (a, b) => a.year - b.year || a.number - b.number,
  copies: (a, b) => (ownedEntry(b)?.count ?? 0) - (ownedEntry(a)?.count ?? 0) || a.number - b.number,
  recent: (a, b) =>
    (ownedEntry(b)?.lastPulledAt ?? '').localeCompare(ownedEntry(a)?.lastPulledAt ?? '') || a.number - b.number,
};

const option = (value, label, current) => html`<option value="${value}" ${raw(value === current ? 'selected' : '')}>${label}</option>`;

function progressHTML(player) {
  const { stats } = player;
  const percent = stats.completion * 100;
  return html`<div class="progress">
    <div class="ring" style="--p:${percent.toFixed(1)}" role="img" aria-label="${t('collection.complete', { percent: fmt.percent(stats.completion) })}">
      <span class="ring__value"><b>${stats.uniqueCards}</b>/${stats.totalCards}</span>
    </div>
    <ul class="rarity-bars">
      ${[...state.meta.rarities].reverse().map((rarity) => {
        const { owned, total } = stats.byRarity[rarity.id];
        return html`<li class="r-${rarity.id}" title="${rarityName(rarity.id)}">
          <span class="rarity-badge">${rarity.id}</span>
          <span class="meter"><span class="meter__fill" style="width:${total ? ((owned / total) * 100).toFixed(1) : 0}%"></span></span>
          <span class="rarity-bars__count">${owned}/${total}</span>
        </li>`;
      })}
    </ul>
  </div>`;
}

function visibleCards() {
  const query = filters.q.trim().toLowerCase();
  return state.cards
    .filter((card) => {
      const isOwned = owned.has(card.id);
      if (filters.show === 'owned' && !isOwned) return false;
      if (filters.show === 'missing' && isOwned) return false;
      if (filters.rarity && card.rarity !== filters.rarity) return false;
      if (filters.type && card.type !== filters.type) return false;
      if (filters.era && card.era !== filters.era) return false;
      // Missing cards keep their name secret, so they never match a search.
      if (query) {
        if (!isOwned) return false;
        const text = cardText(card);
        const haystack = `${card.name} ${card.fr?.name ?? ''} ${text.description}`.toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      return true;
    })
    .sort(SORTS[filters.sort] ?? SORTS.number);
}

/** `player` / `owned` show a friend's collection instead of yours. */
export function renderCollection(main, options) {
  const { player = state.player, owned: shown = state.owned } = options ?? {};
  const { meta } = state;
  const friend = player.id !== state.player.id;
  owned = shown;
  mount(
    main,
    html`<section class="view view-collection">
      <header class="view-head">
        <div>
          ${friend && html`<a class="link" href="#/friends">${t('friends.back')}</a>`}
          <h1 class="view-title">${friend ? t('friends.collectionOf', { name: player.name }) : t('collection.title')}</h1>
          <p class="view-sub">${friend
            ? t('friends.collectionSub', { code: player.friendCode, score: fmt.number(player.stats.score) })
            : raw(tHtml('collection.sub'))}</p>
        </div>
        <div class="panel progress-panel">${progressHTML(player)}</div>
      </header>

      <form class="filters panel" role="search" aria-label="${t('collection.filterLabel')}">
        <label class="field field--search">
          <span class="field__label">${t('collection.search')}</span>
          <input class="input" type="search" name="q" placeholder="${t('collection.searchPlaceholder')}" value="${filters.q}" autocomplete="off">
        </label>
        <label class="field">
          <span class="field__label">${t('collection.show')}</span>
          <select class="input" name="show">
            ${option('all', t('collection.all'), filters.show)}${option('owned', t('collection.owned'), filters.show)}${option('missing', t('collection.missing'), filters.show)}
          </select>
        </label>
        <label class="field">
          <span class="field__label">${t('collection.rarity')}</span>
          <select class="input" name="rarity">
            ${option('', t('collection.anyRarity'), filters.rarity)}
            ${[...meta.rarities].reverse().map((r) => option(r.id, `${r.id} · ${rarityName(r.id)}`, filters.rarity))}
          </select>
        </label>
        <label class="field">
          <span class="field__label">${t('collection.type')}</span>
          <select class="input" name="type">
            ${option('', t('collection.anyType'), filters.type)}
            ${meta.types.map((type) => option(type.id, `${type.icon} ${typeName(type.id)}`, filters.type))}
          </select>
        </label>
        <label class="field">
          <span class="field__label">${t('collection.era')}</span>
          <select class="input" name="era">
            ${option('', t('collection.anyEra'), filters.era)}
            ${meta.eras.map((era) => option(era.id, eraName(era.id), filters.era))}
          </select>
        </label>
        <label class="field">
          <span class="field__label">${t('collection.sort')}</span>
          <select class="input" name="sort">
            ${option('number', t('collection.sortNumber'), filters.sort)}${option('rarity', t('collection.sortRarity'), filters.sort)}
            ${option('name', t('collection.sortName'), filters.sort)}${option('year', t('collection.sortYear'), filters.sort)}
            ${option('copies', t('collection.sortCopies'), filters.sort)}${option('recent', t('collection.sortRecent'), filters.sort)}
          </select>
        </label>
      </form>

      <p class="result-count" aria-live="polite"></p>
      <div class="card-grid"></div>
    </section>`,
  );

  const grid = $('.card-grid', main);
  const count = $('.result-count', main);
  let ownedList = [];

  function renderGrid() {
    const cards = visibleCards();
    ownedList = cards.filter((card) => owned.has(card.id));
    count.textContent = cards.length
      ? t('collection.count', { count: cards.length, owned: ownedList.length, missing: cards.length - ownedList.length })
      : '';
    mount(
      grid,
      cards.length
        ? cards.map((card) =>
            owned.has(card.id)
              ? cardHTML(card, { count: ownedEntry(card).count, tilt: true })
              : lockedCardHTML(card),
          )
        : html`<div class="empty panel">
            <p class="empty__title">${t('collection.emptyTitle')}</p>
            <p>${owned.size ? t('collection.emptyFiltered') : t('collection.emptyStart')}</p>
            ${!friend && html`<a class="btn btn--primary" href="#/">${t('collection.openBooster')}</a>`}
          </div>`,
    );
  }

  $('.filters', main).addEventListener('input', (event) => {
    const { name, value } = event.target;
    if (name in filters) {
      filters[name] = value;
      renderGrid();
    }
  });
  $('.filters', main).addEventListener('submit', (event) => event.preventDefault());

  const activate = (target) => {
    const owned = target.closest('.card[data-card]');
    if (owned) {
      openCardModal(state.cardsById.get(owned.dataset.card), { list: ownedList });
      return;
    }
    if (target.closest('.card--locked')) toast(t('collection.locked'), 'info', 2200);
  };
  grid.addEventListener('click', (event) => activate(event.target));
  grid.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      activate(event.target);
    }
  });

  renderGrid();
}
