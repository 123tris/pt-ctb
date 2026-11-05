// The visitor's language, as assets/js/core/i18n.js chooses it: the one picked with the EN / PT buttons (kept in this
// browser), else Portuguese when the browser asks for it, else English. Switching reloads the page, so everything is
// drawn in one language from the start. The strings are kernel/i18n.ts's, over assets/js/core/pt.js for Portuguese:
// the bundle keeps that file as an import of it (tools/web-build.mjs), and only Portuguese visitors load it.

import { makeText, type Lang, type Table, type Text } from '../kernel/i18n.ts';

export const LANGS: Readonly<Record<Lang, string>> = { en: 'English', pt: 'Português' };
const KEY = 'ptctb:lang';

function chosen(): Lang {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (typeof saved === 'string' && Object.hasOwn(LANGS, saved)) return saved as Lang;
  } catch { /* private mode */ }
  const asked = navigator.languages?.[0] ?? navigator.language ?? '';
  return /^pt\b/i.test(asked) ? 'pt' : 'en';
}

/** 'en' or 'pt'. */
export const lang: Lang = chosen();
/** The <html lang> value: 'en' or 'pt-PT'. */
export const htmlLang = lang === 'pt' ? 'pt-PT' : 'en';

/** The Portuguese strings, keyed by the English. */
export const portuguese = (): Promise<Table> => import('../../../assets/js/core/pt.js').then(m => m.PT as unknown as Table);

let table: Table | null = null;
let current: Text = makeText(lang);
let loading: Promise<Text> | null = null;

/**
 * The strings in the visitor's language, loaded once. The app waits for them before it draws anything, as the old app
 * waited for pt.js; should pt.js fail to load, the site shows in English rather than not at all.
 */
export function loadText(): Promise<Text> {
  loading ??= (lang === 'pt' ? portuguese().catch(() => ({})) : Promise.resolve({})).then(t => {
    table = t;
    current = makeText(lang, t);
    return current;
  });
  return loading;
}

/** The strings, for the browser's code (pages take theirs from their Ctx): English until loadText() is done. */
export const text = (): Text => current;

/** Keeps the choice and reloads the page in that language. */
export function setLang(next: string): void {
  if (!Object.hasOwn(LANGS, next) || next === lang) return;
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* private mode: this page only */ }
  location.reload();
}

let reverse: Map<string, string> | null = null;

/**
 * The English a translated text came from, for the usage counts (client/track.ts), so "Mostrar mais" and "Show more"
 * count as one button. Text that isn't a whole table entry comes back as it is.
 */
export function english(s: string): string {
  if (lang === 'en' || !table) return s;
  reverse ??= new Map(Object.entries(table).filter((e): e is [string, string] => typeof e[1] === 'string').map(([k, v]) => [v, k.split('|')[0]]));
  return reverse.get(s.trim()) ?? s;
}
