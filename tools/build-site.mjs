#!/usr/bin/env node
// Copies the public part of the repo into dist/ for Cloudflare Pages (build command: node tools/build-site.mjs,
// output directory: dist). Only what's listed in PUBLIC is published, so tools/, scripts and docs never are;
// functions/ (the sign-in endpoints) stays at the repo root, where Pages looks for it. No dependencies.
// PUBLIC lists whole folders, so new pages, modules, images or fonts under assets/ are picked up by themselves; only
// a new top-level folder the site loads at runtime has to be added here. The data isn't part of the site: both sites
// read it from R2 at CONFIG.data (https://data.ptcatch.com), which publish.ps1 updates without a build.
//
// Each branch gets its own settings, layered over assets/js/config.js in dist/ only (the repo copy stays as GitHub Pages
// and `npm run serve` use it). Cloudflare sets CF_PAGES_BRANCH; set it by hand to try a branch locally:
//   main → the release site (CONFIG.production);
//   dev  → the development site (CONFIG.development): DEV marker and noindex. Same data as the release site.
// SIGN_IN=1 (a Pages build variable, set per environment) turns "Sign in with osu!" on for that build.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIG } from '../assets/js/config.js';
import { staticImports } from './lib/modules.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const PUBLIC = ['index.html', '404.html', '_headers', 'assets'];
// Cloudflare Pages limits (free plan): 20,000 files per deployment, 25 MiB per file.
const MAX_FILES = 20000;
const MAX_FILE_BYTES = 25 * 1024 * 1024;

const branch = process.env.CF_PAGES_BRANCH || '';
const release = branch === 'main';
// No branch: a plain local build, left exactly as the repo has it. Any other branch is a development build; only dev
// has a domain of its own (CONFIG.development), the rest live on their *.pages.dev preview address.
const settings = !branch ? null : release
  ? { home: CONFIG.production }
  : { home: branch === 'dev' ? CONFIG.development : '', env: 'dev' };
if (settings) settings.signIn = process.env.SIGN_IN === '1';

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist);
for (const entry of PUBLIC) fs.cpSync(path.join(root, entry), path.join(dist, entry), { recursive: true });

const edit = (file, change) => {
  const target = path.join(dist, file);
  const before = fs.readFileSync(target, 'utf8');
  const after = change(before);
  if (after === before) throw new Error(`build-site: expected to change ${file}, but nothing matched.`);
  fs.writeFileSync(target, after);
};

if (settings) {
  edit('assets/js/config.js', s => `${s}\n// Set by tools/build-site.mjs for the "${branch}" branch.\nObject.assign(CONFIG, ${JSON.stringify(settings)});\n`);
  if (!release) {
    edit('index.html', s => s.replace('<html lang="en">', `<html lang="en" data-env="${settings.env}">`));
    edit('_headers', s => `${s}\n# A development build: keep it out of search engines.\n/*\n  X-Robots-Tag: noindex\n`);
  }
}

// Every JS, CSS and font address gets ?v=<hash of all the code and fonts>, in index.html, in every import and in the
// CSS. _headers lets browsers keep them for a year, and a stale module next to fresh ones breaks the page ("does not
// provide an export named …"). With the version in the address, a deploy that changes any code changes every address
// at once, and a deploy that changes none leaves them all cached.
const codeFiles = [];
const collect = dir => {
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) collect(p);
    else if (/\.(js|css|woff2)$/.test(d.name)) codeFiles.push(p);
  }
};
collect(path.join(dist, 'assets'));
codeFiles.sort();
const code = crypto.createHash('sha256');
for (const file of codeFiles) code.update(path.relative(dist, file)).update(fs.readFileSync(file));
const version = code.digest('hex').slice(0, 10);

// Preload app.js's whole static import graph (and moved.js's) from index.html, so the modules come in parallel instead
// of one import level at a time. Added before the versioning below, which gives these the same ?v= as the imports.
const entries = ['assets/js/app.js', 'assets/js/moved.js'].map(f => path.join(dist, f));
const preload = [...new Set(entries.flatMap(staticImports))].filter(f => !entries.includes(f))
  .map(f => `<link rel="modulepreload" href="${path.relative(dist, f).split(path.sep).join('/')}">`);
// meta.json isn't preloaded: a <link rel="preload"> fetches it with the default cache mode, so on a repeat visit it came
// straight from the browser cache, and data.js's fetch (cache: 'no-cache') then took that preloaded copy instead of
// revalidating: returning visitors kept an old manifest, and with it old data. app.js asks for meta.json as soon as it
// runs, which is still before any page has its module. Opening the connection to the data host early is what's left.
if (/^https?:/.test(CONFIG.data)) preload.push(`<link rel="preconnect" href="${new URL(CONFIG.data).origin}" crossorigin>`);
edit('index.html', s => s.replace(/^([ \t]*)(<script type="module" src="assets\/js\/moved\.js")/m,
  (_, indent, tag) => `${preload.map(l => `${indent}${l}${s.includes('\r\n') ? '\r\n' : '\n'}`).join('')}${indent}${tag}`));
const IMPORT = /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])(\.{1,2}\/[^'"?]+\.js)\2/g;
for (const file of codeFiles.filter(f => f.endsWith('.js'))) {
  const source = fs.readFileSync(file, 'utf8');
  const versioned = source.replace(IMPORT, `$1$2$3?v=${version}$2`);
  if (versioned !== source) fs.writeFileSync(file, versioned);
}
// The fonts, named in the CSS (url(../fonts/x.woff2)), get the same version, so they can be cached as long as the code.
const FONT_URL = /(url\(\s*['"]?)(\.\.\/fonts\/[^'")?]+\.woff2)(['"]?\s*\))/g;
for (const file of codeFiles.filter(f => f.endsWith('.css'))) {
  const source = fs.readFileSync(file, 'utf8');
  const versioned = source.replace(FONT_URL, `$1$2?v=${version}$3`);
  if (versioned !== source) fs.writeFileSync(file, versioned);
}
edit('index.html', s => s.replace(/((?:src|href)=")(assets\/(?:js|css|fonts)\/[^"?]+\.(?:js|css|woff2))"/g, `$1$2?v=${version}"`));

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
