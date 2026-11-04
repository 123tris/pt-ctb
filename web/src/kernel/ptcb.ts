// PTCB v1, the site's binary data packs (engine/src/PtCatch.Engine/Packs/Ptcb.cs writes them). A pack is a short JSON
// header and then columns; reading one wraps each column in a typed array over the downloaded bytes, so there's no
// parsing, no copying and no object per row. Strings are decoded one at a time, when shown, and kept.
//
// Layout: "PTCB", a u32 header length n, n bytes of JSON ({ v, pack, hash, tables: { name: { rows, cols: { name:
// [kind, offset, (heap offset, heap length)] } } } }), then the columns, little-endian, each 8-aligned from the start.
// Numeric columns are used where they lie. A d32 column (ids as differences) and a string column (u16 byte lengths, then
// the heap) are added up once here, which costs about 0.1 ms for 50k rows and lets them compress far better.

export type Column = Uint8Array | Uint16Array | Uint32Array | Int32Array | Float32Array | Float64Array | StrColumn;

export interface Table {
  rows: number;
  [column: string]: Column | number;
}

const decoder = new TextDecoder();
const littleEndian = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;

/** A string column: each row's offset into a UTF-8 heap (rows + 1 of them, the last being the heap's length). */
export class StrColumn {
  readonly offsets: Uint32Array;
  readonly bytes: Uint8Array;
  private readonly cache: (string | undefined)[];

  constructor(offsets: Uint32Array, bytes: Uint8Array) {
    this.offsets = offsets;
    this.bytes = bytes;
    this.cache = new Array(offsets.length - 1);
  }

  get length(): number {
    return this.offsets.length - 1;
  }

  /** Row i's string, decoded the first time it's asked for. */
  at(i: number): string {
    let s = this.cache[i];
    if (s === undefined) {
      s = decoder.decode(this.bytes.subarray(this.offsets[i], this.offsets[i + 1]));
      this.cache[i] = s;
    }
    return s;
  }

  /** Row i's UTF-8 bytes, without decoding (to search in place). */
  bytesAt(i: number): Uint8Array {
    return this.bytes.subarray(this.offsets[i], this.offsets[i + 1]);
  }
}

/** Thrown for a pack of another layout than the code expects: the page should reload to get matching code. */
export class PackMismatch extends Error {
  constructor(pack: string, expected: string, found: string) {
    super(`The ${pack} data has layout ${found}, this code reads ${expected}`);
    this.name = 'PackMismatch';
  }
}

/** Reads a pack's tables. The generated readers (gen/packs.ts) give the result its type. */
export function readPack(buffer: ArrayBuffer, pack: string, hash: string): Record<string, Table> {
  if (!littleEndian) throw new Error('PTCB packs are little-endian and this device is not');
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== 0x42435450) throw new Error(`Not a PTCB pack (${pack})`);
  const length = view.getUint32(4, true);
  const header = JSON.parse(decoder.decode(new Uint8Array(buffer, 8, length)));
  if (header.v !== 1 || header.pack !== pack) throw new Error(`Expected a v1 ${pack} pack, got v${header.v} ${header.pack}`);
  if (header.hash !== hash) throw new PackMismatch(pack, hash, header.hash);
  const tables: Record<string, Table> = {};
  for (const [name, { rows, cols }] of Object.entries(header.tables as Record<string, { rows: number; cols: Record<string, [string, number, number?, number?]> }>)) {
    const table: Table = { rows };
    for (const [col, [kind, offset, heap, heapLength]] of Object.entries(cols)) {
      table[col] = column(buffer, kind, offset, rows, heap, heapLength);
    }
    tables[name] = table;
  }
  return tables;
}

function column(buffer: ArrayBuffer, kind: string, offset: number, rows: number, heap?: number, heapLength?: number): Column {
  switch (kind) {
    case 'u8': return new Uint8Array(buffer, offset, rows);
    case 'u16': return new Uint16Array(buffer, offset, rows);
    case 'u32': return new Uint32Array(buffer, offset, rows);
    case 'i32': return new Int32Array(buffer, offset, rows);
    case 'f32': return new Float32Array(buffer, offset, rows);
    case 'f64': return new Float64Array(buffer, offset, rows);
    case 'd32': {
      const deltas = new Uint32Array(buffer, offset, rows);
      const values = new Uint32Array(rows);
      let value = 0;
      for (let i = 0; i < rows; i++) values[i] = value = (value + deltas[i]) >>> 0;
      return values;
    }
    case 'str': {
      const lengths = new Uint16Array(buffer, offset, rows);
      const offsets = new Uint32Array(rows + 1);
      for (let i = 0; i < rows; i++) offsets[i + 1] = offsets[i] + lengths[i];
      return new StrColumn(offsets, new Uint8Array(buffer, heap ?? 0, heapLength ?? 0));
    }
    default: throw new Error(`Unknown column kind ${kind}`);
  }
}
