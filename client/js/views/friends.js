/**
 * "Friends" page: your friend code, sending / answering friend requests, your
 * friends (with a link to their collection) and the ranking between friends.
 */
import { $, fmt, html, mount } from '../dom.js';
import { errorText, rarityName, t } from '../i18n.js';
import { acceptFriend, addFriend, declineFriend, fetchFriendCollection, fetchFriends, removeFriend, state } from '../state.js';
import { confirmDialog } from '../components/modal.js';
import { toast } from '../ui/toast.js';
import { renderCollection } from './collection.js';

let renderId = 0;
const RARITIES_DESC = ['REV', 'UR', 'SSR', 'SR', 'R', 'N'];

/** Tells the header how many requests are waiting (badge on the "Friends" link). */
const announceRequests = (count) => window.dispatchEvent(new CustomEvent('mb:friend-requests', { detail: count }));

function requestRow(player, actions) {
  return html`<li class="request">
    <span class="request__who"><b>${player.name}</b> <span class="muted">#${player.friendCode}</span></span>
    <time class="muted" datetime="${player.sentAt}">${fmt.timeAgo(player.sentAt)}</time>
    <span class="request__actions">${actions}</span>
  </li>`;
}

function rankingHTML(ranking, scoring) {
  return html`<table class="leaderboard ranking">
      <thead><tr>
        <th scope="col">${t('stats.rank')}</th><th scope="col">${t('stats.player')}</th>
        <th scope="col">${t('friends.score')}</th><th scope="col">${t('stats.cards')}</th>
      </tr></thead>
      <tbody>
        ${ranking.map((row) => html`<tr class="${row.you ? 'is-you' : ''}">
          <td>${row.rank === 1 ? '🥇' : row.rank === 2 ? '🥈' : row.rank === 3 ? '🥉' : row.rank}</td>
          <td>
            ${row.name}${row.you ? html` <span class="you-pill">${t('stats.you')}</span>` : ''}
            <span class="ranking__rarities">
              ${RARITIES_DESC.filter((id) => row.byRarity[id]).map(
                (id) => html`<span class="mini-chip r-${id}" title="${rarityName(id)}"><b>${id}</b> ×${row.byRarity[id]}</span>`,
              )}
            </span>
          </td>
          <td><b class="score">${fmt.number(row.score)}</b></td>
          <td>${row.uniqueCards} <span class="muted">(${fmt.percent(row.completion)})</span></td>
        </tr>`)}
      </tbody>
    </table>
    <p class="muted ranking__rule">${t('friends.scoreRule', scoring.points)}</p>`;
}

function friendCardHTML(friend) {
  return html`<li class="friend panel">
    <div class="friend__head">
      <span class="friend__avatar" aria-hidden="true">${[...friend.name][0]?.toUpperCase() ?? '?'}</span>
      <span>
        <b class="friend__name">${friend.name}</b><br>
        <span class="muted">#${friend.friendCode}${friend.since ? html` · ${t('friends.since', { date: fmt.date(friend.since) })}` : ''}</span>
      </span>
    </div>
    <div class="friend__stats">
      <span><b>${fmt.number(friend.score)}</b> ${t('friends.pts')}</span>
      <span><b>${friend.uniqueCards}</b>/${state.cards.length} (${fmt.percent(friend.completion)})</span>
    </div>
    <div class="btn-row btn-row--start">
      <a class="btn btn--primary" href="#/friends/${encodeURIComponent(friend.id)}">${t('friends.see')}</a>
      <button class="btn btn--ghost" type="button" data-action="remove" data-id="${friend.id}" data-name="${friend.name}">${t('friends.remove')}</button>
    </div>
  </li>`;
}

