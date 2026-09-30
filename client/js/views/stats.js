/** "Stats" page: numbers, luck compared with the official odds, history, leaderboard and account. */
import { $, fmt, html, mount, raw } from '../dom.js';
import { cardText, errorText, rarityName, setName, t, tHtml } from '../i18n.js';
import {
  changePassword,
  fetchHistory,
  fetchLeaderboard,
  reloadPlayer,
  renamePlayer,
  resetCollection,
  state,
} from '../state.js';
import { confirmDialog, formDialog } from '../components/modal.js';
import { toast } from '../ui/toast.js';

let renderId = 0;

const tile = (label, value, hint = '') => html`<div class="stat-tile">
  <span class="stat-tile__value">${value}</span>
  <span class="stat-tile__label">${label}</span>
  ${hint && html`<span class="stat-tile__hint">${hint}</span>`}
</div>`;

function luckHTML(stats) {
  const { rarities, booster } = state.meta;
  if (!stats.cardsPulled) return html`<p class="muted">${t('stats.luckEmpty')}</p>`;
  return html`<div class="luck">
    ${[...rarities].reverse().map((rarity) => {
      const yours = (stats.pullsByRarity[rarity.id] ?? 0) / stats.cardsPulled;
      const expected = booster.odds.expected[rarity.id] / booster.size;
      const scale = (ratio) => Math.min(100, (ratio / 0.6) * 100).toFixed(1);
      return html`<div class="luck__row r-${rarity.id}" title="${rarityName(rarity.id)}">
        <span class="rarity-badge">${rarity.id}</span>
        <div class="luck__bars">
          <span class="luck__bar luck__bar--you" style="width:${scale(yours)}%"></span>
          <span class="luck__bar luck__bar--expected" style="width:${scale(expected)}%"></span>
        </div>
        <span class="luck__values"><b>${fmt.percent(yours, 1)}</b> <span class="muted">${t('stats.vs')} ${fmt.percent(expected, 1)}</span></span>
      </div>`;
    })}
    <p class="luck__legend"><span class="swatch swatch--you"></span> ${t('stats.yours')} <span class="swatch swatch--expected"></span> ${t('stats.expected')}</p>
  </div>`;
}

function historyHTML(boosters) {
  if (!boosters.length) return html`<p class="muted">${t('stats.noHistory')}</p>`;
  return html`<ol class="history">
    ${boosters.map((booster) => html`<li class="history__item">
      <div class="history__head">
        <strong>${setName(booster.setId)}</strong>
        <time datetime="${booster.openedAt}" title="${fmt.date(booster.openedAt)}">${fmt.timeAgo(booster.openedAt)}</time>
      </div>
      <div class="history__cards">
        ${booster.cards.map((pull) => {
          const card = state.cardsById.get(pull.id);
          return html`<span class="mini-chip r-${pull.rarity}" title="${rarityName(pull.rarity)}">
            <b>${pull.rarity}</b> ${card ? cardText(card).name : pull.name}${pull.isNew ? html` <em>${t('stats.new')}</em>` : ''}
          </span>`;
        })}
      </div>
    </li>`)}
  </ol>`;
}

function leaderboardHTML(players) {
  if (!players.length) return html`<p class="muted">${t('stats.nobody')}</p>`;
  return html`<table class="leaderboard">
    <thead><tr>
      <th scope="col">${t('stats.rank')}</th><th scope="col">${t('stats.player')}</th>
      <th scope="col">${t('stats.score')}</th><th scope="col">${t('stats.cards')}</th>
    </tr></thead>
    <tbody>
      ${players.map((p) => html`<tr class="${p.you ? 'is-you' : ''}">
        <td>${p.rank === 1 ? '🥇' : p.rank === 2 ? '🥈' : p.rank === 3 ? '🥉' : p.rank}</td>
        <td>${p.name}${p.you ? html` <span class="you-pill">${t('stats.you')}</span>` : ''}</td>
        <td><b class="score">${fmt.number(p.score)}</b></td>
        <td>${p.uniqueCards} <span class="muted">(${fmt.percent(p.completion)})</span></td>
      </tr>`)}
    </tbody>
  </table>`;
}

