/**
 * "Trades" page (#/trades, or #/trades/<friendId> to start a trade with a friend):
 * 1. you offer one copy of a card to a friend · 2. they choose one of their cards
 * to give back, or decline · 3. you accept the swap, or cancel it.
 */
import { $, fmt, html, mount, raw } from '../dom.js';
import { cardText, errorText, t } from '../i18n.js';
import {
  acceptTrade,
  byRarity,
  cancelTrade,
  declineTrade,
  fetchFriendCollection,
  fetchTrades,
  offerTrade,
  proposeTrade,
  state,
  syncCollection,
} from '../state.js';
import { cardHTML } from '../components/card.js';
import { openCardModal } from '../components/card-modal.js';
import { pickCard } from '../components/card-picker.js';
import { sfx } from '../ui/sfx.js';
import { toast } from '../ui/toast.js';

let renderId = 0;
// The trade being prepared in the "New trade" form, kept between visits.
const draft = { friendId: '', cardId: '' };

/** Tells the header how many trades wait for your answer (badge on the "Trades" link). */
const announceTrades = (trades) =>
  window.dispatchEvent(new CustomEvent('mb:trades-waiting', { detail: trades.filter((trade) => trade.yourTurn).length }));

const cardName = (cardId) => {
  const card = state.cardsById.get(cardId);
  return card ? cardText(card).name : cardId;
};
const copies = (cardId) => state.owned.get(cardId)?.count ?? 0;
const option = (value, label, current) => html`<option value="${value}" ${raw(value === current ? 'selected' : '')}>${label}</option>`;

// ── Picking a card ───────────────────────────────────────────────────────────

/** Ids of the cards a friend owns, or null if their collection cannot be read. */
async function friendCards(friendId) {
  try {
    const { cards } = await fetchFriendCollection(friendId);
    return new Set(cards.map((entry) => entry.cardId));
  } catch {
    return null;
  }
}

/** Your cards for the picker: the copies you can still trade, and which ones the friend is missing. */
function pickerEntries(data, friendOwns, excludeId) {
  return [...state.owned.values()]
    .map((entry) => ({ card: state.cardsById.get(entry.cardId), count: entry.count }))
    .filter(({ card }) => card && card.id !== excludeId)
    .sort((a, b) => byRarity(a.card, b.card))
    .map(({ card, count }) => {
      const spare = count - (data.promised[card.id] ?? 0);
      let note;
      if (spare <= 0) note = t('trades.allPromised');
      else if (spare < count) note = t('trades.somePromised', { spare, count });
      else if (count === 1) note = t('trades.onlyCopy');
      else note = t('trades.youHave', { count });
      return { card, count, spare, note, highlight: Boolean(friendOwns && !friendOwns.has(card.id)) };
    });
}

// ── Trade cards ──────────────────────────────────────────────────────────────

/** Note under the card you give: how many copies you keep. */
function giveNote(cardId) {
  const count = copies(cardId);
  if (count <= 1) return html`<span class="trade__warn">${t('trades.lastCopy')}</span>`;
  return t('trades.keep', { count, after: count - 1 });
}

/** Note under the card you get. */
function getNote(cardId) {
  const count = copies(cardId);
  return count ? t('trades.alreadyHave', { count, after: count + 1 }) : html`<span class="trade__new">${t('trades.newForYou')}</span>`;
}

function sideHTML(label, cardId, note, waiting) {
  const card = cardId ? state.cardsById.get(cardId) : null;
  return html`<figure class="trade__side">
    <figcaption class="trade__label">${label}</figcaption>
    <div class="trade__card">
      ${card ? cardHTML(card) : html`<div class="trade__unknown"><span aria-hidden="true">?</span></div>`}
    </div>
    <p class="trade__note">${card ? note : waiting}</p>
  </figure>`;
}

