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
  label: string;
  active?: boolean;
}

/** A strip of links between sibling pages (real addresses, so not an ARIA tablist); `label` names the landmark. */
export const tabs = (items: Tab[], label: string): Safe => html`<nav class="tabs" aria-label="${label}">${items.map(tab =>
  html`<a href="${tab.href}" class="${tab.active ? 'active' : ''}" ${tab.active ? raw('aria-current="page"') : ''}>${tab.label}</a>`)}</nav>`;

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
