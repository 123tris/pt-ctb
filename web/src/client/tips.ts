// The site's two kinds of tap-to-explain, as assets/js/core/ui.js wires them: the in-joke badge rows (ui/page.ts
// funChips(), the tip under the row) and the tags that explain themselves (ui/players.ts tipTag(), one bubble beside
// the tag). One listener each for the whole document, started by the app.
//
// An old page standing in for a new one (client/page.ts oldPage) brings the old ui.js, which adds the same listeners
// and its own bubble the moment it's imported, and says so (globalThis.ptctbOldUi). From then on these stand down for
// good, and the old ones handle every page: two would open and shut each badge in one click.

import { html } from '../kernel/html.ts';

let tipPop: HTMLElement | null = null;
let tipOwner: HTMLElement | null = null;

/** Whether the old ui.js has been loaded (it then handles the tips); this module's own bubble goes when it has. */
function oldUi(): boolean {
  if (!(globalThis as { ptctbOldUi?: boolean }).ptctbOldUi) return false;
  if (tipPop) {
    closeTip();
    tipPop.remove(); // the old one has the same id
    tipPop = null;
  }
  return true;
}

function closeTip({ refocus = false } = {}): void {
  if (!tipOwner || !tipPop) return;
  tipOwner.setAttribute('aria-expanded', 'false');
  if (refocus) tipOwner.focus();
  tipOwner = null;
  tipPop.textContent = '';
  tipPop.classList.remove('open');
}

function openTip(button: HTMLElement): void {
  if (!tipPop) return;
  closeTip();
  tipOwner = button;
  button.setAttribute('aria-expanded', 'true');
  tipPop.textContent = button.dataset.tip ?? '';
  tipPop.classList.add('open');
  const at = button.getBoundingClientRect();
  const gutter = 16, gap = 6;
  const left = Math.max(gutter, Math.min(at.left, innerWidth - gutter - tipPop.offsetWidth));
  const below = at.bottom + gap + tipPop.offsetHeight <= innerHeight - gutter;
  tipPop.style.left = `${left}px`;
  tipPop.style.top = `${below ? at.bottom + gap : at.top - gap - tipPop.offsetHeight}px`;
}

/** A badge row's click: "+N more" shows the rest; a badge opens its tip under the row; any other click shuts them. */
function funChipClick(e: MouseEvent): void {
  const target = e.target as Element;
  const more = target.closest?.('.fun-more');
  if (more) {
    const row = more.parentElement!;
    row.querySelectorAll<HTMLElement>('.fun-chip[hidden]').forEach(b => { b.hidden = false; });
    more.remove();
    row.querySelector<HTMLElement>('.fun-chip')?.focus();
    return;
  }
  const chip = target.closest?.<HTMLElement>('.fun-chip');
  document.querySelectorAll('.fun-chips-wrap').forEach(wrap => {
    if (chip && wrap.contains(chip)) return;
    wrap.querySelectorAll('.fun-chip[aria-pressed="true"]').forEach(b => b.setAttribute('aria-pressed', 'false'));
    wrap.querySelector<HTMLElement>('.fun-tip')!.hidden = true;
  });
  if (!chip) return;
  const wrap = chip.closest('.fun-chips-wrap')!;
  const tip = wrap.querySelector<HTMLElement>('.fun-tip')!;
  const open = chip.getAttribute('aria-pressed') !== 'true';
  wrap.querySelectorAll('.fun-chip').forEach(b => b.setAttribute('aria-pressed', String(b === chip && open)));
  tip.hidden = !open;
  tip.innerHTML = open ? String(html`<b>${chip.textContent}</b> ${chip.dataset.tip}`) : '';
}

export function startTips(): void {
  // One bubble for every tipTag(): fixed to the viewport beside the tapped tag, so a scrolling table can't clip it, and
  // a live region from the start, so filling it is read out. It closes on Escape, any other click (on it too), losing
  // focus, or scroll.
  tipPop = document.createElement('div');
  tipPop.className = 'tip-pop';
  tipPop.id = 'tip-pop';
  tipPop.setAttribute('role', 'status');
  document.body.append(tipPop);

  document.addEventListener('click', e => {
    if (oldUi()) return;
    funChipClick(e);
    const button = (e.target as Element).closest?.<HTMLElement>('button[data-tip][aria-controls="tip-pop"]');
    if (button && button !== tipOwner) openTip(button);
    else closeTip();
  });
  document.addEventListener('keydown', e => { if (!oldUi() && e.key === 'Escape' && tipOwner) closeTip({ refocus: true }); });
  document.addEventListener('focusout', e => { if (!oldUi() && e.target === tipOwner && e.relatedTarget) closeTip(); });
  addEventListener('scroll', () => closeTip(), { passive: true, capture: true });
  addEventListener('resize', () => closeTip());
  addEventListener('routechange', () => closeTip());
}

/** Lets the old ui.js take over at once once a page has loaded it, rather than at the next click. */
export const checkOldUi = (): void => { oldUi(); };
