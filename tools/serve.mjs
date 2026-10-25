#!/usr/bin/env node
// Minimal static server for trying the site locally: node tools/serve.mjs [port] [--local-data]
// The site reads its data from https://data.ptcatch.com; --local-data points it at this repo's data/ instead (after
// npm run export or publish.ps1 -NoUpload), by serving config.js with that one setting changed, and answers the hashed
// names the site asks for (data/players/1.<hash>.json) with the plain files (core/data-name.js).

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { plainName } from '../assets/js/core/data-name.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.argv.slice(2).find(a => /^\d+$/.test(a))) || 8080;
const localData = process.argv.includes('--local-data');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
};

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let file = path.join(root, decodeURIComponent(url.pathname));
  if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (localData && !fs.existsSync(file) && url.pathname.startsWith('/data/')) file = plainName(file);
  if (!fs.existsSync(file)) { res.writeHead(404).end('Not found'); return; }
  if (localData && url.pathname === '/assets/js/config.js') {
    res.writeHead(200, { 'Content-Type': TYPES['.js'], 'Cache-Control': 'no-cache' });
    res.end(`${fs.readFileSync(file, 'utf8')}\nObject.assign(CONFIG, { data: 'data/' }); // npm run serve -- --local-data\n`);
    return;
  }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
}).listen(port, () => console.log(`PT-CTB at http://localhost:${port}/${localData ? ' (data from data/)' : ''}`));