export async function renderStats(main) {
  const id = ++renderId;
  mount(main, html`<section class="view view-stats"><div class="loading"><span class="loading__spinner"></span> ${t('stats.loading')}</div></section>`);

  let history;
  let leaderboard;
  try {
    [{ boosters: history }, { players: leaderboard }] = await Promise.all([fetchHistory(12), fetchLeaderboard(), reloadPlayer()]);
  } catch (err) {
    if (id === renderId) mount(main, html`<div class="empty panel"><p class="empty__title">${t('common.oops')}</p><p>${errorText(err)}</p></div>`);
    return;
  }
  if (id !== renderId || !main.isConnected) return;

  const { player } = state;
  const stats = player.stats;
  const duplicates = stats.cardsPulled - stats.uniqueCards;
  const bestRarity = [...state.meta.rarities].reverse().find((r) => stats.pullsByRarity[r.id]);

  mount(
    main,
    html`<section class="view view-stats">
      <header class="view-head">
        <div>
          <p class="view-kicker" lang="ja">記録</p>
          <h1 class="view-title">${t('stats.title')}</h1>
          <p class="view-sub">${raw(tHtml('stats.playing', { name: player.name, date: fmt.date(player.createdAt) }))}</p>
        </div>
      </header>

      <div class="stat-tiles">
        ${tile(t('stats.score'), fmt.number(stats.score))}
        ${tile(t('stats.boosters'), fmt.number(stats.boostersOpened))}
        ${tile(t('stats.pulled'), fmt.number(stats.cardsPulled))}
        ${tile(t('stats.unique'), `${stats.uniqueCards}/${stats.totalCards}`, fmt.percent(stats.completion, 1))}
        ${tile(t('stats.duplicates'), fmt.number(duplicates))}
        ${tile(t('stats.urPulled'), fmt.number((stats.pullsByRarity.UR ?? 0) + (stats.pullsByRarity.REV ?? 0)))}
        ${tile(t('stats.best'), bestRarity ? bestRarity.id : '—', bestRarity ? rarityName(bestRarity.id) : '')}
      </div>

      <div class="stats-grid">
        <section class="panel">
          <h2 class="panel__title">${t('stats.luck')}</h2>
          ${luckHTML(stats)}
        </section>
        <section class="panel">
          <h2 class="panel__title">${t('stats.leaderboard')}</h2>
          ${leaderboardHTML(leaderboard)}
        </section>
        <section class="panel panel--wide">
          <h2 class="panel__title">${t('stats.history')}</h2>
          ${historyHTML(history)}
        </section>
        <section class="panel panel--wide">
          <h2 class="panel__title">${t('stats.account')}</h2>
          <dl class="account">
            <div><dt>${t('stats.player')}</dt><dd>${player.name}</dd></div>
            <div><dt>${t('stats.email')}</dt><dd>${player.email ?? '—'}</dd></div>
          </dl>
          <p class="muted">${t('stats.accountText')}</p>
          <div class="btn-row btn-row--start">
            <button class="btn btn--secondary" type="button" data-action="rename">${t('stats.rename')}</button>
            <button class="btn btn--secondary" type="button" data-action="password">${t('stats.changePassword')}</button>
            <button class="btn btn--ghost" type="button" data-action="logout">${t('stats.logout')}</button>
            <button class="btn btn--danger" type="button" data-action="reset">${t('stats.reset')}</button>
          </div>
        </section>
      </div>
    </section>`,
  );

  $('.view-stats', main).addEventListener('click', async (event) => {
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (action === 'rename') {
      const saved = await formDialog({
        title: t('stats.renameTitle'),
        fields: [{ name: 'name', label: t('stats.renameLabel'), value: player.name, maxLength: 24 }],
        onSubmit: ({ name }) => renamePlayer(name),
      });
      if (saved) {
        toast(t('stats.nameSaved'), 'success');
        renderStats(main);
      }
    } else if (action === 'password') {
      const saved = await formDialog({
        title: t('stats.passwordTitle'),
        fields: [
          { name: 'current', label: t('stats.currentPassword'), type: 'password', autocomplete: 'current-password' },
          { name: 'next', label: t('stats.newPassword'), type: 'password', autocomplete: 'new-password', maxLength: 128, hint: t('auth.passwordHint') },
        ],
        onSubmit: ({ current, next }) => changePassword(current, next),
      });
      if (saved) toast(t('stats.passwordSaved'), 'success');
    } else if (action === 'logout') {
      window.dispatchEvent(new CustomEvent('mb:logout'));
    } else if (action === 'reset') {
      const ok = await confirmDialog({
        title: t('stats.resetTitle'),
        message: t('stats.resetText'),
        confirmLabel: t('stats.resetConfirm'),
        danger: true,
      });
      if (!ok) return;
      try {
        await resetCollection();
        toast(t('stats.resetDone'), 'success');
        renderStats(main);
      } catch (err) {
        toast(errorText(err), 'error');
      }
    }
  });
}
