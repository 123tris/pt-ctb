// Top 10 of the year (TOP10-DESIGN.md): the shapes the site's endpoints answer with (contract §13.3), the season and
// its phase (§13.1), a ballot's spots and rules (§3.1, §13.3), the live word counter that mirrors the server's
// (§13.4), and the markup the Top 10 pages share. Pure: no DOM, no fetch.

import { html, raw, type Safe, type Value } from '../kernel/html.ts';
import type { Ctx } from '../kernel/ctx.ts';

// ---- The endpoints' shapes (contract §13.3) ------------------------------------------------------------------------

export type Phase = 'before' | 'open' | 'closed' | 'revealed';

/** The season's dates (ISO, UTC: §13.1) and its phase, which the server derives. */
export interface Season {
  year: number;
  opens: string;
  closes: string;
  reveal: string;
  thanksUntil: string;
  phase?: Phase;
}

/** A ranked player: `spot` repeats for a tie, and the next spot skips (1, 2, 3, 3, 5). */
export interface Pick {
  id: number;
  spot: number;
}

/**
 * A write-up. The server adds `words` and `flags` (the voter's own ballot and the admin queue), `thanks` (public ballots)
 * and, signed in, whether you thanked it. `flags` is a comma list in D1: either form is read.
 */
export interface Writeup {
  body: string;
  cites?: string[];
  words?: number;
  flags?: string[] | string | null;
  mod?: 'ok' | 'struck';
  mod_reason?: string | null;
  thanks?: number;
  /** Not in the contract: whether the signed-in player thanked this one. Read when the server sends it. */
  thanked?: boolean;
}

export type BallotStatus = 'draft' | 'submitted' | 'void';

/** The ballot as PUT /api/top10/ballot takes it. */
export interface BallotInput {
  picks: Pick[];
  mentions: number[];
  watch: number[];
  intro: string;
  outro: string;
  writeups: Record<string, { body: string; cites: string[] }>;
}

/** Your own ballot (GET /api/top10/ballot), draft or submitted. */
export interface OwnBallot extends Omit<BallotInput, 'writeups'> {
  status: BallotStatus;
  submitted_at?: string | number | null;
  updated?: string | number | null;
  void_reason?: string | null;
  writeups: Record<string, Writeup>;
}

/** A submitted ballot as anyone reads it (GET /api/top10/ballots). */
export interface PublicBallot {
  voter: number;
  picks: Pick[];
  mentions: number[];
  watch: number[];
  intro?: string;
  outro?: string;
  submitted_at?: string | number | null;
  updated?: string | number | null;
  writeups: Record<string, Writeup>;
  /** Not in the contract: cited scores, by reference, for the cards under a write-up. Read when the server sends it. */
  scores?: Record<string, ScoreCard>;
}

/** GET /api/top10. `me` only when signed in. */
export interface Hub {
  season: Season;
  /** Submitted ballots so far. */
  turnout: number;
  me?: { eligible: boolean; reason?: string | null; ballot: Partial<OwnBallot> | null } | null;
}

/**
 * A score as a card: what the exported data says about it. Not in the contract (a showcase entry has `score_ref` and
 * `beatmap_id` only); the UI draws it when the server sends one and a plain link otherwise.
 */
export interface ScoreCard {
  map: number;
  title?: string;
  artist?: string;
  version?: string;
  stars?: number;
  set?: number;
  pp?: number;
  acc?: number;
  miss?: number;
  combo?: number;
  mods?: string;
  grade?: string;
  time?: number;
}

/** A showcase entry (GET /api/top10/plays). */
export interface ShowPlay {
  id: number;
  year: number;
  submitter: number;
  player: number;
  score_ref?: string | null;
  beatmap_id?: number | null;
  caption?: string | null;
  clip?: string | null;
  created?: string | number | null;
  status?: 'ok' | 'hidden';
  reason?: string | null;
  endorsements?: number;
  endorsed?: boolean;
  score?: ScoreCard | null;
}

// ---- The season ------------------------------------------------------------------------------------------------------

/** The 2026 edition (§13.1), shown when the endpoints can't be reached. The server's own always wins. */
export const DEFAULT_SEASON: Season = {
  year: 2026,
  opens: '2026-12-01T00:00:00Z',
  closes: '2026-12-31T23:59:59Z',
  reveal: '2027-01-02T12:00:00Z',
  thanksUntil: '2027-01-31T23:59:59Z',
};

