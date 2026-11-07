// /top10/:view?/:id?/:year? for the app's router: Top 10 of the year (TOP10-DESIGN.md).
//   /top10                     the season's page (views/top10-hub.ts)
//   /top10/vote                your ballot, and the write-ups once it's in (views/top10-ballot.ts)
//   /top10/ballots             every submitted ballot, by voter or (?player=<id>, ?by=player) by player
//   /top10/plays               the score showcase (?player=<id>)
//   /top10/dossier/:id/:year?  a player's year, for voters
//   /top10/<year>              the results: a placeholder until the reveal pages come
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
import { DEFAULT_SEASON, phaseOf, troubleOf, type Hub, type OwnBallot, type PublicBallot, type ShowPlay } from '../ui/top10.ts';
import { candidatesOf } from '../ui/top10-players.ts';
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
    return { ...s, signInHere: signInHere(), results: asked };
  },
  title: (ctx, d) => (d.results !== undefined ? ctx.t('Top 10 of {year}', { year: d.results }) : ctx.t('Top 10 of {year}', { year: d.season.year })),
  render: (ctx, d) => hubView.render(ctx, d),
  mount: root => startCountdowns(root),
});

const ballot = top10Page<{ d: ballotView.Data; e: ballotView.Editor }>({
  load: async (ctx, { query }) => {
    const [c, h, s, own] = await Promise.all([
      core(), history(), season(ctx),
      ctx.me === null ? null : top10Api('/api/top10/ballot'),
    ]);
    const server = own?.ok ? (own.body?.ballot ?? null) as OwnBallot | null : null;
    const draft = server ? null : localDraft(s.season.year, ctx.me);
    const trouble = own && !own.ok ? troubleOf(own.status) : s.trouble;
    const d: ballotView.Data = {
      core: c, history: h, season: s.season, phase: s.phase, trouble, eligible: s.hub?.me ? s.hub.me.eligible : true,
      reason: s.hub?.me?.reason ?? null, ballot: server ?? draft, candidates: candidatesOf(c, h, s.season.year), signInHere: signInHere(),
    };
    return { d, e: ballotView.editorOf(server ?? draft, query) };
  },
  title: (ctx, { d }) => ctx.t('Your top 10 of {year}', { year: d.season.year }),
  render: (ctx, { d, e }) => ballotView.render(ctx, d, e),
  mount: (root, ctx, { d, e }) => mountBallot(root, ctx, d, e),
});

const feed = top10Page<feedView.Data>({
  load: async (ctx, { query }) => {
    const [c, s] = await Promise.all([core(), season(ctx)]);
    const res = await top10Api(`/api/top10/ballots?year=${s.season.year}`);
    const player = Number(query.player);
    const thanksUntil = Date.parse(s.season.thanksUntil) / 1000;
    return {
      core: c, season: s.season, ballots: res.ok ? (res.body?.ballots ?? []) as PublicBallot[] : [], trouble: troubleOf(res.status),
      mineIn: s.hub?.me?.ballot?.status === 'submitted', thanksOpen: !(ctx.now() > thanksUntil),
      player: Number.isSafeInteger(player) && player > 0 ? player : null, by: query.by === 'player' ? 'player' : 'voter',
    };
  },
  title: (ctx, d) => (d.player !== null ? ctx.t('About {name}', { name: (() => { const r = rowOf(d.core.players, d.player!); return r < 0 ? `#${d.player}` : d.core.players.name.at(r); })() }) : ctx.t('Ballots')),
  render: (ctx, d) => feedView.render(ctx, d),
  mount: (root, ctx, d) => mountFeed(root, ctx, d),
});

const plays = top10Page<playsView.Data>({
  load: async (ctx, { query }) => {
    const [c, s] = await Promise.all([core(), season(ctx)]);
    const res = await top10Api(`/api/top10/plays?year=${s.season.year}`);
    const player = Number(query.player);
    return {
      core: c, season: s.season, phase: s.phase, plays: res.ok ? (res.body?.plays ?? []) as ShowPlay[] : [], trouble: troubleOf(res.status),
      player: Number.isSafeInteger(player) && player > 0 ? player : null, candidates: candidatesOf(c, null, s.season.year).sort((a, b) => a.name.localeCompare(b.name)),
      signInHere: signInHere(),
    };
  },
  title: (ctx, d) => ctx.t('Plays of {year}', { year: d.season.year }),
  render: (ctx, d) => playsView.render(ctx, d),
  mount: (root, ctx, d) => mountPlays(root, ctx, d),
});

const dossier = top10Page<dossierView.Data>({
  load: async (ctx, { params }) => {
    const id = Number(params.id);
    if (!Number.isSafeInteger(id) || id <= 0) throw new NotFound(`top10/dossier/${params.id}`);
    const pack = store.pack(playerPack(id), readPlayer);
    pack.catch(() => {});
    const [c, h, s] = await Promise.all([core(), history(), season(ctx)]);
    const row = rowOf(c.players, id);
    if (row < 0) throw new NotFound(`players/${id}`);
    const year = /^\d{4}$/.test(params.year ?? '') ? Number(params.year) : s.season.year;
    const shown = await top10Api(`/api/top10/plays?year=${year}&player=${id}`);
    return {
      id, year, core: c, row, pack: await pack.catch(() => null), history: h, plays: shown.ok ? (shown.body?.plays ?? []) as ShowPlay[] : null,
      candidate: candidatesOf(c, h, year).find(x => x.id === id) ?? null,
    };
  },
  title: (ctx, d) => dossierView.title(ctx, d),
  render: (ctx, d) => dossierView.render(ctx, d),
});

const VIEWS: Record<string, RouterPage> = { vote: ballot, ballots: feed, plays, dossier };

const top10: RouterPage = (root, args) => {
  const view = args.params.view;
  if (view === undefined || /^\d{4}$/.test(view)) return hub(root, args);
  const page = VIEWS[view];
  if (!page || (view !== 'dossier' && args.params.id !== undefined)) throw new NotFound(`top10/${view}`);
  return page(root, args);
};

export default top10;
