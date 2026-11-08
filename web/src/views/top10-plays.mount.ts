// /top10/plays in the browser: the add form (a player's plays of the year from their pack, a pasted score link, or a
// clip), 🔥 endorse, removing your own entry, and the player filter, which keeps itself in the address.

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
import { playItem, usedLine, type Data } from './top10-plays.ts';
import { yearChoices } from './top10-dossier.ts';

export function mount(root: HTMLElement, ctx: Ctx, d: Data): void {
  const { t } = ctx;
  const form = root.querySelector<HTMLFormElement>('[data-form]');
  let kind = 'pick';

  const drawList = () => {
    const list = d.player === null ? d.plays : d.plays.filter(p => p.player === d.player);
    const el = root.querySelector('[data-plays]');
    if (el) el.outerHTML = String(list.length ? html`<ul class="t10-show-grid" data-plays>${list.map(p => playItem(ctx, d, p))}</ul>` : html`<p class="empty" data-plays>${t('Nothing showcased yet.')}</p>`);
  };

  // A player's plays of the year, to pick one: from their pack, the most pp first.
  async function yearPlays(id: number): Promise<void> {
    const box = root.querySelector<HTMLElement>('[data-year-plays]');
    if (!box) return;
    if (!id) { box.innerHTML = ''; return; }
    box.innerHTML = String(html`<p class="small muted">${t('Loading…')}</p>`);
    const pack = await store.pack(playerPack(id), readPlayer).catch(() => null);
    const choices = yearChoices(pack, d.season.year);
    const taken = new Set(d.plays.map(p => p.score_ref).filter(Boolean));
    box.innerHTML = String(choices.length ? html`<fieldset class="t10-pick-plays"><legend class="small muted">${t('Their plays of {year}, the most pp first', { year: d.season.year })}</legend>
      <ul class="t10-cite-list">${choices.map((c, i) => html`<li><label><input type="radio" name="pick" value="${c.ref}" ${taken.has(c.ref) ? raw('disabled') : i === 0 ? raw('checked') : ''}>
        ${scoreCard(ctx, c.card, c.ref, taken.has(c.ref) ? html`<span class="t10-pill">${t('already in')}</span>` : '')}</label></li>`)}</ul></fieldset>`
      : html`<p class="small muted">${t('No plays of theirs stored in {year}. Paste a score link or add a clip instead.', { year: d.season.year })}</p>`);
  }

  root.addEventListener('click', async ev => {
    const el = (ev.target as Element).closest<HTMLButtonElement>('button');
    if (!el) return;
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
      if (!res.ok) { toast(problemText(t, res)); return; }
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
      if (!res.ok) { toast(problemText(t, res)); return; }
      d.plays = d.plays.filter(p => p.id !== id);
      const used = root.querySelector('[data-used]');
      if (used) used.textContent = usedLine(ctx, d);
      drawList();
      toast(t('Removed.'));
    }
  });

  root.querySelector<HTMLSelectElement>('[data-filter-player]')?.addEventListener('change', ev => {
    const v = (ev.target as HTMLSelectElement).value;
    go(v ? `/top10/plays?player=${v}` : '/top10/plays');
  });

  const select = root.querySelector<HTMLSelectElement>('[data-player-select]');
  select?.addEventListener('change', () => yearPlays(Number(select.value)));
  if (select?.value) yearPlays(Number(select.value));

  form?.addEventListener('submit', async ev => {
    ev.preventDefault();
    const msg = form.querySelector<HTMLElement>('[data-msg]')!;
    const data = new FormData(form);
    const caption = String(data.get('caption') ?? '').trim();
    const picked = data.get('replay');
    const file = (kind === 'link' || kind === 'replay') && picked instanceof File && picked.size ? picked : null;
    if (file && !/\.osr$/i.test(file.name)) { msg.textContent = t('A replay has to be an .osr file.'); return; }
    if (file && file.size > MAX_REPLAY_BYTES) { msg.textContent = t('That replay is over 2 MB.'); return; }
    let body: Record<string, unknown>;
    if (kind === 'replay') {
      if (!file) { msg.textContent = t('Choose your .osr file.'); return; }
      body = { caption };
    } else if (kind === 'clip') {
      const clip = String(data.get('clip') ?? '').trim();
      if (!data.get('player')) { msg.textContent = t('Choose the player whose play it is.'); return; }
      if (!clipOk(clip)) { msg.textContent = t('A clip has to be a YouTube, Twitch or Streamable link.'); return; }
      body = { player: Number(data.get('player')), clip, caption };
    } else {
      const score = String(kind === 'link' ? data.get('score') ?? '' : data.get('pick') ?? '').trim();
      if (!score) { msg.textContent = kind === 'link' ? t('Paste the score’s link from osu!.') : t('Choose a player, then one of their plays.'); return; }
      // A stored play without an osu! score id goes by its map, with whose it is (ui/top10.ts playRef).
      body = score.startsWith('map:') ? { score, player: Number(data.get('player')), caption } : { score, caption };
    }
    const button = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    button.disabled = true;
    msg.textContent = '';
    const res = await top10Api('/api/top10/plays', { method: 'POST', body: await showcaseBody(body, file) });
    button.disabled = false;
    if (!res.ok) { msg.textContent = problemText(t, res); return; }
    const added = (res.body?.play ?? res.body) as ShowPlay;
    if (added && typeof added.id === 'number') d.plays = [added, ...d.plays];
    form.reset();
    root.querySelector('[data-year-plays]')!.innerHTML = '';
    root.querySelector('[data-used]')!.textContent = usedLine(ctx, d);
    drawList();
    toast(t('Added to the showcase 🔥'));
    writeQuery({ player: d.player ?? '' });
  });
}
