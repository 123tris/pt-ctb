using System;
using System.Collections.Generic;
using System.Linq;
using PtCatch.Engine.Js;
using PtCatch.Engine.Model;
using PtCatch.Engine.World;

namespace PtCatch.Engine.Export;

/// <summary>Fields that replace a cached map's own in its tuple (a set's title lent to an untitled difficulty).</summary>
internal readonly record struct MapOverride(string Artist, string Title, string Creator, bool HasDate, string ApprovedDate)
{
    public bool Any => Artist != null || Title != null || Creator != null || HasDate;
}

/// <summary>A player's own file (players/{id}.json), filled in by several systems before it's written.</summary>
internal sealed class PlayerFile
{
    public Person Person;
    public SortedSet<int> MapIds = new();
    public JsNode Crowns;
    /// <summary>The duelist's slice (duels.mjs profiles), or null.</summary>
    public JsNode Duels;
    public JsNode Ledger;
    /// <summary>The pinned play: (category letter, tuple), or null.</summary>
    public (string Cat, int Tuple)? Pinned;
}

/// <summary>A map page in maps/{id % 128}.json.</summary>
internal sealed class BucketEntry
{
    public int Row = -1;
    public MapOverride Override;
    public Cat Cat;
    public Board Board;
    public bool Banned;
    public List<(int Uid, int Tuple)> Pre;
}

public sealed partial class Build
{
    /// <summary>The map fields a player's files carry (model.js PLAYER_MAP_FIELDS); the rest are null, the dates left off.</summary>
    private static readonly bool[] PlayerField = [true, true, true, true, true, true, false, false, false, false, false, true, false, true, true];

    private readonly SortedDictionary<int, PlayerFile> playerFiles = new();
    private readonly Dictionary<int, BucketEntry> mapBuckets = new();

    /// <summary>The map pages in file order: bucket (id % 128), then id, as JavaScript lists integer keys.</summary>
    private List<KeyValuePair<int, BucketEntry>> BucketOrder()
    {
        var list = new List<KeyValuePair<int, BucketEntry>>(mapBuckets);
        list.Sort((a, b) => a.Key % Buckets != b.Key % Buckets ? (a.Key % Buckets).CompareTo(b.Key % Buckets) : a.Key.CompareTo(b.Key));
        return list;
    }
    /// <summary>[id, setId, artist, title, version, stars, cat, players, topUid, mapper] rows, most players first.</summary>
    private readonly List<MapIndexRow> mapsIndex = new();

    internal readonly record struct MapIndexRow(int Id, double Set, string Artist, string Title, string Version, double Stars, string Cat, int Players, int Top, string Mapper);

    /// <summary>Writes a map's tuple (model.js M); <paramref name="player"/> keeps only the fields player files carry.</summary>
    private void WriteMapTuple(JsJsonWriter w, int row, MapOverride o = default, bool player = false)
    {
        if (row < 0)
        {
            w.Null();
            return;
        }
        w.BeginArray();
        var artist = o.Artist ?? maps.Artist[row];
        var title = o.Title ?? maps.Title[row];
        var creator = o.Creator ?? maps.Creator[row];
        w.String(string.IsNullOrEmpty(artist) ? "" : artist);
        w.String(string.IsNullOrEmpty(title) ? "" : title);
        w.String(string.IsNullOrEmpty(maps.Version[row]) ? "" : maps.Version[row]);
        w.Number(maps.SetId[row]);
        w.Number(Round(maps.Stars[row]));
        w.Number(maps.Ar[row]);
        if (player)
        {
            w.Null();
            w.Null();
            w.Null();
            w.Null();
            w.Null();
            w.Number(maps.MaxCombo[row]);
            w.Null();
            w.Number(maps.Mode[row]);
            w.String(string.IsNullOrEmpty(creator) ? "" : creator);
            w.EndArray();
            return;
        }
        w.Number(maps.Cs[row]);
        w.Number(maps.Od[row]);
        w.Number(maps.Hp[row]);
        w.Number(maps.Bpm[row]);
        w.Number(maps.HitLength[row]);
        w.Number(maps.MaxCombo[row]);
        w.Number(maps.Approved[row]);
        w.Number(maps.Mode[row]);
        w.String(string.IsNullOrEmpty(creator) ? "" : creator);
        w.Number(RankedAtWith(row, o));
        w.Number(maps.UpdatedAt(row));
        w.EndArray();
    }

