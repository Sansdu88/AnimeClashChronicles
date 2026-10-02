/**
 * "Admin" page, for the players whose is_admin is set in the database (the server
 * checks it on every call): the game settings, which apply at once (Kira prices and
 * values, daily shop prices, rewards of the weekly ranking, daily reward, Super Booster
 * events, rarity odds), and the list of players with their tools (give the daily back,
 * Super Booster gift, clear their data, delete them).
 */
import { $, $$, fmt, html, mount } from '../dom.js';
import { errorText, rarityName, setName, t } from '../i18n.js';
import {
  adminClearPlayer,
  adminDailyGift,
  adminDeletePlayer,
  adminResetDaily,
  dailyStatus,
  fetchAdminPlayers,
  fetchAdminSettings,
  refreshDaily,
  saveAdminSettings,
  state,
} from '../state.js';
import { confirmDialog } from '../components/modal.js';
import { onPageClick, pageCount, pageSize, paginationHTML } from '../components/pagination.js';
import { coinHTML, kiraHTML } from '../ui/kira.js';
import { toast } from '../ui/toast.js';

// Odds are weights adding up to `oddsTotal` (100%) in each column, given by the server
// (thousandths of a percent: odds as small as 0.001%, see server/settings.js).
let oddsTotal = 100_000;
const ODDS_COLUMNS = [
  { section: 'booster', slot: 'slotWeights', label: 'admin.boosterSlots' },
  { section: 'booster', slot: 'rareSlotWeights', label: 'admin.boosterLast' },
  { section: 'superBooster', slot: 'slotWeights', label: 'admin.superSlots' },
  { section: 'superBooster', slot: 'rareSlotWeights', label: 'admin.superLast' },
];
// Kept between visits: the search of the player list and its page.
const search = { q: '', page: 1 };
let renderId = 0;

const rarestFirst = () => [...state.meta.rarities].reverse().map((rarity) => rarity.id);
const percent = (weight) => String(weight / (oddsTotal / 100)); // 58000 → "58", 20 → "0.02"
const weightOf = (value) => Math.round(Number(value) * (oddsTotal / 100));
const numberField = (name, value, { min = 0, max = 100000, step = 1 } = {}) =>
  html`<input class="input" type="number" name="${name}" value="${value}" min="${min}" max="${max}" step="${step}" inputmode="decimal" required>`;

function marketFieldsHTML(market) {
  return html`<h3 class="admin-form__subtitle">${t('admin.prices')}</h3>
    <div class="admin-fields">
      ${state.meta.sets.map((set) => html`<label class="field">
        <span class="field__label">${setName(set.id)}</span>
        <span class="input-kira">${numberField(`price:${set.id}`, market.prices[set.id])}${coinHTML()}</span>
      </label>`)}
    </div>
    <h3 class="admin-form__subtitle">${t('admin.recycle')}</h3>
    <div class="admin-fields admin-fields--rarities">
      ${rarestFirst().map((id) => html`<label class="field r-${id}" title="${rarityName(id)}">
        <span class="field__label"><span class="rarity-badge">${id}</span></span>
        <span class="input-kira">${numberField(`recycle:${id}`, market.recycle[id])}${coinHTML()}</span>
      </label>`)}
    </div>
    <h3 class="admin-form__subtitle">${t('admin.cardPrices')}</h3>
    <div class="admin-fields admin-fields--rarities">
      ${shopRarities(market).map((id) => html`<label class="field r-${id}" title="${rarityName(id)}">
        <span class="field__label"><span class="rarity-badge">${id}</span></span>
        <span class="input-kira">${numberField(`card:${id}`, market.cardPrices[id])}${coinHTML()}</span>
      </label>`)}
    </div>`;
}

/** The rarities sold at the daily shop, rarest first. */
const shopRarities = (market) => rarestFirst().filter((id) => id in market.cardPrices);

/** The rewards of the weekly ranking: Super Boosters and Kira for the 1st, the 2nd… */
function weeklyRowsHTML(weekly) {
  return weekly.rewards.map((reward, i) => html`<tr>
    <th scope="row">${{ 1: '🥇', 2: '🥈', 3: '🥉' }[i + 1] ?? t('admin.rank', { rank: i + 1 })}</th>
    <td>${numberField(`super:${i}`, reward.superBoosters, { max: 50 })}</td>
    <td><span class="input-kira">${numberField(`kira:${i}`, reward.kira)}${coinHTML()}</span></td>
  </tr>`);
}

