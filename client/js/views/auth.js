/** Log in / create account screen, shown while no one is logged in. */
import { $, html, mount } from '../dom.js';
import { errorText, t } from '../i18n.js';
import { byRarity, hasLegacyPlayer, login, register, state } from '../state.js';
import { cardHTML } from '../components/card.js';

let mode = 'login';
// Kept when switching tabs or languages, so the player does not type them again.
// `login`: the e-mail or the player name typed to log in.
const draft = { login: '', email: '', name: '' };

/** `onSuccess(player, mode)` is called once logged in. */
export function renderAuth(main, { onSuccess }) {
  const isLogin = mode === 'login';
  const preview = [...state.cards].sort(byRarity).slice(0, 3);

  mount(
    main,
    html`<section class="view view-auth">
      <div class="auth">
        <div class="auth__intro">
          <h1 class="auth__title">${t('auth.title')}</h1>
          <p class="auth__pitch">${t('auth.pitch')}</p>
          <div class="auth__fan" aria-hidden="true">
            ${preview.map((card, i) => html`<div class="auth__fan-card" style="--i:${i}">${cardHTML(card, { interactive: false, lazy: false })}</div>`)}
          </div>
        </div>

        <div class="auth__panel panel">
          <div class="tabs" role="tablist">
            <button class="tabs__tab" type="button" role="tab" data-mode="login" aria-selected="${isLogin}">${t('auth.login')}</button>
            <button class="tabs__tab" type="button" role="tab" data-mode="register" aria-selected="${!isLogin}">${t('auth.register')}</button>
          </div>
          <form class="auth__form" novalidate>
            ${!isLogin &&
            html`<label class="field">
              <span class="field__label">${t('auth.name')}</span>
              <input class="input" name="name" maxlength="24" autocomplete="nickname" value="${draft.name}">
              <span class="field__hint">${t('auth.nameHint')}</span>
            </label>`}
            ${isLogin
              ? html`<label class="field">
                  <span class="field__label">${t('auth.loginId')}</span>
                  <input class="input" name="login" autocomplete="username" autocapitalize="none" spellcheck="false" required
                    value="${draft.login}">
                </label>`
              : html`<label class="field">
                  <span class="field__label">${t('auth.email')}</span>
                  <input class="input" name="email" type="email" autocomplete="email" required value="${draft.email}">
                </label>`}
            <label class="field">
              <span class="field__label">${t('auth.password')}</span>
              <span class="password">
                <input class="input" name="password" type="password" maxlength="128" required
                  autocomplete="${isLogin ? 'current-password' : 'new-password'}">
                <button class="password__toggle" type="button" aria-pressed="false">${t('auth.show')}</button>
              </span>
              ${!isLogin && html`<span class="field__hint">${t('auth.passwordHint')}</span>`}
            </label>
            ${!isLogin && hasLegacyPlayer() && html`<p class="auth__legacy">🎁 ${t('auth.legacy')}</p>`}            <p class="form-error" role="alert"></p>
            <button class="btn btn--primary btn--big auth__submit" type="submit">
              ${isLogin ? t('auth.submitLogin') : t('auth.submitRegister')}
            </button>
            <p class="auth__switch">
              ${isLogin ? t('auth.toRegister') : t('auth.toLogin')}
              <button class="link-button" type="button" data-mode="${isLogin ? 'register' : 'login'}">
                ${isLogin ? t('auth.toRegisterLink') : t('auth.toLoginLink')}
              </button>
            </p>
          </form>
        </div>
      </div>
    </section>`,
  );

  const form = $('.auth__form', main);
  const errorBox = $('.form-error', form);
  const submit = $('.auth__submit', form);
  const { password } = form.elements;
  const id = form.elements.login ?? form.elements.email; // e-mail or name to log in, e-mail to sign up
  (id.value ? password : (form.elements.name ?? id)).focus({ preventScroll: true });

  main.querySelectorAll('[data-mode]').forEach((button) =>
    button.addEventListener('click', () => {
      if (button.dataset.mode === mode) return;
      mode = button.dataset.mode;
      renderAuth(main, { onSuccess });
    }),
  );

  form.addEventListener('input', (event) => {
    const { name, value } = event.target;
    if (name in draft) draft[name] = value;
    // An e-mail is kept from one tab to the other (not a player name typed to log in).
    if (name === 'email') draft.login = value;
    if (name === 'login') draft.email = value.includes('@') ? value : '';
  });

  $('.password__toggle', form).addEventListener('click', (event) => {
    const visible = password.type === 'password';
    password.type = visible ? 'text' : 'password';
    event.currentTarget.textContent = visible ? t('auth.hide') : t('auth.show');
    event.currentTarget.setAttribute('aria-pressed', String(visible));
    password.focus();
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    errorBox.textContent = '';
    if (!id.value.trim() || !password.value) {
      errorBox.textContent = t(mode === 'login' ? 'auth.requiredLogin' : 'auth.required');
      (id.value.trim() ? password : id).focus();
      return;
    }
    submit.disabled = true;
    try {
      const player =
        mode === 'login'
          ? await login(id.value.trim(), password.value)
          : await register({ email: id.value.trim(), password: password.value, name: form.elements.name?.value.trim() });
      const how = mode;
      draft.name = '';
      mode = 'login';
      onSuccess(player, how);
    } catch (err) {
      errorBox.textContent = errorText(err);
      submit.disabled = false;
      password.focus();
      password.select();
    }
  });
}
