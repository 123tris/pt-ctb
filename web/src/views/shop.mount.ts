// The shop's browser half (shop.ts draws it): the visitor's requests to the bot, fetched and kept up to date; opening
// and folding the items; the effect line and the colour preview as the choice changes; and buying in two steps, pick
// then confirm, which sends the request (bananas.js). Esc steps back: from the confirmation to the choice, then folds
// the item.
//
// The page is drawn again whole on each change, as the old page does, so the listeners are on its root (#content),
// which outlives it. The old page left them there, adding more on every visit; here each one takes itself off at the
// first event after the page has gone.

import type { Ctx } from '../kernel/ctx.ts';
import { announce, sendRequest, myRequests, requestList, pendingSpend, mapIdFrom } from '../client/legacy.ts';
import { rowOf } from '../ui/players.ts';
import { bananas } from '../ui/bananas.ts';
import {
  render, shopItems, you, argKind, argField, currentTimed, effectOf, confirmStep,
  type Data, type State, type ShopItem, type ShopRequest,
} from './shop.ts';

export function mount(root: HTMLElement, ctx: Ctx, data: Data, isCurrent: () => boolean): void {
  const { t } = ctx;
  const items = shopItems(ctx);
  const find = (item: string | null | undefined) => items.find(s => s.item === item);
  const w = ctx.me !== null ? data.economy?.players?.[ctx.me] ?? null : null;
  // requestList() names a tip's player through an index by id, as the old app's players.json gave it.
  const players = data.core.players;
  const index = { get: (id: number) => { const row = rowOf(players, id); return row < 0 ? undefined : { name: players.name.at(row) }; } };
  let requests: ShopRequest[] = [];
  let open: string | null = null; // the item whose panel is open
  const free = () => (w ? w.b - pendingSpend(requests) : 0);
  const state = (purchases = ''): State => ({ open, requests, pending: pendingSpend(requests), purchases });

  const wired = new AbortController();
  const on = <K extends keyof HTMLElementEventMap>(type: K, handler: (e: HTMLElementEventMap[K]) => void) =>
    root.addEventListener(type, e => { if (isCurrent()) handler(e); else wired.abort(); }, { signal: wired.signal });

  /** The item's choice as picked in its panel; null or '' when there's none (no map, or one that can't be read). */
  const readArg = (s: ShopItem, panelBox: Element): string | number | null => {
    const text = panelBox.querySelector<HTMLInputElement | HTMLSelectElement>(`#arg-${s.item}`)!.value;
    const kind = argKind(s.item);
    return kind === 'map' ? mapIdFrom(text) : kind === 'play' ? Number(text) || null : text;
  };
  /** How many periods of a timed item are picked (1 for anything else). */
  const periodsOf = (panelBox: Element, s: ShopItem) => Number(panelBox.querySelector<HTMLSelectElement>(`#periods-${s.item}`)?.value) || 1;

  /** The open item's effect line (and the colour preview), for what's picked right now. */
  const showEffect = () => {
    const s = find(open);
    const panelBox = s && root.querySelector<HTMLElement>(`#panel-${s.item}`);
    const line = panelBox?.querySelector<HTMLElement>(`#effect-${s!.item}`);
    if (!s || !panelBox || !line) return;
    const value = readArg(s, panelBox);
    const periods = periodsOf(panelBox, s);
    const total = s.price * periods;
    const now = ctx.now();
    const { text, blocked } = value === null || value === ''
      ? { text: '', blocked: false } : effectOf(ctx, s, value, w, currentTimed(s, w, requests, now), now, periods);
    line.textContent = text;
    line.classList.toggle('shop-blocked', Boolean(blocked));
    const short = total > free();
    panelBox.querySelector<HTMLButtonElement>('[data-review]')!.disabled = Boolean(blocked) || short;
    const balance = bananas(ctx, free());
    panelBox.querySelector('.shop-why')!.textContent = short ? t('Short by {n} for that: your wallet has {balance} free.', { n: bananas(ctx, total - free()), balance })
      : t('Your wallet: {balance}, then {after}.', { balance, after: bananas(ctx, free() - total) });
    const preview = panelBox.querySelector('#colour-preview');
    if (preview) preview.className = `name-colour name-${value}`;
  };

  // requestList() is the old html tag's markup, so the view takes it as a string.
  const draw = () => {
    root.innerHTML = String(render(ctx, data, state(String(requestList(requests.filter(r => r.type === 'shop.buy'), index)))));
    showEffect();
  };
  on('input', showEffect);
  on('change', showEffect);
  if (!data.economy) return;
  if (ctx.me !== null) {
    const refresh = async () => {
      if (!isCurrent()) { wired.abort(); return; }
      const list: ShopRequest[] | null = await myRequests();
      if (!isCurrent() || !list) return;
      requests = list;
      // Redraw without losing the open step: only when nothing is being confirmed.
      if (root.querySelector('.shop-confirm')) return;
      const focused = document.activeElement?.id;
      draw();
      if (focused) document.getElementById(focused)?.focus();
    };
    refresh();
    window.addEventListener('ptctb:requests', refresh, { signal: wired.signal });
  }

  const fold = (s: ShopItem) => {
    open = null;
    draw();
    document.getElementById(`head-${s.item}`)?.focus();
  };
  const backToPick = (s: ShopItem, panelBox: HTMLElement) => {
    panelBox.querySelector('.shop-confirm')!.outerHTML = panelBox.dataset.pick!;
    panelBox.querySelector<HTMLInputElement>(`#arg-${s.item}`)!.value = panelBox.dataset.value!;
    const periodsField = panelBox.querySelector<HTMLSelectElement>(`#periods-${s.item}`);
    if (periodsField) periodsField.value = panelBox.dataset.periods!;
    showEffect();
    panelBox.querySelector<HTMLElement>(`#arg-${s.item}`)!.focus();
  };

  // Esc: from the confirmation back to the choice; from the choice, fold the item.
  on('keydown', e => {
    if (e.key !== 'Escape') return;
    const itemBox = (e.target as Element).closest?.<HTMLElement>('.shop-item');
    if (!itemBox || itemBox.dataset.item !== open) return;
    e.preventDefault();
    e.stopPropagation();
    const s = find(open)!;
    const panelBox = itemBox.querySelector<HTMLElement>('.shop-panel')!;
    if (panelBox.querySelector('.shop-confirm')) backToPick(s, panelBox);
    else fold(s);
  });

  on('click', async e => {
    const target = e.target as Element;
    const headButton = target.closest('.shop-head');
    const itemBox = target.closest<HTMLElement>('.shop-item');
    if (!itemBox) return;
    const s = find(itemBox.dataset.item);
    if (!s) return;
    if (headButton) {
      open = open === s.item ? null : s.item;
      draw();
      document.getElementById(`head-${s.item}`)?.focus();
      return;
    }
    const panelBox = itemBox.querySelector<HTMLElement>('.shop-panel')!;
    const step = panelBox.querySelector<HTMLElement>('.shop-step');
    if (target.closest('[data-review]') && step) {
      const value = readArg(s, panelBox);
      if (value === null || value === '') {
        panelBox.querySelector('.shop-why')!.textContent = argField(ctx, s.item, you(ctx, data, state()), null).missing ?? '';
        panelBox.querySelector<HTMLElement>(`#arg-${s.item}`)!.focus();
        return;
      }
      const now = ctx.now();
      const periods = periodsOf(panelBox, s);
      const effect = effectOf(ctx, s, value, w, currentTimed(s, w, requests, now), now, periods);
      if (effect.blocked || s.price * periods > free()) return;
      const select = panelBox.querySelector<HTMLSelectElement>(`select#arg-${s.item}`);
      const choice = select ? select.selectedOptions[0].textContent ?? '' : t('map {id}', { id: value });
      const kept = step.outerHTML;
      step.outerHTML = String(confirmStep(ctx, s, choice, effect.text, s.price * periods, periods, free()));
      panelBox.dataset.pick = kept;
      panelBox.dataset.value = String(value);
      panelBox.dataset.periods = String(periods);
      panelBox.querySelector<HTMLElement>('[data-confirm]')!.focus();
      announce(t('Check the price, then confirm.'));
      return;
    }
    if (target.closest('[data-cancel]')) { backToPick(s, panelBox); return; }
    const button = target.closest<HTMLButtonElement>('[data-confirm]');
    if (button && !button.disabled) {
      // Disabled while it's on its way, so a second press can't buy twice.
      button.disabled = true;
      const picked = panelBox.dataset.value!;
      const value = /^\d+$/.test(picked) && s.item !== 'title' ? Number(picked) : picked;
      const periods = Number(panelBox.dataset.periods) || 1;
      const sent = await sendRequest('shop.buy', { item: s.item, arg: value, periods });
      // Gone to another page meanwhile: the request is sent, and that page isn't this one's to draw over.
      if (!isCurrent()) return;
      if (sent.ok) {
        requests = [{ type: 'shop.buy', payload: { item: s.item, arg: value, periods }, status: 'pending', t: new Date().toISOString() }, ...requests];
        fold(s);
      } else {
        button.disabled = false;
        panelBox.querySelector('.shop-error')!.textContent = sent.message;
      }
    }
  });
}
