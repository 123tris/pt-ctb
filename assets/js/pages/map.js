import { html } from '../core/html.js';
import { mapEntry, mapSet, playerIndex, challenges, dan } from '../core/data.js';
import { S, M, CAT, STATUS, DAN_MAPS } from '../core/model.js';
import { danName } from '../core/events.js';
import { mapTags } from '../core/badges.js';
import { mapLore } from '../core/lore.js';
import {
  setTitle, playerLink, scoreStats, ppText, posBadge, bannerArt, starsBadge, starColor, mapText, osuMap, osuGame, prefs, catChip, scoreWhen,
  funChips, setPressed,
} from '../core/ui.js';
import * as fmt from '../core/fmt.js';

const STATUS_LABEL = {
  [STATUS.GRAVEYARD]: 'Graveyard', [STATUS.WIP]: 'WIP', [STATUS.PENDING]: 'Pending', [STATUS.RANKED]: 'Ranked',
  [STATUS.APPROVED]: 'Approved', [STATUS.QUALIFIED]: 'Qualified', [STATUS.LOVED]: 'Loved',
};

// The date next to the status: when a ranked, approved, qualified or loved map got that status ("Ranked 14 Mar 2021"),
// or when a graveyard, pending or WIP map was last updated ("Last updated 2 Jun 2023"). Both are unix seconds at the
// end of the beatmap tuple and are often missing (older data has neither), so a null shows nothing.
const DATED = new Set([STATUS.RANKED, STATUS.APPROVED, STATUS.QUALIFIED, STATUS.LOVED]);

/** [label, unix seconds] for the date to show after the status, or null. */
function statusDate(meta) {
  if (DATED.has(meta[M.STATUS])) {
    const at = meta[M.RANKED_AT] ?? null;
    return at ? [STATUS_LABEL[meta[M.STATUS]], at] : null;
  }
  const at = meta[M.UPDATED_AT] ?? null;
  return at ? ['Last updated', at] : null;
}

/** The set's difficulties as links, easiest first, this one marked. */
function diffSwitcher(id, diffs) {
  return html`<nav class="diffs" aria-label="Difficulties">${diffs.map(([mapId, version, stars, players]) => {
    const label = `${version}, ${fmt.num(stars, 2)} stars, ${players ? fmt.plural(players, 'Portuguese player') : 'no Portuguese scores yet'}`;
    return html`<a class="diff ${players ? '' : 'diff-new'}" href="#/map/${mapId}" style="--s:${starColor(stars)}" title="${label}"
      aria-label="${label}" aria-current="${mapId === id ? 'page' : 'false'}"><span>${version}</span><small>${fmt.num(stars, 2)}</small></a>`;
  })}</nav>`;
}

/**
 * Leaderboard rows. `pre`: plays from before the map was ranked, which count toward nothing, so a plain position and a
 * dash for pp (a "0pp" would read as a play worth nothing rather than one that isn't counted).
 */
function boardRows(entries, me, index, pre = false) {
  return entries.map(([uid, ...s], i) => html`<tr class="${uid === me ? 'me' : ''}">
    <td class="rank">${pre ? i + 1 : posBadge(i + 1)}</td>
    <td class="cell-player">${playerLink(uid, index)}<span class="cell-sub"><span class="score-line">${scoreStats(s)}</span> ${fmt.num(s[S.SCORE])} · <time datetime="${new Date(s[S.TIME] * 1000).toISOString()}">${fmt.date(s[S.TIME])}</time></span></td>
    <td class="num col-opt">${fmt.num(s[S.SCORE])}</td>
    <td class="col-opt"><span class="score-line">${scoreStats(s)}</span></td>
    <td class="num">${pre ? html`<span class="faint" title="Set before the map was ranked: counts toward nothing">—</span>` : ppText(s[S.PP])}</td>
    <td class="num faint col-opt" title="${fmt.dateTime(s[S.TIME])}">${scoreWhen(s, fmt.date(s[S.TIME]))}</td>
  </tr>`);
}

const boardTable = rows => html`<div class="table-wrap"><table>
  <thead><tr><th>#</th><th>Player</th><th class="num col-opt">Score</th><th class="col-opt">Play</th><th class="num">pp</th><th class="num col-opt">Date</th></tr></thead>
  <tbody>${rows}</tbody>
</table></div>`;

async function otherMeta(id) {
  const [ch, d] = await Promise.all([challenges(), dan()]);
  return ch.maps[id] ?? d.stages.find(stage => stage.map === id)?.meta ?? null;
}