/** An ISO time (or unix seconds, or milliseconds) as unix seconds; 0 when there's none. */
export function toSec(v: string | number | null | undefined): number {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') return v > 1e12 ? Math.floor(v / 1000) : v;
  const n = Date.parse(v);
  return Number.isFinite(n) ? Math.floor(n / 1000) : 0;
}

/** The phase at `now` (unix seconds), as the server derives it: the server's own when it sent one. */
export function phaseOf(season: Season, now: number): Phase {
  if (season.phase) return season.phase;
  if (now < toSec(season.opens)) return 'before';
  if (now <= toSec(season.closes)) return 'open';
  if (now < toSec(season.reveal)) return 'closed';
  return 'revealed';
}

/** A time in Lisbon, where the season's dates are set: "Sat 2 Jan, 12:00". */
export function lisbon(ctx: Ctx, sec: number, { time = true, weekday = true } = {}): string {
  return new Intl.DateTimeFormat(ctx.locale, {
    timeZone: 'Europe/Lisbon', day: 'numeric', month: 'short',
    ...(weekday ? { weekday: 'short' } : {}), ...(time ? { hour: '2-digit', minute: '2-digit' } : {}),
  } as Intl.DateTimeFormatOptions).format(new Date(sec * 1000));
}

/** Days, hours, minutes and seconds until `target` (unix seconds); all 0 once it's passed. */
export function countdownParts(target: number, now: number): { d: number; h: number; m: number; s: number; left: number } {
  const left = Math.max(0, Math.floor(target - now));
  return { d: Math.floor(left / 86400), h: Math.floor(left / 3600) % 24, m: Math.floor(left / 60) % 60, s: left % 60, left };
}

/** The countdown's figures, which client code updates every second ([data-cd] holds the target). */
export function countdown(ctx: Ctx, target: number, label: string): Safe {
  const { t } = ctx;
  const p = countdownParts(target, ctx.now());
  const box = (n: number, unit: string, key: string) => html`<span class="t10-cd-box"><b data-cd-${raw(key)}>${String(n).padStart(2, '0')}</b><small>${unit}</small></span>`;
  return html`<div class="t10-cd" data-cd="${target}" role="timer" aria-label="${label}">
    ${box(p.d, t('days'), 'd')}${box(p.h, t('hours'), 'h')}${box(p.m, t('min|minutes'), 'm')}${box(p.s, t('sec|seconds'), 's')}
  </div>`;
}

/** The phase's name. */
export const phaseName = ({ t }: Ctx, phase: Phase): string =>
  ({ before: t('Opens soon'), open: t('Voting is open'), closed: t('Voting has closed'), revealed: t('Results are out') })[phase];

// ---- A ballot's list -------------------------------------------------------------------------------------------------

export const MIN_PICKS = 5;
export const MAX_PICKS = 10;
export const MAX_EXTRAS = 5;
export const MAX_BODY = 4000;
export const MAX_NOTE = 2000;
export const MAX_CAPTION = 280;

/** A list row in the editor: the player and whether they share the spot above. */
export interface Row {
  id: number;
  tie: boolean;
}

/** Each row's spot: a tie repeats the spot above, and the next spot skips (1, 2, 3, 3, 5). The first can't tie. */
export function spotsOf(rows: readonly Row[]): number[] {
  const spots: number[] = [];
  rows.forEach((r, i) => spots.push(i > 0 && r.tie ? spots[i - 1] : i + 1));
  return spots;
}

/** The rows as the API's picks. */
export const picksOf = (rows: readonly Row[]): Pick[] => {
  const spots = spotsOf(rows);
  return rows.map((r, i) => ({ id: r.id, spot: spots[i] }));
};

/** The API's picks as rows, in order of spot (a repeated spot is a tie). */
export function rowsOf(picks: readonly Pick[] | null | undefined): Row[] {
  const sorted = [...(picks ?? [])].sort((a, b) => a.spot - b.spot);
  return sorted.map((p, i) => ({ id: p.id, tie: i > 0 && p.spot === sorted[i - 1].spot }));
}

/** "6", or "=6" for a shared spot. */
export function spotLabel(picks: readonly Pick[], i: number): string {
  const spot = picks[i].spot;
  const shared = picks.some((p, j) => j !== i && p.spot === spot);
  return `${shared ? '=' : ''}${spot}`;
}

