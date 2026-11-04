// Rendering a page at the edge ("ssr" mode), for the pages whose first view is drawn from packs alone. Off for now:
// tools/edge-bench.mjs measures the CPU it takes, and Cloudflare's free plan ends a request outright past 10 ms of CPU
// (error 1102, which can't be caught). The page goes out in "inline" mode (inline.ts) until a route's measured cost,
// three times over for slower machines and cold starts, fits the budget.

import { makeText, type Lang, type Table } from '../src/kernel/i18n.ts';
import { makeFmt } from '../src/kernel/fmt.ts';
import type { Ctx } from '../src/kernel/ctx.ts';
import { readCore } from '../src/gen/packs.ts';
import { BOARD_CAT, readState, render, type Slug } from '../src/views/rankings.ts';

/** A Ctx at the edge: no visitor's clock or zone, so the data's time and Lisbon's, and nobody signed in. */
export function edgeCtx(lang: Lang, table: Table, generatedAt: number, data: string): Ctx {
  const text = makeText(lang, table);
  const now = () => generatedAt;
  return { ...text, fmt: makeFmt(text, { timeZone: 'Europe/Lisbon', now }), now, data, me: null };
}

/** The leaderboards' first view, as the browser would draw it, from the core pack's bytes. */
export function renderRankings(ctx: Ctx, core: ArrayBuffer, board: string | undefined, query: Record<string, string>): string {
  const slug: Slug = board && board in BOARD_CAT ? board as Slug : 'converts';
  return String(render(ctx, readCore(core), readState(slug, query)));
}
