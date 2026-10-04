/**
 * The ×10 show: each booster set has its own theme and its own anime
 * "cut-ins" (a manga-style band crossing the screen with the anime's picture
 * and one of its famous lines). An anime is in one show only.
 */
import { html, prefersReducedMotion } from '../dom.js';
import { cardText, has, t } from '../i18n.js';
import { state } from '../state.js';
import { burst } from '../ui/effects.js';
import { sfx } from '../ui/sfx.js';

/** Theme (CSS: .stage[data-show="…"]), confetti colors and the 6 anime of each set, by card id. */
const SHOWS = {
  'all-stars': {
    theme: 'legends',
    colors: ['#ffd23f', '#ff2e88', '#3a86ff', '#06d6a0', '#8338ec', '#ffffff'],
    anime: ['dragon-ball-z', 'pokemon', 'sailor-moon', 'neon-genesis-evangelion', 'bleach', 'hunter-hunter'],
  },
  showa: {
    theme: 'retro',
    colors: ['#fefae0', '#dda15e', '#bc6c25', '#e63946', '#ffd23f'],
    anime: ['dragon-ball', 'fist-of-the-north-star', 'mobile-suit-gundam', 'akira', 'saint-seiya', 'doraemon'],
  },
  heisei: {
    theme: 'energy',
    colors: ['#4cc9f0', '#4361ee', '#7209b7', '#ffd23f', '#ffffff'],
    anime: ['one-piece', 'naruto', 'attack-on-titan', 'death-note', 'my-hero-academia', 'jojo-s-bizarre-adventure'],
  },
  reiwa: {
    theme: 'neon',
    colors: ['#ff006e', '#8338ec', '#3a86ff', '#00f5d4', '#ffffff'],
    anime: ['demon-slayer-kimetsu-no-yaiba', 'jujutsu-kaisen', 'chainsaw-man', 'spy-family', 'frieren', 'solo-leveling'],
  },
  // The Halloween event: its monsters, in the Halloween editions of their cards.
  halloween: {
    theme: 'spooky',
    colors: ['#ff6b00', '#ffb347', '#7b2cbf', '#39ff14', '#1a0b2e', '#ffffff'],
    anime: [
      'halloween:death-note',
      'halloween:jujutsu-kaisen',
      'halloween:phantom-blood',
      'halloween:tokyo-ghoul',
      'halloween:higurashi-when-they-cry',
      'halloween:hellsing',
    ],
  },
};

/**
 * { theme, colors, anime: [{ card, shout }] } for a booster set. A set without
 * its own show gets the "legends" theme with its 6 most popular cards.
 */
export function showFor(set) {
  const cards = set.event ? (state.eventCards[set.event] ?? []) : state.cards.filter((card) => !set.era || card.era === set.era);
  const show = SHOWS[set.id] ?? {
    ...SHOWS['all-stars'],
    anime: [...cards].sort((a, b) => b.power - a.power).slice(0, 6).map((card) => card.id),
  };
  const anime = show.anime
    .map((id) => state.cardsById.get(id))
    .filter(Boolean)
    .map((card) => ({ card, shout: has(`show.shouts.${card.id}`) ? t(`show.shouts.${card.id}`) : t('show.shoutDefault') }));
  return { theme: show.theme, colors: show.colors, anime };
}

/**
 * A cut-in crosses the screen with the card's picture, its name and `shout`.
 * Resolves once it is gone.
 */
export function cutIn({ card, shout }, { side = 'left', theme = 'legends', duration = 1150 } = {}) {
  const element = document.createElement('div');
  element.className = `cutin cutin--${side} cutin--${theme}`;
  element.setAttribute('aria-hidden', 'true');
  element.style.setProperty('--duration', `${duration}ms`);
  element.innerHTML = String(html`<div class="cutin__band">
    <div class="cutin__art">${card.image && html`<img src="${card.image.src}" alt="" draggable="false">`}</div>
    <div class="cutin__text">
      <span class="cutin__name">${cardText(card).name}</span>
      <span class="cutin__shout">${shout}</span>
    </div>
  </div>`);
  document.body.append(element);
  sfx.play('whoosh');
  return new Promise((resolve) =>
    setTimeout(() => {
      element.remove();
      resolve();
    }, prefersReducedMotion() ? 700 : duration),
  );
}

/** Removes the cut-ins on screen (when the show is skipped). */
export function clearCutIns() {
  for (const element of document.querySelectorAll('.cutin')) element.remove();
}

/** Confetti everywhere: from the bottom corners, rain from the top and a big burst in the middle. */
export function confettiStorm(colors, { rounds = 6 } = {}) {
  const width = window.innerWidth;
  const height = window.innerHeight;
  burst(width / 2, height / 2, { colors, count: 180, power: 2.1 });
  for (let k = 0; k < rounds; k++) {
    setTimeout(() => {
      burst(width * (k % 2 ? 0.92 : 0.08), height * 0.9, { colors, count: 60, power: 2 });
      burst(width * (0.15 + Math.random() * 0.7), height * (0.1 + Math.random() * 0.2), { colors, count: 40, power: 1 });
    }, k * 170);
  }
}

/** `count` small packs (the `packHTML` of the set) fly out of (x, y) in every direction. */
export function scatterPacks(packHTML, count, x, y) {
  const layer = document.createElement('div');
  layer.className = 'pack-scatter';
  layer.setAttribute('aria-hidden', 'true');
  layer.style.left = `${x}px`;
  layer.style.top = `${y}px`;
  layer.innerHTML = String(
    html`${Array.from({ length: count }, (_, i) => html`<span class="pack-scatter__pack" style="--a:${Math.round((360 / count) * i + 18)}deg;--i:${i}">${packHTML}</span>`)}`,
  );
  document.body.append(layer);
  setTimeout(() => layer.remove(), 1600);
}
