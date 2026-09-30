import { escapeHtml } from '../dom.js';

/** Small notification in the corner. `kind`: info | success | error */
export function toast(message, kind = 'info', duration = 3200) {
  const root = document.getElementById('toasts');
  if (!root) return;
  const item = document.createElement('div');
  item.className = `toast toast--${kind}`;
  item.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  item.innerHTML = escapeHtml(message);
  root.append(item);
  setTimeout(() => {
    item.classList.add('is-leaving');
    setTimeout(() => item.remove(), 300);
  }, duration);
}
