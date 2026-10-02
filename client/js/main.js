import { $, $$, html, mount, storage } from './dom.js';
import { errorText, getLang, setLang, t, tHtml } from './i18n.js';
import { loadCatalog, logout, renamePlayer, restoreSession, state, subscribe } from './state.js';
import { enableCardEffects } from './components/card.js';
import { repaintDrops, startDrops, stopDrops } from './components/drops.js';
import { formDialog } from './components/modal.js';
import { closeAllLayers, pushLayer } from './ui/layers.js';
import { sfx } from './ui/sfx.js';
import { toast } from './ui/toast.js';
import { renderAuth } from './views/auth.js';
import { renderOpen } from './views/open.js';
import { openDailyPopup, renderDaily } from './views/daily.js';
import { renderMarket } from './views/market.js';
import { renderAdmin } from './views/admin.js';
import { rollNumber } from './ui/kira.js';
import { renderCollection } from './views/collection.js';
import { renderStats, rewardText } from './views/stats.js';
import { renderRules } from './views/rules.js';
import { renderFriendCollection, renderFriends } from './views/friends.js';
import { renderTrades } from './views/trades.js';
import { boosterStock, dailyStatus, fetchNotifications, refreshDaily, syncCollection } from './state.js';

const ROUTES = {
  open: renderOpen,
  daily: renderDaily,
  market: renderMarket,
  // Shown in the menu to admins only (the server checks every admin call).
  admin: renderAdmin,
  collection: renderCollection,
  stats: renderStats,
  rules: renderRules,
  // #/friends, or #/friends/<id> for a friend's collection
  friends: (main, friendId) => (friendId ? renderFriendCollection(main, friendId) : renderFriends(main)),
  // #/trades, or #/trades/<friendId> to start a trade with that friend
  trades: renderTrades,
};

const main = $('#main');
/** 'loading' → 'auth' (logged out) or 'app' (logged in). */
let screen = 'loading';

