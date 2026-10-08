/**
 * "Profile" page (#/profile, the 👤 button of the header): your name, badges and numbers,
 * and your showcase: up to 10 favorite cards you choose, that your friends see on your page.
 */
import { $, fmt, html, mount } from '../dom.js';
import { errorText, t } from '../i18n.js';
import { renamePlayer, state, syncCollection } from '../state.js';
import { formDialog } from '../components/modal.js';
import { SHOWCASE_SIZE, mountShowcase } from '../components/showcase.js';
import { toast } from '../ui/toast.js';
import { badgesHTML } from './achievements.js';
import { tile } from './stats.js';

let renderId = 0;

export async function renderProfile(main) {
  const id = ++renderId;
  mount(main, html`<section class="view view-profile"><div class="loading"><span class="loading__spinner"></span> ${t('common.loading')}</div></section>`);
  // Your latest cards: a friend may have taken one of the showcase in a trade.
  try {
    await syncCollection();
  } catch (err) {
    if (id === renderId && main.dataset.view === 'profile') mount(main, html`<div class="empty panel"><p class="empty__title">${t('common.oops')}</p><p>${errorText(err)}</p></div>`);
    return;
  }
  // Another page may be on screen by now.
  if (id !== renderId || main.dataset.view !== 'profile') return;

  const { player } = state;
  const { stats } = player;
  const showcase = player.showcase ?? [];

  mount(
    main,
    html`<section class="view view-profile">
      <header class="view-head">
        <div class="profile-who">
          <span class="friend__avatar profile-who__avatar" aria-hidden="true">${[...player.name][0]?.toUpperCase() ?? '?'}</span>
          <div>
            <h1 class="view-title">${player.name}</h1>
            <p class="view-sub">${badgesHTML(player.achievements.map((row) => row.id))} #${player.friendCode} · ${t('profile.since', { date: fmt.date(player.createdAt) })}</p>
          </div>
        </div>
        <div class="btn-row">
          <button class="btn btn--secondary" type="button" data-action="rename">${t('stats.rename')}</button>
          <a class="btn btn--ghost" href="#/stats">${t('profile.stats')}</a>
        </div>
      </header>

      <div class="stat-tiles">
        ${tile(t('stats.score'), fmt.number(stats.score))}
        ${tile(t('stats.unique'), `${stats.uniqueCards}/${stats.totalCards}`, fmt.percent(stats.completion, 1))}
        ${tile(t('stats.boosters'), fmt.number(stats.boostersOpened))}
        ${tile(t('profile.achievements'), fmt.number(player.achievements.length))}
      </div>

      <section class="panel showcase-panel">
        <div class="showcase-panel__head">
          <h2 class="panel__title">✨ ${t('showcase.title')}</h2>
          <span class="showcase-panel__count"></span>
        </div>
        <p class="muted">${t('showcase.hint', { size: SHOWCASE_SIZE })}</p>
        <div class="showcase-mount"></div>
      </section>
    </section>`,
  );

  const count = $('.showcase-panel__count', main);
  const paintCount = (ids) => (count.textContent = `${ids.length}/${SHOWCASE_SIZE}`);
  paintCount(showcase);
  mountShowcase($('.showcase-mount', main), { cardIds: showcase, editable: true, onChange: paintCount });

  $('[data-action="rename"]', main).addEventListener('click', async () => {
    const saved = await formDialog({
      title: t('stats.renameTitle'),
      fields: [{ name: 'name', label: t('stats.renameLabel'), value: state.player.name, maxLength: 24 }],
      onSubmit: ({ name }) => renamePlayer(name),
    });
    if (saved) {
      toast(t('stats.nameSaved'), 'success');
      renderProfile(main);
    }
  });
}
