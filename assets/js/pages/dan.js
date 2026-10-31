import { html } from '../core/html.js';
import { S, DAN_STAGES, DAN_ROLES, danRole } from '../core/model.js';
import { danName } from '../core/events.js';
import { DAN_ROLE_LORE } from '../core/lore.js';
import { playerLink, mapLink, scoreStats, posBadge, empty, prefs, scrollBehavior, avatarSrc } from '../core/ui.js';
import * as fmt from '../core/fmt.js';
import { t, th } from '../core/i18n.js';

// The Dan course is the "Dan course" tab of Challenges (pages/challenges.js); #/dan still redirects there.
export const DAN_INTRO = th('The Dan course is the community’s ladder of challenges: 19 maps, each harder than the last. Up to the 10th Dan you pass with 98% accuracy; from the Hebrew letters on (Aleph to Shin) you need 99%. Every stage gives points, and points give Discord roles. Use {updatedan} and {claimdanrole}.', {
  updatedan: html`<span class="kbd">/updatedan</span>`, claimdanrole: html`<span class="kbd">/claimdanrole</span>`,
});

function stageCard(stage, data, index, selected) {
  const passers = data.passers;
  return html`<button class="dan-stage ${stage.index > 10 ? 'hebrew' : ''} ${passers.length ? '' : 'unpassed'} ${selected ? 'selected' : ''}" data-stage="${stage.index}" type="button" aria-pressed="${selected}">
    <span class="points">${t('{n} pts', { n: fmt.num(stage.points) })}</span>
    <div class="dan-glyph">${stage.glyph}</div>
    <b>${danName(stage.index)}</b>
    <div class="small muted">${passers.length ? `${fmt.plural(passers.length, 'pass', 'passes')}` : t('No passes yet')}</div>
    ${passers.length ? html`<div class="avatars">
      ${passers.slice(0, 5).map(([uid]) => html`<img ${avatarSrc(uid, 22)} alt="${index.get(uid)?.name ?? ''}" title="${index.get(uid)?.name ?? ''}" width="22" height="22" loading="lazy" decoding="async">`)}
      ${passers.length > 5 ? html`<span class="more">+${passers.length - 5}</span>` : ''}
    </div>` : ''}
  </button>`;
}

function stageDetail(stage, data, index) {
  return html`<div class="card">
    <div class="detail-head">
      <h2>${danName(stage.index)}</h2>
      <span class="faint small">${t('{points} points · needs {acc}%', { points: fmt.num(stage.points), acc: fmt.num(stage.passAcc) })}</span>
    </div>
    <div class="mb-3">${mapLink(data.map, data.meta)}</div>
    ${data.passers.length ? html`<div class="table-wrap" data-label="${t('Players who passed the {dan}', { dan: danName(stage.index) })}"><table class="table-compact">
      <thead><tr><th>#</th><th>${t('Player')}</th><th class="num col-opt">${t('Score')}</th><th class="col-opt">${t('Play')}</th><th class="num">${t('Date')}</th></tr></thead>
      <tbody>${data.passers.map(([uid, ...s], i) => html`<tr>
        <td>${posBadge(i + 1)}</td>
        <td class="cell-player">${playerLink(uid, index)}<span class="cell-sub"><span class="score-line">${scoreStats(s)}</span></span></td>
        <td class="num col-opt">${fmt.num(s[S.SCORE])}</td>
        <td class="col-opt"><span class="score-line">${scoreStats(s)}</span></td><td class="num faint">${fmt.date(s[S.TIME])}</td>
      </tr>`)}</tbody>
    </table></div>` : empty(t('Nobody has passed this stage yet. Glory awaits.'))}
  </div>`;
}

/** Renders the Dan course (ladder, chosen stage, leaderboard, roles) into `root`: the Challenges page's Dan tab. */
export function renderDan(root, data, index, query) {
  let selected = Number(query.stage ?? data.stages.findLastIndex(s => s.passers.length)) || 0;
  const me = prefs.get('me', null);

  root.innerHTML = String(html`
    <div class="section-head"><h2>${t('From Zeroth Dan to Shin')}</h2><span class="muted small">${t('The Dan has run on the server since June 2018. Alphonse sleeps; the site doesn’t.')}</span></div>
    <div class="dan-ladder" id="ladder" role="group" aria-label="${t('Dan stages')}"></div>
    <section class="section" id="detail"></section>

    <section class="section grid grid-2">
      <div>
        <h2>${t('Dan leaderboard')}</h2>
        ${data.ladder.length ? html`<div class="table-wrap"><table class="table-compact">
          <thead><tr><th>#</th><th>${t('Player')}</th><th class="num">${t('Points')}</th><th class="num col-opt">${t('Stages')}</th><th class="col-opt">${t('Highest')}</th></tr></thead>
          <tbody>${data.ladder.map(([uid, points, count, highest], i) => html`<tr class="${uid === me ? 'me' : ''}">
            <td class="rank">${i + 1}</td>
            <td class="cell-player">${playerLink(uid, index, 'avatar-sm')}<span class="cell-sub">${fmt.plural(count, 'stage')}${highest >= 0 ? ` · ${t('highest {dan}', { dan: danName(highest) })}` : ''}</span></td>
            <td class="num">${fmt.num(points)}</td>
            <td class="num col-opt">${count}</td><td class="col-opt">${highest >= 0 ? danName(highest) : '—'}</td>
          </tr>`)}</tbody>
        </table></div>` : empty(t('Nobody has Dan points yet.'))}
      </div>
      <div>
        <h2>${t('Roles')}</h2>
        <div class="table-wrap"><table class="table-compact">
          <thead><tr><th>${t('Role')}</th><th class="num">${t('Points')}</th><th class="num">${t('Players')}</th></tr></thead>
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
        <p class="mt-3 small muted">${t('Stages are worth from {min} (Zeroth Dan) to {max} (Shin) points. Each stage only counts once; replaying it for a higher score only improves your place on this page.', { min: fmt.num(DAN_STAGES[0].points), max: fmt.num(DAN_STAGES[18].points) })}</p>
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
    // The ladder was rebuilt, so put focus back on the stage that was just chosen rather than losing it.
    ladder.querySelector(`[data-stage="${selected}"]`)?.focus({ preventScroll: true });
    history.replaceState(null, '', `#/challenges/dan?stage=${selected}`);
    detail.scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
  });
  draw();
}
