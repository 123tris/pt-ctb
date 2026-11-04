// The site's two languages, as assets/js/core/i18n.js has them, without its globals: a Text is made for one language
// and its table (assets/js/core/pt.js for Portuguese, keyed by the English), so a view can be drawn in either, in the
// browser or at the edge. The keys are the same strings as the old site's, so node tools/i18n-check.mjs and pt.js
// cover both.
//
//   t('Leaderboards')                        → 'Classificações'
//   t('Data updated {ago}.', { ago })        → vars fill {name}
//   th('Read the {link}.', { link: html`…` }) → markup: the text is escaped, html`` vars pass through
//   tn(n, '{n} player', '{n} players')       → the form for n; {n} is n formatted
//   t('All|time')                            → a context after "|" when one English word needs two translations

import { html, raw, escape, type Safe, type Value } from './html.ts';

export type Lang = 'en' | 'pt';
/** English → Portuguese; a plural is [one, other] under the English singular. */
export type Table = Readonly<Record<string, string | readonly [string, string]>>;
export type Vars = Readonly<Record<string, unknown>>;

export const LOCALES: Record<Lang, string> = { en: 'en-GB', pt: 'pt-PT' };

export interface Text {
  readonly lang: Lang;
  /** The locale numbers and dates are formatted in. */
  readonly locale: string;
  t(text: string, vars?: Vars): string;
  th(text: string, vars?: Readonly<Record<string, Value>>): Safe;
  tn(n: number, one: string, many: string, vars?: Vars): string;
}

/** The English shown for a key: the key without its |context. */
const bare = (text: string) => text.split('|')[0];
const fill = (text: string, vars?: Vars) => (vars ? text.replace(/\{(\w+)\}/g, (all, name) => (name in vars ? String(vars[name]) : all)) : text);

export function makeText(lang: Lang, table: Table = {}): Text {
  const locale = LOCALES[lang];
  const plurals = new Intl.PluralRules(locale);
  const numbers = new Intl.NumberFormat(locale);
  return {
    lang,
    locale,
    t(text, vars) {
      const found = table[text];
      return fill(typeof found === 'string' ? found : bare(text), vars);
    },
    th(text, vars = {}) {
      const found = table[text];
      const parts = (typeof found === 'string' ? found : bare(text)).split(/\{(\w+)\}/);
      const strings = parts.filter((_, i) => i % 2 === 0).map(escape);
      const values = parts.filter((_, i) => i % 2 === 1).map(name => (name in vars ? vars[name] : raw(`{${name}}`)));
      return html(Object.assign(strings, { raw: strings }) as TemplateStringsArray, ...values);
    },
    tn(n, one, many, vars = {}) {
      const found = table[one];
      const [singular, plural] = Array.isArray(found) ? found : [bare(one), many];
      return fill(plurals.select(n) === 'one' ? singular : plural, { n: numbers.format(n), ...vars });
    },
  };
}