/** What stops a ballot from being submitted (§13.3 ballot rules), in words; [] when it can go. */
export function ballotProblems(ctx: Ctx, rows: readonly Row[], mentions: readonly number[], watch: readonly number[], me: number | null): string[] {
  const { t } = ctx;
  const out: string[] = [];
  const ids = rows.map(r => r.id);
  if (ids.length < MIN_PICKS) out.push(t('Rank at least {n} players.', { n: MIN_PICKS }));
  if (ids.length > MAX_PICKS) out.push(t('Rank at most {n} players.', { n: MAX_PICKS }));
  if (new Set(ids).size !== ids.length) out.push(t('Each player can only be on your list once.'));
  if (me !== null && [...ids, ...mentions, ...watch].includes(me)) out.push(t('You can’t vote for yourself.'));
  if (mentions.length > MAX_EXTRAS || watch.length > MAX_EXTRAS) out.push(t('At most {n} honourable mentions and {n} ones to watch.', { n: MAX_EXTRAS }));
  if ([...mentions, ...watch].some(id => ids.includes(id)) || mentions.some(id => watch.includes(id))) out.push(t('A player can only be in one place on your ballot.'));
  return out;
}

// ---- Words and flags (contract §13.4, mirrored from top10/words.js) -------------------------------------------------

const PUNCT_ENDS = /^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu;
const LETTER = /\p{L}/gu;
const URLISH = /^(?:[a-z][a-z0-9+.-]*:\/\/|www\.)|^[\w-]+(?:\.[\w-]+)+\/\S*/i;
const VOWEL = /[aeiouyáàâãéêíóôõú]/i;

/** The text's tokens: split on whitespace, punctuation stripped from the ends. */
export function tokensOf(text: string): string[] {
  return text.split(/\s+/).map(tok => tok.replace(PUNCT_ENDS, '')).filter(Boolean);
}

/** Whether a token counts as a word: 2 or more letters, not a link, at most 30 characters. */
export const isWord = (tok: string): boolean =>
  (tok.match(LETTER)?.length ?? 0) >= 2 && !URLISH.test(tok) && [...tok].length <= 30;

/** The words that count. */
export const wordsOf = (text: string): string[] => tokensOf(text).filter(isWord);

/** 3-word shingles, case-folded. */
function shingles(words: readonly string[]): Set<string> {
  const low = words.map(w => w.toLocaleLowerCase());
  const out = new Set<string>();
  for (let i = 0; i + 2 < low.length; i++) out.add(`${low[i]} ${low[i + 1]} ${low[i + 2]}`);
  return out;
}

/** How much of `a`'s shingles are in `b`, 0 to 1. */
export function overlap(a: string, b: string): number {
  const sa = shingles(wordsOf(a));
  if (!sa.size) return 0;
  const sb = shingles(wordsOf(b));
  let shared = 0;
  for (const s of sa) if (sb.has(s)) shared++;
  return shared / sa.size;
}

export type Flag = 'repetitive' | 'copy' | 'mash';

/**
 * The flags a text gets as you type: `others` are the ballot's other write-ups (the server also checks every other
 * ballot for `copy`). A flagged write-up is saved and shown but pays nothing unless a mod clears it.
 */
export function flagsOf(text: string, others: readonly string[] = []): Flag[] {
  const tokens = tokensOf(text);
  const words = tokens.filter(isWord);
  const out: Flag[] = [];
  if (words.length >= 8 && new Set(words.map(w => w.toLocaleLowerCase())).size < words.length / 2) out.push('repetitive');
  if (words.length >= 3 && others.some(o => o && overlap(text, o) >= 0.7)) out.push('copy');
  if (tokens.length && tokens.filter(tok => [...tok].length >= 6 && !VOWEL.test(tok)).length / tokens.length > 0.2) out.push('mash');
  return out;
}

/** A flags field as the API sends it (array or comma list), as a list. */
export const flagList = (flags: Writeup['flags']): string[] =>
  (Array.isArray(flags) ? flags : String(flags ?? '').split(',')).map(f => f.trim()).filter(Boolean);

/** Bananas a write-up on a ranked player earns: 1 per 4 words, at most 10 (§9). */
export const PEAK_WORDS = 40;
export const PEAK_BANANAS = 10;
export const bananasFor = (words: number): number => Math.min(PEAK_BANANAS, Math.floor(words / 4));

