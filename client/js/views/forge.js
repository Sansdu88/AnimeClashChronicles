/**
 * "Forge" page: duplicates of one rarity are melted into a random card of the next one
 * (5 N → 1 R … 5 UR → 1 REV by default, meta.forge), from the booster the player chooses.
 * The player puts copies on the anvil (one by one, or "Fill"), gems pay for the missing ones,
 * then the hammer strikes three times and the forged card is flipped on the stage (views/open.js).
 * Only true duplicates can be melted: one copy of each card is kept, and the copies promised in
 * open trades (the `spare` copies of the market).
 */
import { $, $$, fmt, html, mount, prefersReducedMotion, raw, wait } from '../dom.js';
import { cardText, errorText, rarityName, setName, t, tHtml } from '../i18n.js';
import { fetchMarket, forgeCard, refreshMeta, state } from '../state.js';
import { cardHTML } from '../components/card.js';
import { openCardModal } from '../components/card-modal.js';
import { onPageClick, pageCount, pageSize, paginationHTML } from '../components/pagination.js';
import { RARITY_COLORS, burst, flash, onomatopoeia } from '../ui/effects.js';
import { GEM_SVG, gemIconHTML, gemsHTML } from '../ui/gems.js';
import { flySparkles } from '../ui/kira.js';
import { sfx } from '../ui/sfx.js';
import { toast } from '../ui/toast.js';
import { revealCard } from './open.js';

// Kept between visits: the recipe, the booster the card is forged from, the page of duplicates
// and the copies on the anvil (one card id per copy).
const chosen = { rarity: 'N', setId: 'all-stars', page: 1 };
let anvil = [];
let renderId = 0;

/** The stage of a forged card: embers on iron. */
const FORGE_COLORS = ['#ff6a00', '#3b3a40'];
const SPARKS = ['#fff3b0', '#ffd23f', '#ff8c00', '#ff6a00', '#ffffff'];

const recipes = () => state.meta.forge.recipes;
const recipeOf = (rarity) => recipes().find((recipe) => recipe.rarity === rarity) ?? recipes()[0];

/** The duplicates of `rarity` you can melt: [{ card, spare }], the most copies first, then the least popular. */
const spareList = (spare, rarity) =>
  Object.entries(spare)
    .map(([cardId, count]) => ({ card: state.cardsById.get(cardId), spare: count }))
    .filter(({ card }) => card?.rarity === rarity)
    .sort((a, b) => b.spare - a.spare || a.card.power - b.card.power || a.card.number - b.card.number);

/** Copies of a card on the anvil. */
const onAnvil = (cardId) => anvil.filter((id) => id === cardId).length;

/** The booster sets a card of `rarity` can be forged from (the ones that have some). */
const setsWith = (rarity) => state.meta.sets.filter((set) => set.rarityCounts[rarity] > 0);

/** { given, missing, gems, blocked }: what the anvil holds and what the forge costs; `blocked`: why it cannot start. */
function costOf(recipe) {
  const given = anvil.length;
  const missing = recipe.cards - given;
  const gems = missing * recipe.gems;
  let blocked = null;
  if (missing > 0 && recipe.gems === 0) blocked = t('forge.needCards', { count: missing });
  else if (gems > state.player.gems) blocked = t('gems.missing', { count: gems - state.player.gems });
  return { given, missing, gems, blocked };
}

function recipeHTML(recipe, spare) {
  const copies = spareList(spare, recipe.rarity).reduce((sum, item) => sum + item.spare, 0);
  return html`<button class="forge-recipe" type="button" data-recipe="${recipe.rarity}" aria-pressed="${recipe.rarity === chosen.rarity}"
      aria-label="${t('forge.recipeLabel', { count: recipe.cards, from: rarityName(recipe.rarity), to: rarityName(recipe.to) })}">
    <span class="forge-recipe__formula">
      <span class="forge-recipe__count">${recipe.cards}×</span>
      <span class="rarity-badge r-${recipe.rarity}">${recipe.rarity}</span>
      <span class="forge-recipe__arrow" aria-hidden="true">➜</span>
      <span class="rarity-badge r-${recipe.to}">${recipe.to}</span>
    </span>
    <span class="forge-recipe__spare">${t('forge.spareCount', { count: copies })}</span>
  </button>`;
}

