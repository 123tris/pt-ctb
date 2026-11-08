// /top10/vote in the browser: the editor's state and everything that changes it. Taps on the picker fill the next spot
// (or the mentions or ones to watch), ↑/↓ and drag reorder, "same spot" ties, ⓘ opens a player's dossier in a drawer.
//
// Saving (§10, the free tier): a change saves at most every 20 seconds, and leaving a box saves too, within the same
// limit; leaving the page saves what's left. A ballot that can't be saved on the server yet (before 1 December, or on
// a copy of the site without the endpoints) is kept in this browser instead, and goes to the server once it can.

import type { Ctx } from '../kernel/ctx.ts';
import { html } from '../kernel/html.ts';
import { store } from '../client/boot.ts';
import { announce, prefs, writeQuery } from '../client/ui.ts';
import { toast } from '../client/fun.ts';
import { setPressed } from '../client/dom.ts';
import { closeOnEscape } from '../client/bananas.ts';
import { top10Api, problemText } from '../client/top10.ts';
import { readPlayer } from '../gen/packs.ts';
import { playerPack } from '../routes.ts';
import { rowOf } from '../ui/players.ts';
import {
  flagList, flagsOf, picksOf, wordMeter, type Kind, wordsOf, MAX_EXTRAS, MAX_PICKS, type BallotInput, type OwnBallot, type ShowPlay,
} from '../ui/top10.ts';
import {
  accessOf, actionBar, extrasSection, listSection, pickerCards, pickerSection, placeOf, statusLine, writeOrder, writerSection,
  placeholderOf, type CiteChoice, type Data, type Editor, type Target,
} from './top10-ballot.ts';
import { careerChoices, dossierBody, yearChoices } from './top10-dossier.ts';

/** The shortest time between two saves of a draft, in ms. */
export const SAVE_GAP = 20_000;
/** How long after the first change a save waits, when the last one was long enough ago. */
const SETTLE = 3_000;

/** Where a draft that can't go to the server yet is kept, per ballot (the yearly one's key is as it was). */
const draftKey = (year: number, me: number | null, kind: Kind = 'year') => `top10draft:${year}:${kind === 'alltime' ? 'alltime:' : ''}${me ?? 0}`;

/** What a save sends. */
export const inputOf = (e: Editor, kind: Kind = 'year'): BallotInput & { kind: Kind } => ({
  // `kind` goes with every write (§13.11); all time has no ones to watch.
  kind, picks: picksOf(e.rows), mentions: e.mentions, watch: kind === 'alltime' ? [] : e.watch, intro: e.intro, outro: e.outro,
  writeups: Object.fromEntries(Object.entries(e.writeups).filter(([, w]) => w.body.trim() || w.cites.length)),
});

/** A draft kept in this browser, for when the server can't take it yet. */
export function localDraft(year: number, me: number | null, kind: Kind = 'year'): OwnBallot | null {
  const saved = prefs.get(draftKey(year, me, kind), null) as (BallotInput & { at: number }) | null;
  if (!saved?.picks) return null;
  return { ...saved, status: 'draft', writeups: Object.fromEntries(Object.entries(saved.writeups ?? {}).map(([k, w]) => [k, { body: w.body, cites: w.cites }])) };
}