    private double RankedAtWith(int row, MapOverride o) =>
        o.HasDate ? Beatmaps.RankedAtOf(maps.Approved[row], o.ApprovedDate) : maps.RankedAt(row);

    /// <summary>The same tuple as a node (for the small files built as trees).</summary>
    private JsNode MapTupleNode(int row, MapOverride o = default, bool player = false)
    {
        if (row < 0)
        {
            return JsNode.NullValue;
        }
        using var w = new JsJsonWriter(512);
        WriteMapTuple(w, row, o, player);
        return JsNode.Parse(w.Written);
    }

    /// <summary>mapsFor: <c>{ id: tuple or null }</c> for unique ids, ascending.</summary>
    private void WriteMapsFor(JsJsonWriter w, IEnumerable<int> ids, bool player = false)
    {
        w.BeginObject();
        foreach (var id in new SortedSet<int>(ids))
        {
            w.Key(id);
            WriteMapTuple(w, Row(id), default, player);
        }
        w.EndObject();
    }

    private JsNode MapsForNode(IEnumerable<int> ids, bool player = false)
    {
        var o = JsNode.Object();
        foreach (var id in new SortedSet<int>(ids))
        {
            o.Set(id.ToString(), MapTupleNode(Row(id), default, player));
        }
        return o;
    }

    // ---- Per-player files ------------------------------------------------------------------------------------

    private void BuildPlayerFiles()
    {
        foreach (var p in people)
        {
            var file = new PlayerFile { Person = p };
            foreach (var cat in Rules.Cats)
            {
                foreach (var t in p.PpLists[(int)cat])
                {
                    file.MapIds.Add(T.Map[t]);
                }
            }
            foreach (var (_, t) in p.Dan)
            {
                file.MapIds.Add(T.Map[t]);
            }
            foreach (var t in p.DumpTop)
            {
                file.MapIds.Add(T.Map[t]);
            }
            foreach (var t in p.Pre)
            {
                file.MapIds.Add(T.Map[t]);
            }
            playerFiles[p.Id] = file;
        }
    }

    private byte[] PlayerFileBytes(PlayerFile file, JsJsonWriter w)
    {
        var p = file.Person;
        w.Reset();
        w.BeginObject();
        w.Key("id");
        w.Number(p.Id);
        w.Key("name");
        w.String(p.Name);
        w.Key("scores");
        w.BeginObject();
        foreach (var cat in Rules.Cats)
        {
            w.Key(Rules.Letter(cat));
            w.BeginArray();
            foreach (var t in p.Lists[(int)cat])
            {
                T.WriteWithPos(w, t, PositionOf(p.Id, T.Map[t]));
            }
            w.EndArray();
        }
        w.EndObject();
        w.Key("top");
        WriteTuples(w, p.DumpTop);
        w.Key("dan");
        WriteDan(w, p);
        if (p.PpOnly.Count > 0)
        {
            w.Key("pp");
            w.BeginObject();
            w.Key("c");
            WriteTuples(w, p.PpOnly);
            w.EndObject();
        }
        if (p.Pre.Count > 0)
        {
            w.Key("pre");
            WriteTuples(w, p.Pre);
        }
        w.Key("maps");
        WriteMapsFor(w, file.MapIds, player: true);
        if (file.Crowns != null)
        {
            w.Key("crowns");
            w.Node(file.Crowns);
        }
        if (file.Duels != null)
        {
            w.Key("duels");
            w.Node(file.Duels);
        }
        if (file.Ledger != null)
        {
            w.Key("ledger");
            w.Node(file.Ledger);
        }
        if (file.Pinned is var (pinCat, pinTuple))
        {
            w.Key("pinned");
            w.BeginArray();
            w.String(pinCat);
            T.Fields(w, pinTuple);
            w.Number(PositionOf(p.Id, T.Map[pinTuple]) is var pos && pos > 0 ? pos : double.NaN);
            if (T.Id[pinTuple] != 0)
            {
                w.Number(T.Id[pinTuple]);
            }
            w.EndArray();
        }
        w.EndObject();
        return w.ToArray();
    }

