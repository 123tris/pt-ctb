import { html, raw } from '../core/html.js';
import { playerLink, empty, chipGroup, setPressed, writeQuery, announce, isInactive, statusTag, setTitle } from '../core/ui.js';
import { sharedRanks } from '../core/model.js';
import * as fmt from '../core/fmt.js';

const SOURCES = [['catch', 'Catch maps'], ['converts', 'Converts']];
const NAME = { catch: 'catch maps', converts: 'converts' };
const starLabel = stars => `${fmt.num(stars)}${stars === 10 ? '+' : ''}★`;
const rangeText = stars => (stars === 10 ? 'from 10.00★ up' : `from ${stars}.00★ to below ${stars + 1}.00★`);
/** A range's board link; catch is the default source, so it stays out of the URL (as writeQuery leaves it). */
const boardHref = (stars, source) => `#/rankings/kings?stars=${stars}${source === 'catch' ? '' : `&src=${source}`}`;

/** Two comparable boards; only the holders of each title appear, including joint kings. */
export function starKingsBoards(kings, index, me) {
  if (!kings) return empty('The star kings arrive with the next data update.');
  return html`
    <p class="muted kings-note">Ranges use nomod catch stars: 6★ means 6.00★ to below 7.00★; 10+★ includes everything from 10.00★ up. Ranked, loved and unranked maps count. Tied totals share the title.</p>
    <div class="grid grid-2 kings-boards">${SOURCES.map(([source, title]) => html`
      <section aria-labelledby="kings-${source}">
        <div class="section-head"><h2 id="kings-${source}">${title}</h2></div>
        ${kings[source].length ? html`<div class="table-wrap" data-label="${title}: kings by star rating"><table class="kings-table">
          <thead><tr><th scope="col">Title</th><th scope="col">Player</th><th scope="col" class="num">#1s in PT</th></tr></thead>
          <tbody>${kings[source].map(({ stars, count, players, board }) => html`<tr class="${players.includes(me) ? 'me' : ''}">
            <th scope="row"><span class="king-title">King of ${starLabel(stars)}</span>
              ${players.length > 1 ? html`<span class="king-tie">Shared title</span>` : ''}
              ${board ? html`<a class="king-link" href="${boardHref(stars, source)}">Full board<span class="sr-only"> of ${starLabel(stars)} ${NAME[source]}</span></a>` : ''}</th>
            <td><div class="king-players">${players.map(id => playerLink(id, index, 'avatar-sm'))}</div></td>
            <td class="num king-count">${fmt.num(count)}${players.length > 1 ? html`<span class="king-tie">each</span>` : ''}</td>
          </tr>`)}</tbody>
        </table></div>` : empty(`No ${NAME[source]} with a known catch star rating have a PT #1 yet.`)}
      </section>`)}</div>
  `;
}

/** One range's full board: everyone with a #1 there, most first, with tied counts sharing a rank. */
function boardTable(board, stars, source, index, me) {
  if (!board?.length) return empty(`Nobody in PT holds a #1 on ${NAME[source]} ${rangeText(stars)} yet.`);
  const ranks = sharedRanks(board.map(([, n]) => n));
  return html`<div class="table-wrap" data-label="${starLabel(stars)} ${NAME[source]}: #1s in PT"><table>
    <thead><tr><th>#</th><th>Player</th><th class="num">#1s in PT</th></tr></thead>
    <tbody>${board.map(([id, n], i) => {
      const p = index.get(id);
      const tag = p ? statusTag(p) : '';
      return html`<tr class="${id === me ? 'me' : ''} ${p && isInactive(p) ? 'inactive' : ''}">
        <td class="rank ${ranks[i] === 1 ? 'king-rank' : ''}">${ranks[i]}</td>
        <td class="cell-player">${playerLink(id, index)}${tag ? html` ${tag}` : ''}</td>
        <td class="num king-count">${fmt.num(n)}</td>
      </tr>`;
    })}</tbody>
  </table></div>`;
}

/** What a kings view shows, kept on its root element so the next render can tell an in-page move from a new visit. */
const viewKey = (stars, source) => (stars === null ? 'all' : `${stars}:${source}`);
const viewQuery = key => {
  if (!key || key === 'all') return {};
  const [stars, source] = key.split(':');
  return source === 'catch' ? { stars } : { stars, src: source };
};

