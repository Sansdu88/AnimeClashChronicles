/**
 * Limited-time events (Halloween…), turned on and off by the admins: /api/meta lists them
 * (meta.events: { id, active, hours, max, set }) and their cards are in state.eventCards.
 * While one is on, the page wears its theme: html[data-event="…"] (css/events.css), a
 * decor behind the pages (DECORS) and its sounds (sfx.theme, see ui/sfx.js).
 * To add an event: EVENTS in server/config.js, its cards and booster in a migration, then
 * its texts (i18n.js: events.<id>, sets.<id>), its look (css/events.css) and here its decor.
 */
import { state } from './state.js';
import { sfx } from './ui/sfx.js';

/** The events on now. */
export const activeEvents = () => state.meta?.events?.filter((event) => event.active) ?? [];

/** An event of meta.events, on or not (null if there is none). */
export const eventOf = (id) => state.meta?.events?.find((event) => event.id === id) ?? null;

/** The cards of an event, in number order. */
export const eventCards = (id) => state.eventCards[id] ?? [];

/** The event the page wears the theme of: the first one on, or null. */
export const themeEvent = () => activeEvents()[0]?.id ?? null;

/** The emblem of each event, on its cards, its booster and its tab of the collection. */
export const EVENT_ICONS = { halloween: '🎃' };

/** The color of the browser's bar (phones) during an event. */
const THEME_COLORS = { halloween: '#24103b' };

// A bat and a ghost, drawn in SVG (the decor is aria-hidden).
const BAT = `<svg viewBox="0 0 100 50" aria-hidden="true"><path d="M50 18 46 10 46.5 19C40 14 28 9 3 13 11 18 14 24 13 31 18 26 25 26 28 32 32 27 38 27 41 33 44 29 47 29 50 36 53 29 56 29 59 33 62 27 68 27 72 32 75 26 82 26 87 31 86 24 89 18 97 13 72 9 60 14 53.5 19L54 10Z"/></svg>`;
const GHOST = `<svg viewBox="0 0 60 70" aria-hidden="true"><path class="ghost__body" d="M6 66V28a24 24 0 0 1 48 0v38l-8-7-8 7-8-7-8 7-8-7z"/><ellipse cx="22" cy="28" rx="4" ry="6"/><ellipse cx="38" cy="28" rx="4" ry="6"/><ellipse cx="30" cy="44" rx="5" ry="4"/></svg>`;

/** The decor of each event: drawn behind the pages, it never takes a click. */
const DECORS = {
  halloween: () => `
    <span class="decor__moon"></span>
    ${[0, 1, 2, 3, 4].map((i) => `<span class="decor__bat" style="--i:${i}">${BAT}</span>`).join('')}
    ${[0, 1].map((i) => `<span class="decor__ghost" style="--i:${i}">${GHOST}</span>`).join('')}
    <span class="decor__web decor__web--left"></span>
    <span class="decor__web decor__web--right"></span>`,
};

/**
 * Puts on (or takes off) the theme of the event on now: the attribute read by the CSS, the
 * decor, the color of the browser's bar and the sounds. Cheap when nothing changed.
 */
export function applyEventTheme() {
  const id = themeEvent();
  const root = document.documentElement;
  // A booster on stage plays the sounds of its own event (see dressStage in views/open.js).
  if (!document.body.classList.contains('has-stage')) sfx.theme = id;
  if ((root.dataset.event ?? null) === id) return;
  if (id) root.dataset.event = id;
  else delete root.dataset.event;

  document.querySelector('.event-decor')?.remove();
  if (id && DECORS[id]) {
    const decor = document.createElement('div');
    decor.className = `event-decor event-decor--${id}`;
    decor.setAttribute('aria-hidden', 'true');
    decor.innerHTML = DECORS[id]();
    document.body.prepend(decor);
  }
  const color = document.querySelector('meta[name="theme-color"]');
  color.dataset.base ??= color.content;
  color.content = THEME_COLORS[id] ?? color.dataset.base;
}
