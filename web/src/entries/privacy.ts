// /privacy for the app's router. No data: the Discord invite is a setting, and whether this browser is counted is
// the browser's to say (client/track.ts), both read here so the view stays pure.

import { page } from '../client/page.ts';
import { CONFIG } from '../client/config.ts';
import { trackingBlock } from '../client/track.ts';
import { render, title, type Data } from '../views/privacy.ts';
import { mount } from '../views/privacy.mount.ts';

export default page<Data>({
  old: 'privacy',
  load: async () => ({ invite: CONFIG.discordInvite, block: trackingBlock() }),
  title: ctx => title(ctx),
  render: (ctx, data) => render(ctx, data),
  mount: (root, ctx) => mount(root, ctx),
});
