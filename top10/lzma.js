// A small LZMA decoder, for the score info osu! lazer appends to the replays it writes (top10/osr.js): a few hundred
// bytes of JSON in the "LZMA alone" framing, which is 5 property bytes (lc/lp/pb, then the dictionary size), the
// uncompressed size (8 bytes, little-endian; all ones when it isn't known and an end marker closes the stream), then
// the stream itself. A port of the reference decoder in Igor Pavlov's LZMA SDK (LzmaSpec.cpp, public domain): only
// what decoding needs, and bounded, since the bytes come from an upload: at most `maxOut` bytes out, and any read past
// the end, bad property or impossible distance answers null.

const PROB_INIT = 1024; // half of 1 << 11
const TOP = 2 ** 24;
const STATES = 12;
const POS_BITS_MAX = 4;
const END_POS_MODEL = 14;
const FULL_DISTANCES = 128;
const ALIGN_BITS = 4;
const LEN_TO_POS_STATES = 4;
const MATCH_MIN_LEN = 2;

class Corrupt extends Error {}

const probs = n => new Uint16Array(n).fill(PROB_INIT);

/** The range decoder over `bytes` from `at`. Range and code are kept as plain numbers below 2^32. */
function rangeDecoder(bytes, at) {
  const next = () => {
    if (at >= bytes.length) throw new Corrupt('The stream ends too soon.');
    return bytes[at++];
  };
  if (next() !== 0) throw new Corrupt('A bad first byte.');
  let range = 0xffffffff;
  let code = 0;
  for (let i = 0; i < 4; i++) code = code * 256 + next();
  if (code === range) throw new Corrupt('A bad start.');
  const normalize = () => {
    if (range < TOP) { range *= 256; code = code * 256 + next(); }
  };
  return {
    bit(p, i) {
      const v = p[i];
      const bound = (range >>> 11) * v;
      let bit;
      if (code < bound) { p[i] = v + ((2048 - v) >>> 5); range = bound; bit = 0; }
      else { p[i] = v - (v >>> 5); code -= bound; range -= bound; bit = 1; }
      normalize();
      return bit;
    },
    direct(count) {
      let res = 0;
      for (let i = 0; i < count; i++) {
        range = Math.floor(range / 2);
        let bit = 0;
        if (code >= range) { code -= range; bit = 1; }
        if (code === range) throw new Corrupt('A bad direct bit.');
        normalize();
        res = res * 2 + bit;
      }
      return res;
    },
  };
}

const tree = (rc, p, bits, offset = 0) => {
  let m = 1;
  for (let i = 0; i < bits; i++) m = (m << 1) + rc.bit(p, offset + m);
  return m - (1 << bits);
};
const reverseTree = (rc, p, bits, offset = 0) => {
  let m = 1;
  let symbol = 0;
  for (let i = 0; i < bits; i++) {
    const bit = rc.bit(p, offset + m);
    m = (m << 1) + bit;
    symbol |= bit << i;
  }
  return symbol;
};

/** A length decoder's probabilities: choice, choice 2, low and mid trees per position state, and the high tree. */
const lengthProbs = () => ({ choice: probs(2), low: probs(8 << POS_BITS_MAX), mid: probs(8 << POS_BITS_MAX), high: probs(256) });
const decodeLength = (rc, l, posState) => {
  if (rc.bit(l.choice, 0) === 0) return tree(rc, l.low, 3, posState << 3);
  if (rc.bit(l.choice, 1) === 0) return 8 + tree(rc, l.mid, 3, posState << 3);
  return 16 + tree(rc, l.high, 8);
};

/**
 * The bytes an "LZMA alone" stream holds, or null when it isn't one, is cut short, is corrupt or would come to more
 * than `maxOut` bytes.
 */
