// The Maps page's search over the search pack: the same results, in the same order, as assets/js/pages/maps.js gave,
// which lowercased about 54k strings and sorted every match again for each query (47–84 ms on a desktop). Here,
// everything that doesn't depend on the query is made once per pack, over the columns:
// - the text (mapText): each of artist, title, difficulty name and id lowercased into one string per column, with a
//   sketch of each row that rules out nearly every row that can't hold a word without reading it. No string is made
//   per map, and a set's artist and title are searched once for all its difficulties. It's made for the first search
//   with words, so the page's first view doesn't wait for it;
// - each sort's order of every map, the first time it's asked for. A search walks that order and keeps what matches,
//   so it never sorts.
// web/test/maps.test.mjs checks it against the old page's search on many queries, filters and sorts.

import type { SearchPack } from '../gen/packs.ts';
import type { StrColumn } from '../kernel/ptcb.ts';
import { inStars, isAnyStars, type StarRange } from './star-range.ts';

export type MapSort = 'players' | 'stars' | 'easy' | 'new';
/** A category as the old pages write it: Converts, Loved & Unranked, Ranked ('' for any). */
export type MapCat = '' | 'c' | 'u' | 'r';

/** The search pack's `cat` codes (1 converts, 2 loved, 3 ranked) as letters. */
export const CAT_OF = ['', 'c', 'u', 'r'] as const;
const CODE_OF = { '': 0, c: 1, u: 2, r: 3 } as const;

export interface MapQuery {
  /** The search box's text: maps whose id, artist, title or difficulty name hold every word of it. */
  q: string;
  cat: MapCat;
  stars: StarRange;
  sort: MapSort;
}

/**
 * A column's rows lowercased into one string, row r being text[at[r]] up to text[at[r + 1]], and a sketch of each row
 * in marks[4r…4r + 3]: 64 bits for the characters in it and 64 for each pair of characters side by side. A row without
 * all of a word's bits can't hold the word, so its text isn't read: that's nearly every row that doesn't hold it.
 */
export interface TextColumn {
  readonly text: string;
  readonly at: Uint32Array;
  readonly marks: Uint32Array;
}

/** The text of a pack's maps, as findMaps() searches it. */
export interface MapText {
  /** By set. */
  readonly artist: TextColumn;
  readonly title: TextColumn;
  /** By map: the difficulty name, and the id in digits. */
  readonly version: TextColumn;
  readonly id: TextColumn;
}

export interface MapIndex {
  readonly pack: SearchPack;
  /** Stars as the old rows had them (hundredths / 100), so a range compares exactly as before. */
  readonly stars: Float64Array;
  /** Each sort's order of the maps (rows), made when first asked for. */
  readonly orders: Map<MapSort, Uint32Array>;
  /** Scratch for findMaps(), kept between searches: the maps still in, whether a map is in, the sets holding a word. */
  readonly kept: Uint32Array;
  readonly isKept: Uint8Array;
  readonly setHit: Uint8Array;
}

const indexes = new WeakMap<SearchPack, MapIndex>();
const texts = new WeakMap<SearchPack, MapText>();

/** What every search of a pack needs, made once and kept with it. */
export function mapIndex(pack: SearchPack): MapIndex {
  let index = indexes.get(pack);
  if (!index) {
    const { sets, maps } = pack;
    const stars = new Float64Array(maps.rows);
    for (let i = 0; i < maps.rows; i++) stars[i] = maps.stars[i] / 100;
    const kept = new Uint32Array(maps.rows), isKept = new Uint8Array(maps.rows), setHit = new Uint8Array(sets.rows);
    index = { pack, stars, orders: new Map(), kept, isKept, setHit };
    indexes.set(pack, index);
  }
  return index;
}

/** The pack's text, made the first time it's asked for (the page asks early, once it's idle). */
export function mapText({ pack }: MapIndex): MapText {
  let text = texts.get(pack);
  if (!text) {
    const { sets, maps } = pack;
    text = {
      artist: lowerColumn(sets.artist), title: lowerColumn(sets.title), version: lowerColumn(maps.version), id: idColumn(maps.id),
    };
    texts.set(pack, text);
  }
  return text;
}

const decoder = new TextDecoder();

