// The profile's browser half (player.ts draws it): the score lists' search, sort, "Only #1s" and pages, kept in the
// address and loading the whole player file when they need it; switching lists in place; the pp chart, with
// history.json loaded once it's opened; the wallet's shield, requests and tip form; and the badges card.

import { html } from '../kernel/html.ts';
import type { Ctx } from '../kernel/ctx.ts';
import { store } from '../client/boot.ts';
import { paginate, setPressed } from '../client/dom.ts';
import type { PageArgs } from '../client/page.ts';
import {
  announce, writeQuery, prefs, chartHover, sendRequest, myRequests, requestList, pendingSpend, closeOnEscape,
} from '../client/legacy.ts';
import { rowOf } from '../ui/players.ts';
import { RULES, bananas } from '../ui/bananas.ts';
import type { Play } from '../ui/scores.ts';
import {
  countsOf, pickTab, listOf, listTabs, listBody, needsAll, shownPlays, playLabel, playsCount, playRows, noMatch, pageOf,
  historyPoints, historyRanges, historyLines, historyChart, historyRows, historyChips, tipConfirm, title,
  type Data, type State, type PlayerFile, type ListTab, type SortKey, type Query, type History, type HistoryPoint, type HistoryRange,
} from './player.ts';

/** The profile on the page. Switching between its score lists only redraws them, so the page doesn't jump or flash. */
interface View {
  id: number;
  name: string;
  counts: Record<string, number>;
  /** The head file, until a list loads the whole one. */
  file: PlayerFile;
  section: HTMLElement;
  /** The open list's listeners on what stays when another list opens, to take them off then. */
  wired: AbortController | null;
}

let onScreen: View | null = null;

/** The last whole player file this page loaded, so switching tabs on that profile doesn't go back to the head file. */
let lastFull: PlayerFile | null = null;
export const lastFullFile = (id: number): PlayerFile | null => (lastFull?.id === id ? lastFull : null);

export function mount(root: HTMLElement, ctx: Ctx, data: Data, state: State, isCurrent: () => boolean): void {
  if (!data.file.head) lastFull = data.file;
  const view: View = { id: data.id, name: title(data), counts: countsOf(data.file), file: data.file, section: root.querySelector('#plays')!, wired: null };
  onScreen = view;
  wirePlays(ctx, view, pickTab(state.tab, view.counts), state.query, isCurrent);
  wireBananas(root, ctx, data, state, isCurrent);
  wireHistory(root, ctx, data);
  wirePeek(root);
}

/**
 * Another score list of the profile on the page (app.js keeps the page in place for a new tab): marks its tab and draws
 * it, so the tab that was clicked keeps focus and the page stays where it was scrolled. False for any other address.
 */
