#!/usr/bin/env node
// Copies the public part of the repo into dist/ for Cloudflare Pages (build command: node tools/build-site.mjs,
// output directory: dist). Only what's listed in PUBLIC is published, so tools/, state/, scripts and docs never are;
// functions/ (the sign-in endpoints) stays at the repo root, where Pages looks for it. No dependencies.
// PUBLIC lists whole folders, so new pages, modules, images or fonts under assets/ are picked up by themselves; only
// a new top-level folder the site loads at runtime has to be added here.
//
// Each branch gets its own settings, layered over assets/js/config.js in dist/ only (the repo copy stays as GitHub Pages
// and `npm run serve` use it). Cloudflare sets CF_PAGES_BRANCH; set it by hand to try a branch locally:
//   main → the release site (CONFIG.production), with the data files and CORS for the development site to read them;
//   dev  → the development site (CONFIG.development): DEV marker, noindex, and no data files of its own, since it
//          reads the release site's, which are always current (publish.ps1 only ever commits data to main).
// SIGN_IN=1 (a Pages build variable, set per environment) turns "Sign in with osu!" on for that build.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIG } from '../assets/js/config.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const PUBLIC = ['index.html', '404.html', '_headers', 'assets', 'data'];
// Cloudflare Pages limits (free plan): 20,000 files per deployment, 25 MiB per file.
const MAX_FILES = 20000;
const MAX_FILE_BYTES = 25 * 1024 * 1024;

const branch = process.env.CF_PAGES_BRANCH || '';
const release = branch === 'main';
// No branch: a plain local build, left exactly as the repo has it. Any other branch is a development build; only dev
// has a domain of its own (CONFIG.development), the rest live on their *.pages.dev preview address.
const settings = !branch ? null : release
  ? { home: CONFIG.production }
  : { home: branch === 'dev' ? CONFIG.development : '', env: 'dev', data: `${CONFIG.production}/data/` };
if (settings) settings.signIn = process.env.SIGN_IN === '1';

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist);
for (const entry of PUBLIC) {
  if (entry === 'data' && settings?.data) continue; // development builds read the release site's data
  fs.cpSync(path.join(root, entry), path.join(dist, entry), { recursive: true });
}

const edit = (file, change) => {
  const target = path.join(dist, file);
  const before = fs.readFileSync(target, 'utf8');
  const after = change(before);
  if (after === before) throw new Error(`build-site: expected to change ${file}, but nothing matched.`);
  fs.writeFileSync(target, after);
};

if (settings) {
  edit('assets/js/config.js', s => `${s}\n// Set by tools/build-site.mjs for the "${branch}" branch.\nObject.assign(CONFIG, ${JSON.stringify(settings)});\n`);
  if (release) {
    // Let the development site read the release site's data files.
    edit('_headers', s => `${s}\n/data/*\n  Access-Control-Allow-Origin: ${CONFIG.development}\n`);
  } else {
    edit('index.html', s => s.replace('<html lang="en">', `<html lang="en" data-env="${settings.env}">`));
    edit('_headers', s => s.replace("connect-src 'self'", `connect-src 'self' ${CONFIG.production}`));
    edit('_headers', s => `${s}\n# A development build: keep it out of search engines.\n/*\n  X-Robots-Tag: noindex\n`);
  }
}

// Every JS and CSS address gets ?v=<hash of all the code>, in index.html and in every import. The custom domain's
// zone caches .js/.css in browsers for 4 hours whatever _headers says, and a stale module next to fresh ones breaks
// the page ("does not provide an export named …"). With the version in the address, a deploy that changes any code
// changes every address at once, and a data-only deploy changes none, so nothing is downloaded again for nothing.
const codeFiles = [];
const collect = dir => {
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) collect(p);
    else if (/\.(js|css)$/.test(d.name)) codeFiles.push(p);
  }
};
collect(path.join(dist, 'assets'));
codeFiles.sort();
const code = crypto.createHash('sha256');
for (const file of codeFiles) code.update(path.relative(dist, file)).update(fs.readFileSync(file));
const version = code.digest('hex').slice(0, 10);
const IMPORT = /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])(\.{1,2}\/[^'"?]+\.js)\2/g;
for (const file of codeFiles.filter(f => f.endsWith('.js'))) {
  const source = fs.readFileSync(file, 'utf8');
  const versioned = source.replace(IMPORT, `$1$2$3?v=${version}$2`);
  if (versioned !== source) fs.writeFileSync(file, versioned);
}
edit('index.html', s => s.replace(/((?:src|href)=")(assets\/(?:js|css)\/[^"?]+\.(?:js|css))"/g, `$1$2?v=${version}"`));

// The CSP in _headers allows inline scripts only by hash: fill in the hashes of the ones the pages have right now.
const sha256 = s => `'sha256-${crypto.createHash('sha256').update(s, 'utf8').digest('base64')}'`;
const inline = { scripts: [], handlers: [] };
for (const page of ['index.html', '404.html']) {
  const source = fs.readFileSync(path.join(root, page), 'utf8');
  for (const [, body] of source.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)) inline.scripts.push(body);
  for (const [, body] of source.matchAll(/\son[a-z]+="([^"]*)"/g)) inline.handlers.push(body);
}
const hashes = [...new Set([...inline.scripts, ...inline.handlers].map(sha256))];
if (inline.handlers.length) hashes.unshift("'unsafe-hashes'");
const headersFile = path.join(dist, '_headers');
fs.writeFileSync(headersFile, fs.readFileSync(headersFile, 'utf8').replaceAll('{{inline-script-hashes}}', hashes.join(' ')));

let files = 0;
let bytes = 0;
let largest = { size: 0, file: '' };
const walk = dir => {
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) { walk(p); continue; }
    const { size } = fs.statSync(p);
    files++;
    bytes += size;
    if (size > largest.size) largest = { size, file: path.relative(dist, p) };
  }
};
walk(dist);

const mb = n => (n / 1024 / 1024).toFixed(1);
console.log(`dist/ for ${branch ? `branch "${branch}"` : 'a local build'}: ${files} files, ${mb(bytes)} MiB; largest ${largest.file} (${mb(largest.size)} MiB); code version ${version}`);
if (settings) console.log(`settings: ${JSON.stringify(settings)}`);
if (files > MAX_FILES) throw new Error(`${files} files is over Cloudflare Pages' limit of ${MAX_FILES}.`);
if (largest.size > MAX_FILE_BYTES) throw new Error(`${largest.file} is over Cloudflare Pages' 25 MiB per-file limit.`);
