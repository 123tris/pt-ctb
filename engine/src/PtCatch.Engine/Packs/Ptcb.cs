using System;
using System.Collections.Generic;
using System.Linq;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using PtCatch.Engine.Js;

namespace PtCatch.Engine.Packs;

/// <summary>A column's element type. The names are what the header says and what the TypeScript reader switches on.</summary>
public enum ColKind : byte
{
    U8,
    U16,
    U32,
    I32,
    F32,
    F64,
    /// <summary>
    /// u32 values stored as the difference from the previous one (wrapping), for ids in nearly increasing order: small
    /// numbers compress far better than the ids. The reader adds them back up into a Uint32Array.
    /// </summary>
    D32,
    /// <summary>UTF-8 strings: each one's byte length (u16), then the heap. The reader adds the lengths up into offsets.</summary>
    Str,
}

public sealed record Col(string Name, ColKind Kind, string Doc);

public sealed record TableSchema(string Name, string Doc, Col[] Cols);

/// <summary>A pack's tables and columns: the one definition the writer checks against and gen-ts turns into types.</summary>
public sealed record PackSchema(string Name, string Doc, TableSchema[] Tables)
{
    /// <summary>
    /// A short hash of the layout (names and kinds, not the docs). Packs carry it, the generated readers know it, and a
    /// reader that meets a pack of another layout says so instead of misreading it.
    /// </summary>
    public string Hash
    {
        get
        {
            var text = string.Join(";", Tables.Select(t => $"{t.Name}:{string.Join(",", t.Cols.Select(c => $"{c.Name}={c.Kind}"))}"));
            return Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes($"{Name}|{text}")))[..8];
        }
    }
}

/// <summary>
/// PTCB v1, the site's binary data packs. A browser reads one by wrapping each column in a typed array over the bytes it
/// downloaded: no parsing, no copies, no objects per row.
///
///   bytes 0-3   "PTCB"
///   bytes 4-7   u32 n, the length of the header
///   then n bytes of UTF-8 JSON: { v: 1, pack, hash, tables: { name: { rows, cols: { name: [kind, offset, (heap offset,
///               heap length)] } } } }
///   then the columns, each at an offset that's a multiple of 8 from the start, little-endian
///
/// A numeric column is rows elements, used where it lies. A d32 column is u32 differences and a string column is u16
/// byte lengths then the heap of UTF-8 bytes: both are added up once on reading (a prefix sum, about 0.1 ms for 50k
/// rows), because differences and lengths are small numbers and compress several times better than the values or
/// offsets themselves. The header is JSON because it's tiny and keeps the format easy to extend; everything with rows is
/// binary.
/// </summary>
public sealed class PackWriter
{
    private readonly PackSchema schema;
    private readonly Dictionary<string, (int Rows, Dictionary<string, object> Cols)> tables = new();

    public PackWriter(PackSchema schema)
    {
        this.schema = schema;
    }

    /// <summary>Starts a table of the schema with this many rows; its columns are given with <see cref="Column"/>.</summary>
    public PackWriter Table(string name, int rows)
    {
        if (schema.Tables.All(t => t.Name != name))
        {
            throw new ArgumentException($"{schema.Name} has no table {name}");
        }
        tables[name] = (rows, new Dictionary<string, object>());
        return this;
    }

    /// <summary>One column's values (an array of the kind's element type, or strings), as many as the table has rows.</summary>
    public PackWriter Column(string table, string name, Array values)
    {
        var (rows, cols) = tables[table];
        var col = schema.Tables.First(t => t.Name == table).Cols.FirstOrDefault(c => c.Name == name)
            ?? throw new ArgumentException($"{schema.Name}.{table} has no column {name}");
        var expected = col.Kind switch
        {
            ColKind.U8 => typeof(byte[]),
            ColKind.U16 => typeof(ushort[]),
            ColKind.U32 => typeof(uint[]),
            ColKind.I32 => typeof(int[]),
            ColKind.F32 => typeof(float[]),
            ColKind.F64 => typeof(double[]),
            ColKind.D32 => typeof(uint[]),
            _ => typeof(string[]),
        };
        if (values.GetType() != expected || values.Length != rows)
        {
            throw new ArgumentException($"{schema.Name}.{table}.{name}: {rows} {expected.Name} wanted, got {values.Length} {values.GetType().Name}");
        }
        cols[name] = values;
        return this;
    }

