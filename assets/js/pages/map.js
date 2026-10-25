import { html } from '../core/html.js';
import { mapEntry, playerIndex, challenges, dan } from '../core/data.js';
import { S, M, CAT, STATUS, MODE, DAN_MAPS } from '../core/model.js';
import { danName } from '../core/events.js';
import { mapTags } from '../core/badges.js';
import { mapLore } from '../core/lore.js';
import {
  setTitle, playerLink, scoreStats, ppText, posBadge, coverUrl, starsBadge, mapText, osuMap, prefs, catChip, funChips,
} from '../core/ui.js';
import * as fmt from '../core/fmt.js';

const STATUS_LABEL = {
  [STATUS.GRAVEYARD]: 'Graveyard', [STATUS.WIP]: 'WIP', [STATUS.PENDING]: 'Pending', [STATUS.RANKED]: 'Ranked',
  [STATUS.APPROVED]: 'Approved', [STATUS.QUALIFIED]: 'Qualified', [STATUS.LOVED]: 'Loved',
};
const MODE_LABEL = { [MODE.OSU]: 'osu!standard (convert)', [MODE.TAIKO]: 'taiko', [MODE.CATCH]: 'osu!catch', [MODE.MANIA]: 'mania' };

async function otherMeta(id) {
  const [ch, d] = await Promise.all([challenges(), dan()]);
  return ch.maps[id] ?? d.stages.find(stage => stage.map === id)?.meta ?? null;
}

