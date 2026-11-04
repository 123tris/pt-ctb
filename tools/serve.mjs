#!/usr/bin/env node
// Minimal static server for trying the site locally: node tools/serve.mjs [port] [--local-data [folder]] [--usage]
// The site reads its data from https://data.ptcatch.com; --local-data points it at this repo's data/ instead (after
// npm run export or publish.ps1 -NoUpload), or at another export's folder (ptcatch-engine export --out <folder>
// --packs), by serving config.js with that one setting changed, and answers the hashed names the site asks for
// (data/players/1.<hash>.json) with the plain files (core/data-name.js).
// The new web client (web/src) is bundled in memory as assets/web/ is asked for (tools/web-build.mjs), so an edit shows
// on the next reload; its pages get their slice of packs.json and meta.json, as functions/[[path]].js sends them
// (web/edge/inline.ts).
// --usage turns the usage counts on for this address and runs their Functions (POST /api/hit, GET /stats with the
// password "local") over a SQLite file in the system's temp folder (tools/lib/d1-sqlite.mjs), to try them end to end.
// --economy does the same for Bananas (the daily game, wallet and admin requests, the bot's inbox: economy/api.js) and
// turns "Sign in with osu!" on, with a local stand-in for osu! that asks which player to be (the admins first). With
// --local-data and no admin.json of its own, the data gets tools/admin-sample.json as admin.json, so #/admin has
// settings and a log to show.
//
// Review aids, for requests to localhost only (tools/local-review.js, never deployed): a "Design: new / old" button
// sits in the corner. "Old" sets a cookie, and then every site file this branch has changed since it last took in dev is served as dev had it, straight from git, so the old CSS,
// markup and JS come back together. Drop this once the design pass is merged.

import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { plainName } from '../assets/js/core/data-name.js';
import { describe, pageFor } from '../embed/embed.js';
import { CONFIG } from '../assets/js/config.js';
import { inlineData, manifestsFor } from '../web/edge/inline.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.argv.slice(2).find(a => /^\d+$/.test(a))) || 8080;
const localData = process.argv.includes('--local-data');
/** The export --local-data serves at /data/: the folder named after it, or this repo's data/. */
const dataArg = process.argv[process.argv.indexOf('--local-data') + 1];
const dataDir = localData && dataArg && !dataArg.startsWith('--') && !/^\d+$/.test(dataArg) ? path.resolve(dataArg) : path.join(root, 'data');
const usage = process.argv.includes('--usage') ? await usageFunctions() : null;
const economy = process.argv.includes('--economy') ? await economyFunctions() : null;

/**
 * --economy: the Bananas Functions (economy/api.js) over a SQLite file, and a stand-in for "Sign in with osu!" that asks
 * which player to be instead of asking osu! (localhost only; it makes a real session token with the local secret).
 */