function paint(main, data) {
  announceRequests(data.incoming.length);
  mount(
    main,
    html`<section class="view view-friends">
      <header class="view-head">
        <div>
          <p class="view-kicker" lang="ja">友達</p>
          <h1 class="view-title">${t('friends.title')}</h1>
          <p class="view-sub">${t('friends.sub')}</p>
        </div>
        <div class="panel friend-code">
          <span class="field__label">${t('friends.yourCode')}</span>
          <span class="friend-code__value">#${data.friendCode}</span>
          <button class="btn btn--secondary" type="button" data-action="copy">${t('friends.copy')}</button>
        </div>
      </header>

      <div class="stats-grid">
        <section class="panel">
          <h2 class="panel__title">${t('friends.add')}</h2>
          <form class="add-friend" novalidate>
            <label class="field">
              <span class="field__label">${t('friends.codeLabel')}</span>
              <input class="input" name="code" placeholder="#K7Q2XM · ami@example.com" autocomplete="off" spellcheck="false" required>
            </label>
            <button class="btn btn--primary" type="submit">${t('friends.send')}</button>
          </form>
          <p class="form-error" role="alert"></p>

          <h3 class="panel__subtitle">${t('friends.incoming')} ${data.incoming.length ? html`<span class="count-pill">${data.incoming.length}</span>` : ''}</h3>
          ${data.incoming.length
            ? html`<ul class="requests">${data.incoming.map((player) =>
                requestRow(
                  player,
                  html`<button class="btn btn--primary btn--small" type="button" data-action="accept" data-id="${player.id}" data-name="${player.name}">${t('friends.accept')}</button>
                    <button class="btn btn--ghost btn--small" type="button" data-action="decline" data-id="${player.id}">${t('friends.decline')}</button>`,
                ),
              )}</ul>`
            : html`<p class="muted">${t('friends.noRequests')}</p>`}

          <h3 class="panel__subtitle">${t('friends.outgoing')}</h3>
          ${data.outgoing.length
            ? html`<ul class="requests">${data.outgoing.map((player) =>
                requestRow(
                  player,
                  html`<button class="btn btn--ghost btn--small" type="button" data-action="cancel" data-id="${player.id}">${t('friends.cancel')}</button>`,
                ),
              )}</ul>`
            : html`<p class="muted">${t('friends.noRequests')}</p>`}
        </section>

        <section class="panel">
          <h2 class="panel__title">${t('friends.ranking')}</h2>
          ${rankingHTML(data.ranking, data.scoring)}
        </section>

        <section class="panel panel--wide">
          <h2 class="panel__title">${t('friends.list', { count: data.friends.length })}</h2>
          ${data.friends.length
            ? html`<ul class="friends">${data.friends.map(friendCardHTML)}</ul>`
            : html`<p class="muted">${t('friends.noFriends')}</p>`}
        </section>
      </div>
    </section>`,
  );

  const view = $('.view-friends', main);
  const errorBox = $('.form-error', view);

  $('.add-friend', view).addEventListener('submit', async (event) => {
    event.preventDefault();
    const input = event.currentTarget.elements.code;
    if (!input.value.trim()) return input.focus();
    errorBox.textContent = '';
    try {
      const result = await addFriend(input.value);
      toast(t(result.status === 'accepted' ? 'friends.nowFriends' : 'friends.sent', { name: result.friend.name }), 'success');
      paint(main, result);
    } catch (err) {
      errorBox.textContent = errorText(err);
      input.focus();
    }
  });

  view.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const { action, id, name } = button.dataset;
    try {
      if (action === 'copy') {
        await navigator.clipboard?.writeText(`#${data.friendCode}`);
        toast(t('friends.copied'), 'success');
      } else if (action === 'accept') {
        paint(main, await acceptFriend(id));
        toast(t('friends.accepted', { name }), 'success');
      } else if (action === 'decline') {
        paint(main, await declineFriend(id));
        toast(t('friends.declined'));
      } else if (action === 'cancel') {
        paint(main, await removeFriend(id));
        toast(t('friends.canceled'));
      } else if (action === 'remove') {
        const ok = await confirmDialog({
          title: t('friends.removeTitle', { name }),
          message: t('friends.removeText'),
          confirmLabel: t('friends.remove'),
          danger: true,
        });
        if (!ok) return;
        paint(main, await removeFriend(id));
        toast(t('friends.removed', { name }));
      }
    } catch (err) {
      toast(errorText(err), 'error');
    }
  });
}

export async function renderFriends(main) {
  const id = ++renderId;
  mount(main, html`<section class="view"><div class="loading"><span class="loading__spinner"></span> ${t('common.loading')}</div></section>`);
  try {
    const data = await fetchFriends();
    if (id === renderId && main.isConnected) paint(main, data);
  } catch (err) {
    if (id === renderId) mount(main, html`<div class="empty panel"><p class="empty__title">${t('common.oops')}</p><p>${errorText(err)}</p></div>`);
  }
}

/** Read-only collection of a friend (#/friends/<id>). */
export async function renderFriendCollection(main, friendId) {
  const id = ++renderId;
  mount(main, html`<section class="view"><div class="loading"><span class="loading__spinner"></span> ${t('common.loading')}</div></section>`);
  try {
    const { player, cards } = await fetchFriendCollection(friendId);
    if (id !== renderId || !main.isConnected) return;
    renderCollection(main, { player, owned: new Map(cards.map((entry) => [entry.cardId, entry])) });
  } catch (err) {
    if (id === renderId) {
      mount(
        main,
        html`<div class="empty panel">
          <p class="empty__title">${t('common.oops')}</p><p>${errorText(err)}</p>
          <a class="btn btn--primary" href="#/friends">${t('friends.back')}</a>
        </div>`,
      );
    }
  }
}