/** One slot of the anvil: a copy (tap it to take it off), or empty (a gem pays for it, when gems can). */
function slotHTML(cardId, recipe, i) {
  if (cardId) {
    const card = state.cardsById.get(cardId);
    return html`<button class="forge-slot is-filled" type="button" data-slot="${i}" style="--i:${i}"
        aria-label="${t('forge.slotLabel', { name: cardText(card).name })}">
      ${cardHTML(card, { interactive: false })}
      <span class="forge-slot__remove" aria-hidden="true">✕</span>
    </button>`;
  }
  return html`<span class="forge-slot is-empty${recipe.gems ? ' is-gem' : ''}" style="--i:${i}" title="${recipe.gems ? t('forge.gemSlot', { count: recipe.gems }) : t('forge.emptySlot')}">
    ${recipe.gems ? html`${gemIconHTML()}<b>${fmt.number(recipe.gems)}</b>` : html`<b>+</b>`}
  </span>`;
}

function pickCardHTML({ card, spare }, recipe) {
  const used = onAnvil(card.id);
  const left = spare - used;
  return html`<div class="recycle-card forge-pick" data-card-id="${card.id}">
    ${cardHTML(card, { count: state.owned.get(card.id)?.count ?? 0, tilt: true })}
    <p class="recycle-card__info">${t('forge.copies', { count: spare })}${used ? html` · <b class="forge-pick__used">${t('forge.onAnvil', { count: used })}</b>` : ''}</p>
    <div class="recycle-card__actions">
      <button class="btn btn--secondary" type="button" data-add="${card.id}" ${left > 0 && anvil.length < recipe.cards ? '' : 'disabled'}
        aria-label="${t('forge.addLabel', { name: cardText(card).name })}">⚒️ +1</button>
      ${used > 0 && html`<button class="btn btn--ghost" type="button" data-take="${card.id}" aria-label="${t('forge.takeLabel', { name: cardText(card).name })}">−1</button>`}
    </div>
  </div>`;
}

