/**
 * "Daily" page and popup: once a day, a free booster of your choice, opened at
 * once (views/open.js, openDaily); every `cycle` days (5), the Super Booster.
 * The popup shows up at the first visit of the day (main.js).
 */
import { $, everySecond, fmt, html, mount, raw } from '../dom.js';
import { setName, t, tHtml } from '../i18n.js';
import { dailyStatus, setOf, state } from '../state.js';
import { openModal } from '../components/modal.js';
import { sfx } from '../ui/sfx.js';
import { openDaily, packHTML } from './open.js';

const superSet = () => state.meta.daily.superSet;

/** The days of the cycle, like a stamp card: claimed ones are stamped, today's one bounces. */
function trackHTML({ day, cycle, available }) {
  return html`<ol class="daily-track" style="--days:${cycle}" aria-label="${t('daily.track', { day, cycle })}">
    ${Array.from({ length: cycle }, (_, i) => {
      const n = i + 1;
      const status = n < day || (n === day && !available) ? 'claimed' : n === day ? 'today' : 'next';
      const isSuperDay = n === cycle;
      return html`<li class="daily-day is-${status}${isSuperDay ? ' daily-day--super' : ''}" style="--i:${i}">
        <span class="daily-day__label">
          ${status === 'today' && html`<span class="daily-day__today">${t('daily.today')}</span>`}
          <span class="daily-day__number">${t('daily.day', { day: n })}</span>
        </span>
        <span class="daily-day__pack" aria-hidden="true">${packHTML(isSuperDay ? superSet() : setOf('all-stars'))}</span>
        <span class="daily-day__reward">${isSuperDay ? t('daily.super') : t('daily.booster')}</span>
        ${status === 'claimed' && html`<span class="daily-day__stamp" title="${t('daily.claimed')}">✓</span>`}
      </li>`;
    })}
  </ol>`;
}

/** Today's reward to claim: the boosters to choose from (chosen by the admins), or the Super Booster. */
function claimHTML({ cycle, super: isSuperDay, superReason, choices }) {
  if (isSuperDay) {
    const heading = { event: t('daily.superEvent'), gift: t('daily.superGift') }[superReason] ?? t('daily.superDay', { cycle });
    return html`<h2 class="daily__heading">${heading}</h2>
      <p class="daily__hint">${t('daily.superInfo')}</p>
      <button class="daily-super" type="button" data-claim="${superSet().id}" aria-label="${t('daily.claimSuper')}">
        <span class="daily-super__aura" aria-hidden="true"></span>
        <span class="pack">${packHTML(superSet())}</span>
      </button>
      <button class="btn btn--special btn--big" type="button" data-claim="${superSet().id}">★ ${t('daily.claimSuper')}</button>`;
  }
  return html`<h2 class="daily__heading">${t('daily.choose')}</h2>
    <p class="daily__hint">${t('daily.chooseHint')}</p>
    <div class="daily-choice">
      ${choices.map(setOf).filter(Boolean).map(
        (set) => html`<button class="daily-pick" type="button" data-claim="${set.id}" aria-label="${t('daily.claimLabel', { set: setName(set.id) })}">
          <span class="pack">${packHTML(set)}</span>
          <span class="daily-pick__name">${setName(set.id)}</span>
        </button>`,
      )}
    </div>`;
}

/** Already claimed: the countdown to the next day, and what it brings. */
function doneHTML({ day, cycle }) {
  const next = (day % cycle) + 1;
  const tomorrow =
    next === 1
      ? t('daily.newCycle')
      : next === cycle
        ? t('daily.tomorrowSuper')
        : `${t('daily.tomorrow', { day: next })} ${t('daily.superIn', { count: cycle - day })}`;
  return html`<div class="daily-done">
    <p class="daily-done__title">✓ ${t('daily.done')}</p>
    <p class="daily-done__next" data-countdown></p>
    <p class="daily-done__tomorrow">${tomorrow}</p>
  </div>`;
}

/**
 * Shows today's reward in `root` and keeps it up to date: the countdown every
 * second, everything when the day changes. A click on a booster claims it.
 */
function mountPanel(root, { beforeClaim } = {}) {
  let shown = null;
  everySecond(() => {
    if (!root.isConnected) return false; // the page was left or the popup closed
    const status = dailyStatus();
    const key = `${status.today} ${status.available} ${status.day}`;
    if (key !== shown) {
      shown = key;
      mount(root, html`${trackHTML(status)}<div class="daily__claim">${status.available ? claimHTML(status) : doneHTML(status)}</div>`);
    }
    const countdown = $('[data-countdown]', root);
    if (countdown) countdown.textContent = `⏳ ${t('daily.nextIn', { time: fmt.duration(status.nextIn) })}`;
    return true;
  });
  root.addEventListener('click', (event) => {
    const button = event.target.closest('[data-claim]');
    if (!button || !dailyStatus().available) return;
    sfx.play('click');
    beforeClaim?.();
    openDaily(button.dataset.claim);
  });
}

export function renderDaily(main) {
  const { cycle } = dailyStatus();
  mount(
    main,
    html`<section class="view view-daily">
      <div class="hero">
        <h1 class="hero__title">🎁 ${t('daily.title')}</h1>
        <p class="hero__sub">${raw(tHtml('daily.sub', { count: cycle }))}</p>
      </div>
      <div class="panel daily"></div>
      <section class="panel daily-info">
        <span class="pack daily-info__pack" aria-hidden="true">${packHTML(superSet())}</span>
        <div>
          <h2 class="panel__title">${t('daily.superTitle')}</h2>
          <p>${t('daily.superInfo')}</p>
          <p class="muted">${t('daily.keep', { count: cycle })}</p>
          <a class="link" href="#/rules">${t('daily.odds')} →</a>
        </div>
      </section>
    </section>`,
  );
  mountPanel($('.daily', main));
}

/** The popup of the first visit of the day. */
export function openDailyPopup() {
  const { cycle } = dailyStatus();
  const modal = openModal(
    html`<div class="daily-popup">
      <div class="hero hero--popup">
        <h2 class="hero__title">🎁 ${t('daily.title')}</h2>
        <p class="hero__sub">${raw(tHtml('daily.sub', { count: cycle }))}</p>
      </div>
      <div class="daily"></div>
      <div class="btn-row"><button class="btn btn--ghost" type="button" data-close>${t('daily.later')}</button></div>
    </div>`,
    { label: t('daily.title'), className: 'modal--daily' },
  );
  mountPanel($('.daily', modal.body), { beforeClaim: () => modal.close() });
}
