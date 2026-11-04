// /shop for the old app's router: what bananas buy. The wallet from economy.json, the signed-in visitor's head file
// (their badges and best plays) and their name from the core pack; their requests to the bot once the page is drawn
// (shop.mount.ts).

import { page } from '../client/page.ts';
import { store } from '../client/boot.ts';
import { signInHere } from '../client/legacy.ts';
import { readCore } from '../gen/packs.ts';
import { CORE } from '../routes.ts';
import { render, START, type Data, type Economy, type HeadFile } from '../views/shop.ts';
import { mount } from '../views/shop.mount.ts';

export default page<Data>({
  old: 'shop',
  load: async ctx => {
    // economy.json exists once the bot has started Bananas. The head file is the visitor's, which the edge can't know,
    // so it waits for meta.json; data from before head files has none, and then there's nothing to pick from.
    const headName = `players/${ctx.me}-head.json`;
    const [core, economy, head] = await Promise.all([
      store.pack(CORE, readCore),
      store.hasJson('economy.json').then(has => (has ? store.json<Economy>('economy.json') : null)).catch(() => null),
      ctx.me === null ? null : store.hasJson(headName).then(has => (has ? store.json<HeadFile>(headName) : null)).catch(() => null),
    ]);
    return { core, economy, head, signInHere: signInHere() };
  },
  title: ctx => ctx.t('Shop'),
  render: (ctx, data) => render(ctx, data, START),
  mount: (root, ctx, data, { isCurrent }) => mount(root, ctx, data, isCurrent),
});
