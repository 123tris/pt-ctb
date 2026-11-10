// /top10: the season's page (§2, §3.3, §6, §13.11). Where the season is (opens soon, open, closed, results out), its
// two ballots side by side (the year's top 10 and the top 10 of all time, each with its own state, turnout and way
// in; voters do either or both), the countdown to the reveal at 12:00 Lisbon on 2 January, and the rules. A year's
// results (/top10/<year>, /top10/<year>/alltime), and this season's once they're out, are views/top10-results.ts's.
// While the showcase is open (from before voting opens), a PT player is asked to make their case with their own best
// scores.

import { html, type Safe } from '../kernel/html.ts';
import type { Ctx } from '../kernel/ctx.ts';
import { signInButton } from '../ui/bananas.ts';
import * as resultsView from './top10-results.ts';
import {
  KINDS, PAST_EDITIONS, countdown, kindName, lisbon, myBallotOf, phaseName, publicNote, rules, toSec, top10Tabs,
  troubleNote, turnoutOf, type Hub, type Kind, type Phase, type Season, type Showcase, type Trouble,
} from '../ui/top10.ts';
import { caseLink } from './top10-plays.ts';

export interface Data {
  season: Season;
  phase: Phase;
  /** The showcase's window, which opens before voting does. */
  showcase?: Showcase;
  hub: Hub | null;
  trouble: Trouble;
  signInHere: boolean;
  /** A year's results (/top10/<year>, or /top10 once they're out): the results view draws the page. */
  shown?: resultsView.Data;
}

/** Signed out, or not a PT player: one line above both ballots. */
function whoNote(ctx: Ctx, d: Data): Safe | '' {
  const { t } = ctx;
  if (d.phase === 'revealed') return '';
  if (ctx.me === null) return html`<div class="t10-cta"><p class="m-0">${t('Only PT players can vote. Sign in with osu! to make your list.')}</p>${signInButton(ctx, d.signInHere)}</div>`;
  if (d.hub?.me && !d.hub.me.eligible) return html`<div class="t10-cta"><p class="m-0">${t('Only PT players on the site can vote, and your osu! account isn’t in its list of Portuguese players.')}</p></div>`;
  return '';
}

/**
 * While the showcase is open: before voting, that it's open already; for a PT player, the way to make their case with
 * their own best scores.
 */
function showcaseNote(ctx: Ctx, d: Data): Safe | '' {
  const { t } = ctx;
  if (d.showcase !== 'open') return '';
  const player = ctx.me !== null && d.hub?.me?.eligible !== false;
  const early = d.phase === 'before';
  if (!early && !player) return '';
  return html`<div class="t10-cta">
    ${early ? html`<p class="m-0">${t('The showcase is open now: add your best scores before voting opens on {date}.', { date: lisbon(ctx, toSec(d.season.opens), { time: false }) })}</p>` : ''}
    ${player ? caseLink(ctx) : html`<a class="btn" href="/top10/plays">${t('Plays of {year}', { year: d.season.year })}</a>`}
  </div>`;
}

/** One ballot's card: what it is, how many are in, where yours is, and the way in. */
function ballotCard(ctx: Ctx, d: Data, kind: Kind): Safe {
  const { t, tn, fmt } = ctx;
  const year = d.season.year;
  const mine = myBallotOf(d.hub, kind);
  const turnout = turnoutOf(d.hub, kind);
  const href = kind === 'alltime' ? '/top10/vote/alltime' : '/top10/vote';
  const can = ctx.me !== null && d.hub?.me?.eligible !== false;
  const state = mine?.status === 'submitted' ? html`<span class="t10-state t10-state-in">${t('Yours is in')}</span>`
    : mine?.status === 'void' ? html`<span class="t10-state t10-state-void">${t('Voided')}</span>`
      : mine?.picks?.length ? html`<span class="t10-state">${t('Draft')}</span>` : can ? html`<span class="t10-state">${t('Not started')}</span>` : '';
  const label = mine?.status === 'submitted' ? t('Edit your ballot') : mine?.picks?.length ? t('Finish your ballot') : d.phase === 'before' ? t('Start your list') : t('Vote now');
  const way = !can || d.phase === 'revealed' ? ''
    : d.phase === 'closed' ? html`<a class="btn btn-small" href="/top10/ballots${kind === 'alltime' ? '?kind=alltime' : ''}">${t('Read the ballots')}</a>`
      : html`<a class="btn ${mine?.status === 'submitted' ? '' : 'btn-primary'}" href="${href}">${label}</a>`;
  return html`<section class="t10-ballot-card" aria-labelledby="t10-bc-${kind}">
    <h2 id="t10-bc-${kind}" class="m-0">${kindName(ctx, kind, year)}</h2>
    <p class="muted m-0">${kind === 'alltime' ? t('The greatest PT catch players ever, legends included. Their whole career counts.')
      : t('The players of {year}: what they did this year, and nothing else.', { year })}</p>
    <div class="t10-ballot-meta">${state}
      ${turnout !== undefined ? html`<span class="small"><b>${fmt.num(turnout)}</b> ${tn(turnout, 'ballot in', 'ballots in')}</span>` : ''}</div>
    ${way}
  </section>`;
}

