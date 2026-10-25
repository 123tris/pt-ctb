#!/usr/bin/env node
// Copies the public part of the repo into dist/ for Cloudflare Pages (build command: node tools/build-site.mjs,
// output directory: dist). Only what's listed in PUBLIC is published, so tools/, state/, scripts and docs never are;
// functions/ (the sign-in endpoints) stays at the repo root, where Pages looks for it. No dependencies.
// PUBLIC lists whole folders, so new pages, modules, images or fonts under assets/ are picked up by themselves; only
// a new top-level folder the site loads at runtime has to be added here.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const PUBLIC = ['index.html', '404.html', '_headers', 'assets', 'data'];
// Cloudflare Pages limits (free plan): 20,000 files per deployment, 25 MiB per file.
const MAX_FILES = 20000;
const MAX_FILE_BYTES = 25 * 1024 * 1024;

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist);
for (const entry of PUBLIC) fs.cpSync(path.join(root, entry), path.join(dist, entry), { recursive: true });

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
console.log(`dist/: ${files} files, ${mb(bytes)} MiB; largest ${largest.file} (${mb(largest.size)} MiB)`);
if (files > MAX_FILES) throw new Error(`${files} files is over Cloudflare Pages' limit of ${MAX_FILES}.`);
if (largest.size > MAX_FILE_BYTES) throw new Error(`${largest.file} is over Cloudflare Pages' 25 MiB per-file limit.`);
