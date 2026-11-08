// /top10/:view?/:id?/:year? for the app's router: Top 10 of the year and of all time (TOP10-DESIGN.md, §13.11).
//   /top10                         the season's page, with both ballots (views/top10-hub.ts)
//   /top10/vote                    your yearly ballot, and the write-ups once it's in (views/top10-ballot.ts)
//   /top10/vote/alltime            your all-time ballot
//   /top10/ballots                 every submitted ballot, by voter or (?player=<id>, ?by=player) by player; ?kind=alltime
//   /top10/plays                   the score showcase (?player=<id>); ?scope=alltime is "Legendary plays"
//   /top10/dossier/:id/:year?      a player's year, for voters; /alltime is their career
//   /top10/<year>, /<year>/alltime the results: placeholders until the reveal pages come
// Players from the core pack; the season, ballots and showcase from the site's endpoints (client/top10.ts), which
// may not be on this copy (503) or need a sign-in (401): each page says so and shows what it can. There's no old page
// for any of it: data without packs gets a notice instead.

import type { Ctx } from '../kernel/ctx.ts';
import { store } from '../client/boot.ts';
import { signInHere } from '../client/bananas.ts';
import type { RouterPage } from '../client/page.ts';
import { top10Api } from '../client/top10.ts';
import { top10Page } from '../client/top10-page.ts';
import { NotFound } from '../kernel/store.ts';
import { readCore, readPlayer } from '../gen/packs.ts';
import { CORE, playerPack } from '../routes.ts';
import { rowOf } from '../ui/players.ts';
import {
  DEFAULT_SEASON, editionLabel, kindName, kindOf, myBallotOf, phaseOf, troubleOf,
  type Hub, type Kind, type OwnBallot, type PublicBallot, type Scope, type ShowPlay,
} from '../ui/top10.ts';
import { byCareer, candidatesOf } from '../ui/top10-players.ts';
import type { History } from '../views/player.ts';
import * as hubView from '../views/top10-hub.ts';
import * as ballotView from '../views/top10-ballot.ts';
import * as feedView from '../views/top10-feed.ts';
import * as playsView from '../views/top10-plays.ts';
import * as dossierView from '../views/top10-dossier.ts';
import { mount as mountBallot, localDraft } from '../views/top10-ballot.mount.ts';
import { mount as mountFeed } from '../views/top10-feed.mount.ts';
import { mount as mountPlays } from '../views/top10-plays.mount.ts';
import { startCountdowns } from '../views/top10-hub.mount.ts';

const core = () => store.pack(CORE, readCore);
const history = () => store.hasJson('history.json').then(has => (has ? store.json<History>('history.json') : null)).catch(() => null);

/** GET /api/top10: the season (the default one when the endpoints aren't there), its phase, and what went wrong. */
async function season(ctx: Ctx) {
  const res = await top10Api('/api/top10');
  const hub = res.ok ? res.body as Hub : null;
  const s = hub?.season ?? DEFAULT_SEASON;
  return { hub, season: s, phase: phaseOf(s, ctx.now()), trouble: troubleOf(res.status) };
}

const hub = top10Page<hubView.Data>({
  load: async (ctx, { params }) => {
    const s = await season(ctx);
    const asked = /^\d{4}$/.test(params.view ?? '') ? Number(params.view) : undefined;
    return { ...s, signInHere: signInHere(), results: asked, kind: kindOf(params.id) };
  },
  title: (ctx, d) => (d.results !== undefined && d.kind === 'alltime' ? `${kindName(ctx, 'alltime', d.results)} · ${editionLabel(d.results, d.hub?.editions)}`
    : ctx.t('Top 10 of {year}', { year: d.results !== undefined ? editionLabel(d.results, d.hub?.editions) : d.season.year })),
  render: (ctx, d) => hubView.render(ctx, d),
  mount: root => startCountdowns(root),
});

const ballot = top10Page<{ d: ballotView.Data; e: ballotView.Editor }>({
  load: async (ctx, { params, query }) => {
    const kind: Kind = kindOf(params.id);
    const [c, h, s, own] = await Promise.all([
      core(), history(), season(ctx),
      ctx.me === null ? null : top10Api(`/api/top10/ballot?kind=${kind}`),
    ]);
    const server = own?.ok ? (own.body?.ballot ?? null) as OwnBallot | null : null;
    const draft = server ? null : localDraft(s.season.year, ctx.me, kind);
    const trouble = own && !own.ok ? troubleOf(own.status) : s.trouble;
    // GET /ballot says whether you may vote, and why not ({ eligible, code, reason }); GET /api/top10's me says it too.
    const said = own?.ok ? own.body : s.hub?.me;
    const candidates = candidatesOf(c, h, s.season.year, ctx.now());
    const d: ballotView.Data = {
      kind, core: c, history: h, season: s.season, phase: s.phase, trouble, eligible: said && typeof said.eligible === 'boolean' ? said.eligible : true,
      code: said?.code ?? null, reason: said?.reason ?? null, log: own?.ok && Array.isArray(own.body?.log) ? own.body.log : [],
      ballot: server ?? draft, candidates: kind === 'alltime' ? byCareer(candidates) : candidates, signInHere: signInHere(),
    };
    return { d, e: ballotView.editorOf(server ?? draft, query, kind) };
  },
  title: (ctx, { d }) => (d.kind === 'alltime' ? ctx.t('Your top 10 of all time') : ctx.t('Your top 10 of {year}', { year: d.season.year })),
  render: (ctx, { d, e }) => ballotView.render(ctx, d, e),
  mount: (root, ctx, { d, e }) => mountBallot(root, ctx, d, e),
});

