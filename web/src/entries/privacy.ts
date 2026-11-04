// /privacy for the old app's router. No data: the Discord invite is a setting, and whether this browser is counted is
// the browser's to say (track.js), both read here so the view stays pure.

import { page } from '../client/page.ts';
import { CONFIG, trackingBlock } from '../client/legacy.ts';
import { render, title, type Data } from '../views/privacy.ts';
import { mount } from '../views/privacy.mount.ts';

export default page<Data>({
  old: 'privacy',
  load: async () => ({ invite: CONFIG.discordInvite, block: trackingBlock() }),
  title: ctx => title(ctx),
  render: (ctx, data) => render(ctx, data),
  mount: (root, ctx) => mount(root, ctx),
});
