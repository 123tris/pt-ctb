// The King of the hill tab's browser half: the season picker (chips, or a select past five seasons) redraws the crown
// table, and the tier chips switch the pool's tier on phones; both are kept in the address.

import type { Ctx } from '../kernel/ctx.ts';
import type { Players } from '../ui/players.ts';
import { tierName } from '../ui/hill.ts';
import { announce, writeQuery } from '../client/ui.ts';
import { setPressed } from '../client/dom.ts';
import { countText, crownTable, seasonTitles, tableRows, type Hill, type State } from './hill.ts';

export function mount(panel: HTMLElement, ctx: Ctx, hill: Hill, players: Players, start: State): void {
  let { scope, tier } = start;
  const save = () => writeQuery({ season: scope, tier }, { season: 'all', tier: 'open' });
  const titles = panel.querySelector<HTMLElement>('#hill-titles')!;
  const table = panel.querySelector<HTMLElement>('#hill-table')!;
  const count = panel.querySelector<HTMLElement>('#hill-count')!;
  const draw = () => {
    const season = hill.seasons.find(s => s.id === scope) ?? null;
    const rows = tableRows(hill, scope);
    titles.innerHTML = String(season ? seasonTitles(ctx, season, players) : '');
    table.innerHTML = String(crownTable(ctx, rows, season, players));
    count.textContent = countText(ctx, rows);
    setPressed(panel, 'scope', scope);
    save();
    announce(count.textContent || ctx.t('No crowns yet.'));
  };
  panel.querySelector('#hill-scope')?.addEventListener('change', e => { scope = (e.target as HTMLSelectElement).value; draw(); });
  panel.querySelector('#hill-scopes')?.addEventListener('click', e => {
    const chip = (e.target as Element).closest<HTMLElement>('[data-scope]');
    if (chip) { scope = chip.dataset.scope!; draw(); }
  });
  // Phones show one tier of the pool at a time.
  const pick = panel.querySelector<HTMLElement>('.hill-pick');
  pick?.addEventListener('click', e => {
    const chip = (e.target as Element).closest<HTMLElement>('[data-tier]');
    if (!chip) return;
    tier = chip.dataset.tier!;
    panel.querySelector<HTMLElement>('.hill-pool')!.dataset.show = tier;
    setPressed(pick, 'tier', tier);
    save();
    announce(tierName(ctx, tier));
  });
  // An unknown season or tier in the address goes, as the old page's first draw did.
  save();
}
