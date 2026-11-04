// The Games page's browser half (games.ts draws it), as assets/js/pages/games.js plays: the start…() functions make a
// game's first state before render() draws it (they throw the dice, read this browser's records, and ask the site for
// the paying daily), then mount() plays it, redrawing with games.ts as it goes. Records are kept in this browser
// (prefs), results counted (track), and "Copy result" puts a line on the clipboard.

import type { Ctx } from '../kernel/ctx.ts';
import type { CorePack, SearchPack } from '../gen/packs.ts';
import { coverUrl } from '../ui/maps.ts';
import { api, prefs, session, signInHere, toast, track, wysi } from '../client/legacy.ts';
import {
  BLUR, ROUNDS, blurFilter, dailyRecord, dailyRound, dailyShare, dailyView, hiloRight, hiloRound, hiloShare, hiloValue,
  hiloView, lisbonDay, optionButtons, paidView, playedToday, practiceDeck, practiceResult, practiceReveal, practiceShare,
  quizAnswer, quizDeck, quizResult, quizView, roundOptions, specialLabel,
  type Daily, type DailyRecord, type Data, type Hilo, type Hub, type Paid, type PaidDay, type Practice, type Quiz,
  type QuizGame, type QuizMode,
} from './games.ts';

const NO_RECORD: DailyRecord = { last: null, streak: 0, best: 0, result: null };
const DAY_MS = 86400000;

// ---- Starting a game ------------------------------------------------------------------------------------------

export const startHub = (core: CorePack): Hub => ({
  game: 'hub',
  core,
  records: {
    guessBest: prefs.get('guess-best', null), hiloBest: prefs.get('hilo-best', null), daily: prefs.get('daily', null),
    quizBest: prefs.get('quiz-best', null),
  },
});

/** Keeps the daily streak the hub shows, for either daily game; `tried` is the try it was solved on, 0 for missed. */
function noteDaily(today: string, tried: number): number {
  const record = dailyRecord(prefs.get('daily', NO_RECORD), today, lisbonDay(Date.now() - DAY_MS), tried);
  prefs.set('daily', record);
  return record.streak;
}

/**
 * The paying daily, for a visitor signed in with osu!: today's game as far as they've got. Null when the site can't
 * run it here (signed out, or the endpoint refuses), and the free daily runs instead.
 */
export async function startPaid(): Promise<Paid | null> {
  if (!session()) return null;
  const res = await api('/api/daily');
  if (!res.ok) return null;
  const day = res.body as PaidDay;
  // A game already over (played earlier today, maybe on another device) still counts for this browser's streak.
  if (day.done) noteDaily(day.day, day.solved ? day.tries : 0);
  return { game: 'paid', day, streak: prefs.get('daily', { streak: 0 }).streak };
}

export function startDaily({ sets }: Quiz): Daily {
  const now = Date.now();
  const today = lisbonDay(now);
  return {
    game: 'daily', today, yesterday: lisbonDay(now - DAY_MS), ...dailyRound(sets, today, Math.random),
    saved: prefs.get('daily', NO_RECORD), signInHere: signInHere(),
  };
}

export function startPractice({ sets }: Quiz): Practice {
  if (sets.length < 4) return { game: 'practice', deck: [], special: new Map(), options: [] };
  // "Eu estou aqui" sneaks in as a bonus round once per browser session.
  let tugaShown = false;
  try {
    tugaShown = sessionStorage.getItem('ptctb:tuga') === '1';
    sessionStorage.setItem('ptctb:tuga', '1');
  } catch { /* private mode */ }
  const { deck, special } = practiceDeck(sets, tugaShown, Math.random);
  return { game: 'practice', deck, special, options: roundOptions(deck, deck[0], Math.random) };
}

export const startQuiz = (search: SearchPack, mode: QuizMode): QuizGame =>
  ({ game: 'quiz', mode, deck: quizDeck(search, mode, Math.random) });

export const startHilo = (core: CorePack): Hilo =>
  ({ game: 'hilo', core, round: hiloRound(core.players, null, Math.random), best: prefs.get('hilo-best', 0) });

// ---- Playing ------------------------------------------------------------------------------------------------

/** Wires "Copy result" (#share), if the page has one, to put `text` on the clipboard. */
function copyButton(root: HTMLElement, { t }: Ctx, text: string): void {
  const button = root.querySelector<HTMLElement>('#share');
  button?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(text);
      button.textContent = t('Copied!');
    } catch {
      button.textContent = t('Couldn’t copy');
    }
  });
}

