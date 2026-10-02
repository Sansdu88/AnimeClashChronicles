/**
 * "Market" page, the Kira market: duplicates are recycled into Kira (✦), the game's
 * money, by rarity, and Kira buys boosters, opened at once (views/open.js): one, a
 * chosen number, or as many as the wallet pays for (Max). The daily shop sells 5 cards,
 * new ones every day (a UR on Sundays), one copy of each per player.
 * You keep one copy of each card, and the copies promised in your open trades.
 * A recycled copy turns into sparkles that fly to the wallet; Kira spent at the daily
 * shop flies from the wallet to the card.
 */
import { $, $$, everySecond, fmt, html, mount, raw } from '../dom.js';
import { cardText, errorText, rarityName, setName, t, tHtml } from '../i18n.js';
import { affordable, buyShopCard, byRarity, fetchMarket, priceOf, recycleCards, state } from '../state.js';
import { cardHTML } from '../components/card.js';
import { openCardModal } from '../components/card-modal.js';
import { confirmDialog } from '../components/modal.js';
import { onPageClick, pageCount, pageSize, paginationHTML } from '../components/pagination.js';
import { RARITY_COLORS, burst, onomatopoeia } from '../ui/effects.js';
import { bump, coinHTML, flySparkles, kiraHTML, rollNumber } from '../ui/kira.js';
import { sfx } from '../ui/sfx.js';
import { toast } from '../ui/toast.js';
import { openBought, packHTML } from './open.js';

// Kept between visits: the rarities to recycle (the rarest ones are left out at first), and the page.
const chosen = new Set(['N', 'R', 'SR']);
const paging = { page: 1 };
let renderId = 0;

const rarestFirst = () => [...state.meta.rarities].reverse().map((rarity) => rarity.id);
const valueOf = (card) => state.meta.market.recycle[card.rarity];

/** The cards you have duplicates of, rarest first: [{ card, spare }]. */
const spareList = (spare) =>
  Object.entries(spare)
    .map(([cardId, count]) => ({ card: state.cardsById.get(cardId), spare: count }))
    .filter(({ card }) => card)
    .sort((a, b) => byRarity(a.card, b.card) || b.spare - a.spare);

/** The boosters to buy at once, read from a shop item's field (1 to the most per request). */
function quantityOf(item) {
  const value = Math.round(Number($('.qty__input', item).value)) || 1;
  return Math.min(Math.max(value, 1), state.meta.booster.maxPerRequest);
}

/** Each booster with how many to buy (1, a number, or Max); the price and the button follow (paintShop). */
function shopHTML() {
  const most = state.meta.booster.maxPerRequest;
  return html`<div class="shop">
    ${state.meta.sets.map(
      (set) => html`<div class="shop-item" data-set="${set.id}">
        <span class="pack shop-item__pack" aria-hidden="true">${packHTML(set)}</span>
        <span class="shop-item__name">${setName(set.id)}</span>
        <span class="shop-item__price"></span>
        <span class="shop-item__each"></span>
        <div class="qty" role="group" aria-label="${t('market.quantity')}">
          <button class="btn btn--small qty__step" type="button" data-step="-1" aria-label="${t('market.less')}">−</button>
          <input class="input qty__input" type="number" value="1" min="1" max="${most}" step="1" inputmode="numeric"
            aria-label="${t('market.quantity')}">
          <button class="btn btn--small qty__step" type="button" data-step="1" aria-label="${t('market.more')}">+</button>
          <button class="btn btn--small btn--secondary" type="button" data-max>${t('market.max')}</button>
        </div>
        <button class="btn btn--kira shop-item__buy" type="button" data-buy="${set.id}"></button>
        <span class="shop-item__need" aria-live="polite"></span>
      </div>`,
    )}
  </div>`;
}

