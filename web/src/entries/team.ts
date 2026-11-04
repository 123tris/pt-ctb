// /team for the old app's router. No data: the page is the community's lore.

import { page } from '../client/page.ts';
import { render, title } from '../views/team.ts';

export default page({
  old: 'team',
  load: async () => ({}),
  title: ctx => title(ctx),
  render: ctx => render(ctx),
});
