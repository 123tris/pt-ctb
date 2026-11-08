// /top10/plays in the browser: the add form (a player's plays of the year from their pack, a pasted score link, or a
// clip), 🔥 endorse, removing your own entry, and the player filter, which keeps itself in the address. "Your best
// scores" follows what you add and remove.

import type { Ctx } from '../kernel/ctx.ts';
import { html, raw } from '../kernel/html.ts';
import { store } from '../client/boot.ts';
import { go, writeQuery } from '../client/ui.ts';
import { toast } from '../client/fun.ts';
import { setPressed } from '../client/dom.ts';
import { top10Api, problemText, showcaseBody } from '../client/top10.ts';
import { readPlayer } from '../gen/packs.ts';
import { playerPack } from '../routes.ts';
import { MAX_REPLAY_BYTES, clipOk, scoreCard, type ShowPlay } from '../ui/top10.ts';
import { editForm, mineBox, playItem, usedLine, type Data } from './top10-plays.ts';
import { careerChoices, yearChoices } from './top10-dossier.ts';
import type { CiteChoice } from './top10-ballot.ts';

export function mount(root: HTMLElement, ctx: Ctx, d: Data): void {
  const { t } = ctx;
  const form = root.querySelector<HTMLFormElement>('[data-form]');
  let kind = 'pick';

  const drawList = () => {
    const list = d.player === null ? d.plays : d.plays.filter(p => p.player === d.player);
    const el = root.querySelector('[data-plays]');
    if (el) el.outerHTML = String(list.length ? html`<ul class="t10-show-grid" data-plays>${list.map(p => playItem(ctx, d, p))}</ul>` : html`<p class="empty" data-plays>${t('Nothing showcased yet.')}</p>`);
    const mine = root.querySelector('[data-mine]');
    if (mine) mine.outerHTML = String(mineBox(ctx, d));
    const used = root.querySelector('[data-used]');
    if (used) used.textContent = usedLine(ctx, d);
  };

  // A player's plays to pick one from, searchable: every play of the season's year (Legendary plays: of their whole
  // career, §13.11) in their pack, the most pp first. PAGE at a time, "Show more" for the next.
  const PAGE = 50;
  let choices: CiteChoice[] = [];
  let chosen = '';
  let shown = PAGE;
  const taken = () => new Set(d.plays.map(p => p.score_ref).filter(Boolean));
  const textOf = (c: CiteChoice) => [c.card?.title, c.card?.artist, c.card?.version, c.card?.mods, c.pre ? t('pre-rank') : ''].filter(Boolean).join(' ').toLocaleLowerCase();

  function drawChoices(): void {
    const list = root.querySelector<HTMLElement>('[data-pick-list]');
    if (!list) return;
    const q = (root.querySelector<HTMLInputElement>('[data-pick-q]')?.value ?? '').trim();
    const words = q.toLocaleLowerCase().split(/\s+/).filter(Boolean);
    const hits = words.length ? choices.filter(c => { const s = textOf(c); return words.every(w => s.includes(w)); }) : choices;
    const inAlready = taken();
    const more = hits.length - shown;
    list.innerHTML = String(hits.length ? html`<ul class="t10-cite-list">${hits.slice(0, shown).map(c => html`<li><label><input type="radio" name="pick" value="${c.ref}" ${inAlready.has(c.ref) ? raw('disabled') : c.ref === chosen ? raw('checked') : ''}>
        ${scoreCard(ctx, c.card, c.ref, inAlready.has(c.ref) ? html`<span class="t10-pill">${t('already in')}</span>` : c.pre ? html`<span class="t10-pill" title="${t('Set before the map was ranked')}">${t('pre-rank')}</span>` : '')}</label></li>`)}</ul>
      ${more > 0 ? html`<button class="btn btn-small" type="button" data-pick-more>${t('Show {n} more', { n: ctx.fmt.num(Math.min(PAGE, more)) })}</button>` : ''}`
      : html`<p class="small muted">${t('No plays match “{q}”.', { q })}</p>`);
  }

  async function yearPlays(id: number): Promise<void> {
    const box = root.querySelector<HTMLElement>('[data-year-plays]');
    if (!box) return;
    choices = []; chosen = ''; shown = PAGE;
    if (!id) { box.innerHTML = ''; return; }
    box.innerHTML = String(html`<p class="small muted">${t('Loading…')}</p>`);
    const pack = await store.pack(playerPack(id), readPlayer).catch(() => null);
    // Legendary plays: any year (§13.11), the whole career; else the season's. All of them.
    choices = d.scope === 'alltime' ? careerChoices(pack, id, Infinity) : yearChoices(pack, d.season.year, id, Infinity);
    // The best one not in yet starts picked.
    const inAlready = taken();
    chosen = choices.find(c => !inAlready.has(c.ref))?.ref ?? '';
    const mine = id === ctx.me;
    const legend = d.scope === 'alltime' ? (mine ? t('Your career best plays, the most pp first') : t('Their career best plays, the most pp first'))
      : mine ? t('Your plays of {year}, the most pp first', { year: d.season.year }) : t('Their plays of {year}, the most pp first', { year: d.season.year });
    box.innerHTML = String(choices.length ? html`<fieldset class="t10-pick-plays"><legend class="small muted">${legend} · ${t('{n} plays', { n: ctx.fmt.num(choices.length) })}</legend>
      <input class="input" type="search" data-pick-q placeholder="${t('Search by map, artist, difficulty or mods')}" aria-label="${t('Search their plays')}" autocomplete="off">
      <div data-pick-list></div></fieldset>`
      : html`<p class="small muted">${d.scope === 'alltime' ? t('No plays of theirs stored. Paste a score link or add a clip instead.')
        : t('No plays of theirs stored in {year}. Paste a score link or add a clip instead.', { year: d.season.year })}</p>`);
    drawChoices();
  }

  root.addEventListener('input', ev => {
    if ((ev.target as Element).matches?.('[data-pick-q]')) { shown = PAGE; drawChoices(); }
  });
  root.addEventListener('change', ev => {
    const el = ev.target as HTMLInputElement;
    if (el.name === 'pick' && el.type === 'radio') chosen = el.value;
  });

  const select = root.querySelector<HTMLSelectElement>('[data-player-select]');

  root.addEventListener('click', async ev => {
    const el = (ev.target as Element).closest<HTMLButtonElement>('button');
    if (!el) return;
    if (el.hasAttribute('data-pick-more')) { shown += PAGE; drawChoices(); return; }
    // Editing your entry: the form opens under it; Cancel puts it back as it was.
    if (el.dataset.edit || el.dataset.editCancel) {
      const p = d.plays.find(x => x.id === Number(el.dataset.edit || el.dataset.editCancel));
      const item = el.closest<HTMLElement>('[data-play]');
      if (!p || !item) return;
      if (el.dataset.editCancel) { item.outerHTML = String(playItem(ctx, d, p)); root.querySelector<HTMLElement>(`[data-edit="${p.id}"]`)?.focus(); return; }
      if (item.querySelector('[data-edit-form]')) return;
      item.insertAdjacentHTML('beforeend', String(editForm(ctx, p)));
      item.querySelector<HTMLInputElement>('[data-edit-form] input')?.focus();
      return;
    }
    if (el.dataset.kind) {
      kind = el.dataset.kind;
      setPressed(root, 'kind', kind);
      root.querySelectorAll<HTMLElement>('[data-for]').forEach(f => { f.hidden = !f.dataset.for!.split(' ').includes(kind); });
      // The .osr is the entry itself in "A replay file", and optional next to a score link.
      const label = root.querySelector('[data-osr-label]');
      if (label) label.textContent = kind === 'replay' ? t('Replay file') : t('Replay file (optional)');
      return;
    }
    if (el.dataset.endorse) {
      const p = d.plays.find(x => x.id === Number(el.dataset.endorse));
      if (!p) return;
      el.disabled = true;
      const res = await top10Api(`/api/top10/plays/${p.id}/endorse`, { method: 'POST' });
      el.disabled = false;
      if (!res.ok) { toast(problemText(t, res, { scope: d.scope })); return; }
      p.endorsed = typeof res.body?.endorsed === 'boolean' ? res.body.endorsed : !p.endorsed;
      p.endorsements = typeof res.body?.endorsements === 'number' ? res.body.endorsements : (p.endorsements ?? 0) + (p.endorsed ? 1 : -1);
      el.closest('[data-play]')!.outerHTML = String(playItem(ctx, d, p));
      root.querySelector<HTMLElement>(`[data-endorse="${p.id}"]`)?.focus();
      return;
    }
    if (el.dataset.delete) {
      if (!confirm(t('Remove this play from the showcase?'))) return;
      const id = Number(el.dataset.delete);
      const res = await top10Api(`/api/top10/plays/${id}`, { method: 'DELETE' });
      if (!res.ok) { toast(problemText(t, res, { scope: d.scope })); return; }
      d.plays = d.plays.filter(p => p.id !== id);
      drawList();
      // The play can be picked again.
      if (select?.value) yearPlays(Number(select.value));
      toast(t('Removed.'));
    }
  });

  root.addEventListener('submit', async ev => {
    const f = (ev.target as Element).closest<HTMLFormElement>('[data-edit-form]');
    if (!f) return;
    ev.preventDefault();
    const p = d.plays.find(x => x.id === Number(f.dataset.editForm));
    if (!p) return;
    const data = new FormData(f);
    const msg = f.querySelector<HTMLElement>('[data-edit-msg]')!;
    const clip = String(data.get('clip') ?? '').trim();
    if (clip && !clipOk(clip)) { msg.textContent = t('A clip has to be a YouTube, Twitch or Streamable link.'); return; }
    const button = f.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    button.disabled = true;
    const res = await top10Api(`/api/top10/plays/${p.id}`, { method: 'PATCH', body: { caption: String(data.get('caption') ?? '').trim(), clip } });
    button.disabled = false;
    if (!res.ok) { msg.textContent = problemText(t, res, { scope: d.scope }); return; }
    const saved = (res.body?.play ?? {}) as Partial<ShowPlay>;
    p.caption = saved.caption ?? p.caption;
    p.clip = saved.clip === undefined ? p.clip : saved.clip;
    drawList();
    toast(t('Saved.'));
  });

  root.querySelector<HTMLSelectElement>('[data-filter-player]')?.addEventListener('change', ev => {
    const v = (ev.target as HTMLSelectElement).value;
    const scope = d.scope === 'alltime' ? 'scope=alltime' : '';
    go(v ? `/top10/plays?${scope ? `${scope}&` : ''}player=${v}` : `/top10/plays${scope ? `?${scope}` : ''}`);
  });

  select?.addEventListener('change', () => yearPlays(Number(select.value)));
  if (select?.value) yearPlays(Number(select.value));

  form?.addEventListener('submit', async ev => {
    ev.preventDefault();
    const msg = form.querySelector<HTMLElement>('[data-msg]')!;
    const data = new FormData(form);
    const caption = String(data.get('caption') ?? '').trim();
    const upload = data.get('replay');
    const file = (kind === 'link' || kind === 'replay') && upload instanceof File && upload.size ? upload : null;
    if (file && !/\.osr$/i.test(file.name)) { msg.textContent = t('A replay has to be an .osr file.'); return; }
    if (file && file.size > MAX_REPLAY_BYTES) { msg.textContent = t('That replay is over 2 MB.'); return; }
    let body: Record<string, unknown>;
    if (kind === 'replay') {
      if (!file) { msg.textContent = t('Choose your .osr file.'); return; }
      body = { scope: d.scope, caption };
    } else if (kind === 'clip') {
      const clip = String(data.get('clip') ?? '').trim();
      if (!data.get('player')) { msg.textContent = t('Choose the player whose play it is.'); return; }
      if (!clipOk(clip)) { msg.textContent = t('A clip has to be a YouTube, Twitch or Streamable link.'); return; }
      body = { scope: d.scope, player: Number(data.get('player')), clip, caption };
    } else {
      // A pick may be filtered out of view: the one chosen is remembered.
      const score = String(kind === 'link' ? data.get('score') ?? '' : chosen).trim();
      if (!score) { msg.textContent = kind === 'link' ? t('Paste the score’s link from osu!.') : t('Choose a player, then one of their plays.'); return; }
      // A pick is a canonical ref (osu:, legacy: or map:<beatmap>:<player>: ui/top10.ts playRef); a link goes as pasted.
      body = { scope: d.scope, score, caption };
    }
    const button = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    button.disabled = true;
    msg.textContent = '';
    const res = await top10Api('/api/top10/plays', { method: 'POST', body: await showcaseBody(body, file) });
    button.disabled = false;
    if (!res.ok) { msg.textContent = problemText(t, res, { scope: d.scope }); return; }
    const added = (res.body?.play ?? res.body) as ShowPlay;
    if (added && typeof added.id === 'number') d.plays = [added, ...d.plays];
    // Back to the player the form started on (you, on your own page), with the play just added marked as in.
    form.reset();
    if (select?.value) yearPlays(Number(select.value));
    else root.querySelector('[data-year-plays]')!.innerHTML = '';
    drawList();
    // With a replay file: osu! may keep this score's replay, and then the site links to theirs rather than storing it.
    toast(res.body?.replay === 'osu' ? t('Added to the showcase. osu! keeps this score’s replay, so the site links to theirs.') : t('Added to the showcase 🔥'));
    writeQuery({ scope: d.scope === 'alltime' ? 'alltime' : '', player: d.player ?? '' });
  });
}
