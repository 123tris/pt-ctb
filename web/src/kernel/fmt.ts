// Number and date formatting, as assets/js/core/fmt.js has it, for one Text's language. `timeZone` is left out in the
// browser (the visitor's own, as the old site shows dates); the edge, which has no visitor's zone, will pass
// 'Europe/Lisbon'. `now` is the clock for "3 days ago": the visitor's in the browser, the data's time at the edge.

import type { Text } from './i18n.ts';

export interface Fmt {
  /** 12,345 / 6.23: `digits` fixed decimals (default none). */
  num(n: number | null | undefined, digits?: number): string;
  pp(n: number): string;
  acc(n: number): string;
  rank(n: number | null | undefined): string;
  date(t: number): string;
  dateTime(t: number): string;
  /** "3 days ago", "yesterday", "just now". */
  ago(t: number): string;
  /** "1 player" / "3 players"; `many` defaults to `one` + "s", translated by pt.js. */
  plural(n: number, one: string, many?: string): string;
}

interface Formatter {
  format(d: Date): string;
}

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]];

export function makeFmt(text: Text, { timeZone, now }: { timeZone?: string; now: () => number }): Fmt {
  const { locale, lang, tn } = text;
  const numberFormats = new Map<number, Intl.NumberFormat>();
  const numberFormat = (digits: number) => {
    let f = numberFormats.get(digits);
    if (!f) numberFormats.set(digits, f = new Intl.NumberFormat(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits }));
    return f;
  };
  // A Portuguese date with a short month spells it out as the English does ("8 out. 2025"), where pt-PT's own short
  // date is all numbers (8/10/2025).
  const dateFormatOf = (options: Intl.DateTimeFormatOptions): Formatter => {
    const format = new Intl.DateTimeFormat(locale, { ...options, timeZone });
    if (lang !== 'pt' || options.month !== 'short') return format;
    const month = new Intl.DateTimeFormat(locale, { month: 'short', timeZone });
    return { format: d => format.formatToParts(d).map(p => (p.type === 'month' ? month.format(d) : p.value === '/' ? ' ' : p.value)).join('') };
  };
  let dateFormat: Formatter | undefined;
  let dateTimeFormat: Formatter | undefined;
  let relative: Intl.RelativeTimeFormat | undefined;

  const num = (n: number | null | undefined, digits = 0) => (n === null || n === undefined || Number.isNaN(n) ? '—' : numberFormat(digits).format(n));
  return {
    num,
    pp: n => num(n, n >= 1000 ? 0 : 2),
    acc: n => `${num(n, 2)}%`,
    rank: n => (n ? `#${num(n)}` : '—'),
    date: t => (dateFormat ??= dateFormatOf({ day: 'numeric', month: 'short', year: 'numeric' })).format(new Date(t * 1000)),
    dateTime: t => (dateTimeFormat ??= dateFormatOf({ day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })).format(new Date(t * 1000)),
    ago(t) {
      const diff = t - now();
      for (const [unit, seconds] of UNITS) {
        if (Math.abs(diff) >= seconds) return (relative ??= new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })).format(Math.round(diff / seconds), unit);
      }
      return lang === 'pt' ? 'agora mesmo' : 'just now';
    },
    plural: (n, one, many = `${one}s`) => `${num(n)} ${tn(n, one, many)}`,
  };
}