    private void WriteTuples(JsJsonWriter w, List<int> tuples)
    {
        w.BeginArray();
        foreach (var t in tuples)
        {
            T.Write(w, t);
        }
        w.EndArray();
    }

    private void WriteDan(JsJsonWriter w, Person p)
    {
        w.BeginArray();
        foreach (var (stage, t) in p.Dan)
        {
            w.BeginArray();
            w.Number(stage);
            T.Write(w, t);
            w.EndArray();
        }
        w.EndArray();
    }

    // ---- Map buckets and the search indexes --------------------------------------------------------------------

    private readonly Dictionary<int, List<(int Uid, int Tuple)>> preBoards = new();

    private void BuildMapBuckets()
    {
        // The "played before ranked" list per map: best score first. Not a board: nothing is ranked on it.
        var preOrder = new List<int>();
        foreach (var p in people)
        {
            foreach (var t in p.Pre)
            {
                if (!preBoards.TryGetValue(T.Map[t], out var list))
                {
                    preBoards[T.Map[t]] = list = new List<(int, int)>();
                    preOrder.Add(T.Map[t]);
                }
                list.Add((p.Id, t));
            }
        }
        foreach (var list in preBoards.Values)
        {
            JsSort.Stable(list, (a, b) => JsSort.Sign(T.Score[b.Tuple] - T.Score[a.Tuple]) is var c && c != 0 ? c : a.Uid.CompareTo(b.Uid));
        }

        var sorted = new List<Board>(boards);
        sorted.Sort((a, b) => a.MapId.CompareTo(b.MapId));
        foreach (var board in sorted)
        {
            var id = board.MapId;
            var row = Row(id);
            mapBuckets[id] = new BucketEntry
            {
                Row = row, Cat = board.Cat, Board = board, Banned = IsBanned(id),
                Pre = preBoards.TryGetValue(id, out var pre) ? pre : null,
            };
            mapsIndex.Add(new MapIndexRow(
                id, row >= 0 ? maps.SetId[row] : 0, row >= 0 ? OrEmpty(maps.Artist[row]) : "", row >= 0 ? OrEmpty(maps.Title[row]) : "",
                row >= 0 ? OrEmpty(maps.Version[row]) : "", row >= 0 ? Round(maps.Stars[row]) : 0, Rules.Letter(board.Cat),
                board.Entries.Count, board.Entries[0].Uid, row >= 0 ? OrEmpty(maps.Creator[row]) : ""));
        }
        JsSort.Stable(mapsIndex, (a, b) => b.Players != a.Players ? b.Players.CompareTo(a.Players) : a.Id.CompareTo(b.Id));
        // Maps with only pre-rank plays still get a page (an empty board plus the list), but no place in the index.
        foreach (var id in preOrder)
        {
            if (boardOf.ContainsKey(id))
            {
                continue;
            }
            mapBuckets[id] = new BucketEntry { Row = Row(id), Cat = CatOf(id, Cat.Ranked), Pre = preBoards[id] };
        }
    }

    private static string OrEmpty(string s) => string.IsNullOrEmpty(s) ? "" : s;