export default async function mapPage(root, { params, isCurrent }) {
  const id = Number(params.id);
  const [entry, index] = await Promise.all([mapEntry(id), playerIndex()]);
  // Maps nobody here has played (challenge suggestions, unplayed Dan stages) still have details elsewhere.
  const meta = entry?.m ?? await otherMeta(id);
  if (!isCurrent()) return;
  const { title, sub } = mapText(id, meta);
  setTitle(title);
  const me = prefs.get('me', null);
  const danStage = DAN_MAPS.indexOf(id);
  const board = entry?.s ?? [];
  const lore = mapLore(meta);
  const tags = [
    ...(lore?.tuga ? [{ name: 'tuga certified 🇵🇹', tip: 'A Portuguese song or meme map.' }] : []), // PT text (intentional): "tuga"
    ...mapTags(meta, board, entry?.c),
  ];
  const fcs = board.filter(e => e[S.MISS + 1] === 0).length;
  const unrankedForever = meta && [STATUS.GRAVEYARD, STATUS.WIP, STATUS.PENDING].includes(meta[M.STATUS]) && board.length >= 3;

  root.innerHTML = String(html`
    <section class="banner">
      <div class="banner-art" style="${meta?.[M.SET] ? `background-image:url('${coverUrl(meta[M.SET], 'cover@2x')}')` : ''}"></div>
      <div class="banner-body">
        <div class="links">
          ${entry ? catChip(entry.c) : ''}
          ${meta ? starsBadge(meta[M.STARS]) : ''}
          ${danStage >= 0 ? html`<span class="badge badge-gold">Dan course: ${danName(danStage)}</span>` : ''}
          ${entry?.banned ? html`<span class="badge badge-red" title="Scores on this map are kept but give no pp">Banned — no pp</span>` : ''}
        </div>
        <h1>${title}</h1>
        <div class="sub">${sub}</div>
        ${funChips(tags, 'map-tags')}
        ${unrankedForever ? html`<p class="small faint" style="margin:10px 0 0">Still waiting to be ranked. Since 2018, probably.</p>` : ''}
      </div>
    </section>

    ${lore ? html`<div class="lore-card">
      <span class="eyebrow">${lore.title}</span>
      <p>${lore.text(board.length, board.reduce((max, e) => Math.max(max, e[S.PP + 1]), 0))}</p>
      ${board.length ? html`<p class="small muted" style="margin:0">FC watch: ${fmt.num(fcs)} of ${fmt.plural(board.length, 'Portuguese player')} ${fcs === 1 ? 'has' : 'have'} a full combo on this diff.</p>` : ''}
    </div>` : ''}

    ${meta ? html`<dl class="kv kv-strip">
      <div><dt>Status</dt><dd>${STATUS_LABEL[meta[M.STATUS]] ?? '—'}</dd></div>
      <div><dt>Mode</dt><dd>${MODE_LABEL[meta[M.MODE]] ?? '—'}</dd></div>
      <div><dt>Length</dt><dd>${fmt.duration(meta[M.LENGTH])}</dd></div>
      <div><dt>BPM</dt><dd>${fmt.num(meta[M.BPM])}</dd></div>
      <div><dt>Max combo</dt><dd>${meta[M.MAX_COMBO] ? `${fmt.num(meta[M.MAX_COMBO])}x` : '—'}</dd></div>
      <div><dt>CS</dt><dd>${fmt.num(meta[M.CS], 1)}</dd></div>
      <div><dt>AR</dt><dd>${fmt.num(meta[M.AR], 1)}</dd></div>
      <div><dt>OD</dt><dd>${fmt.num(meta[M.OD], 1)}</dd></div>
      <div><dt>HP</dt><dd>${fmt.num(meta[M.HP], 1)}</dd></div>
    </dl>` : ''}

    <div class="btn-row" style="margin-top:16px">
      <a class="btn btn-small" href="${osuMap(id)}" target="_blank" rel="noopener">Open on osu! ↗</a>
      ${meta?.[M.MAX_COMBO] ? html`<a class="btn btn-small" href="#/calculator?map=${id}">Calculate pp</a>` : ''}
    </div>

    <section class="section">
      <div class="section-head">
        <h2>Portuguese leaderboard</h2>
        <span class="muted small">${entry?.c === CAT.LOVED && !entry.banned ? 'Sorted by pp, as in the bot.' : 'Sorted by classic score, as on osu!.'}</span>
      </div>
      ${board.length ? html`<div class="table-wrap"><table>
        <thead><tr><th>#</th><th>Player</th><th class="num">Score</th><th>Play</th><th class="num">pp</th><th class="num">Date</th></tr></thead>
        <tbody>${board.map(([uid, ...s], i) => html`<tr class="${uid === me ? 'me' : ''}">
          <td class="rank">${posBadge(i + 1)}</td>
          <td>${playerLink(uid, index)}</td>
          <td class="num">${fmt.num(s[S.SCORE])}</td>
          <td><span class="score-line">${scoreStats(s)}</span></td>
          <td class="num">${ppText(s[S.PP])}</td>
          <td class="num faint" title="${fmt.dateTime(s[S.TIME])}">${fmt.date(s[S.TIME])}</td>
        </tr>`)}</tbody>
      </table></div>` : html`<div class="empty">No Portuguese player has a score on this map yet. Why not be the first?</div>`}
    </section>

    ${entry?.pre?.length ? html`<section class="section">
      <div class="section-head">
        <h2>Played before ranked</h2>
        <span class="muted small">Set on an earlier version of the map, before it was ranked. Kept for the record; they count toward nothing.</span>
      </div>
      <div class="table-wrap"><table>
        <thead><tr><th>Player</th><th class="num">Score</th><th>Play</th><th class="num">Date</th></tr></thead>
        <tbody>${entry.pre.map(([uid, ...s]) => html`<tr class="${uid === me ? 'me' : ''}">
          <td>${playerLink(uid, index)}</td>
          <td class="num">${fmt.num(s[S.SCORE])}</td>
          <td><span class="score-line">${scoreStats(s)}</span></td>
          <td class="num faint" title="${fmt.dateTime(s[S.TIME])}">${fmt.date(s[S.TIME])}</td>
        </tr>`)}</tbody>
      </table></div>
    </section>` : ''}
  `);
}
