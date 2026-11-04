// The calculator's browser half: recalculating as the fields change, and the "What if…?", which reads the picked
// player's pack (their plays' pp) and works out the totals with WeightedTotals instead of sorting the list again for
// every value it tries.

import { html } from '../kernel/html.ts';
import type { Ctx } from '../kernel/ctx.ts';
import { MOD } from '../kernel/model.ts';
import { readPlayer } from '../gen/packs.ts';
import { store } from '../client/boot.ts';
import { playerPack } from '../routes.ts';
import { pickedRow } from '../ui/pickers.ts';
import { countedPp, WeightedTotals } from '../ui/playerpack.ts';
import { EXCLUSIVE, boardOrder, results, type Data } from './calculator.ts';

export function mount(root: HTMLElement, ctx: Ctx, { core }: Data, isCurrent: () => boolean): void {
  const { t, th, fmt } = ctx;
  const $ = <T extends HTMLElement = HTMLInputElement>(id: string) => root.querySelector<T>(`#${id}`)!;
  const value = (id: string) => Number($(id).value) || 0;

  // ---- pp calculator ----
  const mods = new Set<string>();
  const recalc = () => {
    const mask = [...mods].reduce((m, name) => m | MOD[name as keyof typeof MOD], 0);
    const out = results(ctx, {
      stars: value('stars'), ar: value('ar'), maxCombo: value('maxcombo'), combo: value('combo'), acc: value('acc'), misses: value('miss'), mods: mask,
    });
    $('pp').textContent = out.pp;
    $('ar-note').textContent = out.note;
    $('acc-table').innerHTML = String(out.table);
    root.querySelectorAll<HTMLElement>('[data-mod]').forEach(b => {
      b.classList.toggle('active', mods.has(b.dataset.mod!));
      b.setAttribute('aria-pressed', String(mods.has(b.dataset.mod!)));
    });
  };
  $('mods').addEventListener('click', e => {
    const name = (e.target as HTMLElement).dataset.mod;
    if (!name) return;
    if (mods.has(name)) mods.delete(name);
    else { mods.add(name); mods.delete(EXCLUSIVE[name]); }
    recalc();
  });
  ['stars', 'ar', 'maxcombo', 'combo', 'acc', 'miss'].forEach(id => $(id).addEventListener('input', recalc));

  // ---- what if ----
  const out = $<HTMLElement>('whatif');
  const players = core.players;
  let ticket = 0;
  const whatIf = async () => {
    const mine = ++ticket;
    const row = pickedRow(players, $('who').value);
    if (row < 0) { out.innerHTML = String(html`<p class="faint">${t('Pick a player from the list.')}</p>`); return; }
    const cat = $<HTMLSelectElement>('board').value as 'c' | 'u';
    const pack = await store.pack(playerPack(players.id[row]), readPlayer);
    if (mine !== ticket || !isCurrent()) return;
    const totals = new WeightedTotals(countedPp(pack, cat));
    const key = cat === 'c' ? 'cv' : 'ul';
    const now = totals.total;
    const after = totals.with(value('newpp'));
    const board = boardOrder(core, key);
    const rankNow = board.indexOf(row) + 1 || board.length + 1;
    const rankAfter = board.filter(r => r !== row && players[key][r] / 100 > after).length + 1;
    const above = rankNow >= 2 ? board[rankNow - 2] : undefined;
    const abovePp = above === undefined ? 0 : players[key][above] / 100;
    const needed = above === undefined ? null : totals.toReach(abovePp);
    const name = above === undefined ? '' : players.name.at(above);
    out.innerHTML = String(html`
      <div class="stats">
        <div class="stat"><div class="stat-label">${t('Now')}</div><div class="stat-value">${fmt.pp(now)} pp</div><div class="stat-sub">${t('{rank} in Portugal', { rank: fmt.rank(rankNow) })}</div></div>
        <div class="stat"><div class="stat-label">${t('With the play')}</div><div class="stat-value">${fmt.pp(after)} pp</div><div class="stat-sub">+${fmt.num(after - now, 2)} pp · ${fmt.rank(rankAfter)}</div></div>
      </div>
      <p class="mt-3 small muted">${above !== undefined
        ? needed !== null
          ? th('To pass {name} ({pp} pp) you need a new play worth at least {needed}.', { name: html`<b>${name}</b>`, pp: fmt.pp(abovePp), needed: html`<b>${fmt.num(needed, 2)} pp</b>` })
          : th('No single play is enough to pass {name}.', { name: html`<b>${name}</b>` })
        : t('Already first. Now defend the spot.')}</p>
      <p class="small faint">${t('This assumes a new map; if you already have a score on that map, the real gain is smaller.')}</p>`);
  };
  $('who').addEventListener('input', () => { if (pickedRow(players, $('who').value) >= 0) whatIf(); });
  $('who').addEventListener('change', whatIf);
  $('board').addEventListener('change', whatIf);
  $('newpp').addEventListener('input', whatIf);
  if (ctx.me !== null) whatIf();
}