/** A card of the daily shop: the card, how many copies you have, and its buy button (or "Bought"). */
function shopCardHTML(item) {
  const card = state.cardsById.get(item.cardId);
  const owned = state.owned.get(item.cardId)?.count ?? 0;
  const missing = item.price - state.player.kira;
  return html`<div class="shop-card${item.bought ? ' is-bought' : ''}" data-card-id="${item.cardId}">
    ${item.rarity === 'UR' && html`<span class="shop-card__ribbon">☀️ ${t('shop.sunday')}</span>`}
    <div class="shop-card__art">
      ${cardHTML(card, { count: owned, tilt: true })}
      ${item.bought && html`<span class="shop-card__stamp" aria-hidden="true">${t('shop.sold')}</span>`}
    </div>
    <p class="shop-card__owned">${owned ? t('shop.owned', { count: owned }) : html`<b class="shop-card__new">✨ ${t('shop.notOwned')}</b>`}</p>
    ${item.bought
      ? html`<button class="btn btn--ghost" type="button" disabled>✓ ${t('shop.bought')}</button>`
      : html`<button class="btn btn--kira" type="button" data-shop-buy="${item.cardId}" ${missing > 0 ? 'disabled' : ''}
          aria-label="${t('shop.buyLabel', { name: cardText(card).name, price: item.price })}">${t('market.buy')} · ${kiraHTML(item.price)}</button>`}
    <span class="shop-item__need">${!item.bought && missing > 0 ? t('market.missing', { count: missing }) : ''}</span>
  </div>`;
}

/** The rarities to recycle: how many duplicates of each, and their Kira. */
function picksHTML(list) {
  return rarestFirst().map((id) => {
    const copies = list.filter(({ card }) => card.rarity === id).reduce((sum, item) => sum + item.spare, 0);
    return html`<label class="rarity-pick r-${id}${copies ? '' : ' is-empty'}" title="${rarityName(id)}">
      <input type="checkbox" value="${id}" ${chosen.has(id) ? 'checked' : ''}>
      <span class="rarity-badge">${id}</span>
      <span class="rarity-pick__count">×${fmt.number(copies)}</span>
      <span class="rarity-pick__kira">${kiraHTML(copies * state.meta.market.recycle[id])}</span>
    </label>`;
  });
}

function recycleCardHTML({ card, spare }) {
  const value = valueOf(card);
  return html`<div class="recycle-card" data-card-id="${card.id}">
    ${cardHTML(card, { count: state.owned.get(card.id)?.count ?? 0, tilt: true })}
    <p class="recycle-card__info">${t('market.spare', { count: spare })} · ${kiraHTML(value)} ${t('market.each')}</p>
    <div class="recycle-card__actions">
      <button class="btn btn--kira" type="button" data-recycle="${card.id}" data-count="1"
        aria-label="${t('market.recycleOneLabel', { kira: value })}">♻ +${value}</button>
      ${spare > 1 && html`<button class="btn btn--ghost" type="button" data-recycle="${card.id}" data-count="${spare}"
        aria-label="${t('market.recycleAllLabel', { count: spare, kira: value * spare })}">${t('market.all', { count: spare })}</button>`}
    </div>
  </div>`;
}