/** A string column lowercased, each row as its own toLowerCase() gives it, as the old page did it. */
function lowerColumn(column: StrColumn): TextColumn {
  const { offsets, bytes } = column;
  const rows = column.length;
  const whole = decoder.decode(bytes.subarray(0, offsets[rows]));
  // All ASCII (as many characters as bytes), nearly always: lowercased at once, with the rows where they were.
  if (whole.length === offsets[rows]) return textColumn(whole.toLowerCase(), offsets);
  // Otherwise each row outside ASCII is lowercased on its own, since that can change its length, and Σ's lowercase
  // depends on what's next to it; the runs of ASCII rows between them at once. Offsets are counted in UTF-16 units.
  const parts: string[] = [];
  const at = new Uint32Array(rows + 1);
  let pos = 0, run = 0, out = 0;
  for (let r = 0; r < rows; r++) {
    let length = 0;
    for (let k = offsets[r]; k < offsets[r + 1]; k++) if ((bytes[k] & 0xc0) !== 0x80) length += bytes[k] >= 0xf0 ? 2 : 1;
    at[r] = out;
    if (length === offsets[r + 1] - offsets[r]) {
      out += length;
    } else {
      if (run < pos) parts.push(whole.slice(run, pos).toLowerCase());
      const lower = whole.slice(pos, pos + length).toLowerCase();
      parts.push(lower);
      out += lower.length;
      run = pos + length;
    }
    pos += length;
  }
  if (run < pos) parts.push(whole.slice(run, pos).toLowerCase());
  at[rows] = out;
  return textColumn(parts.join(''), at);
}

/** The ids in decimal digits, as `${id}` writes them. */
function idColumn(ids: Uint32Array): TextColumn {
  const digits = new Uint8Array(ids.length * 10);
  const at = new Uint32Array(ids.length + 1);
  let pos = 0;
  for (let i = 0; i < ids.length; i++) {
    at[i] = pos;
    let length = 1;
    for (let n = ids[i]; n >= 10; n = Math.floor(n / 10)) length++;
    for (let k = length - 1, n = ids[i]; k >= 0; k--, n = Math.floor(n / 10)) digits[pos + k] = 48 + (n % 10);
    pos += length;
  }
  at[ids.length] = pos;
  return textColumn(decoder.decode(digits.subarray(0, pos)), at);
}

/** A character's bit in a sketch (0…63): its own for a–z and 0–9, where most words start, and hashed for the rest. */
const charBit = (c: number) =>
  (c >= 97 && c <= 122 ? c - 97 : c >= 48 && c <= 57 ? c - 22 : 36 + ((Math.imul(c, 0x9e3779b1) >>> 0) % 28));
/** charBit() for ASCII, looked up. */
const ASCII_BIT = Uint8Array.from({ length: 128 }, (_, c) => charBit(c));

/** Writes the sketch of text[from…to) into marks[m…m + 3] (a pair's bit is hashed). */
function sketch(text: string, from: number, to: number, marks: Uint32Array, m: number): void {
  let chars = 0, charsHigh = 0, pairs = 0, pairsHigh = 0;
  for (let i = from, before = -1; i < to; i++) {
    const c = text.charCodeAt(i);
    const bit = c < 128 ? ASCII_BIT[c] : charBit(c);
    if (bit < 32) chars |= 1 << bit;
    else charsHigh |= 1 << (bit - 32);
    if (before >= 0) {
      const pair = Math.imul((before << 16) | c, 0x9e3779b1) >>> 26;
      if (pair < 32) pairs |= 1 << pair;
      else pairsHigh |= 1 << (pair - 32);
    }
    before = c;
  }
  marks[m] = chars;
  marks[m + 1] = charsHigh;
  marks[m + 2] = pairs;
  marks[m + 3] = pairsHigh;
}

/** The column with each row's sketch. */
function textColumn(text: string, at: Uint32Array): TextColumn {
  const rows = at.length - 1;
  const marks = new Uint32Array(rows * 4);
  for (let r = 0; r < rows; r++) sketch(text, at[r], at[r + 1], marks, 4 * r);
  return { text, at, marks };
}

/** A word of the query, with its sketch (as a row's, as signed numbers, as `&` gives them back) and first two characters. */
interface Word {
  readonly text: string;
  readonly first: number;
  readonly second: number;
  readonly m0: number;
  readonly m1: number;
  readonly m2: number;
  readonly m3: number;
}

function word(text: string): Word {
  const m = new Uint32Array(4);
  sketch(text, 0, text.length, m, 0);
  const first = text.charCodeAt(0), second = text.charCodeAt(1);
  return { text, first, second, m0: m[0] | 0, m1: m[1] | 0, m2: m[2] | 0, m3: m[3] | 0 };
}

/** Whether a row's sketch has all of the word's bits: if not, it can't hold the word. */
function fits(marks: Uint32Array, row: number, w: Word): boolean {
  const m = 4 * row;
  return (marks[m] & w.m0) === w.m0 && (marks[m + 1] & w.m1) === w.m1
    && (marks[m + 2] & w.m2) === w.m2 && (marks[m + 3] & w.m3) === w.m3;
}

/** Whether text[from…to) holds the word. */
function reads(text: string, from: number, to: number, w: Word): boolean {
  const length = w.text.length;
  for (let i = from, last = to - length; i <= last; i++) {
    if (text.charCodeAt(i) !== w.first) continue;
    if (length === 1 || (text.charCodeAt(i + 1) === w.second && (length === 2 || text.startsWith(w.text, i)))) return true;
  }
  return false;
}

