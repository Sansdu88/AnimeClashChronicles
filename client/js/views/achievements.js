/**
 * "Achievements" page: collect every card of a booster (All-Stars, which holds every card, is
 * not one of them) to unlock an achievement, worth gems and a badge next to your name
 * (meta.achievements, ACHIEVEMENTS in server/config.js). The server unlocks them on its own;
 * this page shows how close you are. Also the badges shown next to the players' names, and the
 * popup that celebrates a new achievement (main.js opens it once the booster stage is closed).
 */
import { fmt, html, mount, raw } from '../dom.js';
import { setName, t, tHtml } from '../i18n.js';
import { cardsOfSet, setOf, state } from '../state.js';
import { confettiStorm } from '../components/booster-show.js';
import { openModal } from '../components/modal.js';
import { gemsHTML } from '../ui/gems.js';
import { sfx } from '../ui/sfx.js';

const CONFETTI = ['#ffd23f', '#36c5f0', '#a8f0ff', '#ff2e88', '#ffffff'];

const nameOf = (id) => t(`achievements.list.${id}.name`);

/** How close the player is to an achievement: { have, total, setId } (for `any`: the closest booster). */
function progressOf(achievement) {
  const rows = achievement.sets
    .map(setOf)
    .filter(Boolean)
    .map((set) => {
      const cards = cardsOfSet(set);
      return { setId: set.id, have: cards.filter((card) => state.owned.has(card.id)).length, total: cards.length };
    });
  if (achievement.any) return rows.sort((a, b) => b.have / b.total - a.have / a.total)[0] ?? { have: 0, total: 0, setId: null };
  return rows.reduce((sum, row) => ({ ...sum, have: sum.have + row.have, total: sum.total + row.total }), { have: 0, total: 0, setId: null });
}

/** The badges of a player, after their name: `ids` = their achievements (the order of meta.achievements). */
export function badgesHTML(ids = []) {
  const shown = (state.meta?.achievements ?? []).filter((achievement) => ids.includes(achievement.id));
  if (!shown.length) return '';
  return html`<span class="badges">${shown.map(
    (achievement) => html`<span class="badge" role="img" title="${nameOf(achievement.id)}" aria-label="${nameOf(achievement.id)}">${achievement.icon}</span>`,
  )}</span>`;
}

function achievementHTML(achievement, unlocked) {
  const { have, total, setId } = progressOf(achievement);
  return html`<li class="achievement${unlocked ? ' is-unlocked' : ''}">
    <span class="achievement__badge" aria-hidden="true">${achievement.icon}</span>
    <div class="achievement__body">
      <h2 class="achievement__name">${nameOf(achievement.id)}</h2>
      <p class="achievement__text">${t(`achievements.list.${achievement.id}.text`)}</p>
      ${unlocked
        ? html`<p class="achievement__done">✓ ${t('achievements.unlockedOn', { date: fmt.date(unlocked.unlockedAt) })}</p>`
        : html`<div class="achievement__progress">
            <span class="meter"><span class="meter__fill" style="width:${total ? ((have / total) * 100).toFixed(1) : 0}%"></span></span>
            <span class="achievement__count">${t('achievements.progress', { have: fmt.number(have), total: fmt.number(total) })}</span>
          </div>
          <p class="muted achievement__hint">${achievement.any && setId ? `${t('achievements.closest', { set: setName(setId) })} · ` : ''}${t('achievements.missing', { count: total - have })}</p>`}
    </div>
    <div class="achievement__side">
      <span class="achievement__reward">${gemsHTML(achievement.gems, '+')}</span>
      <span class="achievement__status">${unlocked ? '🏅' : `🔒 ${t('achievements.locked')}`}</span>
    </div>
  </li>`;
}

export function renderAchievements(main) {
  const { player, meta } = state;
  const unlocked = new Map(player.achievements.map((row) => [row.id, row]));
  const earned = player.achievements.reduce((sum, row) => sum + row.gems, 0);
  // Every achievement gives the same gems for now: the most one gives is shown in the title.
  const reward = Math.max(0, ...meta.achievements.map((achievement) => achievement.gems));
  mount(
    main,
    html`<section class="view view-achievements">
      <div class="hero hero--achievements">
        <h1 class="hero__title">🏅 ${t('achievements.title')}</h1>
        <p class="hero__sub">${raw(tHtml('achievements.sub', { gems: reward }))}</p>
      </div>

      <section class="panel achievements-summary">
        <div class="achievements-summary__numbers">
          <p class="achievements-summary__count">${t('achievements.summary', { count: unlocked.size, total: meta.achievements.length })}</p>
          <p class="achievements-summary__earned">${gemsHTML(earned)} <span>${t('achievements.earned', { count: earned, gems: fmt.number(earned) })}</span></p>
        </div>
        <div class="achievements-summary__badges">
          <p class="field__label">${t('achievements.yourBadges')}</p>
          <p class="achievements-summary__name">👤 <b>${player.name}</b> ${badgesHTML([...unlocked.keys()])}</p>
          ${!unlocked.size && html`<p class="muted">${t('achievements.noBadges')}</p>`}
        </div>
      </section>

      <ul class="achievement-list">${meta.achievements.map((achievement) => achievementHTML(achievement, unlocked.get(achievement.id)))}</ul>
    </section>`,
  );
}

/**
 * Celebrates achievements just unlocked (`rows`: [{ id, gems }] of player.achievements): their
 * badge, their gems, confetti. `onClose`: when the popup is closed.
 */
export function openAchievementPopup(rows, { onClose } = {}) {
  const items = rows
    .map((row) => ({ row, achievement: state.meta.achievements.find((achievement) => achievement.id === row.id) }))
    .filter(({ achievement }) => achievement);
  if (!items.length) {
    onClose?.();
    return;
  }
  const gems = items.reduce((sum, { row }) => sum + row.gems, 0);
  openModal(
    html`<div class="achievement-popup">
      <p class="achievement-popup__kicker">${t('achievements.kicker')}</p>
      <ul class="achievement-popup__list">
        ${items.map(({ achievement }) => html`<li class="achievement-popup__item">
          <span class="achievement-popup__badge" aria-hidden="true">${achievement.icon}</span>
          <b class="achievement-popup__name">${nameOf(achievement.id)}</b>
          <span class="achievement-popup__text">${t(`achievements.list.${achievement.id}.text`)}</span>
        </li>`)}
      </ul>
      <p class="achievement-popup__gems">${gemsHTML(gems, '+')}</p>
      <p class="muted">${t('achievements.badgeNote')}</p>
      <div class="btn-row">
        <a class="btn btn--ghost" href="#/achievements" data-close>${t('achievements.see')}</a>
        <button class="btn btn--primary btn--big" type="button" data-close>${t('achievements.ok')}</button>
      </div>
    </div>`,
    { label: t('achievements.kicker'), className: 'modal--small modal--achievement', onClose },
  );
  sfx.play('fanfare');
  confettiStorm(CONFETTI, { rounds: 4 });
}
