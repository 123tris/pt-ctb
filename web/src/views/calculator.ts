// The pp calculator and "What if…?" (/calculator), as assets/js/pages/calculator.js has it. render() draws the page
// with the calculator already worked out for its starting values, so the first paint is final; calculator.mount.ts
// recalculates as the fields change and runs the "What if".

import { html, raw, type Safe } from '../kernel/html.ts';
import type { Ctx } from '../kernel/ctx.ts';
import type { CorePack } from '../gen/packs.ts';
import { M, MOD, catchPp, adjustedAr } from '../kernel/model.ts';
import { CALC_PRESETS } from '../../../assets/js/core/presets.js';
import { mapLink, type MapMeta } from '../ui/maps.ts';
import { ppText, rowOf } from '../ui/players.ts';
import { playerPicker } from '../ui/pickers.ts';

export const CALC_MODS = ['EZ', 'HD', 'HR', 'DT', 'HT', 'FL', 'NF'] as const;
/** Mods that can't go together: picking one drops the other. */
export const EXCLUSIVE: Record<string, string> = { EZ: 'HR', HR: 'EZ', DT: 'HT', HT: 'DT' };
const ACC_STEPS = [95, 96, 97, 98, 99, 99.5, 100];

export interface Data {
  core: CorePack;
  /** The preset or linked map (?map=), with its details when the data has them. */
  mapId: number | null;
  meta: MapMeta;
}

/** The calculator's fields. */
export interface Inputs {
  stars: number;
  ar: number;
  maxCombo: number;
  combo: number;
  acc: number;
  misses: number;
  mods: number;
}

/** The fields' starting values: the map's, or a 5★ AR9 map of 1,000 combo. */
export function startInputs(meta: MapMeta): Inputs {
  const maxCombo = Number(meta?.[M.MAX_COMBO]) || 1000;
  return { stars: meta ? Number(meta[M.STARS]) || 0 : 5, ar: meta ? Number(meta[M.AR]) || 0 : 9, maxCombo, combo: maxCombo, acc: 99, misses: 0, mods: 0 };
}

/** The calculator's results for `inputs`: the pp, the note under it, and the accuracy table's rows. */
export function results(ctx: Ctx, inputs: Inputs): { pp: string; note: string; table: Safe } {
  const { t, fmt } = ctx;
  const ar = adjustedAr(inputs.ar, inputs.mods);
  const base = { stars: inputs.stars, ar, maxCombo: inputs.maxCombo, mods: inputs.mods, comboHits: undefined };
  const pp = catchPp({ ...base, combo: Math.min(inputs.combo, inputs.maxCombo), misses: inputs.misses, acc: inputs.acc });
  const note = pp === 0 ? t('Time to quit this game instead.')
    : inputs.mods & (MOD.EZ | MOD.HR | MOD.DT | MOD.HT) ? t('AR with mods: {ar}', { ar: fmt.num(ar, 2) }) : '';
  const table = html`${ACC_STEPS.map(a => html`<tr>
      <td>${fmt.acc(a)}</td><td class="num">${ppText(ctx, catchPp({ ...base, combo: base.maxCombo, acc: a }))}</td></tr>`)}`;
  return { pp: `${fmt.num(pp, 2)} pp`, note, table };
}

export function render(ctx: Ctx, { core, mapId, meta }: Data): Safe {
  const { t } = ctx;
  const start = startInputs(meta);
  const first = results(ctx, start);
  const me = ctx.me === null ? -1 : rowOf(core.players, ctx.me);
  return html`
    <header class="page-head">
      <h1>${t('Calculator')}</h1>
      <p>${t('The current osu!catch pp formula (the same one the bot uses) and a "what if I set this play?" simulator. Do the maths before the next rework.')}</p>
    </header>

    <section class="grid grid-2">
      <div class="card">
        <h2>${t('pp calculator')}</h2>
        <nav class="mb-3 chips" aria-label="${t('Preset maps')}">
          <span class="chips-label small faint">${t('Try:')}</span>
          ${CALC_PRESETS.map(([id, label]) => html`<a class="chip ${id === mapId ? 'active' : ''}" href="/calculator?map=${id}" ${id === mapId ? raw('aria-current="page"') : ''}>${label}</a>`)}
        </nav>
        ${meta ? html`<div class="mb-3">${mapLink(ctx, mapId!, meta)}</div>` : ''}
        <div class="gap-3 grid grid-2">
          <div class="field"><label for="stars">${t('Stars (with mods applied)')}</label><input class="input" id="stars" type="number" step="0.01" min="0" value="${meta ? meta[M.STARS] : 5}"></div>
          <div class="field"><label for="ar">${t('Base AR (without mods)')}</label><input class="input" id="ar" type="number" step="0.1" min="0" max="11" value="${meta ? meta[M.AR] : 9}"></div>
          <div class="field"><label for="maxcombo">${t('Map max combo')}</label><input class="input" id="maxcombo" type="number" min="1" value="${start.maxCombo}"></div>
          <div class="field"><label for="combo">${t('Your combo')}</label><input class="input" id="combo" type="number" min="0" value="${start.maxCombo}"></div>
          <div class="field"><label for="acc">${t('Accuracy (%)')}</label><input class="input" id="acc" type="number" step="0.01" min="0" max="100" value="99"></div>
          <div class="field"><label for="miss">${t('Misses')}</label><input class="input" id="miss" type="number" min="0" value="0"></div>
        </div>
        <div class="mt-3 field">
          <span class="field-label" id="mods-label">Mods</span>
          <div class="chips" id="mods" role="group" aria-labelledby="mods-label">${CALC_MODS.map(m => html`<button class="chip" type="button" data-mod="${m}" aria-pressed="false">${m}</button>`)}</div>
        </div>
        <p class="m-0 mt-2 small faint">${t('EZ, HR, DT and HT change the star rating: enter the one osu! shows with the chosen mods. AR is adjusted here automatically. Copium included.')}</p>
        <div class="mt-4">
          <div class="result-big" id="pp">${first.pp}</div>
          <div class="muted small" id="ar-note">${first.note}</div>
        </div>
        <div class="mt-3 table-wrap"><table class="table-compact"><thead><tr><th>${t('Accuracy')}</th><th class="num">pp (FC)</th></tr></thead><tbody id="acc-table">${first.table}</tbody></table></div>
      </div>

      <div class="card">
        <h2>${t('What if…?')}</h2>
        <p class="muted small">${t('Pick a player and a leaderboard and see how far a new play would take them.')}</p>
        <div class="gap-3 grid">
          <div class="field"><label for="who">${t('Player')}</label>${playerPicker(core.players, 'who', me, ctx.t('Player name…'))}</div>
          <div class="field"><label for="board">${t('Leaderboard')}</label>
            <select class="select" id="board"><option value="c">${t('Converts')}</option><option value="u">${t('Loved & Unranked')}</option></select></div>
          <div class="field"><label for="newpp">${t('New play pp')}</label><input class="input" id="newpp" type="number" min="0" step="0.01" value="300"></div>
        </div>
        <div id="whatif" class="mt-4">${me < 0 ? html`<p class="faint">${t('Pick a player from the list.')}</p>` : ''}</div>
      </div>
    </section>
  `;
}

/** A player's place on a board (`key`: cv or ul, hundredths): everyone above 0 pp, best first, as the old page ranks it. */
export function boardOrder(core: CorePack, key: 'cv' | 'ul'): number[] {
  const values = core.players[key];
  const rows: number[] = [];
  for (let row = 0; row < core.players.rows; row++) if (values[row] > 0) rows.push(row);
  return rows.sort((a, b) => values[b] - values[a]);
}
