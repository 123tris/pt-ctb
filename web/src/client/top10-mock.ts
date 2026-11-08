// A stand-in for Top 10's endpoints (contract §13.3), for working on the pages before the backend is on a copy of the
// site. client/top10.ts loads it only on a local address after ?top10mock=1; production never does. It answers the
// same shapes from a state kept in this browser (localStorage), seeded with real players from the core pack: a few
// submitted ballots with write-ups, and showcase entries from three players' plays of the year.
//
//   ?top10mock=1 / 0          turn it on / off in this browser
//   ?top10phase=open          before | open | closed | revealed (default open), kept until changed
//   ?top10reset=1             start again from the seed
//
// Everyone is an admin here. Not part of the contract: it only has to answer like it.

import type { Answer } from './bananas.ts';
import { prefs } from './ui.ts';
import { store } from './boot.ts';
import { readCore, readPlayer, type CorePack, type PlayerPack } from '../gen/packs.ts';
import { CORE, playerPack } from '../routes.ts';
import { rowOf } from '../ui/players.ts';
import { mapDetails } from '../ui/playerpack.ts';
import { M, modString } from '../kernel/model.ts';
import {
  DEFAULT_SEASON, flagsOf, overlap, spotsOf, wordsOf, MIN_PICKS, MAX_PICKS, MAX_EXTRAS, MAX_BODY, MAX_NOTE, MAX_CAPTION,
  clipOk, playRef, toSec, type Phase, type Pick, type ScoreCard, type ShowPlay,
} from '../ui/top10.ts';

interface MockWriteup { body: string; cites: string[]; cards?: Record<string, ScoreCard>; words: number; flags: string; mod: 'ok' | 'struck'; mod_reason: string | null; updated: string }
interface MockBallot {
  voter: number; picks: Pick[]; mentions: number[]; watch: number[]; intro: string; outro: string;
  status: 'draft' | 'submitted' | 'void'; submitted_at: string | null; updated: string; void_reason: string | null;
  writeups: Record<string, MockWriteup>;
}
interface MockPlay extends ShowPlay { endorsers: number[] }

/** osu!'s own replay download for a score with an osu! id (§13.9: only when has_replay; the mock says yes). */
const osuReplay = (ref: string): ShowPlay['replay'] => {
  const n = Number(ref);
  return Number.isSafeInteger(n) && n !== 0 ? { kind: 'osu', url: n > 0 ? `https://osu.ppy.sh/scores/${n}/download` : `https://osu.ppy.sh/scores/fruits/${-n}/download` } : null;
};

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

/** The file the site would keep (§13.9): replays/<sha256>.osr on data.ptcatch.com, under a friendly name. */
async function storedReplay(file: File, player: string): Promise<ShowPlay['replay']> {
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()))].map(x => x.toString(16).padStart(2, '0')).join('');
  return { kind: 'file', url: `https://data.ptcatch.com/replays/${hash}.osr`, name: `${player} - ${file.name.replace(/\.osr$/i, '')}.osr` };
}
interface State {
  v: number;
  ballots: Record<string, MockBallot>;
  plays: MockPlay[];
  thanks: [number, number][]; // [subject, voter]
  log: { seq: number; admin: number; action: string; target: string; reason: string; at: string }[];
  finalized: boolean;
  nextPlay: number;
}

const KEY = 'top10mockState';
const VERSION = 5;
const now = () => new Date().toISOString();
const ok = (body: unknown, status = 200): Answer => ({ ok: true, status, body });
const no = (status: number, error: string): Answer => ({ ok: false, status, body: { error } });

function phase(): Phase {
  const asked = new URLSearchParams(location.search).get('top10phase');
  if (asked && ['before', 'open', 'closed', 'revealed'].includes(asked)) prefs.set('top10mockPhase', asked);
  return prefs.get('top10mockPhase', 'open');
}

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