/** Why a flag doesn't count, for the writer. */
export const flagText = ({ t }: Ctx, flag: string): string => ({
  repetitive: t('Looks repetitive, so it doesn’t count yet.'),
  copy: t('Looks copied from another write-up, so it doesn’t count yet.'),
  mash: t('Looks like keyboard mashing, so it doesn’t count yet.'),
} as Record<string, string>)[flag] ?? flag;

/**
 * The word counter under a write-up box: "18 words · 🍌 4 of 10", "🍌 10 of 10 (paid after the reveal)" from 40 words,
 * and a bar that fills as you write. `pays` is false for mentions and ones to watch, which earn nothing.
 */
export function wordMeter(ctx: Ctx, words: number, flags: readonly string[], { pays = true } = {}): Safe {
  const { t, tn, fmt } = ctx;
  const count = tn(words, '{n} word', '{n} words');
  if (!pays) return html`<div class="t10-meter t10-meter-none"><span class="t10-meter-text">${count} · ${t('no bananas for mentions')}</span></div>`;
  const flagged = flags.length > 0;
  const earned = flagged ? 0 : bananasFor(words);
  const full = !flagged && words >= PEAK_WORDS;
  const pct = flagged ? 0 : Math.min(100, Math.round((words / PEAK_WORDS) * 100));
  const text = full ? t('🍌 {n} of {max} (paid after the reveal)', { n: fmt.num(PEAK_BANANAS), max: fmt.num(PEAK_BANANAS) })
    : t('🍌 {n} of {max}', { n: fmt.num(earned), max: fmt.num(PEAK_BANANAS) });
  return html`<div class="t10-meter ${full ? 't10-meter-full' : ''} ${flagged ? 't10-meter-flag' : ''}">
    <div class="t10-meter-bar" role="progressbar" aria-label="${t('Bananas for this write-up')}" aria-valuemin="0" aria-valuemax="${PEAK_WORDS}" aria-valuenow="${Math.min(words, PEAK_WORDS)}"><span style="width:${pct}%"></span></div>
    <span class="t10-meter-text">${count} · ${text}</span>
    ${flags.map(f => html`<span class="t10-flag-note">${flagText(ctx, f)}</span>`)}
  </div>`;
}

// ---- Shared markup -----------------------------------------------------------------------------------------------------

/** The rules on the ballot page (§3.3). The fourth is the mods' warning, which stands out. */
export function rules(ctx: Ctx, season: Season): Safe {
  const { t } = ctx;
  return html`<ol class="t10-rules">
    <li>${t('You can’t vote for yourself.')}</li>
    <li>${t('Lists must be serious: 5 to 10 players. Banter is welcome; being mean isn’t.')}</li>
    <li>${t('One ballot per person. Alts are voided.')}</li>
    <li class="t10-warn">${t('Mods read every write-up before bananas are paid. Filler, copy-paste or spam is removed, and it costs the ballot all its write-up bananas.')}</li>
    <li>${t('You can edit until {when}, Lisbon time.', { when: lisbon(ctx, toSec(season.closes), { weekday: false }) })}</li>
    <li>${t('Write in Portuguese or English.')}</li>
  </ol>`;
}

/** The mods' warning (§3.3 rule 4), shown in full where you write, not only in the folded rules. */
export const modWarning = ({ t }: Ctx): Safe =>
  html`<p class="t10-modwarn">⚠️ ${t('Mods read every write-up before bananas are paid. Filler, copy-paste or spam is removed, and it costs the ballot all its write-up bananas.')}</p>`;

/** The note that ballots are public (decision 7), shown before you submit. */
export const publicNote = ({ t }: Ctx): Safe =>
  html`<p class="t10-public">👁 ${t('Ballots are public. Once you submit, your list and write-ups show on the site with your name, like a forum post. Drafts stay private.')}</p>`;

/** The Top 10 pages' tabs. */
export function top10Tabs(ctx: Ctx, current: string, year: number): Safe {
  const { t } = ctx;
  const items: [string, string, string][] = [
    ['hub', '/top10', t('Overview')],
    ['vote', '/top10/vote', t('Your ballot')],
    ['ballots', '/top10/ballots', t('Ballots')],
    ['plays', '/top10/plays', t('Plays of {year}', { year })],
  ];
  return html`<nav class="tabs t10-tabs" aria-label="${t('Top 10')}">${items.map(([key, href, label]) =>
    html`<a href="${href}" class="${key === current ? 'active' : ''}" ${key === current ? raw('aria-current="page"') : ''}>${label}</a>`)}</nav>`;
}

