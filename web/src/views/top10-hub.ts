// /top10: the season's page (§2, §3.3, §6). Where the season is (opens soon, open, closed, results out), how many
// ballots are in, the countdown to the reveal at 12:00 Lisbon on 2 January, the rules, and the way in: vote, edit
// your ballot, or sign in. Once the results are out, a placeholder until the reveal pages come (December's work).
// /top10/<year> (the results) shows the same placeholder for now.

import { html, type Safe } from '../kernel/html.ts';
import type { Ctx } from '../kernel/ctx.ts';
import { signInButton } from '../ui/bananas.ts';
import {
  countdown, lisbon, phaseName, publicNote, rules, toSec, top10Tabs, troubleNote,
  type Hub, type Phase, type Season, type Trouble,
} from '../ui/top10.ts';

export interface Data {
  season: Season;
  phase: Phase;
  hub: Hub | null;
  trouble: Trouble;
  signInHere: boolean;
  /** /top10/<year>: the results page asked for. */
  results?: number;
}

/** The way in, by phase and by where your ballot is. */
function callToAction(ctx: Ctx, d: Data): Safe {
  const { t } = ctx;
  const mine = d.hub?.me?.ballot ?? null;
  if (d.phase === 'revealed') return html``;
  if (ctx.me === null) {
    return html`<div class="t10-cta"><p class="m-0">${t('Only PT players can vote. Sign in with osu! to make your list.')}</p>${signInButton(ctx, d.signInHere)}</div>`;
  }
  if (d.hub?.me && !d.hub.me.eligible) return html`<div class="t10-cta"><p class="m-0">${d.hub.me.reason ? t(d.hub.me.reason) : t('Only PT players can vote.')}</p></div>`;
  if (d.phase === 'closed') {
    return html`<div class="t10-cta"><p class="m-0">${mine?.status === 'submitted' ? t('Your ballot is in. The results come out at the reveal.') : t('Voting has closed.')}</p>
      <a class="btn" href="/top10/ballots">${t('Read the ballots')}</a></div>`;
  }
  const label = mine?.status === 'submitted' ? t('Edit your ballot') : mine?.picks?.length ? t('Finish your ballot') : d.phase === 'before' ? t('Start your list') : t('Vote now');
  const sub = mine?.status === 'submitted' ? t('Your top 10 is in ✅. You can still change it and write about the players until it closes.')
    : t('Rank 5 to 10 players. About two minutes; writing about them is optional.');
  return html`<div class="t10-cta t10-cta-go"><p class="m-0">${sub}</p><a class="btn btn-primary" href="/top10/vote">${label}</a></div>`;
}

export function render(ctx: Ctx, d: Data): Safe {
  const { t, tn, fmt } = ctx;
  const { season, phase } = d;
  const year = season.year;
  const opens = toSec(season.opens), closes = toSec(season.closes), reveal = toSec(season.reveal);
  const turnout = d.hub?.turnout;

  if (d.results !== undefined || phase === 'revealed') {
    return html`${top10Tabs(ctx, 'hub', year)}
      <header class="page-head"><span class="eyebrow">${t('Top 10 of {year}', { year: d.results ?? year })}</span><h1>${t('The results')}</h1></header>
      <div class="empty t10-soon"><p class="t10-done-big">🏆</p>
        <p>${phase === 'revealed' ? t('The results are out. The reveal, 10 to 1, comes to this page in January.') : t('The results come out {when}, Lisbon time.', { when: lisbon(ctx, reveal) })}</p>
        <div class="btn-row justify-center"><a class="btn" href="/top10/ballots">${t('Read the ballots')}</a><a class="btn" href="/top10/plays">${t('Plays of {year}', { year })}</a></div></div>`;
  }

  const when = phase === 'before' ? t('Voting opens {when}.', { when: lisbon(ctx, opens) })
    : phase === 'open' ? t('Voting closes {when}, Lisbon time.', { when: lisbon(ctx, closes) })
      : t('Voting closed {when}.', { when: lisbon(ctx, closes) });
  return html`${top10Tabs(ctx, 'hub', year)}
    <header class="page-head t10-hero">
      <span class="eyebrow">${t('PT osu!catch · every December')}</span>
      <h1>${t('Top 10 of {year}', { year })}</h1>
      <p>${t('Rank the Portuguese catch players of the year. Everyone’s lists are combined into one top 10, revealed in January. What you write about them stays on their profile for good.')}</p>
    </header>
    ${troubleNote(ctx, d.trouble === 'signin' ? null : d.trouble)}

    <div class="t10-phase">
      <span class="t10-state t10-state-${phase}">${phaseName(ctx, phase)}</span>
      <span>${when}</span>
      ${turnout !== undefined ? html`<span class="t10-turnout"><b>${fmt.num(turnout)}</b> ${tn(turnout, 'ballot in', 'ballots in')}</span>` : ''}
    </div>

    ${callToAction(ctx, d)}

    <section class="section" aria-labelledby="t10-cd-h">
      <h2 id="t10-cd-h">${t('The reveal')}</h2>
      <p class="muted">${t('{when}, Lisbon time: the top 10 from 10 to 1, then everything people wrote.', { when: lisbon(ctx, reveal) })}</p>
      ${countdown(ctx, reveal, t('Time to the reveal'))}
      <p class="small faint">${t('Until then nobody sees the combined ranking, not even the mods. Each ballot is public as soon as it’s submitted.')}</p>
    </section>

    <section class="section" aria-labelledby="t10-rules-h">
      <h2 id="t10-rules-h">${t('The rules')}</h2>
      ${rules(ctx, season)}
      ${publicNote(ctx)}
    </section>

    <section class="section" aria-labelledby="t10-more-h">
      <h2 id="t10-more-h">${t('While you decide')}</h2>
      <div class="grid grid-auto">
        <a class="card card-link" href="/top10/plays"><h3 class="m-0">🔥 ${t('Plays of {year}', { year })}</h3><p class="muted m-0">${t('The year’s notable scores, showcased and endorsed by the community. Add the ones voters should see.')}</p></a>
        <a class="card card-link" href="/top10/ballots"><h3 class="m-0">📝 ${t('Ballots')}</h3><p class="muted m-0">${t('Every submitted list and what its voter wrote, like the forum threads. Make your own list first.')}</p></a>
        ${ctx.me !== null ? html`<a class="card card-link" href="/top10/dossier/${ctx.me}/${year}"><h3 class="m-0">📇 ${t('Your year')}</h3><p class="muted m-0">${t('Your dossier: what voters see when they look you up.')}</p></a>` : ''}
      </div>
    </section>

    <section class="section small faint">
      <p>${t('Bananas: 20 🍌 for a ballot, and 1 🍌 per 4 words of write-up (up to 10 at 40 words) for each player on your list, +30 when everyone on it has 40 words, and +5 each time a player thanks you. Paid after the mods’ review, once voting closes.')}</p>
    </section>`;
}
