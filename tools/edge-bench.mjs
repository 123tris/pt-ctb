#!/usr/bin/env node
// What rendering a page at the edge would cost in CPU (web/edge/render.ts), measured the way the plan budgets it: in
// Node, three times over. Cloudflare's free plan ends a request past 10 ms of CPU; the budget for rendering is 7 ms of
// that, so a route's render (the measured cost × 3) has to fit in 7 ms before its "ssr" switch goes on.
//
//   node tools/edge-bench.mjs [export folder]     (default data/; needs packs: ptcatch-engine export --packs)
//
// Cold: a fresh Node process loading the bundled render code (as a new isolate compiles the Function) and drawing the
// page once. Warm: the same render again in a running process. Timed with performance.now(): the work is one thread
// with nothing to wait for, so its time is its CPU time (process.cpuUsage counts in 15.6 ms ticks on Windows).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.resolve(process.argv[2] ?? process.env.PTCATCH_DATA ?? path.join(root, 'data'));
const BUDGET_MS = 7;
const MARGIN = 3;

// The render code bundled as the Function would have it, Portuguese strings included.
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-bench-'));
const bundle = path.join(work, 'render.mjs');
const entry = `
  export { edgeCtx, renderRankings } from ${JSON.stringify(path.join(root, 'web/edge/render.ts'))};
  export { PT } from ${JSON.stringify(path.join(root, 'assets/js/core/pt.js'))};`;
await esbuild.build({ stdin: { contents: entry, resolveDir: root, loader: 'js' }, bundle: true, format: 'esm', platform: 'neutral', target: 'es2022', minify: true, outfile: bundle, logLevel: 'error' });

const core = path.join(dataDir, 'packs', 'core.ptcb');
if (!fs.existsSync(core)) throw new Error(`No packs in ${dataDir}: export with --packs first.`);

/** One page drawn in a new process: CPU ms to load the code, and to draw (reading the pack included). */
const child = `
  const t0 = performance.now();
  const m = await import(${JSON.stringify(pathToFileURL(bundle).href)});
  const t1 = performance.now() - t0;
  const bytes = (await import('node:fs')).readFileSync(${JSON.stringify(core)});
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const lang = process.argv[1];
  const t2 = performance.now();
  const ctx = m.edgeCtx(lang, lang === 'pt' ? m.PT : {}, 1793796270, 'https://data.ptcatch.com/');
  const html = m.renderRankings(ctx, buffer, process.argv[2], {});
  const t3 = performance.now() - t2;
  console.log(JSON.stringify({ load: t1, render: t3, bytes: html.length }));`;

const median = list => [...list].sort((a, b) => a - b)[list.length >> 1];
const rows = [];
for (const [board, lang] of [['converts', 'en'], ['converts', 'pt'], ['ranked', 'en'], ['loved', 'pt']]) {
  const cold = Array.from({ length: 7 }, () => JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', child, lang, board], { encoding: 'utf8' })));
  const m = await import(pathToFileURL(bundle).href);
  const bytes = fs.readFileSync(core);
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const warm = [];
  for (let i = 0; i < 30; i++) {
    const t = performance.now();
    m.renderRankings(m.edgeCtx(lang, lang === 'pt' ? m.PT : {}, 1793796270, ''), buffer, board, {});
    warm.push(performance.now() - t);
  }
  const coldRender = median(cold.map(c => c.render)), coldLoad = median(cold.map(c => c.load)), warmRender = median(warm.slice(5));
  rows.push({ page: `/rankings/${board} (${lang})`, html: `${(cold[0].bytes / 1024).toFixed(0)} KB`, load: coldLoad, cold: coldRender, warm: warmRender });
}
fs.rmSync(work, { recursive: true, force: true });

const f = n => n.toFixed(1).padStart(6);
console.log(`Edge render CPU, ms (median; budget ${BUDGET_MS} ms after × ${MARGIN}):`);
console.log('page                        html    load code  render cold  render warm   cold × 3   fits');
for (const r of rows) {
  const worst = (r.load + r.cold) * MARGIN;
  console.log(`${r.page.padEnd(27)} ${r.html.padStart(6)}  ${f(r.load)}      ${f(r.cold)}       ${f(r.warm)}     ${f(worst)}   ${worst <= BUDGET_MS ? 'yes' : 'no'}`);
}