export function lzmaDecode(input, { maxOut = 64 * 1024 } = {}) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input ?? []);
  if (bytes.length < 13) return null;
  let d = bytes[0];
  if (d >= 9 * 5 * 5) return null;
  const lc = d % 9; d = Math.floor(d / 9);
  const lp = d % 5;
  const pb = Math.floor(d / 5);
  if (lc + lp > 4) return null; // as LZMA2 allows; osu! (and every common encoder) uses lc 3, lp 0
  let dictSize = 0;
  for (let i = 0; i < 4; i++) dictSize += bytes[1 + i] * 2 ** (8 * i);
  dictSize = Math.max(dictSize, 4096);
  let known = false;
  let size = 0;
  for (let i = 0; i < 8; i++) {
    if (bytes[5 + i] !== 0xff) known = true;
    size += bytes[5 + i] * 2 ** (8 * i);
  }
  if (known && size > maxOut) return null;

  const out = new Uint8Array(known ? size : maxOut);
  let n = 0;
  try {
    const rc = rangeDecoder(bytes, 13);
    const literal = probs(0x300 << (lc + lp));
    const posSlot = Array.from({ length: LEN_TO_POS_STATES }, () => probs(64));
    const posDecoders = probs(1 + FULL_DISTANCES - END_POS_MODEL);
    const align = probs(1 << ALIGN_BITS);
    const isMatch = probs(STATES << POS_BITS_MAX);
    const isRep = probs(STATES);
    const isRepG0 = probs(STATES);
    const isRepG1 = probs(STATES);
    const isRepG2 = probs(STATES);
    const isRep0Long = probs(STATES << POS_BITS_MAX);
    const lens = lengthProbs();
    const repLens = lengthProbs();
    const pbMask = (1 << pb) - 1;
    const lpMask = (1 << lp) - 1;
    let state = 0;
    let rep0 = 0, rep1 = 0, rep2 = 0, rep3 = 0;
    const put = b => {
      if (n >= out.length) throw new Corrupt('More than the room there is.');
      out[n++] = b;
    };

    while (!known || n < size) {
      const posState = n & pbMask;
      if (rc.bit(isMatch, (state << POS_BITS_MAX) + posState) === 0) {
        // A literal, coded against the byte at rep0 right after a match.
        const prev = n > 0 ? out[n - 1] : 0;
        const base = 0x300 * (((n & lpMask) << lc) + (prev >> (8 - lc)));
        let symbol = 1;
        if (state >= 7) {
          if (rep0 >= n) throw new Corrupt('A literal after a match outside the data.');
          let matchByte = out[n - rep0 - 1];
          do {
            const matchBit = (matchByte >> 7) & 1;
            matchByte <<= 1;
            const bit = rc.bit(literal, base + ((1 + matchBit) << 8) + symbol);
            symbol = (symbol << 1) | bit;
            if (matchBit !== bit) break;
          } while (symbol < 0x100);
        }
        while (symbol < 0x100) symbol = (symbol << 1) | rc.bit(literal, base + symbol);
        put(symbol - 0x100);
        state = state < 4 ? 0 : state < 10 ? state - 3 : state - 6;
        continue;
      }
      let len;
      if (rc.bit(isRep, state) !== 0) {
        if (n === 0) throw new Corrupt('A repeat before any data.');
        if (rc.bit(isRepG0, state) === 0) {
          if (rc.bit(isRep0Long, (state << POS_BITS_MAX) + posState) === 0) {
            // A short repeat: one byte from rep0.
            state = state < 7 ? 9 : 11;
            put(out[n - rep0 - 1]);
            continue;
          }
        } else {
          let dist;
          if (rc.bit(isRepG1, state) === 0) dist = rep1;
          else {
            if (rc.bit(isRepG2, state) === 0) dist = rep2;
            else { dist = rep3; rep3 = rep2; }
            rep2 = rep1;
          }
          rep1 = rep0;
          rep0 = dist;
        }
        len = decodeLength(rc, repLens, posState);
        state = state < 7 ? 8 : 11;
      } else {
        rep3 = rep2; rep2 = rep1; rep1 = rep0;
        len = decodeLength(rc, lens, posState);
        state = state < 7 ? 7 : 10;
        // The distance: a slot, then the bits under it.
        const slot = tree(rc, posSlot[Math.min(len, LEN_TO_POS_STATES - 1)], 6);
        if (slot < 4) rep0 = slot;
        else {
          const direct = (slot >> 1) - 1;
          let dist = (2 + (slot & 1)) * 2 ** direct;
          if (slot < END_POS_MODEL) dist += reverseTree(rc, posDecoders, direct, dist - slot);
          else dist += rc.direct(direct - ALIGN_BITS) * 2 ** ALIGN_BITS + reverseTree(rc, align, ALIGN_BITS);
          rep0 = dist;
        }
        if (rep0 === 0xffffffff) break; // the end marker
        if (rep0 >= dictSize || rep0 >= n) throw new Corrupt('A distance outside the data.');
      }
      len += MATCH_MIN_LEN;
      if (known && len > size - n) throw new Corrupt('A match past the end.');
      for (let i = 0; i < len; i++) put(out[n - rep0 - 1]);
    }
  } catch (e) {
    if (e instanceof Corrupt) return null;
    throw e;
  }
  return known ? out : out.slice(0, n);
}
