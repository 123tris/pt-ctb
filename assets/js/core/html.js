// A tiny escaping template tag: html`<b>${name}</b>` escapes `name`, while nested html`` results, arrays of them
// and raw() pass through untouched. Every page builds its markup with this, so player and map names (which come
// from osu!) can never inject markup.

class Safe {
  constructor(text) { this.text = text; }
  toString() { return this.text; }
}

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escape = value => String(value).replace(/[&<>"']/g, ch => ESCAPES[ch]);

function piece(value) {
  if (value === null || value === undefined || value === false) return '';
  if (value instanceof Safe) return value.text;
  if (Array.isArray(value)) return value.map(piece).join('');
  return escape(value);
}

export function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) out += piece(values[i]) + strings[i + 1];
  return new Safe(out);
}

/** Marks trusted markup (e.g. built SVG) as safe. */
export const raw = text => new Safe(text);
