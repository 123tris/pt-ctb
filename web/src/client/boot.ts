// The browser's side of the kernel: the visitor's Ctx, and the data store, found through the slice of the manifests the
// page came with (edge/inline.ts), or the manifests themselves.

import { makeFmt } from '../kernel/fmt.ts';
import { Store, type Manifest, type Slice } from '../kernel/store.ts';
import type { Ctx } from '../kernel/ctx.ts';
import { CONFIG } from './config.ts';
import { loadText } from './i18n.ts';
import { myId } from './ui.ts';

/** Where the data is, as an absolute address (CONFIG.data is data/ with npm run serve -- --local-data). */
const data: string = new URL(CONFIG.data, `${location.origin}/`).href;

/** The page's slice of packs.json and meta.json, when the edge put one in (a <script type="application/json">). */
function pageSlice(): Slice | null {
  try {
    const s = JSON.parse(document.getElementById('ptc-data')?.textContent ?? 'null');
    const ok = (m?: { generatedAt?: unknown; files?: unknown }) => m === undefined || (typeof m?.generatedAt === 'number' && typeof m.files === 'object');
    return s && typeof s === 'object' && ok(s.packs) && ok(s.meta) ? s : null;
  } catch {
    return null;
  }
}

/** The meta.json request index.html started before any code loaded (tools/build-site.mjs), for this data. */
const early = (globalThis as { ptctbEarly?: { data: string; meta: Promise<Manifest | null> } }).ptctbEarly;

export const store = new Store(data, pageSlice(), async name => {
  if (name === 'meta.json' && early?.data === CONFIG.data) {
    const m = await early.meta;
    if (m) return m;
  }
  // meta.json revalidated every time, as the old app does (core/data.js); there's always one.
  const r = await fetch(`${data}${name}`, { cache: 'no-cache' });
  // No packs.json: data from before the packs. An empty manifest, kept, so the old pages stand in without asking again.
  if (r.status === 404 && name === 'packs.json') return { generatedAt: 0, files: {} };
  if (!r.ok) throw new Error(`${name} answered HTTP ${r.status}`);
  return r.json();
});

let ctx: Promise<Ctx> | null = null;

/** The visitor's Ctx: their language, their clock, and whether they're signed in (checked each time). */
export async function clientCtx(): Promise<Ctx> {
  ctx ??= loadText().then(t => {
    const now = () => Date.now() / 1000;
    return { ...t, fmt: makeFmt(t, { now }), now, data, me: null };
  });
  return { ...(await ctx), me: myId() };
}
