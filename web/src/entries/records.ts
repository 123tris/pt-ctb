// /records for the old app's router: from records.json and economy.json (when Bananas is on), players from the core
// pack. ?at=<section> scrolls to that section, as the old page does.

import { page } from '../client/page.ts';
import { store } from '../client/boot.ts';
import { readCore } from '../gen/packs.ts';
import { CORE } from '../routes.ts';
import { render, type Data, type Economy, type Records } from '../views/records.ts';

export default page<Data>({
  old: 'records',
  load: async () => {
    const [core, records, economy] = await Promise.all([
      store.pack(CORE, readCore),
      store.json<Records>('records.json'),
      store.hasJson('economy.json').then(has => (has ? store.json<Economy>('economy.json') : null)).catch(() => null),
    ]);
    return { core, records, economy };
  },
  title: ctx => ctx.t('Records'),
  render: (ctx, data) => render(ctx, data),
  mount: (root, _, __, { query }) => {
    if (query.at) root.querySelector(`#${CSS.escape(query.at)}`)?.scrollIntoView({ block: 'start' });
  },
});
