using System;
using System.IO;
using System.IO.Compression;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using PtCatch.Engine.Js;
using PtCatch.Engine.World;

namespace PtCatch.Engine.Ingest;

/// <summary>
/// The bot's beatmap cache (beatmaps.json, ~237k maps, 171 MB; or the gzipped copy the data repo commits). Parsing it is
/// most of a cold run's load time, and it changes far less often than the scores, so the parsed columns are kept in a
/// binary file next to the exporter's state and reused while the source file's size and time are the same.
/// </summary>
public static class BeatmapReader
{
    private const uint Magic = 0x42435450; // "PTCB"
    private const int FormatVersion = 2;

    /// <summary>Which file the exporter reads: the plain one unless the gzipped copy is newer (source.mjs).</summary>
    public static string SourceFile(string root)
    {
        var plain = Path.Combine(root, "beatmaps.json");
        var gz = Path.Combine(root, "beatmaps.json.gz");
        var usePlain = File.Exists(plain) && (!File.Exists(gz) || File.GetLastWriteTimeUtc(plain) >= File.GetLastWriteTimeUtc(gz));
        return usePlain ? plain : File.Exists(gz) ? gz : null;
    }

    /// <summary>Every map in the bot's cache, from the binary copy when it's current.</summary>
    public static Beatmaps ReadAll(string root, string binaryCache, Action<string> log = null)
    {
        var source = SourceFile(root);
        if (source == null)
        {
            return new Beatmaps(0);
        }
        var info = new FileInfo(source);
        var fingerprint = $"{Path.GetFileName(source)}|{info.Length}|{info.LastWriteTimeUtc.Ticks}";
        if (binaryCache != null && File.Exists(binaryCache))
        {
            try
            {
                var cached = LoadBinary(binaryCache, fingerprint);
                if (cached != null)
                {
                    return cached;
                }
            }
            catch (Exception e) when (e is IOException or InvalidDataException or EndOfStreamException)
            {
                log?.Invoke($"  the beatmap column cache won't read ({e.Message}); rebuilding it");
            }
        }
        var bytes = source.EndsWith(".gz", StringComparison.OrdinalIgnoreCase) ? Gunzip(source) : File.ReadAllBytes(source);
        var maps = Parse(bytes);
        if (binaryCache != null)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(binaryCache)));
            SaveBinary(binaryCache + ".tmp", fingerprint, maps);
            File.Move(binaryCache + ".tmp", binaryCache, true);
        }
        return maps;
    }

    private static byte[] Gunzip(string file)
    {
        using var input = File.OpenRead(file);
        using var gz = new GZipStream(input, CompressionMode.Decompress);
        using var output = new MemoryStream((int)Math.Min(int.MaxValue / 2, input.Length * 7));
        gz.CopyTo(output, 1 << 20);
        return output.GetBuffer().AsSpan(0, (int)output.Length).ToArray();
    }

    /// <summary>Parses beatmaps.json's array of the bot's beatmap objects into columns.</summary>
    public static Beatmaps Parse(ReadOnlySpan<byte> json)
    {
        if (json.StartsWith((ReadOnlySpan<byte>)[0xEF, 0xBB, 0xBF]))
        {
            json = json[3..];
        }
        var maps = new Beatmaps(Math.Max(16, json.Length / 700));
        var reader = new Utf8JsonReader(json, new JsonReaderOptions { MaxDepth = 64 });
        reader.Read();
        if (reader.TokenType != JsonTokenType.StartArray)
        {
            throw new InvalidDataException("beatmaps.json isn't an array");
        }
        var row = new RowFields();
        while (reader.Read() && reader.TokenType == JsonTokenType.StartObject)
        {
            row.Reset();
            ReadObject(ref reader, ref row);
            if (row.Id == null)
            {
                continue;
            }
            var r = maps.Upsert(row.Id.Value);
            row.Store(maps, r);
        }
        return maps;
    }

    /// <summary>One beatmap object's fields while it's read.</summary>
    internal struct RowFields
    {
        public int? Id;
        public double SetId, Approved, Mode, Stars, Ar, Cs, Od, Hp, Bpm, HitLength, MaxCombo, Playcount, Favourites;
        public bool StarsNull, CatchDifficulty;
        public string ApprovedDate, LastUpdate, Artist, Title, Version, Creator;

        public void Reset()
        {
            this = default;
            Approved = double.NaN;
            Mode = double.NaN;
            StarsNull = true;
        }

        public readonly void Store(Beatmaps maps, int r)
        {
            maps.SetId[r] = double.IsNaN(SetId) ? 0 : (int)SetId;
            maps.Approved[r] = Approved;
            maps.Mode[r] = Mode;
            maps.ApprovedDate[r] = ApprovedDate;
            maps.LastUpdate[r] = LastUpdate;
            maps.Artist[r] = Artist;
            maps.Title[r] = Title;
            maps.Version[r] = Version;
            maps.Creator[r] = Creator;
            maps.Stars[r] = StarsNull ? 0 : Stars;
            maps.StarsNull[r] = StarsNull;
            maps.Ar[r] = Ar;
            maps.Cs[r] = Cs;
            maps.Od[r] = Od;
            maps.Hp[r] = Hp;
            maps.Bpm[r] = Bpm;
            maps.HitLength[r] = HitLength;
            maps.MaxCombo[r] = MaxCombo;
            maps.CatchDifficulty[r] = CatchDifficulty;
            maps.Playcount[r] = Playcount;
            maps.Favourites[r] = Favourites;
        }
    }

    internal static void ReadObject(ref Utf8JsonReader reader, ref RowFields row)
    {
        while (reader.Read() && reader.TokenType == JsonTokenType.PropertyName)
        {
            var name = reader.ValueSpan;
            reader.Read();
            switch (name.Length)
            {
                case 5 when name.SequenceEqual("title"u8): row.Title = Text(ref reader); break;
                case 6 when name.SequenceEqual("artist"u8): row.Artist = Text(ref reader); break;
                case 7 when name.SequenceEqual("version"u8): row.Version = Text(ref reader); break;
                case 7 when name.SequenceEqual("creator"u8): row.Creator = Text(ref reader); break;
                case 8 when name.SequenceEqual("approved"u8): row.Approved = ToNumber(ref reader); break;
                case 8 when name.SequenceEqual("playmode"u8): row.Mode = ToNumber(ref reader); break;
                case 3 when name.SequenceEqual("bpm"u8): row.Bpm = Num(ref reader); break;
                case 9 when name.SequenceEqual("diff_size"u8): row.Cs = Num(ref reader); break;
                case 9 when name.SequenceEqual("max_combo"u8): row.MaxCombo = Num(ref reader); break;
                case 9 when name.SequenceEqual("playcount"u8): row.Playcount = Num(ref reader); break;
                case 10 when name.SequenceEqual("beatmap_id"u8):
                    if (reader.TokenType == JsonTokenType.Number)
                    {
                        row.Id = (int)reader.GetDouble();
                    }
                    break;
                case 10 when name.SequenceEqual("diff_drain"u8): row.Hp = Num(ref reader); break;
                case 11 when name.SequenceEqual("last_update"u8): row.LastUpdate = Text(ref reader); break;
                case 10 when name.SequenceEqual("hit_length"u8): row.HitLength = Num(ref reader); break;
                case 12 when name.SequenceEqual("diff_overall"u8): row.Od = Num(ref reader); break;
                case 13 when name.SequenceEqual("approved_date"u8): row.ApprovedDate = Text(ref reader); break;
                case 13 when name.SequenceEqual("beatmapset_id"u8): row.SetId = Num(ref reader); break;
                case 13 when name.SequenceEqual("diff_approach"u8): row.Ar = Num(ref reader); break;
                case 15 when name.SequenceEqual("favourite_count"u8): row.Favourites = Num(ref reader); break;
                case 16 when name.SequenceEqual("difficultyrating"u8):
                    if (reader.TokenType == JsonTokenType.Number)
                    {
                        row.Stars = reader.GetDouble();
                        row.StarsNull = false;
                    }
                    break;
                case 16 when name.SequenceEqual("catch_difficulty"u8): row.CatchDifficulty = reader.TokenType == JsonTokenType.True; break;
                default:
                    reader.Skip();
                    break;
            }
        }
    }

    private static string Text(ref Utf8JsonReader reader) => reader.TokenType == JsonTokenType.String ? reader.GetString() : null;

    /// <summary>A numeric field read through <c>?? 0</c>: null or not a number is 0.</summary>
    private static double Num(ref Utf8JsonReader reader) => reader.TokenType == JsonTokenType.Number ? reader.GetDouble() : 0;

    /// <summary>JavaScript's <c>Number(x)</c> of a field that may be a number or a numeric string.</summary>
    private static double ToNumber(ref Utf8JsonReader reader) => reader.TokenType switch
    {
        JsonTokenType.Number => reader.GetDouble(),
        JsonTokenType.String => JsNode.StringToNumber(reader.GetString()),
        JsonTokenType.Null => 0,
        JsonTokenType.True => 1,
        JsonTokenType.False => 0,
        _ => double.NaN,
    };

    // ---- The binary copy ---------------------------------------------------------------------------------------

    private static void SaveBinary(string file, string fingerprint, Beatmaps m)
    {
        using var stream = new FileStream(file, FileMode.Create, FileAccess.Write, FileShare.None, 1 << 20);
        using var w = new BinaryWriter(stream, Encoding.UTF8);
        w.Write(Magic);
        w.Write(FormatVersion);
        w.Write(fingerprint);
        var n = m.Count;
        w.Write(n);
        Ints(w, m.Id, n);
        Ints(w, m.SetId, n);
        Doubles(w, m.Approved, n);
        Doubles(w, m.Mode, n);
        Doubles(w, m.Stars, n);
        Bools(w, m.StarsNull, n);
        Doubles(w, m.Ar, n);
        Doubles(w, m.Cs, n);
        Doubles(w, m.Od, n);
        Doubles(w, m.Hp, n);
        Doubles(w, m.Bpm, n);
        Doubles(w, m.HitLength, n);
        Doubles(w, m.MaxCombo, n);
        Bools(w, m.CatchDifficulty, n);
        Doubles(w, m.Playcount, n);
        Doubles(w, m.Favourites, n);
        Strings(w, m.ApprovedDate, n);
        Strings(w, m.LastUpdate, n);
        Strings(w, m.Artist, n);
        Strings(w, m.Title, n);
        Strings(w, m.Version, n);
        Strings(w, m.Creator, n);
    }

    private static Beatmaps LoadBinary(string file, string fingerprint)
    {
        var bytes = File.ReadAllBytes(file);
        var r = new SpanReader(bytes);
        if (r.UInt() != Magic || r.Int() != FormatVersion || r.String() != fingerprint)
        {
            return null;
        }
        var n = r.Int();
        var m = new Beatmaps(n);
        r.Ints(m.Id, n);
        r.Ints(m.SetId, n);
        r.Doubles(m.Approved, n);
        r.Doubles(m.Mode, n);
        r.Doubles(m.Stars, n);
        r.Bools(m.StarsNull, n);
        r.Doubles(m.Ar, n);
        r.Doubles(m.Cs, n);
        r.Doubles(m.Od, n);
        r.Doubles(m.Hp, n);
        r.Doubles(m.Bpm, n);
        r.Doubles(m.HitLength, n);
        r.Doubles(m.MaxCombo, n);
        r.Bools(m.CatchDifficulty, n);
        r.Doubles(m.Playcount, n);
        r.Doubles(m.Favourites, n);
        r.Strings(m.ApprovedDate, n);
        r.Strings(m.LastUpdate, n);
        r.Strings(m.Artist, n);
        r.Strings(m.Title, n);
        r.Strings(m.Version, n);
        r.Strings(m.Creator, n);
        m.Count = 0;
        for (var i = 0; i < n; i++)
        {
            // Rebuilds the id → row index; ids are unique in the file, so rows keep their order.
            if (m.Upsert(m.Id[i]) != i)
            {
                throw new InvalidDataException("duplicate beatmap id in the column cache");
            }
        }
        return m;
    }

    private static void Ints(BinaryWriter w, int[] a, int n) => w.Write(MemoryMarshal.AsBytes(a.AsSpan(0, n)));

    private static void Doubles(BinaryWriter w, double[] a, int n) => w.Write(MemoryMarshal.AsBytes(a.AsSpan(0, n)));

    private static void Bools(BinaryWriter w, bool[] a, int n) => w.Write(MemoryMarshal.AsBytes(a.AsSpan(0, n)));

    private static void Strings(BinaryWriter w, string[] a, int n)
    {
        var lengths = new int[n];
        var heap = new MemoryStream();
        Span<byte> one = stackalloc byte[1024];
        for (var i = 0; i < n; i++)
        {
            if (a[i] == null)
            {
                lengths[i] = -1;
                continue;
            }
            var bytes = Encoding.UTF8.GetByteCount(a[i]) <= one.Length ? one[..Encoding.UTF8.GetBytes(a[i], one)] : Encoding.UTF8.GetBytes(a[i]);
            lengths[i] = bytes.Length;
            heap.Write(bytes);
        }
        w.Write(MemoryMarshal.AsBytes(lengths.AsSpan()));
        w.Write((int)heap.Length);
        w.Write(heap.GetBuffer(), 0, (int)heap.Length);
    }

    /// <summary>Reads what <see cref="SaveBinary"/> wrote, straight from the file's bytes.</summary>
    private ref struct SpanReader(ReadOnlySpan<byte> data)
    {
        private readonly ReadOnlySpan<byte> data = data;
        private int at;

        public uint UInt()
        {
            var v = MemoryMarshal.Read<uint>(Take(4));
            return v;
        }

        public int Int() => MemoryMarshal.Read<int>(Take(4));

        public string String()
        {
            // BinaryWriter.Write(string): a 7-bit encoded length, then UTF-8.
            var length = 0;
            var shift = 0;
            byte b;
            do
            {
                b = Take(1)[0];
                length |= (b & 0x7F) << shift;
                shift += 7;
            }
            while ((b & 0x80) != 0);
            return Encoding.UTF8.GetString(Take(length));
        }

        public void Ints(int[] into, int n) => MemoryMarshal.Cast<byte, int>(Take(n * 4)).CopyTo(into);

        public void Doubles(double[] into, int n) => MemoryMarshal.Cast<byte, double>(Take(n * 8)).CopyTo(into);

        public void Bools(bool[] into, int n) => MemoryMarshal.Cast<byte, bool>(Take(n)).CopyTo(into);

        public void Strings(string[] into, int n)
        {
            var lengths = MemoryMarshal.Cast<byte, int>(Take(n * 4));
            var heapLength = Int();
            var heap = Take(heapLength);
            var pos = 0;
            for (var i = 0; i < n; i++)
            {
                var len = lengths[i];
                if (len < 0)
                {
                    into[i] = null;
                    continue;
                }
                into[i] = Encoding.UTF8.GetString(heap.Slice(pos, len));
                pos += len;
            }
        }

        private ReadOnlySpan<byte> Take(int n)
        {
            if (at + n > data.Length)
            {
                throw new EndOfStreamException();
            }
            var s = data.Slice(at, n);
            at += n;
            return s;
        }
    }
}
