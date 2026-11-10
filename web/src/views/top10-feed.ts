// /top10/ballots: every submitted ballot, read like the forum threads (§6). By voter, each ballot is a post: the
// intro, the list with each write-up under its player (and the scores it cites), the mentions and ones to watch, the
// closing message. By player (?player=<id>), everything written about one player, with who wrote it and where they
// placed them ("#1 by ExPin"); with no player picked, who has been written about. A write-up about you has a button to
// thank its writer (§3.5). Your own ballot comes first, and if you haven't made one there's a nudge to do that before
// reading everyone else's (§12, herding).

import { html, raw, type Safe } from '../kernel/html.ts';
import type { Ctx } from '../kernel/ctx.ts';
import type { CorePack } from '../gen/packs.ts';
import { avatar, playerLinkId, rowOf } from '../ui/players.ts';
import { tabs } from '../ui/page.ts';
import { KINDS, kindName, scoreCard, spotLabel, toSec, top10Tabs, troubleNote, type Kind, type PublicBallot, type Season, type Trouble, type Writeup } from '../ui/top10.ts';

export interface Data {
  /** Which ballots (§13.11): the year's or all time's. */
  kind: Kind;
  core: CorePack;
  season: Season;
  ballots: PublicBallot[];
  trouble: Trouble;
  /** Whether you have a submitted ballot (from GET /api/top10). */
  mineIn: boolean;
  /** Thanks can be given until thanksUntil. */
  thanksOpen: boolean;
  player: number | null;
  by: 'voter' | 'player';
}

const nameOf = (core: CorePack, id: number) => { const r = rowOf(core.players, id); return r < 0 ? `#${id}` : core.players.name.at(r); };

/** A write-up's paragraph(s), its cited scores and its thanks. */
export function writeupBlock(ctx: Ctx, d: Data, b: PublicBallot, subject: number, w: Writeup): Safe {
  const { t } = ctx;
  const mine = ctx.me === subject;
  const thanks = w.thanks ?? 0;
  const paragraphs = w.body.split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
  return html`<div class="t10-wu">
    ${paragraphs.map(p => html`<p>${p.split('\n').map((line, i) => html`${i ? html`<br>` : ''}${line}`)}</p>`)}
    ${(w.cites ?? []).length ? html`<div class="t10-cites">${(w.cites ?? []).map(ref => scoreCard(ctx, b.scores?.[ref] ?? null, ref))}</div>` : ''}
    <div class="t10-wu-foot">
      ${mine && d.thanksOpen ? html`<button class="t10-thanks ${w.thanked ? 't10-thanks-on' : ''}" type="button" data-thank="${b.voter}" aria-pressed="${String(Boolean(w.thanked))}">
          <span>${w.thanked ? t('Thanked') : t('Thank {name}', { name: nameOf(d.core, b.voter) })}</span></button>`
        : thanks ? html`<span class="small faint">${t('{name} thanked this', { name: nameOf(d.core, subject) })}</span>` : ''}
    </div>
  </div>`;
}

/** One ballot as a post. */
export function ballotPost(ctx: Ctx, d: Data, b: PublicBallot): Safe {
  const { t, fmt } = ctx;
  const sorted = [...b.picks].sort((x, y) => x.spot - y.spot);
  const row = rowOf(d.core.players, b.voter);
  const when = toSec(b.submitted_at);
  const extra = (ids: number[], label: string) => (ids.length ? html`<div class="t10-post-extra"><h4>${label}</h4>
    <ul>${ids.map(id => html`<li>${playerLinkId(ctx, d.core.players, id, 'avatar-sm')}${b.writeups[id] ? writeupBlock(ctx, d, b, id, b.writeups[id]) : ''}</li>`)}</ul></div>` : '');
  return html`<article class="t10-post ${b.voter === ctx.me ? 't10-post-mine' : ''}" id="ballot-${b.voter}" aria-labelledby="post-${b.voter}">
    <header class="t10-post-head">
      ${row >= 0 ? avatar(ctx, d.core.players, row, 'avatar-md') : ''}
      <div><h2 class="m-0" id="post-${b.voter}"><a href="/player/${b.voter}">${nameOf(d.core, b.voter)}</a>${b.voter === ctx.me ? html` <span class="t10-pill">${t('you')}</span>` : ''}</h2>
        ${when ? html`<span class="small faint" title="${fmt.dateTime(when)}">${t('Submitted {ago}', { ago: fmt.ago(when) })}</span>` : ''}</div>
    </header>
    ${b.intro ? html`<p class="t10-note-text">${b.intro}</p>` : ''}
    <ol class="t10-post-list">${sorted.map((p, i) => html`<li>
      <div class="t10-post-pick"><span class="t10-spot">${spotLabel(sorted, i)}</span>${playerLinkId(ctx, d.core.players, p.id, 'avatar-sm')}
        <a class="small dim-link" href="/top10/ballots?player=${p.id}${d.kind === 'alltime' ? '&kind=alltime' : ''}">${t('all about them')}</a></div>
      ${b.writeups[p.id] ? writeupBlock(ctx, d, b, p.id, b.writeups[p.id]) : ''}
    </li>`)}</ol>
    ${extra(b.mentions ?? [], t('Honourable mentions'))}
    ${extra(b.watch ?? [], t('Ones to watch'))}
    ${b.outro ? html`<p class="t10-note-text">${b.outro}</p>` : ''}
  </article>`;
}