export async function renderMarket(main) {
  const id = ++renderId;
  mount(main, html`<section class="view view-market"><div class="loading"><span class="loading__spinner"></span> ${t('common.loading')}</div></section>`);
  let market;
  try {
    market = await fetchMarket();
  } catch (err) {
    if (id === renderId) mount(main, html`<div class="empty panel"><p class="empty__title">${t('common.oops')}</p><p>${errorText(err)}</p></div>`);
    return;
  }
  if (id !== renderId || !main.isConnected) return;
  let { spare, shop } = market;
  const rates = state.meta.market.recycle;

  mount(
    main,
    html`<section class="view view-market">
      <div class="hero hero--market">
        <h1 class="hero__title">${t('market.title')}</h1>
        <p class="hero__sub">${raw(tHtml('market.sub'))}</p>
      </div>

      <div class="market-top">
        <section class="panel wallet" aria-label="${t('market.wallet')}">
          ${coinHTML('big')}
          <div>
            <p class="wallet__label">${t('market.wallet')}</p>
            <p class="wallet__amount"><b data-kira data-value="${state.player.kira}">${fmt.number(state.player.kira)}</b> Kira</p>
            <p class="wallet__hint">${t('market.kiraInfo')}</p>
          </div>
        </section>
        <section class="panel rates">
          <h2 class="panel__title">${t('market.rates')}</h2>
          <ul class="rates__list">
            ${rarestFirst().map((rarity) => html`<li class="r-${rarity}" title="${rarityName(rarity)}">
              <span class="rarity-badge">${rarity}</span> ${kiraHTML(rates[rarity])}
            </li>`)}
          </ul>
          <p class="muted">${t('market.ratesHint')}</p>
        </section>
      </div>

      <section class="panel daily-shop">
        <div class="daily-shop__head">
          <h2 class="panel__title">🛒 ${t('shop.title')}</h2>
          <p class="daily-shop__timer"></p>
        </div>
        <p class="muted">${t('shop.hint')}</p>
        <div class="daily-shop__cards"></div>
      </section>

      <section class="panel market-shop">
        <h2 class="panel__title">${t('market.shop')}</h2>
        <p class="muted">${t('market.shopHint', { max: state.meta.booster.maxPerRequest })}</p>
        ${shopHTML()}
      </section>

      <section class="panel market-recycle">
        <h2 class="panel__title">${t('market.recycleTitle')}</h2>
        <p class="muted">${t('market.recycleHint')}</p>
        <div class="recycle-bar">
          <div class="rarity-picks" role="group" aria-label="${t('market.picksLabel')}"></div>
          <button class="btn btn--special btn--big" type="button" data-action="recycle-all"></button>
        </div>
        <p class="result-count" aria-live="polite"></p>
        <div class="pager-slot"></div>
        <div class="card-grid recycle-grid"></div>
        <div class="pager-slot"></div>
      </section>
    </section>`,
  );

  const amount = $('[data-kira]', main);
  const picks = $('.rarity-picks', main);
  const recycleAll = $('[data-action="recycle-all"]', main);
  const count = $('.result-count', main);
  const grid = $('.recycle-grid', main);
  const pagers = $$('.market-recycle .pager-slot', main);
  const shopCards = $('.daily-shop__cards', main);
  const shopTimer = $('.daily-shop__timer', main);

  /** The daily shop's cards (the ones of the catalog this page knows). */
  const paintDailyShop = () => mount(shopCards, shop.items.filter((item) => state.cardsById.has(item.cardId)).map(shopCardHTML));

  // The shop changes at midnight: the page asks for the new one.
  const shopEndsAt = Date.now() + shop.nextIn * 1000;
  everySecond(() => {
    if (!shopTimer.isConnected) return false;
    const left = Math.ceil((shopEndsAt - Date.now()) / 1000);
    if (left <= 0) {
      renderMarket(main);
      return false;
    }
    shopTimer.textContent = `⏳ ${t('shop.nextIn', { time: fmt.duration(left) })}`;
    return true;
  });

  /**
   * Each shop item: the price of the boosters chosen, the quantity buttons, and the buy
   * button, disabled with what is missing when the wallet is too light.
   */
  function paintShop() {
    for (const item of $$('.shop-item', main)) {
      const setId = item.dataset.set;
      const count = quantityOf(item);
      const price = priceOf(setId) * count;
      const missing = price - state.player.kira;
      const max = affordable(setId);
      mount($('.shop-item__price', item), kiraHTML(price));
      mount($('.shop-item__each', item), count > 1 ? html`×${count} · ${kiraHTML(priceOf(setId))} ${t('market.each')}` : '');
      $('[data-step="-1"]', item).disabled = count <= 1;
      $('[data-step="1"]', item).disabled = count >= state.meta.booster.maxPerRequest;
      const maxButton = $('[data-max]', item);
      maxButton.disabled = max < 1;
      maxButton.title = t('market.maxLabel', { count: max });
      maxButton.setAttribute('aria-label', maxButton.title);
      const buy = $('[data-buy]', item);
      buy.dataset.count = count;
      buy.textContent = t('market.buyOpen', { count });
      buy.setAttribute('aria-label', t('market.buyLabel', { set: setName(setId), price, count }));
      buy.disabled = missing > 0;
      $('.shop-item__need', item).textContent = missing > 0 ? t('market.missing', { count: missing }) : '';
    }
  }

  /** Puts `count` boosters (kept between 1 and the most per request) in a shop item's field. */
  function setQuantity(item, count) {
    $('.qty__input', item).value = Math.min(Math.max(count, 1), state.meta.booster.maxPerRequest);
    paintShop();
  }

  /** The rarity picks, the "recycle all" button and the page of duplicates. */
  function paintRecycle() {
    const list = spareList(spare);
    const shown = list.filter(({ card }) => chosen.has(card.rarity));
    const copies = shown.reduce((sum, item) => sum + item.spare, 0);
    const kira = shown.reduce((sum, item) => sum + item.spare * valueOf(item.card), 0);
    mount(picks, picksHTML(list));
    mount(recycleAll, html`♻ ${t('market.recycleAll', { count: copies })} · ${kiraHTML(kira, '+')}`);
    recycleAll.disabled = copies === 0;

    const size = pageSize.get();
    const pages = pageCount(shown.length, size);
    paging.page = Math.min(Math.max(1, paging.page), pages);
    const first = (paging.page - 1) * size;
    const pageItems = shown.slice(first, first + size);
    count.textContent = shown.length
      ? `${t('market.cards', { count: shown.length })}${pages > 1 ? ` · ${t('pager.showing', { from: first + 1, to: first + pageItems.length })}` : ''}`
      : '';
    for (const pager of pagers) mount(pager, paginationHTML(paging.page, pages));
    mount(
      grid,
      pageItems.length
        ? pageItems.map(recycleCardHTML)
        : html`<div class="empty panel">
            <p class="empty__title">${t(list.length ? 'market.noneChosen' : 'market.noneTitle')}</p>
            <p>${t(list.length ? 'market.noneChosenText' : 'market.noneText')}</p>
            ${!list.length && html`<a class="btn btn--primary" href="#/">${t('collection.openBooster')}</a>`}
          </div>`,
    );
  }

  /** The wallet coin if it is on screen, else the one of the header. */
  function walletCoin() {
    const coin = $('.wallet .kira-coin', main);
    const box = coin.getBoundingClientRect();
    return box.bottom > 70 && box.top < window.innerHeight ? coin : ($('#kira-chip .kira-coin') ?? coin);
  }

  /** A copy of the card leaves it in a burst of sparkles. */
  function dissolve(cardElement) {
    const box = cardElement.getBoundingClientRect();
    const ghost = cardElement.cloneNode(true);
    ghost.classList.add('recycle-ghost');
    ghost.removeAttribute('tabindex');
    Object.assign(ghost.style, { left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px` });
    document.body.append(ghost);
    setTimeout(() => ghost.remove(), 800);
    return box;
  }

  /**
   * Recycles `cards` ([{ cardId, count }]); the copies fly to the wallet as sparkles.
   * `from`: where they come from (the card, or the "recycle all" button).
   */
  async function recycle(cards, from) {
    const buttons = $$('[data-recycle], [data-action="recycle-all"]', main);
    for (const button of buttons) button.disabled = true;
    let result;
    try {
      result = await recycleCards(cards);
    } catch (err) {
      toast(errorText(err), 'error');
      renderMarket(main);
      return;
    }
    if (!main.isConnected) return;
    const coin = walletCoin();
    const bulk = cards.length > 1 || from === recycleAll;
    const sources = bulk
      ? $$('.recycle-card .card', main).slice(0, 12).map((card) => dissolve(card))
      : [dissolve($(`.recycle-card[data-card-id="${cards[0].cardId}"] .card`, main))];
    sfx.play('flip');
    await flySparkles(bulk ? from.getBoundingClientRect() : sources[0], coin, { count: bulk ? 28 : Math.min(16, 5 + result.recycled * 2) });
    for (const box of bulk ? sources.slice(0, 6) : []) flySparkles(box, coin, { count: 3 });
    sfx.play(bulk ? 'kaching' : 'coin');
    bump(coin);
    rollNumber(amount, result.kira, bulk ? 1100 : 600);
    const target = coin.getBoundingClientRect();
    onomatopoeia(`+${fmt.number(result.earned)} ✦`, { x: target.left + target.width / 2, y: target.bottom + 10, color: '#ffd23f', size: bulk ? 'xl' : 'l', tilt: -6 });
    if (bulk) toast(t('market.recycled', { count: result.recycled, kira: fmt.number(result.earned) }), 'success');
    spare = result.spare;
    paintRecycle();
    paintShop();
    paintDailyShop();
  }

  /** Buys a card of the daily shop: the Kira flies from the wallet to the card, which joins your collection. */
  async function buyFromShop(button) {
    const item = shop.items.find((row) => row.cardId === button.dataset.shopBuy);
    button.disabled = true;
    let result;
    try {
      result = await buyShopCard(item.cardId, item.price);
    } catch (err) {
      toast(errorText(err), 'error');
      renderMarket(main); // a new day, a new price, or bought from another page: show the shop again
      return;
    }
    if (!main.isConnected) return;
    shop = result.shop;
    const coin = walletCoin();
    const target = $(`.shop-card[data-card-id="${item.cardId}"] .card`, main);
    sfx.play('coin');
    rollNumber(amount, result.kira, 700);
    await flySparkles(coin.getBoundingClientRect(), target, { count: 16 });
    if (!main.isConnected) return;
    const box = target.getBoundingClientRect();
    sfx.play(item.rarity);
    burst(box.left + box.width / 2, box.top + box.height / 2, { colors: RARITY_COLORS[item.rarity], count: 60, power: 1.3 });
    onomatopoeia(result.isNew ? t('shop.newCard') : '+1', { x: box.left + box.width / 2, y: box.top + 10, color: '#ffd23f', size: 'l', tilt: -6 });
    toast(t('shop.boughtToast', { name: cardText(state.cardsById.get(item.cardId)).name }), 'success');
    paintDailyShop();
    paintShop();
  }

  picks.addEventListener('change', (event) => {
    const rarity = event.target.value;
    if (event.target.checked) chosen.add(rarity);
    else chosen.delete(rarity);
    paging.page = 1;
    paintRecycle();
  });

  onPageClick(pagers, count, (page) => {
    paging.page = page;
    paintRecycle();
  });

  const boosterShop = $('.shop', main);
  // Typing a number updates the price at once; the field is put back in range when left.
  boosterShop.addEventListener('input', paintShop);
  boosterShop.addEventListener('change', (event) => {
    const item = event.target.closest('.shop-item');
    if (item) setQuantity(item, quantityOf(item));
  });

  main.querySelector('.view-market').addEventListener('click', async (event) => {
    const buy = event.target.closest('[data-buy]');
    if (buy) {
      sfx.play('click');
      openBought(buy.dataset.buy, Number(buy.dataset.count));
      return;
    }
    const shopBuy = event.target.closest('[data-shop-buy]');
    if (shopBuy) {
      sfx.play('click');
      buyFromShop(shopBuy);
      return;
    }
    const shopCard = event.target.closest('.shop-card .card');
    if (shopCard) {
      const cards = shop.items.map((item) => state.cardsById.get(item.cardId)).filter(Boolean);
      openCardModal(state.cardsById.get(shopCard.dataset.card), { list: cards });
      return;
    }
    const step = event.target.closest('[data-step]');
    const max = event.target.closest('[data-max]');
    if (step || max) {
      const item = event.target.closest('.shop-item');
      sfx.play('click');
      setQuantity(item, max ? affordable(item.dataset.set) : quantityOf(item) + Number(step.dataset.step));
      return;
    }
    const one = event.target.closest('[data-recycle]');
    if (one) {
      sfx.play('click');
      recycle([{ cardId: one.dataset.recycle, count: Number(one.dataset.count) }], one);
      return;
    }
    if (event.target.closest('[data-action="recycle-all"]')) {
      const shown = spareList(spare).filter(({ card }) => chosen.has(card.rarity));
      const copies = shown.reduce((sum, item) => sum + item.spare, 0);
      const kira = shown.reduce((sum, item) => sum + item.spare * valueOf(item.card), 0);
      const ok = await confirmDialog({
        title: t('market.confirmTitle', { count: copies }),
        message: t('market.confirmText', { kira: fmt.number(kira) }),
        confirmLabel: t('market.confirm'),
      });
      if (ok) recycle(shown.map(({ card, spare: n }) => ({ cardId: card.id, count: n })), recycleAll);
      return;
    }
    const card = event.target.closest('.recycle-card .card');
    if (card) openCardModal(state.cardsById.get(card.dataset.card), { list: spareList(spare).filter((item) => chosen.has(item.card.rarity)).map((item) => item.card) });
  });
  grid.addEventListener('keydown', (event) => {
    if ((event.key === 'Enter' || event.key === ' ') && event.target.matches('.card')) {
      event.preventDefault();
      event.target.click();
    }
  });

  paintDailyShop();
  paintShop();
  paintRecycle();
}
