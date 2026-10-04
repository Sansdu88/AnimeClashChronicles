/**
 * The popup of the "Events" button (in the header, or in the "More" sheet on phones): every
 * limited-time event of the game (meta.events, see events.js), on now or not, with its booster,
 * how many of its cards you have, and the way to its booster and to its collection.
 */
import { html, mount, raw } from '../dom.js';
import { t, tHtml } from '../i18n.js';
import { state } from '../state.js';
import { EVENT_ICONS, eventCards } from '../events.js';
import { openModal } from './modal.js';
import { chooseBook } from '../views/collection.js';
import { packHTML } from '../views/open.js';

function eventHTML(event) {
  const cards = eventCards(event.id);
  const have = cards.filter((card) => state.owned.has(card.id)).length;
  const count = (rarity) => cards.filter((card) => card.rarity === rarity).length;
  return html`<li class="event-item ev-${event.id}${event.active ? ' is-live' : ''}">
    <span class="pack event-item__pack" aria-hidden="true">${packHTML(event.set)}</span>
    <div class="event-item__body">
      <p class="event-item__head">
        <b class="event-item__name">${EVENT_ICONS[event.id] ?? '🎉'} ${t(`events.${event.id}.title`)}</b>
        <span class="event-item__state">${event.active ? `● ${t('eventsPopup.live')}` : t('eventsPopup.off')}</span>
      </p>
      <p class="event-item__pitch">${raw(tHtml(`events.${event.id}.pitch`, { count: cards.length, rev: count('REV'), ur: count('UR') }))}</p>
      <p class="event-item__rule">${event.active ? `⏳ ${t('open.eventStock', { count: event.hours, max: event.max })}` : t('eventsPopup.offText')}</p>
      <div class="event-item__progress">
        <span class="meter"><span class="meter__fill" style="width:${cards.length ? ((have / cards.length) * 100).toFixed(1) : 0}%"></span></span>
        <span class="event-item__count">${t('eventsPopup.collected', { have, total: cards.length })}</span>
      </div>
      <div class="btn-row btn-row--start">
        ${event.active && html`<a class="btn btn--primary" href="#/" data-close>${t('eventsPopup.open')}</a>`}
        ${(event.active || have > 0) && html`<a class="btn btn--secondary" href="#/collection" data-book="${event.id}" data-close>${t('eventsPopup.cards')}</a>`}
      </div>
    </div>
  </li>`;
}

/** The events, the ones on now first. */
export function openEventsPopup() {
  const events = [...state.meta.events].sort((a, b) => Number(b.active) - Number(a.active));
  const modal = openModal('', { label: t('nav.events'), className: 'modal--events' });
  mount(
    modal.body,
    html`<div class="events-popup">
      <h2 class="dialog__title">🎉 ${t('nav.events')}</h2>
      <p class="muted">${t('eventsPopup.sub')}</p>
      ${events.length ? html`<ul class="event-list">${events.map(eventHTML)}</ul>` : html`<p class="muted">${t('eventsPopup.none')}</p>`}
    </div>`,
  );
  modal.body.addEventListener('click', (event) => {
    const link = event.target.closest('a[href^="#"]');
    if (!link) return;
    if (link.dataset.book) chooseBook(link.dataset.book);
    // A link to the page already on screen does not change the URL (no hashchange): draw it again.
    const route = (hash) => hash.replace(/^#\/?/, '');
    if (route(link.hash) === route(location.hash)) window.dispatchEvent(new CustomEvent('mb:refresh'));
  });
}
