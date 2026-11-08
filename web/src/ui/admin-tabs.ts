// The admin panel's tabs (/admin): the bot's settings and actions, and Top 10 (?tab=top10, views/top10-admin.ts).

import { html, raw, type Safe } from '../kernel/html.ts';
import type { Ctx } from '../kernel/ctx.ts';

export const adminTabs = (ctx: Ctx, current: 'bot' | 'top10'): Safe => html`<nav class="tabs" aria-label="${ctx.t('Admin')}">
  <a href="/admin" class="${current === 'bot' ? 'active' : ''}" ${current === 'bot' ? raw('aria-current="page"') : ''}>${ctx.t('Bot')}</a>
  <a href="/admin?tab=top10" class="${current === 'top10' ? 'active' : ''}" ${current === 'top10' ? raw('aria-current="page"') : ''}>${ctx.t('Top 10')}</a></nav>`;