/** [route name, parameter] from the URL hash, e.g. "#/friends/abc" → ['friends', 'abc']. */
function currentRoute() {
  const [name, param] = location.hash.replace(/^#\/?/, '').split(/[?]/)[0].split('/');
  return ROUTES[name] ? [name, param ? decodeURIComponent(param) : null] : ['open', null];
}

// ── Notifications ────────────────────────────────────────────────────────────
// The badges of the "Friends" and "Trades" links are checked every few seconds.

const NOTIFY_EVERY_MS = 10_000;
/** Last numbers shown on the badges (null = not known yet, e.g. just logged in). */
const badges = { friends: null, trades: null };
let badgesVersion = 0; // changes when a page shows fresher numbers than a check in progress
let notifyTimer = 0;

function paintBadge(name, count) {
  // The link of the menu, the one of the "More" sheet (phones), and the "More" tab: friends + trades.
  for (const badge of [$(`#${name}-badge`), $(`#sheet-${name}-badge`)]) {
    badge.textContent = count;
    badge.hidden = !count;
  }
  badges[name] = count;
  const more = (badges.friends ?? 0) + (badges.trades ?? 0);
  $('#more-badge').textContent = more;
  $('#more-badge').hidden = !more;
}

/** Numbers given by the Friends / Trades pages, which just read them. */
function pageBadge(name, count) {
  badgesVersion += 1;
  paintBadge(name, count);
}

/** True while the player types or has a dialog open: the page is not redrawn under them. */
const isBusy = () =>
  document.body.classList.contains('has-modal') || Boolean(document.activeElement?.matches?.('input, select, textarea'));

function showNotifications({ friendRequests, trades }) {
  const before = { ...badges };
  paintBadge('friends', friendRequests);
  paintBadge('trades', trades);
  if (before.friends !== null && friendRequests > before.friends) toast(t('notify.friendRequest'), 'info', 4500);
  if (before.trades !== null && trades > before.trades) toast(t('notify.trade'), 'info', 4500);

  // The Friends or Trades page on screen shows old data: redraw it.
  const [name, param] = currentRoute();
  const stale =
    (name === 'friends' && !param && before.friends !== null && friendRequests !== before.friends) ||
    (name === 'trades' && before.trades !== null && trades !== before.trades);
  if (stale && !isBusy()) render({ scroll: false });
}

async function checkNotifications() {
  if (screen !== 'app' || document.hidden) return;
  const version = badgesVersion;
  try {
    const counts = await fetchNotifications();
    if (screen === 'app' && version === badgesVersion) showNotifications(counts);
  } catch {
    /* offline or server restarting: next check */
  }
}

function startNotifications() {
  clearInterval(notifyTimer);
  checkNotifications();
  notifyTimer = setInterval(checkNotifications, NOTIFY_EVERY_MS);
}

function stopNotifications() {
  clearInterval(notifyTimer);
  badges.friends = null;
  badges.trades = null;
}

function paintStockBadge() {
  if (screen !== 'app' || !state.player) return;
  const badge = $('#open-badge');
  const stocks = Object.keys(state.meta.stocks).map(boosterStock);
  // An admin's boosters are unlimited.
  const stock = stocks.some((each) => each.unlimited) ? '∞' : String(stocks.reduce((sum, each) => sum + each.stock, 0));
  if (badge.textContent !== stock) badge.textContent = stock;
  badge.hidden = stock === '0';
}

// ── Daily reward ─────────────────────────────────────────────────────────────
// A popup shows it at the first visit of the day (once a day per player in this
// browser), then the badge of the "Daily" link. At midnight the server is asked again.

const DAILY_POPUP_KEY = 'animeClashChronicles.dailyPopup';
const WEEKLY_TOAST_KEY = 'animeClashChronicles.weeklyToast';
let dailyCheckAt = 0; // no new-day check before this time (ms): checks are spaced out when they fail

function maybeDailyPopup() {
  const daily = dailyStatus();
  const key = `${state.player.id} ${daily.today}`;
  if (!daily.available || storage.get(DAILY_POPUP_KEY) === key) return;
  storage.set(DAILY_POPUP_KEY, key);
  if (currentRoute()[0] === 'daily') return; // the page shows it already
  if (isBusy() || document.body.classList.contains('has-stage')) toast(t('daily.ready'), 'info', 5000);
  else openDailyPopup();
}

/** Once per week ended: what the player won in the weekly ranking (their Super Boosters wait on the shelf). */
function maybeWeeklyToast() {
  const won = state.player.lastWeekly;
  if (!won || (!won.superBoosters && !won.kira)) return;
  const key = `${state.player.id} ${won.week}`;
  if (storage.get(WEEKLY_TOAST_KEY) === key) return;
  storage.set(WEEKLY_TOAST_KEY, key);
  sfx.play('fanfare');
  toast(t('weekly.wonToast', { rank: won.rank, prize: rewardText(won), count: won.rank }), 'success', 8000);
}

async function paintDaily() {
  if (screen !== 'app' || !state.player) return;
  const daily = dailyStatus();
  $('#daily-badge').hidden = !daily.available;
  if (!daily.newDay || document.hidden || Date.now() < dailyCheckAt) return;
  dailyCheckAt = Date.now() + 30_000;
  try {
    await refreshDaily();
  } catch {
    return; /* offline or server restarting: try again later */
  }
  dailyCheckAt = 0;
  if (screen !== 'app') return;
  $('#daily-badge').hidden = !dailyStatus().available;
  maybeDailyPopup();
}

// ── Header & static texts ────────────────────────────────────────────────────

// Colorblind mode: off by default, remembered in this browser.
const COLORBLIND_KEY = 'animeClashChronicles.colorblind';
let colorblind = (() => {
  try {
    return localStorage.getItem(COLORBLIND_KEY) === 'on';
  } catch {
    return false;
  }
})();

function paintColorblind() {
  document.documentElement.classList.toggle('cb-mode', colorblind);
  const button = $('#colorblind-toggle');
  button.setAttribute('aria-pressed', String(colorblind));
  button.title = colorblind ? t('header.colorblindOn') : t('header.colorblindOff');
  $('[data-proxy="colorblind-toggle"]').setAttribute('aria-pressed', String(colorblind));
}

function paintSound() {
  const button = $('#sound-toggle');
  button.textContent = sfx.enabled ? '🔊' : '🔇';
  button.setAttribute('aria-pressed', String(sfx.enabled));
  button.title = sfx.enabled ? t('header.soundOn') : t('header.soundOff');
  $('[data-proxy="sound-toggle"]').setAttribute('aria-pressed', String(sfx.enabled));
  $('[data-sound-icon]').textContent = sfx.enabled ? '🔊' : '🔇';
}

/** Texts of index.html, marked with data-i18n attributes. */
function applyStaticTexts() {
  for (const el of $$('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of $$('[data-i18n-aria]')) el.setAttribute('aria-label', t(el.dataset.i18nAria));
  for (const el of $$('[data-i18n-title]')) el.title = t(el.dataset.i18nTitle);
  $('#footer').innerHTML = tHtml('footer');
  for (const button of $$('[data-lang]')) button.setAttribute('aria-pressed', String(button.dataset.lang === getLang()));
  paintSound();
  paintColorblind();
}

function updateHeader() {
  const { player } = state;
  if (!player) return;
  $('#player-name').textContent = player.name;
  $('#player-progress').textContent = `${player.stats.uniqueCards}/${player.stats.totalCards}`;
  $('#sheet-player-name').textContent = player.name;
  $('#sheet-player-progress').textContent = `${player.stats.uniqueCards}/${player.stats.totalCards}`;
  rollNumber($('#kira-balance'), player.kira);
  $('#admin-link').hidden = !player.isAdmin;
  $('#sheet-admin-link').hidden = !player.isAdmin;
}

// ── Phones: the "More" sheet ─────────────────────────────────────────────────
// The tab bar at the bottom shows the main pages; "More" opens a sheet with the
// other ones and the settings of the header (its buttons click the header's).

const sheet = $('#more-sheet');
const MORE_ROUTES = ['friends', 'trades', 'stats', 'rules', 'admin'];
let removeSheetLayer = null;

function openSheet() {
  sheet.hidden = false;
  requestAnimationFrame(() => sheet.classList.add('is-open'));
  document.body.classList.add('has-sheet');
  $('#nav-more').setAttribute('aria-expanded', 'true');
  removeSheetLayer = pushLayer(closeSheet);
  $('.sheet__panel', sheet).focus({ preventScroll: true });
}

function closeSheet() {
  if (!sheet.classList.contains('is-open')) return;
  removeSheetLayer?.();
  removeSheetLayer = null;
  sheet.classList.remove('is-open');
  document.body.classList.remove('has-sheet');
  $('#nav-more').setAttribute('aria-expanded', 'false');
  setTimeout(() => {
    if (!sheet.classList.contains('is-open')) sheet.hidden = true;
  }, 250);
}

function setupSheet() {
  $('#nav-more').addEventListener('click', () => (sheet.classList.contains('is-open') ? closeSheet() : openSheet()));
  sheet.addEventListener('click', (event) => {
    if (event.target.closest('[data-close-sheet], .sheet__links a')) closeSheet();
    const proxy = event.target.closest('[data-proxy]');
    if (!proxy) return;
    // Renaming and logging out leave the sheet; sound and colorblind mode keep it open.
    if (['player-chip', 'logout'].includes(proxy.dataset.proxy)) closeSheet();
    $(`#${proxy.dataset.proxy}`).click();
  });
}

function setupHeader() {
  $('#player-chip').addEventListener('click', async () => {
    const saved = await formDialog({
      title: t('header.renameTitle'),
      fields: [{ name: 'name', label: t('header.renameLabel'), value: state.player.name, maxLength: 24 }],
      onSubmit: ({ name }) => renamePlayer(name),
    });
    if (saved) toast(t('header.welcome', { name: state.player.name }), 'success');
  });

  $('#colorblind-toggle').addEventListener('click', () => {
    colorblind = !colorblind;
    try {
      localStorage.setItem(COLORBLIND_KEY, colorblind ? 'on' : 'off');
    } catch {
      /* not remembered in private mode */
    }
    paintColorblind();
    toast(t(colorblind ? 'header.colorblindEnabled' : 'header.colorblindDisabled'), colorblind ? 'success' : 'info');
  });

  $('#sound-toggle').addEventListener('click', () => {
    sfx.enabled = !sfx.enabled;
    paintSound();
    sfx.play('click');
  });

  for (const button of $$('[data-lang]')) button.addEventListener('click', () => setLang(button.dataset.lang));

  $('#logout').addEventListener('click', doLogout);
}

// ── Screens ──────────────────────────────────────────────────────────────────

function render({ scroll = true } = {}) {
  if (screen !== 'app') return;
  const [name, param] = currentRoute();
  for (const link of $$('.nav a, .sheet__links a')) {
    if (link.dataset.route === name) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  $('#nav-more').classList.toggle('is-current', MORE_ROUTES.includes(name));
  document.title = `${t(`titles.${name}`)} · Anime Clash Chronicles`;
  main.dataset.view = name;
  ROUTES[name](main, param ?? undefined);
  // A friend may have accepted a trade since your cards were loaded: show your latest collection.
  if (name === 'collection') {
    syncCollection()
      .then((changed) => changed && screen === 'app' && currentRoute()[0] === 'collection' && render({ scroll: false }))
      .catch(() => {});
  }
  if (scroll) {
    window.scrollTo(0, 0);
    main.focus({ preventScroll: true });
  }
}

function showAuth() {
  screen = 'auth';
  stopNotifications();
  stopDrops();
  closeAllLayers();
  document.body.classList.add('is-logged-out');
  document.title = `${t('titles.auth')} · Anime Clash Chronicles`;
  main.dataset.view = 'auth';
  renderAuth(main, {
    onSuccess(player, how) {
      toast(t(how === 'register' ? 'auth.created' : 'auth.welcomeBack', { name: player.name }), 'success');
      enterApp();
    },
  });
}

function enterApp() {
  screen = 'app';
  document.body.classList.remove('is-logged-out');
  updateHeader();
  render();
  startNotifications();
  startDrops();
  paintStockBadge();
  paintDaily();
  maybeDailyPopup();
  maybeWeeklyToast();
}

async function doLogout() {
  closeAllLayers();
  try {
    await logout();
  } catch {
    /* even if the server cannot be reached, show the login screen */
  }
  toast(t('auth.loggedOut'));
  history.replaceState(null, '', '#/');
  showAuth();
}

async function start() {
  applyStaticTexts();
  mount(main, html`<div class="loading"><span class="loading__spinner"></span> ${t('app.loading')}</div>`);

  let player;
  try {
    await loadCatalog();
    player = await restoreSession();
  } catch (err) {
    mount(
      main,
      html`<div class="empty panel">
        <p class="empty__title">${t('app.loadError')}</p>
        <p>${errorText(err)}</p>
        <button class="btn btn--primary" type="button">${t('app.retry')}</button>
      </div>`,
    );
    $('.empty .btn', main)?.addEventListener('click', () => location.reload());
    return;
  }

  enableCardEffects();
  setupHeader();
  setupSheet();
  subscribe(updateHeader);

  window.addEventListener('hashchange', () => {
    if (screen !== 'app') return;
    closeAllLayers();
    render();
  });
  // A booster stage was closed: refresh the page behind it (progress bars…).
  window.addEventListener('mb:refresh', () => render({ scroll: false }));
  window.addEventListener('mb:lang', () => {
    applyStaticTexts();
    if (screen === 'app') {
      render({ scroll: false });
      repaintDrops();
    } else if (screen === 'auth') {
      showAuth();
    }
  });
  window.addEventListener('mb:logout', doLogout);
  window.addEventListener('mb:friend-requests', (event) => pageBadge('friends', event.detail));
  window.addEventListener('mb:trades-waiting', (event) => pageBadge('trades', event.detail));
  // Boosters in stock (both stocks), on the "Open" link, and the daily reward.
  setInterval(() => {
    paintStockBadge();
    paintDaily();
  }, 1000);
  // Back on the tab: check at once instead of waiting for the next check.
  document.addEventListener('visibilitychange', checkNotifications);
  window.addEventListener('mb:unauthorized', () => {
    if (screen !== 'app') return;
    state.player = null;
    toast(t('app.sessionExpired'), 'error');
    showAuth();
  });

  if (player) enterApp();
  else showAuth();
}

start();