/** The free daily: three tries, the cover a little sharper after each miss. */
function playDaily(root: HTMLElement, ctx: Ctx, d: Daily, isCurrent: () => boolean): void {
  const already = playedToday(d);
  if (already !== null) {
    copyButton(root, ctx, dailyShare(ctx, d.today, already, d.saved.streak));
    return;
  }
  let tries = 0;
  const finish = (tried: number) => {
    const record = dailyRecord(d.saved, d.today, d.yesterday, tried);
    prefs.set('daily', record);
    track('game', 'daily', tried > 0 ? 'solved' : 'missed', '', tried);
    root.innerHTML = String(dailyView(ctx, d, tries, { tried, streak: record.streak }));
    copyButton(root, ctx, dailyShare(ctx, d.today, tried, record.streak));
  };
  // Listen on the options list, which the last draw replaces, so nothing leaks onto other pages.
  root.querySelector('#options')!.addEventListener('click', e => {
    const button = (e.target as Element).closest<HTMLButtonElement>('[data-i]');
    if (!button || button.disabled || !isCurrent()) return;
    tries++;
    if (d.options[Number(button.dataset.i)] === d.answer) { finish(tries); return; }
    button.disabled = true;
    button.classList.add('wrong');
    if (tries >= 3) { finish(0); return; }
    root.querySelector<HTMLElement>('#cover')!.style.filter = blurFilter(tries);
    root.querySelector('.scoreboard b')!.textContent = String(3 - tries);
  });
}

/** The paying daily: each guess goes to the site, which answers with the game as it now stands. */
function playPaid(root: HTMLElement, ctx: Ctx, { day }: Paid, isCurrent: () => boolean): void {
  let busy = false;
  const wire = (g: PaidDay, streak: number) => {
    if (g.done) copyButton(root, ctx, dailyShare(ctx, g.day, g.solved ? g.tries : 0, streak));
    root.querySelector('#options')?.addEventListener('click', onGuess);
  };
  async function onGuess(e: Event) {
    const button = (e.target as Element).closest<HTMLButtonElement>('[data-i]');
    if (!button || button.disabled || busy || !isCurrent()) return;
    busy = true;
    button.disabled = true;
    const res = await api('/api/daily/guess', { method: 'POST', body: { guess: Number(button.dataset.i) } });
    busy = false;
    if (!isCurrent()) return;
    const g = res.body as PaidDay | undefined;
    if (!g?.options) {
      toast(g?.error ? ctx.t(g.error) : ctx.t('That didn’t go through. Try again in a moment.'));
      button.disabled = false;
      return;
    }
    if (g.done) {
      noteDaily(g.day, g.solved ? g.tries : 0);
      track('game', 'daily', g.solved ? 'solved' : 'missed', 'paid', g.solved ? g.tries : 0);
    }
    const streak = prefs.get('daily', { streak: 0 }).streak;
    root.innerHTML = String(paidView(ctx, g, streak));
    wire(g, streak);
  }
  wire(day, prefs.get('daily', { streak: 0 }).streak);
}

