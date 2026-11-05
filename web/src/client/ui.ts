// The browser's small shared helpers, as assets/js/core/ui.js has them: the visitor's settings in this browser, who's
// signed in, moving between pages without a reload, the address's query, the page's title, the live region, motion,
// and the data tables' labels.

import { text } from './i18n.ts';

/**
 * Tiny persistent preference (localStorage may be unavailable, so every access is guarded). Setting one fires a
 * `ptctb:pref` event on window with `{ key, value }`, so the header can follow a sign-in as it changes.
 */
export const prefs = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  get(key: string, fallback: any): any {
    try { const v = localStorage.getItem(`ptctb:${key}`); return v === null ? fallback : JSON.parse(v); } catch { return fallback; }
  },
  set(key: string, value: unknown): void {
    try { localStorage.setItem(`ptctb:${key}`, JSON.stringify(value)); } catch { /* private mode */ }
    window.dispatchEvent(new CustomEvent('ptctb:pref', { detail: { key, value } }));
  },
};

/** The sign-in session in this browser (client/you.ts keeps it, signin/session.js makes it). */
export interface Session {
  id: number;
  token: string;
  /** When it ends, unix seconds. */
  exp: number;
}

/**
 * The visitor's osu! player id while their sign-in lasts (the 30-day session client/you.ts keeps), else null. The only
 * "you" the site has: highlighted rows, the You menu and Bananas all key off it.
 */
export function myId(): number | null {
  const s: Session | null = prefs.get('osuSession', null);
  return s?.token && s.exp > Date.now() / 1000 && Number.isSafeInteger(s.id) && s.id > 0 ? s.id : null;
}

/** The page's address on this site, path and query: '/maps?q=x&page=2'. */
export const here = (): string => location.pathname + location.search;

/**
 * Opens one of the site's pages (an address like '/player/123?tab=x') without a reload; `replace` swaps it for the
 * current history entry instead of adding one. The app draws it on 'routechange'.
 */
export function go(address: string, { replace = false } = {}): void {
  if (address === here()) return;
  history[replace ? 'replaceState' : 'pushState'](null, '', address);
  window.dispatchEvent(new Event('routechange'));
}

/** The address's query (/maps?q=x&page=2) as an object. */
export const readQuery = (): Record<string, string> => Object.fromEntries(new URLSearchParams(location.search));

/**
 * Rewrites the address's query in place, so filters, sort and page survive Back and can be shared. No history entry
 * and no redraw. Empty, false and default values (`defaults[key]`) are left out.
 */
export function writeQuery(params: Record<string, unknown>, defaults: Record<string, unknown> = {}): void {
  const path = location.pathname;
  const before = readQuery();
  const kept = Object.entries(params).filter(([k, v]) => v !== '' && v !== null && v !== undefined && v !== false && String(v) !== String(defaults[k] ?? ''));
  const q = String(new URLSearchParams(kept.map(([k, v]) => [k, v === true ? '1' : String(v)])));
  history.replaceState(history.state, '', `${path}${q ? `?${q}` : ''}`);
  // For the usage counts (client/track.ts): which filters, sorts and search fields get used.
  window.dispatchEvent(new CustomEvent('ptctb:query', { detail: { before, after: readQuery() } }));
}

/** Opens and focuses the header search, the same as pressing "/" (client/search.ts). */
export const openSearch = (): void => { document.dispatchEvent(new KeyboardEvent('keydown', { key: '/', bubbles: true })); };

export const reducedMotion = (): boolean => matchMedia('(prefers-reduced-motion: reduce)').matches;
export const scrollBehavior = (): ScrollBehavior => (reducedMotion() ? 'auto' : 'smooth');

/** Says `message` through the page's polite live region (#status in index.html), e.g. a new result count. */
export function announce(message: string): void {
  const el = document.getElementById('status');
  if (!el) return;
  el.textContent = '';
  setTimeout(() => { el.textContent = message; }, 50);
}

/** The window's title: the page's, then the site's name; the site's own for '' (the home page). */
export function setTitle(title: string): void {
  document.title = title ? `${title} · PT Catch` : `PT Catch · ${text().t('osu!catch in Portugal')}`;
}

/**
 * Makes data tables usable by keyboard and screen readers: the scroll box becomes a labelled, focusable region,
 * tables get a caption and header cells a scope. Runs on whatever is in `scope`, so call it after drawing.
 */
export function enhanceTables(scope: ParentNode): void {
  scope.querySelectorAll<HTMLElement>('.table-wrap:not([data-ok])').forEach(wrap => {
    wrap.dataset.ok = '';
    const table = wrap.querySelector('table');
    const label = wrap.dataset.label || headingBefore(wrap) || text().t('Table');
    wrap.setAttribute('role', 'region');
    wrap.setAttribute('aria-label', label);
    wrap.tabIndex = 0;
    if (table && !table.caption) {
      const caption = table.createCaption();
      caption.className = 'sr-only';
      caption.textContent = label;
    }
    table?.querySelectorAll('thead th').forEach(th => th.setAttribute('scope', 'col'));
  });
}

/** The text of the nearest heading before `el` (siblings first, then up the tree). */
function headingBefore(el: Element): string {
  for (let node: Element | null = el; node && node !== document.body; node = node.parentElement) {
    for (let prev = node.previousElementSibling; prev; prev = prev.previousElementSibling) {
      const h = prev.matches('h1, h2, h3') ? prev : prev.querySelector('h1, h2, h3');
      if (h) return h.textContent!.trim();
    }
  }
  return '';
}
