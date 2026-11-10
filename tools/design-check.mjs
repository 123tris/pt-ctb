#!/usr/bin/env node
// Checks the styles and page markup against DESIGN.md's rules that a program can read: node tools/design-check.mjs
//
// It reads the stylesheets (assets/css/*.css and the Top 10's, web/src/ui/top10-style.ts) and the code that writes
// markup (web/src, assets/js), and lists each place that breaks a rule, with the section of DESIGN.md that says so
// (exit 1). npm test runs it (tools/design-check.test.mjs), so a new pill, glow, emoji or off-scale size fails there
// instead of reaching the site. What it can't see (hierarchy, wording, one hero per view) is DESIGN.md §13's checklist.
//
// An exception is a decision, so it's written down here with its reason (ALLOW), never as a comment that switches the
// check off where the code is.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Stylesheets: a .css file, or a module whose String.raw`…` template holds the CSS. */
const STYLES = ['assets/css/site.css', 'assets/css/ambience.css', 'web/src/ui/top10-style.ts'];
/** Folders whose code writes markup or the text the site shows. */
const MARKUP = ['web/src/views', 'web/src/ui', 'web/src/client', 'web/src/app.ts', 'assets/js/pages', 'assets/js/core', 'assets/js/app.js', 'index.html'];

/** The four breakpoints (§4), and the top bar's own, where its contents stop fitting. */
const BREAKPOINTS = new Set([480, 600, 760, 940]);
const TOPBAR_BREAKPOINTS = new Set([420, 941, 1060, 1180]);

/** Exceptions, each with why. `rule` is the check's name; `at` matches the selector (CSS) or the file (markup). */
const ALLOW = [
  { rule: 'colour', at: /^body::before$/, why: 'the tiles’ mask: #000 and transparent are the mask’s alpha, not colours' },
  { rule: 'font-size', at: /^\.chart text$/, why: 'SVG text, sized in the chart’s own units (12, the scale’s floor)' },
  { rule: 'font-size', at: /jersey-glyph/, why: 'the profile’s Dan numeral is art, sized to its corner (§4: sizes from geometry)' },
  { rule: 'letter-spacing', at: /^(\.brand|\.mod|\.stat-unit|html\[data-env\] \.brand::after)$/, why: 'the wordmark, osu!’s mod pills, the “PT” unit and the DEV tag: marks, not labels' },
  { rule: 'italic', at: /^(\.event \.quip|\.where \.quote)$/, why: 'the one-line event quip and its quote (§3)' },
  { rule: 'dashed', at: /legend-dashed/, why: 'the chart legend’s key for the estimated line (§10)' },
  { rule: 'gradient', at: /^\.goal-year$/, why: 'a hard stop that fills a column to its share, not a blend' },
  { rule: 'gradient', at: /^body::before$/, why: 'the tiles’ mask' },
  { rule: 'shadow', at: /^\.range input/, why: 'the slider thumb’s ring (§9)' },
  { rule: 'emoji', at: /core\/fun\.js$|client\/fun\.ts$/, why: 'opt-in easter eggs (§6)' },
  { rule: 'emoji', at: /core\/pt\.js$/, why: 'the Portuguese of strings checked where they’re used' },
  { rule: 'emoji', at: /views\/games\.ts$|pages\/games\.js$|views\/recap\.ts$|pages\/wrapped\.js$/, text: /🍎|🎯|❌|✨|⬆️⬇️/u, why: 'results copied to Discord (§6)' },
  { rule: 'emoji', at: /views\/home\.ts$|pages\/home\.js$/, text: /🎅/u, why: 'the Christmas greeting, a seasonal easter egg (§6)' },
];

const allowed = (rule, at, text = '') => ALLOW.some(a => a.rule === rule && a.at.test(at) && (!a.text || a.text.test(text)));

/** The CSS in a stylesheet file, comments blanked (keeping line numbers). */
function cssOf(file) {
  let text = fs.readFileSync(path.join(root, file), 'utf8');
  if (!file.endsWith('.css')) {
    const start = text.indexOf('String.raw`');
    const end = text.indexOf('`;', start);
    text = text.slice(0, start).replace(/[^\n]/g, ' ') + ' '.repeat(11) + text.slice(start + 11, end);
  }
  return text.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '));
}