function dailyFieldsHTML(daily) {
  return html`<label class="field admin-field--short">
      <span class="field__label">${t('admin.superEvery')}</span>
      ${numberField('superEvery', daily.superEvery, { min: 1, max: 60 })}
    </label>
    <fieldset class="admin-checks">
      <legend class="field__label">${t('admin.offered')}</legend>
      ${state.meta.sets.map((set) => html`<label class="admin-check">
        <input type="checkbox" name="sets" value="${set.id}" ${daily.sets.includes(set.id) ? 'checked' : ''}> ${setName(set.id)}
      </label>`)}
    </fieldset>`;
}

function eventsHTML(daily) {
  const { today } = dailyStatus();
  const days = daily.superDays.filter((day) => day >= today);
  return html`<h2 class="panel__title">⚡ ${t('admin.events')}</h2>
    <p class="muted">${t('admin.eventsText')}</p>
    ${days.length
      ? html`<ul class="admin-days">
          ${days.map((day) => html`<li class="admin-day${day === today ? ' is-today' : ''}">
            📅 ${fmt.day(day)}${day === today ? html` <b>(${t('daily.today')})</b>` : ''}
            <button type="button" class="admin-day__remove" data-remove-day="${day}" aria-label="${t('admin.removeDay', { day: fmt.day(day) })}">✕</button>
          </li>`)}
        </ul>`
      : html`<p class="admin-days__none">${t('admin.noEvent')}</p>`}
    <div class="admin-day-add">
      <input class="input" type="date" name="newDay" min="${today}" aria-label="${t('admin.eventDay')}">
      <button type="button" class="btn btn--secondary" data-add-day>${t('admin.addDay')}</button>
    </div>
    <button type="button" class="btn btn--special" data-event-today ${days.includes(today) ? 'disabled' : ''}>${t('admin.eventToday')}</button>`;
}

function oddsRowsHTML(settings) {
  return rarestFirst().map((id) => html`<tr class="r-${id}">
    <td><span class="rarity-badge">${id}</span> ${rarityName(id)}</td>
    ${ODDS_COLUMNS.map(({ section, slot }, column) => html`<td>
      <span class="input-percent">${numberField(`odds:${column}:${id}`, percent(settings[section][slot][id] ?? 0), { max: 100, step: 0.001 })}%</span>
    </td>`)}
  </tr>`);
}

function playerHTML(player) {
  const you = player.id === state.player.id;
  const { daily } = player;
  return html`<li class="admin-player" data-id="${player.id}" data-name="${player.name}">
    <div class="admin-player__who">
      <b class="admin-player__name">${player.name}</b>
      ${player.isAdmin && html`<span class="admin-badge">${t('admin.badge')}</span>`}
      ${you && html`<span class="you-pill">${t('stats.you')}</span>`}
      <span class="muted admin-player__meta">${player.email ?? '—'} · #${player.friendCode} · ${t('admin.joined', { date: fmt.day(player.createdAt.slice(0, 10)) })}</span>
    </div>
    <div class="admin-player__stats">
      <span>🃏 ${t('admin.cards', { count: player.cards, total: state.meta.totalCards })}</span>
      <span>📦 ${t('admin.boosters', { count: player.boosters })}</span>
      ${kiraHTML(player.kira)}
      ${player.superBoosters > 0 && html`<span class="admin-gift">🏆 ${t('weekly.superBoosters', { count: player.superBoosters })}</span>`}
      <span>🎁 ${t(daily.claimedToday ? 'admin.claimedToday' : 'admin.notClaimed')} · ${t('admin.claims', { count: daily.claims })}</span>
      ${daily.gift && html`<span class="admin-gift">${t('admin.giftWaiting')}</span>`}
    </div>
    <div class="admin-player__actions">
      <button class="btn btn--small" type="button" data-act="reset" ${daily.claimedToday ? '' : 'disabled'}>${t('admin.giveBack')}</button>
      <button class="btn btn--small" type="button" data-act="gift">${t(daily.gift ? 'admin.ungift' : 'admin.gift')}</button>
      <button class="btn btn--small btn--danger" type="button" data-act="clear" ${player.isAdmin ? html`disabled title="${t('admin.protected')}"` : ''}>${t('admin.clear')}</button>
      <button class="btn btn--small btn--danger" type="button" data-act="delete" ${player.isAdmin ? html`disabled title="${t('admin.protected')}"` : ''}>${t('admin.delete')}</button>
    </div>
  </li>`;
}

