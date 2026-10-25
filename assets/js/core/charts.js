// Small hand-rolled SVG charts (a line chart and a bar chart). No library: the site has two chart shapes.

import { raw, escape } from './html.js';
import * as fmt from './fmt.js';

const W = 600;

/** Rounds a step to 1/2/5 × 10^n so axis labels read nicely. */
function niceStep(range, ticks) {
  const rough = range / ticks;
  const power = 10 ** Math.floor(Math.log10(rough || 1));
  return [1, 2, 5, 10].map(m => m * power).find(step => step >= rough) || power;
}

/**
 * Lines over time. `series` = [{ label, color, points: [[x, y]] }] with x as unix seconds.
 */
export function lineChart(series, { height = 240, format = v => fmt.num(v), label } = {}) {
  const all = series.flatMap(s => s.points);
  if (all.length < 2) return raw('');
  const pad = { l: 56, r: 16, t: 14, b: 28 };
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
  let svg = `<svg class="chart" viewBox="0 0 ${W} ${height}" role="img" aria-label="${escape(alt)}">`;
  for (let v = y0; v <= y1 + 1e-9; v += step) {
    svg += `<line class="grid-line" x1="${pad.l}" x2="${W - pad.r}" y1="${y(v)}" y2="${y(v)}"/>`;
    svg += `<text x="${pad.l - 8}" y="${y(v) + 4}" text-anchor="end">${escape(format(v))}</text>`;
  }
  for (const t of [x0, (x0 + x1) / 2, x1])
    svg += `<text x="${x(t)}" y="${height - 8}" text-anchor="middle">${escape(fmt.date(t))}</text>`;
  for (const s of series) {
    if (!s.points.length) continue;
    const d = s.points.map((p, i) => `${i ? 'L' : 'M'}${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join('');
    svg += `<path class="line" d="${d}" stroke="${s.color}"/>`;
    const last = s.points[s.points.length - 1];
    svg += `<circle cx="${x(last[0])}" cy="${y(last[1])}" r="4" fill="${s.color}"><title>${escape(s.label)}: ${escape(format(last[1]))}</title></circle>`;
  }
  return raw(`${svg}</svg>`);
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
