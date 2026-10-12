/**
 * "Wheel" page, the Wheel of Fortune: a spin costs Kira (1,000 by default, meta.wheel) or gems,
 * and wins one of the prizes, each a slice of the wheel as wide as its chance: boosters opened
 * at once, Super Boosters (they wait on the shelf; the ones won are opened at once), or a random
 * card of a rarity. The server draws the prize while the wheel spins up, then the wheel slows
 * down until that slice stops under the pointer, and the prize opens on the stage (views/open.js).
 */
import { $, $$, fmt, html, mount, prefersReducedMotion, raw, wait } from '../dom.js';
import { cardText, errorText, rarityName, setName, t, tHtml } from '../i18n.js';
import { rarityOf, refreshMeta, reloadPlayer, spinWheel, state } from '../state.js';
import { confettiStorm } from '../components/booster-show.js';
import { RARITY_COLORS, burst, onomatopoeia } from '../ui/effects.js';
import { GEM_SVG, gemIconHTML, gemsHTML } from '../ui/gems.js';
import { coinHTML, flySparkles, kiraHTML } from '../ui/kira.js';
import { sfx } from '../ui/sfx.js';
import { toast } from '../ui/toast.js';
import { openPrize, revealCard } from './open.js';

// The wheel stays where it stopped between visits (degrees, clockwise).
let rotation = 0;
let spinning = false;

const RADIUS = 190;
const SPEED = 0.85; // degrees per millisecond at full speed
const ICONS = { boosters: '🎴', super: '🌈', card: '🃏' };
const CONFETTI = ['#ffd23f', '#ff2e88', '#3a86ff', '#06d6a0', '#8338ec', '#ffffff'];

/** "5 All-Stars boosters", "1 Super Booster", "A Ultra Rare card": a prize of the wheel in words. */
export function prizeName(prize) {
  if (prize.type === 'boosters') return t('wheel.prize.boosters', { count: prize.count, set: setName(prize.setId) });
  if (prize.type === 'super') return t('wheel.prize.super', { count: prize.count });
  return t('wheel.prize.card', { rarity: rarityName(prize.rarity) });
}

/** What happens to a prize once won. */
function prizeHint(prize) {
  if (prize.type === 'card') {
    return t('wheel.hint.card', { count: state.cards.filter((card) => card.rarity === prize.rarity).length, rarity: prize.rarity });
  }
  return t(`wheel.hint.${prize.type}`);
}

/** The short label printed on a slice. */
function sliceLabel(prize) {
  if (prize.type === 'card') return prize.rarity;
  return prize.type === 'super' ? `SUPER ×${prize.count}` : `×${prize.count}`;
}

/** The color of a slice: blue or red boosters, purple or rainbow Super Boosters, a card in the color of its rarity. */
function sliceFill(prize) {
  if (prize.type === 'boosters') return prize.count >= 10 ? '#e63946' : '#2667ff';
  if (prize.type === 'super') return prize.count > 1 ? 'url(#wheel-rainbow)' : '#8338ec';
  return prize.rarity === 'REV' ? '#16130f' : (rarityOf(prize.rarity)?.color ?? '#8d99ae');
}

/** The prizes that can be won, with their slice: [{ prize, start, end }] in degrees, clockwise from the top. */
function slices() {
  const prizes = state.meta.wheel.prizes.filter((prize) => prize.chance > 0);
  const total = prizes.reduce((sum, prize) => sum + prize.chance, 0);
  let start = 0;
  return prizes.map((prize) => {
    const size = (prize.chance / total) * 360;
    const slice = { prize, start, end: start + size };
    start += size;
    return slice;
  });
}

/** [x, y] of the point at `angle` degrees (clockwise from the top), `r` from the center. */
const xy = (angle, r = RADIUS) => {
  const rad = (angle * Math.PI) / 180;
  return [(r * Math.sin(rad)).toFixed(2), (-r * Math.cos(rad)).toFixed(2)];
};
const point = (angle) => xy(angle).join(' ');