function tradeHTML(trade) {
  const mine = trade.from.id === state.player.id; // you offered this trade
  const friend = mine ? trade.to : trade.from;
  const give = mine ? trade.fromCardId : trade.toCardId;
  const get = mine ? trade.toCardId : trade.fromCardId;
  const button = (action, label, style = 'ghost') =>
    html`<button class="btn btn--${style} btn--small" type="button" data-action="${action}" data-id="${trade.id}">${label}</button>`;

  let status;
  let actions;
  if (trade.status === 'pending' && mine) {
    status = t('trades.waitChoice', { name: friend.name });
    actions = button('cancel', t('trades.cancel'));
  } else if (trade.status === 'pending') {
    status = t('trades.offersYou', { name: friend.name });
    actions = [button('decline', t('trades.decline')), button('choose', t('trades.choose'), 'primary')];
  } else if (mine) {
    status = t('trades.proposedYou', { name: friend.name });
    actions = [button('cancel', t('trades.cancel')), button('accept', t('trades.accept'), 'primary')];
  } else {
    status = t('trades.waitAccept', { name: friend.name });
    actions = button('decline', t('trades.withdraw'));
  }
  const at = trade.proposedAt ?? trade.createdAt;

  return html`<li class="trade ${trade.yourTurn ? 'is-your-turn' : ''}">
    <header class="trade__head">
      <span class="friend__avatar" aria-hidden="true">${[...friend.name][0]?.toUpperCase() ?? '?'}</span>
      <p class="trade__status"><b>${status}</b><br><time class="muted" datetime="${at}" title="${fmt.date(at)}">${fmt.timeAgo(at)}</time></p>
    </header>
    <div class="trade__swap">
      ${sideHTML(t('trades.youGive'), give, giveNote(give), t('trades.yourChoice'))}
      <span class="trade__arrow" aria-hidden="true">⇄</span>
      ${sideHTML(t('trades.youGet'), get, getNote(get), t('trades.theirChoice', { name: friend.name }))}
    </div>
    <div class="btn-row btn-row--end">${actions}</div>
  </li>`;
}

function chipHTML(cardId) {
  const card = state.cardsById.get(cardId);
  if (!card) return html`<span class="mini-chip">${cardId}</span>`;
  return html`<span class="mini-chip r-${card.rarity}"><b>${card.rarity}</b> ${cardText(card).name}</span>`;
}

function historyHTML(trade) {
  const mine = trade.from.id === state.player.id;
  const name = (mine ? trade.to : trade.from).name;
  const give = mine ? trade.fromCardId : trade.toCardId;
  const get = mine ? trade.toCardId : trade.fromCardId;
  let text;
  if (trade.status === 'accepted') text = t('trades.doneWith', { name });
  else if (trade.status === 'declined') text = mine ? t('trades.declinedBy', { name }) : t('trades.youDeclined', { name });
  else text = mine ? t('trades.youCanceled', { name }) : t('trades.canceledBy', { name });

  return html`<li class="history__item trade-log is-${trade.status}">
    <div class="history__head">
      <strong>${trade.status === 'accepted' ? '✔' : '✖'} ${text}</strong>
      <time datetime="${trade.closedAt}" title="${fmt.date(trade.closedAt)}">${fmt.timeAgo(trade.closedAt)}</time>
    </div>
    ${trade.status === 'accepted'
      ? html`<div class="history__cards">
          <span class="muted">${t('trades.gave')}</span> ${chipHTML(give)}
          <span class="muted">${t('trades.got')}</span> ${chipHTML(get)}
        </div>`
      : html`<div class="history__cards">${chipHTML(trade.fromCardId)}</div>`}
  </li>`;
}

// ── New trade ────────────────────────────────────────────────────────────────

