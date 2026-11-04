// The Games page (/games/:game?), as assets/js/pages/games.js draws it: the hub, Guess the map (one map a day, or ten
// rounds of practice), the map quizzes (Convert or specific?, Overdose or Rain?) and Higher or lower?. From quiz.json,
// the header search's maps (search-maps.json) and the core pack.
//
// Everything here is pure: each game's markup, drawn from its state, and its rules (the decks, the answers, the scores,
// the daily streak), with the dice passed in. The browser half (games.mount.ts) throws them, keeps the records in this
// browser and plays: it makes each game's first state before render() draws it, then redraws with these as it goes.

import { html, type Safe } from '../kernel/html.ts';
import type { Ctx } from '../kernel/ctx.ts';
import type { CorePack } from '../gen/packs.ts';
import { avatar, avatarUrl, rowOf, type Players } from '../ui/players.ts';
import { coverUrl, starsBadge } from '../ui/maps.ts';
import { catChip, type Cat } from '../ui/scores.ts';
import { bananas, signInButton } from '../ui/bananas.ts';
import { BOSS_SETS, TUGA_SET, pick } from '../ui/lore.ts';
import { randomItem, shuffle } from '../ui/fun.ts';
import { RIVALRY_LABELS } from '../../../assets/js/core/presets.js';

/** quiz.json's sets, most played first: [set id, artist, title, mapper, Portuguese players on its most played map]. */
export type QuizSet = readonly [number, string, string, string, number];

export interface Quiz {
  sets: QuizSet[];
}

/**
 * The daily game's record in this browser (prefs 'daily'): the last day played, the streak, the best streak, and that
 * day's result, the try it was solved on (0 for missed).
 */
export interface DailyRecord {
  last: string | null;
  streak: number;
  best: number;
  result: number | null;
}

/** This browser's records, as the hub shows them (prefs guess-best, hilo-best, daily and quiz-best). */
export interface Records {
  guessBest: number | null;
  hiloBest: number | null;
  daily: DailyRecord | null;
  quizBest: number | null;
}

/** The paying daily as /api/daily answers it (economy/api.js gameView): the answer only once the game is over. */
export interface PaidDay {
  day: string;
  options: { artist: string; title: string }[];
  tries: number;
  triesLeft: number;
  guesses: number[];
  solved: boolean;
  done: boolean;
  cover: string;
  answer?: { index: number; setId: number; artist: string; title: string; mapper: string };
  error?: string;
}

/**
 * A map as the maps' indexes have it (core/maps-search.js decodeSearchMaps and decodeMapsSearch): [id, set id, artist,
 * title, difficulty, stars, category ('c', 'u' or 'r'), Portuguese players, …].
 */
export type MapRow = readonly [number, number, string, string, string, number, string, number, ...unknown[]];

/** A map quiz's question: one map of the index. */
export interface QuizCard {
  set: number;
  artist: string;
  title: string;
  version: string;
  stars: number;
  cat: Cat;
}

export type QuizMode = 'convert' | 'dose';

/** A Higher or lower round: the stat (STATS) and the two players, rows in core.players, `a` shown and `b` to guess. */
export interface HiloRound {
  stat: number;
  a: number;
  b: number;
}

export interface Hub {
  game: 'hub';
  core: CorePack;
  records: Records;
}

/** The free daily: today's map, picked from quiz.json the same for everyone, and this browser's record. */
export interface Daily {
  game: 'daily';
  /** Lisbon days, YYYY-MM-DD. */
  today: string;
  yesterday: string;
  answer: QuizSet;
  /** Six, the answer among them (the same array, so a pick is checked by identity). */
  options: QuizSet[];
  /** The record as the page found it. */
  saved: DailyRecord;
  /** Whether "Sign in with osu!" works on this address (then the free daily offers the paying one). */
  signInHere: boolean;
}

/** The paying daily (signed in): the game as the site's endpoint has it, and this browser's streak. */
export interface Paid {
  game: 'paid';
  day: PaidDay;
  streak: number;
}

/** Ten rounds of Guess the map; an empty deck when quiz.json has too few sets. */
export interface Practice {
  game: 'practice';
  deck: QuizSet[];
  /** The sets of the special rounds (the Portuguese bonus round, the boss) by set id. */
  special: Map<number, Special>;
  /** The first round's four options. */
  options: QuizSet[];
}

