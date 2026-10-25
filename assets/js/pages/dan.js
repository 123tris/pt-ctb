import { html } from '../core/html.js';
import { dan, playerIndex } from '../core/data.js';
import { S, DAN_STAGES, DAN_ROLES, danRole } from '../core/model.js';
import { danName } from '../core/events.js';
import { DAN_ROLE_LORE } from '../core/lore.js';
import { setTitle, playerLink, mapLink, scoreStats, posBadge, empty, prefs } from '../core/ui.js';
import * as fmt from '../core/fmt.js';

function stageCard(stage, data, index, selected) {
  const passers = data.passers;
  return html`<button class="dan-stage ${stage.index > 10 ? 'hebrew' : ''} ${selected ? 'selected' : ''}" data-stage="${stage.index}" type="button">
    <span class="points">${stage.points} pts</span>
    <div class="dan-glyph">${stage.glyph}</div>
    <b>${danName(stage.index)}</b>
    <div class="small muted">${passers.length ? `${fmt.plural(passers.length, 'pass', 'passes')}` : 'No passes yet'}</div>
    ${passers.length ? html`<div class="avatars">
      ${passers.slice(0, 5).map(([uid]) => html`<img src="https://a.ppy.sh/${uid}" alt="${index.get(uid)?.name ?? ''}" title="${index.get(uid)?.name ?? ''}" loading="lazy">`)}
      ${passers.length > 5 ? html`<span class="more">+${passers.length - 5}</span>` : ''}
    </div>` : ''}
  </button>`;
}

function stageDetail(stage, data, index) {
  return html`<div class="card">
    <div class="detail-head">
      <h2>${danName(stage.index)}</h2>
      <span class="faint small">${stage.points} points · needs ${stage.passAcc}%</span>
    </div>
    <div style="margin-bottom:14px">${mapLink(data.map, data.meta)}</div>
    ${data.passers.length ? html`<div class="table-wrap"><table class="table-compact">
      <thead><tr><th>#</th><th>Player</th><th class="num">Score</th><th>Play</th><th class="num">Date</th></tr></thead>
      <tbody>${data.passers.map(([uid, ...s], i) => html`<tr>
        <td>${posBadge(i + 1)}</td><td>${playerLink(uid, index)}</td><td class="num">${fmt.num(s[S.SCORE])}</td>
        <td><span class="score-line">${scoreStats(s)}</span></td><td class="num faint">${fmt.date(s[S.TIME])}</td>
      </tr>`)}</tbody>
    </table></div>` : empty('Nobody has passed this stage yet. Glory awaits.')}
  </div>`;
}

export default async function danPage(root, { query, isCurrent }) {
  const [data, index] = await Promise.all([dan(), playerIndex()]);
  if (!isCurrent()) return;
  setTitle('Dan course');
  let selected = Number(query.stage ?? data.stages.findLastIndex(s => s.passers.length)) || 0;
  const me = prefs.get('me', null);

  root.innerHTML = String(html`
    <header class="page-head">
      <span class="eyebrow">Dan course</span>
      <h1>From Zeroth Dan to Shin</h1>
      <p>The Dan course is the community’s ladder of challenges: 19 maps, each harder than the last. Up to the 10th Dan you pass with 98% accuracy; from the Hebrew letters on (Aleph to Shin) you need 99%. Every stage gives points, and points give Discord roles. Use <span class="kbd">/updatedan</span> and <span class="kbd">/claimdanrole</span>.</p>
      <p class="small faint">The Dan has run on the server since June 2018. Alphonse sleeps; the site doesn’t.</p>
    </header>

    <div class="dan-ladder" id="ladder"></div>
    <section class="section" id="detail"></section>

    <section class="section grid grid-2">
      <div>
        <h2>Dan leaderboard</h2>
        ${data.ladder.length ? html`<div class="table-wrap"><table class="table-compact">
          <thead><tr><th>#</th><th>Player</th><th class="num">Points</th><th class="num">Stages</th><th>Highest</th></tr></thead>
          <tbody>${data.ladder.map(([uid, points, count, highest], i) => html`<tr class="${uid === me ? 'me' : ''}">
            <td class="rank">${i + 1}</td><td>${playerLink(uid, index, 'avatar-sm')}</td><td class="num">${fmt.num(points)}</td>
            <td class="num">${count}</td><td>${highest >= 0 ? danName(highest) : '—'}</td>
          </tr>`)}</tbody>
        </table></div>` : empty('Nobody has Dan points yet.')}
      </div>
      <div>
        <h2>Roles</h2>
        <div class="table-wrap"><table class="table-compact">
          <thead><tr><th>Role</th><th class="num">Points</th><th class="num">Players</th></tr></thead>
          <tbody>${[...DAN_ROLES].reverse().map(([min, name]) => {
            const holders = data.ladder.filter(([, points]) => danRole(points) === name).length;
            const lore = DAN_ROLE_LORE[name];
            const note = lore && (holders === 0 && lore.empty ? lore.empty : lore.text);
            return html`<tr>
              <td><span class="badge badge-gold">${name}</span>${note ? html`<div class="role-lore">${note}</div>` : ''}</td><td class="num">${fmt.num(min)}+</td>
              <td class="num">${holders}</td>
            </tr>`;
          })}</tbody>
        </table></div>
        <p class="small muted" style="margin-top:12px">Stages are worth from ${DAN_STAGES[0].points} (Zeroth Dan) to ${fmt.num(DAN_STAGES[18].points)} (Shin) points. Each stage only counts once; replaying it for a higher score only improves your place on this page.</p>
      </div>
    </section>
  `);

  const ladder = root.querySelector('#ladder');
  const detail = root.querySelector('#detail');
  const draw = () => {
    ladder.innerHTML = String(html`${DAN_STAGES.map(stage => stageCard(stage, data.stages[stage.index], index, stage.index === selected))}`);
    detail.innerHTML = String(stageDetail(DAN_STAGES[selected], data.stages[selected], index));
  };
  ladder.addEventListener('click', e => {
    const button = e.target.closest('[data-stage]');
    if (!button) return;
    selected = Number(button.dataset.stage);
    draw();
    history.replaceState(null, '', `#/dan?stage=${selected}`);
    detail.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  draw();
}
