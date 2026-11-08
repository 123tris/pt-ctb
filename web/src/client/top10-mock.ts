// A stand-in for Top 10's endpoints, for working on the pages without the backend. client/top10.ts loads it only on a
// local address after ?top10mock=1; production never does. It answers the backend's shapes (top10/api.js, at the top:
// Ballot, Writeup, Card, Play, the canonical refs, refusals as { error, code }) from a state kept in this browser
// (localStorage), seeded with real players from the core pack: a few submitted ballots with write-ups and cites, and
// showcase entries from three players' plays of the year.
//
//   ?top10mock=1 / 0          turn it on / off in this browser
//   ?top10phase=open          early | before | open | closed | revealed (default open), kept until changed: early is
//                             before the showcase opens too; before is the showcase open and voting not yet
//   ?top10reset=1             start again from the seed
//
// Everyone is an admin here. For the real thing end to end: tools/serve.mjs --economy on the backend's branch.

import type { Answer } from './bananas.ts';
import { prefs } from './ui.ts';
import { store } from './boot.ts';
import { readCore, readPlayer, type CorePack, type PlayerPack } from '../gen/packs.ts';
import { CORE, playerPack } from '../routes.ts';
import { OWN_LIMIT, limitOf } from '../views/top10-plays.ts';
import { rowOf } from '../ui/players.ts';
import { mapDetails } from '../ui/playerpack.ts';
import { M, modString } from '../kernel/model.ts';
import {
  DEFAULT_SEASON, PAST_EDITIONS, flagsOf, overlap, spotsOf, wordsOf, MIN_PICKS, MAX_PICKS, MAX_EXTRAS, MAX_BODY, MAX_NOTE, MAX_CAPTION,
  MAX_REPLAY_BYTES, clipOk, playRef, scoreHref, type Card, type Phase, type Pick, type Scope, type Showcase, type ShowPlay,
} from '../ui/top10.ts';

interface MockWriteup { body: string; cites: string[]; words: number; flags: string[]; mod: 'ok' | 'struck'; mod_reason: string | null; updated: string }
interface MockBallot {
  voter: number; picks: Pick[]; mentions: number[]; watch: number[]; intro: string; outro: string;
  status: 'draft' | 'submitted' | 'void'; submitted_at: string | null; updated: string; void_reason: string | null;
  writeups: Record<string, MockWriteup>;
}
interface MockPlay extends ShowPlay { endorsers: number[] }
interface State {
  v: number;
  ballots: Record<string, MockBallot>;
  plays: MockPlay[];
  /** Cards by canonical ref: every play cited or showcased, as the server stores them. */
  cards: Record<string, Card>;
  thanks: [number, number][]; // [subject, voter]
  log: { seq: number; year: number; admin: number; action: string; target: string; reason: string; at: string }[];
  finalized: boolean;
  nextPlay: number;
}

const KEY = 'top10mockState';
const VERSION = 6;
const YEAR = DEFAULT_SEASON.year;
const now = () => new Date().toISOString();
const ok = (body: unknown, status = 200): Answer => ({ ok: true, status, body });
/** A refusal as the backend sends one: { error, code, …details }. */
const no = (status: number, code: string, error: string, extra: Record<string, unknown> = {}): Answer => ({ ok: false, status, body: { error, code, ...extra } });

type MockPhase = Phase | 'early';

function phase(): MockPhase {
  const asked = new URLSearchParams(location.search).get('top10phase');
  if (asked && ['early', 'before', 'open', 'closed', 'revealed'].includes(asked)) prefs.set('top10mockPhase', asked);
  return prefs.get('top10mockPhase', 'open');
}

/** The showcase's window in a mock phase: it opens before voting does, and closes with it. */
const showcaseIn = (ph: MockPhase): Showcase => (ph === 'early' ? 'before' : ph === 'before' || ph === 'open' ? 'open' : 'closed');

/** A number from 0 to 1 that's the same for the same seed. */
const rand = (seed: number) => { const x = Math.sin(seed * 9301 + 49297) * 233280; return x - Math.floor(x); };

const SAMPLES = [
  'What a year. The HR plays on the hard Loved maps were something else, and the consistency in the weekly challenges kept them at the top all year. Nobody else in Portugal FCs those maps.',
  'Subiu imenso este ano. Lembro-me do FC no mapa da semana em março, ninguém estava à espera. Merece estar aqui, e acho que para o ano vai estar ainda mais acima.',
  'Consistent, humble and always helping newer players in the Discord. The duels this year were a highlight.',
  'Top 3 sem dúvida. O Dan 7 foi histórico para nós.',
  'Grinded the converts board like nobody else.',
  'idk man just look at the profile, the pp speaks for itself lol',
];
const INTROS = ['Ranked by what I saw this year, not by pp alone.', 'Lista feita com base nos perfis e no que vi no Discord.'];
const OUTROS = ['GG to everyone, see you next year.', 'Obrigado a todos pelo ano!'];

// ---- Plays, refs and cards ------------------------------------------------------------------------------------------

