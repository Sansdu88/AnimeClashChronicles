/**
 * Page numbers for long card lists: ‹ 1 … 4 5 [6] 7 8 … 41 ›.
 * Every button carries its page in `data-page`.
 */
import { html, storage } from '../dom.js';
import { t } from '../i18n.js';

const PAGE_SIZE_KEY = 'animeClashChronicles.pageSize';
export const PAGE_SIZES = [50, 100];

/** Cards per page chosen by the player (remembered in this browser). */
export const pageSize = {
  get: () => (PAGE_SIZES.includes(Number(storage.get(PAGE_SIZE_KEY))) ? Number(storage.get(PAGE_SIZE_KEY)) : PAGE_SIZES[0]),
  set: (size) => storage.set(PAGE_SIZE_KEY, String(size)),
};

export const pageCount = (total, size) => Math.max(1, Math.ceil(total / size));

/** The first page, the last one, and 2 on each side of the current one; gaps become "…". */
function pageNumbers(page, pages) {
  const shown = new Set([1, pages]);
  for (let n = page - 2; n <= page + 2; n++) if (n >= 1 && n <= pages) shown.add(n);
  const sorted = [...shown].sort((a, b) => a - b);
  return sorted.flatMap((n, i) => (i && n - sorted[i - 1] > 1 ? ['…', n] : [n]));
}

/** Nothing when everything fits on one page. */
export function paginationHTML(page, pages) {
  if (pages <= 1) return '';
  return html`<nav class="pager" aria-label="${t('pager.label')}">
    <button class="pager__btn pager__btn--step" type="button" data-page="${page - 1}" aria-label="${t('pager.previous')}" ${page <= 1 ? 'disabled' : ''}>‹</button>
    ${pageNumbers(page, pages).map((n) =>
      n === '…'
        ? html`<span class="pager__gap" aria-hidden="true">…</span>`
        : html`<button class="pager__btn" type="button" data-page="${n}" aria-label="${t('pager.page', { page: n })}"
            ${n === page ? html`aria-current="page"` : ''}>${n}</button>`,
    )}
    <button class="pager__btn pager__btn--step" type="button" data-page="${page + 1}" aria-label="${t('pager.next')}" ${page >= pages ? 'disabled' : ''}>›</button>
  </nav>`;
}

/**
 * Clicks on the page numbers of `pagers` (the top one first) call `go(page)`; the list
 * then starts again at the top of the screen (from `anchor`, under the header).
 */
export function onPageClick(pagers, anchor, go) {
  for (const pager of pagers) {
    pager.addEventListener('click', (event) => {
      const button = event.target.closest('[data-page]');
      if (!button || button.disabled) return;
      go(Number(button.dataset.page));
      const top = anchor.getBoundingClientRect().top - (document.querySelector('.topbar')?.offsetHeight ?? 0) - 12;
      if (top < 0) window.scrollBy({ top, behavior: 'instant' });
      pagers[0].querySelector('[aria-current="page"]')?.focus({ preventScroll: true });
    });
  }
}
