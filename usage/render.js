// Small HTML helpers shared by the dashboard's views (usage/dashboard.js, usage/insights.js). Server-rendered, so
// every value goes through esc().

export const BAR = '#e85a78'; // the site's rose, one step darker so bars sit in the chart lightness band (checked with the dataviz validator)

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const num = n => Number(n ?? 0).toLocaleString('en-GB');
export const pct = (a, b) => (b ? `${Math.round((100 * a) / b)}%` : '–');

/** 75 → "1m 15s", 4000 → "1h 7m"; '–' for nothing. */
export function duration(secs) {
  if (!Number.isFinite(secs) || secs <= 0) return '–';
  const s = Math.round(secs);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}
/** Milliseconds as "840 ms" or "2.4 s". */
export const ms = v => (!Number.isFinite(v) ? '–' : v < 1000 ? `${Math.round(v)} ms` : `${(v / 1000).toFixed(1)} s`);
/** A unix time as "2026-10-27 14:05" (UTC). */
export const when = ts => (ts ? new Date(ts * 1000).toISOString().slice(0, 16).replace('T', ' ') : '–');

/** The value below which `p` (0–1) of the numbers fall; null for none. */
export function quantile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
}

export const meter = (n, max) => `<span class="meter"><span style="width:${max ? Math.max(1, Math.round((100 * n) / max)) : 0}%"></span></span>`;

export function table(head, rows, empty = 'Nothing yet.') {
  if (!rows.length) return `<p class="muted">${esc(empty)}</p>`;
  return `<div class="table-wrap"><table><thead><tr>${head.map(h => `<th${h.num ? ' class="num"' : ''}>${esc(h.label ?? h)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map(r => `<tr>${r.join('')}</tr>`).join('')}</tbody></table></div>`;
}
export const td = (v, cls = '') => `<td${cls ? ` class="${cls}"` : ''}>${v}</td>`;

/** Rows grouped by `key`, each group's items sorted by `n` and cut to `top`. */
export function topBy(rows, key, top = 3) {
  const groups = new Map();
  for (const r of rows) {
    if (!groups.has(r[key])) groups.set(r[key], []);
    groups.get(r[key]).push(r);
  }
  for (const list of groups.values()) list.sort((a, b) => b.n - a.n).splice(top);
  return groups;
}

export const CSS = `
:root { --bg:#1f191b; --surface:#2a2225; --line:#3d3236; --text:#f3ecee; --muted:#a09095; --accent:#ff6b89; }
* { box-sizing:border-box; }
body { margin:0; background:var(--bg); color:var(--text); font:15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
main { max-width:1080px; margin:0 auto; padding:24px 16px 64px; }
h1 { font-size:24px; margin:0 0 4px; } h2 { font-size:17px; margin:32px 0 8px; } p { margin:4px 0 8px; }
a { color:var(--accent); } .muted, .tick { color:var(--muted); fill:var(--muted); font-size:12px; }
.bar { display:flex; flex-wrap:wrap; gap:8px 16px; align-items:center; margin:12px 0 20px; }
.chips a { display:inline-block; padding:3px 10px; border:1px solid var(--line); border-radius:999px; text-decoration:none; color:var(--text); font-size:13px; }
.chips a[aria-current] { background:var(--accent); border-color:var(--accent); color:#1f191b; font-weight:600; }
.views { display:flex; gap:4px 20px; flex-wrap:wrap; border-bottom:1px solid var(--line); margin:16px 0 0; }
.views a { color:var(--muted); text-decoration:none; padding:6px 0; border-bottom:2px solid transparent; font-weight:500; }
.views a[aria-current] { color:var(--text); border-color:var(--accent); }
.tiles { display:grid; grid-template-columns:repeat(auto-fit, minmax(150px, 1fr)); gap:12px; }
.tile { background:var(--surface); border-radius:6px; padding:12px 14px; }
.tile b { display:block; font-size:26px; font-variant-numeric:tabular-nums; } .tile span { color:var(--muted); font-size:13px; }
.card { background:var(--surface); border-radius:6px; padding:14px; }
.chart { width:100%; height:auto; display:block; } .axis { stroke:var(--line); stroke-width:1; } .grid { stroke:var(--line); stroke-width:1; opacity:.5; }
.chart g:hover path { opacity:.8; }
.cols { display:grid; grid-template-columns:repeat(auto-fit, minmax(300px, 1fr)); gap:0 24px; }
.table-wrap { overflow-x:auto; } table { width:100%; border-collapse:collapse; font-size:14px; }
th { text-align:left; color:var(--muted); font-weight:500; font-size:12px; border-bottom:1px solid var(--line); padding:6px 8px; }
td { border-bottom:1px solid var(--line); padding:6px 8px; } .num { text-align:right; font-variant-numeric:tabular-nums; white-space:nowrap; }
.meter { display:inline-block; width:90px; height:6px; background:var(--line); border-radius:3px; vertical-align:middle; margin-right:6px; }
.cap { border:1px solid var(--accent); border-radius:6px; padding:8px 12px; }
.meter span { display:block; height:100%; background:${BAR}; border-radius:3px; }
.note { margin-top:40px; color:var(--muted); font-size:13px; } button { font:inherit; padding:4px 10px; border-radius:4px; border:1px solid var(--line); background:var(--surface); color:var(--text); cursor:pointer; }
.warn { border-left:3px solid var(--accent); padding-left:10px; }
.tag { display:inline-block; font-size:11px; padding:0 6px; border-radius:999px; border:1px solid var(--line); color:var(--muted); white-space:nowrap; }
.tag.ok { border-color:var(--accent); color:var(--accent); }
.small { font-size:12px; } .nowrap { white-space:nowrap; }
`;
