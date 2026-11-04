// /games/:game? for the old app's router: the hub and Higher or lower over the core pack, Guess the map from quiz.json
// (or, signed in, the paying daily from the site's endpoint), the map quizzes from the search pack. Each game's first
// state is made before it's drawn (games.mount.ts start…()), so render() draws its first view whole.

import { page } from '../client/page.ts';
import { store } from '../client/boot.ts';
import { readCore, readSearch } from '../gen/packs.ts';
import { CORE, SEARCH } from '../routes.ts';
import { gameOf, quizMode, render, title, type Data, type Quiz } from '../views/games.ts';
import { mount, startDaily, startHilo, startHub, startPaid, startPractice, startQuiz } from '../views/games.mount.ts';

export default page<Data>({
  old: 'games',
  load: async (_, { params, query }) => {
    switch (gameOf(params, query)) {
      case 'hub': return startHub(await store.pack(CORE, readCore));
      case 'daily': return (await startPaid()) ?? startDaily(await store.json<Quiz>('quiz.json'));
      case 'practice': return startPractice(await store.json<Quiz>('quiz.json'));
      case 'quiz': return startQuiz(await store.pack(SEARCH, readSearch), quizMode(query));
      case 'hilo': return startHilo(await store.pack(CORE, readCore));
    }
  },
  title: (ctx, data) => title(ctx, data),
  render: (ctx, data) => render(ctx, data),
  mount: (root, ctx, data, { isCurrent }) => mount(root, ctx, data, isCurrent),
});