    private byte[] BucketBytes(IEnumerable<KeyValuePair<int, BucketEntry>> entries, JsJsonWriter w)
    {
        w.Reset();
        w.BeginObject();
        foreach (var (id, e) in entries)
        {
            w.Key(id);
            w.BeginObject();
            w.Key("m");
            WriteMapTuple(w, e.Row, e.Override);
            w.Key("c");
            w.String(Rules.Letter(e.Cat));
            w.Key("s");
            w.BeginArray();
            if (e.Board != null)
            {
                foreach (var (uid, t) in e.Board.Entries)
                {
                    T.WriteEntry(w, uid, t);
                }
            }
            w.EndArray();
            if (e.Banned)
            {
                w.Key("banned");
                w.Bool(true);
            }
            if (e.Pre != null)
            {
                w.Key("pre");
                w.BeginArray();
                foreach (var (uid, t) in e.Pre)
                {
                    T.WriteEntry(w, uid, t);
                }
                w.EndArray();
            }
            w.EndObject();
        }
        w.EndObject();
        return w.ToArray();
    }

    /// <summary>maps-search.json (core/maps-search.js encodeMapsSearch): the index by column, the mapper left out.</summary>
    private byte[] MapsSearchBytes(JsJsonWriter w)
    {
        var rows = new List<MapIndexRow>(mapsIndex);
        JsSort.Stable(rows, (a, b) => a.Set != b.Set ? JsSort.Sign(a.Set - b.Set) : a.Id.CompareTo(b.Id));
        var sets = new List<(double Set, string Artist, string Title, int Mapper)>();
        var setNumber = new Dictionary<string, int>(StringComparer.Ordinal);
        var tops = new List<int>();
        var topNumber = new Dictionary<int, int>();
        var setOf = new int[rows.Count];
        var topOf = new int[rows.Count];
        for (var i = 0; i < rows.Count; i++)
        {
            var r = rows[i];
            // The Maps page's rows are sliced to nine fields, so every mapper is ''.
            var key = $"{JsMath.ToString(r.Set)}\0{r.Artist}\0{r.Title}\0";
            if (!setNumber.TryGetValue(key, out var set))
            {
                setNumber[key] = set = sets.Count;
                sets.Add((r.Set, r.Artist, r.Title, 0));
            }
            if (!topNumber.TryGetValue(r.Top, out var top))
            {
                topNumber[r.Top] = top = tops.Count;
                tops.Add(r.Top);
            }
            setOf[i] = set;
            topOf[i] = top;
        }
        w.Reset();
        w.BeginObject();
        w.Key("v");
        w.Number(1);
        w.Key("sets");
        w.BeginArray();
        foreach (var s in sets)
        {
            w.BeginArray();
            w.Number(s.Set);
            w.String(s.Artist);
            w.String(s.Title);
            w.Number(s.Mapper);
            w.EndArray();
        }
        w.EndArray();
        w.Key("tops");
        w.BeginArray();
        foreach (var t in tops)
        {
            w.Number(t);
        }
        w.EndArray();
        w.Key("mappers");
        w.BeginArray();
        if (rows.Count > 0)
        {
            w.String("");
        }
        w.EndArray();
        WriteIndexColumns(w, rows, setOf);
        w.Key("top");
        w.BeginArray();
        foreach (var t in topOf)
        {
            w.Number(t);
        }
        w.EndArray();
        w.EndObject();
        return w.ToArray();
    }