/** Every innermost `selector { declarations }` block, with its line. */
function* rules(css) {
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = m[1].trim().replace(/\s+/g, ' ');
    if (!selector || selector.startsWith('@font-face') || selector.startsWith('@keyframes') || /^(\d+%|from|to)(, ?(\d+%|from|to))*$/.test(selector)) continue;
    const line = css.slice(0, m.index + m[1].length).split('\n').length;
    const decls = [];
    // Split on ";" outside brackets, so a data: URI's semicolon doesn't end a declaration.
    let depth = 0, from = 0;
    const body = m[2];
    for (let i = 0; i <= body.length; i++) {
      const c = body[i];
      if (c === '(') depth++;
      else if (c === ')') depth--;
      if (i === body.length || (c === ';' && depth === 0)) {
        const d = body.slice(from, i);
        from = i + 1;
        const colon = d.indexOf(':');
        if (colon > 0) decls.push([d.slice(0, colon).trim(), d.slice(colon + 1).trim()]);
      }
    }
    yield { selector, decls, line };
  }
}

const withoutUrls = value => value.replace(/url\((?:"[^"]*"|'[^']*'|[^)]*)\)/g, 'url()');
const FS_OK = /^(var\(--fs-[\w]+\)|inherit|clamp\(.*\)|max\(var\(--fs-[\w]+\), ?[\d.]+em\)|[\d.]+em)$/;
const RADIUS_PART = /^(0|[12]px|50%|inherit|var\(--r(?:-sm|-xs)?\))$/;
const SHADOW_OK = /^(none|var\(--shadow-float\)|(inset )?-?\d+(px)? -?\d+(px)? 0( 0)? var\(--[\w-]+\)|0 0 0 \dpx (var\(--[\w-]+\)|color-mix\(.*\)))$/;
const FAMILY_OK = /^(var\(--(font|display|mono)\)|inherit|'Unbounded', var\(--display\))$/;

/** The size in a `font:` shorthand: the token before "/line-height family", or before the family. */
function shorthandSize(value) {
  const m = value.match(/(?:^|\s)((?:clamp|max|var)\([^/]*?\)|[\d.]+(?:px|rem|em))\s*(?:\/|\s+(?:var\(|'|inherit))/);
  return m ? m[1] : null;
}

function checkStyles(file, out) {
  const css = cssOf(file);
  const add = (rule, selector, line, message) => { if (!allowed(rule, selector)) out.push({ file, line, rule, message: `${selector} { ${message} }` }); };

  // Colours live in :root (§2).
  for (const { selector, decls, line } of rules(css)) {
    const inRoot = selector === ':root';
    for (const [prop, raw] of decls) {
      const value = withoutUrls(raw);
      if (!inRoot && !prop.startsWith('--') && /#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(/i.test(value)) add('colour', selector, line, `${prop}: ${raw.slice(0, 60)} — a colour outside :root (§2): give it a token`);
      if (inRoot) continue;

      if (prop === 'font-size' && !FS_OK.test(value)) add('font-size', selector, line, `font-size: ${value} — off the type scale (§3): use a --fs-* step`);
      if (prop === 'font') {
        const size = shorthandSize(value);
        if (size && !FS_OK.test(size)) add('font-size', selector, line, `font: ${value} — its size is off the type scale (§3)`);
      }
      if (prop === 'font-family' && !FAMILY_OK.test(value)) add('font-family', selector, line, `font-family: ${value} — a family outside --font, --display and --mono (§3)`);
      if (prop === 'text-transform' && /uppercase/.test(value)) add('uppercase', selector, line, 'text-transform: uppercase — sentence case everywhere (§3)');
      if (prop === 'letter-spacing' && /^\.?\d/.test(value) && parseFloat(value.replace(/^\./, '0.')) > 0) add('letter-spacing', selector, line, `letter-spacing: ${value} — no letter-spaced labels (§3)`);
      if (prop === 'font-style' && /italic/.test(value)) add('italic', selector, line, 'font-style: italic — only the event quip is italic (§3)');
      if (/^border(-(top|right|bottom|left)(-(left|right))?)?-radius$/.test(prop) || prop === 'border-radius') {
        const bad = value.split(/\s+/).filter(part => part !== '/' && !RADIUS_PART.test(part));
        if (bad.length) add('radius', selector, line, `${prop}: ${value} — radii are --r, --r-sm, --r-xs, or 50% for people (§5); no pills`);
      }
      if (/^(-webkit-)?backdrop-filter$/.test(prop)) add('glass', selector, line, `${prop} — nothing is translucent or blurred (§5)`);
      if (prop === 'text-shadow') add('shadow', selector, line, 'text-shadow — no glows (§5)');
      if (prop === 'box-shadow' && !value.split(/,\s*(?![^(]*\))/).every(s => SHADOW_OK.test(s.trim()))) add('shadow', selector, line, `box-shadow: ${value} — only --shadow-float on floating layers, inset edges and rings (§5)`);
      if (/gradient\(/.test(value)) add('gradient', selector, line, `${prop}: ${value.slice(0, 50)}… — no gradients (§5)`);
      if (/^border/.test(prop) && /\b(dashed|dotted)\b/.test(value)) add('dashed', selector, line, `${prop}: ${value} — no dashed borders (§5)`);
    }
  }

  // Breakpoints (§4).
  for (const m of css.matchAll(/@media[^{]*\{/g)) {
    const line = css.slice(0, m.index).split('\n').length;
    for (const w of m[0].matchAll(/(?:max|min)-width:\s*(\d+)px/g)) {
      const px = Number(w[1]);
      if (BREAKPOINTS.has(px)) continue;
      // A min-width one px above a breakpoint is that breakpoint's other side.
      if (/min-width/.test(w[0]) && BREAKPOINTS.has(px - 1)) continue;
      if (file === 'assets/css/site.css' && TOPBAR_BREAKPOINTS.has(px)) continue;
      out.push({ file, line, rule: 'breakpoint', message: `${m[0].trim()} — breakpoints are 480, 600, 760 and 940 (§4)` });
    }
  }
}

function walk(target) {
  const full = path.join(root, target);
  if (!fs.existsSync(full)) return [];
  if (fs.statSync(full).isFile()) return [target];
  return fs.readdirSync(full, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? walk(path.join(target, e.name)) : /\.(ts|js|html)$/.test(e.name) ? [path.join(target, e.name)] : []));
}

/** Code with its comments blanked (line numbers kept): rules are about what the site shows. */
function uncommented(text, html) {
  if (html) return text.replace(/<!--[\s\S]*?-->/g, m => m.replace(/[^\n]/g, ' '));
  return text
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, (m, before) => before + ' '.repeat(m.length - before.length));
}

function checkMarkup(file, out) {
  const at = file.replace(/\\/g, '/');
  if (at.endsWith('top10-style.ts')) return;
  const lines = uncommented(fs.readFileSync(path.join(root, file), 'utf8'), at.endsWith('.html')).split('\n');
  lines.forEach((text, i) => {
    const add = (rule, message) => { if (!allowed(rule, at, text)) out.push({ file: at, line: i + 1, rule, message }); };
    // 🍌 is the unit of Bananas (§6).
    const emoji = [...text.matchAll(/\p{Extended_Pictographic}/gu)].map(m => m[0]).filter(e => e !== '🍌');
    if (emoji.length) add('emoji', `${[...new Set(emoji)].join(' ')} — no emoji or arrows after link text in the interface (§6): say it in words`);
    for (const m of text.matchAll(/style="([^"]*)"/g)) {
      if (!m[1].includes('${')) add('inline-style', `style="${m[1].slice(0, 50)}" — static styling belongs in a class (§4); style="" only carries a value from the data`);
    }
  });
}

/** Every break of a rule: { file, line, rule, message }. */
export function check() {
  const out = [];
  for (const file of STYLES) checkStyles(file, out);
  for (const file of MARKUP.flatMap(walk)) checkMarkup(file, out);
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const found = check();
  for (const f of found) console.log(`${f.file}:${f.line}  [${f.rule}]  ${f.message}`);
  console.log(found.length ? `\n${found.length} to fix (DESIGN.md says why; an exception goes in ALLOW, with its reason).` : 'The styles and markup follow DESIGN.md’s checkable rules.');
  process.exit(found.length ? 1 : 0);
}
