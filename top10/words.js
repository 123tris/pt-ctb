// Words and flags for Top 10 write-ups (TOP10-DESIGN.md §13.4). The server is the authority: it counts and flags every
// write-up it saves, and the bot pays from those numbers. The ballot page mirrors these rules for its live counter, so
// keep this file plain JavaScript with no imports.
//
// Words: the text is split on whitespace, and punctuation and symbols are stripped from each token's ends. A token
// counts when it has 2 or more letters (\p{L}), isn't a link, and is at most 30 characters long. So "6 miss HR on
// Uncontrollable!" is 4 words ("6" has no letters), emoji and bare numbers never count, and Portuguese works as English
// does ("é" is 1 letter, "não" is a word).
//
// Flags (a flagged write-up is saved and shown, but pays 0 until a mod clears it):
//   repetitive  8 or more words, and fewer than half of them unique (case-folded)
//   copy        70% or more of its word 3-shingles also appear in another write-up (on this ballot or any other)
//   mash        more than 20% of its words have no vowel (aeiouyáàâãéêíóôõú) and are 6 or more characters long
// "Tokens" in the mash rule are read as the counted words: a token that doesn't count can't earn anything to flag.

export const MAX_WORD = 30;
export const COPY_SHARE = 0.7;
export const REPEAT_MIN = 8;
export const MASH_SHARE = 0.2;
export const MASH_LENGTH = 6;
export const FLAGS = ['repetitive', 'copy', 'mash'];

// Punctuation, symbols (emoji included), format characters (zero-width joiners) and variation selectors.
const EDGES = /^[\p{P}\p{S}\p{Cf}︀-️]+|[\p{P}\p{S}\p{Cf}︀-️]+$/gu;
const LETTER = /\p{L}/gu;
const VOWEL = /[aeiouyáàâãéêíóôõú]/u;
const TLDS = 'com|net|org|pt|sh|gg|io|tv|be|me|ly|co|uk|br|eu|xyz|app|dev|info';
const LINK = new RegExp(`^(?:[a-z][a-z0-9+.-]*://|www\\.|[\\p{L}\\p{N}-]+(?:\\.[\\p{L}\\p{N}-]+)+/|(?:[\\p{L}\\p{N}-]+\\.)+(?:${TLDS})$)`, 'iu');

/** The tokens of a text: split on whitespace, with punctuation and symbols stripped from their ends. */
export function tokens(text) {
  if (typeof text !== 'string') return [];
  return text.normalize('NFC').split(/\s+/u).map(t => t.replace(EDGES, '')).filter(Boolean);
}

/** Whether a token counts as a word. */
export function isWord(token) {
  if ([...token].length > MAX_WORD) return false;
  if ((token.match(LETTER) ?? []).length < 2) return false;
  return !LINK.test(token);
}

/** The text's words, case-folded. */
export const words = text => tokens(text).filter(isWord).map(w => w.toLowerCase());

/** How many words the text has. */
export const countWords = text => words(text).length;

/** The text's word 3-shingles ("a b c"), as a Set; empty below 3 words. Takes the text or its words. */
export function shingles(textOrWords) {
  const list = Array.isArray(textOrWords) ? textOrWords : words(textOrWords);
  const out = new Set();
  for (let i = 0; i + 2 < list.length; i++) out.add(`${list[i]} ${list[i + 1]} ${list[i + 2]}`);
  return out;
}

/** The share of `a`'s shingles that are also in `b` (0 when `a` has none). */
export function overlap(a, b) {
  if (!a.size) return 0;
  let shared = 0;
  for (const s of a) if (b.has(s)) shared++;
  return shared / a.size;
}

/**
 * A write-up's word count and flags. `others` are the write-ups to check it against for copying: their texts, or
 * their shingle Sets. Returns { words, flags: [...] } with the flags in FLAGS order.
 */
export function analyse(body, others = []) {
  const list = words(body);
  const flags = [];
  if (list.length >= REPEAT_MIN && new Set(list).size < list.length / 2) flags.push('repetitive');
  const mine = shingles(list);
  if (mine.size && others.some(o => overlap(mine, o instanceof Set ? o : shingles(o)) >= COPY_SHARE)) flags.push('copy');
  const mashed = list.filter(w => [...w].length >= MASH_LENGTH && !VOWEL.test(w)).length;
  if (list.length && mashed > list.length * MASH_SHARE) flags.push('mash');
  return { words: list.length, flags };
}

/** What a write-up pays the writer in bananas (the bot's rule, §9): 1 per 4 words, at most 10. */
export const bananasFor = n => Math.min(10, Math.floor(n / 4));
