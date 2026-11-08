// A page of the new client, as the app's router loads pages (app.ts; the old router, assets/js/app.js, loads them the
// same way): page(root, { params, query, isCurrent }). Each entry (entries/) is one of these: it loads the page's data
// from the store, draws it with the view's pure render(), and wires it up with mount(). When the data can't be drawn by
// this code (no packs yet, or packs of another layout), or the view doesn't cover what's asked (a tab not ported yet),
// the old page draws it instead.

import type { Safe } from '../kernel/html.ts';
import type { Ctx } from '../kernel/ctx.ts';
import { PacksMissing } from '../kernel/store.ts';
import { PackMismatch } from '../kernel/ptcb.ts';
import { clientCtx } from './boot.ts';
import { setTitle } from './ui.ts';
// Every page reaches the app's shell too, though it calls none of it: esbuild then puts the shell and everything the
// pages share with it in one chunk, which app.js loads at once, instead of one chunk per set of pages that share a
// module (tools/web-build.mjs).
import './shell.ts';

export interface PageArgs {
  params: Record<string, string | undefined>;
  query: Record<string, string | undefined>;
  isCurrent(): boolean;
}

export type RouterPage = (root: HTMLElement, args: PageArgs) => Promise<void>;

export interface PageSpec<D> {
  /** The old page (assets/js/pages/<old>.js) that stands in. */
  old: string;
  /** Loads what the page shows (from `store`), or null to hand this address to the old page. */
  load(ctx: Ctx, args: PageArgs): Promise<D | null>;
  title(ctx: Ctx, data: D, args: PageArgs): string;
  /** The whole page, pure (the edge can draw it too). */
  render(ctx: Ctx, data: D, args: PageArgs): Safe;
  /**
   * The browser-only part: events, focus, anything that reads or changes the page after it's drawn. `before` is what
   * `keep` took from the page that was there (to tell a move within the page from a new visit).
   */
  mount?(root: HTMLElement, ctx: Ctx, data: D, args: PageArgs, before: string | undefined): void;
  /** Reads something off the page about to be replaced, for mount(). */
  keep?(root: HTMLElement): string | undefined;
}

/**
 * An old page module (assets/js/pages/<name>.js), for what the new client doesn't draw. Found from this module's own
 * address (assets/web/…), with its ?v= version, which is the one the old site's modules have: the same address is the
 * same module, so an old page shares the state of any other old module already loaded.
 */
export function oldPage(name: string): Promise<RouterPage> {
  const here = new URL(import.meta.url);
  return import(/* @vite-ignore */ new URL(`../js/pages/${name}.js${here.search}`, here).href).then(m => m.default);
}

/** A page for the router. */
export function page<D>(spec: PageSpec<D>): RouterPage {
  return async (root, args) => {
    const ctx = await clientCtx();
    let data: D | null;
    try {
      data = await spec.load(ctx, args);
    } catch (e) {
      // Data the new client can't read (yet): the old page, from the JSON. Anything else (not found, offline) is the
      // router's to show, as for its own pages.
      if (!(e instanceof PacksMissing || e instanceof PackMismatch)) throw e;
      console.warn(`${spec.old}: the old page, from the JSON:`, e);
      data = null;
    }
    if (!args.isCurrent()) return;
    if (data === null) return (await oldPage(spec.old))(root, args);
    const before = spec.keep?.(root);
    setTitle(spec.title(ctx, data, args));
    root.innerHTML = String(spec.render(ctx, data, args));
    spec.mount?.(root, ctx, data, args, before);
  };
}
