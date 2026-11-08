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
 * A write-up (top10/api.js Writeup). Yours: words, cites, flags, mod status and reason. On a public ballot: words, cites,
 * `thanks` (0 or 1: only its subject can thank it) and, signed in, `thanked`: whether you did (so you're its subject).
 */
export interface Writeup {
  body: string;
  cites?: string[];
  words?: number;
  flags?: string[] | string | null;
  mod?: 'ok' | 'struck';
  mod_reason?: string | null;
  thanks?: number;
  thanked?: boolean;
  updated?: string | null;
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

/** Your own ballot (GET /api/top10/ballot, PUT, submit, withdraw), draft or submitted. */
export interface OwnBallot extends Omit<BallotInput, 'writeups'> {
  year?: number;
  voter?: number;
  status: BallotStatus;
  submitted_at?: string | number | null;
  updated?: string | number | null;
  void_reason?: string | null;
  writeups: Record<string, Writeup>;
  /** The cited plays' cards, by ref. */
  scores?: Record<string, Card>;
}

/** A submitted ballot as anyone reads it (GET /api/top10/ballots). */
export interface PublicBallot {
  voter: number;
  picks: Pick[];
  mentions: number[];
  watch: number[];
  intro?: string | null;
  outro?: string | null;
  submitted_at?: string | number | null;
  updated?: string | number | null;
  /** Thanks on the whole ballot. */
  thanks?: number;
  writeups: Record<string, Writeup>;
  scores?: Record<string, Card>;
}

/** A mod action on your ballot, write-ups or showcase entries (GET /ballot `log`), or in the admin queue's log. */
export interface LogLine {
  seq?: number;
  year?: number;
  admin: number;
  action: string;
  target: string;
  reason?: string | null;
  at?: string | number | null;
}

/** GET /api/top10. `me` only when signed in; `editions` are the years whose results are out. */
export interface Hub {
  season: Season;
  /** Submitted yearly ballots so far (the deployed bot reads this one). */
  turnout: number;
  /** Submitted ballots of each kind (§13.11). */
  turnouts?: Partial<Record<Kind, number>>;
  finalized?: boolean;
  editions?: { year: number; label: string; kind?: Kind }[];
  me?: {
    osuId?: number; eligible: boolean; code?: string | null; reason?: string | null;
    /** The yearly ballot, as before; `ballots` has both kinds. */
    ballot: Partial<OwnBallot> | null;
    ballots?: Partial<Record<Kind, Partial<OwnBallot> | null>>;
  } | null;
}

/**
 * Which ballot (§13.11): the year's top 10, or the top 10 of all time, in the same window with the same rules but its
 * own candidates (anyone, legends included), no ones to watch, and cites from any year. Missing means 'year'.
 */
export type Kind = 'year' | 'alltime';
export const KINDS: readonly Kind[] = ['year', 'alltime'];
export const kindOf = (v: unknown): Kind => (v === 'alltime' ? 'alltime' : 'year');

/** Which part of the showcase: the season's plays, or "Legendary plays" from any year (§13.11). */
export type Scope = 'year' | 'alltime';

/** A ballot's name: "Top 10 of 2026" or "Top 10 of all time". */
export const kindName = ({ t }: Ctx, kind: Kind, year: number): string =>
  (kind === 'alltime' ? t('Top 10 of all time') : t('Top 10 of {year}', { year }));

/** A ballot of this kind from GET /api/top10's me: `ballots[kind]`, or the yearly `ballot` from before kinds. */
export const myBallotOf = (hub: Hub | null | undefined, kind: Kind): Partial<OwnBallot> | null =>
  hub?.me?.ballots?.[kind] ?? (kind === 'year' ? hub?.me?.ballot ?? null : null);

/** Submitted ballots of a kind: `turnouts[kind]`, or the yearly `turnout`. */
export const turnoutOf = (hub: Hub | null | undefined, kind: Kind): number | undefined =>
  hub?.turnouts?.[kind] ?? (kind === 'year' ? hub?.turnout : undefined);

/**
 * A play as a card (top10/api.js Card): resolved by the server when the play is showcased or cited, any field null when
 * not known. `url` is its osu! page (null for a map ref or an .osr). A cited showcase entry's card has `play` (its id)
 * and `clip` too.
 */
export interface Card {
  ref?: string | null;
  player?: number | null;
  map?: number | null;
  set?: number | null;
  artist?: string | null;
  title?: string | null;
  version?: string | null;
  stars?: number | null;
  pp?: number | null;
  acc?: number | null;
  miss?: number | null;
  combo?: number | null;
  mods?: string | null;
  grade?: string | null;
  /** Unix seconds. */
  time?: number | null;
  url?: string | null;
  play?: number | null;
  clip?: string | null;
}

/** A showcase entry (GET /api/top10/plays; in the admin queue with status, reason and target). */
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
  /** When the play was set. */
  played?: string | number | null;
  /** The season's showcase, or "Legendary plays" (§13.11); missing means 'year'. */
  scope?: Scope;
  status?: 'ok' | 'hidden';
  reason?: string | null;
  target?: string | null;
  endorsements?: number;
  endorsed?: boolean;
  score?: Card | null;
  /** Its replay (§13.9): osu!'s own download (signed in on osu! only), a .osr the site keeps, or none. */
  replay?: Replay | null;
}

export type Replay = { kind: 'osu'; url: string } | { kind: 'file'; url: string; name?: string | null };

/** The largest .osr the showcase takes (§13.9). */
export const MAX_REPLAY_BYTES = 2 * 1024 * 1024;

/**
 * How the showcase's form sends a replay file: multipart form data, field `replay`, which the backend takes (top10/api.js
 * POST /plays); 'base64' would send JSON with `replay: { name, data }` instead. Read by client/top10.ts showcaseBody().
 */
export const REPLAY_UPLOAD: 'multipart' | 'base64' = 'multipart';

/** A replay's download link (§13.9): osu!'s needs a sign-in there, which the link says. */
export function replayLink(ctx: Ctx, replay: Replay | null | undefined): Safe | '' {
  const { t } = ctx;
  if (!replay?.url) return '';
  if (replay.kind === 'osu') {
    return html`<span class="t10-replay"><a href="${replay.url}" target="_blank" rel="noopener">⬇ ${t('Download replay')} ↗</a> <span class="small faint">${t('needs you signed in on osu!')}</span></span>`;
  }
  // data.ptcatch.com serves it as an attachment under its name (cross-origin, so download="" alone wouldn't name it).
  return html`<span class="t10-replay"><a href="${replay.url}" ${replay.name ? html`download="${replay.name}"` : raw('download')}>⬇ ${t('Download replay')}</a>${replay.name ? html` <span class="small faint">${replay.name}</span>` : ''}</span>`;
}

/**
 * The past editions' labels (§13.10), for when GET /api/top10 can't be asked: the year key results take, and its label.
 * 2023–24 was one edition, keyed 2024. The server's `editions` list (the ones whose results are out) wins.
 */
export const PAST_EDITIONS: readonly (readonly [number, string])[] = [[2020, '2020'], [2021, '2021'], [2022, '2022'], [2024, '2023–24'], [2025, '2025']];

/** An edition's label: the server's, else "2023–24" for 2024, the year otherwise. */
export const editionLabel = (year: number, editions?: Hub['editions']): string =>
  editions?.find(e => e.year === year)?.label ?? PAST_EDITIONS.find(([y]) => y === year)?.[1] ?? String(year);

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

/** Bananas a write-up on a ranked player earns: 1 per word, at most 40 (decision 4, §9; the bot's min(40, words)). */
export const PEAK_WORDS = 40;
export const PEAK_BANANAS = 40;
export const bananasFor = (words: number): number => Math.min(PEAK_BANANAS, Math.max(0, Math.floor(words)));

/** Why a flag doesn't count, for the writer. */
export const flagText = ({ t }: Ctx, flag: string): string => ({
  repetitive: t('Looks repetitive, so it doesn’t count yet.'),
  copy: t('Looks copied from another write-up, so it doesn’t count yet.'),
  mash: t('Looks like keyboard mashing, so it doesn’t count yet.'),
} as Record<string, string>)[flag] ?? flag;

/**
 * The word counter under a write-up box: "18 words · 🍌 18 of 40", "🍌 40 of 40 (paid after the reveal)" from 40 words,
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
export function rules(ctx: Ctx, season: Season, kind: Kind = 'year'): Safe {
  const { t } = ctx;
  return html`<ol class="t10-rules">
    ${kind === 'alltime' ? html`<li>${t('All time means any PT player’s whole career, active or not: legends count.')}</li>` : ''}
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
 * A stored play's ref, in the server's canonical form (top10/refs.js): osu:<id> for a lazer score id, legacy:<id> for a
 * stable one (the packs keep those negative), else map:<beatmap>:<player>, that player's best play on the map this year.
 */
export const playRef = (sid: number | null | undefined, map: number, player: number): string =>
  (sid && sid > 0 ? `osu:${sid}` : sid && sid < 0 ? `legacy:${-sid}` : `map:${map}:${player}`);

/** A score's page on osu! from its ref (osu:, legacy:, a link, or a bare id as the packs keep them); null for the rest. */
export function scoreHref(ref: string | null | undefined): string | null {
  if (!ref) return null;
  const s = String(ref).trim();
  if (/^https?:\/\/osu\.ppy\.sh\//i.test(s)) return s;
  const m = s.match(/^(osu|legacy):(\d+)$/);
  if (m) return m[1] === 'osu' ? `https://osu.ppy.sh/scores/${m[2]}` : `https://osu.ppy.sh/scores/fruits/${m[2]}`;
  if (!/^-?\d+$/.test(s)) return null;
  const n = Number(s);
  return !Number.isSafeInteger(n) || n === 0 ? null : n > 0 ? `https://osu.ppy.sh/scores/${n}` : `https://osu.ppy.sh/scores/fruits/${-n}`;
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

/**
 * A play as a small card: its map, the figures, when it was set and its osu! page, from the server's card. A cited
 * showcase entry with no map (a clip or a replay file) reads as that, with its clip.
 */
export function scoreCard(ctx: Ctx, card: Card | null | undefined, ref: string | null | undefined, extra: Value = ''): Safe {
  const { t, fmt } = ctx;
  const href = card?.url ?? scoreHref(ref ?? card?.ref);
  if (!card?.map) {
    const showcased = Boolean(card?.play) || Boolean(ref?.startsWith('play:'));
    const who = card?.player ? html` <a class="dim-link" href="/top10/plays?player=${card.player}">${t('in the showcase')}</a>` : '';
    const text = showcased ? html`🎬 ${t('A play from the showcase')}${who}${card?.clip ? html` · <a href="${card.clip}" target="_blank" rel="noopener">${t('Watch the clip')} ↗</a>` : ''}`
      : href ? html`<a href="${href}" target="_blank" rel="noopener">${t('This score on osu!')} ↗</a>` : t('A score');
    return html`<div class="t10-score t10-score-bare">${text}${extra}</div>`;
  }
  const title = card.title ? `${card.artist ? `${card.artist} – ` : ''}${card.title}` : t('Map {id}', { id: card.map });
  const figures = [
    card.pp ? `${fmt.pp(card.pp)} pp` : '',
    card.mods && card.mods !== 'NM' ? `+${card.mods}` : '',
    card.acc ? fmt.acc(card.acc) : '',
    card.miss === 0 ? 'FC' : card.miss ? t('{n} ✕', { n: fmt.num(card.miss) }) : '',
    card.stars ? `★ ${fmt.num(card.stars, 2)}` : '',
    card.time ? fmt.date(card.time) : '',
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