function wheelSVG(list) {
  return html`<svg class="wheel__svg" viewBox="-200 -200 400 400" aria-hidden="true">
    <defs>
      <linearGradient id="wheel-rainbow" x1="0" y1="1" x2="1" y2="0">
        <stop offset="0" stop-color="#ff2e88" /><stop offset=".25" stop-color="#ffbe0b" /><stop offset=".5" stop-color="#06d6a0" />
        <stop offset=".75" stop-color="#3a86ff" /><stop offset="1" stop-color="#8338ec" />
      </linearGradient>
    </defs>
    <g class="wheel__rotor">
      ${list.map(({ prize, start, end }) => {
        const size = end - start;
        const mid = start + size / 2;
        const arc = ((size * Math.PI) / 180) * RADIUS * 0.78; // room for the icon at its radius
        return html`<g class="wheel__slice wheel__slice--${prize.type}${prize.rarity ? ` r-${prize.rarity}` : ''}" data-prize="${prize.id}">
          <path d="${size >= 359.99 ? `M 0 ${-RADIUS} A ${RADIUS} ${RADIUS} 0 1 1 0 ${RADIUS} A ${RADIUS} ${RADIUS} 0 1 1 0 ${-RADIUS} Z` : `M 0 0 L ${point(start)} A ${RADIUS} ${RADIUS} 0 ${size > 180 ? 1 : 0} 1 ${point(end)} Z`}"
            fill="${sliceFill(prize)}" />
          <g transform="rotate(${mid.toFixed(2)})">
            <text class="wheel__icon" x="0" y="${-RADIUS * 0.8}" style="font-size:${Math.min(30, Math.max(12, arc * 0.7)).toFixed(1)}px">${ICONS[prize.type]}</text>
            <text class="wheel__label" transform="rotate(-90)" x="${RADIUS * 0.44}" y="0"
              style="font-size:${Math.min(22, Math.max(11, ((size * Math.PI) / 180) * RADIUS * 0.4 * 0.75)).toFixed(1)}px">${sliceLabel(prize)}</text>
          </g>
        </g>`;
      })}
      ${list.map(({ start }) => {
        const [x, y] = xy(start, RADIUS - 7);
        return html`<circle class="wheel__peg" cx="${x}" cy="${y}" r="4.5" />`;
      })}
    </g>
  </svg>`;
}

function prizeRowHTML({ prize }) {
  return html`<li class="wheel-prize" data-prize="${prize.id}">
    <span class="wheel-prize__swatch wheel-prize__swatch--${prize.type}${prize.rarity ? ` r-${prize.rarity}` : ''}" style="--fill:${prize.type === 'super' && prize.count > 1 ? 'var(--rainbow)' : sliceFill(prize)}" aria-hidden="true">${ICONS[prize.type]}</span>
    <span class="wheel-prize__text">
      <b>${prizeName(prize)}</b>
      <span class="muted">${prizeHint(prize)}</span>
    </span>
    <span class="wheel-prize__chance">${fmt.percent(prize.chance, 0, 3)}</span>
  </li>`;
}

