/**
 * Gems (💎), the rare money of the game: the gem (a cut stone inked like the rest of the
 * game) and an amount of gems. The rolling counter and the flying sparkles of ui/kira.js
 * work for them too (flySparkles with { symbol: GEM_SVG }).
 */
import { fmt, html, raw } from '../dom.js';

/** A cut gem: its crown, three facets, a shine, and the ink outline. */
export const GEM_SVG = `<svg viewBox="0 0 26 22" focusable="false" aria-hidden="true">
  <path d="M7 1.5h12l5.5 6.2L13 20.5 1.5 7.7z" fill="#36c5f0"/>
  <path d="M7 1.5h12l5.5 6.2h-23z" fill="#a8f0ff"/>
  <path d="M1.5 7.7 13 20.5 8.3 7.7z" fill="#1e9bd7"/>
  <path d="M17.7 7.7 13 20.5 24.5 7.7z" fill="#1471b8"/>
  <path d="M9 2.8h4.2L11.6 6.4H6.2z" fill="#fff" opacity=".85"/>
  <path d="M7 1.5h12l5.5 6.2L13 20.5 1.5 7.7zM1.5 7.7h23M8.3 7.7 13 20.5l4.7-12.8M7 1.5l1.3 6.2L13 1.5l4.7 6.2L19 1.5" fill="none" stroke="#16130f" stroke-width="1.6" stroke-linejoin="round"/>
</svg>`;

/** A gem (CSS .gem-icon), `size`: '' or 'big'. */
export const gemIconHTML = (size = '') => html`<span class="gem-icon${size ? ` gem-icon--${size}` : ''}" aria-hidden="true">${raw(GEM_SVG)}</span>`;

/** "12 💎", or with a `sign` in front: "+200 💎". */
export const gemsHTML = (amount, sign = '') => html`<span class="gem-amount">${sign}${fmt.number(amount)}${gemIconHTML()}</span>`;
