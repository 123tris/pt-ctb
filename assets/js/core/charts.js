// Small hand-rolled SVG charts (a line chart and a bar chart). No library: the site has two chart shapes.

import { raw, escape } from './html.js';
import * as fmt from './fmt.js';

const W = 600;
const PAD = { l: 56, r: 16, t: 14, b: 28 }; // line charts

/** Rounds a step to 1/2/5 × 10^n so axis labels read nicely. */
function niceStep(range, ticks) {
  const rough = range / ticks;
  const power = 10 ** Math.floor(Math.log10(rough || 1));
  return [1, 2, 5, 10].map(m => m * power).find(step => step >= rough) || power;
}

const YEAR = 365.25 * 86400;

/**
 * Where the x-axis gets labels: each new year for long ranges (at most ~7 labels), otherwise start, middle and end
 * (just start and end for a few days, where the middle would repeat a date).
 */
function timeTicks(x0, x1) {
  if (x1 - x0 < 7 * 86400) return [[x0, fmt.date(x0)], [x1, fmt.date(x1)]];
  if (x1 - x0 < 2 * YEAR) return [x0, (x0 + x1) / 2, x1].map(t => [t, fmt.date(t)]);
  const first = new Date(x0 * 1000).getUTCFullYear() + 1, last = new Date(x1 * 1000).getUTCFullYear();
  const every = Math.ceil((last - first + 1) / 7);
  const ticks = [];
  for (let year = first; year <= last; year += every) ticks.push([Date.UTC(year, 0, 1) / 1000, String(year)]);
  return ticks;
}

/**
 * Lines over time. `series` = [{ label, color, points: [[x, y]], dashed?, step? }] with x as unix seconds. Points with a
 * null y are skipped. `dashed` lines get no end dot; `step` lines hold each value until the next point (for data that
 * only has a point when something changed).
 */
export function lineChart(series, { height = 240, format = v => fmt.num(v), label } = {}) {
  series = series.map(s => ({ ...s, points: s.points.filter(p => p[1] != null) }));
  const all = series.flatMap(s => s.points);
  if (all.length < 2) return raw('');
  const pad = PAD;
  const xs = all.map(p => p[0]), ys = all.map(p => p[1]);
  let [x0, x1] = [Math.min(...xs), Math.max(...xs)];
  if (x0 === x1) { x0 -= 86400; x1 += 86400; }
  let [y0, y1] = [Math.min(...ys), Math.max(...ys)];
  const step = niceStep((y1 - y0) || y1 || 1, 4);
  y0 = Math.floor(y0 / step) * step;
  y1 = Math.max(y0 + step, Math.ceil(y1 / step) * step);

  const x = v => pad.l + ((v - x0) / (x1 - x0)) * (W - pad.l - pad.r);
  const y = v => height - pad.b - ((v - y0) / (y1 - y0)) * (height - pad.t - pad.b);

  // The chart's text alternative: the caller's summary, or where each line starts and ends.
  const alt = label ?? series.filter(s => s.points.length).map(s =>
    `${s.label}: ${format(s.points[0][1])} to ${format(s.points[s.points.length - 1][1])}`).join('; ');
  // The scales go along as data-*, so chartHover() can place its guide and dots on the same axes.
  let svg = `<svg class="chart" viewBox="0 0 ${W} ${height}" role="img" aria-label="${escape(alt)}" data-x0="${x0}" data-x1="${x1}" data-y0="${y0}" data-y1="${y1}">`;
  for (let v = y0; v <= y1 + 1e-9; v += step) {
    svg += `<line class="grid-line" x1="${pad.l}" x2="${W - pad.r}" y1="${y(v)}" y2="${y(v)}"/>`;
    svg += `<text x="${pad.l - 8}" y="${y(v) + 4}" text-anchor="end">${escape(format(v))}</text>`;
  }
  for (const [t, text] of timeTicks(x0, x1))
    svg += `<text x="${x(t)}" y="${height - 8}" text-anchor="middle">${escape(text)}</text>`;
  for (const s of series) {
    if (!s.points.length) continue;
    const d = s.points.map((p, i) => (i === 0 ? `M${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`
      : s.step ? `H${x(p[0]).toFixed(1)}V${y(p[1]).toFixed(1)}`
        : `L${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`)).join('');
    svg += `<path class="line${s.dashed ? ' line-dashed' : ''}" d="${d}" stroke="${s.color}"/>`;
    if (s.dashed) continue;
    const last = s.points[s.points.length - 1];
    svg += `<circle cx="${x(last[0])}" cy="${y(last[1])}" r="4" fill="${s.color}"><title>${escape(s.label)}: ${escape(format(last[1]))}</title></circle>`;
  }
  return raw(`${svg}</svg>`);
}

