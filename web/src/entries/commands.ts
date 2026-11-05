// /commands for the app's router: the bot's own list (commands.json), or the hand-written one when the data has
// none or it can't be read, as the old page does. No packs, so the old page never has to stand in.

import { page } from '../client/page.ts';
import { store } from '../client/boot.ts';
import { render, title, type CommandsFile, type Data } from '../views/commands.ts';

/** commands.json when the export lists it, or null: the bot writes it on start, so older data has none. */
async function commandsFile(): Promise<CommandsFile | null> {
  try {
    if (await store.hasJson('commands.json')) return await store.json<CommandsFile>('commands.json');
  } catch { /* the hand-written list */ }
  return null;
}

export default page<Data>({
  old: 'commands',
  load: async () => ({ file: await commandsFile() }),
  title: ctx => title(ctx),
  render: (ctx, data) => render(ctx, data),
});