/** The editions before this one (§13.10), each linking to its results; all-time editions marked as such. */
function pastYears(ctx: Ctx, d: Data, current?: number, { label = true, kind = 'year' as Kind } = {}): Safe | '' {
  // The server's editions (the years whose results are out); the known list only when it can't be asked.
  const all = d.hub ? (d.hub.editions ?? []).map(e => [e.year, e.label, e.kind ?? 'year'] as const) : PAST_EDITIONS.map(([y, l]) => [y, l, 'year'] as const);
  const past = all.filter(([y]) => y < d.season.year).sort((a, b) => a[0] - b[0] || (a[2] === 'alltime' ? 1 : -1));
  return past.length ? html`<nav class="chips t10-past" aria-label="${ctx.t('Past years')}">${label ? html`<span class="chips-label">${ctx.t('Past years')}</span>` : ''}
    ${past.map(([y, l, k]) => {
      const on = y === current && k === kind;
      return html`<a class="chip ${on ? 'active' : ''}" href="/top10/${y}${k === 'alltime' ? '/alltime' : ''}" ${on ? html`aria-current="page"` : ''}>${k === 'alltime' ? ctx.t('{label}, all time', { label: resultsView.yearLabel(y, d.hub) }) : l}</a>`;
    })}</nav>` : '';
}

export function render(ctx: Ctx, d: Data): Safe {
  const { t } = ctx;
  const { season, phase } = d;
  const year = season.year;
  const opens = toSec(season.opens), closes = toSec(season.closes), reveal = toSec(season.reveal);

  // A year's results (/top10/<year>): this season's, or a past edition's (§13.10).
  if (d.shown) return resultsView.render(ctx, d.shown);

  const past = pastYears(ctx, d, undefined, { label: false });
  const when = phase === 'before' ? t('Voting opens {when}.', { when: lisbon(ctx, opens) })
    : phase === 'open' ? t('Voting closes {when}, Lisbon time.', { when: lisbon(ctx, closes) })
      : t('Voting closed {when}.', { when: lisbon(ctx, closes) });
  return html`${top10Tabs(ctx, 'hub', year)}
    <header class="page-head t10-hero">
      <span class="eyebrow">${t('PT osu!catch · every December')}</span>
      <h1>${t('Top 10 of {year}', { year })}</h1>
      <p>${t('Two ballots this December: the players of the year, and the greatest of all time. Do either or both. Everyone’s lists are combined and revealed in January, and what you write about players stays on their profile for good.')}</p>
    </header>
    ${troubleNote(ctx, d.trouble === 'signin' ? null : d.trouble)}

    <div class="t10-phase">
      <span class="t10-state t10-state-${phase}">${phaseName(ctx, phase)}</span>
      <span>${when}</span>
    </div>

    ${whoNote(ctx, d)}
    ${showcaseNote(ctx, d)}
    <div class="t10-ballot-cards">${KINDS.map(k => ballotCard(ctx, d, k))}</div>

    <section class="section" aria-labelledby="t10-cd-h">
      <h2 id="t10-cd-h">${t('The reveal')}</h2>
      <p class="muted">${t('{when}, Lisbon time: the year’s top 10 from 10 to 1, then the top 10 of all time as the finale, then everything people wrote.', { when: lisbon(ctx, reveal) })}</p>
      ${countdown(ctx, reveal, t('Time to the reveal'))}
      <p class="small faint">${t('Until then nobody sees the combined ranking, not even the mods. Each ballot is public as soon as it’s submitted.')}</p>
    </section>

    <section class="section" aria-labelledby="t10-rules-h">
      <h2 id="t10-rules-h">${t('The rules')}</h2>
      ${rules(ctx, season)}
      <p class="small muted">${t('The all-time ballot has the same rules, for any PT player’s whole career (legends count), with honourable mentions but no ones to watch.')}</p>
      ${publicNote(ctx)}
    </section>

    <section class="section" aria-labelledby="t10-more-h">
      <h2 id="t10-more-h">${t('While you decide')}</h2>
      <div class="grid grid-auto">
        <a class="card card-link" href="/top10/plays"><h3 class="m-0">${t('Plays of {year}', { year })}</h3><p class="muted m-0">${t('The year’s notable scores, showcased and endorsed by the community. Add the ones voters should see.')}</p></a>
        <a class="card card-link" href="/top10/plays?scope=alltime"><h3 class="m-0">${t('Legendary plays')}</h3><p class="muted m-0">${t('The plays that made PT catch history, from any year, for the all-time ballot.')}</p></a>
        <a class="card card-link" href="/top10/ballots"><h3 class="m-0">${t('Ballots')}</h3><p class="muted m-0">${t('Every submitted list and what its voter wrote, like the forum threads. Make your own list first.')}</p></a>
        ${ctx.me !== null ? html`<a class="card card-link" href="/top10/dossier/${ctx.me}/${year}"><h3 class="m-0">${t('Your year')}</h3><p class="muted m-0">${t('Your dossier: what voters see when they look you up.')}</p></a>` : ''}
        ${ctx.me !== null ? html`<a class="card card-link" href="/top10/dossier/${ctx.me}/alltime"><h3 class="m-0">${t('Your career')}</h3><p class="muted m-0">${t('What all-time voters see: your best plays, peak rank and past placements.')}</p></a>` : ''}
      </div>
    </section>

    ${past ? html`<section class="section" aria-labelledby="t10-past-h">
      <h2 id="t10-past-h">${t('Past years')}</h2>
      <p class="muted">${t('The forum threads since 2020, combined the same way.')}</p>
      ${past}
    </section>` : ''}

    <section class="section small faint">
      <p>${t('Bananas: 20 🍌 for a ballot, and 1 🍌 per word of write-up (up to 40) for each player on your list, +30 when everyone on it has 40 words, and +5 each time a player thanks you. Paid after the mods’ review, once voting closes.')}
        ${t('Each ballot pays on its own, so doing both pays twice.')}</p>
    </section>`;
}
