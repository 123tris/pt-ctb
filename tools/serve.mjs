#!/usr/bin/env node
// Minimal static server for trying the site locally: node tools/serve.mjs [port] [--local-data]
// The site reads its data from https://data.ptcatch.com; --local-data points it at this repo's data/ instead (after
// npm run export or publish.ps1 -NoUpload), by serving config.js with that one setting changed, and answers the hashed
// names the site asks for (data/players/1.<hash>.json) with the plain files (core/data-name.js).
//
// Design on/off (review aid, localhost only): index.html gets a "Design: new / old" button (tools/design-switch.js,
// never deployed). "Old" sets a cookie, and then every site file the design pass changed (DESIGN_PASS) is served as it
// was before it, straight from git, so the old CSS, markup and JS come back together. Drop this once it's reviewed.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { plainName } from '../assets/js/core/data-name.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.argv.slice(2).find(a => /^\d+$/.test(a))) || 8080;
const localData = process.argv.includes('--local-data');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
};

const DESIGN_PASS = { before: 'b1d9a4e', after: '693476b' };
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: 1 << 26 });
/** '/assets/css/site.css' → its text before the design pass, for each site file the pass changed. */
const oldDesign = (() => {
  try {
    const files = git('diff', '--name-only', DESIGN_PASS.before, DESIGN_PASS.after, '--', 'index.html', '404.html', 'assets').split('\n').filter(Boolean);
    return new Map(files.map(f => [`/${f}`, git('show', `${DESIGN_PASS.before}:${f}`)]));
  } catch (e) {
    console.warn(`Design switch off: couldn't read ${DESIGN_PASS.before} from git (${e.message.split('\n')[0]})`);
    return null;
  }
})();
const isLocal = req => { try { return LOCAL_HOSTS.has(new URL(`http://${req.headers.host}`).hostname); } catch { return false; } };
const wantsOld = req => /(?:^|;\s*)ptcatch-design=old(?:;|$)/.test(req.headers.cookie ?? '');

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let file = path.join(root, decodeURIComponent(url.pathname));
  if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (localData && !fs.existsSync(file) && url.pathname.startsWith('/data/')) file = plainName(file);
  if (!fs.existsSync(file)) { res.writeHead(404).end('Not found'); return; }
  const page = '/' + path.relative(root, file).split(path.sep).join('/');
  const old = oldDesign && isLocal(req) && wantsOld(req) && oldDesign.has(page);
  if (old || (oldDesign && isLocal(req) && page === '/index.html')) {
    let text = old ? oldDesign.get(page) : fs.readFileSync(file, 'utf8');
    if (page === '/index.html') text = text.replace('</body>', '<script type="module" src="tools/design-switch.js"></script>\n</body>');
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)], 'Cache-Control': 'no-cache' });
    res.end(text);
    return;
  }
  if (localData && url.pathname === '/assets/js/config.js') {
    res.writeHead(200, { 'Content-Type': TYPES['.js'], 'Cache-Control': 'no-cache' });
    res.end(`${fs.readFileSync(file, 'utf8')}\nObject.assign(CONFIG, { data: 'data/' }); // npm run serve -- --local-data\n`);
    return;
  }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
}).listen(port, () => console.log(`PT-CTB at http://localhost:${port}/${localData ? ' (data from data/)' : ''}`));
