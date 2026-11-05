// A line chart's hover readout, as assets/js/core/charts.js chartHover() has it, over a chart ui/charts.ts lineChart()
// drew: it reads the scales the chart writes into the SVG's data-*, on the same axes (W and PAD).

import { escape } from '../kernel/html.ts';
import type { Ctx } from '../kernel/ctx.ts';
import { W, PAD } from '../ui/charts.ts';

/** A row of the readout: a time and each line's value then. */
export interface HoverRow {
  t: number;
  title: string;
  items: readonly { name: string; color: string; value: number; approx?: boolean }[];
}

/**
 * A guide line, a dot per value and a small tooltip for the row nearest the pointer, inside `wrap`. `rows` are sorted
 * by t. The mouse (hover), touch (tap or drag sideways) and the keyboard (focus the chart, then ←/→, Home/End, Esc)
 * all move it; `onKey(text)` gets the row as a sentence on each key press, for a live region.
 */
export function chartHover(ctx: Ctx, wrap: HTMLElement, rows: readonly HoverRow[],
  { format = (v: number) => ctx.fmt.num(v), onKey }: { format?: (v: number) => string; onKey?: (text: string) => void } = {}): void {
  const { t } = ctx;
  const svg = wrap.querySelector<SVGSVGElement>('svg.chart');
  if (!svg || !rows.length) return;
  const [x0, x1, y0, y1] = ['x0', 'x1', 'y0', 'y1'].map(k => Number(svg.dataset[k]));
  const height = svg.viewBox.baseVal.height;
  const x = (v: number) => PAD.l + ((v - x0) / (x1 - x0)) * (W - PAD.l - PAD.r);
  const y = (v: number) => height - PAD.b - ((v - y0) / (y1 - y0)) * (height - PAD.t - PAD.b);
  const value = (item: HoverRow['items'][number]) => `${item.approx ? '≈ ' : ''}${format(item.value)}`;

  const layer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  layer.setAttribute('class', 'chart-hover');
  svg.append(layer);
  const tip = document.createElement('div');
  tip.className = 'chart-tip';
  tip.hidden = true;
  wrap.append(tip);
  svg.setAttribute('tabindex', '0');
  svg.setAttribute('aria-label', `${svg.getAttribute('aria-label')} ${t('Use the arrow keys to read the values over time.')}`);

  let current = -1;
  const show = (i: number) => {
    current = i;
    const row = rows[i], cx = x(row.t).toFixed(1);
    layer.innerHTML = `<line class="chart-guide" x1="${cx}" x2="${cx}" y1="${PAD.t}" y2="${height - PAD.b}"/>`
      + row.items.map(item => `<circle cx="${cx}" cy="${y(item.value).toFixed(1)}" r="3.5" fill="${escape(item.color)}"/>`).join('');
    tip.innerHTML = `<b>${escape(row.title)}</b>${row.items.map(item =>
      `<span><i style="background:${escape(item.color)}"></i>${escape(item.name)} <b>${escape(value(item))}</b></span>`).join('')}`
      + (row.items.some(item => item.approx) ? '<small>≈ approximate (reconstructed)</small>' : '');
    tip.hidden = false;
    // Beside the guide line, flipping to its left side near the right edge.
    const box = svg.getBoundingClientRect(), outer = wrap.getBoundingClientRect();
    const px = box.left - outer.left + (Number(cx) / W) * box.width;
    const left = px + 12 + tip.offsetWidth > outer.width ? px - 12 - tip.offsetWidth : px + 12;
    tip.style.left = `${Math.max(0, left)}px`;
    tip.style.top = `${box.top - outer.top + 4}px`;
  };
  const hide = () => { current = -1; layer.innerHTML = ''; tip.hidden = true; };
  const nearest = (clientX: number) => {
    const box = svg.getBoundingClientRect();
    const at = x0 + ((((clientX - box.left) / box.width) * W - PAD.l) / (W - PAD.l - PAD.r)) * (x1 - x0);
    let best = 0;
    rows.forEach((row, i) => { if (Math.abs(row.t - at) < Math.abs(rows[best].t - at)) best = i; });
    return best;
  };

  svg.addEventListener('pointermove', e => show(nearest(e.clientX)));
  svg.addEventListener('pointerdown', e => show(nearest(e.clientX)));
  svg.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') hide(); });
  svg.addEventListener('blur', hide);
  svg.addEventListener('keydown', e => {
    if (e.key === 'Escape') { hide(); return; }
    const last = rows.length - 1;
    const i = e.key === 'ArrowRight' ? (current < 0 ? 0 : Math.min(last, current + 1))
      : e.key === 'ArrowLeft' ? (current < 0 ? last : Math.max(0, current - 1))
        : e.key === 'Home' ? 0 : e.key === 'End' ? last : null;
    if (i === null) return;
    e.preventDefault();
    show(i);
    const row = rows[i];
    onKey?.(`${row.title}: ${row.items.map(item => `${item.name} ${item.approx ? `${t('about')} ` : ''}${format(item.value)}`).join(', ')}.`);
  });
}