export function mount(root: HTMLElement, ctx: Ctx, d: Data, e: Editor): void {
  const { t, fmt } = ctx;
  const year = d.season.year;
  const kind = d.kind;
  const access = accessOf(ctx, d);
  if (access === 'signed-out' || access === 'ineligible') return;
  const can = access === 'edit' || access === 'local';
  const $ = <T extends Element = HTMLElement>(sel: string) => root.querySelector<T>(sel);

  // ---- Saving ------------------------------------------------------------------------------------------------------

  let dirty = false;
  let saving = false;
  let lastSave = 0;
  let savedAt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let problem = '';

  const saveText = () => (problem ? problem : saving ? t('Saving…') : dirty ? t('Unsaved changes') : savedAt ? t('Saved {ago}', { ago: fmt.ago(savedAt / 1000) }) : '');
  const drawStatus = () => { const el = $('[data-status]'); if (el) el.innerHTML = String(statusLine(ctx, e, access, saveText())); };
  const tick = setInterval(() => { if (!root.isConnected) { clearInterval(tick); return; } if (savedAt && !dirty && !saving) drawStatus(); }, 15_000);

  let inFlight: Promise<boolean> | null = null;
  let again = false;

  /**
   * Saves now. A save asked for while one is on its way (a change, leaving the page, Submit) waits for it and then
   * sends what changed meanwhile, so nothing typed during a save is dropped.
   */
  function save(): Promise<boolean> {
    if (inFlight) { again = true; return inFlight; }
    inFlight = (async () => {
      let ok = await saveOnce();
      while (again) { again = false; if (dirty) ok = await saveOnce(); }
      return ok;
    })().finally(() => { inFlight = null; });
    return inFlight;
  }

  async function saveOnce(): Promise<boolean> {
    if (timer) { clearTimeout(timer); timer = null; }
    if (!dirty) return true;
    const body = inputOf(e, kind);
    if (access === 'local') {
      prefs.set(draftKey(year, ctx.me, kind), { ...body, at: Date.now() });
      dirty = false;
      drawStatus();
      return true;
    }
    saving = true;
    dirty = false;
    lastSave = Date.now();
    drawStatus();
    const res = await top10Api('/api/top10/ballot', { method: 'PUT', body });
    saving = false;
    if (res.ok) {
      problem = '';
      savedAt = Date.now();
      prefs.set(draftKey(year, ctx.me, kind), null);
      const back = (res.body?.ballot ?? null) as OwnBallot | null;
      for (const [id, w] of Object.entries(back?.writeups ?? {})) e.server[id] = { flags: flagList(w.flags), mod: w.mod, mod_reason: w.mod_reason };
      if (back?.status) e.status = back.status;
      // The server's cards for the cites, under the canonical refs it answers with.
      Object.assign(e.scores, back?.scores ?? {});
    } else {
      dirty = true;
      problem = t('Not saved: {why}', { why: problemText(t, res) });
      // Kept here, so nothing typed is lost; the next change tries again.
      prefs.set(draftKey(year, ctx.me, kind), { ...body, at: Date.now() });
    }
    drawStatus();
    return res.ok;
  }

  /** Saves `SETTLE` after a change, and never sooner than `SAVE_GAP` after the last save. */
  function changed(): void {
    dirty = true;
    if (access === 'local') { save(); return; }
    drawStatus();
    if (timer) return;
    const wait = Math.max(SETTLE, lastSave + SAVE_GAP - Date.now());
    timer = setTimeout(save, wait);
  }

  /** Leaving a box: saves now if the last save was long enough ago, else when it may. */
  function left(): void {
    if (!dirty) return;
    if (Date.now() - lastSave >= SAVE_GAP) save();
    else if (!timer) timer = setTimeout(save, lastSave + SAVE_GAP - Date.now());
  }

  // Leaving the page or the tab: what's left goes now (PUT is sent with keepalive).
  const flush = () => { if (dirty) save(); };
  const onHide = () => { if (document.visibilityState === 'hidden') flush(); };
  document.addEventListener('visibilitychange', onHide);
  window.addEventListener('pagehide', flush);
  window.addEventListener('routechange', function off() {
    flush();
    document.removeEventListener('visibilitychange', onHide);
    window.removeEventListener('pagehide', flush);
    window.removeEventListener('routechange', off);
  });
  // A draft kept here that the server hasn't got yet (saved before 1 December, or when a save failed): send it.
  if (access === 'edit' && localDraft(year, ctx.me, kind) && prefs.get(draftKey(year, ctx.me, kind), null)) changed();

  // ---- Drawing -----------------------------------------------------------------------------------------------------

  let extrasOpen = false;
  let prompt = '';
  let citeOpen = false;
  let choices: CiteChoice[] | null = null;

  const drawBar = () => { const el = $('[data-bar]'); if (el) el.innerHTML = String(actionBar(ctx, d, e, access)); };
  function drawMain(): void {
    const main = $('[data-main]')!;
    if (e.mode === 'write') {
      main.innerHTML = String(writerSection(ctx, d, e, access, { prompt, choices, citeOpen }));
    } else {
      extrasOpen = $<HTMLDetailsElement>('[data-extras]')?.open ?? extrasOpen;
      const picker = $('.t10-picker');
      // The list and extras redraw; the picker stays (its search box keeps focus), only its cards' marks change.
      main.querySelector('.t10-list-wrap')?.remove();
      main.querySelector('[data-extras]')?.remove();
      main.insertAdjacentHTML('afterbegin', String(html`${listSection(ctx, d, e, access)}${extrasSection(ctx, d, e, access, extrasOpen)}`));
      if (!picker && access !== 'read') main.insertAdjacentHTML('beforeend', String(pickerSection(ctx, d, e, access)));
      markCards();
    }
    drawBar();
  }
  function markCards(): void {
    root.querySelectorAll<HTMLElement>('.t10-card').forEach(card => {
      const id = Number(card.dataset.id);
      const placed = placeOf(e, id);
      card.classList.toggle('t10-card-on', Boolean(placed));
      const button = card.querySelector<HTMLButtonElement>('[data-pick]');
      if (button && !button.disabled) button.setAttribute('aria-pressed', String(Boolean(placed)));
      const badge = card.querySelector('[data-badge]');
      if (badge) badge.textContent = placed;
    });
  }
  const drawCards = () => { const el = $('[data-cards]'); if (el) el.innerHTML = String(pickerCards(ctx, d, e)); };
  const name = (id: number) => { const r = rowOf(d.core.players, id); return r < 0 ? `#${id}` : d.core.players.name.at(r); };

  // ---- The list ----------------------------------------------------------------------------------------------------

  /** Takes a player off wherever they are on the ballot. */
  const takeOff = (id: number) => {
    e.rows = e.rows.filter(r => r.id !== id);
    if (e.rows[0]) e.rows[0].tie = false;
    e.mentions = e.mentions.filter(x => x !== id);
    e.watch = e.watch.filter(x => x !== id);
  };

  function pick(id: number): void {
    if (!can || id === ctx.me) return;
    const where = e.target;
    const already = placeOf(e, id);
    const inTarget = where === 'list' ? e.rows.some(r => r.id === id) : e[where].includes(id);
    if (inTarget) {
      takeOff(id);
      announce(t('{name} taken off', { name: name(id) }));
    } else {
      const full = where === 'list' ? e.rows.length >= MAX_PICKS : e[where].length >= MAX_EXTRAS;
      if (full) { toast(where === 'list' ? t('Your list is full. Take someone off first.') : t('That’s {n} already, the most there can be.', { n: MAX_EXTRAS })); return; }
      if (already) takeOff(id);
      if (where === 'list') e.rows.push({ id, tie: false });
      else e[where].push(id);
      announce(t('{name} added: {place}', { name: name(id), place: placeOf(e, id) }));
      if (where !== 'list') extrasOpen = true;
    }
    drawMain();
    changed();
  }

  function move(from: number, to: number): void {
    if (to < 0 || to >= e.rows.length || from === to) return;
    const [r] = e.rows.splice(from, 1);
    e.rows.splice(to, 0, r);
    if (e.rows[0]) e.rows[0].tie = false;
    drawMain();
    changed();
    // Focus follows the player, so ↑ ↑ ↑ keeps moving them.
    root.querySelector<HTMLElement>(`[data-i="${to}"] [data-${from > to ? 'up' : 'down'}]:not([disabled])`)?.focus()
      ?? root.querySelector<HTMLElement>(`[data-i="${to}"] [data-info]`)?.focus();
  }

  root.addEventListener('click', async ev => {
    const el = (ev.target as Element).closest<HTMLElement>('button, [data-step]');
    if (!el) return;
    const ds = el.dataset;
    if (ds.pick) return pick(Number(ds.pick));
    if (ds.info) return openDrawer(Number(ds.info), el);
    if (ds.up !== undefined) return move(Number(ds.up), Number(ds.up) - 1);
    if (ds.down !== undefined) return move(Number(ds.down), Number(ds.down) + 1);
    if (ds.tie !== undefined) {
      const r = e.rows[Number(ds.tie)];
      r.tie = !r.tie;
      drawMain();
      changed();
      root.querySelector<HTMLElement>(`[data-tie="${ds.tie}"]`)?.focus();
      return;
    }
    if (ds.remove) { takeOff(Number(ds.remove)); drawMain(); changed(); return; }
    if (ds.removeMentions || ds.removeWatch) { takeOff(Number(ds.removeMentions ?? ds.removeWatch)); extrasOpen = true; drawMain(); changed(); return; }
    if (ds.target) { e.target = ds.target as Target; setPressed(root, 'target', e.target); return; }
    if (ds.filter) { e.filter = ds.filter as Editor['filter']; setPressed(root, 'filter', e.filter); drawCards(); return; }
    if (el.hasAttribute('data-write')) return toWrite(0);
    if (el.hasAttribute('data-back')) { e.mode = 'list'; e.fresh = false; writeQuery({}); rebuild(); return; }
    if (el.hasAttribute('data-submit')) return submit(el as HTMLButtonElement);
    if (el.hasAttribute('data-withdraw')) return withdraw(el as HTMLButtonElement);
    // The write-ups.
    if (ds.step !== undefined) return toWrite(Number(ds.step));
    if (el.hasAttribute('data-prev')) return toWrite(e.writing - 1);
    if (el.hasAttribute('data-next')) return toWrite(e.writing + 1);
    if (el.hasAttribute('data-finish')) { await save(); e.mode = 'list'; e.fresh = false; writeQuery({}); rebuild(); toast(t('Thanks for writing ✍️')); return; }
    if (ds.prompt) {
      prompt = prompt === ds.prompt ? '' : ds.prompt;
      root.querySelectorAll<HTMLElement>('[data-prompt]').forEach(c => { const on = c.dataset.prompt === prompt; c.classList.toggle('active', on); c.setAttribute('aria-pressed', String(on)); });
      const box = $<HTMLTextAreaElement>('[data-body]');
      if (box) { box.placeholder = prompt || placeholderOf(ctx, kind, name(Number(box.dataset.body))); box.focus(); }
      return;
    }
    if (el.hasAttribute('data-cite')) { citeOpen = !citeOpen; if (citeOpen) loadChoices(); redrawWriter(); return; }
    if (ds.uncite) { const w = current(); w.cites = w.cites.filter(r => r !== ds.uncite); redrawWriter(); changed(); return; }
  });

  root.addEventListener('input', ev => {
    const el = ev.target as HTMLInputElement | HTMLTextAreaElement;
    if (el.matches('[data-q]')) { e.q = el.value; drawCards(); return; }
    if (el.matches('[data-note]')) { e[(el as HTMLTextAreaElement).dataset.note as 'intro' | 'outro'] = el.value; changed(); return; }
    if (el.matches('[data-body]')) {
      const id = (el as HTMLTextAreaElement).dataset.body!;
      const w = (e.writeups[id] ??= { body: '', cites: [] });
      w.body = el.value;
      // Typing again clears the server's flags until the next save says otherwise.
      if (e.server[id]) e.server[id].flags = [];
      const others = Object.entries(e.writeups).filter(([k]) => k !== id).map(([, x]) => x.body);
      const kind = writeOrder(e)[e.writing]?.kind ?? 'list';
      $('[data-meter]')!.innerHTML = String(wordMeter(ctx, wordsOf(w.body).length, flagsOf(w.body, others), { pays: kind === 'list' }));
      const next = $('[data-next]');
      if (next) next.textContent = `${w.body.trim() ? t('Next player') : t('Skip')} →`;
      changed();
    }
  });
  root.addEventListener('change', ev => {
    const el = ev.target as HTMLInputElement;
    if (!el.matches('[data-cite-ref]')) return;
    const w = current();
    const ref = el.dataset.citeRef!;
    w.cites = el.checked ? [...new Set([...w.cites, ref])].slice(0, 5) : w.cites.filter(r => r !== ref);
    const picked = choices?.find(c => c.ref === ref)?.card;
    if (picked) e.scores[ref] = picked;
    const cites = $('[data-cites]');
    if (cites) {
      // Only the cards under the box; the list keeps its place and focus.
      const fresh = document.createElement('div');
      fresh.innerHTML = String(writerSection(ctx, d, e, access, { prompt, choices, citeOpen }));
      cites.innerHTML = fresh.querySelector('[data-cites]')!.innerHTML;
    }
    changed();
  });
  root.addEventListener('focusout', ev => { if ((ev.target as Element).matches('textarea, input[data-q]')) left(); });
  root.addEventListener('toggle', ev => { if ((ev.target as Element).matches('[data-extras]')) extrasOpen = (ev.target as HTMLDetailsElement).open; }, true);

  // Drag to reorder, where there's a mouse: the slot dropped on takes the dragged player's place.
  let dragFrom = -1;
  root.addEventListener('dragstart', ev => {
    const li = (ev.target as Element).closest<HTMLElement>('[data-i]');
    if (!li || !can) return;
    dragFrom = Number(li.dataset.i);
    li.classList.add('t10-dragging');
    ev.dataTransfer?.setData('text/plain', String(dragFrom));
    if (ev.dataTransfer) ev.dataTransfer.effectAllowed = 'move';
  });
  root.addEventListener('dragover', ev => {
    const li = (ev.target as Element).closest<HTMLElement>('[data-i]');
    if (dragFrom < 0 || !li) return;
    ev.preventDefault();
    root.querySelectorAll('.t10-drop').forEach(x => x.classList.remove('t10-drop'));
    li.classList.add('t10-drop');
  });
  root.addEventListener('drop', ev => {
    const li = (ev.target as Element).closest<HTMLElement>('[data-i]');
    if (dragFrom < 0 || !li) return;
    ev.preventDefault();
    const to = Number(li.dataset.i);
    const from = dragFrom;
    dragFrom = -1;
    move(from, to);
  });
  root.addEventListener('dragend', () => {
    dragFrom = -1;
    root.querySelectorAll('.t10-drop, .t10-dragging').forEach(x => x.classList.remove('t10-drop', 't10-dragging'));
  });

  // ---- Submit and withdraw -------------------------------------------------------------------------------------------

  async function submit(button: HTMLButtonElement): Promise<void> {
    button.disabled = true;
    dirty = true;
    if (!(await save())) { button.disabled = false; toast(problem || t('That didn’t go through. Try again in a moment.')); return; }
    const res = await top10Api('/api/top10/ballot/submit', { method: 'POST', body: { kind } });
    if (!res.ok) { button.disabled = false; toast(problemText(t, res)); return; }
    e.status = 'submitted';
    e.fresh = true;
    toWrite(0);
    announce(kind === 'alltime' ? t('Your top 10 of all time is in ✅') : t('Your top 10 is in ✅'));
  }

  async function withdraw(button: HTMLButtonElement): Promise<void> {
    if (!confirm(t('Withdraw your ballot? It goes back to a draft: no longer public, and it won’t count unless you submit it again.'))) return;
    button.disabled = true;
    await save();
    const res = await top10Api('/api/top10/ballot/withdraw', { method: 'POST', body: { kind } });
    if (!res.ok) { button.disabled = false; toast(problemText(t, res)); return; }
    e.status = 'draft';
    drawStatus();
    drawBar();
    toast(t('Withdrawn. It’s a draft again.'));
  }

  // ---- The write-ups -----------------------------------------------------------------------------------------------

  const current = () => {
    const o = writeOrder(e)[e.writing];
    return (e.writeups[o.id] ??= { body: '', cites: [] });
  };
  function redrawWriter(): void {
    const box = $<HTMLTextAreaElement>('[data-body]');
    const caret = box && document.activeElement === box ? box.selectionStart : null;
    $('[data-main]')!.innerHTML = String(writerSection(ctx, d, e, access, { prompt, choices, citeOpen }));
    if (caret !== null) { const b = $<HTMLTextAreaElement>('[data-body]'); b?.focus(); b?.setSelectionRange(caret, caret); }
  }
  function toWrite(i: number): void {
    const order = writeOrder(e);
    if (!order.length) return;
    left();
    e.mode = 'write';
    e.writing = Math.max(0, Math.min(i, order.length - 1));
    prompt = '';
    citeOpen = false;
    choices = null;
    writeQuery({ write: 1 });
    $('[data-main]')!.innerHTML = String(writerSection(ctx, d, e, access, { prompt, choices, citeOpen }));
    drawBar();
    drawStatus();
    $('.t10-writer')?.scrollIntoView({ block: 'start' });
    $<HTMLTextAreaElement>('[data-body]')?.focus({ preventScroll: true });
  }

  /** The current player's scores to cite: their showcase entries, then their plays of the year by pp. */
  async function loadChoices(): Promise<void> {
    const id = writeOrder(e)[e.writing]?.id;
    if (!id) return;
    const [shown, pack] = await Promise.all([
      top10Api(`/api/top10/plays?year=${year}&player=${id}${kind === 'alltime' ? '&scope=alltime' : ''}`).then(r => (r.ok ? (r.body?.plays ?? []) as ShowPlay[] : [])),
      store.pack(playerPack(id), readPlayer).catch(() => null),
    ]);
    if (writeOrder(e)[e.writing]?.id !== id) return;
    const out: CiteChoice[] = shown.map(p => ({ ref: p.score_ref || `play:${p.id}`, card: p.score ?? null, label: `🔥 ${fmt.num(p.endorsements ?? 0)}` }));
    for (const c of kind === 'alltime' ? careerChoices(pack, id) : yearChoices(pack, year, id)) if (!out.some(o => o.ref === c.ref)) out.push(c);
    choices = out.slice(0, 25);
    if (citeOpen) redrawWriter();
  }

  // ---- The dossier drawer --------------------------------------------------------------------------------------------

  const drawer = $('[data-drawer]')!;
  let opener: HTMLElement | null = null;
  async function openDrawer(id: number, from: HTMLElement): Promise<void> {
    const row = rowOf(d.core.players, id);
    if (row < 0) return;
    opener = from;
    drawer.hidden = false;
    document.body.classList.add('t10-noscroll');
    $('[data-drawer-title]')!.textContent = kind === 'alltime' ? t('{name}’s career', { name: name(id) }) : t('{name}’s {year}', { name: name(id), year });
    const body = $('[data-drawer-body]')!;
    body.innerHTML = String(html`<p class="muted">${t('Loading…')}</p>`);
    $<HTMLElement>('.t10-drawer-panel')!.focus();
    const [pack, shown] = await Promise.all([
      store.pack(playerPack(id), readPlayer).catch(() => null),
      top10Api(`/api/top10/plays?year=${year}&player=${id}${kind === 'alltime' ? '&scope=alltime' : ''}`).then(r => (r.ok ? (r.body?.plays ?? []) as ShowPlay[] : null)),
    ]);
    if (drawer.hidden) return;
    body.innerHTML = String(dossierBody(ctx, {
      id, year, core: d.core, row, pack, history: d.history, plays: shown, candidate: d.candidates.find(c => c.id === id) ?? null, career: kind === 'alltime', head: null, placements: null,
    }, { compact: true }));
  }
  function closeDrawer(): void {
    if (drawer.hidden) return;
    drawer.hidden = true;
    document.body.classList.remove('t10-noscroll');
    opener?.focus();
  }
  drawer.addEventListener('click', ev => {
    if (ev.target === drawer || (ev.target as Element).closest('[data-drawer-close]')) closeDrawer();
  });
  closeOnEscape(drawer, closeDrawer);
  window.addEventListener('routechange', function off() { document.body.classList.remove('t10-noscroll'); window.removeEventListener('routechange', off); });

  function rebuild(): void {
    const main = $('[data-main]')!;
    main.innerHTML = '';
    if (e.mode === 'write') { drawMain(); return; }
    main.innerHTML = String(html`${listSection(ctx, d, e, access)}${extrasSection(ctx, d, e, access, extrasOpen)}`);
    // The picker comes back with its filters as they were.
    if (access !== 'read') main.insertAdjacentHTML('beforeend', String(pickerSection(ctx, d, e, access)));
    drawBar();
    drawStatus();
  }

  drawStatus();
  if (e.mode === 'write') { e.writing = 0; redrawWriter(); }
}
