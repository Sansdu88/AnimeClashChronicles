/** "Rules" page: how boosters and rarities work, the daily reward, types and credits. */
import { fmt, html, mount, raw } from '../dom.js';
import { rarityName, setName, setTagline, t, tHtml, typeName } from '../i18n.js';
import { state } from '../state.js';

function atLeastOneLabel(rarityId, chance) {
  if (rarityId === 'N') return '—';
  if (chance > 0.9999) return t('rules.guaranteed');
  const isRarest = rarityId === state.meta.rarities.at(-1).id;
  return `${fmt.percent(chance, 1)}${isRarest ? '' : ` ${t('rules.orBetter')}`}`;
}

export function renderRules(main) {
  const { meta } = state;
  const { booster } = meta;
  const superOdds = meta.daily.superBooster;
  const rarities = [...meta.rarities].reverse();
  const popularity = meta.catalog.popularity;
  const share = (id) => fmt.percent(meta.rarities.find((r) => r.id === id).share);

  mount(
    main,
    html`<section class="view view-rules">
      <header class="view-head">
        <div>
          <h1 class="view-title">${t('rules.title')}</h1>
          <p class="view-sub">${t('rules.sub', { count: meta.totalCards })}</p>
        </div>
      </header>

      <ol class="steps">
        <li class="panel step"><span class="step__num">1</span><h2>${t('rules.step1Title')}</h2><p>${t('rules.step1')}</p></li>
        <li class="panel step"><span class="step__num">2</span><h2>${t('rules.step2Title')}</h2>
          <p>${raw(tHtml('rules.step2', { size: booster.size, minutes: booster.cooldownSeconds / 60, max: booster.stackMax }))}</p></li>
        <li class="panel step"><span class="step__num">3</span><h2>${t('rules.step3Title')}</h2>
          <p>${t('rules.step3', { rev: meta.rarities.find((r) => r.id === 'REV').cardCount })}</p></li>
      </ol>

      <section class="panel">
        <h2 class="panel__title">${raw(tHtml('rules.odds'))}</h2>
        <div class="table-wrap">
          <table class="odds">
            <thead>
              <tr>
                <th scope="col">${t('rules.colRarity')}</th>
                <th scope="col">${t('rules.colCards')}</th>
                <th scope="col">${t('rules.colSlots', { n: booster.size - 1 })}</th>
                <th scope="col">${t('rules.colLast', { n: booster.size })}</th>
                <th scope="col">${t('rules.colAtLeast')}</th>
              </tr>
            </thead>
            <tbody>
              ${rarities.map((r) => html`<tr class="r-${r.id}">
                <td><span class="rarity-badge">${r.id}</span> ${rarityName(r.id)}</td>
                <td>${r.cardCount}</td>
                <td>${fmt.percent(booster.odds.normalSlot[r.id], 1)}</td>
                <td>${fmt.percent(booster.odds.rareSlot[r.id], 1)}</td>
                <td>${atLeastOneLabel(r.id, booster.odds.atLeastOne[r.id])}</td>
              </tr>`)}
            </tbody>
          </table>
        </div>
        <h3 class="panel__subtitle">${t('rules.whereTitle')}</h3>
        <p>${raw(
          tHtml('rules.where', {
            days: popularity?.days ?? 60,
            until: popularity?.until ? fmt.day(popularity.until) : '—',
            rev: share('REV'),
            ur: share('UR'),
          }),
        )}</p>
      </section>

      <section class="panel">
        <h2 class="panel__title">${raw(tHtml('rules.dailyTitle'))}</h2>
        <p>${raw(tHtml('rules.daily', { cycle: meta.daily.superEvery }))}</p>
        <div class="table-wrap">
          <table class="odds">
            <thead>
              <tr>
                <th scope="col">${t('rules.colRarity')}</th>
                <th scope="col">${t('rules.colSlots', { n: superOdds.size - 1 })}</th>
                <th scope="col">${t('rules.colLast', { n: superOdds.size })}</th>
                <th scope="col">${t('rules.colAtLeast')}</th>
              </tr>
            </thead>
            <tbody>
              ${rarities.map((r) => html`<tr class="r-${r.id}">
                <td><span class="rarity-badge">${r.id}</span> ${rarityName(r.id)}</td>
                <td>${superOdds.odds.normalSlot[r.id] ? fmt.percent(superOdds.odds.normalSlot[r.id], 1) : '—'}</td>
                <td>${superOdds.odds.rareSlot[r.id] ? fmt.percent(superOdds.odds.rareSlot[r.id], 1) : '—'}</td>
                <td>${atLeastOneLabel(r.id, superOdds.odds.atLeastOne[r.id])}</td>
              </tr>`)}
            </tbody>
          </table>
        </div>
      </section>

      <div class="rules-grid">
        <section class="panel">
          <h2 class="panel__title">${t('rules.sets')}</h2>
          <ul class="set-list">
            ${meta.sets.map((set) => html`<li style="--c1:${set.colors[0]};--c2:${set.colors[1]}">
              <span class="set-list__swatch" aria-hidden="true"></span>
              <span><b>${setName(set.id)}</b><br><span class="muted">${setTagline(set.id)} · ${t('rules.setCards', { count: set.cardCount })}</span></span>
            </li>`)}
          </ul>
        </section>
        <section class="panel">
          <h2 class="panel__title">${t('rules.types')}</h2>
          <ul class="type-list">
            ${meta.types.map((type) => html`<li><span class="tag tag--type" style="--type:${type.color}">${type.icon} ${typeName(type.id)}</span></li>`)}
          </ul>
        </section>
      </div>

      <section class="panel">
        <h2 class="panel__title">${t('rules.credits')}</h2>
        <p>${raw(tHtml('rules.creditsText'))}</p>
      </section>
    </section>`,
  );
}
