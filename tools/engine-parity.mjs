#!/usr/bin/env node
// Checks that the C# engine (engine/) writes exactly what tools/export.mjs writes: both export the same bot data at
// the same time into trial folders, day after day so the state each run leaves is checked too, and every file is
// compared byte for byte. The engine's binary packs, which Node doesn't write, are checked against its JSON. The engine has to match before it publishes, since a file's name on R2 is the hash of its
// bytes: identical output means the switch uploads nothing new and nobody's cache is emptied.
//
//   node tools/engine-parity.mjs [--data <bot data folder>] [--now <unix seconds>] [--days 2] [--engine <exe>] [--keep]
//
// Needs the .NET 10 SDK when --engine isn't given (the engine is built first). Network-free: the Node exporter runs
// with --offline (avatars as they are) and without --fetch-titles. Exits 1 when any file differs.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const data = path.resolve(arg('data', path.join(repo, '..', 'PT-CTB-Bot-Data')));
const days = Number(arg('days', 2));
const start = Number(arg('now', Math.floor(Date.now() / 1000)));
const keep = process.argv.includes('--keep');

let engine = arg('engine', null);
if (!engine) {
  console.log('Building the engine…');
  execFileSync('dotnet', ['build', path.join(repo, 'engine', 'src', 'PtCatch.Engine.Cli'), '-c', 'Release', '--nologo', '-v', 'q'], { stdio: 'inherit' });
  engine = path.join(repo, 'engine', 'src', 'PtCatch.Engine.Cli', 'bin', 'Release', 'net10.0', process.platform === 'win32' ? 'ptcatch-engine.exe' : 'ptcatch-engine');
}

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'ptcatch-parity-'));
const out = { node: path.join(work, 'node'), engine: path.join(work, 'engine') };
for (const dir of Object.values(out)) {
  fs.mkdirSync(dir, { recursive: true });
  // The same avatars in both, so meta.json lists the same thumbnails.
  const avatars = path.join(repo, 'data', 'avatars');
  if (fs.existsSync(avatars)) fs.cpSync(avatars, path.join(dir, 'avatars'), { recursive: true });
}

const files = root => {
  const found = [];
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else found.push(path.relative(root, full).replaceAll('\\', '/'));
    }
  };
  walk(root);
  return found.sort();
};

/** Where two JSON values first differ: [path, a, b], or null. */
function firstDifference(a, b, at = '$') {
  if (typeof a !== typeof b || Array.isArray(a) !== Array.isArray(b) || (a === null) !== (b === null)) return [at, a, b];
  if (a && typeof a === 'object') {
    const ka = Object.keys(a), kb = Object.keys(b);
    if (ka.join('\u0000') !== kb.join('\u0000')) return [`${at} (keys)`, ka.slice(0, 12), kb.slice(0, 12)];
    for (const k of ka) {
      const d = firstDifference(a[k], b[k], Array.isArray(a) ? `${at}[${k}]` : `${at}.${k}`);
      if (d) return d;
    }
    return null;
  }
  return Object.is(a, b) || a === b ? null : [at, a, b];
}

let failed = false;
for (let day = 0; day < days; day++) {
  const now = String(start + day * 86400);
  const timer = name => { const t = Date.now(); return () => `${name} ${((Date.now() - t) / 1000).toFixed(1)}s`; };
  const nodeDone = timer('Node');
  execFileSync(process.execPath, ['--max-old-space-size=4096', path.join(repo, 'tools', 'export.mjs'), '--data', data, '--out', out.node, '--now', now, '--offline'], { stdio: 'ignore' });
  const nodeTime = nodeDone();
  const engineDone = timer('engine');
  execFileSync(engine, ['export', '--repo', repo, '--data', data, '--out', out.engine, '--now', now, '--offline', '--packs'], { stdio: 'ignore' });
  const engineTime = engineDone();

  // The binary packs are the engine's alone: they're checked against its JSON (web/test/packs.test.mjs) below.
  const a = files(out.node), b = files(out.engine).filter(f => !f.startsWith('packs/'));
  const missing = a.filter(f => !b.includes(f)), extra = b.filter(f => !a.includes(f));
  const differ = a.filter(f => b.includes(f) && !fs.readFileSync(path.join(out.node, f)).equals(fs.readFileSync(path.join(out.engine, f))));
  console.log(`day ${day + 1} (now ${now}): ${a.length - differ.length - missing.length} of ${a.length} files identical; ${nodeTime}, ${engineTime}`);
  for (const f of missing) console.log(`  only from Node: ${f}`);
  for (const f of extra) console.log(`  only from the engine: ${f}`);
  for (const f of differ.slice(0, 20)) {
    let detail = '';
    if (f.endsWith('.json')) {
      const d = firstDifference(JSON.parse(fs.readFileSync(path.join(out.node, f), 'utf8')), JSON.parse(fs.readFileSync(path.join(out.engine, f), 'utf8')));
      detail = d ? `${d[0]}: Node ${JSON.stringify(d[1])?.slice(0, 120)} / engine ${JSON.stringify(d[2])?.slice(0, 120)}` : 'same values, different bytes';
    }
    console.log(`  differs: ${f} ${detail}`);
  }
  if (missing.length || extra.length || differ.length) failed = true;
  try {
    execFileSync(process.execPath, ['--test', path.join(repo, 'web', 'test', 'packs.test.mjs')], { stdio: 'pipe', env: { ...process.env, PTCATCH_DATA: out.engine } });
    console.log('  packs: the same data as the JSON');
  } catch (e) {
    console.log(`  packs differ from the JSON:
${e.stdout}`);
    failed = true;
  }
}

if (keep || failed) console.log(`Outputs kept in ${work}`);
else fs.rmSync(work, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
