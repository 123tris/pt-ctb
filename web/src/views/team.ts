// Team Portugal (/team): the World Cup timeline, the yearly top 10 threads and the server's currency, as
// assets/js/pages/team.js draws it. No data: the text is the community's lore (ui/lore.ts).

import { html, type Safe } from '../kernel/html.ts';
import type { Ctx } from '../kernel/ctx.ts';
import { teamTimeline, TOP10_THREADS } from '../ui/lore.ts';

export const title = ({ t }: Ctx) => t('Team Portugal');

export function render(ctx: Ctx): Safe {
  const { t } = ctx;
  return html`
    <header class="page-head">
      <h1>${t('Team Portugal')} <span class="faint" lang="pt-PT">· A Seleção</span></h1>
      <p>${t('Portugal at the Catch World Cup and its 4-digit edition, as the Discord remembers it. The tournament channels are where this community is proudest and loudest.')}</p>
    </header>

    <ol class="timeline">${teamTimeline(ctx).map(([year, name, text]) => html`<li>
      <span class="timeline-year">${year}</span>
      <div class="timeline-body"><b>${name}</b><p>${text}</p></div>
    </li>`)}</ol>

    <section class="section grid grid-2">
      <div class="card">
        <h2>Top 10 PT Catch Players</h2>
        <p class="muted">${t('Every year since 2020, someone posts their top 10 Portuguese catch players on the osu! forums and everyone replies with their own list. The rule since day one: you’re supposed to leave yourself out.')}</p>
        <div class="link-list one-col">${TOP10_THREADS.map(([year, url]) => html`<a href="${url}" target="_blank" rel="noopener"><b>${t('The {year} list', { year })}</b><span>${t('osu! forums')} ↗</span></a>`)}</div>
      </div>
      <div class="card">
        <h2>${t('The currency')}</h2>
        <p class="muted">${t('Bounties, challenges and bets on this server have been paid in osu!supporter since 2018: weekly prizes, a month per sniped loved score, the top-50 challenge, and in 2026 a month of supporter for every point the CWC team took.')}</p>
        <a class="btn btn-small" href="/challenges">${t('See the challenges')}</a>
      </div>
    </section>
  `;
}