/** A player's plays of the year as cards, under their canonical refs (top10/refs.js), the most pp first. */
function yearCards(pack: PlayerPack, player: number, max: number): Card[] {
  const out: (Card & { ref: string })[] = [];
  const from = Date.UTC(YEAR, 0, 1) / 1000, to = Date.UTC(YEAR + 1, 0, 1) / 1000;
  for (const cat of ['c', 'u', 'r'] as const) {
    const list = pack[cat];
    for (let i = 0; i < list.rows; i++) {
      if (list.time[i] < from || list.time[i] >= to) continue;
      const meta = mapDetails(pack, list.map[i]);
      const ref = playRef(list.sid[i], list.map[i], player);
      const none = (v: number) => (v === 0xFFFFFFFF ? null : v);
      out.push({
        ref, player, map: list.map[i], set: meta?.[M.SET] ?? null, artist: meta?.[M.ARTIST] ?? null, title: meta?.[M.TITLE] ?? null,
        version: meta?.[M.VERSION] ?? null, stars: meta?.[M.STARS] ?? null, pp: list.pp[i] / 100, acc: list.acc[i] / 100,
        miss: none(list.miss[i]), combo: none(list.combo[i]), mods: modString(list.mods[i]), grade: null, time: list.time[i], url: scoreHref(ref),
      });
    }
  }
  return out.sort((a, b) => (b.pp ?? 0) - (a.pp ?? 0)).slice(0, max);
}

/** osu!'s own replay download for an osu:/legacy: score (§13.9: only when osu! keeps one; the mock says it does). */
function osuReplay(ref: string): ShowPlay['replay'] {
  const m = ref.match(/^(osu|legacy):(\d+)$/);
  return m ? { kind: 'osu', url: m[1] === 'osu' ? `https://osu.ppy.sh/scores/${m[2]}/download` : `https://osu.ppy.sh/scores/fruits/${m[2]}/download` } : null;
}

/** A ref as sent (a canonical one, a score link, a bare id, map:<beatmap> with the player apart) in canonical form. */
function canonical(raw: unknown, player: number | null): string | null {
  const s = String(raw ?? '').trim();
  if (/^(osu|legacy):\d+$/.test(s) || /^map:\d+:\d+$/.test(s) || /^play:\d+$/.test(s)) return s;
  const legacy = s.match(/osu\.ppy\.sh\/scores\/fruits\/(\d+)/);
  if (legacy) return `legacy:${legacy[1]}`;
  const lazer = s.match(/osu\.ppy\.sh\/scores\/(\d+)/);
  if (lazer) return `osu:${lazer[1]}`;
  if (/^-\d+$/.test(s)) return `legacy:${s.slice(1)}`;
  if (/^\d+$/.test(s)) return `osu:${s}`;
  const map = s.match(/^map:(\d+)$/);
  return map && player ? `map:${map[1]}:${player}` : null;
}

let core: CorePack | null = null;
/** Cards for osu:/legacy: refs, from the first few active players' packs (the real server asks osu!). */
let known: Map<string, Card> | null = null;

/** A play's card by canonical ref, or null when "the data" doesn't have it. */
async function cardOf(ref: string): Promise<Card | null> {
  const map = ref.match(/^map:(\d+):(\d+)$/);
  if (map) {
    const pack = await store.pack(playerPack(Number(map[2])), readPlayer).catch(() => null);
    return pack ? yearCards(pack, Number(map[2]), 500).find(c => c.ref === ref) ?? null : null;
  }
  return known!.get(ref) ?? null;
}

/** The players the seed draws from: the most pp first, active this year. */
function activeIds(c: CorePack): number[] {
  const from = Date.UTC(YEAR, 0, 1) / 1000;
  const rows = [...Array(c.players.rows).keys()].filter(r => c.players.last[r] >= from);
  return rows.sort((a, b) => c.players.pp[b] - c.players.pp[a]).map(r => c.players.id[r]);
}

// ---- The state ------------------------------------------------------------------------------------------------------

