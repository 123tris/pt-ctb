// /games/:game? for the app's router: the hub and Higher or lower over the core pack, Guess the map from quiz.json
// (or, signed in, the paying daily from the site's endpoint), the map quizzes from the header search's maps. Each
// game's first state is made before it's drawn (games.mount.ts start…()), so render() draws its first view whole.

import { page } from '../client/page.ts';
import { store } from '../client/boot.ts';
import { readCore } from '../gen/packs.ts';
import { CORE } from '../routes.ts';
import { gameOf, quizMode, render, title, type Data, type MapRow, type Quiz } from '../views/games.ts';
import { mount, startDaily, startHilo, startHub, startPaid, startPractice, startQuiz } from '../views/games.mount.ts';
// Pure, with no imports: the header search's own decoders (client/search.ts), bundled in like the client's own code.
import { decodeMapsSearch, decodeSearchMaps } from '../../../assets/js/core/maps-search.js';

/**
 * The maps the quizzes ask about, as the old page read them: the header search's index (search-maps.json, the maps two
 * or more players here have played: under half the size of the search pack, and often in the cache already). Data
 * from before that file, or from before it had the category, takes the whole index (maps-search.json).
 */
async function quizMaps(): Promise<MapRow[]> {
  const rows: MapRow[] | null = (await store.hasJson('search-maps.json'))
    ? decodeSearchMaps(await store.json('search-maps.json'))
    : null;
  return rows && !(rows.length && !rows[0][6]) ? rows : decodeMapsSearch(await store.json('maps-search.json'));
}

export default page<Data>({
  old: 'games',
  load: async (_, { params, query }) => {
    switch (gameOf(params, query)) {
      case 'hub': return startHub(await store.pack(CORE, readCore));
      case 'daily': return (await startPaid()) ?? startDaily(await store.json<Quiz>('quiz.json'));
      case 'practice': return startPractice(await store.json<Quiz>('quiz.json'));
      case 'quiz': return startQuiz(await quizMaps(), quizMode(query));
      case 'hilo': return startHilo(await store.pack(CORE, readCore));
    }
  },
  title: (ctx, data) => title(ctx, data),
  render: (ctx, data) => render(ctx, data),
  mount: (root, ctx, data, { isCurrent }) => mount(root, ctx, data, isCurrent),
});
