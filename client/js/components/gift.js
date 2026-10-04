/**
 * The popup of a gift waiting for the player (player.gift, GIFTS in server/config.js), opened
 * at their next visit (main.js): the gems of the launch, with what gems are and what they buy.
 * Claimed, the gems fly to the wallet of the header. Closed without claiming, it comes back at
 * the next visit.
 */
import { $, fmt, html, raw } from '../dom.js';
import { errorText, t, tHtml } from '../i18n.js';
import { claimGift, gemPriceOf, state } from '../state.js';
import { confettiStorm } from './booster-show.js';
import { openModal } from './modal.js';
import { GEM_SVG, gemIconHTML } from '../ui/gems.js';
import { bump, flySparkles } from '../ui/kira.js';
import { sfx } from '../ui/sfx.js';
import { toast } from '../ui/toast.js';

const CONFETTI = ['#36c5f0', '#a8f0ff', '#1471b8', '#ffd23f', '#ffffff'];

/** `gift`: { id, gems }. `onClose`: when the popup is closed, claimed or not. */
export function openGiftPopup(gift, { onClose } = {}) {
  const { meta } = state;
  const reward = Math.max(0, ...meta.achievements.map((achievement) => achievement.gems));
  const eraSet = meta.sets.find((set) => set.era) ?? meta.sets[0];
  const modal = openModal(
    html`<div class="gift-popup">
      <div class="hero hero--popup hero--gems">
        <span class="gift-popup__gem">${gemIconHTML('big')}</span>
        <h2 class="hero__title">🎁 ${t('gift.title')}</h2>
        <p class="gift-popup__amount">${t('gift.amount', { gems: fmt.number(gift.gems) })}</p>
      </div>
      <p class="gift-popup__intro">${raw(tHtml('gift.intro', { gems: fmt.number(gift.gems) }))}</p>
      <ul class="gift-popup__list">
        <li>${raw(tHtml('gift.what', { kira: fmt.number(meta.gems.kiraPerGem) }))}</li>
        <li>${raw(tHtml('gift.spend', { era: eraSet ? gemPriceOf(eraSet.id) : 1 }))}</li>
        <li>${raw(tHtml('gift.earn', { reward: fmt.number(reward) }))}</li>
      </ul>
      <div class="btn-row">
        <button class="btn btn--gems btn--big" type="button" data-claim>${t('gift.claim', { gems: fmt.number(gift.gems) })}</button>
      </div>
    </div>`,
    { label: t('gift.title'), className: 'modal--gift', onClose },
  );
  const button = $('[data-claim]', modal.body);
  button.focus({ preventScroll: true });
  button.addEventListener('click', async () => {
    button.disabled = true;
    const from = $('.gift-popup__gem', modal.body).getBoundingClientRect();
    try {
      await claimGift(gift.id);
    } catch (err) {
      toast(errorText(err), 'error');
      // Already claimed (another tab): nothing more to do here.
      if (err.code === 'gift_claimed') modal.close();
      else button.disabled = false;
      return;
    }
    sfx.play('fanfare');
    confettiStorm(CONFETTI, { rounds: 3 });
    // The gems fly to the wallet of the header (it shows on phones too), then the popup closes.
    const chip = $('#gem-chip .gem-icon');
    if (chip) {
      await flySparkles(from, chip, { count: 18, symbol: GEM_SVG, className: 'gem-spark' });
      bump(chip);
    }
    sfx.play('kaching');
    toast(t('gift.claimed', { gems: fmt.number(gift.gems) }), 'success', 6000);
    modal.close();
  });
}