/** The best plays of the year in a pack, as cards with their osu! score ids. */
function yearCards(pack: PlayerPack, year: number, max: number): { ref: string; card: ScoreCard }[] {
  const out: { ref: string; card: ScoreCard; pp: number }[] = [];
  const from = Date.UTC(year, 0, 1) / 1000, to = Date.UTC(year + 1, 0, 1) / 1000;
  for (const cat of ['c', 'u', 'r'] as const) {
    const list = pack[cat];
    for (let i = 0; i < list.rows; i++) {
      if (list.time[i] < from || list.time[i] >= to) continue;
      const meta = mapDetails(pack, list.map[i]);
      out.push({
        ref: playRef(list.sid[i], list.map[i]), pp: list.pp[i],
        card: {
          map: list.map[i], title: meta?.[M.TITLE], artist: meta?.[M.ARTIST], version: meta?.[M.VERSION], stars: meta?.[M.STARS], set: meta?.[M.SET],
          pp: list.pp[i] / 100, acc: list.acc[i] / 100, miss: list.miss[i] === 0xFFFFFFFF ? undefined : list.miss[i],
          combo: list.combo[i] === 0xFFFFFFFF ? undefined : list.combo[i], mods: modString(list.mods[i]), time: list.time[i],
        },
      });
    }
  }
  return out.sort((a, b) => b.pp - a.pp).slice(0, max);
}

let known: Map<string, { player: number; card: ScoreCard }> | null = null;

/** A score by reference: an osu! score id from the players loaded so far, or map:<id> from `player`'s pack. */
async function findScore(ref: string, player: number | null): Promise<{ player: number; card: ScoreCard } | null> {
  if (ref.startsWith('map:')) {
    if (!player) return null;
    const pack = await store.pack(playerPack(player), readPlayer).catch(() => null);
    const hit = pack ? yearCards(pack, DEFAULT_SEASON.year, 500).find(c => c.ref === ref) : null;
    return hit ? { player, card: hit.card } : null;
  }
  return known!.get(ref) ?? known!.get(String(-Number(ref))) ?? null;
}
let core: CorePack | null = null;

/** The players the seed draws from: the most pp first, active this year. */
function activeIds(c: CorePack, year: number): number[] {
  const from = Date.UTC(year, 0, 1) / 1000;
  const rows = [...Array(c.players.rows).keys()].filter(r => c.players.last[r] >= from);
  return rows.sort((a, b) => c.players.pp[b] - c.players.pp[a]).map(r => c.players.id[r]);
}

