import { html, raw } from '../core/html.js';
import { players, playerFile, mapEntry } from '../core/data.js';
import { S, M, MOD, catchPp, adjustedAr, weightedTotal, countedPp } from '../core/model.js';
import { setTitle, playerPicker, pickedPlayer, prefs, mapLink, ppText } from '../core/ui.js';
import { CALC_PRESETS } from '../core/lore.js';
import * as fmt from '../core/fmt.js';
import { t, th } from '../core/i18n.js';

const CALC_MODS = ['EZ', 'HD', 'HR', 'DT', 'HT', 'FL', 'NF'];
const EXCLUSIVE = { EZ: 'HR', HR: 'EZ', DT: 'HT', HT: 'DT' };

/** The smallest single new play (pp) that lifts `scores` (pp, best first) past `target` total pp; null if none ≤ 3000. */
function ppToReach(scores, target) {
  const totalWith = extra => weightedTotal([...scores, extra].sort((a, b) => b - a));
  if (totalWith(3000) <= target) return null;
  let lo = 0, hi = 3000;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (totalWith(mid) > target) hi = mid; else lo = mid;
  }
  return hi;
}

export default async function calculator(root, { query, isCurrent }) {
  const mapId = Number(query.map) || null;
  const [list, entry] = await Promise.all([players(), mapId ? mapEntry(mapId) : null]);
  if (!isCurrent()) return;
  setTitle(t('Calculator'));
  const meta = entry?.m ?? null;
  const me = list.find(p => p.id === prefs.get('me', null));

  root.innerHTML = String(html`
    <header class="page-head">
      <h1>${t('Calculator')}</h1>
      <p>${t('The current osu!catch pp formula (the same one the bot uses) and a "what if I set this play?" simulator. Do the maths before the next rework.')}</p>
    </header>

    <section class="grid grid-2">
      <div class="card">
        <h2>${t('pp calculator')}</h2>
        <nav class="mb-3 chips" aria-label="${t('Preset maps')}">
          <span class="chips-label small faint">${t('Try:')}</span>
          ${CALC_PRESETS.map(([id, label]) => html`<a class="chip ${id === mapId ? 'active' : ''}" href="#/calculator?map=${id}" ${id === mapId ? raw('aria-current="page"') : ''}>${label}</a>`)}
        </nav>
        ${meta ? html`<div class="mb-3">${mapLink(mapId, meta)}</div>` : ''}
        <div class="gap-3 grid grid-2">
          <div class="field"><label for="stars">${t('Stars (with mods applied)')}</label><input class="input" id="stars" type="number" step="0.01" min="0" value="${meta ? meta[M.STARS] : 5}"></div>
          <div class="field"><label for="ar">${t('Base AR (without mods)')}</label><input class="input" id="ar" type="number" step="0.1" min="0" max="11" value="${meta ? meta[M.AR] : 9}"></div>
          <div class="field"><label for="maxcombo">${t('Map max combo')}</label><input class="input" id="maxcombo" type="number" min="1" value="${meta?.[M.MAX_COMBO] || 1000}"></div>
          <div class="field"><label for="combo">${t('Your combo')}</label><input class="input" id="combo" type="number" min="0" value="${meta?.[M.MAX_COMBO] || 1000}"></div>
          <div class="field"><label for="acc">${t('Accuracy (%)')}</label><input class="input" id="acc" type="number" step="0.01" min="0" max="100" value="99"></div>
          <div class="field"><label for="miss">${t('Misses')}</label><input class="input" id="miss" type="number" min="0" value="0"></div>
        </div>
        <div class="mt-3 field">
          <span class="field-label" id="mods-label">Mods</span>
          <div class="chips" id="mods" role="group" aria-labelledby="mods-label">${CALC_MODS.map(m => html`<button class="chip" type="button" data-mod="${m}" aria-pressed="false">${m}</button>`)}</div>
        </div>
        <p class="m-0 mt-2 small faint">${t('EZ, HR, DT and HT change the star rating: enter the one osu! shows with the chosen mods. AR is adjusted here automatically. Copium included.')}</p>
        <div class="mt-4">
          <div class="result-big" id="pp">0 pp</div>
          <div class="muted small" id="ar-note"></div>
        </div>
        <div class="mt-3 table-wrap"><table class="table-compact"><thead><tr><th>${t('Accuracy')}</th><th class="num">pp (FC)</th></tr></thead><tbody id="acc-table"></tbody></table></div>
      </div>

      <div class="card">
        <h2>${t('What if…?')}</h2>
        <p class="muted small">${t('Pick a player and a leaderboard and see how far a new play would take them.')}</p>
        <div class="gap-3 grid">
          <div class="field"><label for="who">${t('Player')}</label>${playerPicker('who', list, me)}</div>
          <div class="field"><label for="board">${t('Leaderboard')}</label>
            <select class="select" id="board"><option value="c">${t('Converts')}</option><option value="u">${t('Loved & Unranked')}</option></select></div>
          <div class="field"><label for="newpp">${t('New play pp')}</label><input class="input" id="newpp" type="number" min="0" step="0.01" value="300"></div>
        </div>
        <div id="whatif" class="mt-4"></div>
      </div>
    </section>
  `);

  // ---- pp calculator ----
  const mods = new Set();
  const $ = id => root.querySelector(`#${id}`);
  const value = id => Number($(id).value) || 0;
  const recalc = () => {
    const mask = [...mods].reduce((m, name) => m | MOD[name], 0);
    const ar = adjustedAr(value('ar'), mask);
    const base = { stars: value('stars'), ar, maxCombo: value('maxcombo'), mods: mask };
    const pp = catchPp({ ...base, combo: Math.min(value('combo'), value('maxcombo')), misses: value('miss'), acc: value('acc') });
    $('pp').textContent = `${fmt.num(pp, 2)} pp`;
    $('ar-note').textContent = pp === 0 ? t('Time to quit this game instead.')
      : mask & (MOD.EZ | MOD.HR | MOD.DT | MOD.HT) ? t('AR with mods: {ar}', { ar: fmt.num(ar, 2) }) : '';
    $('acc-table').innerHTML = String(html`${[95, 96, 97, 98, 99, 99.5, 100].map(a => html`<tr>
      <td>${fmt.acc(a)}</td><td class="num">${ppText(catchPp({ ...base, combo: base.maxCombo, acc: a }))}</td></tr>`)}`);
    root.querySelectorAll('[data-mod]').forEach(b => {
      b.classList.toggle('active', mods.has(b.dataset.mod));
      b.setAttribute('aria-pressed', String(mods.has(b.dataset.mod)));
    });
  };
  $('mods').addEventListener('click', e => {
    const name = e.target.dataset.mod;
    if (!name) return;
    if (mods.has(name)) mods.delete(name);
    else { mods.add(name); mods.delete(EXCLUSIVE[name]); }
    recalc();
  });
  ['stars', 'ar', 'maxcombo', 'combo', 'acc', 'miss'].forEach(id => $(id).addEventListener('input', recalc));
  recalc();

  // ---- what if ----
  const out = $('whatif');
  let ticket = 0;
  const whatIf = async () => {
    const mine = ++ticket;
    const p = pickedPlayer($('who'), list);
    if (!p) { out.innerHTML = String(html`<p class="faint">${t('Pick a player from the list.')}</p>`); return; }
    const cat = $('board').value;
    const file = await playerFile(p.id);
    if (mine !== ticket || !isCurrent()) return;
    const scores = countedPp(file, cat);
    const key = cat === 'c' ? 'cv' : 'ul';
    const now = weightedTotal(scores);
    const extra = value('newpp');
    const after = weightedTotal([...scores, extra].sort((a, b) => b - a));
    const board = list.filter(q => q[key] > 0).sort((a, b) => b[key] - a[key]);
    const rankNow = board.findIndex(q => q.id === p.id) + 1 || board.length + 1;
    const rankAfter = board.filter(q => q.id !== p.id && q[key] > after).length + 1;
    const above = board[rankNow - 2];
    const needed = above ? ppToReach(scores, above[key]) : null;
    out.innerHTML = String(html`
      <div class="stats">
        <div class="stat"><div class="stat-label">${t('Now')}</div><div class="stat-value">${fmt.pp(now)} pp</div><div class="stat-sub">${t('{rank} in Portugal', { rank: fmt.rank(rankNow) })}</div></div>
        <div class="stat"><div class="stat-label">${t('With the play')}</div><div class="stat-value">${fmt.pp(after)} pp</div><div class="stat-sub">+${fmt.num(after - now, 2)} pp · ${fmt.rank(rankAfter)}</div></div>
      </div>
      <p class="mt-3 small muted">${above
        ? needed !== null
          ? th('To pass {name} ({pp} pp) you need a new play worth at least {needed}.', { name: html`<b>${above.name}</b>`, pp: fmt.pp(above[key]), needed: html`<b>${fmt.num(needed, 2)} pp</b>` })
          : th('No single play is enough to pass {name}.', { name: html`<b>${above.name}</b>` })
        : t('Already first. Now defend the spot.')}</p>
      <p class="small faint">${t('This assumes a new map; if you already have a score on that map, the real gain is smaller.')}</p>`);
  };
  $('who').addEventListener('input', () => { if (pickedPlayer($('who'), list)) whatIf(); });
  $('who').addEventListener('change', whatIf);
  $('board').addEventListener('change', whatIf);
  $('newpp').addEventListener('input', whatIf);
  whatIf();
}
