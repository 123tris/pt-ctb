// /rankings/:board? for the old app's router (assets/js/app.js loads it as a page: page(root, { params, query,
// isCurrent })). Converts, Loved and Ranked are drawn from the core pack; the other tabs, and data without packs, go to
// the old page.

import { packs, clientCtx } from '../client/boot.ts';
import { oldRankings, setTitle } from '../client/legacy.ts';
import { readCore } from '../gen/packs.ts';
import { firstPacks } from '../routes.ts';
import { BOARD_CAT, readState, render, title, type Slug } from '../views/rankings.ts';
import { mount } from '../views/rankings.mount.ts';

interface Page {
  params: Record<string, string | undefined>;
  query: Record<string, string | undefined>;
  isCurrent(): boolean;
}

export default async function rankings(root: HTMLElement, page: Page): Promise<void> {
  const board = page.params.board;
  if (!firstPacks(`/rankings/${board ?? ''}`)) return (await oldRankings())(root, page);
  // An unknown board shows the first, as the old page does.
  const slug: Slug = board && board in BOARD_CAT ? board as Slug : 'converts';
  let core;
  try {
    core = await packs.load('packs/core.ptcb', readCore);
  } catch (e) {
    // No packs in this data yet, or another layout than this code reads: the old page, from the JSON.
    console.warn('Leaderboards from the JSON:', e);
    return (await oldRankings())(root, page);
  }
  const ctx = await clientCtx();
  if (!page.isCurrent()) return;
  const state = readState(slug, page.query);
  setTitle(title(ctx, slug));
  root.innerHTML = String(render(ctx, core, state));
  mount(root, ctx, core, state);
}
