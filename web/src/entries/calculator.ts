// /calculator for the old app's router: the pp calculator and "What if…?", from the core pack, the linked map's bucket
// and, for the "What if", the picked player's pack.

import { page } from '../client/page.ts';
import { store } from '../client/boot.ts';
import { NotFound } from '../client/legacy.ts';
import { readCore } from '../gen/packs.ts';
import { CORE, mapBucket } from '../routes.ts';
import type { MapMeta } from '../ui/maps.ts';
import { render, type Data } from '../views/calculator.ts';
import { mount } from '../views/calculator.mount.ts';

/** A map's details from its bucket ({ id: { m: map tuple, … } }), or null for a map the data doesn't have. */
async function mapMeta(id: number): Promise<MapMeta> {
  const bucket: Record<string, { m?: MapMeta }> = await store.json<Record<string, { m?: MapMeta }>>(mapBucket(id))
    .catch(e => (e instanceof NotFound ? {} : Promise.reject(e)));
  return bucket[id]?.m ?? null;
}

export default page<Data>({
  old: 'calculator',
  load: async (_, { query }) => {
    const mapId = Number(query.map) || null;
    const [core, meta] = await Promise.all([store.pack(CORE, readCore), mapId ? mapMeta(mapId) : null]);
    return { core, mapId, meta };
  },
  title: ctx => ctx.t('Calculator'),
  render: (ctx, data) => render(ctx, data),
  mount: (root, ctx, data, { isCurrent }) => mount(root, ctx, data, isCurrent),
});