/**
 * The Star kings tab: every range's king (no `stars` in the query), or one range's full board (?stars=6&src=converts).
 * Data from before the boards (no `board` on the rows) keeps the kings-only view. `head` is the page head and tabs.
 */
export function kingsPage(root, { kings, index, me, query, head, intro }) {
  const hasBoards = Boolean(kings && Object.values(kings).some(rows => rows.some(r => r.board)));
  const asked = /^(?:[0-9]|10)$/.test(query.stars ?? '') ? Number(query.stars) : null;
  let stars = hasBoards ? asked : null;
  let source = SOURCES.some(([k]) => k === query.src) ? query.src : 'catch';
  const before = root.querySelector('[data-kings]')?.dataset.kings;

  if (stars === null) {
    root.innerHTML = String(html`${head}
      <p class="muted">${intro}</p>
      ${asked !== null ? html`<p class="muted small">The full board for each star range arrives with the next data update.</p>` : ''}
      <div data-kings="all">${starKingsBoards(kings, index, me)}</div>`);
    const titles = kings ? Object.values(kings).reduce((n, rows) => n + rows.length, 0) : 0;
    announce(`${fmt.plural(titles, 'star title')} across catch maps and converts.`);
    // Back from a board: return to its link instead of wherever the shorter board left the scroll.
    const from = before && before !== 'all' ? root.querySelector(`a[href="${boardHref(...before.split(':'))}"]`) : null;
    if (from) {
      from.focus({ preventScroll: true });
      from.scrollIntoView({ block: 'center', behavior: 'instant' });
      window.dispatchEvent(new CustomEvent('ptctb:query', { detail: { before: viewQuery(before), after: {} } }));
    }
    return;
  }

  // The ranges with a board in either source (and the one asked for), so switching source keeps the range.
  const ranges = [...new Set([...Object.values(kings).flatMap(rows => rows.map(r => r.stars)), stars])].sort((a, b) => a - b);
  const boardOf = () => kings[source].find(r => r.stars === stars)?.board ?? [];
  root.innerHTML = String(html`${head}
    <p class="muted">Everyone holding a #1 in PT in one star range, most first. Ties share a rank.</p>
    <div class="toolbar kings-toolbar" data-kings="">
      <select class="select" id="kings-stars" aria-label="Star range">${ranges.map(s => html`<option value="${s}" ${s === stars ? raw('selected') : ''}>${starLabel(s)}</option>`)}</select>
      ${chipGroup('Maps', 'src', SOURCES, source)}
    </div>
    <p class="result-count" id="kings-count"></p>
    <div id="kings-board"></div>
    <p class="mt-3 small"><a href="#/rankings/kings">All star kings</a></p>`);

  const view = root.querySelector('[data-kings]');
  const boardEl = root.querySelector('#kings-board');
  const count = root.querySelector('#kings-count');
  const draw = ({ speak = false } = {}) => {
    const board = boardOf();
    view.dataset.kings = viewKey(stars, source);
    setPressed(root, 'src', source);
    setTitle(`${starLabel(stars)} ${NAME[source]} · Star kings`);
    boardEl.innerHTML = String(boardTable(board, stars, source, index, me));
    count.textContent = board.length ? `${fmt.plural(board.length, 'player')} with a #1 on ${NAME[source]} ${rangeText(stars)}` : '';
    writeQuery({ stars, src: source }, { src: 'catch' });
    if (speak) announce(count.textContent || `No #1s on ${NAME[source]} ${rangeText(stars)} yet.`);
  };
  draw({ speak: true });
  root.querySelector('#kings-stars').addEventListener('change', e => { stars = Number(e.target.value); draw({ speak: true }); });
  view.addEventListener('click', e => {
    const b = e.target.closest('[data-src]');
    if (b && b.dataset.src !== source) { source = b.dataset.src; draw({ speak: true }); }
  });

  // Opened from the kings (same page, so the router neither scrolls, moves focus nor counts it): do all three here.
  if (before === 'all') {
    window.scrollTo({ top: 0, behavior: 'instant' });
    const h1 = root.querySelector('h1');
    if (h1) { h1.tabIndex = -1; h1.focus({ preventScroll: true }); }
    window.dispatchEvent(new CustomEvent('ptctb:query', { detail: { before: {}, after: viewQuery(view.dataset.kings) } }));
  }
}
