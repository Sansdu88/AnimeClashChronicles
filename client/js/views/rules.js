/**
 * "Rules" page: how boosters and rarities work, the events on now, the daily reward, the
 * Kira market and its daily shop, the weekly ranking, types and credits.
 */
import { fmt, html, mount, raw } from '../dom.js';
import { rarityName, setName, setTagline, t, tHtml, typeName } from '../i18n.js';
import { state } from '../state.js';
import { EVENT_ICONS, activeEvents, eventCards } from '../events.js';
import { gemsHTML } from '../ui/gems.js';
import { kiraHTML } from '../ui/kira.js';
import { rewardText } from './stats.js';

/** An event on now: its booster, its stock and the rarities of its cards. */
function eventRulesHTML(event) {
  const cards = eventCards(event.id);
  return html`<section class="panel rules-event ev-${event.id}">
    <h2 class="panel__title">${EVENT_ICONS[event.id]} ${t('rules.eventTitle', { name: t(`events.${event.id}.title`) })}</h2>
    <p>${raw(tHtml(`events.${event.id}.pitch`, { count: cards.length, rev: cards.filter((card) => card.rarity === 'REV').length, ur: cards.filter((card) => card.rarity === 'UR').length }))}</p>
    <p>${t('rules.event', { set: setName(event.set.id), count: event.hours, max: event.max })}</p>
    <ul class="rates__list">
      ${[...state.meta.rarities].reverse().map((rarity) => html`<li class="r-${rarity.id}" title="${rarityName(rarity.id)}">
        <span class="rarity-badge">${rarity.id}</span> ${t('rules.eventCards', { count: cards.filter((card) => card.rarity === rarity.id).length })}
      </li>`)}
    </ul>
  </section>`;
}

function atLeastOneLabel(rarityId, chance) {
  if (rarityId === 'N') return '—';
  if (chance > 0.9999) return t('rules.guaranteed');
  const isRarest = rarityId === state.meta.rarities.at(-1).id;
  return `${fmt.percent(chance, 1, 3)}${isRarest ? '' : ` ${t('rules.orBetter')}`}`;
}

export function renderRules(main) {
  const { meta } = state;
  const { booster, stocks, market } = meta;
  const superOdds = meta.daily.superBooster;
  // The shop boosters, then the Super Booster (only given by the daily reward).
  const superSet = meta.daily.superSet;
  const shelfAndSuper = superSet ? [...meta.sets, superSet] : meta.sets;
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
          <p>${raw(tHtml('rules.step2', {
            size: booster.size,
            era: stocks.era.cooldownSeconds / 60,
            stars: stocks['all-stars'].cooldownSeconds / 60,
            max: stocks.era.stackMax,
          }))}</p></li>
        <li class="panel step"><span class="step__num">3</span><h2>${t('rules.step3Title')}</h2>
          <p>${t('rules.step3', { rev: meta.rarities.find((r) => r.id === 'REV').cardCount })}</p></li>
      </ol>

      ${activeEvents().map(eventRulesHTML)}

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
                <td>${fmt.percent(booster.odds.normalSlot[r.id], 1, 3)}</td>
                <td>${fmt.percent(booster.odds.rareSlot[r.id], 1, 3)}</td>
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
        <p>${raw(tHtml('rules.daily', { count: meta.daily.superEvery }))}</p>
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
                <td>${superOdds.odds.normalSlot[r.id] ? fmt.percent(superOdds.odds.normalSlot[r.id], 1, 3) : '—'}</td>
                <td>${superOdds.odds.rareSlot[r.id] ? fmt.percent(superOdds.odds.rareSlot[r.id], 1, 3) : '—'}</td>
                <td>${atLeastOneLabel(r.id, superOdds.odds.atLeastOne[r.id])}</td>
              </tr>`)}
            </tbody>
          </table>
        </div>
      </section>

      <section class="panel">
        <h2 class="panel__title">${t('rules.marketTitle')}</h2>
        <p>${raw(tHtml('rules.market'))}</p>
        <h3 class="panel__subtitle">${t('rules.marketRecycle')}</h3>
        <ul class="rates__list">
          ${rarities.map((r) => html`<li class="r-${r.id}" title="${rarityName(r.id)}">
            <span class="rarity-badge">${r.id}</span> ${kiraHTML(market.recycle[r.id])}
          </li>`)}
        </ul>
        <h3 class="panel__subtitle">${t('rules.marketPrices')}</h3>
        <ul class="rates__list">
          ${meta.sets.map((set) => html`<li>${setName(set.id)} ${kiraHTML(market.prices[set.id])}</li>`)}
        </ul>
        <p>${t('rules.shop')}</p>
        <h3 class="panel__subtitle">${t('rules.shopPrices')}</h3>
        <ul class="rates__list">
          ${rarities.filter((r) => r.id in market.cardPrices).map((r) => html`<li class="r-${r.id}" title="${rarityName(r.id)}">
            <span class="rarity-badge">${r.id}</span> ${kiraHTML(market.cardPrices[r.id])}
          </li>`)}
        </ul>
      </section>

      <section class="panel">
        <h2 class="panel__title">💎 ${t('rules.gemsTitle')}</h2>
        <p>${raw(tHtml('rules.gems', {
          reward: fmt.number(Math.max(0, ...meta.achievements.map((achievement) => achievement.gems))),
          kira: fmt.number(meta.gems.kiraPerGem),
        }))}</p>
        <h3 class="panel__subtitle">${t('rules.marketPrices')}</h3>
        <ul class="rates__list">
          ${meta.sets.map((set) => html`<li>${setName(set.id)} ${gemsHTML(meta.gems.prices[set.id])}</li>`)}
        </ul>
        <h3 class="panel__subtitle">${t('rules.shopPrices')}</h3>
        <ul class="rates__list">
          ${rarities.filter((r) => r.id in meta.gems.cardPrices).map((r) => html`<li class="r-${r.id}" title="${rarityName(r.id)}">
            <span class="rarity-badge">${r.id}</span> ${gemsHTML(meta.gems.cardPrices[r.id])}
          </li>`)}
        </ul>
      </section>

      <section class="panel">
        <h2 class="panel__title">🏆 ${t('rules.weeklyTitle')}</h2>
        <p>${t('rules.weekly', { share: fmt.percent(meta.scoring.duplicateShare) })}</p>
        <ol class="rules-rewards">
          ${meta.weekly.rewards.map((reward, i) => html`<li><b>${{ 1: '🥇', 2: '🥈', 3: '🥉' }[i + 1] ?? `${i + 1}.`}</b> ${rewardText(reward)}</li>`)}
        </ol>
      </section>

      <div class="rules-grid">
        <section class="panel">
          <h2 class="panel__title">${t('rules.sets')}</h2>
          <ul class="set-list">
            ${shelfAndSuper.map((set) => html`<li style="--c1:${set.colors[0]};--c2:${set.colors[1]}">
              <span class="set-list__swatch" aria-hidden="true"></span>
              <span><b>${setName(set.id)}</b><br><span class="muted">${setTagline(set.id)} · ${t('rules.setCards', { count: set.cardCount })}</span>
                ${set === superSet ? html`<br><span class="muted">${raw(tHtml('rules.setSuper'))}</span>` : ''}</span>
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
