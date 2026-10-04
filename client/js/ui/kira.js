/**
 * Kira (✦), the game's money: the coin, a counter that rolls to its new value, and
 * the sparkles a recycled card turns into, flying to the wallet.
 */
import { fmt, html, prefersReducedMotion, wait } from '../dom.js';

/** A Kira coin (CSS .kira-coin), `size`: '' or 'big'. */
export const coinHTML = (size = '') => html`<span class="kira-coin${size ? ` kira-coin--${size}` : ''}" aria-hidden="true">✦</span>`;

/** "1,250 ✦", or with a `sign` in front: "+12 ✦". */
export const kiraHTML = (amount, sign = '') => html`<span class="kira-amount">${sign}${fmt.number(amount)}${coinHTML()}</span>`;

const frames = new WeakMap();

/** Shows `to` in `element`, rolling from the number it showed before. */
export function rollNumber(element, to, duration = 700) {
  const from = Number(element.dataset.value ?? to);
  element.dataset.value = to;
  cancelAnimationFrame(frames.get(element));
  if (from === to || prefersReducedMotion()) {
    element.textContent = fmt.number(to);
    return;
  }
  const start = performance.now();
  const step = (now) => {
    const k = Math.min(1, (now - start) / duration);
    element.textContent = fmt.number(Math.round(from + (to - from) * (1 - (1 - k) ** 3)));
    if (k < 1) frames.set(element, requestAnimationFrame(step));
  };
  frames.set(element, requestAnimationFrame(step));
}

/** The coin bounces (an amount just landed in it). */
export function bump(element) {
  element.classList.remove('is-bumped');
  void element.offsetWidth; // restart the animation
  element.classList.add('is-bumped');
  element.addEventListener('animationend', () => element.classList.remove('is-bumped'), { once: true });
}

/**
 * `count` sparkles fly from `from` (a DOMRect) to the element `to`, each on its own
 * curve. Resolves when the first ones land. `symbol`: what flies (static markup: a Kira
 * sparkle, or the gem of ui/gems.js with `className` 'gem-spark').
 */
export function flySparkles(from, to, { count = 10, symbol = '✦', className = '' } = {}) {
  if (prefersReducedMotion()) return Promise.resolve();
  const target = to.getBoundingClientRect();
  const tx = target.left + target.width / 2;
  const ty = target.top + target.height / 2;
  for (let i = 0; i < count; i++) {
    const spark = document.createElement('span');
    spark.className = `kira-spark${className ? ` ${className}` : ''}`;
    spark.innerHTML = symbol;
    spark.setAttribute('aria-hidden', 'true');
    const x = from.left + from.width * (0.2 + Math.random() * 0.6);
    const y = from.top + from.height * (0.2 + Math.random() * 0.6);
    spark.style.left = `${x}px`;
    spark.style.top = `${y}px`;
    document.body.append(spark);
    const dx = tx - x;
    const dy = ty - y;
    const bend = { x: dx * 0.3 + (Math.random() - 0.5) * 220, y: dy * 0.3 - 60 - Math.random() * 120 };
    spark
      .animate(
        [
          { transform: 'translate(-50%, -50%) scale(0.3) rotate(0deg)', opacity: 0 },
          { transform: `translate(calc(-50% + ${bend.x}px), calc(-50% + ${bend.y}px)) scale(1.4) rotate(120deg)`, opacity: 1, offset: 0.35 },
          { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(0.5) rotate(300deg)`, opacity: 0.8 },
        ],
        { duration: 700 + i * 35, delay: i * 25, easing: 'cubic-bezier(0.45, 0, 0.25, 1)', fill: 'forwards' },
      )
      .finished.then(() => spark.remove(), () => spark.remove());
  }
  return wait(700);
}
