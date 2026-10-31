// The site's two languages: English, the default and the text written in the code, and European Portuguese (pt-PT),
// whose strings are in core/pt.js, keyed by the English. A visitor's choice is kept in localStorage; a first visit
// takes Portuguese when the browser asks for it. Switching reloads the page, so every module can translate its text
// once, when it loads. node tools/i18n-check.mjs lists strings core/pt.js is missing.
//
//   t('Leaderboards')                        → 'Classificações'
//   t('Data updated {ago}.', { ago })        → vars fill {name}
//   th('Read the {link}.', { link: html`…` }) → markup: the text is escaped, html`` vars pass through (core/html.js)
//   tn(n, '{n} player', '{n} players')       → the form for n; {n} is n formatted
//   t('All|time')                            → a context after "|" when one English word needs two translations
//
// A table entry for a plural is [one, other] under the English singular. Runs in Node too (the exporter imports
// modules that import this), where it's always English.

import { html, raw, escape } from './html.js';

export const LANGS = { en: 'English', pt: 'Português' };
const LOCALES = { en: 'en-GB', pt: 'pt-PT' };
const KEY = 'ptctb:lang';

function chosen() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY));
    if (LANGS[saved]) return saved;
  } catch { /* private mode, or no localStorage (Node) */ }
  const asked = globalThis.navigator?.languages?.[0] ?? globalThis.navigator?.language ?? '';
  return /^pt\b/i.test(asked) ? 'pt' : 'en';
}

/** 'en' or 'pt'. */
export const lang = chosen();
/** The locale numbers and dates are formatted in (core/fmt.js). */
export const locale = LOCALES[lang];
/** The <html lang> value: 'en' or 'pt-PT'. */
export const htmlLang = lang === 'pt' ? 'pt-PT' : 'en';

if (globalThis.document) document.documentElement.lang = htmlLang;

const table = lang === 'pt' ? (await import('./pt.js')).PT : {};
const plurals = new Intl.PluralRules(locale);

/** Keeps the choice and reloads the page in that language. */
export function setLang(next) {
  if (!LANGS[next] || next === lang) return;
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* private mode: this page only */ }
  location.reload();
}

/** The English shown for a key: the key without its |context. */
const bare = text => text.split('|')[0];
const fill = (text, vars) => (vars ? text.replace(/\{(\w+)\}/g, (all, name) => (name in vars ? String(vars[name]) : all)) : text);

/** The text in the visitor's language, with {name} filled from `vars`. */
export function t(text, vars) {
  const found = table[text];
  return fill(typeof found === 'string' ? found : bare(text), vars);
}

/** t() for markup: escapes the text and inserts `vars` as html`` does (escaped unless they're html`` themselves). */
export function th(text, vars = {}) {
  const found = table[text];
  const parts = (typeof found === 'string' ? found : bare(text)).split(/\{(\w+)\}/);
  return html(parts.filter((_, i) => i % 2 === 0).map(escape), ...parts.filter((_, i) => i % 2 === 1).map(name => (name in vars ? vars[name] : raw(`{${name}}`))));
}

/** The singular or plural of `one`/`many` for `n` (PT: [one, other] from the table), with {n} as n formatted. */
export function tn(n, one, many, vars = {}) {
  const found = table[one];
  const [singular, plural] = Array.isArray(found) ? found : [bare(one), many];
  const text = plurals.select(n) === 'one' ? singular : plural;
  return fill(text, { n: new Intl.NumberFormat(locale).format(n), ...vars });
}

/**
 * The English a translated text came from, for the usage counts (core/track.js), so "Mostrar mais" and "Show more"
 * count as one button. Text that isn't a whole table entry comes back as it is.
 */
let reverse = null;
export function english(text) {
  if (lang === 'en') return text;
  reverse ??= new Map(Object.entries(table).filter(([, v]) => typeof v === 'string').map(([k, v]) => [v, bare(k)]));
  return reverse.get(text.trim()) ?? text;
}