export interface QuizGame {
  game: 'quiz';
  mode: QuizMode;
  /** Ten questions, or none when the data has too few maps for the mode. */
  deck: QuizCard[];
}

export interface Hilo {
  game: 'hilo';
  core: CorePack;
  round: HiloRound;
  /** The best streak in this browser, as the first round shows it. */
  best: number;
}

export type Data = Hub | Daily | Paid | Practice | QuizGame | Hilo;

export type Game = 'hub' | 'daily' | 'practice' | 'quiz' | 'hilo';
export type Special = 'tuga' | 'boss';

/**
 * Which game an address shows, as the old page picks it: /games/guess is the daily map and ?mode=practice the ten
 * rounds (old /games/daily links still work); anything else is the hub.
 */
export function gameOf(params: Record<string, string | undefined>, query: Record<string, string | undefined>): Game {
  const game = params.game;
  if (game === 'guess') return query.mode === 'practice' ? 'practice' : 'daily';
  if (game === 'daily') return 'daily';
  if (game === 'higher-lower') return 'hilo';
  if (game === 'quiz') return 'quiz';
  return 'hub';
}

/** The quiz's mode from the address: "Overdose or Rain?" by name, "Convert or specific?" otherwise. */
export const quizMode = (query: Record<string, string | undefined>): QuizMode =>
  (query.mode === 'dose' ? 'dose' : 'convert');

const eyebrowHome = ({ t }: Ctx) => html`<a href="/games">${t('Games')}</a>`;

// ---- Hub ------------------------------------------------------------------------------------------------

/** Rivals by osu! id: their avatar from the core pack, or osu!'s for someone not on the site. */
function rivalAvatar(ctx: Ctx, players: Players, id: number): Safe {
  const row = rowOf(players, id);
  return row < 0
    ? html`<img class="avatar avatar-md" src="${avatarUrl(id)}" alt="" width="44" height="44" loading="lazy" decoding="async" data-hide-broken>`
    : avatar(ctx, players, row, 'avatar-md');
}

function hub(ctx: Ctx, { core, records }: Hub): Safe {
  const { t, th, tn } = ctx;
  const { guessBest: best, hiloBest: streak, daily, quizBest } = records;
  // The guess card's boss changes each day (UTC), the same for everyone.
  const boss = BOSS_SETS[Math.floor(ctx.now() / 86400) % BOSS_SETS.length];
  const [a, b, rivalry] = (RIVALRY_LABELS as [number, number, string][])[0];
  return html`
    <header class="page-head">
      <h1>${t('Games')}</h1>
      <p>${t('Quick games made from the community’s data. Your records are saved in this browser.')}</p>
    </header>
    <div class="grid grid-3 game-cards">
      <a class="card card-link" href="/games/guess">
        <span class="game-art"><img class="game-art-blur" src="${coverUrl(boss, 'card')}" alt="" width="400" height="140" loading="lazy" decoding="async"></span>
        <h2>${t('Guess the map')}</h2>
        <p class="muted">${th('Name the map from its blurred cover. {daily} one map a day, three tries, like the Discord’s Wordle but with fruit. {practice} ten rounds with a boss round at the end.', { daily: html`<b>${t('Daily:')}</b>`, practice: html`<b>${t('Practice:')}</b>` })}</p>
        <p class="m-0 small faint">${daily?.streak ? tn(daily.streak, 'Daily streak: {n} day', 'Daily streak: {n} days') : t('No daily streak yet.')}${best !== null ? ` · ${t('Practice record: {best} of 30', { best })}` : ''}</p>
      </a>
      <a class="card card-link" href="/games/quiz">
        <span class="game-art"><img src="${coverUrl(TUGA_SET, 'card')}" alt="" width="400" height="140" loading="lazy" decoding="async"></span>
        <h2>${t('Convert or specific?')}</h2>
        <p class="muted">${t('The eternal argument, as a quiz. Or try “Overdose or Rain?” and name the difficulty from the cover and the stars.')}</p>
        <p class="m-0 small faint">${quizBest !== null ? t('Your record: {best} of 10', { best: quizBest }) : t('You haven’t played yet.')}</p>
      </a>
      <a class="card card-link" href="/games/higher-lower">
        <span class="game-art game-art-duel">${rivalAvatar(ctx, core.players, a)}<span class="duel-vs">${t('vs')}</span>${rivalAvatar(ctx, core.players, b)}<small>${t(rivalry)}</small></span>
        <h2>${t('Higher or lower?')}</h2>
        <p class="muted">${t('Who has more pp, more #1s or more plays? Guess whether the next player is higher or lower and keep the streak alive.')}</p>
        <p class="m-0 small faint">${streak !== null ? t('Your best streak: {n}', { n: streak }) : t('You haven’t played yet.')}</p>
      </a>
    </div>
  `;
}