async function seed(): Promise<State> {
  const ids = activeIds(core!);
  const top = ids.slice(0, 24);
  const voters = top.slice(0, 7).filter((_, i) => i !== 1);
  const state: State = { v: VERSION, ballots: {}, plays: [], cards: {}, thanks: [], log: [], finalized: false, nextPlay: 1 };
  // Showcase: three players' best plays of the year, and a clip.
  for (const [i, id] of top.slice(0, 3).entries()) {
    for (const [j, card] of yearCards(await store.pack(playerPack(id), readPlayer), id, 2).entries()) {
      const ref = card.ref!;
      state.cards[ref] = card;
      state.plays.push({
        id: state.nextPlay++, year: YEAR, submitter: voters[(i + j + 1) % voters.length], player: id, score_ref: ref, beatmap_id: card.map ?? null,
        caption: j === 0 ? 'Best play of the year in Portugal, easily.' : 'Pouca gente faz isto com HR.', clip: null, created: now(),
        played: card.time ? new Date(card.time * 1000).toISOString() : null, status: 'ok', endorsers: voters.filter((_, k) => rand(k + i * 3 + j) > 0.4),
        score: card, replay: osuReplay(ref),
      });
    }
  }
  const clip = { id: state.nextPlay++, year: YEAR, submitter: voters[2], player: top[4], score_ref: null, beatmap_id: null, caption: 'Offline ScoreV2 run the site can’t see.',
    clip: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', created: now(), played: null, status: 'ok' as const, endorsers: [voters[0]], score: null, replay: null };
  state.plays.push(clip);
  // Ballots, with write-ups citing the showcase.
  voters.forEach((voter, v) => {
    const others = top.filter(id => id !== voter).sort((a, b) => rand(a + v * 7) - rand(b + v * 7) + (top.indexOf(a) - top.indexOf(b)) / 8);
    const n = 6 + (v % 5);
    const rows = others.slice(0, n).map((id, i) => ({ id, tie: i === 5 && v % 2 === 0 }));
    const spots = spotsOf(rows);
    const picks = rows.map((r, i) => ({ id: r.id, spot: spots[i] }));
    const writeups: Record<string, MockWriteup> = {};
    picks.slice(0, 3 + (v % 4)).forEach((p, i) => {
      const body = SAMPLES[(v + i) % SAMPLES.length];
      const shown = state.plays.find(x => x.player === p.id);
      const cites = shown && i % 2 === 0 ? [shown.score_ref ?? `play:${shown.id}`] : [];
      writeups[p.id] = { body, cites, words: wordsOf(body).length, flags: flagsOf(body), mod: 'ok', mod_reason: null, updated: now() };
    });
    state.ballots[voter] = {
      voter, picks, mentions: others.slice(n, n + 2), watch: [ids[30 + v] ?? others[n + 3]].filter(Boolean), intro: INTROS[v % 2], outro: v % 3 ? OUTROS[v % 2] : '',
      status: 'submitted', submitted_at: new Date(Date.now() - (v + 1) * 86400e3).toISOString(), updated: now(), void_reason: null, writeups,
    };
    for (const subject of Object.keys(writeups)) if (rand(Number(subject) + voter) > 0.6) state.thanks.push([Number(subject), voter]);
  });
  // A filler write-up for the mods' queue.
  const filler = 'good good good good player player player good good';
  const first = state.ballots[voters[0]];
  const subj = first.picks[first.picks.length - 1].id;
  first.writeups[subj] = { body: filler, cites: [], words: wordsOf(filler).length, flags: flagsOf(filler), mod: 'ok', mod_reason: null, updated: now() };
  state.cards[`play:${clip.id}`] = { ref: `play:${clip.id}`, player: clip.player, play: clip.id, clip: clip.clip, url: null };
  return state;
}

async function load(): Promise<State> {
  core ??= await store.pack(CORE, readCore);
  if (!known) {
    known = new Map();
    for (const id of activeIds(core).slice(0, 6)) {
      for (const card of yearCards(await store.pack(playerPack(id), readPlayer), id, 25)) if (!card.ref!.startsWith('map:')) known.set(card.ref!, card);
    }
  }
  if (new URLSearchParams(location.search).get('top10reset') === '1') prefs.set(KEY, null);
  const saved: State | null = prefs.get(KEY, null);
  if (saved?.v === VERSION) return saved;
  const fresh = await seed();
  prefs.set(KEY, fresh);
  return fresh;
}

const save = (s: State) => prefs.set(KEY, s);
const isPt = (id: number) => rowOf(core!.players, id) >= 0;
const nameRow = (name: string) => [...Array(core!.players.rows).keys()].find(r => core!.players.name.at(r).toLowerCase() === name.toLowerCase());

function wordsAndFlags(s: State, voter: number, subject: string, body: string): { words: number; flags: string[] } {
  const others: string[] = [];
  for (const b of Object.values(s.ballots)) for (const [subj, w] of Object.entries(b.writeups)) if (!(b.voter === voter && subj === subject)) others.push(w.body);
  const flags: string[] = flagsOf(body).filter(f => f !== 'copy');
  if (wordsOf(body).length >= 3 && others.some(o => overlap(body, o) >= 0.7)) flags.push('copy');
  return { words: wordsOf(body).length, flags };
}

/** The cards a ballot's cites need, by ref. */
function scoresOf(s: State, b: MockBallot): Record<string, Card> {
  const out: Record<string, Card> = {};
  for (const w of Object.values(b.writeups)) for (const ref of w.cites) if (s.cards[ref]) out[ref] = s.cards[ref];
  return out;
}

/** Your own ballot, as GET /ballot and PUT answer it. */
const ownView = (s: State, b: MockBallot) => ({
  year: YEAR, voter: b.voter, status: b.status, picks: b.picks, mentions: b.mentions, watch: b.watch, skills: null, intro: b.intro, outro: b.outro,
  submitted_at: b.submitted_at, updated: b.updated, void_reason: b.void_reason,
  writeups: Object.fromEntries(Object.entries(b.writeups).map(([k, w]) => [k, { ...w, thanks: s.thanks.some(([su, v]) => String(su) === k && v === b.voter) ? 1 : 0 }])),
  scores: scoresOf(s, b),
});

function checkSubmit(b: MockBallot): string | null {
  const ids = b.picks.map(p => p.id);
  if (ids.length < MIN_PICKS || ids.length > MAX_PICKS) return 'Rank 5 to 10 players.';
  if (new Set(ids).size !== ids.length) return 'Each player can only be on your list once.';
  if (ids.includes(b.voter) || b.mentions.includes(b.voter) || b.watch.includes(b.voter)) return 'You can’t vote for yourself.';
  if (!ids.every(isPt)) return 'Only PT players can be ranked.';
  const spots = b.picks.map(p => p.spot);
  if (spots[0] !== 1 || spots.some((x, i) => i > 0 && x !== spots[i - 1] && x !== i + 1)) return 'The spots don’t add up.';
  return null;
}

/** 13.5: the combined ranking from the counted ballots. */
function results(s: State, year: number) {
  const counted = Object.values(s.ballots).filter(b => b.status === 'submitted');
  const per = new Map<number, { id: number; points: number; lists: number; firsts: number; positions: number[]; places: number[]; mentions: number; watch: number }>();
  const get = (id: number) => { let p = per.get(id); if (!p) per.set(id, p = { id, points: 0, lists: 0, firsts: 0, positions: Array(10).fill(0), places: [], mentions: 0, watch: 0 }); return p; };
  for (const b of counted) {
    const bySpot = new Map<number, number[]>();
    for (const p of b.picks) bySpot.set(p.spot, [...(bySpot.get(p.spot) ?? []), p.id]);
    for (const [spot, group] of bySpot) {
      const avg = group.map((_, k) => spot + k).reduce((n, pos) => n + (pos <= 10 ? 11 - pos : 0), 0) / group.length;
      for (const id of group) {
        const p = get(id);
        p.points += avg; p.lists++; if (spot === 1) p.firsts++; if (spot <= 10) p.positions[spot - 1]++; p.places.push(spot);
      }
    }
    b.mentions.forEach(id => get(id).mentions++);
    b.watch.forEach(id => get(id).watch++);
  }
  const voters = new Set(counted.map(b => b.voter));
  const median = (xs: number[]) => { const a = [...xs].sort((x, y) => x - y); return a.length ? (a[(a.length - 1) >> 1] + a[a.length >> 1]) / 2 : 99; };
  const ranking = [...per.values()].filter(p => p.points > 0).map(p => {
    const eligible = counted.length - (voters.has(p.id) ? 1 : 0);
    return { id: p.id, score: Math.round((p.points / Math.max(1, eligible)) * 100) / 100, points: Math.round(p.points * 100) / 100, lists: p.lists, eligible, firsts: p.firsts,
      positions: p.positions, best: Math.min(...p.places), worst: Math.max(...p.places), mentions: p.mentions, watch: p.watch, median: median(p.places) };
  }).sort((a, b) => b.score - a.score || b.lists - a.lists || b.firsts - a.firsts || a.median - b.median || b.mentions - a.mentions);
  let rank = 0;
  const ranked = ranking.map((r, i) => {
    const prev = ranking[i - 1];
    if (!prev || prev.score !== r.score || prev.lists !== r.lists || prev.firsts !== r.firsts || prev.median !== r.median || prev.mentions !== r.mentions) rank = i + 1;
    const { median: _m, ...rest } = r;
    return { ...rest, rank };
  });
  const writeups = counted.flatMap(b => Object.entries(b.writeups).filter(([, w]) => w.mod === 'ok'));
  return {
    year, ballots: counted.length, finalizedAt: now(), ranking: ranked,
    mentions: [...per.values()].filter(p => p.mentions).map(p => ({ id: p.id, count: p.mentions })),
    watch: [...per.values()].filter(p => p.watch).map(p => ({ id: p.id, count: p.watch })),
    stats: { writeups: writeups.length, words: writeups.reduce((n, [, w]) => n + w.words, 0), subjects: new Set(writeups.map(([x]) => x)).size },
  };
}

/** 13.6: one payout per counted ballot, and thanks on approved write-ups, as the requests finalize queues. */
function payouts(s: State, year: number) {
  const counted = Object.values(s.ballots).filter(b => b.status === 'submitted');
  return {
    payouts: counted.map(b => {
      const writeups = b.picks.map(p => ({ subject: p.id, w: b.writeups[p.id] }))
        .filter(({ w }) => w && w.mod === 'ok' && !w.flags.length).map(({ subject, w }) => ({ subject, words: w.words }));
      return { osuId: b.voter, type: 'top10.payout', payload: { year, ballot: true, writeups, allFull: b.picks.every(p => (writeups.find(w => w.subject === p.id)?.words ?? 0) >= 40) } };
    }),
    thanks: s.thanks.filter(([subject, voter]) => counted.some(b => b.voter === voter && b.writeups[subject]?.mod === 'ok' && !b.writeups[subject].flags.length))
      .map(([subject, voter]) => ({ osuId: voter, type: 'top10.thanks', payload: { year, subject } })),
  };
}

/** An .osr's header (§13.9): ruleset, game version, the map's MD5 and the player's name (osu!'s ULEB128 strings). */
function osrHeader(bytes: Uint8Array): { mode: number; md5: string; player: string } | null {
  let at = 0;
  const str = (): string | null => {
    if (bytes[at] === 0x00) { at++; return ''; }
    if (bytes[at++] !== 0x0b) return null;
    let len = 0, shift = 0, byte: number;
    do { byte = bytes[at++]; len |= (byte & 0x7f) << shift; shift += 7; } while (byte & 0x80 && at < bytes.length);
    const text = new TextDecoder().decode(bytes.subarray(at, at + len));
    at += len;
    return text;
  };
  if (bytes.length < 8) return null;
  const mode = bytes[at];
  at += 5;
  const md5 = str(), player = str();
  return md5 === null || player === null ? null : { mode, md5, player };
}

/** The file the site keeps (§13.9): replays/<sha256>.osr on data.ptcatch.com, under a friendly name. */
async function storedReplay(file: File, player: string): Promise<ShowPlay['replay']> {
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()))].map(x => x.toString(16).padStart(2, '0')).join('');
  return { kind: 'file', url: `https://data.ptcatch.com/replays/${hash}.osr`, name: `${player} - ${file.name.replace(/\.osr$/i, '')}.osr` };
}

