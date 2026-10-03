/**
 * "Stats" page: numbers, the weekly ranking (rewards every Sunday at midnight), luck
 * compared with the official odds, history, leaderboard and account.
 */
import { $, everySecond, fmt, html, mount, raw } from '../dom.js';
import { cardText, errorText, rarityName, setName, t, tHtml } from '../i18n.js';
import {
  changePassword,
  fetchHistory,
  fetchLeaderboard,
  fetchWeekly,
  reloadPlayer,
  renamePlayer,
  resetCollection,
  state,
} from '../state.js';
import { confirmDialog, formDialog } from '../components/modal.js';
import { kiraHTML } from '../ui/kira.js';
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
        <strong>${setName(booster.setId)}${booster.kira ? html` <span class="history__price" title="${t('stats.bought')}">${kiraHTML(booster.kira)}</span>` : ''}</strong>
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

const medal = (rank) => ({ 1: '🥇', 2: '🥈', 3: '🥉' })[rank] ?? rank;

/** "5 Super Boosters + 100 Kira": a reward of the weekly ranking, in words (for toasts and labels). */
export function rewardText({ superBoosters = 0, kira = 0 }) {
  const parts = [superBoosters && t('weekly.superBoosters', { count: superBoosters }), kira && t('weekly.kira', { count: fmt.number(kira) })];
  return parts.filter(Boolean).join(' + ') || '—';
}

/** A reward of the weekly ranking as chips: ⭐ ×5 (Super Boosters), 300 ✦. */
const rewardHTML = (reward) =>
  html`<span class="reward" title="${rewardText(reward)}">
    ${reward.superBoosters > 0 && html`<span class="reward__super">⭐ ×${reward.superBoosters}</span>`}
    ${reward.kira > 0 && kiraHTML(reward.kira)}
    ${!reward.superBoosters && !reward.kira && '—'}
  </span>`;

/**
 * The weekly ranking: one row per rank that gets a reward (empty while nobody holds it),
 * your row below when you are further down, and the winners of last week.
 */
function weeklyHTML(weekly) {
  const row = (rank, player, reward) => html`<tr class="${player?.you ? 'is-you' : ''}">
    <td>${medal(rank)}</td>
    <td>${player ? html`${player.name}${player.you ? html` <span class="you-pill">${t('stats.you')}</span>` : ''}` : html`<span class="muted">—</span>`}</td>
    <td>${player ? html`<b class="score">${fmt.number(player.points)}</b>` : ''}</td>
    <td>${player ? html`${player.cards} <span class="muted">(${t('weekly.new', { count: player.newCards })})</span>` : ''}</td>
    <td>${reward ? rewardHTML(reward) : ''}</td>
  </tr>`;
  const { you, last } = weekly;
  const winners = last?.results.slice(0, 3) ?? [];
  const yours = last?.results.find((result) => result.you);
  return html`<div class="weekly__body">
    <div class="table-wrap">
      <table class="leaderboard weekly__table">
        <thead><tr>
          <th scope="col">${t('stats.rank')}</th><th scope="col">${t('stats.player')}</th>
          <th scope="col">${t('weekly.points')}</th><th scope="col">${t('stats.cards')}</th><th scope="col">${t('weekly.reward')}</th>
        </tr></thead>
        <tbody>
          ${weekly.rewards.map((reward, i) => row(i + 1, weekly.players[i], reward))}
          ${you && you.rank > weekly.rewards.length && html`<tr class="weekly__gap" aria-hidden="true"><td colspan="5">⋯</td></tr>${row(you.rank, you, null)}`}
        </tbody>
      </table>
    </div>
    <aside class="weekly__side">
      <div class="weekly__you">
        <h3 class="panel__subtitle">${t('weekly.yourWeek')}</h3>
        ${you
          ? html`<p class="weekly__rank"><span class="weekly__medal">${medal(you.rank)}</span> ${t('weekly.yourRank', { rank: you.rank, points: fmt.number(you.points), count: you.rank })}</p>`
          : html`<p class="muted">${t('weekly.notRanked')}</p>`}
      </div>
      <div class="weekly__last">
        <h3 class="panel__subtitle">${t('weekly.last')}</h3>
        ${winners.length
          ? html`<ol class="weekly__winners">
              ${winners.map((winner) => html`<li class="${winner.you ? 'is-you' : ''}">
                <span class="weekly__medal">${medal(winner.rank)}</span>
                <b>${winner.name}</b> <span class="muted">${fmt.number(winner.points)} ${t('weekly.pts')}</span>
                ${rewardHTML(winner)}
              </li>`)}
            </ol>
            ${yours && html`<p class="weekly__won">🎉 ${t('weekly.youWon', { rank: yours.rank, prize: rewardText(yours), count: yours.rank })}</p>`}`
          : html`<p class="muted">${t('weekly.lastEmpty')}</p>`}
      </div>
    </aside>
  </div>`;
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
  let weekly;
  try {
    [{ boosters: history }, { players: leaderboard }, weekly] = await Promise.all([fetchHistory(12), fetchLeaderboard(), fetchWeekly(), reloadPlayer()]);
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
          <h1 class="view-title">${t('stats.title')}</h1>
          <p class="view-sub">${raw(tHtml('stats.playing', { name: player.name, date: fmt.date(player.createdAt) }))}</p>
        </div>
        <button class="btn btn--secondary" type="button" data-action="tutorial">${t('stats.tutorial')}</button>
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
        <section class="panel panel--wide weekly">
          <div class="weekly__head">
            <h2 class="panel__title">🏆 ${t('weekly.title')}</h2>
            <p class="weekly__timer"></p>
          </div>
          <p class="muted">${t('weekly.hint')}</p>
          ${weeklyHTML(weekly)}
        </section>
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

  // The week ends on Sunday at midnight: the page asks for the new one (and the rewards are given).
  const timer = $('.weekly__timer', main);
  const weekEndsAt = Date.now() + weekly.nextIn * 1000;
  everySecond(() => {
    if (!timer.isConnected) return false;
    const left = Math.ceil((weekEndsAt - Date.now()) / 1000);
    if (left <= 0) {
      renderStats(main);
      return false;
    }
    const time = left >= 86_400 ? t('weekly.days', { days: Math.floor(left / 86_400), hours: Math.floor((left % 86_400) / 3600) }) : fmt.duration(left);
    timer.textContent = `⏳ ${t('weekly.endsIn', { time })}`;
    return true;
  });

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
    } else if (action === 'tutorial') {
      window.dispatchEvent(new CustomEvent('mb:tutorial'));
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
