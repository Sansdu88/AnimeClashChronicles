import { escapeHtml, html, raw } from '../dom.js';
import { errorText, t } from '../i18n.js';
import { pushLayer } from '../ui/layers.js';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

/** Opens a modal dialog. Returns { body, setContent, close }. */
export function openModal(content, { label = 'Dialog', className = '', onClose } = {}) {
  const previousFocus = document.activeElement;
  const root = document.createElement('div');
  root.className = `modal ${className}`;
  root.innerHTML = `
    <div class="modal__backdrop" data-close></div>
    <div class="modal__panel" role="dialog" aria-modal="true" aria-label="${escapeHtml(label)}" tabindex="-1">
      <button class="modal__close" type="button" data-close aria-label="${escapeHtml(t('common.close'))}">✕</button>
      <div class="modal__content"></div>
    </div>`;
  const panel = root.querySelector('.modal__panel');
  const body = root.querySelector('.modal__content');
  body.innerHTML = String(content);
  document.body.append(root);
  document.body.classList.add('has-modal');
  requestAnimationFrame(() => root.classList.add('is-open'));
  panel.focus({ preventScroll: true });

  let closed = false;
  const removeLayer = pushLayer(close);

  root.addEventListener('click', (event) => {
    if (event.target.closest('[data-close]')) close();
  });
  root.addEventListener('keydown', (event) => {
    if (event.key !== 'Tab') return;
    const items = [...panel.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null);
    if (items.length === 0) return;
    const first = items[0];
    const last = items.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  function close() {
    if (closed) return;
    closed = true;
    removeLayer();
    root.classList.remove('is-open');
    root.classList.add('is-leaving');
    setTimeout(() => root.remove(), 200);
    if (!document.querySelector('.modal:not(.is-leaving)')) document.body.classList.remove('has-modal');
    previousFocus?.focus?.({ preventScroll: true });
    onClose?.();
  }

  return {
    root,
    body,
    close,
    setContent(next) {
      body.innerHTML = String(next);
    },
    setLabel(next) {
      panel.setAttribute('aria-label', next);
    },
  };
}

/** Yes/no question. Resolves to true when confirmed. */
export function confirmDialog({ title, message, confirmLabel = t('common.confirm'), danger = false }) {
  return new Promise((resolve) => {
    let answer = false;
    const modal = openModal(
      html`<div class="dialog">
        <h2 class="dialog__title">${title}</h2>
        <p class="dialog__text">${message}</p>
        <div class="btn-row btn-row--end">
          <button class="btn btn--ghost" type="button" data-close>${t('common.cancel')}</button>
          <button class="btn ${danger ? 'btn--danger' : 'btn--primary'}" type="button" data-confirm>${confirmLabel}</button>
        </div>
      </div>`,
      { label: title, className: 'modal--small', onClose: () => resolve(answer) },
    );
    const confirmButton = modal.body.querySelector('[data-confirm]');
    confirmButton.focus();
    confirmButton.addEventListener('click', () => {
      answer = true;
      modal.close();
    });
  });
}

/**
 * A small form in a dialog. `fields`: [{ name, label, type, value, autocomplete, maxLength, hint }].
 * `onSubmit(values)` may throw: its error is shown in the dialog, which stays open.
 * Resolves to true once submitted successfully, false when cancelled.
 */
export function formDialog({ title, fields, submitLabel = t('common.save'), onSubmit }) {
  return new Promise((resolve) => {
    let done = false;
    const modal = openModal(
      html`<form class="dialog" novalidate>
        <h2 class="dialog__title">${title}</h2>
        ${fields.map(
          (field) => html`<label class="field">
            <span class="field__label">${field.label}</span>
            <input class="input" name="${field.name}" type="${field.type ?? 'text'}" value="${field.value ?? ''}"
              ${raw(field.maxLength ? `maxlength="${field.maxLength}"` : '')} autocomplete="${field.autocomplete ?? 'off'}"
              spellcheck="false" required>
            ${field.hint && html`<span class="field__hint">${field.hint}</span>`}
          </label>`,
        )}
        <p class="form-error" role="alert"></p>
        <div class="btn-row btn-row--end">
          <button class="btn btn--ghost" type="button" data-close>${t('common.cancel')}</button>
          <button class="btn btn--primary" type="submit">${submitLabel}</button>
        </div>
      </form>`,
      { label: title, className: 'modal--small', onClose: () => resolve(done) },
    );
    const form = modal.body.querySelector('form');
    const errorBox = form.querySelector('.form-error');
    const first = form.querySelector('input');
    first.focus();
    first.select();
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const values = Object.fromEntries(new FormData(form));
      const empty = fields.find((field) => !String(values[field.name]).trim());
      if (empty) {
        form.elements[empty.name].focus();
        return;
      }
      const submit = form.querySelector('[type="submit"]');
      submit.disabled = true;
      errorBox.textContent = '';
      try {
        await onSubmit(values);
        done = true;
        modal.close();
      } catch (err) {
        errorBox.textContent = errorText(err);
        submit.disabled = false;
      }
    });
  });
}