export default async function mapPage(root, { params, isCurrent }) {
  const id = Number(params.id);
  const [entry, index] = await Promise.all([mapEntry(id), playerIndex()]);
  // Maps nobody here has played (challenge suggestions, unplayed Dan stages) still have details elsewhere.
  const meta = entry?.m ?? await otherMeta(id);
  // The set's difficulties, when the data has them (sets/ came after the map files) and they include this one.
  const set = meta?.[M.SET] ? await mapSet(meta[M.SET]).catch(() => null) : null;
  const diffs = set?.some(d => d[0] === id) ? set : null;
  if (!isCurrent()) return;
  const { title, sub } = mapText(id, meta);
  setTitle(title);
  const me = prefs.get('me', null);
  const danStage = DAN_MAPS.indexOf(id);
  const board = entry?.s ?? [];
  // Plays from before the map was ranked: a second view of the leaderboard, offered only when there are any.
  const pre = entry?.pre ?? [];
  const lore = mapLore(meta);
  const tags = [
    ...(lore?.tuga ? [{ name: 'tuga certified 🇵🇹', tip: 'A Portuguese song or meme map.' }] : []), // PT text (intentional): "tuga"
    ...mapTags(meta, board, entry?.c),
  ];
  const fcs = board.filter(e => e[S.MISS + 1] === 0).length;
  const unrankedForever = meta && [STATUS.GRAVEYARD, STATUS.WIP, STATUS.PENDING].includes(meta[M.STATUS]) && board.length >= 3;
  const dated = meta ? statusDate(meta) : null;

  root.innerHTML = String(html`
    <section class="banner">
      ${bannerArt(meta?.[M.SET])}
      <div class="banner-body">
        <div class="links">
          ${entry ? catChip(entry.c) : ''}
          ${meta ? starsBadge(meta[M.STARS]) : ''}
          ${danStage >= 0 ? html`<span class="badge badge-gold">Dan course: ${danName(danStage)}</span>` : ''}
          ${entry?.banned ? html`<span class="badge badge-red" title="Scores on this map are kept but give no pp">Banned — no pp</span>` : ''}
        </div>
        <h1><a class="title-link" href="${osuMap(id)}" target="_blank" rel="noopener" title="${title} on osu!">${title}</a></h1>
        <div class="sub">${sub}</div>
        ${diffs ? diffSwitcher(id, diffs) : ''}
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
      <div><dt>Status</dt><dd>${STATUS_LABEL[meta[M.STATUS]] ?? '—'}${dated ? html`<span class="status-date">${dated[0] === STATUS_LABEL[meta[M.STATUS]] ? ' ' : html`<span class="sep-dot"> · </span>${dated[0]} `}<time datetime="${new Date(dated[1] * 1000).toISOString()}">${fmt.date(dated[1])}</time></span>` : ''}</dd></div>
      <div><dt>Length</dt><dd>${fmt.duration(meta[M.LENGTH])}</dd></div>
      <div><dt>BPM</dt><dd>${fmt.num(meta[M.BPM])}</dd></div>
      <div><dt>Max combo</dt><dd>${meta[M.MAX_COMBO] ? `${fmt.num(meta[M.MAX_COMBO])}x` : '—'}</dd></div>
      <div><dt>CS</dt><dd>${fmt.num(meta[M.CS], 1)}</dd></div>
      <div><dt>AR</dt><dd>${fmt.num(meta[M.AR], 1)}</dd></div>
      <div><dt>HP</dt><dd>${fmt.num(meta[M.HP], 1)}</dd></div>
    </dl>` : ''}

    <div class="btn-row" style="margin-top:16px">
      <a class="btn btn-small" href="${osuGame(id)}" title="Opens this difficulty in the osu! game (on stable, downloading it through osu!direct needs supporter)">Open in osu!</a>
      ${meta?.[M.MAX_COMBO] ? html`<a class="btn btn-small" href="#/calculator?map=${id}">Calculate pp</a>` : ''}
    </div>

    <section class="section map-board">
      <div class="section-head">
        <h2>Portuguese leaderboard</h2>
        <span class="muted small" data-view="now">${entry?.c === CAT.LOVED && !entry.banned ? 'Sorted by pp, as in the bot.' : 'Sorted by classic score, as on osu!.'}</span>
        ${pre.length ? html`<span class="muted small" data-view="pre" hidden>Set before the map was ranked. Kept for the record; they count toward nothing.</span>` : ''}
      </div>
      ${pre.length ? html`<div class="chips board-views" role="group" aria-label="Plays shown">
        <button class="chip active" type="button" data-board="now" aria-pressed="true">${STATUS_LABEL[meta?.[M.STATUS]] ?? 'Ranked'} <span class="faint">${fmt.num(board.length)}</span></button>
        <button class="chip" type="button" data-board="pre" aria-pressed="false">Before ranking <span class="faint">${fmt.num(pre.length)}</span></button>
      </div>` : ''}
      <div data-view="now">
        ${board.length ? boardTable(boardRows(board, me, index))
          : html`<div class="empty">No Portuguese player has a score on ${pre.length ? 'the ranked version of this map' : 'this map'} yet. Why not be the first?</div>`}
      </div>
      ${pre.length ? html`<div data-view="pre" hidden>${boardTable(boardRows(pre, me, index, true))}</div>` : ''}
    </section>
  `);

  // The two views of the leaderboard: the plays that count, and those from before the map was ranked.
  const boardSection = root.querySelector('.map-board');
  boardSection.addEventListener('click', e => {
    const view = e.target.closest('[data-board]')?.dataset.board;
    if (!view) return;
    setPressed(boardSection, 'board', view);
    boardSection.querySelectorAll('[data-view]').forEach(el => { el.hidden = el.dataset.view !== view; });
  });

  // A long list scrolls (sideways on a phone): start it with this difficulty in view.
  const nav = root.querySelector('.diffs'), current = nav?.querySelector('[aria-current="page"]');
  if (current) {
    nav.scrollLeft = current.offsetLeft - nav.offsetLeft - (nav.clientWidth - current.offsetWidth) / 2;
    nav.scrollTop = current.offsetTop - nav.offsetTop - (nav.clientHeight - current.offsetHeight) / 2;
  }
}