export async function renderAdmin(main) {
  const id = ++renderId;
  if (!state.player.isAdmin) {
    mount(main, html`<div class="empty panel"><p class="empty__title">${t('admin.only')}</p><p>${t('admin.onlyText')}</p></div>`);
    return;
  }
  mount(main, html`<section class="view view-admin"><div class="loading"><span class="loading__spinner"></span> ${t('common.loading')}</div></section>`);
  let data;
  let list;
  try {
    [data, list] = await Promise.all([fetchAdminSettings(), fetchAdminPlayers()]);
  } catch (err) {
    if (id === renderId) mount(main, html`<div class="empty panel"><p class="empty__title">${t('common.oops')}</p><p>${errorText(err)}</p></div>`);
    return;
  }
  if (id !== renderId || !main.isConnected) return;
  let { settings } = data;
  const { defaults } = data;
  oddsTotal = data.oddsTotal ?? oddsTotal;

  mount(
    main,
    html`<section class="view view-admin">
      <header class="view-head">
        <div>
          <h1 class="view-title">${t('admin.title')}</h1>
          <p class="view-sub">${t('admin.sub')}</p>
        </div>
      </header>

      <div class="admin-columns">
        <form class="panel admin-form" data-form="market" novalidate>
          <h2 class="panel__title">✦ ${t('admin.market')}</h2>
          <div data-fields></div>
          <div class="btn-row btn-row--end">
            <button class="btn btn--ghost" type="button" data-defaults>${t('admin.defaults')}</button>
            <button class="btn btn--primary" type="submit">${t('admin.save')}</button>
          </div>
        </form>
        <div class="admin-stack">
          <form class="panel admin-form" data-form="weekly" novalidate>
            <h2 class="panel__title">🏆 ${t('admin.weekly')}</h2>
            <p class="muted">${t('admin.weeklyText')}</p>
            <div class="table-wrap">
              <table class="odds admin-weekly">
                <thead><tr>
                  <th scope="col">${t('stats.rank')}</th>
                  <th scope="col">⭐ ${t('admin.superBoosters')}</th>
                  <th scope="col">✦ Kira</th>
                </tr></thead>
                <tbody data-fields></tbody>
              </table>
            </div>
            <div class="btn-row btn-row--end">
              <button class="btn btn--ghost" type="button" data-defaults>${t('admin.defaults')}</button>
              <button class="btn btn--primary" type="submit">${t('admin.save')}</button>
            </div>
          </form>
          <form class="panel admin-form" data-form="daily" novalidate>
            <h2 class="panel__title">🎁 ${t('admin.daily')}</h2>
            <div data-fields></div>
            <div class="btn-row btn-row--end">
              <button class="btn btn--ghost" type="button" data-defaults>${t('admin.defaults')}</button>
              <button class="btn btn--primary" type="submit">${t('admin.save')}</button>
            </div>
          </form>
          <section class="panel admin-events"></section>
        </div>
      </div>

      <form class="panel admin-form" data-form="odds" novalidate>
        <h2 class="panel__title">🎲 ${t('admin.odds')}</h2>
        <p class="muted">${t('admin.oddsText')}</p>
        <div class="table-wrap">
          <table class="odds admin-odds">
            <thead><tr>
              <th scope="col">${t('rules.colRarity')}</th>
              ${ODDS_COLUMNS.map(({ label }) => html`<th scope="col">${t(label)}</th>`)}
            </tr></thead>
            <tbody data-fields></tbody>
            <tfoot><tr>
              <th scope="row">${t('admin.total')}</th>
              ${ODDS_COLUMNS.map((_, column) => html`<td data-total="${column}"></td>`)}
            </tr></tfoot>
          </table>
        </div>
        <div class="btn-row btn-row--end">
          <button class="btn btn--ghost" type="button" data-defaults>${t('admin.defaults')}</button>
          <button class="btn btn--primary" type="submit">${t('admin.save')}</button>
        </div>
      </form>

      <section class="panel admin-players">
        <h2 class="panel__title">👥 ${t('admin.players')}</h2>
        <label class="field field--search">
          <span class="field__label">${t('admin.search')}</span>
          <input class="input" type="search" name="q" value="${search.q}" placeholder="${t('admin.searchPlaceholder')}" autocomplete="off">
        </label>
        <p class="result-count" aria-live="polite"></p>
        <div class="pager-slot"></div>
        <ul class="admin-list"></ul>
        <div class="pager-slot"></div>
      </section>
    </section>`,
  );

  const forms = Object.fromEntries($$('[data-form]', main).map((form) => [form.dataset.form, form]));
  const events = $('.admin-events', main);
  const fieldsOf = (name) => $('[data-fields]', forms[name]);

  // ── Settings ───────────────────────────────────────────────────────────────

  const paint = {
    market: (values) => mount(fieldsOf('market'), marketFieldsHTML(values.market)),
    weekly: (values) => mount(fieldsOf('weekly'), weeklyRowsHTML(values.weekly)),
    daily: (values) => mount(fieldsOf('daily'), dailyFieldsHTML(values.daily)),
    odds: (values) => {
      mount(fieldsOf('odds'), oddsRowsHTML(values));
      paintTotals();
    },
  };

  /** Totals of the odds columns: each must be 100%, else the form cannot be saved. */
  function paintTotals() {
    let right = true;
    ODDS_COLUMNS.forEach((_, column) => {
      const total = rarestFirst().reduce((sum, rarity) => sum + weightOf(forms.odds.elements[`odds:${column}:${rarity}`].value || 0), 0);
      const cell = $(`[data-total="${column}"]`, forms.odds);
      cell.textContent = `${percent(total)}%`;
      cell.classList.toggle('is-wrong', total !== oddsTotal);
      right &&= total === oddsTotal;
    });
    $('[type="submit"]', forms.odds).disabled = !right;
  }

  /** The values of a form, as the sections of the settings to save. */
  const read = {
    market(form) {
      const value = (name) => Number(form.elements[name].value);
      return {
        market: {
          prices: Object.fromEntries(state.meta.sets.map((set) => [set.id, value(`price:${set.id}`)])),
          recycle: Object.fromEntries(rarestFirst().map((id) => [id, value(`recycle:${id}`)])),
          cardPrices: Object.fromEntries(shopRarities(settings.market).map((id) => [id, value(`card:${id}`)])),
        },
      };
    },
    weekly(form) {
      const value = (name) => Number(form.elements[name].value);
      return { weekly: { rewards: settings.weekly.rewards.map((_, i) => ({ superBoosters: value(`super:${i}`), kira: value(`kira:${i}`) })) } };
    },
    daily(form) {
      const sets = $$('[name="sets"]:checked', form).map((box) => box.value);
      if (!sets.length) throw new Error(t('admin.needOne'));
      return { daily: { ...settings.daily, superEvery: Number(form.elements.superEvery.value), sets } };
    },
    odds(form) {
      const sections = { booster: {}, superBooster: {} };
      ODDS_COLUMNS.forEach(({ section, slot }, column) => {
        sections[section][slot] = Object.fromEntries(rarestFirst().map((id) => [id, weightOf(form.elements[`odds:${column}:${id}`].value || 0)]));
      });
      return sections;
    },
  };

  async function save(sections, message = t('admin.saved')) {
    try {
      ({ settings } = await saveAdminSettings(sections));
      toast(message, 'success');
      return true;
    } catch (err) {
      toast(errorText(err), 'error');
      return false;
    }
  }

  for (const [name, form] of Object.entries(forms)) {
    paint[name](settings);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!form.reportValidity()) return;
      let sections;
      try {
        sections = read[name](form);
      } catch (err) {
        toast(err.message, 'error');
        return;
      }
      const submit = $('[type="submit"]', form);
      submit.disabled = true;
      if (await save(sections)) paint[name](settings);
      submit.disabled = false;
      if (name === 'odds') paintTotals();
    });
    // Back to the defaults of config.js (saved only with "Save").
    $('[data-defaults]', form).addEventListener('click', () => paint[name](defaults));
  }
  forms.odds.addEventListener('input', paintTotals);

  // Super Booster events are saved at once.
  const paintEvents = () => mount(events, eventsHTML(settings.daily));
  const saveDays = async (superDays, message) => {
    if (await save({ daily: { ...settings.daily, superDays } }, message)) paintEvents();
  };
  events.addEventListener('click', (event) => {
    const { today } = dailyStatus();
    const remove = event.target.closest('[data-remove-day]');
    if (remove) saveDays(settings.daily.superDays.filter((day) => day !== remove.dataset.removeDay), t('admin.eventRemoved'));
    if (event.target.closest('[data-event-today]')) saveDays([...settings.daily.superDays, today], t('admin.eventAdded', { day: fmt.day(today) }));
    if (event.target.closest('[data-add-day]')) {
      const day = $('[name="newDay"]', events).value;
      if (!day || day < today) {
        toast(t('admin.pickDay'), 'error');
        return;
      }
      saveDays([...settings.daily.superDays, day], t('admin.eventAdded', { day: fmt.day(day) }));
    }
  });
  paintEvents();

  // ── Players ────────────────────────────────────────────────────────────────

  const players = $('.admin-players', main);
  const listElement = $('.admin-list', players);
  const pagers = $$('.pager-slot', players);
  const count = $('.result-count', players);

  function shownPlayers() {
    const query = search.q.trim().toLowerCase().replace(/^#/, '');
    const all = [...list.players].sort((a, b) => b.createdAt.localeCompare(a.createdAt)); // newest first
    if (!query) return all;
    return all.filter((player) => `${player.name} ${player.email ?? ''} ${player.friendCode} ${player.id}`.toLowerCase().includes(query));
  }

  function paintPlayers() {
    const shown = shownPlayers();
    const size = pageSize.get();
    const pages = pageCount(shown.length, size);
    search.page = Math.min(Math.max(1, search.page), pages);
    const first = (search.page - 1) * size;
    count.textContent = `${t('admin.count', { count: list.players.length })}${
      search.q.trim() ? ` · ${t('admin.matches', { count: shown.length })}` : ''
    }`;
    for (const pager of pagers) mount(pager, paginationHTML(search.page, pages));
    mount(
      listElement,
      shown.length
        ? shown.slice(first, first + size).map(playerHTML)
        : html`<li class="admin-list__none muted">${t('admin.none')}</li>`,
    );
  }

  async function reloadPlayers() {
    list = await fetchAdminPlayers();
    if (main.isConnected) paintPlayers();
  }

  $('[name="q"]', players).addEventListener('input', (event) => {
    search.q = event.target.value;
    search.page = 1;
    paintPlayers();
  });
  onPageClick(pagers, count, (page) => {
    search.page = page;
    paintPlayers();
  });

  const actions = {
    async reset(player) {
      await adminResetDaily(player.id);
      return t('admin.giveBackDone', { name: player.name });
    },
    async gift(player) {
      const gift = !list.players.find((row) => row.id === player.id)?.daily.gift;
      await adminDailyGift(player.id, gift);
      return t(gift ? 'admin.giftDone' : 'admin.ungiftDone', { name: player.name });
    },
    async clear(player) {
      const ok = await confirmDialog({
        title: t('admin.clearTitle', { name: player.name }),
        message: t('admin.clearText'),
        confirmLabel: t('admin.clearConfirm'),
        danger: true,
      });
      if (!ok) return null;
      await adminClearPlayer(player.id);
      return t('admin.clearDone', { name: player.name });
    },
    async delete(player) {
      const ok = await confirmDialog({
        title: t('admin.deleteTitle', { name: player.name }),
        message: t('admin.deleteText'),
        confirmLabel: t('admin.deleteConfirm'),
        danger: true,
      });
      if (!ok) return null;
      await adminDeletePlayer(player.id);
      return t('admin.deleteDone', { name: player.name });
    },
  };

  listElement.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-act]');
    if (!button) return;
    const row = button.closest('.admin-player');
    const player = { id: row.dataset.id, name: row.dataset.name };
    button.disabled = true;
    try {
      const message = await actions[button.dataset.act](player);
      if (message) toast(message, 'success');
      // Your own daily reward changed: the rest of the page follows.
      if (player.id === state.player.id) await refreshDaily();
    } catch (err) {
      toast(errorText(err), 'error');
    }
    await reloadPlayers().catch((err) => toast(errorText(err), 'error'));
  });

  paintPlayers();
}
