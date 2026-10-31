#!/usr/bin/env node
// Checks the Portuguese strings (assets/js/core/pt.js) against the English ones in the code: node tools/i18n-check.mjs
//
// Finds the English the site shows in t('…'), th('…'), tn(n, '…', '…'), fmt.plural(n, '…') and resultCount(…, '…')
// calls, in every string inside a /* i18n */ [ … ] or { … } (texts kept in English and translated later, like the
// badges the exporter writes), and in index.html's data-t, data-t-html and data-t-label elements. Lists what pt.js is
// missing (exit 1), entries whose {placeholders} differ from the English, plurals that aren't [one, other], and
// entries nothing uses any more.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { PT } = await import(new URL('../assets/js/core/pt.js', import.meta.url));

const STRING = String.raw`'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|\`(?:[^\`\\$]|\\.)*\``;
const literal = text => Function(`return ${text}`)();
const CALLS = [
  new RegExp(String.raw`\b(?:t|th)\(\s*(${STRING})`, 'g'),
  new RegExp(String.raw`\btn\([^,()]+(?:\([^()]*\))?[^,()]*,\s*(${STRING})`, 'g'),
  new RegExp(String.raw`\bplural\([^,()]+(?:\([^()]*\))?[^,()]*,\s*(${STRING})`, 'g'),
  new RegExp(String.raw`\bresultCount\((?:[^,()]+(?:\([^()]*\))?[^,()]*,\s*){2}(${STRING})`, 'g'),
];

const used = new Map(); // English → first place it's used
const use = (text, where) => { if (!used.has(text)) used.set(text, where); };

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
}

/** The strings between a /* i18n *\/ marker's bracket and its match. */
function markedStrings(source) {
  const out = [];
  for (const marker of source.matchAll(/\/\* i18n \*\/\s*([[{])/g)) {
    let depth = 0;
    const tokens = new RegExp(`${STRING}|[\\[\\]{}()]|//[^\\n]*`, 'g');
    tokens.lastIndex = marker.index + marker[0].length - 1;
    for (let m; (m = tokens.exec(source));) {
      const token = m[0];
      if ('[{('.includes(token)) depth++;
      else if (')}]'.includes(token)) { if (--depth === 0) break; }
      else if (/^['"`]/.test(token)) out.push(literal(token));
    }
  }
  return out;
}

const lineOf = (source, index) => source.slice(0, index).split('\n').length;
for (const file of walk(path.join(root, 'assets/js')).filter(f => f.endsWith('.js') && !['pt.js', 'i18n.js'].includes(path.basename(f)))) {
  const source = fs.readFileSync(file, 'utf8');
  const rel = path.relative(root, file).replaceAll('\\', '/');
  for (const pattern of CALLS) for (const m of source.matchAll(pattern)) use(literal(m[1]), `${rel}:${lineOf(source, m.index)}`);
  for (const text of markedStrings(source)) use(text, `${rel} (i18n block)`);
}

const page = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
for (const m of page.matchAll(/<(\w+)[^>]*\sdata-t(?:-html)?(?=[\s>])[^>]*>([\s\S]*?)<\/\1>/g)) use(m[2].trim(), `index.html:${lineOf(page, m.index)}`);
for (const m of page.matchAll(/aria-label="([^"]*)"[^>]*\sdata-t-label/g)) use(m[1], `index.html:${lineOf(page, m.index)}`);

const holes = text => [...String(text).matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort().join(',');
const missing = [...used].filter(([text]) => !(text in PT));
const wrongHoles = Object.entries(PT).filter(([en, pt]) => typeof pt === 'string' && holes(pt) !== holes(en));
const badPlurals = Object.entries(PT).filter(([, pt]) => Array.isArray(pt) && (pt.length !== 2 || pt.some(f => typeof f !== 'string')));
const unused = Object.keys(PT).filter(en => !used.has(en));
const keys = [...fs.readFileSync(path.join(root, 'assets/js/core/pt.js'), 'utf8').matchAll(new RegExp(`^\s*(${STRING}):`, 'gm'))].map(m => literal(m[1]));
const twice = [...new Set(keys.filter((k, i) => keys.indexOf(k) !== i))];

const report = (title, rows) => rows.length && console.log(`\n${title} (${rows.length}):\n${rows.map(r => `  ${r}`).join('\n')}`);
report('Missing from pt.js', missing.map(([text, where]) => `${JSON.stringify(text)}  (${where})`));
report('Placeholders differ', wrongHoles.map(([en, pt]) => `${JSON.stringify(en)} → ${JSON.stringify(pt)}`));
report('Plurals that aren\'t [one, other]', badPlurals.map(([en]) => JSON.stringify(en)));
report('In pt.js twice (the last one wins)', twice.map(en => JSON.stringify(en)));
report('Unused (or only used through a variable)', unused.map(en => JSON.stringify(en)));
console.log(`\n${used.size} strings in the code, ${Object.keys(PT).length} in pt.js, ${missing.length} missing.`);
process.exit(missing.length || wrongHoles.length || badPlurals.length || twice.length ? 1 : 0);
