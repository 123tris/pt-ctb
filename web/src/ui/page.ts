// A page's parts, as assets/js/core/ui.js draws them: heading, tabs, empty states, result counts, tables.

import { html, raw, type Safe, type Value } from '../kernel/html.ts';
import type { Ctx } from '../kernel/ctx.ts';

export const pageHead = ({ title, intro, extra }: { title: string; intro?: Value; extra?: Value }): Safe => html`<header class="page-head">
  <h1>${title}</h1>
  ${intro ? html`<p>${intro}</p>` : ''}
  ${extra ?? ''}
</header>`;

export interface Tab {
  href: string;
  /** The tab's name: text, or markup (a tag beside the name). */
  label: Value;
  active?: boolean;
  /** A figure after the label, already formatted: a count (ctx.fmt.num), or a short text ("2d left", "79.3%"). */
  count?: string;
}

/**
 * A strip of links between sibling pages (real addresses, so not an ARIA tablist); `label` names the landmark. A hidden
 * comma keeps a tab's count apart from its name when read out ("Snipe targets, 30", not "Snipe targets30").
 */
export const tabs = (items: Tab[], label: string): Safe => html`<nav class="tabs" aria-label="${label}">${items.map(tab =>
  html`<a href="${tab.href}" class="${tab.active ? 'active' : ''}" ${tab.active ? raw('aria-current="page"') : ''}>${tab.label}${tab.count !== undefined
    ? html`<span class="count"><span class="sr-only">, </span>${tab.count}</span>` : ''}</a>`)}</nav>`;

export const empty = (text: Value): Safe => html`<div class="empty">${text}</div>`;

/** An empty result after filtering, with a way back: the page handles clicks on [data-clear]. */
export const emptyFiltered = (ctx: Ctx, text: string): Safe =>
  html`<div class="empty"><p>${text}</p><button class="btn btn-small" type="button" data-clear>${ctx.t('Clear filters')}</button></div>`;

/** "12 of 53,734 maps", or "53,734 maps" when nothing is filtered out. */
export const resultCount = (ctx: Ctx, shown: number, total: number, one: string, many = `${one}s`): string =>
  (shown === total ? ctx.fmt.plural(total, one, many) : ctx.t('{shown} of {total}', { shown: ctx.fmt.num(shown), total: ctx.fmt.plural(total, one, many) }));

/**
 * A data table in its labelled, focusable scroll box, with a caption and column scopes: what ui.js's enhanceTables
 * adds after the fact, written in, so a table is complete the moment it's drawn (and marked done for enhanceTables).
 */
export const dataTable = (label: string, head: Value, body: Value, cls = ''): Safe => html`<div class="table-wrap${cls ? ` ${cls}` : ''}" data-label="${label}" data-ok role="region" aria-label="${label}" tabindex="0"><table>
    <caption class="sr-only">${label}</caption>
    <thead><tr>${head}</tr></thead>
    <tbody>${body}</tbody>
  </table></div>`;

/** A column heading for dataTable(). */
export const col = (text: Value, cls = ''): Safe => html`<th${cls ? html` class="${cls}"` : ''} scope="col">${text}</th>`;

/** A headline figure: label, value and an optional line under it. */
export const stat = (label: Value, value: Value, sub: Value = '', cls = ''): Safe =>
  html`<div class="stat ${cls}"><div class="stat-label">${label}</div><div class="stat-value"><span class="stat-fit">${value}</span></div>${sub ? html`<div class="stat-sub">${sub}</div>` : ''}</div>`;

/**
 * A labelled row of toggle chips: `items` = [[value, label]]. Each chip is a button with aria-pressed, and the visible
 * label names the group. client/dom.ts setPressed() updates the state.
 */
export const chipGroup = (label: string, attr: string, items: [string, Value][], current: string): Safe => html`<div class="chips" role="group" aria-label="${label}">
  <span class="chips-label" aria-hidden="true">${label}</span>
  ${items.map(([value, text]) => html`<button class="chip ${value === current ? 'active' : ''}" type="button" data-${raw(attr)}="${value}" aria-pressed="${String(value === current)}">${text}</button>`)}
</div>`;

/** How many pages `n` items take at `size` a page: one at least, for the empty list. */
export const pageCount = (n: number, size: number): number => Math.max(1, Math.ceil(n / size));

/**
 * One page of `items` (`page`, 0-based, kept within the list) and the previous/next pager under it: what
 * client/dom.ts paginate() draws on each page, so a view can draw the address's page itself and paginate() take over.
 * `render(slice, offset)` gives the page's markup; `empty()` what to show when there's nothing.
 */
export function paged<T>(ctx: Ctx, items: readonly T[], render: (slice: readonly T[], offset: number) => Value,
  { size = 50, page = 0, empty: emptyView }: { size?: number; page?: number; empty?: () => Value } = {}): Safe {
  const { t, fmt } = ctx;
  const pages = pageCount(items.length, size);
  page = Math.min(Math.max(0, page), pages - 1);
  const slice = items.slice(page * size, page * size + size);
  return html`${slice.length ? render(slice, page * size) : emptyView?.() ?? empty(t('Nothing to show.'))}
      ${pages > 1 ? html`<nav class="pager" aria-label="${t('Pages')}">
        <button class="btn btn-small" type="button" data-page="prev" ${page === 0 ? raw('disabled') : ''}>← ${t('Previous')}</button>
        <span>${t('Page {page} of {pages}', { page: fmt.num(page + 1), pages: fmt.num(pages) })}</span>
        <button class="btn btn-small" type="button" data-page="next" ${page >= pages - 1 ? raw('disabled') : ''}>${t('Next')}</button>
      </nav>` : ''}`;
}

/** Grey rows the height of real ones, while a list loads. */
export const placeholderRows = (n = 6): Safe =>
  html`<div class="rows rows-placeholder" aria-hidden="true">${Array.from({ length: Math.min(n, 50) }, () => html`<div class="row row-placeholder"></div>`)}</div>`;

/**
 * In-joke badges or map tags ({ name, tip }), each a toggle button whose tip shows under the row (ui.js has the one
 * listener for every row on the site). `show` keeps the row short: the rest behind "+N more".
 */
export const funChips = (ctx: Ctx, list: { name: string; tip: string }[], cls = '', { show = Infinity } = {}): Safe | '' => (list.length
  ? html`<div class="fun-chips-wrap ${cls}">
      <div class="fun-chips">${list.map((b, i) => html`<button class="fun-chip" type="button" aria-pressed="false" data-tip="${b.tip}" ${i >= show ? 'hidden' : ''}>${b.name}</button>`)}${list.length > show
        ? html`<button class="fun-chip fun-more" type="button" data-track="more badges">${ctx.t('+{n} more', { n: list.length - show })}</button>` : ''}</div>
      <p class="fun-tip" role="status" hidden></p>
    </div>`
  : '');