const playView = ({ endorsers, ...p }: MockPlay, me: number | null) => ({ ...p, endorsements: endorsers.length, ...(me !== null ? { endorsed: endorsers.includes(me) } : {}) });

// ---- The endpoints --------------------------------------------------------------------------------------------------

export async function handle(method: string, path: string, body: unknown, me: number | null): Promise<Answer> {
  await new Promise(r => setTimeout(r, 120));
  const url = new URL(path, location.origin);
  const year = Number(url.searchParams.get('year')) || YEAR;
  const s = await load();
  const mockPhase = phase();
  const ph: Phase = mockPhase === 'early' ? 'before' : mockPhase;
  const showcase = showcaseIn(mockPhase);
  const season = { ...DEFAULT_SEASON, phase: ph, showcase };
  const route = `${method} ${url.pathname}`;
  // A multipart body (a showcase entry with a replay file) as its text fields, with the file aside.
  const file = body instanceof FormData && body.get('replay') instanceof File ? body.get('replay') as File : null;
  const b = (body instanceof FormData ? Object.fromEntries([...body].filter(([, v]) => typeof v === 'string')) : body ?? {}) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const signed = me !== null;
  const own = () => s.ballots[me!];
  const eligible = () => (isPt(me!) ? { eligible: true } : { eligible: false, code: 'not_pt', reason: 'Only PT players on the site can take part.' });
  const notOpen = () => (ph === 'before' ? no(409, 'not_open', 'Voting opens on 2026-12-01.', { phase: ph }) : no(409, 'closed', 'Voting has closed.', { phase: ph }));
  const showcaseShut = () => (showcase === 'before' ? no(409, 'not_open', 'The showcase opens on 2026-11-08.', { phase: ph, showcase })
    : no(409, 'closed', 'The showcase has closed.', { phase: ph, showcase }));

  if (route === 'GET /api/top10') {
    const turnout = Object.values(s.ballots).filter(x => x.status === 'submitted').length;
    return ok({
      season, turnout, finalized: s.finalized, editions: PAST_EDITIONS.map(([y, label]) => ({ year: y, label })),
      ...(signed ? { me: { osuId: me, ...eligible(), ballot: own() ? ownView(s, own()) : null } } : {}),
    });
  }
  if (route === 'GET /api/top10/ballots') {
    const ballots = Object.values(s.ballots).filter(x => x.status === 'submitted' && year === YEAR)
      .sort((a, c) => String(a.submitted_at).localeCompare(String(c.submitted_at))).map(x => {
        const writeups: Record<string, unknown> = {};
        for (const [subject, w] of Object.entries(x.writeups)) {
          if (w.mod === 'struck') continue;
          const thanked = s.thanks.some(([su, v]) => String(su) === subject && v === x.voter);
          writeups[subject] = { body: w.body, words: w.words, cites: w.cites, thanks: thanked ? 1 : 0, updated: w.updated, ...(signed ? { thanked: thanked && String(me) === subject } : {}) };
        }
        return {
          voter: x.voter, picks: x.picks, mentions: x.mentions, watch: x.watch, skills: null, intro: x.intro, outro: x.outro, submitted_at: x.submitted_at, updated: x.updated,
          thanks: s.thanks.filter(([, v]) => v === x.voter).length, writeups, scores: scoresOf(s, x),
        };
      });
    return ok({ year, ballots });
  }
  if (route === 'GET /api/top10/ballot') {
    if (!signed) return no(401, '', 'Sign in with osu! first.');
    const mine = own();
    const log = s.log.filter(l => l.target === `ballot:${me}` || l.target.startsWith(`writeup:${me}:`)
      || s.plays.some(p => p.submitter === me && l.target === `play:${p.id}`));
    return ok({ season, ...eligible(), ballot: mine ? ownView(s, mine) : null, log });
  }
  if (route === 'PUT /api/top10/ballot') {
    if (!signed) return no(401, '', 'Sign in with osu! first.');
    if (!isPt(me!)) return no(403, 'not_pt', 'Only PT players on the site can take part.');
    if (ph !== 'open') return notOpen();
    const before = own();
    const picks: Pick[] = (b.picks ?? before?.picks ?? []).slice(0, MAX_PICKS);
    const mentions: number[] = (b.mentions ?? before?.mentions ?? []).slice(0, MAX_EXTRAS), watch: number[] = (b.watch ?? before?.watch ?? []).slice(0, MAX_EXTRAS);
    const listed = new Set([...picks.map(p => String(p.id)), ...mentions.map(String), ...watch.map(String)]);
    // `writeups` merges: an empty body (or null) deletes one; one on anyone no longer listed goes.
    const writeups: Record<string, MockWriteup> = Object.fromEntries(Object.entries(before?.writeups ?? {}).filter(([k]) => listed.has(k)));
    for (const [subject, w] of Object.entries((b.writeups ?? {}) as Record<string, { body?: string; cites?: string[] } | null>)) {
      if (!listed.has(subject)) return no(400, 'not_listed', 'Write-ups are only for players on your list, mentions or ones to watch.');
      if (!w || !w.body?.trim()) { delete writeups[subject]; continue; }
      const text = w.body.slice(0, MAX_BODY);
      const cites: string[] = [];
      for (const raw of (w.cites ?? []).slice(0, 5)) {
        const ref = canonical(raw, Number(subject));
        const card = ref ? s.cards[ref] ?? await cardOf(ref) : null;
        if (!ref || !card) return no(400, 'cite', 'The site’s data has no such play to cite.', { ref: raw });
        s.cards[ref] = card;
        cites.push(ref);
      }
      const prev = writeups[subject];
      const same = prev && prev.body === text;
      writeups[subject] = { body: text, cites, ...wordsAndFlags(s, me!, subject, text), mod: same ? prev.mod : 'ok', mod_reason: same ? prev.mod_reason : null, updated: same ? prev.updated : now() };
    }
    s.ballots[me!] = {
      voter: me!, picks, mentions, watch, intro: String(b.intro ?? before?.intro ?? '').slice(0, MAX_NOTE), outro: String(b.outro ?? before?.outro ?? '').slice(0, MAX_NOTE),
      status: before?.status ?? 'draft', submitted_at: before?.submitted_at ?? null, updated: now(), void_reason: before?.void_reason ?? null, writeups,
    };
    save(s);
    return ok({ ballot: ownView(s, s.ballots[me!]) });
  }
  if (route === 'POST /api/top10/ballot/submit' || route === 'POST /api/top10/ballot/withdraw') {
    if (!signed) return no(401, '', 'Sign in with osu! first.');
    if (ph !== 'open') return notOpen();
    const mine = own();
    if (!mine) return no(409, 'no_ballot', 'Save your list first.');
    if (mine.status === 'void') return no(409, 'void', `This ballot was voided: ${mine.void_reason}`);
    if (route.endsWith('submit')) {
      const problem = checkSubmit(mine);
      if (problem) return no(400, 'picks', problem);
      mine.status = 'submitted';
      mine.submitted_at ??= now();
    } else {
      mine.status = 'draft';
      mine.submitted_at = null;
    }
    save(s);
    return ok({ ballot: ownView(s, mine) });
  }
  if (route === 'GET /api/top10/plays') {
    const player = Number(url.searchParams.get('player')) || null;
    const scope: Scope = url.searchParams.get('scope') === 'alltime' ? 'alltime' : 'year';
    const plays = s.plays.filter(p => p.status === 'ok' && (p.scope ?? 'year') === scope && (!player || p.player === player)).map(p => playView(p, me))
      .sort((a, c) => c.endorsements - a.endorsements || String(c.created).localeCompare(String(a.created)));
    return ok({ year, scope, plays });
  }
  if (route === 'POST /api/top10/plays') {
    if (!signed) return no(401, '', 'Sign in with osu! first.');
    if (!isPt(me!)) return no(403, 'not_pt', 'Only PT players on the site can take part.');
    if (showcase !== 'open') return showcaseShut();
    const scope: Scope = b.scope === 'alltime' ? 'alltime' : 'year';
    const mine = s.plays.filter(p => p.submitter === me && (p.scope ?? 'year') === scope);
    if (mine.length >= limitOf(scope)) return no(429, 'limit', `That’s ${limitOf(scope)} entries this season: remove one to add another.`);
    const caption = String(b.caption ?? '').slice(0, MAX_CAPTION);
    // The replay file, when there's one: a catch replay by a PT player (§13.9), at most 2 MB.
    let header: { mode: number; md5: string; player: string } | null = null;
    if (file) {
      if (file.size > MAX_REPLAY_BYTES) return no(413, 'too_big', 'A replay can be 2 MB at most.');
      header = osrHeader(new Uint8Array(await file.arrayBuffer()));
      if (!header) return no(400, 'osr', 'That file isn’t an osu! replay (.osr).');
      if (header.mode !== 2) return no(400, 'mode', 'That replay isn’t osu!catch.');
      if (nameRow(header.player) === undefined) return no(400, 'not_pt', `The replay’s player, ${header.player}, isn’t a PT player on the site.`);
    }
    // The file is stored only when osu! doesn't keep the score's replay (the mock says it does for every osu:/legacy: score).
    const osuKeeps = file && b.score ? osuReplay(canonical(b.score, Number(b.player) || null) ?? '') : null;
    const replay = file && header && !osuKeeps ? await storedReplay(file, header.player) : null;
    let entry: MockPlay;
    if (b.score !== undefined && b.score !== '') {
      if (String(b.score).startsWith('play:')) return no(400, 'score', 'score is an osu! score link, an osu: or legacy: ref, or a map: ref.');
      const ref = canonical(b.score, Number(b.player) || null);
      const card = ref ? await cardOf(ref) : null;
      if (!ref || !card) return no(400, 'not_in_data', 'That score isn’t in the site’s data yet: add it with /addscore first, or attach its replay (.osr) or a clip.');
      if (Number(b.player) && card.player !== Number(b.player)) return no(400, 'not_theirs', 'That score is another player’s.');
      const dup = s.plays.find(p => p.score_ref === ref && p.status === 'ok');
      if (dup) return no(409, 'duplicate', 'That play is already in the showcase.', { id: dup.id });
      s.cards[ref] = card;
      entry = { id: s.nextPlay++, year, submitter: me!, player: card.player!, score_ref: ref, beatmap_id: card.map ?? null, caption, clip: b.clip ?? null, created: now(),
        played: card.time ? new Date(card.time * 1000).toISOString() : null, status: 'ok', endorsers: [], score: card, replay: osuReplay(ref) ?? replay };
    } else if (file && header) {
      const player = core!.players.id[nameRow(header.player)!];
      entry = { id: s.nextPlay++, year, submitter: me!, player, score_ref: null, beatmap_id: null, caption, clip: null, created: now(), played: null, status: 'ok',
        endorsers: [], score: { ref: null, player, map: null, url: null }, replay };
    } else {
      if (!isPt(Number(b.player))) return no(400, 'not_pt', 'That player isn’t a PT player on the site.');
      if (!clipOk(String(b.clip ?? ''))) return no(400, 'clip', 'A clip must be a link on youtube.com, youtu.be, twitch.tv or streamable.com.');
      entry = { id: s.nextPlay++, year, submitter: me!, player: Number(b.player), score_ref: null, beatmap_id: null, caption, clip: String(b.clip), created: now(),
        played: null, status: 'ok', endorsers: [], score: null, replay: null };
    }
    if (entry.player === me && mine.filter(p => p.player === me).length >= OWN_LIMIT) return no(429, 'own_limit', `At most ${OWN_LIMIT} of your own plays a season.`);
    if (entry.player !== me && mine.some(p => p.player === entry.player)) return no(429, 'other_limit', 'You’ve already added a play by that player: one per player.');
    entry.scope = scope;
    s.plays.push(entry);
    s.cards[`play:${entry.id}`] = { ...(entry.score ?? {}), ref: `play:${entry.id}`, player: entry.player, play: entry.id, clip: entry.clip };
    save(s);
    return ok({ play: playView(entry, me), ...(file ? { replay: osuKeeps ? 'osu' : 'kept' } : {}) }, 201);
  }
  const playMatch = url.pathname.match(/^\/api\/top10\/plays\/(\d+)(\/endorse)?$/);
  if (playMatch) {
    if (!signed) return no(401, '', 'Sign in with osu! first.');
    const p = s.plays.find(x => x.id === Number(playMatch[1]));
    if (!p) return no(404, 'no_play', 'No such showcase entry.');
    if (method === 'DELETE' && !playMatch[2]) {
      if (p.submitter !== me) return no(403, 'not_yours', 'Only whoever added an entry can remove it.');
      s.plays = s.plays.filter(x => x !== p);
      save(s);
      return ok({ ok: true });
    }
    if (method === 'POST' && playMatch[2]) {
      const want = typeof b.endorsed === 'boolean' ? b.endorsed : !p.endorsers.includes(me!);
      p.endorsers = want ? [...new Set([...p.endorsers, me!])] : p.endorsers.filter(x => x !== me);
      save(s);
      return ok({ endorsed: want, endorsements: p.endorsers.length });
    }
  }
  if (route === 'POST /api/top10/thanks') {
    if (!signed) return no(401, '', 'Sign in with osu! first.');
    const voter = Number(b.voter);
    const ballot = s.ballots[voter];
    if (!ballot || ballot.status !== 'submitted') return no(404, 'not_public', 'That ballot isn’t public.');
    if (!ballot.writeups[me!]) return no(404, 'no_writeup', 'There’s no write-up about you on that ballot.');
    const had = s.thanks.some(([su, v]) => su === me && v === voter);
    const want = typeof b.thanked === 'boolean' ? b.thanked : !had;
    if (had && !want && s.finalized) return no(409, 'final', 'Thanks can’t be taken back once the results are final.');
    s.thanks = want ? (had ? s.thanks : [...s.thanks, [me!, voter]]) : s.thanks.filter(([su, v]) => !(su === me && v === voter));
    save(s);
    return ok({ thanked: want, thanks: want ? 1 : 0 });
  }
  if (route === 'GET /api/top10/results') {
    if (year === YEAR && ph !== 'revealed') return no(404, 'not_yet', 'The results aren’t out yet.');
    if (year !== YEAR) return no(404, 'not_published', 'There are no results for that year.');
    return ok(results(s, year));
  }
  if (url.pathname.startsWith('/api/top10/admin/')) {
    if (!signed) return no(401, '', 'Sign in with osu! first.');
    if (route === 'GET /api/top10/admin/queue') {
      const writeups = Object.values(s.ballots).flatMap(x => Object.entries(x.writeups).map(([subject, w]) => ({
        voter: x.voter, subject: Number(subject), body: w.body, words: w.words, cites: w.cites, flags: w.flags, mod: w.mod, mod_reason: w.mod_reason,
        updated: w.updated, ranked: x.picks.some(p => String(p.id) === subject), ballot_status: x.status, target: `writeup:${x.voter}:${subject}`,
        own: Number(subject) === me || x.voter === me,
      }))).sort((a, c) => Number(c.flags.length > 0) - Number(a.flags.length > 0) || String(c.updated).localeCompare(String(a.updated)));
      const plays = s.plays.map(p => ({ ...playView(p, me), target: `play:${p.id}` }));
      const ballots = Object.values(s.ballots).map(x => (x.status === 'draft'
        ? { voter: x.voter, status: x.status, updated: x.updated, target: `ballot:${x.voter}`, own: x.voter === me }
        : { ...ownView(s, x), writeups: undefined, target: `ballot:${x.voter}`, own: x.voter === me }));
      return ok({ season, phase: ph, year, finalized: s.finalized, writeups, plays, ballots, log: [...s.log].reverse() });
    }
    if (route === 'POST /api/top10/admin/action') {
      const action = String(b.action), reason = String(b.reason ?? '').trim();
      const target = typeof b.target === 'object' && b.target ? `writeup:${b.target.voter}:${b.target.subject}` : String(b.target ?? '');
      if (['strike', 'hide-play', 'void'].includes(action) && !reason) return no(400, 'reason', 'Say why: the player sees the reason.');
      const [kind, a, c] = target.includes(':') ? target.split(':') : ['id', target];
      if (action === 'strike' || action === 'restore') {
        const [voter, subject] = kind === 'writeup' ? [Number(a), Number(c)] : [Number(kind), Number(a)];
        const w = s.ballots[voter]?.writeups[subject];
        if (!w) return no(404, 'no_writeup', 'No such write-up.');
        if (subject === me || voter === me) return no(403, 'self', 'That write-up is about you (or yours): the other mod handles it.');
        if (action === 'strike') { w.mod = 'struck'; w.mod_reason = reason; } else { w.mod = 'ok'; w.mod_reason = null; w.flags = []; }
        s.log.push({ seq: s.log.length + 1, year: YEAR, admin: me!, action, target: `writeup:${voter}:${subject}`, reason, at: now() });
      } else if (action === 'hide-play' || action === 'show-play') {
        const id = Number(kind === 'play' ? a : kind === 'id' ? a : target);
        const p = s.plays.find(x => x.id === id);
        if (!p) return no(404, 'no_play', 'No such showcase entry.');
        p.status = action === 'hide-play' ? 'hidden' : 'ok';
        p.reason = action === 'hide-play' ? reason : null;
        s.log.push({ seq: s.log.length + 1, year: YEAR, admin: me!, action, target: `play:${id}`, reason, at: now() });
      } else if (action === 'void' || action === 'unvoid') {
        const voter = Number(kind === 'ballot' ? a : kind === 'id' ? a : target);
        const x = s.ballots[voter];
        if (!x) return no(404, 'no_ballot', 'No such ballot.');
        if (voter === me) return no(403, 'self', 'That’s your own ballot: the other mod handles it.');
        x.status = action === 'void' ? 'void' : 'submitted';
        x.void_reason = action === 'void' ? reason : null;
        s.log.push({ seq: s.log.length + 1, year: YEAR, admin: me!, action, target: `ballot:${voter}`, reason, at: now() });
      } else return no(400, 'action', 'action is strike, restore, hide-play, show-play, void or unvoid.');
      save(s);
      return ok({ ok: true, changed: true });
    }
    if (route === 'POST /api/top10/admin/finalize') {
      if (ph !== 'closed') return no(409, 'not_closed', 'Voting is still open: finalize once it closes.');
      const counted = Object.values(s.ballots).filter(x => x.status === 'submitted').length;
      if (counted < 5) return no(409, 'turnout', `Only ${counted} ballots count; the results need at least 5.`);
      if (s.finalized && !b.dryRun) return no(409, 'already', `${year} was already finalized.`);
      const out = { dryRun: Boolean(b.dryRun), results: results(s, year), ...payouts(s, year) };
      if (!b.dryRun) { s.finalized = true; s.log.push({ seq: s.log.length + 1, year: YEAR, admin: me!, action: 'finalize', target: String(year), reason: '', at: now() }); save(s); }
      return ok(out);
    }
  }
  return no(404, 'mock', `The mock has no ${route}.`);
}
