// osu! replay files (.osr), for the score showcase's uploads (TOP10-DESIGN.md §13.9): only the header is read, never
// the compressed cursor data. The format (https://osu.ppy.sh/wiki/en/Client/File_formats/osr_(file_format)), all
// little-endian:
//
//   byte mode (2 = catch) · int version · string beatmap MD5 · string player · string replay MD5 ·
//   short 300s, 100s, 50s, gekis, katus, misses · int score · short max combo · byte perfect · int mods ·
//   string life bar · long timestamp (.NET ticks) · int length + that many bytes of LZMA data · long online score id
//
// A "string" is 0x00 (empty) or 0x0b, a ULEB128 length, then that many UTF-8 bytes. In catch, 300s are fruits, 100s
// drops, 50s droplets, katus missed droplets and misses missed fruits.

export const MAX_REPLAY_BYTES = 2 * 1024 * 1024;
const TICKS_AT_UNIX_EPOCH = 621355968000000000n;
const MOD_BITS = [
  ['NF', 1], ['EZ', 2], ['TD', 4], ['HD', 8], ['HR', 16], ['SD', 32], ['DT', 64], ['RX', 128], ['HT', 256], ['NC', 512],
  ['FL', 1024], ['AT', 2048], ['SO', 4096], ['AP', 8192], ['PF', 16384], ['CN', 4194304], ['V2', 536870912], ['MR', 1073741824],
];

/** A mods bitmask as acronyms, NC instead of DT and PF instead of SD, as osu! shows them. */
export function modNames(mods) {
  const names = MOD_BITS.filter(([, bit]) => (mods & bit) !== 0).map(([name]) => name);
  return names.filter(n => !(n === 'DT' && names.includes('NC')) && !(n === 'SD' && names.includes('PF')));
}

/**
 * The header of an .osr (an ArrayBuffer or Uint8Array): { mode, version, beatmapMd5, player, replayMd5, counts:
 * { n300, n100, n50, geki, katu, miss }, score, combo, perfect, mods, time (unix seconds), onlineId, accuracy (%) },
 * or null when it isn't a whole, sane replay header.
 */
export function parseOsr(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input ?? []);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = new TextDecoder('utf-8');
  let at = 0;
  const need = n => {
    if (n < 0 || at + n > bytes.length) throw new RangeError('The file ends too soon.');
  };
  const u8 = () => { need(1); return bytes[at++]; };
  const u16 = () => { need(2); const v = view.getUint16(at, true); at += 2; return v; };
  const i32 = () => { need(4); const v = view.getInt32(at, true); at += 4; return v; };
  const i64 = () => { need(8); const v = view.getBigInt64(at, true); at += 8; return v; };
  const uleb = () => {
    let value = 0;
    for (let shift = 0; shift < 35; shift += 7) {
      const b = u8();
      value += (b & 0x7f) * 2 ** shift;
      if (!(b & 0x80)) return value;
    }
    throw new RangeError('A length is too long.');
  };
  const string = () => {
    const flag = u8();
    if (flag === 0x00) return '';
    if (flag !== 0x0b) throw new RangeError('Not a string.');
    const length = uleb();
    need(length);
    const s = text.decode(bytes.subarray(at, at + length));
    at += length;
    return s;
  };
  try {
    const mode = u8();
    const version = i32();
    const beatmapMd5 = string().toLowerCase();
    const player = string();
    const replayMd5 = string().toLowerCase();
    const counts = { n300: u16(), n100: u16(), n50: u16(), geki: u16(), katu: u16(), miss: u16() };
    const score = i32();
    const combo = u16();
    const perfect = u8() === 1;
    const mods = i32() >>> 0;
    string(); // the life bar graph
    const ticks = i64();
    const dataLength = i32();
    need(dataLength);
    at += dataLength;
    const onlineId = at + 8 <= bytes.length ? i64() : 0n;
    const time = Number((ticks - TICKS_AT_UNIX_EPOCH) / 10000000n);
    if (mode > 3 || !/^[0-9a-f]{32}$/.test(beatmapMd5) || !player || player.length > 32 || /[\p{C}]/u.test(player)) return null;
    if (!(time > 946684800 && time < 4102444800)) return null; // 2000 to 2100
    const hits = counts.n300 + counts.n100 + counts.n50;
    const total = hits + counts.katu + counts.miss;
    return {
      mode, version, beatmapMd5, player, replayMd5, counts, score, combo, perfect, mods, time,
      onlineId: onlineId > 0n && onlineId <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(onlineId) : null,
      accuracy: total ? Math.round((hits / total) * 10000) / 100 : 0,
    };
  } catch {
    return null;
  }
}

/** The SHA-256 of some bytes, as 64 hex characters: a replay's name in R2. */
export async function sha256Hex(bytes) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * The name a replay downloads as: "<player> - <artist> - <title> [<version>] (<yyyy-mm-dd>).osr", without the map when
 * it isn't known, and without characters a file name can't have.
 */
export function replayFileName({ player, map, time }) {
  const clean = s => String(s ?? '').replace(/[\\/:*?"<>|\p{C}]/gu, '').replace(/\s+/g, ' ').trim();
  const date = new Date(time * 1000).toISOString().slice(0, 10);
  const mapPart = map && (map.artist || map.title) ? `${map.artist} - ${map.title}${map.version ? ` [${map.version}]` : ''}` : '';
  const stem = [clean(player), clean(mapPart)].filter(Boolean).join(' - ').slice(0, 150).trim() || 'replay';
  return `${stem} (${date}).osr`;
}

/** A Content-Disposition that downloads under `name`, with an ASCII fallback for older browsers. */
export function attachment(name) {
  const ascii = name.normalize('NFD').replace(/[^\x20-\x7e]/g, '').replace(/["\\]/g, '') || 'replay.osr';
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}
