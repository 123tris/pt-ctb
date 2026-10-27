#!/usr/bin/env node
// Minimal static server for trying the site locally: node tools/serve.mjs [port] [--local-data] [--usage]
// The site reads its data from https://data.ptcatch.com; --local-data points it at this repo's data/ instead (after
// npm run export or publish.ps1 -NoUpload), by serving config.js with that one setting changed, and answers the hashed
// names the site asks for (data/players/1.<hash>.json) with the plain files (core/data-name.js).
// --usage turns the usage counts on for this address and runs their Functions (POST /api/hit, GET /stats with the
// password "local") over a SQLite file in the system's temp folder (tools/lib/d1-sqlite.mjs), to try them end to end.

import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { plainName } from '../assets/js/core/data-name.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.argv.slice(2).find(a => /^\d+$/.test(a))) || 8080;
const localData = process.argv.includes('--local-data');
const usage = process.argv.includes('--usage') ? await usageFunctions() : null;
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
};

async function usageFunctions() {
  const [{ sqliteD1 }, { recordHit }, { stats }] = await Promise.all([import('./lib/d1-sqlite.mjs'), import('../usage/store.js'), import('../usage/dashboard.js')]);
  const file = path.join(os.tmpdir(), 'ptctb-usage-local.sqlite');
  console.log(`Usage counts in ${file}; the dashboard is /stats (any user name, password "local").`);
  return { env: { USAGE: sqliteD1(file), STATS_PASSWORD: 'local' }, recordHit, stats };
}

/** Runs a usage Function for a Node request and writes its Response back. */
async function serveUsage(req, res, url, handler) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const request = new Request(url, { method: req.method, headers: req.headers, body: req.method === 'POST' ? Buffer.concat(chunks) : undefined });
  const response = await handler(Object.assign(request, { cf: { country: 'PT' } }), usage.env).catch(e => new Response(String(e?.stack ?? e), { status: 500 }));
  res.writeHead(response.status, Object.fromEntries(response.headers)).end(Buffer.from(await response.arrayBuffer()));
}

http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
  if (usage && url.pathname === '/api/hit' && req.method === 'POST') return serveUsage(req, res, url, usage.recordHit);
  if (usage && url.pathname === '/stats') return serveUsage(req, res, url, usage.stats);
  let file = path.join(root, decodeURIComponent(url.pathname));
  if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (localData && !fs.existsSync(file) && url.pathname.startsWith('/data/')) file = plainName(file);
  if (!fs.existsSync(file)) { res.writeHead(404).end('Not found'); return; }
  if ((localData || usage) && url.pathname === '/assets/js/config.js') {
    const local = { ...(localData && { data: 'data/' }), ...(usage && { home: url.origin }) };
    res.writeHead(200, { 'Content-Type': TYPES['.js'], 'Cache-Control': 'no-cache' });
    res.end(`${fs.readFileSync(file, 'utf8')}\nObject.assign(CONFIG, ${JSON.stringify(local)}); // npm run serve -- ${process.argv.slice(2).join(' ')}\n`);
    return;
  }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
}).listen(port, () => console.log(`PT-CTB at http://localhost:${port}/${localData ? ' (data from data/)' : ''}${usage ? ' (usage counts on)' : ''}`));