    /// <summary>search-maps.json (encodeSearchMaps): the maps two or more players here have played, with the mapper.</summary>
    private byte[] SearchMapsBytes(JsJsonWriter w)
    {
        var rows = mapsIndex.Where(r => r.Players >= 2).ToList();
        JsSort.Stable(rows, (a, b) => a.Set != b.Set ? JsSort.Sign(a.Set - b.Set) : a.Id.CompareTo(b.Id));
        var sets = new List<(double SetDelta, string Artist, string Title, int Mapper)>();
        var setNumber = new Dictionary<string, int>(StringComparer.Ordinal);
        var mappers = new List<string>();
        var mapperNumber = new Dictionary<string, int>(StringComparer.Ordinal);
        var setOf = new int[rows.Count];
        double lastSetId = 0;
        for (var i = 0; i < rows.Count; i++)
        {
            var r = rows[i];
            if (!mapperNumber.TryGetValue(r.Mapper, out var mapper))
            {
                mapperNumber[r.Mapper] = mapper = mappers.Count;
                mappers.Add(r.Mapper);
            }
            var key = $"{JsMath.ToString(r.Set)}\0{r.Artist}\0{r.Title}\0{r.Mapper}";
            if (!setNumber.TryGetValue(key, out var set))
            {
                setNumber[key] = set = sets.Count;
                sets.Add((r.Set - lastSetId, r.Artist, r.Title, mapper));
                lastSetId = r.Set;
            }
            setOf[i] = set;
        }
        w.Reset();
        w.BeginObject();
        w.Key("v");
        w.Number(1);
        w.Key("sets");
        w.BeginArray();
        foreach (var s in sets)
        {
            w.BeginArray();
            w.Number(s.SetDelta);
            w.String(s.Artist);
            w.String(s.Title);
            w.Number(s.Mapper);
            w.EndArray();
        }
        w.EndArray();
        w.Key("mappers");
        w.BeginArray();
        foreach (var m in mappers)
        {
            w.String(m);
        }
        w.EndArray();
        WriteIndexColumns(w, rows, setOf);
        w.EndObject();
        return w.ToArray();
    }

    /// <summary>The columns both indexes share: id and set as differences, version, stars in hundredths, cat, players.</summary>
    private static void WriteIndexColumns(JsJsonWriter w, List<MapIndexRow> rows, int[] setOf)
    {
        w.Key("id");
        w.BeginArray();
        var last = 0;
        foreach (var r in rows)
        {
            w.Number(r.Id - last);
            last = r.Id;
        }
        w.EndArray();
        w.Key("set");
        w.BeginArray();
        var lastSet = 0;
        foreach (var s in setOf)
        {
            w.Number(s - lastSet);
            lastSet = s;
        }
        w.EndArray();
        w.Key("ver");
        w.BeginArray();
        foreach (var r in rows)
        {
            w.String(r.Version);
        }
        w.EndArray();
        w.Key("stars");
        w.BeginArray();
        foreach (var r in rows)
        {
            w.Number(JsMath.Round(r.Stars * 100));
        }
        w.EndArray();
        w.Key("cat");
        w.String(string.Concat(rows.Select(r => r.Cat)));
        w.Key("n");
        w.BeginArray();
        foreach (var r in rows)
        {
            w.Number(r.Players);
        }
        w.EndArray();
    }

    private byte[] MapsTopBytes(JsJsonWriter w)
    {
        w.Reset();
        w.BeginObject();
        w.Key("total");
        w.Number(mapsIndex.Count);
        w.Key("rows");
        w.BeginArray();
        for (var i = 0; i < Math.Min(MapsTop, mapsIndex.Count); i++)
        {
            var r = mapsIndex[i];
            w.BeginArray();
            w.Number(r.Id);
            w.Number(r.Set);
            w.String(r.Artist);
            w.String(r.Title);
            w.String(r.Version);
            w.Number(r.Stars);
            w.String(r.Cat);
            w.Number(r.Players);
            w.Number(r.Top);
            w.EndArray();
        }
        w.EndArray();
        w.EndObject();
        return w.ToArray();
    }

    // ---- Mapsets ---------------------------------------------------------------------------------------------

    private readonly SortedDictionary<int, List<double[]>> setBuckets = new();
    /// <summary>The set rows, sorted, by set id (only sets with two or more difficulties).</summary>
    private readonly SortedDictionary<int, List<(int Id, string Version, double Stars, int Players)>> setLists = new();

