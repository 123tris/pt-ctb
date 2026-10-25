// Number and date formatting in British English.

const LOCALE = 'en-GB';
const numberFormats = new Map();

function numberFormat(digits) {
  if (!numberFormats.has(digits))
    numberFormats.set(digits, new Intl.NumberFormat(LOCALE, { minimumFractionDigits: digits, maximumFractionDigits: digits }));
  return numberFormats.get(digits);
}

/** 12,345 / 6.23 — `digits` fixed decimals (default none). */
export const num = (n, digits = 0) => (n === null || n === undefined || Number.isNaN(n) ? '—' : numberFormat(digits).format(n));
export const pp = n => num(n, n >= 1000 ? 0 : 2);
export const acc = n => `${num(n, 2)}%`;
export const rank = n => (n ? `#${num(n)}` : '—');

const dateFormat = new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'short', year: 'numeric' });
const dateTimeFormat = new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const dayFormat = new Intl.DateTimeFormat(LOCALE, { weekday: 'long', day: 'numeric', month: 'long' });
const monthFormat = new Intl.DateTimeFormat(LOCALE, { month: 'short' });
const relative = new Intl.RelativeTimeFormat(LOCALE, { numeric: 'auto' });

export const date = t => dateFormat.format(new Date(t * 1000));
export const dateTime = t => dateTimeFormat.format(new Date(t * 1000));
export const day = t => dayFormat.format(new Date(t * 1000));
export const monthName = m => monthFormat.format(new Date(2026, m, 1)).replace('.', '');
/** "Mar 2019", in UTC (monthly points are stamped 00:00 UTC on the 1st, which is still the month before in the Americas). */
const monthYearFormat = new Intl.DateTimeFormat(LOCALE, { month: 'short', year: 'numeric', timeZone: 'UTC' });
export const monthYear = t => monthYearFormat.format(new Date(t * 1000));

const UNITS = [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]];

/** "3 days ago", "yesterday", "just now". */
export function ago(t) {
  const diff = t - Date.now() / 1000;
  for (const [unit, seconds] of UNITS) {
    if (Math.abs(diff) >= seconds) return relative.format(Math.round(diff / seconds), unit);
  }
  return 'just now';
}

/** 2:41 for a length in seconds. */
export const duration = s => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

/** "1 player" / "3 players"; `many` defaults to `one` + "s". */
export const plural = (n, one, many = `${one}s`) => `${num(n)} ${n === 1 ? one : many}`;

/** 1st, 2nd, 3rd, 4th, 11th, 22nd. */
export function ordinal(n) {
  const tens = n % 100, ones = n % 10;
  const suffix = tens >= 11 && tens <= 13 ? 'th' : ones === 1 ? 'st' : ones === 2 ? 'nd' : ones === 3 ? 'rd' : 'th';
  return `${n}${suffix}`;
}
