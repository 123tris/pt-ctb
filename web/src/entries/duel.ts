// /duel/:id for the old app's router: a duel's own page. Its players come from the core pack, the duel from its file
// (duels/<n>.json, a hundred duels each), which the old page reads too. An id that isn't a duel, or a file meta.json
// doesn't list, is the old router's "No such duel".

import { page } from '../client/page.ts';
import { store } from '../client/boot.ts';
import { NotFound } from '../client/legacy.ts';
import { readCore } from '../gen/packs.ts';
import { duelFile } from '../kernel/model.ts';
import { CORE } from '../routes.ts';
import type { DuelPage } from '../ui/duels.ts';
import { render, title, type Data } from '../views/duel.ts';

export default page<Data>({
  old: 'duel',
  load: async (_, { params }) => {
    const id = Number(params.id);
    if (!Number.isSafeInteger(id) || id <= 0) throw new NotFound(`duel ${params.id}`);
    const name = duelFile(id);
    const [core, file] = await Promise.all([
      store.pack(CORE, readCore),
      store.hasJson(name).then(has => (has ? store.json<DuelPage>(name) : null)),
    ]);
    if (!file?.duels[id]) throw new NotFound(name);
    return { core, duel: file.duels[id], maps: file.maps };
  },
  title: (ctx, data) => title(ctx, data),
  render: (ctx, data) => render(ctx, data),
});
