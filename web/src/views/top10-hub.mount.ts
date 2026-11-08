// /top10 in the browser: the countdown to the reveal ticks every second, and redraws the page when it gets there.

import { countdownParts } from '../ui/top10.ts';

export function startCountdowns(root: HTMLElement): void {
  const boxes = [...root.querySelectorAll<HTMLElement>('[data-cd]')];
  if (!boxes.length) return;
  const tick = () => {
    if (!root.contains(boxes[0])) { clearInterval(timer); return; }
    const now = Date.now() / 1000;
    for (const box of boxes) {
      const p = countdownParts(Number(box.dataset.cd), now);
      for (const key of ['d', 'h', 'm', 's'] as const) {
        const el = box.querySelector(`[data-cd-${key}]`);
        const text = String(p[key]).padStart(2, '0');
        if (el && el.textContent !== text) el.textContent = text;
      }
      if (p.left === 0) { clearInterval(timer); window.dispatchEvent(new Event('routechange')); return; }
    }
  };
  const timer = setInterval(tick, 1000);
}