function newTradeHTML(data) {
  if (!data.friends.length) {
    return html`<p class="muted">${t('trades.noFriends')}</p>
      <a class="btn btn--primary" href="#/friends">${t('trades.findFriends')}</a>`;
  }
  const card = draft.cardId ? state.cardsById.get(draft.cardId) : null;
  return html`<form class="trade-form" novalidate>
      <label class="field">
        <span class="field__label">${t('trades.friend')}</span>
        <select class="input" name="friend">
          ${option('', t('trades.chooseFriend'), draft.friendId)}
          ${data.friends.map((friend) => option(friend.id, `${friend.name} · #${friend.friendCode}`, draft.friendId))}
        </select>
      </label>
      <div class="field">
        <span class="field__label">${t('trades.card')}</span>
        <div class="trade-form__card">
          ${card
            ? html`<div class="trade__card trade__card--small">${cardHTML(card, { interactive: false })}</div>
                <span class="trade-form__chosen">
                  <b>${cardText(card).name}</b><br>
                  <span class="muted">${copies(card.id) <= 1 ? t('trades.onlyCopy') : t('trades.youHave', { count: copies(card.id) })}</span><br>
                  <button class="link-button link" type="button" data-action="pick">${t('trades.change')}</button>
                </span>`
            : html`<button class="btn btn--secondary" type="button" data-action="pick">${t('trades.chooseCard')}</button>`}
        </div>
      </div>
      <p class="form-error" role="alert"></p>
      <button class="btn btn--primary" type="submit">${t('trades.send')}</button>
    </form>
    <p class="muted trade-form__how">${t('trades.how')}</p>`;
}

// ── Page ─────────────────────────────────────────────────────────────────────

function paint(main, data) {
  announceTrades(data.trades);
  if (draft.friendId && !data.friends.some((friend) => friend.id === draft.friendId)) draft.friendId = '';
  if (draft.cardId && copies(draft.cardId) - (data.promised[draft.cardId] ?? 0) < 1) draft.cardId = '';

  const yourTurn = data.trades.filter((trade) => trade.yourTurn);
  const waiting = data.trades.filter((trade) => !trade.yourTurn);

  mount(
    main,
    html`<section class="view view-trades">
      <header class="view-head">
        <div>
          <h1 class="view-title">${t('trades.title')}</h1>
          <p class="view-sub">${t('trades.sub')}</p>
        </div>
      </header>

      <div class="stats-grid">
        <section class="panel panel--wide">
          <h2 class="panel__title">${t('trades.yourTurn')} ${yourTurn.length ? html`<span class="count-pill">${yourTurn.length}</span>` : ''}</h2>
          ${yourTurn.length
            ? html`<ul class="trades">${yourTurn.map(tradeHTML)}</ul>`
            : html`<p class="muted">${t('trades.nothingToAnswer')}</p>`}
        </section>

        <section class="panel">
          <h2 class="panel__title">${t('trades.new')}</h2>
          ${newTradeHTML(data)}
        </section>

        <section class="panel">
          <h2 class="panel__title">${t('trades.history')}</h2>
          ${data.history.length
            ? html`<ul class="history">${data.history.map(historyHTML)}</ul>`
            : html`<p class="muted">${t('trades.noHistory')}</p>`}
        </section>

        <section class="panel panel--wide">
          <h2 class="panel__title">${t('trades.waiting')}</h2>
          ${waiting.length
            ? html`<ul class="trades">${waiting.map(tradeHTML)}</ul>`
            : html`<p class="muted">${t('trades.nothingWaiting')}</p>`}
        </section>
      </div>
    </section>`,
  );

  const view = $('.view-trades', main);
  const form = $('.trade-form', view);
  const tradeById = (id) => data.trades.find((trade) => String(trade.id) === id);
  const friendName = (id) => data.friends.find((friend) => friend.id === id)?.name ?? '';

  form?.addEventListener('change', (event) => {
    if (event.target.name === 'friend') draft.friendId = event.target.value;
  });

  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const errorBox = $('.form-error', form);
    errorBox.textContent = '';
    if (!draft.friendId) {
      errorBox.textContent = t('trades.needFriend');
      return form.elements.friend.focus();
    }
    if (!draft.cardId) {
      errorBox.textContent = t('trades.needCard');
      return;
    }
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    try {
      const result = await offerTrade(draft.friendId, draft.cardId);
      toast(t('trades.sent', { name: friendName(draft.friendId), card: cardName(draft.cardId) }), 'success');
      draft.cardId = '';
      paint(main, result);
    } catch (err) {
      errorBox.textContent = errorText(err);
      submit.disabled = false;
    }
  });

  async function pickOffer() {
    const name = friendName(draft.friendId);
    const friendOwns = draft.friendId ? await friendCards(draft.friendId) : null;
    const cardId = await pickCard({
      title: t('trades.pickOfferTitle'),
      sub: name ? t('trades.pickOfferSub', { name }) : t('trades.pickOfferSubNoFriend'),
      entries: pickerEntries(data, friendOwns),
      highlightLabel: t('trades.missingFor', { name }),
    });
    if (!cardId) return;
    draft.cardId = cardId;
    paint(main, data);
  }

  async function chooseCardFor(trade) {
    const { name } = trade.from;
    const cardId = await pickCard({
      title: t('trades.pickBackTitle', { name }),
      sub: t('trades.pickBackSub', { name, card: cardName(trade.fromCardId) }),
      entries: pickerEntries(data, await friendCards(trade.from.id), trade.fromCardId),
      highlightLabel: t('trades.missingFor', { name }),
    });
    if (!cardId) return;
    paint(main, await proposeTrade(trade.id, cardId));
    toast(t('trades.proposed', { name }), 'success');
  }

  view.addEventListener('click', async (event) => {
    const shownCard = event.target.closest('.trade .card[data-card]');
    if (shownCard) {
      openCardModal(state.cardsById.get(shownCard.dataset.card));
      return;
    }
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const { action, id } = button.dataset;
    const trade = id ? tradeById(id) : null;
    button.disabled = true;
    try {
      if (action === 'pick') {
        await pickOffer();
      } else if (action === 'choose') {
        await chooseCardFor(trade);
      } else if (action === 'accept') {
        const received = trade.toCardId;
        paint(main, await acceptTrade(trade.id));
        const card = state.cardsById.get(received);
        if (card) sfx.play(card.rarity);
        toast(t('trades.done', { card: cardName(received) }), 'success');
      } else if (action === 'decline') {
        paint(main, await declineTrade(trade.id));
        toast(t(trade.status === 'pending' ? 'trades.declined' : 'trades.withdrawn'));
      } else if (action === 'cancel') {
        paint(main, await cancelTrade(trade.id));
        toast(t('trades.canceled'));
      }
    } catch (err) {
      toast(errorText(err), 'error');
      // The trade may have changed on the other side (declined, canceled…): show the latest state.
      if (err.code === 'trade_not_found' || err.code === 'card_not_owned' || err.code === 'friend_card_gone') {
        renderTrades(main);
      }
    } finally {
      if (button.isConnected) button.disabled = false;
    }
  });

  view.addEventListener('keydown', (event) => {
    const shownCard = (event.key === 'Enter' || event.key === ' ') && event.target.closest('.trade .card[data-card]');
    if (!shownCard) return;
    event.preventDefault();
    openCardModal(state.cardsById.get(shownCard.dataset.card));
  });
}

export async function renderTrades(main, friendId) {
  const id = ++renderId;
  if (friendId) draft.friendId = friendId;
  mount(main, html`<section class="view"><div class="loading"><span class="loading__spinner"></span> ${t('common.loading')}</div></section>`);
  try {
    // A friend may have accepted one of your trades: your cards are reloaded too.
    const [data] = await Promise.all([fetchTrades(), syncCollection()]);
    if (id === renderId && main.isConnected) paint(main, data);
  } catch (err) {
    if (id === renderId) mount(main, html`<div class="empty panel"><p class="empty__title">${t('common.oops')}</p><p>${errorText(err)}</p></div>`);
  }
}