// ---- Guess the map: Daily (one map a day) or Practice (ten rounds) ------------------------------------------------

export const ROUNDS = 10;
/** The cover's blur in px at each hint level; a right answer is worth 3 - level points. */
export const BLUR = [26, 14, 6];

/** The cover's filter at a hint level (or try), as the games set it inline. */
export const blurFilter = (level: number) => `blur(${BLUR[Math.min(level, BLUR.length - 1)]}px) saturate(1.2)`;

const guessModes = ({ t }: Ctx, mode: 'daily' | 'practice'): Safe => html`<div class="justify-center mb-3 chips">
  <a class="chip ${mode === 'daily' ? 'active' : ''}" href="/games/guess" ${mode === 'daily' ? html`aria-current="page"` : ''}>${t('Daily')}</a>
  <a class="chip ${mode === 'practice' ? 'active' : ''}" href="/games/guess?mode=practice" ${mode === 'practice' ? html`aria-current="page"` : ''}>${t('Practice')}</a>
</div>`;

let lisbon: Intl.DateTimeFormat | undefined;

/** The day in Lisbon at `ms` (YYYY-MM-DD): the daily turns at midnight there, so everyone gets the same map. */
export const lisbonDay = (ms: number): string =>
  (lisbon ??= new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Lisbon' })).format(ms);

/**
 * The daily record after a game on `today`: a solve (`tried` 1–3) carries on yesterday's streak (or today's, played
 * again on another device), a miss (0) ends it.
 */
export function dailyRecord(saved: DailyRecord, today: string, yesterday: string, tried: number): DailyRecord {
  const won = tried > 0;
  const streak = won
    ? (saved.last === yesterday || saved.last === today ? saved.streak : 0) + (saved.last === today ? 0 : 1)
    : 0;
  return { last: today, streak, best: Math.max(streak, saved.best || 0), result: tried };
}

/**
 * Today's free daily: the map is picked from the 300 most played sets by the day alone, so it's the same for everyone;
 * five others from those, never the same set or title, and the six in random order.
 */
export function dailyRound(sets: readonly QuizSet[], today: string, random: () => number):
  { answer: QuizSet; options: QuizSet[] } {
  const pool = sets.slice(0, 300);
  const answer = pick(pool, `daily:${today}`);
  const others = shuffle(pool.filter(s => s[0] !== answer[0] && s[2] !== answer[2]), random).slice(0, 5);
  return { answer, options: shuffle([answer, ...others], random) };
}

/** The try today's map was solved on in this browser (0 missed), or null while it's still to play. */
export function playedToday({ saved, today }: Daily): number | null {
  const result = saved.last === today ? saved.result : null;
  return result === null ? null : result ?? 0;
}

/** What the daily says once it's over: `tried` is the try it was solved on (1–3), 0 for missed. */
const dailyVerdict = ({ t }: Ctx, tried: number) => (tried === 1 ? t('First try. Show-off.')
  : tried === 2 ? t('Second try. Not bad.') : tried === 3 ? t('3rd try gang.') : t('Unlucky, 1 miss. Back tomorrow.'));

/** The daily's "Copy result" text: an apple per miss, then the target, or a cross. */
export const dailyShare = ({ t }: Ctx, day: string, tried: number, streak: number) =>
  t('Guess the map (daily) · PT Catch {day}: {result} · streak {streak}',
    { day, result: tried ? `${'🍎'.repeat(tried - 1)}🎯 (${tried}/3)` : '❌', streak });

/** How the daily ends: the try it was solved on (0 missed) and the streak after it. */
export interface DailyEnd {
  tried: number;
  streak: number;
}

/** The free daily, `tries` tries in, or over (`end`). */
export function dailyView(ctx: Ctx, d: Daily, tries = 0, end: DailyEnd | null = null): Safe {
  const { t, fmt } = ctx;
  const { answer, saved, today, yesterday } = d;
  return html`
      <div class="game">
        <header class="page-head center">
          <span class="eyebrow">${eyebrowHome(ctx)} · ${t('Guess the map')} · ${fmt.date(Date.parse(`${today}T12:00:00Z`) / 1000)}</span>
          <h1>${t('Which map is today’s?')}</h1>
        </header>
        ${guessModes(ctx, 'daily')}
        ${d.signInHere ? html`<p class="center small muted">${t('Signed in with osu!, the daily pays bananas.')} ${signInButton(ctx, true, t('Sign in'))}</p>` : ''}
        <div class="scoreboard"><span>${t('Tries left')} <b>${end ? '—' : 3 - tries}</b></span><span>${t('Streak')} <b>${end ? end.streak : saved.last === yesterday || saved.last === today ? saved.streak : 0}</b></span></div>
        <div class="game-cover"><img id="cover" alt="${t('Map cover (blurred)')}" src="${coverUrl(answer[0], 'cover')}" style="filter:${end ? 'none' : blurFilter(tries)}"></div>
        <div class="game-options" id="options">${d.options.map((s, i) => html`<button class="option ${end && s === answer ? 'right' : ''}" type="button" data-i="${i}" ${end ? html`disabled` : ''}>${s[2]}<small>${s[1]}</small></button>`)}</div>
        ${end ? html`<p class="game-result ${end.tried ? 'right' : 'wrong'}">${dailyVerdict(ctx, end.tried)}</p>
          <p class="center muted small">${t('{map}, mapped by {mapper}. A new map tomorrow.', { map: `${answer[1]} - ${answer[2]}`, mapper: answer[3] })}</p>
          <div class="justify-center btn-row"><button class="btn" id="share" type="button">${t('Copy result')}</button></div>` : ''}
      </div>`;
}

/**
 * The paying daily: the site's endpoint picked the map and checks each guess (economy/api.js), so the page only ever
 * knows the six options, and the answer once the game is over. Solving it pays 3, 2 or 1 bananas, added by the bot.
 */
export function paidView(ctx: Ctx, g: PaidDay, streak: number): Safe {
  const { t, fmt } = ctx;
  return html`
      <div class="game">
        <header class="page-head center">
          <span class="eyebrow">${eyebrowHome(ctx)} · ${t('Guess the map')} · ${fmt.date(Date.parse(`${g.day}T12:00:00Z`) / 1000)}</span>
          <h1>${t('Which map is today’s?')}</h1>
        </header>
        ${guessModes(ctx, 'daily')}
        <p class="center small muted">${t('Signed in: solving pays {pay} on the 1st, 2nd or 3rd try, and the bot adds it within 15 minutes.', { pay: '3 / 2 / 1 🍌' })}</p>
        <div class="scoreboard"><span>${t('Tries left')} <b>${g.done ? '—' : g.triesLeft}</b></span><span>${t('Streak')} <b>${streak}</b></span></div>
        <div class="game-cover"><img id="cover" alt="${t('Map cover (blurred)')}" src="${g.cover}" style="filter:${g.done ? 'none' : blurFilter(g.tries)}"></div>
        <div class="game-options" id="options">${g.options.map((o, i) => {
          const tried = g.guesses.includes(i);
          const right = g.done && g.answer?.index === i;
          return html`<button class="option ${right ? 'right' : tried ? 'wrong' : ''}" type="button" data-i="${i}" ${g.done || tried ? html`disabled` : ''}>${o.title}<small>${o.artist}</small></button>`;
        })}</div>
        ${g.done && g.answer ? html`<p class="game-result ${g.solved ? 'right' : 'wrong'}">${dailyVerdict(ctx, g.solved ? g.tries : 0)}</p>
          <p class="center muted small">${t('{map}, mapped by {mapper}. A new map tomorrow.', { map: `${g.answer.artist} - ${g.answer.title}`, mapper: g.answer.mapper })}
            ${g.solved ? html`<br>${t('{n} on its way to your wallet.', { n: bananas(ctx, 4 - g.tries) })}` : ''}</p>
          <div class="justify-center btn-row"><button class="btn" id="share" type="button">${t('Copy result')}</button></div>` : ''}
      </div>`;
}

/**
 * Practice's deck: every set but the special ones, shuffled; the Portuguese bonus round somewhere in rounds 3–8 (once
 * per browser session: `tugaShown` once it has been), and a boss map as the last round.
 */
export function practiceDeck(sets: readonly QuizSet[], tugaShown: boolean, random: () => number):
  { deck: QuizSet[]; special: Map<number, Special> } {
  const special = new Map<number, Special>();
  const deck = shuffle(sets.filter(s => !BOSS_SETS.includes(s[0]) && s[0] !== TUGA_SET), random);
  const tuga = sets.find(s => s[0] === TUGA_SET);
  if (tuga && !tugaShown) {
    deck.splice(2 + Math.floor(random() * 6), 0, tuga);
    special.set(tuga[0], 'tuga');
  }
  const boss = randomItem(sets.filter(s => BOSS_SETS.includes(s[0])), random);
  if (boss) {
    deck.splice(ROUNDS - 1, 0, boss);
    special.set(boss[0], 'boss');
  }
  return { deck, special };
}

/** A round's four options: the set and three others of the deck, never the same title, in random order. */
export function roundOptions(deck: readonly QuizSet[], current: QuizSet, random: () => number): QuizSet[] {
  const others = shuffle(deck.filter(s => s[0] !== current[0] && s[2] !== current[2]), random).slice(0, 3);
  return shuffle([current, ...others], random);
}

/** The line above a special round's cover ('' for an ordinary round). */
export const specialLabel = ({ t }: Ctx, special: Special | undefined) =>
  (special === 'tuga' ? t('Tuga bonus 🇵🇹') : special === 'boss' ? t('Boss round') : '');

/** A round's options. */
export const optionButtons = (options: readonly QuizSet[]): Safe =>
  html`${options.map((s, i) => html`<button class="option" type="button" data-i="${i}">${s[2]}<small>${s[1]}</small></button>`)}`;

/** What a practice answer reveals: the map, its mapper and how many here have played it. */
export function practiceReveal(ctx: Ctx, current: QuizSet, right: boolean): string {
  const { t, fmt } = ctx;
  const vars = {
    map: `${current[1]} - ${current[2]}`, mapper: current[3], players: fmt.plural(current[4], 'Portuguese player'),
  };
  return right
    ? t('Right! {map}, mapped by {mapper} · {players} on this set’s most played map.', vars)
    : t('Unlucky, 1 miss. It was {map}, mapped by {mapper} · {players} on this set’s most played map.', vars);
}

/** Practice, its first round drawn (the browser half plays the rest in place). */
export function practiceView(ctx: Ctx, p: Practice): Safe {
  const { t } = ctx;
  if (!p.deck.length) return html`<div class="empty">${t('There aren’t enough maps for this game yet.')}</div>`;
  const current = p.deck[0];
  return html`
    <div class="game">
      <header class="page-head center">
        <span class="eyebrow">${eyebrowHome(ctx)} · ${t('Guess the map')}</span>
        <h1>${t('Which map is this?')}</h1>
      </header>
      ${guessModes(ctx, 'practice')}
      <div class="scoreboard"><span>${t('Round')} <b><span id="round">1</span><small>/${ROUNDS}</small></b></span><span>${t('Points')} <b id="score">0</b></span><span>${t('Worth')} <b id="worth">3</b></span></div>
      <p class="center special-round" id="special">${specialLabel(ctx, p.special.get(current[0]))}</p>
      <div class="game-cover"><img id="cover" alt="${t('Map cover (blurred)')}" src="${coverUrl(current[0], 'cover')}" style="filter:${blurFilter(0)}"></div>
      <div class="game-options" id="options">${optionButtons(p.options)}</div>
      <div class="justify-center mt-4 btn-row">
        <button class="btn" id="hint" type="button">${t('Less blur (−1 point)')}</button>
        <button class="btn btn-primary hidden" id="next" type="button">${t('Next')}</button>
      </div>
      <p class="mt-3 center muted small" id="reveal"></p>
    </div>
  `;
}

/** Practice's result card; `stamp` makes "Play again" a new address, so the router starts a new game. */
export function practiceResult(ctx: Ctx, score: number, best: number, stamp: number): Safe {
  const { t } = ctx;
  return html`
      <div class="card-roomy card center">
        <span class="eyebrow">${t('Result')}</span>
        <div class="game-score">${score}<small>/ ${ROUNDS * 3}</small></div>
        <h1 class="text-xl">${t('{score} of {max} points', { score, max: ROUNDS * 3 })}</h1>
        <p class="muted">${score >= 25 ? t('You know your maps by heart!') : score >= 15 ? t('Not bad, you’ve been playing.') : t('Plenty of maps left to discover.')} ${t('Your record is {best}.', { best })}</p>
        <div class="justify-center btn-row">
          <a class="btn btn-primary" href="/games/guess?mode=practice&r=${stamp}">${t('Play again')}</a>
          <button class="btn" id="share" type="button">${t('Copy result')}</button>
        </div>
      </div>`;
}

/** Practice's "Copy result" text, with the address to play it (`origin`, the site's). */
export const practiceShare = ({ t }: Ctx, score: number, origin: string) =>
  `${t('Guess the map')} · PT Catch: ${score}/${ROUNDS * 3} 🍎 ${origin}/games/guess?mode=practice`;

// ---- Convert or specific? / Overdose or Rain? ---------------------------------------------------------------------

/** Each quiz's words: its name, its question, and its answers as [key, label]. */
const quizText = ({ t }: Ctx): Record<QuizMode, { label: string; question: string; answers: [string, string][] }> => ({
  convert: {
    label: t('Convert or specific?'),
    question: t('Is this a convert or a catch-specific map?'),
    answers: [['c', t('Convert')], ['r', t('Specific')]],
  },
  dose: {
    label: t('Overdose or Rain?'),
    question: t('Overdose or Rain? Name the difficulty.'),
    answers: [['overdose', 'Overdose'], ['rain', 'Rain']],
  },
});

export const quizLabel = (ctx: Ctx, mode: QuizMode) => quizText(ctx)[mode].label;

const OVERDOSE = /\boverdose\b/i;
const RAIN = /\brain\b/i;

/**
 * The maps a quiz asks about, in the index's order. Both want maps with details that several players here have
 * played: for "Convert or specific?", converts and ranked maps three or more have; for "Overdose or Rain?",
 * difficulties named one or the other (not both) two or more have.
 */
export function quizPool(rows: readonly MapRow[], mode: QuizMode): MapRow[] {
  return mode === 'convert'
    ? rows.filter(r => r[3] && r[7] >= 3 && (r[6] === 'c' || r[6] === 'r'))
    : rows.filter(r => r[3] && r[7] >= 2 && OVERDOSE.test(r[4]) !== RAIN.test(r[4]));
}

/** A quiz's ten questions: ten maps of its pool at random. */
export const quizDeck = (rows: readonly MapRow[], mode: QuizMode, random: () => number): QuizCard[] =>
  shuffle(quizPool(rows, mode), random).slice(0, 10)
    .map(r => ({ set: r[1], artist: r[2], title: r[3], version: r[4], stars: r[5], cat: r[6] as Cat }));

/** A question's right answer: its category ('c' or 'r'), or which of 'overdose' and 'rain' its difficulty is named. */
export const quizAnswer = (mode: QuizMode, card: QuizCard): string =>
  (mode === 'convert' ? card.cat : OVERDOSE.test(card.version) ? 'overdose' : 'rain');

/** A quiz's round `round` (from 0), `score` points in; `picked` is the answer given, or null while it's open. */
export function quizView(ctx: Ctx, q: QuizGame, round: number, score: number, picked: string | null): Safe {
  const { t } = ctx;
  const text = quizText(ctx);
  const m = text[q.mode];
  if (!q.deck.length) return html`<div class="empty">${t('There aren’t enough maps for this quiz yet.')}</div>`;
  const r = q.deck[round];
  const right = picked !== null && picked === quizAnswer(q.mode, r);
  return html`
      <div class="game">
        <header class="page-head center">
          <span class="eyebrow">${eyebrowHome(ctx)} · ${m.label}</span>
          <h1>${m.question}</h1>
          <div class="justify-center chips">${(Object.keys(text) as QuizMode[]).map(k => html`<a class="chip ${k === q.mode ? 'active' : ''}" href="/games/quiz?mode=${k}">${text[k].label}</a>`)}</div>
        </header>
        <div class="scoreboard"><span>${t('Round')} <b>${round + 1}<small>/${q.deck.length}</small></b></span><span>${t('Points')} <b>${score}</b></span></div>
        <div class="game-cover"><img src="${coverUrl(r.set, 'cover')}" alt="${t('Map cover')}" data-hide-broken></div>
        <p class="m-0 mt-3 center"><b>${r.artist} - ${r.title}</b> ${starsBadge(ctx, r.stars)}${q.mode === 'convert' ? html` <span class="faint">[${r.version}]</span>` : ''}</p>
        <div class="justify-center mt-4 btn-row">
          ${picked === null
            ? m.answers.map(([k, label]) => html`<button class="btn btn-primary" type="button" data-pick="${k}">${label}</button>`)
            : html`<button class="btn btn-primary" id="next" type="button">${round + 1 >= q.deck.length ? t('See result') : t('Next')}</button>`}
        </div>
        ${picked !== null ? html`<p class="game-result ${right ? 'right' : 'wrong'}">${right ? t('Right!') : t('Unlucky, 1 miss.')} <span class="muted">${catChip(ctx, r.cat)} [${r.version}]</span></p>` : ''}
      </div>`;
}

/** A quiz's result card; `stamp` makes "Play again" a new address, so the router starts a new game. */
export function quizResult(ctx: Ctx, mode: QuizMode, score: number, total: number, stamp: number): Safe {
  const { t } = ctx;
  return html`<div class="card-roomy card center">

        <span class="eyebrow">${quizLabel(ctx, mode)}</span>
        <div class="game-score">${score}<small>/ ${total}</small></div>
        <p class="muted">${score >= 9 ? t('You’ve clearly had this argument before.') : score >= 6 ? t('Not bad.') : t('Skill issue. Try again?')}</p>
        <div class="justify-center btn-row"><a class="btn btn-primary" href="/games/quiz?mode=${mode}&r=${stamp}">${t('Play again')}</a></div>
      </div>`;
}

// ---- Higher or lower ------------------------------------------------------------------------------------------

/** What Higher or lower compares, from the core pack (pp in hundredths there), and whether it's pp. */
export const STATS: readonly { value(players: Players, row: number): number; pp: boolean }[] = [
  { value: (p, r) => p.cv[r] / 100, pp: true },
  { value: (p, r) => p.ul[r] / 100, pp: true },
  { value: (p, r) => p.pp[r] / 100, pp: true },
  { value: (p, r) => p.firstsC[r] + p.firstsU[r] + p.firstsR[r], pp: false },
  { value: (p, r) => p.plays[r], pp: false },
];

const statLabel = ({ t }: Ctx, stat: number) =>
  [t('Converts pp'), t('Loved & Unranked pp'), t('official osu!catch pp'), t('#1s in Portugal'), t('osu!catch plays')][stat];

const statText = ({ fmt }: Ctx, stat: number, v: number) => (STATS[stat].pp ? `${fmt.num(v)} pp` : fmt.num(v));

/**
 * The next round: a stat at random, and two players who both have some of it, with different values. `a` (the last
 * round's second player) stays on when they have some of the new stat; otherwise both are new.
 */
export function hiloRound(players: Players, a: number | null, random: () => number): HiloRound {
  let stat = 0;
  for (let tries = 0; tries < 50; tries++) {
    stat = Math.floor(random() * STATS.length);
    const { value } = STATS[stat];
    const pool: number[] = [];
    for (let row = 0; row < players.rows; row++) if (value(players, row) > 0) pool.push(row);
    const first = a !== null && value(players, a) > 0 ? a : randomItem(pool, random);
    const others = first === undefined ? [] : pool.filter(row => row !== first && value(players, row) !== value(players, first));
    const second = randomItem(others, random);
    if (first !== undefined && second !== undefined) return { stat, a: first, b: second };
  }
  return { stat, a: 0, b: 1 };
}

/** Whether "higher" (`up`) or "lower" is right: whether the second player has more than the first. */
export function hiloRight(players: Players, { stat, a, b }: HiloRound, up: boolean): boolean {
  const { value } = STATS[stat];
  return up === value(players, b) > value(players, a);
}

/** The second player's value, to see it (WYSI at 727). */
export const hiloValue = (players: Players, { stat, b }: HiloRound) => STATS[stat].value(players, b);

/** A round: the second player's value hidden until `revealed`, then whether the guess was right (`result`). */
export function hiloView(ctx: Ctx, players: Players, round: HiloRound, streak: number, best: number, revealed = false,
  result: boolean | null = null): Safe {
  const { t, th } = ctx;
  const label = statLabel(ctx, round.stat);
  const card = (row: number, shown: boolean) => html`<div class="duel-card">
    ${avatar(ctx, players, row, 'avatar-lg')}
    <b class="text-lg">${players.name.at(row)}</b>
    <span class="muted small">${t('has')}</span>
    <span class="value">${shown ? statText(ctx, round.stat, STATS[round.stat].value(players, row)) : '?'}</span>
    <span class="muted small">${label}</span>
  </div>`;
  return html`
      <div class="game">
        <header class="page-head center">
          <span class="eyebrow">${eyebrowHome(ctx)} · ${t('Higher or lower?')}</span>
          <h1>${t('Who has more {stat}?', { stat: label })}</h1>
        </header>
        <div class="scoreboard"><span>${t('Streak')} <b>${streak}</b></span><span>${t('Record')} <b>${best}</b></span></div>
        <div class="duel">
          ${card(round.a, true)}
          <div class="duel-vs">${t('VS')}</div>
          ${card(round.b, revealed)}
        </div>
        <div class="justify-center mt-4 btn-row">
          ${revealed
            ? result
              ? html`<button class="btn btn-primary" id="continue" type="button">${t('Continue')}</button>`
              : html`<button class="btn btn-primary" id="restart" type="button">${t('Start again')}</button><button class="btn" id="share" type="button">${t('Copy result')}</button>`
            : html`<button class="btn btn-primary" data-guess="up" type="button">↑ ${t('Higher')}</button><button class="btn" data-guess="down" type="button">↓ ${t('Lower')}</button>`}
        </div>
        ${revealed ? html`<p class="game-result ${result ? 'right' : 'wrong'}">${result ? t('Right!') : html`<span>${th('Unlucky, 1 miss. Your streak was {streak}. o7', { streak: html`<b>${streak}</b>` })}</span>`}</p>` : ''}
      </div>
    `;
}

/** Higher or lower's "Copy result" text. */
export const hiloShare = ({ t }: Ctx, streak: number) =>
  t('Higher or lower? · PT Catch: a streak of {streak} ⬆️⬇️', { streak });

// ---- The page ---------------------------------------------------------------------------------------------------

export function title(ctx: Ctx, data: Data): string {
  const { t } = ctx;
  switch (data.game) {
    case 'hub': return t('Games');
    case 'daily': case 'paid': return `${t('Guess the map')} · ${t('Daily')}`;
    case 'practice': return `${t('Guess the map')} · ${t('Practice')}`;
    case 'quiz': return quizLabel(ctx, data.mode);
    case 'hilo': return t('Higher or lower?');
  }
}

/** The game's first view. */
export function render(ctx: Ctx, data: Data): Safe {
  switch (data.game) {
    case 'hub': return hub(ctx, data);
    case 'daily': {
      const tried = playedToday(data);
      return dailyView(ctx, data, 0, tried === null ? null : { tried, streak: data.saved.streak });
    }
    case 'paid': return paidView(ctx, data.day, data.streak);
    case 'practice': return practiceView(ctx, data);
    case 'quiz': return quizView(ctx, data, 0, 0, null);
    case 'hilo': return hiloView(ctx, data.core.players, data.round, 0, data.best);
  }
}