async function economyFunctions() {
  const [{ sqliteD1 }, api, { makeSession }, { makeProof }, { recordSignin }] = await Promise.all([
    import('./lib/d1-sqlite.mjs'), import('../economy/api.js'), import('../signin/session.js'), import('../signin/proof.js'), import('../economy/store.js'),
  ]);
  const file = path.join(os.tmpdir(), 'ptctb-economy-local.sqlite');
  console.log(`Bananas Functions over ${file}: DAILY_SEED, ECONOMY_INBOX_KEY and the session secret are all "local".`);
  const env = { ECONOMY: sqliteD1(file), OSU_CLIENT_SECRET: 'local', DAILY_SEED: 'local', ECONOMY_INBOX_KEY: 'local' };
  const routes = {
    'GET /api/daily': api.daily, 'POST /api/daily/guess': api.dailyGuess, 'GET /api/daily/cover': api.dailyCover,
    'POST /api/wallet/request': api.walletRequest, 'GET /api/wallet/requests': api.walletRequests,
    'GET /api/economy/inbox': api.economyInbox, 'POST /api/economy/ack': api.economyAck,
    'POST /api/admin/request': api.adminRequest, 'GET /api/admin/requests': api.adminRequests,
  };
  /** /auth/login: a form picking the player; then back to the site the way /auth/callback sends it. */
  async function login(request) {
    const url = new URL(request.url);
    const state = url.searchParams.get('state') ?? '';
    const as = Number(url.searchParams.get('as'));
    const all = JSON.parse(fs.readFileSync(path.join(dataDir, 'players.json'), 'utf8'));
    const admins = api.adminIds(env);
    const names = [...all.filter(x => admins.includes(x.id)), ...all.filter(x => !admins.includes(x.id))];
    const p = names.find(x => x.id === as);
    if (!p) {
      const page = `<!doctype html><meta charset="utf-8"><title>Local sign-in</title><body style="font:16px system-ui;background:#1f191b;color:#f4ebee;padding:2rem">
        <h1>Local sign-in (npm run serve -- --economy)</h1><p>Stands in for osu!: pick who to be. Only on localhost. The first ${admins.length} are admins (#/admin).</p>
        <form><input type="hidden" name="state" value="${state.replace(/"/g, '')}"><select name="as">${names.map(x => `<option value="${x.id}">${x.name.replace(/</g, '')} (${x.id})</option>`).join('')}</select>
        <button>Sign in</button></form>`;
      return new Response(page, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }
    await recordSignin(env.ECONOMY, p.id);
    const answer = new URLSearchParams({ id: String(p.id), name: p.name, state, proof: await makeProof('local', p.id), token: await makeSession('local', p.id) });
    return new Response(null, { status: 302, headers: { Location: `/#signin?${answer}` } });
  }
  return { env, routes, login };
}

async function usageFunctions() {
  const [{ sqliteD1 }, { recordHit }, { stats }] = await Promise.all([import('./lib/d1-sqlite.mjs'), import('../usage/store.js'), import('../usage/dashboard.js')]);
  const file = path.join(os.tmpdir(), 'ptctb-usage-local.sqlite');
  console.log(`Usage counts in ${file}; the dashboard is /stats (any user name, password "local").`);
  return { env: { USAGE: sqliteD1(file), STATS_PASSWORD: 'local' }, recordHit, stats };
}

// The sample admin.json's stand-in hash (10 characters, like a real one: core/data-name.js).
const SAMPLE_HASH = 'adminLocal';

/** meta.json, listing the sample admin.json when the export made none (--economy --local-data). */
function serveMetaWithAdmin(res, file) {
  const meta = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!meta.files?.['admin.json']) meta.files = { ...meta.files, 'admin.json': SAMPLE_HASH };
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' });
  res.end(JSON.stringify(meta));
}

/** Runs a usage Function for a Node request and writes its Response back. */
const serveUsage = (req, res, url, handler) => serveFunction(req, res, url, request => handler(request, usage.env));

