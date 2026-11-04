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
  /** "Wednesday, 4 November". */
  day(t: number): string;
  /** "Mar 2019", in UTC (monthly points are stamped 00:00 UTC on the 1st, which is still the month before in the Americas). */
  monthYear(t: number): string;
  /** "3 days ago", "yesterday", "just now". */
  ago(t: number): string;
  /** "1 player" / "3 players"; `many` defaults to `one` + "s", translated by pt.js. */
  plural(n: number, one: string, many?: string): string;
  /** 1st, 2nd, 3rd, 11th; in Portuguese 1.º, or 1.ª where the noun is feminine (jogada, posição, etapa). */
  ordinal(n: number, options?: { feminine?: boolean }): string;
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
  // date is all numbers (8/10/2025). A format that names its own zone (monthYear's UTC) keeps it.
  const dateFormatOf = (options: Intl.DateTimeFormatOptions): Formatter => {
    const zone = options.timeZone ?? timeZone;
    const format = new Intl.DateTimeFormat(locale, { ...options, timeZone: zone });
    if (lang !== 'pt' || options.month !== 'short') return format;
    const month = new Intl.DateTimeFormat(locale, { month: 'short', timeZone: zone });
    return { format: d => format.formatToParts(d).map(p => (p.type === 'month' ? month.format(d) : p.value === '/' ? ' ' : p.value)).join('') };
  };
  let dateFormat: Formatter | undefined;
  let dateTimeFormat: Formatter | undefined;
  let monthYearFormat: Formatter | undefined;
  let dayFormat: Intl.DateTimeFormat | undefined;
  let relative: Intl.RelativeTimeFormat | undefined;

  const num = (n: number | null | undefined, digits = 0) => (n === null || n === undefined || Number.isNaN(n) ? '—' : numberFormat(digits).format(n));
  return {
    num,
    pp: n => num(n, n >= 1000 ? 0 : 2),
    acc: n => `${num(n, 2)}%`,
    rank: n => (n ? `#${num(n)}` : '—'),
    date: t => (dateFormat ??= dateFormatOf({ day: 'numeric', month: 'short', year: 'numeric' })).format(new Date(t * 1000)),
    dateTime: t => (dateTimeFormat ??= dateFormatOf({ day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })).format(new Date(t * 1000)),
    day: t => (dayFormat ??= new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long', timeZone })).format(new Date(t * 1000)),
    monthYear: t => (monthYearFormat ??= dateFormatOf({ month: 'short', year: 'numeric', timeZone: 'UTC' })).format(new Date(t * 1000)),
    ago(t) {
      const diff = t - now();
      for (const [unit, seconds] of UNITS) {
        if (Math.abs(diff) >= seconds) return (relative ??= new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })).format(Math.round(diff / seconds), unit);
      }
      return lang === 'pt' ? 'agora mesmo' : 'just now';
    },
    plural: (n, one, many = `${one}s`) => `${num(n)} ${tn(n, one, many)}`,
    ordinal(n, { feminine = false } = {}) {
      if (lang === 'pt') return `${n}.${feminine ? 'ª' : 'º'}`;
      const tens = n % 100, ones = n % 10;
      const suffix = tens >= 11 && tens <= 13 ? 'th' : ones === 1 ? 'st' : ones === 2 ? 'nd' : ones === 3 ? 'rd' : 'th';
      return `${n}${suffix}`;
    },
  };
}
