#!/usr/bin/env node
// Minimal static server for trying the site locally: node tools/serve.mjs [port] [--local-data]
// The site reads its data from https://data.ptcatch.com; --local-data points it at this repo's data/ instead (after
// npm run export or publish.ps1 -NoUpload), by serving config.js with that one setting changed, and answers the hashed
// names the site asks for (data/players/1.<hash>.json) with the plain files (core/data-name.js).
//
// Review aids, for requests to localhost only (tools/local-review.js, never deployed): "This is me" starts as Tris in a
// browser that never chose, and a "Design: new / old" button sits in the corner. "Old" sets a cookie, and then every site
// file this branch has changed since it last took in dev is served as dev had it, straight from git, so the old CSS,
// markup and JS come back together. Drop this once the design pass is merged.

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

const DESIGN_BASE = 'dev';
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: 1 << 26, stdio: ['ignore', 'pipe', 'ignore'] });
const isLocal = req => { try { return LOCAL_HOSTS.has(new URL(`http://${req.headers.host}`).hostname); } catch { return false; } };
const wantsOld = req => /(?:^|;\s*)ptcatch-design=old(?:;|$)/.test(req.headers.cookie ?? '');

/** Where this branch last took in dev, and the site files that differ from it (uncommitted edits too). */
let before = null;
function readBefore() {
  try {
    const base = git('merge-base', 'HEAD', DESIGN_BASE).trim();
    const files = git('diff', '--name-only', base, '--', 'index.html', '404.html', 'assets').split('\n').filter(Boolean);
    before = { base, files: new Set(files.map(f => `/${f}`)) };
  } catch {
    if (before !== false) console.warn(`Design switch off: no merge base with ${DESIGN_BASE} in git.`);
    before = false;
  }
}
const oldTexts = new Map();
/** A file's text as dev had it, or null if it didn't exist there. */
function oldText(page) {
  const key = `${before.base}:${page.slice(1)}`;
  if (!oldTexts.has(key)) { try { oldTexts.set(key, git('show', key)); } catch { oldTexts.set(key, null); } }
  return oldTexts.get(key);
}

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let file = path.join(root, decodeURIComponent(url.pathname));
  if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
  const local = isLocal(req);
  const page = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
  if (local && page === '/index.html') readBefore(); // on every page load, so new edits and commits count
  const old = local && wantsOld(req) && before?.files.has(page) ? oldText(page) : null;
  if (old !== null || (local && page === '/index.html')) {
    let text = old ?? fs.readFileSync(path.join(root, page), 'utf8');
    if (page === '/index.html') text = text.replace('</head>', '<script src="tools/local-review.js"></script>\n</head>');
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(page)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(text);
    return;
  }
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
