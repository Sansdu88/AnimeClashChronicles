/** Tiny DOM helpers: an auto-escaping `html` template tag, selectors and formatters. */
import { locale } from './i18n.js';

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ESCAPES[ch]);

class SafeHtml {
  constructor(value) {
    this.value = value;
  }
  toString() {
    return this.value;
  }
}

/** Marks a string as already-safe HTML. */
export const raw = (value) => new SafeHtml(String(value));

function render(value) {
  if (value instanceof SafeHtml) return value.value;
  if (Array.isArray(value)) return value.map(render).join('');
  if (value === null || value === undefined || value === false) return '';
  return escapeHtml(value);
}

/** html`<p>${text}</p>` — every interpolated value is escaped unless it is itself html`` or raw(). */
export function html(strings, ...values) {
  let out = strings[0];
  values.forEach((value, i) => {
    out += render(value) + strings[i + 1];
  });
  return new SafeHtml(out);
}

export function mount(element, content) {
  element.innerHTML = render(content);
  return element;
}

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

export const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export const storage = {
  get(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* private mode: settings are simply not remembered */
    }
  },
};

/** Numbers and dates in the format of the current language. */
export const fmt = {
  number: (n) => Number(n).toLocaleString(locale()),
  percent: (ratio, digits = 0) =>
    new Intl.NumberFormat(locale(), { style: 'percent', minimumFractionDigits: digits, maximumFractionDigits: digits }).format(ratio),
  date: (iso) => new Intl.DateTimeFormat(locale(), { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso)),
  day: (iso) => new Intl.DateTimeFormat(locale(), { dateStyle: 'long' }).format(new Date(`${iso}T12:00:00Z`)),
  pad: (n) => String(n).padStart(3, '0'),
  timeAgo(iso) {
    const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
    const relative = new Intl.RelativeTimeFormat(locale(), { numeric: 'auto' });
    const units = [
      ['year', 31536000],
      ['month', 2592000],
      ['day', 86400],
      ['hour', 3600],
      ['minute', 60],
    ];
    for (const [unit, size] of units) {
      const value = Math.floor(seconds / size);
      if (value >= 1) return relative.format(-value, unit);
    }
    return relative.format(0, 'second');
  },
};
