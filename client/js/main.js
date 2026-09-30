import { $, $$, html, mount } from './dom.js';
import { errorText, getLang, setLang, t, tHtml } from './i18n.js';
import { loadCatalog, logout, renamePlayer, restoreSession, state, subscribe } from './state.js';
import { enableCardEffects } from './components/card.js';
import { formDialog } from './components/modal.js';
import { closeAllLayers } from './ui/layers.js';
import { sfx } from './ui/sfx.js';
import { toast } from './ui/toast.js';
import { renderAuth } from './views/auth.js';
import { renderOpen } from './views/open.js';
import { renderCollection } from './views/collection.js';
import { renderStats } from './views/stats.js';
import { renderRules } from './views/rules.js';

const ROUTES = {
  open: renderOpen,
  collection: renderCollection,
  stats: renderStats,
  rules: renderRules,
};

const main = $('#main');
/** 'loading' → 'auth' (logged out) or 'app' (logged in). */
let screen = 'loading';

function currentRoute() {
  const name = location.hash.replace(/^#\/?/, '').split(/[?/]/)[0];
  return ROUTES[name] ? name : 'open';
}

// ── Header & static texts ────────────────────────────────────────────────────

function paintSound() {
  const button = $('#sound-toggle');
  button.textContent = sfx.enabled ? '🔊' : '🔇';
  button.setAttribute('aria-pressed', String(sfx.enabled));
  button.title = sfx.enabled ? t('header.soundOn') : t('header.soundOff');
}

/** Texts of index.html, marked with data-i18n attributes. */
function applyStaticTexts() {
  for (const el of $$('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of $$('[data-i18n-aria]')) el.setAttribute('aria-label', t(el.dataset.i18nAria));
  for (const el of $$('[data-i18n-title]')) el.title = t(el.dataset.i18nTitle);
  $('#footer').innerHTML = tHtml('footer');
  for (const button of $$('[data-lang]')) button.setAttribute('aria-pressed', String(button.dataset.lang === getLang()));
  paintSound();
}

function updateHeader() {
  const { player } = state;
  if (!player) return;
  $('#player-name').textContent = player.name;
  $('#player-progress').textContent = `${player.stats.uniqueCards}/${player.stats.totalCards}`;
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
  const name = currentRoute();
  for (const link of $$('.nav a')) {
    if (link.dataset.route === name) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  document.title = `${t(`titles.${name}`)} · Anime Clash Chronicles`;
  main.dataset.view = name;
  ROUTES[name](main);
  if (scroll) {
    window.scrollTo(0, 0);
    main.focus({ preventScroll: true });
  }
}

function showAuth() {
  screen = 'auth';
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
    if (screen === 'app') render({ scroll: false });
    else if (screen === 'auth') showAuth();
  });
  window.addEventListener('mb:logout', doLogout);
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
