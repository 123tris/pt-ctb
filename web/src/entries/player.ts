// /player/:id/:tab? for the app's router: a profile, every tab. The player comes from the core pack; their file and
// the rest from the JSON the old page reads, when it reads them. Data without packs goes to the old page. A switch to
// another score list of the profile on the page redraws only the list, as the old page does.

import { page, type PageArgs } from '../client/page.ts';
import { store, clientCtx } from '../client/boot.ts';
import { prefs } from '../client/ui.ts';
import { signInHere } from '../client/bananas.ts';
import { NotFound } from '../kernel/store.ts';
import { readCore } from '../gen/packs.ts';
import { CORE } from '../routes.ts';
import { rowOf } from '../ui/players.ts';
import type { BadgeRecords } from '../ui/badges.ts';
import { needsAll, readState, render, title, type Data, type PlayerFile, type Bounties, type Economy, type History } from '../views/player.ts';
import { mount, switchList, lastFullFile } from '../views/player.mount.ts';

/** What the browser knows of the visitor: whether they left the pp chart open, and whether sign-in works here. */
const visitor = () => ({ chartOpen: Boolean(prefs.get('ppchart', false)), signInHere: signInHere() });

async function load(args: PageArgs, chartOpen: boolean): Promise<Data> {
  const id = Number(args.params.id);
  const core = store.pack(CORE, readCore);
  // The small head file shows the first page in the default order. A link straight to a search, sort, filter or later
  // page needs the whole file, as does data from before head files. A profile whose whole file this page has
  // already loaded keeps it.
  const loaded = lastFullFile(id);
  const headName = `players/${id}-head.json`;
  const fullName = `players/${id}.json`;
  const head = needsAll(args.query) || loaded ? null
    : store.hasJson(headName).then(has => (has ? store.json<PlayerFile>(headName) : null));
  const file = loaded ? Promise.resolve(loaded) : head ? head.then(h => h ?? store.json<PlayerFile>(fullName)) : store.json<PlayerFile>(fullName);
  // Records only feed the badges, which a head file brings already worked out.
  const records = (head ?? Promise.resolve(null)).then(h => (h ? null : store.json<BadgeRecords>('records.json').catch(() => null)));
  // bounties.json and economy.json are small and cached: the trophies list the bounties this player claimed, and
  // Bananas shows the wallet or pouch (economy.json exists once the bot has started Bananas).
  const bounties = store.json<Bounties>('bounties.json').catch(() => null);
  const economy = store.hasJson('economy.json').then(has => (has ? store.json<Economy>('economy.json') : null)).catch(() => null);
  // history.json is every player's history, and large: only when the chart is open from the start. A shut one loads
  // it when it's opened (player.mount.ts); one that fails here does the same.
  const history = chartOpen ? store.json<History>('history.json').catch(() => null) : Promise.resolve(null);
  const [c, f, r, b, e, h] = await Promise.all([core, file, records, bounties, economy, history]);
  const row = rowOf(c.players, id);
  // A player file for someone the players list doesn't have: as good as not there.
  if (row < 0) throw new NotFound(fullName);
  return { id, core: c, row, file: f, records: r, bounties: b, economy: e, history: h };
}

const draw = page<Data & { visitor: ReturnType<typeof visitor> }>({
  old: 'player',
  load: async (_, args) => {
    const seen = visitor();
    return { ...await load(args, seen.chartOpen), visitor: seen };
  },
  title: (_, data) => title(data),
  render: (ctx, data, { params, query }) => render(ctx, data, readState(params, query, data.visitor)),
  mount: (root, ctx, data, { params, query, isCurrent }) => mount(root, ctx, data, readState(params, query, data.visitor), isCurrent),
});

export default async function player(root: HTMLElement, args: PageArgs): Promise<void> {
  if (switchList(root, await clientCtx(), args)) return;
  return draw(root, args);
}
