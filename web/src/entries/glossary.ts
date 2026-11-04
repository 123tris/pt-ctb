// /glossary for the old app's router. No data.

import { page } from '../client/page.ts';
import { readState, render, title } from '../views/glossary.ts';
import { mount } from '../views/glossary.mount.ts';

export default page({
  old: 'glossary',
  load: async () => ({}),
  title: ctx => title(ctx),
  render: (ctx, _, { query }) => render(ctx, readState(query)),
  mount: (root, _ctx, _data, { query }) => mount(root, readState(query)),
});