/** Everything written about one player, with who wrote it and where they put them. */
function aboutPlayer(ctx: Ctx, d: Data, id: number): Safe {
  const { t } = ctx;
  const items = d.ballots.flatMap(b => {
    const w = b.writeups[id];
    if (!w) return [];
    const sorted = [...b.picks].sort((x, y) => x.spot - y.spot);
    const i = sorted.findIndex(p => p.id === id);
    const place = i >= 0 ? `#${spotLabel(sorted, i).replace(/^=/, '')}` : b.mentions?.includes(id) ? t('Honourable mention') : t('One to watch');
    return [{ b, w, place, order: i >= 0 ? sorted[i].spot : 50 }];
  }).sort((x, y) => x.order - y.order);
  const r = rowOf(d.core.players, id);
  return html`<header class="t10-about-head">${r >= 0 ? avatar(ctx, d.core.players, r, 'avatar-md') : ''}<div>
      <h2 class="m-0">${t('About {name}', { name: nameOf(d.core, id) })}</h2>
      <a class="small" href="/top10/dossier/${id}/${d.kind === 'alltime' ? 'alltime' : d.season.year}">${d.kind === 'alltime' ? t('{name}’s career', { name: nameOf(d.core, id) }) : t('{name}’s year', { name: nameOf(d.core, id) })}</a></div></header>
    ${items.length ? html`<ul class="t10-about">${items.map(({ b, w, place }) => html`<li class="t10-post">
        <div class="t10-about-by"><b>${place}</b> ${t('by')} ${playerLinkId(ctx, d.core.players, b.voter, 'avatar-sm')}</div>
        ${writeupBlock(ctx, d, b, id, w)}</li>`)}</ul>`
      : html`<p class="empty">${t('Nobody has written about {name} yet.', { name: nameOf(d.core, id) })}</p>`}`;
}

/** The players written about, the most written about first. */
function playerIndex(ctx: Ctx, d: Data): Safe {
  const { t, tn } = ctx;
  const count = new Map<number, number>();
  for (const b of d.ballots) for (const id of Object.keys(b.writeups)) count.set(Number(id), (count.get(Number(id)) ?? 0) + 1);
  const list = [...count].sort((a, b) => b[1] - a[1] || nameOf(d.core, a[0]).localeCompare(nameOf(d.core, b[0])));
  return list.length ? html`<ul class="t10-index">${list.map(([id, n]) => html`<li><a href="/top10/ballots?player=${id}${d.kind === 'alltime' ? '&kind=alltime' : ''}">
      ${(() => { const r = rowOf(d.core.players, id); return r < 0 ? '' : avatar(ctx, d.core.players, r, 'avatar-sm'); })()}<span>${nameOf(d.core, id)}</span>
      <span class="faint small">${tn(n, '{n} write-up', '{n} write-ups')}</span></a></li>`)}</ul>`
    : html`<p class="empty">${t('No write-ups yet.')}</p>`;
}

export function render(ctx: Ctx, d: Data): Safe {
  const { t, tn, fmt } = ctx;
  const year = d.season.year;
  const mine = d.ballots.filter(b => b.voter === ctx.me);
  const rest = d.ballots.filter(b => b.voter !== ctx.me);
  const k = d.kind === 'alltime' ? 'kind=alltime' : '';
  const nudge = ctx.me !== null && !d.mineIn && d.by === 'voter' && !d.player
    ? html`<div class="t10-cta"><p class="m-0">${t('Make your own list first? Reading everyone else’s first tends to make lists look alike.')}</p><a class="btn btn-primary" href="${d.kind === 'alltime' ? '/top10/vote/alltime' : '/top10/vote'}">${t('Your ballot')}</a></div>` : '';
  // Which ballots: the year's or all time's (§13.11), as chips above the voter / player tabs.
  const kinds = html`<nav class="chips t10-kinds" aria-label="${t('Which ballot')}">${KINDS.map(kind => html`<a class="chip ${kind === d.kind ? 'active' : ''}"
    href="/top10/ballots${kind === 'alltime' ? '?kind=alltime' : ''}" ${kind === d.kind ? raw('aria-current="page"') : ''}>${kindName(ctx, kind, year)}</a>`)}</nav>`;
  const sub = tabs([
    { href: `/top10/ballots${k ? `?${k}` : ''}`, label: t('By voter'), active: d.by === 'voter' && !d.player, count: fmt.num(d.ballots.length) },
    { href: `/top10/ballots?by=player${k ? `&${k}` : ''}`, label: t('By player'), active: d.by === 'player' || d.player !== null },
  ], t('Read the ballots'));
  const body = d.player !== null ? aboutPlayer(ctx, d, d.player)
    : d.by === 'player' ? playerIndex(ctx, d)
      : d.ballots.length ? html`${[...mine, ...rest].map(b => ballotPost(ctx, d, b))}`
        : html`<p class="empty">${t('No ballots in yet. Be the first!')}</p>`;
  return html`${top10Tabs(ctx, 'ballots', year)}
    <header class="page-head"><h1>${t('Ballots')}</h1>
      <p>${t('Each ballot is public once it’s submitted, write-ups and all. The combined ranking stays hidden until the reveal.')}
        ${d.ballots.length ? html` <b>${tn(d.ballots.length, '{n} ballot in', '{n} ballots in')}</b>.` : ''}</p></header>
    ${troubleNote(ctx, d.trouble === 'signin' ? null : d.trouble)}
    ${kinds}${sub}${nudge}
    <div data-feed>${body}</div>`;
}