export async function renderForge(main) {
  const id = ++renderId;
  mount(main, html`<section class="view view-forge"><div class="loading"><span class="loading__spinner"></span> ${t('common.loading')}</div></section>`);
  let market;
  try {
    market = await fetchMarket();
  } catch (err) {
    if (id === renderId) mount(main, html`<div class="empty panel"><p class="empty__title">${t('common.oops')}</p><p>${errorText(err)}</p></div>`);
    return;
  }
  if (id !== renderId || !main.isConnected) return;
  const { spare } = market;
  if (!recipes().some((recipe) => recipe.rarity === chosen.rarity)) chosen.rarity = recipes()[0].rarity;
  // Copies that are not spare anymore (recycled, traded…) leave the anvil.
  const kept = new Map();
  anvil = anvil.filter((cardId) => {
    kept.set(cardId, (kept.get(cardId) ?? 0) + 1);
    return state.cardsById.get(cardId)?.rarity === chosen.rarity && kept.get(cardId) <= (spare[cardId] ?? 0);
  });

  mount(
    main,
    html`<section class="view view-forge">
      <div class="hero hero--forge">
        <div class="forge-anvil" aria-hidden="true">
          <span class="forge-anvil__sparks">${Array.from({ length: 8 }, (_, i) => html`<span style="--i:${i}"></span>`)}</span>
          <span class="forge-anvil__icon">⚒️</span>
        </div>
        <h1 class="hero__title">${t('forge.title')}</h1>
        <p class="hero__sub">${raw(tHtml('forge.sub'))}</p>
      </div>

      <section class="panel forge-recipes">
        <h2 class="panel__title">📜 ${t('forge.recipes')}</h2>
        <div class="forge-recipes__list" role="group" aria-label="${t('forge.recipes')}"></div>
      </section>

      <section class="panel forge-bench" aria-label="${t('forge.anvil')}">
        <h2 class="panel__title">🔥 ${t('forge.anvil')}</h2>
        <div class="forge-bench__stage">
          <div class="forge-slots"></div>
          <div class="forge-bench__hammer" aria-hidden="true"><span class="forge-bench__glow"></span><span class="forge-bench__icon">🔨</span></div>
          <div class="forge-bench__result"></div>
        </div>
        <div class="forge-from">
          <p class="field__label">${t('forge.from')}</p>
          <div class="forge-from__sets" role="group" aria-label="${t('forge.from')}"></div>
          <p class="muted forge-from__hint"></p>
        </div>
        <p class="forge-cost" aria-live="polite"></p>
        <div class="btn-row forge-actions">
          <button class="btn btn--ghost" type="button" data-action="clear"></button>
          <button class="btn btn--secondary" type="button" data-action="fill"></button>
          <button class="btn btn--primary btn--big forge-go" type="button" data-action="forge"></button>
        </div>
      </section>

      <section class="panel forge-picks">
        <h2 class="panel__title"></h2>
        <p class="muted">${t('forge.pickHint')}</p>
        <p class="result-count" aria-live="polite"></p>
        <div class="pager-slot"></div>
        <div class="card-grid recycle-grid"></div>
        <div class="pager-slot"></div>
      </section>
    </section>`,
  );

  const view = $('.view-forge', main);
  const bench = $('.forge-bench', main);
  const recipeList = $('.forge-recipes__list', main);
  const slots = $('.forge-slots', bench);
  const result = $('.forge-bench__result', bench);
  const hammer = $('.forge-bench__hammer', bench);
  const sets = $('.forge-from__sets', bench);
  const cost = $('.forge-cost', bench);
  const grid = $('.forge-picks .card-grid', main);
  const pagers = $$('.forge-picks .pager-slot', main);
  const count = $('.forge-picks .result-count', main);
  let busy = false;

  /** The recipes, the anvil (its slots, the card it gives, the booster, the cost and the buttons). */
  function paintBench() {
    const recipe = recipeOf(chosen.rarity);
    mount(recipeList, recipes().map((each) => recipeHTML(each, spare)));
    mount(slots, Array.from({ length: recipe.cards }, (_, i) => slotHTML(anvil[i], recipe, i)));
    slots.style.setProperty('--n', recipe.cards);
    mount(
      result,
      html`<div class="forge-result r-${recipe.to}">
        <span class="forge-result__q" aria-hidden="true">?</span>
        <span class="rarity-badge r-${recipe.to}">${recipe.to}</span>
      </div>
      <p class="forge-result__name">${rarityName(recipe.to)}</p>`,
    );

    const usable = setsWith(recipe.to);
    if (!usable.some((set) => set.id === chosen.setId)) chosen.setId = usable[0]?.id ?? chosen.setId;
    mount(
      sets,
      state.meta.sets.map((set) => {
        const cards = set.rarityCounts[recipe.to] ?? 0;
        return html`<button class="forge-set" type="button" data-set="${set.id}" aria-pressed="${set.id === chosen.setId}" ${cards ? '' : 'disabled'}
            style="--c1:${set.colors[0]};--c2:${set.colors[1]}" title="${cards ? '' : t('forge.noCard', { rarity: recipe.to })}">
          <b>${setName(set.id)}</b><span>${t('forge.setCards', { count: cards, rarity: recipe.to })}</span>
        </button>`;
      }),
    );
    $('.forge-from__hint', bench).textContent = usable.length ? t('forge.fromHint', { rarity: rarityName(recipe.to), id: recipe.to, set: setName(chosen.setId) }) : t('forge.noCard', { rarity: recipe.to });

    const { given, missing, gems, blocked } = costOf(recipe);
    mount(
      cost,
      html`<b>${t('forge.costCards', { count: given, total: recipe.cards })}</b>
        ${missing > 0 && recipe.gems > 0 && html` · ${t('forge.costGems', { count: missing })} ${gemsHTML(gems)}`}
        ${blocked && html`<span class="forge-cost__blocked">${blocked}</span>`}`,
    );
    const go = $('[data-action="forge"]', bench);
    mount(go, html`⚒️ ${t('forge.forge')}${gems > 0 ? html` · ${gemsHTML(gems)}` : ''}`);
    go.disabled = busy || Boolean(blocked) || usable.length === 0;
    const fill = $('[data-action="fill"]', bench);
    fill.textContent = t('forge.autoFill');
    fill.disabled = busy || anvil.length >= recipe.cards || !spareList(spare, chosen.rarity).some(({ card, spare: n }) => n > onAnvil(card.id));
    const clear = $('[data-action="clear"]', bench);
    clear.textContent = t('forge.clear');
    clear.disabled = busy || anvil.length === 0;
  }

  /** Your duplicates of the recipe's rarity, a page of them. */
  function paintPicks() {
    const recipe = recipeOf(chosen.rarity);
    const list = spareList(spare, chosen.rarity);
    $('.forge-picks .panel__title', main).textContent = `🃏 ${t('forge.pick', { name: rarityName(chosen.rarity), rarity: chosen.rarity })}`;
    const size = pageSize.get();
    const pages = pageCount(list.length, size);
    chosen.page = Math.min(Math.max(1, chosen.page), pages);
    const first = (chosen.page - 1) * size;
    const items = list.slice(first, first + size);
    count.textContent = list.length
      ? `${t('forge.cards', { count: list.length })}${pages > 1 ? ` · ${t('pager.showing', { from: first + 1, to: first + items.length })}` : ''}`
      : '';
    for (const pager of pagers) mount(pager, paginationHTML(chosen.page, pages));
    mount(
      grid,
      items.length
        ? items.map((item) => pickCardHTML(item, recipe))
        : html`<div class="empty panel">
            <p class="empty__title">${t('forge.noneTitle', { rarity: chosen.rarity })}</p>
            <p>${t(recipe.gems ? 'forge.noneGems' : 'forge.noneText')}</p>
          </div>`,
    );
  }

  const paint = () => {
    paintBench();
    paintPicks();
  };

  /** Puts a copy of `cardId` on the anvil (if it has room and the card a spare copy left). */
  function add(cardId) {
    const recipe = recipeOf(chosen.rarity);
    if (anvil.length >= recipe.cards) {
      toast(t('forge.full'), 'info');
      return;
    }
    if (onAnvil(cardId) >= (spare[cardId] ?? 0)) return;
    anvil.push(cardId);
    sfx.play('flip');
    paint();
  }

  function take(cardId) {
    const at = anvil.lastIndexOf(cardId);
    if (at < 0) return;
    anvil.splice(at, 1);
    sfx.play('click');
    paint();
  }

  /** Fills the empty slots with your duplicates: the cards you have the most copies of first, then the least popular. */
  function fill() {
    const recipe = recipeOf(chosen.rarity);
    for (const { card, spare: copies } of spareList(spare, chosen.rarity)) {
      while (anvil.length < recipe.cards && onAnvil(card.id) < copies) anvil.push(card.id);
    }
    sfx.play('flip');
    paint();
  }

  /** The hammer strikes the anvil `times` times: CLANG, sparks, the last strike the biggest. */
  async function strike(times = 3) {
    const still = prefersReducedMotion();
    for (let i = 1; i <= times; i++) {
      hammer.classList.remove('is-striking');
      void hammer.offsetWidth; // restart the animation
      hammer.classList.add('is-striking');
      await wait(still ? 120 : 260);
      if (!view.isConnected) return;
      const box = $('.forge-result', result).getBoundingClientRect();
      const x = box.left + box.width / 2;
      const y = box.top + box.height / 2;
      sfx.play('clang');
      burst(x, y, { colors: SPARKS, count: 26 + i * 14, power: 0.9 + i * 0.2 });
      onomatopoeia(t('forge.clang'), { x, y: box.top - 10, color: '#ffd23f', size: i === times ? 'xl' : 'l', tilt: i % 2 ? -8 : 8 });
      result.classList.add('is-hot');
      await wait(still ? 200 : 420);
    }
  }

  /** The copies slide into the anvil and the gems fly to it, the hammer strikes, and the forged card is flipped on the stage. */
  async function forge() {
    const recipe = recipeOf(chosen.rarity);
    const { gems, blocked } = costOf(recipe);
    if (busy || blocked) return;
    busy = true;
    view.classList.add('is-forging');
    paintBench();
    const counts = new Map();
    for (const cardId of anvil) counts.set(cardId, (counts.get(cardId) ?? 0) + 1);
    const cards = [...counts].map(([cardId, n]) => ({ cardId, count: n }));
    const setId = chosen.setId;
    const given = anvil.length;

    // The copies melt into the anvil…
    const target = $('.forge-result', result).getBoundingClientRect();
    for (const slot of $$('.forge-slot', slots)) {
      const box = slot.getBoundingClientRect();
      slot.style.setProperty('--dx', `${target.left + target.width / 2 - (box.left + box.width / 2)}px`);
      slot.style.setProperty('--dy', `${target.top + target.height / 2 - (box.top + box.height / 2)}px`);
      slot.classList.add('is-melting');
    }
    sfx.play('charge');
    if (gems > 0) flySparkles($('#gem-chip .gem-icon').getBoundingClientRect(), $('.forge-result', result), { count: 10, symbol: GEM_SVG, className: 'gem-spark' });

    // …while the server forges the card, the hammer strikes.
    const request = forgeCard({ rarity: recipe.rarity, cards, setId, gems });
    let card;
    try {
      [card] = await Promise.all([request, wait(prefersReducedMotion() ? 150 : 600).then(() => strike())]);
    } catch (err) {
      busy = false;
      toast(err.code === 'price_changed' ? t('forge.priceChanged') : errorText(err), 'error');
      if (err.code === 'price_changed') await refreshMeta().catch(() => {});
      if (view.isConnected) renderForge(main);
      return;
    }
    anvil = [];
    busy = false;
    if (!view.isConnected) {
      // The player left the page during the strikes: the card is theirs anyway.
      toast(t('forge.forged', { name: cardText(card).name }), 'success');
      return;
    }
    const box = $('.forge-result', result).getBoundingClientRect();
    flash('rgba(255, 179, 71, .8)', 420);
    burst(box.left + box.width / 2, box.top + box.height / 2, { colors: [...SPARKS, ...RARITY_COLORS[card.rarity]], count: 90, power: 1.5 });
    await wait(350);
    revealCard(
      card,
      {
        title: `⚒️ ${t('forge.stageTitle')}`,
        sub: t('forge.stageSub', { count: given, from: recipe.rarity, to: recipe.to, set: setName(setId) }),
        again: { href: '#/forge', label: t('forge.again') },
      },
      FORGE_COLORS,
    );
  }

  view.addEventListener('click', (event) => {
    if (busy) return;
    const recipe = event.target.closest('[data-recipe]');
    if (recipe && recipe.dataset.recipe !== chosen.rarity) {
      sfx.play('click');
      chosen.rarity = recipe.dataset.recipe;
      chosen.page = 1;
      anvil = [];
      paint();
      return;
    }
    const set = event.target.closest('[data-set]');
    if (set) {
      sfx.play('click');
      chosen.setId = set.dataset.set;
      paintBench();
      return;
    }
    const slot = event.target.closest('[data-slot]');
    if (slot) {
      anvil.splice(Number(slot.dataset.slot), 1);
      sfx.play('click');
      paint();
      return;
    }
    const plus = event.target.closest('[data-add]');
    if (plus) {
      add(plus.dataset.add);
      return;
    }
    const minus = event.target.closest('[data-take]');
    if (minus) {
      take(minus.dataset.take);
      return;
    }
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (action === 'fill') fill();
    else if (action === 'clear') {
      anvil = [];
      sfx.play('click');
      paint();
    } else if (action === 'forge') forge();
    if (action) return;
    const card = event.target.closest('.forge-pick .card');
    if (card) openCardModal(state.cardsById.get(card.dataset.card), { list: spareList(spare, chosen.rarity).map((item) => item.card) });
  });
  grid.addEventListener('keydown', (event) => {
    if ((event.key === 'Enter' || event.key === ' ') && event.target.matches('.card')) {
      event.preventDefault();
      event.target.click();
    }
  });
  onPageClick(pagers, count, (page) => {
    chosen.page = page;
    paintPicks();
  });

  paint();
}
