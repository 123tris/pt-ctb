import { html } from '../core/html.js';
import { players, playerFile, mapEntry } from '../core/data.js';
import { S, M, MOD, catchPp, adjustedAr, weightedTotal } from '../core/model.js';
import { setTitle, playerPicker, pickedPlayer, prefs, mapLink, ppText } from '../core/ui.js';
import { CALC_PRESETS } from '../core/lore.js';
import * as fmt from '../core/fmt.js';

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
  setTitle('Calculator');
  const meta = entry?.m ?? null;
  const me = list.find(p => p.id === prefs.get('me', null));

  root.innerHTML = String(html`
    <header class="page-head">
      <span class="eyebrow">Calculator</span>
      <h1>How much pp is it worth?</h1>
      <p>The current osu!catch pp formula (the same one the bot uses) and a "what if I set this play?" simulator. Do the maths before the next rework.</p>
    </header>

    <section class="grid grid-2">
      <div class="card">
        <h2>pp calculator</h2>
        <div class="chips" style="margin-bottom:14px" aria-label="Preset maps">
          <span class="small faint" style="align-self:center;margin-right:4px">Try:</span>
          ${CALC_PRESETS.map(([id, label]) => html`<a class="chip ${id === mapId ? 'active' : ''}" href="#/calculator?map=${id}">${label}</a>`)}
        </div>
        ${meta ? html`<div style="margin-bottom:14px">${mapLink(mapId, meta)}</div>` : ''}
        <div class="grid grid-2" style="gap:12px">
          <div class="field"><label for="stars">Stars (with mods applied)</label><input class="input" id="stars" type="number" step="0.01" min="0" value="${meta ? meta[M.STARS] : 5}"></div>
          <div class="field"><label for="ar">Base AR (without mods)</label><input class="input" id="ar" type="number" step="0.1" min="0" max="11" value="${meta ? meta[M.AR] : 9}"></div>
          <div class="field"><label for="maxcombo">Map max combo</label><input class="input" id="maxcombo" type="number" min="1" value="${meta?.[M.MAX_COMBO] || 1000}"></div>
          <div class="field"><label for="combo">Your combo</label><input class="input" id="combo" type="number" min="0" value="${meta?.[M.MAX_COMBO] || 1000}"></div>
          <div class="field"><label for="acc">Accuracy (%)</label><input class="input" id="acc" type="number" step="0.01" min="0" max="100" value="99"></div>
          <div class="field"><label for="miss">Misses</label><input class="input" id="miss" type="number" min="0" value="0"></div>
        </div>
        <div class="field" style="margin-top:12px">
          <label>Mods</label>
          <div class="chips" id="mods">${CALC_MODS.map(m => html`<button class="chip" type="button" data-mod="${m}">${m}</button>`)}</div>
        </div>
        <p class="small faint" style="margin:10px 0 0">EZ, HR, DT and HT change the star rating: enter the one osu! shows with the chosen mods. AR is adjusted here automatically. Copium included.</p>
        <div style="margin-top:18px">
          <div class="result-big" id="pp">0 pp</div>
          <div class="muted small" id="ar-note"></div>
        </div>
        <div class="table-wrap" style="margin-top:14px"><table class="table-compact"><thead><tr><th>Accuracy</th><th class="num">pp (FC)</th></tr></thead><tbody id="acc-table"></tbody></table></div>
      </div>

      <div class="card">
        <h2>What if…?</h2>
        <p class="muted small">Pick a player and a leaderboard and see how far a new play would take them.</p>
        <div class="grid" style="gap:12px">
          <div class="field"><label for="who">Player</label>${playerPicker('who', list, me)}</div>
          <div class="field"><label for="board">Leaderboard</label>
            <select class="select" id="board"><option value="c">Converts</option><option value="u">Loved & Unranked</option></select></div>
          <div class="field"><label for="newpp">New play pp</label><input class="input" id="newpp" type="number" min="0" step="0.01" value="300"></div>
        </div>
        <div id="whatif" style="margin-top:18px"></div>
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
    $('ar-note').textContent = pp === 0 ? 'Time to quit this game instead.'
      : mask & (MOD.EZ | MOD.HR | MOD.DT | MOD.HT) ? `AR with mods: ${fmt.num(ar, 2)}` : '';
    $('acc-table').innerHTML = String(html`${[95, 96, 97, 98, 99, 99.5, 100].map(a => html`<tr>
      <td>${fmt.acc(a)}</td><td class="num">${ppText(catchPp({ ...base, combo: base.maxCombo, acc: a }))}</td></tr>`)}`);
    root.querySelectorAll('[data-mod]').forEach(b => b.classList.toggle('active', mods.has(b.dataset.mod)));
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
    if (!p) { out.innerHTML = String(html`<p class="faint">Pick a player from the list.</p>`); return; }
    const cat = $('board').value;
    const file = await playerFile(p.id);
    if (mine !== ticket || !isCurrent()) return;
    const scores = file.scores[cat].map(s => s[S.PP]).sort((a, b) => b - a);
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
        <div class="stat"><div class="stat-label">Now</div><div class="stat-value">${fmt.pp(now)} pp</div><div class="stat-sub">${fmt.rank(rankNow)} in Portugal</div></div>
        <div class="stat"><div class="stat-label">With the play</div><div class="stat-value">${fmt.pp(after)} pp</div><div class="stat-sub">+${fmt.num(after - now, 2)} pp · ${fmt.rank(rankAfter)}</div></div>
      </div>
      <p class="small muted" style="margin-top:12px">${above
        ? needed !== null
          ? html`To pass <b>${above.name}</b> (${fmt.pp(above[key])} pp) you need a new play worth at least <b>${fmt.num(needed, 2)} pp</b>.`
          : html`No single play is enough to pass <b>${above.name}</b>.`
        : 'Already first. Now defend the spot.'}</p>
      <p class="small faint">This assumes a new map; if you already have a score on that map, the real gain is smaller.</p>`);
  };
  $('who').addEventListener('input', () => { if (pickedPlayer($('who'), list)) whatIf(); });
  $('who').addEventListener('change', whatIf);
  $('board').addEventListener('change', whatIf);
  $('newpp').addEventListener('input', whatIf);
  whatIf();
}
