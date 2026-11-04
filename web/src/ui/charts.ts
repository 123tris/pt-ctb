// Small hand-rolled SVG charts, as assets/js/core/charts.js draws them. So far the line chart a profile's pp history
// uses; the bar chart will follow with the pages that show one. The hover readout (chartHover) is browser-only and
// still the old module's (client/legacy.ts): it reads the scales this chart writes into the SVG's data-*, on the same
// axes (W and PAD are the same numbers there).

import { raw, escape, type Safe } from '../kernel/html.ts';
import type { Ctx } from '../kernel/ctx.ts';

const W = 600;
const PAD = { l: 56, r: 16, t: 14, b: 28 }; // line charts

/** Rounds a step to 1/2/5 × 10^n so axis labels read nicely. */
function niceStep(range: number, ticks: number): number {
  const rough = range / ticks;
  const power = 10 ** Math.floor(Math.log10(rough || 1));
  return [1, 2, 5, 10].map(m => m * power).find(step => step >= rough) || power;
}

const YEAR = 365.25 * 86400;

/**
 * Where the x-axis gets labels: each new year for long ranges (at most ~7 labels), otherwise start, middle and end
 * (just start and end for a few days, where the middle would repeat a date).
 */
function timeTicks(ctx: Ctx, x0: number, x1: number): [number, string][] {
  const { fmt } = ctx;
  if (x1 - x0 < 7 * 86400) return [[x0, fmt.date(x0)], [x1, fmt.date(x1)]];
  if (x1 - x0 < 2 * YEAR) return [x0, (x0 + x1) / 2, x1].map(t => [t, fmt.date(t)]);
  const first = new Date(x0 * 1000).getUTCFullYear() + 1, last = new Date(x1 * 1000).getUTCFullYear();
  const every = Math.ceil((last - first + 1) / 7);
  const ticks: [number, string][] = [];
  for (let year = first; year <= last; year += every) ticks.push([Date.UTC(year, 0, 1) / 1000, String(year)]);
  return ticks;
}

/** A point: [x, y], with x as unix seconds; a null y is skipped. */
export type Point = readonly [number, number | null];

export interface Series {
  label: string;
  color: string;
  points: readonly Point[];
  /** Drawn dashed, with no end dot. */
  dashed?: boolean;
  /** Holds each value until the next point (for data that only has a point when something changed). */
  step?: boolean;
}

/** Lines over time. Points with a null y are skipped. */
export function lineChart(ctx: Ctx, series: readonly Series[], { height = 240, format = (v: number) => ctx.fmt.num(v), label }:
  { height?: number; format?: (v: number) => string; label?: string } = {}): Safe {
  const lines = series.map(s => ({ ...s, points: s.points.filter((p): p is [number, number] => p[1] != null) }));
  const all = lines.flatMap(s => s.points);
  if (all.length < 2) return raw('');
  const pad = PAD;
  const xs = all.map(p => p[0]), ys = all.map(p => p[1]);
  let [x0, x1] = [Math.min(...xs), Math.max(...xs)];
  if (x0 === x1) { x0 -= 86400; x1 += 86400; }
  let [y0, y1] = [Math.min(...ys), Math.max(...ys)];
  const step = niceStep((y1 - y0) || y1 || 1, 4);
  y0 = Math.floor(y0 / step) * step;
  y1 = Math.max(y0 + step, Math.ceil(y1 / step) * step);

  const x = (v: number) => pad.l + ((v - x0) / (x1 - x0)) * (W - pad.l - pad.r);
  const y = (v: number) => height - pad.b - ((v - y0) / (y1 - y0)) * (height - pad.t - pad.b);

  // The chart's text alternative: the caller's summary, or where each line starts and ends.
  const alt = label ?? lines.filter(s => s.points.length).map(s =>
    `${s.label}: ${ctx.t('{from} to {to}', { from: format(s.points[0][1]), to: format(s.points[s.points.length - 1][1]) })}`).join('; ');
  // The scales go along as data-*, so chartHover() can place its guide and dots on the same axes.
  let svg = `<svg class="chart" viewBox="0 0 ${W} ${height}" role="img" aria-label="${escape(alt)}" data-x0="${x0}" data-x1="${x1}" data-y0="${y0}" data-y1="${y1}">`;
  for (let v = y0; v <= y1 + 1e-9; v += step) {
    svg += `<line class="grid-line" x1="${pad.l}" x2="${W - pad.r}" y1="${y(v)}" y2="${y(v)}"/>`;
    svg += `<text x="${pad.l - 8}" y="${y(v) + 4}" text-anchor="end">${escape(format(v))}</text>`;
  }
  for (const [t, text] of timeTicks(ctx, x0, x1))
    svg += `<text x="${x(t)}" y="${height - 8}" text-anchor="middle">${escape(text)}</text>`;
  for (const s of lines) {
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

/** A bar of barChart(): its label under the axis, its value, and the hover text (default "label: value"). */
export interface Bar {
  label: string;
  value: number;
  title?: string;
}

/** Bars over equal slots, labelled every `every` bars (charts.js barChart): a short list, such as the hours of a day. */
export function barChart(ctx: Ctx, bars: readonly Bar[], { height = 200, color = 'var(--accent)', every = 1, label }: { height?: number; color?: string; every?: number; label?: string } = {}): Safe {
  if (!bars.length) return raw('');
  const pad = { l: 8, r: 8, t: 10, b: 24 };
  const max = Math.max(...bars.map(b => b.value), 1);
  const slot = (W - pad.l - pad.r) / bars.length;
  const width = Math.max(2, slot * 0.72);
  // The chart's text alternative: the caller's summary, or every bar's value (they're short lists: hours, months).
  const alt = label ?? bars.map(b => `${b.label}: ${ctx.fmt.num(b.value)}`).join(', ');
  let svg = `<svg class="chart" viewBox="0 0 ${W} ${height}" role="img" aria-label="${escape(alt)}">`;
  bars.forEach((b, i) => {
    const h = (b.value / max) * (height - pad.t - pad.b);
    const bx = pad.l + i * slot + (slot - width) / 2;
    svg += `<rect class="bar" x="${bx}" y="${height - pad.b - h}" width="${width}" height="${h}" rx="1" style="fill:${color}">` +
      `<title>${escape(b.title ?? `${b.label}: ${ctx.fmt.num(b.value)}`)}</title></rect>`;
    if (i % every === 0)
      svg += `<text x="${bx + width / 2}" y="${height - 8}" text-anchor="middle">${escape(b.label)}</text>`;
  });
  return raw(`${svg}</svg>`);
}