/** Runs a Function (request → Response) for a Node request and writes its Response back. */
async function serveFunction(req, res, url, handler) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const request = new Request(url, { method: req.method, headers: req.headers, body: req.method === 'POST' ? Buffer.concat(chunks) : undefined });
  const response = await handler(Object.assign(request, { cf: { country: 'PT' } })).catch(e => new Response(String(e?.stack ?? e), { status: 500 }));
  res.writeHead(response.status, Object.fromEntries(response.headers)).end(Buffer.from(await response.arrayBuffer()));
}
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

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
  if (usage && url.pathname === '/api/hit' && req.method === 'POST') return serveUsage(req, res, url, usage.recordHit);
  if (usage && url.pathname === '/stats') return serveUsage(req, res, url, usage.stats);
  if (economy && isLocal(req)) {
    const route = economy.routes[`${req.method} ${url.pathname}`];
    // The daily game's pool comes from this server's data (with --local-data) or R2's.
    const env = { ...economy.env, DATA_URL: localData ? `${url.origin}/data/` : '' };
    if (route) return serveFunction(req, res, url, request => route(request, env));
    if (url.pathname === '/auth/login') return serveFunction(req, res, url, economy.login);
    // With `home` set the site sends its usage counts; without --usage there's nowhere to keep them.
    if (!usage && url.pathname === '/api/hit') { res.writeHead(204).end(); return; }
  }
  if (url.pathname.startsWith('/assets/web/')) return serveWeb(res, path.basename(url.pathname));
  const dataPath = localData && url.pathname.startsWith('/data/');
  let file = dataPath ? path.join(dataDir, decodeURIComponent(url.pathname.slice('/data/'.length))) : path.join(root, decodeURIComponent(url.pathname));
  if (!file.startsWith(dataPath ? dataDir : root)) { res.writeHead(403).end(); return; }
  const local = isLocal(req);
  // A page address (/player/123) gets index.html with its link preview, as functions/[[path]].js sends it.
  const isPage = url.pathname === '/' || (!path.extname(url.pathname) && describe(url.pathname) !== null);
  const page = isPage ? '/index.html' : decodeURIComponent(url.pathname);
  if (local && page === '/index.html') readBefore(); // on every page load, so new edits and commits count
  const old = local && wantsOld(req) && before?.files.has(page) ? oldText(page) : null;
  if (old !== null || page === '/index.html') {
    let text = old ?? fs.readFileSync(path.join(root, page), 'utf8');
    if (page === '/index.html') {
      const base = localData ? `${url.origin}/data/` : CONFIG.data;
      const fetchJson = u => fetch(u).then(r => (r.ok ? r.json() : Promise.reject(new Error(`${r.status} ${u}`))));
      text = await pageFor(text, url.href, { ua: req.headers['user-agent'], base, fetchJson });
      const need = manifestsFor(url.pathname);
      const manifest = name => (localData
        ? Promise.resolve().then(() => JSON.parse(fs.readFileSync(path.join(dataDir, name), 'utf8')))
        : fetchJson(`${base}${name}`)).catch(() => null);
      const [packs, meta] = await Promise.all([need.packs ? manifest('packs.json') : null, need.meta ? manifest('meta.json') : null]);
      text = inlineData(text, url.pathname, { packs, meta }, base);
      if (local) text = text.replace('</head>', '<script src="tools/local-review.js"></script>\n</head>');
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(page)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(text);
    return;
  }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (economy && localData && url.pathname === '/data/meta.json') return serveMetaWithAdmin(res, file);
  if (economy && localData && url.pathname === `/data/admin.${SAMPLE_HASH}.json` && !fs.existsSync(path.join(dataDir, 'admin.json'))) file = path.join(root, 'tools', 'admin-sample.json');
  if (dataPath && !fs.existsSync(file)) file = plainName(file);
  if (!fs.existsSync(file)) { res.writeHead(404).end('Not found'); return; }
  if ((localData || usage || economy) && url.pathname === '/assets/js/config.js') {
    const local = { ...(localData && { data: 'data/' }), ...((usage || economy) && { home: url.origin }), ...(economy && { signIn: true }) };
    res.writeHead(200, { 'Content-Type': TYPES['.js'], 'Cache-Control': 'no-cache' });
    res.end(`${fs.readFileSync(file, 'utf8')}\nObject.assign(CONFIG, ${JSON.stringify(local)}); // npm run serve -- ${process.argv.slice(2).join(' ')}\n`);
    return;
  }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
}).listen(port, () => console.log(`PT-CTB at http://localhost:${port}/${localData ? ` (data from ${path.relative(root, dataDir) || '.'})` : ''}${usage ? ' (usage counts on)' : ''}`));

/** The new web client's bundle, rebuilt in memory when asked for (esbuild only rebuilds what changed). */
let web = null;
async function serveWeb(res, name) {
  try {
    web ??= import('./web-build.mjs').then(m => m.webContext({ outdir: path.join(root, 'assets', 'web') }));
    const { outputFiles } = await (await web).rebuild();
    const out = outputFiles.find(f => path.basename(f.path) === name);
    if (!out) { res.writeHead(404).end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': TYPES['.js'], 'Cache-Control': 'no-cache' });
    res.end(out.contents);
  } catch (e) {
    // No esbuild (npm install first) or a build error: the old pages stand in (assets/js/app.js).
    res.writeHead(500, { 'Content-Type': TYPES['.txt'] }).end(String(e?.message ?? e));
  }
}