async function seed(year: number): Promise<State> {
  const ids = activeIds(core!, year);
  const top = ids.slice(0, 24);
  const voters = top.slice(0, 7).filter((_, i) => i !== 1);
  const state: State = { v: VERSION, ballots: {}, plays: [], thanks: [], log: [], finalized: false, nextPlay: 1 };
  voters.forEach((voter, v) => {
    const others = top.filter(id => id !== voter).sort((a, b) => rand(a + v * 7) - rand(b + v * 7) + (top.indexOf(a) - top.indexOf(b)) / 8);
    const n = 6 + (v % 5);
    const rows = others.slice(0, n).map((id, i) => ({ id, tie: i === 5 && v % 2 === 0 }));
    const spots = spotsOf(rows);
    const picks = rows.map((r, i) => ({ id: r.id, spot: spots[i] }));
    const writeups: Record<string, MockWriteup> = {};
    picks.slice(0, 3 + (v % 4)).forEach((p, i) => {
      const body = SAMPLES[(v + i) % SAMPLES.length];
      writeups[p.id] = { body, cites: [], words: wordsOf(body).length, flags: flagsOf(body).join(','), mod: 'ok', mod_reason: null, updated: now() };
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
  first.writeups[subj] = { body: filler, cites: [], words: wordsOf(filler).length, flags: flagsOf(filler).join(','), mod: 'ok', mod_reason: null, updated: now() };
  // Showcase: three players' best plays of the year.
  for (const [i, id] of top.slice(0, 3).entries()) {
    for (const [j, { ref, card }] of yearCards(await store.pack(playerPack(id), readPlayer), year, 2).entries()) {
      state.plays.push({
        id: state.nextPlay++, year, submitter: voters[(i + j + 1) % voters.length], player: id, score_ref: ref, beatmap_id: card.map,
        caption: j === 0 ? 'Best play of the year in Portugal, easily.' : 'Pouca gente faz isto com HR.', clip: null, created: now(),
        status: 'ok', endorsers: voters.filter((_, k) => rand(k + i * 3 + j) > 0.4), score: card, replay: osuReplay(ref),
      });
    }
  }
  state.plays.push({
    id: state.nextPlay++, year, submitter: voters[2], player: top[4], score_ref: null, beatmap_id: null, caption: 'Offline ScoreV2 run the site can’t see.',
    clip: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', created: now(), status: 'ok', endorsers: [voters[0]], score: null,
  });
  return state;
}

async function load(year: number): Promise<State> {
  core ??= await store.pack(CORE, readCore);
  if (!known) {
    known = new Map();
    for (const id of activeIds(core, year).slice(0, 6)) {
      for (const { ref, card } of yearCards(await store.pack(playerPack(id), readPlayer), year, 25)) known.set(ref, { player: id, card });
    }
  }
  if (new URLSearchParams(location.search).get('top10reset') === '1') prefs.set(KEY, null);
  const saved: State | null = prefs.get(KEY, null);
  if (saved?.v === VERSION) return saved;
  const fresh = await seed(year);
  prefs.set(KEY, fresh);
  return fresh;
}

const save = (s: State) => prefs.set(KEY, s);
const isPt = (id: number) => rowOf(core!.players, id) >= 0;

function wordsAndFlags(s: State, voter: number, subject: string, body: string): { words: number; flags: string } {
  const others: string[] = [];
  for (const b of Object.values(s.ballots)) for (const [subj, w] of Object.entries(b.writeups)) if (!(b.voter === voter && subj === subject)) others.push(w.body);
  const flags: string[] = flagsOf(body).filter(f => f !== 'copy');
  if (wordsOf(body).length >= 3 && others.some(o => overlap(body, o) >= 0.7)) flags.push('copy');
  return { words: wordsOf(body).length, flags: flags.join(',') };
}

function checkSubmit(b: MockBallot): string | null {
  const ids = b.picks.map(p => p.id);
  if (ids.length < MIN_PICKS || ids.length > MAX_PICKS) return 'Rank 5 to 10 players.';
  if (new Set(ids).size !== ids.length) return 'Each player can only be on your list once.';
  if (ids.includes(b.voter) || b.mentions.includes(b.voter) || b.watch.includes(b.voter)) return 'You can’t vote for yourself.';
  if (!ids.every(isPt)) return 'Only PT players can be ranked.';
  const spots = b.picks.map(p => p.spot);
  if (spots[0] !== 1 || spots.some((s, i) => i > 0 && s !== spots[i - 1] && s !== i + 1)) return 'The spots don’t add up.';
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
      const covered = group.map((_, k) => spot + k);
      const avg = covered.reduce((n, pos) => n + (pos <= 10 ? 11 - pos : 0), 0) / group.length;
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
    stats: { writeups: writeups.length, words: writeups.reduce((n, [, w]) => n + w.words, 0), subjects: new Set(writeups.map(([s]) => s)).size },
  };
}

/** 13.6: one payout per counted ballot, and thanks on approved write-ups. */
function payouts(s: State, year: number) {
  const counted = Object.values(s.ballots).filter(b => b.status === 'submitted');
  return {
    payouts: counted.map(b => {
      const writeups = b.picks.map(p => ({ subject: p.id, w: b.writeups[p.id] }))
        .filter(({ w }) => w && w.mod === 'ok' && !w.flags).map(({ subject, w }) => ({ subject, words: w.words }));
      return { type: 'top10.payout', osu_id: b.voter, payload: { year, ballot: true, writeups, allFull: b.picks.every(p => (writeups.find(w => w.subject === p.id)?.words ?? 0) >= 40) } };
    }),
    thanks: s.thanks.filter(([subject, voter]) => counted.some(b => b.voter === voter && b.writeups[subject]?.mod === 'ok' && !b.writeups[subject].flags))
      .map(([subject, voter]) => ({ type: 'top10.thanks', osu_id: voter, payload: { year, subject } })),
  };
}

export async function handle(method: string, path: string, body: unknown, me: number | null): Promise<Answer> {
  await new Promise(r => setTimeout(r, 120));
  const url = new URL(path, location.origin);
  const year = Number(url.searchParams.get('year')) || DEFAULT_SEASON.year;
  const s = await load(DEFAULT_SEASON.year);
  const ph = phase();
  const route = `${method} ${url.pathname}`;
  // A multipart body (a showcase entry with a replay file) as fields, with the file aside.
  const file = body instanceof FormData && body.get('replay') instanceof File ? body.get('replay') as File : null;
  const b = (body instanceof FormData ? Object.fromEntries([...body].filter(([, v]) => typeof v === 'string')) : body ?? {}) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const signed = () => me !== null;
  const own = () => s.ballots[me!];

  if (route === 'GET /api/top10') {
    const turnout = Object.values(s.ballots).filter(x => x.status === 'submitted').length;
    const mine = me !== null ? own() : null;
    return ok({
      season: { ...DEFAULT_SEASON, phase: ph }, turnout,
      ...(me !== null ? { me: { eligible: isPt(me), reason: isPt(me) ? null : 'Only PT players can vote.', ballot: mine ? { status: mine.status, submitted_at: mine.submitted_at, updated: mine.updated, picks: mine.picks } : null } } : {}),
    });
  }
  if (route === 'GET /api/top10/ballots') {
    const thanksOf = (subject: number, voter: number) => s.thanks.filter(([su, v]) => su === subject && v === voter).length;
    const ballots = Object.values(s.ballots).filter(x => x.status === 'submitted' && year === DEFAULT_SEASON.year).map(x => {
      const writeups: Record<string, unknown> = {};
      const scores: Record<string, ScoreCard> = {};
      for (const [subject, w] of Object.entries(x.writeups)) {
        if (w.mod === 'struck') continue;
        writeups[subject] = { body: w.body, cites: w.cites, words: w.words, thanks: thanksOf(Number(subject), x.voter), ...(me !== null ? { thanked: s.thanks.some(([su, v]) => su === me && v === x.voter && String(su) === subject) } : {}) };
        for (const ref of w.cites) { const card = w.cards?.[ref] ?? known!.get(ref)?.card; if (card) scores[ref] = card; }
      }
      return { voter: x.voter, picks: x.picks, mentions: x.mentions, watch: x.watch, intro: x.intro, outro: x.outro, submitted_at: x.submitted_at, updated: x.updated, writeups, scores };
    }).sort((a, c) => toSec(c.submitted_at) - toSec(a.submitted_at));
    return ok({ year, ballots });
  }
  if (route === 'GET /api/top10/ballot') {
    if (!signed()) return no(401, 'Sign in first.');
    const mine = own();
    return ok({ ballot: mine ? { ...mine, writeups: Object.fromEntries(Object.entries(mine.writeups).map(([k, w]) => [k, { ...w, flags: w.flags ? w.flags.split(',') : [] }])) } : null });
  }
  if (route === 'PUT /api/top10/ballot') {
    if (!signed()) return no(401, 'Sign in first.');
    if (!isPt(me!)) return no(403, 'Only PT players can vote.');
    if (ph !== 'open') return no(409, 'Voting isn’t open.');
    const picks: Pick[] = (b.picks ?? []).slice(0, MAX_PICKS);
    const mentions: number[] = (b.mentions ?? []).slice(0, MAX_EXTRAS), watch: number[] = (b.watch ?? []).slice(0, MAX_EXTRAS);
    const allowed = new Set([...picks.map(p => String(p.id)), ...mentions.map(String), ...watch.map(String)]);
    const before = own();
    const writeups: Record<string, MockWriteup> = {};
    for (const [subject, w] of Object.entries((b.writeups ?? {}) as Record<string, { body: string; cites: string[] }>)) {
      if (!allowed.has(subject) || !w.body?.trim()) continue;
      const body2 = w.body.slice(0, MAX_BODY);
      const prev = before?.writeups[subject];
      const same = prev && prev.body === body2;
      const cites = (w.cites ?? []).slice(0, 5);
      const cards: Record<string, ScoreCard> = {};
      for (const ref of cites) { const hit = await findScore(ref, Number(subject)); if (hit) cards[ref] = hit.card; }
      writeups[subject] = { body: body2, cites, cards, ...wordsAndFlags(s, me!, subject, body2), mod: same ? prev.mod : 'ok', mod_reason: same ? prev.mod_reason : null, updated: same ? prev.updated : now() };
    }
    s.ballots[me!] = {
      voter: me!, picks, mentions, watch, intro: String(b.intro ?? '').slice(0, MAX_NOTE), outro: String(b.outro ?? '').slice(0, MAX_NOTE),
      status: before?.status === 'submitted' ? 'submitted' : before?.status === 'void' ? 'void' : 'draft', submitted_at: before?.submitted_at ?? null,
      updated: now(), void_reason: before?.void_reason ?? null, writeups,
    };
    save(s);
    return ok({ ballot: { ...s.ballots[me!], writeups: Object.fromEntries(Object.entries(writeups).map(([k, w]) => [k, { ...w, flags: w.flags ? w.flags.split(',') : [] }])) } });
  }
  if (route === 'POST /api/top10/ballot/submit' || route === 'POST /api/top10/ballot/withdraw') {
    if (!signed()) return no(401, 'Sign in first.');
    if (ph !== 'open') return no(409, 'Voting isn’t open.');
    const mine = own();
    if (!mine) return no(400, 'Save a list first.');
    if (route.endsWith('submit')) {
      const problem = checkSubmit(mine);
      if (problem) return no(400, problem);
      mine.status = 'submitted';
      mine.submitted_at ??= now();
    } else {
      mine.status = 'draft';
      mine.submitted_at = null;
    }
    save(s);
    return ok({ status: mine.status });
  }
  if (route === 'GET /api/top10/plays') {
    const player = Number(url.searchParams.get('player')) || null;
    const plays = s.plays.filter(p => p.status === 'ok' && (!player || p.player === player)).map(({ endorsers, ...p }) => ({ ...p, endorsements: endorsers.length, ...(me !== null ? { endorsed: endorsers.includes(me) } : {}) }))
      .sort((a, c) => c.endorsements - a.endorsements || toSec(c.created) - toSec(a.created));
    return ok({ year, plays });
  }
  if (route === 'POST /api/top10/plays') {
    if (!signed()) return no(401, 'Sign in first.');
    if (!isPt(me!)) return no(403, 'Only PT players can submit plays.');
    if (ph !== 'open') return no(409, 'The showcase isn’t open.');
    const mine = s.plays.filter(p => p.submitter === me);
    if (mine.length >= 15) return no(429, 'You’ve showcased 15 plays this year, the most there can be.');
    const caption = String(b.caption ?? '').slice(0, MAX_CAPTION);
    let entry: MockPlay;
    // The replay file, when there's one: a catch replay by a PT player (§13.9), at most 2 MB.
    let header: { mode: number; md5: string; player: string } | null = null;
    if (file) {
      if (file.size > 2 * 1024 * 1024) return no(413, 'A replay can be at most 2 MB.');
      header = osrHeader(new Uint8Array(await file.arrayBuffer()));
      if (!header) return no(400, 'That isn’t a replay file osu! wrote.');
      if (header.mode !== 2) return no(400, 'That replay isn’t osu!catch.');
    }
    const byName = header ? [...Array(core!.players.rows).keys()].find(r => core!.players.name.at(r).toLowerCase() === header!.player.toLowerCase()) : undefined;
    if (header && byName === undefined) return no(400, 'The replay’s player isn’t a PT player.');
    const replay = file && header ? await storedReplay(file, header.player) : null;
    if (b.score === undefined && file) {
      entry = { id: s.nextPlay++, year, submitter: me!, player: core!.players.id[byName!], score_ref: null, beatmap_id: null, caption, clip: null, created: now(), status: 'ok', endorsers: [], score: null, replay };
    } else if (b.score !== undefined) {
      const ref = String(b.score).startsWith('map:') ? String(b.score) : String(b.score).match(/(-?\d{4,})\/?$/)?.[1] ?? '';
      const hit = await findScore(ref, Number(b.player) || null);
      if (!hit) return no(400, 'add it with /addscore first, or attach a clip');
      if (s.plays.some(p => p.score_ref === ref && p.player === hit.player && p.status === 'ok')) return no(409, 'That score is in the showcase already.');
      entry = { id: s.nextPlay++, year, submitter: me!, player: hit.player, score_ref: ref, beatmap_id: hit.card.map, caption, clip: b.clip ?? null, created: now(), status: 'ok', endorsers: [], score: hit.card, replay: replay ?? osuReplay(ref) };
    } else {
      if (!isPt(Number(b.player))) return no(400, 'Pick a PT player.');
      if (!clipOk(String(b.clip ?? ''))) return no(400, 'A clip has to be on YouTube, Twitch or Streamable.');
      entry = { id: s.nextPlay++, year, submitter: me!, player: Number(b.player), score_ref: null, beatmap_id: null, caption, clip: String(b.clip), created: now(), status: 'ok', endorsers: [], score: null };
    }
    if (entry.player === me && mine.filter(p => p.player === me).length >= 5) return no(429, 'At most 5 of your own plays.');
    s.plays.push(entry);
    save(s);
    const { endorsers, ...rest } = entry;
    return ok({ play: { ...rest, endorsements: endorsers.length, endorsed: false } }, 201);
  }
  const playMatch = url.pathname.match(/^\/api\/top10\/plays\/(\d+)(\/endorse)?$/);
  if (playMatch) {
    if (!signed()) return no(401, 'Sign in first.');
    const p = s.plays.find(x => x.id === Number(playMatch[1]));
    if (!p) return no(404, 'No such play.');
    if (method === 'DELETE' && !playMatch[2]) {
      if (p.submitter !== me) return no(403, 'Only who submitted it can remove it.');
      s.plays = s.plays.filter(x => x !== p);
      save(s);
      return ok({ removed: p.id });
    }
    if (method === 'POST' && playMatch[2]) {
      p.endorsers = p.endorsers.includes(me!) ? p.endorsers.filter(x => x !== me) : [...p.endorsers, me!];
      save(s);
      return ok({ endorsed: p.endorsers.includes(me!), endorsements: p.endorsers.length });
    }
  }
  if (route === 'POST /api/top10/thanks') {
    if (!signed()) return no(401, 'Sign in first.');
    const voter = Number(b.voter);
    const ballot = s.ballots[voter];
    if (!ballot || ballot.status !== 'submitted' || !ballot.writeups[me!]) return no(404, 'There’s no write-up about you on that ballot.');
    const had = s.thanks.some(([su, v]) => su === me && v === voter);
    if (had && s.finalized) return no(409, 'Thanks can’t be undone after the results are finalized.');
    s.thanks = had ? s.thanks.filter(([su, v]) => !(su === me && v === voter)) : [...s.thanks, [me!, voter]];
    save(s);
    return ok({ thanked: !had, thanks: s.thanks.filter(([su, v]) => su === me && v === voter).length });
  }
  if (route === 'GET /api/top10/results') {
    if (ph !== 'revealed') return no(404, 'The results aren’t out yet.');
    return ok(results(s, year));
  }
  if (url.pathname.startsWith('/api/top10/admin/')) {
    if (!signed()) return no(401, 'Sign in first.');
    if (route === 'GET /api/top10/admin/queue') {
      const writeups = Object.values(s.ballots).flatMap(x => Object.entries(x.writeups).map(([subject, w]) => ({
        voter: x.voter, subject: Number(subject), body: w.body, words: w.words, flags: w.flags ? w.flags.split(',') : [], mod: w.mod, mod_reason: w.mod_reason,
        updated: w.updated, ballot: x.status, ranked: x.picks.some(p => String(p.id) === subject),
      }))).sort((a, c) => Number(c.flags.length > 0) - Number(a.flags.length > 0) || toSec(c.updated) - toSec(a.updated));
      const plays = s.plays.map(({ endorsers, ...p }) => ({ ...p, endorsements: endorsers.length }));
      const ballots = Object.values(s.ballots).map(x => ({ voter: x.voter, status: x.status, picks: x.picks.length, submitted_at: x.submitted_at, updated: x.updated, void_reason: x.void_reason }));
      return ok({ year, phase: ph, finalized: s.finalized, writeups, plays, ballots, log: [...s.log].reverse() });
    }
    if (route === 'POST /api/top10/admin/action') {
      const action = String(b.action), target = String(b.target ?? ''), reason = String(b.reason ?? '').trim();
      if (['strike', 'hide-play', 'void'].includes(action) && !reason) return no(400, 'Give a reason: the player sees it.');
      if (action === 'strike' || action === 'restore') {
        const [voter, subject] = target.split(':').map(Number);
        const w = s.ballots[voter]?.writeups[subject];
        if (!w) return no(404, 'No such write-up.');
        if (subject === me) return no(403, 'You can’t moderate write-ups about yourself; the other mod handles those.');
        if (action === 'strike') { w.mod = 'struck'; w.mod_reason = reason; } else { w.mod = 'ok'; w.mod_reason = null; w.flags = ''; }
      } else if (action === 'hide-play' || action === 'show-play') {
        const p = s.plays.find(x => x.id === Number(target));
        if (!p) return no(404, 'No such play.');
        p.status = action === 'hide-play' ? 'hidden' : 'ok';
        p.reason = action === 'hide-play' ? reason : null;
      } else if (action === 'void' || action === 'unvoid') {
        const x = s.ballots[Number(target)];
        if (!x) return no(404, 'No such ballot.');
        x.status = action === 'void' ? 'void' : 'submitted';
        x.void_reason = action === 'void' ? reason : null;
      } else return no(400, 'Unknown action.');
      s.log.push({ seq: s.log.length + 1, admin: me!, action, target, reason, at: now() });
      save(s);
      return ok({ done: action });
    }
    if (route === 'POST /api/top10/admin/finalize') {
      if (ph !== 'closed') return no(409, 'Finalize once voting has closed.');
      const counted = Object.values(s.ballots).filter(x => x.status === 'submitted').length;
      if (counted < 5) return no(409, 'Fewer than 5 counted ballots: the results can’t be published.');
      if (s.finalized && !b.dryRun) return no(409, 'Already finalized.');
      const out = { dryRun: Boolean(b.dryRun), results: results(s, year), ...payouts(s, year) };
      if (!b.dryRun) { s.finalized = true; s.log.push({ seq: s.log.length + 1, admin: me!, action: 'finalize', target: String(year), reason: '', at: now() }); save(s); }
      return ok(out);
    }
  }
  return no(404, `The mock has no ${route}.`);
}
