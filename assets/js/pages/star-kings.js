import { html } from '../core/html.js';
import { playerLink, empty } from '../core/ui.js';
import * as fmt from '../core/fmt.js';

/** Two comparable boards; only the holders of each title appear, including joint kings. */
export function starKingsBoards(kings, index, me) {
  if (!kings) return empty('The star kings arrive with the next data update.');
  return html`
    <p class="muted kings-note">Ranges use nomod catch stars: 6★ means 6.00★ to below 7.00★; 10+★ includes everything from 10.00★ up. Ranked, loved and unranked maps count. Tied totals share the title.</p>
    <div class="grid grid-2 kings-boards">${[['catch', 'Catch maps'], ['converts', 'Converts']].map(([source, title]) => html`
      <section aria-labelledby="kings-${source}">
        <div class="section-head"><h2 id="kings-${source}">${title}</h2></div>
        ${kings[source].length ? html`<div class="table-wrap" data-label="${title}: kings by star rating"><table class="kings-table">
          <thead><tr><th scope="col">Title</th><th scope="col">Player</th><th scope="col" class="num">#1s in PT</th></tr></thead>
          <tbody>${kings[source].map(({ stars, count, players }) => html`<tr class="${players.includes(me) ? 'me' : ''}">
            <th scope="row"><span class="king-title">King of ${fmt.num(stars)}${stars === 10 ? '+' : ''}★</span>
              ${players.length > 1 ? html`<span class="king-tie">Shared title</span>` : ''}</th>
            <td><div class="king-players">${players.map(id => playerLink(id, index, 'avatar-sm'))}</div></td>
            <td class="num king-count">${fmt.num(count)}${players.length > 1 ? html`<span class="king-tie">each</span>` : ''}</td>
          </tr>`)}</tbody>
        </table></div>` : empty(`No ${source === 'catch' ? 'catch maps' : 'converts'} with a known catch star rating have a PT #1 yet.`)}
      </section>`)}</div>
  `;
}