/**
 * A stored play's reference: its osu! score id when the data has one, else map:<beatmap id> (the player's stored best
 * on that map). Not in the contract, which has osu! score ids only: see the report on scoreRef.
 */
export const playRef = (sid: number | null | undefined, map: number): string => (sid ? String(sid) : `map:${map}`);

/** A link to a score on osu! from its reference (an id, a URL, or a legacy id written negative as the packs keep it). */
export function scoreHref(ref: string | null | undefined): string | null {
  if (!ref) return null;
  const s = String(ref).trim();
  if (/^https?:\/\/osu\.ppy\.sh\//i.test(s)) return s;
  if (/^(map|play):/.test(s)) return null;
  const n = Number(s);
  if (!Number.isSafeInteger(n) || n === 0) return null;
  return n > 0 ? `https://osu.ppy.sh/scores/${n}` : `https://osu.ppy.sh/scores/fruits/${-n}`;
}

/** Whether a clip's address is on a site the showcase takes (§13.3). */
export function clipOk(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^www\.|^m\./, '');
    return ['youtube.com', 'youtu.be', 'twitch.tv', 'clips.twitch.tv', 'streamable.com'].includes(host);
  } catch {
    return false;
  }
}

/** A score as a small card: its map, and the figures when known; a plain link to osu! otherwise. */
export function scoreCard(ctx: Ctx, card: ScoreCard | null | undefined, ref: string | null | undefined, extra: Value = ''): Safe {
  const { t, fmt } = ctx;
  const href = scoreHref(ref);
  if (!card) {
    return html`<div class="t10-score t10-score-bare">${href ? html`<a href="${href}" target="_blank" rel="noopener">${t('This score on osu!')} ↗</a>` : t('A score')}${extra}</div>`;
  }
  const title = card.title ? `${card.artist ? `${card.artist} – ` : ''}${card.title}` : t('Map {id}', { id: card.map });
  const figures = [
    card.pp ? `${fmt.pp(card.pp)} pp` : '',
    card.mods && card.mods !== 'NM' ? `+${card.mods}` : '',
    card.acc ? fmt.acc(card.acc) : '',
    card.miss === 0 ? 'FC' : card.miss ? t('{n} ✕', { n: fmt.num(card.miss) }) : '',
    card.stars ? `★ ${fmt.num(card.stars, 2)}` : '',
  ].filter(Boolean).join(' · ');
  return html`<div class="t10-score">
    ${card.set ? html`<img class="t10-score-cover" src="https://assets.ppy.sh/beatmaps/${card.set}/covers/list.jpg" alt="" loading="lazy" data-hide-broken>` : html`<span class="t10-score-cover"></span>`}
    <span class="t10-score-text">
      <a class="t10-score-title" href="/map/${card.map}">${title}${card.version ? html` <span class="faint">[${card.version}]</span>` : ''}</a>
      <span class="t10-score-figs">${figures}${href ? html` · <a class="dim-link" href="${href}" target="_blank" rel="noopener">osu! ↗</a>` : ''}</span>
    </span>
    ${extra}
  </div>`;
}

/** What the endpoints answered, as the pages show it: 503 is "not on this copy", 401 "sign in". */
export type Trouble = 'off' | 'signin' | 'offline' | 'error' | null;

export function troubleOf(status: number): Trouble {
  if (status >= 200 && status < 300) return null;
  return status === 503 || status === 404 ? 'off' : status === 401 ? 'signin' : status === 0 ? 'offline' : 'error';
}

/** A line explaining trouble, with a way on. */
export function troubleNote(ctx: Ctx, trouble: Trouble, signIn: Value = ''): Safe | '' {
  const { t } = ctx;
  if (!trouble) return '';
  if (trouble === 'off') return html`<p class="notice">${t('Top 10 voting isn’t set up on this copy of the site.')}</p>`;
  if (trouble === 'signin') return html`<p class="notice">${t('Sign in with osu! to vote, endorse plays and thank write-ups.')} ${signIn}</p>`;
  if (trouble === 'offline') return html`<p class="notice">${t('The site couldn’t be reached. Check your connection and try again.')}</p>`;
  return html`<p class="notice">${t('That didn’t go through. Try again in a moment.')}</p>`;
}