export function renderWheel(main) {
  const { wheel } = state.meta;
  const list = slices();

  mount(
    main,
    html`<section class="view view-wheel">
      <div class="hero hero--wheel">
        <h1 class="hero__title">${t('wheel.title')}</h1>
        <p class="hero__sub">${raw(tHtml('wheel.sub', { price: fmt.number(wheel.price) }))}</p>
      </div>

      <div class="wheel-layout">
        <section class="panel wheel-panel">
          <div class="wheel" style="--rotation:${rotation}deg">
            <span class="wheel__pointer" aria-hidden="true"></span>
            ${list.length ? wheelSVG(list) : ''}
            <span class="wheel__hub" aria-hidden="true">${coinHTML('big')}</span>
          </div>
          <p class="wheel__result" aria-live="polite"></p>
          <div class="wheel__buttons">
            <button class="btn btn--kira btn--big wheel__spin" type="button" data-spin="kira"
              aria-label="${t('wheel.spinLabel', { price: wheel.price })}">🎡 ${t('wheel.spin')} · ${kiraHTML(wheel.price)}</button>
            <span class="shop-item__or">${t('gems.or')}</span>
            <button class="btn btn--gems wheel__spin" type="button" data-spin="gems"
              aria-label="${t('wheel.spinGemsLabel', { price: wheel.gemPrice })}">${gemsHTML(wheel.gemPrice)}</button>
            <span class="shop-item__need wheel__need" aria-live="polite"></span>
          </div>
        </section>

        <aside class="wheel-side">
          <section class="panel wallet wheel-wallet" aria-label="${t('market.wallet')}">
            ${coinHTML('big')}
            <div>
              <p class="wallet__label">${t('market.wallet')}</p>
              <p class="wallet__amount"><b data-kira>${fmt.number(state.player.kira)}</b> Kira</p>
              <p class="wallet__gems">${gemIconHTML()} <b data-gems>${fmt.number(state.player.gems)}</b> ${t('header.gemsUnit')}</p>
              <p class="wallet__hint"><a class="link" href="#/market">${t('wheel.earn')}</a></p>
            </div>
          </section>
          <section class="panel wheel-prizes">
            <h2 class="panel__title">🎁 ${t('wheel.prizes')}</h2>
            <p class="muted">${t('wheel.prizesHint')}</p>
            <ul class="wheel-prizes__list">${list.map(prizeRowHTML)}</ul>
          </section>
        </aside>
      </div>
    </section>`,
  );

  const view = $('.view-wheel', main);
  const wheelElement = $('.wheel', main);
  const svg = $('.wheel__svg', main);
  const pointer = $('.wheel__pointer', main);
  const resultText = $('.wheel__result', main);

  /** The spin buttons: disabled while the wheel turns, or without enough Kira (or gems). */
  function paintButtons() {
    const kiraMissing = wheel.price - state.player.kira;
    const gemsMissing = wheel.gemPrice - state.player.gems;
    const kiraButton = $('[data-spin="kira"]', view);
    const gemsButton = $('[data-spin="gems"]', view);
    kiraButton.disabled = spinning || kiraMissing > 0 || !list.length;
    gemsButton.disabled = spinning || gemsMissing > 0 || !list.length;
    gemsButton.title = gemsMissing > 0 ? t('gems.missing', { count: gemsMissing }) : '';
    $('.wheel__need', view).textContent = !spinning && kiraMissing > 0 ? t('market.missing', { count: fmt.number(kiraMissing) }) : '';
    $('[data-kira]', view).textContent = fmt.number(state.player.kira);
    $('[data-gems]', view).textContent = fmt.number(state.player.gems);
  }

  /** The slice under the pointer when the wheel has turned `angle` degrees. */
  const sliceAt = (angle) => {
    const top = (((-angle) % 360) + 360) % 360;
    return list.findIndex((slice) => top >= slice.start && top < slice.end);
  };

  /** The angle that stops a random point of the prize's slice under the pointer (modulo 360). */
  function stopAngle(prizeId) {
    const slice = list.find((each) => each.prize.id === prizeId);
    if (!slice) return null;
    const at = slice.start + (slice.end - slice.start) * (0.2 + Math.random() * 0.6);
    return (360 - at) % 360;
  }

  const show = (angle) => {
    rotation = angle;
    wheelElement.style.setProperty('--rotation', `${angle}deg`);
  };

  /**
   * Spins up while `pending` (the server's answer: { result } or { error }) is not there, then slows down
   * to stop on the prize's slice (or anywhere quickly when it failed). The pointer ticks on every peg.
   */
  function turn(pending) {
    const still = prefersReducedMotion();
    return new Promise((resolve) => {
      let outcome = null;
      pending.then((value) => (outcome = value));
      const started = performance.now();
      let last = started;
      let angle = rotation;
      let velocity = 0;
      let plan = null;
      let current = sliceAt(angle);
      let tickedAt = 0;
      const frame = (now) => {
        const dt = Math.min(64, now - last);
        last = now;
        if (!plan) {
          velocity = Math.min(SPEED, velocity + (dt * SPEED) / (still ? 150 : 450));
          angle += velocity * dt;
          if (outcome && now - started > (still ? 200 : 650)) {
            const stop = outcome.result ? stopAngle(outcome.result.prize.id) : null;
            let distance = still ? 360 : 1080; // at least three more turns
            if (stop === null) distance = 90;
            else distance += (((stop - (angle + distance)) % 360) + 360) % 360;
            // An ease-out curve that starts at the current speed: angle = from + distance × (1 − (1 − k)³).
            plan = { from: angle, distance, duration: (3 * distance) / velocity, at: now };
          }
        } else {
          const k = Math.min(1, (now - plan.at) / plan.duration);
          angle = plan.from + plan.distance * (1 - (1 - k) ** 3);
          if (k >= 1) plan.done = true;
        }
        if (svg) show(angle);
        const under = sliceAt(angle);
        if (under !== current && now - tickedAt > 35) {
          current = under;
          tickedAt = now;
          sfx.play('tick');
          pointer.classList.remove('is-ticking');
          void pointer.offsetWidth; // restart the animation
          pointer.classList.add('is-ticking');
        }
        if (plan?.done) resolve(outcome);
        else requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });
  }

  /** Pays a spin with Kira or gems, spins the wheel, then opens the prize on the stage. */
  async function spin(currency) {
    if (spinning) return;
    spinning = true;
    view.classList.add('is-spinning');
    resultText.textContent = t('wheel.spinning');
    paintButtons();
    sfx.play('coin');
    const gems = currency === 'gems';
    const coin = $(gems ? '.wheel-wallet .gem-icon' : '.wheel-wallet .kira-coin', view);
    flySparkles(coin.getBoundingClientRect(), $('.wheel__hub', view), gems ? { count: 10, symbol: GEM_SVG, className: 'gem-spark' } : { count: 16 });
    const pending = spinWheel(currency).then(
      (result) => ({ result }),
      (error) => ({ error }),
    );
    const { result, error } = await turn(pending);
    spinning = false;
    view.classList.remove('is-spinning');
    if (error) {
      resultText.textContent = '';
      toast(error.code === 'price_changed' ? t('wheel.priceChanged') : errorText(error), 'error');
      if (error.code === 'price_changed') refreshMeta().catch(() => {});
      if (['not_enough_kira', 'not_enough_gems'].includes(error.code)) reloadPlayer().catch(() => {});
      if (view.isConnected) paintButtons();
      return;
    }
    const { prize } = result;
    const name = prizeName(prize);
    if (!view.isConnected) {
      // The player left the page while the wheel was turning: the prize is theirs anyway.
      toast(t('wheel.won', { prize: name }), 'success', 6000);
      if ($('.view-wheel', main)) renderWheel(main); // drawn again meanwhile: its buttons wake up
      return;
    }
    // The prize's slice lights up, confetti, then the prize opens.
    resultText.textContent = t('wheel.won', { prize: name });
    $(`.wheel__slice[data-prize="${prize.id}"]`, view)?.classList.add('is-won');
    $(`.wheel-prize[data-prize="${prize.id}"]`, view)?.classList.add('is-won');
    const box = wheelElement.getBoundingClientRect();
    const colors = prize.type === 'card' ? [...RARITY_COLORS[prize.rarity], '#fff'] : CONFETTI;
    sfx.play(prize.type === 'card' ? prize.rarity : 'fanfare');
    burst(box.left + box.width / 2, box.top + box.height * 0.2, { colors, count: 90, power: 1.4 });
    if (prize.type !== 'boosters' || prize.count >= 10) confettiStorm(colors, { rounds: 3 });
    onomatopoeia(t('wheel.boom'), { x: box.left + box.width / 2, y: box.top + box.height * 0.15, color: '#ffd23f', size: 'xl', tilt: -6 });
    paintButtons();
    await wait(1300);
    if (!view.isConnected) return;
    const won = { title: `🎡 ${t('wheel.stageTitle')}`, sub: name, again: { href: '#/wheel', label: t('wheel.again') } };
    if (prize.type === 'boosters') openPrize(prize.setId, { boosters: result.boosters, won });
    else if (prize.type === 'super') openPrize(state.meta.daily.superSet.id, { count: result.superBoosters, won });
    else {
      revealCard(result.card, won, prize.rarity === 'REV' ? ['#00d177', '#16130f'] : [rarityOf(prize.rarity).color, '#16130f']);
      toast(t('wheel.cardToast', { name: cardText(result.card).name }), 'success');
    }
  }

  view.addEventListener('click', (event) => {
    const button = event.target.closest('[data-spin]');
    if (button && !button.disabled) spin(button.dataset.spin);
  });
  for (const slice of $$('.wheel-prize', view)) {
    slice.addEventListener('mouseenter', () => $(`.wheel__slice[data-prize="${slice.dataset.prize}"]`, view)?.classList.add('is-hovered'));
    slice.addEventListener('mouseleave', () => $(`.wheel__slice[data-prize="${slice.dataset.prize}"]`, view)?.classList.remove('is-hovered'));
  }
  paintButtons();
}