/**
 * A readout for a lineChart inside `wrap`: a guide line, a dot per value and a small tooltip for the row nearest the
 * pointer. `rows` = [{ t, title, items: [{ name, color, value, approx }] }], sorted by t. The mouse (hover), touch (tap
 * or drag sideways) and the keyboard (focus the chart, then ←/→, Home/End, Esc) all move it; `onKey(text)` gets the
 * row as a sentence on each key press, for a live region.
 */
export function chartHover(wrap, rows, { format = v => fmt.num(v), onKey } = {}) {
  const svg = wrap.querySelector('svg.chart');
  if (!svg || !rows.length) return;
  const [x0, x1, y0, y1] = ['x0', 'x1', 'y0', 'y1'].map(k => Number(svg.dataset[k]));
  const height = svg.viewBox.baseVal.height;
  const x = v => PAD.l + ((v - x0) / (x1 - x0)) * (W - PAD.l - PAD.r);
  const y = v => height - PAD.b - ((v - y0) / (y1 - y0)) * (height - PAD.t - PAD.b);
  const value = item => `${item.approx ? '≈ ' : ''}${format(item.value)}`;

  const layer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  layer.setAttribute('class', 'chart-hover');
  svg.append(layer);
  const tip = document.createElement('div');
  tip.className = 'chart-tip';
  tip.hidden = true;
  wrap.append(tip);
  svg.setAttribute('tabindex', '0');
  svg.setAttribute('aria-label', `${svg.getAttribute('aria-label')} Use the arrow keys to read the values over time.`);

  let current = -1;
  const show = i => {
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
    const px = box.left - outer.left + (cx / W) * box.width;
    const left = px + 12 + tip.offsetWidth > outer.width ? px - 12 - tip.offsetWidth : px + 12;
    tip.style.left = `${Math.max(0, left)}px`;
    tip.style.top = `${box.top - outer.top + 4}px`;
  };
  const hide = () => { current = -1; layer.innerHTML = ''; tip.hidden = true; };
  const nearest = clientX => {
    const box = svg.getBoundingClientRect();
    const t = x0 + ((((clientX - box.left) / box.width) * W - PAD.l) / (W - PAD.l - PAD.r)) * (x1 - x0);
    let best = 0;
    rows.forEach((row, i) => { if (Math.abs(row.t - t) < Math.abs(rows[best].t - t)) best = i; });
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
    onKey?.(`${row.title}: ${row.items.map(item => `${item.name} ${item.approx ? 'about ' : ''}${format(item.value)}`).join(', ')}.`);
  });
}

/** Vertical bars. `bars` = [{ label, value, title? }]. */
export function barChart(bars, { height = 200, color = 'var(--accent)', every = 1, label } = {}) {
  if (!bars.length) return raw('');
  const pad = { l: 8, r: 8, t: 10, b: 24 };
  const max = Math.max(...bars.map(b => b.value), 1);
  const slot = (W - pad.l - pad.r) / bars.length;
  const width = Math.max(2, slot * 0.72);
  // The chart's text alternative: the caller's summary, or every bar's value (they're short lists: hours, months).
  const alt = label ?? bars.map(b => `${b.label}: ${fmt.num(b.value)}`).join(', ');
  let svg = `<svg class="chart" viewBox="0 0 ${W} ${height}" role="img" aria-label="${escape(alt)}">`;
  bars.forEach((b, i) => {
    const h = (b.value / max) * (height - pad.t - pad.b);
    const bx = pad.l + i * slot + (slot - width) / 2;
    svg += `<rect class="bar" x="${bx}" y="${height - pad.b - h}" width="${width}" height="${h}" rx="1" style="fill:${color}">` +
      `<title>${escape(b.title ?? `${b.label}: ${fmt.num(b.value)}`)}</title></rect>`;
    if (i % every === 0)
      svg += `<text x="${bx + width / 2}" y="${height - 8}" text-anchor="middle">${escape(b.label)}</text>`;
  });
  return raw(`${svg}</svg>`);
}
