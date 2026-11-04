// The browser's side of the kernel: the visitor's Ctx, and the packs, found through the slice of packs.json the page
// came with (edge/inline.ts) or packs.json itself.

import { makeText, type Lang, type Table } from '../kernel/i18n.ts';
import { makeFmt } from '../kernel/fmt.ts';
import { Packs, type Manifest } from '../kernel/packs.ts';
import type { Ctx } from '../kernel/ctx.ts';
import { CONFIG, lang, myId, portuguese } from './legacy.ts';

/** Where the data is, as an absolute address (CONFIG.data is data/ with npm run serve -- --local-data). */
const data: string = new URL(CONFIG.data, `${location.origin}/`).href;

/** The page's slice of packs.json, when the edge put one in (a <script type="application/json">). */
function pageSlice(): Manifest | null {
  try {
    const m = JSON.parse(document.getElementById('ptc-packs')?.textContent ?? 'null');
    return m && typeof m.generatedAt === 'number' && m.files && typeof m.files === 'object' ? m : null;
  } catch {
    return null;
  }
}

export const packs = new Packs(data, pageSlice(), async () => {
  const r = await fetch(`${data}packs.json`, { cache: 'no-cache' });
  // No packs.json: data from before the packs. An empty manifest, kept, so the old pages stand in without asking again.
  if (r.status === 404) return { generatedAt: 0, files: {} };
  if (!r.ok) throw new Error(`packs.json answered HTTP ${r.status}`);
  return r.json();
});

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
