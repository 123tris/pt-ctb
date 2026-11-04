// The browser's side of the kernel: the visitor's Ctx, and the data store, found through the slice of the manifests the
// page came with (edge/inline.ts), or the manifests themselves.

import { makeText, type Lang, type Table } from '../kernel/i18n.ts';
import { makeFmt } from '../kernel/fmt.ts';
import { Store, type Slice } from '../kernel/store.ts';
import type { Ctx } from '../kernel/ctx.ts';
import { CONFIG, lang, myId, portuguese, NotFound } from './legacy.ts';

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

export const store = new Store(data, pageSlice(), async name => {
  // meta.json revalidated every time, as the old app does (core/data.js); there's always one.
  const r = await fetch(`${data}${name}`, { cache: 'no-cache' });
  // No packs.json: data from before the packs. An empty manifest, kept, so the old pages stand in without asking again.
  if (r.status === 404 && name === 'packs.json') return { generatedAt: 0, files: {} };
  if (!r.ok) throw new Error(`${name} answered HTTP ${r.status}`);
  return r.json();
}, { notFound: name => new NotFound(name) });

let text: Promise<Ctx> | null = null;

/** The visitor's Ctx: their language, their clock, and whether they're signed in (checked each time). */
export async function clientCtx(): Promise<Ctx> {
  text ??= (async () => {
    const t = makeText(lang as Lang, lang === 'pt' ? (await portuguese()) as unknown as Table : {});
    const now = () => Date.now() / 1000;
    return { ...t, fmt: makeFmt(t, { now }), now, data, me: null };
  })();
  return { ...(await text), me: myId() };
}