/** Whether the column's row holds the word: its sketch first, then, if that allows it, its text. */
const holds = ({ text, at, marks }: TextColumn, row: number, w: Word): boolean =>
  fits(marks, row, w) && reads(text, at[row], at[row + 1], w);

/**
 * Of the first `n` rows in index.kept, keeps (at the front) those whose id, artist, title or difficulty name hold
 * `w`, and returns how many. The old page looked for it in `${id} ${artist} ${title} ${version}`; a word, split at
 * spaces, can't run across two of them. A set's artist and title are read once for all its maps: for many maps, every
 * set first, in order (about twice as fast); for a few, only theirs.
 */
function keepWith(index: MapIndex, w: Word, n: number): number {
  const { kept, setHit } = index;
  const { artist, title, version, id } = mapText(index);
  const set = index.pack.maps.set;
  const sets = setHit.length;
  // 0 not checked for this word, 1 holds it, 2 doesn't.
  if (n >= sets) for (let s = 0; s < sets; s++) setHit[s] = holds(artist, s, w) || holds(title, s, w) ? 1 : 2;
  else setHit.fill(0);
  let m = 0;
  for (let k = 0; k < n; k++) {
    const i = kept[k];
    const s = set[i];
    let hit = setHit[s];
    if (!hit) setHit[s] = hit = holds(artist, s, w) || holds(title, s, w) ? 1 : 2;
    if (hit === 1 || holds(version, i, w) || holds(id, i, w)) kept[m++] = i;
  }
  return m;
}

/** `order` (rows) sorted by key[row] (0…65535), smallest first, ties kept in order: a counting sort. */
function sortBy(order: Uint32Array, key: Uint16Array): Uint32Array {
  const starts = new Uint32Array(0x10001);
  for (let j = 0; j < order.length; j++) starts[key[order[j]] + 1]++;
  for (let v = 1; v <= 0xffff; v++) starts[v] += starts[v - 1];
  const sorted = new Uint32Array(order.length);
  for (let j = 0; j < order.length; j++) sorted[starts[key[order[j]]]++] = order[j];
  return sorted;
}

/**
 * Every map in one of the old page's sorts: most players then lowest id, most stars, fewest stars with unknown (0)
 * last, or newest id. Its other ties kept the list's order, the pack's (by set, then id), as its sort was stable.
 */
function makeOrder({ maps }: SearchPack, sort: MapSort): Uint32Array {
  const n = maps.rows;
  const rows = new Uint32Array(n);
  for (let i = 0; i < n; i++) rows[i] = i;
  const key = new Uint16Array(n);
  if (sort === 'stars' || sort === 'easy') {
    for (let i = 0; i < n; i++) key[i] = sort === 'stars' ? 0xffff - maps.stars[i] : maps.stars[i] || 9900;
    return sortBy(rows, key);
  }
  // By id: its low half, then its high half.
  for (let i = 0; i < n; i++) key[i] = maps.id[i] & 0xffff;
  let byId = sortBy(rows, key);
  for (let i = 0; i < n; i++) key[i] = maps.id[i] >>> 16;
  byId = sortBy(byId, key);
  if (sort === 'new') return byId.reverse();
  for (let i = 0; i < n; i++) key[i] = 0xffff - maps.players[i];
  return sortBy(byId, key);
}

export function sortOrder(index: MapIndex, sort: MapSort): Uint32Array {
  let order = index.orders.get(sort);
  if (!order) index.orders.set(sort, order = makeOrder(index.pack, sort));
  return order;
}

/**
 * The maps (rows in the pack's `maps`) the query finds, in its sort's order: a plain list of numbers, as the pages'
 * paging (ui/page.ts paged(), client/dom.ts paginate()) takes it.
 */
export function findMaps(index: MapIndex, { q, cat, stars, sort }: MapQuery): number[] {
  const { maps } = index.pack;
  const order = sortOrder(index, sort);
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const code = CODE_OF[cat];
  const anyStars = isAnyStars(stars);
  const out: number[] = [];
  if (!words.length) {
    for (let j = 0; j < order.length; j++) {
      const i = order[j];
      if ((!code || maps.cat[i] === code) && (anyStars || inStars(index.stars[i], stars))) out.push(i);
    }
    return out;
  }
  // The maps in the category and range, in the pack's order; then each word keeps those of them that hold it, and
  // what's left comes out in the sort's order.
  const { kept, isKept } = index;
  let n = 0;
  for (let i = 0; i < maps.rows; i++) {
    if ((!code || maps.cat[i] === code) && (anyStars || inStars(index.stars[i], stars))) kept[n++] = i;
  }
  for (const text of words) n = keepWith(index, word(text), n);
  for (let k = 0; k < n; k++) isKept[kept[k]] = 1;
  for (let j = 0; j < order.length && out.length < n; j++) if (isKept[order[j]]) out.push(order[j]);
  for (let k = 0; k < n; k++) isKept[kept[k]] = 0;
  return out;
}
