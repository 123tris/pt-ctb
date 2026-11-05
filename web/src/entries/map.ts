// /map/:id for the app's router: a map's page. The map and its board come from its bucket, the players from the
// core pack, and the rest from the JSON the old page reads, when it reads it: bounties.json and meta.json's brief week
// and hill for the chips, the set's file for the difficulties, and dan.json and challenges.json only for a map the
// bucket doesn't have. Data without packs goes to the old page.

import { page } from '../client/page.ts';
import { store } from '../client/boot.ts';
import { NotFound } from '../kernel/store.ts';
import { readCore } from '../gen/packs.ts';
import { M } from '../kernel/model.ts';
import type { Manifest } from '../kernel/store.ts';
import { CORE, mapBucket } from '../routes.ts';
import type { MapMeta } from '../ui/maps.ts';
import { render, title, type Data, type Bucket, type Bounties, type Diff, type SiteBrief } from '../views/map.ts';
import { mount } from '../views/map.mount.ts';

/** dan.json's stages, each with its map and the map's details. */
interface Dan {
  stages: { map: number; meta: MapMeta }[];
}

/**
 * The details of a map nobody here has played: challenge suggestions, bounties, pool maps and unplayed Dan stages have
 * them in their own files. challenges.json only comes if it's needed. A missing dan.json is the router's "not
 * found", as on the old page.
 */
async function otherMeta(id: number, site: SiteBrief, bounties: Bounties | null): Promise<MapMeta> {
  return bounties?.maps[id] ?? site.hill?.maps[id]
    ?? (await store.json<Dan>('dan.json')).stages.find(stage => stage.map === id)?.meta
    ?? (await store.json<{ maps: Record<string, MapMeta> }>('challenges.json').catch(() => null))?.maps[id] ?? null;
}

/**
 * A set's difficulties ([map, version, stars, players], easiest first), or null for a set with one, or data from before
 * sets/ (then the page shows no switcher), as assets/js/core/data.js mapSet.
 */
async function mapSet(set: number): Promise<readonly Diff[] | null> {
  const name = `sets/${set % 128}.json`;
  return (await store.hasJson(name)) ? (await store.json<Record<string, Diff[]>>(name))[set] ?? null : null;
}

export default page<Data>({
  old: 'map',
  load: async (_, { params }) => {
    const id = Number(params.id);
    // The challenges running now, for the chips under the title: bounties.json is small and cached, and meta.json (the
    // manifest the store already has) holds the map of the week and King of the hill's month in brief. A missing or
    // broken bounties.json only means fewer chips.
    const [core, bucket, bounties, site] = await Promise.all([
      store.pack(CORE, readCore),
      store.json<Bucket>(mapBucket(id)).catch(e => (e instanceof NotFound ? {} as Bucket : Promise.reject(e))),
      store.json<Bounties>('bounties.json').catch(() => null),
      store.manifest('meta.json').then(m => m as Manifest & SiteBrief),
    ]);
    const entry = bucket[id] ?? null;
    const meta = entry?.m ?? await otherMeta(id, site, bounties);
    // The set's difficulties, when the data has them (sets/ came after the map files) and they include this one.
    const set = meta?.[M.SET] ? await mapSet(meta[M.SET]).catch(() => null) : null;
    return { id, core, entry, meta, diffs: set?.some(d => d[0] === id) ? set : null, bounties, site };
  },
  title: (ctx, data) => title(ctx, data),
  render: (ctx, data) => render(ctx, data),
  mount: root => mount(root),
});