    private void BuildSets()
    {
        // sets/{setId % 128}.json: each shown mapset's difficulties, easiest first, for the map page's switcher.
        var setRows = new Dictionary<int, Dictionary<int, (int Id, string Version, double Stars, int Players)>>();
        var setOrder = new List<int>();
        void AddRow(int set, (int, string, double, int) row)
        {
            if (!setRows.TryGetValue(set, out var rows))
            {
                setRows[set] = rows = new Dictionary<int, (int, string, double, int)>();
                setOrder.Add(set);
            }
            rows[row.Item1] = row;
        }
        // In bucket order: bucket number, then map id (JavaScript lists integer keys in order).
        foreach (var (id, e) in BucketOrder())
        {
            if (e.Row < 0 || maps.SetId[e.Row] == 0)
            {
                continue;
            }
            AddRow(maps.SetId[e.Row], (id, OrEmpty(maps.Version[e.Row]), Round(maps.Stars[e.Row]), e.Board?.Entries.Count ?? 0));
        }
        var paged = new List<int>(Rules.DanMaps);
        paged.AddRange(unclaimedIds);
        paged.AddRange(openBountyMapIds);
        foreach (var id in paged)
        {
            var row = Row(id);
            var set = row >= 0 ? maps.SetId[row] : 0;
            if (set != 0 && !setRows.ContainsKey(set))
            {
                setRows[set] = new Dictionary<int, (int, string, double, int)>();
                setOrder.Add(set);
            }
        }
        // The dump's rows carry no title: a difficulty without one borrows its set's (and the set's ranked date).
        var titled = new Dictionary<int, int>();
        var unlisted = new List<int>();
        for (var row = 0; row < maps.Count; row++)
        {
            var set = maps.SetId[row];
            if (!setRows.TryGetValue(set, out var rows))
            {
                continue;
            }
            if (maps.HasTitle(row) && !titled.ContainsKey(set))
            {
                titled[set] = row;
            }
            if (maps.IsCatchPlayable(row) && !rows.ContainsKey(maps.Id[row]))
            {
                unlisted.Add(row);
            }
        }
        var newEntries = new Dictionary<int, BucketEntry>();
        foreach (var row in unlisted)
        {
            var cat = maps.Classify(row);
            if (cat == Cat.None)
            {
                continue;
            }
            var o = default(MapOverride);
            if (!maps.HasTitle(row) && titled.TryGetValue(maps.SetId[row], out var donor))
            {
                var sameStatus = maps.Approved[donor] == maps.Approved[row];
                // The donor's fields, '' where it has none (toMapTuple reads a missing one as '').
                o = new MapOverride(maps.Artist[donor] ?? "", maps.Title[donor] ?? "", maps.Creator[donor] ?? "", true,
                    maps.ApprovedDate[row] ?? (sameStatus ? maps.ApprovedDate[donor] : null));
            }
            newEntries[maps.Id[row]] = new BucketEntry { Row = row, Override = o, Cat = cat };
            AddRow(maps.SetId[row], (maps.Id[row], OrEmpty(maps.Version[row]), Round(maps.Stars[row]), 0));
        }
        foreach (var set in setOrder.OrderBy(s => s))
        {
            var rows = setRows[set];
            if (rows.Count < 2)
            {
                continue;
            }
            var list = rows.Values.ToList();
            JsSort.Stable(list, (a, b) => a.Stars != b.Stars ? JsSort.Sign(a.Stars - b.Stars) : a.Id.CompareTo(b.Id));
            setLists[set] = list;
            foreach (var id in rows.Keys)
            {
                if (newEntries.TryGetValue(id, out var entry))
                {
                    mapBuckets[id] = entry;
                }
            }
        }
    }

    private byte[] SetBucketBytes(IEnumerable<KeyValuePair<int, List<(int Id, string Version, double Stars, int Players)>>> sets, JsJsonWriter w)
    {
        w.Reset();
        w.BeginObject();
        foreach (var (set, rows) in sets)
        {
            w.Key(set);
            w.BeginArray();
            foreach (var r in rows)
            {
                w.BeginArray();
                w.Number(r.Id);
                w.String(r.Version);
                w.Number(r.Stars);
                w.Number(r.Players);
                w.EndArray();
            }
            w.EndArray();
        }
        w.EndObject();
        return w.ToArray();
    }
}
