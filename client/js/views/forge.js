/**
 * "Forge" page: a new part of the game, announced for a future update. For now it only
 * says so (an anvil throwing sparks), nothing can be done here yet.
 */
import { html, mount } from '../dom.js';
import { t } from '../i18n.js';

export function renderForge(main) {
  mount(
    main,
    html`<section class="view view-forge">
      <div class="hero hero--forge">
        <div class="forge-anvil" aria-hidden="true">
          <span class="forge-anvil__sparks">${Array.from({ length: 8 }, (_, i) => html`<span style="--i:${i}"></span>`)}</span>
          <span class="forge-anvil__icon">⚒️</span>
        </div>
        <h1 class="hero__title">${t('forge.title')}</h1>
        <p class="forge-soon">🚧 ${t('forge.soon')}</p>
        <p class="hero__sub">${t('forge.text')}</p>
        <a class="btn btn--secondary btn--big forge-back" href="#/">${t('forge.back')}</a>
      </div>
    </section>`,
  );
}
