// /join (and /verify, which moved there) for the app's router. No data: the Discord invite is a setting.

import { page } from '../client/page.ts';
import { CONFIG } from '../client/config.ts';
import { render, title, type Data } from '../views/join.ts';

export default page<Data>({
  old: 'join',
  load: async () => ({ invite: CONFIG.discordInvite }),
  title: ctx => title(ctx),
  render: (ctx, data) => render(ctx, data),
});
