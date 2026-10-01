/**
 * "Collection" page: every card, owned ones face up, missing ones as ??? silhouettes,
 * 50 or 100 per page.
 */
import { $, $$, fmt, html, mount, raw } from '../dom.js';
import { cardText, eraName, rarityName, t, tHtml, typeName } from '../i18n.js';
import { byLocalName, byRarity, state } from '../state.js';
import { cardHTML, lockedCardHTML } from '../components/card.js';
import { openCardModal } from '../components/card-modal.js';
import { PAGE_SIZES, onPageClick, pageCount, pageSize, paginationHTML } from '../components/pagination.js';
import { toast } from '../ui/toast.js';

// Kept between visits of the page (the page number too, unless it shows another player's cards).
const filters = { q: '', show: 'all', rarity: '', type: '', era: '', copies: '', sort: 'number' };
const DEFAULT_FILTERS = { ...filters };
// Phones: the filters other than the search are folded behind a button.
let filtersOpen = false;
const paging = { page: 1, playerId: null };

// The collection on screen: yours, or a friend's (see renderCollection's options).
let owned = new Map();
const ownedEntry = (card) => owned.get(card.id);
const copiesOf = (card) => ownedEntry(card)?.count ?? 0;
const SORTS = {
  number: (a, b) => a.number - b.number,
  rarity: byRarity,
  name: byLocalName,
  year: (a, b) => a.year - b.year || a.number - b.number,
  copies: (a, b) => copiesOf(b) - copiesOf(a) || a.number - b.number,
  // Fewest copies first; the cards not owned come last.
  fewest: (a, b) => (copiesOf(a) || Infinity) - (copiesOf(b) || Infinity) || a.number - b.number,
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
      // Copies: exactly ×1 to ×4, "5" = ×5 or more, "dupes" = ×2 or more (cards not owned never match).
      if (filters.copies) {
        const count = copiesOf(card);
        if (filters.copies === 'dupes' ? count < 2 : filters.copies === '5' ? count < 5 : count !== Number(filters.copies)) {
          return false;
        }
      }
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
  if (paging.playerId !== player.id) Object.assign(paging, { page: 1, playerId: player.id });
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
        <button class="filters__toggle" type="button" aria-expanded="false">
          <span aria-hidden="true">⚙</span> ${t('collection.filters')} <span class="filters__count"></span>
        </button>
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
          <span class="field__label">${t('collection.copies')}</span>
          <select class="input" name="copies">
            ${option('', t('collection.anyCopies'), filters.copies)}
            ${['1', '2', '3', '4'].map((n) => option(n, `×${n}`, filters.copies))}
            ${option('5', t('collection.copiesOrMore', { count: 5 }), filters.copies)}
            ${option('dupes', t('collection.duplicates'), filters.copies)}
          </select>
        </label>
        <label class="field">
          <span class="field__label">${t('collection.sort')}</span>
          <select class="input" name="sort">
            ${option('number', t('collection.sortNumber'), filters.sort)}${option('rarity', t('collection.sortRarity'), filters.sort)}
            ${option('name', t('collection.sortName'), filters.sort)}${option('year', t('collection.sortYear'), filters.sort)}
            ${option('copies', t('collection.sortCopies'), filters.sort)}${option('fewest', t('collection.sortFewest'), filters.sort)}
            ${option('recent', t('collection.sortRecent'), filters.sort)}
          </select>
        </label>
      </form>

      <div class="result-bar">
        <p class="result-count" aria-live="polite"></p>
        <label class="page-size">
          <span>${t('pager.perPage')}</span>
          <select class="input" name="pageSize">
            ${PAGE_SIZES.map((size) => option(String(size), String(size), String(pageSize.get())))}
          </select>
        </label>
      </div>
      <div class="pager-slot" data-pager="top"></div>
      <div class="card-grid"></div>
      <div class="pager-slot" data-pager="bottom"></div>
    </section>`,
  );

  const grid = $('.card-grid', main);
  const count = $('.result-count', main);
  const bar = $('.result-bar', main);
  const pagers = $$('.pager-slot', main);
  let ownedList = [];

  function renderGrid() {
    const cards = visibleCards();
    // Every owned card of the filters, not only this page: the detail view goes from one to the next.
    ownedList = cards.filter((card) => owned.has(card.id));
    const size = pageSize.get();
    const pages = pageCount(cards.length, size);
    paging.page = Math.min(Math.max(1, paging.page), pages);
    const first = (paging.page - 1) * size;
    const pageCards = cards.slice(first, first + size);
    count.textContent = cards.length
      ? `${t('collection.count', { count: cards.length, owned: ownedList.length, missing: cards.length - ownedList.length })}${
          pages > 1 ? ` · ${t('pager.showing', { from: first + 1, to: first + pageCards.length })}` : ''
        }`
      : '';
    for (const pager of pagers) mount(pager, paginationHTML(paging.page, pages));
    mount(
      grid,
      cards.length
        ? pageCards.map((card) =>
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

  /** The fold of the filters (phones), and how many of them are set. */
  const form = $('.filters', main);
  const toggle = $('.filters__toggle', form);
  function paintFilters() {
    form.classList.toggle('is-open', filtersOpen);
    toggle.setAttribute('aria-expanded', String(filtersOpen));
    const set = Object.keys(DEFAULT_FILTERS).filter((name) => name !== 'q' && filters[name] !== DEFAULT_FILTERS[name]).length;
    $('.filters__count', toggle).textContent = set ? `(${set})` : '';
  }
  toggle.addEventListener('click', () => {
    filtersOpen = !filtersOpen;
    paintFilters();
  });
  paintFilters();

  form.addEventListener('input', (event) => {
    const { name, value } = event.target;
    if (name in filters) {
      filters[name] = value;
      paging.page = 1;
      renderGrid();
      paintFilters();
    }
  });
  $('[name="pageSize"]', main).addEventListener('change', (event) => {
    // Stay on the page that shows the first card on screen.
    const firstShown = (paging.page - 1) * pageSize.get();
    pageSize.set(Number(event.target.value));
    paging.page = Math.floor(firstShown / pageSize.get()) + 1;
    renderGrid();
  });

  onPageClick(pagers, bar, (page) => {
    paging.page = page;
    renderGrid();
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