    public byte[] ToArray()
    {
        if (!BitConverter.IsLittleEndian)
        {
            throw new PlatformNotSupportedException("PTCB packs are little-endian");
        }
        // Lay the columns out first, so the header can say where each is.
        var blocks = new List<byte[]>();
        var header = JsNode.Object().Set("v", 1).Set("pack", schema.Name).Set("hash", schema.Hash);
        var tablesNode = JsNode.Object();
        var places = new List<(JsNode Entry, int Block, int HeapBlock)>();
        foreach (var t in schema.Tables)
        {
            if (!tables.TryGetValue(t.Name, out var table))
            {
                throw new InvalidOperationException($"{schema.Name}.{t.Name} wasn't written");
            }
            var colsNode = JsNode.Object();
            foreach (var c in t.Cols)
            {
                if (!table.Cols.TryGetValue(c.Name, out var values))
                {
                    throw new InvalidOperationException($"{schema.Name}.{t.Name}.{c.Name} wasn't written");
                }
                var entry = JsNode.ArrayOf(JsNode.Str(KindName(c.Kind)));
                if (c.Kind == ColKind.Str)
                {
                    var strings = (string[])values;
                    var lengths = new ushort[strings.Length];
                    var heap = new List<byte>();
                    for (var i = 0; i < strings.Length; i++)
                    {
                        var bytes = Encoding.UTF8.GetBytes(strings[i] ?? "");
                        if (bytes.Length > ushort.MaxValue)
                        {
                            throw new ArgumentException($"{schema.Name}.{t.Name}.{c.Name}[{i}] is longer than a string column holds");
                        }
                        lengths[i] = (ushort)bytes.Length;
                        heap.AddRange(bytes);
                    }
                    blocks.Add(MemoryMarshal.AsBytes(lengths.AsSpan()).ToArray());
                    blocks.Add(heap.ToArray());
                    places.Add((entry, blocks.Count - 2, blocks.Count - 1));
                }
                else if (c.Kind == ColKind.D32)
                {
                    var ids = (uint[])values;
                    var deltas = new uint[ids.Length];
                    uint previous = 0;
                    for (var i = 0; i < ids.Length; i++)
                    {
                        deltas[i] = unchecked(ids[i] - previous);
                        previous = ids[i];
                    }
                    blocks.Add(MemoryMarshal.AsBytes(deltas.AsSpan()).ToArray());
                    places.Add((entry, blocks.Count - 1, -1));
                }
                else
                {
                    blocks.Add(Bytes((Array)values));
                    places.Add((entry, blocks.Count - 1, -1));
                }
                colsNode.Set(c.Name, entry);
            }
            tablesNode.Set(t.Name, JsNode.Object().Set("rows", table.Rows).Set("cols", colsNode));
        }
        header.Set("tables", tablesNode);

        // The header's length depends on the offsets it lists, and they on it: settle it by padding the header.
        var reserve = 64 + schema.Tables.Sum(t => t.Cols.Length) * 32;
        for (var attempt = 0; ; attempt++)
        {
            var start = Align(8 + reserve);
            var offsets = new int[blocks.Count];
            var at = start;
            for (var i = 0; i < blocks.Count; i++)
            {
                offsets[i] = at;
                at = Align(at + blocks[i].Length);
            }
            foreach (var (entry, block, heap) in places)
            {
                while (entry.Count > 1)
                {
                    ((List<JsNode>)entry.Items).RemoveAt(entry.Count - 1);
                }
                entry.Add(offsets[block]);
                if (heap >= 0)
                {
                    entry.Add(offsets[heap]);
                    entry.Add(blocks[heap].Length);
                }
            }
            var json = Encoding.UTF8.GetBytes(header.Stringify());
            if (json.Length > reserve)
            {
                reserve = json.Length + 64;
                continue;
            }
            var output = new byte[at];
            "PTCB"u8.CopyTo(output);
            BitConverter.TryWriteBytes(output.AsSpan(4), (uint)reserve);
            json.CopyTo(output.AsSpan(8));
            output.AsSpan(8 + json.Length, reserve - json.Length).Fill((byte)' ');
            for (var i = 0; i < blocks.Count; i++)
            {
                blocks[i].CopyTo(output.AsSpan(offsets[i]));
            }
            return output;
        }
    }

    private static int Align(int n) => (n + 7) & ~7;

    public static string KindName(ColKind kind) => kind switch
    {
        ColKind.U8 => "u8",
        ColKind.U16 => "u16",
        ColKind.U32 => "u32",
        ColKind.I32 => "i32",
        ColKind.F32 => "f32",
        ColKind.F64 => "f64",
        ColKind.D32 => "d32",
        _ => "str",
    };

    private static byte[] Bytes(Array values) => values switch
    {
        byte[] a => a.ToArray(),
        ushort[] a => MemoryMarshal.AsBytes(a.AsSpan()).ToArray(),
        uint[] a => MemoryMarshal.AsBytes(a.AsSpan()).ToArray(),
        int[] a => MemoryMarshal.AsBytes(a.AsSpan()).ToArray(),
        float[] a => MemoryMarshal.AsBytes(a.AsSpan()).ToArray(),
        double[] a => MemoryMarshal.AsBytes(a.AsSpan()).ToArray(),
        _ => throw new ArgumentException("not a numeric column"),
    };
}