/** Practice: ten rounds, played in place; a hint sharpens the cover for a point less. */
function playPractice(root: HTMLElement, ctx: Ctx, p: Practice, isCurrent: () => boolean): void {
  const { deck, special } = p;
  if (!deck.length) return;
  let round = 0, score = 0, level = 0, current = deck[0], options = p.options, answered = false;
  const img = root.querySelector<HTMLImageElement>('#cover')!;
  const optionsEl = root.querySelector<HTMLElement>('#options')!;
  const hint = root.querySelector<HTMLButtonElement>('#hint')!;
  const next = root.querySelector<HTMLButtonElement>('#next')!;
  const reveal = root.querySelector<HTMLElement>('#reveal')!;

  const drawStatus = () => {
    root.querySelector('#round')!.textContent = String(round + 1);
    root.querySelector('#score')!.textContent = String(score);
    root.querySelector('#worth')!.textContent = answered ? '—' : String(3 - level);
    img.style.filter = answered ? 'none' : blurFilter(level);
    hint.disabled = answered || level >= BLUR.length - 1;
  };

  // A round after the first (render() drew that one).
  const start = () => {
    answered = false;
    level = 0;
    current = deck[round % deck.length];
    root.querySelector('#special')!.textContent = specialLabel(ctx, special.get(current[0]));
    options = roundOptions(deck, current, Math.random);
    img.src = coverUrl(current[0], 'cover');
    optionsEl.innerHTML = String(optionButtons(options));
    next.classList.add('hidden');
    reveal.textContent = '';
    drawStatus();
  };

  const finish = () => {
    const best = Math.max(score, prefs.get('guess-best', 0));
    prefs.set('guess-best', best);
    track('game', 'guess', 'finished', '', score);
    root.querySelector('.game')!.innerHTML = String(practiceResult(ctx, score, best, Date.now()));
    copyButton(root, ctx, practiceShare(ctx, score, location.origin));
  };

  // A set without a cover can't be guessed: quietly swap it for the next one in the deck.
  img.addEventListener('error', () => {
    deck.splice(round % deck.length, 1);
    if (isCurrent()) start();
  });
  hint.addEventListener('click', () => {
    level = Math.min(level + 1, BLUR.length - 1);
    drawStatus();
  });
  optionsEl.addEventListener('click', e => {
    const button = (e.target as Element).closest<HTMLButtonElement>('[data-i]');
    if (!button || answered) return;
    answered = true;
    const right = options[Number(button.dataset.i)] === current;
    if (right) score += 3 - level;
    optionsEl.querySelectorAll<HTMLButtonElement>('[data-i]').forEach(b => {
      b.disabled = true;
      if (options[Number(b.dataset.i)] === current) b.classList.add('right');
    });
    if (!right) button.classList.add('wrong');
    reveal.textContent = practiceReveal(ctx, current, right);
    next.classList.remove('hidden');
    next.textContent = round + 1 >= ROUNDS ? ctx.t('See result') : ctx.t('Next');
    drawStatus();
  });
  next.addEventListener('click', () => {
    round++;
    if (round >= ROUNDS) finish();
    else start();
  });
}

/** A map quiz: ten questions, each redrawn whole, then the score. */
function playQuiz(root: HTMLElement, ctx: Ctx, q: QuizGame): void {
  if (!q.deck.length) return;
  let round = 0, score = 0;
  const draw = (picked: string | null) => {
    root.innerHTML = String(quizView(ctx, q, round, score, picked));
    wire();
  };
  const wire = () => {
    const r = q.deck[round];
    root.querySelectorAll<HTMLElement>('[data-pick]').forEach(b => b.addEventListener('click', () => {
      if (b.dataset.pick === quizAnswer(q.mode, r)) score++;
      draw(b.dataset.pick!);
    }));
    root.querySelector('#next')?.addEventListener('click', () => {
      round++;
      if (round < q.deck.length) { draw(null); return; }
      prefs.set('quiz-best', Math.max(score, prefs.get('quiz-best', 0)));
      track('game', 'quiz', `finished ${q.mode}`, '', score);
      root.querySelector('.game')!.innerHTML = String(quizResult(ctx, q.mode, score, q.deck.length, Date.now()));
    });
  };
  wire();
}

/** Higher or lower: a streak of right guesses, each round redrawn whole. */
function playHilo(root: HTMLElement, ctx: Ctx, h: Hilo): void {
  const players = h.core.players;
  let streak = 0, round = h.round;
  const best = () => prefs.get('hilo-best', 0);
  const draw = (revealed = false, result: boolean | null = null) => {
    root.innerHTML = String(hiloView(ctx, players, round, streak, best(), revealed, result));
    wire(revealed, result);
  };
  const wire = (revealed: boolean, result: boolean | null) => {
    root.querySelectorAll<HTMLElement>('[data-guess]').forEach(button => button.addEventListener('click', () => {
      const right = hiloRight(players, round, button.dataset.guess === 'up');
      if (right) streak++;
      prefs.set('hilo-best', Math.max(streak, best()));
      if (!right) track('game', 'higher or lower', 'streak ended', '', streak);
      draw(true, right);
      if (Math.round(hiloValue(players, round)) === 727) wysi();
    }));
    root.querySelector('#continue')?.addEventListener('click', () => {
      round = hiloRound(players, round.b, Math.random);
      draw();
    });
    root.querySelector('#restart')?.addEventListener('click', () => {
      streak = 0;
      round = hiloRound(players, null, Math.random);
      draw();
    });
    if (revealed && !result) copyButton(root, ctx, hiloShare(ctx, streak));
  };
  wire(false, null);
}

export function mount(root: HTMLElement, ctx: Ctx, data: Data, isCurrent: () => boolean): void {
  switch (data.game) {
    case 'daily': return playDaily(root, ctx, data, isCurrent);
    case 'paid': return playPaid(root, ctx, data, isCurrent);
    case 'practice': return playPractice(root, ctx, data, isCurrent);
    case 'quiz': return playQuiz(root, ctx, data);
    case 'hilo': return playHilo(root, ctx, data);
  }
}
