// / for the old app's router: the home page, from the core pack and the engine's home.json (packs.json lists both).

import { page } from '../client/page.ts';
import { store } from '../client/boot.ts';
import { CONFIG, openSearch, signInHere } from '../client/legacy.ts';
import { readCore } from '../gen/packs.ts';
import { CORE, HOME } from '../routes.ts';
import { render, type Data, type Home } from '../views/home.ts';

const decoder = new TextDecoder();

export default page<Data>({
  old: 'home',
  load: async () => {
    const [core, home] = await Promise.all([store.pack(CORE, readCore), store.pack(HOME, b => JSON.parse(decoder.decode(b)) as Home)]);
    return { core, home, invite: CONFIG.discordInvite ?? '', signIn: Boolean(signInHere()) };
  },
  // The site's own name, as the old page sets it (ui.js setTitle('')).
  title: () => '',
  render: (ctx, data) => render(ctx, data),
  mount: root => root.querySelector('[data-find]')?.addEventListener('click', openSearch),
});