const feed = top10Page<feedView.Data>({
  load: async (ctx, { query }) => {
    const kind = kindOf(query.kind);
    const [c, s] = await Promise.all([core(), season(ctx)]);
    const res = await top10Api(`/api/top10/ballots?year=${s.season.year}&kind=${kind}`);
    const player = Number(query.player);
    const thanksUntil = Date.parse(s.season.thanksUntil) / 1000;
    return {
      kind, core: c, season: s.season, ballots: res.ok ? (res.body?.ballots ?? []) as PublicBallot[] : [], trouble: troubleOf(res.status),
      mineIn: myBallotOf(s.hub, kind)?.status === 'submitted', thanksOpen: !(ctx.now() > thanksUntil),
      player: Number.isSafeInteger(player) && player > 0 ? player : null, by: query.by === 'player' ? 'player' : 'voter',
    };
  },
  title: (ctx, d) => (d.player !== null ? ctx.t('About {name}', { name: (() => { const r = rowOf(d.core.players, d.player!); return r < 0 ? `#${d.player}` : d.core.players.name.at(r); })() }) : ctx.t('Ballots')),
  render: (ctx, d) => feedView.render(ctx, d),
  mount: (root, ctx, d) => mountFeed(root, ctx, d),
});

const plays = top10Page<playsView.Data>({
  load: async (ctx, { query }) => {
    const scope: Scope = kindOf(query.scope);
    const [c, s] = await Promise.all([core(), season(ctx)]);
    const res = await top10Api(`/api/top10/plays?year=${s.season.year}&scope=${scope}`);
    const player = Number(query.player);
    return {
      scope, core: c, season: s.season, phase: s.phase, plays: res.ok ? (res.body?.plays ?? []) as ShowPlay[] : [], trouble: troubleOf(res.status),
      player: Number.isSafeInteger(player) && player > 0 ? player : null,
      candidates: candidatesOf(c, null, s.season.year, ctx.now()).sort((a, b) => a.name.localeCompare(b.name)), signInHere: signInHere(),
    };
  },
  title: (ctx, d) => (d.scope === 'alltime' ? ctx.t('Legendary plays') : ctx.t('Plays of {year}', { year: d.season.year })),
  render: (ctx, d) => playsView.render(ctx, d),
  mount: (root, ctx, d) => mountPlays(root, ctx, d),
});

/** A player's places in the published Top 10s (both kinds), from each edition GET /api/top10 lists. */
async function placementsOf(hubData: Hub | null, id: number): Promise<dossierView.Placement[] | null> {
  if (!hubData) return null;
  const editions = hubData.editions ?? [];
  const found = await Promise.all(editions.map(async e => {
    const kind = kindOf(e.kind);
    const res = await top10Api(`/api/top10/results?year=${e.year}&kind=${kind}`);
    if (!res.ok) return null;
    const r = (res.body?.ranking ?? []).find((x: { id: number }) => x.id === id);
    return r ? { year: e.year, label: e.label, kind, rank: r.rank, score: r.score, lists: r.lists, eligible: r.eligible } : null;
  }));
  return found.filter((p): p is dossierView.Placement => p !== null);
}

const dossier = top10Page<dossierView.Data>({
  load: async (ctx, { params }) => {
    const id = Number(params.id);
    if (!Number.isSafeInteger(id) || id <= 0) throw new NotFound(`top10/dossier/${params.id}`);
    const career = params.year === 'alltime';
    const pack = store.pack(playerPack(id), readPlayer);
    pack.catch(() => {});
    const [c, h, s] = await Promise.all([core(), history(), season(ctx)]);
    const row = rowOf(c.players, id);
    if (row < 0) throw new NotFound(`players/${id}`);
    const year = /^\d{4}$/.test(params.year ?? '') ? Number(params.year) : s.season.year;
    const headName = `players/${id}-head.json`;
    const [shown, head, placements] = await Promise.all([
      // The showcase is the season's: a past year's dossier asks for that year's entries.
      top10Api(`/api/top10/plays?year=${career ? s.season.year : year}&player=${id}&scope=${career ? 'alltime' : 'year'}`),
      career ? store.hasJson(headName).then(has => (has ? store.json<dossierView.Data['head']>(headName) : null)).catch(() => null) : null,
      career ? placementsOf(s.hub, id) : null,
    ]);
    return {
      id, year, core: c, row, pack: await pack.catch(() => null), history: h, plays: shown.ok ? (shown.body?.plays ?? []) as ShowPlay[] : null,
      candidate: candidatesOf(c, h, year, ctx.now()).find(x => x.id === id) ?? null, career, head, placements,
    };
  },
  title: (ctx, d) => dossierView.title(ctx, d),
  render: (ctx, d) => dossierView.render(ctx, d),
});

const VIEWS: Record<string, RouterPage> = { vote: ballot, ballots: feed, plays, dossier };

const top10: RouterPage = (root, args) => {
  const { view, id, year } = args.params;
  // /top10, /top10/<year> and /top10/<year>/alltime.
  if (view === undefined || /^\d{4}$/.test(view)) {
    if ((id !== undefined && id !== 'alltime') || year !== undefined) throw new NotFound(`top10/${view}/${id}`);
    return hub(root, args);
  }
  const page = VIEWS[view];
  // /top10/vote/alltime; /top10/dossier/:id/:year? (a year or alltime); the rest take no more.
  const ok = Object.hasOwn(VIEWS, view) && (view === 'dossier' ? year === undefined || /^\d{4}$|^alltime$/.test(year)
    : view === 'vote' ? (id === undefined || id === 'alltime') && year === undefined : id === undefined);
  if (!ok) throw new NotFound(`top10/${view}`);
  return page(root, args);
};

export default top10;
