// The escaping template tag, as assets/js/core/html.js has it: html`<b>${name}</b>` escapes `name`, while nested html``
// results, arrays of them and raw() pass through untouched. Player and map names come from osu!, so every view builds
// its markup with this. Pure: the same in the browser and at the edge.

export class Safe {
  readonly text: string;
  constructor(text: string) {
    this.text = text;
  }
  toString(): string {
    return this.text;
  }
}

/** What a template can hold: text (escaped), markup, or lists of them. Nothing at all for null, undefined and false. */
export type Value = Safe | string | number | boolean | null | undefined | readonly Value[];

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const SPECIAL = /[&<>"']/;

export const escape = (value: unknown): string => {
  const s = String(value);
  return SPECIAL.test(s) ? s.replace(/[&<>"']/g, ch => ESCAPES[ch]) : s;
};

function piece(value: Value): string {
  if (value === null || value === undefined || value === false) return '';
  if (value instanceof Safe) return value.text;
  if (Array.isArray(value)) {
    let out = '';
    for (const v of value) out += piece(v);
    return out;
  }
  return escape(value);
}

export function html(strings: TemplateStringsArray, ...values: Value[]): Safe {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) out += piece(values[i]) + strings[i + 1];
  return new Safe(out);
}

/** Marks trusted markup as safe. */
export const raw = (text: string): Safe => new Safe(text);