export function switchList(root: HTMLElement, ctx: Ctx, { params, query, isCurrent }: PageArgs): boolean {
  const view = onScreen;
  if (!view || view.id !== Number(params.id) || !root.contains(view.section)) return false;
  const tab = pickTab(params.tab, view.counts);
  const href = `/player/${view.id}/${tab.slug}`;
  const links = [...view.section.querySelectorAll('.tabs a')];
  if (links.some(a => a.getAttribute('href') === href)) {
    links.forEach(a => {
      const on = a.getAttribute('href') === href;
      a.classList.toggle('active', on);
      if (on) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
  } else {
    view.section.querySelector('#play-tabs')!.innerHTML = String(listTabs(ctx, view.id, view.counts, tab));
  }
  view.section.querySelector('#play-list')!.innerHTML = String(listBody(ctx, view.file, view.name, view.counts, tab, query));
  wirePlays(ctx, view, tab, query, isCurrent);
  return true;
}

/** Wires the open list, already drawn: its search, sort, filter and pages, and the whole file when they need it. */
function wirePlays(ctx: Ctx, view: View, tab: ListTab, query: Query, isCurrent: () => boolean): void {
  const { t } = ctx;
  view.wired?.abort();
  view.wired = null;
  const total = view.counts[tab.slug];
  if (tab.slug === 'dan' || !total) return;
  const body = view.section.querySelector<HTMLElement>('#play-list')!;
  const scores = body.querySelector<HTMLElement>('#scores')!;
  const q = body.querySelector<HTMLInputElement>('#q')!;
  const sort = body.querySelector<HTMLSelectElement>('#sort')!;
  const onlyFirsts = body.querySelector<HTMLInputElement>('#firsts');
  const count = body.querySelector<HTMLElement>('#count')!;

  let all = listOf(view.file, tab);
  // A head file holds this list's first page only (in the default order): until the whole file is in, the list is that
  // page padded with nulls to its real length.
  let partial = all.length < total;
  // The lowercase labels are built once per list, on the first search, not again on every keystroke.
  let labels: Map<Play, string> | null = null;
  const label = (s: Play) => (labels ??= new Map(all.map(x => [x, playLabel(ctx, view.file, x)]))).get(s) ?? '';
  const visible = () => shownPlays(all, total, partial, { q: q.value, sort: sort.value as SortKey, firsts: Boolean(onlyFirsts?.checked) }, label);

  // The whole file, loaded on the first search, sort, filter or page change of a list that came from the head.
  let fullPromise: Promise<boolean> | null = null;
  const loadAll = () => (fullPromise ??= store.json<PlayerFile>(`players/${view.id}.json`).then(full => {
    if (!isCurrent()) return false;
    lastFull = full;
    view.file = full;
    all = listOf(full, tab);
    labels = null;
    partial = false;
    return true;
  }, (e: Error) => {
    fullPromise = null;
    count.textContent = t('Couldn’t load all plays ({error}). Try again.', { error: e.message });
    return false;
  }));

  // Search, sort, "Only #1s" and page live in the address, so Back from a map comes back to the same list.
  let page = pageOf(query);
  const save = () => writeQuery({ q: q.value.trim(), sort: sort.value, firsts: Boolean(onlyFirsts?.checked), page: page + 1 }, { sort: 'pp', page: 1 });
  let items = visible();
  const showCount = (speak: boolean) => {
    count.textContent = playsCount(ctx, items.length, partial ? total : all.length);
    if (speak) announce(count.textContent);
  };
  // view.file at each draw: the head's maps, then the whole file's.
  const redraw = paginate(ctx, scores, items, slice => playRows(ctx, view.file, tab, slice), 50, {
    page,
    onPage: n => {
      page = n;
      save();
      upgrade();
    },
    empty: () => noMatch(ctx, q.value, Boolean(onlyFirsts?.checked)),
  });
  showCount(false);
  // Swaps the head's first page for the whole list, staying on the same page.
  function upgrade() {
    if (partial) loadAll().then(ok => { if (ok) { items = visible(); redraw(items, true); showCount(false); } });
  }
  // A switch on the page to a list's later page or sort (Back, say) while only the head file is in.
  if (needsAll(query)) upgrade();

  const signal = (view.wired = new AbortController()).signal;
  // The whole file can be 500 KB: start it when the pointer or focus reaches the search, sort or pages, so it's
  // usually in by the time they're used.
  const intent = (e: Event) => { if ((e.target as Element).closest?.('.toolbar, .pager')) upgrade(); };
  body.addEventListener('pointerover', intent, { signal });
  body.addEventListener('focusin', intent, { signal });
  const refilter = () => {
    if (partial) {
      count.textContent = t('Loading all plays…');
      loadAll().then(ok => { if (ok) refilter(); });
      return;
    }
    items = visible();
    redraw(items);
    showCount(true);
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  q.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(refilter, 120); });
  sort.addEventListener('change', refilter);
  onlyFirsts?.addEventListener('change', refilter);
  scores.addEventListener('click', e => {
    if (!(e.target as Element).closest('[data-clear]')) return;
    q.value = '';
    if (onlyFirsts) onlyFirsts.checked = false;
    refilter();
    q.focus();
  });
}

/**
 * The pp chart: drawn when its section is first opened (or by player.ts, when it opened open), redrawn when the range
 * changes. history.json is every player's, so a page that opened with the chart shut fetches it only when it's opened,
 * or about to be (the pointer or focus on its heading); the range chips come with it.
 */
function wireHistory(root: HTMLElement, ctx: Ctx, data: Data): void {
  const historyEl = root.querySelector<HTMLDetailsElement>('#history');
  if (!historyEl) return;
  const wrap = historyEl.querySelector<HTMLElement>('#history-chart')!;
  interface Points { recorded: HistoryPoint[]; rebuilt: HistoryPoint[]; ranges: HistoryRange[] }
  const pointsOf = (history: History): Points => {
    const { recorded, rebuilt } = historyPoints(history, data.id);
    return { recorded, rebuilt, ranges: historyRanges(ctx, recorded, rebuilt) };
  };
  let points: Points | null = data.history ? pointsOf(data.history) : null;
  let range = points?.ranges[0];
  let fetching: Promise<boolean> | null = null;
  const fetchHistory = () => (fetching ??= store.json<History>('history.json').then(history => {
    points = pointsOf(history);
    range = points.ranges[0];
    if (points.ranges.length > 1) wrap.insertAdjacentHTML('beforebegin', String(historyChips(ctx, points.ranges)));
    return true;
  }, () => {
    fetching = null;
    return false;
  }));

  // With too few points there are no ranges, and the chart says so.
  const linesNow = () => historyLines(ctx, points!.recorded, points!.rebuilt, range?.[2] ?? -Infinity);
  let drawn = false;
  const drawHistory = () => {
    drawn = true;
    const lines = linesNow();
    wrap.innerHTML = String(historyChart(ctx, lines));
    chartHover(wrap, historyRows(ctx, lines), { onKey: announce });
  };
  const show = async () => {
    if (drawn) return;
    if (!points) {
      wrap.innerHTML = String(html`<p class="muted small">${ctx.t('Loading…')}</p>`);
      if (!(await fetchHistory())) {
        wrap.innerHTML = String(html`<p class="muted small">${ctx.t('That didn’t go through. Try again in a moment.')}</p>`);
        return;
      }
    }
    if (historyEl.open && !drawn) drawHistory();
  };

  if (historyEl.open && points) {
    // player.ts drew it: only the readout to add.
    drawn = true;
    chartHover(wrap, historyRows(ctx, linesNow()), { onKey: announce });
  } else if (historyEl.open) {
    show();
  }
  historyEl.addEventListener('toggle', () => {
    prefs.set('ppchart', historyEl.open);
    if (historyEl.open) show();
  });
  const soon = () => { if (!points) fetchHistory(); };
  const summary = historyEl.querySelector('summary')!;
  summary.addEventListener('pointerover', soon, { once: true });
  summary.addEventListener('focusin', soon, { once: true });
  historyEl.addEventListener('click', e => {
    const chip = (e.target as Element).closest<HTMLElement>('.chips [data-range]');
    const picked = chip && points?.ranges.find(r => r[0] === chip.dataset.range);
    if (!picked) return;
    range = picked;
    setPressed(historyEl, 'range', range[0]);
    drawHistory();
  });
}

/** A request to the bot (economy/api.js), as myRequests() lists them. */
interface WalletRequest {
  type: string;
  status: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload: any;
  t: string;
  reason?: string;
}

/**
 * Wires the wallet: the shield toggle (waiting for the bot while a change is pending), the player's requests (fetched
 * now and after each new one) and the tip form (amount, then a confirmation with the wallet before and after).
 */
function wireBananas(root: HTMLElement, ctx: Ctx, data: Data, state: State, isCurrent: () => boolean): void {
  const { t } = ctx;
  const me = ctx.me;
  const id = data.id;
  const name = title(data);
  const myWallet = me ? data.economy?.players?.[me] ?? null : null;
  let requests: WalletRequest[] = [];
  const free = () => (myWallet ? myWallet.b - pendingSpend(requests) : 0);

  const shield = root.querySelector<HTMLButtonElement>('#shield');
  const shieldNote = root.querySelector<HTMLElement>('#shield-note');
  const showShield = () => {
    if (!shield || !shieldNote) return;
    const pending = requests.find(r => r.type === 'shield' && r.status === 'pending');
    shield.disabled = Boolean(pending);
    if (pending) shieldNote.textContent = pending.payload.on ? t('Turning the shield on: waiting for the bot.') : t('Turning the shield off: waiting for the bot.');
  };
  shield?.addEventListener('click', async () => {
    shield.disabled = true;
    const on = shield.getAttribute('aria-pressed') !== 'true';
    const sent = await sendRequest('shield', { on });
    if (sent.ok) requests = [{ type: 'shield', status: 'pending', payload: { on }, t: new Date().toISOString() }, ...requests];
    else { shield.disabled = false; if (shieldNote) shieldNote.textContent = sent.message; }
    showShield();
  });

  const tipBox = root.querySelector<HTMLElement>('#tip-box');
  const box = root.querySelector('#my-requests');
  // requestList() names a tip's player through an index by id, as the old app's players.json gave it.
  const players = data.core.players;
  const index = { get: (who: number) => { const row = rowOf(players, who); return row < 0 ? undefined : { name: players.name.at(row) }; } };
  const draw = async () => {
    if (!isCurrent()) { window.removeEventListener('ptctb:requests', draw); return; }
    const list: WalletRequest[] | null = me ? await myRequests() : null;
    if (!isCurrent() || !list) return;
    requests = list;
    showShield();
    // requestList() is the old html tag's markup, so it goes in as a string beside this client's.
    if (box) box.innerHTML = list.length ? `${html`<h3 class="small-h">${t('Your requests')}</h3>`}${String(requestList(list, index, { maps: data.bounties?.maps }))}` : '';
    if (tipBox?.querySelector('.tip-note')) tipNote();
  };
  if (me) { draw(); window.addEventListener('ptctb:requests', draw); }

  if (!tipBox) return;
  const input = (sel: string) => tipBox.querySelector<HTMLInputElement>(sel);
  const amountOf = () => Math.round(Number(input('#tip-amount')?.value) || 0);
  function tipNote() {
    const amount = amountOf();
    const ok = amount >= RULES.tipMin && amount <= RULES.tipMax && amount <= free();
    const submit = tipBox!.querySelector<HTMLButtonElement>('[type=submit]');
    const note = tipBox!.querySelector('.tip-note');
    if (!submit || !note) return;
    submit.disabled = !ok;
    note.textContent = !myWallet ? t('The bot has no wallet for you yet. It makes one at its next update after your first sign-in.')
      : amount < RULES.tipMin || amount > RULES.tipMax ? t('A tip is {min} to {max}.', { min: ctx.fmt.num(RULES.tipMin), max: ctx.fmt.num(RULES.tipMax) })
        : amount > free() ? t('Your wallet has {balance} free.', { balance: bananas(ctx, free()) })
          : t('Your wallet: {balance}, then {after}.', { balance: bananas(ctx, free()), after: bananas(ctx, free() - amount) });
  }
  const pickHtml = tipBox.innerHTML;
  const backToPick = (amount: string | number, reason: string | undefined) => {
    tipBox.innerHTML = pickHtml;
    input('#tip-amount')!.value = String(amount);
    input('#tip-reason')!.value = reason ?? '';
    tipNote();
    input('#tip-amount')!.focus();
  };
  tipNote();
  if (state.query.tip) input('#tip-amount')?.focus();
  tipBox.addEventListener('input', tipNote);
  tipBox.addEventListener('submit', e => {
    e.preventDefault();
    const amount = amountOf();
    if (tipBox.querySelector<HTMLButtonElement>('#tip [type=submit]')?.disabled) return;
    const reason = input('#tip-reason')!.value.trim() || null;
    tipBox.innerHTML = String(tipConfirm(ctx, name, amount, reason, free()));
    tipBox.dataset.amount = String(amount);
    tipBox.dataset.reason = reason ?? '';
    tipBox.querySelector<HTMLElement>('[data-confirm]')!.focus();
  });
  tipBox.addEventListener('click', async e => {
    const target = e.target as Element;
    if (target.closest('[data-cancel]')) { backToPick(tipBox.dataset.amount ?? 10, tipBox.dataset.reason); return; }
    const go = target.closest<HTMLButtonElement>('[data-confirm]');
    if (!go || go.disabled) return;
    go.disabled = true;
    const amount = Number(tipBox.dataset.amount);
    const sent = await sendRequest('tip', { to: id, amount, reason: tipBox.dataset.reason || null });
    if (sent.ok) {
      requests = [{ type: 'tip', status: 'pending', payload: { to: id, amount }, t: new Date().toISOString() }, ...requests];
      backToPick(10, '');
    } else {
      go.disabled = false;
      const error = tipBox.querySelector('.tip-error');
      if (error) error.textContent = sent.message;
    }
  });
  closeOnEscape(tipBox, () => { if (tipBox.querySelector('[data-cancel]')) backToPick(tipBox.dataset.amount ?? 10, tipBox.dataset.reason); });
}

/**
 * The badges card opens on hover (site.css, pointers only); a click or tap opens it until a second click, Escape or a
 * click anywhere else.
 */
function wirePeek(root: HTMLElement): void {
  const peek = root.querySelector<HTMLElement>('.peek');
  if (!peek) return;
  const peekButton = peek.querySelector<HTMLButtonElement>('.peek-btn')!;
  const setOpen = (open: boolean) => {
    peek.classList.toggle('open', open);
    peekButton.setAttribute('aria-expanded', String(open));
  };
  peekButton.addEventListener('click', () => setOpen(!peek.classList.contains('open')));
  const outside = (e: Event) => {
    if (!peek.isConnected) document.removeEventListener('click', outside);
    else if (!peek.contains(e.target as Node)) setOpen(false);
  };
  document.addEventListener('click', outside);
  peek.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    setOpen(false);
    peek.classList.add('shut');
    peekButton.focus();
  });
  peek.addEventListener('mouseleave', () => peek.classList.remove('shut'));
}
