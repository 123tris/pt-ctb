// A Top 10 page for the app's router, as client/page.ts's page() makes one: load, title, render, mount. With the Top 10
// stylesheet (ui/top10-style.ts) put in once, and, as there's no old page for any of it, a notice instead of one when
// the data has no packs yet.

import type { Ctx } from '../kernel/ctx.ts';
import type { Safe } from '../kernel/html.ts';
import { html } from '../kernel/html.ts';
import { clientCtx } from './boot.ts';
import { setTitle } from './ui.ts';
import type { PageArgs, RouterPage } from './page.ts';
import { PacksMissing } from '../kernel/store.ts';
import { PackMismatch } from '../kernel/ptcb.ts';
import { empty } from '../ui/page.ts';
import { injectStyle } from '../ui/top10-style.ts';

/** A Top 10 page: its data, title, markup and wiring, as client/page.ts's page() has them. */
export interface Spec<D> {
  load(ctx: Ctx, args: PageArgs): Promise<D>;
  title(ctx: Ctx, data: D): string;
  render(ctx: Ctx, data: D, args: PageArgs): Safe;
  mount?(root: HTMLElement, ctx: Ctx, data: D, args: PageArgs): void;
}

/** A page for the router, with a notice instead of an old page when the data has no packs yet. */
export function top10Page<D>(spec: Spec<D>): RouterPage {
  return async (root, args) => {
    injectStyle();
    const ctx = await clientCtx();
    let data: D;
    try {
      data = await spec.load(ctx, args);
    } catch (e) {
      if (!(e instanceof PacksMissing || e instanceof PackMismatch)) throw e;
      if (!args.isCurrent()) return;
      setTitle(ctx.t('Top 10'));
      root.innerHTML = String(empty(html`<h1>${ctx.t('Top 10')}</h1><p>${ctx.t('Top 10 needs the site’s new data files, which this copy doesn’t have yet.')}</p>`));
      return;
    }
    if (!args.isCurrent()) return;
    setTitle(spec.title(ctx, data));
    root.innerHTML = String(spec.render(ctx, data, args));
    spec.mount?.(root, ctx, data, args);
  };
}
